import type {
  AppInfo,
  Bookmark,
  Download,
  EngineBridge,
  EngineEventPayload,
  Settings,
  TabsState,
} from '@tiger/shared'
import { createStore, type WritableStore } from '../lib/store'

export type WindowState = EngineEventPayload<'window.state'>

/**
 * What the engine tells the UI about this window, kept current from engine events. One instance per
 * UI view; the stores are read with `useStore` through the hooks in `./hooks`.
 */
export interface EngineState {
  tabs: WritableStore<{ value: TabsState | null }>
  settings: WritableStore<{ value: Settings | null }>
  window: WritableStore<WindowState>
  downloads: WritableStore<{ list: Download[] }>
  bookmarks: WritableStore<{ list: Bookmark[] }>
  app: WritableStore<{ info: AppInfo | null }>
  /** Fetch the initial values and follow the events. Resolves once tabs and settings are known. */
  start(): Promise<void>
  dispose(): void
}

export function createEngineState(bridge: EngineBridge): EngineState {
  const tabs = createStore<{ value: TabsState | null }>({ value: null })
  const settings = createStore<{ value: Settings | null }>({ value: null })
  const win = createStore<WindowState>({ focused: true, fullscreen: false, maximized: false })
  const downloads = createStore<{ list: Download[] }>({ list: [] })
  const bookmarks = createStore<{ list: Bookmark[] }>({ list: [] })
  const app = createStore<{ info: AppInfo | null }>({ info: null })
  const offs: (() => void)[] = []
  let started: Promise<void> | null = null

  return {
    tabs,
    settings,
    window: win,
    downloads,
    bookmarks,
    app,
    start() {
      if (started) return started
      // Subscribe first so an event that lands while the initial reads are in flight is not lost;
      // an initial read that resolves after a newer event does not overwrite it.
      let tabsSeen = false
      let settingsSeen = false
      offs.push(
        bridge.on('tabs.changed', (value) => {
          tabsSeen = true
          tabs.setState({ value })
        }),
        bridge.on('settings.changed', (value) => {
          settingsSeen = true
          settings.setState({ value })
        }),
        bridge.on('window.state', (s) => win.replace(s)),
        bridge.on('downloads.changed', (list) => downloads.setState({ list })),
        bridge.on('bookmarks.changed', (list) => bookmarks.setState({ list })),
      )
      const quiet = <T>(p: Promise<T>) => p.catch(() => null)
      started = Promise.all([
        quiet(bridge.invoke('tabs.get')).then((value) => {
          if (value && !tabsSeen) tabs.setState({ value })
        }),
        quiet(bridge.invoke('settings.get')).then((value) => {
          if (value && !settingsSeen) settings.setState({ value })
        }),
        quiet(bridge.invoke('downloads.list')).then((list) => {
          if (list) downloads.setState({ list })
        }),
        quiet(bridge.invoke('bookmarks.list')).then((list) => {
          if (list) bookmarks.setState({ list })
        }),
        quiet(bridge.invoke('app.info')).then((info) => {
          if (info) app.setState({ info })
        }),
      ]).then(() => undefined)
      return started
    },
    dispose() {
      for (const off of offs.splice(0)) off()
    },
  }
}
