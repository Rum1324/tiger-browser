import type { Rect } from '@tiger/shared'

/**
 * The page-slot reporter: the UI owns layout, so it measures where the page card sits and tells the
 * engine (`page.setBounds`), which places the native page view there with the same corner radius.
 *
 * - Bounds are in CSS pixels of the UI view (the engine applies the UI zoom), rounded to whole pixels.
 * - `null` hides the page: a surface covers the page card, the slot is not mounted, or it has no area.
 * - Repeated identical reports are dropped, and every trigger within one frame collapses into one
 *   measurement, so a window resize does not flood the engine.
 * - The corner radius is read from the slot element's computed `border-top-left-radius`, so it
 *   follows the design tokens (`--r-card`) without code changes.
 */

export interface SlotElement {
  getBoundingClientRect(): { left: number; top: number; width: number; height: number }
}

export interface PageSlotOptions {
  send(bounds: Rect | null, cornerRadius: number): void | Promise<void>
  /** The corner radius of an element; defaults to its computed border-top-left-radius. */
  radiusOf?: (el: SlotElement) => number
  /** Run `cb` before the next paint; returns a cancel function. Defaults to requestAnimationFrame. */
  schedule?: (cb: () => void) => () => void
}

export interface SlotReport {
  bounds: Rect | null
  cornerRadius: number
}

export class PageSlotReporter {
  private el: SlotElement | null = null
  private covered = false
  private disposed = false
  private cancelPending: (() => void) | null = null
  private lastSent: SlotReport | null = null
  private readonly radiusOf: (el: SlotElement) => number
  private readonly schedule: (cb: () => void) => () => void

  constructor(private readonly opts: PageSlotOptions) {
    this.radiusOf = opts.radiusOf ?? computedRadius
    this.schedule = opts.schedule ?? frame
  }

  /** The element the page card occupies (null when it unmounts). Measured on the next frame. */
  setElement(el: SlotElement | null): void {
    if (this.el === el) return
    this.el = el
    this.invalidate()
  }

  /** A surface covers the page card: the page view is hidden until it is uncovered. */
  setCovered(covered: boolean): void {
    if (this.covered === covered) return
    this.covered = covered
    // Hiding is reported at once, so a surface never paints under a page view still on top of it.
    if (covered) this.flush()
    else this.invalidate()
  }

  /** Something may have moved the slot: measure on the next frame. */
  invalidate(): void {
    if (this.disposed || this.cancelPending) return
    this.cancelPending = this.schedule(() => {
      this.cancelPending = null
      this.flush()
    })
  }

  /** Measure now and report if anything changed. */
  flush(): SlotReport {
    this.cancelPending?.()
    this.cancelPending = null
    const report = this.measure()
    if (!this.disposed && !sameReport(report, this.lastSent)) {
      this.lastSent = report
      void Promise.resolve(this.opts.send(report.bounds, report.cornerRadius)).catch(() => {
        // The engine refused or the view is closing; the next change reports again.
        this.lastSent = null
      })
    }
    return report
  }

  /** The last report sent to the engine. */
  get current(): SlotReport | null {
    return this.lastSent
  }

  /** Stop reporting; the page is hidden (a UI that unmounts its page card shows no page). */
  dispose(): void {
    if (this.disposed) return
    this.cancelPending?.()
    this.cancelPending = null
    const hidden: SlotReport = { bounds: null, cornerRadius: this.lastSent?.cornerRadius ?? 0 }
    if (this.lastSent && !sameReport(hidden, this.lastSent))
      void Promise.resolve(this.opts.send(null, hidden.cornerRadius)).catch(() => {})
    this.disposed = true
  }

  private measure(): SlotReport {
    const el = this.el
    const radius = el ? Math.max(0, round(this.radiusOf(el))) : (this.lastSent?.cornerRadius ?? 0)
    if (!el || this.covered) return { bounds: null, cornerRadius: radius }
    const r = el.getBoundingClientRect()
    const width = round(r.width)
    const height = round(r.height)
    if (width <= 0 || height <= 0) return { bounds: null, cornerRadius: radius }
    return {
      bounds: { x: round(r.left), y: round(r.top), width, height },
      cornerRadius: radius,
    }
  }
}

