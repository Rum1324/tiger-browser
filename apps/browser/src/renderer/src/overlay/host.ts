import type { EngineBridge, Rect } from '@tiger/shared'
import { createStore, type WritableStore } from '../lib/store'
import {
  type DismissReason,
  type GuestMessage,
  type HostTransport,
  type OpenMessage,
  type Placement,
  resolvePlacement,
} from './protocol'
import type { OverlaySurfaceName, SurfaceEvent, SurfaceProps, SurfaceResult } from './surfaces'

export type OverlayOutcome<R> =
  | { status: 'result'; value: R }
  | { status: 'dismissed'; reason: DismissReason }

export interface OverlayHandle<N extends OverlaySurfaceName> {
  readonly id: string
  /** Settles once: with the surface's result, or how it was dismissed. Never rejects. */
  readonly outcome: Promise<OverlayOutcome<SurfaceResult<N>>>
  /** Replace the props of the open surface (a sheet following a flow's state). */
  update(props: SurfaceProps<N>): void
  /** Close it from the host side. */
  close(reason?: DismissReason): void
}

export interface OpenOptions<N extends OverlaySurfaceName> {
  /** A sheet's intermediate actions (confirm, decide, undo) arrive here while it stays open. */
  onEvent?: (event: SurfaceEvent<N>) => void
}

export interface OverlayHostState {
  open: { id: string; surface: OverlaySurfaceName; placement: Placement; shown: boolean } | null
}

export interface OverlayHost {
  store: WritableStore<OverlayHostState>
  open<N extends OverlaySurfaceName>(
    surface: N,
    props: SurfaceProps<N>,
    placement: Placement,
    opts?: OpenOptions<N>,
  ): OverlayHandle<N>
  /** Close whatever is open. */
  closeAll(reason?: DismissReason): void
  /**
   * True when this surface was dismissed by a click outside it moments ago. A toggle button checks
   * it: its pointerdown already closed the surface, so the click that follows must not reopen it.
   */
  justDismissed(surface: OverlaySurfaceName, withinMs?: number): boolean
  /** Keydown/pointerdown in the main view while a surface is open (wired by `attachToDocument`). */
  handleMainKey(key: string): boolean
  handleMainPointerDown(): boolean
  /** Listen for Escape and clicks in the main view. Returns the cleanup. */
  attachToDocument(doc: Document): () => void
  dispose(): void
}

export interface OverlayHostOptions {
  transport: HostTransport
  bridge: Pick<EngineBridge, 'invoke'>
  viewport: () => { width: number; height: number }
  /** Where focus was before a surface opened, to give it back afterwards. */
  focus?: { save(): (() => void) | null }
  /** How long to wait for the overlay view to show a surface before giving up. */
  shownTimeoutMs?: number
  newId?: () => string
}

interface Pending {
  msg: OpenMessage
  placement: Placement
  bounds: Rect | null
  settle: (o: OverlayOutcome<unknown>) => void
  onEvent?: (event: unknown) => void
  restoreFocus: (() => void) | null
  timer: ReturnType<typeof setTimeout> | null
  shown: boolean
}

/**
 * The main view's side of the overlay protocol. One surface is open at a time; opening another
 * dismisses the first with `replaced`. The overlay view is raised (`overlay.setOpen`) only once the
 * guest reports the surface is rendered, with `bounds: null` for a modal surface (full window) and
 * the popover's rectangle otherwise; it is lowered before the result is handed back, and focus goes
 * back to where it was.
 */
