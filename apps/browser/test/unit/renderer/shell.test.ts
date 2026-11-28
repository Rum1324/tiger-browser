// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ServicesProvider } from '../../../src/renderer/src/app/context'
import { Shell } from '../../../src/renderer/src/app/Shell'
import { createOverlayGuest } from '../../../src/renderer/src/overlay/guest'
import { createOverlayHost } from '../../../src/renderer/src/overlay/host'
import { OverlayRoot } from '../../../src/renderer/src/overlay/OverlayRoot'
import { memoryTransportPair } from '../../../src/renderer/src/overlay/protocol'
import { makeWorld, settle, type World, waitFor } from './world'

/**
 * jsdom has no layout: the page slot's rectangle is derived here from the frame's attributes the
 * way the CSS grid would place it (sidebar 248 or 52, toolbar 48, gutter 8, panel 400).
 */
function fakeLayout() {
  const original = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.dataset.region !== 'page') return original.call(this)
    const frame = this.closest<HTMLElement>('[data-region="window"]')
    const sidebar = frame?.dataset.sidebar === 'collapsed' ? 52 : 248
    const panel = frame?.dataset.panel === 'open' ? 400 : 0
    const left = sidebar + 8
    return {
      left,
      top: 48,
      width: 1440 - left - 8 - panel,
      height: 900 - 48 - 8,
      x: left,
      y: 48,
      right: 0,
      bottom: 0,
      toJSON() {},
    } as DOMRect
  }
  return () => {
    HTMLElement.prototype.getBoundingClientRect = original
  }
}

describe('shell: surfaces and the page slot', () => {
  let w: World
  let restore: () => void
  beforeEach(() => {
    restore = fakeLayout()
  })
  afterEach(() => {
    restore()
    w?.dispose()
    document.body.innerHTML = ''
  })

  async function mount() {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => {
      root.render(createElement(ServicesProvider, { services: w.services }, createElement(Shell)))
    })
    return { el, unmount: () => act(() => root.unmount()) }
  }

  const bounds = () => w.engine.pageBounds?.bounds

  it('reports the page slot, hides it under a surface, follows panel and sidebar', async () => {
    w = await makeWorld({ tabs: [{ page: 'pitch', active: true }] })
    const { el } = await mount()
    await waitFor(() => bounds(), 'first report')
    expect(bounds()).toEqual({ x: 256, y: 48, width: 1176, height: 844 })
    expect(el.querySelector('[data-region="window"]')?.getAttribute('data-space')).toBe('amber')

    await settle(() => w.services.layout.togglePanel())
    await waitFor(() => bounds()?.width === 776, 'panel open')
    await settle(() => w.services.layout.toggleSidebar())
    await waitFor(() => bounds()?.x === 60, 'sidebar collapsed')
    expect(bounds()).toEqual({ x: 60, y: 48, width: 972, height: 844 })

    await settle(() => w.services.router.go({ name: 'settings', section: 'general' }))
    expect(bounds()).toBeNull()
    expect(el.querySelector('[data-testid="surface-settings"]')).not.toBeNull()
    expect(el.querySelector('[data-region="page"]')).toBeNull()

    await settle(() => w.services.router.back())
    await waitFor(() => bounds(), 'page again')
    expect(bounds()).toEqual({ x: 60, y: 48, width: 972, height: 844 })
  })

  it('a blank tab shows the new-tab surface (page hidden); navigating shows the page', async () => {
    w = await makeWorld({ tabs: [{ page: '', active: true }] })
    const { el } = await mount()
    await settle()
    expect(el.querySelector('[data-testid="surface-new-tab"]')).not.toBeNull()
    expect(bounds() ?? null).toBeNull()
    await settle(() =>
      w.engine.invoke('tabs.navigate', {
        tabId: w.engine.state.activeTabId as string,
        input: 'news',
      }),
    )
    await waitFor(() => bounds(), 'page shown')
  })

  it('first run covers everything until it is completed', async () => {
    w = await makeWorld({ tabs: [{ page: 'pitch', active: true }] })
    w.services.layout.store.setState({ firstRunDone: false })
    const { el } = await mount()
    await settle()
    expect(el.querySelector('[data-testid="surface-first-run"]')).not.toBeNull()
    await settle(() =>
      (el.querySelector('[data-testid="first-run-skip"]') as HTMLButtonElement).click(),
    )
    await waitFor(() => bounds(), 'page after first run')
  })

  it('private window: the frame carries no hue', async () => {
    w = await makeWorld({ tabs: [{ page: 'news', active: true }], privateWindow: true })
    const { el } = await mount()
    const frame = el.querySelector('[data-region="window"]')
    expect(frame?.getAttribute('data-window')).toBe('private')
    expect(frame?.getAttribute('data-space')).toBe('none')
  })

  it('a region that throws shows its fallback; the others keep working', async () => {
    w = await makeWorld({ tabs: [{ page: 'pitch', active: true }] })
    const { regionContent } = await import('../../../src/renderer/src/screens')
    const original = regionContent.askPanel
    regionContent.askPanel = () => {
      throw new Error('boom')
    }
    const errors = console.error
    console.error = () => {}
    try {
      w.services.layout.setPanelOpen(true)
      const { el } = await mount()
      expect(
        el.querySelector('[data-region="ask-panel"] [data-testid="region-error"]'),
      ).not.toBeNull()
      expect(el.querySelector('[data-testid="toolbar"]')).not.toBeNull()
    } finally {
      regionContent.askPanel = original
      console.error = errors
    }
  })
})

