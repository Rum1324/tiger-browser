import {
  type CaptureResult,
  captureEligibility,
  type Download,
  type EngineBridge,
  type EngineCommandName,
  type EngineEventName,
  type EngineEventPayload,
  type EngineRequest,
  type EngineResponse,
  engineCommands,
  engineEvents,
  type GoogleConnection,
  type Rect,
  type Settings,
  type Suggestion,
  type Tab,
  type TabsState,
} from '@tiger/shared'
import { extractedPage, type FixturePage, type FixtureWorld } from './fixtures'

export interface FakeTabSpec {
  /** A fixture page key, or a raw URL ('' = new tab). */
  page: string
  active?: boolean
  pinned?: boolean
  audible?: boolean
  isLoading?: boolean
  crashed?: boolean
  spaceId?: string | null
  loadError?: Tab['loadError']
}

export interface FakeEngineOptions {
  world: FixtureWorld
  tabs?: FakeTabSpec[]
  privateWindow?: boolean
  windowId?: string
  /** Stored session token (null = signed out). */
  token?: string | null
  /** Override the capture result of a URL (e.g. a page that fails to extract). */
  captures?: Record<string, CaptureResult>
  google?: GoogleConnection
  /** Validate every request and response against the contract (on by default). */
  validate?: boolean
}

export interface RecordedCall {
  name: EngineCommandName
  request: unknown
}

type Handler<K extends EngineCommandName> = (req: EngineRequest<K>) => EngineResponse<K> | Promise<EngineResponse<K>>

/**
 * An in-memory engine that implements every command and event of the contract, for unit tests and
 * the visual rig. Requests and responses are validated against the zod schemas in @tiger/shared,
 * so the UI cannot drift from the contract under the fake either. Every call is recorded.
 */
export class FakeEngine implements EngineBridge {
  readonly calls: RecordedCall[] = []
  readonly world: FixtureWorld
  state: TabsState
  settings: Settings
  token: string | null
  downloads: Download[]
  google: GoogleConnection
  pageBounds: { bounds: Rect | null; cornerRadius: number } | null = null
  overlay: { open: boolean; bounds: Rect | null } = { open: false, bounds: null }
  findText = ''
  private listeners = new Map<EngineEventName, Set<(p: unknown) => void>>()
  private observers = new Set<() => void>()
  private nextTab = 1
  private closed: Tab[] = []
  private readonly validate: boolean
  private readonly captures: Record<string, CaptureResult>
  private readonly handlers: { [K in EngineCommandName]: Handler<K> }

  constructor(opts: FakeEngineOptions) {
    this.world = opts.world
    this.validate = opts.validate ?? true
    this.captures = opts.captures ?? {}
    this.settings = structuredClone(opts.world.settings)
    this.token = opts.token === undefined ? opts.world.token : opts.token
    this.downloads = structuredClone(opts.world.downloads)
    this.google = opts.google ?? { connected: false, email: null, configured: true }
    const privateWindow = opts.privateWindow ?? false
    const specs = opts.tabs ?? [{ page: '', active: true }]
    const tabs = specs.map((s) => this.makeTab(s, privateWindow))
    const active = specs.findIndex((s) => s.active)
    this.state = {
      windowId: opts.windowId ?? 'win-1',
      privateWindow,
      tabs,
      activeTabId: tabs[active === -1 ? 0 : active]?.id ?? null,
    }
    this.handlers = this.buildHandlers()
  }

  // ── EngineBridge ──────────────────────────────────────────────────────────

  invoke<K extends EngineCommandName>(
    name: K,
    ...args: EngineRequest<K> extends undefined ? [] : [request: EngineRequest<K>]
  ): Promise<EngineResponse<K>> {
    const request = args[0] as EngineRequest<K>
    this.calls.push({ name, request })
    try {
      const def = engineCommands[name]
      const req = this.validate ? (def.req.parse(request) as EngineRequest<K>) : request
      const handler = this.handlers[name] as Handler<K>
      return Promise.resolve(handler(req)).then((res) =>
        this.validate ? (def.res.parse(res) as EngineResponse<K>) : res,
      )
    } catch (e) {
      return Promise.reject(e)
    }
  }

