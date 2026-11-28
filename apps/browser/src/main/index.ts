import { join } from 'node:path'
import { app, Menu, protocol, session } from 'electron'
import { AppLinks, type InviteTarget } from './app-links'
import { Engine, TAB_PARTITION } from './engine'
import { env } from './env'
import { APP_LINK_SCHEME } from './invite'
import { appMenuTemplate, syncMenuState } from './menus'
import { UI_SCHEME } from './protocol'
import type { EngineWindow } from './window'

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

const inviteTarget = (win: EngineWindow): InviteTarget => ({
  focus: () => {
    if (win.base.isMinimized()) win.base.restore()
    win.base.focus()
  },
  whenUiLoaded: (fn) => win.whenUiLoaded(fn),
  emit: (event, payload) => win.emit(event, payload),
})

/** `tiger://invite/<token>` handed over by the operating system. */
const appLinks = new AppLinks({
  focused: () => {
    const win = engine?.focusedWindow()
    return win ? inviteTarget(win) : null
  },
  open: () => inviteTarget((engine as Engine).createWindow({ restore: true })),
})

/**
 * Make Tiger the operating system's handler for `tiger:` links. This is not the `tiger://ui`
 * protocol that serves the UI, which lives on the UI session only. Packaged builds only: dev and
 * test runs must not take over the machine's handler. macOS and Linux also get it from the
 * installer (Info.plist, the .desktop file's MimeType); an AppImage is left to its desktop entry,
 * because its executable path changes on every launch.
 */
function registerAsLinkHandler(): void {
  if (!app.isPackaged || process.platform === 'linux') return
  if (!app.isDefaultProtocolClient(APP_LINK_SCHEME)) app.setAsDefaultProtocolClient(APP_LINK_SCHEME)
}

function installMenu(e: Engine): void {
  const activeTab = () => e.focusedWindow()?.activeTab() ?? null
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      appMenuTemplate(process.platform, {
        shortcut: (action) => e.focusedWindow()?.shortcut(action),
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
  e.onMenuStateChange = () =>
    syncMenuState(Menu.getApplicationMenu(), {
      modalOverlayOpen: e.focusedWindow()?.modalOverlayOpen() ?? false,
    })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // macOS hands links over as an event, possibly before the app is ready.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    appLinks.openUrl(url)
  })
  // Windows and Linux pass the link as an argument: to this launch, or to a second one.
  appLinks.openArgv(process.argv)

  app.on('second-instance', (_event, argv) => {
    if (appLinks.openArgv(argv)) return
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
    registerAsLinkHandler()
    engine.createWindow({ restore: true })
    appLinks.start()

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
