import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Sql } from './sql'

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url))

/** Serialises concurrent runners (two server instances starting at once). Any constant works. */
const LOCK_KEY = 0x7419e2

/**
 * Apply every `NNNN_name.sql` in order that is not yet in schema_migrations. Each file runs in its own
 * transaction together with its bookkeeping row, so a failing file leaves no partial schema behind.
 * Returns the names applied by this call.
 */
export async function runMigrations(sql: Sql, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort()
  const applied: string[] = []
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${LOCK_KEY})`
    await tx`
      create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `
  })
  for (const file of files) {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${LOCK_KEY})`
      const done = await tx`select 1 from schema_migrations where name = ${file}`
      if (done.length > 0) return
      const text = await readFile(join(dir, file), 'utf8')
      await tx.unsafe(text)
      await tx`insert into schema_migrations (name) values (${file})`
      applied.push(file)
    })
  }
  return applied
}
