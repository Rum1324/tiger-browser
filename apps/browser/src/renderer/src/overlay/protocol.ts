import type { Rect } from '@tiger/shared'
import type { OverlaySurfaceName } from './surfaces'

/**
 * The overlay protocol: the main UI view (host) asks the overlay view (guest) to show a surface
 * (palette, menu, sheet) with props, and gets back a result or a dismissal. The two views are
 * separate pages of the same origin in the same session, so they talk over a BroadcastChannel
 * named after the window; messages are structured-cloned, so props, events and results must be
 * plain data (no functions, no class instances).
 *
 *   host                                   guest (overlay view)
 *   open(id, surface, props, placement) →  renders it, moves focus into it
 *                                       ←  shown(id)        host: overlay.setOpen(true, bounds)
 *   update(id, props)                   →  re-renders
 *                                       ←  event(id, data)  (a sheet's intermediate action)
 *                                       ←  result(id, value) | dismiss(id, reason)
 *   overlay.setOpen(false); close(id)   →  clears
 *
 * A guest that starts (or reloads) says `hello`; the host answers with `sync` (what should be open).
 */

export const PROTOCOL_VERSION = 1

export type DismissReason =
  /** Escape pressed in the surface. */
  | 'escape'
  /** A click outside the surface (full-window surfaces) or in the main view. */
  | 'outside'
  /** The overlay view lost focus: a click on the page or the main view around a popover. */
  | 'blur'
  /** Another surface was opened in its place. */
  | 'replaced'
  /** The host closed it (navigation, sign-out, a shortcut toggled it). */
  | 'closed'
  /** The overlay view did not answer in time. */
  | 'unavailable'

export type Side = 'below' | 'above' | 'start' | 'end'
export type Align = 'start' | 'center' | 'end'

/**
 * Where a surface goes. `modal`: the overlay covers the whole window (bounds null) and takes every
 * click; a click outside the surface dismisses it. `popover`: a tight rectangle next to an anchor;
 * the page and the main view stay clickable around it.
 */
export type Placement =
  | { mode: 'modal'; anchor?: Rect }
  | {
      mode: 'popover'
      anchor: Rect
      size: { width: number; height: number }
      side?: Side
      align?: Align
      /** Gap between anchor and popover, CSS px. */
      offset?: number
    }

/** What the guest receives: the placement plus the overlay view's bounds in window coordinates. */
export type ResolvedPlacement =
  | { mode: 'modal'; anchor: Rect | null }
  | { mode: 'popover'; bounds: Rect; side: Side }

export interface OpenMessage {
  t: 'open'
  id: string
  surface: OverlaySurfaceName
  props: unknown
  placement: ResolvedPlacement
}

export type HostMessage =
  | OpenMessage
  | { t: 'update'; id: string; props: unknown }
  | { t: 'close'; id: string }
  | { t: 'sync'; open: OpenMessage | null }

export type GuestMessage =
  | { t: 'hello' }
  | { t: 'shown'; id: string }
  | { t: 'result'; id: string; value: unknown }
  | { t: 'dismiss'; id: string; reason: DismissReason }
  | { t: 'event'; id: string; event: unknown }

type Envelope<M> = { v: typeof PROTOCOL_VERSION; from: 'host' | 'guest'; m: M }

export interface Transport<Out, In> {
  post(message: Out): void
  subscribe(listener: (message: In) => void): () => void
  close(): void
}
export type HostTransport = Transport<HostMessage, GuestMessage>
export type GuestTransport = Transport<GuestMessage, HostMessage>

const HOST_TYPES = new Set(['open', 'update', 'close', 'sync'])
const GUEST_TYPES = new Set(['hello', 'shown', 'result', 'dismiss', 'event'])

/** Accept only well-formed envelopes from the other side; anything else is ignored. */
export function readEnvelope<M>(data: unknown, from: 'host' | 'guest'): M | null {
  if (typeof data !== 'object' || data === null) return null
  const e = data as Partial<Envelope<{ t?: unknown; id?: unknown }>>
  if (e.v !== PROTOCOL_VERSION || e.from !== from || typeof e.m !== 'object' || e.m === null)
    return null
  const t = e.m.t
  if (typeof t !== 'string' || !(from === 'host' ? HOST_TYPES : GUEST_TYPES).has(t)) return null
  if (t !== 'hello' && t !== 'sync' && typeof e.m.id !== 'string') return null
  return e.m as M
}

export function channelName(windowId: string): string {
  return `tiger.overlay.${windowId}`
}

