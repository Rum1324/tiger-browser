import type { PermissionRequest } from '@tiger/shared'
import { ShortcutAction } from '@tiger/shared'
import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it } from 'vitest'
import { AppLinks, type InviteTarget } from '../../src/main/app-links'
import { inviteTokenFromAppLink, inviteTokenFromArgv } from '../../src/main/invite'
import { appMenuTemplate, shortcutItems, syncMenuState } from '../../src/main/menus'
import { PermissionBroker } from '../../src/main/permission-broker'
import { openDatabase } from '../../src/main/store/db'
import { ForgetfulPermissionStore, PermissionStore } from '../../src/main/store/permissions'
import { createEventHub } from '../../src/preload/events'

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde'

describe('remembered permissions: list and revoke', () => {
  it('lists newest first and revoking deletes exactly that decision', () => {
    let t = Date.parse('2026-11-20T10:00:00.000Z')
    const store = new PermissionStore(openDatabase(':memory:'), () => {
      t += 1000
      return new Date(t)
    })
    store.set('https://a.example', 'camera', true)
    store.set('https://b.example', 'notifications', false)
    store.set('https://a.example', 'geolocation', true)
    expect(store.list()).toEqual([
      {
        origin: 'https://a.example',
        permission: 'geolocation',
        allow: true,
        decidedAt: '2026-11-20T10:00:03.000Z',
      },
      {
        origin: 'https://b.example',
        permission: 'notifications',
        allow: false,
        decidedAt: '2026-11-20T10:00:02.000Z',
      },
      {
        origin: 'https://a.example',
        permission: 'camera',
        allow: true,
        decidedAt: '2026-11-20T10:00:01.000Z',
      },
    ])
    store.revoke('https://a.example', 'camera')
    expect(store.get('https://a.example', 'camera')).toBeUndefined()
    expect(store.get('https://a.example', 'geolocation')).toBe(true)
    expect(store.list().map((p) => p.permission)).toEqual(['geolocation', 'notifications'])
  })

  it('revoking makes the site ask again, even straight after the answer', async () => {
    const sent: PermissionRequest[] = []
    const broker = new PermissionBroker(
      (_w, r) => sent.push(r),
      () => 0,
    )
    const decisions = new PermissionStore(openDatabase(':memory:'))
    const ask = () =>
      broker.ask({
        tabId: 't1',
        windowId: 'w1',
        origin: 'https://a.example',
        permission: 'geolocation',
        decisions,
      })
    const first = ask()
    broker.respond(sent[0]?.requestId as string, true, true, 'w1')
    expect(await first).toBe(true)
    expect(await ask()).toBe(true)
    expect(sent).toHaveLength(1)

    decisions.revoke('https://a.example', 'geolocation')
    broker.forget('https://a.example', 'geolocation')
    const again = ask()
    expect(sent).toHaveLength(2)
    broker.respond(sent[1]?.requestId as string, false, false, 'w1')
    expect(await again).toBe(false)
  })

  it('a private window remembers nothing: "remember" is ignored and nothing is listed', async () => {
    let now = 0
    const sent: PermissionRequest[] = []
    const broker = new PermissionBroker(
      (_w, r) => sent.push(r),
      () => now,
    )
    const decisions = new ForgetfulPermissionStore()
    const ask = () =>
      broker.ask({
        tabId: 't1',
        windowId: 'w1',
        origin: 'https://a.example',
        permission: 'notifications',
        decisions,
      })
    const first = ask()
    broker.respond(sent[0]?.requestId as string, true, true, 'w1')
    expect(await first).toBe(true)
    now += 60_000
    void ask()
    expect(sent).toHaveLength(2)
    expect(decisions.list()).toEqual([])
    expect(decisions.get('https://a.example', 'notifications')).toBeUndefined()
  })
})

