import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { engineCommands, IPC_EVENT_CHANNEL, IPC_INVOKE_CHANNEL } from '@tiger/shared'
import { describe, expect, it } from 'vitest'
import {
  TAB_CAPTURE_REQUEST,
  TAB_CAPTURE_RESULT,
  TAB_NOTIFICATION_STATE,
} from '../../src/main/channels'
import {
  checkEvent,
  checkResponse,
  isTrustedSender,
  isTrustedUiUrl,
  parseInvoke,
} from '../../src/main/ipc-validate'

describe('parseInvoke', () => {
  it('accepts a valid request and strips unknown keys', () => {
    const r = parseInvoke('tabs.navigate', { tabId: 't1', input: 'example.com', evil: true })
    expect(r).toEqual({ ok: true, name: 'tabs.navigate', request: { tabId: 't1', input: 'example.com' } })
  })

  it('rejects unknown command names, including prototype keys', () => {
    for (const name of ['tabs.nuke', '__proto__', 'constructor', 'toString', 42, null, undefined]) {
      const r = parseInvoke(name, undefined)
      expect(r.ok, String(name)).toBe(false)
    }
  })

  it('rejects malformed payloads before any handler runs', () => {
    expect(parseInvoke('tabs.navigate', { tabId: 't1' }).ok).toBe(false)
    expect(parseInvoke('tabs.move', { tabId: 't1', toIndex: -1 }).ok).toBe(false)
    expect(parseInvoke('page.setZoom', { tabId: 't1', factor: 50 }).ok).toBe(false)
    expect(parseInvoke('suggest.query', { input: 'x'.repeat(2001) }).ok).toBe(false)
    expect(parseInvoke('page.setBounds', { bounds: { x: 0, y: 0, width: -1, height: 1 }, cornerRadius: 0 }).ok).toBe(false)
    expect(parseInvoke('capture.extract', 't1').ok).toBe(false)
  })

  it('requires void commands to carry no payload', () => {
    expect(parseInvoke('tabs.get', undefined).ok).toBe(true)
    expect(parseInvoke('tabs.get', { windowId: 'w2' }).ok).toBe(false)
  })

  it('knows every contract command', () => {
    for (const name of Object.keys(engineCommands)) {
      const r = parseInvoke(name, {})
      // Every name is recognised; the error, if any, is about the payload.
      if (!r.ok) expect(r.error).toMatch(/^invalid request/)
    }
  })
})

describe('checkResponse / checkEvent', () => {
  it('throws when the engine would breach the contract', () => {
    expect(() => checkResponse('tabs.reopenClosed', null)).not.toThrow()
    expect(() => checkResponse('auth.getToken', 42)).toThrow()
    expect(() => checkEvent('window.state', { focused: true })).toThrow()
    expect(checkEvent('shortcut', { action: 'find' })).toEqual({ action: 'find' })
  })
})

describe('trusted senders', () => {
  const ui = new Set([5, 6])

  it('trusts only tiger://ui and, in development, the dev server', () => {
    expect(isTrustedUiUrl('tiger://ui/index.html', null)).toBe(true)
    expect(isTrustedUiUrl('tiger://ui/index.html#overlay', null)).toBe(true)
    expect(isTrustedUiUrl('tiger://evil/index.html', null)).toBe(false)
    expect(isTrustedUiUrl('http://localhost:5173/', null)).toBe(false)
    expect(isTrustedUiUrl('http://localhost:5173/', 'http://localhost:5173')).toBe(true)
    expect(isTrustedUiUrl('http://localhost:5174/', 'http://localhost:5173')).toBe(false)
    expect(isTrustedUiUrl('https://example.com/', null)).toBe(false)
    expect(isTrustedUiUrl('garbage', null)).toBe(false)
  })

  it('requires a UI webContents, its main frame, and our UI URL', () => {
    const good = { webContentsId: 5, frameUrl: 'tiger://ui/index.html', isMainFrame: true }
    expect(isTrustedSender(good, ui, null)).toBe(true)
    expect(isTrustedSender({ ...good, webContentsId: 9 }, ui, null)).toBe(false)
    expect(isTrustedSender({ ...good, isMainFrame: false }, ui, null)).toBe(false)
    expect(isTrustedSender({ ...good, frameUrl: null }, ui, null)).toBe(false)
    expect(isTrustedSender({ ...good, frameUrl: 'https://example.com/' }, ui, null)).toBe(false)
  })
})

describe('preload channel literals', () => {
  const read = (f: string) => readFileSync(join(__dirname, '../../src/preload', f), 'utf8')

  it('the UI preload uses the contract channel names', () => {
    const src = read('ui.ts')
    expect(src).toContain(`'${IPC_INVOKE_CHANNEL}'`)
    expect(src).toContain(`'${IPC_EVENT_CHANNEL}'`)
  })

  it('the tab preload uses the main-process channel names and exposes no bridge', () => {
    const src = read('tab.ts')
    for (const ch of [TAB_CAPTURE_REQUEST, TAB_CAPTURE_RESULT, TAB_NOTIFICATION_STATE]) {
      expect(src).toContain(`'${ch}'`)
    }
    expect(src).not.toContain('exposeInMainWorld')
  })
})
