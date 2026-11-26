import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launch, removeDir, type TigerApp, tempDir, waitFor, waitForTab } from './app'
import { ARTICLE, type FixtureServer, startFixtureServer } from './fixtures'

let server: FixtureServer
let t: TigerApp
let dir: string
// Public-looking names mapped to the fixture server: loopback hosts are never capturable.
const NEWS = 'news.tiger-fixture.com'
const BANK = 'direct.bk.mufg.jp'

beforeAll(async () => {
  server = await startFixtureServer()
  dir = tempDir('capture')
  t = await launch({
    userDataDir: dir,
    args: [`--host-resolver-rules=MAP ${NEWS} 127.0.0.1, MAP ${BANK} 127.0.0.1`],
  })
})
afterAll(async () => {
  await t?.close()
  await server?.close()
  removeDir(dir)
})

async function openTab(href: string, title: string, app = t, page = t.ui) {
  const tab = await app.invokeFrom(page, 'tabs.create', { input: href })
  return waitForTab(app, tab.id, (x) => x.title === title && !x.isLoading, `load ${href}`, page)
}

describe('capture', () => {
  it('extracts an article to Markdown locally', async () => {
    const tab = await openTab(server.url(NEWS, '/article'), ARTICLE.title)
    expect(tab.capture).toEqual({ allowed: true, reason: null, rule: null })
    const r = await t.invoke('capture.extract', { tabId: tab.id })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const md = r.page.markdown
    // Readability moves the H1 into `title`; navigation and footer are dropped.
    expect(md).toBe(
      [
        'By Aiko Tanaka',
        ...ARTICLE.paragraphs,
        '- First point to remember\n- Second point to remember',
      ].join('\n\n'),
    )
    expect(r.page).toMatchObject({
      url: server.url(NEWS, '/article'),
      title: ARTICLE.title,
      sourceType: 'web',
      lang: 'en',
      truncated: false,
    })

    // The harness capture button goes through the same command and shows the Markdown.
    await t.ui.click('[data-testid="capture"]')
    const shown = await t.ui.textContent('[data-testid="capture-markdown"]')
    expect(shown).toContain(ARTICLE.paragraphs[0])
    await t.invoke('tabs.close', { tabId: tab.id })
  })

  it('refuses a blocklisted host even when the UI asks directly', async () => {
    const tab = await openTab(server.url(BANK, '/article'), ARTICLE.title)
    expect(tab.capture).toMatchObject({ allowed: false, reason: 'banking', rule: 'mufg.jp' })
    const r = await t.invoke('capture.extract', { tabId: tab.id })
    expect(r).toEqual({ ok: false, error: 'blocked', reason: 'banking', detail: 'mufg.jp' })
    await t.invoke('tabs.close', { tabId: tab.id })
  })

  it("refuses hosts on the member's own blocklist and updates eligibility live", async () => {
    const tab = await openTab(server.url(NEWS, '/one'), 'Page One')
    expect(tab.capture.allowed).toBe(true)
    await t.invoke('settings.update', { userBlockedHosts: ['tiger-fixture.com'] })
    await waitForTab(t, tab.id, (x) => x.capture.reason === 'user-rule', 'eligibility updated')
    expect(await t.invoke('capture.extract', { tabId: tab.id })).toMatchObject({
      ok: false,
      error: 'blocked',
      reason: 'user-rule',
    })
    await t.invoke('settings.update', { userBlockedHosts: [] })
    await waitForTab(t, tab.id, (x) => x.capture.allowed, 'eligibility restored')
    await t.invoke('tabs.close', { tabId: tab.id })
  })

  it('reads a PDF with the tab session cookies', async () => {
    await openTab(server.url(NEWS, '/set-cookie?name=pdfauth&value=yes'), 'Cookie set')
    const tab = await t.invoke('tabs.create', { input: server.url(NEWS, '/doc.pdf') })
    await waitForTab(t, tab.id, (x) => x.url.endsWith('/doc.pdf') && !x.isLoading, 'pdf loaded')
    const r = await waitFor(async () => {
      const res = await t.invoke('capture.extract', { tabId: tab.id })
      // The viewer may still be starting; retry until the engine sees the PDF document.
      return res.ok ? res : null
    }, 20_000, 'pdf capture')
    expect(r.page.sourceType).toBe('pdf')
    expect(r.page.markdown).toContain('Quarterly report for the Tiger team')
    expect(r.page.markdown).toContain('Revenue grew in every region')
    await t.invoke('tabs.close', { tabId: tab.id })
  })

  it('maps a PDF without a text layer to no-text-layer', async () => {
    const tab = await t.invoke('tabs.create', { input: server.url(NEWS, '/scan.pdf') })
    await waitForTab(t, tab.id, (x) => x.url.endsWith('/scan.pdf') && !x.isLoading, 'scan loaded')
    const r = await waitFor(async () => {
      const res = await t.invoke('capture.extract', { tabId: tab.id })
      return !res.ok && res.error === 'no-text-layer' ? res : null
    }, 20_000, 'no-text-layer')
    expect(r).toMatchObject({ ok: false, error: 'no-text-layer', reason: null })
    await t.invoke('tabs.close', { tabId: tab.id })
  })

  it('refuses every tab of a private window', async () => {
    const before = t.uiPages().length
    await t.invoke('window.create', { private: true })
    const priv = await waitFor(() => t.uiPages()[before], 15_000, 'private window UI')
    await priv.waitForFunction(() => typeof window.tiger?.invoke === 'function')
    const state = await t.tabsState(priv)
    expect(state.privateWindow).toBe(true)
    const tab = await openTab(server.url(NEWS, '/article'), ARTICLE.title, t, priv)
    expect(tab.isPrivate).toBe(true)
    expect(tab.capture).toMatchObject({ allowed: false, reason: 'incognito' })
    expect(await t.invokeFrom(priv, 'capture.extract', { tabId: tab.id })).toMatchObject({
      ok: false,
      error: 'blocked',
      reason: 'incognito',
    })
    // A tab id from another window is not reachable from this window's UI.
    expect(await t.invoke('capture.extract', { tabId: tab.id })).toMatchObject({ ok: false, error: 'no-tab' })
    // The window closes while the call is in flight, so its reply never arrives.
    await t.invokeFrom(priv, 'window.action', { action: 'close' }).catch(() => {})
    await waitFor(() => t.uiPages().length === before, 10_000, 'private window closed')
  })
})
