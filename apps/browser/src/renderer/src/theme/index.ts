/**
 * The one place the design tokens enter the UI. `tokens.css` is the design's file
 * (design/final/tokens.css) copied verbatim: replace it with `pnpm --filter @tiger/browser
 * tokens:sync` and no code changes. The plumbing keys on what that file defines:
 *
 * - `[data-theme="dark"]` on <html> (app/theme.ts applies it from Settings.theme),
 * - `[data-space="<SpaceHue>|none"]` and `[data-window="private"]` on the window frame,
 * - layout sizes: --w-sidebar, --w-rail, --w-panel, --h-toolbar, --gutter, --r-card
 *   (layout/layout.css; the page card's radius is read back from the DOM, so it follows --r-card).
 *
 * Import this module once per entry (main view, overlay view, rig).
 */
import './tokens.css'

/** Tokens the layout plumbing reads; a test checks tokens.css still defines them. */
export const LAYOUT_TOKENS = [
  '--w-sidebar',
  '--w-rail',
  '--w-panel',
  '--h-toolbar',
  '--gutter',
  '--r-card',
  '--space-frame',
  '--ink',
] as const
