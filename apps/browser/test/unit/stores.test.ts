import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BookmarkStore } from '../../src/main/store/bookmarks'
import { KvStore, migrate, openDatabase } from '../../src/main/store/db'
import { HistoryStore, likePattern } from '../../src/main/store/history'
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
    expect(v.user_version).toBe(1)
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
    s.save(
      [
        { url: '', title: 'New tab', pinned: false, spaceId: null },
        { url: 'https://a.example/', title: 'A', pinned: true, spaceId: 's1' },
        { url: 'file:///etc/passwd', title: 'x', pinned: false, spaceId: null },
        { url: 'https://b.example/', title: 'B', pinned: false, spaceId: null },
      ],
      3,
    )
    const saved = s.load()
    expect(saved?.tabs.map((t) => t.url)).toEqual(['https://a.example/', 'https://b.example/'])
    expect(saved?.activeIndex).toBe(1)
    expect(saved?.tabs[0]).toMatchObject({ pinned: true, spaceId: 's1' })
  })

  it('falls back to the last tab when the active one was dropped, and to null when empty', () => {
    const s = new SessionRestoreStore(new KvStore(db))
    s.save(
      [
        { url: 'https://a.example/', title: 'A', pinned: false, spaceId: null },
        { url: '', title: '', pinned: false, spaceId: null },
      ],
      1,
    )
    expect(s.load()?.activeIndex).toBe(0)
    s.save([], null)
    expect(s.load()).toMatchObject({ tabs: [], activeIndex: null })
  })

  it('ignores a corrupt document', () => {
    const kv = new KvStore(db)
    kv.set('session.lastWindow', '{"tabs": 3}')
    expect(new SessionRestoreStore(kv).load()).toBeNull()
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
