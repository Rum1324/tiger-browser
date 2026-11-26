import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { Download } from '@tiger/shared'
import { type DownloadItem, type Session, shell } from 'electron'
import { safeFileName, uniquePath } from './files'

/**
 * Whose downloads these are: `null` for the shared normal-window session, otherwise the id of the
 * private window whose in-memory session started them.
 */
export type DownloadScope = string | null

interface Entry {
  item: DownloadItem
  scope: DownloadScope
  data: Download
}

const running = (d: Download) => d.state === 'progressing' || d.state === 'paused'

/**
 * Downloads from every tab session. Files go straight to the downloads folder (no dialog); the list
 * lives in memory for this run. A private window's downloads are listed only in that window and
 * forgotten when it closes (the files stay on disk).
 */
export class DownloadManager {
  private readonly entries = new Map<string, Entry>()
  private next = 1
  private readonly scheduled = new Set<DownloadScope>()

  constructor(
    private readonly dir: () => string,
    private readonly onChange: (scope: DownloadScope, list: Download[]) => void,
  ) {}

  attach(ses: Session, scope: DownloadScope): void {
    ses.on('will-download', (_e, item) => this.track(item, scope))
  }

  list(scope: DownloadScope): Download[] {
    return [...this.entries.values()].filter((e) => e.scope === scope).map((e) => e.data)
  }

  /** A private window closed: running downloads are cancelled and its entries forgotten. */
  dropScope(scope: string): void {
    for (const [id, e] of this.entries) {
      if (e.scope !== scope) continue
      if (running(e.data)) e.item.cancel()
      this.entries.delete(id)
    }
    this.scheduled.delete(scope)
  }

  /**
   * Chromium writes to an intermediate file and creates the final one only on completion, so a
   * name taken by a running download is not on disk yet: those paths count as taken too.
   */
  private taken(path: string): boolean {
    if (existsSync(path)) return true
    for (const e of this.entries.values())
      if (running(e.data) && e.data.savePath === path) return true
    return false
  }

  private track(item: DownloadItem, scope: DownloadScope): void {
    const id = `d${this.next++}`
    const filename = safeFileName(item.getFilename())
    const savePath = uniquePath(this.dir(), filename, (p) => this.taken(p))
    item.setSavePath(savePath)
    const entry: Entry = {
      item,
      scope,
      data: {
        id,
        url: item.getURL(),
        filename: basename(savePath),
        savePath,
        state: 'progressing',
        receivedBytes: 0,
        totalBytes: Math.max(0, item.getTotalBytes()),
        startedAt: new Date(item.getStartTime() * 1000 || Date.now()).toISOString(),
      },
    }
    this.entries.set(id, entry)
    const refresh = () => {
      const state = item.getState()
      entry.data = {
        ...entry.data,
        state: state === 'progressing' && item.isPaused() ? 'paused' : state,
        receivedBytes: Math.max(0, item.getReceivedBytes()),
        totalBytes: Math.max(0, item.getTotalBytes()),
      }
      if (this.entries.get(id) === entry) this.changed(scope)
    }
    item.on('updated', refresh)
    item.once('done', refresh)
    this.changed(scope)
  }

  /** The entry, if it belongs to the asking window's scope; another scope's ids do not exist. */
  private get(id: string, scope: DownloadScope): Entry {
    const e = this.entries.get(id)
    if (!e || e.scope !== scope) throw new Error(`no download ${id}`)
    return e
  }

  cancel(id: string, scope: DownloadScope): void {
    const e = this.get(id, scope)
    if (running(e.data)) e.item.cancel()
  }

  async open(id: string, scope: DownloadScope): Promise<void> {
    const e = this.get(id, scope)
    if (e.data.state !== 'completed' || !e.data.savePath) throw new Error('download not completed')
    const err = await shell.openPath(e.data.savePath)
    if (err) throw new Error(err)
  }

  showInFolder(id: string, scope: DownloadScope): void {
    const e = this.get(id, scope)
    if (e.data.savePath) shell.showItemInFolder(e.data.savePath)
  }

  /** Forget this scope's finished downloads; running ones stay. */
  clear(scope: DownloadScope): void {
    for (const [id, e] of this.entries) {
      if (e.scope === scope && !running(e.data)) this.entries.delete(id)
    }
    this.changed(scope)
  }

  private changed(scope: DownloadScope): void {
    if (this.scheduled.has(scope)) return
    this.scheduled.add(scope)
    setTimeout(() => {
      if (!this.scheduled.delete(scope)) return
      this.onChange(scope, this.list(scope))
    }, 50)
  }
}
