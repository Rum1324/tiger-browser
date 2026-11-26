import type { DatabaseSync } from 'node:sqlite'
import type { HistoryEntry } from '@tiger/shared'

interface Row {
  id: number
  url: string
  title: string
  visit_count: number
  last_visited_at: string
}

const toEntry = (r: Row): HistoryEntry => ({
  id: String(r.id),
  url: r.url,
  title: r.title,
  visitedAt: r.last_visited_at,
  visitCount: r.visit_count,
})

/** Escape LIKE wildcards so a typed "%" or "_" matches literally. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** One row per URL: the latest title, the last visit time and how often it was visited. */
export class HistoryStore {
  constructor(private readonly db: DatabaseSync) {}

  recordVisit(url: string, title: string, at: Date = new Date()): void {
    this.db
      .prepare(
        `INSERT INTO history (url, title, visit_count, last_visited_at) VALUES (?, ?, 1, ?)
         ON CONFLICT(url) DO UPDATE SET
           visit_count = visit_count + 1,
           last_visited_at = excluded.last_visited_at,
           title = CASE WHEN excluded.title = '' THEN history.title ELSE excluded.title END`,
      )
      .run(url, title, at.toISOString())
  }

  updateTitle(url: string, title: string): void {
    if (!title) return
    this.db.prepare('UPDATE history SET title = ? WHERE url = ?').run(title, url)
  }

  /** Most recent first; a blank query lists recent history. */
  search(query: string, limit = 100): HistoryEntry[] {
    const q = query.trim()
    const rows = (
      q
        ? this.db
            .prepare(
              `SELECT * FROM history WHERE url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'
               ORDER BY last_visited_at DESC LIMIT ?`,
            )
            .all(likePattern(q), likePattern(q), limit)
        : this.db.prepare('SELECT * FROM history ORDER BY last_visited_at DESC LIMIT ?').all(limit)
    ) as unknown as Row[]
    return rows.map(toEntry)
  }

  /** For suggestions: frequently visited pages first. */
  topMatches(query: string, limit: number): HistoryEntry[] {
    const q = query.trim()
    if (!q) return []
    const rows = this.db
      .prepare(
        `SELECT * FROM history WHERE url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'
         ORDER BY visit_count DESC, last_visited_at DESC LIMIT ?`,
      )
      .all(likePattern(q), likePattern(q), limit) as unknown as Row[]
    return rows.map(toEntry)
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM history WHERE id = ?').run(Number(id))
  }

  clear(): void {
    this.db.exec('DELETE FROM history')
  }
}
