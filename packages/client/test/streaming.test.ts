import { randomUUID } from 'node:crypto'
import type { Citation, Message, ServerEvent, Thread } from '@tiger/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ApiClient } from '../src'
import type { ClientContext } from '../src/load'
import { createThreads, type ThreadsController, type ViewMessage } from '../src/stores/threads'
import { FakeBridge } from './helpers/fake-bridge'

/**
 * Stream assembly in isolation: events are fed straight into the threads store in the orders a
 * network can produce (reordered, duplicated, missing, early), with no server involved.
 */

const SPACE = randomUUID()
const THREAD = randomUUID()
const USER = { id: randomUUID(), name: 'Aiko', avatarUrl: null }
const ITEM = randomUUID()
const now = () => new Date().toISOString()

const noNetwork: ApiClient = {
  serverUrl: 'http://x.test',
  call: async () => {
    throw new Error('this test makes no requests')
  },
}

function citation(n: number, itemId = ITEM): Citation {
  return {
    n,
    itemId,
    itemVersionId: randomUUID(),
    title: `Source ${n}`,
    url: `https://example.com/${n}`,
    sourceType: 'web',
    sharedBy: USER,
    sharedAt: now(),
    quote: `quote ${n}`,
    available: true,
  }
}

function placeholder(id = randomUUID()): Message {
  return {
    id,
    threadId: THREAD,
    role: 'assistant',
    author: USER,
    model: { provider: 'mock', id: 'mock-chat' },
    content: '',
    citations: [],
    attachments: [],
    status: 'streaming',
    errorCode: null,
    usage: null,
    streamSeq: 0,
    createdAt: now(),
  }
}

const thread: Thread = {
  id: THREAD,
  spaceId: SPACE,
  visibility: 'space',
  owner: USER,
  title: 'T',
  createdAt: now(),
  lastMessageAt: null,
}

let threads: ThreadsController
let finished: string[]

beforeEach(() => {
  const ctx: ClientContext = { api: noNetwork, bridge: new FakeBridge(), userId: () => USER.id }
  finished = []
  threads = createThreads(ctx, {
    modelForMessage: () => null,
    messagePosted: () => {},
    answerFinished: (s) => finished.push(s),
  })
  threads.store.setState({
    spaceId: SPACE,
    threads: [thread],
    messages: { [THREAD]: { list: [], load: { status: 'ready', error: null }, hasMore: false } },
  })
})

const send = (e: ServerEvent) => threads.handleEvent(e)
const delta = (messageId: string, seq: number, text: string): ServerEvent => ({
  type: 'message.delta',
  spaceId: SPACE,
  threadId: THREAD,
  messageId,
  seq,
  text,
})
const view = (id: string): ViewMessage | undefined =>
  threads.store.getState().messages[THREAD]?.list.find((m) => m.id === id)

