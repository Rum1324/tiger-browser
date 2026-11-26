import type { Item, ServerEvent } from '@tiger/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newId } from '../src/ids'
import {
  AnswerError,
  type Answerer,
  type AnswerInput,
  type CitationInput,
  type ModelDirectory,
} from '../src/seams'
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
        {
          provider: 'openai',
          id: 'gpt-x',
          label: 'GPT',
          tier: 'best',
          contextWindow: 100_000,
          available: false,
        },
      ],
      defaultModel: { provider: 'mock', id: 'mock-1' },
    }
  },
}

const citationOf = (n: number, item: Item, quote: string): CitationInput => ({
  n,
  itemId: item.id,
  itemVersionId: item.currentVersion.id,
  title: item.title,
  url: item.url,
  sourceType: item.sourceType,
  sharedBy: item.sharedBy,
  sharedAt: item.sharedAt,
  quote,
})

/** Behaviour per test, keyed by the asking message's content. */
type Script = (input: AnswerInput) => Promise<{ content: string; citations: CitationInput[] }>
const scripts = new Map<string, Script>()
const calls: AnswerInput[] = []
const fakeAnswerer: Answerer = {
  async answer(input) {
    calls.push(input)
    const script = scripts.get(input.message.content)
    if (!script) throw new Error(`no script for ${input.message.content}`)
    const { content, citations } = await script(input)
    return {
      content,
      citations,
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        cachedInputTokens: 100,
        cacheWriteTokens: 5,
        costUsd: 0.0012,
      },
    }
  },
}

let h: Harness
let port: number
beforeAll(async () => {
  h = await startHarness({ answerer: fakeAnswerer, models })
  port = await h.listen()
})
afterAll(() => h.close())

const eventsFor = (events: ServerEvent[], threadId: string) =>
  events.filter((e) => {
    if ('threadId' in e) return e.threadId === threadId
    if ('message' in e && typeof e.message === 'object') return e.message.threadId === threadId
    if ('thread' in e) return e.thread.id === threadId
    return false
  })

