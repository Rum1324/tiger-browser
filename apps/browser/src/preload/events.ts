/**
 * Engine events fanned out to the UI's listeners. No Electron import, so it is unit-testable and
 * bundles into the UI preload.
 *
 * Most events describe state and are worthless once missed. An offer is different: `invite.open`
 * can arrive while the UI is still starting (the app was launched by the link), before anyone
 * listens. The latest such event is held and handed to the first listener that subscribes.
 */
type Listener = (payload: unknown) => void

const HELD_UNTIL_HEARD = new Set(['invite.open'])

export interface EventHub {
  dispatch(event: string, payload: unknown): void
  on(event: string, listener: Listener): () => void
}

export function createEventHub(
  onError: (event: string, err: unknown) => void = (event, err) =>
    console.error(`tiger: listener for ${event} threw`, err),
  defer: (fn: () => void) => void = queueMicrotask,
): EventHub {
  const listeners = new Map<string, Set<Listener>>()
  const held = new Map<string, unknown>()

  const call = (event: string, fn: Listener, payload: unknown) => {
    try {
      fn(payload)
    } catch (err) {
      onError(event, err)
    }
  }

  return {
    dispatch(event, payload) {
      const set = listeners.get(event)
      if (!set || set.size === 0) {
        if (HELD_UNTIL_HEARD.has(event)) held.set(event, payload)
        return
      }
      for (const fn of [...set]) call(event, fn, payload)
    },
    on(event, listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function')
      let set = listeners.get(event)
      if (!set) {
        set = new Set()
        listeners.set(event, set)
      }
      set.add(listener)
      if (held.has(event)) {
        const payload = held.get(event)
        held.delete(event)
        // After `on` returns, so the subscriber has its unsubscribe before it hears anything.
        defer(() => {
          if (set.has(listener)) call(event, listener, payload)
          else held.set(event, payload)
        })
      }
      return () => {
        set.delete(listener)
      }
    },
  }
}
