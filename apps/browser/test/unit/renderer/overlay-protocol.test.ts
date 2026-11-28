import type { Rect } from '@tiger/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOverlayGuest } from '../../../src/renderer/src/overlay/guest'
import { createOverlayHost } from '../../../src/renderer/src/overlay/host'
import {
  broadcastTransport,
  type GuestMessage,
  type HostMessage,
  memoryTransportPair,
  popoverBounds,
  readEnvelope,
} from '../../../src/renderer/src/overlay/protocol'

const tick = () => new Promise((r) => setTimeout(r, 0))

function setup(opts: { shownTimeoutMs?: number } = {}) {
  const pair = memoryTransportPair()
  const setOpen: { open: boolean; bounds?: Rect | null }[] = []
  const restored: string[] = []
  let n = 0
  const host = createOverlayHost({
    transport: pair.host,
    bridge: {
      invoke: (async (name: string, req: { open: boolean; bounds?: Rect | null }) => {
        if (name === 'overlay.setOpen') setOpen.push(req)
      }) as never,
    },
    viewport: () => ({ width: 1440, height: 900 }),
    focus: { save: () => () => restored.push('focus') },
    newId: () => `s${++n}`,
    ...(opts.shownTimeoutMs ? { shownTimeoutMs: opts.shownTimeoutMs } : {}),
  })
  const guest = createOverlayGuest(pair.guest)
  return { host, guest, setOpen, restored, pair }
}

