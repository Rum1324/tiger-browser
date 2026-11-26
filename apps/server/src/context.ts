import type { RouteDef } from '@tiger/shared'
import type { FastifyBaseLogger } from 'fastify'
import type { BackgroundTasks } from './background'
import type { Config } from './config'
import type { Sql } from './db/sql'
import type { RealtimeHub } from './realtime/hub'
import type { Answerer, Indexer, ModelDirectory, Retriever, VerifyGoogleIdToken } from './seams'

/** Everything a route or service needs, built once per app instance. */
export interface AppContext {
  sql: Sql
  config: Config
  log: FastifyBaseLogger
  hub: RealtimeHub
  background: BackgroundTasks
  indexer: Indexer
  answerer: Answerer
  models: ModelDirectory
  retriever: Retriever
  /** Null when Google sign-in is not configured. */
  verifyGoogleIdToken: VerifyGoogleIdToken | null
  /** Aborted on shutdown; every background task's signal follows it. */
  shutdown: AbortController
  /** Running AI answers by thread, so deleting a thread stops its answers. */
  runningAnswers: Map<string, Set<AbortController>>
}

declare module 'fastify' {
  interface FastifyInstance {
    tiger: AppContext
    /** Contract routes registered through registerRoute; a test checks none is missing. */
    contractRoutes: Set<RouteDef<unknown, unknown, unknown, unknown>>
  }
}
