import type { CaptureResult, Item, Thread } from '@tiger/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeClient, sleep, type TestClient, waitFor } from './helpers/client'
import { makePage, makeTab } from './helpers/fake-bridge'
import { googleToken, startServer, type TestServer } from './helpers/server'

/**
 * Two members, two clients, one real server (mock LLM, hash embedder, tiger_test). The tests run in
 * order and build on each other, like a session: sign in, a Space, an invite, shares, AI answers.
 */

let server: TestServer
let A: TestClient
let B: TestClient
const run = Date.now().toString(36)
const emailA = `aiko.${run}@example.com`
const emailB = `ben.${run}@example.com`

const ARTICLE_URL = 'https://news.example.com/article?id=7&utm_source=feed'
const ARTICLE_URL_B = 'https://news.example.com/article?id=7#comments' // same page for canonicalUrl
const articleV1 = makePage(
  ARTICLE_URL,
  '# Quarterly plan\n\nThe team will ship the offline mode in March. Revenue target is 48 units.',
  'Quarterly plan',
)

let spaceId = ''
let item: Item
let spaceThread: Thread

beforeAll(async () => {
  server = await startServer()
  A = makeClient(server.url)
  B = makeClient(server.url)
})

afterAll(async () => {
  A?.client.dispose()
  B?.client.dispose()
  await server?.close()
})

describe('session', () => {
  it('boots signed out without a stored token, then signs in with dev login', async () => {
    await A.client.start()
    expect(A.client.session.store.getState().status).toBe('signedOut')
    await A.client.session.devLogin(emailA, 'Aiko')
    const s = A.client.session.store.getState()
    expect(s.status).toBe('signedIn')
    expect(s.user?.name).toBe('Aiko')
    // The token went to the engine's keychain and is not part of the observable state.
    expect(A.bridge.token).toBe(A.client.session.token())
    expect(JSON.stringify(s)).not.toContain(A.bridge.token as string)
    await waitFor(() => A.client.ui.getState().connection === 'online', 5000, 'A online')
  })

  it('Google sign-in goes through the bridge, then the server; a cancelled window is not an error', async () => {
    await B.client.start()
    B.bridge.googleIdToken = null
    expect(await B.client.session.signInWithGoogle()).toBe(false)
    expect(B.client.session.store.getState()).toMatchObject({
      status: 'signedOut',
      error: null,
      googleError: 'cancelled',
    })
    // The engine's reason reaches the store, for every way a flow can fail.
    B.bridge.googleSignInError = 'timeout'
    expect(await B.client.session.signInWithGoogle()).toBe(false)
    expect(B.client.session.store.getState().googleError).toBe('timeout')
    expect(B.count('POST', /\/auth\/google$/)).toBe(0)

    B.bridge.googleIdToken = 'forged-token-value'
    expect(await B.client.session.signInWithGoogle()).toBe(false)
    expect(B.client.session.store.getState().error?.code).toBe('google_token_invalid')
    expect(B.client.session.store.getState().googleError).toBeNull()

    B.bridge.googleIdToken = googleToken(emailB, 'Ben')
    expect(await B.client.session.signInWithGoogle()).toBe(true)
    expect(B.client.session.store.getState().user?.email).toBe(emailB)
    await waitFor(() => B.client.ui.getState().connection === 'online', 5000, 'B online')
  })

  it('boots from the engine stored token, and drops a token the server no longer accepts', async () => {
    const C = makeClient(server.url)
    C.bridge.token = A.bridge.token
    await C.client.start()
    expect(C.client.session.store.getState().user?.email).toBe(emailA)
    C.client.dispose()

    const D = makeClient(server.url)
    D.bridge.token = 'x'.repeat(43)
    await D.client.start()
    expect(D.client.session.store.getState().status).toBe('signedOut')
    expect(D.bridge.token).toBeNull()
    D.client.dispose()
  })
})

