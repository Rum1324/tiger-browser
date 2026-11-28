// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { usePageShare } from '../../../src/renderer/src/features/page-share'
import { useTabs } from '../../../src/renderer/src/features/tabs'
import { spaceIds } from '../../../src/renderer/src/testing/fixtures'
import { makeWorld, renderHook, settle, waitFor, type World } from './world'

const TABS = [
  { page: 'pitch', active: true },
  { page: 'notion' },
  { page: 'news' },
  { page: 'gmail' },
  { page: 'hireplan' },
  { page: 'bank', pinned: true },
  { page: '' },
]

describe('usePageShare: every capsule state from the fixture world', () => {
  let w: World
  afterEach(() => w?.dispose())

  const stateOf = (tabIndex: number) => {
    const id = w.engine.state.tabs[tabIndex]?.id as string
    const h = renderHook(w.services, () => usePageShare(id))
    return h
  }

  it('fresh, local, blocked, elsewhere, none', async () => {
    w = await makeWorld({ tabs: TABS })
    const fresh = stateOf(0)
    expect(fresh.result.current).toMatchObject({ state: 'fresh', space: { id: spaceIds.fund, memberCount: 4 } })
    if (fresh.result.current.state === 'fresh') expect(fresh.result.current.location.versionNumber).toBe(2)
    expect(stateOf(2).result.current.state).toBe('local')
    expect(stateOf(3).result.current).toMatchObject({ state: 'blocked', reason: 'email' })
    expect(stateOf(5).result.current).toMatchObject({ state: 'blocked', reason: 'banking' })
    const elsewhere = stateOf(4).result.current
    expect(elsewhere).toMatchObject({ state: 'elsewhere', spaces: [{ id: spaceIds.hire, name: '採用' }] })
    expect(stateOf(6).result.current.state).toBe('none')
  })

  it('stale after the local check finds a changed page; sends no request for it', async () => {
    w = await makeWorld({ tabs: TABS })
    const notionTab = w.engine.state.tabs[1]?.id as string
    const h = renderHook(w.services, () => usePageShare(notionTab))
    expect(h.result.current.state).toBe('fresh')
    const before = w.server.requests.length
    await settle(() => w.services.pageShare.checkStale(notionTab))
    expect(h.result.current.state).toBe('stale')
    expect(w.server.requests.length).toBe(before)
    // The pitch deck's capture equals its shared version: still fresh after the check.
    const pitchTab = w.engine.state.tabs[0]?.id as string
    await settle(() => w.services.pageShare.checkStale(pitchTab))
    expect(renderHook(w.services, () => usePageShare(pitchTab)).result.current.state).toBe('fresh')
  })

  it('pending while the index loads, error when it fails', async () => {
    w = await makeWorld({ tabs: TABS })
    const release = w.server.holdRoute('listItemIndex')
    const h = renderHook(w.services, () => usePageShare())
    await settle(() => {
      void w.client.urlShare.refresh()
    })
    // A refresh keeps the rows it has: the state stays known while it reloads.
    expect(h.result.current.state).toBe('fresh')
    release()
    w.client.urlShare.reset()
    await settle()
    expect(h.result.current.state).toBe('pending')
    w.server.failRoute('listItemIndex', 'internal')
    await settle(() => w.client.urlShare.start(w.world.spaces.map((s) => s.id)))
    await waitFor(() => h.result.current.state === 'error', 'error state')
    expect(h.result.current).toMatchObject({ state: 'error', error: { key: 'error.internal' } })
  })

  it('private window: every tab is private', async () => {
    w = await makeWorld({ tabs: [{ page: 'news', active: true }], privateWindow: true })
    expect(renderHook(w.services, () => usePageShare()).result.current.state).toBe('private')
  })

  it('signed out: local, and sharing is not offered', async () => {
    w = await makeWorld({ tabs: [{ page: 'news', active: true }], signedIn: false })
    expect(renderHook(w.services, () => usePageShare()).result.current).toMatchObject({
      state: 'local',
      canShare: false,
      why: 'signed-out',
    })
  })

  it('sharing → just-shared with undo → local again after undo', async () => {
    w = await makeWorld({ tabs: [{ page: 'news', active: true }] })
    const h = renderHook(w.services, () => usePageShare())
    expect(h.result.current).toMatchObject({ state: 'local', canShare: true })
    await settle(() => w.client.share.begin(w.engine.state.activeTabId as string, spaceIds.fund))
    expect(h.result.current.sharing).toBe('preview')
    await settle(() => w.client.share.confirm())
    expect(h.result.current).toMatchObject({ state: 'just-shared', outcome: 'new', canUndo: true })
    await settle(() => w.services.pageShare.undo())
    await waitFor(() => h.result.current.state === 'local', 'local after undo')
    expect(w.server.requests.filter((r) => r.route === 'unshareItem')).toHaveLength(1)
  })

  it('attached: the page is in the next question’s draft', async () => {
    w = await makeWorld({ tabs: [{ page: 'news', active: true }] })
    const h = renderHook(w.services, () => usePageShare())
    expect(h.result.current.attached).toBe(false)
    const thread = await w.client.threads.ensurePrivateThread()
    await settle(() => w.client.threads.beginAttach(thread?.id as string, w.engine.state.activeTabId as string))
    await settle(() => w.client.threads.confirmAttach())
    expect(h.result.current.attached).toBe(true)
  })
})

describe('useTabs: the sidebar zones', () => {
  let w: World
  afterEach(() => w?.dispose())

  it('splits tabs the Space can read from tabs that stay on this Mac', async () => {
    w = await makeWorld({ tabs: TABS })
    const h = renderHook(w.services, () => useTabs())
    const titles = (rows: { tab: { title: string } }[]) => rows.map((r) => r.tab.title)
    expect(titles(h.result.current.shared)).toEqual(['投資家向けピッチ v3', '資本政策メモ'])
    expect(titles(h.result.current.pinned)).toEqual(['PayPay銀行 ビジネス口座'])
    expect(h.result.current.local.map((r) => r.tab.url)).toContain('')
    expect(h.result.current.local.find((r) => r.tab.title === '採用計画 2027')?.elsewhere).toBe(true)

    // Switching Space moves the rows: in 採用 the hiring plan is shared, the pitch is not.
    await settle(() => w.client.spaces.select(spaceIds.hire))
    expect(titles(h.result.current.shared)).toEqual(['採用計画 2027'])
  })

  it('actions go to the engine; cycle wraps in sidebar order', async () => {
    w = await makeWorld({ tabs: TABS })
    const h = renderHook(w.services, () => useTabs())
    await settle(() => h.result.current.create('news'))
    expect(w.engine.callsOf('tabs.create').at(-1)).toMatchObject({ input: 'news', active: true, spaceId: spaceIds.fund })
    const created = w.engine.state.activeTabId as string
    await settle(() => h.result.current.close(created))
    expect(w.engine.state.tabs.some((t) => t.id === created)).toBe(false)
    // Sidebar order: pinned (bank), shared (pitch, notion), local (news, gmail, hireplan, blank).
    await settle(() => h.result.current.activate(w.engine.state.tabs[5]?.id as string))
    await settle(() => h.result.current.cycle(1))
    expect(h.result.current.activeTab?.title).toBe('投資家向けピッチ v3')
    await settle(() => h.result.current.cycle(-1))
    await settle(() => h.result.current.cycle(-1))
    expect(h.result.current.activeTab?.url).toBe('')
  })
})