interface ChannelLike {
  postMessage(data: unknown): void
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void
  removeEventListener(type: 'message', listener: (e: MessageEvent) => void): void
  close(): void
}

/** A transport over a BroadcastChannel (the real one between the two views of one window). */
export function broadcastTransport<Out, In>(
  side: 'host' | 'guest',
  channel: ChannelLike,
): Transport<Out, In> {
  const other = side === 'host' ? 'guest' : 'host'
  return {
    post(m) {
      channel.postMessage({ v: PROTOCOL_VERSION, from: side, m } satisfies Envelope<Out>)
    },
    subscribe(listener) {
      const l = (e: MessageEvent) => {
        const m = readEnvelope<In>(e.data, other)
        if (m) listener(m)
      }
      channel.addEventListener('message', l)
      return () => channel.removeEventListener('message', l)
    },
    close: () => channel.close(),
  }
}

/**
 * Two connected in-memory transports (tests, and the visual rig, which draws the overlay inside the
 * same page). Delivery is asynchronous like a real channel, and goes through a structured clone so
 * a non-cloneable prop fails here as it would between the views.
 */
export function memoryTransportPair(): { host: HostTransport; guest: GuestTransport } {
  const hostListeners = new Set<(m: GuestMessage) => void>()
  const guestListeners = new Set<(m: HostMessage) => void>()
  let closed = false
  const deliver = <M>(listeners: Set<(m: M) => void>, m: M) => {
    if (closed) return
    const copy = structuredClone(m)
    queueMicrotask(() => {
      if (closed) return
      for (const l of [...listeners]) l(copy)
    })
  }
  return {
    host: {
      post: (m) => deliver(guestListeners, m),
      subscribe(l) {
        hostListeners.add(l)
        return () => hostListeners.delete(l)
      },
      close() {
        closed = true
      },
    },
    guest: {
      post: (m) => deliver(hostListeners, m),
      subscribe(l) {
        guestListeners.add(l)
        return () => guestListeners.delete(l)
      },
      close() {
        closed = true
      },
    },
  }
}

const MARGIN = 8

/**
 * The overlay view's rectangle for a popover: next to the anchor on the requested side, flipped to
 * the other side when it does not fit, then kept inside the window with a small margin. Pure.
 */
export function popoverBounds(
  p: Extract<Placement, { mode: 'popover' }>,
  viewport: { width: number; height: number },
): { bounds: Rect; side: Side } {
  const offset = p.offset ?? 4
  const width = Math.min(p.size.width, Math.max(0, viewport.width - 2 * MARGIN))
  const height = Math.min(p.size.height, Math.max(0, viewport.height - 2 * MARGIN))
  const a = p.anchor
  let side = p.side ?? 'below'
  const fits = (s: Side) => {
    switch (s) {
      case 'below':
        return a.y + a.height + offset + height <= viewport.height - MARGIN
      case 'above':
        return a.y - offset - height >= MARGIN
      case 'end':
        return a.x + a.width + offset + width <= viewport.width - MARGIN
      case 'start':
        return a.x - offset - width >= MARGIN
    }
  }
  const flip: Record<Side, Side> = { below: 'above', above: 'below', start: 'end', end: 'start' }
  if (!fits(side) && fits(flip[side])) side = flip[side]

  const align = p.align ?? 'start'
  const along = (start: number, length: number, size: number) =>
    align === 'start'
      ? start
      : align === 'end'
        ? start + length - size
        : start + (length - size) / 2

  let x: number
  let y: number
  if (side === 'below' || side === 'above') {
    x = along(a.x, a.width, width)
    y = side === 'below' ? a.y + a.height + offset : a.y - offset - height
  } else {
    y = along(a.y, a.height, height)
    x = side === 'end' ? a.x + a.width + offset : a.x - offset - width
  }
  x = Math.min(Math.max(MARGIN, x), viewport.width - MARGIN - width)
  y = Math.min(Math.max(MARGIN, y), viewport.height - MARGIN - height)
  return {
    bounds: {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    },
    side,
  }
}

export function resolvePlacement(
  p: Placement,
  viewport: { width: number; height: number },
): { resolved: ResolvedPlacement; bounds: Rect | null } {
  if (p.mode === 'modal')
    return { resolved: { mode: 'modal', anchor: p.anchor ?? null }, bounds: null }
  const { bounds, side } = popoverBounds(p, viewport)
  return { resolved: { mode: 'popover', bounds, side }, bounds }
}