describe('OverlayRoot: focus, Escape, click outside, blur', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  async function setup() {
    const pair = memoryTransportPair()
    const raised: unknown[] = []
    const host = createOverlayHost({
      transport: pair.host,
      bridge: { invoke: (async (_n: string, r: unknown) => raised.push(r)) as never },
      viewport: () => ({ width: 1440, height: 900 }),
    })
    const guest = createOverlayGuest(pair.guest)
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    const { Placeholder } = await import('../../../src/renderer/src/overlay/placeholders')
    const { translator } = await import('../../../src/renderer/src/i18n')
    await act(async () => {
      root.render(
        createElement(OverlayRoot, {
          guest,
          fallback: (name) =>
            createElement(Placeholder, {
              name,
              t: translator('ja'),
              bridge: { invoke: (async () => []) as never },
            }),
        }),
      )
    })
    return { host, guest, el, raised }
  }

  const confirmProps = {
    title: { key: 'ledger.unshareTitle' as const },
    body: { key: 'ledger.unshareBody' as const },
    confirm: { key: 'ledger.unshareConfirm' as const },
  }

  it('moves focus into the surface, then reports it shown (the host raises the view)', async () => {
    const { host, el, raised } = await setup()
    host.open('confirm', confirmProps, { mode: 'modal' })
    await waitFor(() => raised.length === 1, 'raised')
    const surface = el.querySelector('[data-overlay-surface]')
    expect(surface?.contains(document.activeElement)).toBe(true)
    expect(el.textContent).toContain('共有を解除しますか？')
    expect(raised[0]).toEqual({ open: true, bounds: null })
  })

  it('Escape dismisses; a surface that handled Escape itself keeps it', async () => {
    const { host } = await setup()
    const h = host.open('confirm', confirmProps, { mode: 'modal' })
    await settle()
    await settle(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(await h.outcome).toEqual({ status: 'dismissed', reason: 'escape' })
  })

  it('modal: a pointerdown outside the surface dismisses; inside does not', async () => {
    const { host, el } = await setup()
    const h = host.open('confirm', confirmProps, { mode: 'modal' })
    await settle()
    const inside = el.querySelector('[data-overlay-surface] button') as HTMLElement
    await settle(() => inside.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(host.store.getState().open).not.toBeNull()
    const backdrop = el.querySelector('[data-overlay-backdrop]') as HTMLElement
    await settle(() => backdrop.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(await h.outcome).toEqual({ status: 'dismissed', reason: 'outside' })
  })

  it('popover: losing focus (a click on the page or the main view) dismisses', async () => {
    const { host } = await setup()
    const h = host.open(
      'downloads',
      {},
      {
        mode: 'popover',
        anchor: { x: 0, y: 0, width: 10, height: 10 },
        size: { width: 100, height: 100 },
      },
    )
    await settle()
    await settle(() => window.dispatchEvent(new Event('focus')))
    await settle(() => window.dispatchEvent(new Event('blur')))
    expect(await h.outcome).toEqual({ status: 'dismissed', reason: 'blur' })
  })

  it('confirm placeholder: the button resolves with the result', async () => {
    const { host, el } = await setup()
    const h = host.open('confirm', confirmProps, { mode: 'modal' })
    await settle()
    await settle(() =>
      (el.querySelector('[data-testid="confirm-ok"]') as HTMLButtonElement).click(),
    )
    expect(await h.outcome).toEqual({ status: 'result', value: true })
  })
})