describe('stream assembly', () => {
  it('appends deltas in seq order, buffering out-of-order ones', () => {
    const m = placeholder()
    send({ type: 'message.created', spaceId: SPACE, message: m })
    send(delta(m.id, 0, 'Hel'))
    send(delta(m.id, 2, 'wor'))
    expect(view(m.id)?.text).toBe('Hel') // gap at seq 1: nothing after it is shown yet
    send(delta(m.id, 1, 'lo '))
    expect(view(m.id)?.text).toBe('Hello wor')
    send(delta(m.id, 3, 'ld'))
    expect(view(m.id)).toMatchObject({ phase: 'streaming', text: 'Hello world' })
  })

  it('ignores duplicate deltas, delivered or buffered', () => {
    const m = placeholder()
    send({ type: 'message.created', spaceId: SPACE, message: m })
    send(delta(m.id, 0, 'a'))
    send(delta(m.id, 0, 'a'))
    send(delta(m.id, 2, 'c'))
    send(delta(m.id, 2, 'X'))
    send(delta(m.id, 1, 'b'))
    send(delta(m.id, 1, 'b'))
    expect(view(m.id)?.text).toBe('abc')
  })

  it('deltas that arrive before the placeholder message are kept', () => {
    const m = placeholder()
    send(delta(m.id, 0, 'early '))
    send(delta(m.id, 1, 'text'))
    send({ type: 'message.created', spaceId: SPACE, message: m })
    expect(view(m.id)?.text).toBe('early text')
  })

  it('a gap that never fills is repaired by the final message', () => {
    const m = placeholder()
    send({ type: 'message.created', spaceId: SPACE, message: m })
    send(delta(m.id, 0, 'One '))
    send(delta(m.id, 2, 'three'))
    expect(view(m.id)?.text).toBe('One ')
    send({
      type: 'message.completed',
      spaceId: SPACE,
      message: { ...m, status: 'complete', content: 'One two three [1]', citations: [citation(1)] },
      usage: null,
    })
    expect(view(m.id)).toMatchObject({ phase: 'complete', text: 'One two three [1]' })
    expect(finished).toEqual([SPACE])
  })

  it('the early source list is shown while streaming, then replaced (not merged) by the final citations', () => {
    const m = placeholder()
    send({ type: 'message.created', spaceId: SPACE, message: m })
    send({
      type: 'message.sources',
      spaceId: SPACE,
      threadId: THREAD,
      messageId: m.id,
      citations: [citation(1), citation(2), citation(3)],
    })
    send(delta(m.id, 0, 'Answer [2]'))
    expect(view(m.id)?.citations.map((c) => c.n)).toEqual([1, 2, 3])
    send({
      type: 'message.completed',
      spaceId: SPACE,
      message: { ...m, status: 'complete', content: 'Answer [1]', citations: [citation(1)] },
      usage: null,
    })
    expect(view(m.id)?.citations.map((c) => c.n)).toEqual([1])
  })

  it('a failed answer keeps the streamed text and the reason; ai_aborted is shown as aborted', () => {
    const a = placeholder()
    send({ type: 'message.created', spaceId: SPACE, message: a })
    send(delta(a.id, 0, 'partial'))
    send({
      type: 'message.failed',
      spaceId: SPACE,
      threadId: THREAD,
      messageId: a.id,
      code: 'ai_timeout',
      message: 'slow',
    })
    expect(view(a.id)).toMatchObject({
      phase: 'failed',
      text: 'partial',
      failure: { code: 'ai_timeout', message: 'slow' },
    })

    const b = placeholder()
    send({ type: 'message.created', spaceId: SPACE, message: b })
    send({
      type: 'message.failed',
      spaceId: SPACE,
      threadId: THREAD,
      messageId: b.id,
      code: 'ai_aborted',
      message: 'stopped',
    })
    expect(view(b.id)?.phase).toBe('aborted')
  })

  it('a late streaming copy (the POST response) never rolls a settled answer back', () => {
    const m = placeholder()
    send({
      type: 'message.completed',
      spaceId: SPACE,
      message: { ...m, status: 'complete', content: 'Done' },
      usage: null,
    })
    send({ type: 'message.created', spaceId: SPACE, message: m })
    expect(view(m.id)).toMatchObject({ phase: 'complete', text: 'Done' })

    const f = placeholder()
    send(delta(f.id, 0, 'half'))
    send({
      type: 'message.failed',
      spaceId: SPACE,
      threadId: THREAD,
      messageId: f.id,
      code: 'ai_failed',
      message: 'x',
    })
    send({ type: 'message.created', spaceId: SPACE, message: f })
    expect(view(f.id)).toMatchObject({ phase: 'failed', text: 'half' })
  })

  it('unsharing an item marks its citations unavailable and empties the quote, streaming or final', () => {
    const done = placeholder()
    send({
      type: 'message.completed',
      spaceId: SPACE,
      message: {
        ...done,
        status: 'complete',
        content: 'x [1] [2]',
        citations: [citation(1), citation(2, randomUUID())],
      },
      usage: null,
    })
    send({ type: 'message.created', spaceId: SPACE, message: done })
    const live = placeholder()
    send({ type: 'message.created', spaceId: SPACE, message: live })
    send({
      type: 'message.sources',
      spaceId: SPACE,
      threadId: THREAD,
      messageId: live.id,
      citations: [citation(1)],
    })

    send({ type: 'item.deleted', spaceId: SPACE, itemId: ITEM, url: 'https://example.com/1' })
    expect(view(done.id)?.citations.map((c) => [c.n, c.available, c.quote])).toEqual([
      [1, false, ''],
      [2, true, 'quote 2'],
    ])
    expect(view(live.id)?.citations[0]).toMatchObject({ available: false, quote: '' })
  })

  it('a deleted thread drops its messages; events for other Spaces are ignored', () => {
    send({ type: 'thread.created', thread: { ...thread, id: randomUUID(), spaceId: randomUUID() } })
    expect(threads.store.getState().threads).toHaveLength(1)
    send({ type: 'thread.deleted', spaceId: SPACE, threadId: THREAD })
    expect(threads.store.getState().threads).toHaveLength(0)
    expect(threads.store.getState().messages[THREAD]).toBeUndefined()
  })
})

