import {
  ApiError,
  type ApiRouteName,
  api,
  buildPath,
  type ExtractedPage,
  type RouteInput,
  type RouteOutput,
  ServerEvent,
  type User,
} from '@tiger/shared'
import type { FastifyInstance } from 'fastify'
import { expect } from 'vitest'
import WebSocket from 'ws'
import { type BuildAppOptions, buildApp } from '../../src/app'
import { type Config, loadConfig } from '../../src/config'
import type { Sql } from '../../src/db/sql'
import { createTestDb, TEST_DATABASE_URL, type TestDb } from './db'

type Def<N extends ApiRouteName> = (typeof api)[N]

export type CallResult<N extends ApiRouteName> =
  | { status: 200; body: RouteOutput<Def<N>> }
  | { status: number; body: ApiError }

export interface Harness {
  app: FastifyInstance
  sql: Sql
  config: Config
  db: TestDb
  /**
   * Call a contract route through Fastify's injector. Every 200 body is parsed with the route's
   * response schema and every error body with ApiError, so a test fails on any contract drift.
   */
  call<N extends ApiRouteName>(
    name: N,
    input: RouteInput<Def<N>>,
    token?: string,
  ): Promise<CallResult<N>>
  /** Like call, but asserts 200 and returns the typed body. */
  ok<N extends ApiRouteName>(
    name: N,
    input: RouteInput<Def<N>>,
    token?: string,
  ): Promise<RouteOutput<Def<N>>>
  /** Asserts the call failed with this status and code. */
  fails<N extends ApiRouteName>(
    name: N,
    input: RouteInput<Def<N>>,
    token: string | undefined,
    status: number,
    code: string,
  ): Promise<void>
  login(name: string): Promise<{ token: string; user: User }>
  /** Waits for indexing and AI answers started so far. */
  settle(): Promise<void>
  listen(): Promise<number>
  close(): Promise<void>
}

export interface HarnessOptions extends Omit<BuildAppOptions, 'sql' | 'config'> {
  env?: Record<string, string>
}

let emailSeq = 0

export async function startHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const db = await createTestDb()
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    AUTH_DEV_LOGIN: '1',
    AUTH_RATE_LIMIT_PER_MINUTE: '100000',
    PUBLIC_URL: 'https://tiger.test',
    ...opts.env,
  })
  const { env: _env, ...rest } = opts
  const app = await buildApp({ sql: db.sql, config, logger: false, ...rest })

  const call = async <N extends ApiRouteName>(
    name: N,
    input: RouteInput<Def<N>>,
    token?: string,
  ): Promise<CallResult<N>> => {
    const def = api[name]
    const i = input as {
      params?: Record<string, string>
      query?: Record<string, unknown>
      body?: unknown
    }
    const res = await app.inject({
      method: def.method,
      url: buildPath(def.path, i.params),
      query: i.query as Record<string, string> | undefined,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      ...(i.body !== undefined ? { payload: i.body as object } : {}),
    })
    const json = res.json()
    if (res.statusCode === 200) {
      const parsed = (
        def.response as { safeParse(v: unknown): { success: boolean; error?: unknown } }
      ).safeParse(json)
      if (!parsed.success) {
        throw new Error(`${name} response breaks the contract: ${JSON.stringify(parsed.error)}`)
      }
      return { status: 200, body: json }
    }
    return { status: res.statusCode, body: ApiError.parse(json) }
  }

  const harness: Harness = {
    app,
    sql: db.sql,
    config,
    db,
    call,
    async ok(name, input, token) {
      const r = await call(name, input, token)
      if (r.status !== 200) throw new Error(`${name} failed: ${r.status} ${JSON.stringify(r.body)}`)
      return r.body as RouteOutput<Def<typeof name>>
    },
    async fails(name, input, token, status, code) {
      const r = await call(name, input, token)
      expect({ status: r.status, code: 'error' in r.body ? r.body.error.code : null }).toEqual({
        status,
        code,
      })
    },
    async login(name) {
      const email = `${name.toLowerCase()}.${process.pid}.${++emailSeq}@example.com`
      return harness.ok('authDev', { body: { email, name } })
    },
    settle: () => app.tiger.background.drain(),
    async listen() {
      if (!app.server.listening) await app.listen({ host: '127.0.0.1', port: 0 })
      const addr = app.server.address()
      if (!addr || typeof addr === 'string') throw new Error('no port')
      return addr.port
    },
    async close() {
      await app.close()
      await db.drop()
    },
  }
  return harness
}

export function page(url: string, markdown: string, title = 'A page'): ExtractedPage {
  return {
    url,
    title,
    sourceType: 'web',
    markdown,
    lang: 'en',
    byline: null,
    siteName: null,
    extractor: 'readability@1',
    capturedAt: new Date().toISOString(),
    charCount: markdown.length,
    truncated: false,
  }
}

// ── WebSocket client ────────────────────────────────────────────────────────

export interface WsClient {
  socket: WebSocket
  /** Every frame received, each parsed with the contract's ServerEvent schema. */
  events: ServerEvent[]
  send(frame: unknown): void
  next<T extends ServerEvent['type']>(
    type: T,
    pred?: (e: Extract<ServerEvent, { type: T }>) => boolean,
    timeoutMs?: number,
  ): Promise<Extract<ServerEvent, { type: T }>>
  /** Round-trips a ping: every frame the server sent before the pong has arrived. */
  sync(): Promise<void>
  closed: Promise<{ code: number; reason: string }>
  close(): void
}

export async function connectWs(port: number): Promise<WsClient> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/ws`)
  const events: ServerEvent[] = []
  const waiters: (() => void)[] = []
  socket.on('message', (raw) => {
    events.push(ServerEvent.parse(JSON.parse(raw.toString())))
    for (const w of waiters.splice(0)) w()
  })
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    socket.on('close', (code, reason) => {
      resolve({ code, reason: reason.toString() })
      for (const w of waiters.splice(0)) w()
    }),
  )
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })
  // Matching events are consumed; others stay available to later `next` calls.
  const consumed = new Set<number>()
  const client: WsClient = {
    socket,
    events,
    closed,
    send: (frame) => socket.send(JSON.stringify(frame)),
    async next(type, pred, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        for (let i = 0; i < events.length; i++) {
          const e = events[i] as ServerEvent
          if (consumed.has(i) || e.type !== type || (pred && !pred(e as never))) continue
          consumed.add(i)
          return e as never
        }
        if (socket.readyState === WebSocket.CLOSED)
          throw new Error(`socket closed waiting for ${type}`)
        const left = deadline - Date.now()
        if (left <= 0) throw new Error(`timed out waiting for ${type}`)
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, left)
          waiters.push(() => {
            clearTimeout(t)
            resolve()
          })
        })
      }
    },
    async sync() {
      client.send({ type: 'ping' })
      await client.next('pong')
    },
    close: () => socket.close(),
  }
  return client
}

/** Connect, authenticate and subscribe; resolves once the subscription is in place. */
export async function connectAs(
  port: number,
  token: string,
  spaceIds: string[],
): Promise<WsClient> {
  const c = await connectWs(port)
  c.send({ type: 'auth', token })
  await c.next('ready')
  c.send({ type: 'subscribe', spaceIds })
  await c.sync()
  return c
}
