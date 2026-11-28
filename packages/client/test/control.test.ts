import type { ServerEvent, Thread } from '@tiger/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeClient, sleep, type TestClient, waitFor } from './helpers/client'
import { makePage, makeTab } from './helpers/fake-bridge'
import { startServer, type TestServer } from './helpers/server'

/**
 * Stopping answers, repairing lost deltas, keeping the local item index current, and opened invite
 * links, against the real server with a slow mock provider so answers stream for a few seconds.
 * A owns the Space; B is a member; C is a member of another Space.
 */

let server: TestServer
let A: TestClient
let B: TestClient
let C: TestClient
let spaceId = ''
let thread: Thread
const run = Date.now().toString(36)

/** B loses deltas 3..6 of every answer, once each, as a flaky network would. */
const dropped = new Set<string>()
const dropDeltas = (f: ServerEvent) => {
  if (f.type !== 'message.delta' || f.seq < 3 || f.seq > 6) return false
  const key = `${f.messageId}:${f.seq}`
  if (dropped.has(key)) return false
  dropped.add(key)
  return true
}

const viewOf = (c: TestClient, threadId: string, id: string) =>
  c.client.threads.store.getState().messages[threadId]?.list.find((m) => m.id === id)

beforeAll(async () => {
  server = await startServer({ mock: { chunkDelayMs: 35, chunkSize: 4 } })
  A = makeClient(server.url)
  B = makeClient(server.url, undefined, { dropFrame: dropDeltas })
  C = makeClient(server.url)
  for (const [c, name] of [
    [A, 'aoi'],
    [B, 'bunta'],
    [C, 'chika'],
  ] as const) {
    await c.client.start()
    await c.client.session.devLogin(`${name}.${run}@example.com`, name)
  }
  const space = await A.client.spaces.create('Control')
  spaceId = space?.id as string
  await A.client.spaces.select(spaceId)
  const invite = await A.client.spaces.createInvite()
  await B.client.spaces.acceptInvite(invite?.url as string)
  for (const c of [A, B]) await waitFor(() => c.client.ui.getState().connection === 'online')
  await sleep(50)
  const t = await A.client.threads.createSpaceThread('Control')
  thread = t as Thread
  await waitFor(() => B.client.threads.thread(thread.id), 5000, 'B sees thread')
  await B.client.threads.loadMessages(thread.id)
})

afterAll(async () => {
  for (const c of [A, B, C]) c?.client.dispose()
  await server?.close()
})

describe('stopping an answer', () => {
  it('a member who neither asked nor owns the Space is refused; the asker stops it and the partial text stays', async () => {
    const r = await A.client.threads.post(thread.id, 'Explain the plan in detail', { askAi: true })
    const id = r?.assistantMessage?.id as string
    await waitFor(() => (viewOf(A, thread.id, id)?.text.length ?? 0) >= 12, 5000, 'some text')

    expect(await B.client.threads.stop(id)).toBe(false)
    expect(B.client.threads.store.getState().mutation.error?.code).toBe('forbidden')
    expect(viewOf(A, thread.id, id)?.phase).toBe('streaming')

    expect(await A.client.threads.stop(id)).toBe(true)
    const stored = await server.sql<{ content: string; status: string; error_code: string }[]>`
      select content, status, error_code from messages where id = ${id}`
    expect(stored[0]).toMatchObject({ status: 'error', error_code: 'ai_aborted' })
    expect(stored[0]?.content.length).toBeGreaterThan(0)
    for (const c of [A, B]) {
      await waitFor(() => viewOf(c, thread.id, id)?.phase === 'aborted', 5000, 'aborted')
    }
    // Both members end with exactly the text the server kept, B after repairing its lost deltas.
    await waitFor(() => viewOf(B, thread.id, id)?.text === stored[0]?.content, 5000, 'B text')
    expect(viewOf(A, thread.id, id)?.text).toBe(stored[0]?.content)
    expect(viewOf(A, thread.id, id)?.failure?.code).toBe('ai_aborted')
    await sleep(150)
    expect(viewOf(A, thread.id, id)?.text).toBe(stored[0]?.content)
  })

  it('a Space owner may stop an answer another member asked for', async () => {
    const r = await B.client.threads.post(thread.id, 'Another question', { askAi: true })
    const id = r?.assistantMessage?.id as string
    await waitFor(() => (viewOf(A, thread.id, id)?.text.length ?? 0) >= 4, 5000, 'A sees text')
    expect(await A.client.threads.stop(id)).toBe(true)
    await waitFor(() => viewOf(B, thread.id, id)?.phase === 'aborted', 5000, 'B aborted')
    // Stopping a settled answer is a harmless no-op.
    expect(await A.client.threads.stop(id)).toBe(true)
  })
})

