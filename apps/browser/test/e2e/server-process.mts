/**
 * The Tiger server as its own process for the MVP end-to-end test: the real routes, realtime hub,
 * retrieval (hash embedder) and chat layer (mock provider), on a fresh schema in tiger_test, through
 * the server's supported test entry. In front of it sits a recording proxy, so the test can read
 * every request that reached the server: method, URL, body, and every text frame a client sent on a
 * WebSocket.
 *
 * Run: tsx test/e2e/server-process.mts  (env TIGER_E2E_REQUEST_LOG=<file.jsonl>)
 * Prints one JSON line `{ "proxyUrl", "directUrl" }` when ready. SIGTERM closes the server and drops
 * its schema.
 */
import { appendFileSync } from 'node:fs'
import { createServer, request as httpRequest, type IncomingMessage } from 'node:http'
import { type AddressInfo, connect, type Socket } from 'node:net'
import { startTestServer } from '@tiger/server/testing'

const LOG = process.env.TIGER_E2E_REQUEST_LOG
if (!LOG) throw new Error('TIGER_E2E_REQUEST_LOG is required')
const logFile: string = LOG

export interface LoggedRequest {
  kind: 'http' | 'ws-upgrade' | 'ws-frame'
  method: string
  url: string
  body: string
  at: string
}

function record(entry: Omit<LoggedRequest, 'at'>): void {
  appendFileSync(logFile, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`)
}

// The proxy listens first: its address is the server's public URL, so the invite links the server
// issues point at the server the browser is configured with.
let target = new URL('http://127.0.0.1:9')

/** Unmask and log the client's text frames, as they pass through unchanged. */
function frameLogger(url: string): (chunk: Buffer) => void {
  let buf = Buffer.alloc(0)
  return (chunk) => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      if (buf.length < 2) return
      const b0 = buf[0] as number
      const b1 = buf[1] as number
      let len = b1 & 0x7f
      let off = 2
      if (len === 126) {
        if (buf.length < 4) return
        len = buf.readUInt16BE(2)
        off = 4
      } else if (len === 127) {
        if (buf.length < 10) return
        len = Number(buf.readBigUInt64BE(2))
        off = 10
      }
      const masked = (b1 & 0x80) !== 0
      const maskAt = off
      if (masked) off += 4
      if (buf.length < off + len) return
      const payload = Buffer.from(buf.subarray(off, off + len))
      if (masked) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] = (payload[i] as number) ^ (buf[maskAt + (i % 4)] as number)
        }
      }
      if ((b0 & 0x0f) === 1)
        record({ kind: 'ws-frame', method: 'WS', url, body: payload.toString('utf8') })
      buf = buf.subarray(off + len)
    }
  }
}

const proxy = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    record({
      kind: 'http',
      method: req.method ?? 'GET',
      url: req.url ?? '',
      body: body.toString('utf8'),
    })
    const upstream = httpRequest(
      {
        host: target.hostname,
        port: target.port,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers)
        up.pipe(res)
      },
    )
    upstream.on('error', () => {
      res.writeHead(502)
      res.end()
    })
    upstream.end(body)
  })
})

proxy.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
  const url = req.url ?? ''
  record({ kind: 'ws-upgrade', method: req.method ?? 'GET', url, body: '' })
  const up = connect(Number(target.port), target.hostname, () => {
    const lines = [`${req.method} ${url} HTTP/1.1`]
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i] as string
      // No compression, so the recorded frames are readable.
      if (name.toLowerCase() === 'sec-websocket-extensions') continue
      lines.push(`${name}: ${req.rawHeaders[i + 1]}`)
    }
    up.write(`${lines.join('\r\n')}\r\n\r\n`)
    const log = frameLogger(url)
    if (head.length) {
      log(head)
      up.write(head)
    }
    socket.on('data', (c: Buffer) => {
      log(c)
      up.write(c)
    })
    up.pipe(socket)
  })
  const end = () => {
    socket.destroy()
    up.destroy()
  }
  up.on('error', end)
  socket.on('error', end)
  up.on('close', end)
  socket.on('close', end)
})

await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
const port = (proxy.address() as AddressInfo).port
const server = await startTestServer({
  mock: { chunkDelayMs: 25, chunkSize: 5 },
  env: { PUBLIC_URL: `http://127.0.0.1:${port}` },
})
target = new URL(server.url)
process.stdout.write(
  `${JSON.stringify({ proxyUrl: `http://127.0.0.1:${port}`, directUrl: server.url })}\n`,
)

let closing = false
const shutdown = async () => {
  if (closing) return
  closing = true
  proxy.closeAllConnections()
  proxy.close()
  // Requests in flight make the server's close hang (see the client tests); give them a moment.
  await new Promise((r) => setTimeout(r, 300))
  await Promise.race([server.close(), new Promise((r) => setTimeout(r, 10_000))])
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())
