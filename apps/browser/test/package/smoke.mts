/**
 * Smoke test of the packaged Linux build (dist/linux-unpacked, fuses flipped, so Playwright cannot
 * drive it). It launches the binary, reaches the UI view over the DevTools protocol and checks that
 * window.tiger works and capture runs end to end (article, PDF read with the session cookie, scanned
 * PDF). Run with: pnpm test:package
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFixtureServer } from '../e2e/fixtures.ts'

const BIN = join(import.meta.dirname, '../../dist/linux-unpacked/tiger')
const PORT = 9334
const HOST = 'news.tiger-fixture.com'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function check(label: string, ok: boolean, detail: unknown): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(detail)}`)
  if (!ok) process.exitCode = 1
}

async function uiSocket(): Promise<WebSocket> {
  for (let i = 0; i < 100; i++) {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as {
        url: string
        webSocketDebuggerUrl: string
      }[]
      const ui = list.find((t) => t.url === 'tiger://ui/index.html')
      if (ui) {
        const ws = new WebSocket(ui.webSocketDebuggerUrl)
        await new Promise((r) => ws.addEventListener('open', r))
        return ws
      }
    } catch {
      // Not listening yet.
    }
    await sleep(200)
  }
  throw new Error('the UI view never appeared')
}

const server = await startFixtureServer()
const profile = mkdtempSync(join(tmpdir(), 'tiger-package-'))
let child: ChildProcess | null = null
try {
  // Root in a container: Chromium needs --no-sandbox, and TIGER_NO_SANDBOX keeps the app from
  // re-enabling the sandbox for its child processes.
  child = spawn(
    BIN,
    [
      '--no-sandbox',
      `--remote-debugging-port=${PORT}`,
      `--host-resolver-rules=MAP ${HOST} 127.0.0.1`,
    ],
    {
      env: { ...process.env, TIGER_NO_SANDBOX: '1', TIGER_USER_DATA_DIR: profile },
      stdio: 'ignore',
    },
  )
  const ws = await uiSocket()
  let id = 0
  const evaluate = (expression: string) =>
    new Promise<unknown>((resolve) => {
      const my = ++id
      ws.addEventListener('message', function on(ev) {
        const msg = JSON.parse(String(ev.data))
        if (msg.id !== my) return
        ws.removeEventListener('message', on)
        resolve(msg.result?.result?.value ?? null)
      })
      ws.send(
        JSON.stringify({
          id: my,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      )
    })
  const base = `http://${HOST}:${server.port}`
  const capture = async (path: string) => {
    const tabId = await evaluate(
      `window.tiger.invoke('tabs.create', { input: '${base}${path}' }).then((t) => t.id)`,
    )
    for (let i = 0; i < 50; i++) {
      const loading = await evaluate(
        `window.tiger.invoke('tabs.get').then((s) => s.tabs.find((t) => t.id === '${tabId}')?.isLoading ?? true)`,
      )
      if (loading === false) break
      await sleep(200)
    }
    await sleep(500)
    return evaluate(`window.tiger.invoke('capture.extract', { tabId: '${tabId}' })`) as Promise<{
      ok: boolean
      error?: string
      page?: { sourceType: string; markdown: string }
    }>
  }

  for (let i = 0; i < 50 && (await evaluate('typeof window.tiger?.invoke')) !== 'function'; i++) {
    await sleep(200)
  }
  const info = (await evaluate(`window.tiger.invoke('app.info')`)) as {
    engine: string
    engineVersion: string
  }
  check('bridge and app.info', info?.engine === 'electron', info)
  const article = await capture('/article')
  check(
    'article capture',
    article.ok && article.page?.markdown.includes('Tiger reads the article') === true,
    article.page?.markdown.slice(0, 60),
  )
  await capture('/set-cookie?name=pdfauth&value=yes')
  const pdf = await capture('/doc.pdf')
  check(
    'PDF capture',
    pdf.ok && pdf.page?.sourceType === 'pdf' && pdf.page.markdown.includes('Quarterly report'),
    pdf.page?.markdown.slice(0, 60),
  )
  const scan = await capture('/scan.pdf')
  check('scanned PDF', !scan.ok && scan.error === 'no-text-layer', scan.error)
  ws.close()
} finally {
  if (child && child.exitCode === null) {
    const exited = new Promise((r) => child?.once('exit', r))
    child.kill()
    await exited
  }
  await server.close()
  rmSync(profile, { recursive: true, force: true })
}