describe('spaces and invites', () => {
  it('creates a Space, selects it and persists the choice in engine settings', async () => {
    const space = await A.client.spaces.create('リサーチ', 'teal')
    expect(space).not.toBeNull()
    spaceId = space?.id as string
    await A.client.spaces.select(spaceId)
    expect(A.client.spaces.store.getState().currentSpaceId).toBe(spaceId)
    expect(A.bridge.settings.lastSpaceId).toBe(spaceId)
    expect(A.client.spaces.store.getState().detail?.members).toHaveLength(1)
  })

  it('invites, revokes, and accepts from a pasted link; the other member appears live', async () => {
    const revoked = await A.client.spaces.createInvite()
    expect(revoked?.url).toContain('#')
    expect(A.client.spaces.store.getState().detail?.pendingInvites).toHaveLength(1)
    expect(await A.client.spaces.revokeInvite(revoked?.invite.id as string)).toBe(true)
    expect(A.client.spaces.store.getState().detail?.pendingInvites).toHaveLength(0)
    expect(await B.client.spaces.acceptInvite(revoked?.url as string)).toBeNull()
    expect(B.client.spaces.store.getState().mutation.error?.code).toBe('invite_revoked')

    // A paste with no token in it is refused without a request.
    const before = B.requests.length
    expect(await B.client.spaces.acceptInvite('hello')).toBeNull()
    expect(B.requests.length).toBe(before)

    const invite = await A.client.spaces.createInvite()
    const joined = await B.client.spaces.acceptInvite(`  ${invite?.url as string}  `)
    expect(joined?.id).toBe(spaceId)
    expect(B.client.spaces.store.getState().currentSpaceId).toBe(spaceId)
    expect(B.bridge.settings.lastSpaceId).toBe(spaceId)
    await waitFor(
      () => A.client.spaces.store.getState().detail?.members.some((m) => m.user.email === emailB),
      5000,
      'B in A member list',
    )
  })

  it('a rename and recolour reaches the other member through the socket', async () => {
    await waitFor(() => B.client.ui.getState().connection === 'online')
    await sleep(50) // let B's resubscribe for the new Space land
    await A.client.spaces.update(spaceId, { name: 'Research', hue: 'violet' })
    await waitFor(
      () =>
        B.client.spaces.current()?.name === 'Research' &&
        B.client.spaces.current()?.hue === 'violet',
      5000,
      'B sees rename',
    )
  })
})