  on<E extends EngineEventName>(event: E, listener: (payload: EngineEventPayload<E>) => void): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    const l = listener as (p: unknown) => void
    set.add(l)
    return () => set.delete(l)
  }

  // ── Test controls ─────────────────────────────────────────────────────────

  emit<E extends EngineEventName>(event: E, payload: EngineEventPayload<E>): void {
    const value = this.validate ? engineEvents[event].parse(payload) : payload
    for (const l of [...(this.listeners.get(event) ?? [])]) l(value)
  }

  /** Called after the page bounds or the overlay change (the rig draws them). */
  observe(cb: () => void): () => void {
    this.observers.add(cb)
    return () => this.observers.delete(cb)
  }

  private changed(): void {
    for (const o of [...this.observers]) o()
  }

  /** How many listeners an event has (tests check that hooks unsubscribe). */
  listenerCount(event: EngineEventName): number {
    return this.listeners.get(event)?.size ?? 0
  }

  callsOf<K extends EngineCommandName>(name: K): EngineRequest<K>[] {
    return this.calls.filter((c) => c.name === name).map((c) => c.request as EngineRequest<K>)
  }

  activeTab(): Tab | null {
    return this.state.tabs.find((t) => t.id === this.state.activeTabId) ?? null
  }

  updateTab(tabId: string, patch: Partial<Tab>): void {
    this.state = {
      ...this.state,
      tabs: this.state.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)),
    }
    this.emit('tabs.changed', this.state)
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private pageFor(urlOrKey: string): FixturePage | null {
    return (
      this.world.pages[urlOrKey] ??
      Object.values(this.world.pages).find((p) => p.url === urlOrKey) ??
      null
    )
  }

  private makeTab(spec: FakeTabSpec, privateWindow: boolean): Tab {
    const p = this.pageFor(spec.page)
    const url = p ? p.url : spec.page
    const isPrivate = privateWindow
    const capture = captureEligibility(url, {
      incognito: isPrivate,
      userBlockedHosts: this.settings.userBlockedHosts,
    })
    return {
      id: `tab-${this.nextTab++}`,
      url,
      title: p?.title ?? (url ? url : ''),
      faviconUrl: null,
      isLoading: spec.isLoading ?? false,
      canGoBack: url !== '',
      canGoForward: false,
      isPrivate,
      spaceId: spec.spaceId ?? null,
      pinned: spec.pinned ?? false,
      audible: spec.audible ?? false,
      crashed: spec.crashed ?? false,
      security: url.startsWith('https:') ? 'secure' : url === '' ? 'internal' : 'insecure',
      capture: url === '' ? { allowed: false, reason: 'scheme', rule: null } : capture,
      loadError: spec.loadError ?? null,
      zoomFactor: 1,
    }
  }

  private setState(next: Partial<TabsState>): void {
    this.state = { ...this.state, ...next }
    this.emit('tabs.changed', this.state)
  }

  private resolveInput(input: string): string {
    const trimmed = input.trim()
    const page = this.pageFor(trimmed)
    if (page) return page.url
    if (/^https?:\/\//.test(trimmed)) return trimmed
    if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(trimmed)) return `https://${trimmed}`
    return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
  }

  private suggestions(input: string): Suggestion[] {
    const q = input.trim().toLowerCase()
    if (!q) return []
    const out: Suggestion[] = []
    const hit = (s: string) => s.toLowerCase().includes(q)
    for (const t of this.state.tabs)
      if (t.url && (hit(t.title) || hit(t.url)))
        out.push({ kind: 'tab', title: t.title, url: t.url, tabId: t.id })
    for (const b of this.world.bookmarks)
      if (hit(b.title) || hit(b.url)) out.push({ kind: 'bookmark', title: b.title, url: b.url, tabId: null })
    for (const h of this.world.history)
      if (hit(h.title) || hit(h.url)) out.push({ kind: 'history', title: h.title, url: h.url, tabId: null })
    const resolved = this.resolveInput(input)
    out.push(
      resolved.includes('/search?q=')
        ? { kind: 'search', title: input.trim(), url: resolved, tabId: null }
        : { kind: 'url', title: resolved, url: resolved, tabId: null },
    )
    return out.slice(0, 8)
  }

  private buildHandlers(): { [K in EngineCommandName]: Handler<K> } {
    const tab = (tabId: string) => {
      const t = this.state.tabs.find((x) => x.id === tabId)
      if (!t) throw new Error(`no tab ${tabId}`)
      return t
    }
    return {
      'app.info': () => ({
        version: '0.1.0',
        engine: 'electron',
        engineVersion: '45.5.0',
        chromiumVersion: '146.0.0.0',
        platform: 'darwin',
        systemLocale: 'ja-JP',
      }),
      'tabs.get': () => this.state,
      'tabs.create': (req) => {
        const url = req.input ? this.resolveInput(req.input) : ''
        const t = this.makeTab({ page: url, spaceId: req.spaceId ?? null }, this.state.privateWindow)
        const active = req.active ?? true
        this.setState({
          tabs: [...this.state.tabs, t],
          activeTabId: active ? t.id : this.state.activeTabId,
        })
        return t
      },
      'tabs.close': ({ tabId }) => {
        const idx = this.state.tabs.findIndex((t) => t.id === tabId)
        if (idx === -1) return undefined
        const closing = this.state.tabs[idx] as Tab
        this.closed.push(closing)
        const tabs = this.state.tabs.filter((t) => t.id !== tabId)
        const activeTabId =
          this.state.activeTabId === tabId
            ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? null)
            : this.state.activeTabId
        this.setState({ tabs, activeTabId })
        return undefined
      },
      'tabs.activate': ({ tabId }) => {
        tab(tabId)
        this.setState({ activeTabId: tabId })
        return undefined
      },
      'tabs.navigate': ({ tabId, input }) => {
        const old = tab(tabId)
        const fresh = this.makeTab({ page: this.resolveInput(input) }, this.state.privateWindow)
        this.updateTab(tabId, { ...fresh, id: old.id, pinned: old.pinned, canGoBack: true })
        return undefined
      },
      'tabs.back': ({ tabId }) => {
        tab(tabId)
        return undefined
      },
      'tabs.forward': ({ tabId }) => {
        tab(tabId)
        return undefined
      },
      'tabs.reload': ({ tabId }) => {
        tab(tabId)
        return undefined
      },
      'tabs.stop': ({ tabId }) => {
        this.updateTab(tabId, { isLoading: false })
        return undefined
      },
      'tabs.move': ({ tabId, toIndex }) => {
        const t = tab(tabId)
        const rest = this.state.tabs.filter((x) => x.id !== tabId)
        rest.splice(Math.min(toIndex, rest.length), 0, t)
        this.setState({ tabs: rest })
        return undefined
      },
      'tabs.setSpace': ({ tabId, spaceId }) => {
        this.updateTab(tabId, { spaceId })
        return undefined
      },
      'tabs.setPinned': ({ tabId, pinned }) => {
        this.updateTab(tabId, { pinned })
        return undefined
      },
      'tabs.duplicate': ({ tabId }) => {
        const t = { ...tab(tabId), id: `tab-${this.nextTab++}` }
        this.setState({ tabs: [...this.state.tabs, t], activeTabId: t.id })
        return t
      },
      'tabs.reopenClosed': () => {
        const t = this.closed.pop()
        if (!t) return null
        this.setState({ tabs: [...this.state.tabs, t], activeTabId: t.id })
        return t
      },
      'page.setBounds': (req) => {
        this.pageBounds = req
        this.changed()
        return undefined
      },
      'page.find': ({ tabId, text }) => {
        tab(tabId)
        this.findText = text
        const p = this.pageFor(tab(tabId).url)
        const matches = text && p ? p.markdown.split(text).length - 1 : 0
        queueMicrotask(() =>
          this.emit('page.findResult', { tabId, matches, activeMatch: matches ? 1 : 0 }),
        )
        return undefined
      },
      'page.stopFind': () => {
        this.findText = ''
        return undefined
      },
      'page.setZoom': ({ tabId, factor }) => {
        this.updateTab(tabId, { zoomFactor: factor })
        return undefined
      },
      'page.print': () => undefined,
      'capture.extract': ({ tabId }) => {
        const t = this.state.tabs.find((x) => x.id === tabId)
        if (!t) return { ok: false, error: 'no-tab', reason: null, detail: null }
        if (!t.capture.allowed)
          return { ok: false, error: 'blocked', reason: t.capture.reason, detail: t.capture.rule }
        const override = this.captures[t.url]
        if (override) return override
        const p = this.pageFor(t.url)
        if (!p || !p.markdown) return { ok: false, error: 'empty', reason: null, detail: null }
        return { ok: true, page: extractedPage(p) }
      },
      'overlay.setOpen': ({ open, bounds }) => {
        this.overlay = { open, bounds: open ? (bounds ?? null) : null }
        this.changed()
        return undefined
      },
      'permission.respond': () => undefined,
      'suggest.query': ({ input }) => this.suggestions(input),
      'downloads.list': () => this.downloads,
      'downloads.cancel': ({ id }) => {
        this.downloads = this.downloads.map((d) => (d.id === id ? { ...d, state: 'cancelled' } : d))
        this.emit('downloads.changed', this.downloads)
        return undefined
      },
      'downloads.open': () => undefined,
      'downloads.showInFolder': () => undefined,
      'downloads.clear': () => {
        this.downloads = this.downloads.filter((d) => d.state === 'progressing' || d.state === 'paused')
        this.emit('downloads.changed', this.downloads)
        return undefined
      },
      'bookmarks.list': () => this.world.bookmarks,
      'bookmarks.add': ({ url, title, spaceId }) => {
        const b = { id: `b${this.world.bookmarks.length + 1}`, url, title, faviconUrl: null, spaceId: spaceId ?? null, createdAt: new Date().toISOString() }
        this.world.bookmarks.push(b)
        this.emit('bookmarks.changed', this.world.bookmarks)
        return b
      },
      'bookmarks.remove': () => undefined,
      'history.search': ({ query, limit }) =>
        this.world.history
          .filter((h) => !query || h.title.includes(query) || h.url.includes(query))
          .slice(0, limit ?? 100),
      'history.remove': () => undefined,
      'history.clear': () => undefined,
      'settings.get': () => this.settings,
      'settings.update': (patch) => {
        this.settings = { ...this.settings, ...patch }
        this.emit('settings.changed', this.settings)
        return this.settings
      },
      'auth.getToken': () => this.token,
      'auth.setToken': ({ token }) => {
        this.token = token
        return undefined
      },
      'auth.googleSignIn': () => ({ ok: false, error: 'not-configured' }),
      'google.status': () => this.google,
      'google.connect': () => ({ connection: this.google, error: 'not-configured' }),
      'google.cancel': () => undefined,
      'google.disconnect': () => {
        this.google = { ...this.google, connected: false, email: null }
        return this.google
      },
      'google.exportDoc': () =>
        this.google.connected
          ? { ok: true, url: 'https://docs.google.com/document/d/1Exported/edit', docId: '1Exported' }
          : { ok: false, error: 'not-connected', detail: null },
      'export.saveFile': ({ suggestedName, extension }) => ({
        path: `/Users/saeki/Downloads/${suggestedName}.${extension}`,
      }),
      'clipboard.writeText': () => undefined,
      'window.create': () => undefined,
      'window.action': () => undefined,
    }
  }
}
