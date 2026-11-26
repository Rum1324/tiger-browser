import type { MessageCreateParamsStreaming } from '@anthropic-ai/sdk/resources/messages'
import { describe, expect, it } from 'vitest'
import { defaultCatalog, findModel } from '../src/catalog'
import { type AnthropicClientLike, AnthropicProvider } from '../src/providers/anthropic'
import { collect, httpError, iter, last, request, text } from './helpers'

const cat = (id: string) => {
  const m = findModel(defaultCatalog, { provider: 'anthropic', id })
  if (!m) throw new Error(id)
  return m
}
const haiku = cat('claude-haiku-5-5')

type Ev = Record<string, unknown>
const start = (usage: Ev = {}): Ev => ({
  type: 'message_start',
  message: {
    usage: {
      input_tokens: 10,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 1,
      ...usage,
    },
  },
})
const textDelta = (t: string): Ev => ({
  type: 'content_block_delta',
  index: 0,
  delta: { type: 'text_delta', text: t },
})
const msgDelta = (stop: string | null, usage: Ev = {}): Ev => ({
  type: 'message_delta',
  delta: { stop_reason: stop },
  usage: {
    input_tokens: null,
    cache_read_input_tokens: null,
    cache_creation_input_tokens: null,
    output_tokens: 7,
    ...usage,
  },
})
const stop: Ev = { type: 'message_stop' }

function fake(events: Ev[] | (() => AsyncIterable<Ev>), throwOnCreate?: unknown) {
  const calls: { params: MessageCreateParamsStreaming; signal?: AbortSignal }[] = []
  const client: AnthropicClientLike = {
    messages: {
      async create(params, options) {
        calls.push({ params, signal: options?.signal })
        if (throwOnCreate) throw throwOnCreate
        const src = typeof events === 'function' ? events() : iter(events)
        return src as never
      },
    },
  }
  return { client, calls }
}

const run = async (f: ReturnType<typeof fake>, over = {}, model = haiku) =>
  collect(new AnthropicProvider(f.client).stream(model, request(over)))

describe('AnthropicProvider event mapping', () => {
  it('streams text deltas, then usage, then done', async () => {
    const f = fake([start(), textDelta('Hel'), textDelta('lo'), msgDelta('end_turn'), stop])
    const ev = await run(f)
    expect(ev.map((e) => e.type)).toEqual(['text', 'text', 'usage', 'done'])
    expect(text(ev)).toBe('Hello')
    expect(last(ev)).toEqual({ type: 'done', stopReason: 'end' })
  })

  it('never leaks thinking, signature or redacted blocks into the text', async () => {
    const f = fake([
      start(),
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'secret reasoning' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'abc' },
      },
      textDelta('Answer'),
      msgDelta('end_turn'),
      stop,
    ])
    const ev = await run(f)
    expect(text(ev)).toBe('Answer')
    expect(JSON.stringify(ev)).not.toContain('secret reasoning')
  })

  it('maps stop reasons', async () => {
    for (const [raw, want] of [
      ['max_tokens', 'max_tokens'],
      ['refusal', 'refusal'],
      ['stop_sequence', 'end'],
      ['tool_use', 'other'],
    ] as const) {
      const ev = await run(fake([start(), msgDelta(raw), stop]))
      expect(last(ev)).toEqual({ type: 'done', stopReason: want })
    }
  })
})

describe('AnthropicProvider usage accounting', () => {
  it('reports total input including cache reads and writes', async () => {
    const f = fake([
      start({ input_tokens: 17, cache_read_input_tokens: 5112, cache_creation_input_tokens: 0 }),
      textDelta('x'),
      msgDelta('end_turn', { output_tokens: 42 }),
      stop,
    ])
    const usage = (await run(f)).find((e) => e.type === 'usage')
    expect(usage).toEqual({
      type: 'usage',
      inputTokens: 17 + 5112,
      cachedInputTokens: 5112,
      cacheWriteTokens: 0,
      outputTokens: 42,
    })
  })

  it('counts cache writes, and prefers the cumulative message_delta values', async () => {
    const f = fake([
      start({ input_tokens: 3, cache_creation_input_tokens: 100 }),
      msgDelta('end_turn', { input_tokens: 5, cache_creation_input_tokens: 200, output_tokens: 9 }),
      stop,
    ])
    const usage = (await run(f)).find((e) => e.type === 'usage')
    expect(usage).toMatchObject({ inputTokens: 205, cacheWriteTokens: 200, outputTokens: 9 })
  })
})

