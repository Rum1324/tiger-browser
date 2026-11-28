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
 * Window-width rules of DESIGN.md 15.3 item 15. The window is never narrower than 960 (the engine's
 * minimum) and the ask panel is always docked:
 * - `wide`, 1280 and up: sidebar 248, panel 408 (or the widths the member dragged to).
 * - `medium`, 1100 to 1279: the sidebar becomes the 52 px rail while the panel is open; panel 408.
 * - `compact`, under 1100: the same rail while the panel is open, and the panel is 360.
 * The page card never gets narrower than 532: a dragged width gives way first, panel before sidebar.
 * Pure, from the member's choices and the window's CSS width.
 */
export type LayoutMode = 'wide' | 'medium' | 'compact'
export const BREAKPOINTS = { medium: 1100, wide: 1280 } as const
export const LAYOUT_WIDTHS = {
  sidebar: 248,
  rail: 52,
  panel: 408,
  compactPanel: 360,
  minPage: 532,
  /** The stage's gutters around the page card (8 px each side). */
  gutters: 16,
} as const

export interface EffectiveLayout {
  mode: LayoutMode
  sidebar: 'open' | 'rail'
  panel: 'open' | 'closed'
  /** CSS px the sidebar column takes (the rail's width when railed). */
  sidebarWidth: number
  /** CSS px the panel column takes while open. */
  panelWidth: number
}

export function effectiveLayout(
  prefs: Pick<UiPrefs, 'sidebarCollapsed' | 'panelOpen'> &
    Partial<Pick<UiPrefs, 'sidebarWidth' | 'panelWidth'>>,
  windowWidth: number,
): EffectiveLayout {
  const W = LAYOUT_WIDTHS
  const mode: LayoutMode =
    windowWidth >= BREAKPOINTS.wide
      ? 'wide'
      : windowWidth >= BREAKPOINTS.medium
        ? 'medium'
        : 'compact'
  const rail = prefs.sidebarCollapsed || (mode !== 'wide' && prefs.panelOpen)
  let sidebarWidth = rail ? W.rail : (prefs.sidebarWidth ?? W.sidebar)
  let panelWidth = mode === 'compact' ? W.compactPanel : (prefs.panelWidth ?? W.panel)
  const page = () => windowWidth - sidebarWidth - (prefs.panelOpen ? panelWidth : 0) - W.gutters
  if (prefs.panelOpen && page() < W.minPage)
    panelWidth = Math.max(PANEL_WIDTH.min, panelWidth - (W.minPage - page()))
  if (!rail && page() < W.minPage)
    sidebarWidth = Math.max(SIDEBAR_WIDTH.min, sidebarWidth - (W.minPage - page()))
  return {
    mode,
    sidebar: rail ? 'rail' : 'open',
    panel: prefs.panelOpen ? 'open' : 'closed',
    sidebarWidth,
    panelWidth,
  }
}
