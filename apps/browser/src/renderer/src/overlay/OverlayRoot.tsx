import { createContext, type ReactNode, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useStore } from '../lib/store'
import type { OverlayGuest } from './guest'
import type { DismissReason, ResolvedPlacement } from './protocol'
import { surfaceComponent } from './registry'
import type { OverlaySurfaceName, SurfaceEvent, SurfaceProps, SurfaceResult } from './surfaces'

export interface OverlaySurfaceApi<N extends OverlaySurfaceName> {
  id: string
  surface: N
  props: SurfaceProps<N>
  placement: ResolvedPlacement
  /** Close with a result. */
  resolve(value: SurfaceResult<N>): void
  dismiss(reason?: DismissReason): void
  /** An intermediate action; the surface stays open (the host may update its props). */
  emit(event: SurfaceEvent<N>): void
}

const SurfaceContext = createContext<OverlaySurfaceApi<OverlaySurfaceName> | null>(null)

/** Inside a surface component: its props and how to answer. */
export function useOverlaySurface<N extends OverlaySurfaceName>(_name?: N): OverlaySurfaceApi<N> {
  const api = useContext(SurfaceContext)
  if (!api) throw new Error('useOverlaySurface() outside an overlay surface')
  return api as unknown as OverlaySurfaceApi<N>
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The overlay view's root. It draws the surface the host asked for and handles what every surface
 * shares: focus moves into the surface when it appears; Escape dismisses; in a full-window (modal)
 * surface a pointerdown outside the surface dismisses; a popover is dismissed when the overlay view
 * loses focus (the member clicked the page or the main view around it). Only then does it tell the
 * host the surface is shown, so the view is raised with the surface already painted.
 */
export function OverlayRoot({ guest, fallback }: { guest: OverlayGuest; fallback?: (name: OverlaySurfaceName) => ReactNode }) {
  const current = useStore(guest.store, (s) => s.current)
  const surfaceRef = useRef<HTMLDivElement>(null)

  const api = useMemo<OverlaySurfaceApi<OverlaySurfaceName> | null>(() => {
    if (!current) return null
    const id = current.id
    return {
      id,
      surface: current.surface,
      props: current.props as SurfaceProps<OverlaySurfaceName>,
      placement: current.placement,
      resolve: (value) => guest.resolve(id, value),
      dismiss: (reason = 'closed') => guest.dismiss(id, reason),
      emit: (event) => guest.emit(id, event),
    }
  }, [current, guest])

  // Focus handover, then "shown" (once per surface id).
  const shownId = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!current || shownId.current === current.id) return
    shownId.current = current.id
    const root = surfaceRef.current
    if (root) {
      const target =
        root.querySelector<HTMLElement>('[data-autofocus]') ?? root.querySelector<HTMLElement>(FOCUSABLE) ?? root
      target.focus({ preventScroll: true })
    }
    guest.shown(current.id)
  }, [current, guest])

  useEffect(() => {
    if (!current) return
    const id = current.id
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        guest.dismiss(id, 'escape')
      }
    }
    const onPointer = (e: PointerEvent) => {
      if (current.placement.mode !== 'modal') return
      const root = surfaceRef.current
      if (root && e.target instanceof Node && root.contains(e.target)) return
      guest.dismiss(id, 'outside')
    }
    // A popover lives in a tight view: a click anywhere else moves focus away from this view.
    let focused = document.hasFocus()
    const onFocus = () => {
      focused = true
    }
    const onBlur = () => {
      if (focused && current.placement.mode === 'popover') guest.dismiss(id, 'blur')
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [current, guest])

  if (!current || !api) return null
  const Component = surfaceComponent(current.surface)
  const popover = current.placement.mode === 'popover'
  return (
    <div data-overlay-root="" data-mode={current.placement.mode} data-surface-name={current.surface}>
      {popover ? null : <div data-overlay-backdrop="" />}
      <div
        ref={surfaceRef}
        data-overlay-surface=""
        role="dialog"
        aria-modal={popover ? undefined : true}
        tabIndex={-1}
      >
        <SurfaceContext.Provider value={api}>
          {Component ? <Component key={current.id} /> : (fallback?.(current.surface) ?? null)}
        </SurfaceContext.Provider>
      </div>
    </div>
  )
}
