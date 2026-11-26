import { MockProvider } from '@tiger/llm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spaceWithMembers } from '../helpers/fixtures'
import { connectAs } from '../helpers/harness'
import { type ChatHarness, ScriptedProvider, shareSettled, startChatHarness } from './helpers'

/** The real chat layer (Answerer, router, mock provider) streaming slowly enough to be stopped. */
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

describe('abortMessage through the real Answerer', () => {
  it('stops the provider stream; every subscriber gets ai_aborted and the stored text is what they saw', async () => {
    const { h } = c
    const { owner, member, space } = await spaceWithMembers(h, 'RealStop')
    await shareSettled(
      h,
      owner.token,
      space.id,
      'https://example.com/plan',
      'Plan',
      '# Plan\n\nThe 2027 revenue target is 4.8 billion yen across all regions.',
    )
    const thread = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      member.token,
    )
    const subscribers = [
      await connectAs(port, owner.token, [space.id]),
      await connectAs(port, member.token, [space.id]),
      await connectAs(port, member.token, [space.id]),
    ]
    const posted = await h.ok(
      'postMessage',
      {
        params: { threadId: thread.id },
        body: { content: 'What is the revenue target?', askAi: true },
      },
      member.token,
    )
    const messageId = posted.assistantMessage?.id
    if (!messageId) throw new Error('no assistant message')
    const watcher = subscribers[0]
    if (!watcher) throw new Error('no subscriber')
    // Let a few deltas through, then stop.
    await watcher.next('message.delta', (e) => e.messageId === messageId && e.seq >= 3)

    const mid = await h.ok('listMessages', { params: { threadId: thread.id } }, owner.token)
    const streaming = mid.find((m) => m.id === messageId)
    expect(streaming?.status).toBe('streaming')
    expect(streaming?.content.length).toBeGreaterThan(0)

    await h.ok('abortMessage', { params: { messageId } }, member.token)
    const providerRequests = c.provider.requests.length

    const [stored] = await h.sql<{ status: string; error_code: string; content: string }[]>`
      select status, error_code, content from messages where id = ${messageId}
    `
    expect(stored?.status).toBe('error')
    expect(stored?.error_code).toBe('ai_aborted')
    expect(stored?.content.length).toBeGreaterThan(0)
    expect(stored?.content.startsWith(streaming?.content ?? '\u0000')).toBe(true)

    // Wait out what the rest of the stream would have taken: nothing more arrives.
    await new Promise((r) => setTimeout(r, 400))
    await h.settle()
    for (const ws of subscribers) {
      const failed = await ws.next('message.failed', (e) => e.messageId === messageId)
      expect(failed).toMatchObject({ code: 'ai_aborted', spaceId: space.id, threadId: thread.id })
      await ws.sync()
      const mine = ws.events.filter(
        (e) =>
          (e.type === 'message.delta' || e.type === 'message.failed') && e.messageId === messageId,
      )
      // Deltas then exactly one failure, nothing after it.
      expect(mine.filter((e) => e.type === 'message.failed')).toHaveLength(1)
      expect(mine.at(-1)?.type).toBe('message.failed')
      const text = mine.map((e) => (e.type === 'message.delta' ? e.text : '')).join('')
      expect(text).toBe(stored?.content)
      const seqs = mine.flatMap((e) => (e.type === 'message.delta' ? [e.seq] : []))
      expect(seqs).toEqual(seqs.map((_, i) => i))
      expect(
        ws.events.some((e) => e.type === 'message.completed' && e.message.id === messageId),
      ).toBe(false)
      ws.close()
    }

    const listed = await h.ok('listMessages', { params: { threadId: thread.id } }, owner.token)
    expect(listed.find((m) => m.id === messageId)).toMatchObject({
      status: 'error',
      errorCode: 'ai_aborted',
      content: stored?.content,
    })
    expect(c.provider.requests.length).toBe(providerRequests)
    expect(h.app.tiger.runningAnswers.size).toBe(0)

    // Asked again in a fresh thread, the same question is answered in full, and the stopped text
    // is a strict prefix of that answer: the stop really cut the stream short.
    const fresh = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      member.token,
    )
    const again = await h.ok(
      'postMessage',
      {
        params: { threadId: fresh.id },
        body: { content: 'What is the revenue target?', askAi: true },
      },
      member.token,
    )
    await h.settle()
    const full = (
      await h.ok('listMessages', { params: { threadId: fresh.id } }, member.token)
    ).find((m) => m.id === again.assistantMessage?.id)
    expect(full?.status).toBe('complete')
    expect(full?.content.startsWith(stored?.content ?? '\u0000')).toBe(true)
    expect(stored?.content.length).toBeLessThan(full?.content.length ?? 0)
  })
})
