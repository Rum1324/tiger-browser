import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTigerClient, errorKey, type TigerClient, t, type WebSocketCtor } from '../src'
import { makeClient, type TestClient, waitFor } from './helpers/client'
import { FakeBridge, makePage, makeTab } from './helpers/fake-bridge'
import { startServer, type TestServer } from './helpers/server'

/**
 * DESIGN.md section 15 against the real server: attachment consent bound to the provider, network
 * failures on send reconciled with the thread, the invite preview, and the staleness policy's
 * wiring to the engine's tab events.
 */

let server: TestServer
let A: TestClient
let spaceId = ''
let privateId = ''
const run = Date.now().toString(36)

/** What the next message POST does: go through, go through but lose the response, or never leave. */
const net = { mode: 'ok' as 'ok' | 'lose-response' | 'unreachable' }
let N: TigerClient
let nBridge: FakeBridge
const nPosts: string[] = []

beforeAll(async () => {
  server = await startServer()
  A = makeClient(server.url)
  await A.client.start()
  await A.client.session.devLogin(`aoi.${run}@example.com`, 'aoi')
  const space = await A.client.spaces.create('Resolutions')
  spaceId = space?.id as string
  await A.client.spaces.select(spaceId)
  await waitFor(() => A.client.models.store.getState().selected, 5000, 'models')
  privateId = (await A.client.threads.ensurePrivateThread())?.id as string

  nBridge = new FakeBridge()
  N = createTigerClient({
    serverUrl: server.url,
    bridge: nBridge,
    WebSocket: globalThis.WebSocket as unknown as WebSocketCtor,
    fetch: async (input, init) => {
      const isPost = init.method === 'POST' && new URL(input).pathname.endsWith('/messages')
      if (isPost) nPosts.push(net.mode)
      if (isPost && net.mode === 'unreachable') throw new TypeError('fetch failed')
      const res = await fetch(input, init)
      if (isPost && net.mode === 'lose-response') throw new TypeError('fetch failed')
      return res
    },
  })
  await N.start()
  await N.session.devLogin(`nao.${run}@example.com`, 'nao')
  const nSpace = await N.spaces.create('Flaky')
  await N.spaces.select(nSpace?.id as string)
  await waitFor(() => N.models.store.getState().selected, 5000, 'models')
})

afterAll(async () => {
  A?.client.dispose()
  N?.dispose()
  await server?.close()
})

describe('attachment consent is bound to the provider', () => {
  it('a model of another company returns the attachment to unconfirmed; post refuses until confirmed again', async () => {
    const threads = A.client.threads
    const models = A.client.models
    const mock = models.store.getState().selected
    expect(mock?.provider).toBe('mock')
    const page = makePage('https://notes.example.net/consent', '# Notes\n\nPricing ideas.')
    A.bridge.captures.set('c1', { ok: true, page })
    await threads.beginAttach(privateId, 'c1')
    expect(threads.confirmAttach()).toBe(true)
    expect(threads.store.getState().draftConsent[privateId]).toEqual(['mock'])
    expect(threads.unconfirmedAttachments(privateId)).toEqual([])

    // The member picks a model of another company.
    models.store.setState({
      models: [
        ...models.store.getState().models,
        {
          provider: 'anthropic',
          id: 'claude-test',
          label: 'Claude',
          tier: 'best',
          contextWindow: 200_000,
          available: true,
        },
      ],
    })
    models.select({ provider: 'anthropic', id: 'claude-test' })
    expect(threads.store.getState().draftConsent[privateId]).toEqual([null])
    expect(threads.unconfirmedAttachments(privateId)).toEqual([page])

    const posts = () => A.count('POST', /\/messages$/)
    const before = posts()
    expect(await threads.post(privateId, 'Summarise', { askAi: true })).toBeNull()
    expect(threads.store.getState().mutation.error?.code).toBe('attachment_unconfirmed')
    // Going back does not restore a consent that was withdrawn.
    models.select(mock as { provider: 'mock'; id: string })
    expect(await threads.post(privateId, 'Summarise', { askAi: true })).toBeNull()
    // A per-message model of another company is refused too.
    expect(threads.reconfirmAttachments(privateId)).toBe(true)
    expect(
      await threads.post(privateId, 'Summarise', {
        askAi: true,
        model: { provider: 'anthropic', id: 'claude-test' },
      }),
    ).toBeNull()
    expect(threads.store.getState().mutation.error?.code).toBe('attachment_unconfirmed')
    expect(posts()).toBe(before)
    expect(threads.store.getState().drafts[privateId]).toEqual([page])

    // Confirmed again for the company that will read it: it is sent.
    const r = await threads.post(privateId, 'Summarise', { askAi: true })
    expect(r?.message.attachments[0]?.url).toBe(page.url)
    expect(posts()).toBe(before + 1)
    expect(threads.store.getState().drafts[privateId]).toBeUndefined()
    expect(threads.store.getState().draftConsent[privateId]).toBeUndefined()
  })

  it('removing an attachment keeps the consent of the others aligned', async () => {
    const threads = A.client.threads
    const p1 = makePage('https://notes.example.net/one', 'one')
    const p2 = makePage('https://notes.example.net/two', 'two')
    A.bridge.captures.set('r1', { ok: true, page: p1 })
    A.bridge.captures.set('r2', { ok: true, page: p2 })
    await threads.beginAttach(privateId, 'r1')
    threads.confirmAttach()
    threads.modelChanged({ provider: 'openai', id: 'x' })
    await threads.beginAttach(privateId, 'r2')
    threads.confirmAttach()
    expect(threads.store.getState().draftConsent[privateId]).toEqual([null, 'mock'])
    threads.removeAttachment(privateId, 0)
    expect(threads.store.getState().drafts[privateId]).toEqual([p2])
    expect(threads.store.getState().draftConsent[privateId]).toEqual(['mock'])
    expect(threads.unconfirmedAttachments(privateId)).toEqual([])
    threads.removeAttachment(privateId, 0)
  })
})

