import type { ShortcutAction, Suggestion } from '@tiger/shared'
import { attachActions } from '../features/attach'
import { shareActions } from '../features/share'
import { tabsActions } from '../features/tabs'
import type { Notice } from '../i18n'
import type { AppServices } from './services'

/**
 * The commands the palette (and the shortcuts) can run. A command is described as plain data for
 * the overlay view and executed here, in the main view, where the client and the engine live.
 */
export type CommandId =
  | 'new-tab'
  | 'new-window'
  | 'new-private-window'
  | 'close-tab'
  | 'reopen-closed-tab'
  | 'reload'
  | 'share'
  | 'attach'
  | 'ask'
  | 'space-home'
  | 'settings'
  | 'find'
  | 'downloads'
  | 'history'
  | 'toggle-sidebar'
  | 'bookmark'
  | 'sign-in'
  | 'sign-out'
  | `switch-space:${string}`

export type PaletteGroup = 'commands' | 'tabs' | 'history' | 'bookmarks' | 'go'

export interface CommandDescriptor {
  id: CommandId
  label: Notice
  group: 'commands'
  /** The shortcut action whose accelerator to display next to it. */
  shortcut?: ShortcutAction
  /** Extra words that match (e.g. the English name in a Japanese UI). */
  keywords: string[]
}

/** What the palette hands back. */
export type PaletteChoice =
  | { kind: 'command'; id: CommandId }
  | { kind: 'suggestion'; suggestion: Suggestion }
  | { kind: 'text'; text: string }

/** The commands that make sense right now (a private window cannot share, signed out cannot ask…). */
export function availableCommands(s: AppServices): CommandDescriptor[] {
  const tabs = s.engine.tabs.getState().value
  const active = tabs?.tabs.find((t) => t.id === tabs.activeTabId) ?? null
  const signedIn = s.client.session.store.getState().status === 'signedIn'
  const spaces = s.client.spaces.store.getState()
  const canCapture = !!active && active.url !== '' && active.capture.allowed && !active.isPrivate
  const c = (
    id: CommandId,
    key: Notice['key'],
    keywords: string[],
    shortcut?: ShortcutAction,
    vars?: Notice['vars'],
  ): CommandDescriptor => ({
    id,
    label: vars ? { key, vars } : { key },
    group: 'commands',
    keywords,
    ...(shortcut ? { shortcut } : {}),
  })
  const list: CommandDescriptor[] = [
    c('new-tab', 'command.newTab', ['new tab'], 'new-tab'),
    c('new-window', 'command.newWindow', ['new window'], 'new-window'),
    c('new-private-window', 'command.newPrivateWindow', ['private', 'incognito'], 'new-private-window'),
  ]
  if (active) list.push(c('close-tab', 'command.closeTab', ['close'], 'close-tab'))
  list.push(c('reopen-closed-tab', 'command.reopenClosedTab', ['reopen'], 'reopen-closed-tab'))
  if (active?.url) list.push(c('reload', 'command.reload', ['reload', 'refresh']))
  if (signedIn && canCapture && spaces.currentSpaceId) {
    list.push(c('share', 'command.share', ['share'], 'share-tab'))
    list.push(c('attach', 'command.attach', ['attach']))
  }
  if (signedIn) {
    list.push(c('ask', 'command.ask', ['ask', 'ai'], 'toggle-side-panel'))
    list.push(c('space-home', 'command.spaceHome', ['space', 'home'], 'toggle-space-home'))
  }
  if (active?.url) list.push(c('find', 'command.find', ['find', 'search in page'], 'find'))
  if (active?.url) list.push(c('bookmark', 'command.bookmark', ['bookmark'], 'bookmark-tab'))
  list.push(
    c('history', 'command.history', ['history'], 'open-history'),
    c('downloads', 'command.downloads', ['downloads'], 'open-downloads'),
    c('toggle-sidebar', 'command.toggleSidebar', ['sidebar']),
    c('settings', 'command.settings', ['settings', 'preferences'], 'open-settings'),
  )
  if (signedIn) {
    for (const sp of spaces.list)
      if (sp.id !== spaces.currentSpaceId)
        list.push(c(`switch-space:${sp.id}`, 'command.switchSpace', ['space', sp.name], undefined, { space: sp.name }))
    list.push(c('sign-out', 'command.signOut', ['sign out', 'logout']))
  } else list.push(c('sign-in', 'command.signIn', ['sign in', 'login']))
  return list
}

