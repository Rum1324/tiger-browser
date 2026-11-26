import { z } from 'zod'
import { CaptureBlockReason, CaptureEligibility } from './blocklist'
import { ExtractedPage, IsoDate } from './domain'

/**
 * The engine contract: everything the browser's own UI can ask of the engine, and everything the engine
 * tells the UI. Today the engine is the Electron main process; a Chromium fork would implement the same
 * names. The UI never imports Electron.
 */

// ── State objects ───────────────────────────────────────────────────────────

export const Tab = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  faviconUrl: z.string().nullable(),
  isLoading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  /** A tab in a private (incognito) session: nothing persists and nothing can be captured. */
  isPrivate: z.boolean(),
  /** The Space this tab is working in: UI grouping and the default share destination. */
  spaceId: z.string().nullable(),
  pinned: z.boolean(),
  audible: z.boolean(),
  crashed: z.boolean(),
  security: z.enum(['secure', 'insecure', 'internal']),
  /** Whether this page may ever be shared or attached, decided by the engine. */
  capture: CaptureEligibility,
  loadError: z.object({ code: z.number(), description: z.string() }).nullable(),
  zoomFactor: z.number(),
})
export type Tab = z.infer<typeof Tab>

/** Tab state is per window. Every tab of a private window is private. */
export const TabsState = z.object({
  windowId: z.string(),
  privateWindow: z.boolean(),
  tabs: z.array(Tab),
  activeTabId: z.string().nullable(),
})
export type TabsState = z.infer<typeof TabsState>

export const Rect = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
})
export type Rect = z.infer<typeof Rect>

export const Download = z.object({
  id: z.string(),
  url: z.string(),
  filename: z.string(),
  savePath: z.string().nullable(),
  state: z.enum(['progressing', 'paused', 'completed', 'cancelled', 'interrupted']),
  receivedBytes: z.number().nonnegative(),
  totalBytes: z.number().nonnegative(),
  startedAt: IsoDate,
})
export type Download = z.infer<typeof Download>

export const Bookmark = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  faviconUrl: z.string().nullable(),
  spaceId: z.string().nullable(),
  createdAt: IsoDate,
})
export type Bookmark = z.infer<typeof Bookmark>

export const HistoryEntry = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  visitedAt: IsoDate,
  visitCount: z.number().int().positive(),
})
export type HistoryEntry = z.infer<typeof HistoryEntry>

export const Suggestion = z.object({
  kind: z.enum(['url', 'history', 'bookmark', 'tab', 'search']),
  title: z.string(),
  url: z.string(),
  /** Set for `tab` suggestions: activating switches to that tab. */
  tabId: z.string().nullable(),
})
export type Suggestion = z.infer<typeof Suggestion>

export const Settings = z.object({
  locale: z.enum(['ja', 'en']),
  theme: z.enum(['system', 'light', 'dark']),
  searchEngine: z.enum(['google', 'duckduckgo', 'bing']),
  serverUrl: z.string(),
  /** Host suffixes the member never wants captured, on top of the built-in blocklist. */
  userBlockedHosts: z.array(z.string()),
  /** The Space last worked in; restored at launch. */
  lastSpaceId: z.string().nullable(),
  defaultModel: z.object({ provider: z.string(), id: z.string() }).nullable(),
})
export type Settings = z.infer<typeof Settings>

export const AppInfo = z.object({
  version: z.string(),
  engine: z.literal('electron'),
  engineVersion: z.string(),
  chromiumVersion: z.string(),
  platform: z.enum(['darwin', 'win32', 'linux']),
  systemLocale: z.string(),
})
export type AppInfo = z.infer<typeof AppInfo>

export const CaptureResult = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), page: ExtractedPage }),
  z.object({
    ok: z.literal(false),
    /**
     * `blocked`: eligibility said no. `empty`: nothing readable. `no-text-layer`: a scanned PDF
     * (OCR is not supported). `failed`: the extractor threw.
     */
    error: z.enum(['blocked', 'empty', 'no-text-layer', 'failed', 'no-tab']),
    reason: CaptureBlockReason.nullable(),
    detail: z.string().nullable(),
  }),
])
export type CaptureResult = z.infer<typeof CaptureResult>

export const GoogleConnection = z.object({
  connected: z.boolean(),
  email: z.string().nullable(),
  /** False when the build has no Google OAuth client configured. */
  configured: z.boolean(),
})
export type GoogleConnection = z.infer<typeof GoogleConnection>

