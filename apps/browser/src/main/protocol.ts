import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import type { Session } from 'electron'

export const UI_SCHEME = 'tiger'
export const UI_HOST = 'ui'
export const UI_ORIGIN = `${UI_SCHEME}://${UI_HOST}`

/**
 * The origins the UI may connect to: the configured Tiger server, over HTTP(S) and its WebSocket.
 * Nothing else: the UI never talks to sites, LLM providers or Google itself.
 */
export function serverConnectSources(serverUrl: string | null): string[] {
  if (!serverUrl) return []
  let u: URL
  try {
    u = new URL(serverUrl)
  } catch {
    return []
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return []
  const ws = `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`
  return [u.origin, ws]
}

/**
 * No inline script, no eval, no remote code, no frames, no plugins. `connect-src` adds the
 * configured server; a changed server URL applies to UI documents loaded after the change.
 */
export function uiCsp(serverUrl: string | null): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: http:",
    "font-src 'self' data:",
    ["connect-src 'self'", ...serverConnectSources(serverUrl)].join(' '),
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/** The policy with no server configured. */
export const UI_CSP = uiCsp(null)

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
}

/** Map a tiger://ui/ request path to a file under `root`, refusing anything that escapes it. */
export function resolveUiFile(root: string, requestUrl: string): string | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (url.protocol !== `${UI_SCHEME}:` || url.host !== UI_HOST) return null
  let path: string
  try {
    path = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  if (path.includes('\0')) return null
  if (path === '/' || path === '') path = '/index.html'
  const base = normalize(root.endsWith(sep) ? root : root + sep)
  const file = normalize(join(base, path))
  return file.startsWith(base) ? file : null
}

/** Serve the built renderer from tiger://ui on the chrome-ui session only. */
export function registerUiProtocol(
  ses: Session,
  rendererRoot: string,
  serverUrl: () => string | null,
): void {
  ses.protocol.handle(UI_SCHEME, async (request) => {
    const file = resolveUiFile(rendererRoot, request.url)
    if (!file) return new Response('not found', { status: 404 })
    try {
      const body = await readFile(file)
      const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
      return new Response(body, {
        headers: {
          'content-type': type,
          'content-security-policy': uiCsp(serverUrl()),
          'x-content-type-options': 'nosniff',
        },
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}
