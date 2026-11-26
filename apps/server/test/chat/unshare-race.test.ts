import { MockProvider } from '@tiger/llm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spaceWithMembers } from '../helpers/fixtures'
import { connectAs } from '../helpers/harness'
import { type ChatHarness, ScriptedProvider, shareSettled, startChatHarness } from './helpers'

/** Invariant 3: an item unshared while an answer streams leaves no quote of it behind. */
let c: ChatHarness
let port: number
beforeAll(async () => {
  c = await startChatHarness({
    provider: new ScriptedProvider(new MockProvider({ chunkDelayMs: 25, chunkSize: 2 })),
    env: { CHAT_THREAD_TITLES: '0' },
  })
  port = await c.h.listen()
})
afterAll(() => c.h.close())

describe('unshare during a streaming answer', () => {
  it('a stopped answer keeps no quote of an item unshared while it streamed', async () => {
    const { h } = c
    const { owner, space } = await spaceWithMembers(h, 'UnshareStop')
    const secret = '極秘の買収計画はA社を三月に買収することです。'
    const item = await shareSettled(
      h,
      owner.token,
      space.id,
      'https://example.com/secret',
      'Secret',
      `${secret}\n\nその他の詳細は後日共有します。`,
    )
    const thread = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      owner.token,
    )
    const ws = await connectAs(port, owner.token, [space.id])
    const posted = await h.ok(
      'postMessage',
      { params: { threadId: thread.id }, body: { content: '買収計画は?', askAi: true } },
      owner.token,
    )
    const messageId = posted.assistantMessage?.id
    if (!messageId) throw new Error('no assistant message')
    const sources = await ws.next('message.sources', (e) => e.messageId === messageId)
    expect(sources.citations[0]?.quote).toContain('極秘')
    await ws.next('message.delta', (e) => e.messageId === messageId)

    await h.ok('unshareItem', { params: { itemId: item.id } }, owner.token)
    await h.ok('abortMessage', { params: { messageId } }, owner.token)
    await h.settle()

    const [stored] = await h.sql<{ status: string; citations: { quote: string }[] }[]>`
      select status, citations from messages where id = ${messageId}
    `
    expect(stored?.status).toBe('error')
    expect(JSON.stringify(stored?.citations)).not.toContain('極秘')
    for (const cit of stored?.citations ?? []) expect(cit.quote).toBe('')
    ws.close()
  })
})

describe('token budget under concurrent questions', () => {
  it('questions asked together cannot all pass the budget check', async () => {
    const b = await startChatHarness({ env: { CHAT_THREAD_TITLES: '0' } })
    try {
      const { h } = b
      const { owner, space } = await spaceWithMembers(h, 'Budget')
      await h.sql`update spaces set token_budget = 100 where id = ${space.id}`
      await shareSettled(h, owner.token, space.id, 'https://example.com/b', 'B', '# B\n\nSome facts.')
      const thread = await h.ok(
        'createThread',
        { params: { spaceId: space.id }, body: { visibility: 'space' } },
        owner.token,
      )
      const posts = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          h.call(
            'postMessage',
            { params: { threadId: thread.id }, body: { content: `question ${i}?`, askAi: true } },
            owner.token,
          ),
        ),
      )
      await h.settle()
      const ids = posts.flatMap((p) =>
        p.status === 200 && 'assistantMessage' in p.body && p.body.assistantMessage
          ? [p.body.assistantMessage.id]
          : [],
      )
      const rows = await h.sql<{ status: string; error_code: string | null }[]>`
        select status, error_code from messages where id = any(${ids}::uuid[])
      `
      expect(rows.filter((r) => r.status === 'complete')).toHaveLength(1)
      expect(rows.filter((r) => r.error_code === 'budget_exceeded').length).toBe(rows.length - 1)
      const [left] = await h.sql<{ n: number }[]>`select count(*)::int as n from llm_reservations`
      expect(left?.n).toBe(0)
    } finally {
      await b.h.close()
    }
  })
})
