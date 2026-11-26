import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Download, PermissionRequest, Rect } from '@tiger/shared'
import type { Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launch, removeDir, type TigerApp, tempDir, waitFor, waitForTab } from './app'
import { DOWNLOAD_CONTENT, type FixtureServer, startFixtureServer } from './fixtures'
import { xClick } from './xtest'

let server: FixtureServer
let t: TigerApp
let dir: string
const url = (path: string) => server.url('127.0.0.1', path)

beforeAll(async () => {
  server = await startFixtureServer()
  dir = tempDir('interact')
  t = await launch({ userDataDir: dir })
  // Collect every engine event the UI receives, for the assertions below.
  await t.ui.evaluate(() => {
    const w = window as unknown as { __events: { name: string; payload: unknown }[] }
    w.__events = []
    for (const name of ['permission.request', 'downloads.changed', 'shortcut'] as const) {
      window.tiger.on(name, (payload: unknown) => w.__events.push({ name, payload }))
    }
  })
})
afterAll(async () => {
  await t?.close()
  await server?.close()
  removeDir(dir)
})

const events = <T>(name: string) =>
  t.ui.evaluate(
    (n) =>
      (window as unknown as { __events: { name: string; payload: unknown }[] }).__events
        .filter((e) => e.name === n)
        .map((e) => e.payload),
    name,
  ) as Promise<T[]>

async function activeTabOn(path: string, title: string) {
  const s = await t.tabsState()
  const id = s.activeTabId as string
  await t.invoke('tabs.navigate', { tabId: id, input: url(path) })
  await waitForTab(t, id, (x) => x.title === title && !x.isLoading, title)
  return { id, page: await t.tabPage((u) => u === url(path)) }
}

describe('overlay and page layout', () => {
  let page: Page
  let overlay: Page
  let slot: Rect
  let origin: { x: number; y: number }
  const at = (dx: number, dy: number) => xClick(origin.x + slot.x + dx, origin.y + slot.y + dy)
  const pageClicks = () => page.evaluate(() => (window as unknown as { __clicks: number }).__clicks)
  const overlayClicks = async () => Number(await overlay.textContent('[data-testid="overlay-clicks"]'))

  beforeAll(async () => {
    ;({ page } = await activeTabOn('/clicks', 'Clicks'))
    overlay = await waitFor(() => t.app.windows().find((p) => p.url().endsWith('#overlay')), 10_000, 'overlay view')
    slot = await t.ui.evaluate(() => {
      const r = (document.querySelector('.page-slot') as HTMLElement).getBoundingClientRect()
      return { x: r.left, y: r.top, width: r.width, height: r.height }
    })
    origin = await t.app.evaluate(({ BaseWindow }) => {
      const b = BaseWindow.getAllWindows()[0]?.getContentBounds()
      return { x: b?.x ?? 0, y: b?.y ?? 0 }
    })
  })

  it('places the page view at the rectangle the UI reports', async () => {
    const bounds = await t.app.evaluate(({ BaseWindow }) => {
      const win = BaseWindow.getAllWindows()[0]
      // Children: UI view first, overlay last; the visible tab view sits between them.
      const views = win?.contentView.children ?? []
      const tab = views.slice(1, -1).find((v) => v.getVisible())
      return tab?.getBounds() ?? null
    })
    expect(bounds).toEqual({
      x: Math.round(slot.x),
      y: Math.round(slot.y),
      width: Math.round(slot.x + slot.width) - Math.round(slot.x),
      height: Math.round(slot.y + slot.height) - Math.round(slot.y),
    })
  })

  it('closed overlay: the page receives clicks', async () => {
    await at(100, 100)
    await waitFor(async () => (await pageClicks()) === 1, 5_000, 'page click')
  })

  it('open overlay takes clicks inside its bounds; the page still gets clicks around it', async () => {
    await t.invoke('overlay.setOpen', {
      open: true,
      bounds: { x: slot.x + 24, y: slot.y + 24, width: 320, height: 180 },
    })
    await at(100, 100)
    await waitFor(async () => (await overlayClicks()) === 1, 5_000, 'overlay click')
    expect(await pageClicks()).toBe(1)
    await at(600, 400)
    await waitFor(async () => (await pageClicks()) === 2, 5_000, 'page click beside the overlay')
    expect(await overlayClicks()).toBe(1)
  })

  it('a full-window overlay takes every click', async () => {
    await t.invoke('overlay.setOpen', { open: true, bounds: null })
    await at(600, 400)
    await waitFor(async () => (await overlayClicks()) === 2, 5_000, 'full overlay click')
    expect(await pageClicks()).toBe(2)
  })

  it('after closing, the page receives the same clicks again', async () => {
    await t.invoke('overlay.setOpen', { open: false })
    await at(100, 100)
    await waitFor(async () => (await pageClicks()) === 3, 5_000, 'page click after close')
    expect(await overlayClicks()).toBe(2)
  })

  it('null bounds hide the page view', async () => {
    await t.invoke('page.setBounds', { bounds: null, cornerRadius: 0 })
    const visible = await t.app.evaluate(({ BaseWindow }) =>
      (BaseWindow.getAllWindows()[0]?.contentView.children ?? []).slice(1, -1).some((v) => v.getVisible()),
    )
    expect(visible).toBe(false)
    await at(100, 100)
    await new Promise((r) => setTimeout(r, 500))
    expect(await pageClicks()).toBe(3)
    await t.invoke('page.setBounds', { bounds: slot, cornerRadius: 8 })
  })
})

