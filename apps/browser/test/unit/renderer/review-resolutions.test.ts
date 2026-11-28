// @vitest-environment jsdom
import type { Rect, RememberedPermission } from '@tiger/shared'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { bindDefaultShortcuts } from '../../../src/renderer/src/app/default-shortcuts'
import { createFocusRegions } from '../../../src/renderer/src/features/focus-regions'
import { useRememberedPermissions } from '../../../src/renderer/src/features/permissions'
import { shareActions } from '../../../src/renderer/src/features/share'
import { createOverlayGuest } from '../../../src/renderer/src/overlay/guest'
import { createOverlayHost } from '../../../src/renderer/src/overlay/host'
import { OverlayRoot } from '../../../src/renderer/src/overlay/OverlayRoot'
import { memoryTransportPair } from '../../../src/renderer/src/overlay/protocol'
import { guestSurface, makeWorld, renderHook, settle, type World, waitFor } from './world'

let w: World | null = null
afterEach(() => {
  w?.dispose()
  w = null
  document.body.innerHTML = ''
})

const tick = () => new Promise((r) => setTimeout(r, 0))

function hostPair() {
  const pair = memoryTransportPair()
  const setOpen: { open: boolean; bounds?: Rect | null }[] = []
  let n = 0
  const host = createOverlayHost({
    transport: pair.host,
    bridge: {
      invoke: (async (name: string, req: { open: boolean; bounds?: Rect | null }) => {
        if (name === 'overlay.setOpen') setOpen.push(req)
      }) as never,
    },
    viewport: () => ({ width: 1440, height: 900 }),
    newId: () => `s${++n}`,
  })
  return { host, guest: createOverlayGuest(pair.guest), setOpen }
}

const anchor = { x: 1380, y: 8, width: 32, height: 32 }
const size = { width: 336, height: 240 }

describe('overlay rules (DESIGN.md 15.3 items 13 and 14)', () => {
  it('a hover card is the only surface raised at tight bounds', async () => {
    const { host, guest, setOpen } = hostPair()
    host.open('menu', { items: [] }, { mode: 'hovercard', anchor, size, align: 'end' })
    await tick()
    guest.shown('s1')
    await tick()
    expect(setOpen[0]).toEqual({ open: true, bounds: { x: 1076, y: 44, width: 336, height: 240 } })
    expect(guest.store.getState().current?.placement).toEqual({
      mode: 'hovercard',
      bounds: { x: 1076, y: 44, width: 336, height: 240 },
      side: 'below',
    })
  })

  it('one surface at a time: a second replaces the first, which is lowered first', async () => {
    const { host, guest, setOpen } = hostPair()
    const first = host.open('menu', { items: [] }, { mode: 'popover', anchor, size })
    await tick()
    guest.shown('s1')
    await tick()
    host.open('downloads', {}, { mode: 'popover', anchor, size })
    expect(await first.outcome).toEqual({ status: 'dismissed', reason: 'replaced' })
    await tick()
    expect(guest.store.getState().current).toMatchObject({ id: 's2', surface: 'downloads' })
    guest.shown('s2')
    await tick()
    expect(setOpen).toEqual([
      { open: true, bounds: null },
      { open: false },
      { open: true, bounds: null },
    ])
    expect(host.store.getState().open).toMatchObject({ id: 's2', surface: 'downloads' })
  })

  it('confirmSheet sends the open sheet its confirm event; nothing for other surfaces', async () => {
    const { host, guest } = hostPair()
    const events: unknown[] = []
    expect(host.confirmSheet()).toBe(false)
    host.open('menu', { items: [] }, { mode: 'modal' })
    await tick()
    guest.shown('s1')
    await tick()
    expect(host.confirmSheet()).toBe(false)
    host.open(
      'share',
      { phase: 'extracting', space: null },
      { mode: 'modal' },
      { onEvent: (e) => events.push(e) },
    )
    // Not drawn yet: the member cannot have seen what would be sent.
    expect(host.confirmSheet()).toBe(false)
    await tick()
    guest.shown('s2')
    await tick()
    expect(host.confirmSheet()).toBe(true)
    expect(events).toEqual([{ type: 'confirm' }])
  })
})

