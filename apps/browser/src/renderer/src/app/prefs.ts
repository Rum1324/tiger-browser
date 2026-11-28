/**
 * UI-only preferences that live in the chrome UI's own storage (the persist:chrome-ui session):
 * layout choices and whether first run was completed. Nothing here is product data and nothing
 * leaves the machine. Settings that the engine owns (theme, locale, server) are not here.
 */
export interface UiPrefs {
  firstRunDone: boolean
  sidebarCollapsed: boolean
  panelOpen: boolean
  /** CSS px; null = the design's default width token. */
  sidebarWidth: number | null
  panelWidth: number | null
}

export const DEFAULT_PREFS: UiPrefs = {
  firstRunDone: false,
  sidebarCollapsed: false,
  panelOpen: false,
  sidebarWidth: null,
  panelWidth: null,
}

export interface PrefsStorage {
  load(): Partial<UiPrefs>
  save(prefs: UiPrefs): void
}

const KEY = 'tiger.ui.prefs.v1'

export function localPrefsStorage(storage: Storage | null = safeLocalStorage()): PrefsStorage {
  return {
    load() {
      try {
        const raw = storage?.getItem(KEY)
        return raw ? sanitize(JSON.parse(raw)) : {}
      } catch {
        return {}
      }
    },
    save(prefs) {
      try {
        storage?.setItem(KEY, JSON.stringify(prefs))
      } catch {
        // Storage full or unavailable: the preference lasts for this session only.
      }
    },
  }
}

export function memoryPrefsStorage(initial: Partial<UiPrefs> = {}): PrefsStorage & {
  saved: UiPrefs | null
} {
  const box = { saved: null as UiPrefs | null }
  return {
    get saved() {
      return box.saved
    },
    load: () => ({ ...initial }),
    save(prefs) {
      box.saved = prefs
    },
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function sanitize(raw: unknown): Partial<UiPrefs> {
  if (typeof raw !== 'object' || raw === null) return {}
  const r = raw as Record<string, unknown>
  const out: Partial<UiPrefs> = {}
  for (const k of ['firstRunDone', 'sidebarCollapsed', 'panelOpen'] as const)
    if (typeof r[k] === 'boolean') out[k] = r[k]
  for (const k of ['sidebarWidth', 'panelWidth'] as const)
    if (typeof r[k] === 'number' && Number.isFinite(r[k]) && r[k] > 0) out[k] = r[k]
  return out
}
