import type { EngineEventName, EngineEventPayload, Rect, TabsState } from '@tiger/shared'
import {
  BaseWindow,
  type BrowserWindowConstructorOptions,
  type Session,
  type WebContents,
  WebContentsView,
} from 'electron'
import { fullBounds, toCornerRadius, toViewBounds } from './bounds'
import type { Engine } from './engine'
import { resolveInput } from './resolve-input'
import type { PermissionDecisions } from './store/permissions'
import type { RestoredTab } from './store/session-restore'
import { TabController } from './tab'

interface ClosedTab {
  url: string
  title: string
  spaceId: string | null
  pinned: boolean
  index: number
}

const MAX_CLOSED = 25
let nextWindowId = 1

/**
 * One browser window: the chrome UI view at the bottom, one view per tab above it, and the overlay
 * view on top. Tab state lives here; every command from this window's UI acts on this window.
 */
export class EngineWindow {
  readonly id = `w${nextWindowId++}`
  readonly base: BaseWindow
  readonly ui: WebContentsView
  readonly uiWc: WebContents
  readonly overlay: WebContentsView
  readonly overlayWc: WebContents
  tabs: TabController[] = []
  activeTabId: string | null = null
  private pageBounds: Rect | null = null
  private cornerRadius = 0
  private overlayOpen = false
  private overlayBounds: Rect | null = null
  private readonly closedTabs: ClosedTab[] = []
  private htmlFullscreenTab: TabController | null = null
  private emitScheduled = false
  closed = false

  constructor(
    readonly engine: Engine,
    readonly isPrivate: boolean,
    readonly tabSession: Session,
    readonly decisions: PermissionDecisions,
  ) {
    this.base = new BaseWindow({
      width: 1280,
      height: 820,
      minWidth: 480,
      minHeight: 360,
      title: isPrivate ? 'Tiger (Private)' : 'Tiger',
      backgroundColor: '#ffffff',
      autoHideMenuBar: true,
      show: false,
    })

    // Created first so Playwright's firstWindow() is this window's UI.
    this.ui = new WebContentsView({ webPreferences: engine.uiWebPreferences() })
    this.uiWc = this.ui.webContents
    this.overlay = new WebContentsView({ webPreferences: engine.uiWebPreferences() })
    this.overlayWc = this.overlay.webContents
    this.overlay.setBackgroundColor('#00000000')
    this.overlay.setVisible(false)

    this.base.contentView.addChildView(this.ui)
    this.base.contentView.addChildView(this.overlay)

    this.wire()
    this.layout()
    engine.loadUi(this.uiWc, 'main')
    engine.loadUi(this.overlayWc, 'overlay')
    this.base.show()
  }

  private wire(): void {
    const b = this.base
    b.on('resize', () => this.layout())
    b.on('focus', () => {
      this.engine.windowFocused(this)
      this.emitWindowState()
    })
    b.on('blur', () => this.emitWindowState())
    b.on('maximize', () => this.emitWindowState())
    b.on('unmaximize', () => this.emitWindowState())
    b.on('enter-full-screen', () => this.emitWindowState())
    b.on('leave-full-screen', () => this.emitWindowState())
    b.on('closed', () => this.dispose())

    // The UI views hold the bridge: they must never show anything but our own UI. Links and
    // window.open from the UI are refused; the UI opens pages through tabs.create instead.
    for (const wc of [this.uiWc, this.overlayWc]) {
      wc.on('will-navigate', (e) => e.preventDefault())
      wc.on('will-frame-navigate', (e) => {
        if (!e.isMainFrame) e.preventDefault()
      })
      wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    }
  }

  // ── Events ───────────────────────────────────────────────────────────────

  emit<E extends EngineEventName>(event: E, payload: EngineEventPayload<E>): void {
    this.engine.sendEvent([this.uiWc, this.overlayWc], event, payload)
  }

  windowState(): EngineEventPayload<'window.state'> {
    return {
      focused: this.base.isFocused(),
      fullscreen: this.base.isFullScreen(),
      maximized: this.base.isMaximized(),
    }
  }

  private emitWindowState(): void {
    if (!this.closed) this.emit('window.state', this.windowState())
  }

  tabsState(): TabsState {
    return {
      windowId: this.id,
      privateWindow: this.isPrivate,
      tabs: this.tabs.map((t) => t.state()),
      activeTabId: this.activeTabId,
    }
  }

  /** Coalesces bursts of tab events into one tabs.changed per turn of the event loop. */
  tabChanged(_tab?: TabController): void {
    if (this.emitScheduled || this.closed) return
    this.emitScheduled = true
    setImmediate(() => {
      this.emitScheduled = false
      if (this.closed) return
      this.emit('tabs.changed', this.tabsState())
      this.engine.windowTabsChanged(this)
    })
  }

