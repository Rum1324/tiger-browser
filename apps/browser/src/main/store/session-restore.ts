import { z } from 'zod'
import { isWebUrl } from '../resolve-input'
import type { KvStore } from './db'

/** Every normal window, in the order they were opened. */
const KEY = 'session.windows'
/** The single-window document written by earlier builds; read when the new one is absent. */
const LEGACY_KEY = 'session.lastWindow'

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

const RestoredSession = z.object({ windows: z.array(RestoredWindow), savedAt: z.string() })

export interface WindowSnapshot {
  tabs: readonly RestoredTab[]
  activeIndex: number | null
}

/**
 * The normal windows' tabs, restored at the next launch. Private windows are never written here;
 * tabs that never left the new-tab page (or hold a non-web URL) are dropped, and so is a window left
 * with no tab.
 */
export class SessionRestoreStore {
  constructor(private readonly kv: KvStore) {}

  save(windows: readonly WindowSnapshot[]): void {
    const savedAt = new Date().toISOString()
    const out: RestoredWindow[] = []
    for (const w of windows) {
      const kept: RestoredTab[] = []
      let active: number | null = null
      w.tabs.forEach((tab, i) => {
        if (!isWebUrl(tab.url)) return
        if (i === w.activeIndex) active = kept.length
        kept.push(tab)
      })
      if (kept.length === 0) continue
      out.push({ tabs: kept, activeIndex: active ?? kept.length - 1, savedAt })
    }
    this.kv.set(KEY, JSON.stringify({ windows: out, savedAt }))
  }

  load(): RestoredWindow[] {
    const raw = this.kv.get(KEY)
    if (raw) return parse(raw, RestoredSession)?.windows ?? []
    const legacy = this.kv.get(LEGACY_KEY)
    const one = legacy ? parse(legacy, RestoredWindow) : null
    return one?.tabs.length ? [one] : []
  }
}

function parse<T>(raw: string, schema: z.ZodType<T>): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
