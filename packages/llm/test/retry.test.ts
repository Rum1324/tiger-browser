import { describe, expect, it } from 'vitest'
import { backoffDelayMs, defaultSleep, type RetryPolicy, withRetry } from '../src/retry'
import type { ChatEvent } from '../src/types'
import { collect, iter, last, text } from './helpers'

const errEv = (
  retryable: boolean,
  extra: Partial<Extract<ChatEvent, { type: 'error' }>> = {},
): ChatEvent => ({
  type: 'error',
  code: 'overloaded',
  message: 'busy',
  retryable,
  ...extra,
})
const ok: ChatEvent[] = [
  { type: 'text', delta: 'ok' },
  { type: 'done', stopReason: 'end' },
]

function policy(over: Partial<RetryPolicy> = {}) {
  const delays: number[] = []
  const p: RetryPolicy = {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 1000,
    random: () => 1, // top of the jitter band
    sleep: async (ms) => {
      delays.push(ms)
    },
    ...over,
  }
  return { p, delays }
}

/** Scripted attempts: each call to the factory yields the next script. */
function script(attempts: (ChatEvent[] | { events: ChatEvent[]; then: unknown })[]) {
  let i = 0
  return {
    factory: () => {
      const a = attempts[Math.min(i++, attempts.length - 1)]
      return Array.isArray(a) ? iter(a) : iter(a?.events ?? [], a?.then)
    },
    get calls() {
      return i
    },
  }
}

describe('withRetry', () => {
  it('retries a retryable error before any text and then succeeds', async () => {
    const { p, delays } = policy()
    const s = script([[errEv(true)], [errEv(true)], ok])
    const ev = await collect(withRetry(s.factory, p))
    expect(s.calls).toBe(3)
    expect(text(ev)).toBe('ok')
    expect(last(ev)).toEqual({ type: 'done', stopReason: 'end' })
    // 100 then 200 with jitter at the top of the band; no error leaked to the caller
    expect(delays).toEqual([100, 200])
    expect(ev.some((e) => e.type === 'error')).toBe(false)
  })

  it('surfaces the last error when attempts run out', async () => {
    const { p } = policy({ maxAttempts: 2 })
    const s = script([[errEv(true)], [errEv(true, { message: 'still busy' })]])
    const ev = await collect(withRetry(s.factory, p))
    expect(s.calls).toBe(2)
    expect(last(ev)).toMatchObject({ type: 'error', message: 'still busy' })
    expect(ev.filter((e) => e.type === 'error')).toHaveLength(1)
  })

  it('does not retry non-retryable errors', async () => {
    const { p, delays } = policy()
    const s = script([[errEv(false)], ok])
    const ev = await collect(withRetry(s.factory, p))
    expect(s.calls).toBe(1)
    expect(last(ev)).toMatchObject({ type: 'error', retryable: false })
    expect(delays).toEqual([])
  })

  it('does not retry once text has been emitted', async () => {
    const { p } = policy()
    const s = script([[{ type: 'text', delta: 'par' }, errEv(true)], ok])
    const ev = await collect(withRetry(s.factory, p))
    expect(s.calls).toBe(1)
    expect(text(ev)).toBe('par')
    expect(last(ev)).toMatchObject({ type: 'error', retryable: true })
  })

  it('treats an empty delta as not yet emitted', async () => {
    const { p } = policy()
    const s = script([[{ type: 'text', delta: '' }, errEv(true)], ok])
    await collect(withRetry(s.factory, p))
    expect(s.calls).toBe(2)
  })

  it('honours retry-after as a floor and caps the exponential part', async () => {
    const { p, delays } = policy({ maxAttempts: 4 })
    const s = script([[errEv(true, { retryAfterMs: 5000 })], [errEv(true)], [errEv(true)], ok])
    await collect(withRetry(s.factory, p))
    expect(delays[0]).toBe(5000)
    expect(delays[1]).toBe(200)
    expect(delays[2]).toBe(400)
    const big = policy({ baseDelayMs: 100, maxDelayMs: 300 }).p
    expect(backoffDelayMs(big, 10, errEv(true) as never)).toBe(300)
  })

  it('applies full jitter within the upper half of the window', () => {
    const lo = policy({ random: () => 0 }).p
    expect(backoffDelayMs(lo, 1, errEv(true) as never)).toBe(50)
    const hi = policy({ random: () => 0.5 }).p
    expect(backoffDelayMs(hi, 1, errEv(true) as never)).toBe(75)
  })

  it('stops with an aborted error when the signal fires during the backoff', async () => {
    const ac = new AbortController()
    const { p } = policy({
      sleep: (ms, signal) => defaultSleep(ms, signal),
      baseDelayMs: 10_000,
      maxDelayMs: 10_000,
    })
    const s = script([[errEv(true)], ok])
    setTimeout(() => ac.abort(), 20)
    const t0 = Date.now()
    const ev = await collect(withRetry(s.factory, p, ac.signal))
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(s.calls).toBe(1)
    expect(last(ev)).toMatchObject({ type: 'error', code: 'aborted', retryable: false })
  })

  it('does not start another attempt when already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    const { p } = policy()
    const s = script([[errEv(true)], ok])
    const ev = await collect(withRetry(s.factory, p, ac.signal))
    expect(s.calls).toBe(1)
    expect(last(ev)).toMatchObject({ code: 'aborted' })
  })

  it('reports a stream that ends without done or error', async () => {
    const { p } = policy()
    const ev = await collect(withRetry(script([[{ type: 'text', delta: 'x' }]]).factory, p))
    expect(last(ev)).toMatchObject({ type: 'error', retryable: false })
  })
})