describe('AnthropicProvider request shape', () => {
  it('puts the context behind a cache breakpoint ahead of the instructions', async () => {
    const f = fake([start(), msgDelta('end_turn'), stop])
    await run(f, { context: '[1] Source one', system: 'Be exact.' })
    const params = f.calls[0]?.params
    expect(params?.system).toEqual([
      { type: 'text', text: '[1] Source one', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'Be exact.' },
    ])
    expect(params?.stream).toBe(true)
    expect(params?.model).toBe('claude-haiku-5-5')
  })

  it('sends the context without a breakpoint when the caller says it will not repeat', async () => {
    const f = fake([start(), msgDelta('end_turn'), stop])
    await run(f, { context: '[1] Retrieved passage', system: 'Be exact.', cacheContext: false })
    expect(f.calls[0]?.params.system).toEqual([
      { type: 'text', text: '[1] Retrieved passage' },
      { type: 'text', text: 'Be exact.' },
    ])
  })

  it('sends no breakpoint without a context', async () => {
    const f = fake([start(), msgDelta('end_turn'), stop])
    await run(f)
    expect(JSON.stringify(f.calls[0]?.params.system)).not.toContain('cache_control')
  })

  it('disables thinking on Haiku and keeps a small max_tokens usable', async () => {
    const f = fake([start(), msgDelta('end_turn'), stop])
    await run(f, { maxOutputTokens: 50 })
    expect(f.calls[0]?.params.thinking).toEqual({ type: 'disabled' })
    expect(f.calls[0]?.params.max_tokens).toBe(50)
  })

  it('never sends "disabled" to models that reject it and floors their max_tokens', async () => {
    const opus = fake([start(), msgDelta('end_turn'), stop])
    await run(opus, { maxOutputTokens: 50 }, cat('claude-opus-5-5'))
    expect(opus.calls[0]?.params.thinking).toBeUndefined()
    expect(opus.calls[0]?.params.max_tokens).toBe(4096)
    expect(opus.calls[0]?.params.output_config).toEqual({ effort: 'low' })

    const sonnet = fake([start(), msgDelta('end_turn'), stop])
    await run(sonnet, {}, cat('claude-sonnet-5-5'))
    expect(sonnet.calls[0]?.params.thinking).toEqual({ type: 'between_tools' })
  })

  it('passes the abort signal to the SDK', async () => {
    const ac = new AbortController()
    const f = fake([start(), msgDelta('end_turn'), stop])
    await run(f, { signal: ac.signal })
    expect(f.calls[0]?.signal).toBe(ac.signal)
  })
})

describe('AnthropicProvider errors and abort', () => {
  it('maps HTTP errors with retry-after as a floor for the retry', async () => {
    const err = httpError(429, {
      headers: new Headers({ 'retry-after': '3' }),
      type: 'rate_limit_error',
      apiMessage: 'slow down',
    })
    const ev = await run(fake([], err))
    expect(last(ev)).toEqual({
      type: 'error',
      code: 'rate_limited',
      message: 'slow down',
      retryable: true,
      retryAfterMs: 3000,
    })
  })

  it('does not retry a spend-limit 429', async () => {
    const err = httpError(429, { errorCode: 'enforced_spend_limit_reached' })
    expect(last(await run(fake([], err)))).toMatchObject({
      code: 'quota_exceeded',
      retryable: false,
    })
  })

  it.each([
    [401, 'auth', false],
    [400, 'invalid_request', false],
    [404, 'unknown_model', false],
    [500, 'provider_error', true],
    [529, 'overloaded', true],
  ])('maps status %i to %s (retryable %s)', async (status, code, retryable) => {
    expect(last(await run(fake([], httpError(status))))).toMatchObject({ code, retryable })
  })

  it('treats a connection failure as retryable', async () => {
    class APIConnectionError extends Error {}
    const ev = await run(fake([], new APIConnectionError('Connection error.')))
    expect(last(ev)).toMatchObject({ code: 'network', retryable: true })
  })

  it('maps an in-band overloaded_error event after some text', async () => {
    const ev = await run(
      fake([
        start(),
        textDelta('partial'),
        { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
      ]),
    )
    expect(text(ev)).toBe('partial')
    expect(last(ev)).toMatchObject({ code: 'overloaded', retryable: true })
  })

  it('maps a mid-stream throw', async () => {
    const f = fake(() => iter([start(), textDelta('a')], httpError(500)))
    const ev = await run(f)
    expect(text(ev)).toBe('a')
    expect(last(ev)).toMatchObject({ type: 'error', code: 'provider_error' })
  })

  it('reports an abort as a non-retryable aborted error', async () => {
    const ac = new AbortController()
    const f = fake(() =>
      (async function* () {
        yield start()
        yield textDelta('a')
        ac.abort()
        throw Object.assign(new Error('Request was aborted.'), { name: 'AbortError' })
      })(),
    )
    const ev = await run(f, { signal: ac.signal })
    expect(last(ev)).toEqual({
      type: 'error',
      code: 'aborted',
      message: 'Request aborted',
      retryable: false,
    })
  })

  it('errors when the stream ends before message_stop', async () => {
    const ev = await run(fake([start(), textDelta('a')]))
    expect(last(ev)).toMatchObject({ type: 'error', retryable: true })
  })
})

describe('AnthropicProvider through the router', () => {
  it('retries an overloaded error before the first byte, then streams', async () => {
    const { createRouter } = await import('../src/router')
    let n = 0
    const client: AnthropicClientLike = {
      messages: {
        async create() {
          if (n++ === 0) throw httpError(529, {}, 'Overloaded')
          return iter([start(), textDelta('ok'), msgDelta('end_turn'), stop]) as never
        },
      },
    }
    const r = createRouter({
      providers: { anthropic: new AnthropicProvider(client) },
      retry: { sleep: async () => {} },
    })
    const ev = await collect(
      r.stream(request({ model: { provider: 'anthropic', id: 'claude-haiku-5-5' } })),
    )
    expect(n).toBe(2)
    expect(text(ev)).toBe('ok')
    expect(last(ev)).toEqual({ type: 'done', stopReason: 'end' })
  })
})
