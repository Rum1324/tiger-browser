import { aiFailureKey, errorKey, type Load, MAX_ATTACHMENTS, type ViewMessage } from '@tiger/client'
import type { Citation, Thread } from '@tiger/shared'
import { useEffect, useMemo } from 'react'
import { useServices } from '../app/context'
import type { Notice } from '../i18n'
import { shallow, useStore } from '../lib/store'

/** A message as the UI draws it: the client's view plus what the chrome needs to decide. */
export interface MessageView extends ViewMessage {
  mine: boolean
  /** The answer's failure as a message to show (stopped answers included). */
  failureNotice: Notice | null
  /** The member may stop this streaming answer (who asked it, or a Space owner). */
  canStop: boolean
}

export interface ThreadView {
  threadId: string | null
  thread: Thread | null
  messages: MessageView[]
  loading: boolean
  error: Notice | null
  hasMore: boolean
  /** An answer is still being written. */
  streaming: MessageView | null
  /** A post or stop in flight, and its failure. */
  busy: boolean
  mutationError: Notice | null
  loadOlder(): Promise<void>
  stop(messageId?: string): Promise<boolean>
  /** Where a citation chip leads: the shared item's detail, or nothing once unshared. */
  openCitation(c: Citation): void
}

const noticeOf = (load: Load | undefined): Notice | null =>
  load?.status === 'error' && load.error ? { key: errorKey(load.error) } : null

function useThreadView(threadId: string | null): ThreadView {
  const { client, router } = useServices()
  const thread = useStore(client.threads.store, (s) =>
    threadId ? (s.threads.find((t) => t.id === threadId) ?? null) : null,
  )
  const entry = useStore(client.threads.store, (s) => (threadId ? s.messages[threadId] : undefined))
  const mutation = useStore(client.threads.store, (s) => s.mutation)
  const meId = useStore(client.session.store, (s) => s.user?.id ?? null)
  const isOwner = useStore(
    client.spaces.store,
    (s) => s.list.find((x) => x.id === s.currentSpaceId)?.myRole === 'owner',
  )

  // Load the messages the first time this thread is shown.
  useEffect(() => {
    if (threadId && !client.threads.store.getState().messages[threadId])
      void client.threads.loadMessages(threadId)
  }, [threadId, client])

  return useMemo(() => {
    const messages: MessageView[] = (entry?.list ?? []).map((m) => ({
      ...m,
      mine: m.message.author.id === meId,
      failureNotice: m.failure ? { key: aiFailureKey(m.failure.code) } : null,
      canStop:
        m.phase === 'streaming' && m.message.role === 'assistant' && (m.message.author.id === meId || isOwner),
    }))
    const streaming = [...messages].reverse().find((m) => m.phase === 'streaming') ?? null
    return {
      threadId,
      thread,
      messages,
      loading: !entry || entry.load.status === 'loading',
      error: noticeOf(entry?.load),
      hasMore: entry?.hasMore ?? false,
      streaming,
      busy: mutation.status === 'loading',
      mutationError: noticeOf(mutation),
      loadOlder: () => (threadId ? client.threads.loadOlder(threadId) : Promise.resolve()),
      stop: (messageId) => {
        const id = messageId ?? streaming?.id
        return id ? client.threads.stop(id) : Promise.resolve(false)
      },
      openCitation: (c) => {
        if (c.available) router.go({ name: 'item', itemId: c.itemId })
      },
    }
  }, [threadId, thread, entry, mutation, meId, isOwner, client, router])
}

export interface AskPanelView extends ThreadView {
  open: boolean
  /** How many shared items the AI reads in this Space (the composer ledger). */
  sharedCount: number
  attachmentCount: number
  maxAttachments: number
  toggle(): void
  setOpen(open: boolean): void
  /** Ask the Space privately (creates the side-panel thread on first use). */
  ask(text: string): Promise<boolean>
}

/** The right-hand ask panel: the member's private thread in the current Space. */
export function useAskPanel(): AskPanelView {
  const { client, layout } = useServices()
  const open = useStore(layout.store, (s) => s.panelOpen)
  const privateThreadId = useStore(client.threads.store, (s) => s.privateThreadId)
  const attachmentCount = useStore(client.threads.store, (s) =>
    s.privateThreadId ? (s.drafts[s.privateThreadId]?.length ?? 0) : 0,
  )
  const sharedCount = useStore(client.items.store, (s) => s.items.length)
  const view = useThreadView(open ? privateThreadId : null)
  return useMemo(
    () => ({
      ...view,
      open,
      sharedCount,
      attachmentCount,
      maxAttachments: MAX_ATTACHMENTS,
      toggle: () => layout.togglePanel(),
      setOpen: (o) => layout.setPanelOpen(o),
      async ask(text) {
        const content = text.trim()
        if (!content) return false
        if (!layout.store.getState().panelOpen) layout.setPanelOpen(true)
        return (await client.threads.askPrivate(content, { askAi: true })) !== null
      },
    }),
    [view, open, sharedCount, attachmentCount, client, layout],
  )
}

export interface SpaceThreadView extends ThreadView {
  /** Post to the Space thread; with `askAi` the Space's AI answers from shared items only. */
  post(text: string, askAi: boolean): Promise<boolean>
}

/** A Space thread (visible to every member). Page attachments are never allowed here. */
export function useSpaceThread(threadId: string | null): SpaceThreadView {
  const { client } = useServices()
  const view = useThreadView(threadId)
  return useMemo(
    () => ({
      ...view,
      async post(text, askAi) {
        const content = text.trim()
        if (!threadId || !content) return false
        return (await client.threads.post(threadId, content, { askAi })) !== null
      },
    }),
    [view, threadId, client],
  )
}

export interface ThreadListView {
  spaceThreads: Thread[]
  privateThreads: Thread[]
  loading: boolean
  error: Notice | null
  create(title?: string): Promise<Thread | null>
  remove(threadId: string): Promise<boolean>
  /** Show a thread on the Space home. */
  show(threadId: string): void
}

export function useThreadList(): ThreadListView {
  const { client, router } = useServices()
  const s = useStore(client.threads.store, (x) => ({ threads: x.threads, load: x.load }), shallow)
  return useMemo(
    () => ({
      spaceThreads: s.threads.filter((t) => t.visibility === 'space'),
      privateThreads: s.threads.filter((t) => t.visibility === 'private'),
      loading: s.load.status === 'loading',
      error: noticeOf(s.load),
      async create(title) {
        const t = await client.threads.createSpaceThread(title)
        if (t) router.go({ name: 'space-home', section: 'threads', threadId: t.id })
        return t
      },
      remove: (id) => client.threads.remove(id),
      show: (id) => router.go({ name: 'space-home', section: 'threads', threadId: id }),
    }),
    [s, client, router],
  )
}

/** Split an answer's text at its `[n]` markers, for drawing citation chips inline. Pure. */
export type AnswerPart = { kind: 'text'; text: string } | { kind: 'cite'; n: number; citation: Citation | null }

export function answerParts(text: string, citations: readonly Citation[]): AnswerPart[] {
  const parts: AnswerPart[] = []
  const re = /\[(\d{1,3})\]/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push({ kind: 'text', text: text.slice(last, m.index) })
    const n = Number(m[1])
    parts.push({ kind: 'cite', n, citation: citations.find((c) => c.n === n) ?? null })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}
