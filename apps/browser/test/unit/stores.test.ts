import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { captureEligibility } from '@tiger/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BookmarkStore } from '../../src/main/store/bookmarks'
import { KvStore, migrate, openDatabase } from '../../src/main/store/db'
import { HistoryStore, isNewVisit, likePattern } from '../../src/main/store/history'
import { MemoryPermissionStore, PermissionStore } from '../../src/main/store/permissions'
import { SessionRestoreStore } from '../../src/main/store/session-restore'
import {
  defaultSettings,
  normalizeBlockedHosts,
  SettingsStore,
} from '../../src/main/store/settings'
import { type Cipher, TokenStore } from '../../src/main/store/token'

let db: DatabaseSync
beforeEach(() => {
  db = openDatabase(':memory:')
})
afterEach(() => db.close())

describe('database', () => {
  it('migrates once and is idempotent', () => {
    migrate(db)
    const v = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(v.user_version).toBe(2)
  })

  it('upgrades a version-1 database (adds the suggestion index, keeps the rows)', () => {
    const old = new DatabaseSync(':memory:')
    old.exec(
      `CREATE TABLE history (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL DEFAULT '', visit_count INTEGER NOT NULL DEFAULT 1, last_visited_at TEXT NOT NULL);
       INSERT INTO history (url, title, last_visited_at) VALUES ('https://a.example/', 'A', '2026-01-01');
       PRAGMA user_version = 1;`,
    )
    migrate(old)
    const indexes = old.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as {
      name: string
    }[]
    expect(indexes.map((i) => i.name)).toContain('history_visits')
    expect(new HistoryStore(old).topMatches('a.example', 5).map((h) => h.title)).toEqual(['A'])
  })

  it('persists across reopen of the same file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tiger-db-'))
    try {
      const path = join(dir, 'tiger.db')
      const a = openDatabase(path)
      new KvStore(a).set('k', 'v1')
      new HistoryStore(a).recordVisit('https://a.example/', 'A')
      a.close()
      const b = openDatabase(path)
      expect(new KvStore(b).get('k')).toBe('v1')
      expect(new HistoryStore(b).search('').map((h) => h.url)).toEqual(['https://a.example/'])
      b.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('kv set overwrites and delete removes', () => {
    const kv = new KvStore(db)
    kv.set('a', '1')
    kv.set('a', '2')
    expect(kv.get('a')).toBe('2')
    kv.delete('a')
    expect(kv.get('a')).toBeNull()
  })
})