describe('askAi pipeline', () => {
  it('streams deltas and sources to members, then persists content, citations and usage', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'Ai')
    const other = await spaceWithMembers(h, 'AiOther')
    const item = (
      await h.ok(
        'shareItem',
        {
          params: { spaceId: space.id },
          body: { page: page('https://example.com/q3', 'Q3 revenue rose 12%', 'Q3 report') },
        },
        owner.token,
      )
    ).item
    const foreign = (
      await h.ok(
        'shareItem',
        { params: { spaceId: other.space.id }, body: { page: page('https://example.com/x', 'x') } },
        other.owner.token,
      )
    ).item
    await h.settle()
    const thread = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      owner.token,
    )
    await h.ok(
      'postMessage',
      { params: { threadId: thread.id }, body: { content: 'earlier note', askAi: false } },
      member.token,
    )
    const memberWs = await connectAs(port, member.token, [space.id])

    scripts.set('How did Q3 go?', async ({ emit }) => {
      emit({
        type: 'sources',
        citations: [citationOf(1, item, 'Q3 revenue rose 12%'), citationOf(2, foreign, 'leak')],
      })
      for (const text of ['Revenue ', 'rose 12% ', '[1].']) emit({ type: 'delta', text })
      return {
        content: 'Revenue rose 12% [1].',
        citations: [citationOf(1, item, 'Q3 revenue rose 12%'), citationOf(2, foreign, 'leak')],
      }
    })
    const r = await h.ok(
      'postMessage',
      { params: { threadId: thread.id }, body: { content: 'How did Q3 go?', askAi: true } },
      owner.token,
    )
    expect(r.assistantMessage).toMatchObject({
      role: 'assistant',
      status: 'streaming',
      content: '',
      author: { id: owner.user.id },
      model: { provider: 'mock', id: 'mock-1' },
    })
    const assistantId = r.assistantMessage?.id

    const completed = await memberWs.next('message.completed')
    expect(completed.message).toMatchObject({
      id: assistantId,
      status: 'complete',
      content: 'Revenue rose 12% [1].',
    })
    expect(completed.message.citations).toEqual([
      { ...citationOf(1, item, 'Q3 revenue rose 12%'), available: true },
    ])
    expect(completed.usage).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      cachedInputTokens: 100,
      cacheWriteTokens: 5,
    })

    const stream = eventsFor(memberWs.events, thread.id)
    // Sources are validated asynchronously, so they may land between deltas, but always before completion.
    const types = stream.map((e) => e.type)
    expect(types.slice(0, 2)).toEqual(['message.created', 'message.created'])
    expect(types.at(-1)).toBe('message.completed')
    expect([...types].sort()).toEqual(
      [
        'message.completed',
        'message.created',
        'message.created',
        'message.delta',
        'message.delta',
        'message.delta',
        'message.sources',
      ].sort(),
    )
    const deltas = stream.filter((e) => e.type === 'message.delta')
    expect(deltas.map((d) => [d.seq, d.text])).toEqual([
      [0, 'Revenue '],
      [1, 'rose 12% '],
      [2, '[1].'],
    ])
    const sources = stream.find((e) => e.type === 'message.sources')
    expect(
      sources && sources.type === 'message.sources' && sources.citations.map((c) => c.itemId),
    ).toEqual([item.id])
    const created = stream.filter((e) => e.type === 'message.created')
    expect(created.map((e) => e.type === 'message.created' && e.message.role)).toEqual([
      'user',
      'assistant',
    ])

    // What the Answerer was given.
    const input = calls.at(-1)
    expect(input).toMatchObject({
      spaceId: space.id,
      user: { id: owner.user.id, email: owner.user.email },
      model: { provider: 'mock', id: 'mock-1' },
      assistantMessageId: assistantId,
      attachments: [],
      thread: { id: thread.id, visibility: 'space' },
      message: { content: 'How did Q3 go?' },
    })
    expect(input?.history.map((m) => m.content)).toEqual(['earlier note'])
    expect(input?.signal.aborted).toBe(false)

    // Persisted state.
    const [stored] = await h.ok(
      'listMessages',
      { params: { threadId: thread.id }, query: { limit: 1 } },
      member.token,
    )
    expect(stored).toMatchObject({
      id: assistantId,
      status: 'complete',
      content: 'Revenue rose 12% [1].',
      usage: completed.usage,
      errorCode: null,
    })
    expect(stored?.citations.map((c) => c.itemId)).toEqual([item.id])
    const usageRows = await h.sql<
      {
        provider: string
        model: string
        input_tokens: string
        cache_write_tokens: string
        cost_usd: string
        user_id: string
      }[]
    >`
      select provider, model, input_tokens::text, cache_write_tokens::text, cost_usd::text, user_id from llm_usage where message_id = ${assistantId ?? ''}
    `
    expect(usageRows).toEqual([
      {
        provider: 'mock',
        model: 'mock-1',
        input_tokens: '120',
        cache_write_tokens: '5',
        cost_usd: '0.001200',
        user_id: owner.user.id,
      },
    ])
    const usage = await h.ok('getUsage', { params: { spaceId: space.id } }, member.token)
    expect(usage).toMatchObject({
      spaceId: space.id,
      inputTokens: 120,
      outputTokens: 30,
      budgetTokens: null,
    })
    expect(new Date(usage.periodStart).getUTCDate()).toBe(1)
    memberWs.close()
  })

  it('gives a private thread’s answer and attachments to its owner only', async () => {
    const { owner, member, space } = await spaceWithMembers(h, 'AiPriv')
    const ownerWs = await connectAs(port, owner.token, [space.id])
    const memberWs = await connectAs(port, member.token, [space.id])
    const thread = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'private' } },
      owner.token,
    )
    scripts.set('Summarise this page', async ({ emit, attachments }) => {
      emit({ type: 'delta', text: `About ${attachments[0]?.title}` })
      return { content: `About ${attachments[0]?.title}`, citations: [] }
    })
    await h.ok(
      'postMessage',
      {
        params: { threadId: thread.id },
        body: {
          content: 'Summarise this page',
          askAi: true,
          attachments: [page('https://example.com/doc', 'page body', 'Doc')],
        },
      },
      owner.token,
    )
    const done = await ownerWs.next('message.completed')
    expect(done.message.content).toBe('About Doc')
    expect(calls.at(-1)?.attachments).toEqual([
      {
        url: 'https://example.com/doc',
        title: 'Doc',
        sourceType: 'web',
        markdown: 'page body',
        charCount: 9,
      },
    ])
    expect(eventsFor(ownerWs.events, thread.id).map((e) => e.type)).toEqual([
      'thread.created',
      'message.created',
      'thread.updated',
      'message.created',
      'message.delta',
      'message.completed',
    ])
    await memberWs.sync()
    expect(eventsFor(memberWs.events, thread.id)).toEqual([])
    expect(memberWs.events.map((e) => e.type)).toEqual(['ready', 'subscribed', 'pong', 'pong'])
    ownerWs.close()
    memberWs.close()
  })

  it('fails the message with the Answerer’s code and keeps the partial text and spent tokens', async () => {
    const { owner, space } = await spaceWithMembers(h, 'AiErr')
    const thread = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      owner.token,
    )
    const ws = await connectAs(port, owner.token, [space.id])
    scripts.set('overloaded', async ({ emit }) => {
      emit({ type: 'delta', text: 'Partial' })
      throw new AnswerError('ai_busy', 'Try again', {
        inputTokens: 10,
        outputTokens: 2,
        cachedInputTokens: 0,
      })
    })
    const r = await h.ok(
      'postMessage',
      { params: { threadId: thread.id }, body: { content: 'overloaded', askAi: true } },
      owner.token,
    )
    const failed = await ws.next('message.failed')
    expect(failed).toMatchObject({
      messageId: r.assistantMessage?.id,
      code: 'ai_busy',
      message: 'Try again',
    })
    const [m] = await h.ok(
      'listMessages',
      { params: { threadId: thread.id }, query: { limit: 1 } },
      owner.token,
    )
    expect(m).toMatchObject({
      status: 'error',
      errorCode: 'ai_busy',
      content: 'Partial',
    })
    expect(
      (await h.ok('getUsage', { params: { spaceId: space.id } }, owner.token)).inputTokens,
    ).toBe(10)

    scripts.set('crash', async () => {
      throw new Error('socket hang up')
    })
    await h.ok(
      'postMessage',
      { params: { threadId: thread.id }, body: { content: 'crash', askAi: true } },
      owner.token,
    )
    expect((await ws.next('message.failed')).code).toBe('ai_failed')
    ws.close()
  })

  it('refuses a model the directory does not offer as available', async () => {
    const { owner, space } = await spaceWithMembers(h, 'AiModel')
    const thread = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      owner.token,
    )
    for (const model of [
      { provider: 'openai' as const, id: 'gpt-x' },
      { provider: 'mock' as const, id: 'nope' },
    ]) {
      await h.fails(
        'postMessage',
        { params: { threadId: thread.id }, body: { content: 'q', askAi: true, model } },
        owner.token,
        400,
        'model_unavailable',
      )
    }
    expect(await h.ok('listModels', {}, owner.token)).toMatchObject({
      defaultModel: { provider: 'mock', id: 'mock-1' },
    })
  })

  it('stops a running answer when its thread is deleted', async () => {
    const { owner, space } = await spaceWithMembers(h, 'AiAbort')
    const thread = await h.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      owner.token,
    )
    let sawAbort = false
    let started!: () => void
    const running = new Promise<void>((resolve) => {
      started = resolve
    })
    scripts.set('long', ({ signal }) => {
      started()
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          sawAbort = true
          reject(new Error('aborted'))
        })
      })
    })
    await h.ok(
      'postMessage',
      { params: { threadId: thread.id }, body: { content: 'long', askAi: true } },
      owner.token,
    )
    await running
    await h.ok('deleteThread', { params: { threadId: thread.id } }, owner.token)
    await h.settle()
    expect(sawAbort).toBe(true)
    expect(h.app.tiger.runningAnswers.size).toBe(0)
  })
})