describe('sharing', () => {
  it('per-URL share state starts as not shared for both members, from the local index', async () => {
    A.bridge.captures.set('t1', { ok: true, page: articleV1 })
    A.bridge.setTabs([makeTab('t1', ARTICLE_URL)])
    B.bridge.setTabs([makeTab('b1', ARTICLE_URL_B)])
    await waitFor(() => A.client.urlShare.forTab('t1')?.status === 'ready', 5000, 'A tab state')
    await waitFor(() => B.client.urlShare.forTab('b1')?.status === 'ready', 5000, 'B tab state')
    expect(A.client.urlShare.forTab('t1')?.locations).toEqual([])
    expect(B.client.urlShare.forTab('b1')?.locations).toEqual([])
  })

  it('nothing is sent before confirm(); cancel discards the extraction', async () => {
    const shareCalls = () => A.count('POST', /\/spaces\/[^/]+\/items$/)
    await A.client.share.begin('t1')
    const s = A.client.share.store.getState()
    expect(s.phase).toBe('preview')
    if (s.phase !== 'preview') return
    expect(s.page).toEqual(articleV1)
    expect(s.existing).toBeNull()
    await sleep(50)
    expect(shareCalls()).toBe(0)

    A.client.share.cancel()
    expect(A.client.share.store.getState().phase).toBe('idle')
    expect(await A.client.share.confirm()).toBe(false)
    expect(shareCalls()).toBe(0)

    // Cancelled while extracting: the late result is dropped.
    let release: (r: CaptureResult) => void = () => {}
    A.bridge.captures.set('slow', () => new Promise((r) => (release = r)))
    const pending = A.client.share.begin('slow')
    await waitFor(() =>
      A.bridge
        .callsOf('capture.extract')
        .some((c) => (c.req as { tabId: string }).tabId === 'slow'),
    )
    expect(A.client.share.store.getState().phase).toBe('extracting')
    A.client.share.cancel()
    release({ ok: true, page: articleV1 })
    await pending
    expect(A.client.share.store.getState().phase).toBe('idle')
    expect(await A.client.share.confirm()).toBe(false)
    expect(shareCalls()).toBe(0)
  })

  it('confirm sends exactly the previewed page; the other member sees it through the socket', async () => {
    await A.client.share.begin('t1')
    const preview = A.client.share.store.getState()
    expect(preview.phase).toBe('preview')
    expect(await A.client.share.confirm()).toBe(true)
    const done = A.client.share.store.getState()
    expect(done.phase === 'done' && done.outcome).toBe('new')
    const sent = A.requests.filter((r) => r.method === 'POST' && /\/items$/.test(r.path))
    expect(sent).toHaveLength(1)
    expect(sent[0]?.body).toEqual({ page: preview.phase === 'preview' ? preview.page : null })
    item = (done.phase === 'done' ? done.item : null) as Item

    await waitFor(
      () => B.client.items.store.getState().items.some((i) => i.id === item.id),
      5000,
      'B items',
    )
    expect(B.client.items.store.getState().items[0]?.sharedBy.name).toBe('Aiko')
  })

  it('per-URL share state says where, by whom and which version, for both members', async () => {
    const check = (c: TestClient, tabId: string) => {
      const st = c.client.urlShare.forTab(tabId)
      const loc = st?.locations[0]
      return loc?.spaceId === spaceId && loc.sharedBy.name === 'Aiko' && loc.versionNumber === 1
    }
    await waitFor(() => check(A, 't1'), 5000, 'A url state')
    await waitFor(() => check(B, 'b1'), 5000, 'B url state')
    expect(B.client.urlShare.inSpace(ARTICLE_URL_B, spaceId)?.itemId).toBe(item.id)
  })

  it('re-sharing the same content is unchanged; a stale check sends nothing; changed content is a version', async () => {
    await A.client.share.begin('t1')
    const p = A.client.share.store.getState()
    expect(p.phase === 'preview' && p.existing?.itemId).toBe(item.id)
    expect(p.phase === 'preview' && p.changed).toBe(false)
    await A.client.share.confirm()
    const s1 = A.client.share.store.getState()
    expect(s1.phase === 'done' && s1.outcome).toBe('unchanged')

    expect((await A.client.share.checkStale('t1')).status).toBe('fresh')
    const v2 = makePage(
      ARTICLE_URL,
      `${articleV1.markdown}\n\nUpdate: the date moved to April.`,
      'Quarterly plan',
    )
    A.bridge.captures.set('t1', { ok: true, page: v2 })
    const before = A.requests.length
    const stale = await A.client.share.checkStale('t1')
    expect(stale.status).toBe('stale')
    expect(A.requests.length).toBe(before)

    await A.client.share.begin('t1')
    await A.client.share.confirm()
    const s2 = A.client.share.store.getState()
    expect(s2.phase === 'done' && s2.outcome).toBe('version')
    await waitFor(
      () => B.client.urlShare.forTab('b1')?.locations[0]?.versionNumber === 2,
      5000,
      'B sees version 2',
    )
    await server.settle()
  })

  it('a tab that navigates gets the new URL state without any request', async () => {
    const before = A.requests.length
    A.bridge.setTabs([
      makeTab('t1', 'https://news.example.com/other'),
      ...Array.from({ length: 6 }, (_, i) => makeTab(`x${i}`, `https://site${i}.example.org/p`)),
      makeTab('bank', 'https://direct.bk.mufg.jp/account'),
      makeTab('priv', 'https://news.example.com/article?id=7', { isPrivate: true }),
    ])
    expect(A.client.urlShare.forTab('x5')).toMatchObject({ status: 'ready', locations: [] })
    expect(A.client.urlShare.forTab('t1')).toMatchObject({ status: 'ready', locations: [] })
    // A private tab on a shared URL still shows as not shared: it may never be captured.
    expect(A.client.urlShare.forTab('priv')?.locations).toEqual([])
    expect(A.client.urlShare.forTab('bank')?.locations).toEqual([])

    // Navigating back to the shared article shows it as shared again.
    A.bridge.setTabs([makeTab('t1', ARTICLE_URL)])
    expect(A.client.urlShare.forTab('t1')?.locations[0]?.itemId).toBe(item.id)
    await sleep(50)
    expect(A.requests.length).toBe(before)
  })

  it('a blocked capture result never reaches the network', async () => {
    const before = A.requests.length
    A.bridge.captures.set('bank', {
      ok: false,
      error: 'blocked',
      reason: 'banking',
      detail: 'mufg.jp',
    })
    await A.client.share.begin('bank')
    const s = A.client.share.store.getState()
    expect(s.phase === 'error' && s.failure.kind === 'capture' && s.failure.outcome.reason).toBe(
      'banking',
    )
    expect(await A.client.share.confirm()).toBe(false)

    // Even if an engine returned a page for a blocked URL, the client refuses it.
    A.bridge.captures.set('sneaky', {
      ok: true,
      page: makePage('https://direct.bk.mufg.jp/account', 'balance 1,000,000'),
    })
    await A.client.share.begin('sneaky')
    const s2 = A.client.share.store.getState()
    expect(s2.phase === 'error' && s2.failure.kind === 'capture' && s2.failure.outcome.reason).toBe(
      'banking',
    )
    expect(A.requests.length).toBe(before)
  })
})

