import { buildApp } from './app'
import { createChat, loadChatConfig } from './chat'
import { loadConfig } from './config'
import { runMigrations } from './db/migrate'
import { createSql } from './db/sql'
import { createRetrieval } from './retrieval'

const config = loadConfig()
const sql = createSql(config.databaseUrl)
await runMigrations(sql)
const retrieval = createRetrieval({ sql })
const chat = createChat({
  sql,
  config: loadChatConfig(config),
  contextBuilder: retrieval.contextBuilder,
})
const app = await buildApp({
  sql,
  config,
  indexer: retrieval.indexer,
  retriever: retrieval.retriever,
  answerer: chat.answerer,
  models: chat.models,
})
chat.attach(app)

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down')
  await app.close()
  await sql.end({ timeout: 5 })
  process.exit(0)
}
process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

await app.listen({ host: config.host, port: config.port })
