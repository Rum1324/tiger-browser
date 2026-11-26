import { describe, expect, it } from 'vitest'
import { fullBounds, toCornerRadius, toViewBounds } from '../../src/main/bounds'

const content = { width: 1280, height: 800 }

describe('toViewBounds', () => {
  it('passes a rectangle inside the window through as integers', () => {
    expect(toViewBounds({ x: 10.4, y: 80.6, width: 900.2, height: 600 }, 1, content)).toEqual({
      x: 10,
      y: 81,
      width: 901,
      height: 600,
    })
  })

  it('scales by the UI zoom factor', () => {
    expect(toViewBounds({ x: 10, y: 50, width: 100, height: 100 }, 1.5, content)).toEqual({
      x: 15,
      y: 75,
      width: 150,
      height: 150,
    })
  })

  it('treats an invalid zoom as 1', () => {
    const r = { x: 1, y: 2, width: 3, height: 4 }
    expect(toViewBounds(r, 0, content)).toEqual(toViewBounds(r, 1, content))
    expect(toViewBounds(r, Number.NaN, content)).toEqual(toViewBounds(r, 1, content))
  })

  it('clips to the content area', () => {
    expect(toViewBounds({ x: -20, y: 700, width: 2000, height: 400 }, 1, content)).toEqual({
      x: 0,
      y: 700,
      width: 1280,
      height: 100,
    })
  })

  it('returns null when nothing remains visible', () => {
    expect(toViewBounds({ x: 0, y: 0, width: 0, height: 100 }, 1, content)).toBeNull()
    expect(toViewBounds({ x: 1300, y: 0, width: 100, height: 100 }, 1, content)).toBeNull()
  })
})

describe('fullBounds / toCornerRadius', () => {
  it('covers the whole content area', () => {
    expect(fullBounds({ width: 1280.6, height: 799.4 })).toEqual({ x: 0, y: 0, width: 1281, height: 799 })
  })

  it('scales the radius and caps it at half the shorter side', () => {
    const b = { x: 0, y: 0, width: 400, height: 20 }
    expect(toCornerRadius(8, 1, b)).toBe(8)
    expect(toCornerRadius(8, 2, { ...b, height: 300 })).toBe(16)
    expect(toCornerRadius(50, 1, b)).toBe(10)
    expect(toCornerRadius(-4, 1, b)).toBe(0)
  })
})
