import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { canonicalUrl } from '@tiger/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launch, removeDir, type TigerApp, tempDir, waitFor, waitForTab } from './app'
import type { LoggedRequest } from './server-process.mts'

/**
 * The MVP flow, by hand, in the real app: the developer harness drives @tiger/client through
 * window.tiger, against a real server process (tiger_test, mock provider, hash embedder) and a local
 * fixture site. The server's request log (a recording proxy in front of it) is then checked for what
 * left the machine.
 */

const APP_DIR = join(__dirname, '../..')

// Public-looking names for the fixture site: loopback hosts are never capturable.
const NEWS = 'news.tiger-e2e.jp'
const MEMO = 'memo.tiger-e2e.jp'
const SECRET = 'naisho.tiger-e2e.jp'

const ARTICLE_TITLE = '春の新製品発表について'
const ARTICLE_PARAS = [
  '株式会社タイガーは本日、チーム向けの新しいブラウザを四月に発売すると発表しました。',
  '新製品は、メンバーが明示的に共有したページだけを、チームの共有コンテキストとして扱います。',
  '価格は一人あたり月額千二百円で、最初の三十日間は無料で試すことができます。',
  '発表会では、銀行やメールのページは決して共有されない仕組みも紹介されました。',
]
const MEMO_TITLE = '個人メモ:価格の検討'
const MEMO_PARAS = [
  'これは自分だけの下書きで、スペースには共有しない内容です。',
  '競合製品の価格は月額千五百円前後で、こちらの方が少し安い設定になっています。',
  '来週の会議までに、法人向けの割引案を三つ用意しておく必要があります。',
]
const SECRET_TITLE = '誰にも見せないページ'
const SECRET_PARA =
  'この秘密のページの内容と住所は、どこにも送られてはいけません。合言葉はうぐいす餅です。'

const page = (title: string, paras: string[]) =>
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${title}</title></head><body>
   <header><nav><a href="/">トップ</a> <a href="/about">会社概要</a></nav></header>
   <main><article><h1>${title}</h1>${paras.map((p) => `<p>${p}</p>`).join('\n')}</article></main>
   <footer>Copyright フッター</footer></body></html>`

let fixture: Server
let fixturePort = 0
let serverProc: ChildProcess
let proxyUrl = ''
let directUrl = ''
let t: TigerApp
let dir: string
let logFile = ''

const url = (host: string, path: string) => `http://${host}:${fixturePort}${path}`
const ARTICLE_URL = () => url(NEWS, '/kiji/haru?ref=top')
const MEMO_URL = () => url(MEMO, '/memo/kakaku')
const SECRET_URL = () => url(SECRET, '/himitsu/page?user=tanaka')

beforeAll(async () => {
  fixture = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0]
    const body =
      path === '/kiji/haru'
        ? page(ARTICLE_TITLE, ARTICLE_PARAS)
        : path === '/memo/kakaku'
          ? page(MEMO_TITLE, MEMO_PARAS)
          : path === '/himitsu/page'
            ? page(SECRET_TITLE, [SECRET_PARA, SECRET_PARA])
            : path === '/link'
              ? `<!doctype html><html><head><meta charset="utf-8"><title>招待リンク</title></head><body><a id="go" href="${new URL(req.url ?? '', 'http://x').searchParams.get('to') ?? ''}">参加する</a></body></html>`
              : null
    if (!body) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body)
  })
  await new Promise<void>((r) => fixture.listen(0, '127.0.0.1', r))
  fixturePort = (fixture.address() as AddressInfo).port

  dir = tempDir('mvp')
  logFile = join(dir, 'requests.jsonl')
  serverProc = spawn(join(APP_DIR, 'node_modules/.bin/tsx'), ['test/e2e/server-process.mts'], {
    cwd: APP_DIR,
    env: { ...process.env, TIGER_E2E_REQUEST_LOG: logFile },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const ready = await new Promise<{ proxyUrl: string; directUrl: string }>((resolve, reject) => {
    let out = ''
    const timer = setTimeout(() => reject(new Error('server process did not start')), 45_000)
    serverProc.stdout?.on('data', (c: Buffer) => {
      out += c.toString()
      const line = out.split('\n').find((l) => l.startsWith('{'))
      if (line) {
        clearTimeout(timer)
        resolve(JSON.parse(line))
      }
    })
    serverProc.on('exit', (code) => reject(new Error(`server process exited with ${code}`)))
  })
  proxyUrl = ready.proxyUrl
  directUrl = ready.directUrl

  t = await launch({
    userDataDir: join(dir, 'profile'),
    args: [
      `--host-resolver-rules=MAP ${NEWS} 127.0.0.1, MAP ${MEMO} 127.0.0.1, MAP ${SECRET} 127.0.0.1`,
    ],
    env: { TIGER_SERVER_URL: proxyUrl },
  })
}, 90_000)

