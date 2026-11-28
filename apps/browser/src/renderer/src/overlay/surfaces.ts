import type {
  CaptureBlockReason,
  ModelInfo,
  ModelRef,
  PermissionRequest,
  SpaceHue,
} from '@tiger/shared'
import type { PaletteChoice } from '../app/commands'
import type { AttachSheetEvent, AttachView } from '../features/attach'
import type { PaletteProps } from '../features/palette'
import type { ShareSheetEvent, ShareView } from '../features/share'
import type { ShareThreadEvent, ShareThreadView } from '../features/share-thread'
import type { Notice } from '../i18n'

/**
 * Every surface the overlay view can show: its props (host → overlay), its result (overlay → host,
 * closes it) and its events (overlay → host while it stays open). All plain data: they cross
 * between two pages by structured clone. A designed component registers for a name in
 * `overlay/registry.tsx`; add a new surface by adding an entry here.
 */
export interface MenuItemSpec {
  id: string
  label: string
  detail?: string
  /** A shortcut action whose accelerator to show. */
  shortcut?: string
  checked?: boolean
  disabled?: boolean
  /** Draw a rule above this item. */
  separatorBefore?: boolean
}

export interface ConfirmProps {
  title: Notice
  body: Notice
  /** What the confirmation is about, shown verbatim (an item title). */
  subject?: string
  confirm: Notice
  destructive?: boolean
}

export interface InviteSheetProps {
  token: string
  busy: boolean
  error: Notice | null
}

export interface ModelPickerProps {
  models: ModelInfo[]
  selected: ModelRef | null
  defaultRef: ModelRef | null
}

export interface OverlaySurfaceMap {
  palette: { props: PaletteProps; result: PaletteChoice; event: never }
  menu: { props: { items: MenuItemSpec[] }; result: string; event: never }
  confirm: { props: ConfirmProps; result: true; event: never }
  share: { props: ShareView; result: never; event: ShareSheetEvent }
  attach: { props: AttachView; result: never; event: AttachSheetEvent }
  'share-thread': { props: ShareThreadView; result: never; event: ShareThreadEvent }
  permission: {
    props: { request: PermissionRequest; canRemember: boolean }
    result: { allow: boolean; remember: boolean }
    event: never
  }
  'model-picker': { props: ModelPickerProps; result: ModelRef; event: never }
  invite: {
    props: InviteSheetProps
    result: never
    event: { type: 'accept' } | { type: 'dismiss' }
  }
  /** Create a Space (16a2): the dialog stays open while the request runs and shows its failure. */
  'create-space': {
    props: { busy: boolean; error: Notice | null }
    result: never
    event: { type: 'create'; name: string; hue?: SpaceHue } | { type: 'cancel' }
  }
  /** Why a page can never be shared, with the rule that matched (05). */
  'blocked-reason': {
    props: { reason: CaptureBlockReason | null; rule: string | null; url: string }
    result: never
    event: never
  }
  /** The engine-only surfaces read the engine from the overlay view's own bridge. */
  downloads: { props: Record<string, never>; result: never; event: never }
  find: { props: { tabId: string }; result: never; event: never }
}

export type OverlaySurfaceName = keyof OverlaySurfaceMap
export type SurfaceProps<N extends OverlaySurfaceName> = OverlaySurfaceMap[N]['props']
export type SurfaceResult<N extends OverlaySurfaceName> = OverlaySurfaceMap[N]['result']
export type SurfaceEvent<N extends OverlaySurfaceName> = OverlaySurfaceMap[N]['event']

export const OVERLAY_SURFACES: readonly OverlaySurfaceName[] = [
  'palette',
  'menu',
  'confirm',
  'share',
  'attach',
  'share-thread',
  'permission',
  'model-picker',
  'invite',
  'create-space',
  'blocked-reason',
  'downloads',
  'find',
]
