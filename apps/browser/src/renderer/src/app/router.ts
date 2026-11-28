import type { SessionStatus } from '@tiger/client'
import type { Tab } from '@tiger/shared'
import { createStore, type WritableStore } from '../lib/store'

/**
 * Routing between the surfaces of the main view, as plain state (no URLs: the UI view's URL never
 * changes). `page` shows the active tab's page in the page card; every other surface replaces it,
 * and then the page view is hidden (page.setBounds with null).
 */
export type SpaceHomeSection = 'overview' | 'items' | 'threads' | 'members' | 'activity'
export type SettingsSection = 'general' | 'account' | 'spaces' | 'privacy' | 'models' | 'about'

export type Route =
  | { name: 'page' }
  | { name: 'space-home'; section: SpaceHomeSection; threadId?: string }
  | { name: 'settings'; section: SettingsSection }
  | { name: 'item'; itemId: string }
  | { name: 'sign-in' }
  | { name: 'first-run' }

/**
 * What is actually shown: a route, or a surface the active tab resolves to on its own: the new-tab
 * surface for a blank tab, and the page-problem surface (drawn by Tiger in the page card, with the
 * native view hidden) for a page that did not load or whose process ended.
 */
export type PageProblem =
  | { kind: 'load-error'; code: number; description: string }
  | { kind: 'crashed' }
export type Surface =
  | Route
  | { name: 'new-tab'; tabId: string | null }
  | { name: 'page-problem'; tabId: string; problem: PageProblem }
export type SurfaceName = Surface['name']

/** Routes that only make sense for a signed-in member; signed out, they show sign-in instead. */
const NEEDS_SESSION: ReadonlySet<SurfaceName> = new Set(['space-home', 'item'])

export interface SurfaceContext {
  activeTab: Tab | null
  session: SessionStatus
  firstRunDone: boolean
}

/** The surface shown for a route in the current situation. Pure, so it is tested directly. */
export function resolveSurface(route: Route, ctx: SurfaceContext): Surface {
  if (!ctx.firstRunDone && route.name !== 'settings') return { name: 'first-run' }
  if (NEEDS_SESSION.has(route.name) && ctx.session !== 'signedIn' && ctx.session !== 'booting')
    return { name: 'sign-in' }
  if (route.name === 'page') {
    // A new tab is blank (the engine reports an empty URL): it shows the new-tab surface.
    if (!ctx.activeTab) return { name: 'new-tab', tabId: null }
    const tab = ctx.activeTab
    if (tab.crashed) return { name: 'page-problem', tabId: tab.id, problem: { kind: 'crashed' } }
    // A failed load stays until the next navigation starts (the engine clears it then).
    if (tab.loadError && !tab.isLoading)
      return {
        name: 'page-problem',
        tabId: tab.id,
        problem: { kind: 'load-error', ...tab.loadError },
      }
    if (tab.url === '' && !tab.isLoading) return { name: 'new-tab', tabId: tab.id }
  }
  if (route.name === 'sign-in' && ctx.session === 'signedIn') return { name: 'page' }
  return route
}

/** True when the surface replaces the page card, so the native page view must be hidden. */
export function coversPage(surface: Surface): boolean {
  return surface.name !== 'page'
}

export interface RouterState {
  route: Route
  /** Earlier routes, newest last, for `back()`. */
  history: Route[]
}

export interface Router {
  store: WritableStore<RouterState>
  go(route: Route): void
  /** Replace the current route without a history entry. */
  replace(route: Route): void
  back(): void
  /** Go to `route`, or back to the page if it is already shown (toggle shortcuts). */
  toggle(route: Route): void
}

const MAX_HISTORY = 50
const same = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b)

export function createRouter(initial: Route = { name: 'page' }): Router {
  const store = createStore<RouterState>({ route: initial, history: [] })
  const go = (route: Route) => {
    const { route: current, history } = store.getState()
    if (same(current, route)) return
    store.setState({ route, history: [...history, current].slice(-MAX_HISTORY) })
  }
  return {
    store,
    go,
    replace: (route) => store.setState({ route }),
    back() {
      const { history } = store.getState()
      const prev = history.at(-1)
      store.setState({ route: prev ?? { name: 'page' }, history: history.slice(0, -1) })
    },
    toggle(route) {
      if (store.getState().route.name === route.name) go({ name: 'page' })
      else go(route)
    },
  }
}
