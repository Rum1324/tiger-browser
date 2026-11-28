import { useCallback, useRef, useSyncExternalStore } from 'react'

/**
 * The read side every store in the UI shares: @tiger/client's zustand stores and the UI's own stores
 * below both fit it, so one hook reads either.
 */
export interface ReadableStore<S> {
  getState(): S
  subscribe(listener: (state: S, previous: S) => void): () => void
}

export interface WritableStore<S> extends ReadableStore<S> {
  setState(patch: Partial<S> | ((state: S) => Partial<S>)): void
  /** Replace the whole state (for union-typed states where a partial merge makes no sense). */
  replace(next: S): void
}

/** A minimal vanilla store for the UI's own state (router, layout, overlay, feature models). */
export function createStore<S extends object>(initial: S): WritableStore<S> {
  let state = initial
  const listeners = new Set<(s: S, p: S) => void>()
  const emit = (next: S) => {
    if (Object.is(next, state)) return
    const previous = state
    state = next
    for (const l of [...listeners]) l(state, previous)
  }
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setState(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch
      const keys = Object.keys(p) as (keyof S)[]
      if (keys.every((k) => Object.is(state[k], p[k]))) return
      emit({ ...state, ...p })
    },
    replace: emit,
  }
}

export type Equality<T> = (a: T, b: T) => boolean

/** Equal when both are the same value, or objects/arrays whose own entries are the same values. */
export function shallow<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.hasOwn(b, k)) return false
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
      return false
  }
  return true
}

/**
 * Read a slice of a store. The component re-renders only when the selected value changes under
 * `equal` (default `Object.is`; pass `shallow` for a selector that builds an object or array).
 * The last selection is kept, so a selector may build a fresh object without looping.
 */
export function useStore<S, T>(
  store: ReadableStore<S>,
  selector: (state: S) => T,
  equal: Equality<T> = Object.is,
): T {
  const last = useRef<{ state: S; value: T } | null>(null)
  const sel = useRef(selector)
  sel.current = selector
  const eq = useRef(equal)
  eq.current = equal

  const getSnapshot = useCallback((): T => {
    const state = store.getState()
    const prev = last.current
    if (prev && Object.is(prev.state, state)) return prev.value
    const value = sel.current(state)
    if (prev && eq.current(prev.value, value)) {
      last.current = { state, value: prev.value }
      return prev.value
    }
    last.current = { state, value }
    return value
  }, [store])

  const subscribe = useCallback((onChange: () => void) => store.subscribe(onChange), [store])
  // A new selector (e.g. a different id) must be applied even if the store did not change.
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const fresh = selector(store.getState())
  if (last.current && !eq.current(last.current.value, fresh)) {
    last.current = { state: store.getState(), value: fresh }
    return fresh
  }
  return value
}
