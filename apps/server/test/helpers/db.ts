import { randomBytes } from 'node:crypto'
import { runMigrations } from '../../src/db/migrate'
import { createSql, type Sql } from '../../src/db/sql'

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://tiger:tiger@127.0.0.1:5432/tiger_test'

export interface TestDb {
  sql: Sql
  schema: string
  drop(): Promise<void>
}

/**
 * A fresh, fully migrated schema in tiger_test. Each test file gets its own, so files run in parallel
 * without seeing each other's rows. `public` stays on the search path for the vector and pg_trgm types.
 */
export async function createTestDb(): Promise<TestDb> {
  const schema = `t_${randomBytes(6).toString('hex')}`
  const admin = createSql(TEST_DATABASE_URL, { max: 1 })
  await admin.unsafe(`create schema ${schema}`)
  await admin.end()
  const sql = createSql(TEST_DATABASE_URL, { max: 6, searchPath: `${schema}, public` })
  await runMigrations(sql)
  return {
    sql,
    schema,
    async drop() {
      await sql.end({ timeout: 5 })
      const cleanup = createSql(TEST_DATABASE_URL, { max: 1 })
      await cleanup.unsafe(`drop schema ${schema} cascade`)
      await cleanup.end()
    },
  }
}