describe('HistoryStore', () => {
  it('counts visits per URL and keeps the latest non-empty title', () => {
    const h = new HistoryStore(db)
    h.recordVisit('https://a.example/', 'First', new Date('2026-01-01T00:00:00Z'))
    h.recordVisit('https://a.example/', '', new Date('2026-01-02T00:00:00Z'))
    h.recordVisit('https://b.example/', 'Bee', new Date('2026-01-03T00:00:00Z'))
    const all = h.search('')
    expect(all.map((e) => e.url)).toEqual(['https://b.example/', 'https://a.example/'])
    expect(all[1]).toMatchObject({
      title: 'First',
      visitCount: 2,
      visitedAt: '2026-01-02T00:00:00.000Z',
    })
    h.updateTitle('https://a.example/', 'Renamed')
    expect(h.search('renamed')[0]?.title).toBe('Renamed')
  })

  it('matches URL or title, escapes LIKE wildcards and honours the limit', () => {
    const h = new HistoryStore(db)
    h.recordVisit('https://shop.example/100%25-off', '100% off')
    h.recordVisit('https://plain.example/', 'plain')
    expect(h.search('%').map((e) => e.title)).toEqual(['100% off'])
    expect(h.search('_')).toEqual([])
    expect(h.search('example', 1)).toHaveLength(1)
    expect(likePattern('a_b%')).toBe('%a\\_b\\%%')
  })

  it('ranks suggestions by visit count', () => {
    const h = new HistoryStore(db)
    h.recordVisit('https://rare.example/', 'rare')
    for (let i = 0; i < 3; i++) h.recordVisit('https://often.example/', 'often')
    expect(h.topMatches('example', 5).map((e) => e.url)).toEqual([
      'https://often.example/',
      'https://rare.example/',
    ])
    expect(h.topMatches('  ', 5)).toEqual([])
  })

  it('keeps one row per page whatever its #fragment', () => {
    const h = new HistoryStore(db)
    h.recordVisit('https://docs.example/page#install', 'Docs')
    h.recordVisit('https://docs.example/page#usage', 'Docs')
    h.recordVisit('https://docs.example/page', 'Docs')
    expect(h.search('docs').map((e) => [e.url, e.visitCount])).toEqual([
      ['https://docs.example/page', 3],
    ])
    h.updateTitle('https://docs.example/page#api', 'Docs v2')
    expect(h.search('docs')[0]?.title).toBe('Docs v2')
  })

  it('counts a same-document change as a visit only when the path or query changed', () => {
    expect(isNewVisit('https://a.example/p#x', 'https://a.example/p#y')).toBe(false)
    expect(isNewVisit('https://a.example/p', 'https://a.example/p#top')).toBe(false)
    expect(isNewVisit('https://a.example/p', 'https://a.example/q')).toBe(true)
    expect(isNewVisit('https://a.example/p?page=1', 'https://a.example/p?page=2')).toBe(true)
    expect(isNewVisit(null, 'https://a.example/p')).toBe(true)
  })

  it('suggests from a bounded candidate set, never a full-table LIKE scan', () => {
    const h = new HistoryStore(db)
    const plan = h
      .explainTopMatches('site')
      .map((r) => r.trim())
      .filter((d) => /^SCAN history\b/.test(d))
    // Every scan of the table walks an index (newest or most visited first) under a LIMIT.
    expect(plan.length).toBeGreaterThan(0)
    for (const d of plan) expect(d).toMatch(/USING (COVERING )?INDEX/)
  })

  it('removes one entry and clears everything', () => {
    const h = new HistoryStore(db)
    h.recordVisit('https://a.example/', 'a')
    h.recordVisit('https://b.example/', 'b')
    const [first] = h.search('a.example')
    h.remove(first?.id as string)
    expect(h.search('').map((e) => e.url)).toEqual(['https://b.example/'])
    h.clear()
    expect(h.search('')).toEqual([])
  })
})

describe('BookmarkStore', () => {
  it('adds, lists newest first, searches and removes', () => {
    const b = new BookmarkStore(db)
    const one = b.add({ url: 'https://one.example/', title: 'One' })
    const two = b.add({ url: 'https://two.example/', title: 'Two', spaceId: 's1' })
    expect(b.list().map((x) => x.id)).toEqual([two.id, one.id])
    expect(two).toMatchObject({ spaceId: 's1', faviconUrl: null })
    expect(b.search('one', 5).map((x) => x.id)).toEqual([one.id])
    expect(b.search('', 5)).toEqual([])
    b.remove(one.id)
    expect(b.list().map((x) => x.id)).toEqual([two.id])
  })
})

describe('SettingsStore', () => {
  const defaults = defaultSettings('ja-JP', 'http://localhost:8787')

  it('derives the locale from the system and persists updates', () => {
    expect(defaults.locale).toBe('ja')
    expect(defaultSettings('en-US', 'x').locale).toBe('en')
    const kv = new KvStore(db)
    const s = new SettingsStore(kv, defaults)
    s.update({
      searchEngine: 'duckduckgo',
      userBlockedHosts: [' https://Secret.Example.com/path ', ''],
    })
    const again = new SettingsStore(kv, defaults)
    expect(again.get()).toMatchObject({
      searchEngine: 'duckduckgo',
      userBlockedHosts: ['secret.example.com'],
      locale: 'ja',
    })
  })

  it('rejects an update that breaks the contract and keeps the old value', () => {
    const s = new SettingsStore(new KvStore(db), defaults)
    expect(() => s.update({ theme: 'neon' as never })).toThrow()
    expect(s.get().theme).toBe('system')
  })

  it('keeps the still-valid fields of a stored document that no longer validates', () => {
    const kv = new KvStore(db)
    kv.set('settings', JSON.stringify({ theme: 'dark', searchEngine: 'altavista', extra: 1 }))
    const s = new SettingsStore(kv, defaults)
    expect(s.get()).toEqual({ ...defaults, theme: 'dark' })
    kv.set('settings', '{not json')
    expect(new SettingsStore(kv, defaults).get()).toEqual(defaults)
  })

  it('normalises blocked hosts', () => {
    expect(normalizeBlockedHosts(['.Example.COM.', 'http://a.b/c?d', 'a.b', '  '])).toEqual([
      'example.com',
      'a.b',
    ])
  })
})

