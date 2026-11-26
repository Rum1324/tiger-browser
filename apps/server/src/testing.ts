/**
 * `@tiger/server/testing`: start the real server in-process for another package's tests. It runs on
 * a fresh, migrated Postgres schema with the real routes, realtime hub and retrieval, the
 * deterministic hash embedder (no model download), and the chat layer on the mock LLM provider (no
 * key, no network). Not for production use: dev login is on and Google sign-in accepts fake tokens.
 */
import { randomBytes } from 'node:crypto'
import { type ChatProvider, MockProvider } from '@tiger/llm'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app'
import { createChat, loadChatConfig } from './chat'
import { loadConfig } from './config'
import { runMigrations } from './db/migrate'
import { createSql, type Sql } from './db/sql'
import { createRetrieval, HashEmbedder } from './retrieval'
import type { VerifyGoogleIdToken } from './seams'

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://tiger:tiger@127.0.0.1:5432/tiger_test'

/** A Google ID token that `fakeGoogleVerifier` accepts. */
export const fakeGoogleIdToken = (email: string, name: string): string => `good:${email}:${name}`

/** Accepts `good:<email>:<name>` (see `fakeGoogleIdToken`) and rejects anything else. */
export const fakeGoogleVerifier: VerifyGoogleIdToken = async (idToken) => {
  const [kind, email, name] = idToken.split(':')
  if (kind !== 'good' || !email || !name) throw new Error('bad token')
  return { sub: `g-${email}`, email, emailVerified: true, name, picture: null }
}

export type MockProviderOptions = NonNullable<ConstructorParameters<typeof MockProvider>[0]>

export interface TestServerOptions {
  /** Defaults to TEST_DATABASE_URL (env TEST_DATABASE_URL, else the local tiger_test database). */
  databaseUrl?: string
  /** Options of the mock provider. Default `{ chunkDelayMs: 8, chunkSize: 6 }`: answers really stream. */
  mock?: MockProviderOptions
  /** Replaces the mock provider (registered under the `mock` provider name), e.g. a scripted one. */
  provider?: ChatProvider
  /** Extra server configuration, as environment variables (e.g. `SPACE_TOKEN_BUDGET`). */
  env?: Record<string, string>
  /** Extra chat configuration (`CHAT_*`). Titles are off by default (`CHAT_THREAD_TITLES=0`). */
  chatEnv?: Record<string, string>
  /** Default `fakeGoogleVerifier`. */
  verifyGoogleIdToken?: VerifyGoogleIdToken
}

export interface TestServer {
  app: FastifyInstance
  /** Connected to the server's own schema (search path `<schema>, public`). */
  sql: Sql
  schema: string
  port: number
  /** `http://127.0.0.1:<port>`; the WebSocket is at `ws://127.0.0.1:<port>/v1/ws`. */
  url: string
  /** Wait for indexing and AI answers started so far. */
  settle(): Promise<void>
  /** Drop every WebSocket connection from the server side, as a network failure would. */
  dropSockets(): void
  /** Stop the server, then drop its schema. */
  close(): Promise<void>
}

export async function startTestServer(opts: TestServerOptions = {}): Promise<TestServer> {
  const databaseUrl = opts.databaseUrl ?? TEST_DATABASE_URL
  const schema = `c_${randomBytes(6).toString('hex')}`
  const admin = createSql(databaseUrl, { max: 1 })
  try {
    await admin.unsafe(`create schema ${schema}`)
  } finally {
    await admin.end()
  }
  const dropSchema = async () => {
    const cleanup = createSql(databaseUrl, { max: 1 })
    try {
      await cleanup.unsafe(`drop schema if exists ${schema} cascade`)
    } finally {
      await cleanup.end()
    }
  }

  const sql = createSql(databaseUrl, { max: 8, searchPath: `${schema}, public` })
  let app: FastifyInstance | null = null
  try {
    await runMigrations(sql)
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      AUTH_DEV_LOGIN: '1',
      AUTH_RATE_LIMIT_PER_MINUTE: '100000',
      PUBLIC_URL: 'https://tiger.test',
      ...opts.env,
    })
    const retrieval = createRetrieval({ sql, embedder: new HashEmbedder() })
    const chat = createChat({
      sql,
      config: loadChatConfig(config, {
        CHAT_ENABLE_MOCK: '1',
        CHAT_THREAD_TITLES: '0',
        ...opts.chatEnv,
      }),
      contextBuilder: retrieval.contextBuilder,
      routerOptions: {
        providers: {
          mock: opts.provider ?? new MockProvider(opts.mock ?? { chunkDelayMs: 8, chunkSize: 6 }),
        },
        retry: { maxAttempts: 1 },
      },
    })
    const built = await buildApp({
      sql,
      config,
      logger: false,
      indexer: retrieval.indexer,
      retriever: retrieval.retriever,
      answerer: chat.answerer,
      models: chat.models,
      verifyGoogleIdToken: opts.verifyGoogleIdToken ?? fakeGoogleVerifier,
    })
    app = built
    chat.attach(built)
    await built.listen({ host: '127.0.0.1', port: 0 })
    const addr = built.server.address()
    if (!addr || typeof addr === 'string') throw new Error('test server has no TCP address')

    return {
      app: built,
      sql,
      schema,
      port: addr.port,
      url: `http://127.0.0.1:${addr.port}`,
      settle: () => built.tiger.background.drain(),
      dropSockets() {
        for (const ws of built.websocketServer.clients) ws.terminate()
      },
      async close() {
        await built.close()
        await sql.end({ timeout: 5 })
        await dropSchema()
      },
    }
  } catch (err) {
    if (app) await app.close().catch(() => {})
    await sql.end({ timeout: 5 }).catch(() => {})
    await dropSchema().catch(() => {})
    throw err
  }
}
