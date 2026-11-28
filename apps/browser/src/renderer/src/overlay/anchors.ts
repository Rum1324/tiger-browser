import type { Rect } from '@tiger/shared'
import type { Placement } from './protocol'

/**
 * Popovers opened from a shortcut have no clicked element to sit next to. A designed component marks
 * its control with `data-overlay-anchor="<name>"` (the toolbar's downloads button, the capsule's
 * state chip…) and the popover is placed next to it; without one it goes under the toolbar's right
 * end. Rects are in CSS pixels of the main view, like page.setBounds.
 */
export function anchorRect(name: string, doc: Document | null = typeof document === 'undefined' ? null : document): Rect {
  const el = doc?.querySelector(`[data-overlay-anchor="${CSS.escape(name)}"]`)
  if (el) {
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, width: r.width, height: r.height }
  }
  const width = doc?.defaultView?.innerWidth ?? 1440
  return { x: width - 48, y: 8, width: 32, height: 32 }
}

export const POPOVER_SIZES = {
  downloads: { width: 360, height: 420 },
  permission: { width: 360, height: 180 },
  find: { width: 360, height: 48 },
  menu: { width: 280, height: 320 },
  'model-picker': { width: 320, height: 360 },
} as const

export function popoverAt(anchor: string, size: keyof typeof POPOVER_SIZES, side: 'below' | 'above' | 'start' | 'end' = 'below'): Placement {
  return { mode: 'popover', anchor: anchorRect(anchor), size: POPOVER_SIZES[size], side, align: 'end' }
}
