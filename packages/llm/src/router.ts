import type { ModelInfo, ModelRef } from '@tiger/shared'
import {
  type Catalog,
  type CatalogModel,
  computeCostUsd,
  defaultCatalog,
  findModel,
} from './catalog'
import { genericThrownToEvent } from './errors'
import { AnthropicProvider, createAnthropicClient } from './providers/anthropic'
import { createGeminiClient, GeminiProvider } from './providers/google'
import { MockProvider } from './providers/mock'
import { createOpenAIClient, OpenAIProvider } from './providers/openai'
import type { ChatProvider } from './providers/types'
import { defaultRetryPolicy, type RetryPolicy, withRetry } from './retry'
import type { ChatEvent, ChatRequest, ChatUsage } from './types'

export interface RouterOptions {
  anthropicKey?: string
  openaiKey?: string
  geminiKey?: string
  /** Adds the offline mock model. Never enable it in production. */
  enableMock?: boolean
  /** Defaults to the bundled catalog.json. */
  catalog?: Catalog
  retry?: Partial<RetryPolicy>
  /** Replaces a provider's implementation (tests, or a proxy). A provider listed here counts as keyed. */
  providers?: Partial<Record<ModelRef['provider'], ChatProvider>>
}

export interface Router {
  listModels(): ModelInfo[]
  /** The best-ranked available model, or null when no provider is configured. */
  defaultModel(): ModelRef | null
  stream(request: ChatRequest): AsyncGenerator<ChatEvent>
  /** USD for one request at the prices in force on `at`; null for a model not in the catalog. */
  costUsd(model: ModelRef, usage: ChatUsage, at: Date | string | number): number | null
}

const errorEvent = (
  code: 'unknown_model' | 'model_unavailable' | 'invalid_request',
  message: string,
): ChatEvent => ({ type: 'error', code, message, retryable: false })

export function createRouter(options: RouterOptions = {}): Router {
  const catalog = options.catalog ?? defaultCatalog
  const policy: RetryPolicy = { ...defaultRetryPolicy, ...options.retry }
  const o = options.providers ?? {}

  const providers = new Map<ModelRef['provider'], ChatProvider>()
  if (o.anthropic) providers.set('anthropic', o.anthropic)
  else if (options.anthropicKey) {
    providers.set('anthropic', new AnthropicProvider(createAnthropicClient(options.anthropicKey)))
  }
  if (o.openai) providers.set('openai', o.openai)
  else if (options.openaiKey) {
    providers.set('openai', new OpenAIProvider(createOpenAIClient(options.openaiKey)))
  }
  if (o.google) providers.set('google', o.google)
  else if (options.geminiKey) {
    providers.set('google', new GeminiProvider(createGeminiClient(options.geminiKey)))
  }
  if (o.mock) providers.set('mock', o.mock)
  else if (options.enableMock) providers.set('mock', new MockProvider())

  const visible = (m: CatalogModel) => m.provider !== 'mock' || providers.has('mock')
  const available = (m: CatalogModel) => providers.has(m.provider)

  return {
    listModels() {
      return catalog.models.filter(visible).map((m) => ({
        provider: m.provider,
        id: m.id,
        label: m.label,
        tier: m.tier,
        contextWindow: m.contextWindow,
        available: available(m),
      }))
    },

    defaultModel() {
      const best = catalog.models
        .filter((m) => visible(m) && available(m) && m.defaultRank !== undefined)
        .sort((a, b) => (a.defaultRank ?? 0) - (b.defaultRank ?? 0))[0]
      return best ? { provider: best.provider, id: best.id } : null
    },

    async *stream(request) {
      const model = findModel(catalog, request.model)
      if (!model || !visible(model)) {
        return yield errorEvent(
          'unknown_model',
          `Unknown model ${request.model.provider}/${request.model.id}`,
        )
      }
      const provider = providers.get(model.provider)
      if (!provider) {
        return yield errorEvent(
          'model_unavailable',
          `No API key is configured for ${model.provider}`,
        )
      }
      if (request.messages.length === 0 || request.messages.at(-1)?.role !== 'user') {
        return yield errorEvent('invalid_request', 'The last message must be a user message')
      }
      // Providers report failures as events; this guard only covers a custom provider that throws.
      const attempt = async function* (): AsyncGenerator<ChatEvent> {
        try {
          yield* provider.stream(model, request)
        } catch (err) {
          yield genericThrownToEvent(err, request.signal)
        }
      }
      yield* withRetry(attempt, policy, request.signal)
    },

    costUsd(model, usage, at) {
      const m = findModel(catalog, model)
      return m ? computeCostUsd(m, usage, at) : null
    },
  }
}
