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

/**
 * The member's blocked hosts in the form capture eligibility compares against `URL.hostname`:
 * lower-case, punycode for internationalised names (社内.example.jp → xn--…), no scheme, port, user
 * info, path or surrounding dots. A leading `*.` means the domain and its subdomains, which is how
 * every entry already matches. Entries that are not host names are dropped, so the list shown back
 * to the member is exactly what is enforced.
 */
export function normalizeBlockedHosts(hosts: readonly string[]): string[] {
  const out = new Set<string>()
  for (const raw of hosts) {
    const text = raw
      .trim()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      .replace(/^\*\./, '')
    if (!text) continue
    let host: string
    try {
      // The URL parser applies IDNA (punycode, full-width to ASCII) and drops port and user info.
      host = new URL(`http://${text}`).hostname
    } catch {
      continue
    }
    host = host.replace(/^\.+|\.+$/g, '')
    if (/^\[[0-9a-f:.]+\]$/.test(host) || /^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host)) out.add(host)
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
    const loaded = this.load()
    // Entries saved by a build that stored them as typed are enforced in the normalised form too.
    this.current = { ...loaded, userBlockedHosts: normalizeBlockedHosts(loaded.userBlockedHosts) }
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
