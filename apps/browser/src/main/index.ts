import { join } from 'node:path'
import { app, Menu, protocol, session } from 'electron'
import { Engine, TAB_PARTITION } from './engine'
import { env } from './env'
import { appMenuTemplate } from './menus'
import { UI_SCHEME } from './protocol'

if (env.userDataDir) app.setPath('userData', env.userDataDir)

// Chromium's OS sandbox cannot start as root (test containers). Tests opt out explicitly; the app
// itself always runs sandboxed.
if (env.noSandbox) app.commandLine.appendSwitch('no-sandbox')
else app.enableSandbox()

protocol.registerSchemesAsPrivileged([
  {
    scheme: UI_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
  },
])

let engine: Engine | null = null

function installMenu(e: Engine): void {
  const activeTab = () => e.focusedWindow()?.activeTab() ?? null
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      appMenuTemplate(process.platform, {
        shortcut: (action) => e.focusedWindow()?.emit('shortcut', { action }),
        reload: (ignoreCache) => {
          const tab = activeTab()
          if (!tab) return
          if (ignoreCache) tab.wc.reloadIgnoringCache()
          else tab.wc.reload()
        },
        back: () => {
          const nav = activeTab()?.wc.navigationHistory
          if (nav?.canGoBack()) nav.goBack()
        },
        forward: () => {
          const nav = activeTab()?.wc.navigationHistory
          if (nav?.canGoForward()) nav.goForward()
        },
        zoom: (direction) => activeTab()?.zoom(direction),
        toggleDevTools: () => {
          if (!e.devToolsAllowed) return
          activeTab()?.wc.toggleDevTools()
        },
        toggleFullscreen: () => e.focusedWindow()?.toggleFullscreen(),
      }),
    ),
  )
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = engine?.focusedWindow()
    if (win) win.base.focus()
    else engine?.createWindow({})
  })

  app.on('web-contents-created', (_e, wc) => {
    // No <webview> anywhere, whatever a page or a bug tries.
    wc.on('will-attach-webview', (ev) => ev.preventDefault())
  })

  app.whenReady().then(() => {
    engine = new Engine({
      preloadDir: join(__dirname, '../preload'),
      rendererDir: join(__dirname, '../renderer'),
    })
    installMenu(engine)
    engine.createWindow({ restore: true })

    app.on('activate', () => {
      if (engine && engine.windows.size === 0) engine.createWindow({ restore: true })
    })
  })

  app.on('before-quit', () => {
    engine?.prepareQuit()
    // Cookies written in the last seconds must reach disk before exit.
    session
      .fromPartition(TAB_PARTITION)
      .cookies.flushStore()
      .catch(() => {})
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
