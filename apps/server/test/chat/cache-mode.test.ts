import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spaceWithMembers } from '../helpers/fixtures'
import { ask, type ChatHarness, isTitleRequest, shareSettled, startChatHarness } from './helpers'

/** Retrieval-mode context differs per question; marking it cacheable only buys cache-write premiums. */
let whole: ChatHarness
let retrieval: ChatHarness
beforeAll(async () => {
  whole = await startChatHarness({ env: { CHAT_THREAD_TITLES: '0' } })
  const before = process.env.RETRIEVAL_WHOLE_SPACE_MAX_TOKENS
  process.env.RETRIEVAL_WHOLE_SPACE_MAX_TOKENS = '0'
  try {
    retrieval = await startChatHarness({ env: { CHAT_THREAD_TITLES: '0' } })
  } finally {
    if (before === undefined) delete process.env.RETRIEVAL_WHOLE_SPACE_MAX_TOKENS
    else process.env.RETRIEVAL_WHOLE_SPACE_MAX_TOKENS = before
  }
})
afterAll(async () => {
  await whole.h.close()
  await retrieval.h.close()
})

async function lastRequest(c: ChatHarness) {
  const { h } = c
  const { owner, space } = await spaceWithMembers(h, 'Cache')
  await shareSettled(h, owner.token, space.id, 'https://example.com/c', 'C', '# C\n\nThe launch is in May.')
  const thread = await h.ok(
    'createThread',
    { params: { spaceId: space.id }, body: { visibility: 'space' } },
    owner.token,
  )
  await ask(h, owner.token, thread.id, 'When is the launch?')
  const trace = c.traces.at(-1)
  const req = c.provider.requests.filter((r) => !isTitleRequest(r)).at(-1)
  return { trace, req }
}

describe('context cache breakpoint', () => {
  it('asks for a cached context only in whole-space mode', async () => {
    const w = await lastRequest(whole)
    expect(w.trace?.context.mode).toBe('whole-space')
    expect(w.req?.context).toContain('launch')
    expect(w.req?.cacheContext).toBe(true)

    const r = await lastRequest(retrieval)
    expect(r.trace?.context.mode).toBe('retrieval')
    expect(r.req?.context).toContain('launch')
    expect(r.req?.cacheContext).toBe(false)
  })
})
