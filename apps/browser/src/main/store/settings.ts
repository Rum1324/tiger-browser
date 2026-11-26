import { Settings } from '@tiger/shared'
import type { KvStore } from './db'

const KEY = 'settings'

export function defaultSettings(systemLocale: string, serverUrl: string): Settings {
  return {
    locale: systemLocale.toLowerCase().startsWith('ja') ? 'ja' : 'en',
    theme: 'system',
    searchEngine: 'google',
    serverUrl,
    userBlockedHosts: [],
    lastSpaceId: null,
    defaultModel: null,
  }
}

/** Host suffixes are compared lower-case without a leading dot or scheme; blanks are dropped. */
export function normalizeBlockedHosts(hosts: readonly string[]): string[] {
  const out = new Set<string>()
  for (const raw of hosts) {
    const h = raw
      .trim()
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
      .replace(/[/?#].*$/, '')
      .replace(/^\.+|\.+$/g, '')
    if (h) out.add(h)
  }
  return [...out]
}

/**
 * The Settings contract object, stored as one JSON document. A stored value that no longer matches
 * the contract (an older build, a hand edit) is merged over the defaults key by key, keeping only
 * the fields that still validate.
 */
export class SettingsStore {
  private current: Settings

  constructor(
    private readonly kv: KvStore,
    private readonly defaults: Settings,
  ) {
    this.current = this.load()
  }

  get(): Settings {
    return this.current
  }

  update(patch: Partial<Settings>): Settings {
    const merged = { ...this.current, ...patch }
    if (patch.userBlockedHosts)
      merged.userBlockedHosts = normalizeBlockedHosts(patch.userBlockedHosts)
    const next = Settings.parse(merged)
    this.kv.set(KEY, JSON.stringify(next))
    this.current = next
    return next
  }

  private load(): Settings {
    const raw = this.kv.get(KEY)
    if (!raw) return this.defaults
    let stored: unknown
    try {
      stored = JSON.parse(raw)
    } catch {
      return this.defaults
    }
    const whole = Settings.safeParse(stored)
    if (whole.success) return whole.data
    if (typeof stored !== 'object' || stored === null) return this.defaults
    const result: Record<string, unknown> = { ...this.defaults }
    for (const [key, value] of Object.entries(stored)) {
      const field = Settings.shape[key as keyof Settings]
      if (field?.safeParse(value).success) result[key] = value
    }
    return Settings.parse(result)
  }
}