describe('threads and AI', () => {
  it('both members see a Space thread; an AI answer streams in order with citations in both clients', async () => {
    const t = await A.client.threads.createSpaceThread('Plan')
    expect(t).not.toBeNull()
    spaceThread = t as Thread
    await waitFor(() => B.client.threads.thread(spaceThread.id), 5000, 'B sees thread')
    await B.client.threads.loadMessages(spaceThread.id)

    // Record B's view of the assistant message on every store change.
    const snapshots: { phase: string; text: string; citations: number }[] = []
    const off = B.client.threads.store.subscribe((s) => {
      const list = s.messages[spaceThread.id]?.list ?? []
      const m = list.find((v) => v.message.role === 'assistant')
      if (m) snapshots.push({ phase: m.phase, text: m.text, citations: m.citations.length })
    })

    const selected = A.client.models.selectedInfo()
    expect(selected?.provider).toBe('mock')
    const r = await A.client.threads.post(spaceThread.id, 'What is the plan?', { askAi: true })
    expect(r?.assistantMessage).not.toBeNull()
    const body = A.requests.filter(
      (x) => x.path.endsWith(`/threads/${spaceThread.id}/messages`) && x.method === 'POST',
    )[0]?.body
    expect(body).toMatchObject({ askAi: true, model: { provider: 'mock', id: selected?.model.id } })

    const id = r?.assistantMessage?.id as string
    for (const c of [A, B]) {
      await waitFor(
        () =>
          c.client.threads.store.getState().messages[spaceThread.id]?.list.find((m) => m.id === id)
            ?.phase === 'complete',
        8000,
        'answer complete',
      )
    }
    off()
    const finalA = A.client.threads.store
      .getState()
      .messages[spaceThread.id]?.list.find((m) => m.id === id)
    const finalB = B.client.threads.store
      .getState()
      .messages[spaceThread.id]?.list.find((m) => m.id === id)
    expect(finalB?.text).toBe(finalA?.text)
    expect(finalB?.text).toContain('[1]')
    expect(finalB?.citations[0]).toMatchObject({ n: 1, itemId: item.id, available: true })
    expect(finalB?.citations[0]?.quote.length).toBeGreaterThan(0)

    // The stream assembled in order: every streaming snapshot is a prefix of the final text, growing.
    const streaming = snapshots.filter((s) => s.phase === 'streaming')
    expect(streaming.length).toBeGreaterThan(3)
    let prev = ''
    for (const s of streaming) {
      expect(finalB?.text.startsWith(s.text)).toBe(true)
      expect(s.text.length).toBeGreaterThanOrEqual(prev.length)
      prev = s.text
    }
    // The early source list was shown while streaming, then replaced by the final citations.
    expect(streaming.some((s) => s.citations > 0)).toBe(true)
    await waitFor(
      () => (A.client.activity.store.getState().usage?.inputTokens ?? 0) > 0,
      5000,
      'usage',
    )
  })

  it('a private thread answer is invisible to the other member', async () => {
    const seenByB: string[] = []
    const off = B.client.realtime.on('event', (e) => {
      if ('threadId' in e) seenByB.push(e.threadId)
      if ('thread' in e) seenByB.push(e.thread.id)
      if ('message' in e && typeof e.message === 'object') seenByB.push(e.message.threadId)
    })
    const r = await A.client.threads.askPrivate('My own question', { askAi: true })
    const privateId = A.client.threads.store.getState().privateThreadId as string
    expect(r?.message.threadId).toBe(privateId)
    await waitFor(
      () =>
        A.client.threads.store
          .getState()
          .messages[privateId]?.list.find((m) => m.id === r?.assistantMessage?.id)?.phase ===
        'complete',
      8000,
      'private answer',
    )
    await server.settle()
    await sleep(50)
    off()
    expect(seenByB).not.toContain(privateId)
    expect(B.client.threads.thread(privateId)).toBeNull()
    expect(B.client.threads.store.getState().messages[privateId]).toBeUndefined()
  })

  it('attachments follow preview-then-confirm on a private thread and are refused on Space threads before any request', async () => {
    const privateId = A.client.threads.store.getState().privateThreadId as string
    const posts = () => A.count('POST', /\/messages$/)
    const extracts = () => A.bridge.callsOf('capture.extract').length

    // Space thread: refused before extracting or sending.
    const e0 = extracts()
    const r0 = A.requests.length
    await A.client.threads.beginAttach(spaceThread.id, 't1')
    const a0 = A.client.threads.store.getState().attach
    expect(a0.phase === 'error' && a0.failure.kind).toBe('not-allowed')
    expect(extracts()).toBe(e0)
    // Even a draft forced onto a Space thread is refused client-side.
    A.client.threads.store.setState({ drafts: { [spaceThread.id]: [articleV1] } })
    expect(await A.client.threads.post(spaceThread.id, 'with page', { askAi: true })).toBeNull()
    expect(A.client.threads.store.getState().mutation.error?.code).toBe('attachments_not_allowed')
    expect(A.requests.length).toBe(r0)
    A.client.threads.store.setState({ drafts: {} })

    // Private thread: preview, cancel discards, confirm adds to the draft; only post() sends.
    const page = makePage(
      'https://notes.example.net/draft',
      '# My notes\n\nPrivate notes about pricing.',
      'Notes',
    )
    A.bridge.captures.set('t2', { ok: true, page })
    await A.client.threads.beginAttach(privateId, 't2')
    expect(A.client.threads.store.getState().attach.phase).toBe('preview')
    A.client.threads.cancelAttach()
    expect(A.client.threads.store.getState().drafts[privateId]).toBeUndefined()
    await A.client.threads.beginAttach(privateId, 't2')
    const pv = A.client.threads.store.getState().attach
    expect(pv.phase === 'preview' && pv.page).toEqual(page)
    expect(A.client.threads.confirmAttach()).toBe(true)
    expect(A.client.threads.store.getState().drafts[privateId]).toEqual([page])
    expect(A.requests.length).toBe(r0)

    const before = posts()
    const r = await A.client.threads.post(privateId, 'Summarise my notes', { askAi: true })
    expect(posts()).toBe(before + 1)
    const sent = A.requests
      .filter((x) => x.method === 'POST' && x.path.endsWith('/messages'))
      .at(-1)
    expect((sent?.body as { attachments?: unknown[] } | undefined)?.attachments).toEqual([page])
    expect(r?.message.attachments[0]).toMatchObject({
      url: page.url,
      charCount: page.markdown.length,
    })
    expect(A.client.threads.store.getState().drafts[privateId]).toBeUndefined()

    // A blocked page cannot even be attached.
    await A.client.threads.beginAttach(privateId, 'bank')
    const ab = A.client.threads.store.getState().attach
    expect(ab.phase === 'error' && ab.failure.kind).toBe('capture')
    await server.settle()
  })

  it('sharing a private thread: each attached question is decided before anything is sent', async () => {
    const privateId = A.client.threads.store.getState().privateThreadId as string
    const flow = A.client.shareThread
    const shares = () => A.count('POST', /\/share$/)
    const s0 = shares()

    // A Space thread cannot be shared again: refused before any request.
    const r0 = A.requests.length
    await flow.begin(spaceThread.id)
    expect(flow.store.getState()).toMatchObject({ phase: 'error', failure: { kind: 'not-private' } })
    expect(A.requests.length).toBe(r0)

    // The whole thread is read; the attached question is listed with its answer.
    await flow.begin(privateId)
    const d0 = flow.store.getState()
    if (d0.phase !== 'deciding') throw new Error(`expected deciding, got ${d0.phase}`)
    expect(d0.messages.map((m) => m.content).slice(0, 1)).toEqual(['My own question'])
    expect(d0.questions).toHaveLength(1)
    const q = d0.questions[0]
    expect(q?.question.content).toBe('Summarise my notes')
    expect(q?.answers.map((m) => m.role)).toEqual(['assistant'])
    expect(q?.decision).toBeNull()
    expect(d0.ready).toBe(false)

    // Undecided: confirm sends nothing; an attached question cannot be dropped as a plain message.
    expect(await flow.confirm()).toBe(false)
    expect(flow.setExcluded(q?.question.id as string, true)).toBe(false)
    expect(shares()).toBe(s0)

    // Excluding the question excludes its answer; including it brings both back.
    expect(flow.decide(q?.question.id as string, 'include')).toBe(true)
    expect(flow.preview().map((m) => m.id)).toEqual(d0.messages.map((m) => m.id))
    expect(flow.decide(q?.question.id as string, 'exclude')).toBe(true)
    expect(flow.preview().map((m) => m.content)).not.toContain('Summarise my notes')
    expect(flow.preview().some((m) => m.id === q?.answers[0]?.id)).toBe(false)
    expect(flow.store.getState()).toMatchObject({ phase: 'deciding', ready: true })
    expect(shares()).toBe(s0)

    expect(await flow.confirm()).toBe(true)
    expect(shares()).toBe(s0 + 1)
    const sent = A.requests.filter((x) => x.method === 'POST' && x.path.endsWith('/share')).at(-1)
    expect(sent?.body).toEqual({
      includeAttachedMessageIds: [],
      excludeMessageIds: [q?.question.id],
    })
    const done = flow.store.getState()
    if (done.phase !== 'done') throw new Error(`expected done, got ${done.phase}`)
    const copy = done.thread
    expect(copy).toMatchObject({ visibility: 'space', spaceId })
    expect(copy.id).not.toBe(privateId)
    expect(A.client.threads.thread(copy.id)?.visibility).toBe('space')

    // The private thread is unchanged and still the side-panel thread; B sees only the copy.
    expect(A.client.threads.thread(privateId)?.visibility).toBe('private')
    expect(A.client.threads.store.getState().privateThreadId).toBe(privateId)
    await waitFor(() => B.client.threads.thread(copy.id) !== null, 5000, 'B sees the copy')
    expect(B.client.threads.thread(privateId)).toBeNull()
    await B.client.threads.loadMessages(copy.id)
    const seen = B.client.threads.store.getState().messages[copy.id]?.list ?? []
    expect(seen.map((m) => m.message.content).slice(0, 1)).toEqual(['My own question'])
    const visible = JSON.stringify(seen)
    for (const s of ['Summarise my notes', 'notes.example.net', 'Private notes about pricing']) {
      expect(visible).not.toContain(s)
    }
    expect(seen.every((m) => m.message.attachments.length === 0)).toBe(true)
  })

  it('a page attached after the decisions were made is refused by the server; nothing is created', async () => {
    const privateId = A.client.threads.store.getState().privateThreadId as string
    const flow = A.client.shareThread
    await flow.begin(privateId)
    const d = flow.store.getState()
    if (d.phase !== 'deciding') throw new Error(`expected deciding, got ${d.phase}`)
    for (const q of d.questions) flow.decide(q.question.id, 'exclude')
    const threadsBefore = B.client.threads.store.getState().threads.length

    // A new attached question lands before confirm: it is undecided, so the server refuses.
    A.bridge.captures.set('t3', {
      ok: true,
      page: makePage('https://notes.example.net/late', '# Late\n\nLate private page.', 'Late'),
    })
    await A.client.threads.beginAttach(privateId, 't3')
    expect(A.client.threads.confirmAttach()).toBe(true)
    expect(await A.client.threads.post(privateId, 'One more page', { askAi: false })).not.toBeNull()

    expect(await flow.confirm()).toBe(false)
    expect(flow.store.getState()).toMatchObject({
      phase: 'error',
      failure: { kind: 'api', error: { code: 'thread_has_private_attachments', status: 409 } },
    })
    await sleep(100)
    expect(B.client.threads.store.getState().threads.length).toBe(threadsBefore)
    flow.cancel()
    expect(flow.store.getState().phase).toBe('idle')
  })

  it('unshare updates both clients and marks citations unavailable', async () => {
    expect(await A.client.items.unshare(item.id)).toBe(true)
    for (const c of [A, B]) {
      await waitFor(
        () => !c.client.items.store.getState().items.some((i) => i.id === item.id),
        5000,
        'item gone',
      )
      const cites = () =>
        (c.client.threads.store.getState().messages[spaceThread.id]?.list ?? []).flatMap(
          (m) => m.citations,
        )
      await waitFor(
        () => cites().length > 0 && cites().every((x) => x.available === false && x.quote === ''),
        5000,
        'citations unavailable',
      )
    }
    await waitFor(
      () => (B.client.urlShare.forTab('b1')?.locations.length ?? -1) === 0,
      5000,
      'B url state cleared',
    )
    expect(A.client.urlShare.forTab('t1')?.locations).toEqual([])
  })

  it('the audit log of the current Space updates live', async () => {
    await waitFor(
      () => {
        const actions = B.client.activity.store.getState().audit.map((a) => a.action)
        return actions.includes('item.unshared') && actions.includes('thread.shared')
      },
      5000,
      'audit',
    )
  })
})