describe('blocked hosts are enforced as written', () => {
  const allowed = (url: string, hosts: string[]) =>
    captureEligibility(url, { incognito: false, userBlockedHosts: normalizeBlockedHosts(hosts) })
      .allowed

  it('matches a Japanese (IDN) domain', () => {
    expect(normalizeBlockedHosts(['社内.example.jp'])).toEqual(['xn--v6q418g.example.jp'])
    expect(allowed('https://社内.example.jp/wiki', ['社内.example.jp'])).toBe(false)
    expect(allowed('https://wiki.社内.example.jp/', ['社内.example.jp'])).toBe(false)
  })

  it('treats a leading *. as the domain and its subdomains', () => {
    expect(normalizeBlockedHosts(['*.Example.com'])).toEqual(['example.com'])
    expect(allowed('https://a.example.com/', ['*.example.com'])).toBe(false)
  })

  it('drops a port, user info and full-width dots', () => {
    expect(
      normalizeBlockedHosts(['example.com:8443', 'user:pw@intra.example', 'ｗｗｗ．example．org']),
    ).toEqual(['example.com', 'intra.example', 'www.example.org'])
    expect(allowed('https://example.com:8443/', ['example.com:8443'])).toBe(false)
  })

  it('normalises entries stored by an older build when loading', () => {
    const kv = new KvStore(db)
    const base = defaultSettings('ja-JP', 'http://127.0.0.1:1')
    kv.set(
      'settings',
      JSON.stringify({ ...base, userBlockedHosts: ['社内.example.jp', '*.a.example'] }),
    )
    expect(new SettingsStore(kv, base).get().userBlockedHosts).toEqual([
      'xn--v6q418g.example.jp',
      'a.example',
    ])
  })

  it('drops entries that are not host names', () => {
    expect(normalizeBlockedHosts(['exa mple.com', '*', 'http://', '[::1]x'])).toEqual([])
  })
})

describe('permission decisions', () => {
  it('remembers per origin and permission, and survives reopening', () => {
    const p = new PermissionStore(db)
    expect(p.get('https://a.example', 'camera')).toBeUndefined()
    p.set('https://a.example', 'camera', true)
    p.set('https://a.example', 'geolocation', false)
    p.set('https://a.example', 'camera', false)
    expect(new PermissionStore(db).get('https://a.example', 'camera')).toBe(false)
    expect(p.get('https://a.example', 'geolocation')).toBe(false)
    expect(p.get('https://b.example', 'camera')).toBeUndefined()
  })

  it('memory decisions are per instance', () => {
    const m = new MemoryPermissionStore()
    m.set('https://a.example', 'notifications', true)
    expect(m.get('https://a.example', 'notifications')).toBe(true)
    expect(new MemoryPermissionStore().get('https://a.example', 'notifications')).toBeUndefined()
  })
})