  // ── Tabs ─────────────────────────────────────────────────────────────────

  getTab(tabId: string): TabController {
    const tab = this.tabs.find((t) => t.id === tabId)
    if (!tab) throw new Error(`no tab ${tabId} in this window`)
    return tab
  }

  activeTab(): TabController | null {
    return this.tabs.find((t) => t.id === this.activeTabId) ?? null
  }

  private attach(tab: TabController, index: number, activate: boolean): void {
    const at = Math.max(0, Math.min(index, this.tabs.length))
    this.tabs.splice(at, 0, tab)
    this.engine.registerTab(tab)
    // Above the UI view, below the overlay (always the last child).
    const children = this.base.contentView.children.length
    this.base.contentView.addChildView(tab.view, Math.max(1, children - 1))
    tab.view.setVisible(false)
    if (activate || this.activeTabId === null) this.activeTabId = tab.id
    this.layout()
    this.tabChanged()
  }

  /** Index for a new unpinned tab: never inside the pinned block. */
  private firstUnpinnedIndex(): number {
    const i = this.tabs.findIndex((t) => !t.pinned)
    return i === -1 ? this.tabs.length : i
  }

  createTab(opts: {
    url?: string | null
    active?: boolean
    spaceId?: string | null
    pinned?: boolean
    index?: number
    title?: string
  }): TabController {
    const tab = new TabController(this, {
      spaceId: opts.spaceId ?? null,
      pinned: opts.pinned ?? false,
    })
    if (opts.title) tab.title = opts.title
    const index = opts.index ?? (tab.pinned ? this.firstUnpinnedIndex() : this.tabs.length)
    this.attach(tab, index, opts.active ?? true)
    if (!opts.url || !tab.load(opts.url)) tab.loadBlank()
    if (opts.active ?? true) this.focusActive()
    return tab
  }

  /** A window.open from `opener`: Chromium created the webContents, we give it a view and a slot. */
  adoptPopup(
    opener: TabController,
    options: BrowserWindowConstructorOptions & { webContents?: WebContents },
    activate: boolean,
  ): TabController {
    const tab = new TabController(this, {
      adopt: options,
      spaceId: opener.spaceId,
      openerId: opener.id,
    })
    const index = Math.max(this.tabs.indexOf(opener) + 1, this.firstUnpinnedIndex())
    this.attach(tab, index, activate)
    if (activate) this.focusActive()
    return tab
  }

  /** "Open link in new tab" and "Search for …" from the page menu: next to the source, in background. */
  openTabFrom(source: TabController, input: string): void {
    const url = resolveInput(input, this.engine.settings.get().searchEngine)
    if (!url) return
    const index = Math.max(this.tabs.indexOf(source) + 1, this.firstUnpinnedIndex())
    this.createTab({ url, active: false, spaceId: source.spaceId, index })
  }

  closeTab(tabId: string): void {
    const tab = this.getTab(tabId)
    tab.close()
    // The 'destroyed' handler calls removeTab; do it now too, so the state is current on return.
    this.removeTab(tab)
  }

  removeTab(tab: TabController): void {
    const index = this.tabs.indexOf(tab)
    if (index === -1) return
    const url = tab.displayUrl()
    // Kept in memory only, so a private window can reopen tabs within its own lifetime.
    if (url && !this.closed) {
      this.closedTabs.push({
        url,
        title: tab.title,
        spaceId: tab.spaceId,
        pinned: tab.pinned,
        index,
      })
      if (this.closedTabs.length > MAX_CLOSED) this.closedTabs.shift()
    }
    this.tabs.splice(index, 1)
    this.engine.unregisterTab(tab)
    if (this.htmlFullscreenTab === tab) this.htmlFullscreenTab = null
    if (!this.closed) {
      try {
        this.base.contentView.removeChildView(tab.view)
      } catch {
        // The window is being torn down.
      }
    }
    if (this.activeTabId === tab.id) {
      const opener = tab.openerId ? this.tabs.find((t) => t.id === tab.openerId) : undefined
      const next = opener ?? this.tabs[index] ?? this.tabs[index - 1] ?? null
      this.activeTabId = next?.id ?? null
      this.focusActive()
    }
    this.layout()
    this.tabChanged()
  }

  activate(tabId: string): void {
    this.getTab(tabId)
    this.activeTabId = tabId
    this.layout()
    this.focusActive()
    this.tabChanged()
  }

