import type { Download } from '@tiger/shared'
import { useMemo } from 'react'
import { useServices } from '../app/context'
import { useStore } from '../lib/store'

export interface DownloadsView {
  list: Download[]
  /** Newest first. */
  recent: Download[]
  /** Downloads still running (progressing or paused). */
  active: Download[]
  /** 0..1 over every running download with a known size; null when none has one. */
  progress: number | null
  cancel(id: string): void
  open(id: string): void
  showInFolder(id: string): void
  clear(): void
}

/** Overall progress of the running downloads. Pure. */
export function downloadsProgress(list: readonly Download[]): number | null {
  const sized = list.filter(
    (d) => (d.state === 'progressing' || d.state === 'paused') && d.totalBytes > 0,
  )
  if (!sized.length) return null
  const total = sized.reduce((n, d) => n + d.totalBytes, 0)
  const received = sized.reduce((n, d) => n + Math.min(d.receivedBytes, d.totalBytes), 0)
  return received / total
}

export function useDownloads(): DownloadsView {
  const { engine, bridge } = useServices()
  const list = useStore(engine.downloads, (s) => s.list)
  return useMemo(() => {
    const quiet = (p: Promise<unknown>) => void p.catch(() => {})
    return {
      list,
      recent: [...list].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)),
      active: list.filter((d) => d.state === 'progressing' || d.state === 'paused'),
      progress: downloadsProgress(list),
      cancel: (id) => quiet(bridge.invoke('downloads.cancel', { id })),
      open: (id) => quiet(bridge.invoke('downloads.open', { id })),
      showInFolder: (id) => quiet(bridge.invoke('downloads.showInFolder', { id })),
      clear: () => quiet(bridge.invoke('downloads.clear')),
    }
  }, [list, bridge])
}