export function createOverlayHost(opts: OverlayHostOptions): OverlayHost {
  const store = createStore<OverlayHostState>({ open: null })
  const newId = opts.newId ?? (() => crypto.randomUUID())
  const timeoutMs = opts.shownTimeoutMs ?? 5000
  let current: Pending | null = null
  let lastOutside: { surface: OverlaySurfaceName; at: number } | null = null

  const setOpen = (open: boolean, bounds: Rect | null) =>
    opts.bridge.invoke('overlay.setOpen', open ? { open, bounds } : { open }).catch(() => {})

  const finish = (p: Pending, outcome: OverlayOutcome<unknown>) => {
    if (current !== p) return
    current = null
    if (outcome.status === 'dismissed' && (outcome.reason === 'outside' || outcome.reason === 'blur'))
      lastOutside = { surface: p.msg.surface, at: Date.now() }
    if (p.timer) clearTimeout(p.timer)
    store.setState({ open: null })
    if (p.shown) void setOpen(false, null)
    opts.transport.post({ t: 'close', id: p.msg.id })
    p.restoreFocus?.()
    p.settle(outcome)
  }

  const onMessage = (m: GuestMessage) => {
    if (m.t === 'hello') {
      opts.transport.post({ t: 'sync', open: current?.msg ?? null })
      return
    }
    const p = current
    if (!p || m.id !== p.msg.id) return
    switch (m.t) {
      case 'shown':
        if (p.shown) return
        p.shown = true
        if (p.timer) clearTimeout(p.timer)
        p.timer = null
        store.setState({ open: { ...(store.getState().open as NonNullable<OverlayHostState['open']>), shown: true } })
        void setOpen(true, p.bounds)
        return
      case 'event':
        p.onEvent?.(m.event)
        return
      case 'result':
        finish(p, { status: 'result', value: m.value })
        return
      case 'dismiss':
        finish(p, { status: 'dismissed', reason: m.reason })
        return
    }
  }
  const unsubscribe = opts.transport.subscribe(onMessage)

  const host: OverlayHost = {
    store,
    open(surface, props, placement, o = {}) {
      if (current) finish(current, { status: 'dismissed', reason: 'replaced' })
      const id = newId()
      const { resolved, bounds } = resolvePlacement(placement, opts.viewport())
      const msg: OpenMessage = { t: 'open', id, surface, props, placement: resolved }
      let settle!: (o: OverlayOutcome<unknown>) => void
      const outcome = new Promise<OverlayOutcome<unknown>>((r) => {
        settle = r
      })
      const p: Pending = {
        msg,
        placement,
        bounds,
        settle,
        ...(o.onEvent ? { onEvent: o.onEvent as (e: unknown) => void } : {}),
        restoreFocus: opts.focus?.save() ?? null,
        timer: null,
        shown: false,
      }
      p.timer = setTimeout(() => finish(p, { status: 'dismissed', reason: 'unavailable' }), timeoutMs)
      current = p
      store.setState({ open: { id, surface, placement, shown: false } })
      opts.transport.post(msg)
      return {
        id,
        outcome: outcome as Promise<OverlayOutcome<SurfaceResult<typeof surface>>>,
        update(next) {
          if (current !== p) return
          p.msg = { ...p.msg, props: next }
          opts.transport.post({ t: 'update', id, props: next })
        },
        close(reason = 'closed') {
          finish(p, { status: 'dismissed', reason })
        },
      }
    },
    closeAll(reason = 'closed') {
      if (current) finish(current, { status: 'dismissed', reason })
    },
    justDismissed(surface, withinMs = 300) {
      return !!lastOutside && lastOutside.surface === surface && Date.now() - lastOutside.at < withinMs
    },
    handleMainKey(key) {
      if (!current || key !== 'Escape') return false
      finish(current, { status: 'dismissed', reason: 'escape' })
      return true
    },
    handleMainPointerDown() {
      // A modal overlay covers the main view, so a click there means it is not shown yet or is a
      // popover: either way the member is acting outside the surface.
      if (!current) return false
      finish(current, { status: 'dismissed', reason: 'outside' })
      return true
    },
    attachToDocument(doc) {
      const onKey = (e: KeyboardEvent) => {
        if (host.handleMainKey(e.key)) e.preventDefault()
      }
      const onPointer = () => {
        host.handleMainPointerDown()
      }
      doc.addEventListener('keydown', onKey, true)
      doc.addEventListener('pointerdown', onPointer, true)
      return () => {
        doc.removeEventListener('keydown', onKey, true)
        doc.removeEventListener('pointerdown', onPointer, true)
      }
    },
    dispose() {
      if (current) finish(current, { status: 'dismissed', reason: 'closed' })
      unsubscribe()
      opts.transport.close()
    },
  }
  return host
}

/** Remember the focused element of a document and refocus it later (if it is still attached). */
export function documentFocus(doc: Document): { save(): (() => void) | null } {
  return {
    save() {
      const el = doc.activeElement
      if (!el || el === doc.body || !(el instanceof HTMLElement)) return null
      return () => {
        if (el.isConnected) el.focus({ preventScroll: true })
      }
    },
  }
}
