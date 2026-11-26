import { describe, expect, it } from 'vitest'
import { defaultCatalog } from '../src/catalog'
import type { ChatProvider } from '../src/providers/types'
import { createRouter } from '../src/router'
import type { ChatEvent } from '../src/types'
import { collect, iter, last, request, text } from './helpers'

const fastRetry = { baseDelayMs: 1, maxDelayMs: 2, sleep: async () => {} }

describe('listModels / defaultModel', () => {
  it('lists every model, marking those without a key unavailable, and hides the mock', () => {
    const r = createRouter({ anthropicKey: 'k' })
    const models = r.listModels()
    expect(models.some((m) => m.provider === 'mock')).toBe(false)
    const by = (p: string) => models.filter((m) => m.provider === p)
    expect(by('anthropic').length).toBeGreaterThan(0)
    expect(by('anthropic').every((m) => m.available)).toBe(true)
    expect(by('openai').every((m) => !m.available)).toBe(true)
    expect(by('google').every((m) => !m.available)).toBe(true)
    const first = models[0]
    expect(Object.keys(first ?? {}).sort()).toEqual(
      ['available', 'contextWindow', 'id', 'label', 'provider', 'tier'].sort(),
    )
  })

  it('includes the mock only when enabled', () => {
    const r = createRouter({ enableMock: true })
    expect(r.listModels().find((m) => m.provider === 'mock')).toMatchObject({ available: true })
  })

  it('marks each provider available according to its own key', () => {
    const r = createRouter({ openaiKey: 'k', geminiKey: 'k' })
    const avail = (p: string) =>
      r
        .listModels()
        .filter((m) => m.provider === p)
        .every((m) => m.available)
    expect([avail('openai'), avail('google'), avail('anthropic')]).toEqual([true, true, false])
  })

  it('picks the best-ranked available model, or null with nothing configured', () => {
    expect(createRouter().defaultModel()).toBeNull()
    expect(createRouter({ anthropicKey: 'k' }).defaultModel()).toEqual({
      provider: 'anthropic',
      id: 'claude-sonnet-5-5',
    })
    expect(createRouter({ geminiKey: 'k' }).defaultModel()).toEqual({
      provider: 'google',
      id: 'gemini-4-carbon',
    })
    expect(createRouter({ enableMock: true }).defaultModel()).toEqual({
      provider: 'mock',
      id: 'mock-chat',
    })
  })
})

describe('stream: unknown and unavailable models yield errors, never throw', () => {
  it('unknown model id', async () => {
    const r = createRouter({ anthropicKey: 'k' })
    const ev = await collect(r.stream(request({ model: { provider: 'anthropic', id: 'nope' } })))
    expect(ev).toEqual([
      {
        type: 'error',
        code: 'unknown_model',
        message: 'Unknown model anthropic/nope',
        retryable: false,
      },
    ])
  })

  it('provider without a key', async () => {
    const r = createRouter({ anthropicKey: 'k' })
    const ev = await collect(
      r.stream(request({ model: { provider: 'openai', id: 'gpt-6.2-sol' } })),
    )
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ type: 'error', code: 'model_unavailable', retryable: false })
  })

  it('the mock when it is not enabled looks unknown', async () => {
    const ev = await collect(createRouter().stream(request()))
    expect(ev[0]).toMatchObject({ type: 'error', code: 'unknown_model' })
  })

  it('a conversation that does not end with a user message', async () => {
    const r = createRouter({ enableMock: true })
    const ev = await collect(
      r.stream(request({ messages: [{ role: 'assistant', content: 'hi' }] })),
    )
    expect(ev[0]).toMatchObject({ type: 'error', code: 'invalid_request' })
    expect(await collect(r.stream(request({ messages: [] })))).toHaveLength(1)
  })
})

describe('stream: retry policy through the router', () => {
  const busy: ChatEvent = { type: 'error', code: 'overloaded', message: 'busy', retryable: true }
  function provider(attempts: ChatEvent[][]) {
    let calls = 0
    const p: ChatProvider = {
      stream: () => iter(attempts[Math.min(calls++, attempts.length - 1)] ?? []),
    }
    return { p, calls: () => calls }
  }
  const ask = { model: { provider: 'anthropic', id: 'claude-haiku-5-5' } } as const

  it('retries before the first byte', async () => {
    const f = provider([
      [busy],
      [busy],
      [
        { type: 'text', delta: 'hi' },
        { type: 'done', stopReason: 'end' },
      ],
    ])
    const r = createRouter({ providers: { anthropic: f.p }, retry: fastRetry })
    const ev = await collect(r.stream(request(ask)))
    expect(f.calls()).toBe(3)
    expect(text(ev)).toBe('hi')
  })

  it('does not retry after text', async () => {
    const f = provider([[{ type: 'text', delta: 'par' }, busy], [{ type: 'text', delta: 'x' }]])
    const r = createRouter({ providers: { anthropic: f.p }, retry: fastRetry })
    const ev = await collect(r.stream(request(ask)))
    expect(f.calls()).toBe(1)
    expect(last(ev)).toMatchObject({ type: 'error', code: 'overloaded' })
  })

  it('turns a throwing custom provider into an error event', async () => {
    const p: ChatProvider = {
      stream: () => iter([], new Error('kaboom')),
    }
    const r = createRouter({ providers: { anthropic: p }, retry: fastRetry })
    const ev = await collect(r.stream(request(ask)))
    expect(ev).toEqual([
      { type: 'error', code: 'provider_error', message: 'kaboom', retryable: false },
    ])
  })
})

describe('costUsd', () => {
  const usage = {
    inputTokens: 1_000_000,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
  }
  it('prices a known model at the date and returns null for an unknown one', () => {
    const r = createRouter()
    const carbon = { provider: 'google', id: 'gemini-4-carbon' } as const
    expect(r.costUsd(carbon, usage, '2026-11-30')).toBeCloseTo(2, 6)
    expect(r.costUsd(carbon, usage, new Date('2026-12-02T00:00:00Z'))).toBeCloseTo(4, 6)
    expect(r.costUsd({ provider: 'google', id: 'nope' }, usage, '2026-11-30')).toBeNull()
  })

  it('uses an injected catalog', () => {
    const cat = {
      ...defaultCatalog,
      models: defaultCatalog.models.filter((m) => m.provider === 'mock'),
    }
    const r = createRouter({ catalog: cat, enableMock: true })
    expect(r.listModels().map((m) => m.id)).toEqual(['mock-chat'])
    expect(r.costUsd({ provider: 'mock', id: 'mock-chat' }, usage, '2026-11-30')).toBe(0)
  })
})
