import {
  api,
  type Citation,
  type ExtractedPage,
  MESSAGE_ERROR_CODES,
  type Message,
  type MessageErrorCode,
  type ModelRef,
  type Provider,
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

/**
 * A citation as the UI draws it. `versionNumber` is the 第n版 the answer read. An unavailable
 * citation (its item was unshared) carries no name or date: `title`, `url`, `quote`, the sharer's
 * name and `sharedAt` are empty strings, so a view cannot show them by mistake.
 */
export type ViewCitation = Citation

/** Strip what an unavailable citation must not show. */
export function viewCitation(c: Citation): ViewCitation {
  if (c.available) return c
  return {
    ...c,
    title: '',
    url: '',
    quote: '',
    sharedBy: { id: c.sharedBy.id, name: '', avatarUrl: null },
    sharedAt: '',
  }
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
  /**
   * Per thread, index for index with `drafts`: the provider each attachment was confirmed for, or
   * null when it is unconfirmed (the selected model changed to another provider since). An
   * unconfirmed attachment is not sent until `reconfirmAttachments()` names the new provider.
   */
  draftConsent: Record<string, (Provider | null)[]>
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
  /** Add the previewed page to the draft, confirmed for the provider of the model now selected. */
  confirmAttach(): boolean
  /**
   * The selected model changed: attachments confirmed for another provider become unconfirmed.
   * Called by the client whenever the models store's selection changes provider.
   */
  modelChanged(model: ModelRef | null): void
  /** Draft attachments of this thread that must be confirmed again before they can be sent. */
  unconfirmedAttachments(threadId: string): ExtractedPage[]
  /**
   * The member confirmed again, with the current provider named: every attachment of this thread's
   * draft is now confirmed for it. False when no model is known (nothing to name).
   */
  reconfirmAttachments(threadId: string): boolean
  cancelAttach(): void
  removeAttachment(threadId: string, index: number): void
  remove(threadId: string): Promise<boolean>
  thread(threadId: string): Thread | null
  /**
   * Stop an answer that is still streaming (allowed for the member who asked and Space owners).
   * The message ends as `aborted` and keeps the text generated so far. Resolves false when the
   * server refused (see `mutation.error`).
   */
  stop(messageId: string): Promise<boolean>
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

export interface ThreadsOptions {
  /**
   * How long a gap in the delta sequence may last before the thread's messages are refetched to
   * repair it (the server returns a streaming message with the text generated so far).
   */
  gapRepairMs?: number
}

/**
 * The assembled stream of one assistant message. Text = `base` (what the server reported in a
 * listMessages snapshot, covering deltas `0 .. baseSeq-1`, its `streamSeq`) + `text` (the contiguous
 * deltas from `baseSeq` on). `baseSeq` is null only after a streaming snapshot without `streamSeq`;
 * the next delta that arrives then starts the run.
 */
interface StreamBuffer {
  threadId: string
  /** Every delta received, by seq (kept so a snapshot can be aligned with them). */
  received: Map<number, string>
  base: string
  baseSeq: number | null
  text: string
  nextSeq: number
  maxSeq: number
  sources: Citation[] | null
  repairTimer: ReturnType<typeof setTimeout> | null
}

const newBuffer = (threadId: string): StreamBuffer => ({
  threadId,
  received: new Map(),
  base: '',
  baseSeq: 0,
  text: '',
  nextSeq: 0,
  maxSeq: -1,
  sources: null,
  repairTimer: null,
})

const shown = (b: StreamBuffer) => b.base + b.text
const hasGap = (b: StreamBuffer) => b.baseSeq !== null && b.maxSeq >= b.nextSeq

function advance(b: StreamBuffer): void {
  for (let next = b.received.get(b.nextSeq); next !== undefined; next = b.received.get(b.nextSeq)) {
    b.text += next
    b.nextSeq++
  }
}

/**
 * Line a server snapshot up with the deltas this client holds, so that nothing is shown twice and
 * nothing is dropped. The snapshot's text covers deltas `0 .. streamSeq-1`: deltas from `streamSeq`
 * on continue it, earlier ones are already in it. A streaming snapshot always states `streamSeq`;
 * should one not, the next delta this client has not seen yet continues it. A snapshot never moves
 * the text backwards.
 */
function alignStream(b: StreamBuffer, snapshot: string, streamSeq: number | null): void {
  // The text only grows: a snapshot that covers no more than the contiguous text already assembled
  // (one read earlier, delivered late) has nothing to add, and the deltas it predates may be gone.
  if (streamSeq !== null && b.baseSeq !== null && streamSeq <= b.nextSeq) return
  b.base = snapshot
  b.text = ''
  if (streamSeq === null) {
    b.baseSeq = null
    b.nextSeq = b.maxSeq + 1
    return
  }
  b.baseSeq = streamSeq
  b.nextSeq = streamSeq
  advance(b)
}

const MESSAGE_CODES = new Set<string>(MESSAGE_ERROR_CODES)
/** `message.failed.code` is a plain string on the wire; a code this client does not know reads as ai_failed. */
const messageErrorCode = (code: string | undefined): MessageErrorCode =>
  code !== undefined && MESSAGE_CODES.has(code) ? (code as MessageErrorCode) : 'ai_failed'

const activity = (t: Thread) => t.lastMessageAt ?? t.createdAt
const byActivity = (a: Thread, b: Thread) => (activity(a) < activity(b) ? 1 : -1)

const PAGE = 50

export function createThreads(
  ctx: ClientContext,
  deps: ThreadsDeps,
  opts: ThreadsOptions = {},
): ThreadsController {
  const gapRepairMs = opts.gapRepairMs ?? 400
  const initial = (): ThreadsState => ({
    spaceId: null,
    threads: [],
    load: IDLE,
    privateThreadId: null,
    messages: {},
    drafts: {},
    draftConsent: {},
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
  /** listMessages requests by start order, and per thread the latest one whose answer was applied. */
  let listRequests = 0
  const listApplied = new Map<string, number>()
  /** Threads with a post in flight: a second send (double Enter) would post the message twice. */
  const posting = new Set<string>()

  function dropStream(messageId: string): StreamBuffer | undefined {
    const buf = streams.get(messageId)
    if (buf?.repairTimer) clearTimeout(buf.repairTimer)
    streams.delete(messageId)
    return buf
  }

  function bufferFor(messageId: string, threadId: string): StreamBuffer {
    let buf = streams.get(messageId)
    if (!buf) {
      buf = newBuffer(threadId)
      streams.set(messageId, buf)
    }
    return buf
  }

  /** A streaming copy from the server carries the text so far: line the local stream up with it. */
  function absorbSnapshot(message: Message): void {
    if (message.status !== 'streaming') return
    alignStream(bufferFor(message.id, message.threadId), message.content, message.streamSeq)
  }

  function scheduleRepair(messageId: string, buf: StreamBuffer): void {
    if (buf.repairTimer || !hasGap(buf)) return
    buf.repairTimer = setTimeout(() => {
      buf.repairTimer = null
      if (streams.get(messageId) !== buf || !hasGap(buf)) return
      if (store.getState().messages[buf.threadId]) void controller.loadMessages(buf.threadId)
    }, gapRepairMs)
  }

  function project(message: Message): ViewMessage {
    const buf = streams.get(message.id)
    const base = { id: message.id, threadId: message.threadId, message }
    if (message.status === 'streaming') {
      return {
        ...base,
        phase: 'streaming',
        text: buf ? shown(buf) : message.content,
        citations: (buf?.sources ?? []).map(viewCitation),
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
        citations: message.citations.map(viewCitation),
        failure,
      }
    }
    return {
      ...base,
      phase: 'complete',
      text: message.content,
      citations: message.citations.map(viewCitation),
      failure: null,
    }
  }

  function setMessages(threadId: string, patch: Partial<ThreadMessages>): void {
    const s = store.getState()
    const cur = s.messages[threadId] ?? { list: [], load: IDLE, hasMore: false }
    store.setState({ messages: { ...s.messages, [threadId]: { ...cur, ...patch } } })
  }

  /**
   * The freshest known state of a message the server sent: a streaming copy yields to a settled
   * version this client already has, or to a failure reported before the copy arrived. A message
   * settled here is remembered so a later streaming copy cannot roll it back.
   */
  function current(incoming: Message): Message {
    let message =
      incoming.status === 'streaming' ? (settled.get(incoming.id) ?? incoming) : incoming
    const failedText = pendingFailures.get(message.id)
    if (message.status === 'streaming' && failedText !== undefined) {
      const f = failures.get(message.id)
      message = {
        ...message,
        status: 'error',
        errorCode: messageErrorCode(f?.code),
        content: failedText || message.content,
        streamSeq: null,
      }
    }
    pendingFailures.delete(message.id)
    if (message.status !== 'streaming') {
      settled.set(message.id, message)
      dropStream(message.id)
    }
    return message
  }

  /** Insert or replace one message in a loaded thread, keeping server order (oldest first). */
  function upsertMessage(incoming: Message): void {
    const message = current(incoming)
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
    store.setState({ threads: [thread, ...rest].sort(byActivity) })
  }

  function dropThread(threadId: string): void {
    const s = store.getState()
    const { [threadId]: _m, ...messages } = s.messages
    const { [threadId]: _d, ...drafts } = s.drafts
    const { [threadId]: _c, ...draftConsent } = s.draftConsent
    for (const [id, b] of streams) if (b.threadId === threadId) dropStream(id)
    store.setState({
      threads: s.threads.filter((t) => t.id !== threadId),
      messages,
      drafts,
      draftConsent,
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

  const sendFailed = () =>
    new ApiClientError('network', 'send_failed', 'the message did not reach the server')

  /**
   * After a send that got no response: read the thread and look for the message. It counts as sent
   * when a message from this member with exactly this text is there that this client did not know
   * before the send (the newest such one). Null when it is not there or the thread cannot be read.
   */
  async function reconcile(
    threadId: string,
    content: string,
    askAi: boolean,
    known: Set<string>,
  ): Promise<{ message: Message; assistantMessage: Message | null } | null> {
    let fetched: Message[]
    try {
      fetched = await ctx.api.call(api.listMessages, {
        params: { threadId },
        query: { limit: PAGE },
      })
    } catch {
      return null
    }
    const me = ctx.userId()
    let at = -1
    fetched.forEach((m, i) => {
      if (m.role === 'user' && m.author.id === me)
        at = m.content === content && !known.has(m.id) ? i : -1
    })
    const message = fetched[at]
    if (!message) return null
    const next = fetched[at + 1]
    const assistantMessage = askAi && next?.role === 'assistant' ? next : null
    return { message, assistantMessage }
  }

  const controller: ThreadsController = {
    store,

    async load(spaceId) {
      for (const id of [...streams.keys()]) dropStream(id)
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
      const request = ++listRequests
      // Overlapping loads can be answered out of order; one read before a list already shown is stale.
      const stale = () => (listApplied.get(threadId) ?? 0) > request
      setMessages(threadId, { load: LOADING })
      try {
        const fetched = await ctx.api.call(api.listMessages, {
          params: { threadId },
          query: { limit: PAGE },
        })
        if (stale()) return
        listApplied.set(threadId, request)
        // A message settled here or by the server has no use for a stream buffer any more (current()
        // drops it); a streaming one carries the text so far, which repairs any deltas this client lost.
        const list = fetched.map(current)
        for (const m of list) absorbSnapshot(m)
        setMessages(threadId, {
          list: list.map(project),
          load: READY,
          hasMore: list.length === PAGE,
        })
      } catch (e) {
        if (stale()) return
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
        const added = older.filter((m) => !ids.has(m.id)).map(current)
        for (const m of added) absorbSnapshot(m)
        setMessages(threadId, {
          list: [...added.map(project), ...now.list],
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
      const consent = store.getState().draftConsent[threadId] ?? []
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
      if (posting.has(threadId)) return null
      const model = opts.askAi ? (opts.model ?? deps.modelForMessage()) : null
      // A page goes only to the company the member confirmed it for (invariant 1).
      if (
        opts.askAi &&
        attachments.some((_, i) => !model || (consent[i] ?? null) !== model.provider)
      ) {
        store.setState({
          mutation: failed(
            new ApiClientError(
              'client',
              'attachment_unconfirmed',
              'an attachment was not confirmed for this provider',
            ),
          ),
        })
        return null
      }
      posting.add(threadId)
      store.setState({ mutation: LOADING })
      const known = new Set(store.getState().messages[threadId]?.list.map((m) => m.id) ?? [])
      let r: { message: Message; assistantMessage: Message | null } | null = null
      try {
        r = await ctx.api.call(api.postMessage, {
          params: { threadId },
          body: {
            content,
            askAi: opts.askAi,
            ...(model ? { model } : {}),
            ...(attachments.length ? { attachments } : {}),
          },
        })
      } catch (e) {
        const error = toClientError(e)
        // No response does not mean the message did not arrive: ask the thread before saying so.
        r = error.isNetwork ? await reconcile(threadId, content, opts.askAi, known) : null
        if (!r) {
          store.setState({ mutation: failed(error.isNetwork ? sendFailed() : error) })
        }
      } finally {
        posting.delete(threadId)
      }
      if (!r) return null
      store.setState({ mutation: READY })
      // Only the pages that went out leave the draft; one attached while sending stays for the next.
      const sent = new Set(attachments)
      const s = store.getState()
      const keep = (s.drafts[threadId] ?? []).map((p) => !sent.has(p))
      const left = (s.drafts[threadId] ?? []).filter((_, i) => keep[i])
      const leftConsent = (s.draftConsent[threadId] ?? []).filter((_, i) => keep[i])
      const { [threadId]: _sent, ...rest } = s.drafts
      const { [threadId]: _sentConsent, ...restConsent } = s.draftConsent
      store.setState({
        drafts: left.length ? { ...rest, [threadId]: left } : rest,
        draftConsent: left.length ? { ...restConsent, [threadId]: leftConsent } : restConsent,
      })
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
      const { drafts, draftConsent } = store.getState()
      const list = drafts[a.threadId] ?? []
      if (list.length >= MAX_ATTACHMENTS) {
        store.setState({ attach: { phase: 'idle' } })
        return false
      }
      const provider = deps.modelForMessage()?.provider ?? null
      store.setState({
        drafts: { ...drafts, [a.threadId]: [...list, a.page] },
        draftConsent: {
          ...draftConsent,
          [a.threadId]: [...(draftConsent[a.threadId] ?? list.map(() => null)), provider],
        },
        attach: { phase: 'idle' },
      })
      return true
    },

    modelChanged(model) {
      const provider = model?.provider ?? null
      const consent = store.getState().draftConsent
      let changed = false
      const next: Record<string, (Provider | null)[]> = {}
      for (const [threadId, list] of Object.entries(consent)) {
        next[threadId] = list.map((p) => {
          if (p === null || p === provider) return p
          changed = true
          return null
        })
      }
      if (changed) store.setState({ draftConsent: next })
    },

    unconfirmedAttachments(threadId) {
      const provider = deps.modelForMessage()?.provider ?? null
      const consent = store.getState().draftConsent[threadId] ?? []
      return (store.getState().drafts[threadId] ?? []).filter(
        (_, i) => provider === null || (consent[i] ?? null) !== provider,
      )
    },

    reconfirmAttachments(threadId) {
      const provider = deps.modelForMessage()?.provider ?? null
      if (provider === null) return false
      const { drafts, draftConsent } = store.getState()
      const list = drafts[threadId] ?? []
      store.setState({ draftConsent: { ...draftConsent, [threadId]: list.map(() => provider) } })
      return true
    },

    cancelAttach() {
      attachRun++
      store.setState({ attach: { phase: 'idle' } })
    },

    removeAttachment(threadId, index) {
      const { drafts, draftConsent } = store.getState()
      const list = (drafts[threadId] ?? []).filter((_, i) => i !== index)
      const consent = (draftConsent[threadId] ?? []).filter((_, i) => i !== index)
      store.setState({
        drafts: { ...drafts, [threadId]: list },
        draftConsent: { ...draftConsent, [threadId]: consent },
      })
    },

    async remove(threadId) {
      const ok = await mutate(() => ctx.api.call(api.deleteThread, { params: { threadId } }))
      if (ok) dropThread(threadId)
      return ok !== null
    },

    thread(threadId) {
      return store.getState().threads.find((t) => t.id === threadId) ?? null
    },

    async stop(messageId) {
      const ok = await mutate(() => ctx.api.call(api.abortMessage, { params: { messageId } }))
      if (ok === null) return false
      // The server answers once the final state is stored. If its message.failed has not reached
      // this client (socket down), read the settled message instead of waiting.
      const view = Object.values(store.getState().messages)
        .flatMap((tm) => tm.list)
        .find((m) => m.id === messageId)
      if (view?.phase === 'streaming') await controller.loadMessages(view.threadId)
      return true
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
          if (settled.has(e.messageId)) return
          // Deltas can arrive before the placeholder message itself; buffer them.
          const buf = bufferFor(e.messageId, e.threadId)
          if (buf.received.has(e.seq)) return // duplicate
          buf.received.set(e.seq, e.text)
          buf.maxSeq = Math.max(buf.maxSeq, e.seq)
          if (buf.baseSeq === null) {
            // After a snapshot that covered more than this client had seen, the first new delta
            // continues it.
            buf.baseSeq = e.seq
            buf.nextSeq = e.seq
          }
          // Append only the contiguous run; a gap waits for the missing delta, a refetch, or the
          // final message.
          if (e.seq >= buf.nextSeq) advance(buf)
          scheduleRepair(e.messageId, buf)
          reproject(e.threadId, e.messageId)
          return
        }
        case 'message.sources': {
          if (settled.has(e.messageId)) return
          const buf = bufferFor(e.messageId, e.threadId)
          buf.sources = e.citations
          reproject(e.threadId, e.messageId)
          return
        }
        case 'message.completed':
          dropStream(e.message.id)
          upsertMessage(e.message)
          deps.answerFinished(e.spaceId)
          return
        case 'message.failed': {
          const buf = dropStream(e.messageId)
          failures.set(e.messageId, { code: e.code, message: e.message })
          const partial = buf ? shown(buf) : ''
          const cur = store.getState().messages[e.threadId]?.list.find((m) => m.id === e.messageId)
          if (cur) {
            upsertMessage({
              ...cur.message,
              status: 'error',
              errorCode: messageErrorCode(e.code),
              content: partial || cur.message.content,
              streamSeq: null,
            })
            // The server keeps exactly the text it had sent. If this client missed some of it,
            // read the stored message.
            if (buf && hasGap(buf)) void controller.loadMessages(e.threadId)
          } else {
            pendingFailures.set(e.messageId, partial)
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
      for (const id of [...streams.keys()]) dropStream(id)
      posting.clear()
      failures.clear()
      settled.clear()
      pendingFailures.clear()
      attachRun++
      store.setState(initial(), true)
    },
  }
  return controller
}
