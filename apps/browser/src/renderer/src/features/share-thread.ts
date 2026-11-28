import {
  type AttachedQuestion,
  type ShareThreadState,
  shareThreadFailureKey,
  type TigerClient,
} from '@tiger/client'
import type { Message, Thread } from '@tiger/shared'
import { useMemo } from 'react'
import { useServices } from '../app/context'
import type { Notice } from '../i18n'
import { useStore } from '../lib/store'
import type { OverlayHost } from '../overlay/host'

/**
 * Sharing the private ask thread with the Space as a NEW Space thread. Every question that had a
 * page attached must be decided (share it with its answers, or leave it out) before confirm is
 * possible; other messages can be left out one by one. Plain data: also the sheet's props.
 */
export type ShareThreadView =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | {
      phase: 'deciding'
      threadId: string
      questions: AttachedQuestion[]
      excluded: string[]
      /** Exactly the messages that would be copied, in order. */
      preview: Message[]
      ready: boolean
    }
  | { phase: 'sending' }
  | { phase: 'done'; thread: Thread }
  | { phase: 'error'; error: Notice }

export type ShareThreadEvent =
  | { type: 'decide'; questionId: string; decision: 'include' | 'exclude' }
  | { type: 'exclude'; messageId: string; excluded: boolean }
  | { type: 'confirm' }
  | { type: 'cancel' }

export function shareThreadView(s: ShareThreadState, preview: () => Message[]): ShareThreadView {
  switch (s.phase) {
    case 'idle':
      return { phase: 'idle' }
    case 'loading':
      return { phase: 'loading' }
    case 'deciding':
      return {
        phase: 'deciding',
        threadId: s.threadId,
        questions: s.questions,
        excluded: [...s.excluded],
        preview: preview(),
        ready: s.ready,
      }
    case 'sending':
      return { phase: 'sending' }
    case 'done':
      return { phase: 'done', thread: s.thread }
    case 'error':
      return { phase: 'error', error: { key: shareThreadFailureKey(s.failure) } }
  }
}

export interface ShareThreadActions {
  /** Start with a thread (default: the private ask thread). */
  begin(threadId?: string | null): Promise<void>
  decide(questionId: string, decision: 'include' | 'exclude'): boolean
  setExcluded(messageId: string, excluded: boolean): boolean
  confirm(): Promise<boolean>
  cancel(): void
  /** Begin and present the sheet; resolves with the new Space thread, or null. */
  present(threadId?: string | null): Promise<Thread | null>
}

export function useShareThread(): ShareThreadView & ShareThreadActions {
  const { client, overlay } = useServices()
  const state = useStore(client.shareThread.store, (s) => s)
  return useMemo(
    () => ({
      ...shareThreadView(state, () => client.shareThread.preview()),
      ...shareThreadActions(client, overlay),
    }),
    [state, client, overlay],
  )
}

export function shareThreadActions(client: TigerClient, overlay: OverlayHost): ShareThreadActions {
  const flow = client.shareThread
  const begin = async (threadId?: string | null) => {
    const id = threadId ?? client.threads.store.getState().privateThreadId
    if (id) await flow.begin(id)
  }
  return {
    begin,
    decide: (q, d) => flow.decide(q, d),
    setExcluded: (m, e) => flow.setExcluded(m, e),
    confirm: () => flow.confirm(),
    cancel: () => flow.cancel(),
    async present(threadId) {
      const view = () => shareThreadView(flow.store.getState(), () => flow.preview())
      const started = begin(threadId)
      const handle = overlay.open(
        'share-thread',
        view(),
        { mode: 'modal' },
        {
          onEvent(e) {
            if (e.type === 'decide') flow.decide(e.questionId, e.decision)
            else if (e.type === 'exclude') flow.setExcluded(e.messageId, e.excluded)
            else if (e.type === 'confirm') void flow.confirm()
            else handle.close('closed')
          },
        },
      )
      const off = flow.store.subscribe(() => {
        const v = view()
        handle.update(v)
        if (v.phase === 'done') handle.close('closed')
      })
      await started
      await handle.outcome
      off()
      const end = flow.store.getState()
      if (end.phase === 'done') return end.thread
      if (end.phase !== 'sending') flow.cancel()
      return null
    },
  }
}
