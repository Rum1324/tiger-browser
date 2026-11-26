/** A minimal typed event emitter: `on` returns its own unsubscribe, listener errors are isolated. */
export class Emitter<Events extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof Events, Set<(payload: never) => void>>()

  on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener as (payload: never) => void)
    return () => {
      set.delete(listener as (payload: never) => void)
    }
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const l of [...set]) {
      try {
        ;(l as (p: Events[K]) => void)(payload)
      } catch (err) {
        // One broken listener must not stop the others or the socket loop.
        console.error('[tiger/client] listener failed', err)
      }
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}
