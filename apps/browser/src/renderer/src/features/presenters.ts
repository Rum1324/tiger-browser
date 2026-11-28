import { errorKey } from '@tiger/client'
import type { ModelRef } from '@tiger/shared'
import { useMemo } from 'react'
import { useServices } from '../app/context'
import type { AppServices } from '../app/services'
import { type Translate, translator } from '../i18n'
import { popoverAt } from '../overlay/anchors'
import type { MenuItemSpec } from '../overlay/surfaces'
import { canRemember } from './permissions'

/**
 * The surfaces that open from a control or from an engine event rather than from a flow of
 * @tiger/client: menus (the Space menu, the export menu, the menu behind 「共有中」), the model
 * menu, the create-Space dialog, the site permission prompt and the invite offer. Each one opens
 * the overlay with plain props, waits for its answer and carries it out in the main view. A
 * designed component marks its trigger with `data-overlay-anchor="<name>"`; the popover is placed
 * next to it.
 */

const tOf = (s: AppServices): Translate =>
  translator(s.engine.settings.getState().value?.locale ?? s.client.ui.getState().locale)

/** Open a menu next to an anchor; resolves with the chosen item id, or null. */
export async function presentMenu(
  s: AppServices,
  items: MenuItemSpec[],
  anchor: string,
  side: 'below' | 'above' = 'below',
): Promise<string | null> {
  const height = Math.min(480, 16 + items.length * 32 + items.filter((i) => i.separatorBefore).length * 9)
  const placement = popoverAt(anchor, 'menu', side)
  if (placement.mode === 'popover') placement.size = { width: placement.size.width, height }
  const outcome = await s.overlay.open('menu', { items }, placement).outcome
  return outcome.status === 'result' ? outcome.value : null
}

// ── The Space menu (16a) and the create dialog (16a2) ───────────────────────

export type SpaceMenuChoice =
  | { kind: 'space'; spaceId: string }
  | { kind: 'home' }
  | { kind: 'create' }
  | { kind: 'join' }
  | { kind: 'private-window' }

export function spaceMenuItems(s: AppServices, t: Translate): MenuItemSpec[] {
  const { list, currentSpaceId } = s.client.spaces.store.getState()
  return [
    ...list.map((sp) => ({
      id: `space:${sp.id}`,
      label: sp.name,
      detail: t(sp.myRole === 'owner' ? 'members.owner' : 'members.member'),
      checked: sp.id === currentSpaceId,
    })),
    { id: 'home', label: t('command.spaceHome'), separatorBefore: list.length > 0 },
    { id: 'create', label: t('spaces.create') },
    { id: 'join', label: t('invite.paste') },
    { id: 'private-window', label: t('window.newPrivate'), separatorBefore: true },
  ]
}

export function parseSpaceMenuChoice(id: string): SpaceMenuChoice | null {
  if (id.startsWith('space:')) return { kind: 'space', spaceId: id.slice('space:'.length) }
  if (id === 'home' || id === 'create' || id === 'join' || id === 'private-window')
    return { kind: id }
  return null
}

/** The Space menu under the Space header's chevron; carries out the choice. */
export async function presentSpaceMenu(s: AppServices): Promise<SpaceMenuChoice | null> {
  const id = await presentMenu(s, spaceMenuItems(s, tOf(s)), 'space-menu')
  const choice = id ? parseSpaceMenuChoice(id) : null
  if (!choice) return null
  switch (choice.kind) {
    case 'space':
      await s.client.spaces.select(choice.spaceId)
      break
    case 'home':
      s.router.go({ name: 'space-home', section: 'overview' })
      break
    case 'create':
      await presentCreateSpace(s)
      break
    case 'join':
      s.router.go({ name: 'settings', section: 'spaces' })
      break
    case 'private-window':
      await s.bridge.invoke('window.create', { private: true }).catch(() => {})
      break
  }
  return choice
}

/** The create-Space dialog; resolves with the new Space's id, or null when cancelled. */
export async function presentCreateSpace(s: AppServices): Promise<string | null> {
  let created: string | null = null
  const props = () => {
    const m = s.client.spaces.store.getState().mutation
    return {
      busy: m.status === 'loading',
      error: m.status === 'error' && m.error ? { key: errorKey(m.error) } : null,
    }
  }
  const handle = s.overlay.open(
    'create-space',
    { busy: false, error: null },
    { mode: 'modal' },
    {
      async onEvent(e) {
        if (e.type === 'cancel') return handle.close('closed')
        handle.update({ ...props(), busy: true })
        const space = await s.client.spaces.create(e.name, e.hue)
        if (space) {
          created = space.id
          await s.client.spaces.select(space.id)
          handle.close('closed')
        } else handle.update(props())
      },
    },
  )
  await handle.outcome
  return created
}

// ── The model menu (12) ──────────────────────────────────────────────────────

/** The model menu above the composer's model button; the choice applies to the next question. */
export async function presentModelPicker(s: AppServices): Promise<ModelRef | null> {
  const m = s.client.models.store.getState()
  const outcome = await s.overlay.open(
    'model-picker',
    { models: m.models, selected: m.selected, defaultRef: m.memberDefault ?? m.serverDefault },
    popoverAt('model', 'model-picker', 'above'),
  ).outcome
  if (outcome.status !== 'result') return null
  s.client.models.select(outcome.value)
  return outcome.value
}

// ── Export menu (18a) and the menu behind 「共有中」 ──────────────────────────

export type ExportTarget = 'google' | 'copy' | 'file'

