import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Bookmark } from '@tiger/shared'
import { likePattern } from './history'

interface Row {
  id: string
  url: string
  title: string
  favicon_url: string | null
  space_id: string | null
  created_at: string
}

const toBookmark = (r: Row): Bookmark => ({
  id: r.id,
  url: r.url,
  title: r.title,
  faviconUrl: r.favicon_url,
  spaceId: r.space_id,
  createdAt: r.created_at,
})

export class BookmarkStore {
  constructor(private readonly db: DatabaseSync) {}

  list(): Bookmark[] {
    const rows = this.db
      .prepare('SELECT * FROM bookmarks ORDER BY created_at DESC, rowid DESC')
      .all() as unknown as Row[]
    return rows.map(toBookmark)
  }

  add(input: {
    url: string
    title: string
    spaceId?: string | null
    faviconUrl?: string | null
  }): Bookmark {
    const row: Row = {
      id: randomUUID(),
      url: input.url,
      title: input.title,
      favicon_url: input.faviconUrl ?? null,
      space_id: input.spaceId ?? null,
      created_at: new Date().toISOString(),
    }
    this.db
      .prepare(
        'INSERT INTO bookmarks (id, url, title, favicon_url, space_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(row.id, row.url, row.title, row.favicon_url, row.space_id, row.created_at)
    return toBookmark(row)
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id)
  }

  search(query: string, limit: number): Bookmark[] {
    const q = query.trim()
    if (!q) return []
    const rows = this.db
      .prepare(
        `SELECT * FROM bookmarks WHERE url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(likePattern(q), likePattern(q), limit) as unknown as Row[]
    return rows.map(toBookmark)
  }
}
