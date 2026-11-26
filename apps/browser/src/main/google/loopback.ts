import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { GoogleAuthError } from './errors'

export interface LoopbackOptions {
  /** The state value sent in the authorization request; the redirect must carry it back. */
  state: string
  timeoutMs: number
  /** Aborting closes the listener and rejects with `cancelled`. */
  signal?: AbortSignal
}

export interface Loopback {
  /** http://127.0.0.1:<port>, registered nowhere: Google accepts any port for desktop clients. */
  redirectUri: string
  /** Resolves with the authorization code; rejects with a GoogleAuthError. Settles exactly once. */
  code: Promise<string>
  close(): void
}

const PAGE_STYLE =
  'body{font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;background:#f6f5f2;color:#1d1d1b;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0 0 1.5rem;color:#55534e}'

/** The page the system browser shows after the redirect, in Japanese first and English. No script. */
export function returnPage(ok: boolean): string {
  const [jaTitle, jaBody, enTitle, enBody] = ok
    ? [
        'Tiger に戻ってください',
        'Google での手続きが完了しました。このタブは閉じてかまいません。',
        'You can return to Tiger',
        'Google is done. You may close this tab.',
      ]
    : [
        'Google での手続きは完了しませんでした',
        'Tiger に戻って、もう一度お試しください。このタブは閉じてかまいません。',
        'Google did not finish',
        'Return to Tiger and try again. You may close this tab.',
      ]
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tiger</title><style>${PAGE_STYLE}</style></head><body><main><h1>${jaTitle}</h1><p>${jaBody}</p><h1 lang="en">${enTitle}</h1><p lang="en">${enBody}</p></main></body></html>`
}

function respond(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'Referrer-Policy': 'no-referrer',
    Connection: 'close',
  })
  res.end(html)
}

/**
 * Listen on 127.0.0.1 at a random port for the one redirect that ends an authorization request.
 * The first request to "/" decides the outcome and closes the listener; other paths (a favicon
 * probe) get 404 and do not count.
 */
export async function startLoopback(opts: LoopbackOptions): Promise<Loopback> {
  let settle: { resolve: (code: string) => void; reject: (e: GoogleAuthError) => void } | null =
    null
  const code = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject }
  })
  // The caller may never await `code` if opening the browser fails first.
  code.catch(() => {})

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method !== 'GET' || url.pathname !== '/' || !settle) {
      respond(res, 404, '')
      return
    }
    const params = url.searchParams
    if (params.get('state') !== opts.state) {
      respond(res, 400, returnPage(false))
      finish(new GoogleAuthError('state-mismatch', 'the redirect carried an unexpected state'))
      return
    }
    const error = params.get('error')
    if (error) {
      respond(res, 200, returnPage(false))
      finish(
        new GoogleAuthError(
          error === 'access_denied' ? 'denied' : 'failed',
          `authorization ended with ${error.slice(0, 64)}`,
        ),
      )
      return
    }
    const value = params.get('code')
    if (!value) {
      respond(res, 400, returnPage(false))
      finish(new GoogleAuthError('failed', 'the redirect carried no authorization code'))
      return
    }
    respond(res, 200, returnPage(true))
    finish(value)
  })

  let timer: NodeJS.Timeout | null = null
  const onAbort = () =>
    finish(new GoogleAuthError('cancelled', 'a newer request replaced this one'))

  function finish(outcome: string | GoogleAuthError): void {
    const s = settle
    if (!s) return
    settle = null
    if (timer) clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
    server.close()
    // Let the response that is being written finish, then drop keep-alive sockets.
    setImmediate(() => server.closeAllConnections())
    if (typeof outcome === 'string') s.resolve(outcome)
    else s.reject(outcome)
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const { port } = server.address() as AddressInfo

  timer = setTimeout(
    () => finish(new GoogleAuthError('timeout', 'nobody returned from the browser in time')),
    opts.timeoutMs,
  )
  if (opts.signal?.aborted) onAbort()
  else opts.signal?.addEventListener('abort', onAbort, { once: true })

  return {
    redirectUri: `http://127.0.0.1:${port}`,
    code,
    close: () => finish(new GoogleAuthError('cancelled', 'the listener was closed')),
  }
}
