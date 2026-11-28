// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { useNotice } from '../../../src/renderer/src/features/notice'
import {
  bindAutoSurfaces,
  parseSpaceMenuChoice,
  presentCreateSpace,
  presentExportMenu,
  presentModelPicker,
  presentSpaceMenu,
} from '../../../src/renderer/src/features/presenters'
import type { MenuItemSpec } from '../../../src/renderer/src/overlay/surfaces'
import { spaceIds } from '../../../src/renderer/src/testing/fixtures'
import { makeWorld, renderHook, settle, type World, waitFor } from './world'

const TABS = [{ page: 'pitch', active: true }, { page: 'news' }]

/** The surface the overlay view was asked to show, once it arrives, reported as shown. */
async function opened(w: World, name: string) {
  const s = await waitFor(
    () => (w.guest.store.getState().current?.surface === name ? w.guest.store.getState().current : null),
    `${name} in the overlay`,
  )
  w.guest.shown(s.id)
  await settle()
  return s
}

describe('menus and dialogs opened from a control', () => {
  let w: World
  afterEach(() => w?.dispose())

  it('Space menu: every Space with the current one checked; choosing one switches', async () => {
    w = await makeWorld({ tabs: TABS })
    const done = presentSpaceMenu(w.services)
    const s = await opened(w, 'menu')
    const items = (s.props as { items: MenuItemSpec[] }).items
    expect(items.filter((i) => i.id.startsWith('space:')).map((i) => i.label)).toEqual(
      w.client.spaces.store.getState().list.map((x) => x.name),
    )
    expect(items.find((i) => i.checked)?.id).toBe(`space:${spaceIds.fund}`)
    expect(s.placement.mode).toBe('popover')
    w.guest.resolve(s.id, `space:${spaceIds.hire}`)
    expect(await done).toEqual({ kind: 'space', spaceId: spaceIds.hire })
    await waitFor(() => w.client.spaces.store.getState().currentSpaceId === spaceIds.hire)
    expect(parseSpaceMenuChoice('nonsense')).toBeNull()
  })

  it('Space menu → private window asks the engine; a dismissed menu does nothing', async () => {
    w = await makeWorld({ tabs: TABS })
    const first = presentSpaceMenu(w.services)
    w.guest.dismiss((await opened(w, 'menu')).id, 'escape')
    expect(await first).toBeNull()
    const second = presentSpaceMenu(w.services)
    w.guest.resolve((await opened(w, 'menu')).id, 'private-window')
    await second
    expect(w.engine.callsOf('window.create').at(-1)).toEqual({ private: true })
  })

  it('create Space: the dialog stays open while the request runs, then switches to it', async () => {
    w = await makeWorld({ tabs: TABS })
    const done = presentCreateSpace(w.services)
    const s = await opened(w, 'create-space')
    expect(s.props).toEqual({ busy: false, error: null })
    w.guest.emit(s.id, { type: 'create', name: '営業', hue: 'teal' })
    const id = await done
    expect(id).toBeTruthy()
    expect(w.client.spaces.store.getState().currentSpaceId).toBe(id)
    expect(w.server.requests.find((r) => r.route === 'createSpace')?.body).toMatchObject({
      name: '営業',
      hue: 'teal',
    })
  })

  it('create Space: a failure is shown in the open dialog; cancel closes it', async () => {
    w = await makeWorld({ tabs: TABS })
    w.server.failRoute('createSpace', 'invalid_request', 400)
    const done = presentCreateSpace(w.services)
    const s = await opened(w, 'create-space')
    w.guest.emit(s.id, { type: 'create', name: 'x' })
    await waitFor(
      () => (w.guest.store.getState().current?.props as { error: unknown } | undefined)?.error,
      'error in the dialog',
    )
    expect(w.guest.store.getState().current?.props).toMatchObject({
      busy: false,
      error: { key: 'error.invalid_request' },
    })
    w.guest.emit(s.id, { type: 'cancel' })
    expect(await done).toBeNull()
  })

  it('model menu opens above its button; the choice is for the next question', async () => {
    w = await makeWorld({ tabs: TABS })
    await waitFor(() => w.client.models.store.getState().load.status === 'ready', 'models')
    const done = presentModelPicker(w.services)
    const s = await opened(w, 'model-picker')
    const models = (s.props as { models: { provider: string; id: string; available: boolean }[] })
      .models
    const pick = models.find((m) => m.available) as { provider: string; id: string }
    w.guest.resolve(s.id, { provider: pick.provider, id: pick.id })
    expect(await done).toEqual({ provider: pick.provider, id: pick.id })
    expect(w.client.models.store.getState().selected).toEqual({
      provider: pick.provider,
      id: pick.id,
    })
  })

  it('export menu returns the chosen exit', async () => {
    w = await makeWorld({ tabs: TABS })
    const done = presentExportMenu(w.services)
    const s = await opened(w, 'menu')
    expect((s.props as { items: MenuItemSpec[] }).items.map((i) => i.id)).toEqual([
      'google',
      'copy',
      'file',
    ])
    w.guest.resolve(s.id, 'copy')
    expect(await done).toBe('copy')
  })
})

