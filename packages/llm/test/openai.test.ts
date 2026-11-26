import type { ResponseCreateParamsStreaming } from 'openai/resources/responses/responses'
import { describe, expect, it } from 'vitest'
import { defaultCatalog, findModel } from '../src/catalog'
import { type OpenAIClientLike, OpenAIProvider } from '../src/providers/openai'
import { collect, httpError, iter, last, request, text } from './helpers'

const sol = (() => {
  const m = findModel(defaultCatalog, { provider: 'openai', id: 'gpt-6.2-sol' })
  if (!m) throw new Error('sol')
  return m
})()

type Ev = Record<string, unknown>
const delta = (d: string): Ev => ({ type: 'response.output_text.delta', delta: d })
const usage = (over: Ev = {}) => ({
  input_tokens: 2000,
  input_tokens_details: { cached_tokens: 1536, cache_write_tokens: 0 },
  output_tokens: 90,
  output_tokens_details: { reasoning_tokens: 40 },
  total_tokens: 2090,
  ...over,
})
const completed = (u: Ev | undefined = usage()): Ev => ({
  type: 'response.completed',
  response: { usage: u },
})

function fake(events: Ev[] | (() => AsyncIterable<Ev>), throwOnCreate?: unknown) {
  const calls: { params: ResponseCreateParamsStreaming; signal?: AbortSignal }[] = []
  const client: OpenAIClientLike = {
    responses: {
      async create(params, options) {
        calls.push({ params, signal: options?.signal })
        if (throwOnCreate) throw throwOnCreate
        return (typeof events === 'function' ? events() : iter(events)) as never
      },
    },
  }
  return { client, calls }
}
const run = (f: ReturnType<typeof fake>, over = {}) =>
  collect(new OpenAIProvider(f.client).stream(sol, request(over)))

describe('OpenAIProvider', () => {
  it('maps deltas, usage with cached tokens, and completion', async () => {
    const f = fake([
      { type: 'response.reasoning_summary_text.delta', delta: 'thinking...' },
      delta('Hi '),
      delta('there'),
      completed(),
    ])
    const ev = await run(f)
    expect(text(ev)).toBe('Hi there')
    expect(ev.find((e) => e.type === 'usage')).toEqual({
      type: 'usage',
      inputTokens: 2000,
      cachedInputTokens: 1536,
      cacheWriteTokens: 0,
      outputTokens: 90,
    })
    expect(last(ev)).toEqual({ type: 'done', stopReason: 'end' })
  })

  it('reports cache writes', async () => {
    const f = fake([
      delta('x'),
      completed(usage({ input_tokens_details: { cached_tokens: 0, cache_write_tokens: 1800 } })),
    ])
    expect((await run(f)).find((e) => e.type === 'usage')).toMatchObject({
      cachedInputTokens: 0,
      cacheWriteTokens: 1800,
    })
  })

  it('maps incomplete responses and refusals', async () => {
    const maxed = await run(
      fake([
        delta('a'),
        {
          type: 'response.incomplete',
          response: { incomplete_details: { reason: 'max_output_tokens' }, usage: usage() },
        },
      ]),
    )
    expect(last(maxed)).toEqual({ type: 'done', stopReason: 'max_tokens' })

    const filtered = await run(
      fake([
        {
          type: 'response.incomplete',
          response: { incomplete_details: { reason: 'content_filter' } },
        },
      ]),
    )
    expect(last(filtered)).toEqual({ type: 'done', stopReason: 'filtered' })

    const refused = await run(
      fake([{ type: 'response.refusal.delta', delta: "I can't help with that." }, completed()]),
    )
    expect(text(refused)).toBe("I can't help with that.")
    expect(last(refused)).toEqual({ type: 'done', stopReason: 'refusal' })
  })

  it('sends the context first in instructions and the cache key per Space', async () => {
    const f = fake([completed()])
    await run(f, {
      context: '[1] Source',
      system: 'Rules',
      cacheKey: 'space:42',
      maxOutputTokens: 100,
    })
    const p = f.calls[0]?.params
    expect(p?.instructions).toBe('[1] Source\n\nRules')
    expect(p?.prompt_cache_key).toBe('space:42')
    expect(p?.stream).toBe(true)
    expect(p?.model).toBe('gpt-6.2-sol')
    // Reasoning model: the small cap is floored so reasoning cannot eat the answer.
    expect(p?.max_output_tokens).toBe(4096)
  })

  it('omits the cache key when none is given and forwards the abort signal', async () => {
    const ac = new AbortController()
    const f = fake([completed()])
    await run(f, { signal: ac.signal })
    expect(f.calls[0]?.params.prompt_cache_key).toBeUndefined()
    expect(f.calls[0]?.signal).toBe(ac.signal)
  })

  it('maps in-band error events and failed responses', async () => {
    const e1 = await run(fake([{ type: 'error', code: 'rate_limit_exceeded', message: 'slow' }]))
    expect(last(e1)).toMatchObject({ code: 'rate_limited', retryable: true })
    const e2 = await run(
      fake([
        { type: 'response.failed', response: { error: { code: 'server_error', message: 'boom' } } },
      ]),
    )
    expect(last(e2)).toMatchObject({ code: 'provider_error', retryable: true })
  })

  it('maps thrown HTTP errors with retry-after', async () => {
    const err = httpError(503, {
      headers: new Headers({ 'retry-after-ms': '1500' }),
      code: 'server_is_overloaded',
    })
    expect(last(await run(fake([], err)))).toMatchObject({
      code: 'overloaded',
      retryable: true,
      retryAfterMs: 1500,
    })
    expect(last(await run(fake([], httpError(429, { code: 'insufficient_quota' }))))).toMatchObject(
      {
        code: 'quota_exceeded',
        retryable: false,
      },
    )
    expect(last(await run(fake([], httpError(401))))).toMatchObject({
      code: 'auth',
      retryable: false,
    })
  })

  it('reports abort and truncated streams', async () => {
    const ac = new AbortController()
    ac.abort()
    expect(last(await run(fake([], new Error('x')), { signal: ac.signal }))).toMatchObject({
      code: 'aborted',
      retryable: false,
    })
    expect(last(await run(fake([delta('a')])))).toMatchObject({ type: 'error', retryable: true })
  })
})
