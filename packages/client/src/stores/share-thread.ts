import { api, type Message, type Thread } from '@tiger/shared'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { type ApiClientError, toClientError } from '../api'
import type { ClientContext } from '../load'

/**
 * Sharing a private thread with the Space, as an explicit state machine like the page share flow:
 *
 *   idle ─begin→ loading ─→ deciding ─confirm→ sending ─→ done
 *                   │          │                  └────→ error
 *                   └→ error   └─cancel→ idle
 *
 * The server copies the chosen messages into a NEW Space thread; the private thread and its pages
 * stay as they are and no page is ever copied. Every question that had a page attached is listed
 * with its answers and must be decided (include or exclude) by the member. Nothing is sent before
 * every one is decided and `confirm()` is called; `confirm()` sends exactly the decisions shown.
 */

/** A question that had a page attached, the answers that followed it, and the member's decision. */
export interface AttachedQuestion {
  question: Message
  /** The assistant messages after the question, up to the next question. */
  answers: Message[]
  /** Null until the member decides. */
  decision: 'include' | 'exclude' | null
}

export type ShareThreadFailure =
  | { kind: 'api'; error: ApiClientError }
  /** Only a private thread of this member can be shared. */
  | { kind: 'not-private' }
  /** Everything is excluded: nothing would be shared. */
  | { kind: 'nothing-to-share' }

export type ShareThreadState =
  | { phase: 'idle' }
  | { phase: 'loading'; threadId: string }
  | {
      phase: 'deciding'
      threadId: string
      /** Every message of the thread, oldest first. */
      messages: Message[]
      /** The attached questions in thread order; each needs a decision. */
      questions: AttachedQuestion[]
      /** Other messages the member chose to leave out (a question's answers go with it). */
      excluded: string[]
      /** Every attached question is decided and something is left to share. */
      ready: boolean
    }
  | { phase: 'sending'; threadId: string }
  | { phase: 'done'; threadId: string; thread: Thread }
  | { phase: 'error'; threadId: string | null; failure: ShareThreadFailure }

export interface ShareThreadController {
  store: StoreApi<ShareThreadState>
  /** Load the whole thread and list its attached questions. Sends nothing but reads. */
  begin(threadId: string): Promise<void>
  /** Decide one attached question. Returns false when it is not one of the listed questions. */
  decide(questionId: string, decision: 'include' | 'exclude'): boolean
  /**
   * Leave out (or put back) a message that is not an attached question. Leaving out a question
   * leaves out its answers too. Returns false for an attached question (use `decide`) or an unknown id.
   */
  setExcluded(messageId: string, excluded: boolean): boolean
  /** The messages the Space thread would hold with the current decisions, in order. */
  preview(): Message[]
  /** Send the decisions. Returns false, sending nothing, unless every question is decided. */
  confirm(): Promise<boolean>
  /** Discard the decisions. Does nothing while `sending`. */
  cancel(): void
  /** Sign-out: clear the flow whatever its phase. */
  reset(): void
}

export interface ShareThreadDeps {
  thread(threadId: string): Thread | null
  /** Called with the new Space thread so the stores can show it before the socket event arrives. */
  shared(thread: Thread): void
}

const PAGE = 200

/** Group a thread into attached questions with their answers (thread order). */
export function attachedQuestions(messages: Message[]): AttachedQuestion[] {
  const out: AttachedQuestion[] = []
  let current: AttachedQuestion | null = null
  for (const m of messages) {
    if (m.role === 'user') {
      current = m.attachments.length > 0 ? { question: m, answers: [], decision: null } : null
      if (current) out.push(current)
    } else if (current) {
      current.answers.push(m)
    }
  }
  return out
}

/** The messages kept: an excluded question takes its answers with it. */
function kept(messages: Message[], questions: AttachedQuestion[], excluded: string[]): Message[] {
  const out = new Set(excluded)
  for (const q of questions) if (q.decision === 'exclude') out.add(q.question.id)
  const result: Message[] = []
  let questionOut = false
  for (const m of messages) {
    if (m.role === 'user') questionOut = out.has(m.id)
    if (questionOut || out.has(m.id)) continue
    result.push(m)
  }
  return result
}