describe('SessionRestoreStore', () => {
  it('saves web tabs only and remaps the active index', () => {
    const s = new SessionRestoreStore(new KvStore(db))
    s.save([
      {
        tabs: [
          { url: '', title: 'New tab', pinned: false, spaceId: null },
          { url: 'https://a.example/', title: 'A', pinned: true, spaceId: 's1' },
          { url: 'file:///etc/passwd', title: 'x', pinned: false, spaceId: null },
          { url: 'https://b.example/', title: 'B', pinned: false, spaceId: null },
        ],
        activeIndex: 3,
      },
    ])
    const [saved] = s.load()
    expect(saved?.tabs.map((t) => t.url)).toEqual(['https://a.example/', 'https://b.example/'])
    expect(saved?.activeIndex).toBe(1)
    expect(saved?.tabs[0]).toMatchObject({ pinned: true, spaceId: 's1' })
  })

  it('falls back to the last tab when the active one was dropped, and drops empty windows', () => {
    const s = new SessionRestoreStore(new KvStore(db))
    s.save([
      {
        tabs: [
          { url: 'https://a.example/', title: 'A', pinned: false, spaceId: null },
          { url: '', title: '', pinned: false, spaceId: null },
        ],
        activeIndex: 1,
      },
    ])
    expect(s.load()[0]?.activeIndex).toBe(0)
    s.save([{ tabs: [], activeIndex: null }])
    expect(s.load()).toEqual([])
  })

  it('keeps every window, in order', () => {
    const s = new SessionRestoreStore(new KvStore(db))
    const tab = (u: string) => ({ url: u, title: u, pinned: false, spaceId: null })
    s.save([
      { tabs: [tab('https://a.example/'), tab('https://b.example/')], activeIndex: 0 },
      { tabs: [tab('https://c.example/')], activeIndex: 0 },
    ])
    expect(s.load().map((w) => w.tabs.map((t) => t.url))).toEqual([
      ['https://a.example/', 'https://b.example/'],
      ['https://c.example/'],
    ])
  })

  it('reads the single-window document of earlier builds', () => {
    const kv = new KvStore(db)
    kv.set(
      'session.lastWindow',
      JSON.stringify({
        tabs: [{ url: 'https://old.example/', title: 'Old', pinned: false, spaceId: null }],
        activeIndex: 0,
        savedAt: '2026-11-01T00:00:00.000Z',
      }),
    )
    expect(new SessionRestoreStore(kv).load().map((w) => w.tabs[0]?.url)).toEqual([
      'https://old.example/',
    ])
  })

  it('ignores a corrupt document', () => {
    const kv = new KvStore(db)
    kv.set('session.windows', '{"windows": 3}')
    expect(new SessionRestoreStore(kv).load()).toEqual([])
    kv.set('session.windows', '{not json')
    expect(new SessionRestoreStore(kv).load()).toEqual([])
  })
})

describe('TokenStore', () => {
  const fakeCipher = (available = true): Cipher => ({
    isAvailable: async () => available,
    encrypt: async (plain) => Buffer.from(`sealed:${[...plain].reverse().join('')}`),
    decrypt: async (sealed) => {
      const s = sealed.toString()
      if (!s.startsWith('sealed:')) throw new Error('foreign keychain')
      return [...s.slice(7)].reverse().join('')
    },
  })

  it('stores only ciphertext and reads the token back', async () => {
    const kv = new KvStore(db)
    const t = new TokenStore(kv, fakeCipher())
    expect(await t.get()).toBeNull()
    await t.set('secret-token')
    const raw = kv.get('auth.token') as string
    expect(raw).not.toContain('secret-token')
    expect(Buffer.from(raw, 'base64').toString()).toBe('sealed:nekot-terces')
    expect(await t.get()).toBe('secret-token')
    await t.set(null)
    expect(kv.get('auth.token')).toBeNull()
  })

  it('refuses to store in the clear when the keychain is unavailable', async () => {
    const kv = new KvStore(db)
    await expect(new TokenStore(kv, fakeCipher(false)).set('x')).rejects.toThrow(/not available/)
    expect(kv.get('auth.token')).toBeNull()
  })

  it('drops a token sealed by another keychain', async () => {
    const kv = new KvStore(db)
    kv.set('auth.token', Buffer.from('other').toString('base64'))
    expect(await new TokenStore(kv, fakeCipher()).get()).toBeNull()
    expect(kv.get('auth.token')).toBeNull()
  })
})
