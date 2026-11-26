import { z } from 'zod'
import { isWebUrl } from '../resolve-input'
import type { KvStore } from './db'

const KEY = 'session.lastWindow'

export const RestoredTab = z.object({
  url: z.string(),
  title: z.string(),
  pinned: z.boolean(),
  spaceId: z.string().nullable(),
})
export type RestoredTab = z.infer<typeof RestoredTab>

export const RestoredWindow = z.object({
  tabs: z.array(RestoredTab),
  activeIndex: z.number().int().nonnegative().nullable(),
  savedAt: z.string(),
})
export type RestoredWindow = z.infer<typeof RestoredWindow>

/**
 * The last normal window's tabs, restored at the next launch. Private windows are never written
 * here; tabs that never left the new-tab page (or hold a non-web URL) are dropped.
 */
export class SessionRestoreStore {
  constructor(private readonly kv: KvStore) {}

  save(tabs: readonly RestoredTab[], activeIndex: number | null): void {
    const kept: RestoredTab[] = []
    let active: number | null = null
    tabs.forEach((tab, i) => {
      if (!isWebUrl(tab.url)) return
      if (i === activeIndex) active = kept.length
      kept.push(tab)
    })
    const doc: RestoredWindow = {
      tabs: kept,
      activeIndex: active ?? (kept.length ? kept.length - 1 : null),
      savedAt: new Date().toISOString(),
    }
    this.kv.set(KEY, JSON.stringify(doc))
  }

  load(): RestoredWindow | null {
    const raw = this.kv.get(KEY)
    if (!raw) return null
    try {
      const parsed = RestoredWindow.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }
}
