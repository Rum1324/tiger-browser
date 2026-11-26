import type {
  CaptureResult,
  EngineBridge,
  EngineCommandName,
  EngineEventName,
  EngineEventPayload,
  EngineResponse,
  ExtractedPage,
  Settings,
  Tab,
  TabsState,
} from '@tiger/shared'
import { captureEligibility } from '@tiger/shared'

type Capture = CaptureResult | (() => Promise<CaptureResult>)

/**
 * An in-memory engine: settings, the keychain token, tabs, captures and exits. Every call is
 * recorded so tests can assert what was (and was not) asked of the engine.
 */
export class FakeBridge implements EngineBridge {
  settings: Settings = {
    locale: 'ja',
    theme: 'system',
    searchEngine: 'google',
    serverUrl: '',
    userBlockedHosts: [],
    lastSpaceId: null,
    defaultModel: null,
  }
  token: string | null = null
  googleIdToken: string | null = null
  captures = new Map<string, Capture>()
  tabs: TabsState = { windowId: 'w1', privateWindow: false, tabs: [], activeTabId: null }
  googleExport: EngineResponse<'google.exportDoc'> = {
    ok: true,
    url: 'https://docs.google.com/document/d/doc123/edit',
    docId: 'doc123',
  }
  saved: { suggestedName: string; content: string; extension: string }[] = []
  clipboard: string[] = []
  calls: { name: EngineCommandName; req: unknown }[] = []
  private listeners = new Map<string, Set<(p: unknown) => void>>()

  invoke = (async (name: EngineCommandName, req?: unknown): Promise<unknown> => {
    this.calls.push({ name, req })
    const r = req as Record<string, unknown> | undefined
    switch (name) {
      case 'settings.get':
        return { ...this.settings }
      case 'settings.update':
        this.settings = { ...this.settings, ...(r as Partial<Settings>) }
        this.emit('settings.changed', { ...this.settings })
        return { ...this.settings }
      case 'auth.getToken':
        return this.token
      case 'auth.setToken':
        this.token = (r?.token as string | null) ?? null
        return undefined
      case 'auth.googleSignIn':
        return this.googleIdToken ? { idToken: this.googleIdToken } : null
      case 'tabs.get':
        return this.tabs
      case 'capture.extract': {
        const c = this.captures.get(r?.tabId as string)
        if (!c) return { ok: false, error: 'no-tab', reason: null, detail: null }
        return typeof c === 'function' ? c() : c
      }
      case 'google.exportDoc':
        return this.googleExport
      case 'export.saveFile':
        this.saved.push(r as never)
        return { path: `/tmp/${r?.suggestedName as string}.md` }
      case 'clipboard.writeText':
        this.clipboard.push(r?.text as string)
        return undefined
      default:
        throw new Error(`FakeBridge: ${name} not implemented`)
    }
  }) as EngineBridge['invoke']

  on<E extends EngineEventName>(
    event: E,
    listener: (payload: EngineEventPayload<E>) => void,
  ): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener as (p: unknown) => void)
    return () => set.delete(listener as (p: unknown) => void)
  }

  emit<E extends EngineEventName>(event: E, payload: EngineEventPayload<E>): void {
    for (const l of this.listeners.get(event) ?? []) l(payload)
  }

  setTabs(tabs: Tab[]): void {
    this.tabs = { ...this.tabs, tabs, activeTabId: tabs[0]?.id ?? null }
    this.emit('tabs.changed', this.tabs)
  }

  callsOf(name: EngineCommandName) {
    return this.calls.filter((c) => c.name === name)
  }
}

export function makeTab(id: string, url: string, opts: { isPrivate?: boolean } = {}): Tab {
  const isPrivate = opts.isPrivate ?? false
  return {
    id,
    url,
    title: url,
    faviconUrl: null,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    isPrivate,
    spaceId: null,
    pinned: false,
    audible: false,
    crashed: false,
    security: 'secure',
    capture: captureEligibility(url, { incognito: isPrivate }),
    loadError: null,
    zoomFactor: 1,
  }
}

export function makePage(url: string, markdown: string, title = 'A page'): ExtractedPage {
  return {
    url,
    title,
    sourceType: 'web',
    markdown,
    lang: 'en',
    byline: null,
    siteName: null,
    extractor: 'readability@1',
    capturedAt: new Date().toISOString(),
    charCount: markdown.length,
    truncated: false,
  }
}
