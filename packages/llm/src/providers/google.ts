import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai'
import { GoogleGenAI } from '@google/genai'
import { type CatalogModel, resolveMaxOutputTokens } from '../catalog'
import { classifyError, genericThrownToEvent } from '../errors'
import { composeSystem } from '../prompt'
import type { ChatEvent, ChatRequest, StopReason } from '../types'
import type { ChatProvider } from './types'

/** The one SDK call the provider makes; tests fake this boundary. */
export interface GeminiClientLike {
  models: {
    generateContentStream(
      params: GenerateContentParameters,
    ): PromiseLike<AsyncIterable<GenerateContentResponse>>
  }
}

export function createGeminiClient(apiKey: string): GeminiClientLike {
  return new GoogleGenAI({ apiKey }) as unknown as GeminiClientLike
}

export function mapGeminiError(err: unknown, signal?: AbortSignal): ChatEvent {
  if (signal?.aborted) return genericThrownToEvent(err, signal)
  const e = err as { status?: unknown; message?: string }
  if (typeof e?.status === 'number') {
    return classifyError({ status: e.status, message: e.message ?? 'Gemini request failed' })
  }
  return genericThrownToEvent(err, signal)
}

const FILTERED = new Set([
  'SAFETY',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'RECITATION',
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
])

function mapFinish(reason: string | undefined): StopReason {
  if (reason === undefined || reason === 'STOP') return 'end'
  if (reason === 'MAX_TOKENS') return 'max_tokens'
  if (FILTERED.has(reason)) return 'filtered'
  return 'other'
}

export function buildGeminiParams(
  model: CatalogModel,
  req: ChatRequest,
): GenerateContentParameters {
  return {
    model: model.id,
    contents: req.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    config: {
      // Implicit caching keys on the prefix, so the stable context leads the system instruction.
      systemInstruction: composeSystem(req),
      maxOutputTokens: resolveMaxOutputTokens(model, req.maxOutputTokens),
      abortSignal: req.signal,
    },
  }
}

export class GeminiProvider implements ChatProvider {
  constructor(private readonly client: GeminiClientLike) {}

  async *stream(model: CatalogModel, req: ChatRequest): AsyncGenerator<ChatEvent> {
    let usage: GenerateContentResponse['usageMetadata']
    let finish: string | undefined
    let blocked = false
    try {
      const chunks = await this.client.models.generateContentStream(buildGeminiParams(model, req))
      for await (const chunk of chunks) {
        if (chunk.promptFeedback?.blockReason) blocked = true
        const cand = chunk.candidates?.[0]
        for (const part of cand?.content?.parts ?? []) {
          // Thought parts are the model's reasoning and are never shown.
          if (part.thought) continue
          if (typeof part.text === 'string' && part.text !== '') {
            yield { type: 'text', delta: part.text }
          }
        }
        if (cand?.finishReason) finish = cand.finishReason
        if (chunk.usageMetadata) usage = chunk.usageMetadata
      }
    } catch (err) {
      yield mapGeminiError(err, req.signal)
      return
    }
    if (usage) {
      yield {
        type: 'usage',
        inputTokens: usage.promptTokenCount ?? 0,
        cachedInputTokens: usage.cachedContentTokenCount ?? 0,
        cacheWriteTokens: 0,
        // Thinking tokens are billed as output but reported separately.
        outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
      }
    }
    yield { type: 'done', stopReason: blocked ? 'filtered' : mapFinish(finish) }
  }
}