describe('exports', () => {
  it('a Google Doc export goes through the bridge and is recorded on the server', async () => {
    const msg = A.client.threads.store
      .getState()
      .messages[spaceThread.id]?.list.find((m) => m.message.role === 'assistant')
    const r = await A.client.exports.googleDoc({
      spaceId,
      title: 'Plan',
      markdown: msg?.text as string,
      messageId: msg?.id,
    })
    expect(r).toMatchObject({ ok: true, docId: 'doc123', recordError: null })
    expect(A.bridge.callsOf('google.exportDoc')[0]?.req).toEqual({
      title: 'Plan',
      markdown: msg?.text,
    })
    await waitFor(() =>
      A.client.activity.store.getState().audit.some((a) => a.action === 'export.google_doc'),
    )

    A.bridge.googleExport = { ok: false, error: 'not-connected', detail: null }
    const before = A.count('POST', /\/exports$/)
    expect(await A.client.exports.googleDoc({ spaceId, title: 'Plan', markdown: 'x' })).toEqual({
      ok: false,
      error: 'not-connected',
      detail: null,
    })
    expect(A.count('POST', /\/exports$/)).toBe(before)

    expect(await A.client.exports.saveFile({ suggestedName: 'plan', content: '# Plan' })).toBe(
      '/tmp/plan.md',
    )
    expect(A.bridge.saved[0]).toEqual({ suggestedName: 'plan', content: '# Plan', extension: 'md' })
    await A.client.exports.copyMarkdown('# Plan')
    expect(A.bridge.clipboard).toEqual(['# Plan'])
  })
})

