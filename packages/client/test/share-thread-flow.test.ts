import { randomUUID } from 'node:crypto'
import type { Message, Thread } from '@tiger/shared'
import { describe, expect, it } from 'vitest'
import type { ApiClient } from '../src'
import type { ClientContext } from '../src/load'
import { attachedQuestions, createShareThreadFlow } from '../src/stores/share-thread'
import { FakeBridge } from './helpers/fake-bridge'

const user = { id: 'u1', name: 'Aiko', avatarUrl: null }

function msg(role: 'user' | 'assistant', content: string, attached = false): Message {
  return {
    id: randomUUID(),
    threadId: 't',
    role,
    author: user,
    model: null,
    content,
    citations: [],
    attachments: attached
      ? [{ url: 'https://private.example/p', title: 'P', sourceType: 'web', charCount: 1 }]
      : [],
    status: 'complete',
    errorCode: null,
    usage: null,
    streamSeq: null,
    createdAt: new Date().toISOString(),
  }
}

/** The flow against an in-memory thread served in pages of `page` messages, newest page first. */
function setup(messages: Message[], thread: Partial<Thread> = {}) {
  const calls: { path: string; input: Record<string, unknown> }[] = []
  const copy = { id: randomUUID(), visibility: 'space' } as Thread
  const api: ApiClient = {
    serverUrl: 'http://x.test',
    call: (async (def: { path: string }, input: Record<string, unknown>) => {
      calls.push({ path: def.path, input })
      if (def.path.endsWith('/share')) return copy
      const query = input.query as { before?: string; limit: number }
      const end = query.before ? messages.findIndex((m) => m.id === query.before) : messages.length
      return messages.slice(Math.max(0, end - query.limit), end)
    }) as unknown as ApiClient['call'],
  }
  const ctx: ClientContext = { api, bridge: new FakeBridge(), userId: () => 'u1' }
  const landed: Thread[] = []
  const flow = createShareThreadFlow(ctx, {
    thread: () => ({ id: 't', visibility: 'private', owner: user, ...thread }) as Thread,
    shared: (t) => landed.push(t),
  })
  const shareCalls = () => calls.filter((c) => c.path.endsWith('/share'))
  return { flow, calls, shareCalls, landed, copy }
}

describe('share-thread flow', () => {
  const q1 = msg('user', 'plain')
  const a1 = msg('assistant', 'a1')
  const q2 = msg('user', 'attached', true)
  const a2 = msg('assistant', 'a2')
  const a2b = msg('assistant', 'a2b')
  const q3 = msg('user', 'plain again')
  const a3 = msg('assistant', 'a3')
  const thread = [q1, a1, q2, a2, a2b, q3, a3]

  it('groups attached questions with the answers up to the next question', () => {
    expect(
      attachedQuestions(thread).map((q) => [q.question.id, q.answers.map((a) => a.id)]),
    ).toEqual([[q2.id, [a2.id, a2b.id]]])
  })

  it('reads every page of a long thread before listing the questions', async () => {
    const long = Array.from({ length: 450 }, (_, i) =>
      i === 3 ? msg('user', 'old attached', true) : msg(i % 2 ? 'assistant' : 'user', `m${i}`),
    )
    const s = setup(long)
    await s.flow.begin('t')
    const st = s.flow.store.getState()
    if (st.phase !== 'deciding') throw new Error(st.phase)
    expect(st.messages.map((m) => m.id)).toEqual(long.map((m) => m.id))
    expect(st.questions.map((q) => q.question.content)).toEqual(['old attached'])
    expect(s.calls).toHaveLength(3)
  })

  it('sends nothing until every attached question is decided, then exactly the decisions', async () => {
    const s = setup(thread)
    await s.flow.begin('t')
    expect(await s.flow.confirm()).toBe(false)
    expect(s.shareCalls()).toHaveLength(0)
    expect(s.flow.decide(q1.id, 'include')).toBe(false)
    expect(s.flow.setExcluded(q2.id, true)).toBe(false)
    expect(s.flow.setExcluded(q3.id, true)).toBe(true)
    expect(s.flow.decide(q2.id, 'include')).toBe(true)
    expect(s.flow.preview().map((m) => m.id)).toEqual([q1.id, a1.id, q2.id, a2.id, a2b.id])
    expect(await s.flow.confirm()).toBe(true)
    expect(s.shareCalls()[0]?.input.body).toEqual({
      includeAttachedMessageIds: [q2.id],
      excludeMessageIds: [q3.id],
    })
    expect(s.landed).toEqual([s.copy])
    expect(s.flow.store.getState()).toMatchObject({ phase: 'done', thread: s.copy })
  })

  it('refuses to send an empty share, and a thread that is not a private thread of the member', async () => {
    const s = setup([q2, a2])
    await s.flow.begin('t')
    s.flow.decide(q2.id, 'exclude')
    expect(s.flow.store.getState()).toMatchObject({ phase: 'deciding', ready: false })
    expect(await s.flow.confirm()).toBe(false)
    expect(s.flow.store.getState()).toMatchObject({ failure: { kind: 'nothing-to-share' } })
    expect(s.shareCalls()).toHaveLength(0)

    const other = setup(thread, { visibility: 'space' })
    await other.flow.begin('t')
    expect(other.flow.store.getState()).toMatchObject({ failure: { kind: 'not-private' } })
    expect(other.calls).toHaveLength(0)
  })
})
