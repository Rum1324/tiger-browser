import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launch, removeDir, type TigerApp, tempDir, waitFor, waitForTab } from './app'
import { type FixtureServer, startFixtureServer } from './fixtures'

let server: FixtureServer
let dir: string
const url = (path: string) => server.url('127.0.0.1', path)

beforeAll(async () => {
  server = await startFixtureServer()
  dir = tempDir('persist')
})
afterAll(async () => {
  await server?.close()
  removeDir(dir)
})

async function cookieShownIn(t: TigerApp, page = t.ui): Promise<string> {
  const tab = await t.invokeFrom(page, 'tabs.create', { input: url('/echo-cookie') })
  await waitForTab(t, tab.id, (x) => x.title === 'Cookie echo' && !x.isLoading, 'echo', page)
  const pages = t.app.windows().filter((p) => p.url() === url('/echo-cookie'))
  const texts = await Promise.all(pages.map((p) => p.textContent('#cookie')))
  await t.invokeFrom(page, 'tabs.close', { tabId: tab.id })
  return texts.join(' | ')
}

describe('persistence across restart', () => {
  it('keeps cookies, history, tabs, bookmarks and settings, but nothing from a private window', async () => {
    // ── First run ──
    const a = await launch({ userDataDir: dir })
    const first = (await a.tabsState()).tabs[0]?.id as string
    await a.invoke('tabs.navigate', {
      tabId: first,
      input: url('/set-cookie?name=who&value=tiger'),
    })
    await waitForTab(a, first, (x) => x.title === 'Cookie set' && !x.isLoading, 'cookie set')
    const second = await a.invoke('tabs.create', { input: url('/two'), spaceId: 'space-9' })
    await waitForTab(a, second.id, (x) => x.title === 'Page Two' && !x.isLoading, 'two')
    await a.invoke('tabs.setPinned', { tabId: second.id, pinned: true })
    await a.invoke('bookmarks.add', { url: url('/two'), title: 'Two' })
    await a.invoke('settings.update', { searchEngine: 'duckduckgo', lastSpaceId: 'space-9' })
    await a.invoke('permission.respond', { requestId: 'none', allow: true, remember: false })

    let tokenStored = true
    try {
      await a.invoke('auth.setToken', { token: 'tiger-session-token' })
    } catch {
      tokenStored = false
    }

    // A private window in the same run: its own cookie jar, no history.
    const before = a.uiPages().length
    await a.invoke('window.create', { private: true })
    const priv = await waitFor(() => a.uiPages()[before], 15_000, 'private window')
    await priv.waitForFunction(() => typeof window.tiger?.invoke === 'function')
    const pt = await a.invokeFrom(priv, 'tabs.create', {
      input: url('/set-cookie?name=priv&value=secret'),
    })
    await waitForTab(
      a,
      pt.id,
      (x) => x.title === 'Cookie set' && !x.isLoading,
      'private cookie',
      priv,
    )
    const pv = await a.invokeFrom(priv, 'tabs.create', { input: url('/one') })
    await waitForTab(a, pv.id, (x) => x.title === 'Page One' && !x.isLoading, 'private visit', priv)

    const normalJar = await cookieShownIn(a)
    expect(normalJar).toContain('who=tiger')
    expect(normalJar).not.toContain('priv=secret')
    const privateJar = await cookieShownIn(a, priv)
    expect(privateJar).toContain('priv=secret')
    expect(privateJar).not.toContain('who=tiger')

    const history = await a.invoke('history.search', { query: '' })
    expect(history.map((h) => h.url)).toContain(url('/set-cookie?name=who&value=tiger'))
    expect(history.map((h) => h.url)).not.toContain(url('/set-cookie?name=priv&value=secret'))
    expect(history.map((h) => h.url)).not.toContain(url('/one'))
    // Suggestions in the private window do not mix in the member's history.
    const privSuggest = await a.invokeFrom(priv, 'suggest.query', { input: 'name=who' })
    expect(privSuggest.some((s) => s.kind === 'history')).toBe(false)
    const normalSuggest = await a.invoke('suggest.query', { input: 'name=who' })
    expect(normalSuggest.some((s) => s.kind === 'history' || s.kind === 'tab')).toBe(true)

    await a.close()

    // ── Second run, same profile ──
    const b = await launch({ userDataDir: dir })
    try {
      expect(b.uiPages()).toHaveLength(1)
      const restored = await waitFor(
        async () => {
          const s = await b.tabsState()
          return s.tabs.length === 2 && s.tabs.every((x) => x.url) ? s : null
        },
        15_000,
        'restored tabs',
      )
      expect(restored.privateWindow).toBe(false)
      expect(restored.tabs.map((x) => x.url)).toEqual([
        url('/two'),
        url('/set-cookie?name=who&value=tiger'),
      ])
      expect(restored.tabs[0]).toMatchObject({ pinned: true, spaceId: 'space-9' })

      const jar = await cookieShownIn(b)
      expect(jar).toContain('who=tiger')
      expect(jar).not.toContain('priv')

      const h = await b.invoke('history.search', { query: '127.0.0.1' })
      expect(h.map((x) => x.url)).toContain(url('/two'))
      expect(h.map((x) => x.url)).not.toContain(url('/one'))
      expect((await b.invoke('bookmarks.list')).map((x) => x.url)).toEqual([url('/two')])
      expect(await b.invoke('settings.get')).toMatchObject({
        searchEngine: 'duckduckgo',
        lastSpaceId: 'space-9',
      })
      if (tokenStored) expect(await b.invoke('auth.getToken')).toBe('tiger-session-token')
      expect(tokenStored).toBe(true)
    } finally {
      await b.close()
    }
  })
})