describe('engine-driven prompts', () => {
  let w: World
  let unbind: (() => void) | null = null
  afterEach(() => {
    unbind?.()
    unbind = null
    w?.dispose()
  })

  it('a permission request on the active tab opens the prompt; the answer goes to the engine', async () => {
    w = await makeWorld({ tabs: TABS })
    unbind = bindAutoSurfaces(w.services)
    const tabId = w.engine.state.activeTabId as string
    await settle(() =>
      w.engine.emit('permission.request', {
        requestId: 'p1',
        tabId,
        origin: 'https://meet.example',
        permission: 'microphone',
      }),
    )
    const s = await opened(w, 'permission')
    expect(s.props).toMatchObject({ canRemember: true, request: { permission: 'microphone' } })
    expect(s.placement.mode).toBe('popover')
    w.guest.resolve(s.id, { allow: true, remember: false })
    await waitFor(() => w.engine.callsOf('permission.respond').length === 1, 'respond')
    expect(w.engine.callsOf('permission.respond')[0]).toEqual({
      requestId: 'p1',
      allow: true,
      remember: false,
    })
  })

  it('a dismissed prompt waits (no answer sent); another tab’s request waits for that tab', async () => {
    w = await makeWorld({ tabs: TABS })
    unbind = bindAutoSurfaces(w.services)
    const other = w.engine.state.tabs[1]?.id as string
    await settle(() =>
      w.engine.emit('permission.request', {
        requestId: 'p2',
        tabId: other,
        origin: 'https://care-keizai.jp',
        permission: 'notifications',
      }),
    )
    expect(w.services.overlay.store.getState().open).toBeNull()
    await settle(() => w.services.bridge.invoke('tabs.activate', { tabId: other }))
    const s = await opened(w, 'permission')
    w.guest.dismiss(s.id, 'blur')
    await settle()
    expect(w.engine.callsOf('permission.respond')).toHaveLength(0)
    expect(w.services.permissions.store.getState().queue.map((q) => q.requestId)).toEqual(['p2'])
  })

  it('an invite link opened in the engine shows the offer; accepting joins and opens Space home', async () => {
    w = await makeWorld({ tabs: TABS })
    unbind = bindAutoSurfaces(w.services)
    await settle(() => w.engine.emit('invite.open', { token: 'invite-token-abcdefghij' }))
    const s = await opened(w, 'invite')
    expect(s.props).toMatchObject({ token: 'invite-token-abcdefghij', busy: false })
    w.guest.emit(s.id, { type: 'accept' })
    await waitFor(() => w.server.requests.some((r) => r.route === 'acceptInvite'), 'accept')
    await waitFor(() => w.services.router.store.getState().route.name === 'space-home', 'home')
    expect(w.services.overlay.store.getState().open).toBeNull()
  })

  it('an offer closed with Escape is put aside, not accepted', async () => {
    w = await makeWorld({ tabs: TABS })
    unbind = bindAutoSurfaces(w.services)
    await settle(() => w.engine.emit('invite.open', { token: 'invite-token-abcdefghij' }))
    w.guest.dismiss((await opened(w, 'invite')).id, 'escape')
    await waitFor(() => w.client.spaces.store.getState().pendingInvite === null, 'put aside')
    expect(w.server.requests.some((r) => r.route === 'acceptInvite')).toBe(false)
  })
})

describe('the notice', () => {
  let w: World
  afterEach(() => w?.dispose())

  it('a download that completes shows one notice with an open action', async () => {
    w = await makeWorld({ tabs: TABS })
    const running = w.engine.downloads.find((d) => d.state === 'progressing')
    if (!running) throw new Error('fixture has no running download')
    const h = renderHook(w.services, () => useNotice())
    expect(h.result.current.current).toBeNull()
    w.engine.downloads = w.engine.downloads.map((d) =>
      d.id === running.id ? { ...d, state: 'completed', receivedBytes: d.totalBytes } : d,
    )
    await settle(() => w.engine.emit('downloads.changed', w.engine.downloads))
    expect(h.result.current.current?.notice).toEqual({
      key: 'notice.downloadDone',
      vars: { name: running.filename },
    })
    await settle(() => h.result.current.act())
    expect(w.engine.callsOf('downloads.open').at(-1)).toEqual({ id: running.id })
    expect(h.result.current.current).toBeNull()
  })
})
