import type { ShortcutAction } from '@tiger/shared'
import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'

export interface AppMenuActions {
  shortcut(action: ShortcutAction): void
  reload(ignoreCache: boolean): void
  back(): void
  forward(): void
  zoom(direction: 'in' | 'out' | 'reset'): void
  toggleDevTools(): void
}

interface ShortcutItem {
  action: ShortcutAction
  label: string
  accelerator: string
}

/** Accelerators for the contract's shortcut actions; the UI decides what each one does. */
export function shortcutItems(platform: NodeJS.Platform): ShortcutItem[] {
  const mac = platform === 'darwin'
  return [
    { action: 'new-tab', label: 'New Tab', accelerator: 'CmdOrCtrl+T' },
    { action: 'new-window', label: 'New Window', accelerator: 'CmdOrCtrl+N' },
    { action: 'new-private-window', label: 'New Private Window', accelerator: 'CmdOrCtrl+Shift+N' },
    { action: 'close-tab', label: 'Close Tab', accelerator: 'CmdOrCtrl+W' },
    { action: 'reopen-closed-tab', label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T' },
    { action: 'focus-address', label: 'Open Location', accelerator: 'CmdOrCtrl+L' },
    { action: 'toggle-command', label: 'Command', accelerator: 'CmdOrCtrl+K' },
    { action: 'toggle-side-panel', label: 'Side Panel', accelerator: 'CmdOrCtrl+\\' },
    { action: 'toggle-space-home', label: 'Space Home', accelerator: 'CmdOrCtrl+Shift+H' },
    { action: 'share-tab', label: 'Share Tab', accelerator: 'CmdOrCtrl+Shift+S' },
    { action: 'find', label: 'Find', accelerator: 'CmdOrCtrl+F' },
    {
      action: 'next-tab',
      label: 'Next Tab',
      accelerator: mac ? 'Cmd+Alt+Right' : 'Ctrl+Tab',
    },
    {
      action: 'previous-tab',
      label: 'Previous Tab',
      accelerator: mac ? 'Cmd+Alt+Left' : 'Ctrl+Shift+Tab',
    },
    { action: 'bookmark-tab', label: 'Bookmark Tab', accelerator: 'CmdOrCtrl+D' },
    { action: 'open-history', label: 'History', accelerator: mac ? 'Cmd+Y' : 'Ctrl+H' },
    { action: 'open-downloads', label: 'Downloads', accelerator: mac ? 'Cmd+Shift+J' : 'Ctrl+J' },
    { action: 'open-settings', label: 'Settings', accelerator: 'CmdOrCtrl+,' },
  ]
}

export function appMenuTemplate(
  platform: NodeJS.Platform,
  actions: AppMenuActions,
): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin'
  const items = new Map(shortcutItems(platform).map((s) => [s.action, s]))
  const sc = (action: ShortcutAction): MenuItemConstructorOptions => {
    const s = items.get(action) as ShortcutItem
    return {
      id: `shortcut:${action}`,
      label: s.label,
      accelerator: s.accelerator,
      click: () => actions.shortcut(action),
    }
  }
  const sep: MenuItemConstructorOptions = { type: 'separator' }
  return [
    ...(mac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        sc('new-tab'),
        sc('new-window'),
        sc('new-private-window'),
        sep,
        sc('focus-address'),
        sc('share-tab'),
        sep,
        sc('close-tab'),
        sc('reopen-closed-tab'),
        sep,
        mac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        sc('toggle-command'),
        sc('toggle-side-panel'),
        sc('toggle-space-home'),
        sc('find'),
        sep,
        {
          id: 'reload',
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => actions.reload(false),
        },
        {
          id: 'force-reload',
          label: 'Force Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => actions.reload(true),
        },
        sep,
        {
          id: 'zoom-in',
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: () => actions.zoom('in'),
        },
        {
          id: 'zoom-out',
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => actions.zoom('out'),
        },
        {
          id: 'zoom-reset',
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          click: () => actions.zoom('reset'),
        },
        sep,
        {
          id: 'devtools',
          label: 'Developer Tools',
          accelerator: mac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: () => actions.toggleDevTools(),
        },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'History',
      submenu: [
        {
          id: 'back',
          label: 'Back',
          accelerator: mac ? 'Cmd+[' : 'Alt+Left',
          click: () => actions.back(),
        },
        {
          id: 'forward',
          label: 'Forward',
          accelerator: mac ? 'Cmd+]' : 'Alt+Right',
          click: () => actions.forward(),
        },
        sep,
        sc('open-history'),
      ],
    },
    { label: 'Bookmarks', submenu: [sc('bookmark-tab')] },
    {
      label: 'Window',
      submenu: [
        sc('next-tab'),
        sc('previous-tab'),
        sc('open-downloads'),
        sc('open-settings'),
        sep,
        { role: 'minimize' },
        ...(mac ? [{ role: 'zoom' } as MenuItemConstructorOptions] : []),
      ],
    },
  ]
}

