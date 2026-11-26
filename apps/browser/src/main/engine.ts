import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  type EngineEventName,
  type EngineEventPayload,
  IPC_EVENT_CHANNEL,
  IPC_INVOKE_CHANNEL,
} from '@tiger/shared'
import {
  app,
  desktopCapturer,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  net,
  type Session,
  safeStorage,
  session,
  shell,
  type WebContents,
  type WebPreferences,
  webContents,
} from 'electron'
import { type CaptureDeps, captureTab, DomReply, type FetchedResource } from './capture'
import { TAB_CAPTURE_REQUEST, TAB_CAPTURE_RESULT, TAB_NOTIFICATION_STATE } from './channels'
import { createHandlers, type Handlers } from './commands'
import { DownloadManager, type DownloadScope } from './downloads'
import { devServerUrl, env } from './env'
import { fetchingOpener, googleConfigFromEnv, wantsFetchOpener } from './google/config'
import { GoogleService } from './google/service'
import { checkEvent, checkResponse, isTrustedSender, parseInvoke } from './ipc-validate'
import { PermissionBroker } from './permission-broker'
import { checkPermission, policyForRequest, webOrigin } from './permission-policy'
import { registerUiProtocol, serverConnectSources, UI_ORIGIN } from './protocol'
import { isWebUrl } from './resolve-input'
import { BookmarkStore } from './store/bookmarks'
import { KvStore, openDatabase } from './store/db'
import { HistoryStore, isNewVisit } from './store/history'
import {
  MemoryPermissionStore,
  type PermissionDecisions,
  PermissionStore,
} from './store/permissions'
import { type RestoredWindow, SessionRestoreStore } from './store/session-restore'
import { defaultSettings, SettingsStore } from './store/settings'
import { type Cipher, TokenStore } from './store/token'
import type { TabController } from './tab'
import { chromeLikeUserAgent } from './user-agent'
import { EngineWindow } from './window'

export const TAB_PARTITION = 'persist:tabs'
export const UI_PARTITION = 'persist:chrome-ui'

const CAPTURE_TIMEOUT_MS = 15_000
const MAX_FETCH_BYTES = 150 * 1024 * 1024

export interface EnginePaths {
  preloadDir: string
  rendererDir: string
}

/**
 * The engine: sessions, windows, stores and the IPC surface. Everything the UI can do goes through
 * `handlers`, reached only via the validated `tiger:invoke` channel.
 */
export class Engine {
  readonly windows = new Map<string, EngineWindow>()
  private readonly uiOwners = new Map<number, EngineWindow>()
  private readonly tabsByWc = new Map<number, TabController>()
  private readonly captureWaiters = new Map<
    string,
    { wcId: number; resolve: (r: DomReply) => void; timer: NodeJS.Timeout }
  >()
  private lastNormalWindow: EngineWindow | null = null
  private restoreTimer: NodeJS.Timeout | null = null
  private quitting = false

  readonly kv: KvStore
  readonly history: HistoryStore
  readonly bookmarks: BookmarkStore
  readonly settings: SettingsStore
  readonly sessionRestore: SessionRestoreStore
  readonly tokens: TokenStore
  readonly google: GoogleService
  readonly broker: PermissionBroker
  readonly downloads: DownloadManager
  readonly uiSession: Session
  readonly tabSession: Session
  private readonly persistentDecisions: PermissionStore
  private readonly sessionDecisions = new WeakMap<Session, PermissionDecisions>()
  private readonly privateScopes = new Map<EngineWindow, string>()
  readonly userAgent: string
  readonly devToolsAllowed = !app.isPackaged
  private readonly handlers: Handlers