describe('application menu: the new shortcut actions', () => {
  const flat = (t: MenuItemConstructorOptions[]) =>
    t.flatMap((m) => (Array.isArray(m.submenu) ? m.submenu : []))

  it('binds the accelerators of DESIGN.md 15.3 item 16 and emits each action', () => {
    const want = {
      'find-next': 'CmdOrCtrl+G',
      'find-previous': 'CmdOrCtrl+Shift+G',
      reload: 'CmdOrCtrl+R',
      'reload-hard': 'CmdOrCtrl+Shift+R',
      'confirm-sheet': 'CmdOrCtrl+Enter',
      'focus-next-region': 'F6',
    } as const
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const fired: string[] = []
      const noop = () => {}
      const items = flat(
        appMenuTemplate(platform, {
          shortcut: (a) => fired.push(a),
          back: noop,
          forward: noop,
          zoom: noop,
          toggleDevTools: noop,
          toggleFullscreen: noop,
        }),
      )
      for (const [action, accelerator] of Object.entries(want)) {
        const item = items.find((i) => i.id === `shortcut:${action}`)
        expect(item?.accelerator, `${platform} ${action}`).toBe(accelerator)
        ;(item?.click as (() => void) | undefined)?.()
      }
      expect(fired).toEqual(Object.keys(want))
      // Reload is the renderer's to decide now: no menu item reloads on its own.
      expect(items.some((i) => i.id === 'reload' || i.id === 'force-reload')).toBe(false)
      // ⌘↵ is off until a sheet covers the window, so a page's own ⌘↵ still works.
      expect(items.find((i) => i.id === 'shortcut:confirm-sheet')?.enabled).toBe(false)
    }
  })

  it('macOS also moves between regions with ⌃⌘→, through a hidden twin item', () => {
    const fired: string[] = []
    const noop = () => {}
    const items = flat(
      appMenuTemplate('darwin', {
        shortcut: (a) => fired.push(a),
        back: noop,
        forward: noop,
        zoom: noop,
        toggleDevTools: noop,
        toggleFullscreen: noop,
      }),
    )
    const twin = items.find((i) => i.id === 'shortcut:focus-next-region:alternate')
    expect(twin).toMatchObject({ accelerator: 'Ctrl+Cmd+Right', visible: false })
    ;(twin?.click as (() => void) | undefined)?.()
    expect(fired).toEqual(['focus-next-region'])
    expect(shortcutItems('linux').find((s) => s.action === 'focus-next-region')?.alternate).toBe(
      undefined,
    )
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const all = shortcutItems(platform).flatMap((s) =>
        s.alternate ? [s.accelerator, s.alternate] : [s.accelerator],
      )
      expect(new Set(all).size).toBe(all.length)
      expect(shortcutItems(platform)).toHaveLength(ShortcutAction.options.length)
    }
  })

  it('syncMenuState enables confirm-sheet only while a full-window surface is open', () => {
    const item = { enabled: false }
    const menu = {
      getMenuItemById: (id: string) => (id === 'shortcut:confirm-sheet' ? item : null),
    }
    syncMenuState(menu, { modalOverlayOpen: true })
    expect(item.enabled).toBe(true)
    syncMenuState(menu, { modalOverlayOpen: false })
    expect(item.enabled).toBe(false)
    expect(() => syncMenuState(null, { modalOverlayOpen: true })).not.toThrow()
  })
})

