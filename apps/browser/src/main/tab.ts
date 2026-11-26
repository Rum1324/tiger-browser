import type { Tab } from '@tiger/shared'
import {
  type BrowserWindowConstructorOptions,
  clipboard,
  Menu,
  type WebContents,
  WebContentsView,
} from 'electron'
import { eligibilityFor } from './capture'
import { pageMenuTemplate } from './menus'
import { isWebUrl } from './resolve-input'
import type { EngineWindow } from './window'

export interface TabOptions {
  /** A popup created by the page: Chromium already made its webContents (window.opener intact). */
  adopt?: BrowserWindowConstructorOptions & { webContents?: WebContents }
  spaceId: string | null
  pinned?: boolean
  openerId?: string | null
}

let nextTabId = 1

/** Frames may also show about:blank / about:srcdoc; anything other than http(s) is refused. */
const frameUrlAllowed = (url: string) => isWebUrl(url) || url === 'about:blank' || url === 'about:srcdoc'

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]

export function nextZoom(current: number, direction: 'in' | 'out'): number {
  if (direction === 'in') return ZOOM_STEPS.find((z) => z > current + 0.001) ?? 5
  return [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001) ?? 0.25
}

export class TabController {
  readonly id = `t${nextTabId++}`
  readonly view: WebContentsView
  /**
   * Our own reference, taken once. Electron 45 hangs the main process when view.webContents is read
   * after an adopted popup's webContents was destroyed, so the view's getter is never used again.
   */
  readonly wc: WebContents
  destroyed = false
  title = ''
  faviconUrl: string | null = null
  isLoading = false
  crashed = false
  audible = false
  loadError: { code: number; description: string } | null = null
  pinned: boolean
  spaceId: string | null
  readonly openerId: string | null
  /** The URL being loaded before it commits, so the UI can show what was typed. */
  private pendingUrl: string | null = null

  constructor(
    readonly window: EngineWindow,
    opts: TabOptions,
  ) {
    const prefs = window.engine.tabWebPreferences(window.tabSession)
    this.view = opts.adopt?.webContents
      ? new WebContentsView({ webPreferences: prefs, webContents: opts.adopt.webContents })
      : new WebContentsView({ webPreferences: prefs })
    this.wc = this.view.webContents
    this.view.setBackgroundColor('#ffffff')
    this.pinned = opts.pinned ?? false
    this.spaceId = opts.spaceId
    this.openerId = opts.openerId ?? null
    this.wire()
  }

  /** The committed URL of the main frame: the only URL capture decisions are based on. */
  committedUrl(): string {
    if (this.destroyed || this.wc.isDestroyed()) return ''
    return this.wc.getURL()
  }

  /** What the UI shows. The blank new-tab page reports '' so the UI can draw its own start page. */
  displayUrl(): string {
    const committed = this.committedUrl()
    if (this.pendingUrl) return committed && committed !== 'about:blank' ? committed : this.pendingUrl
    return committed === 'about:blank' ? '' : committed
  }

  /**
   * A new tab shows about:blank. It must load something: a webContents that never navigates has no
   * renderer, and DevTools-protocol clients (Playwright) wait on it forever.
   */
  loadBlank(): void {
    this.wc.loadURL('about:blank').catch(() => {})
  }

  state(): Tab {
    const committed = this.committedUrl()
    const url = this.displayUrl()
    const alive = !this.destroyed && !this.wc.isDestroyed()
    const nav = alive ? this.wc.navigationHistory : null
    let security: Tab['security'] = 'internal'
    if (url.startsWith('https:')) security = 'secure'
    else if (url.startsWith('http:')) security = 'insecure'
    return {
      id: this.id,
      url,
      title: this.title,
      faviconUrl: this.faviconUrl,
      isLoading: this.isLoading,
      canGoBack: nav?.canGoBack() ?? false,
      canGoForward: nav?.canGoForward() ?? false,
      isPrivate: this.window.isPrivate,
      spaceId: this.spaceId,
      pinned: this.pinned,
      audible: this.audible,
      crashed: this.crashed,
      security,
      capture: eligibilityFor(
        committed,
        this.window.isPrivate,
        this.window.engine.settings.get().userBlockedHosts,
      ),
      loadError: this.loadError,
      zoomFactor: alive ? this.wc.getZoomFactor() : 1,
    }
  }

  load(url: string): void {
    if (!isWebUrl(url) || this.destroyed) return
    this.pendingUrl = url
    this.loadError = null
    // Failures are reported through did-fail-load; the promise rejection carries nothing more.
    this.wc.loadURL(url).catch(() => {})
    this.changed()
  }

