import type { Citation, RouteDef } from '@tiger/shared'
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
  /**
   * AI answers still streaming, by assistant message id: deleting a thread or `abortMessage` stops
   * them, and `listMessages` serves their text so far from here instead of the database.
   */
  runningAnswers: Map<string, RunningAnswer>
}

export interface RunningAnswer {
  messageId: string
  threadId: string
  spaceId: string
  /** The member who asked; they (or a Space owner) may abort it. */
  askerId: string
  controller: AbortController
  /** Text forwarded to subscribers so far: exactly the deltas with seq < `seq`. */
  text: string
  /** Number of deltas forwarded so far. */
  seq: number
  /** The latest `message.sources` sent, or null before the first. */
  citations: Citation[] | null
  /** Resolves once the message's final state is stored and announced. */
  done: Promise<void>
}

declare module 'fastify' {
  interface FastifyInstance {
    tiger: AppContext
    /** Contract routes registered through registerRoute; a test checks none is missing. */
    contractRoutes: Set<RouteDef<unknown, unknown, unknown, unknown>>
  }
}