  constructor(private readonly paths: EnginePaths) {
    const db = openDatabase(join(app.getPath('userData'), 'tiger.db'))
    this.kv = new KvStore(db)
    this.history = new HistoryStore(db)
    this.bookmarks = new BookmarkStore(db)
    this.settings = new SettingsStore(this.kv, defaultSettings(app.getLocale(), env.serverUrl))
    this.sessionRestore = new SessionRestoreStore(this.kv)
    this.persistentDecisions = new PermissionStore(db)
    const cipher: Cipher = {
      isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
      encrypt: (plain) => safeStorage.encryptStringAsync(plain),
      decrypt: async (sealed) => (await safeStorage.decryptStringAsync(sealed)).result,
    }
    this.tokens = new TokenStore(this.kv, cipher)
    this.google = this.createGoogle(cipher)
    this.broker = new PermissionBroker((windowId, request) => {
      this.windows.get(windowId)?.emit('permission.request', request)
    })
    this.downloads = new DownloadManager(
      () => env.downloadsDir ?? app.getPath('downloads'),
      (scope, list) => {
        // A private window's downloads go to that window only; the shared list to normal windows.
        for (const win of this.windows.values()) {
          if (!win.closed && this.downloadScopeOf(win) === scope)
            win.emit('downloads.changed', list)
        }
      },
    )
    this.userAgent = chromeLikeUserAgent(app.userAgentFallback)
    app.userAgentFallback = this.userAgent

    this.uiSession = session.fromPartition(UI_PARTITION)
    this.hardenUiSession(this.uiSession)
    this.tabSession = session.fromPartition(TAB_PARTITION)
    this.hardenTabSession(this.tabSession, this.persistentDecisions, null)

    this.handlers = createHandlers(this)
    this.wireIpc()
  }

  private createGoogle(cipher: Cipher): GoogleService {
    // Endpoint overrides and the fetching opener exist for tests; a packaged build ignores them.
    const overrides = { allowOverrides: !app.isPackaged }
    // Chromium's network stack: system proxy settings apply, and no cookies are sent.
    const fetchImpl = (input: string, init?: RequestInit) =>
      net.fetch(input, { ...init, credentials: 'omit' })
    return new GoogleService({
      config: googleConfigFromEnv(process.env, overrides),
      store: new TokenStore(this.kv, cipher, 'google.account'),
      fetch: fetchImpl,
      openBrowser: wantsFetchOpener(process.env, overrides)
        ? fetchingOpener(fetchImpl)
        : (url) => shell.openExternal(url),
      onChange: (connection) => this.broadcast('google.changed', connection),
      log: (message) => console.warn(message),
    })
  }

  // ── Web preferences ──────────────────────────────────────────────────────