describe('session restore with several windows', () => {
  it('reopens every normal window with its tabs, not only the one focused last', async () => {
    const profile = tempDir('persist-multi')
    try {
      const a = await launch({ userDataDir: profile })
      const first = (await a.tabsState()).tabs[0]?.id as string
      await a.invoke('tabs.navigate', { tabId: first, input: url('/one') })
      await waitForTab(a, first, (x) => x.title === 'Page One' && !x.isLoading, 'one')
      const two = await a.invoke('tabs.create', { input: url('/two') })
      await waitForTab(a, two.id, (x) => x.title === 'Page Two' && !x.isLoading, 'two')
      // A second, smaller window opened last (so it is the focused one at quit).
      await a.invoke('window.create', {})
      const second = await waitFor(() => a.uiPages()[1], 15_000, 'second window')
      await second.waitForFunction(() => typeof window.tiger?.invoke === 'function')
      const lone = (await a.tabsState(second)).tabs[0]?.id as string
      await a.invokeFrom(second, 'tabs.navigate', { tabId: lone, input: url('/probe') })
      await waitForTab(a, lone, (x) => x.title === 'Probe' && !x.isLoading, 'probe', second)
      await a.close()

      const b = await launch({ userDataDir: profile })
      try {
        const windows = await waitFor(
          async () => {
            const pages = b.uiPages()
            if (pages.length !== 2) return null
            const states = await Promise.all(
              pages.map((p) =>
                p
                  .waitForFunction(() => typeof window.tiger?.invoke === 'function')
                  .then(() => b.tabsState(p)),
              ),
            )
            return states.every((st) => st.tabs.every((x) => x.url)) ? states : null
          },
          20_000,
          'two restored windows',
        )
        const urls = windows
          .map((w) => w.tabs.map((x) => x.url))
          .sort((x, y) => y.length - x.length)
        expect(urls).toEqual([[url('/one'), url('/two')], [url('/probe')]])
      } finally {
        await b.close()
      }
    } finally {
      removeDir(profile)
    }
  })
})
