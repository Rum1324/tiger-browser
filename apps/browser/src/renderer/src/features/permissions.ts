import type {
  EngineBridge,
  PermissionRequest,
  RememberedPermission,
  SitePermission,
} from '@tiger/shared'
import { useEffect, useMemo } from 'react'
import { useServices } from '../app/context'
import type { EngineState } from '../engine/engine-state'
import { createStore, shallow, useStore, type WritableStore } from '../lib/store'

/**
 * Site permission prompts. The engine asks (`permission.request`) and waits for an answer; the UI
 * shows the active tab's oldest request first. A request whose tab closed is dropped (the engine
 * denies it on its own). `remember` is not offered for screen capture, which is asked every time.
 */
export interface PermissionsState {
  queue: PermissionRequest[]
}

/** The decisions the engine remembers for this window's sites (Settings, 15.3 item 17). */
export interface RememberedState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  list: RememberedPermission[]
}

export interface PermissionsModel {
  store: WritableStore<PermissionsState>
  remembered: WritableStore<RememberedState>
  respond(requestId: string, allow: boolean, remember?: boolean): Promise<void>
  /** Read the remembered decisions again (a private window has none). */
  loadRemembered(): Promise<void>
  /** Forget one decision: the site asks again next time. False if the engine refused. */
  revoke(origin: string, permission: SitePermission): Promise<boolean>
  dispose(): void
}

export function canRemember(p: PermissionRequest): boolean {
  return p.permission !== 'screen-capture'
}

export function createPermissionsModel(deps: {
  bridge: EngineBridge
  engine: EngineState
}): PermissionsModel {
  const store = createStore<PermissionsState>({ queue: [] })
  const remembered = createStore<RememberedState>({ status: 'idle', list: [] })
  let loads = 0
  const loadRemembered = async () => {
    const n = ++loads
    remembered.setState((s) => ({ ...s, status: 'loading' }))
    try {
      const list = await deps.bridge.invoke('permissions.list')
      if (n === loads) remembered.setState({ status: 'ready', list })
    } catch {
      if (n === loads) remembered.setState((s) => ({ ...s, status: 'error' }))
    }
  }
  const offs = [
    deps.bridge.on('permission.request', (r) =>
      store.setState((s) => ({
        queue: [...s.queue.filter((q) => q.requestId !== r.requestId), r],
      })),
    ),
    deps.engine.tabs.subscribe((t) => {
      const ids = new Set(t.value?.tabs.map((x) => x.id) ?? [])
      const { queue } = store.getState()
      const kept = queue.filter((q) => ids.has(q.tabId))
      if (kept.length !== queue.length) store.setState({ queue: kept })
    }),
  ]
  return {
    store,
    remembered,
    async respond(requestId, allow, remember = false) {
      const req = store.getState().queue.find((q) => q.requestId === requestId)
      if (!req) return
      store.setState((s) => ({ queue: s.queue.filter((q) => q.requestId !== requestId) }))
      const kept = remember && canRemember(req)
      await deps.bridge
        .invoke('permission.respond', { requestId, allow, remember: kept })
        .catch(() => {})
      // A list on screen (Settings) shows the new decision.
      if (kept && remembered.getState().status !== 'idle') await loadRemembered()
    },
    loadRemembered,
    async revoke(origin, permission) {
      const same = (p: RememberedPermission) => p.origin === origin && p.permission === permission
      loads++
      remembered.setState((s) => ({ ...s, list: s.list.filter((p) => !same(p)) }))
      try {
        await deps.bridge.invoke('permissions.revoke', { origin, permission })
        return true
      } catch {
        await loadRemembered()
        return false
      }
    },
    dispose() {
      for (const off of offs) off()
    },
  }
}

export interface PermissionPromptsView {
  /** The prompt to show now: the active tab's oldest, or null. */
  current: PermissionRequest | null
  canRemember: boolean
  /** Requests waiting in other tabs (a dot on their tab rows). */
  waitingTabIds: string[]
  allow(remember?: boolean): void
  deny(remember?: boolean): void
}

export function usePermissionPrompts(): PermissionPromptsView {
  const { permissions, engine } = useServices()
  const queue = useStore(permissions.store, (s) => s.queue)
  const activeTabId = useStore(engine.tabs, (s) => s.value?.activeTabId ?? null)
  return useMemo(() => {
    const current = queue.find((q) => q.tabId === activeTabId) ?? null
    const answer = (allow: boolean) => (remember?: boolean) => {
      if (current) void permissions.respond(current.requestId, allow, remember)
    }
    return {
      current,
      canRemember: current ? canRemember(current) : false,
      waitingTabIds: [...new Set(queue.filter((q) => q.tabId !== activeTabId).map((q) => q.tabId))],
      allow: answer(true),
      deny: answer(false),
    }
  }, [queue, activeTabId, permissions])
}

export interface RememberedPermissionsView extends RememberedState {
  revoke(origin: string, permission: SitePermission): Promise<boolean>
  reload(): Promise<void>
}

/** Settings' list of remembered site permissions with 「取り消す」; loads when first shown. */
export function useRememberedPermissions(): RememberedPermissionsView {
  const { permissions } = useServices()
  const state = useStore(permissions.remembered, (s) => s, shallow)
  useEffect(() => {
    void permissions.loadRemembered()
  }, [permissions])
  return useMemo(
    () => ({ ...state, revoke: permissions.revoke, reload: permissions.loadRemembered }),
    [state, permissions],
  )
}

export { shallow }
