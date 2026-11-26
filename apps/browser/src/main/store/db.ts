import { DatabaseSync } from 'node:sqlite'

/**
 * Local data lives in one SQLite file in the profile (node:sqlite, no native module). Migrations are
 * an ordered list; PRAGMA user_version records how many have run.
 */
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    visit_count INTEGER NOT NULL DEFAULT 1,
    last_visited_at TEXT NOT NULL
  );
  CREATE INDEX history_last_visited ON history (last_visited_at DESC);

  CREATE TABLE bookmarks (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    favicon_url TEXT,
    space_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE permissions (
    origin TEXT NOT NULL,
    permission TEXT NOT NULL,
    allow INTEGER NOT NULL,
    decided_at TEXT NOT NULL,
    PRIMARY KEY (origin, permission)
  );

  CREATE TABLE kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
]

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

export function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
  const current = row?.user_version ?? 0
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[i] as string)
      db.exec(`PRAGMA user_version = ${i + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}

/** A tiny key/value table for single documents (settings, session restore, the sealed token). */
export class KvStore {
  constructor(private readonly db: DatabaseSync) {}

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value)
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM kv WHERE key = ?').run(key)
  }
}