export async function presentExportMenu(s: AppServices, anchor = 'export'): Promise<ExportTarget | null> {
  const t = tOf(s)
  const id = await presentMenu(
    s,
    [
      { id: 'google', label: t('export.googleDoc') },
      { id: 'copy', label: t('export.copy') },
      { id: 'file', label: t('export.saveFile') },
    ],
    anchor,
  )
  return id === 'google' || id === 'copy' || id === 'file' ? id : null
}

export type SharedPageChoice = 'open-item' | 'share-version' | 'unshare' | 'space-home'

/** The menu behind 「共有中」 in the capsule (component sheet): what can be done with the item. */
export async function presentSharedPageMenu(
  s: AppServices,
  opts: { canUnshare: boolean },
): Promise<SharedPageChoice | null> {
  const t = tOf(s)
  const id = await presentMenu(
    s,
    [
      { id: 'open-item', label: t('ledger.open') },
      { id: 'share-version', label: t('pageState.shareNewVersion') },
      { id: 'space-home', label: t('command.spaceHome') },
      {
        id: 'unshare',
        label: t('ledger.unshare'),
        disabled: !opts.canUnshare,
        separatorBefore: true,
      },
    ],
    'page-state',
  )
  return id === 'open-item' || id === 'share-version' || id === 'unshare' || id === 'space-home'
    ? id
    : null
}

// ── Engine-driven prompts: site permissions (15a) and invite links (16c) ────

/**
 * Show the active tab's permission request as a popover under the address field as soon as it
 * arrives. Dismissing it (Escape, a click elsewhere) leaves the request waiting: the capsule and
 * the tab row keep a mark, and `reopenPermission` shows it again. Returns the cleanup.
 */
export function bindPermissionPrompts(s: AppServices): () => void {
  let showing: string | null = null
  const dismissedIds = new Set<string>()
  const check = () => {
    const active = s.engine.tabs.getState().value?.activeTabId ?? null
    const req = s.permissions.store.getState().queue.find((q) => q.tabId === active) ?? null
    if (!req || showing === req.requestId || dismissedIds.has(req.requestId)) return
    if (s.overlay.store.getState().open) return
    showing = req.requestId
    void s.overlay
      .open(
        'permission',
        { request: req, canRemember: canRemember(req) },
        popoverAt('address', 'permission'),
      )
      .outcome.then((o) => {
        showing = null
        if (o.status === 'result') void s.permissions.respond(req.requestId, o.value.allow, o.value.remember)
        else dismissedIds.add(req.requestId)
      })
  }
  const offs = [s.permissions.store.subscribe(check), s.engine.tabs.subscribe(check)]
  reopeners.set(s, (requestId) => {
    dismissedIds.delete(requestId)
    check()
  })
  return () => {
    for (const off of offs) off()
    reopeners.delete(s)
  }
}

const reopeners = new WeakMap<AppServices, (requestId: string) => void>()

/** Show a waiting permission request again (the mark in the capsule or on the tab row). */
export function reopenPermission(s: AppServices, requestId: string): void {
  reopeners.get(s)?.(requestId)
}

/**
 * Offer an invite link the member opened (engine `invite.open` → @tiger/client's pending invite)
 * as the accept dialog. Returns the cleanup.
 */
export function bindInviteOffer(s: AppServices): () => void {
  let open: string | null = null
  const props = () => {
    const st = s.client.spaces.store.getState()
    return {
      token: st.pendingInvite?.token ?? '',
      busy: st.mutation.status === 'loading',
      error:
        st.mutation.status === 'error' && st.mutation.error
          ? { key: errorKey(st.mutation.error) }
          : null,
    }
  }
  const check = () => {
    const pending = s.client.spaces.store.getState().pendingInvite
    if (!pending || open === pending.token) return
    open = pending.token
    const handle = s.overlay.open('invite', props(), { mode: 'modal' }, {
      async onEvent(e) {
        if (e.type === 'dismiss') {
          s.client.spaces.dismissPendingInvite()
          return handle.close('closed')
        }
        handle.update({ ...props(), busy: true })
        const space = await s.client.spaces.acceptPendingInvite()
        if (space) {
          handle.close('closed')
          s.router.go({ name: 'space-home', section: 'overview' })
        } else handle.update(props())
      },
    })
    void handle.outcome.then((o) => {
      open = null
      // Escape or a click outside: the offer is put aside, not accepted.
      if (o.status === 'dismissed' && o.reason !== 'closed') s.client.spaces.dismissPendingInvite()
    })
  }
  const off = s.client.spaces.store.subscribe(check)
  check()
  return off
}

/** Bind the engine-driven prompts for the life of the services. */
export function bindAutoSurfaces(s: AppServices): () => void {
  const offs = [bindPermissionPrompts(s), bindInviteOffer(s)]
  return () => {
    for (const off of offs) off()
  }
}

/** The presenters bound to the current services, for components. */
export function usePresenters() {
  const s = useServices()
  return useMemo(
    () => ({
      menu: (items: MenuItemSpec[], anchor: string, side?: 'below' | 'above') =>
        presentMenu(s, items, anchor, side),
      spaceMenu: () => presentSpaceMenu(s),
      createSpace: () => presentCreateSpace(s),
      modelPicker: () => presentModelPicker(s),
      exportMenu: (anchor?: string) => presentExportMenu(s, anchor),
      sharedPageMenu: (opts: { canUnshare: boolean }) => presentSharedPageMenu(s, opts),
      reopenPermission: (requestId: string) => reopenPermission(s, requestId),
    }),
    [s],
  )
}