export function createShareThreadFlow(
  ctx: ClientContext,
  deps: ShareThreadDeps,
): ShareThreadController {
  const store = createStore<ShareThreadState>()(() => ({ phase: 'idle' }))
  // Each begin/cancel bumps this, so a late load or response cannot revive a stale flow.
  let run = 0

  function update(patch: Partial<{ questions: AttachedQuestion[]; excluded: string[] }>): boolean {
    const s = store.getState()
    if (s.phase !== 'deciding') return false
    const questions = patch.questions ?? s.questions
    const excluded = patch.excluded ?? s.excluded
    const ready =
      questions.every((q) => q.decision !== null) &&
      kept(s.messages, questions, excluded).length > 0
    store.setState({ ...s, questions, excluded, ready }, true)
    return true
  }

  async function loadAll(threadId: string): Promise<Message[]> {
    const pages: Message[][] = []
    let before: string | undefined
    for (;;) {
      const page = await ctx.api.call(api.listMessages, {
        params: { threadId },
        query: before ? { before, limit: PAGE } : { limit: PAGE },
      })
      pages.unshift(page)
      if (page.length < PAGE || !page[0]) break
      before = page[0].id
    }
    return pages.flat()
  }

  return {
    store,

    async begin(threadId) {
      const my = ++run
      const thread = deps.thread(threadId)
      if (thread && (thread.visibility !== 'private' || thread.owner.id !== ctx.userId())) {
        store.setState({ phase: 'error', threadId, failure: { kind: 'not-private' } }, true)
        return
      }
      store.setState({ phase: 'loading', threadId }, true)
      try {
        const messages = await loadAll(threadId)
        if (my !== run) return
        const questions = attachedQuestions(messages)
        store.setState(
          {
            phase: 'deciding',
            threadId,
            messages,
            questions,
            excluded: [],
            ready: questions.length === 0 && messages.length > 0,
          },
          true,
        )
      } catch (e) {
        if (my === run)
          store.setState(
            { phase: 'error', threadId, failure: { kind: 'api', error: toClientError(e) } },
            true,
          )
      }
    },

    decide(questionId, decision) {
      const s = store.getState()
      if (s.phase !== 'deciding') return false
      if (!s.questions.some((q) => q.question.id === questionId)) return false
      return update({
        questions: s.questions.map((q) => (q.question.id === questionId ? { ...q, decision } : q)),
      })
    },

    setExcluded(messageId, excluded) {
      const s = store.getState()
      if (s.phase !== 'deciding') return false
      if (!s.messages.some((m) => m.id === messageId)) return false
      if (s.questions.some((q) => q.question.id === messageId)) return false
      const rest = s.excluded.filter((id) => id !== messageId)
      return update({ excluded: excluded ? [...rest, messageId] : rest })
    },

    preview() {
      const s = store.getState()
      return s.phase === 'deciding' ? kept(s.messages, s.questions, s.excluded) : []
    },

    async confirm() {
      const s = store.getState()
      if (s.phase !== 'deciding' || !s.questions.every((q) => q.decision !== null)) return false
      const { threadId } = s
      if (kept(s.messages, s.questions, s.excluded).length === 0) {
        store.setState({ phase: 'error', threadId, failure: { kind: 'nothing-to-share' } }, true)
        return false
      }
      const includeAttachedMessageIds = s.questions
        .filter((q) => q.decision === 'include')
        .map((q) => q.question.id)
      const excludeMessageIds = [
        ...s.questions.filter((q) => q.decision === 'exclude').map((q) => q.question.id),
        ...s.excluded,
      ]
      const my = ++run
      store.setState({ phase: 'sending', threadId }, true)
      try {
        const thread = await ctx.api.call(api.shareThread, {
          params: { threadId },
          body: { includeAttachedMessageIds, excludeMessageIds },
        })
        deps.shared(thread)
        if (my === run) store.setState({ phase: 'done', threadId, thread }, true)
        return true
      } catch (e) {
        if (my === run)
          store.setState(
            { phase: 'error', threadId, failure: { kind: 'api', error: toClientError(e) } },
            true,
          )
        return false
      }
    },

    cancel() {
      if (store.getState().phase === 'sending') return
      run++
      store.setState({ phase: 'idle' }, true)
    },

    reset() {
      run++
      store.setState({ phase: 'idle' }, true)
    },
  }
}