describe('repairing a stream that lost deltas', () => {
  it('a gap is filled from the server before the answer finishes, without showing text twice', async () => {
    const snapshots: string[] = []
    let id = ''
    const off = B.client.threads.store.subscribe((s) => {
      const v = s.messages[thread.id]?.list.find((m) => m.id === id)
      if (v?.phase === 'streaming') snapshots.push(v.text)
    })
    const listsBefore = B.count('GET', /\/threads\/[^/]+\/messages$/)
    const r = await A.client.threads.post(thread.id, 'Tell me everything', { askAi: true })
    id = r?.assistantMessage?.id as string
    for (const c of [A, B]) {
      await waitFor(() => viewOf(c, thread.id, id)?.phase === 'complete', 15_000, 'complete')
    }
    off()
    const final = viewOf(A, thread.id, id)?.text as string
    expect(viewOf(B, thread.id, id)?.text).toBe(final)
    expect(dropped.has(`${id}:3`)).toBe(true)
    // B refetched to repair, and its text moved past the gap while still streaming.
    expect(B.count('GET', /\/threads\/[^/]+\/messages$/)).toBeGreaterThan(listsBefore)
    const longest = Math.max(...snapshots.map((s) => s.length))
    expect(longest).toBeGreaterThan(3 * 4 + 4)
    let prev = 0
    for (const s of snapshots) {
      expect(final.startsWith(s), s).toBe(true)
      expect(s.length).toBeGreaterThanOrEqual(prev)
      prev = s.length
    }
  })

  it('a client that loads the thread mid-stream starts from the text so far', async () => {
    const r = await A.client.threads.post(thread.id, 'One more time please', { askAi: true })
    const id = r?.assistantMessage?.id as string
    await waitFor(() => (viewOf(A, thread.id, id)?.text.length ?? 0) >= 20, 5000, 'text so far')
    const D = makeClient(server.url)
    D.bridge.token = B.bridge.token
    await D.client.start()
    await D.client.spaces.select(spaceId)
    await D.client.threads.loadMessages(thread.id)
    const first = viewOf(D, thread.id, id)
    expect(first?.phase).toBe('streaming')
    expect(first?.text.length).toBeGreaterThanOrEqual(20)
    const snapshots: string[] = []
    const off = D.client.threads.store.subscribe((s) => {
      const v = s.messages[thread.id]?.list.find((m) => m.id === id)
      if (v) snapshots.push(v.text)
    })
    await waitFor(() => viewOf(D, thread.id, id)?.phase === 'complete', 15_000, 'D complete')
    off()
    const final = viewOf(D, thread.id, id)?.text as string
    expect(final).toBe(viewOf(A, thread.id, id)?.text)
    // Never shorter than what was already shown, never anything but a prefix of the answer.
    let prev = first?.text.length ?? 0
    for (const s of snapshots) {
      expect(final.startsWith(s), s).toBe(true)
      expect(s.length).toBeGreaterThanOrEqual(prev)
      prev = s.length
    }
    D.client.dispose()
  })
})

describe('the local item index', () => {
  const URL_C = 'https://c.example.com/report?id=1'

  it('follows membership: joining a Space brings its items, leaving drops them', async () => {
    const space = await C.client.spaces.create('C only')
    await C.client.spaces.select(space?.id as string)
    C.bridge.captures.set('c1', { ok: true, page: makePage(URL_C, '# Report\n\nC wrote this.') })
    await C.client.share.begin('c1')
    expect(await C.client.share.confirm()).toBe(true)

    B.bridge.setTabs([makeTab('b1', URL_C)])
    await B.client.urlShare.whenReady()
    expect(B.client.urlShare.forTab('b1')).toMatchObject({ status: 'ready', locations: [] })

    const invite = await C.client.spaces.createInvite()
    // The link is opened in a tab: the engine reports it, B's client only previews it (DESIGN.md
    // 15.3 item 18), and nothing is joined until B accepts.
    const before = B.requests.length
    B.bridge.emit('invite.open', { token: invite?.token as string })
    await waitFor(
      () => B.client.spaces.store.getState().pendingInvite?.previewLoad.status === 'ready',
      5000,
      'invite preview',
    )
    expect(B.client.spaces.store.getState().pendingInvite).toMatchObject({
      token: invite?.token,
      preview: { spaceName: 'C only', memberCount: 1, itemCount: 1 },
    })
    expect(B.requests.slice(before).map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /v1/invites/preview',
    ])
    expect(await B.client.spaces.acceptPendingInvite()).not.toBeNull()
    expect(B.client.spaces.store.getState().pendingInvite).toBeNull()
    await waitFor(
      () => B.client.urlShare.forTab('b1')?.locations[0]?.sharedBy.name === 'chika',
      5000,
      'B index has C item',
    )

    await C.client.spaces.removeMember(B.client.session.store.getState().user?.id as string)
    await waitFor(
      () => B.client.urlShare.forTab('b1')?.locations.length === 0,
      5000,
      'B index dropped C item',
    )
  })

  it('is refetched after a reconnect, catching shares made while offline', async () => {
    const url = 'https://a.example.com/while-offline'
    B.bridge.setTabs([makeTab('b2', url)])
    B.gate.blocked = true
    server.dropSockets()
    await waitFor(() => B.client.ui.getState().connection === 'reconnecting', 5000, 'B offline')
    A.bridge.captures.set('a1', { ok: true, page: makePage(url, '# Offline\n\nShared meanwhile.') })
    await A.client.share.begin('a1')
    expect(await A.client.share.confirm()).toBe(true)
    await sleep(100)
    expect(B.client.urlShare.forTab('b2')?.locations).toEqual([])
    const fetches = B.count('GET', /\/items\/index$/)
    B.gate.blocked = false
    await waitFor(() => B.client.urlShare.forTab('b2')?.locations.length === 1, 5000, 'caught up')
    expect(B.count('GET', /\/items\/index$/)).toBe(fetches + 1)
    await server.settle()
  })
})
