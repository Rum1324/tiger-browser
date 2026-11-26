import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
import type { RouteDef } from '@tiger/shared'
import Fastify, { type FastifyInstance } from 'fastify'
import { googleIdTokenVerifier } from './auth/google'
import { BackgroundTasks } from './background'
import type { Config } from './config'
import type { AppContext } from './context'
import type { Sql } from './db/sql'
import { installErrorHandlers } from './http/errors'
import { SlidingWindowLimiter } from './http/limiter'
import { RealtimeHub } from './realtime/hub'
import { websocketRoute } from './realtime/ws'
import { authRoutes } from './routes/auth'
import { itemRoutes } from './routes/items'
import { metaRoutes } from './routes/meta'
import { spaceRoutes } from './routes/spaces'
import { threadRoutes } from './routes/threads'
import {
  type Answerer,
  emptyModelDirectory,
  type Indexer,
  type ModelDirectory,
  noopIndexer,
  type Retriever,
  trigramRetriever,
  unavailableAnswerer,
  type VerifyGoogleIdToken,
} from './seams'

export interface BuildAppOptions {
  sql: Sql
  config: Config
  indexer?: Indexer
  answerer?: Answerer
  models?: ModelDirectory
  retriever?: Retriever
  /** Defaults to google-auth-library against config.googleClientId; tests inject a fake. */
  verifyGoogleIdToken?: VerifyGoogleIdToken
  /** Pino options or false; defaults to config.logLevel with the Authorization header redacted. */
  logger?: boolean | object
  /**
   * How long `close()` lets in-flight requests, settling answers and closing sockets take before it
   * cuts the remaining connections. Default SHUTDOWN_GRACE_MS.
   */
  shutdownGraceMs?: number
}

export const SHUTDOWN_GRACE_MS = 3000

/** Resolves true once `p` settles, or false when `ms` passes first. */
async function within(p: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.max(0, ms))
  })
  try {
    return await Promise.race([p.then(() => true), timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** Three attachments of up to 600k characters each, at up to 3 bytes per character, plus JSON. */
const BODY_LIMIT = 8 * 1024 * 1024

/**
 * Build the HTTP + WebSocket app. The database pool is owned by the caller: closing the app stops
 * background work and sockets but does not end `sql`.
 */
export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const { config, sql } = opts
  const app = Fastify({
    bodyLimit: BODY_LIMIT,
    trustProxy: config.env === 'production',
    logger:
      opts.logger ??
      ({
        level: config.logLevel,
        redact: ['req.headers.authorization', 'req.headers.cookie'],
      } as object),
  })

  const ctx: AppContext = {
    sql,
    config,
    log: app.log,
    hub: new RealtimeHub(app.log),
    background: new BackgroundTasks(app.log),
    indexer: opts.indexer ?? noopIndexer,
    answerer: opts.answerer ?? unavailableAnswerer,
    models: opts.models ?? emptyModelDirectory,
    retriever: opts.retriever ?? trigramRetriever(sql),
    verifyGoogleIdToken:
      opts.verifyGoogleIdToken ??
      (config.googleClientId ? googleIdTokenVerifier(config.googleClientId) : null),
    shutdown: new AbortController(),
    runningAnswers: new Map(),
    shareLimiter: new SlidingWindowLimiter(config.shareRateLimitPerMinute, 60_000),
  }
  app.decorate('tiger', ctx)
  app.decorate('contractRoutes', new Set<RouteDef<unknown, unknown, unknown, unknown>>())

  installErrorHandlers(app)
  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  })
  await app.register(rateLimit, { global: false })
  // Sockets are closed by the shutdown sequence below, after running answers have settled.
  await app.register(websocket, {
    options: { maxPayload: 64 * 1024 },
    preClose: (done) => done(),
  })

  installShutdown(app, ctx, opts.shutdownGraceMs ?? SHUTDOWN_GRACE_MS)

  await app.register(async (scope) => {
    metaRoutes(scope)
    authRoutes(scope)
    spaceRoutes(scope)
    itemRoutes(scope)
    threadRoutes(scope)
    websocketRoute(scope)
  })
  return app
}

/**
 * A deterministic `close()`. Fastify stops routing first (new requests get 503 with
 * `Connection: close`) and then waits in `server.close()` for every connection to end, which open
 * keep-alive and WebSocket connections never do by themselves. So, within `graceMs` of the start:
 *
 * 1. Running answers and indexing are aborted and allowed to record their final state, so their
 *    messages settle and subscribers get `message.failed` before their socket goes.
 * 2. Every WebSocket gets a close frame (1001); idle keep-alive connections are closed, and responses
 *    still being produced are sent with `Connection: close`.
 * 3. At the deadline, whatever is still open (a request that has not finished, a socket that never
 *    answered the close frame) is cut.
 */
function installShutdown(app: FastifyInstance, ctx: AppContext, graceMs: number): void {
  let deadline = 0
  let force: NodeJS.Timeout | undefined
  const forceClose = () => {
    for (const ws of app.websocketServer.clients) ws.terminate()
    app.server.closeAllConnections()
  }

  app.addHook('onSend', async (_request, reply) => {
    if (ctx.shutdown.signal.aborted) reply.header('connection', 'close')
  })

  app.addHook('preClose', async () => {
    deadline = Date.now() + graceMs
    ctx.shutdown.abort()
    force = setTimeout(forceClose, graceMs)
    if (!(await within(ctx.background.drain(), deadline - Date.now()))) {
      ctx.log.warn({ tasks: ctx.background.size }, 'background work still running at shutdown')
    }
    ctx.hub.closeAll()
    // Sockets that never authenticated are not in the hub.
    for (const ws of app.websocketServer.clients) ws.close(1001, 'server shutting down')
    app.server.closeIdleConnections()
  })

  // After server.close() returned: every connection is gone. Requests that finished during the grace
  // period may have started work (an answer is aborted at once); wait for it to settle as well.
  app.addHook('onClose', async () => {
    clearTimeout(force)
    if (!(await within(ctx.background.drain(), Math.max(deadline - Date.now(), 500)))) {
      ctx.log.warn({ tasks: ctx.background.size }, 'background work still running after close')
    }
    ctx.hub.closeAll()
  })
}