describe('budget', () => {
  let b: Harness
  beforeAll(async () => {
    b = await startHarness({ answerer: fakeAnswerer, models, env: { SPACE_TOKEN_BUDGET: '1000' } })
  })
  afterAll(() => b.close())

  it('fails the assistant message with budget_exceeded once the month’s tokens are spent', async () => {
    const { owner, space } = await spaceWithMembers(b, 'Budget')
    const thread = await b.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      owner.token,
    )
    await b.sql`
      insert into llm_usage (id, space_id, user_id, provider, model, input_tokens, output_tokens)
      values (${newId()}, ${space.id}, ${owner.user.id}, 'mock', 'mock-1', 900, 100)
    `
    // Last month's spending does not count.
    await b.sql`
      insert into llm_usage (id, space_id, user_id, provider, model, input_tokens, output_tokens, at)
      values (${newId()}, ${space.id}, ${owner.user.id}, 'mock', 'mock-1', 5000, 0, date_trunc('month', now()) - interval '1 day')
    `
    expect(await b.ok('getUsage', { params: { spaceId: space.id } }, owner.token)).toMatchObject({
      inputTokens: 900,
      outputTokens: 100,
      budgetTokens: 1000,
    })
    const before = calls.length
    const r = await b.ok(
      'postMessage',
      { params: { threadId: thread.id }, body: { content: 'How did Q3 go?', askAi: true } },
      owner.token,
    )
    expect(r.message.status).toBe('complete')
    expect(r.assistantMessage).toMatchObject({ status: 'error', errorCode: 'budget_exceeded' })
    await b.settle()
    expect(calls.length).toBe(before)
  })

  it('answers while the Space is under budget', async () => {
    const { owner, space } = await spaceWithMembers(b, 'Under')
    const thread = await b.ok(
      'createThread',
      { params: { spaceId: space.id }, body: { visibility: 'space' } },
      owner.token,
    )
    scripts.set('cheap', async () => ({ content: 'ok', citations: [] }))
    const r = await b.ok(
      'postMessage',
      { params: { threadId: thread.id }, body: { content: 'cheap', askAi: true } },
      owner.token,
    )
    expect(r.assistantMessage?.status).toBe('streaming')
    await b.settle()
    const [m] = await b.ok(
      'listMessages',
      { params: { threadId: thread.id }, query: { limit: 1 } },
      owner.token,
    )
    expect(m).toMatchObject({ status: 'complete', content: 'ok' })
  })
})

