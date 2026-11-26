import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EngineCommandName, EngineRequest, EngineResponse, Settings } from '@tiger/shared'
import { app, clipboard, dialog } from 'electron'
import type { Engine } from './engine'
import { env } from './env'
import { safeFileName } from './files'
import { resolveInput } from './resolve-input'
import { mergeSuggestions } from './suggest'
import type { EngineWindow } from './window'

/** Commands whose response is `undefined` may be implemented by functions returning nothing. */
// biome-ignore lint/suspicious/noConfusingVoidType: void lets handlers end in a void call such as wc.stop()
type Out<T> = [T] extends [undefined] ? void : T

type Handler<K extends EngineCommandName> = (
  request: EngineRequest<K>,
  win: EngineWindow,
) => Out<EngineResponse<K>> | Promise<Out<EngineResponse<K>>>

/** One handler per contract command; a missing one is a compile error. */
export type Handlers = { [K in EngineCommandName]: Handler<K> }

export function createHandlers(engine: Engine): Handlers {
  const resolve = (input: string) => resolveInput(input, engine.settings.get().searchEngine)

  return {
    'app.info': () => ({
      version: app.getVersion(),
      engine: 'electron',
      engineVersion: process.versions.electron,
      chromiumVersion: process.versions.chrome,
      platform: process.platform as 'darwin' | 'win32' | 'linux',
      systemLocale: app.getSystemLocale() || app.getLocale(),
    }),

    'tabs.get': (_req, win) => win.tabsState(),
    'tabs.create': (req, win) => {
      const url = req.input ? resolve(req.input) : null
      return win
        .createTab({ url, active: req.active ?? true, spaceId: req.spaceId ?? null })
        .state()
    },
    'tabs.close': (req, win) => win.closeTab(req.tabId),
    'tabs.activate': (req, win) => win.activate(req.tabId),
    'tabs.navigate': (req, win) => {
      const tab = win.getTab(req.tabId)
      const url = resolve(req.input)
      if (url) tab.load(url)
    },
    'tabs.back': (req, win) => {
      const nav = win.getTab(req.tabId).wc.navigationHistory
      if (nav.canGoBack()) nav.goBack()
    },
    'tabs.forward': (req, win) => {
      const nav = win.getTab(req.tabId).wc.navigationHistory
      if (nav.canGoForward()) nav.goForward()
    },
    'tabs.reload': (req, win) => {
      const tab = win.getTab(req.tabId)
      if (req.ignoreCache) tab.wc.reloadIgnoringCache()
      else tab.wc.reload()
    },
    'tabs.stop': (req, win) => win.getTab(req.tabId).wc.stop(),
    'tabs.move': (req, win) => win.move(req.tabId, req.toIndex),
    'tabs.setSpace': (req, win) => {
      win.getTab(req.tabId).spaceId = req.spaceId
      win.tabChanged()
    },
    'tabs.setPinned': (req, win) => win.setPinned(req.tabId, req.pinned),
    'tabs.duplicate': (req, win) => win.duplicate(req.tabId).state(),
    'tabs.reopenClosed': (_req, win) => win.reopenClosed()?.state() ?? null,

    'page.setBounds': (req, win) => win.setPageBounds(req.bounds, req.cornerRadius),
    'page.find': (req, win) => {
      const tab = win.getTab(req.tabId)
      if (!req.text) {
        tab.wc.stopFindInPage('clearSelection')
        return
      }
      tab.wc.findInPage(req.text, { forward: req.forward, findNext: req.findNext })
    },
    'page.stopFind': (req, win) => win.getTab(req.tabId).wc.stopFindInPage('clearSelection'),
    'page.setZoom': (req, win) => {
      const tab = win.getTab(req.tabId)
      tab.wc.setZoomFactor(req.factor)
      win.tabChanged()
    },
    'page.print': (req, win) => {
      win.getTab(req.tabId).wc.print({}, () => {})
    },

    'capture.extract': async (req, win) => {
      const tab = win.tabs.find((t) => t.id === req.tabId)
      if (!tab || tab.destroyed) {
        return { ok: false, error: 'no-tab', reason: null, detail: null }
      }
      return engine.capture(tab)
    },

    'overlay.setOpen': (req, win) => win.setOverlay(req.open, req.bounds ?? null),

    'permission.respond': (req, win) =>
      engine.broker.respond(req.requestId, req.allow, req.remember, win.id),

    'suggest.query': (req, win) => {
      const q = req.input.trim()
      return mergeSuggestions(req.input, {
        tabs: win.tabs.map((t) => ({ id: t.id, url: t.displayUrl(), title: t.title })),
        bookmarks: engine.bookmarks.search(q, 8),
        // Private windows do not mix the member's history into what is shown.
        history: win.isPrivate ? [] : engine.history.topMatches(q, 8),
        engine: engine.settings.get().searchEngine,
      })
    },

    'downloads.list': () => engine.downloads.list(),
    'downloads.cancel': (req) => engine.downloads.cancel(req.id),
    'downloads.open': (req) => engine.downloads.open(req.id),
    'downloads.showInFolder': (req) => engine.downloads.showInFolder(req.id),
    'downloads.clear': () => engine.downloads.clear(),

    'bookmarks.list': () => engine.bookmarks.list(),
    'bookmarks.add': (req) => {
      const bookmark = engine.bookmarks.add({
        url: req.url,
        title: req.title,
        spaceId: req.spaceId,
      })
      engine.broadcast('bookmarks.changed', engine.bookmarks.list())
      return bookmark
    },
    'bookmarks.remove': (req) => {
      engine.bookmarks.remove(req.id)
      engine.broadcast('bookmarks.changed', engine.bookmarks.list())
    },

    'history.search': (req) => engine.history.search(req.query, req.limit ?? 100),
    'history.remove': (req) => engine.history.remove(req.id),
    'history.clear': () => engine.history.clear(),

    'settings.get': () => engine.settings.get(),
    'settings.update': (req) => {
      const next: Settings = engine.settings.update(req)
      engine.settingsChanged()
      return next
    },

    'auth.getToken': () => engine.tokens.get(),
    'auth.setToken': (req) => engine.tokens.set(req.token),
    'auth.googleSignIn': () => engine.google.signIn(),

    'google.status': () => engine.google.status(),
    'google.connect': () => engine.google.connect(),
    'google.disconnect': () => engine.google.disconnect(),
    'google.exportDoc': (req) => engine.google.exportDoc(req),

    'export.saveFile': async (req, win) => {
      const name = `${safeFileName(req.suggestedName).replace(/\.(md|txt)$/i, '')}.${req.extension}`
      const result = await dialog.showSaveDialog(win.base, {
        defaultPath: join(env.downloadsDir ?? app.getPath('downloads'), name),
        filters: [
          req.extension === 'md'
            ? { name: 'Markdown', extensions: ['md'] }
            : { name: 'Text', extensions: ['txt'] },
        ],
      })
      if (result.canceled || !result.filePath) return null
      await writeFile(result.filePath, req.content, 'utf8')
      return { path: result.filePath }
    },
    'clipboard.writeText': (req) => clipboard.writeText(req.text),

    'window.create': (req) => {
      engine.createWindow({ private: req.private ?? false })
    },
    'window.action': (req, win) => {
      const b = win.base
      switch (req.action) {
        case 'minimize':
          b.minimize()
          break
        case 'toggle-maximize':
          if (b.isMaximized()) b.unmaximize()
          else b.maximize()
          break
        case 'close':
          b.close()
          break
        case 'toggle-fullscreen':
          b.setFullScreen(!b.isFullScreen())
          break
      }
    },
  }
}