afterAll(async () => {
  await t?.close()
  if (serverProc && serverProc.exitCode === null) {
    const exited = new Promise((r) => serverProc.once('exit', r))
    serverProc.kill('SIGTERM')
    await Promise.race([exited, new Promise((r) => setTimeout(r, 15_000))])
  }
  await new Promise((r) => fixture?.close(r))
  removeDir(dir)
})

const sel = (id: string) => `[data-testid="${id}"]`

async function openTab(href: string, title: string) {
  const tab = await t.invoke('tabs.create', { input: href })
  return waitForTab(t, tab.id, (x) => x.title === title && !x.isLoading, `load ${href}`)
}

async function shareState(): Promise<string | null> {
  return t.ui.getAttribute(sel('tab-share-state'), 'data-shared')
}

function readLog(): LoggedRequest[] {
  if (!existsSync(logFile)) return []
  return readFileSync(logFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LoggedRequest)
}

/** Every way a URL could appear in a request line, a JSON body or a socket frame. */
function urlForms(u: string): string[] {
  const parsed = new URL(u)
  return [
    u,
    canonicalUrl(u),
    encodeURIComponent(u),
    encodeURIComponent(canonicalUrl(u)),
    `${parsed.host}${parsed.pathname}`,
    parsed.host,
  ]
}
const carriesUrl = (r: LoggedRequest, u: string) =>
  urlForms(u).some((f) => r.url.includes(f) || r.body.includes(f))
const carriesText = (r: LoggedRequest, text: string) => {
  // JSON bodies may escape non-ASCII; compare on the decoded form too.
  const escaped = JSON.stringify(text).slice(1, -1)
  return r.body.includes(text) || r.body.includes(escaped)
}

