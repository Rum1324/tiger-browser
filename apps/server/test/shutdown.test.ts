import { expect, it } from 'vitest'
import { createSql } from '../src/db/sql'
import type { Answerer, ModelDirectory } from '../src/seams'
import { TEST_DATABASE_URL } from './helpers/db'
import { spaceWithMembers } from './helpers/fixtures'
import { connectAs, connectWs, startHarness } from './helpers/harness'

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

/** Streams one delta, then holds until aborted, as a provider stream does. */
let streamed: () => void = () => {}
const holding: Answerer = {
  answer(input) {
    return new Promise((_resolve, reject) => {
      input.signal.addEventListener('abort', () => reject(new Error('provider stream closed')))
      input.emit({ type: 'delta', text: 'Half an answer' })
      streamed()
    })
  },
}

const GRACE_MS = 1500

/** A transaction that holds a thread row FOR UPDATE until released; a post to it blocks meanwhile. */
function lockThread(sql: ReturnType<typeof createSql>, threadId: string) {
  let release!: () => void
  let locked!: () => void
  const isLocked = new Promise<void>((r) => {
    locked = r
  })
  const held = new Promise<void>((r) => {
    release = r
  })
  const done = sql.begin(async (tx) => {
    await tx`select id from threads where id = ${threadId} for update`
    locked()
    await held
  })
  return { isLocked, release, done }
}

it('close finishes within the grace period with a request in flight, open sockets and a streaming answer', async () => {
  const h = await startHarness({ answerer: holding, models, shutdownGraceMs: GRACE_MS })
  const locks = createSql(TEST_DATABASE_URL, { max: 2, searchPath: `${h.db.schema}, public` })
  try {
    const port = await h.listen()
    const base = `http://127.0.0.1:${port}`
    const { owner, space } = await spaceWithMembers(h, 'Down')
    const auth = { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }
    const newThread = () =>
      h.ok(
        'createThread',
        { params: { spaceId: space.id }, body: { visibility: 'space' } },
        owner.token,
      )
    const [answering, slow, stuck] = [await newThread(), await newThread(), await newThread()]

    // An authenticated, subscribed socket, and one that never authenticated.
    const ws = await connectAs(port, owner.token, [space.id])
    const anonymous = await connectWs(port)

    // An idle keep-alive connection: one finished request over fetch's pooled agent.
    expect((await fetch(`${base}/v1/me`, { headers: auth })).status).toBe(200)

    // A streaming answer.
    const started = new Promise<void>((r) => {
      streamed = r
    })
    const posted = await h.ok(
      'postMessage',
      { params: { threadId: answering.id }, body: { content: 'go', askAi: true } },
      owner.token,
    )
    const assistantId = posted.assistantMessage?.id as string
    await started
    await ws.next('message.delta', (e) => e.messageId === assistantId)

    // Two requests in flight, blocked on row locks: one is released within the grace period and
    // must complete, the other is still blocked at the deadline and must be cut.
    const slowLock = lockThread(locks, slow.id)
    const stuckLock = lockThread(locks, stuck.id)
    await Promise.all([slowLock.isLocked, stuckLock.isLocked])
    const post = (threadId: string, content: string) =>
      fetch(`${base}/v1/threads/${threadId}/messages`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ content, askAi: false }),
      })
    const slowReq = post(slow.id, 'finishes during shutdown')
    const stuckReq = post(stuck.id, 'never finishes in time').then(
      (r) => `status ${r.status}`,
      (e: unknown) => `failed: ${String(e)}`,
    )
    await new Promise((r) => setTimeout(r, 150)) // both are now waiting inside their handlers

    const t0 = Date.now()
    const closing = h.app.close()
    setTimeout(() => slowLock.release(), 200)
    // A new request after close began is refused, not left hanging.
    const late = await fetch(`${base}/v1/me`, { headers: auth }).then(
      (r) => r.status,
      () => 'refused',
    )
    await closing
    const elapsed = Date.now() - t0

    expect(elapsed).toBeLessThan(GRACE_MS + 1000)
    expect([503, 'refused']).toContain(late)

    // The released request completed normally and was told the connection closes.
    const slowRes = await slowReq
    expect(slowRes.status).toBe(200)
    expect(slowRes.headers.get('connection')).toBe('close')
    // The one still blocked at the deadline was cut.
    expect(await stuckReq).toMatch(/^failed/)

    // The streaming answer was aborted, its message settled with the text members saw, and the
    // subscriber heard it before the close frame.
    const failed = await ws.next('message.failed', (e) => e.messageId === assistantId)
    expect(failed.code).toBe('ai_aborted')
    expect(await ws.closed).toEqual({ code: 1001, reason: 'server shutting down' })
    expect((await anonymous.closed).code).toBe(1001)
    const [row] = await h.sql<{ status: string; error_code: string; content: string }[]>`
      select status, error_code, content from messages where id = ${assistantId}
    `
    expect(row).toEqual({ status: 'error', error_code: 'ai_aborted', content: 'Half an answer' })
    expect(h.app.tiger.runningAnswers.size).toBe(0)
    expect(h.app.tiger.hub.clientCount).toBe(0)
    expect(h.app.websocketServer.clients.size).toBe(0)

    // Let the cut request's handler run to its end before the schema goes.
    stuckLock.release()
    await Promise.all([slowLock.done, stuckLock.done])
    for (let i = 0; i < 100; i++) {
      const [m] = await h.sql`select 1 from messages where thread_id = ${stuck.id}`
      if (m) break
      await new Promise((r) => setTimeout(r, 20))
    }
  } finally {
    await locks.end({ timeout: 5 })
    await h.db.drop()
  }
})

