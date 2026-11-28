import type { TigerClient } from '@tiger/client'
import type { EngineBridge } from '@tiger/shared'
import type { EngineState } from '../engine/engine-state'
import { createFindModel, type FindModel } from '../features/find'
import { createNoticeModel, type NoticeModel } from '../features/notice'
import { createOmniboxModel, type OmniboxModel } from '../features/omnibox'
import { createPageShareModel, type PageShareModel } from '../features/page-share'
import { createPermissionsModel, type PermissionsModel } from '../features/permissions'
import { createLayout, type Layout } from '../layout/layout-state'
import { PageSlotReporter } from '../layout/page-slot'
import { createOverlayHost, documentFocus, type OverlayHost } from '../overlay/host'
import type { HostTransport } from '../overlay/protocol'
import type { PrefsStorage } from './prefs'
import { createRouter, type Router } from './router'
import { createShortcuts, type Shortcuts } from './shortcuts'

/**
 * Everything below the pixels that the main view's components and hooks reach through context:
 * the engine bridge and its state, the @tiger/client instance, routing, layout, the overlay host,
 * shortcut dispatch, and the feature models that keep UI-only state (omnibox, find, prompts…).
 */
export interface AppServices {
  bridge: EngineBridge
  client: TigerClient
  engine: EngineState
  router: Router
  layout: Layout
  /** Measures the page card and reports it to the engine (page.setBounds). */
  pageSlot: PageSlotReporter
  overlay: OverlayHost
  shortcuts: Shortcuts
  omnibox: OmniboxModel
  find: FindModel
  permissions: PermissionsModel
  pageShare: PageShareModel
  /** The one transient message (15d). */
  notices: NoticeModel
  dispose(): void
}

export interface ServicesOptions {
  bridge: EngineBridge
  /** Started engine state (the window id must be known to open the overlay channel). */
  engine: EngineState
  client: TigerClient
  prefs: PrefsStorage
  overlayTransport: HostTransport
  viewport?: () => { width: number; height: number }
  doc?: Document | null
  /** Check open tabs' shared versions against a fresh local capture (sends nothing). */
  autoStaleCheck?: boolean
  /** Frame scheduler for the page-slot reporter (tests run it synchronously). */
  schedule?: (cb: () => void) => () => void
}

export function createAppServices(o: ServicesOptions): AppServices {
  const doc = o.doc === undefined ? (typeof document === 'undefined' ? null : document) : o.doc
  const viewport =
    o.viewport ??
    (() => ({
      width: typeof window === 'undefined' ? 1440 : window.innerWidth,
      height: typeof window === 'undefined' ? 900 : window.innerHeight,
    }))
  const router = createRouter()
  const layout = createLayout(o.prefs)
  const pageSlot = new PageSlotReporter({
    send: (bounds, cornerRadius) => o.bridge.invoke('page.setBounds', { bounds, cornerRadius }),
    ...(o.schedule ? { schedule: o.schedule } : {}),
  })
  const overlay = createOverlayHost({
    transport: o.overlayTransport,
    bridge: o.bridge,
    viewport,
    ...(doc ? { focus: documentFocus(doc) } : {}),
  })
  const shortcuts = createShortcuts()
  const omnibox = createOmniboxModel({ bridge: o.bridge, engine: o.engine })
  const find = createFindModel({ bridge: o.bridge, engine: o.engine })
  const permissions = createPermissionsModel({ bridge: o.bridge, engine: o.engine })
  const pageShare = createPageShareModel({
    client: o.client,
    engine: o.engine,
    autoStaleCheck: o.autoStaleCheck ?? true,
  })

  const notices = createNoticeModel({ engine: o.engine })
  const offs = [
    shortcuts.attach(o.bridge),
    doc ? overlay.attachToDocument(doc) : () => {},
    // Fullscreen and maximize move the page card without the slot element noticing.
    o.bridge.on('window.state', () => layout.invalidate()),
    // Sidebar collapse, panel open/close and resizing: measure the slot again.
    layout.store.subscribe(() => pageSlot.invalidate()),
  ]
  return {
    bridge: o.bridge,
    client: o.client,
    engine: o.engine,
    router,
    layout,
    pageSlot,
    overlay,
    shortcuts,
    omnibox,
    find,
    permissions,
    pageShare,
    notices,
    dispose() {
      for (const off of offs) off()
      pageSlot.dispose()
      overlay.dispose()
      omnibox.dispose()
      find.dispose()
      permissions.dispose()
      pageShare.dispose()
      notices.dispose()
    },
  }
}
