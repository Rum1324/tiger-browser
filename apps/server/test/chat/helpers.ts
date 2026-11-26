import type { CatalogModel, ChatEvent, ChatProvider, ChatRequest } from '@tiger/llm'
import { MockProvider } from '@tiger/llm'
import type { Item } from '@tiger/shared'
import { type AnswerTrace, type Chat, createChat, loadChatConfig } from '../../src/chat'
import { createRetrieval, HashEmbedder } from '../../src/retrieval'
import { type Harness, page, startHarness } from '../helpers/harness'

export type Script = (req: ChatRequest) => AsyncIterable<ChatEvent> | null

/**
 * The provider the tests talk to: records every request it receives, answers from a per-test script
 * when one matches, and otherwise behaves exactly like the router's MockProvider.
 */
export class ScriptedProvider implements ChatProvider {
  readonly requests: ChatRequest[] = []
  script: Script | null = null
  constructor(private readonly inner: ChatProvider = new MockProvider()) {}

  async *stream(model: CatalogModel, req: ChatRequest): AsyncGenerator<ChatEvent> {
    this.requests.push(req)
    const scripted = this.script?.(req)
    if (scripted) yield* scripted
    else yield* this.inner.stream(model, req)
  }
}

/** A provider reply: the text in small chunks, then usage and done. */
export async function* reply(
  text: string,
  usage: Partial<Extract<ChatEvent, { type: 'usage' }>> = {},
): AsyncGenerator<ChatEvent> {
  for (let i = 0; i < text.length; i += 5) yield { type: 'text', delta: text.slice(i, i + 5) }
  yield {
    type: 'usage',
    inputTokens: 100,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 10,
    ...usage,
  }
  yield { type: 'done', stopReason: 'end' }
}

export interface ChatHarness {
  h: Harness
  chat: Chat
  provider: ScriptedProvider
  traces: AnswerTrace[]
}

export async function startChatHarness(
  opts: {
    provider?: ScriptedProvider
    /** Registered as the anthropic provider: counts as a configured key. */
    anthropic?: ChatProvider
    env?: Record<string, string>
    /** Server configuration overrides, e.g. a provider key for the live test. */
    serverEnv?: Record<string, string>
    retryAttempts?: number
    /** False leaves the mock provider out of the router entirely (the live test). */
    withMock?: boolean
  } = {},
): Promise<ChatHarness> {
  let chat: Chat | null = null
  let retrieval: ReturnType<typeof createRetrieval> | null = null
  const must = <T>(v: T | null): T => {
    if (!v) throw new Error('chat harness not ready')
    return v
  }
  const h = await startHarness({
    ...(opts.serverEnv ? { env: opts.serverEnv } : {}),
    indexer: { index: (i) => must(retrieval).indexer.index(i) },
    retriever: { search: (i) => must(retrieval).retriever.search(i) },
    answerer: { answer: (i) => must(chat).answerer.answer(i) },
    models: { list: () => must(chat).models.list() },
  })
  retrieval = createRetrieval({ sql: h.sql, embedder: new HashEmbedder() })
  const provider = opts.provider ?? new ScriptedProvider()
  const traces: AnswerTrace[] = []
  chat = createChat({
    sql: h.sql,
    config: loadChatConfig(h.config, {
      CHAT_ENABLE_MOCK: '1',
      CHAT_TITLE_MODEL: 'mock/mock-chat',
      ...opts.env,
    }),
    contextBuilder: retrieval.contextBuilder,
    routerOptions: {
      providers: {
        ...(opts.withMock === false ? {} : { mock: provider }),
        ...(opts.anthropic ? { anthropic: opts.anthropic } : {}),
      },
      retry: { maxAttempts: opts.retryAttempts ?? 1 },
    },
    onRequest: (t) => traces.push(t),
  })
  chat.attach(h.app)
  return { h, chat, provider, traces }
}

export async function shareSettled(
  h: Harness,
  token: string,
  spaceId: string,
  url: string,
  title: string,
  markdown: string,
): Promise<Item> {
  const r = await h.ok(
    'shareItem',
    { params: { spaceId }, body: { page: page(url, markdown, title) } },
    token,
  )
  await h.settle()
  return h.ok('getItem', { params: { itemId: r.item.id } }, token)
}

/** Posts a question and waits for the answer (and any title job) to finish. */
export async function ask(
  h: Harness,
  token: string,
  threadId: string,
  content: string,
  extra: {
    attachments?: ReturnType<typeof page>[]
    model?: { provider: 'mock' | 'anthropic'; id: string }
  } = {},
) {
  const posted = await h.ok(
    'postMessage',
    { params: { threadId }, body: { content, askAi: true, ...extra } },
    token,
  )
  await h.settle()
  const messages = await h.ok('listMessages', { params: { threadId } }, token)
  const answer = messages.find((m) => m.id === posted.assistantMessage?.id)
  if (!answer) throw new Error('assistant message missing')
  return { posted, answer }
}

export const isTitleRequest = (req: ChatRequest) => req.system.startsWith('You name chat threads')