describe('OverlayRoot: transparent ground for menus and popovers', () => {
  async function mount() {
    const { host, guest } = hostPair()
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => {
      root.render(
        createElement(OverlayRoot, {
          guest,
          fallback: () => createElement('button', { type: 'button' }, 'item'),
        }),
      )
    })
    return { host, el }
  }

  it('a popover sits at its rectangle; a click on the ground closes it and goes no further', async () => {
    const { host, el } = await mount()
    const h = host.open('menu', { items: [] }, { mode: 'popover', anchor, size, align: 'end' })
    await settle()
    const surface = el.querySelector('[data-overlay-surface]') as HTMLElement
    expect(surface.style.left).toBe('1076px')
    expect(surface.style.top).toBe('44px')
    expect(surface.contains(document.activeElement)).toBe(true)
    await settle(() =>
      surface.querySelector('button')?.dispatchEvent(new Event('pointerdown', { bubbles: true })),
    )
    expect(host.store.getState().open).not.toBeNull()
    const ground = el.querySelector('[data-overlay-backdrop]') as HTMLElement
    const down = new Event('pointerdown', { bubbles: true, cancelable: true })
    let reachedPage = false
    document.addEventListener('pointerdown', () => {
      reachedPage = true
    })
    await settle(() => ground.dispatchEvent(down))
    expect(await h.outcome).toEqual({ status: 'dismissed', reason: 'outside' })
    expect(down.defaultPrevented).toBe(true)
    expect(reachedPage).toBe(false)
  })

  it('a hover card has no ground and does not take focus', async () => {
    const { host, el } = await mount()
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    outside.focus()
    host.open('menu', { items: [] }, { mode: 'hovercard', anchor, size })
    await settle()
    expect(el.querySelector('[data-overlay-backdrop]')).toBeNull()
    expect(el.querySelector('[data-overlay-surface]')?.getAttribute('role')).toBe('tooltip')
    expect(document.activeElement).toBe(outside)
  })
})

describe('new shortcut actions reach the hooks', () => {
  it('find-next / find-previous, reload / reload-hard', async () => {
    w = await makeWorld({ tabs: [{ page: 'news', active: true }] })
    const world = w
    const off = bindDefaultShortcuts(world.services)
    const tabId = world.engine.activeTab()?.id as string
    // ⌘G with the bar closed opens it.
    await settle(() => world.engine.emit('shortcut', { action: 'find-next' }))
    expect(world.services.find.store.getState().open).toBe(true)
    await settle(() => world.services.find.setText('介護'))
    await settle(() => world.engine.emit('shortcut', { action: 'find-next' }))
    await settle(() => world.engine.emit('shortcut', { action: 'find-previous' }))
    expect(world.engine.callsOf('page.find').slice(-2)).toEqual([
      { tabId, text: '介護', forward: true, findNext: true },
      { tabId, text: '介護', forward: false, findNext: true },
    ])
    await settle(() => world.engine.emit('shortcut', { action: 'reload' }))
    await settle(() => world.engine.emit('shortcut', { action: 'reload-hard' }))
    expect(world.engine.callsOf('tabs.reload')).toEqual([{ tabId }, { tabId, ignoreCache: true }])
    off()
  })

  it('confirm-sheet shares what the open share sheet previews, like its button', async () => {
    w = await makeWorld({ tabs: [{ page: 'news', active: true }] })
    const world = w
    const off = bindDefaultShortcuts(world.services)
    const activeId = () => world.engine.activeTab()?.id ?? null
    const done = shareActions(world.client, world.services.overlay, activeId).present()
    const s = await guestSurface(world, 'share')
    world.guest.shown(s.id)
    await waitFor(
      () =>
        (world.guest.store.getState().current?.props as { phase: string } | undefined)?.phase ===
        'preview',
      'preview in the sheet',
    )
    expect(world.server.requests.some((r) => r.route === 'shareItem')).toBe(false)
    await settle(() => world.engine.emit('shortcut', { action: 'confirm-sheet' }))
    expect(await done).toBe(true)
    expect(world.server.requests.filter((r) => r.route === 'shareItem')).toHaveLength(1)
    off()
  })

  it('confirm-sheet with no sheet open sends nothing', async () => {
    w = await makeWorld({ tabs: [{ page: 'news', active: true }] })
    const world = w
    const off = bindDefaultShortcuts(world.services)
    await settle(() => world.engine.emit('shortcut', { action: 'confirm-sheet' }))
    expect(world.server.requests.some((r) => r.route === 'shareItem')).toBe(false)
    off()
  })
})

