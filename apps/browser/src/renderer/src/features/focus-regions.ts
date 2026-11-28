import type { EngineBridge } from '@tiger/shared'
import type { EngineState } from '../engine/engine-state'

/**
 * `focus-next-region` (F6, ⌃⌘→): keyboard focus moves sidebar → toolbar → page → ask panel and
 * round again, skipping what is not shown (the page under a surface or on an empty tab, the closed
 * panel). Tab cannot leave a web page, so this is how the keyboard gets out of one.
 *
 * The page is a separate native view: it is handed focus through the engine (activating the
 * active tab focuses its view), and the engine gives the keyboard back to this view before it
 * sends the shortcut. Whether the page holds focus is tracked here: set when focus is handed to it
 * or when this document loses focus while no overlay is up (a click in the page), cleared by the
 * member's own clicks and keys in this document.
 */
export type FocusRegion = 'sidebar' | 'toolbar' | 'page' | 'ask-panel'
export const FOCUS_ORDER: readonly FocusRegion[] = ['sidebar', 'toolbar', 'page', 'ask-panel']

export interface FocusRegions {
  /** Move to the next region; returns the region that now has focus, or null. */
  next(): FocusRegion | null
  /** Where focus is now, as far as this view can tell. */
  current(): FocusRegion | null
  dispose(): void
}

const FOCUSABLE =
  'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

export function createFocusRegions(deps: {
  doc: Document
  bridge: Pick<EngineBridge, 'invoke'>
  engine: EngineState
  /** True while an overlay surface is up (its focus is not the page's). */
  overlayOpen: () => boolean
}): FocusRegions {
  const { doc } = deps
  let pageFocused = false

  const regionEl = (r: FocusRegion) => doc.querySelector<HTMLElement>(`[data-region="${r}"]`)
  const activeTab = () => {
    const s = deps.engine.tabs.getState().value
    return s?.tabs.find((t) => t.id === s.activeTabId) ?? null
  }
  const available = (r: FocusRegion) => {
    if (r === 'page') return !!regionEl('page') && !!activeTab()?.url
    return !!regionEl(r)
  }

  const current = (): FocusRegion | null => {
    if (pageFocused) return 'page'
    const el = doc.activeElement
    if (!el || el === doc.body) return null
    const region = el.closest('[data-region]')?.getAttribute('data-region')
    return FOCUS_ORDER.includes(region as FocusRegion) ? (region as FocusRegion) : null
  }

  const focusIn = (r: FocusRegion) => {
    if (r === 'page') {
      const tab = activeTab()
      if (!tab) return
      pageFocused = true
      void deps.bridge.invoke('tabs.activate', { tabId: tab.id }).catch(() => {})
      return
    }
    const el = regionEl(r)
    if (!el) return
    pageFocused = false
    const target =
      el.querySelector<HTMLElement>('[data-region-focus]') ??
      el.querySelector<HTMLElement>(FOCUSABLE) ??
      el
    if (target === el && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
    target.focus({ preventScroll: true })
  }

  const onBlur = () => {
    if (!deps.overlayOpen()) pageFocused = true
  }
  const onMemberInput = () => {
    pageFocused = false
  }
  const view = doc.defaultView
  view?.addEventListener('blur', onBlur)
  doc.addEventListener('pointerdown', onMemberInput, true)
  doc.addEventListener('keydown', onMemberInput, true)

  return {
    current,
    next() {
      const from = current()
      const start = from ? FOCUS_ORDER.indexOf(from) : -1
      for (let i = 1; i <= FOCUS_ORDER.length; i++) {
        const r = FOCUS_ORDER[(start + i) % FOCUS_ORDER.length] as FocusRegion
        if (r !== from && available(r)) {
          focusIn(r)
          return r
        }
      }
      return null
    },
    dispose() {
      view?.removeEventListener('blur', onBlur)
      doc.removeEventListener('pointerdown', onMemberInput, true)
      doc.removeEventListener('keydown', onMemberInput, true)
    },
  }
}
