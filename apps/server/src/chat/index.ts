import {
  type Catalog,
  createRouter,
  defaultCatalog,
  type Router,
  type RouterOptions,
} from '@tiger/llm'
import type { FastifyInstance } from 'fastify'
import type { Sql } from '../db/sql'
import type { ContextBuilder } from '../retrieval/context'
import type { Answerer, ModelDirectory } from '../seams'
import { type AnswererDeps, createAnswerer } from './answerer'
import type { ChatConfig } from './config'
import { cheapestModel, createModelDirectory } from './models'
import { createTitleWriter, type TitleRuntime } from './titles'

export { type AnswerTrace, answerErrorCode, createAnswerer } from './answerer'
export {
  bestQuote,
  cleanMarkers,
  finalizeAnswer,
  MAX_QUOTE_CHARS,
  previewCitations,
  similarity,
} from './citations'
export { type ChatConfig, loadChatConfig } from './config'
export { cheapestModel, createModelDirectory, resolveDefaultModel } from './models'
export {
  assemblePrompt,
  historyMessages,
  NO_SOURCES_NOTE,
  renderSpaceContext,
  SYSTEM_PROMPT,
  stripMarkers,
} from './prompt'
export { cleanTitle, provisionalTitle, TITLE_SYSTEM_PROMPT } from './titles'

export interface Chat {
  router: Router
  answerer: Answerer
  models: ModelDirectory
  /** Gives the title writer the app's hub and background tasks; call once after buildApp. */
  attach(app: FastifyInstance): void
}

/** Router, Answerer and ModelDirectory for one server, wired to the Space context builder. */
export function createChat(deps: {
  sql: Sql
  config: ChatConfig
  contextBuilder: ContextBuilder
  /** Extra router options (tests replace providers here). Keys come from `config`. */
  routerOptions?: Omit<RouterOptions, 'anthropicKey' | 'openaiKey' | 'geminiKey' | 'enableMock'>
  onRequest?: AnswererDeps['onRequest']
}): Chat {
  const { config } = deps
  const catalog: Catalog = deps.routerOptions?.catalog ?? defaultCatalog
  const router = createRouter({
    ...deps.routerOptions,
    ...(config.providerKeys.anthropic ? { anthropicKey: config.providerKeys.anthropic } : {}),
    ...(config.providerKeys.openai ? { openaiKey: config.providerKeys.openai } : {}),
    ...(config.providerKeys.gemini ? { geminiKey: config.providerKeys.gemini } : {}),
    enableMock: config.enableMock,
  })
  const models = createModelDirectory({ router, defaultModel: config.defaultModel })

  let runtime: TitleRuntime | null = null
  const titleModel = () => {
    const configured = config.titleModel
    if (
      configured &&
      router
        .listModels()
        .some((m) => m.available && m.id === configured.id && m.provider === configured.provider)
    ) {
      return configured
    }
    return cheapestModel(router, catalog)
  }
  const titles = createTitleWriter({
    sql: deps.sql,
    router,
    model: titleModel,
    runtime: () => runtime,
  })

  const answerer = createAnswerer({
    sql: deps.sql,
    router,
    contextBuilder: deps.contextBuilder,
    ...(deps.onRequest ? { onRequest: deps.onRequest } : {}),
    onFirstExchange: config.generateTitles
      ? ({ input, content }) =>
          titles.schedule({
            thread: input.thread,
            spaceId: input.spaceId,
            userId: input.user.id,
            messageId: input.assistantMessageId,
            question: input.message.content,
            answer: content,
          })
      : undefined,
  })

  return {
    router,
    answerer,
    models,
    attach(app) {
      const ctx = app.tiger
      runtime = {
        hub: ctx.hub,
        background: ctx.background,
        shutdown: ctx.shutdown.signal,
        log: ctx.log,
      }
    },
  }
}