describe('message lists fetched while an answer streams', () => {
  /** A threads store whose listMessages answers are released by the test. */
  function withServer() {
    const replies: { resolve: (list: Message[]) => void }[] = []
    const api: ApiClient = {
      serverUrl: 'http://x.test',
      call: (() =>
        new Promise<Message[]>((resolve) => {
          replies.push({ resolve })
        })) as unknown as ApiClient['call'],
    }
    const ctx: ClientContext = { api, bridge: new FakeBridge(), userId: () => USER.id }
    const t = createThreads(ctx, {
      modelForMessage: () => null,
      messagePosted: () => {},
      answerFinished: () => {},
    })
    t.store.setState({ spaceId: SPACE, threads: [thread], messages: {} })
    const v = (id: string) => t.store.getState().messages[THREAD]?.list.find((m) => m.id === id)
    const d = (id: string, seq: number, text: string) => t.handleEvent(delta(id, seq, text))
    return { t, replies, v, d }
  }

  it('opening a thread after some deltas arrived shows each delta once', async () => {
    const s = withServer()
    const m = placeholder()
    s.d(m.id, 0, 'Hello ')
    s.d(m.id, 1, 'world')
    const loading = s.t.loadMessages(THREAD)
    s.replies[0]?.resolve([{ ...m, content: 'Hello world', streamSeq: 2 }])
    await loading
    expect(s.v(m.id)?.text).toBe('Hello world')
    s.d(m.id, 2, '!')
    expect(s.v(m.id)?.text).toBe('Hello world!')
  })

  it('deltas after a mid-stream load continue the text instead of waiting for completion', async () => {
    const s = withServer()
    const m = placeholder()
    const loading = s.t.loadMessages(THREAD)
    s.replies[0]?.resolve([{ ...m, content: 'Hello ', streamSeq: 1 }])
    await loading
    expect(s.v(m.id)?.text).toBe('Hello ')
    s.d(m.id, 1, 'world')
    s.d(m.id, 2, '!')
    expect(s.v(m.id)?.text).toBe('Hello world!')
  })

  it('a delta the snapshot already covered, arriving after it over the socket, is not shown twice', async () => {
    const s = withServer()
    const m = placeholder()
    const loading = s.t.loadMessages(THREAD)
    s.replies[0]?.resolve([{ ...m, content: 'Hello world', streamSeq: 2 }]) // covers seq 0 and 1
    await loading
    s.d(m.id, 1, 'world') // published before the snapshot was read, delivered after it
    s.d(m.id, 2, '!')
    expect(s.v(m.id)?.text).toBe('Hello world!')
  })

  it('a snapshot older than the deltas already shown keeps them, without repeating any', async () => {
    const s = withServer()
    const m = placeholder()
    s.d(m.id, 0, 'One ')
    s.d(m.id, 1, 'two ')
    s.d(m.id, 2, 'three')
    const loading = s.t.loadMessages(THREAD)
    s.replies[0]?.resolve([{ ...m, content: 'One ', streamSeq: 1 }]) // read before seq 1 went out
    await loading
    expect(s.v(m.id)?.text).toBe('One two three')
    s.d(m.id, 3, '.')
    expect(s.v(m.id)?.text).toBe('One two three.')
  })

  it('a snapshot ahead of the socket: its deltas arriving late are skipped, later ones continue it', async () => {
    const s = withServer()
    const m = placeholder()
    s.d(m.id, 0, 'A')
    const loading = s.t.loadMessages(THREAD)
    s.replies[0]?.resolve([{ ...m, content: 'ABCD', streamSeq: 4 }])
    await loading
    expect(s.v(m.id)?.text).toBe('ABCD')
    s.d(m.id, 2, 'C') // covered by the snapshot
    s.d(m.id, 1, 'B')
    s.d(m.id, 3, 'D')
    expect(s.v(m.id)?.text).toBe('ABCD')
    s.d(m.id, 5, 'F') // seq 4 is still missing: wait for it
    expect(s.v(m.id)?.text).toBe('ABCD')
    s.d(m.id, 4, 'E')
    expect(s.v(m.id)?.text).toBe('ABCDEF')
  })

  it('an empty snapshot of an answer that has not streamed yet takes the deltas from seq 0', async () => {
    const s = withServer()
    const m = placeholder()
    const loading = s.t.loadMessages(THREAD)
    s.replies[0]?.resolve([m])
    await loading
    s.d(m.id, 1, 'b')
    expect(s.v(m.id)?.text).toBe('')
    s.d(m.id, 0, 'a')
    expect(s.v(m.id)?.text).toBe('ab')
  })

  it('a list fetched before the answer completed does not roll the completed answer back', async () => {
    const s = withServer()
    const m = placeholder()
    s.t.store.setState({
      messages: { [THREAD]: { list: [], load: { status: 'ready', error: null }, hasMore: false } },
    })
    s.t.handleEvent({ type: 'message.created', spaceId: SPACE, message: m })
    s.d(m.id, 0, 'Full ans')
    const loading = s.t.loadMessages(THREAD) // e.g. a resync after reconnect
    s.t.handleEvent({
      type: 'message.completed',
      spaceId: SPACE,
      message: { ...m, status: 'complete', content: 'Full answer.' },
      usage: null,
    })
    s.replies[0]?.resolve([{ ...m, content: 'Full ans', streamSeq: 1 }]) // taken earlier
    await loading
    expect(s.v(m.id)).toMatchObject({ phase: 'complete', text: 'Full answer.' })
  })

  it('an older list response that lands after a newer one does not roll the streaming text back', async () => {
    const s = withServer()
    const m = placeholder()
    const first = s.t.loadMessages(THREAD) // its reply is read early and delivered late
    const second = s.t.loadMessages(THREAD)
    s.replies[1]?.resolve([{ ...m, content: 'ABCDE', streamSeq: 5 }])
    await second
    s.d(m.id, 5, 'F')
    expect(s.v(m.id)?.text).toBe('ABCDEF')
    s.replies[0]?.resolve([{ ...m, content: 'AB', streamSeq: 2 }])
    await first
    expect(s.v(m.id)?.text).toBe('ABCDEF')
    s.d(m.id, 6, 'G')
    expect(s.v(m.id)?.text).toBe('ABCDEFG')
  })

  it('an older list response that lands after a newer one does not drop messages the newer one had', async () => {
    const s = withServer()
    const m = placeholder()
    const later = {
      ...placeholder(),
      content: 'next',
      status: 'complete' as const,
      streamSeq: null,
    }
    const first = s.t.loadMessages(THREAD)
    const second = s.t.loadMessages(THREAD)
    s.replies[1]?.resolve([{ ...m, status: 'complete', content: 'done', streamSeq: null }, later])
    await second
    s.replies[0]?.resolve([{ ...m, content: 'do', streamSeq: 1 }])
    await first
    expect(s.t.store.getState().messages[THREAD]?.list.map((v) => [v.id, v.phase])).toEqual([
      [m.id, 'complete'],
      [later.id, 'complete'],
    ])
  })

  it('a snapshot covering less than the text already assembled from an earlier snapshot is ignored', async () => {
    const s = withServer()
    const m = placeholder()
    const first = s.t.loadMessages(THREAD)
    s.replies[0]?.resolve([{ ...m, content: 'ABCDE', streamSeq: 5 }])
    await first
    s.d(m.id, 5, 'F')
    // A copy read from storage (empty text, streamSeq 0) of the same answer, delivered afterwards.
    const second = s.t.loadMessages(THREAD)
    s.replies[1]?.resolve([m])
    await second
    expect(s.v(m.id)?.text).toBe('ABCDEF')
    s.d(m.id, 6, 'G')
    expect(s.v(m.id)?.text).toBe('ABCDEFG')
  })

  it('a failure reported while the list is loading is applied to the streaming copy that list brings', async () => {
    const s = withServer()
    const m = placeholder()
    s.t.store.setState({
      messages: { [THREAD]: { list: [], load: { status: 'ready', error: null }, hasMore: false } },
    })
    const loading = s.t.loadMessages(THREAD)
    s.d(m.id, 0, 'half')
    s.t.handleEvent({
      type: 'message.failed',
      spaceId: SPACE,
      threadId: THREAD,
      messageId: m.id,
      code: 'ai_failed',
      message: 'The provider failed',
    })
    s.replies[0]?.resolve([{ ...m, content: 'half', streamSeq: 1 }]) // read before the failure
    await loading
    expect(s.v(m.id)).toMatchObject({
      phase: 'failed',
      text: 'half',
      failure: { code: 'ai_failed', message: 'The provider failed' },
    })
    s.d(m.id, 1, ' more') // a straggler delta changes nothing
    expect(s.v(m.id)).toMatchObject({ phase: 'failed', text: 'half' })
  })
})