/** Run a command. Returns false when it did not apply (no active tab, unknown id). */
export function runCommand(s: AppServices, id: CommandId): boolean {
  const tabs = s.engine.tabs.getState().value
  const activeId = tabs?.activeTabId ?? null
  const active = tabs?.tabs.find((t) => t.id === activeId) ?? null
  const t = tabsActions(
    s.bridge,
    () => s.engine.tabs.getState().value,
    () => s.client.spaces.store.getState().currentSpaceId,
    () => s.client.urlShare.store.getState(),
  )
  const quiet = (p: Promise<unknown>) => void p.catch(() => {})
  if (id.startsWith('switch-space:')) {
    quiet(s.client.spaces.select(id.slice('switch-space:'.length)))
    return true
  }
  switch (id) {
    case 'new-tab':
      void t.create()
      return true
    case 'new-window':
      quiet(s.bridge.invoke('window.create', {}))
      return true
    case 'new-private-window':
      quiet(s.bridge.invoke('window.create', { private: true }))
      return true
    case 'close-tab':
      if (!activeId) return false
      t.close(activeId)
      return true
    case 'reopen-closed-tab':
      t.reopenClosed()
      return true
    case 'reload':
      if (!activeId) return false
      t.reload(activeId)
      return true
    case 'share':
      void shareActions(s.client, s.overlay, () => activeId).present()
      return true
    case 'attach':
      void attachActions(s.client, s.overlay, () => activeId).present()
      return true
    case 'ask':
      s.layout.togglePanel()
      return true
    case 'space-home':
      s.router.toggle({ name: 'space-home', section: 'overview' })
      return true
    case 'settings':
      s.router.go({ name: 'settings', section: 'general' })
      return true
    case 'find':
      s.find.open()
      return true
    case 'downloads':
      s.shortcuts.dispatch('open-downloads')
      return true
    case 'history':
      s.shortcuts.dispatch('open-history')
      return true
    case 'toggle-sidebar':
      s.layout.toggleSidebar()
      return true
    case 'bookmark':
      if (!active?.url) return false
      quiet(s.bridge.invoke('bookmarks.add', { url: active.url, title: active.title, spaceId: s.client.spaces.store.getState().currentSpaceId }))
      return true
    case 'sign-in':
      s.router.go({ name: 'sign-in' })
      return true
    case 'sign-out':
      quiet(s.client.session.logout())
      return true
    default:
      return false
  }
}

/** Act on what the palette returned. */
export function runPaletteChoice(s: AppServices, choice: PaletteChoice): void {
  const activeId = s.engine.tabs.getState().value?.activeTabId ?? null
  const quiet = (p: Promise<unknown>) => void p.catch(() => {})
  if (choice.kind === 'command') {
    runCommand(s, choice.id)
    return
  }
  if (choice.kind === 'suggestion') {
    const sg = choice.suggestion
    if (sg.kind === 'tab' && sg.tabId) quiet(s.bridge.invoke('tabs.activate', { tabId: sg.tabId }))
    else if (activeId) quiet(s.bridge.invoke('tabs.navigate', { tabId: activeId, input: sg.url }))
    else quiet(s.bridge.invoke('tabs.create', { input: sg.url }))
    s.router.go({ name: 'page' })
    return
  }
  const text = choice.text.trim()
  if (!text) return
  if (activeId) quiet(s.bridge.invoke('tabs.navigate', { tabId: activeId, input: text }))
  else quiet(s.bridge.invoke('tabs.create', { input: text }))
  s.router.go({ name: 'page' })
}
