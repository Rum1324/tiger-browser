import type { GenerateContentParameters } from '@google/genai'
import { describe, expect, it } from 'vitest'
import { defaultCatalog, findModel } from '../src/catalog'
import { type GeminiClientLike, GeminiProvider } from '../src/providers/google'
import { collect, httpError, iter, last, request, text } from './helpers'

const carbon = (() => {
  const m = findModel(defaultCatalog, { provider: 'google', id: 'gemini-4-carbon' })
  if (!m) throw new Error('carbon')
  return m
})()

type Ev = Record<string, unknown>
const chunk = (parts: Ev[], extra: Ev = {}): Ev => ({
  candidates: [{ content: { role: 'model', parts }, ...extra }],
})
const t = (s: string): Ev => ({ text: s })

function fake(chunks: Ev[] | (() => AsyncIterable<Ev>), throwOnCreate?: unknown) {
  const calls: GenerateContentParameters[] = []
  const client: GeminiClientLike = {
    models: {
      async generateContentStream(params) {
        calls.push(params)
        if (throwOnCreate) throw throwOnCreate
        return (typeof chunks === 'function' ? chunks() : iter(chunks)) as never
      },
    },
  }
  return { client, calls }
}
const run = (f: ReturnType<typeof fake>, over = {}) =>
  collect(new GeminiProvider(f.client).stream(carbon, request(over)))

describe('GeminiProvider', () => {
  it('streams text, skips thought parts, and accounts cached tokens and thinking output', async () => {
    const f = fake([
      chunk([{ text: 'planning', thought: true }, t('Hel')]),
      chunk([t('lo')], { finishReason: 'STOP' }),
      {
        ...chunk([]),
        usageMetadata: {
          promptTokenCount: 5000,
          cachedContentTokenCount: 4096,
          candidatesTokenCount: 30,
          thoughtsTokenCount: 70,
        },
      },
    ])
    const ev = await run(f)
    expect(text(ev)).toBe('Hello')
    expect(JSON.stringify(ev)).not.toContain('planning')
    expect(ev.find((e) => e.type === 'usage')).toEqual({
      type: 'usage',
      inputTokens: 5000,
      cachedInputTokens: 4096,
      cacheWriteTokens: 0,
      outputTokens: 100,
    })
    expect(last(ev)).toEqual({ type: 'done', stopReason: 'end' })
  })

  it('uses the last usageMetadata chunk', async () => {
    const f = fake([
      { ...chunk([t('a')]), usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } },
      {
        ...chunk([t('b')], { finishReason: 'STOP' }),
        usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4 },
      },
    ])
    expect((await run(f)).find((e) => e.type === 'usage')).toMatchObject({
      inputTokens: 9,
      outputTokens: 4,
    })
  })

  it('maps finish reasons', async () => {
    for (const [raw, want] of [
      ['MAX_TOKENS', 'max_tokens'],
      ['SAFETY', 'filtered'],
      ['RECITATION', 'filtered'],
      ['MALFORMED_FUNCTION_CALL', 'other'],
    ] as const) {
      const ev = await run(fake([chunk([t('x')], { finishReason: raw })]))
      expect(last(ev)).toEqual({ type: 'done', stopReason: want })
    }
    const blocked = await run(fake([{ promptFeedback: { blockReason: 'SAFETY' } }]))
    expect(last(blocked)).toEqual({ type: 'done', stopReason: 'filtered' })
  })

  it('puts the stable context first in the system instruction and maps roles', async () => {
    const f = fake([chunk([t('x')], { finishReason: 'STOP' })])
    const ac = new AbortController()
    await run(f, {
      context: '[1] Source',
      system: 'Rules',
      signal: ac.signal,
      messages: [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'q2' },
      ],
    })
    const p = f.calls[0]
    expect(p?.model).toBe('gemini-4-carbon')
    expect(p?.config?.systemInstruction).toBe('[1] Source\n\nRules')
    expect(p?.config?.abortSignal).toBe(ac.signal)
    expect(p?.contents).toEqual([
      { role: 'user', parts: [{ text: 'q1' }] },
      { role: 'model', parts: [{ text: 'a1' }] },
      { role: 'user', parts: [{ text: 'q2' }] },
    ])
  })

  it('maps API errors, mid-stream errors and abort', async () => {
    expect(last(await run(fake([], httpError(429, {}, 'RESOURCE_EXHAUSTED'))))).toMatchObject({
      code: 'rate_limited',
      retryable: true,
    })
    expect(last(await run(fake([], httpError(403))))).toMatchObject({
      code: 'auth',
      retryable: false,
    })
    const mid = await run(fake(() => iter([chunk([t('a')])], httpError(503))))
    expect(text(mid)).toBe('a')
    expect(last(mid)).toMatchObject({ code: 'overloaded', retryable: true })

    const ac = new AbortController()
    ac.abort()
    expect(last(await run(fake([], new Error('x')), { signal: ac.signal }))).toMatchObject({
      code: 'aborted',
    })
  })
})
