import { describe, expect, it } from 'vitest'
import { classifyError, genericThrownToEvent, parseRetryAfterMs } from '../src/errors'

describe('parseRetryAfterMs', () => {
  it('reads seconds, milliseconds and HTTP dates; ms header wins', () => {
    expect(parseRetryAfterMs(new Headers({ 'retry-after': '2' }))).toBe(2000)
    expect(parseRetryAfterMs(new Headers({ 'retry-after': '2', 'retry-after-ms': '250' }))).toBe(
      250,
    )
    const now = Date.parse('2026-11-26T00:00:00Z')
    expect(
      parseRetryAfterMs(new Headers({ 'retry-after': 'Thu, 26 Nov 2026 00:00:05 GMT' }), now),
    ).toBe(5000)
    expect(parseRetryAfterMs({ 'retry-after': '1' })).toBe(1000)
    expect(parseRetryAfterMs(undefined)).toBeUndefined()
    expect(parseRetryAfterMs(new Headers({ 'retry-after': 'soon' }))).toBeUndefined()
  })
})

describe('classifyError', () => {
  it('caps an excessive retry-after instead of trusting it', () => {
    expect(classifyError({ status: 429, message: 'x', retryAfterMs: 3_600_000 })).toMatchObject({
      retryAfterMs: 60_000,
    })
  })
  it('recognises context-length failures', () => {
    expect(
      classifyError({ status: 400, message: 'prompt is too long: 1200000 tokens' }),
    ).toMatchObject({
      code: 'context_too_long',
      retryable: false,
    })
  })
})

describe('genericThrownToEvent', () => {
  it('does not retry a plain programming error', () => {
    expect(genericThrownToEvent(new TypeError('x is undefined'))).toMatchObject({
      code: 'provider_error',
      retryable: false,
    })
  })
  it('retries a socket reset', () => {
    const err = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    expect(genericThrownToEvent(err)).toMatchObject({ code: 'network', retryable: true })
  })
})
