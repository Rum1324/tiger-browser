import type { Settings } from '@tiger/shared'

export type SearchEngine = Settings['searchEngine']

const SEARCH_URL: Record<SearchEngine, string> = {
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q=',
}

export function searchUrl(query: string, engine: SearchEngine): string {
  return SEARCH_URL[engine] + encodeURIComponent(query)
}

/** Pages may only ever be http(s); everything else (file:, javascript:, tiger:, data:) is refused. */
export function isWebUrl(raw: string): boolean {
  try {
    const { protocol } = new URL(raw)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

const HAS_SCHEME = /^([a-z][a-z0-9+.-]*):/i
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i
const TLD = /^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/i

/** Hosts that are normally served without TLS, so a bare host gets http:// rather than https://. */
function isLocalHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.test') ||
    IPV4.test(host) ||
    host.startsWith('[')
  )
}

function looksLikeHost(host: string): boolean {
  if (host === 'localhost' || host.startsWith('[')) return true
  if (IPV4.test(host)) return host.split('.').every((n) => Number(n) <= 255)
  const labels = host.split('.')
  if (labels.length < 2) return false
  if (!labels.every((l) => LABEL.test(l))) return false
  return TLD.test(labels[labels.length - 1] ?? '')
}

/**
 * Turn what the member typed into a URL to load. Typed http(s) URLs load as they are, a bare host
 * gets a scheme, and anything else (including other schemes, which pages may never load) becomes a
 * search with the chosen engine. Returns null for blank input.
 */
export function resolveInput(input: string, engine: SearchEngine): string | null {
  const text = input.trim()
  if (!text) return null
  // A leading "?" is the conventional way to force a search.
  if (text.startsWith('?')) {
    const q = text.slice(1).trim()
    return q ? searchUrl(q, engine) : null
  }
  if (/\s/.test(text)) return searchUrl(text, engine)

  const scheme = HAS_SCHEME.exec(text)?.[1]?.toLowerCase()
  if (scheme === 'http' || scheme === 'https') {
    return isWebUrl(text) ? new URL(text).href : searchUrl(text, engine)
  }
  // "localhost:3000" and "example.com:8080/x" parse as a scheme; treat host:port as a host.
  const hostPort = /^([^/?#:]+|\[[^\]]+\]):(\d{1,5})(?=[/?#]|$)/.exec(text)
  if (scheme && !hostPort) return searchUrl(text, engine)

  const host = (/^([^/?#:]+|\[[^\]]+\])/.exec(text)?.[1] ?? '').toLowerCase()
  if (!looksLikeHost(host)) return searchUrl(text, engine)
  const candidate = `${isLocalHost(host) ? 'http' : 'https'}://${text}`
  return isWebUrl(candidate) ? new URL(candidate).href : searchUrl(text, engine)
}