/** Site permissions the engine asks the member about. Everything else is denied without asking. */
export const SitePermission = z.enum([
  'notifications',
  'camera',
  'microphone',
  'camera-and-microphone',
  'geolocation',
  'clipboard-read',
  'screen-capture',
])
export type SitePermission = z.infer<typeof SitePermission>

export const PermissionRequest = z.object({
  requestId: z.string(),
  tabId: z.string(),
  origin: z.string(),
  permission: SitePermission,
})
export type PermissionRequest = z.infer<typeof PermissionRequest>

export const ShortcutAction = z.enum([
  'new-tab',
  'new-window',
  'new-private-window',
  'close-tab',
  'reopen-closed-tab',
  'focus-address',
  'toggle-command',
  'toggle-side-panel',
  'toggle-space-home',
  'share-tab',
  'find',
  'next-tab',
  'previous-tab',
  'bookmark-tab',
  'open-history',
  'open-downloads',
  'open-settings',
])
export type ShortcutAction = z.infer<typeof ShortcutAction>

// ── Commands (UI → engine) ──────────────────────────────────────────────────

const cmd = <Req extends z.ZodType, Res extends z.ZodType>(req: Req, res: Res) => ({ req, res })
const TabId = z.object({ tabId: z.string() })
const Void = z.undefined()

export const engineCommands = {
  'app.info': cmd(Void, AppInfo),

  'tabs.get': cmd(Void, TabsState),
  'tabs.create': cmd(
    z.object({
      /** URL or search text; omitted opens the new-tab page. */
      input: z.string().optional(),
      active: z.boolean().optional(),
      spaceId: z.string().nullable().optional(),
    }),
    Tab,
  ),
  'tabs.close': cmd(TabId, Void),
  'tabs.activate': cmd(TabId, Void),
  /** `input` is whatever the member typed: a URL, a host, or search text. The engine resolves it. */
  'tabs.navigate': cmd(z.object({ tabId: z.string(), input: z.string() }), Void),
  'tabs.back': cmd(TabId, Void),
  'tabs.forward': cmd(TabId, Void),
  'tabs.reload': cmd(z.object({ tabId: z.string(), ignoreCache: z.boolean().optional() }), Void),
  'tabs.stop': cmd(TabId, Void),
  'tabs.move': cmd(z.object({ tabId: z.string(), toIndex: z.number().int().nonnegative() }), Void),
  'tabs.setSpace': cmd(z.object({ tabId: z.string(), spaceId: z.string().nullable() }), Void),
  'tabs.setPinned': cmd(z.object({ tabId: z.string(), pinned: z.boolean() }), Void),
  'tabs.duplicate': cmd(TabId, Tab),
  'tabs.reopenClosed': cmd(Void, Tab.nullable()),

  /**
   * Where the page rectangle sits inside the window, in CSS pixels of the UI. The UI owns layout and
   * reports the slot; the engine places the native page view there. `null` hides the page (Space home,
   * settings).
   */
  'page.setBounds': cmd(
    z.object({ bounds: Rect.nullable(), cornerRadius: z.number().nonnegative() }),
    Void,
  ),
  'page.find': cmd(
    z.object({ tabId: z.string(), text: z.string(), forward: z.boolean(), findNext: z.boolean() }),
    Void,
  ),
  'page.stopFind': cmd(TabId, Void),
  'page.setZoom': cmd(z.object({ tabId: z.string(), factor: z.number().min(0.25).max(5) }), Void),
  'page.print': cmd(TabId, Void),

  /**
   * Extract the page as Markdown, locally. Nothing is sent anywhere: the result returns to the UI,
   * which shows it in the share preview. The engine refuses blocked pages regardless of the caller.
   */
  'capture.extract': cmd(TabId, CaptureResult),

  /**
   * The UI layer that can draw above the page (command palette, menus, sheets). While open, the
   * engine raises it over the page view and gives it input; closed, it is hidden and the page gets
   * every click. The layer takes all pointer input inside its bounds, transparent pixels included,
   * so `bounds: null` (the whole window) is for modal surfaces where a click outside dismisses,
   * and a tight rectangle is for anything the page must stay clickable around.
   */
  'overlay.setOpen': cmd(z.object({ open: z.boolean(), bounds: Rect.nullable().optional() }), Void),

  /** Answer a `permission.request` event. `remember` stores the decision for that origin. */
  'permission.respond': cmd(
    z.object({ requestId: z.string(), allow: z.boolean(), remember: z.boolean() }),
    Void,
  ),

  'suggest.query': cmd(z.object({ input: z.string().max(2000) }), z.array(Suggestion)),

  'downloads.list': cmd(Void, z.array(Download)),
  'downloads.cancel': cmd(z.object({ id: z.string() }), Void),
  'downloads.open': cmd(z.object({ id: z.string() }), Void),
  'downloads.showInFolder': cmd(z.object({ id: z.string() }), Void),
  'downloads.clear': cmd(Void, Void),

  'bookmarks.list': cmd(Void, z.array(Bookmark)),
  'bookmarks.add': cmd(
    z.object({ url: z.string(), title: z.string(), spaceId: z.string().nullable().optional() }),
    Bookmark,
  ),
  'bookmarks.remove': cmd(z.object({ id: z.string() }), Void),

  'history.search': cmd(
    z.object({ query: z.string(), limit: z.number().int().min(1).max(500).optional() }),
    z.array(HistoryEntry),
  ),
  'history.remove': cmd(z.object({ id: z.string() }), Void),
  'history.clear': cmd(Void, Void),

  'settings.get': cmd(Void, Settings),
  'settings.update': cmd(Settings.partial(), Settings),

  /** The product session token, held by the OS keychain. */
  'auth.getToken': cmd(Void, z.string().nullable()),
  'auth.setToken': cmd(z.object({ token: z.string().nullable() }), Void),
  /** Run Google sign-in and return an ID token for the server to verify. */
  'auth.googleSignIn': cmd(Void, z.object({ idToken: z.string() }).nullable()),

  'google.status': cmd(Void, GoogleConnection),
  'google.connect': cmd(Void, GoogleConnection),
  'google.disconnect': cmd(Void, GoogleConnection),
  /** Create a new Google Doc from Markdown in the member's Drive. Tokens never leave the machine. */
  'google.exportDoc': cmd(
    z.object({ title: z.string().min(1).max(300), markdown: z.string().min(1) }),
    z.discriminatedUnion('ok', [
      z.object({ ok: z.literal(true), url: z.string(), docId: z.string() }),
      z.object({
        ok: z.literal(false),
        error: z.enum(['not-configured', 'not-connected', 'denied', 'failed']),
        detail: z.string().nullable(),
      }),
    ]),
  ),

  /** Exits that need no account: save as a file, copy as Markdown. */
  'export.saveFile': cmd(
    z.object({ suggestedName: z.string(), content: z.string(), extension: z.enum(['md', 'txt']) }),
    z.object({ path: z.string() }).nullable(),
  ),
  'clipboard.writeText': cmd(z.object({ text: z.string() }), Void),

  /** Open another window. A private window uses a fresh in-memory session that dies with it. */
  'window.create': cmd(z.object({ private: z.boolean().optional() }), Void),
  'window.action': cmd(
    z.object({ action: z.enum(['minimize', 'toggle-maximize', 'close', 'toggle-fullscreen']) }),
    Void,
  ),
} as const

