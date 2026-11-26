import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launch, removeDir, type TigerApp, tempDir, waitFor, waitForTab } from './app'
import { type FixtureServer, startFixtureServer } from './fixtures'

let server: FixtureServer
let t: TigerApp
let dir: string
const url = (path: string) => server.url('127.0.0.1', path)

beforeAll(async () => {
  server = await startFixtureServer()
  dir = tempDir('tabs')
  t = await launch({ userDataDir: dir })
})
afterAll(async () => {
  await t?.close()
  await server?.close()
  removeDir(dir)
})

describe('tab lifecycle and navigation state', () => {
  it('starts with one blank tab', async () => {
    const s = await t.tabsState()
    expect(s.privateWindow).toBe(false)
    expect(s.tabs).toHaveLength(1)
    expect(s.tabs[0]?.url).toBe('')
    expect(s.tabs[0]?.security).toBe('internal')
    expect(s.activeTabId).toBe(s.tabs[0]?.id)
  })

  it('navigates typed input, tracks title, history and back/forward', async () => {
    const [first] = (await t.tabsState()).tabs
    const id = first?.id as string
    // A bare host:port gets http://, resolved by the engine.
    await t.invoke('tabs.navigate', { tabId: id, input: `127.0.0.1:${server.port}/one` })
    let tab = await waitForTab(t, id, (x) => x.title === 'Page One' && !x.isLoading, 'page one')
    expect(tab.url).toBe(url('/one'))
    expect(tab.security).toBe('insecure')
    // Loopback addresses are never capturable; capture tests use mapped public host names.
    expect(tab.capture).toMatchObject({ allowed: false, reason: 'local-network' })
    // As in Chrome, the first page can go back to the new-tab page.
    expect(tab.canGoBack).toBe(true)
    expect(tab.canGoForward).toBe(false)

    await t.invoke('tabs.navigate', { tabId: id, input: url('/two') })
    tab = await waitForTab(t, id, (x) => x.title === 'Page Two' && !x.isLoading, 'page two')
    expect(tab.canGoBack).toBe(true)
    expect(tab.canGoForward).toBe(false)

    await t.invoke('tabs.back', { tabId: id })
    tab = await waitForTab(t, id, (x) => x.url === url('/one') && !x.isLoading, 'back')
    expect(tab.canGoForward).toBe(true)
    await t.invoke('tabs.forward', { tabId: id })
    await waitForTab(t, id, (x) => x.url === url('/two') && !x.isLoading, 'forward')

    await t.invoke('tabs.reload', { tabId: id })
    await waitForTab(t, id, (x) => x.url === url('/two') && !x.isLoading, 'reload')

    const history = await t.invoke('history.search', { query: '127.0.0.1' })
    expect(history.map((h) => h.url)).toEqual(expect.arrayContaining([url('/one'), url('/two')]))
    expect(history.find((h) => h.url === url('/one'))?.visitCount).toBeGreaterThanOrEqual(2)
  })

  it('never loads a non-web scheme typed by the member: it becomes a search', async () => {
    const tab = await t.invoke('tabs.create', { input: 'javascript:document.title="pwned"' })
    const s = await waitForTab(t, tab.id, (x) => x.url !== '', 'resolved url')
    expect(s.url.startsWith('https://www.google.com/search?q=javascript')).toBe(true)
    expect(s.title).not.toBe('pwned')
    await t.invoke('tabs.close', { tabId: tab.id })
  })

  it('creates, activates, moves, pins, duplicates, closes and reopens tabs', async () => {
    const a = (await t.tabsState()).tabs[0]?.id as string
    const b = await t.invoke('tabs.create', { input: url('/one'), spaceId: 'space-1' })
    expect(b.spaceId).toBe('space-1')
    let s = await t.tabsState()
    expect(s.activeTabId).toBe(b.id)
    const c = await t.invoke('tabs.create', { input: url('/two'), active: false })
    s = await t.tabsState()
    expect(s.activeTabId).toBe(b.id)
    expect(s.tabs.map((x) => x.id)).toEqual([a, b.id, c.id])

    await t.invoke('tabs.activate', { tabId: c.id })
    expect((await t.tabsState()).activeTabId).toBe(c.id)

    await t.invoke('tabs.move', { tabId: c.id, toIndex: 0 })
    expect((await t.tabsState()).tabs.map((x) => x.id)).toEqual([c.id, a, b.id])

    await t.invoke('tabs.setPinned', { tabId: b.id, pinned: true })
    s = await t.tabsState()
    expect(s.tabs.map((x) => x.id)).toEqual([b.id, c.id, a])
    expect(s.tabs[0]?.pinned).toBe(true)
    // An unpinned tab cannot be moved into the pinned block.
    await t.invoke('tabs.move', { tabId: a, toIndex: 0 })
    expect((await t.tabsState()).tabs.map((x) => x.id)).toEqual([b.id, a, c.id])

    await t.invoke('tabs.setSpace', { tabId: c.id, spaceId: 'space-2' })
    expect((await t.tabsState()).tabs.find((x) => x.id === c.id)?.spaceId).toBe('space-2')

    await waitForTab(t, b.id, (x) => x.title === 'Page One', 'b loaded')
    const dup = await t.invoke('tabs.duplicate', { tabId: b.id })
    await waitForTab(t, dup.id, (x) => x.url === url('/one') && !x.isLoading, 'duplicate loaded')
    expect(dup.spaceId).toBe('space-1')

    await waitForTab(t, c.id, (x) => x.title === 'Page Two', 'c loaded')
    await t.invoke('tabs.close', { tabId: c.id })
    s = await t.tabsState()
    expect(s.tabs.some((x) => x.id === c.id)).toBe(false)
    const reopened = await t.invoke('tabs.reopenClosed')
    expect(reopened?.spaceId).toBe('space-2')
    await waitForTab(t, reopened?.id as string, (x) => x.url === url('/two'), 'reopened')

    for (const id of [dup.id, reopened?.id as string, b.id])
      await t.invoke('tabs.close', { tabId: id })
    expect((await t.tabsState()).tabs.map((x) => x.id)).toEqual([a])
  })

  it('reports load errors, zoom and find results', async () => {
    const tab = await t.invoke('tabs.create', { input: 'http://127.0.0.1:9/' })
    const failed = await waitForTab(t, tab.id, (x) => x.loadError !== null, 'load error')
    expect(failed.loadError?.code).toBeLessThan(0)

    await t.invoke('tabs.navigate', { tabId: tab.id, input: url('/two') })
    await waitForTab(
      t,
      tab.id,
      (x) => x.title === 'Page Two' && x.loadError === null && !x.isLoading,
      'recovered',
    )

    await t.invoke('page.setZoom', { tabId: tab.id, factor: 1.5 })
    await waitForTab(t, tab.id, (x) => Math.abs(x.zoomFactor - 1.5) < 0.01, 'zoom')

    await t.ui.evaluate(() => {
      const w = window as unknown as { __find: unknown[] }
      w.__find = []
      window.tiger.on('page.findResult', (r) => w.__find.push(r))
    })
    await t.invoke('page.find', { tabId: tab.id, text: 'apple', forward: true, findNext: false })
    const result = await waitFor(
      () =>
        t.ui.evaluate(() => {
          const list = (window as unknown as { __find: { matches: number; tabId: string }[] })
            .__find
          return list.find((r) => r.matches > 0) ?? null
        }),
      10_000,
      'find result',
    )
    expect(result).toMatchObject({ tabId: tab.id, matches: 3 })
    await t.invoke('page.stopFind', { tabId: tab.id })
    await t.invoke('tabs.stop', { tabId: tab.id })
    await t.invoke('tabs.close', { tabId: tab.id })
  })

  it('opens a popup as a tab with window.opener intact', async () => {
    const opener = await t.invoke('tabs.create', { input: url('/opener') })
    await waitForTab(t, opener.id, (x) => x.title === 'Opener' && !x.isLoading, 'opener loaded')
    const page = await t.tabPage((u) => u === url('/opener'))
    await page.click('#open')

    const popup = await waitFor(
      async () => {
        const s = await t.tabsState()
        return s.tabs.find((x) => x.url === url('/popup') && x.title === 'HAS-OPENER') ?? null
      },
      15_000,
      'popup tab',
    )
    const s = await t.tabsState()
    // A tab in the same window, right after its opener, and active.
    expect(s.tabs.findIndex((x) => x.id === popup.id)).toBe(
      s.tabs.findIndex((x) => x.id === opener.id) + 1,
    )
    expect(s.activeTabId).toBe(popup.id)
    // The popup posted to window.opener and the opener received it.
    await waitForTab(t, opener.id, (x) => x.title === 'OPENER-OK', 'opener got the message')

    // window.close() from the popup closes the tab without wedging the engine.
    const popupPage = await t.tabPage((u) => u === url('/popup'))
    await popupPage
      .evaluate(() => (window as unknown as { closeMe: () => void }).closeMe())
      .catch(() => {})
    await waitFor(
      async () => !(await t.tabsState()).tabs.some((x) => x.id === popup.id),
      10_000,
      'popup closed',
    )
    expect((await t.tabsState()).activeTabId).toBe(opener.id)
    await t.invoke('tabs.close', { tabId: opener.id })
  })

  it('gives page scripts no bridge, no Node and no Electron', async () => {
    const tab = await t.invoke('tabs.create', { input: url('/probe') })
    await waitForTab(t, tab.id, (x) => x.title === 'Probe' && !x.isLoading, 'probe loaded')
    const page = await t.tabPage((u) => u === url('/probe'))
    const probe = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>
      return {
        tiger: typeof w.tiger,
        require: typeof w.require,
        process: typeof w.process,
        electron: typeof w.electron,
        ipcRenderer: typeof w.ipcRenderer,
        globals: Object.keys(window).filter((k) => /tiger|ipc|electron/i.test(k)),
      }
    })
    expect(probe).toEqual({
      tiger: 'undefined',
      require: 'undefined',
      process: 'undefined',
      electron: 'undefined',
      ipcRenderer: 'undefined',
      globals: [],
    })
    // The UI view, by contrast, has the bridge.
    expect(await t.ui.evaluate(() => typeof window.tiger.invoke)).toBe('function')
    await t.invoke('tabs.close', { tabId: tab.id })
  })

  it('validates every command against the contract', async () => {
    const err = await t.ui.evaluate(async () => {
      const call = (name: string, req: unknown) =>
        (window.tiger.invoke as (n: string, r: unknown) => Promise<unknown>)(name, req).then(
          () => 'resolved',
          (e: Error) => e.message,
        )
      return {
        unknown: await call('tabs.nuke', undefined),
        malformed: await call('tabs.navigate', { tabId: 42 }),
        missingTab: await call('tabs.activate', { tabId: 'no-such-tab' }),
      }
    })
    expect(err.unknown).toMatch(/unknown command/)
    expect(err.malformed).toMatch(/invalid request for tabs.navigate/)
    expect(err.missingTab).toMatch(/no tab/)
  })

  it('emits window.state and answers app.info', async () => {
    const info = await t.invoke('app.info')
    expect(info).toMatchObject({ engine: 'electron', platform: 'linux' })
    expect(info.chromiumVersion).toMatch(/^\d+\./)
    await t.ui.evaluate(() => {
      const w = window as unknown as { __ws: unknown[] }
      w.__ws = []
      window.tiger.on('window.state', (s) => w.__ws.push(s))
    })
    // Xvfb has no window manager, so maximize is a no-op there; fullscreen is applied by the app.
    await t.invoke('window.action', { action: 'toggle-fullscreen' })
    const state = await waitFor(
      () =>
        t.ui.evaluate(() => {
          const list = (window as unknown as { __ws: { fullscreen: boolean }[] }).__ws
          return list.find((s) => s.fullscreen) ?? null
        }),
      10_000,
      'fullscreen window.state',
    )
    expect(state.fullscreen).toBe(true)
    await t.invoke('window.action', { action: 'toggle-fullscreen' })
  })
})
