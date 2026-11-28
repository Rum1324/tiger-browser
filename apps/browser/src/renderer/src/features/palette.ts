import type { EngineBridge, HistoryEntry, Suggestion } from '@tiger/shared'
import { useMemo } from 'react'
import {
  availableCommands,
  type CommandDescriptor,
  type PaletteChoice,
  type PaletteGroup,
  runPaletteChoice,
} from '../app/commands'
import { useServices } from '../app/context'
import type { AppServices } from '../app/services'
import { createStore, shallow, useStore, type WritableStore } from '../lib/store'

/**
 * The command palette. The main view opens it in the overlay with the commands that apply now; the
 * overlay view runs the model below (query, the engine's suggestions, keyboard selection) and
 * returns a choice, which the main view carries out.
 */
export type PaletteMode = 'commands' | 'history'

export interface PaletteProps {
  mode: PaletteMode
  initialQuery: string
  commands: CommandDescriptor[]
}

export type PaletteRow =
  | { kind: 'command'; group: 'commands'; command: CommandDescriptor }
  | { kind: 'suggestion'; group: PaletteGroup; suggestion: Suggestion }

const GROUP_OF: Record<Suggestion['kind'], PaletteGroup> = {
  tab: 'tabs',
  history: 'history',
  bookmark: 'bookmarks',
  url: 'go',
  search: 'go',
}
const GROUP_ORDER: PaletteGroup[] = ['commands', 'tabs', 'bookmarks', 'history', 'go']
const MAX_COMMANDS = 8

/**
 * Rank and group the rows for a query. Commands match on their label and keywords (prefix matches
 * first); suggestions come from the engine already ranked. Pure.
 */
export function paletteRows(
  query: string,
  commands: readonly CommandDescriptor[],
  suggestions: readonly Suggestion[],
  labelOf: (c: CommandDescriptor) => string,
): PaletteRow[] {
  const q = query.trim().toLowerCase()
  const scored = commands
    .map((command) => {
      if (!q) return { command, score: 1 }
      const words = [labelOf(command), ...command.keywords].map((w) => w.toLowerCase())
      const score = words.some((w) => w.startsWith(q)) ? 3 : words.some((w) => w.includes(q)) ? 2 : 0
      return { command, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_COMMANDS)
  const rows: PaletteRow[] = scored.map(({ command }) => ({ kind: 'command', group: 'commands', command }))
  for (const s of suggestions) rows.push({ kind: 'suggestion', group: GROUP_OF[s.kind], suggestion: s })
  return rows.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
}

export function historySuggestions(entries: readonly HistoryEntry[]): Suggestion[] {
  return entries.map((h) => ({ kind: 'history', title: h.title, url: h.url, tabId: null }))
}

export interface PaletteState {
  query: string
  suggestions: Suggestion[]
  rows: PaletteRow[]
  selected: number
}

export interface PaletteModel {
  store: WritableStore<PaletteState>
  setQuery(query: string): void
  move(step: 1 | -1): void
  select(index: number): void
  /** The choice for the selected row, or the typed text when nothing is selected. */
  choice(): PaletteChoice | null
  /** Arrow keys and Enter; returns the choice on Enter (Escape is the overlay's). */
  handleKey(key: string): { handled: boolean; choice: PaletteChoice | null }
  dispose(): void
}

/** The overlay side of the palette: runs in the overlay view with its own engine bridge. */
export function createPaletteModel(deps: {
  bridge: Pick<EngineBridge, 'invoke'>
  props: PaletteProps
  labelOf: (c: CommandDescriptor) => string
  debounceMs?: number
}): PaletteModel {
  const { bridge, props, labelOf } = deps
  const store = createStore<PaletteState>({
    query: props.initialQuery,
    suggestions: [],
    rows: paletteRows(props.initialQuery, props.mode === 'commands' ? props.commands : [], [], labelOf),
    selected: 0,
  })
  let query = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  const commands = props.mode === 'commands' ? props.commands : []

  const fetch = (text: string) => {
    const my = ++query
    if (timer) clearTimeout(timer)
    timer = setTimeout(async () => {
      timer = null
      let suggestions: Suggestion[] = []
      try {
        suggestions =
          props.mode === 'history'
            ? historySuggestions(await bridge.invoke('history.search', { query: text, limit: 50 }))
            : text.trim()
              ? await bridge.invoke('suggest.query', { input: text.slice(0, 2000) })
              : []
      } catch {
        suggestions = []
      }
      if (my !== query) return
      store.setState({ suggestions, rows: paletteRows(text, commands, suggestions, labelOf), selected: 0 })
    }, deps.debounceMs ?? 60)
  }

  const model: PaletteModel = {
    store,
    setQuery(q) {
      const { suggestions } = store.getState()
      store.setState({ query: q, rows: paletteRows(q, commands, suggestions, labelOf), selected: 0 })
      fetch(q)
    },
    move(step) {
      const { rows, selected } = store.getState()
      if (!rows.length) return
      store.setState({ selected: (selected + step + rows.length) % rows.length })
    },
    select(index) {
      const { rows } = store.getState()
      if (index >= 0 && index < rows.length) store.setState({ selected: index })
    },
    choice() {
      const { rows, selected, query: q } = store.getState()
      const row = rows[selected]
      if (row?.kind === 'command') return { kind: 'command', id: row.command.id }
      if (row?.kind === 'suggestion') return { kind: 'suggestion', suggestion: row.suggestion }
      return q.trim() ? { kind: 'text', text: q.trim() } : null
    },
    handleKey(key) {
      if (key === 'ArrowDown') {
        model.move(1)
        return { handled: true, choice: null }
      }
      if (key === 'ArrowUp') {
        model.move(-1)
        return { handled: true, choice: null }
      }
      if (key === 'Enter') return { handled: true, choice: model.choice() }
      return { handled: false, choice: null }
    },
    dispose() {
      if (timer) clearTimeout(timer)
      query++
    },
  }
  // History mode lists recent history at once.
  if (props.mode === 'history' || props.initialQuery) fetch(props.initialQuery)
  return model
}

// ── Main-view side ───────────────────────────────────────────────────────────

export interface PaletteView {
  open: boolean
  show(mode?: PaletteMode, initialQuery?: string): Promise<void>
  hide(): void
  toggle(mode?: PaletteMode): void
}

export async function presentPalette(s: AppServices, mode: PaletteMode = 'commands', initialQuery = ''): Promise<void> {
  const handle = s.overlay.open(
    'palette',
    { mode, initialQuery, commands: availableCommands(s) },
    { mode: 'modal' },
  )
  const outcome = await handle.outcome
  if (outcome.status === 'result') runPaletteChoice(s, outcome.value)
}

export function usePalette(): PaletteView {
  const services = useServices()
  const open = useStore(services.overlay.store, (s) => s.open?.surface === 'palette')
  return useMemo(
    () => ({
      open,
      show: (mode, q) => presentPalette(services, mode, q),
      hide: () => {
        if (services.overlay.store.getState().open?.surface === 'palette') services.overlay.closeAll('closed')
      },
      toggle: (mode) => {
        if (services.overlay.store.getState().open?.surface === 'palette') services.overlay.closeAll('closed')
        else if (!services.overlay.justDismissed('palette')) void presentPalette(services, mode)
      },
    }),
    [open, services],
  )
}

export { shallow }
