import type { ModelRef } from '@tiger/shared'

export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface ChatRequest {
  model: ModelRef
  /** Instructions for the model. Keep it identical across calls to stay cacheable. */
  system: string
  /**
   * A long, stable shared context (the Space's numbered sources). It is placed first in the prompt
   * and, where the provider allows it, behind an explicit cache breakpoint.
   */
  context?: string
  /**
   * Whether `context` is worth a cache breakpoint. Default true. Pass false when the context changes
   * with every question (retrieved passages): a breakpoint there is billed as a cache write (1.25x on
   * Anthropic) and is almost never read back.
   */
  cacheContext?: boolean
  /** Conversation so far; the last entry must be a user message. */
  messages: ChatMessage[]
  maxOutputTokens?: number
  /** One per Space. Providers that route caches by key (OpenAI) use it. */
  cacheKey?: string
  signal?: AbortSignal
}

export type StopReason = 'end' | 'max_tokens' | 'refusal' | 'filtered' | 'other'

export type ChatErrorCode =
  | 'unknown_model'
  | 'model_unavailable'
  | 'invalid_request'
  | 'auth'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'overloaded'
  | 'provider_error'
  | 'network'
  | 'timeout'
  | 'context_too_long'
  | 'aborted'

export type ChatEvent =
  | { type: 'text'; delta: string }
  | {
      type: 'usage'
      /** Total input tokens, including cached reads and cache writes. */
      inputTokens: number
      cachedInputTokens: number
      cacheWriteTokens: number
      /** Includes reasoning tokens: they are billed as output. */
      outputTokens: number
    }
  | { type: 'done'; stopReason: StopReason }
  | {
      type: 'error'
      code: ChatErrorCode
      message: string
      retryable: boolean
      /** Server-requested wait before a retry (retry-after), when the provider sent one. */
      retryAfterMs?: number
    }

export type ChatUsage = Omit<Extract<ChatEvent, { type: 'usage' }>, 'type'>
export type ChatErrorEvent = Extract<ChatEvent, { type: 'error' }>
