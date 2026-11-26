import { randomBytes } from 'node:crypto'
import { MockProvider } from '@tiger/llm'
import { buildApp, createSql, loadConfig, runMigrations, type Sql } from '@tiger/server'
// The chat and retrieval layers are not part of @tiger/server's public exports yet (see the
// contract requests in the report); the tests reach them by path, read-only.
import { createChat, loadChatConfig } from '../../../../apps/server/src/chat'
import { createRetrieval, HashEmbedder } from '../../../../apps/server/src/retrieval'

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://tiger:tiger@127.0.0.1:5432/tiger_test'

export interface TestServer {
  app: Awaited<ReturnType<typeof buildApp>>
  sql: Sql
  url: string
  /** Wait for indexing and AI answers started so far. */
  settle(): Promise<void>
  /** Drop every WebSocket connection from the server side, as a network failure would. */
  dropSockets(): void
  close(): Promise<void>
}

/** A Google ID token the fake verifier accepts: `good:<email>:<name>`. */
export const googleToken = (email: string, name: string) => `good:${email}:${name}`

/**
 * The real server, in-process, on its own migrated schema in tiger_test: real routes, realtime hub,
 * retrieval with the deterministic hash embedder, and the chat layer with the mock LLM provider.
 */
export async function startServer(): Promise<TestServer> {
  const schema = `c_${randomBytes(6).toString('hex')}`
  const admin = createSql(TEST_DATABASE_URL, { max: 1 })
  await admin.unsafe(`create schema ${schema}`)
  await admin.end()
  const sql = createSql(TEST_DATABASE_URL, { max: 8, searchPath: `${schema}, public` })
  await runMigrations(sql)

  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    AUTH_DEV_LOGIN: '1',
    AUTH_RATE_LIMIT_PER_MINUTE: '100000',
    PUBLIC_URL: 'https://tiger.test',
  })
  const retrieval = createRetrieval({ sql, embedder: new HashEmbedder() })
  const chat = createChat({
    sql,
    config: loadChatConfig(config, { CHAT_ENABLE_MOCK: '1', CHAT_THREAD_TITLES: '0' }),
    contextBuilder: retrieval.contextBuilder,
    routerOptions: {
      // Small chunks with a delay so answers really stream as many deltas.
      providers: { mock: new MockProvider({ chunkDelayMs: 8, chunkSize: 6 }) },
      retry: { maxAttempts: 1 },
    },
  })
  const app = await buildApp({
    sql,
    config,
    logger: false,
    indexer: retrieval.indexer,
    retriever: retrieval.retriever,
    answerer: chat.answerer,
    models: chat.models,
    verifyGoogleIdToken: async (idToken) => {
      const [kind, email, name] = idToken.split(':')
      if (kind !== 'good' || !email || !name) throw new Error('bad token')
      return { sub: `g-${email}`, email, emailVerified: true, name, picture: null }
    },
  })
  chat.attach(app)
  await app.listen({ host: '127.0.0.1', port: 0 })
  const addr = app.server.address()
  if (!addr || typeof addr === 'string') throw new Error('no port')

  return {
    app,
    sql,
    url: `http://127.0.0.1:${addr.port}`,
    settle: () => app.tiger.background.drain(),
    dropSockets() {
      for (const ws of app.websocketServer.clients) ws.terminate()
    },
    async close() {
      await app.close()
      await sql.end({ timeout: 5 })
      const cleanup = createSql(TEST_DATABASE_URL, { max: 1 })
      await cleanup.unsafe(`drop schema ${schema} cascade`)
      await cleanup.end()
    },
  }
}
