import type { EngineBridge } from '@tiger/shared'
import { useMemo } from 'react'
import { useServices } from '../app/context'
import type { PageProblem } from '../app/router'
import { useSurface } from '../app/surface'
import type { Notice } from '../i18n'

/**
 * A page that is not there (DESIGN.md 20c, 20d): the load failed, or the page's process ended.
 * The router shows the page-problem surface for it and the native view is hidden, so Tiger draws
 * the message in the page card. Retry reloads the tab; the engine clears the problem as soon as
 * the next navigation starts, and the page comes back by itself.
 */
export interface PageProblemView {
  tabId: string | null
  problem: PageProblem | null
  /** The URL that failed, as the engine reports it (shown verbatim, never sent anywhere). */
  url: string
  message: Notice | null
  canGoBack: boolean
}

export interface PageProblemActions {
  retry(): Promise<void>
  back(): Promise<void>
}

export function problemNotice(problem: PageProblem | null): Notice | null {
  if (!problem) return null
  if (problem.kind === 'crashed') return { key: 'tab.crashed' }
  return { key: 'tab.loadError', vars: { description: problem.description, code: problem.code } }
}

export function pageProblemActions(
  bridge: Pick<EngineBridge, 'invoke'>,
  tabId: () => string | null,
): PageProblemActions {
  return {
    async retry() {
      const id = tabId()
      if (id) await bridge.invoke('tabs.reload', { tabId: id })
    },
    async back() {
      const id = tabId()
      if (id) await bridge.invoke('tabs.back', { tabId: id })
    },
  }
}

export function usePageProblem(): PageProblemView & PageProblemActions {
  const { bridge, engine } = useServices()
  const { surface } = useSurface()
  const tabId = surface.name === 'page-problem' ? surface.tabId : null
  const problem = surface.name === 'page-problem' ? surface.problem : null
  const tab = engine.tabs.getState().value?.tabs.find((t) => t.id === tabId) ?? null
  const url = tab?.url ?? ''
  const canGoBack = tab?.canGoBack ?? false
  return useMemo(
    () => ({
      tabId,
      problem,
      url,
      canGoBack,
      message: problemNotice(problem),
      ...pageProblemActions(bridge, () => tabId),
    }),
    [tabId, problem, url, canGoBack, bridge],
  )
}
