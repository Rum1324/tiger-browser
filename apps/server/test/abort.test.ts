import type { Item } from '@tiger/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Answerer, AnswerInput, ModelDirectory } from '../src/seams'
import { spaceWithMembers } from './helpers/fixtures'
import { connectAs, type Harness, page, startHarness } from './helpers/harness'

const models: ModelDirectory = {
  async list() {
    return {
      models: [
        {
          provider: 'mock',
          id: 'mock-1',
          label: 'Mock',
          tier: 'fast',
          contextWindow: 100_000,
          available: true,
        },
      ],
      defaultModel: { provider: 'mock', id: 'mock-1' },
    }
  },
}

/**
 * An answer that streams "Hello " and "world" (plus one source when the question names an item id),
 * then holds until it is released (it finishes with "!") or aborted (it rejects, as providers do).
 */
interface Held {
  input: AnswerInput
  streamed: Promise<void>
  release(): void
  sawAbort: boolean
}
const held = new Map<string, Held>()
let lastItem: Item | null = null

const holdingAnswerer: Answerer = {
  answer(input) {
    let release!: () => void
    let streamed!: () => void
    const h: Held = {
      input,
      streamed: new Promise<void>((r) => {
        streamed = r
      }),
      release: () => release(),
      sawAbort: false,
    }
    held.set(input.message.content, h)
    return new Promise((resolve, reject) => {
      input.signal.addEventListener('abort', () => {
        h.sawAbort = true
        // A late delta after the stop must not reach anyone.
        input.emit({ type: 'delta', text: ' LATE' })
        reject(new Error('provider stream closed'))
      })
      release = () => {
        input.emit({ type: 'delta', text: '!' })
        resolve({
          content: 'Hello world!',
          citations: [],
          usage: { inputTokens: 10, outputTokens: 3, cachedInputTokens: 0 },
        })
      }
      input.emit({ type: 'delta', text: 'Hello ' })
      if (lastItem && input.message.content.includes('cite')) {
        input.emit({
          type: 'sources',
          citations: [
            {
              n: 1,
              itemId: lastItem.id,
              itemVersionId: lastItem.currentVersion.id,
              title: lastItem.title,
              url: lastItem.url,
              sourceType: lastItem.sourceType,
              sharedBy: lastItem.sharedBy,
              sharedAt: lastItem.sharedAt,
              quote: 'q',
            },
          ],
        })
      }
      input.emit({ type: 'delta', text: 'world' })
      // Let the sources settle (they are validated asynchronously) before the test looks.
      setTimeout(streamed, 50)
    })
  },
}

let h: Harness
let port: number
beforeAll(async () => {
  h = await startHarness({ answerer: holdingAnswerer, models })
  port = await h.listen()
})
afterAll(() => h.close())

async function startHeld(token: string, threadId: string, content: string) {
  const posted = await h.ok(
    'postMessage',
    { params: { threadId }, body: { content, askAi: true } },
    token,
  )
  const assistantId = posted.assistantMessage?.id
  if (!assistantId) throw new Error('no assistant message')
  const entry = await waitForHeld(content)
  await entry.streamed
  return { assistantId, entry }
}

async function waitForHeld(content: string): Promise<Held> {
  for (let i = 0; i < 200; i++) {
    const e = held.get(content)
    if (e) return e
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`answer for ${content} never started`)
}

async function storedRow(messageId: string) {
  const [row] = await h.sql<{ status: string; error_code: string | null; content: string }[]>`
    select status, error_code, content from messages where id = ${messageId}
  `
  return row
}

describe('listMessages while an answer streams', () => {
  it('serves the text and sources so far from memory; the database is written only at the end', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'Live')
    const shared = await h.ok(
      'shareItem',
      { params: { spaceId: space.id }, body: { page: page('https://example.com/live', 'body') } },
      owner.token,
    )
    lastItem = shared.item
    const thread = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      owner.token,
    )
    const { assistantId, entry } = await startHeld(owner.token, thread.id, 'live cite')

    // Another member who lost the deltas repairs from REST.
    const during = await h.ok('listMessages', { params: { threadId: thread.id } }, member.token)
    const streaming = during.find((m) => m.id === assistantId)
    // Two deltas ("Hello ", "world") are in the text: the next one a client applies is seq 2.
    expect(streaming).toMatchObject({
      status: 'streaming',
      content: 'Hello world',
      errorCode: null,
      streamSeq: 2,
    })
    expect(streaming?.citations).toEqual([
      expect.objectContaining({ n: 1, itemId: shared.item.id, available: true }),
    ])
    // Nothing was written per delta.
    expect(await storedRow(assistantId)).toEqual({
      status: 'streaming',
      error_code: null,
      content: '',
    })

    entry.release()
    await h.settle()
    const after = await h.ok('listMessages', { params: { threadId: thread.id } }, member.token)
    expect(after.find((m) => m.id === assistantId)).toMatchObject({
      status: 'complete',
      content: 'Hello world!',
      streamSeq: null,
    })
    expect(h.app.tiger.runningAnswers.size).toBe(0)
  })
})

