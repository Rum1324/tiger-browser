import OpenAI from 'openai'
import type {
  Response,
  ResponseCreateParamsStreaming,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses'
import { type CatalogModel, resolveMaxOutputTokens } from '../catalog'
import { classifyError, genericThrownToEvent, parseRetryAfterMs } from '../errors'
import { composeSystem } from '../prompt'
import type { ChatEvent, ChatRequest, StopReason } from '../types'
import type { ChatProvider } from './types'

/** The one SDK call the provider makes; tests fake this boundary. */
export interface OpenAIClientLike {
  responses: {
    create(
      params: ResponseCreateParamsStreaming,
      options?: { signal?: AbortSignal },
    ): PromiseLike<AsyncIterable<ResponseStreamEvent>>
  }
}

export function createOpenAIClient(apiKey: string): OpenAIClientLike {
  return new OpenAI({ apiKey, maxRetries: 0 }) as unknown as OpenAIClientLike
}

export function mapOpenAIError(err: unknown, signal?: AbortSignal): ChatEvent {
  if (signal?.aborted) return genericThrownToEvent(err, signal)
  const e = err as {
    status?: unknown
    headers?: unknown
    code?: string | null
    type?: string
    message?: string
  }
  if (typeof e?.status === 'number') {
    return classifyError({
      status: e.status,
      providerCode: e.code,
      providerType: e.type,
      message: e.message ?? 'OpenAI request failed',
      retryAfterMs: parseRetryAfterMs(e.headers),
    })
  }
  return genericThrownToEvent(err, signal)
}

function usageEvent(response: Response): ChatEvent | null {
  const u = response.usage
  if (!u) return null
  return {
    type: 'usage',
    inputTokens: u.input_tokens,
    cachedInputTokens: u.input_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: u.input_tokens_details?.cache_write_tokens ?? 0,
    outputTokens: u.output_tokens,
  }
}

export function buildOpenAIParams(
  model: CatalogModel,
  req: ChatRequest,
): ResponseCreateParamsStreaming {
  const params: ResponseCreateParamsStreaming = {
    model: model.id,
    stream: true,
    store: false,
    max_output_tokens: resolveMaxOutputTokens(model, req.maxOutputTokens),
    // Stable content first: OpenAI caches by exact prefix, and instructions lead the prompt.
    instructions: composeSystem(req),
    input: req.messages.map((m) => ({ role: m.role, content: m.content })),
  }
  if (req.cacheKey) params.prompt_cache_key = req.cacheKey
  return params
}

export class OpenAIProvider implements ChatProvider {
  constructor(private readonly client: OpenAIClientLike) {}

  async *stream(model: CatalogModel, req: ChatRequest): AsyncGenerator<ChatEvent> {
    let refused = false
    try {
      const events = await this.client.responses.create(buildOpenAIParams(model, req), {
        signal: req.signal,
      })
      for await (const ev of events) {
        switch (ev.type) {
          case 'response.output_text.delta':
            if (ev.delta !== '') yield { type: 'text', delta: ev.delta }
            break
          case 'response.refusal.delta':
            // A refusal is the model's user-facing answer, so it is shown like text.
            refused = true
            if (ev.delta !== '') yield { type: 'text', delta: ev.delta }
            break
          case 'response.completed':
          case 'response.incomplete': {
            const usage = usageEvent(ev.response)
            if (usage) yield usage
            let stop: StopReason = 'end'
            if (ev.type === 'response.incomplete') {
              const reason = ev.response.incomplete_details?.reason
              stop = reason === 'content_filter' ? 'filtered' : 'max_tokens'
            } else if (refused) {
              stop = 'refusal'
            }
            yield { type: 'done', stopReason: stop }
            return
          }
          case 'response.failed': {
            const err = ev.response.error
            yield classifyError({
              providerCode: err?.code,
              message: err?.message ?? 'OpenAI response failed',
              // A failed response is a server-side failure unless the code says otherwise.
              status: err?.code === 'rate_limit_exceeded' ? 429 : 500,
            })
            return
          }
          case 'error':
            yield classifyError({
              providerCode: ev.code,
              status: ev.code === 'rate_limit_exceeded' ? 429 : undefined,
              message: ev.message,
            })
            return
          default:
            // Reasoning and tool events carry nothing the chat shows.
            break
        }
      }
    } catch (err) {
      yield mapOpenAIError(err, req.signal)
      return
    }
    yield {
      type: 'error',
      code: 'network',
      message: 'OpenAI stream ended before a completed response',
      retryable: true,
    }
  }
}
