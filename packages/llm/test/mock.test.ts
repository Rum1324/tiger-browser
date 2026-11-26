import { describe, expect, it } from 'vitest'
import { findNumberedSources, MOCK_ERROR_MARKER, MockProvider } from '../src/providers/mock'
import { createRouter } from '../src/router'
import { collect, last, request, text } from './helpers'

const context = [
  '[1] Pricing page https://a.example/pricing',
  'Plans start at ten dollars.',
  '[2] Roadmap https://a.example/roadmap',
  'Launch in March.',
  '[3] Team https://a.example/team',
  '[4] Extra',
].join('\n')

describe('MockProvider', () => {
  const model = { provider: 'mock', id: 'mock-chat' } as never

  it('streams in several chunks and cites the numbered sources it finds', async () => {
    const ev = await collect(new MockProvider().stream(model, request({ context })))
    const chunks = ev.filter((e) => e.type === 'text')
    expect(chunks.length).toBeGreaterThan(3)
    const out = text(ev)
    expect(out).toContain('[1]')
    expect(out).toContain('[2]')
    expect(out).toContain('[3]')
    expect(out).not.toContain('[4]')
    expect(last(ev)).toEqual({ type: 'done', stopReason: 'end' })
  })

  it('is deterministic', async () => {
    const a = text(await collect(new MockProvider().stream(model, request({ context }))))
    const b = text(await collect(new MockProvider().stream(model, request({ context }))))
    expect(a).toBe(b)
  })

  it('answers without citations when there are no sources', async () => {
    const out = text(await collect(new MockProvider().stream(model, request())))
    expect(out).not.toMatch(/\[\d+\]/)
    expect(out).toContain('No sources')
  })

  it('simulates caching per key and context: write first, read after', async () => {
    const p = new MockProvider()
    const usage = async (key: string, ctx = context) =>
      (await collect(p.stream(model, request({ context: ctx, cacheKey: key })))).find(
        (e) => e.type === 'usage',
      )
    const first = await usage('space-1')
    const second = await usage('space-1')
    const otherSpace = await usage('space-2')
    const changed = await usage('space-1', `${context}\n[5] New`)
    expect(first).toMatchObject({ cachedInputTokens: 0 })
    expect((first as { cacheWriteTokens: number }).cacheWriteTokens).toBeGreaterThan(0)
    expect((second as { cachedInputTokens: number }).cachedInputTokens).toBeGreaterThan(0)
    expect(second).toMatchObject({ cacheWriteTokens: 0 })
    expect((otherSpace as { cacheWriteTokens: number }).cacheWriteTokens).toBeGreaterThan(0)
    expect((changed as { cacheWriteTokens: number }).cacheWriteTokens).toBeGreaterThan(0)
  })

  it('stops with an aborted error when the signal fires mid-stream', async () => {
    const ac = new AbortController()
    const out: string[] = []
    let final: unknown
    for await (const e of new MockProvider().stream(
      model,
      request({ context, signal: ac.signal }),
    )) {
      if (e.type === 'text') {
        out.push(e.delta)
        if (out.length === 2) ac.abort()
      } else final = e
    }
    expect(out).toHaveLength(2)
    expect(final).toMatchObject({ type: 'error', code: 'aborted', retryable: false })
  })

  it('fails on demand', async () => {
    const ev = await collect(
      new MockProvider().stream(
        model,
        request({ messages: [{ role: 'user', content: `go ${MOCK_ERROR_MARKER}` }] }),
      ),
    )
    expect(last(ev)).toMatchObject({ type: 'error', code: 'provider_error', retryable: false })
  })

  it('works through the router when enabled', async () => {
    const router = createRouter({ enableMock: true })
    const ev = await collect(router.stream(request({ context })))
    expect(text(ev)).toContain('[1]')
  })
})

describe('findNumberedSources', () => {
  it('reads [n] at line starts only, once per number', () => {
    expect(findNumberedSources('[1] a\ntext [9] inline\n[2] b\n[1] dup').map((s) => s.n)).toEqual([
      1, 2,
    ])
  })
})
