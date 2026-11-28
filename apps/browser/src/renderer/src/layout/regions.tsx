import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from 'react'
import { useServices, useT } from '../app/context'
import { coversPage } from '../app/router'
import { useSurface } from '../app/surface'
import { frameAttributes } from '../app/theme'
import { useStore } from '../lib/store'
import { effectiveLayout } from './layout-state'
import { observePageSlot } from './page-slot'
import './layout.css'

/**
 * The named layout regions of the Rooms design, unstyled: a grid and the attributes the design
 * tokens key on. The designed components go inside them.
 *
 *   ┌──────────┬──────────────────────────────┬────────────┐
 *   │          │ toolbar                      │            │
 *   │ sidebar  ├──────────────────────────────┤ ask panel  │
 *   │          │ stage: page card | surface   │ (if open)  │
 *   └──────────┴──────────────────────────────┴────────────┘
 *
 * `WindowFrame` carries `data-space` (the current Space's hue, `none` without one or in a private
 * window) and `data-window` (`private` | `normal`), plus `data-sidebar`, `data-panel` and
 * `data-surface` for layout. The overlay layer is a separate view (overlay/), not a region here.
 */
export function WindowFrame({ children }: { children: ReactNode }) {
  const { client, engine, layout } = useServices()
  const hue = useStore(
    client.spaces.store,
    (s) => s.list.find((x) => x.id === s.currentSpaceId)?.hue ?? null,
  )
  const privateWindow = useStore(engine.tabs, (s) => s.value?.privateWindow ?? false)
  const { mode, sidebar, panel } = useEffectiveLayout()
  const sidebarWidth = useStore(layout.store, (s) => s.sidebarWidth)
  const panelWidth = useStore(layout.store, (s) => s.panelWidth)
  const { surface } = useSurface()
  const style: CSSProperties & Record<string, string> = {}
  if (sidebarWidth) style['--sidebar-width'] = `${sidebarWidth}px`
  if (panelWidth) style['--panel-width'] = `${panelWidth}px`
  return (
    <div
      data-region="window"
      {...frameAttributes({ hue, privateWindow })}
      data-layout={mode}
      data-sidebar={sidebar === 'rail' ? 'collapsed' : 'open'}
      data-panel={panel}
      data-surface={surface.name}
      style={style}
    >
      {children}
    </div>
  )
}

export function Sidebar({ children }: { children?: ReactNode }) {
  const t = useT()
  return (
    <aside data-region="sidebar" aria-label={t('region.sidebar')}>
      {children}
    </aside>
  )
}

export function Toolbar({ children }: { children?: ReactNode }) {
  const t = useT()
  return (
    <section data-region="toolbar" aria-label={t('region.toolbar')}>
      {children}
    </section>
  )
}

/** The area right of the sidebar and under the toolbar: the page card, or a surface replacing it. */
export function Stage({ children }: { children?: ReactNode }) {
  return <main data-region="stage">{children}</main>
}

/** Shown only while the panel is open, so the page card takes the space back when it closes. */
export function AskPanelRegion({ children }: { children?: ReactNode }) {
  const { layout } = useServices()
  const open = useStore(layout.store, (s) => s.panelOpen)
  const t = useT()
  if (!open) return null
  return (
    <aside data-region="ask-panel" aria-label={t('region.askPanel')}>
      {children}
    </aside>
  )
}

/** A surface that replaces the page card (Space home, settings, …). */
export function SurfaceRegion({ children }: { children?: ReactNode }) {
  const t = useT()
  return (
    <section data-region="surface" aria-label={t('region.surface')}>
      {children}
    </section>
  )
}

/**
 * The page card's slot: an empty element the native page view is placed over. Its rectangle and
 * computed corner radius (`--r-card`) are reported to the engine whenever they change. Whatever is
 * drawn inside it is covered by the page; the ring and frame belong in the gutter around it.
 */
export function PageSlot({ children }: { children?: ReactNode }) {
  const { pageSlot } = useServices()
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    return observePageSlot(el, pageSlot)
  }, [pageSlot])
  const t = useT()
  return (
    <div data-region="page" ref={ref} role="presentation" aria-label={t('region.page')}>
      {children}
    </div>
  )
}

/** Keep the reporter's "covered" flag in step with the surface shown. Renders nothing. */
export function PageCoverage() {
  const { pageSlot } = useServices()
  const { surface } = useSurface()
  const covered = coversPage(surface)
  useLayoutEffect(() => {
    pageSlot.setCovered(covered)
  }, [covered, pageSlot])
  return null
}

const subscribeWidth = (cb: () => void) => {
  window.addEventListener('resize', cb)
  return () => window.removeEventListener('resize', cb)
}
const windowWidth = () => window.innerWidth

/** The window's CSS width, following resizes (and zoom, which changes the CSS viewport). */
export function useWindowWidth(): number {
  return useSyncExternalStore(subscribeWidth, windowWidth, () => 1440)
}

/**
 * The layout as drawn: the member's choices plus the window-width rules (a rail while the panel
 * is open on a medium window). Components read this, not the raw prefs, to know what is visible.
 */
export function useEffectiveLayout() {
  const { layout } = useServices()
  const sidebarCollapsed = useStore(layout.store, (s) => s.sidebarCollapsed)
  const panelOpen = useStore(layout.store, (s) => s.panelOpen)
  const width = useWindowWidth()
  return effectiveLayout({ sidebarCollapsed, panelOpen }, width)
}

/** Re-measure after a layout change made outside React state (a drag that resizes a column). */
export function useLayoutInvalidate(): () => void {
  const { layout } = useServices()
  return useCallback(() => layout.invalidate(), [layout])
}