export interface PageMenuActions {
  back(): void
  forward(): void
  reload(): void
  openInNewTab(url: string): void
  copyText(text: string): void
  copyImageAt(x: number, y: number): void
  downloadUrl(url: string): void
  searchFor(text: string): void
  replaceMisspelling(word: string): void
  inspect(x: number, y: number): void
}

type MenuParams = Pick<
  ContextMenuParams,
  | 'x'
  | 'y'
  | 'linkURL'
  | 'srcURL'
  | 'mediaType'
  | 'hasImageContents'
  | 'selectionText'
  | 'isEditable'
  | 'editFlags'
  | 'misspelledWord'
  | 'dictionarySuggestions'
>

const isWeb = (u: string) => /^https?:\/\//i.test(u)

/** The page context menu: what Chrome offers for the thing under the pointer, minus extensions. */
export function pageMenuTemplate(
  p: MenuParams,
  nav: { canGoBack: boolean; canGoForward: boolean },
  actions: PageMenuActions,
  devTools: boolean,
): MenuItemConstructorOptions[] {
  const groups: MenuItemConstructorOptions[][] = []

  if (p.misspelledWord) {
    groups.push(
      p.dictionarySuggestions.length
        ? p.dictionarySuggestions.slice(0, 5).map((w) => ({
            label: w,
            click: () => actions.replaceMisspelling(w),
          }))
        : [{ label: 'No suggestions', enabled: false }],
    )
  }

  if (p.linkURL && isWeb(p.linkURL)) {
    groups.push([
      {
        id: 'open-link-new-tab',
        label: 'Open Link in New Tab',
        click: () => actions.openInNewTab(p.linkURL),
      },
      { id: 'copy-link', label: 'Copy Link Address', click: () => actions.copyText(p.linkURL) },
      { id: 'save-link', label: 'Save Link As…', click: () => actions.downloadUrl(p.linkURL) },
    ])
  }

  if (p.mediaType === 'image' && p.srcURL) {
    const img: MenuItemConstructorOptions[] = []
    if (isWeb(p.srcURL)) {
      img.push({
        id: 'open-image-new-tab',
        label: 'Open Image in New Tab',
        click: () => actions.openInNewTab(p.srcURL),
      })
    }
    img.push(
      { id: 'save-image', label: 'Save Image As…', click: () => actions.downloadUrl(p.srcURL) },
      {
        id: 'copy-image',
        label: 'Copy Image',
        enabled: p.hasImageContents,
        click: () => actions.copyImageAt(p.x, p.y),
      },
      {
        id: 'copy-image-url',
        label: 'Copy Image Address',
        click: () => actions.copyText(p.srcURL),
      },
    )
    groups.push(img)
  }

  if (p.isEditable) {
    const f = p.editFlags
    groups.push([
      { role: 'undo', enabled: f.canUndo },
      { role: 'redo', enabled: f.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: f.canCut },
      { role: 'copy', enabled: f.canCopy },
      { role: 'paste', enabled: f.canPaste },
      { role: 'pasteAndMatchStyle', enabled: f.canPaste },
      { role: 'selectAll', enabled: f.canSelectAll },
    ])
  } else if (p.selectionText.trim()) {
    const text = p.selectionText.trim()
    const short = text.length > 24 ? `${text.slice(0, 24)}…` : text
    groups.push([
      { role: 'copy' },
      {
        id: 'search-selection',
        label: `Search for “${short}”`,
        click: () => actions.searchFor(text),
      },
    ])
  }

  if (!p.linkURL && p.mediaType === 'none' && !p.isEditable && !p.selectionText.trim()) {
    groups.push([
      { id: 'back', label: 'Back', enabled: nav.canGoBack, click: () => actions.back() },
      {
        id: 'forward',
        label: 'Forward',
        enabled: nav.canGoForward,
        click: () => actions.forward(),
      },
      { id: 'reload', label: 'Reload', click: () => actions.reload() },
    ])
  }

  if (devTools) {
    groups.push([{ id: 'inspect', label: 'Inspect', click: () => actions.inspect(p.x, p.y) }])
  }

  const out: MenuItemConstructorOptions[] = []
  for (const g of groups) {
    if (out.length) out.push({ type: 'separator' })
    out.push(...g)
  }
  return out
}
