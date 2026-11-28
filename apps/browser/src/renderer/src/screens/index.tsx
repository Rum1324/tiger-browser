import type { ComponentType } from 'react'
import type { SurfaceName } from '../app/router'
import {
  AskPanelPlaceholder,
  SidebarPlaceholder,
  SurfacePlaceholder,
  ToolbarPlaceholder,
} from './placeholders'

/**
 * What draws each region and surface of the main view. The designed components replace the
 * placeholders here; the shell (app/Shell.tsx) does not change. Overlay surfaces register in
 * overlay/registry.ts instead.
 */
export const regionContent: {
  sidebar: ComponentType
  toolbar: ComponentType
  askPanel: ComponentType
} = {
  sidebar: SidebarPlaceholder,
  toolbar: ToolbarPlaceholder,
  askPanel: AskPanelPlaceholder,
}

/** Surfaces that replace the page card. `page` has none: the page view is placed there instead. */
export const surfaceScreens: Record<Exclude<SurfaceName, 'page'>, ComponentType> = {
  'space-home': SurfacePlaceholder,
  settings: SurfacePlaceholder,
  item: SurfacePlaceholder,
  'new-tab': SurfacePlaceholder,
  'page-problem': SurfacePlaceholder,
  'sign-in': SurfacePlaceholder,
  'first-run': SurfacePlaceholder,
}
