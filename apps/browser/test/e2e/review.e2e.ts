import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { Rect } from '@tiger/shared'
import type { Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launch, removeDir, type TigerApp, tempDir, waitFor, waitForTab } from './app'
import { type FixtureServer, startFixtureServer } from './fixtures'

/**
 * DESIGN.md section 15 in the real engine with the product UI: the window minimum, the
 * focus-region accelerator handing focus to the page view and taking it back, menus on a
 * full-window overlay, and `tiger://invite/<token>` arriving from a second launch or a page.
 */
const require = createRequire(import.meta.url)
const ELECTRON = require('electron') as unknown as string
const APP_DIR = join(__dirname, '../..')
const TOKEN = 'e2e-invite-token-0123456789abcdef'

let server: FixtureServer
let t: TigerApp
let dir: string
let overlay: Page

beforeAll(async () => {
  server = await startFixtureServer()
  dir = tempDir('review')
  t = await launch({ userDataDir: dir, env: { TIGER_UI: 'app' } })
  await t.ui.locator('[data-testid="first-run-skip"]').click({ timeout: 20_000 })
  const s = await t.tabsState()
  const id = s.activeTabId as string
  await t.invoke('tabs.navigate', { tabId: id, input: server.url('127.0.0.1', '/clicks') })
  await waitForTab(t, id, (x) => x.title === 'Clicks' && !x.isLoading, 'clicks page')
  overlay = await waitFor(
    () => t.app.windows().find((p) => p.url().endsWith('#overlay')),
    10_000,
    'overlay view',
  )
})
afterAll(async () => {
  await t?.close()
  await server?.close()
  removeDir(dir)
})

const menuShortcut = (action: string) =>
  t.app.evaluate(({ Menu }, a) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(`shortcut:${a}`)
    if (!item) throw new Error(`menu item shortcut:${a} missing`)
    ;(item.click as unknown as () => void)()
  }, action)

const overlayState = (): Promise<{ visible: boolean; bounds: Rect } | null> =>
  t.app.evaluate(({ BaseWindow }) => {
    const o = BaseWindow.getAllWindows()[0]?.contentView.children.at(-1)
    return o ? { visible: o.getVisible(), bounds: o.getBounds() } : null
  })

/** The URL of the webContents that has keyboard focus. */
const focusedUrl = () =>
  t.app.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL() ?? null)

const uiRegion = () =>
  t.ui.evaluate(
    () => document.activeElement?.closest('[data-region]')?.getAttribute('data-region') ?? null,
  )

describe('window', () => {
  it('cannot be made smaller than 960 x 600', async () => {
    const min = await t.app.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows()[0]?.getMinimumSize(),
    )
    expect(min).toEqual([960, 600])
  })
})

describe('focus-next-region (F6)', () => {
  it('reaches the renderer from the menu accelerator and cycles sidebar, toolbar, page and back', async () => {
    const accelerator = await t.app.evaluate(
      ({ Menu }) =>
        Menu.getApplicationMenu()?.getMenuItemById('shortcut:focus-next-region')?.accelerator,
    )
    expect(accelerator).toBe('F6')
    // Start from the UI view.
    await t.ui.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await menuShortcut('focus-next-region')
    await waitFor(async () => (await uiRegion()) === 'sidebar', 5_000, 'sidebar focused')
    await menuShortcut('focus-next-region')
    await waitFor(async () => (await uiRegion()) === 'toolbar', 5_000, 'toolbar focused')
    await menuShortcut('focus-next-region')
    await waitFor(
      async () => (await focusedUrl())?.endsWith('/clicks'),
      5_000,
      'the page view has the keyboard',
    )
    // Out of the page again: the engine gives the keyboard back to the UI, which moves on.
    await menuShortcut('focus-next-region')
    await waitFor(
      async () =>
        (await focusedUrl())?.startsWith('tiger://ui/') && (await uiRegion()) === 'sidebar',
      5_000,
      'focus taken back from the page',
    )
  })
})

describe('overlay rules', () => {
  it('a popover raises the overlay over the whole window; a click outside closes it', async () => {
    await menuShortcut('open-downloads')
    await overlay.locator('[data-surface-name="downloads"]').waitFor({ timeout: 10_000 })
    await waitFor(async () => (await overlayState())?.visible, 5_000, 'overlay raised')
    const [o, size] = await Promise.all([
      overlayState(),
      t.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]?.getContentSize()),
    ])
    expect(o?.bounds).toMatchObject({ x: 0, y: 0, width: size?.[0], height: size?.[1] })
    expect(await overlay.locator('[data-overlay-backdrop]').count()).toBe(1)
    await overlay.mouse.click(20, (size?.[1] ?? 600) - 20)
    await waitFor(async () => (await overlayState())?.visible === false, 5_000, 'overlay lowered')
  })
})

describe('tiger://invite/<token>', () => {
  it('a second launch with the link opens the accept dialog in the running app', async () => {
    const second = spawn(ELECTRON, [APP_DIR, '--no-sandbox', `tiger://invite/${TOKEN}`], {
      cwd: APP_DIR,
      env: {
        ...process.env,
        TIGER_NO_SANDBOX: '1',
        TIGER_USER_DATA_DIR: dir,
        TIGER_UI: 'app',
        ELECTRON_RENDERER_URL: '',
      },
      stdio: 'ignore',
    })
    // The second process finds the first holding the lock, hands over its arguments and quits.
    const code = await new Promise<number | null>((resolve) => second.on('exit', resolve))
    expect(code).toBe(0)
    const dialog = overlay.locator('[data-surface-name="invite"]')
    await dialog.waitFor({ timeout: 10_000 })
    await waitFor(async () => (await overlayState())?.visible, 5_000, 'overlay raised')
    // Only one window: the link went to the running one.
    expect(t.uiPages()).toHaveLength(1)
    await overlay.keyboard.press('Escape')
    await waitFor(async () => (await overlayState())?.visible === false, 5_000, 'dialog closed')
  })

  it('a page navigating to the link only opens the same dialog; the tab stays', async () => {
    const page = await t.tabPage((u) => u.endsWith('/clicks'))
    await page.evaluate((token) => {
      location.href = `tiger://invite/${token}`
    }, `${TOKEN}-page`)
    await overlay.locator('[data-surface-name="invite"]').waitFor({ timeout: 10_000 })
    const s = await t.tabsState()
    expect(s.tabs.find((x) => x.id === s.activeTabId)?.url).toBe(server.url('127.0.0.1', '/clicks'))
    // Nothing was joined: the dialog waits for the member, and Escape puts the offer aside.
    await overlay.keyboard.press('Escape')
    await waitFor(async () => (await overlayState())?.visible === false, 5_000, 'dialog closed')
  })
})