describe('posting with attachments', () => {
  const page = (n: number) => ({
    url: `https://example.com/p${n}`,
    title: `Page ${n}`,
    sourceType: 'web' as const,
    markdown: `Body ${n}`,
    lang: 'en',
    byline: null,
    siteName: null,
    extractor: 'readability@0.6',
    capturedAt: now(),
    charCount: 6,
    truncated: false,
  })
  const priv: Thread = { ...thread, visibility: 'private' }

  function withServer() {
    const posts: { body: unknown; resolve: (r: unknown) => void }[] = []
    const api: ApiClient = {
      serverUrl: 'http://x.test',
      call: ((_ep: unknown, req: { body: unknown }) =>
        new Promise((resolve) => {
          posts.push({ body: req.body, resolve })
        })) as unknown as ApiClient['call'],
    }
    const ctx: ClientContext = { api, bridge: new FakeBridge(), userId: () => USER.id }
    const t = createThreads(ctx, {
      modelForMessage: () => null,
      messagePosted: () => {},
      answerFinished: () => {},
    })
    t.store.setState({
      spaceId: SPACE,
      threads: [priv],
      messages: { [THREAD]: { list: [], load: { status: 'ready', error: null }, hasMore: false } },
    })
    const reply = () => ({
      message: { ...placeholder(), role: 'user', status: 'complete', content: 'q' },
      assistantMessage: null,
    })
    return { t, posts, reply }
  }

  it('keeps an attachment confirmed while the message was being sent', async () => {
    const s = withServer()
    s.t.store.setState({ drafts: { [THREAD]: [page(1)] } })
    const sending = s.t.post(THREAD, 'q', { askAi: false })
    // The member attaches page 2 while the POST is in flight.
    s.t.store.setState({
      drafts: { [THREAD]: [...(s.t.store.getState().drafts[THREAD] ?? []), page(2)] },
    })
    s.posts[0]?.resolve(s.reply())
    await sending
    expect(s.t.store.getState().drafts[THREAD]?.map((p) => p.title)).toEqual(['Page 2'])
  })

  it('a second post to the same thread while one is in flight sends nothing', async () => {
    const s = withServer()
    s.t.store.setState({ drafts: { [THREAD]: [page(1)] } })
    const first = s.t.post(THREAD, 'q', { askAi: false })
    const second = await s.t.post(THREAD, 'q', { askAi: false })
    expect(second).toBeNull()
    expect(s.posts).toHaveLength(1)
    s.posts[0]?.resolve(s.reply())
    expect(await first).not.toBeNull()
  })
})
