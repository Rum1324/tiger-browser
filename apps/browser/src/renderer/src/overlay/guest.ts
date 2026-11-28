import { createStore, type WritableStore } from '../lib/store'
import type { DismissReason, GuestTransport, HostMessage, ResolvedPlacement } from './protocol'
import type { OverlaySurfaceName } from './surfaces'

export interface GuestSurface {
  id: string
  surface: OverlaySurfaceName
  props: unknown
  placement: ResolvedPlacement
}

export interface OverlayGuestState {
  current: GuestSurface | null
}

export interface OverlayGuest {
  store: WritableStore<OverlayGuestState>
  /** The surface rendered and took focus: the host may now raise the overlay view. */
  shown(id: string): void
  resolve(id: string, value: unknown): void
  dismiss(id: string, reason: DismissReason): void
  emit(id: string, event: unknown): void
  dispose(): void
}

/**
 * The overlay view's side of the protocol: holds the surface the host asked for and sends back
 * what happened to it. Each id answers once; anything after its result or dismissal is dropped.
 */
export function createOverlayGuest(transport: GuestTransport): OverlayGuest {
  const store = createStore<OverlayGuestState>({ current: null })
  const settled = new Set<string>()

  const live = (id: string) => store.getState().current?.id === id && !settled.has(id)
  const settle = (id: string) => {
    settled.add(id)
    if (settled.size > 64) settled.delete(settled.values().next().value as string)
  }

  const onMessage = (m: HostMessage) => {
    switch (m.t) {
      case 'open':
        store.setState({
          current: { id: m.id, surface: m.surface, props: m.props, placement: m.placement },
        })
        return
      case 'sync':
        store.setState({
          current: m.open
            ? { id: m.open.id, surface: m.open.surface, props: m.open.props, placement: m.open.placement }
            : null,
        })
        return
      case 'update': {
        const c = store.getState().current
        if (c && c.id === m.id) store.setState({ current: { ...c, props: m.props } })
        return
      }
      case 'close':
        if (store.getState().current?.id === m.id) store.setState({ current: null })
        return
    }
  }
  const off = transport.subscribe(onMessage)
  transport.post({ t: 'hello' })

  return {
    store,
    shown(id) {
      if (live(id)) transport.post({ t: 'shown', id })
    },
    resolve(id, value) {
      if (!live(id)) return
      settle(id)
      transport.post({ t: 'result', id, value })
    },
    dismiss(id, reason) {
      if (!live(id)) return
      settle(id)
      transport.post({ t: 'dismiss', id, reason })
    },
    emit(id, event) {
      if (live(id)) transport.post({ t: 'event', id, event })
    },
    dispose() {
      off()
      transport.close()
    },
  }
}