export type EngineCommandName = keyof typeof engineCommands
export type EngineRequest<K extends EngineCommandName> = z.infer<(typeof engineCommands)[K]['req']>
export type EngineResponse<K extends EngineCommandName> = z.infer<(typeof engineCommands)[K]['res']>

// ── Events (engine → UI) ────────────────────────────────────────────────────

export const engineEvents = {
  'tabs.changed': TabsState,
  'downloads.changed': z.array(Download),
  'bookmarks.changed': z.array(Bookmark),
  'settings.changed': Settings,
  /** A keyboard shortcut or menu item the UI must act on. */
  shortcut: z.object({ action: ShortcutAction }),
  'page.findResult': z.object({
    tabId: z.string(),
    matches: z.number().int().nonnegative(),
    activeMatch: z.number().int().nonnegative(),
  }),
  'window.state': z.object({
    focused: z.boolean(),
    fullscreen: z.boolean(),
    maximized: z.boolean(),
  }),
  'google.changed': GoogleConnection,
  /** A site asked for a permission; the UI shows the prompt and answers with `permission.respond`. */
  'permission.request': PermissionRequest,
} as const

export type EngineEventName = keyof typeof engineEvents
export type EngineEventPayload<E extends EngineEventName> = z.infer<(typeof engineEvents)[E]>

/** What the preload script exposes to the UI as `window.tiger`. */
export interface EngineBridge {
  invoke<K extends EngineCommandName>(
    name: K,
    ...args: EngineRequest<K> extends undefined ? [] : [request: EngineRequest<K>]
  ): Promise<EngineResponse<K>>
  on<E extends EngineEventName>(
    event: E,
    listener: (payload: EngineEventPayload<E>) => void,
  ): () => void
}

/** The single IPC channel names, so the allow-list lives in one place. */
export const IPC_INVOKE_CHANNEL = 'tiger:invoke'
export const IPC_EVENT_CHANNEL = 'tiger:event'
