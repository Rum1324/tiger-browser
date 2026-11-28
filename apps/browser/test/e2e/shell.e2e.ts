import type { Rect } from '@tiger/shared'
import type { Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launch, removeDir, type TigerApp, tempDir, waitFor, waitForTab } from './app'
import { type FixtureServer, startFixtureServer } from './fixtures'

/**
 * The product UI (not the developer harness) in the real engine: the page-slot reporter places the
 * tab view over the page card and follows layout changes; a surface hides it; the overlay protocol
 * crosses between the two views of the window over BroadcastChannel and drives overlay.setOpen.
 */
let server: FixtureServer
let t: TigerApp
let dir: string

beforeAll(async () => {
  server = await startFixtureServer()
  dir = tempDir('shell')
  t = await launch({ userDataDir: dir, env: { TIGER_UI: 'app' } })
  // First run covers everything until it is completed.
  await t.ui.locator('[data-testid="first-run-skip"]').click({ timeout: 20_000 })
  const s = await t.tabsState()
  const id = s.activeTabId as string
  await t.invoke('tabs.navigate', { tabId: id, input: server.url('127.0.0.1', '/clicks') })
  await waitForTab(t, id, (x) => x.title === 'Clicks' && !x.isLoading, 'clicks page')
})
afterAll(async () => {
  await t?.close()
  await server?.close()
  removeDir(dir)
})

const slotRect = (): Promise<Rect | null> =>
  t.ui.evaluate(() => {
    const el = document.querySelector('[data-region="page"]')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    }
  })

/** The visible tab view's bounds (children: UI view first, overlay last). */
const tabViewBounds = (): Promise<Rect | null> =>
  t.app.evaluate(({ BaseWindow }) => {
    const views = BaseWindow.getAllWindows()[0]?.contentView.children ?? []
    return (
      views
        .slice(1, -1)
        .find((v) => v.getVisible())
        ?.getBounds() ?? null
    )
  })

const overlayState = (): Promise<{ visible: boolean; bounds: Rect } | null> =>
  t.app.evaluate(({ BaseWindow }) => {
    const views = BaseWindow.getAllWindows()[0]?.contentView.children ?? []
    const o = views.at(-1)
    return o ? { visible: o.getVisible(), bounds: o.getBounds() } : null
  })

/** Run an application menu item, as its accelerator would. */
const menuShortcut = (action: string) =>
  t.app.evaluate(({ Menu }, a) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(`shortcut:${a}`)
    if (!item) throw new Error(`menu item shortcut:${a} missing`)
    ;(item.click as unknown as () => void)()
  }, action)

async function expectTabOverSlot(label: string) {
  await waitFor(
    async () => {
      const [slot, view] = await Promise.all([slotRect(), tabViewBounds()])
      return !!slot && !!view && JSON.stringify(slot) === JSON.stringify(view)
    },
    10_000,
    label,
  )
}

describe('product UI: page slot', () => {
  it('the tab view sits exactly over the page card', async () => {
    await expectTabOverSlot('tab view over the slot')
  })

  it('follows the ask panel opening and closing', async () => {
    const before = await slotRect()
    await t.ui.locator('[data-overlay-anchor="ask"]').click()
    await waitFor(
      async () => ((await slotRect())?.width ?? 0) < (before?.width ?? 0),
      5_000,
      'narrower slot',
    )
    await expectTabOverSlot('tab view follows the open panel')
    await t.ui.locator('[data-overlay-anchor="ask"]').click()
    await waitFor(
      async () => (await slotRect())?.width === before?.width,
      5_000,
      'slot back to full width',
    )
    await expectTabOverSlot('tab view follows the closed panel')
  })

  it('follows a window resize', async () => {
    const before = await slotRect()
    await t.app.evaluate(({ BaseWindow }) => {
      const w = BaseWindow.getAllWindows()[0]
      const [width, height] = w?.getContentSize() ?? [1200, 800]
      w?.setContentSize((width ?? 1200) - 120, (height ?? 800) - 60)
    })
    await waitFor(async () => (await slotRect())?.width !== before?.width, 5_000, 'slot resized')
    await expectTabOverSlot('tab view follows the resize')
  })

  it('a surface hides the page; going back shows it again', async () => {
    await menuShortcut('open-settings')
    await t.ui.locator('[data-testid="surface-settings"]').waitFor()
    await waitFor(async () => (await tabViewBounds()) === null, 5_000, 'page hidden')
    await menuShortcut('open-settings')
    await expectTabOverSlot('page shown again')
  })
})

describe('product UI: overlay protocol between the two views', () => {
  let overlay: Page

  beforeAll(async () => {
    overlay = await waitFor(
      () => t.app.windows().find((p) => p.url().endsWith('#overlay')),
      10_000,
      'overlay view',
    )
  })

  it('the command palette opens full-window in the overlay view with focus in its field', async () => {
    expect((await overlayState())?.visible).toBe(false)
    await menuShortcut('toggle-command')
    await overlay.locator('[data-testid="overlay-palette"]').waitFor({ timeout: 10_000 })
    await waitFor(async () => (await overlayState())?.visible, 5_000, 'overlay raised')
    const [o, size] = await Promise.all([
      overlayState(),
      t.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]?.getContentSize()),
    ])
    expect(o?.bounds).toMatchObject({ x: 0, y: 0, width: size?.[0], height: size?.[1] })
    expect(await overlay.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe(
      'palette-input',
    )
  })

  it('Escape in the overlay closes it and lowers the view', async () => {
    await overlay.keyboard.press('Escape')
    await waitFor(async () => (await overlayState())?.visible === false, 5_000, 'overlay lowered')
    await overlay.locator('[data-testid="overlay-palette"]').waitFor({ state: 'detached' })
  })

  it('a chosen command comes back to the main view and runs there', async () => {
    await menuShortcut('toggle-command')
    const input = overlay.locator('[data-testid="palette-input"]')
    await input.waitFor({ timeout: 10_000 })
    const tabsBefore = (await t.tabsState()).tabs.length
    // Pick the new-tab command by pressing its row.
    await overlay.locator('[data-row-kind="command"]').first().waitFor()
    const label = await t.ui.evaluate(() =>
      document.documentElement.lang === 'en' ? 'New tab' : '新しいタブ',
    )
    await input.fill(label)
    await input.press('Enter')
    await waitFor(
      async () => (await t.tabsState()).tabs.length === tabsBefore + 1,
      5_000,
      'new tab from the palette',
    )
    await waitFor(async () => (await overlayState())?.visible === false, 5_000, 'overlay lowered')
  })
})
