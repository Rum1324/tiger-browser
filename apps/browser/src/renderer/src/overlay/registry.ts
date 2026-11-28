import type { ComponentType } from 'react'
import type { OverlaySurfaceName } from './surfaces'

/**
 * Which component draws each overlay surface. The designed components register here (one call per
 * surface, at import time of the overlay entry); a surface without a registered component falls
 * back to the plain placeholder, so the protocol works before the designs exist.
 * A component reads its props with `useOverlaySurface(name)`.
 */
const components = new Map<OverlaySurfaceName, ComponentType>()

export function registerOverlaySurface(name: OverlaySurfaceName, component: ComponentType): () => void {
  components.set(name, component)
  return () => {
    if (components.get(name) === component) components.delete(name)
  }
}

export function surfaceComponent(name: OverlaySurfaceName): ComponentType | null {
  return components.get(name) ?? null
}
