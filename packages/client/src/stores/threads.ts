import {
  api,
  type Citation,
  type ExtractedPage,
  type Message,
  type ModelRef,
  type ServerEvent,
  type Thread,
} from '@tiger/shared'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { ApiClientError, toClientError } from '../api'
import { type CaptureOutcome, extractTab, userBlockedHosts } from '../capture'
import { type ClientContext, failed, IDLE, LOADING, type Load, READY } from '../load'

/** The server accepts at most this many page attachments per message. */
export const MAX_ATTACHMENTS = 3

/**
 * How a message should be drawn. `streaming`: text is still arriving. `failed` / `aborted`: the
 * answer stopped (`failure` says why); `text` keeps what had arrived.
 */
export type MessagePhase = 'streaming' | 'complete' | 'failed' | 'aborted'

export interface ViewMessage {
  id: string
  threadId: string
  /** The server's record; `content` and `citations` there are final only once complete. */
  message: Message
  phase: MessagePhase
  /** What to render now: the assembled stream while streaming, the final content afterwards. */
  text: string
  /**
   * While streaming: the early source list (every source in the prompt). Once complete: the final
   * citations (the subset actually cited), which replace the early list rather than merge into it.
   */
  citations: Citation[]
  failure: { code: string; message: string } | null
}

export interface ThreadMessages {
  list: ViewMessage[]
  load: Load
  /** Older messages exist on the server. */
  hasMore: boolean
}

export type AttachFailure =
  | { kind: 'not-allowed' }
  | { kind: 'limit' }
  | { kind: 'capture'; outcome: Extract<CaptureOutcome, { ok: false }> }

/**
 * Attaching the current page to one message follows the same rule as sharing: extract locally,
 * preview the exact page, and only `confirmAttach()` adds it to the draft. The draft leaves the
 * machine only with `post()`.
 */
export type AttachFlowState =
  | { phase: 'idle' }
  | { phase: 'extracting'; threadId: string; tabId: string }
  | { phase: 'preview'; threadId: string; tabId: string; page: ExtractedPage }
  | { phase: 'error'; threadId: string; failure: AttachFailure }

export interface ThreadsState {
  spaceId: string | null
  /** Space threads plus this member's private threads in the current Space, newest activity first. */
  threads: Thread[]
  load: Load
  /** The member's side-panel thread in the current Space (created on first use). */
  privateThreadId: string | null
  messages: Record<string, ThreadMessages>
  /** Confirmed attachments waiting for the next message, per thread. */
  drafts: Record<string, ExtractedPage[]>
  attach: AttachFlowState
  mutation: Load
}

export interface PostOptions {
  askAi: boolean
  /** Overrides the models store's selection for this message. */
  model?: ModelRef
}

export interface ThreadsController {
  store: StoreApi<ThreadsState>
  load(spaceId: string | null): Promise<void>
  /** Refetch threads and every loaded message list (after a reconnect). */
  resync(): Promise<void>
  loadMessages(threadId: string): Promise<void>
  loadOlder(threadId: string): Promise<void>
  /** The side-panel thread, created on the server the first time it is needed. */
  ensurePrivateThread(): Promise<Thread | null>
  createSpaceThread(title?: string): Promise<Thread | null>
  post(
    threadId: string,
    content: string,
    opts: PostOptions,
  ): Promise<{ message: Message; assistantMessage: Message | null } | null>
  /** Post to the side-panel thread, creating it if needed. */
  askPrivate(
    content: string,
    opts: PostOptions,
  ): Promise<{ message: Message; assistantMessage: Message | null } | null>
  beginAttach(threadId: string, tabId: string): Promise<void>
  confirmAttach(): boolean
  cancelAttach(): void
  removeAttachment(threadId: string, index: number): void
  /** Promote a private thread to the Space. */
  promote(threadId: string): Promise<Thread | null>
  remove(threadId: string): Promise<boolean>
  thread(threadId: string): Thread | null
  handleEvent(e: ServerEvent): void
  reset(): void
}

