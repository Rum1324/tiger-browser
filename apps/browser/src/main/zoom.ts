/** Chrome's zoom ladder; menu and Ctrl+wheel zoom step along it. */
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]

export function nextZoom(current: number, direction: 'in' | 'out'): number {
  if (direction === 'in') return ZOOM_STEPS.find((z) => z > current + 0.001) ?? 5
  return [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001) ?? 0.25
}
