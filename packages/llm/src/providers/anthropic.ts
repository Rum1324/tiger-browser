import Anthropic from '@anthropic-ai/sdk'
import type {
  MessageCreateParamsStreaming,
  MessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages'
import { type CatalogModel, resolveMaxOutputTokens } from '../catalog'
import { classifyError, genericThrownToEvent, parseRetryAfterMs } from '../errors'
import type { ChatEvent, ChatRequest, StopReason } from '../types'
import type { ChatProvider } from './types'

/** The one SDK call the provider makes; tests fake this boundary. */
export interface AnthropicClientLike {
  messages: {
    create(
      params: MessageCreateParamsStreaming,
      options?: { signal?: AbortSignal },
    ): PromiseLike<AsyncIterable<MessageStreamEvent>>
  }
}

export function createAnthropicClient(apiKey: string): AnthropicClientLike {
  // The router owns retries, so the SDK must not add its own on top.
  return new Anthropic({ apiKey, maxRetries: 0 }) as unknown as AnthropicClientLike
}

function mapStopReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end'
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'max_tokens'
    case 'refusal':
      return 'refusal'
    default:
      return 'other'
  }
}

/** Maps a thrown SDK error. APIError carries status, headers and the API's own type and code. */
export function mapAnthropicError(err: unknown, signal?: AbortSignal): ChatEvent {
  if (signal?.aborted) return genericThrownToEvent(err, signal)
  const e = err as {
    status?: unknown
    headers?: unknown
    errorCode?: string | null
    type?: string | null
    apiMessage?: string | null
    message?: string
  }
  if (typeof e?.status === 'number') {
    return classifyError({
      status: e.status,
      providerCode: e.errorCode,
      providerType: e.type,
      message: e.apiMessage ?? e.message ?? 'Anthropic request failed',
      retryAfterMs: parseRetryAfterMs(e.headers),
    })
  }
  return genericThrownToEvent(err, signal)
}

export function buildAnthropicParams(
  model: CatalogModel,
  req: ChatRequest,
): MessageCreateParamsStreaming {
  const system: NonNullable<MessageCreateParamsStreaming['system']> = []
  // Context first: it is the part that stays identical across questions, so the breakpoint after it
  // keeps hitting even when the instructions change.
  if (req.context) {
    system.push(
      req.cacheContext === false
        ? { type: 'text', text: req.context }
        : { type: 'text', text: req.context, cache_control: { type: 'ephemeral' } },
    )
  }
  system.push({ type: 'text', text: req.system })

  const params: MessageCreateParamsStreaming = {
    model: model.id,
    max_tokens: resolveMaxOutputTokens(model, req.maxOutputTokens),
    stream: true,
    system,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
  }
  // Haiku 5.5 thinks by default and spends a small max_tokens entirely on thinking, returning no
  // text. Each model gets the mode it accepts: Opus/Fable reject "disabled", Sonnet wants
  // between_tools.
  if (model.chat.reasoning === 'off') params.thinking = { type: 'disabled' }
  else if (model.chat.reasoning === 'between_tools') params.thinking = { type: 'between_tools' }
  if (model.chat.effort) params.output_config = { effort: model.chat.effort }
  return params
}

export class AnthropicProvider implements ChatProvider {
  constructor(private readonly client: AnthropicClientLike) {}

  async *stream(model: CatalogModel, req: ChatRequest): AsyncGenerator<ChatEvent> {
    let input = 0
    let cacheRead = 0
    let cacheWrite = 0
    let output = 0
    let stop: string | null = null
    let finished = false
    try {
      const events = await this.client.messages.create(buildAnthropicParams(model, req), {
        signal: req.signal,
      })
      for await (const ev of events) {
        switch (ev.type) {
          case 'message_start': {
            const u = ev.message.usage
            input = u.input_tokens ?? 0
            cacheRead = u.cache_read_input_tokens ?? 0
            cacheWrite = u.cache_creation_input_tokens ?? 0
            output = u.output_tokens ?? 0
            break
          }
          case 'content_block_delta':
            // Only text deltas reach the caller: thinking and signature deltas stay inside.
            if (ev.delta.type === 'text_delta' && ev.delta.text !== '') {
              yield { type: 'text', delta: ev.delta.text }
            }
            break
          case 'message_delta': {
            // Cumulative values; null means "not updated".
            const u = ev.usage
            if (u.input_tokens != null) input = u.input_tokens
            if (u.cache_read_input_tokens != null) cacheRead = u.cache_read_input_tokens
            if (u.cache_creation_input_tokens != null) cacheWrite = u.cache_creation_input_tokens
            output = u.output_tokens
            stop = ev.delta.stop_reason
            break
          }
          case 'message_stop':
            finished = true
            break
          default: {
            // The stream can carry an in-band error event (overloaded_error mid-stream).
            const raw = ev as unknown as {
              type: string
              error?: { type?: string; message?: string }
            }
            if (raw.type === 'error') {
              yield classifyError({
                providerType: raw.error?.type,
                message: raw.error?.message ?? 'Anthropic stream error',
              })
              return
            }
          }
        }
      }
    } catch (err) {
      yield mapAnthropicError(err, req.signal)
      return
    }
    if (!finished) {
      yield {
        type: 'error',
        code: 'network',
        message: 'Anthropic stream ended before message_stop',
        retryable: true,
      }
      return
    }
    yield {
      type: 'usage',
      inputTokens: input + cacheRead + cacheWrite,
      cachedInputTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      outputTokens: output,
    }
    yield { type: 'done', stopReason: mapStopReason(stop) }
  }
}
