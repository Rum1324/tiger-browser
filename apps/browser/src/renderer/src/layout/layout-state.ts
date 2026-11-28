import { DEFAULT_PREFS, type PrefsStorage, type UiPrefs } from '../app/prefs'
import { createStore, type WritableStore } from '../lib/store'

/**
 * Layout choices the member makes (sidebar collapsed, ask panel open, widths) plus a revision counter
 * the page-slot reporter watches: anything that moves the page card without resizing the slot
 * element calls `invalidate()`.
 */
export interface LayoutState extends UiPrefs {
  revision: number
}

export interface Layout {
  store: WritableStore<LayoutState>
  toggleSidebar(): void
  setSidebarCollapsed(collapsed: boolean): void
  togglePanel(): void
  setPanelOpen(open: boolean): void
  setSidebarWidth(px: number | null): void
  setPanelWidth(px: number | null): void
  completeFirstRun(): void
  /** Ask the page-slot reporter to measure again on the next frame. */
  invalidate(): void
}

export const SIDEBAR_WIDTH = { min: 200, max: 320 } as const
export const PANEL_WIDTH = { min: 360, max: 520 } as const

const clamp = (v: number, r: { min: number; max: number }) => Math.min(r.max, Math.max(r.min, v))

export function createLayout(storage: PrefsStorage): Layout {
  const store = createStore<LayoutState>({ ...DEFAULT_PREFS, ...storage.load(), revision: 0 })
  const persist = () => {
    const { revision: _r, ...prefs } = store.getState()
    storage.save(prefs)
  }
  const set = (patch: Partial<UiPrefs>) => {
    store.setState((s) => ({ ...patch, revision: s.revision + 1 }))
    persist()
  }
  return {
    store,
    toggleSidebar: () => set({ sidebarCollapsed: !store.getState().sidebarCollapsed }),
    setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
    togglePanel: () => set({ panelOpen: !store.getState().panelOpen }),
    setPanelOpen: (panelOpen) => set({ panelOpen }),
    setSidebarWidth: (px) => set({ sidebarWidth: px === null ? null : clamp(px, SIDEBAR_WIDTH) }),
    setPanelWidth: (px) => set({ panelWidth: px === null ? null : clamp(px, PANEL_WIDTH) }),
    completeFirstRun: () => set({ firstRunDone: true }),
    invalidate: () => store.setState((s) => ({ revision: s.revision + 1 })),
  }
}

/**
 * Window-width rules of DESIGN.md section 4: from 1100 px everything is as drawn; from 960 to 1099
 * the sidebar becomes the rail while the ask panel is open and comes back when it closes; under
 * 960 the design floats the panel over the stage (`narrow`). Pure, from the member's choices and
 * the window's CSS width.
 */
export type LayoutMode = 'wide' | 'medium' | 'narrow'
export const BREAKPOINTS = { medium: 960, wide: 1100 } as const

export interface EffectiveLayout {
  mode: LayoutMode
  sidebar: 'open' | 'rail'
  panel: 'open' | 'closed'
}

export function effectiveLayout(
  prefs: Pick<UiPrefs, 'sidebarCollapsed' | 'panelOpen'>,
  windowWidth: number,
): EffectiveLayout {
  const mode: LayoutMode =
    windowWidth >= BREAKPOINTS.wide ? 'wide' : windowWidth >= BREAKPOINTS.medium ? 'medium' : 'narrow'
  const railForPanel = mode !== 'wide' && prefs.panelOpen
  return {
    mode,
    sidebar: prefs.sidebarCollapsed || railForPanel ? 'rail' : 'open',
    panel: prefs.panelOpen ? 'open' : 'closed',
  }
}
