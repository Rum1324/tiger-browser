import type { Download } from '@tiger/shared'
import { useMemo } from 'react'
import { useServices } from '../app/context'
import type { EngineState } from '../engine/engine-state'
import type { Notice } from '../i18n'
import { createStore, useStore, type WritableStore } from '../lib/store'

/**
 * The one transient message (DESIGN.md 10.2, shot 15d): drawn in sidebar pixels above the footer,
 * one at a time; a newer one replaces the older. It is for things that finished somewhere the
 * member is not looking (a download). Sharing has no toast: the capsule says it.
 */
export interface NoticeEntry {
  id: number
  notice: Notice
  /** An action the notice offers, as data the component maps to a call. */
  action: NoticeAction | null
}

export type NoticeAction =
  | { kind: 'open-download'; downloadId: string }
  | { kind: 'show-download'; downloadId: string }

export interface NoticeModel {
  store: WritableStore<{ current: NoticeEntry | null }>
  show(notice: Notice, action?: NoticeAction | null, ms?: number): number
  dismiss(id?: number): void
  dispose(): void
}

export const NOTICE_MS = 6000

export function createNoticeModel(deps: { engine: EngineState }): NoticeModel {
  const store = createStore<{ current: NoticeEntry | null }>({ current: null })
  let seq = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  const model: NoticeModel = {
    store,
    show(notice, action = null, ms = NOTICE_MS) {
      seq += 1
      const id = seq
      if (timer) clearTimeout(timer)
      store.setState({ current: { id, notice, action } })
      timer = setTimeout(() => model.dismiss(id), ms)
      return id
    },
    dismiss(id) {
      const c = store.getState().current
      if (!c || (id !== undefined && c.id !== id)) return
      if (timer) clearTimeout(timer)
      timer = null
      store.setState({ current: null })
    },
    dispose() {
      off()
      if (timer) clearTimeout(timer)
    },
  }
  // A download that finishes while the window is open gets a notice.
  const states = new Map<string, Download['state']>(
    deps.engine.downloads.getState().list.map((d) => [d.id, d.state]),
  )
  const off = deps.engine.downloads.subscribe(({ list }) => {
    for (const d of list) {
      const before = states.get(d.id)
      states.set(d.id, d.state)
      if (before && before !== 'completed' && d.state === 'completed')
        model.show(
          { key: 'notice.downloadDone', vars: { name: d.filename } },
          { kind: 'open-download', downloadId: d.id },
        )
      if (before && before !== 'interrupted' && d.state === 'interrupted')
        model.show({ key: 'notice.downloadFailed', vars: { name: d.filename } }, null)
    }
  })
  return model
}

export interface NoticeView {
  current: NoticeEntry | null
  dismiss(): void
  /** Run the notice's action (and dismiss it). */
  act(): void
}

export function useNotice(): NoticeView {
  const { notices, bridge } = useServices()
  const current = useStore(notices.store, (s) => s.current)
  return useMemo(
    () => ({
      current,
      dismiss: () => notices.dismiss(current?.id),
      act() {
        const a = current?.action
        if (!a) return
        notices.dismiss(current?.id)
        const name = a.kind === 'open-download' ? 'downloads.open' : 'downloads.showInFolder'
        void bridge.invoke(name, { id: a.downloadId }).catch(() => {})
      },
    }),
    [current, notices, bridge],
  )
}
