import { tabLookupKey, type UrlShareState } from '@tiger/client'
import type { Tab, TabsState } from '@tiger/shared'
import { useMemo } from 'react'
import { useServices } from '../app/context'
import { shallow, useStore } from '../lib/store'

/**
 * The sidebar's split (Rooms): tabs whose page the current Space holds sit on the Space's ground
 * ("what the Space can read"); everything else stays in the pocket ("what stays on this Mac").
 * New tabs are born private. Pinned tabs are listed separately in both cases.
 */
export interface TabRow {
  tab: Tab
  /** The current Space holds this page (any version). */
  inSpace: boolean
  /** Another of the member's Spaces holds it, and the current one does not. */
  elsewhere: boolean
  active: boolean
}

export interface TabsView {
  windowId: string | null
  privateWindow: boolean
  activeTabId: string | null
  activeTab: Tab | null
  pinned: TabRow[]
  /** Tabs the current Space can read, in the member's order. */
  shared: TabRow[]
  /** Tabs that stay on this Mac, in the member's order. */
  local: TabRow[]
  count: number
}

/** Split tabs into the sidebar zones. Pure. */
export function tabZones(
  state: TabsState | null,
  share: Pick<UrlShareState, 'byUrl'>,
  currentSpaceId: string | null,
): TabsView {
  const rows: TabRow[] = (state?.tabs ?? []).map((tab) => {
    const key = tabLookupKey(tab)
    const locations = key ? (share.byUrl[key]?.locations ?? []) : []
    const inSpace = !!currentSpaceId && locations.some((l) => l.spaceId === currentSpaceId)
    return {
      tab,
      inSpace,
      elsewhere: !inSpace && locations.length > 0,
      active: tab.id === state?.activeTabId,
    }
  })
  const activeTab = state?.tabs.find((t) => t.id === state.activeTabId) ?? null
  return {
    windowId: state?.windowId ?? null,
    privateWindow: state?.privateWindow ?? false,
    activeTabId: state?.activeTabId ?? null,
    activeTab,
    pinned: rows.filter((r) => r.tab.pinned),
    shared: rows.filter((r) => !r.tab.pinned && r.inSpace),
    local: rows.filter((r) => !r.tab.pinned && !r.inSpace),
    count: rows.length,
  }
}

export interface TabsActions {
  create(input?: string, opts?: { active?: boolean; background?: boolean }): Promise<Tab | null>
  close(tabId: string): void
  activate(tabId: string): void
  /** Activate the next (+1) or previous (-1) tab, wrapping around, in sidebar order. */
  cycle(step: 1 | -1): void
  move(tabId: string, toIndex: number): void
  setPinned(tabId: string, pinned: boolean): void
  duplicate(tabId: string): void
  reopenClosed(): void
  navigate(tabId: string, input: string): void
  back(tabId: string): void
  forward(tabId: string): void
  reload(tabId: string, ignoreCache?: boolean): void
  stop(tabId: string): void
  setZoom(tabId: string, factor: number): void
}

export function useTabs(): TabsView & TabsActions {
  const { engine, client, bridge } = useServices()
  const state = useStore(engine.tabs, (s) => s.value)
  const byUrl = useStore(client.urlShare.store, (s) => s.byUrl)
  const currentSpaceId = useStore(client.spaces.store, (s) => s.currentSpaceId)
  const view = useMemo(
    () => tabZones(state, { byUrl }, currentSpaceId),
    [state, byUrl, currentSpaceId],
  )
  const actions = useMemo(
    () =>
      tabsActions(
        bridge,
        () => engine.tabs.getState().value,
        () => client.spaces.store.getState().currentSpaceId,
        () => client.urlShare.store.getState(),
      ),
    [bridge, engine, client],
  )
  return { ...view, ...actions }
}

export function tabsActions(
  bridge: import('@tiger/shared').EngineBridge,
  tabs: () => TabsState | null,
  currentSpaceId: () => string | null,
  share: () => Pick<UrlShareState, 'byUrl'>,
): TabsActions {
  const quiet = (p: Promise<unknown>) => void p.catch(() => {})
  return {
    async create(input, opts = {}) {
      try {
        return await bridge.invoke('tabs.create', {
          ...(input ? { input } : {}),
          active: opts.background ? false : (opts.active ?? true),
          spaceId: currentSpaceId(),
        })
      } catch {
        return null
      }
    },
    close: (tabId) => quiet(bridge.invoke('tabs.close', { tabId })),
    activate: (tabId) => quiet(bridge.invoke('tabs.activate', { tabId })),
    cycle(step) {
      const v = tabZones(tabs(), share(), currentSpaceId())
      const order = [...v.pinned, ...v.shared, ...v.local].map((r) => r.tab.id)
      if (order.length < 2) return
      const i = Math.max(0, order.indexOf(v.activeTabId ?? ''))
      const next = order[(i + step + order.length) % order.length] as string
      quiet(bridge.invoke('tabs.activate', { tabId: next }))
    },
    move: (tabId, toIndex) =>
      quiet(bridge.invoke('tabs.move', { tabId, toIndex: Math.max(0, toIndex) })),
    setPinned: (tabId, pinned) => quiet(bridge.invoke('tabs.setPinned', { tabId, pinned })),
    duplicate: (tabId) => quiet(bridge.invoke('tabs.duplicate', { tabId })),
    reopenClosed: () => quiet(bridge.invoke('tabs.reopenClosed')),
    navigate: (tabId, input) => quiet(bridge.invoke('tabs.navigate', { tabId, input })),
    back: (tabId) => quiet(bridge.invoke('tabs.back', { tabId })),
    forward: (tabId) => quiet(bridge.invoke('tabs.forward', { tabId })),
    reload: (tabId, ignoreCache) =>
      quiet(bridge.invoke('tabs.reload', ignoreCache ? { tabId, ignoreCache } : { tabId })),
    stop: (tabId) => quiet(bridge.invoke('tabs.stop', { tabId })),
    setZoom: (tabId, factor) =>
      quiet(bridge.invoke('page.setZoom', { tabId, factor: Math.min(5, Math.max(0.25, factor)) })),
  }
}

/** The tab rows only (for a component that draws the list but not the actions). */
export function useTabZones(): TabsView {
  const { engine, client } = useServices()
  const state = useStore(engine.tabs, (s) => s.value)
  const { byUrl, currentSpaceId } = {
    byUrl: useStore(client.urlShare.store, (s) => s.byUrl),
    currentSpaceId: useStore(client.spaces.store, (s) => s.currentSpaceId),
  }
  return useMemo(() => tabZones(state, { byUrl }, currentSpaceId), [state, byUrl, currentSpaceId])
}

export { shallow }
