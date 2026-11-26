import type { Rect } from '@tiger/shared'

export interface Size {
  width: number
  height: number
}

/** Integer device-independent pixels, as WebContentsView.setBounds expects. */
export interface ViewBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Convert a rectangle reported by the UI (CSS pixels of the UI view, which may be zoomed) into view
 * bounds inside the window's content area. The rectangle is clipped to the content area so a stale
 * report during a resize never places the page outside the window. Returns null when nothing of it
 * remains visible, which callers treat like "hide the page".
 */
export function toViewBounds(rect: Rect, uiZoom: number, content: Size): ViewBounds | null {
  const zoom = Number.isFinite(uiZoom) && uiZoom > 0 ? uiZoom : 1
  const left = Math.max(0, Math.round(rect.x * zoom))
  const top = Math.max(0, Math.round(rect.y * zoom))
  const right = Math.min(content.width, Math.round((rect.x + rect.width) * zoom))
  const bottom = Math.min(content.height, Math.round((rect.y + rect.height) * zoom))
  if (right <= left || bottom <= top) return null
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function fullBounds(content: Size): ViewBounds {
  return {
    x: 0,
    y: 0,
    width: Math.max(0, Math.round(content.width)),
    height: Math.max(0, Math.round(content.height)),
  }
}

/** The radius scales with the UI zoom and can never exceed half the shorter side. */
export function toCornerRadius(radius: number, uiZoom: number, bounds: ViewBounds): number {
  const zoom = Number.isFinite(uiZoom) && uiZoom > 0 ? uiZoom : 1
  const max = Math.floor(Math.min(bounds.width, bounds.height) / 2)
  return Math.max(0, Math.min(max, Math.round(radius * zoom)))
}