describe('abortMessage', () => {
  it('lets the asker stop an answer: every subscriber gets ai_aborted and the partial text is kept', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'Stop')
    const thread = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      member.token,
    )
    const wsOwner = await connectAs(port, owner.token, [space.id])
    const wsMember = await connectAs(port, member.token, [space.id])
    const { assistantId, entry } = await startHeld(member.token, thread.id, 'stop me')

    await h.ok('abortMessage', { params: { messageId: assistantId } }, member.token)
    expect(entry.sawAbort).toBe(true)
    // By the time the call returns, the final state is stored.
    expect(await storedRow(assistantId)).toEqual({
      status: 'error',
      error_code: 'ai_aborted',
      content: 'Hello world',
    })

    for (const ws of [wsOwner, wsMember]) {
      const failed = await ws.next('message.failed', (e) => e.messageId === assistantId)
      expect(failed).toMatchObject({ code: 'ai_aborted', threadId: thread.id, spaceId: space.id })
      await ws.sync()
      const deltas = ws.events.filter(
        (e) => e.type === 'message.delta' && e.messageId === assistantId,
      )
      expect(deltas.map((e) => (e.type === 'message.delta' ? e.text : '')).join('')).toBe(
        'Hello world',
      )
      expect(
        ws.events.some((e) => e.type === 'message.completed' && e.message.id === assistantId),
      ).toBe(false)
      ws.close()
    }

    const listed = await h.ok('listMessages', { params: { threadId: thread.id } }, owner.token)
    expect(listed.find((m) => m.id === assistantId)).toMatchObject({
      status: 'error',
      errorCode: 'ai_aborted',
      content: 'Hello world',
    })
    expect(h.app.tiger.runningAnswers.size).toBe(0)

    // Stopping it again is a no-op.
    await h.ok('abortMessage', { params: { messageId: assistantId } }, member.token)
    expect((await storedRow(assistantId))?.error_code).toBe('ai_aborted')
  })

  it('lets a Space owner stop another member’s answer', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'OwnerStop')
    const thread = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      member.token,
    )
    const { assistantId } = await startHeld(member.token, thread.id, 'owner stops')
    await h.ok('abortMessage', { params: { messageId: assistantId } }, owner.token)
    expect(await storedRow(assistantId)).toMatchObject({
      status: 'error',
      error_code: 'ai_aborted',
    })
  })

  it('refuses other members (403) and anyone who cannot see the thread (404)', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'NoStop')
    const third = await h.login('NoStopThird')
    const { token } = await h.ok(
      'createInvite',
      { params: { spaceId: space.id }, body: {} },
      owner.token,
    )
    await h.ok('acceptInvite', { body: { token } }, third.token)
    const stranger = await h.login('NoStopStranger')

    const spaceThread = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      member.token,
    )
    const a = await startHeld(member.token, spaceThread.id, 'not yours')
    await h.fails(
      'abortMessage',
      { params: { messageId: a.assistantId } },
      third.token,
      403,
      'forbidden',
    )
    await h.fails(
      'abortMessage',
      { params: { messageId: a.assistantId } },
      stranger.token,
      404,
      'not_found',
    )

    // A private thread is invisible even to a Space owner: 404, exactly like an unknown id.
    const privateThread = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'private' } },
      member.token,
    )
    const b = await startHeld(member.token, privateThread.id, 'private one')
    await h.fails(
      'abortMessage',
      { params: { messageId: b.assistantId } },
      owner.token,
      404,
      'not_found',
    )
    await h.fails(
      'abortMessage',
      { params: { messageId: '01900000-0000-7000-8000-000000000000' } },
      member.token,
      404,
      'not_found',
    )

    // The refused answers kept streaming and finish normally.
    expect(a.entry.sawAbort).toBe(false)
    expect(b.entry.sawAbort).toBe(false)
    a.entry.release()
    b.entry.release()
    await h.settle()
    expect(await storedRow(a.assistantId)).toMatchObject({ status: 'complete' })
    expect(await storedRow(b.assistantId)).toMatchObject({ status: 'complete' })
  })

  it('is a no-op on a finished answer and on a user message', async () => {
    const { owner, space } = await spaceWithMembers(h, 'Done')
    const thread = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      owner.token,
    )
    const { assistantId, entry } = await startHeld(owner.token, thread.id, 'finish first')
    entry.release()
    await h.settle()
    await h.ok('abortMessage', { params: { messageId: assistantId } }, owner.token)
    expect(await storedRow(assistantId)).toEqual({
      status: 'complete',
      error_code: null,
      content: 'Hello world!',
    })
    const plain = await h.ok(
      'postMessage',
      { params: { threadId: thread.id }, body: { content: 'just text', askAi: false } },
      owner.token,
    )
    await h.ok('abortMessage', { params: { messageId: plain.message.id } }, owner.token)
    expect((await storedRow(plain.message.id))?.status).toBe('complete')
  })

  it('settles a streaming row that no running answer owns (lost to a restart)', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'Stale')
    const thread = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      owner.token,
    )
    const ws = await connectAs(port, member.token, [space.id])
    const { assistantId, entry } = await startHeld(owner.token, thread.id, 'orphan')
    // Simulate a restart: the answer is gone from memory, the row still says streaming.
    entry.release()
    await h.settle()
    await h.sql`update messages set status = 'streaming', content = '' where id = ${assistantId}`
    expect(h.app.tiger.runningAnswers.has(assistantId)).toBe(false)

    await h.ok('abortMessage', { params: { messageId: assistantId } }, owner.token)
    expect(await storedRow(assistantId)).toEqual({
      status: 'error',
      error_code: 'ai_aborted',
      content: '',
    })
    expect(await ws.next('message.failed', (e) => e.messageId === assistantId)).toMatchObject({
      code: 'ai_aborted',
    })
    ws.close()
  })
})
