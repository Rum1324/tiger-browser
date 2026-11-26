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

/** The URL a visit is stored under: without its #fragment, so `page#a` and `page#b` are one page. */
export function historyUrl(url: string): string {
  const i = url.indexOf('#')
  return i === -1 ? url : url.slice(0, i)
}

/**
 * Whether a same-document URL change (pushState, replaceState, a #fragment) is a new visit: only
 * when the path or query changed. Docs pages that update #section while scrolling are one visit.
 */
export function isNewVisit(previousUrl: string | null, url: string): boolean {
  return previousUrl === null || historyUrl(previousUrl) !== historyUrl(url)
}

/**
 * Suggestions look among this many most recently visited and this many most visited pages, each
 * read through an index under a LIMIT, so a keystroke costs the same whatever the size of history
 * (about 5 ms on 200,000 rows, against 35 ms for a LIKE over the whole table).
 */
const SUGGEST_RECENT = 5_000
const SUGGEST_FREQUENT = 2_000
const TOP_MATCHES_SQL = `SELECT * FROM history WHERE id IN (
    SELECT id FROM (SELECT id FROM history ORDER BY last_visited_at DESC LIMIT ${SUGGEST_RECENT})
    UNION
    SELECT id FROM (SELECT id FROM history ORDER BY visit_count DESC, last_visited_at DESC LIMIT ${SUGGEST_FREQUENT})
  )
  AND (url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')
  ORDER BY visit_count DESC, last_visited_at DESC LIMIT ?`

/** One row per page: the latest title, the last visit time and how often it was visited. */
export class HistoryStore {
  constructor(private readonly db: DatabaseSync) {}

  recordVisit(rawUrl: string, title: string, at: Date = new Date()): void {
    const url = historyUrl(rawUrl)
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
    this.db.prepare('UPDATE history SET title = ? WHERE url = ?').run(title, historyUrl(url))
  }

  /** Most recent first; a blank query lists recent history. */
  search(query: string, limit = 100): HistoryEntry[] {
    const q = query.trim()
    const rows = (q
      ? this.db
          .prepare(
            `SELECT * FROM history WHERE url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'
               ORDER BY last_visited_at DESC LIMIT ?`,
          )
          .all(likePattern(q), likePattern(q), limit)
      : this.db
          .prepare('SELECT * FROM history ORDER BY last_visited_at DESC LIMIT ?')
          .all(limit)) as unknown as Row[]
    return rows.map(toEntry)
  }

  /** For suggestions: frequently visited pages first, among the recent and the most visited. */
  topMatches(query: string, limit: number): HistoryEntry[] {
    const q = query.trim()
    if (!q) return []
    const rows = this.db
      .prepare(TOP_MATCHES_SQL)
      .all(likePattern(q), likePattern(q), limit) as unknown as Row[]
    return rows.map(toEntry)
  }

  /** The query plan of `topMatches`, for tests that hold it to indexed, bounded reads. */
  explainTopMatches(query: string): string[] {
    const rows = this.db
      .prepare(`EXPLAIN QUERY PLAN ${TOP_MATCHES_SQL}`)
      .all(likePattern(query), likePattern(query), 8) as { detail: string }[]
    return rows.map((r) => r.detail)
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM history WHERE id = ?').run(Number(id))
  }

  clear(): void {
    this.db.exec('DELETE FROM history')
  }
}