  move(tabId: string, toIndex: number): void {
    const tab = this.getTab(tabId)
    const from = this.tabs.indexOf(tab)
    this.tabs.splice(from, 1)
    // A tab stays inside its block: pinned tabs first, then the rest.
    const pinnedCount = this.tabs.filter((t) => t.pinned).length
    const [lo, hi] = tab.pinned ? [0, pinnedCount] : [pinnedCount, this.tabs.length]
    this.tabs.splice(Math.max(lo, Math.min(hi, toIndex)), 0, tab)
    this.tabChanged()
  }

  setPinned(tabId: string, pinned: boolean): void {
    const tab = this.getTab(tabId)
    if (tab.pinned === pinned) return
    this.tabs.splice(this.tabs.indexOf(tab), 1)
    tab.pinned = pinned
    // Pinning moves the tab to the end of the pinned block; unpinning to the start of the rest.
    this.tabs.splice(this.firstUnpinnedIndex(), 0, tab)
    this.tabChanged()
  }

  duplicate(tabId: string): TabController {
    const tab = this.getTab(tabId)
    const index = this.tabs.indexOf(tab) + 1
    return this.createTab({
      url: tab.displayUrl() || null,
      spaceId: tab.spaceId,
      pinned: tab.pinned,
      index,
      title: tab.title,
    })
  }

  reopenClosed(): TabController | null {
    const last = this.closedTabs.pop()
    if (!last) return null
    return this.createTab({
      url: last.url,
      spaceId: last.spaceId,
      pinned: last.pinned,
      index: last.index,
      title: last.title,
    })
  }

  restore(tabs: readonly RestoredTab[], activeIndex: number | null): void {
    tabs.forEach((t, i) => {
      this.createTab({
        url: t.url,
        spaceId: t.spaceId,
        pinned: t.pinned,
        title: t.title,
        active: i === activeIndex,
      })
    })
  }

  // ── Layout ───────────────────────────────────────────────────────────────

  setPageBounds(bounds: Rect | null, cornerRadius: number): void {
    this.pageBounds = bounds
    this.cornerRadius = cornerRadius
    this.layout()
  }

  setOverlay(open: boolean, bounds: Rect | null): void {
    this.overlayOpen = open
    this.overlayBounds = open ? bounds : null
    this.layout()
    if (open) this.overlayWc.focus()
    else this.focusActive()
  }

  setHtmlFullscreen(tab: TabController, on: boolean): void {
    this.htmlFullscreenTab = on
      ? tab
      : this.htmlFullscreenTab === tab
        ? null
        : this.htmlFullscreenTab
    this.base.setFullScreen(on)
    this.layout()
  }

  /** Where the active page view currently sits, in window content coordinates (null = hidden). */
  pageViewBounds() {
    const content = this.base.getContentBounds()
    if (this.htmlFullscreenTab) return fullBounds(content)
    if (!this.pageBounds) return null
    return toViewBounds(this.pageBounds, this.uiZoom(), content)
  }

  private uiZoom(): number {
    return this.uiWc.isDestroyed() ? 1 : this.uiWc.getZoomFactor()
  }

  layout(): void {
    if (this.closed) return
    const content = this.base.getContentBounds()
    this.ui.setBounds(fullBounds(content))
    const page = this.pageViewBounds()
    for (const tab of this.tabs) {
      const visible = tab.id === this.activeTabId && page !== null
      if (visible && page) {
        tab.view.setBounds(page)
        tab.view.setBorderRadius(
          this.htmlFullscreenTab === tab
            ? 0
            : toCornerRadius(this.cornerRadius, this.uiZoom(), page),
        )
      }
      tab.view.setVisible(visible)
    }
    const overlay =
      this.overlayOpen && this.overlayBounds
        ? toViewBounds(this.overlayBounds, this.uiZoom(), content)
        : fullBounds(content)
    if (overlay) this.overlay.setBounds(overlay)
    this.overlay.setVisible(this.overlayOpen && overlay !== null)
  }

  private focusActive(): void {
    if (this.closed || this.overlayOpen) return
    const tab = this.activeTab()
    if (tab && !tab.destroyed && this.pageViewBounds() && tab.displayUrl()) tab.wc.focus()
    else if (!this.uiWc.isDestroyed()) this.uiWc.focus()
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  private dispose(): void {
    if (this.closed) return
    this.engine.windowClosing(this)
    this.closed = true
    // BaseWindow does not destroy its views' webContents; close them or they leak.
    for (const tab of [...this.tabs]) {
      this.engine.unregisterTab(tab)
      tab.close()
    }
    this.tabs = []
    for (const wc of [this.uiWc, this.overlayWc]) if (!wc.isDestroyed()) wc.close()
    this.engine.windowClosed(this)
  }
}
