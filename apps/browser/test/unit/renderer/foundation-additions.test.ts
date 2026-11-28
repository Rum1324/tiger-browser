// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { coversPage, resolveSurface } from '../../../src/renderer/src/app/router'
import { useSurface } from '../../../src/renderer/src/app/surface'
import { usePageProblem } from '../../../src/renderer/src/features/page-problem'
import { usePageShare, usePageShareActions } from '../../../src/renderer/src/features/page-share'
import { effectiveLayout } from '../../../src/renderer/src/layout/layout-state'
import { makeWorld, renderHook, settle, type World, waitFor } from './world'

describe('page problems: a page that did not load, a page whose process ended', () => {
  let w: World
  afterEach(() => w?.dispose())

  const ctx = { session: 'signedIn' as const, firstRunDone: true }

  it('resolveSurface: crashed wins, a load error shows once loading stops', () => {
    const tab = {
      id: 't1',
      url: 'https://nowhere.invalid/',
      title: '',
      faviconUrl: null,
      isLoading: false,
      canGoBack: true,
      canGoForward: false,
      isPrivate: false,
      spaceId: null,
      pinned: false,
      audible: false,
      crashed: false,
      security: 'secure' as const,
      capture: { allowed: true, reason: null, rule: null },
      loadError: { code: -105, description: 'ERR_NAME_NOT_RESOLVED' },
      zoomFactor: 1,
    }
    expect(resolveSurface({ name: 'page' }, { ...ctx, activeTab: tab })).toEqual({
      name: 'page-problem',
      tabId: 't1',
      problem: { kind: 'load-error', code: -105, description: 'ERR_NAME_NOT_RESOLVED' },
    })
    expect(
      resolveSurface({ name: 'page' }, { ...ctx, activeTab: { ...tab, isLoading: true } }).name,
    ).toBe('page')
    expect(
      resolveSurface({ name: 'page' }, { ...ctx, activeTab: { ...tab, crashed: true } }),
    ).toMatchObject({ name: 'page-problem', problem: { kind: 'crashed' } })
    // Another surface on top (settings) is not replaced by the tab's problem.
    expect(
      resolveSurface({ name: 'settings', section: 'general' }, { ...ctx, activeTab: tab }).name,
    ).toBe('settings')
  })

  it('usePageProblem: the message, retry reloads the tab, the page comes back when it loads', async () => {
    w = await makeWorld({ tabs: [{ page: 'news', active: true }] })
    const id = w.engine.state.activeTabId as string
    const h = renderHook(w.services, () => ({ problem: usePageProblem(), surface: useSurface() }))
    expect(h.result.current.problem.problem).toBeNull()
    await settle(() =>
      w.engine.updateTab(id, { loadError: { code: -105, description: 'ERR_NAME_NOT_RESOLVED' } }),
    )
    expect(h.result.current.surface.surface.name).toBe('page-problem')
    expect(h.result.current.problem.message).toEqual({
      key: 'tab.loadError',
      vars: { description: 'ERR_NAME_NOT_RESOLVED', code: -105 },
    })
    // The page view is hidden while Tiger draws the problem in the card.
    expect(coversPage(h.result.current.surface.surface)).toBe(true)
    await settle(() => h.result.current.problem.retry())
    expect(w.engine.callsOf('tabs.reload').at(-1)).toEqual({ tabId: id })
    await settle(() => w.engine.updateTab(id, { loadError: null }))
    expect(h.result.current.surface.surface.name).toBe('page')

    await settle(() => w.engine.updateTab(id, { crashed: true }))
    expect(h.result.current.problem.message).toEqual({ key: 'tab.crashed' })
  })
})

describe('usePageShareActions: what the capsule can do', () => {
  let w: World
  afterEach(() => w?.dispose())

  it('attach then detach: the page leaves the draft and the dashed state goes', async () => {
    w = await makeWorld({ tabs: [{ page: 'news', active: true }] })
    const h = renderHook(w.services, () => ({ state: usePageShare(), act: usePageShareActions() }))
    const presented = h.result.current.act.attach()
    const s = await waitFor(() => w.guest.store.getState().current, 'attach sheet')
    expect(s.surface).toBe('attach')
    w.guest.shown(s.id)
    await waitFor(
      () => (s && (w.guest.store.getState().current?.props as { phase?: string })?.phase) === 'preview',
      'attach preview',
    )
    await settle(() => w.guest.emit(s.id, { type: 'confirm' }))
    expect(await presented).toBe(true)
    expect(h.result.current.state.attached).toBe(true)
    await settle(() => h.result.current.act.detach())
    expect(h.result.current.state.attached).toBe(false)
  })

  it('a blocked page opens the reason popover next to the capsule; a shareable one does not', async () => {
    w = await makeWorld({ tabs: [{ page: 'gmail', active: true }, { page: 'news' }] })
    const h = renderHook(w.services, () => usePageShareActions())
    const shown = h.result.current.showBlockedReason()
    const s = await waitFor(() => w.guest.store.getState().current, 'reason popover')
    expect(s.surface).toBe('blocked-reason')
    expect(s.props).toMatchObject({ reason: 'email' })
    expect(s.placement.mode).toBe('popover')
    w.guest.dismiss(s.id, 'escape')
    await shown

    const news = w.engine.state.tabs[1]?.id as string
    const other = renderHook(w.services, () => usePageShareActions(news))
    await settle(() => other.result.current.showBlockedReason())
    expect(w.services.overlay.store.getState().open).toBeNull()
  })

  it('retry asks for the item index again (the unknown state)', async () => {
    w = await makeWorld({ tabs: [{ page: 'pitch', active: true }] })
    const h = renderHook(w.services, () => usePageShareActions())
    const before = w.server.requests.filter((r) => r.route === 'listItemIndex').length
    await settle(() => h.result.current.retry())
    expect(w.server.requests.filter((r) => r.route === 'listItemIndex').length).toBeGreaterThan(
      before,
    )
  })
})

describe('effectiveLayout: the window-width rules', () => {
  const prefs = { sidebarCollapsed: false, panelOpen: false }
  it('wide as drawn; medium rails the sidebar only while the panel is open; narrow too', () => {
    expect(effectiveLayout(prefs, 1440)).toEqual({ mode: 'wide', sidebar: 'open', panel: 'closed' })
    expect(effectiveLayout({ ...prefs, panelOpen: true }, 1440).sidebar).toBe('open')
    expect(effectiveLayout(prefs, 1000).sidebar).toBe('open')
    expect(effectiveLayout({ ...prefs, panelOpen: true }, 1000)).toEqual({
      mode: 'medium',
      sidebar: 'rail',
      panel: 'open',
    })
    expect(effectiveLayout({ ...prefs, panelOpen: true }, 800).mode).toBe('narrow')
    expect(effectiveLayout({ sidebarCollapsed: true, panelOpen: false }, 1440).sidebar).toBe('rail')
  })
})