describe('downloads', () => {
  it('saves a download into the downloads folder and reports it', async () => {
    const { page } = await activeTabOn('/download-page', 'Downloads')
    await page.click('#dl')
    const done = await waitFor(async () => {
      const list = await t.invoke('downloads.list')
      return list.find((d) => d.filename === 'tiger-fixture.txt' && d.state === 'completed') ?? null
    }, 15_000, 'download completed')
    expect(done.savePath).toBe(join(dir, 'Downloads', 'tiger-fixture.txt'))
    expect(done.receivedBytes).toBe(Buffer.byteLength(DOWNLOAD_CONTENT))
    expect(readFileSync(done.savePath as string, 'utf8')).toBe(DOWNLOAD_CONTENT)
    const seen = await events<Download[]>('downloads.changed')
    expect(seen.some((list) => list.some((d) => d.id === done.id && d.state === 'completed'))).toBe(true)
  })

  it('cancels a running download', async () => {
    const s = await t.tabsState()
    await t.invoke('tabs.navigate', { tabId: s.activeTabId as string, input: url('/slow.bin') })
    const running = await waitFor(async () => {
      const list = await t.invoke('downloads.list')
      return list.find((d) => d.filename === 'slow.bin' && d.state === 'progressing') ?? null
    }, 15_000, 'download running')
    await t.invoke('downloads.cancel', { id: running.id })
    await waitFor(async () => {
      const list = await t.invoke('downloads.list')
      return list.find((d) => d.id === running.id && d.state === 'cancelled') ?? null
    }, 10_000, 'download cancelled')
    expect(existsSync(running.savePath as string)).toBe(false)
    await t.invoke('downloads.clear')
    expect(await t.invoke('downloads.list')).toEqual([])
  })
})

describe('permissions', () => {
  it('asks the UI and honours an allow that is remembered', async () => {
    const { id, page } = await activeTabOn('/perm', 'Permissions')
    expect(await page.evaluate(() => Notification.permission)).toBe('default')
    await page.evaluate(() => {
      const w = window as unknown as { __perm: Promise<string> }
      w.__perm = Notification.requestPermission()
    })
    const req = await waitFor(async () => {
      const list = await events<PermissionRequest>('permission.request')
      return list.find((r) => r.permission === 'notifications') ?? null
    }, 10_000, 'permission.request')
    expect(req).toMatchObject({ tabId: id, origin: `http://127.0.0.1:${server.port}` })
    await t.invoke('permission.respond', { requestId: req.requestId, allow: true, remember: true })
    expect(await page.evaluate(() => (window as unknown as { __perm: Promise<string> }).__perm)).toBe('granted')

    // Remembered: a reload reports granted and asking again does not prompt.
    await t.invoke('tabs.reload', { tabId: id })
    await waitForTab(t, id, (x) => !x.isLoading, 'reloaded')
    const again = await t.tabPage((u) => u === url('/perm'))
    expect(await again.evaluate(() => Notification.permission)).toBe('granted')
    expect(await again.evaluate(() => Notification.requestPermission())).toBe('granted')
    expect((await events<PermissionRequest>('permission.request')).filter((r) => r.permission === 'notifications')).toHaveLength(1)
  })

  it('honours a deny', async () => {
    const page = await t.tabPage((u) => u === url('/perm'))
    const result = page.evaluate(
      () =>
        new Promise<number>((resolve) =>
          navigator.geolocation.getCurrentPosition(
            () => resolve(0),
            (err) => resolve(err.code),
          ),
        ),
    )
    const req = await waitFor(async () => {
      const list = await events<PermissionRequest>('permission.request')
      return list.find((r) => r.permission === 'geolocation') ?? null
    }, 10_000, 'geolocation request')
    await t.invoke('permission.respond', { requestId: req.requestId, allow: false, remember: false })
    // 1 is PERMISSION_DENIED.
    expect(await result).toBe(1)
  })

  it('denies unlisted permissions without asking', async () => {
    const page = await t.tabPage((u) => u === url('/perm'))
    const midi = await page.evaluate(() =>
      navigator.requestMIDIAccess().then(
        () => 'granted',
        (e: Error) => e.name,
      ),
    )
    expect(midi).not.toBe('granted')
    const asked = await events<PermissionRequest>('permission.request')
    expect(asked.map((r) => r.permission).sort()).toEqual(['geolocation', 'notifications'])
  })
})

describe('menus, clipboard and export', () => {
  it('application menu accelerators emit shortcut events', async () => {
    await t.app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('shortcut:toggle-command')
      ;(item?.click as unknown as () => void)()
    })
    await waitFor(async () => {
      const list = await events<{ action: string }>('shortcut')
      return list.some((e) => e.action === 'toggle-command')
    }, 5_000, 'shortcut event')
  })

  it('writes text to the clipboard', async () => {
    await t.invoke('clipboard.writeText', { text: 'タイガー clipboard' })
    expect(await t.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('タイガー clipboard')
  })

  it('saves Markdown to the file the member picks', async () => {
    const target = join(dir, 'export.md')
    await t.app.evaluate(({ dialog }, path) => {
      // Stand-in for the native save dialog, which cannot be driven under Xvfb.
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog
    }, target)
    const r = await t.invoke('export.saveFile', { suggestedName: 'Notes', content: '# Notes\n', extension: 'md' })
    expect(r).toEqual({ path: target })
    expect(readFileSync(target, 'utf8')).toBe('# Notes\n')
  })
})