describe('focus-next-region: sidebar, toolbar, page, ask panel', () => {
  function frame(withPanel: boolean) {
    document.body.innerHTML = `
      <aside data-region="sidebar"><button id="tab-row">tab</button></aside>
      <section data-region="toolbar"><input id="address" /></section>
      <main data-region="stage"><div data-region="page"></div></main>
      ${withPanel ? '<aside data-region="ask-panel"><textarea id="composer"></textarea></aside>' : ''}`
  }

  it('cycles the regions, hands focus to the page view through the engine, and takes it back', async () => {
    w = await makeWorld({ tabs: [{ page: 'news', active: true }] })
    const world = w
    frame(true)
    let overlay = false
    const regions = createFocusRegions({
      doc: document,
      bridge: world.engine,
      engine: world.services.engine,
      overlayOpen: () => overlay,
    })
    const tabId = world.engine.activeTab()?.id as string
    expect(regions.next()).toBe('sidebar')
    expect(document.activeElement?.id).toBe('tab-row')
    expect(regions.next()).toBe('toolbar')
    expect(document.activeElement?.id).toBe('address')
    const before = world.engine.callsOf('tabs.activate').length
    expect(regions.next()).toBe('page')
    await settle()
    expect(world.engine.callsOf('tabs.activate').slice(before)).toEqual([{ tabId }])
    expect(regions.current()).toBe('page')
    // The engine gave the keyboard back to the UI view before sending the shortcut.
    expect(regions.next()).toBe('ask-panel')
    expect(document.activeElement?.id).toBe('composer')
    expect(regions.next()).toBe('sidebar')

    // A click in the page (this document loses focus) puts focus in the page; an overlay does not.
    overlay = true
    window.dispatchEvent(new Event('blur'))
    expect(regions.current()).toBe('sidebar')
    overlay = false
    window.dispatchEvent(new Event('blur'))
    expect(regions.current()).toBe('page')
    document.dispatchEvent(new Event('pointerdown'))
    expect(regions.current()).toBe('sidebar')
    regions.dispose()
  })

  it('skips the closed panel, and the page while a surface covers it', async () => {
    w = await makeWorld({ tabs: [{ page: 'news', active: true }] })
    const world = w
    frame(false)
    document.querySelector('[data-region="page"]')?.remove()
    const regions = createFocusRegions({
      doc: document,
      bridge: world.engine,
      engine: world.services.engine,
      overlayOpen: () => false,
    })
    expect(regions.next()).toBe('sidebar')
    expect(regions.next()).toBe('toolbar')
    expect(regions.next()).toBe('sidebar')
    expect(world.engine.callsOf('tabs.activate')).toEqual([])
    regions.dispose()
  })

  it('the shortcut is bound to the cycle', async () => {
    w = await makeWorld({ tabs: [{ page: 'news', active: true }] })
    const world = w
    frame(false)
    const regions = createFocusRegions({
      doc: document,
      bridge: world.engine,
      engine: world.services.engine,
      overlayOpen: () => false,
    })
    const services = { ...world.services, focusRegions: regions }
    const off = bindDefaultShortcuts(services)
    await settle(() => world.engine.emit('shortcut', { action: 'focus-next-region' }))
    expect(document.activeElement?.id).toBe('tab-row')
    off()
    regions.dispose()
  })
})

describe('remembered site permissions in Settings (15.3 item 17)', () => {
  const remembered: RememberedPermission[] = [
    {
      origin: 'https://meet.example',
      permission: 'camera',
      allow: true,
      decidedAt: '2026-11-20T10:00:00.000Z',
    },
    {
      origin: 'https://news.example',
      permission: 'notifications',
      allow: false,
      decidedAt: '2026-11-19T10:00:00.000Z',
    },
  ]

  it('lists them when shown and revokes one', async () => {
    w = await makeWorld({ tabs: [{ page: 'news', active: true }], permissions: remembered })
    const world = w
    const h = renderHook(world.services, () => useRememberedPermissions())
    await waitFor(() => h.result.current.status === 'ready', 'list loaded')
    expect(h.result.current.list).toEqual(remembered)
    await settle(() => h.result.current.revoke('https://meet.example', 'camera'))
    expect(world.engine.callsOf('permissions.revoke')).toEqual([
      { origin: 'https://meet.example', permission: 'camera' },
    ])
    expect(h.result.current.list.map((p) => p.origin)).toEqual(['https://news.example'])
    await settle(() => h.result.current.reload())
    expect(h.result.current.list.map((p) => p.origin)).toEqual(['https://news.example'])
    h.unmount()
  })

  it('a refused revoke shows the engine list again', async () => {
    w = await makeWorld({ tabs: [{ page: 'news', active: true }], permissions: remembered })
    const world = w
    const h = renderHook(world.services, () => useRememberedPermissions())
    await waitFor(() => h.result.current.status === 'ready', 'list loaded')
    const real = world.engine.invoke.bind(world.engine)
    world.engine.invoke = (async (name: string, req?: unknown) => {
      if (name === 'permissions.revoke') throw new Error('refused')
      return (real as (n: string, r?: unknown) => Promise<unknown>)(name, req)
    }) as typeof world.engine.invoke
    let ok = true
    await settle(async () => {
      ok = await h.result.current.revoke('https://meet.example', 'camera')
    })
    expect(ok).toBe(false)
    expect(h.result.current.list).toEqual(remembered)
    h.unmount()
  })
})
