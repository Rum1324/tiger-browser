import type { Settings, SpaceHue } from '@tiger/shared'

export type ThemeSetting = Settings['theme']
export type Theme = 'light' | 'dark'

/** The theme to draw: the member's choice, or the system's when they chose `system`. */
export function resolveTheme(setting: ThemeSetting, systemDark: boolean): Theme {
  if (setting === 'system') return systemDark ? 'dark' : 'light'
  return setting
}

/**
 * The attributes the design tokens key on (theme/tokens.css): `data-theme` on <html>, and on the
 * window frame `data-space` (a SpaceHue, or `none` before there is a Space) and
 * `data-window="private"` for a private window, which has no hue.
 */
export function frameAttributes(input: { hue: SpaceHue | null; privateWindow: boolean }): {
  'data-space': SpaceHue | 'none'
  'data-window': 'private' | 'normal'
} {
  return {
    'data-space': input.privateWindow ? 'none' : (input.hue ?? 'none'),
    'data-window': input.privateWindow ? 'private' : 'normal',
  }
}

/** Follow the system colour scheme. Returns the unsubscribe. */
export function watchSystemDark(
  onChange: (dark: boolean) => void,
  media: Pick<Window, 'matchMedia'> | null = typeof window === 'undefined' ? null : window,
): { dark: boolean; stop: () => void } {
  const mq = media?.matchMedia?.('(prefers-color-scheme: dark)')
  if (!mq) return { dark: false, stop: () => {} }
  const listener = (e: MediaQueryListEvent) => onChange(e.matches)
  mq.addEventListener('change', listener)
  return { dark: mq.matches, stop: () => mq.removeEventListener('change', listener) }
}

/** Apply the theme to the document root, where the tokens' `[data-theme="dark"]` block matches. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme
  root.style.colorScheme = theme
}
