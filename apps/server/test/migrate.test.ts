import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMigrations } from '../src/db/migrate'
import { createTestDb, type TestDb } from './helpers/db'

let db: TestDb
beforeAll(async () => {
  db = await createTestDb()
})
afterAll(() => db.drop())

describe('runMigrations', () => {
  it('records each file once and is a no-op on the second run', async () => {
    const rows = await db.sql<{ name: string }[]>`select name from schema_migrations order by name`
    expect(rows.map((r) => r.name)).toContain('0001_init.sql')
    expect(await runMigrations(db.sql)).toEqual([])
    const tables = await db.sql<{ table_name: string }[]>`
      select table_name from information_schema.tables where table_schema = ${db.schema}
    `
    expect(tables.map((t) => t.table_name)).toEqual(
      expect.arrayContaining(['users', 'sessions', 'items', 'chunks', 'messages', 'llm_usage']),
    )
  })
})