const round = (n: number) => (Number.isFinite(n) ? Math.round(n) : 0)

function sameReport(a: SlotReport, b: SlotReport | null): boolean {
  if (!b || a.cornerRadius !== b.cornerRadius) return false
  if (a.bounds === null || b.bounds === null) return a.bounds === b.bounds
  return (
    a.bounds.x === b.bounds.x &&
    a.bounds.y === b.bounds.y &&
    a.bounds.width === b.bounds.width &&
    a.bounds.height === b.bounds.height
  )
}

function computedRadius(el: SlotElement): number {
  if (typeof getComputedStyle !== 'function' || !(el instanceof Element)) return 0
  return Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0
}

function frame(cb: () => void): () => void {
  if (typeof requestAnimationFrame !== 'function') {
    const t = setTimeout(cb, 16)
    return () => clearTimeout(t)
  }
  const id = requestAnimationFrame(cb)
  return () => cancelAnimationFrame(id)
}

/**
 * Wire a reporter to the DOM: the slot's size (ResizeObserver: panel open/close, sidebar collapse,
 * window resize), window resize (zoom changes the CSS viewport too), device-pixel-ratio changes,
 * and running CSS transitions or animations anywhere in the document (an animated panel moves the
 * slot every frame, so it is measured every frame until the motion ends). Returns the cleanup.
 */
export function observePageSlot(
  el: HTMLElement,
  reporter: PageSlotReporter,
  win: Window = window,
): () => void {
  reporter.setElement(el)
  const invalidate = () => reporter.invalidate()
  const cleanups: (() => void)[] = []

  if (typeof win.ResizeObserver === 'function') {
    const ro = new win.ResizeObserver(invalidate)
    ro.observe(el)
    // The slot can move without changing size (a toolbar that grows above it).
    ro.observe(win.document.documentElement)
    cleanups.push(() => ro.disconnect())
  }
  win.addEventListener('resize', invalidate)
  cleanups.push(() => win.removeEventListener('resize', invalidate))

  let dprQuery: MediaQueryList | null = null
  const watchDpr = () => {
    dprQuery?.removeEventListener('change', onDpr)
    dprQuery = win.matchMedia?.(`(resolution: ${win.devicePixelRatio}dppx)`) ?? null
    dprQuery?.addEventListener('change', onDpr)
  }
  const onDpr = () => {
    invalidate()
    watchDpr()
  }
  watchDpr()
  cleanups.push(() => dprQuery?.removeEventListener('change', onDpr))

  // Follow running transitions/animations frame by frame.
  // A transition whose end event never arrives (its element was removed) must not keep the loop
  // alive: the frame loop stops MAX_MOTION_MS after the last start.
  let running = 0
  let lastStart = 0
  let loop: (() => void) | null = null
  const tick = () => {
    reporter.flush()
    if (running > 0 && Date.now() - lastStart > MAX_MOTION_MS) running = 0
    loop = running > 0 ? scheduleFrame(win, tick) : null
  }
  const start = () => {
    running += 1
    lastStart = Date.now()
    if (!loop) loop = scheduleFrame(win, tick)
  }
  const end = () => {
    running = Math.max(0, running - 1)
    if (running === 0) invalidate()
  }
  const doc = win.document
  for (const t of ['transitionrun', 'animationstart'] as const) doc.addEventListener(t, start, true)
  for (const t of ['transitionend', 'transitioncancel', 'animationend', 'animationcancel'] as const)
    doc.addEventListener(t, end, true)
  cleanups.push(() => {
    for (const t of ['transitionrun', 'animationstart'] as const)
      doc.removeEventListener(t, start, true)
    for (const t of [
      'transitionend',
      'transitioncancel',
      'animationend',
      'animationcancel',
    ] as const)
      doc.removeEventListener(t, end, true)
    loop?.()
    loop = null
  })

  return () => {
    for (const c of cleanups) c()
    reporter.setElement(null)
  }
}

const MAX_MOTION_MS = 2000

function scheduleFrame(win: Window, cb: () => void): () => void {
  const id = win.requestAnimationFrame(cb)
  return () => win.cancelAnimationFrame(id)
}
