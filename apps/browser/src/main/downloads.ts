import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { Download } from '@tiger/shared'
import { type DownloadItem, type Session, shell } from 'electron'
import { safeFileName, uniquePath } from './files'

interface Entry {
  item: DownloadItem
  data: Download
}

/**
 * Downloads from every tab session. Files go straight to the downloads folder (no dialog); the list
 * lives in memory for this run.
 */
export class DownloadManager {
  private readonly entries = new Map<string, Entry>()
  private next = 1
  private scheduled = false

  constructor(
    private readonly dir: () => string,
    private readonly onChange: (list: Download[]) => void,
  ) {}

  attach(ses: Session): void {
    ses.on('will-download', (_e, item) => this.track(item))
  }

  list(): Download[] {
    return [...this.entries.values()].map((e) => e.data)
  }

  private track(item: DownloadItem): void {
    const id = `d${this.next++}`
    const filename = safeFileName(item.getFilename())
    const savePath = uniquePath(this.dir(), filename, existsSync)
    item.setSavePath(savePath)
    const entry: Entry = {
      item,
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
      this.changed()
    }
    item.on('updated', refresh)
    item.once('done', refresh)
    this.changed()
  }

  private get(id: string): Entry {
    const e = this.entries.get(id)
    if (!e) throw new Error(`no download ${id}`)
    return e
  }

  cancel(id: string): void {
    const e = this.get(id)
    if (e.data.state === 'progressing' || e.data.state === 'paused') e.item.cancel()
  }

  async open(id: string): Promise<void> {
    const e = this.get(id)
    if (e.data.state !== 'completed' || !e.data.savePath) throw new Error('download not completed')
    const err = await shell.openPath(e.data.savePath)
    if (err) throw new Error(err)
  }

  showInFolder(id: string): void {
    const e = this.get(id)
    if (e.data.savePath) shell.showItemInFolder(e.data.savePath)
  }

  /** Forget finished downloads; running ones stay. */
  clear(): void {
    for (const [id, e] of this.entries) {
      if (e.data.state !== 'progressing' && e.data.state !== 'paused') this.entries.delete(id)
    }
    this.changed()
  }

  private changed(): void {
    if (this.scheduled) return
    this.scheduled = true
    setTimeout(() => {
      this.scheduled = false
      this.onChange(this.list())
    }, 50)
  }
}