describe('MVP flow in the real app', () => {
  let itemId = ''
  let spaceId = ''
  let previewMarkdown = ''
  let attachPreview = ''
  let spaceThreadId = ''
  let articleTabId = ''
  let memoTabId = ''

  it('signs in and creates a Space', async () => {
    await t.ui.fill(sel('dev-email'), `hanako.${Date.now()}@example.co.jp`)
    await t.ui.fill(sel('dev-name'), '花子')
    await t.ui.click(sel('dev-sign-in'))
    await t.ui.waitForSelector(sel('signed-in'), { timeout: 15_000 })
    await waitFor(
      async () => (await t.ui.textContent(sel('connection'))) === 'online',
      15_000,
      'online',
    )

    await t.ui.fill(sel('space-name'), '新製品リサーチ')
    await t.ui.click(sel('space-create'))
    await waitFor(
      async () => (await t.ui.inputValue(sel('space-select'))) !== '',
      10_000,
      'Space selected',
    )
    spaceId = await t.ui.inputValue(sel('space-select'))
  })

  it('a Japanese article opens as not shared; a secret page is open in another tab', async () => {
    await openTab(SECRET_URL(), SECRET_TITLE)
    memoTabId = (await openTab(MEMO_URL(), MEMO_TITLE)).id
    const article = await openTab(ARTICLE_URL(), ARTICLE_TITLE)
    articleTabId = article.id
    expect(article.capture.allowed).toBe(true)
    await waitFor(async () => (await shareState()) === 'false', 10_000, 'not shared')
  })

  it('shares through the preview, and the server stores exactly what the preview showed', async () => {
    await t.ui.click(sel('share-begin'))
    await t.ui.waitForSelector(sel('share-preview'), { timeout: 15_000 })
    previewMarkdown = (await t.ui.textContent(sel('share-preview-markdown'))) ?? ''
    for (const p of ARTICLE_PARAS) expect(previewMarkdown).toContain(p)
    // Nothing has been sent yet.
    expect(readLog().filter((r) => carriesText(r, ARTICLE_PARAS[0] as string))).toEqual([])

    await t.ui.click(sel('share-confirm'))
    await t.ui.waitForSelector(sel('share-done'), { timeout: 15_000 })
    await waitFor(async () => (await shareState()) === 'true', 10_000, 'shared')
    itemId = (await t.ui.getAttribute(`${sel('item')}`, 'data-item-id')) ?? ''
    expect(itemId).not.toBe('')

    const token = await t.invoke('auth.getToken')
    const res = await fetch(`${directUrl}/v1/items/${itemId}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const detail = (await res.json()) as { markdown: string; url: string; title: string }
    expect(detail.markdown).toBe(previewMarkdown)
    expect(detail.url).toBe(ARTICLE_URL())
    expect(detail.title).toBe(ARTICLE_TITLE)
    expect(await t.ui.textContent(sel('tab-share-state'))).toContain('花子')
  })

  it('asks in a Space thread and watches the streamed answer finish with a citation to the shared item', async () => {
    await t.ui.click(sel('thread-new'))
    await waitFor(
      async () => (await t.ui.textContent(sel('thread-kind'))) === 'space',
      10_000,
      'Space thread',
    )
    spaceThreadId = await t.ui.inputValue(sel('thread-select'))

    // Record the assistant text every time the DOM changes while it streams.
    await t.ui.evaluate(() => {
      const w = window as unknown as { __stream: string[] }
      w.__stream = []
      new MutationObserver(() => {
        const m = document.querySelector(
          '[data-testid="message"][data-role="assistant"][data-phase="streaming"]',
        )
        const text = m?.querySelector('[data-testid="message-text"]')?.textContent
        if (text && w.__stream.at(-1) !== text) w.__stream.push(text)
      }).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      })
    })
    expect(await t.ui.$$eval(`${sel('model-select')} option`, (o) => o.length)).toBeGreaterThan(0)
    await t.ui.fill(sel('question'), '新製品の価格と発売時期は?')
    await t.ui.click(sel('ask'))
    const answer = '[data-testid="message"][data-role="assistant"]'
    await t.ui.waitForSelector(`${answer}[data-phase="complete"]`, { timeout: 30_000 })
    const streamed = await t.ui.evaluate(
      () => (window as unknown as { __stream: string[] }).__stream,
    )
    const final = (await t.ui.textContent(`${answer} ${sel('message-text')}`)) ?? ''
    expect(streamed.length).toBeGreaterThan(2)
    for (const s of streamed) expect(final.startsWith(s)).toBe(true)
    expect(final).toContain('[1]')
    const cite = `${answer} ${sel('citation')}[data-item-id="${itemId}"]`
    expect(await t.ui.getAttribute(cite, 'data-available')).toBe('true')
    expect(await t.ui.textContent(cite)).toContain(ARTICLE_TITLE)
  })

  it('attaches the current page to a private-thread message through preview then confirm', async () => {
    await t.invoke('tabs.activate', { tabId: memoTabId })
    await waitFor(async () => (await shareState()) === 'false', 10_000, 'memo tab not shared')
    await t.ui.selectOption(sel('thread-select'), 'private')
    await t.ui.click(sel('attach-begin'))
    await t.ui.waitForSelector(sel('attach-preview'), { timeout: 15_000 })
    attachPreview = (await t.ui.textContent(sel('attach-preview-markdown'))) ?? ''
    for (const p of MEMO_PARAS) expect(attachPreview).toContain(p)
    expect(readLog().filter((r) => carriesText(r, MEMO_PARAS[0] as string))).toEqual([])
    await t.ui.click(sel('attach-confirm'))
    await t.ui.waitForSelector(sel('attachment-draft'))
    await t.ui.fill(sel('question'), 'このメモを三行でまとめて')
    await t.ui.click(sel('ask'))
    await t.ui.waitForSelector(
      '[data-testid="message"][data-role="assistant"][data-phase="complete"]',
      { timeout: 30_000 },
    )
    expect(await t.ui.textContent('[data-testid="message"][data-role="user"]')).toContain(
      MEMO_TITLE,
    )
    expect(await t.ui.$$(sel('attachment-draft'))).toHaveLength(0)
  })

  it('unshares: the tab returns to not shared and the citation is marked unavailable', async () => {
    await t.invoke('tabs.activate', { tabId: articleTabId })
    await waitFor(async () => (await shareState()) === 'true', 10_000, 'article tab shared')
    await t.ui.click(sel('item-unshare'))
    await waitFor(async () => (await shareState()) === 'false', 10_000, 'not shared again')
    await t.ui.selectOption(sel('thread-select'), spaceThreadId)
    const cite = `[data-testid="message"][data-role="assistant"] ${sel('citation')}[data-item-id="${itemId}"]`
    await waitFor(
      async () => (await t.ui.getAttribute(cite, 'data-available')) === 'false',
      10_000,
      'citation unavailable',
    )
    expect(await t.ui.$$(sel('item'))).toHaveLength(0)
  })

  it('an invite link of the configured server is handed to the UI instead of being loaded', async () => {
    // Another member, straight to the server: a Space and an invite link for it.
    const post = async (path: string, body: unknown, token?: string) => {
      const res = await fetch(`${directUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      })
      return (await res.json()) as Record<string, unknown>
    }
    const other = (await post('/v1/auth/dev', {
      email: `taro.${Date.now()}@example.co.jp`,
      name: '太郎',
    })) as {
      token: string
    }
    const space = (await post('/v1/spaces', { name: '太郎のスペース' }, other.token)) as {
      id: string
    }
    const invite = (await post(`/v1/spaces/${space.id}/invites`, {}, other.token)) as {
      url: string
      token: string
    }
    expect(invite.url.startsWith(`${proxyUrl}/invite#`)).toBe(true)

    // Typed into the address field of the current tab.
    const before = readLog().length
    const tab = (await t.tabsState()).tabs.find((x) => x.id === articleTabId)
    await t.invoke('tabs.navigate', { tabId: articleTabId, input: invite.url })
    await t.ui.waitForSelector(sel('pending-invite'), { timeout: 10_000 })
    await t.ui.click(`${sel('pending-invite')} button >> nth=1`)
    await t.ui.waitForSelector(sel('pending-invite'), { state: 'detached' })
    expect((await t.tabsState()).tabs.find((x) => x.id === articleTabId)?.url).toBe(tab?.url)

    // Clicked as a link on a page: the navigation is cancelled, the banner offers to join.
    const linkTab = await openTab(
      url(MEMO, `/link?to=${encodeURIComponent(invite.url)}`),
      '招待リンク',
    )
    const linkPage = await t.tabPage((u) => u.includes('/link?to='))
    // A real click in the page (Playwright's own click would wait for the cancelled navigation).
    await linkPage.evaluate(() => (document.getElementById('go') as HTMLAnchorElement).click())
    await t.ui.waitForSelector(sel('pending-invite'), { timeout: 10_000 })
    await new Promise((r) => setTimeout(r, 300))
    expect((await t.tabsState()).tabs.find((x) => x.id === linkTab.id)?.url).toContain('/link?to=')
    // Nothing was requested from the server for the link itself.
    expect(
      readLog()
        .slice(before)
        .some((r) => r.url.startsWith('/invite')),
    ).toBe(false)

    await t.ui.click(`${sel('pending-invite')} button >> nth=0`)
    await waitFor(
      async () =>
        (
          await t.ui.$$eval(`${sel('space-select')} option`, (o) => o.map((x) => x.textContent))
        ).includes('太郎のスペース'),
      10_000,
      'joined the other Space',
    )
    await t.invoke('tabs.close', { tabId: linkTab.id })
    expect(invite.token.length).toBeGreaterThan(10)
  })

  it('the server request log shows page content only in the share and the attachment, and never an unshared tab URL', async () => {
    const log = readLog()
    expect(log.length).toBeGreaterThan(10)
    expect(log.some((r) => r.kind === 'ws-frame')).toBe(true)

    const articleContent = log.filter((r) => ARTICLE_PARAS.some((p) => carriesText(r, p)))
    expect(articleContent.map((r) => `${r.method} ${r.url}`)).toEqual([
      `POST /v1/spaces/${spaceId}/items`,
    ])
    const memoContent = log.filter((r) => MEMO_PARAS.some((p) => carriesText(r, p)))
    expect(memoContent).toHaveLength(1)
    expect(memoContent[0]?.method).toBe('POST')
    expect(memoContent[0]?.url).toMatch(/^\/v1\/threads\/[^/]+\/messages$/)
    expect(memoContent[0]?.url).not.toContain(spaceThreadId)
    expect(JSON.parse(memoContent[0]?.body ?? '{}').attachments[0].url).toBe(MEMO_URL())

    // The shared and attached URLs left only with their explicit action; the secret tab never did.
    expect(log.filter((r) => carriesUrl(r, ARTICLE_URL()))).toEqual(articleContent)
    expect(log.filter((r) => carriesUrl(r, MEMO_URL()))).toEqual(memoContent)
    expect(log.filter((r) => carriesUrl(r, SECRET_URL()) || carriesText(r, SECRET_PARA))).toEqual(
      [],
    )
    // The per-tab share state came from the local index: a bare GET, never a lookup.
    expect(
      log.some((r) => r.url === '/v1/items/index' && r.method === 'GET' && r.body === ''),
    ).toBe(true)
    expect(log.some((r) => r.url.includes('/items/lookup'))).toBe(false)
  })
})