describe('tiger://invite/<token>: the OS-level invite link', () => {
  it('accepts exactly tiger://invite/<token>', () => {
    expect(inviteTokenFromAppLink(`tiger://invite/${TOKEN}`)).toBe(TOKEN)
    expect(inviteTokenFromAppLink(`tiger://invite/${TOKEN}/`)).toBe(TOKEN)
    for (const bad of [
      `tiger://ui/index.html`,
      `tiger://ui/invite/${TOKEN}`,
      `tiger://invite/`,
      `tiger://invite/short`,
      `tiger://invite/${TOKEN}/extra`,
      `tiger://invite/${TOKEN}?auto=1`,
      `tiger://invite/${TOKEN}#x`,
      `tiger://user:pw@invite/${TOKEN}`,
      `tiger://invite:8080/${TOKEN}`,
      `tiger://invite/${TOKEN.slice(0, 12)}%20${TOKEN.slice(12)}`,
      `https://invite/${TOKEN}`,
      `tiger:invite/${TOKEN}`,
      `tiger://invite/${'a'.repeat(3000)}`,
      'not a url',
    ]) {
      expect(inviteTokenFromAppLink(bad), bad).toBeNull()
    }
  })

  it('finds the link among launch arguments and ignores switches and paths', () => {
    expect(
      inviteTokenFromArgv([
        '/opt/Tiger/tiger',
        '--no-sandbox',
        '/home/me/tiger',
        `tiger://invite/${TOKEN}`,
      ]),
    ).toBe(TOKEN)
    expect(inviteTokenFromArgv(['/opt/Tiger/tiger', 'tiger://ui/index.html'])).toBeNull()
    expect(inviteTokenFromArgv(['electron', '.', `--x=tiger://invite/${TOKEN}`])).toBeNull()
  })

  function fakeWindow(name: string, log: string[]): InviteTarget & { load(): void } {
    const waiting: (() => void)[] = []
    let loaded = false
    return {
      focus: () => log.push(`${name} focus`),
      whenUiLoaded: (fn) => (loaded ? fn() : waiting.push(fn)),
      emit: (event, payload) => log.push(`${name} ${event} ${payload.token}`),
      load() {
        loaded = true
        for (const fn of waiting.splice(0)) fn()
      },
    }
  }

  it('waits for the app and the UI, then offers the invite to the focused window', () => {
    const log: string[] = []
    const win = fakeWindow('w1', log)
    const links = new AppLinks({ focused: () => win, open: () => win })
    expect(links.openArgv(['tiger', `tiger://invite/${TOKEN}`])).toBe(true)
    expect(log).toEqual([])
    links.start()
    expect(log).toEqual(['w1 focus'])
    win.load()
    expect(log).toEqual(['w1 focus', `w1 invite.open ${TOKEN}`])
  })

  it('a second launch or open-url opens a window when none is open; invalid links do nothing', () => {
    const log: string[] = []
    let opened: (InviteTarget & { load(): void }) | null = null
    const links = new AppLinks({
      focused: () => opened,
      open: () => {
        opened = fakeWindow('new', log)
        opened.load()
        return opened
      },
    })
    links.start()
    expect(links.openUrl('tiger://invite/short')).toBe(false)
    expect(links.openArgv(['tiger', '--flag'])).toBe(false)
    expect(log).toEqual([])
    expect(links.openUrl(`tiger://invite/${TOKEN}`)).toBe(true)
    expect(log).toEqual(['new focus', `new invite.open ${TOKEN}`])
  })
})

describe('UI preload: an invite offer is not lost while the UI starts', () => {
  it('holds invite.open until the first listener, then hands it over once', async () => {
    const hub = createEventHub()
    hub.dispatch('invite.open', { token: 'early' })
    hub.dispatch('tabs.changed', { early: true })
    const got: unknown[] = []
    hub.on('tabs.changed', (p) => got.push(['tabs', p]))
    hub.on('invite.open', (p) => got.push(['invite', p]))
    await Promise.resolve()
    expect(got).toEqual([['invite', { token: 'early' }]])
    hub.on('invite.open', (p) => got.push(['second', p]))
    await Promise.resolve()
    expect(got).toHaveLength(1)
    hub.dispatch('invite.open', { token: 'live' })
    expect(got.slice(1)).toEqual([
      ['invite', { token: 'live' }],
      ['second', { token: 'live' }],
    ])
  })

  it('a listener that throws does not stop the others', () => {
    const errors: string[] = []
    const hub = createEventHub((event) => errors.push(event))
    const got: unknown[] = []
    hub.on('shortcut', () => {
      throw new Error('boom')
    })
    hub.on('shortcut', (p) => got.push(p))
    hub.dispatch('shortcut', { action: 'reload' })
    expect(errors).toEqual(['shortcut'])
    expect(got).toEqual([{ action: 'reload' }])
  })
})
