import { presentPalette } from '../features/palette'
import { shareActions } from '../features/share'
import { tabsActions } from '../features/tabs'
import { popoverAt } from '../overlay/anchors'
import { runCommand } from './commands'
import type { AppServices } from './services'

/**
 * The application menu's shortcuts, bound to the feature hooks' actions. A component can take an
 * action over while it is mounted with `useShortcut`; these are the defaults underneath.
 * Returns the cleanup.
 */
export function bindDefaultShortcuts(s: AppServices): () => void {
  const tabs = tabsActions(
    s.bridge,
    () => s.engine.tabs.getState().value,
    () => s.client.spaces.store.getState().currentSpaceId,
    () => s.client.urlShare.store.getState(),
  )
  const activeId = () => s.engine.tabs.getState().value?.activeTabId ?? null
  const paletteOpen = () => s.overlay.store.getState().open?.surface === 'palette'
  const offs = [
    s.shortcuts.on('new-tab', () => {
      void tabs.create()
      s.router.go({ name: 'page' })
    }),
    s.shortcuts.on('new-window', () => runCommand(s, 'new-window')),
    s.shortcuts.on('new-private-window', () => runCommand(s, 'new-private-window')),
    s.shortcuts.on('close-tab', () => runCommand(s, 'close-tab')),
    s.shortcuts.on('reopen-closed-tab', () => runCommand(s, 'reopen-closed-tab')),
    s.shortcuts.on('focus-address', () => {
      s.router.go({ name: 'page' })
      s.omnibox.requestFocus()
    }),
    s.shortcuts.on('toggle-command', () => {
      if (paletteOpen()) s.overlay.closeAll('closed')
      else void presentPalette(s, 'commands')
    }),
    s.shortcuts.on('toggle-side-panel', () => s.layout.togglePanel()),
    s.shortcuts.on('toggle-space-home', () =>
      s.router.toggle({ name: 'space-home', section: 'overview' }),
    ),
    s.shortcuts.on('share-tab', () => {
      const id = activeId()
      if (id) void shareActions(s.client, s.overlay, activeId).present(id)
    }),
    s.shortcuts.on('find', () => s.find.open()),
    s.shortcuts.on('next-tab', () => tabs.cycle(1)),
    s.shortcuts.on('previous-tab', () => tabs.cycle(-1)),
    s.shortcuts.on('bookmark-tab', () => runCommand(s, 'bookmark')),
    s.shortcuts.on('open-history', () => void presentPalette(s, 'history')),
    s.shortcuts.on('open-downloads', () => {
      if (s.overlay.store.getState().open?.surface === 'downloads') s.overlay.closeAll('closed')
      else void s.overlay.open('downloads', {}, popoverAt('downloads', 'downloads')).outcome
    }),
    s.shortcuts.on('open-settings', () =>
      s.router.toggle({ name: 'settings', section: 'general' }),
    ),
  ]
  return () => {
    for (const off of offs) off()
  }
}
