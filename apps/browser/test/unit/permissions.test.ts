import type { PermissionRequest } from '@tiger/shared'
import { describe, expect, it } from 'vitest'
import { PermissionBroker } from '../../src/main/permission-broker'
import {
  checkPermission,
  policyForRequest,
  rememberedDecision,
  webOrigin,
} from '../../src/main/permission-policy'
import { MemoryPermissionStore } from '../../src/main/store/permissions'

describe('policyForRequest', () => {
  it('asks for the contract permissions and denies everything else', () => {
    expect(policyForRequest('notifications')).toEqual({
      action: 'ask',
      permission: 'notifications',
    })
    expect(policyForRequest('geolocation')).toEqual({ action: 'ask', permission: 'geolocation' })
    expect(policyForRequest('clipboard-read')).toEqual({
      action: 'ask',
      permission: 'clipboard-read',
    })
    expect(policyForRequest('display-capture')).toEqual({
      action: 'ask',
      permission: 'screen-capture',
    })
    expect(policyForRequest('media', ['video'])).toEqual({ action: 'ask', permission: 'camera' })
    expect(policyForRequest('media', ['audio'])).toEqual({
      action: 'ask',
      permission: 'microphone',
    })
    expect(policyForRequest('media', ['audio', 'video'])).toEqual({
      action: 'ask',
      permission: 'camera-and-microphone',
    })
    expect(policyForRequest('media', [])).toEqual({ action: 'deny' })
    for (const p of [
      'midi',
      'midiSysex',
      'pointerLock',
      'openExternal',
      'hid',
      'serial',
      'usb',
      'idle-detection',
      'storage-access',
      'something-new',
    ]) {
      expect(policyForRequest(p), p).toEqual({ action: 'deny' })
    }
    expect(policyForRequest('fullscreen')).toEqual({ action: 'grant' })
  })
})

describe('remembered decisions and checks', () => {
  it('relates camera, microphone and the combined permission', () => {
    const d = new MemoryPermissionStore()
    const o = 'https://meet.example'
    d.set(o, 'camera', true)
    expect(rememberedDecision(d, o, 'camera-and-microphone')).toBeUndefined()
    d.set(o, 'microphone', true)
    expect(rememberedDecision(d, o, 'camera-and-microphone')).toBe(true)
    d.set(o, 'microphone', false)
    expect(rememberedDecision(d, o, 'camera-and-microphone')).toBe(false)
    const e = new MemoryPermissionStore()
    e.set(o, 'camera-and-microphone', true)
    expect(rememberedDecision(e, o, 'camera')).toBe(true)
  })

  it('reports granted only for a remembered allow', () => {
    const d = new MemoryPermissionStore()
    const o = 'https://a.example'
    expect(checkPermission(d, 'notifications', o)).toBe(false)
    d.set(o, 'notifications', true)
    expect(checkPermission(d, 'notifications', o)).toBe(true)
    expect(checkPermission(d, 'notifications', 'https://b.example')).toBe(false)
    d.set(o, 'camera', true)
    expect(checkPermission(d, 'media', o, 'video')).toBe(true)
    expect(checkPermission(d, 'media', o, 'audio')).toBe(false)
    expect(checkPermission(d, 'midi', o)).toBe(false)
  })

  it('only web origins hold permissions', () => {
    expect(webOrigin('https://a.example/x?y')).toBe('https://a.example')
    expect(webOrigin('file:///x')).toBeNull()
    expect(webOrigin('tiger://ui/')).toBeNull()
    expect(webOrigin('')).toBeNull()
  })
})

describe('PermissionBroker', () => {
  const setup = () => {
    const sent: { windowId: string; request: PermissionRequest }[] = []
    let now = 0
    const broker = new PermissionBroker(
      (windowId, request) => sent.push({ windowId, request }),
      () => now,
    )
    const decisions = new MemoryPermissionStore()
    const ask = (tabId = 't1', permission: PermissionRequest['permission'] = 'geolocation') =>
      broker.ask({ tabId, windowId: 'w1', origin: 'https://a.example', permission, decisions })
    return {
      broker,
      sent,
      decisions,
      ask,
      tick: (ms: number) => {
        now += ms
      },
    }
  }

  it('asks the UI and resolves with its answer', async () => {
    const s = setup()
    const p = s.ask()
    expect(s.sent).toHaveLength(1)
    expect(s.sent[0]?.windowId).toBe('w1')
    s.broker.respond(s.sent[0]?.request.requestId as string, true, false, 'w1')
    expect(await p).toBe(true)
    expect(s.decisions.get('https://a.example', 'geolocation')).toBeUndefined()
  })

  it('stores a remembered decision and then answers without asking', async () => {
    const s = setup()
    const p = s.ask()
    s.broker.respond(s.sent[0]?.request.requestId as string, false, true, 'w1')
    expect(await p).toBe(false)
    s.tick(60_000)
    expect(await s.ask('t2')).toBe(false)
    expect(s.sent).toHaveLength(1)
  })

  it('shares one prompt between identical concurrent requests', async () => {
    const s = setup()
    const a = s.ask()
    const b = s.ask()
    expect(s.sent).toHaveLength(1)
    s.broker.respond(s.sent[0]?.request.requestId as string, true, false, 'w1')
    expect(await Promise.all([a, b])).toEqual([true, true])
  })

  it('refuses answers from another window and ignores unknown ids', () => {
    const s = setup()
    void s.ask()
    const id = s.sent[0]?.request.requestId as string
    expect(() => s.broker.respond(id, true, true, 'w2')).toThrow()
    expect(s.broker.pendingCount()).toBe(1)
    expect(() => s.broker.respond('nope', true, false, 'w1')).not.toThrow()
  })

  it('denies open requests when the tab navigates away', async () => {
    const s = setup()
    const p = s.ask()
    s.broker.withdrawForTab('t1')
    expect(await p).toBe(false)
    expect(s.broker.pendingCount()).toBe(0)
  })
})
