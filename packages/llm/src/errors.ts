import type { ChatErrorCode, ChatErrorEvent } from './types'

/** Longest server-requested wait honoured; anything above is treated as "do not wait for it". */
const MAX_RETRY_AFTER_MS = 60_000

interface HeadersLike {
  get(name: string): string | null
}

function readHeader(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null
  const h = headers as Partial<HeadersLike> & Record<string, unknown>
  if (typeof h.get === 'function') return h.get(name) ?? null
  const v = h[name]
  return typeof v === 'string' ? v : null
}

/** retry-after-ms (non-standard but sent by Anthropic/OpenAI) wins over retry-after (seconds or date). */
export function parseRetryAfterMs(headers: unknown, now = Date.now()): number | undefined {
  const ms = readHeader(headers, 'retry-after-ms')
  if (ms !== null && ms.trim() !== '' && Number.isFinite(Number(ms))) {
    return Math.max(0, Number(ms))
  }
  const ra = readHeader(headers, 'retry-after')
  if (ra === null || ra.trim() === '') return undefined
  if (Number.isFinite(Number(ra))) return Math.max(0, Number(ra) * 1000)
  const date = Date.parse(ra)
  return Number.isNaN(date) ? undefined : Math.max(0, date - now)
}

export function clampRetryAfter(ms: number | undefined): number | undefined {
  return ms === undefined ? undefined : Math.min(ms, MAX_RETRY_AFTER_MS)
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: unknown; constructor?: { name?: unknown } }
  return (
    e.name === 'AbortError' ||
    e.constructor?.name === 'APIUserAbortError' ||
    e.constructor?.name === 'AbortError'
  )
}

/** Connection-level failures: the request may never have reached the server, so retrying is safe. */
export function isConnectionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { constructor?: { name?: unknown } }).constructor?.name
  if (typeof name === 'string' && /^(APIConnection(Timeout)?Error|FetchError)$/.test(name)) {
    return true
  }
  const e = err as { code?: unknown; cause?: { code?: unknown }; message?: unknown }
  if (e instanceof TypeError && /fetch failed/i.test(String(e.message))) return true
  return /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|UND_ERR_)/.test(
    String(e.code ?? e.cause?.code ?? ''),
  )
}

export interface ClassifyInput {
  status?: number
  /** Provider-specific machine code, e.g. Anthropic error.details.error_code. */
  providerCode?: string | null
  /** Provider-specific error type, e.g. overloaded_error. */
  providerType?: string | null
  message: string
  retryAfterMs?: number
}

const NON_RETRYABLE_RATE_CODES = new Set([
  'enforced_spend_limit_reached',
  'insufficient_quota',
  'billing_hard_limit_reached',
])

/** One mapping from (status, provider hints) to the normalised error, shared by all providers. */
export function classifyError(i: ClassifyInput): ChatErrorEvent {
  const base = { type: 'error' as const, message: i.message }
  const withWait = (e: Omit<ChatErrorEvent, 'retryAfterMs'>): ChatErrorEvent =>
    i.retryAfterMs === undefined ? e : { ...e, retryAfterMs: clampRetryAfter(i.retryAfterMs) }
  const code = i.providerCode ?? ''
  const type = i.providerType ?? ''
  const mk = (c: ChatErrorCode, retryable: boolean) => withWait({ ...base, code: c, retryable })

  if (NON_RETRYABLE_RATE_CODES.has(code)) return mk('quota_exceeded', false)
  if (type === 'overloaded_error' || code === 'server_is_overloaded' || i.status === 529) {
    return mk('overloaded', true)
  }
  switch (i.status) {
    case 400:
    case 422:
      return mk(
        /too (long|large)|context.*(length|window)|maximum context/i.test(i.message)
          ? 'context_too_long'
          : 'invalid_request',
        false,
      )
    case 401:
    case 403:
      return mk('auth', false)
    case 404:
      return mk('unknown_model', false)
    case 408:
      return mk('timeout', true)
    case 413:
      return mk('context_too_long', false)
    case 429:
      return mk('rate_limited', true)
    case 500:
    case 502:
    case 504:
      return mk('provider_error', true)
    case 503:
      return mk('overloaded', true)
    default:
      break
  }
  if (type === 'rate_limit_error') return mk('rate_limited', true)
  if (type === 'api_error') return mk('provider_error', true)
  if (type === 'invalid_request_error') return mk('invalid_request', false)
  if (type === 'authentication_error' || type === 'permission_error') return mk('auth', false)
  if (i.status === undefined) {
    return mk(/timed? ?out/i.test(i.message) ? 'timeout' : 'network', true)
  }
  return mk('provider_error', i.status >= 500)
}

/** Fallback for anything thrown that no SDK-specific mapper recognised. */
export function genericThrownToEvent(err: unknown, signal?: AbortSignal): ChatErrorEvent {
  if (signal?.aborted || isAbortError(err)) {
    return { type: 'error', code: 'aborted', message: 'Request aborted', retryable: false }
  }
  const message = err instanceof Error ? err.message : String(err)
  const status = (err as { status?: unknown } | null)?.status
  if (typeof status === 'number') {
    return classifyError({
      status,
      message,
      retryAfterMs: parseRetryAfterMs((err as { headers?: unknown }).headers),
    })
  }
  if (isConnectionError(err)) return classifyError({ message })
  // Not an HTTP or connection failure: a bug on our side, so retrying cannot help.
  return { type: 'error', code: 'provider_error', message, retryable: false }
}
