import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { type Browser, chromium, type Page } from 'playwright-core'
import { createServer, type ViteDevServer } from 'vite'

/**
 * Drive the visual rig: serve the renderer with Vite, open screens in plain Chromium at 1440x900,
 * and save screenshots. Used by `pnpm rig:shots` (shots.mts) and the rig tests (rig.test.ts).
 */

export const APP_DIR = resolve(__dirname, '../..')
export const SHOTS_DIR = join(APP_DIR, 'test-results', 'rig')
export const VIEWPORT = { width: 1440, height: 900 } as const
export type RigTheme = 'light' | 'dark'

export interface Rig {
  url: string
  browser: Browser
  open(screen: string, theme: RigTheme): Promise<{ page: Page; errors: string[] }>
  shot(screen: string, theme: RigTheme): Promise<{ path: string; errors: string[] }>
  screens(): Promise<string[]>
  close(): Promise<void>
}

export async function startRig(): Promise<Rig> {
  const server: ViteDevServer = await createServer({
    configFile: join(APP_DIR, 'rig.vite.config.ts'),
    server: { port: 0, host: '127.0.0.1' },
  })
  await server.listen()
  const address = server.httpServer?.address()
  if (!address || typeof address === 'string') throw new Error('rig: no server address')
  const url = `http://127.0.0.1:${address.port}`
  const browser = await chromium.launch({ args: ['--font-render-hinting=none'] })

  const open = async (screen: string, theme: RigTheme) => {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: 'ja-JP' })
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    await page.goto(`${url}/rig.html?screen=${encodeURIComponent(screen)}&theme=${theme}`)
    await page.waitForFunction(
      () => document.documentElement.dataset.rigReady === 'true' || !!document.documentElement.dataset.rigError,
      undefined,
      { timeout: 20_000 },
    )
    const rigError = await page.evaluate(() => document.documentElement.dataset.rigError ?? null)
    if (rigError) errors.push(`rig: ${rigError}`)
    return { page, errors }
  }

  return {
    url,
    browser,
    open,
    async shot(screen, theme) {
      const { page, errors } = await open(screen, theme)
      mkdirSync(SHOTS_DIR, { recursive: true })
      const path = join(SHOTS_DIR, `${screen.replace(/\//g, '__')}.${theme}.png`)
      await page.screenshot({ path, fullPage: false })
      await page.close()
      return { path, errors }
    },
    async screens() {
      const page = await browser.newPage()
      await page.goto(`${url}/rig.html?screen=__list__`)
      await page.waitForFunction(() => !!window.__rig)
      const names = await page.evaluate(() => window.__rig?.screens ?? [])
      await page.close()
      return names
    },
    async close() {
      await browser.close()
      await server.close()
    },
  }
}