export interface ThreadsDeps {
  /** The model chosen for the next message (models store), or null for the server default. */
  modelForMessage(): ModelRef | null
  /** A message was posted with askAi: the per-message model choice is consumed. */
  messagePosted(): void
  /** An answer finished in this Space: usage may have moved. */
  answerFinished(spaceId: string): void
}

interface StreamBuffer {
  threadId: string
  nextSeq: number
  text: string
  pending: Map<number, string>
  sources: Citation[] | null
}

const activity = (t: Thread) => t.lastMessageAt ?? t.createdAt
const byActivity = (a: Thread, b: Thread) => (activity(a) < activity(b) ? 1 : -1)

const PAGE = 50

export function createThreads(ctx: ClientContext, deps: ThreadsDeps): ThreadsController {
  const initial = (): ThreadsState => ({
    spaceId: null,
    threads: [],
    load: IDLE,
    privateThreadId: null,
    messages: {},
    drafts: {},
    attach: { phase: 'idle' },
    mutation: IDLE,
  })
  const store = createStore<ThreadsState>()(initial)
  const streams = new Map<string, StreamBuffer>()
  /** Final failure details, kept for messages that failed while this client watched. */
  const failures = new Map<string, { code: string; message: string }>()
  /**
   * Settled versions of messages, by id. The POST response (a `streaming` placeholder) can arrive
   * after the socket already reported the answer complete or failed; it must not roll it back.
   */
  const settled = new Map<string, Message>()
  /** Failures reported before their placeholder message reached this client: id → partial text. */
  const pendingFailures = new Map<string, string>()
  let attachRun = 0

  function project(message: Message): ViewMessage {
    const buf = streams.get(message.id)
    const base = { id: message.id, threadId: message.threadId, message }
    if (message.status === 'streaming') {
      return {
        ...base,
        phase: 'streaming',
        text: message.content + (buf?.text ?? ''),
        citations: buf?.sources ?? [],
        failure: null,
      }
    }
    if (message.status === 'error') {
      const failure = failures.get(message.id) ?? {
        code: message.errorCode ?? 'ai_failed',
        message: '',
      }
      return {
        ...base,
        phase: failure.code === 'ai_aborted' ? 'aborted' : 'failed',
        text: message.content,
        citations: message.citations,
        failure,
      }
    }
    return {
      ...base,
      phase: 'complete',
      text: message.content,
      citations: message.citations,
      failure: null,
    }
  }

  function setMessages(threadId: string, patch: Partial<ThreadMessages>): void {
    const s = store.getState()
    const cur = s.messages[threadId] ?? { list: [], load: IDLE, hasMore: false }
    store.setState({ messages: { ...s.messages, [threadId]: { ...cur, ...patch } } })
  }

  /** Insert or replace one message in a loaded thread, keeping server order (oldest first). */
  function upsertMessage(incoming: Message): void {
    let message =
      incoming.status === 'streaming' ? (settled.get(incoming.id) ?? incoming) : incoming
    const failedText = pendingFailures.get(message.id)
    if (message.status === 'streaming' && failedText !== undefined) {
      const f = failures.get(message.id)
      message = {
        ...message,
        status: 'error',
        errorCode: f?.code ?? 'ai_failed',
        content: failedText,
      }
    }
    pendingFailures.delete(message.id)
    if (message.status !== 'streaming') settled.set(message.id, message)
    const cur = store.getState().messages[message.threadId]
    if (!cur) return
    const view = project(message)
    const i = cur.list.findIndex((m) => m.id === message.id)
    const list =
      i < 0
        ? [...cur.list, view].sort((a, b) =>
            a.message.createdAt === b.message.createdAt
              ? a.id < b.id
                ? -1
                : 1
              : a.message.createdAt < b.message.createdAt
                ? -1
                : 1,
          )
        : cur.list.map((m) => (m.id === message.id ? view : m))
    setMessages(message.threadId, { list })
  }

  function reproject(threadId: string, messageId: string): void {
    const cur = store.getState().messages[threadId]
    const existing = cur?.list.find((m) => m.id === messageId)
    if (existing) upsertMessage(existing.message)
  }

  function upsertThread(thread: Thread): void {
    const s = store.getState()
    if (thread.spaceId !== s.spaceId) return
    const rest = s.threads.filter((t) => t.id !== thread.id)
    const patch: Partial<ThreadsState> = { threads: [thread, ...rest].sort(byActivity) }
    // A promoted side-panel thread now belongs to the Space; the next private question starts anew.
    if (s.privateThreadId === thread.id && thread.visibility !== 'private')
      patch.privateThreadId = null
    store.setState(patch)
  }

  function dropThread(threadId: string): void {
    const s = store.getState()
    const { [threadId]: _m, ...messages } = s.messages
    const { [threadId]: _d, ...drafts } = s.drafts
    for (const [id, b] of streams) if (b.threadId === threadId) streams.delete(id)
    store.setState({
      threads: s.threads.filter((t) => t.id !== threadId),
      messages,
      drafts,
      privateThreadId: s.privateThreadId === threadId ? null : s.privateThreadId,
    })
  }

  function markItemUnavailable(itemId: string): void {
    const gone = (c: Citation): Citation =>
      c.itemId === itemId ? { ...c, available: false, quote: '' } : c
    for (const b of streams.values()) if (b.sources) b.sources = b.sources.map(gone)
    for (const [id, m] of settled) settled.set(id, { ...m, citations: m.citations.map(gone) })
    const s = store.getState()
    const messages: Record<string, ThreadMessages> = {}
    for (const [threadId, tm] of Object.entries(s.messages)) {
      messages[threadId] = {
        ...tm,
        list: tm.list.map((v) => {
          if (
            !v.message.citations.some((c) => c.itemId === itemId) &&
            !v.citations.some((c) => c.itemId === itemId)
          )
            return v
          return project({ ...v.message, citations: v.message.citations.map(gone) })
        }),
      }
    }
    store.setState({ messages })
  }

  function pickPrivate(threads: Thread[]): string | null {
    const me = ctx.userId()
    return threads.find((t) => t.visibility === 'private' && t.owner.id === me)?.id ?? null
  }

  async function mutate<T>(fn: () => Promise<T>): Promise<T | null> {
    store.setState({ mutation: LOADING })
    try {
      const r = await fn()
      store.setState({ mutation: READY })
      return r
    } catch (e) {
      store.setState({ mutation: failed(toClientError(e)) })
      return null
    }
  }

  async function fetchThreads(spaceId: string): Promise<void> {
    const threads = await ctx.api.call(api.listThreads, { params: { spaceId }, query: {} })
    if (store.getState().spaceId !== spaceId) return
    const sorted = [...threads].sort(byActivity)
    const current = store.getState().privateThreadId
    store.setState({
      threads: sorted,
      load: READY,
      privateThreadId:
        current && sorted.some((t) => t.id === current && t.visibility === 'private')
          ? current
          : pickPrivate(sorted),
    })
  }

  const controller: ThreadsController = {
    store,

    async load(spaceId) {
      streams.clear()
      store.setState({ ...initial(), spaceId, load: spaceId ? LOADING : IDLE }, true)
      if (!spaceId) return
      try {
        await fetchThreads(spaceId)
      } catch (e) {
        if (store.getState().spaceId === spaceId) store.setState({ load: failed(toClientError(e)) })
      }
    },

    async resync() {
      const { spaceId, messages } = store.getState()
      if (!spaceId) return
      try {
        await fetchThreads(spaceId)
      } catch (e) {
        store.setState({ load: failed(toClientError(e)) })
        return
      }
      const known = new Set(store.getState().threads.map((t) => t.id))
      await Promise.all(
        Object.keys(messages).map(async (threadId) => {
          if (!known.has(threadId)) {
            dropThread(threadId)
            return
          }
          await controller.loadMessages(threadId)
        }),
      )
    },

    async loadMessages(threadId) {
      setMessages(threadId, { load: LOADING })
      try {
        const list = await ctx.api.call(api.listMessages, {
          params: { threadId },
          query: { limit: PAGE },
        })
        // A message the server reports as settled has no use for a stream buffer any more.
        for (const m of list) if (m.status !== 'streaming') streams.delete(m.id)
        setMessages(threadId, {
          list: list.map(project),
          load: READY,
          hasMore: list.length === PAGE,
        })
      } catch (e) {
        setMessages(threadId, { load: failed(toClientError(e)) })
      }
    },

    async loadOlder(threadId) {
      const cur = store.getState().messages[threadId]
      const oldest = cur?.list[0]
      if (!cur || !oldest || !cur.hasMore) return
      try {
        const older = await ctx.api.call(api.listMessages, {
          params: { threadId },
          query: { before: oldest.id, limit: PAGE },
        })
        const now = store.getState().messages[threadId]
        if (!now) return
        const ids = new Set(now.list.map((m) => m.id))
        setMessages(threadId, {
          list: [...older.filter((m) => !ids.has(m.id)).map(project), ...now.list],
          hasMore: older.length === PAGE,
        })
      } catch (e) {
        setMessages(threadId, { load: failed(toClientError(e)) })
      }
    },

    async ensurePrivateThread() {
      const s = store.getState()
      if (!s.spaceId) return null
      const existing = s.privateThreadId && s.threads.find((t) => t.id === s.privateThreadId)
      if (existing) return existing
      const spaceId = s.spaceId
      const thread = await mutate(() =>
        ctx.api.call(api.createThread, { params: { spaceId }, body: { visibility: 'private' } }),
      )
      if (!thread) return null
      upsertThread(thread)
      store.setState({ privateThreadId: thread.id })
      setMessages(thread.id, { list: [], load: READY, hasMore: false })
      return thread
    },

    async createSpaceThread(title) {
      const spaceId = store.getState().spaceId
      if (!spaceId) return null
      const thread = await mutate(() =>
        ctx.api.call(api.createThread, {
          params: { spaceId },
          body: { visibility: 'space', ...(title ? { title } : {}) },
        }),
      )
      if (!thread) return null
      upsertThread(thread)
      setMessages(thread.id, { list: [], load: READY, hasMore: false })
      return thread
    },

    async post(threadId, content, opts) {
      const thread = controller.thread(threadId)
      const attachments = store.getState().drafts[threadId] ?? []
      if (!thread) {
        store.setState({
          mutation: failed(new ApiClientError('client', 'thread_not_found', 'unknown thread')),
        })
        return null
      }
      if (thread.visibility === 'space' && attachments.length > 0) {
        // Refused here, before any request: a Space thread may only use shared items.
        store.setState({
          mutation: failed(
            new ApiClientError('client', 'attachments_not_allowed', 'Space threads take no pages'),
          ),
        })
        return null
      }
      const model = opts.askAi ? (opts.model ?? deps.modelForMessage()) : null
      const r = await mutate(() =>
        ctx.api.call(api.postMessage, {
          params: { threadId },
          body: {
            content,
            askAi: opts.askAi,
            ...(model ? { model } : {}),
            ...(attachments.length ? { attachments } : {}),
          },
        }),
      )
      if (!r) return null
      const { [threadId]: _sent, ...drafts } = store.getState().drafts
      store.setState({ drafts })
      if (!store.getState().messages[threadId]) {
        setMessages(threadId, { list: [], load: IDLE, hasMore: false })
      }
      upsertMessage(r.message)
      if (r.assistantMessage) upsertMessage(r.assistantMessage)
      if (opts.askAi) deps.messagePosted()
      return r
    },

    async askPrivate(content, opts) {
      const thread = await controller.ensurePrivateThread()
      if (!thread) return null
      return controller.post(thread.id, content, opts)
    },

    async beginAttach(threadId, tabId) {
      const my = ++attachRun
      const thread = controller.thread(threadId)
      if (thread?.visibility !== 'private') {
        // Refused before extracting or sending anything.
        store.setState({ attach: { phase: 'error', threadId, failure: { kind: 'not-allowed' } } })
        return
      }
      if ((store.getState().drafts[threadId]?.length ?? 0) >= MAX_ATTACHMENTS) {
        store.setState({ attach: { phase: 'error', threadId, failure: { kind: 'limit' } } })
        return
      }
      store.setState({ attach: { phase: 'extracting', threadId, tabId } })
      const outcome = await extractTab(ctx.bridge, tabId, await userBlockedHosts(ctx.bridge))
      if (my !== attachRun) return
      store.setState({
        attach: outcome.ok
          ? { phase: 'preview', threadId, tabId, page: outcome.page }
          : { phase: 'error', threadId, failure: { kind: 'capture', outcome } },
      })
    },

    confirmAttach() {
      const a = store.getState().attach
      if (a.phase !== 'preview') return false
      attachRun++
      const drafts = store.getState().drafts
      const list = drafts[a.threadId] ?? []
      store.setState({
        drafts: { ...drafts, [a.threadId]: [...list, a.page].slice(0, MAX_ATTACHMENTS) },
        attach: { phase: 'idle' },
      })
      return true
    },

    cancelAttach() {
      attachRun++
      store.setState({ attach: { phase: 'idle' } })
    },

    removeAttachment(threadId, index) {
      const drafts = store.getState().drafts
      const list = (drafts[threadId] ?? []).filter((_, i) => i !== index)
      store.setState({ drafts: { ...drafts, [threadId]: list } })
    },

    async promote(threadId) {
      const thread = await mutate(() => ctx.api.call(api.shareThread, { params: { threadId } }))
      if (thread) {
        upsertThread(thread)
        // Attachments are not carried over by the server; drop any unsent ones too.
        const { [threadId]: _d, ...drafts } = store.getState().drafts
        store.setState({ drafts })
      }
      return thread
    },

    async remove(threadId) {
      const ok = await mutate(() => ctx.api.call(api.deleteThread, { params: { threadId } }))
      if (ok) dropThread(threadId)
      return ok !== null
    },

    thread(threadId) {
      return store.getState().threads.find((t) => t.id === threadId) ?? null
    },

    handleEvent(e) {
      const spaceId = store.getState().spaceId
      switch (e.type) {
        case 'thread.created':
        case 'thread.updated':
          upsertThread(e.thread)
          return
        case 'thread.deleted':
          if (e.spaceId === spaceId) dropThread(e.threadId)
          return
        case 'message.created':
          upsertMessage(e.message)
          return
        case 'message.delta': {
          let buf = streams.get(e.messageId)
          if (!buf) {
            // Deltas can arrive before the placeholder message itself; buffer them.
            buf = { threadId: e.threadId, nextSeq: 0, text: '', pending: new Map(), sources: null }
            streams.set(e.messageId, buf)
          }
          if (e.seq < buf.nextSeq || buf.pending.has(e.seq)) return // duplicate
          buf.pending.set(e.seq, e.text)
          // Append only the contiguous run; a gap waits for the missing delta or the final message.
          for (
            let next = buf.pending.get(buf.nextSeq);
            next !== undefined;
            next = buf.pending.get(buf.nextSeq)
          ) {
            buf.text += next
            buf.pending.delete(buf.nextSeq)
            buf.nextSeq++
          }
          reproject(e.threadId, e.messageId)
          return
        }
        case 'message.sources': {
          let buf = streams.get(e.messageId)
          if (!buf) {
            buf = { threadId: e.threadId, nextSeq: 0, text: '', pending: new Map(), sources: null }
            streams.set(e.messageId, buf)
          }
          buf.sources = e.citations
          reproject(e.threadId, e.messageId)
          return
        }
        case 'message.completed':
          streams.delete(e.message.id)
          upsertMessage(e.message)
          deps.answerFinished(e.spaceId)
          return
        case 'message.failed': {
          const buf = streams.get(e.messageId)
          streams.delete(e.messageId)
          failures.set(e.messageId, { code: e.code, message: e.message })
          const cur = store.getState().messages[e.threadId]?.list.find((m) => m.id === e.messageId)
          if (cur) {
            upsertMessage({
              ...cur.message,
              status: 'error',
              errorCode: e.code,
              content: cur.message.content || buf?.text || '',
            })
          } else {
            pendingFailures.set(e.messageId, buf?.text ?? '')
          }
          deps.answerFinished(e.spaceId)
          return
        }
        case 'item.deleted':
          markItemUnavailable(e.itemId)
          return
        default:
          return
      }
    },

    reset() {
      streams.clear()
      failures.clear()
      settled.clear()
      pendingFailures.clear()
      attachRun++
      store.setState(initial(), true)
    },
  }
  return controller
}
