import type { EngineBridge } from '@tiger/shared'
import { useMemo } from 'react'
import { useServices } from '../app/context'
import type { EngineState } from '../engine/engine-state'
import { createStore, shallow, useStore, type WritableStore } from '../lib/store'

/**
 * Find in page, for the active tab. Opening it does nothing until there is text; each change of
 * text starts a new search, next/previous continue it, and closing (or switching tab) stops it
 * and clears the highlights.
 */
export interface FindState {
  open: boolean
  tabId: string | null
  text: string
  matches: number
  /** 1-based; 0 when there is no match. */
  activeMatch: number
  /** Increases on every `open()`, so the field can focus and select its text. */
  focusRequest: number
}

export interface FindModel {
  store: WritableStore<FindState>
  open(): void
  setText(text: string): void
  next(): void
  previous(): void
  close(): void
  dispose(): void
}

export function createFindModel(deps: { bridge: EngineBridge; engine: EngineState }): FindModel {
  const { bridge, engine } = deps
  const store = createStore<FindState>({
    open: false,
    tabId: null,
    text: '',
    matches: 0,
    activeMatch: 0,
    focusRequest: 0,
  })
  const activeTabId = () => engine.tabs.getState().value?.activeTabId ?? null
  const quiet = (p: Promise<unknown>) => void p.catch(() => {})

  const search = (forward: boolean, findNext: boolean) => {
    const { tabId, text } = store.getState()
    if (!tabId || !text) return
    quiet(bridge.invoke('page.find', { tabId, text, forward, findNext }))
  }
  const stop = () => {
    const { tabId } = store.getState()
    if (tabId) quiet(bridge.invoke('page.stopFind', { tabId }))
  }

  const model: FindModel = {
    store,
    open() {
      const tabId = activeTabId()
      if (!tabId) return
      const s = store.getState()
      if (s.open && s.tabId !== tabId) stop()
      store.setState({ open: true, tabId, focusRequest: s.focusRequest + 1 })
      if (s.text && s.tabId !== tabId) search(true, false)
    },
    setText(text) {
      const s = store.getState()
      if (!s.open) return
      store.setState({ text, matches: 0, activeMatch: 0 })
      if (text) search(true, false)
      else stop()
    },
    next: () => search(true, true),
    previous: () => search(false, true),
    close() {
      if (!store.getState().open) return
      stop()
      store.setState({ open: false, tabId: null, matches: 0, activeMatch: 0 })
    },
    dispose() {
      for (const off of offs) off()
    },
  }

  const offs = [
    bridge.on('page.findResult', (r) => {
      const s = store.getState()
      if (s.open && r.tabId === s.tabId)
        store.setState({ matches: r.matches, activeMatch: r.activeMatch })
    }),
    // Switching tab (or the tab closing) ends the search of the old one.
    engine.tabs.subscribe((t) => {
      const s = store.getState()
      if (s.open && t.value?.activeTabId !== s.tabId) model.close()
    }),
  ]
  return model
}

export interface FindView extends FindState {
  /** Open the find bar for the active tab (the `find` shortcut). */
  show(): void
  setText(text: string): void
  next(): void
  previous(): void
  close(): void
}

export function useFindInPage(): FindView {
  const { find } = useServices()
  const state = useStore(find.store, (s) => s, shallow)
  return useMemo(
    () => ({
      ...state,
      show: find.open,
      setText: find.setText,
      next: find.next,
      previous: find.previous,
      close: find.close,
    }),
    [state, find],
  )
}
