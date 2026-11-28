import { useMemo } from 'react'
import { useStore } from '../lib/store'
import { useServices } from './context'
import { type Route, resolveSurface, type Surface } from './router'

/** The surface shown now (route + situation), and the router's actions. */
export function useSurface(): {
  surface: Surface
  route: Route
  go(route: Route): void
  back(): void
  toggle(route: Route): void
  completeFirstRun(): void
} {
  const { router, engine, client, layout } = useServices()
  const route = useStore(router.store, (s) => s.route)
  const activeTab = useStore(
    engine.tabs,
    (s) => s.value?.tabs.find((t) => t.id === s.value?.activeTabId) ?? null,
  )
  const session = useStore(client.session.store, (s) => s.status)
  const firstRunDone = useStore(layout.store, (s) => s.firstRunDone)
  return useMemo(
    () => ({
      surface: resolveSurface(route, { activeTab, session, firstRunDone }),
      route,
      go: router.go,
      back: router.back,
      toggle: router.toggle,
      completeFirstRun: () => {
        layout.completeFirstRun()
        if (router.store.getState().route.name === 'first-run') router.replace({ name: 'page' })
      },
    }),
    [route, activeTab, session, firstRunDone, router, layout],
  )
}
