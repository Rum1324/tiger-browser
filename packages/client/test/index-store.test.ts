import { randomUUID } from 'node:crypto'
import type { Item, ItemIndexEntry } from '@tiger/shared'
import { describe, expect, it } from 'vitest'
import type { ApiClient } from '../src'
import type { ClientContext } from '../src/load'
import { createGoogle } from '../src/stores/google'
import { createUrlShare, indexEntryOf } from '../src/stores/items'
import { FakeBridge, makeTab } from './helpers/fake-bridge'

const USER = { id: randomUUID(), name: 'Aiko', avatarUrl: null }
const SPACE = randomUUID()
const OTHER_SPACE = randomUUID()

function item(url: string, spaceId = SPACE, version = 1, at = new Date().toISOString()): Item {
  return {
    id: randomUUID(),
    spaceId,
    url,
    title: url,
    sourceType: 'web',
    sharedBy: USER,
    sharedAt: at,
    updatedAt: at,
    status: 'ready',
    versionCount: version,
    currentVersion: {
      id: randomUUID(),
      number: version,
      charCount: 10,
      contentHash: `h${version}`,
      capturedAt: at,
      capturedBy: USER,
    },
  }
}

/** An API whose listItemIndex answers when the test says so; every call is recorded. */
function scriptedApi() {
  const calls: { path: string; input: unknown }[] = []
  let answer: (rows: ItemIndexEntry[]) => void = () => {}
  const api: ApiClient = {
    serverUrl: 'http://x.test',
    call: (async (route: { path: string }, input: unknown) => {
      calls.push({ path: route.path, input })
      if (route.path !== '/v1/items/index') throw new Error(`unexpected ${route.path}`)
      return new Promise<ItemIndexEntry[]>((r) => (answer = r))
    }) as ApiClient['call'],
  }
  return { api, calls, answer: (rows: ItemIndexEntry[]) => answer(rows) }
}

describe('local item index', () => {
  it('events that arrive while the index is loading are not lost, and the request carries nothing', async () => {
    const s = scriptedApi()
    const bridge = new FakeBridge()
    const ctx: ClientContext = { api: s.api, bridge, userId: () => USER.id }
    const index = createUrlShare(ctx)
    const a = item('https://a.example.com/x')
    const b = item('https://b.example.com/y')
    const c = item('https://c.example.com/z', OTHER_SPACE)

    index.syncTabs({
      windowId: 'w',
      privateWindow: false,
      activeTabId: 't1',
      tabs: [
        makeTab('t1', a.url),
        makeTab('t2', b.url),
        makeTab('t3', 'https://c.example.com/z#x'),
      ],
    })
    expect(index.forTab('t1')?.status).toBe('pending')
    expect(s.calls).toEqual([])

    const loading = index.start([SPACE, OTHER_SPACE])
    expect(s.calls).toEqual([{ path: '/v1/items/index', input: {} }])
    // While the request runs: b is unshared, c is shared, a gets a new version.
    index.handleEvent({ type: 'item.deleted', spaceId: SPACE, itemId: b.id, url: b.url })
    index.handleEvent({ type: 'item.upserted', item: c })
    const a2 = { ...item(a.url, SPACE, 2, new Date(Date.now() + 1000).toISOString()), id: a.id }
    index.handleEvent({ type: 'item.upserted', item: a2 })
    // The answer was computed before those events.
    s.answer([indexEntryOf(a), indexEntryOf(b)])
    await loading

    expect(index.forTab('t1')?.locations.map((l) => l.versionNumber)).toEqual([2])
    expect(index.forTab('t2')).toMatchObject({ status: 'ready', locations: [] })
    expect(index.forTab('t3')?.locations[0]?.itemId).toBe(c.id)

    // Stable references: an unrelated change does not replace another URL's entry.
    const before = index.forTab('t3')
    index.handleEvent({ type: 'item.upserted', item: item('https://d.example.com/') })
    expect(index.forTab('t3')).toBe(before)

    // Leaving a Space drops its rows locally, with no request.
    index.handleEvent({ type: 'member.removed', spaceId: OTHER_SPACE, userId: USER.id })
    expect(index.forTab('t3')?.locations).toEqual([])
    expect(s.calls).toHaveLength(1)

    // Joining a Space refetches; losing one only drops.
    index.membershipChanged([SPACE])
    expect(s.calls).toHaveLength(1)
    index.membershipChanged([SPACE, OTHER_SPACE])
    expect(s.calls).toHaveLength(2)
    s.answer([indexEntryOf(a2)])
    await index.whenReady()
    for (const call of s.calls) expect(JSON.stringify(call.input)).toBe('{}')
  })

  it('a private, blocked or non-web tab is never shown as shared, even when its URL is in the index', async () => {
    const s = scriptedApi()
    const ctx: ClientContext = { api: s.api, bridge: new FakeBridge(), userId: () => USER.id }
    const index = createUrlShare(ctx)
    const shared = item('https://news.example.com/a')
    const loading = index.start([SPACE])
    s.answer([indexEntryOf(shared)])
    await loading
    index.syncTabs({
      windowId: 'w',
      privateWindow: false,
      activeTabId: 'p',
      tabs: [
        makeTab('p', shared.url, { isPrivate: true }),
        makeTab('n', shared.url),
        makeTab('x', 'about:blank'),
      ],
    })
    expect(index.forTab('p')?.locations).toEqual([])
    expect(index.forTab('x')?.locations).toEqual([])
    expect(index.forTab('n')?.locations).toHaveLength(1)
    expect(index.forTab('missing')).toBeNull()
  })
})

describe('Google account controller', () => {
  it('connect reports the engine result, cancel ends a waiting flow, google.changed is followed', async () => {
    const bridge = new FakeBridge()
    const noApi = scriptedApi().api
    const google = createGoogle({ api: noApi, bridge, userId: () => null })
    const off = google.attach()
    await google.refresh()
    expect(google.store.getState().connection).toEqual({
      configured: true,
      connected: false,
      email: null,
    })

    expect(await google.connect()).toBe(true)
    expect(google.store.getState()).toMatchObject({ phase: 'idle', error: null })
    expect(google.store.getState().connection?.email).toBe('a@example.com')

    bridge.googleConnect = 'wait'
    const pending = google.connect()
    expect(google.store.getState().phase).toBe('connecting')
    await google.cancel()
    expect(await pending).toBe(false)
    expect(google.store.getState()).toMatchObject({ phase: 'idle', error: 'cancelled' })

    bridge.googleConnect = {
      connection: { configured: false, connected: false, email: null },
      error: 'not-configured',
    }
    expect(await google.connect()).toBe(false)
    expect(google.store.getState().error).toBe('not-configured')

    await google.disconnect()
    expect(google.store.getState().connection?.connected).toBe(false)
    bridge.emit('google.changed', { configured: true, connected: true, email: 'z@example.com' })
    expect(google.store.getState().connection?.email).toBe('z@example.com')
    off()
  })
})
