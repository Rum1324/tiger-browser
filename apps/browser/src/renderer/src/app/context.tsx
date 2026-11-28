import type { Locale } from '@tiger/shared'
import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { type Translate, translator } from '../i18n'
import { useStore } from '../lib/store'
import type { AppServices } from './services'

const ServicesContext = createContext<AppServices | null>(null)

/** Provides the services to every component and hook of the main view. */
export function ServicesProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>
}

export function useServices(): AppServices {
  const s = useContext(ServicesContext)
  if (!s) throw new Error('useServices() outside <ServicesProvider>')
  return s
}

export const useClient = () => useServices().client
export const useBridge = () => useServices().bridge

/**
 * The UI locale: the engine setting is the source of truth (the member chooses it in Settings);
 * before settings load, the client's locale, which defaults to Japanese.
 */
export function useLocale(): Locale {
  const { engine, client } = useServices()
  const fromSettings = useStore(engine.settings, (s) => s.value?.locale ?? null)
  const fromClient = useStore(client.ui, (s) => s.locale)
  return fromSettings ?? fromClient
}

/** `t(key, vars)` for the UI's own keys and @tiger/client's messages, in the current locale. */
export function useT(): Translate {
  const locale = useLocale()
  return useMemo(() => translator(locale), [locale])
}
