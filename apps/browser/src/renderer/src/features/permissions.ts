import type { EngineBridge, PermissionRequest } from '@tiger/shared'
import { useMemo } from 'react'
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

export interface PermissionsModel {
  store: WritableStore<PermissionsState>
  respond(requestId: string, allow: boolean, remember?: boolean): Promise<void>
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
  const offs = [
    deps.bridge.on('permission.request', (r) =>
      store.setState((s) => ({ queue: [...s.queue.filter((q) => q.requestId !== r.requestId), r] })),
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
    async respond(requestId, allow, remember = false) {
      const req = store.getState().queue.find((q) => q.requestId === requestId)
      if (!req) return
      store.setState((s) => ({ queue: s.queue.filter((q) => q.requestId !== requestId) }))
      await deps.bridge
        .invoke('permission.respond', { requestId, allow, remember: remember && canRemember(req) })
        .catch(() => {})
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

export { shallow }