it('close returns at once when nothing is open', async () => {
  const h = await startHarness({ shutdownGraceMs: GRACE_MS })
  try {
    await h.listen()
    const t0 = Date.now()
    await h.app.close()
    expect(Date.now() - t0).toBeLessThan(300)
  } finally {
    await h.db.drop()
  }
})

/** A provider that streams one delta and then ignores the abort signal: it settles late, or never. */
function deaf(settleAfterMs: number | null): { answerer: Answerer; streamed: Promise<void> } {
  let onStreamed!: () => void
  const streamedOnce = new Promise<void>((r) => {
    onStreamed = r
  })
  return {
    streamed: streamedOnce,
    answerer: {
      answer(input) {
        input.emit({ type: 'delta', text: 'partial' })
        onStreamed()
        return new Promise((resolve) => {
          if (settleAfterMs === null) return
          setTimeout(
            () =>
              resolve({
                content: 'partial and the rest',
                citations: [],
                usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
              }),
            settleAfterMs,
          )
        })
      },
    },
  }
}

for (const [name, settleAfterMs] of [
  ['settles late', 1500],
  ['never settles', null],
] as const) {
  it(`close settles an answer whose provider ignores the abort and ${name}`, async () => {
    const grace = 300
    const provider = deaf(settleAfterMs)
    const h = await startHarness({ answerer: provider.answerer, models, shutdownGraceMs: grace })
    try {
      const port = await h.listen()
      const { owner, space } = await spaceWithMembers(h, 'Deaf')
      const thread = await h.ok(
        'createThread',
        { params: { spaceId: space.id }, body: { visibility: 'space' } },
        owner.token,
      )
      const ws = await connectAs(port, owner.token, [space.id])
      const posted = await h.ok(
        'postMessage',
        { params: { threadId: thread.id }, body: { content: 'go', askAi: true } },
        owner.token,
      )
      const assistantId = posted.assistantMessage?.id as string
      await provider.streamed
      await ws.next('message.delta', (e) => e.messageId === assistantId)

      const t0 = Date.now()
      await h.app.close()
      expect(Date.now() - t0).toBeLessThan(grace + 1000)

      // Settled by the time close returned: the text members saw, stored as ai_aborted.
      const read = async () =>
        (
          await h.sql<{ status: string; error_code: string | null; content: string }[]>`
            select status, error_code, content from messages where id = ${assistantId}
          `
        )[0]
      expect(await read()).toEqual({
        status: 'error',
        error_code: 'ai_aborted',
        content: 'partial',
      })
      expect(h.app.tiger.runningAnswers.size).toBe(0)
      const failed = await ws.next('message.failed', (e) => e.messageId === assistantId)
      expect(failed.code).toBe('ai_aborted')

      // A provider that settles after close cannot overwrite the stored state.
      if (settleAfterMs !== null) await new Promise((r) => setTimeout(r, settleAfterMs))
      expect(await read()).toEqual({
        status: 'error',
        error_code: 'ai_aborted',
        content: 'partial',
      })
    } finally {
      await h.db.drop()
    }
  })
}
