import type { EngineEventName, EngineEventPayload, Settings, Tab, TabsState } from '@tiger/shared'
import { useEffect, useRef } from 'react'
import { useServices } from '../app/context'
import { type Equality, shallow, useStore } from '../lib/store'
import type { WindowState } from './engine-state'

/** A slice of this window's tab state; re-renders only when the slice changes. */
export function useTabsState<T>(selector: (s: TabsState | null) => T, equal?: Equality<T>): T {
  return useStore(useServices().engine.tabs, (s) => selector(s.value), equal)
}

export function useActiveTab(): Tab | null {
  return useTabsState((s) => s?.tabs.find((t) => t.id === s.activeTabId) ?? null)
}

export function useTab(tabId: string | null): Tab | null {
  return useTabsState((s) => (tabId ? (s?.tabs.find((t) => t.id === tabId) ?? null) : null))
}

export function useIsPrivateWindow(): boolean {
  return useTabsState((s) => s?.privateWindow ?? false)
}

/** A slice of the engine settings (null until they load). */
export function useEngineSettings<T>(selector: (s: Settings | null) => T, equal?: Equality<T>): T {
  return useStore(useServices().engine.settings, (s) => selector(s.value), equal)
}

export function useWindowState(): WindowState {
  return useStore(useServices().engine.window, (s) => s, shallow)
}

/**
 * Run `handler` for an engine event while the component is mounted. The handler may change on
 * every render without resubscribing.
 */
export function useEngineEvent<E extends EngineEventName>(
  event: E,
  handler: (payload: EngineEventPayload<E>) => void,
): void {
  const { bridge } = useServices()
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => bridge.on(event, (p) => ref.current(p)), [bridge, event])
}
