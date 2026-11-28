import type { EngineBridge, Suggestion } from '@tiger/shared'
import { useMemo } from 'react'
import { useServices } from '../app/context'
import type { EngineState } from '../engine/engine-state'
import { createStore, shallow, useStore, type WritableStore } from '../lib/store'

/**
 * The address field: what the member types, the engine's suggestions for it (history, bookmarks,
 * open tabs, search; computed on this machine by `suggest.query`), keyboard selection, and what
 * Enter does. While not editing, the text follows the active tab's URL.
 */
export interface OmniboxState {
  editing: boolean
  text: string
  suggestions: Suggestion[]
  /** -1 = the typed text itself. */
  selected: number
  /** Increases on `focus-address` so the field can select its text. */
  focusRequest: number
}

export interface OmniboxModel {
  store: WritableStore<OmniboxState>
  /** The field gained focus: start editing from the current URL. */
  begin(): void
  setText(text: string): void
  move(step: 1 | -1): void
  select(index: number): void
  /** Go: the selected suggestion, or the typed text (URL or search). Returns what was done. */
  commit(opts?: { newTab?: boolean }): Promise<'navigated' | 'switched' | 'created' | 'nothing'>
  /** Escape: first revert the suggestions, then the text. */
  escape(): 'closed-suggestions' | 'reverted'
  /** The field lost focus. */
  end(): void
  /** The `focus-address` shortcut. */
  requestFocus(): void
  /** Arrow keys, Enter, Escape. Returns true when the key was handled (call preventDefault). */
  handleKey(key: string, mods?: { alt?: boolean; meta?: boolean; ctrl?: boolean }): boolean
  dispose(): void
}

const SUGGEST_DEBOUNCE_MS = 60

export function createOmniboxModel(deps: {
  bridge: EngineBridge
  engine: EngineState
  debounceMs?: number
}): OmniboxModel {
  const { bridge, engine } = deps
  const activeUrl = () => {
    const s = engine.tabs.getState().value
    return s?.tabs.find((t) => t.id === s.activeTabId)?.url ?? ''
  }
  const store = createStore<OmniboxState>({
    editing: false,
    text: activeUrl(),
    suggestions: [],
    selected: -1,
    focusRequest: 0,
  })
  let query = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const off = engine.tabs.subscribe(() => {
    if (!store.getState().editing) store.setState({ text: activeUrl() })
  })

  const fetchSuggestions = (text: string) => {
    if (timer) clearTimeout(timer)
    const my = ++query
    if (!text.trim()) {
      store.setState({ suggestions: [], selected: -1 })
      return
    }
    timer = setTimeout(() => {
      timer = null
      bridge
        .invoke('suggest.query', { input: text.slice(0, 2000) })
        .then((suggestions) => {
          // A late answer for older text is dropped.
          if (my === query && store.getState().editing)
            store.setState({ suggestions, selected: -1 })
        })
        .catch(() => {
          if (my === query) store.setState({ suggestions: [] })
        })
    }, deps.debounceMs ?? SUGGEST_DEBOUNCE_MS)
  }

  const model: OmniboxModel = {
    store,
    begin() {
      if (!store.getState().editing)
        store.setState({ editing: true, text: activeUrl(), selected: -1 })
    },
    setText(text) {
      store.setState({ editing: true, text })
      fetchSuggestions(text)
    },
    move(step) {
      const { suggestions, selected } = store.getState()
      if (!suggestions.length) return
      const n = suggestions.length
      // -1 (the typed text) is part of the cycle.
      const next = ((selected + 1 + step + (n + 1)) % (n + 1)) - 1
      store.setState({ selected: next })
    },
    select(index) {
      const n = store.getState().suggestions.length
      store.setState({ selected: index >= -1 && index < n ? index : -1 })
    },
    async commit(opts = {}) {
      const { suggestions, selected, text } = store.getState()
      const s = selected >= 0 ? suggestions[selected] : undefined
      const tabs = engine.tabs.getState().value
      const active = tabs?.activeTabId ?? null
      query++
      store.setState({ editing: false, suggestions: [], selected: -1 })
      try {
        if (s?.kind === 'tab' && s.tabId) {
          await bridge.invoke('tabs.activate', { tabId: s.tabId })
          return 'switched'
        }
        const input = s ? s.url : text.trim()
        if (!input) return 'nothing'
        if (opts.newTab || !active) {
          await bridge.invoke('tabs.create', { input })
          return 'created'
        }
        await bridge.invoke('tabs.navigate', { tabId: active, input })
        return 'navigated'
      } catch {
        return 'nothing'
      } finally {
        store.setState({ text: activeUrl() })
      }
    },
    escape() {
      if (store.getState().suggestions.length) {
        query++
        store.setState({ suggestions: [], selected: -1 })
        return 'closed-suggestions'
      }
      store.setState({ text: activeUrl(), editing: false })
      return 'reverted'
    },
    end() {
      query++
      if (timer) clearTimeout(timer)
      store.setState({ editing: false, suggestions: [], selected: -1, text: activeUrl() })
    },
    requestFocus() {
      store.setState((s) => ({
        focusRequest: s.focusRequest + 1,
        editing: true,
        text: activeUrl(),
      }))
    },
    handleKey(key, mods = {}) {
      switch (key) {
        case 'ArrowDown':
          model.move(1)
          return true
        case 'ArrowUp':
          model.move(-1)
          return true
        case 'Enter':
          void model.commit({ newTab: !!(mods.alt || mods.meta || mods.ctrl) })
          return true
        case 'Escape':
          model.escape()
          return true
        default:
          return false
      }
    },
    dispose() {
      off()
      if (timer) clearTimeout(timer)
    },
  }
  return model
}

export interface OmniboxView extends OmniboxState {
  /** The suggestion Enter would open, or null for the typed text. */
  current: Suggestion | null
}

export function useOmnibox(): OmniboxView & Omit<OmniboxModel, 'store' | 'dispose'> {
  const { omnibox } = useServices()
  const state = useStore(omnibox.store, (s) => s, shallow)
  return useMemo(
    () => ({
      ...state,
      current: state.selected >= 0 ? (state.suggestions[state.selected] ?? null) : null,
      begin: omnibox.begin,
      setText: omnibox.setText,
      move: omnibox.move,
      select: omnibox.select,
      commit: omnibox.commit,
      escape: omnibox.escape,
      end: omnibox.end,
      requestFocus: omnibox.requestFocus,
      handleKey: omnibox.handleKey,
    }),
    [state, omnibox],
  )
}
