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
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } })

  // Stop answers and indexing first, let them record their final state, then drop the sockets.
  app.addHook('onClose', async () => {
    ctx.shutdown.abort()
    await ctx.background.drain()
    ctx.hub.closeAll()
  })

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