describe('reconnect', () => {
  it('after the socket is dropped the client reconnects, resubscribes and catches up', async () => {
    const resyncs: number[] = []
    const off = B.client.realtime.on('resync', () => resyncs.push(Date.now()))
    B.gate.blocked = true
    server.dropSockets()
    await waitFor(
      () => B.client.ui.getState().connection === 'reconnecting',
      5000,
      'B reconnecting',
    )

    // While B is offline: A shares a new page and posts in the Space thread.
    const missed = makePage(
      'https://blog.example.com/missed',
      '# Missed\n\nShared while B was offline.',
      'Missed',
    )
    A.bridge.captures.set('m1', { ok: true, page: missed })
    await A.client.share.begin('m1')
    await A.client.share.confirm()
    const missedItem = (() => {
      const s = A.client.share.store.getState()
      return s.phase === 'done' ? s.item : null
    })()
    const posted = await A.client.threads.post(spaceThread.id, 'Posted while B was away', {
      askAi: false,
    })
    await sleep(100)
    expect(B.client.items.store.getState().items.some((i) => i.id === missedItem?.id)).toBe(false)

    B.gate.blocked = false
    await waitFor(() => B.client.ui.getState().connection === 'online', 5000, 'B back online')
    await waitFor(() => resyncs.length > 0, 2000, 'resync')
    await waitFor(
      () => B.client.items.store.getState().items.some((i) => i.id === missedItem?.id),
      5000,
      'B caught up items',
    )
    await waitFor(
      () =>
        B.client.threads.store
          .getState()
          .messages[spaceThread.id]?.list.some((m) => m.id === posted?.message.id),
      5000,
      'B caught up messages',
    )
    off()

    // Resubscribed: a new event reaches B through the socket again.
    const viaSocket: string[] = []
    const off2 = B.client.realtime.on('item.upserted', (e) => viaSocket.push(e.item.id))
    const again = makePage(
      'https://blog.example.com/after',
      '# After\n\nShared after B came back.',
      'After',
    )
    A.bridge.captures.set('m2', { ok: true, page: again })
    await A.client.share.begin('m2')
    await A.client.share.confirm()
    const s = A.client.share.store.getState()
    const afterId = s.phase === 'done' ? s.item.id : ''
    await waitFor(() => viaSocket.includes(afterId), 5000, 'event after reconnect')
    off2()
    await server.settle()
  })
})

describe('cleanup flows', () => {
  it('deleting a thread removes it for both members', async () => {
    expect(await A.client.threads.remove(spaceThread.id)).toBe(true)
    await waitFor(() => B.client.threads.thread(spaceThread.id) === null, 5000, 'B thread gone')
  })

  it('logout clears the token, the stores and the socket', async () => {
    await A.client.session.logout()
    expect(A.bridge.token).toBeNull()
    expect(A.client.session.store.getState().status).toBe('signedOut')
    expect(A.client.spaces.store.getState().list).toEqual([])
    expect(A.client.threads.store.getState().threads).toEqual([])
    expect(A.client.ui.getState().connection).toBe('offline')
  })
})