describe('a send that fails with a network error', () => {
  it('is shown as sent when the thread has it', async () => {
    const tid = (await N.threads.ensurePrivateThread())?.id as string
    await N.threads.loadMessages(tid)
    net.mode = 'lose-response'
    const r = await N.threads.post(tid, 'did this arrive?', { askAi: true })
    net.mode = 'ok'
    expect(nPosts.at(-1)).toBe('lose-response')
    expect(r?.message.content).toBe('did this arrive?')
    expect(r?.assistantMessage?.role).toBe('assistant')
    expect(N.threads.store.getState().mutation).toEqual({ status: 'ready', error: null })
    const list = N.threads.store.getState().messages[tid]?.list ?? []
    expect(list.filter((m) => m.message.content === 'did this arrive?')).toHaveLength(1)
    // Sent once: no duplicate was created by the reconciliation.
    const rows = await server.sql<{ n: number }[]>`
      select count(*)::int as n from messages where thread_id = ${tid} and content = 'did this arrive?'`
    expect(rows[0]?.n).toBe(1)
  })

  it('keeps the draft and reports the dedicated message when the thread does not have it', async () => {
    const tid = (await N.threads.ensurePrivateThread())?.id as string
    const page = makePage('https://notes.example.net/flaky', 'flaky page')
    nBridge.captures.set('f1', { ok: true, page })
    await N.threads.beginAttach(tid, 'f1')
    N.threads.confirmAttach()
    // The same text was sent before: an older copy must not count as this one arriving.
    await N.threads.post(tid, 'same words', { askAi: false })
    await N.threads.beginAttach(tid, 'f1')
    N.threads.confirmAttach()
    net.mode = 'unreachable'
    expect(await N.threads.post(tid, 'same words', { askAi: false })).toBeNull()
    net.mode = 'ok'
    const error = N.threads.store.getState().mutation.error
    expect(error?.code).toBe('send_failed')
    expect(t('ja', errorKey(error as never))).toBe('送信できませんでした。もう一度送れます。')
    expect(t('en', errorKey(error as never))).toBe(
      "Couldn't send the message. You can send it again.",
    )
    expect(N.threads.store.getState().drafts[tid]).toEqual([page])
  })
})

describe('invite preview', () => {
  it('previews, puts aside, and accepts only when asked', async () => {
    const created = await A.client.spaces.createInvite()
    const B = makeClient(server.url)
    try {
      await B.client.start()
      await B.client.session.devLogin(`bun.${run}@example.com`, 'bunta')
      const preview = await B.client.spaces.previewInvite(created?.url as string)
      expect(preview).toMatchObject({
        spaceName: 'Resolutions',
        memberCount: 1,
        invitedBy: { name: 'aoi' },
        emailRestricted: false,
      })
      expect(B.client.spaces.store.getState().pendingInvite).toMatchObject({
        token: created?.token,
        preview,
        previewLoad: { status: 'ready' },
      })
      B.client.spaces.dismissPendingInvite()
      expect(B.client.spaces.store.getState().pendingInvite).toBeNull()
      expect(B.client.spaces.store.getState().list.map((s) => s.id)).not.toContain(spaceId)
      expect(B.count('POST', /\/invites\/accept$/)).toBe(0)

      B.bridge.emit('invite.open', { token: created?.token as string })
      await waitFor(() => B.client.spaces.store.getState().pendingInvite?.preview, 5000, 'preview')
      expect((await B.client.spaces.acceptPendingInvite())?.id).toBe(spaceId)

      // A refused token shows the same error accepting would.
      const revoked = await A.client.spaces.createInvite()
      await A.client.spaces.revokeInvite(revoked?.invite.id as string)
      expect(await B.client.spaces.previewInvite(revoked?.token as string)).toBeNull()
      expect(B.client.spaces.store.getState().pendingInvite?.previewLoad.error?.code).toBe(
        'invite_revoked',
      )
    } finally {
      B.client.dispose()
    }
  })
})

describe('staleness wiring', () => {
  it('a shared page is checked when its tab becomes active, and lastCheckedAt is set', async () => {
    const url = 'https://news.example.com/stale-check'
    A.bridge.captures.set('s1', { ok: true, page: makePage(url, '# Old') })
    await A.client.share.begin('s1')
    expect(await A.client.share.confirm()).toBe(true)
    A.bridge.captures.set('s1', { ok: true, page: makePage(url, '# New') })
    const extracts = () => A.bridge.callsOf('capture.extract').length
    const before = extracts()
    A.bridge.setTabs([makeTab('s1', url)])
    const entry = await waitFor(
      () => {
        const e = A.client.staleness.store.getState().tabs.s1
        return e && !e.checking ? e : null
      },
      5000,
      'stale check',
    )
    expect(entry.result?.status).toBe('stale')
    expect(entry.lastCheckedAt).toBeTypeOf('number')
    expect(extracts()).toBe(before + 1)
    // Within a minute, opening the share surface does not extract again.
    expect((await A.client.staleness.request('s1', 'surface-opened'))?.status).toBe('stale')
    expect(extracts()).toBe(before + 1)
  })
})