  uiWebPreferences(): WebPreferences {
    return {
      session: this.uiSession,
      preload: join(this.paths.preloadDir, 'ui.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      spellcheck: false,
    }
  }

  tabWebPreferences(ses: Session): WebPreferences {
    return {
      session: ses,
      // Exposes nothing to the page: it answers capture requests from the isolated world only.
      preload: join(this.paths.preloadDir, 'tab.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
      spellcheck: true,
    }
  }

  loadUi(wc: WebContents, route: 'main' | 'overlay'): void {
    const dev = devServerUrl()
    const base = dev ?? `${UI_ORIGIN}/index.html`
    const url = route === 'overlay' ? `${base}#overlay` : base
    wc.loadURL(url).catch(() => {})
  }

  // ── Sessions ─────────────────────────────────────────────────────────────

  private hardenUiSession(ses: Session): void {
    registerUiProtocol(ses, this.paths.rendererDir, () => this.settings.get().serverUrl)
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
    ses.setDevicePermissionHandler(() => false)
    ses.webRequest.onBeforeRequest({ urls: ['file://*/*'] }, (_d, cb) => cb({ cancel: true }))
    const dev = devServerUrl()
    if (dev) {
      // The Vite dev server needs inline module preambles and a websocket; production never does.
      ses.webRequest.onHeadersReceived((details, cb) => {
        const headers = { ...details.responseHeaders }
        if (details.url.startsWith(dev)) {
          headers['Content-Security-Policy'] = [
            `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; connect-src 'self' ws: ${dev} ${serverConnectSources(this.settings.get().serverUrl).join(' ')}`,
          ]
        }
        cb({ responseHeaders: headers })
      })
    }
  }

  hardenTabSession(
    ses: Session,
    decisions: PermissionDecisions,
    downloadScope: DownloadScope,
  ): void {
    this.sessionDecisions.set(ses, decisions)
    ses.setUserAgent(this.userAgent)
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      const tab = this.tabsByWc.get(wc.id)
      const origin = webOrigin(details.requestingUrl || wc.getURL())
      const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
      const policy = policyForRequest(permission, mediaTypes)
      if (policy.action === 'grant') return callback(true)
      if (policy.action === 'deny' || !tab || !origin) return callback(false)
      this.broker
        .ask({
          tabId: tab.id,
          windowId: tab.window.id,
          origin,
          permission: policy.permission,
          decisions,
        })
        .then(callback, () => callback(false))
    })
    ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
      const origin = webOrigin(requestingOrigin)
      if (!origin) return false
      return checkPermission(decisions, permission, origin, details.mediaType)
    })
    ses.setDevicePermissionHandler(() => false)
    ses.setDisplayMediaRequestHandler((request, callback) => {
      const wc = request.frame ? webContents.fromFrame(request.frame) : undefined
      const tab = wc ? this.tabsByWc.get(wc.id) : undefined
      const origin = webOrigin(request.securityOrigin ?? request.frame?.url ?? '')
      if (!tab || !origin) return callback(null)
      this.broker
        .ask({
          tabId: tab.id,
          windowId: tab.window.id,
          origin,
          permission: 'screen-capture',
          decisions,
        })
        .then(async (allow) => {
          if (!allow) return callback(null)
          const [source] = await desktopCapturer.getSources({ types: ['screen'] })
          callback(source ? { video: source } : null)
        })
        .catch(() => callback(null))
    })
    ses.webRequest.onBeforeRequest({ urls: ['file://*/*'] }, (_d, cb) => cb({ cancel: true }))
    this.downloads.attach(ses, downloadScope)
  }

  /** Which downloads a window lists: its own private ones, or the shared normal-window ones. */
  downloadScopeOf(win: EngineWindow): DownloadScope {
    return this.privateScopes.get(win) ?? null
  }

  // ── Windows ──────────────────────────────────────────────────────────────

  createWindow(opts: { private?: boolean; restore?: boolean } = {}): EngineWindow {
    const saved = opts.restore && !opts.private ? this.sessionRestore.load() : []
    const win = this.openWindow(opts.private ?? false, saved[0] ?? null)
    // Every other window of the last session reopens too, in the order they were opened.
    for (const extra of saved.slice(1)) this.openWindow(false, extra)
    if (saved.length > 1) win.base.focus()
    return win
  }

  private openWindow(isPrivate: boolean, restore: RestoredWindow | null): EngineWindow {
    let ses = this.tabSession
    let decisions: PermissionDecisions = this.persistentDecisions
    let scope: string | null = null
    if (isPrivate) {
      // No "persist:" prefix: an in-memory partition that dies with the window.
      scope = `private-${randomUUID()}`
      ses = session.fromPartition(scope)
      decisions = new MemoryPermissionStore()
      this.hardenTabSession(ses, decisions, scope)
    }
    const win = new EngineWindow(this, isPrivate, ses, decisions)
    if (scope) this.privateScopes.set(win, scope)
    this.windows.set(win.id, win)
    this.uiOwners.set(win.uiWc.id, win)
    this.uiOwners.set(win.overlayWc.id, win)
    if (!win.isPrivate) this.lastNormalWindow = win

    if (restore?.tabs.length) win.restore(restore.tabs, restore.activeIndex)
    else win.createTab({})
    return win
  }

  windowFocused(win: EngineWindow): void {
    if (!win.isPrivate) this.lastNormalWindow = win
  }

  /** Session restore covers every open normal window; changes are saved after a short pause. */
  windowTabsChanged(win: EngineWindow): void {
    if (win.isPrivate) return
    if (this.restoreTimer) clearTimeout(this.restoreTimer)
    this.restoreTimer = setTimeout(() => this.saveSession(), 300)
  }

  /** Save the open normal windows (or exactly `only`, for the last window as it closes). */
  saveSession(only?: EngineWindow, except?: EngineWindow): void {
    if (this.restoreTimer) clearTimeout(this.restoreTimer)
    this.restoreTimer = null
    if (this.quitting) return
    const wins = only
      ? [only]
      : [...this.windows.values()].filter((w) => !w.isPrivate && !w.closed && w !== except)
    this.sessionRestore.save(
      wins.map((win) => {
        const active = win.tabs.findIndex((t) => t.id === win.activeTabId)
        return {
          tabs: win.tabs.map((t) => ({
            url: t.displayUrl(),
            title: t.title,
            pinned: t.pinned,
            spaceId: t.spaceId,
          })),
          activeIndex: active === -1 ? null : active,
        }
      }),
    )
  }

  /** Save the session once; windows closing during shutdown must not overwrite it. */
  prepareQuit(): void {
    if (this.quitting) return
    this.saveSession()
    this.quitting = true
  }

  windowClosing(win: EngineWindow): void {
    if (win.isPrivate || this.quitting) return
    const others = [...this.windows.values()].filter((w) => w !== win && !w.isPrivate && !w.closed)
    // The last normal window to close is the one restored next time; a window closed while others
    // stay open is not.
    if (others.length === 0) this.saveSession(win)
    else {
      this.saveSession(undefined, win)
      if (this.lastNormalWindow === win) this.lastNormalWindow = others[others.length - 1] ?? null
    }
  }

  windowClosed(win: EngineWindow): void {
    this.windows.delete(win.id)
    for (const [id, owner] of this.uiOwners) if (owner === win) this.uiOwners.delete(id)
    if (this.lastNormalWindow === win) this.lastNormalWindow = null
    const scope = this.privateScopes.get(win)
    if (scope) {
      // Listed nowhere once the window is gone; the files stay on disk.
      this.downloads.dropScope(scope)
      this.privateScopes.delete(win)
    }
    if (win.isPrivate) {
      // In-memory already; clearing makes sure nothing outlives the window even within this run.
      win.tabSession.clearStorageData().catch(() => {})
      win.tabSession.clearCache().catch(() => {})
    }
  }

  windowForUi(wcId: number): EngineWindow | undefined {
    return this.uiOwners.get(wcId)
  }

  focusedWindow(): EngineWindow | null {
    const wins = [...this.windows.values()]
    return wins.find((w) => w.base.isFocused()) ?? this.lastNormalWindow ?? wins[0] ?? null
  }

  registerTab(tab: TabController): void {
    this.tabsByWc.set(tab.wc.id, tab)
  }

  unregisterTab(tab: TabController): void {
    if (this.tabsByWc.get(tab.wc.id) === tab) this.tabsByWc.delete(tab.wc.id)
  }

  allTabs(): TabController[] {
    return [...this.tabsByWc.values()]
  }

  // ── History ──────────────────────────────────────────────────────────────

  /**
   * A main-frame navigation commit. A same-document change (pushState, #fragment) is a visit only
   * when the path or query changed; otherwise it at most renames the page.
   */
  recordVisit(
    tab: TabController,
    url: string,
    previousUrl: string | null,
    sameDocument: boolean,
  ): void {
    if (tab.window.isPrivate || !isWebUrl(url)) return
    if (sameDocument && !isNewVisit(previousUrl, url)) return
    this.history.recordVisit(url, tab.title)
  }

  updateHistoryTitle(tab: TabController, url: string, title: string): void {
    if (tab.window.isPrivate || !isWebUrl(url)) return
    this.history.updateTitle(url, title)
  }

  // ── Events ───────────────────────────────────────────────────────────────

  sendEvent<E extends EngineEventName>(
    targets: readonly WebContents[],
    event: E,
    payload: EngineEventPayload<E>,
  ): void {
    let checked: unknown
    try {
      checked = checkEvent(event, payload)
    } catch (err) {
      // An engine bug must not reach the UI as a contract breach, nor take the main process down.
      console.error(`tiger: dropped invalid ${event} event`, err)
      return
    }
    for (const wc of targets) if (!wc.isDestroyed()) wc.send(IPC_EVENT_CHANNEL, event, checked)
  }

  broadcast<E extends EngineEventName>(event: E, payload: EngineEventPayload<E>): void {
    for (const win of this.windows.values()) if (!win.closed) win.emit(event, payload)
  }

  settingsChanged(): void {
    this.broadcast('settings.changed', this.settings.get())
    // Capture eligibility depends on the member's own blocked hosts.
    for (const win of this.windows.values()) win.tabChanged()
  }

  // ── Capture ──────────────────────────────────────────────────────────────

  private requestDomExtraction(tab: TabController): Promise<DomReply> {
    return new Promise((resolve) => {
      const id = randomUUID()
      const url = tab.committedUrl()
      const timer = setTimeout(() => {
        this.captureWaiters.delete(id)
        resolve({ kind: 'error', url, message: 'extraction timed out' })
      }, CAPTURE_TIMEOUT_MS)
      this.captureWaiters.set(id, { wcId: tab.wc.id, resolve, timer })
      tab.wc.send(TAB_CAPTURE_REQUEST, id)
    })
  }

  private async fetchWithSession(
    ses: Session,
    url: string,
    mode: 'export' | 'displayed-copy',
  ): Promise<FetchedResource> {
    if (mode === 'displayed-copy') return this.readDisplayedCopy(ses, url)
    const res = await ses.fetch(url, {
      credentials: 'include',
      redirect: 'follow',
      cache: 'no-store',
    })
    const length = Number(res.headers.get('content-length') ?? 0)
    if (length > MAX_FETCH_BYTES) throw new Error('resource too large')
    const body = new Uint8Array(await res.arrayBuffer())
    if (body.byteLength > MAX_FETCH_BYTES) throw new Error('resource too large')
    return {
      status: res.status,
      contentType: res.headers.get('content-type'),
      finalUrl: res.url || null,
      body,
    }
  }

  /**
   * The bytes the tab displayed, from the session's HTTP cache only: no network request (so no second,
   * different answer from the server) and no redirect (the committed URL is already past any).
   * `fetch` refuses `only-if-cached` outside same-origin mode, so this uses `net.request`.
   */
  private readDisplayedCopy(ses: Session, url: string): Promise<FetchedResource> {
    const notCached = (why: string) =>
      new Error(
        `the displayed copy is not in the cache (sent with no-store, too large, or a POST result), so it cannot be read again safely: ${why}`,
      )
    return new Promise((resolve, reject) => {
      const req = net.request({
        url,
        session: ses,
        useSessionCookies: true,
        credentials: 'include',
        redirect: 'error',
        cache: 'only-if-cached',
      })
      req.on('error', (err) => reject(notCached(err.message)))
      req.on('response', (res) => {
        const header = (name: string) => {
          const v = res.headers[name]
          return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
        }
        if (Number(header('content-length') ?? 0) > MAX_FETCH_BYTES) {
          req.abort()
          return reject(new Error('resource too large'))
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.byteLength
          if (size > MAX_FETCH_BYTES) {
            req.abort()
            reject(new Error('resource too large'))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            contentType: header('content-type'),
            finalUrl: url,
            body: new Uint8Array(Buffer.concat(chunks)),
          }),
        )
        res.on('error', (err: Error) => reject(notCached(err.message)))
      })
      req.end()
    })
  }

  async capture(tab: TabController) {
    const deps: CaptureDeps = {
      userBlockedHosts: () => this.settings.get().userBlockedHosts,
      now: () => new Date(),
      extractDom: () => this.requestDomExtraction(tab),
      fetchWithTabSession: (url, mode) => this.fetchWithSession(tab.window.tabSession, url, mode),
      extractPdf: async (bytes) => {
        const { extractPdf } = await import('@tiger/extract/pdf')
        return extractPdf(bytes)
      },
    }
    return captureTab(
      {
        currentUrl: () => tab.committedUrl(),
        title: () => tab.title,
        isPrivate: tab.window.isPrivate,
      },
      deps,
    )
  }

  // ── IPC ──────────────────────────────────────────────────────────────────

  private trustedUiSender(e: IpcMainInvokeEvent | IpcMainEvent): EngineWindow | null {
    const frame = e.senderFrame
    const ok = isTrustedSender(
      {
        webContentsId: e.sender.id,
        frameUrl: frame ? frame.url : null,
        isMainFrame: frame !== null && frame.parent === null,
      },
      new Set(this.uiOwners.keys()),
      devServerUrl(),
    )
    return ok ? (this.uiOwners.get(e.sender.id) ?? null) : null
  }

  private wireIpc(): void {
    ipcMain.handle(IPC_INVOKE_CHANNEL, async (e, name: unknown, payload: unknown) => {
      const win = this.trustedUiSender(e)
      if (!win) throw new Error('forbidden')
      const parsed = parseInvoke(name, payload)
      if (!parsed.ok) throw new Error(parsed.error)
      const handler = this.handlers[parsed.name] as (req: unknown, w: EngineWindow) => unknown
      const result = await handler(parsed.request, win)
      return checkResponse(parsed.name, result)
    })

    ipcMain.on(TAB_CAPTURE_RESULT, (e, id: unknown, reply: unknown) => {
      if (typeof id !== 'string') return
      const waiter = this.captureWaiters.get(id)
      if (!waiter || waiter.wcId !== e.sender.id) return
      if (!e.senderFrame || e.senderFrame.parent !== null) return
      this.captureWaiters.delete(id)
      clearTimeout(waiter.timer)
      const parsed = DomReply.safeParse(reply)
      waiter.resolve(
        parsed.success
          ? parsed.data
          : { kind: 'error', url: '', message: 'malformed extraction reply' },
      )
    })

    ipcMain.on(TAB_NOTIFICATION_STATE, (e) => {
      const tab = this.tabsByWc.get(e.sender.id)
      const origin = webOrigin(e.senderFrame?.url ?? '')
      const decisions = tab ? this.sessionDecisions.get(tab.window.tabSession) : undefined
      if (!tab || !origin || !decisions) {
        e.returnValue = 'denied'
        return
      }
      const d = decisions.get(origin, 'notifications')
      e.returnValue = d === undefined ? 'default' : d ? 'granted' : 'denied'
    })
  }
}
