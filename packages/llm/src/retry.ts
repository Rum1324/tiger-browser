import type { ChatErrorEvent, ChatEvent } from './types'

export interface RetryPolicy {
  /** Total attempts including the first. */
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  /** Injected for tests. Returns [0, 1). */
  random: () => number
  /** Resolves after ms, or rejects early when the signal aborts. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>
}

export const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'))
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })

export const defaultRetryPolicy: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  random: Math.random,
  sleep: defaultSleep,
}

/**
 * Delay before attempt n+1. The server's retry-after is a floor (we never come back sooner than
 * asked); otherwise capped exponential backoff with full jitter in the upper half.
 */
export function backoffDelayMs(policy: RetryPolicy, failedAttempt: number, err: ChatErrorEvent) {
  const exp = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (failedAttempt - 1))
  const jittered = exp / 2 + (exp / 2) * policy.random()
  return err.retryAfterMs !== undefined ? Math.max(err.retryAfterMs, jittered) : jittered
}

const abortedEvent = (): ChatEvent => ({
  type: 'error',
  code: 'aborted',
  message: 'Request aborted',
  retryable: false,
})

/**
 * Runs `attempt` and forwards its events. A retryable error is retried only while no text has been
 * emitted: after the first delta a retry would duplicate text the user already saw, so the error is
 * surfaced as is.
 */
export async function* withRetry(
  attempt: () => AsyncIterable<ChatEvent>,
  policy: RetryPolicy,
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  for (let n = 1; ; n++) {
    let emittedText = false
    let terminal: ChatEvent | null = null
    for await (const ev of attempt()) {
      if (ev.type === 'text' && ev.delta !== '') emittedText = true
      if (ev.type === 'done' || ev.type === 'error') terminal = ev
      if (ev.type === 'error' && ev.retryable && !emittedText && n < policy.maxAttempts) {
        break // swallow; retried below
      }
      yield ev
    }
    if (terminal === null) {
      yield {
        type: 'error',
        code: 'provider_error',
        message: 'The provider stream ended without a result',
        retryable: false,
      }
      return
    }
    const retry =
      terminal.type === 'error' && terminal.retryable && !emittedText && n < policy.maxAttempts
    if (!retry) return
    if (signal?.aborted) {
      yield abortedEvent()
      return
    }
    try {
      await policy.sleep(backoffDelayMs(policy, n, terminal as ChatErrorEvent), signal)
    } catch {
      yield abortedEvent()
      return
    }
  }
}
