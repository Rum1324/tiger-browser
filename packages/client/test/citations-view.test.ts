import { randomUUID } from 'node:crypto'
import type { Citation, Message, Thread } from '@tiger/shared'
import { describe, expect, it } from 'vitest'
import type { ApiClient } from '../src'
import type { ClientContext } from '../src/load'
import { createThreads } from '../src/stores/threads'
import { FakeBridge } from './helpers/fake-bridge'

/** Citations as the UI receives them (DESIGN.md 15.2 item 10). */

const SPACE = randomUUID()
const THREAD = randomUUID()
const USER = { id: randomUUID(), name: 'Aiko', avatarUrl: null }
const SHARER = { id: randomUUID(), name: 'Bunta', avatarUrl: 'https://a.example/b.png' }
const now = () => new Date().toISOString()
const noNetwork: ApiClient = {
  serverUrl: 'http://x.test',
  call: async () => {
    throw new Error('no requests')
  },
}

const cite = (n: number, itemId: string, versionNumber: number, available: boolean): Citation => ({
  n,
  itemId,
  itemVersionId: randomUUID(),
  versionNumber,
  title: `Plan ${n}`,
  url: `https://example.com/${n}`,
  sourceType: 'web',
  sharedBy: SHARER,
  sharedAt: '2026-11-01T00:00:00.000Z',
  quote: available ? `quote ${n}` : '',
  available,
})

function setup() {
  const ctx: ClientContext = { api: noNetwork, bridge: new FakeBridge(), userId: () => USER.id }
  const threads = createThreads(ctx, {
    modelForMessage: () => null,
    messagePosted: () => {},
    answerFinished: () => {},
  })
  const thread: Thread = {
    id: THREAD,
    spaceId: SPACE,
    visibility: 'space',
    owner: USER,
    title: 'T',
    createdAt: now(),
    lastMessageAt: null,
  }
  threads.store.setState({
    spaceId: SPACE,
    threads: [thread],
    messages: { [THREAD]: { list: [], load: { status: 'ready', error: null }, hasMore: false } },
  })
  return threads
}

const answer = (citations: Citation[]): Message => ({
  id: randomUUID(),
  threadId: THREAD,
  role: 'assistant',
  author: USER,
  model: { provider: 'mock', id: 'mock-chat' },
  content: 'See [1] and [2].',
  citations,
  attachments: [],
  status: 'complete',
  errorCode: null,
  usage: null,
  streamSeq: null,
  createdAt: now(),
})

describe('citations in the view', () => {
  it('carry the version number; an unavailable one has no name or date', () => {
    const threads = setup()
    const live = randomUUID()
    const gone = randomUUID()
    const m = answer([cite(1, live, 3, true), cite(2, gone, 2, false)])
    threads.handleEvent({ type: 'message.created', spaceId: SPACE, message: m })
    const [c1, c2] = threads.store.getState().messages[THREAD]?.list[0]?.citations ?? []
    expect(c1).toMatchObject({ n: 1, versionNumber: 3, title: 'Plan 1', sharedBy: SHARER })
    expect(c2).toMatchObject({
      n: 2,
      available: false,
      versionNumber: 2,
      title: '',
      url: '',
      quote: '',
      sharedAt: '',
      sharedBy: { id: SHARER.id, name: '', avatarUrl: null },
    })
  })

  it('an item unshared while shown loses its name and date at once', () => {
    const threads = setup()
    const item = randomUUID()
    threads.handleEvent({
      type: 'message.created',
      spaceId: SPACE,
      message: answer([cite(1, item, 1, true)]),
    })
    threads.handleEvent({ type: 'item.deleted', spaceId: SPACE, itemId: item, url: 'x' })
    const [c] = threads.store.getState().messages[THREAD]?.list[0]?.citations ?? []
    expect(c).toMatchObject({ available: false, title: '', sharedAt: '', versionNumber: 1 })
    expect(c?.sharedBy.name).toBe('')
  })
})
