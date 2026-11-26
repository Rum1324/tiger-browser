import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Download } from '@tiger/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: { openPath: async () => '', showItemInFolder: () => {} } }))

const { DownloadManager } = await import('../../src/main/downloads')

/** Just enough of Electron's DownloadItem: Chromium writes elsewhere and creates savePath at the end. */
class FakeItem extends EventEmitter {
  savePath = ''
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted' = 'progressing'
  constructor(
    private readonly name: string,
    private readonly url = `https://example.com/${name}`,
  ) {
    super()
  }
  getFilename = () => this.name
  getURL = () => this.url
  getTotalBytes = () => 10
  getReceivedBytes = () => 0
  getStartTime = () => Date.now() / 1000
  getState = () => this.state
  isPaused = () => false
  setSavePath = (p: string) => {
    this.savePath = p
  }
  cancel = () => {
    this.state = 'cancelled'
    this.emit('done', {}, 'cancelled')
  }
  finish(state: 'completed' | 'cancelled' | 'interrupted') {
    this.state = state
    this.emit('done', {}, state)
  }
}

let dir: string
let changes: { scope: string | null; list: Download[] }[]
let manager: InstanceType<typeof DownloadManager>
const normal = new EventEmitter()
const priv = new EventEmitter()

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tiger-dl-'))
  changes = []
  manager = new DownloadManager(
    () => dir,
    (scope, list) => changes.push({ scope, list }),
  )
  normal.removeAllListeners()
  priv.removeAllListeners()
  manager.attach(normal as never, null)
  manager.attach(priv as never, 'private-window-1')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const start = (ses: EventEmitter, item: FakeItem) => {
  ses.emit('will-download', {}, item)
  return item
}

describe('downloads', () => {
  it('gives concurrent downloads of the same name different paths', () => {
    const a = start(normal, new FakeItem('invoice.pdf'))
    const b = start(normal, new FakeItem('invoice.pdf'))
    expect(a.savePath).toBe(join(dir, 'invoice.pdf'))
    expect(b.savePath).toBe(join(dir, 'invoice (1).pdf'))
  })

  it('frees the name of a cancelled download for the next one', () => {
    const a = start(normal, new FakeItem('report.pdf'))
    a.finish('cancelled')
    const b = start(normal, new FakeItem('report.pdf'))
    expect(b.savePath).toBe(join(dir, 'report.pdf'))
  })

  it('keeps private-window downloads out of normal windows and drops them with the window', async () => {
    start(normal, new FakeItem('public.txt'))
    const secret = start(priv, new FakeItem('secret.txt', 'https://private.example/secret.txt'))
    expect(manager.list(null).map((d) => d.filename)).toEqual(['public.txt'])
    expect(manager.list('private-window-1').map((d) => d.filename)).toEqual(['secret.txt'])
    const id = manager.list('private-window-1')[0]?.id as string
    // A normal window's UI cannot reach a private download by id.
    expect(() => manager.cancel(id, null)).toThrow()
    await new Promise((r) => setTimeout(r, 80))
    const toNormal = changes.filter((c) => c.scope === null).flatMap((c) => c.list)
    expect(toNormal.some((d) => d.url.includes('private.example'))).toBe(false)
    manager.dropScope('private-window-1')
    expect(secret.state).toBe('cancelled')
    expect(manager.list('private-window-1')).toEqual([])
    expect(manager.list(null).map((d) => d.filename)).toEqual(['public.txt'])
  })
})
