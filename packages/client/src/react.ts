import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'

/**
 * The optional React binding: `useTigerStore(client.spaces.store, (s) => s.list)`.
 * Selectors must return stable values (a field, not a freshly built object) to avoid re-renders.
 */
export function useTigerStore<S, T>(store: StoreApi<S>, selector: (state: S) => T): T {
  return useStore(store, selector)
}