describe('defaults without an AI provider', () => {
  it('fails with ai_unavailable through the default Answerer', async () => {
    const d = await startHarness({ models })
    try {
      const { owner, space } = await spaceWithMembers(d, 'NoAi')
      const thread = await d.ok(
        'createThread',
        { params: { spaceId: space.id }, body: { visibility: 'space' } },
        owner.token,
      )
      await d.ok(
        'postMessage',
        { params: { threadId: thread.id }, body: { content: 'q', askAi: true } },
        owner.token,
      )
      await d.settle()
      const [m] = await d.ok(
        'listMessages',
        { params: { threadId: thread.id }, query: { limit: 1 } },
        owner.token,
      )
      expect(m).toMatchObject({ role: 'assistant', status: 'error', errorCode: 'ai_unavailable' })
    } finally {
      await d.close()
    }
  })

  it('fails with ai_unavailable at once when there is no model at all', async () => {
    const d = await startHarness()
    try {
      const { owner, space } = await spaceWithMembers(d, 'NoModel')
      const thread = await d.ok(
        'createThread',
        { params: { spaceId: space.id }, body: { visibility: 'space' } },
        owner.token,
      )
      const r = await d.ok(
        'postMessage',
        { params: { threadId: thread.id }, body: { content: 'q', askAi: true } },
        owner.token,
      )
      expect(r.assistantMessage).toMatchObject({
        status: 'error',
        errorCode: 'ai_unavailable',
        model: null,
      })
    } finally {
      await d.close()
    }
  })
})
