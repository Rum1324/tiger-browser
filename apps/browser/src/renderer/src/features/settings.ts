import type { Settings } from '@tiger/shared'
import { useMemo } from 'react'
import { useServices } from '../app/context'
import { useStore } from '../lib/store'

export interface SettingsView {
  settings: Settings | null
  update(patch: Partial<Settings>): Promise<boolean>
  setTheme(theme: Settings['theme']): Promise<boolean>
  /** Changes the UI language; signed in, the server's copy of the member's locale follows. */
  setLocale(locale: Settings['locale']): Promise<boolean>
  setSearchEngine(engine: Settings['searchEngine']): Promise<boolean>
  /** Add a host suffix the member never wants captured. Returns false for an empty or bad host. */
  addBlockedHost(host: string): Promise<boolean>
  removeBlockedHost(host: string): Promise<boolean>
}

/** `https://Example.com/x` or `example.com.` → `example.com`; null when it is not a host. */
export function normalizeHost(input: string): string | null {
  let s = input.trim().toLowerCase()
  if (!s) return null
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = new URL(s).hostname
  } catch {
    return null
  }
  s =
    s
      .replace(/^\*?\./, '')
      .replace(/\.$/, '')
      .split('/')[0] ?? ''
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : null
}

export function useSettings(): SettingsView {
  const { engine, bridge, client } = useServices()
  const settings = useStore(engine.settings, (s) => s.value)
  return useMemo(() => {
    const update = async (patch: Partial<Settings>) => {
      try {
        // settings.changed follows and updates the store; apply the answer now too.
        engine.settings.setState({ value: await bridge.invoke('settings.update', patch) })
        return true
      } catch {
        return false
      }
    }
    const hosts = () => engine.settings.getState().value?.userBlockedHosts ?? []
    return {
      settings,
      update,
      setTheme: (theme) => update({ theme }),
      async setLocale(locale) {
        const ok = await update({ locale })
        if (ok && client.session.store.getState().status === 'signedIn')
          void client.session.updateMe({ locale }).catch(() => {})
        return ok
      },
      setSearchEngine: (searchEngine) => update({ searchEngine }),
      async addBlockedHost(input) {
        const host = normalizeHost(input)
        if (!host) return false
        if (hosts().includes(host)) return true
        return update({ userBlockedHosts: [...hosts(), host] })
      },
      removeBlockedHost: (host) => update({ userBlockedHosts: hosts().filter((h) => h !== host) }),
    }
  }, [settings, engine, bridge, client])
}