describe('overlay protocol', () => {
  afterEach(() => vi.useRealTimers())

  it('modal: shown → raised full-window; result → lowered, closed, focus returned, resolved', async () => {
    const { host, guest, setOpen, restored } = setup()
    const handle = host.open('confirm', { title: { key: 'ledger.unshareTitle' }, body: { key: 'ledger.unshareBody' }, confirm: { key: 'ledger.unshareConfirm' } }, { mode: 'modal' })
    await tick()
    const c = guest.store.getState().current
    expect(c).toMatchObject({ id: 's1', surface: 'confirm', placement: { mode: 'modal', anchor: null } })
    // Nothing is raised until the guest has drawn the surface.
    expect(setOpen).toEqual([])
    guest.shown('s1')
    await tick()
    expect(setOpen).toEqual([{ open: true, bounds: null }])
    expect(host.store.getState().open).toMatchObject({ surface: 'confirm', shown: true })
    guest.resolve('s1', true)
    expect(await handle.outcome).toEqual({ status: 'result', value: true })
    expect(setOpen.at(-1)).toEqual({ open: false })
    expect(restored).toEqual(['focus'])
    expect(host.store.getState().open).toBeNull()
    await tick()
    expect(guest.store.getState().current).toBeNull()
  })

  it('popover: a tight rectangle next to its anchor, flipped when it does not fit', async () => {
    const { host, guest, setOpen } = setup()
    host.open('downloads', {}, { mode: 'popover', anchor: { x: 1380, y: 8, width: 32, height: 32 }, size: { width: 360, height: 420 }, align: 'end' })
    await tick()
    guest.shown('s1')
    await tick()
    expect(setOpen[0]).toEqual({ open: true, bounds: { x: 1052, y: 44, width: 360, height: 420 } })
    expect(guest.store.getState().current?.placement).toEqual({ mode: 'popover', bounds: { x: 1052, y: 44, width: 360, height: 420 }, side: 'below' })

    expect(popoverBounds({ mode: 'popover', anchor: { x: 100, y: 860, width: 40, height: 30 }, size: { width: 200, height: 300 } }, { width: 1440, height: 900 })).toEqual({ bounds: { x: 100, y: 556, width: 200, height: 300 }, side: 'above' })
    // Too wide for the window: clamped inside it with the margin.
    expect(popoverBounds({ mode: 'popover', anchor: { x: 10, y: 10, width: 10, height: 10 }, size: { width: 2000, height: 100 } }, { width: 800, height: 600 }).bounds).toEqual({ x: 8, y: 24, width: 784, height: 100 })
  })

  it('dismissals: escape, outside, blur all settle with their reason; late answers are dropped', async () => {
    const { host, guest, setOpen } = setup()
    for (const reason of ['escape', 'outside', 'blur'] as const) {
      const h = host.open('menu', { items: [] }, { mode: 'modal' })
      await tick()
      const id = guest.store.getState().current?.id as string
      guest.shown(id)
      await tick()
      guest.dismiss(id, reason)
      guest.resolve(id, 'late')
      expect(await h.outcome).toEqual({ status: 'dismissed', reason })
    }
    expect(setOpen.filter((s) => s.open)).toHaveLength(3)
    expect(setOpen.filter((s) => !s.open)).toHaveLength(3)
    expect(host.justDismissed('menu')).toBe(true)
  })

  it('opening another surface replaces the first; update and events flow while open', async () => {
    const { host, guest } = setup()
    const first = host.open('menu', { items: [] }, { mode: 'modal' })
    const events: unknown[] = []
    const second = host.open('share', { phase: 'extracting', space: null }, { mode: 'modal' }, { onEvent: (e) => events.push(e) })
    expect(await first.outcome).toEqual({ status: 'dismissed', reason: 'replaced' })
    await tick()
    expect(guest.store.getState().current?.id).toBe('s2')
    second.update({ phase: 'idle' })
    await tick()
    expect(guest.store.getState().current?.props).toEqual({ phase: 'idle' })
    guest.emit('s2', { type: 'confirm' })
    guest.emit('s1', { type: 'confirm' })
    await tick()
    expect(events).toEqual([{ type: 'confirm' }])
    second.close()
    expect(await second.outcome).toEqual({ status: 'dismissed', reason: 'closed' })
  })

  it('a guest that (re)loads says hello and gets the open surface back', async () => {
    const { host, pair } = setup()
    host.open('palette', { mode: 'commands', initialQuery: '', commands: [] }, { mode: 'modal' })
    await tick()
    const late = createOverlayGuest(pair.guest)
    await tick()
    await tick()
    expect(late.store.getState().current).toMatchObject({ id: 's1', surface: 'palette' })
  })

  it('an overlay view that never answers: dismissed as unavailable, nothing raised', async () => {
    vi.useFakeTimers()
    const pair = memoryTransportPair()
    const setOpen: unknown[] = []
    const host = createOverlayHost({
      transport: pair.host,
      bridge: { invoke: (async (_n: string, r: unknown) => setOpen.push(r)) as never },
      viewport: () => ({ width: 1440, height: 900 }),
      shownTimeoutMs: 1000,
    })
    const h = host.open('menu', { items: [] }, { mode: 'modal' })
    vi.advanceTimersByTime(1001)
    expect(await h.outcome).toEqual({ status: 'dismissed', reason: 'unavailable' })
    expect(setOpen).toEqual([])
  })

  it('Escape or a click in the main view closes the open surface', async () => {
    const { host } = setup()
    expect(host.handleMainKey('Escape')).toBe(false)
    const h = host.open('menu', { items: [] }, { mode: 'modal' })
    expect(host.handleMainKey('a')).toBe(false)
    expect(host.handleMainKey('Escape')).toBe(true)
    expect(await h.outcome).toEqual({ status: 'dismissed', reason: 'escape' })
    const p = host.open('downloads', {}, { mode: 'popover', anchor: { x: 0, y: 0, width: 1, height: 1 }, size: { width: 10, height: 10 } })
    expect(host.handleMainPointerDown()).toBe(true)
    expect(await p.outcome).toEqual({ status: 'dismissed', reason: 'outside' })
  })

  it('props must be plain data: a function fails to cross like it would between the views', () => {
    const { host } = setup()
    expect(() => host.open('menu', { items: [], fn: () => 1 } as never, { mode: 'modal' })).toThrow()
  })

  it('envelopes: only well-formed messages from the other side are accepted', () => {
    expect(readEnvelope({ v: 1, from: 'host', m: { t: 'close', id: 'x' } }, 'host')).toEqual({ t: 'close', id: 'x' })
    expect(readEnvelope({ v: 1, from: 'guest', m: { t: 'close', id: 'x' } }, 'host')).toBeNull()
    expect(readEnvelope({ v: 2, from: 'host', m: { t: 'close', id: 'x' } }, 'host')).toBeNull()
    expect(readEnvelope({ v: 1, from: 'host', m: { t: 'eval', id: 'x' } }, 'host')).toBeNull()
    expect(readEnvelope({ v: 1, from: 'host', m: { t: 'close' } }, 'host')).toBeNull()
    expect(readEnvelope('nope', 'host')).toBeNull()
    expect(readEnvelope({ v: 1, from: 'guest', m: { t: 'hello' } }, 'guest')).toEqual({ t: 'hello' })
  })

  it('the BroadcastChannel transport delivers between two channels of one name only', async () => {
    const a = new BroadcastChannel('tiger.overlay.win-1')
    const b = new BroadcastChannel('tiger.overlay.win-1')
    const other = new BroadcastChannel('tiger.overlay.win-2')
    const hostT = broadcastTransport<HostMessage, GuestMessage>('host', a)
    const guestT = broadcastTransport<GuestMessage, HostMessage>('guest', b)
    const otherT = broadcastTransport<GuestMessage, HostMessage>('guest', other)
    const gotGuest: HostMessage[] = []
    const gotOther: HostMessage[] = []
    const gotHost: GuestMessage[] = []
    guestT.subscribe((m) => gotGuest.push(m))
    otherT.subscribe((m) => gotOther.push(m))
    hostT.subscribe((m) => gotHost.push(m))
    hostT.post({ t: 'close', id: 'z' })
    guestT.post({ t: 'hello' })
    await new Promise((r) => setTimeout(r, 30))
    expect(gotGuest).toEqual([{ t: 'close', id: 'z' }])
    expect(gotOther).toEqual([])
    expect(gotHost).toEqual([{ t: 'hello' }])
    for (const t of [hostT, guestT, otherT]) t.close()
  })
})