  close(): void {
    if (this.destroyed || this.wc.isDestroyed()) return
    this.wc.close()
  }

  zoom(direction: 'in' | 'out' | 'reset'): void {
    if (this.destroyed) return
    const next = direction === 'reset' ? 1 : nextZoom(this.wc.getZoomFactor(), direction)
    this.wc.setZoomFactor(next)
    this.changed()
  }

  private changed(): void {
    this.window.tabChanged(this)
  }

  private wire(): void {
    const wc = this.wc
    const engine = this.window.engine

    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (!frameUrlAllowed(url)) return { action: 'deny' }
      // 'allow' with createWindow keeps window.opener, which OAuth popups post their result through.
      return {
        action: 'allow',
        outlivesOpener: true,
        overrideBrowserWindowOptions: {
          webPreferences: engine.tabWebPreferences(this.window.tabSession),
        },
        createWindow: (options) =>
          this.window.adoptPopup(this, options, disposition !== 'background-tab').wc,
      }
    })

    wc.on('will-navigate', (e) => {
      if (!isWebUrl(e.url)) e.preventDefault()
    })
    wc.on('will-frame-navigate', (e) => {
      if (!frameUrlAllowed(e.url)) e.preventDefault()
    })
    wc.on('will-redirect', (e) => {
      if (!frameUrlAllowed(e.url)) e.preventDefault()
    })

    wc.on('did-start-loading', () => {
      this.isLoading = true
      this.changed()
    })
    wc.on('did-stop-loading', () => {
      this.isLoading = false
      this.pendingUrl = null
      this.changed()
    })
    wc.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return
      this.loadError = null
      this.crashed = false
      if (isWebUrl(details.url)) this.pendingUrl = details.url
      engine.broker.withdrawForTab(this.id)
      this.changed()
    })
    wc.on('did-navigate', (_e, url) => {
      this.pendingUrl = null
      this.faviconUrl = null
      engine.recordVisit(this, url)
      this.changed()
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return
      engine.recordVisit(this, url)
      this.changed()
    })
    wc.on('page-title-updated', (_e, title) => {
      this.title = title
      engine.updateHistoryTitle(this, this.committedUrl(), title)
      this.changed()
    })
    wc.on('page-favicon-updated', (_e, favicons) => {
      this.faviconUrl = favicons.find((f) => /^(https?:|data:image\/)/i.test(f)) ?? null
      this.changed()
    })
    wc.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
      // -3 is ERR_ABORTED: a navigation replaced by another one, not an error to show.
      if (!isMainFrame || code === -3) return
      this.loadError = { code, description }
      this.changed()
    })
    wc.on('render-process-gone', () => {
      this.crashed = true
      this.isLoading = false
      this.changed()
    })
    wc.on('audio-state-changed', (e) => {
      this.audible = e.audible
      this.changed()
    })
    wc.on('found-in-page', (_e, result) => {
      this.window.emit('page.findResult', {
        tabId: this.id,
        matches: result.matches,
        activeMatch: result.activeMatchOrdinal,
      })
    })
    wc.on('zoom-changed', (_e, direction) => this.zoom(direction))
    wc.on('enter-html-full-screen', () => this.window.setHtmlFullscreen(this, true))
    wc.on('leave-html-full-screen', () => this.window.setHtmlFullscreen(this, false))
    wc.on('context-menu', (_e, params) => {
      const nav = wc.navigationHistory
      const template = pageMenuTemplate(
        params,
        { canGoBack: nav.canGoBack(), canGoForward: nav.canGoForward() },
        {
          back: () => nav.goBack(),
          forward: () => nav.goForward(),
          reload: () => wc.reload(),
          openInNewTab: (url) => this.window.openTabFrom(this, url),
          copyText: (text) => clipboard.writeText(text),
          copyImageAt: (x, y) => wc.copyImageAt(x, y),
          downloadUrl: (url) => wc.downloadURL(url),
          searchFor: (text) => this.window.openTabFrom(this, `?${text}`),
          replaceMisspelling: (word) => wc.replaceMisspelling(word),
          inspect: (x, y) => wc.inspectElement(x, y),
        },
        engine.devToolsAllowed,
      )
      if (template.length) {
        Menu.buildFromTemplate(template).popup({ window: this.window.base, frame: params.frame ?? undefined })
      }
    })
    wc.on('destroyed', () => {
      this.destroyed = true
      engine.broker.withdrawForTab(this.id)
      // Removing the view synchronously inside 'destroyed' can wedge the main process (Electron 45).
      setImmediate(() => this.window.removeTab(this))
    })
  }
}

