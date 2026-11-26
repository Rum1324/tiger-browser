import { loadConfig } from '../config'
import { runMigrations } from './migrate'
import { createSql } from './sql'

const config = loadConfig()
const sql = createSql(config.databaseUrl, { max: 1 })
try {
  const applied = await runMigrations(sql)
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'schema is up to date')
} finally {
  await sql.end()
}
