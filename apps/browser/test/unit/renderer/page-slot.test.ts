import type { Rect } from '@tiger/shared'
import { describe, expect, it } from 'vitest'
import { PageSlotReporter, type SlotElement } from '../../../src/renderer/src/layout/page-slot'

/** A slot element whose rectangle the test moves, and a manual frame scheduler. */
function rig(rect = { left: 256.4, top: 48.6, width: 775.5, height: 843.2 }, radius = 10) {
  const sent: { bounds: Rect | null; cornerRadius: number }[] = []
  const frames: (() => void)[] = []
  const el: SlotElement & { rect: typeof rect } = { rect, getBoundingClientRect: () => el.rect }
  const reporter = new PageSlotReporter({
    send: (bounds, cornerRadius) => {
      sent.push({ bounds, cornerRadius })
    },
    radiusOf: () => radius,
    schedule: (cb) => {
      frames.push(cb)
      return () => {
        const i = frames.indexOf(cb)
        if (i !== -1) frames.splice(i, 1)
      }
    },
  })
  const frame = () => {
    for (const f of frames.splice(0)) f()
  }
  return { sent, frames, el, reporter, frame }
}

describe('PageSlotReporter', () => {
  it('reports the slot rounded to whole CSS pixels, with the radius, on the next frame', () => {
    const r = rig()
    r.reporter.setElement(r.el)
    expect(r.sent).toEqual([])
    r.frame()
    expect(r.sent).toEqual([
      { bounds: { x: 256, y: 49, width: 776, height: 843 }, cornerRadius: 10 },
    ])
  })

  it('collapses every trigger within one frame into one measurement', () => {
    const r = rig()
    r.reporter.setElement(r.el)
    r.reporter.invalidate()
    r.reporter.invalidate()
    r.reporter.invalidate()
    expect(r.frames).toHaveLength(1)
    r.frame()
    expect(r.sent).toHaveLength(1)
  })

  it('drops a report identical to the last one (resize events that change nothing)', () => {
    const r = rig()
    r.reporter.setElement(r.el)
    r.frame()
    r.reporter.invalidate()
    r.frame()
    r.reporter.flush()
    expect(r.sent).toHaveLength(1)
    r.el.rect = { ...r.el.rect, width: 375.5 } // the ask panel opened
    r.reporter.invalidate()
    r.frame()
    expect(r.sent.at(-1)?.bounds).toEqual({ x: 256, y: 49, width: 376, height: 843 })
  })

  it('hides the page at once when a surface covers it, and measures again when uncovered', () => {
    const r = rig()
    r.reporter.setElement(r.el)
    r.frame()
    r.reporter.setCovered(true)
    // No frame needed: a surface must never paint under a page view still on top of it.
    expect(r.sent.at(-1)).toEqual({ bounds: null, cornerRadius: 10 })
    r.reporter.setCovered(false)
    expect(r.sent).toHaveLength(2)
    r.frame()
    expect(r.sent.at(-1)?.bounds).toEqual({ x: 256, y: 49, width: 776, height: 843 })
  })

  it('a slot with no area or no element hides the page', () => {
    const r = rig()
    r.reporter.setElement(r.el)
    r.frame()
    r.el.rect = { left: 0, top: 0, width: 0, height: 0 }
    r.reporter.flush()
    expect(r.sent.at(-1)?.bounds).toBeNull()
    r.el.rect = { left: 10, top: 10, width: 100, height: 100 }
    r.reporter.flush()
    r.reporter.setElement(null)
    r.frame()
    expect(r.sent.at(-1)?.bounds).toBeNull()
  })

  it('a zoomed or fullscreen window just reports the new CSS rectangle (the engine applies zoom)', () => {
    const r = rig({ left: 248, top: 48, width: 1184, height: 844 })
    r.reporter.setElement(r.el)
    r.frame()
    // Fullscreen: the window grows; at 125% UI zoom the same layout is smaller in CSS pixels.
    r.el.rect = { left: 198.4, top: 38.4, width: 1337.6, height: 1100.8 }
    r.reporter.invalidate()
    r.frame()
    expect(r.sent.at(-1)?.bounds).toEqual({ x: 198, y: 38, width: 1338, height: 1101 })
  })

  it('follows the radius token: a changed computed radius is reported', () => {
    let radius = 10
    const sent: number[] = []
    const reporter = new PageSlotReporter({
      send: (_b, r) => {
        sent.push(r)
      },
      radiusOf: () => radius,
      schedule: (cb) => {
        cb()
        return () => {}
      },
    })
    reporter.setElement({
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }),
    })
    radius = 12.4
    reporter.invalidate()
    expect(sent).toEqual([10, 12])
  })

  it('a refused report is retried on the next change; dispose hides the page once', async () => {
    const calls: (Rect | null)[] = []
    let fail = true
    const reporter = new PageSlotReporter({
      send: (b) => {
        calls.push(b)
        return fail ? Promise.reject(new Error('view closing')) : Promise.resolve()
      },
      radiusOf: () => 8,
      schedule: (cb) => {
        cb()
        return () => {}
      },
    })
    reporter.setElement({ getBoundingClientRect: () => ({ left: 1, top: 2, width: 3, height: 4 }) })
    await Promise.resolve()
    await Promise.resolve()
    fail = false
    reporter.invalidate()
    expect(calls).toHaveLength(2)
    reporter.dispose()
    reporter.dispose()
    expect(calls.at(-1)).toBeNull()
    expect(calls).toHaveLength(3)
    reporter.invalidate()
    expect(calls).toHaveLength(3)
  })
})
