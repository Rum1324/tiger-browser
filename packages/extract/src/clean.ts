import { TASK_TAG } from './markdown'

/**
 * Everything here runs on a clone. The live page is only read (computed styles, before cloning) and is
 * never modified: the member is looking at it, and the page's own scripts must not observe a change.
 */

/** Above this many elements the computed-style pass is skipped; attribute checks still apply. */
const COMPUTED_STYLE_MAX_ELEMENTS = 40_000
/** Share of the total time budget the computed-style pass may use before it gives up. */
const COMPUTED_STYLE_BUDGET_SHARE = 0.25

function isHiddenByStyle(style: CSSStyleDeclaration): boolean {
  return (
    style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
  )
}

/**
 * Clone the document with elements the member cannot see removed. Hidden-ness is read from the live
 * page's computed style (catches stylesheet rules), then applied to the clone by document order, which
 * a deep clone preserves exactly.
 */
export function cloneVisible(doc: Document, deadline: number): Document {
  // Indexes are positions among the body's descendants, the same in the live page and its deep clone.
  const liveElements = doc.body ? Array.from(doc.body.getElementsByTagName('*')) : []
  const hiddenIndexes: number[] = []
  const view = doc.defaultView
  if (
    view &&
    typeof view.getComputedStyle === 'function' &&
    liveElements.length <= COMPUTED_STYLE_MAX_ELEMENTS
  ) {
    const start = performance.now()
    const stopAt = Math.min(deadline, start + (deadline - start) * COMPUTED_STYLE_BUDGET_SHARE)
    let hiddenRoot: Element | null = null
    for (let i = 0; i < liveElements.length; i++) {
      const el = liveElements[i] as Element
      if ((i & 127) === 0 && performance.now() > stopAt) break
      // Descendants of a hidden element go with it; no need to ask for their style.
      if (hiddenRoot?.contains(el)) continue
      let style: CSSStyleDeclaration
      try {
        style = view.getComputedStyle(el)
      } catch {
        continue
      }
      if (isHiddenByStyle(style)) {
        hiddenIndexes.push(i)
        hiddenRoot = el
      }
    }
  }
  const clone = doc.cloneNode(true) as Document
  if (hiddenIndexes.length > 0 && clone.body) {
    const cloneElements = Array.from(clone.body.getElementsByTagName('*'))
    for (const i of hiddenIndexes) cloneElements[i]?.remove()
  }
  return clone
}

/** Elements that are never content. Checked by tag name in one walk; selector passes are far slower. */
const NEVER_CONTENT = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'textarea',
  'select',
  'datalist',
  'keygen',
  'output',
])

const HIDDEN_STYLE =
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\s*(?:!important\s*)?(?:;|$)/i

/**
 * Depth-first walk over the elements under `root` that lets the visitor remove or replace the current
 * element; a removed element's subtree is skipped, never visited.
 */
function walk(root: Element, visit: (el: Element) => 'keep' | 'remove' | Element): void {
  let el: Element | null = root.firstElementChild
  const next = (from: Element, descend: boolean): Element | null => {
    if (descend && from.firstElementChild) return from.firstElementChild
    for (let n: Element | null = from; n && n !== root; n = n.parentElement) {
      if (n.nextElementSibling) return n.nextElementSibling
    }
    return null
  }
  while (el) {
    const verdict = visit(el)
    if (verdict === 'keep') {
      el = next(el, true)
    } else if (verdict === 'remove') {
      const after = next(el, false)
      el.remove()
      el = after
    } else {
      const after = next(el, false)
      el.replaceWith(verdict)
      el = after
    }
  }
}

/**
 * Removal that applies to every extractor, app handlers included: non-content elements, hidden elements
 * by attribute, and every form control, so that a value typed into a field can never be captured.
 */
type Verdict = 'keep' | 'remove' | 'task'

/** Form controls, non-content elements and attribute-hidden elements. Shared by both paths. */
function unsafeVerdict(el: Element): Verdict {
  const tag = el.localName
  if (NEVER_CONTENT.has(tag)) return 'remove'
  if (tag === 'input')
    return (el.getAttribute('type') ?? '').toLowerCase() === 'checkbox' ? 'task' : 'remove'
  if (el.hasAttribute('hidden') && el.getAttribute('hidden') !== 'until-found') return 'remove'
  if (el.getAttribute('aria-hidden') === 'true') return 'remove'
  const style = el.getAttribute('style')
  if (style && HIDDEN_STYLE.test(style)) return 'remove'
  return 'keep'
}

/**
 * Removal that applies to every extractor, app handlers included: non-content elements, hidden elements
 * by attribute, and every form control, so that a value typed into a field can never be captured.
 */
export function stripUnsafe(doc: Document): void {
  const root = doc.body ?? doc.documentElement
  if (!root) return
  walk(root, (el) => {
    const verdict = unsafeVerdict(el)
    if (verdict !== 'task') return verdict
    // Checked state is not typed text; keeping it lets task lists render as `[x]`.
    const marker = doc.createElement(TASK_TAG)
    if ((el as HTMLInputElement).checked) marker.setAttribute('checked', '')
    return marker
  })
}

function isEditable(el: Element): boolean {
  const ce = el.getAttribute('contenteditable')
  if (ce !== null && ce.toLowerCase() !== 'false') return true
  const role = el.getAttribute('role')
  return role === 'textbox' || role === 'searchbox'
}

const BOILERPLATE_TAGS = new Set(['nav', 'dialog', 'button'])
const BOILERPLATE_ROLES = new Set([
  'navigation',
  'banner',
  'contentinfo',
  'search',
  'dialog',
  'alertdialog',
  'button',
])
/** Chrome when outside the article; inside it they hold the title, author notes or callouts. */
const OUTSIDE_ARTICLE_TAGS = new Set(['header', 'footer', 'aside'])

/** Class or id tokens that mark site furniture rather than content. Matched per token, not as substrings. */
const BOILERPLATE_TOKENS = new Set([
  'ad',
  'ads',
  'adsense',
  'adsbygoogle',
  'advert',
  'advertisement',
  'advertising',
  'sponsor',
  'sponsored',
  'promo',
  'outbrain',
  'taboola',
  'dfp',
  'cookie',
  'cookies',
  'consent',
  'gdpr',
  'cmp',
  'onetrust',
  'didomi',
  'truste',
  'usercentrics',
  'qc-cmp2',
  'cookiebot',
  'breadcrumb',
  'breadcrumbs',
  'share',
  'sharing',
  'social',
  'newsletter',
  'subscribe',
  'paywall',
  'related',
  'recommended',
  'ranking',
  'popular',
  'sr-only',
  'visually-hidden',
  'screen-reader-text',
  'skip-link',
])

function tokensOf(el: Element): string[] {
  const raw = `${el.getAttribute('class') ?? ''} ${el.getAttribute('id') ?? ''}`.toLowerCase()
  if (!raw.trim()) return []
  const parts = raw.split(/\s+/)
  const out: string[] = []
  for (const p of parts) {
    if (!p) continue
    out.push(p)
    for (const sub of p.split(/[-_]+/)) if (sub && sub !== p) out.push(sub)
  }
  return out
}

const PROTECTED = new Set(['html', 'body', 'main', 'article'])

/**
 * Generic page furniture: navigation, ads, cookie banners, share bars, related-link rails, plus
 * unsent drafts in contenteditable composers (as private as an input value). App handlers that read
 * contenteditable page content (Notion) run before this and select their own nodes.
 *
 * A match is never removed when it holds most of a substantial page's text, so an over-broad class on
 * a wrapper (or an article opened in a dialog) cannot delete the content.
 */
function textShare(body: Element): (el: Element) => boolean {
  const total = (body.textContent ?? '').length
  return (el) => {
    const len = (el.textContent ?? '').length
    return len > 500 && len > total * 0.5
  }
}

function isBoilerplate(el: Element, holdsMostText: (el: Element) => boolean): boolean {
  if (isEditable(el)) return true
  const tag = el.localName
  if (PROTECTED.has(tag)) return false
  const role = el.getAttribute('role')
  let match =
    BOILERPLATE_TAGS.has(tag) ||
    (role !== null && BOILERPLATE_ROLES.has(role)) ||
    el.getAttribute('aria-modal') === 'true' ||
    el.hasAttribute('data-ad-slot') ||
    el.hasAttribute('data-ad-client') ||
    el.hasAttribute('data-google-query-id')
  if (!match && (OUTSIDE_ARTICLE_TAGS.has(tag) || role === 'complementary')) {
    match = el.closest('article, main, [role="main"]') === null
  }
  if (!match && (el.hasAttribute('class') || el.hasAttribute('id'))) {
    match = tokensOf(el).some((t) => BOILERPLATE_TOKENS.has(t))
  }
  return match && !holdsMostText(el)
}

export function stripBoilerplate(doc: Document): void {
  const body = doc.body
  if (!body) return
  const holdsMostText = textShare(body)
  walk(body, (el) => (isBoilerplate(el, holdsMostText) ? 'remove' : 'keep'))
}

/**
 * The same decisions as `cloneVisible` + `stripUnsafe` + `stripBoilerplate`, as a read-only predicate
 * for converting a live DOM that is too large to clone within the time budget. Checkboxes are not
 * skipped: the converter renders their checked state and never reads a value.
 */
export function liveSkipFilter(doc: Document, deadline: number): (el: Element) => boolean {
  const body = doc.body ?? doc.documentElement
  const holdsMostText = textShare(body)
  const view = doc.defaultView
  const start = performance.now()
  const styleUntil = Math.min(deadline, start + (deadline - start) * COMPUTED_STYLE_BUDGET_SHARE)
  let styleOpen = view !== null && typeof view.getComputedStyle === 'function'
  let checks = 0
  return (el) => {
    const verdict = unsafeVerdict(el)
    if (verdict === 'remove') return true
    if (verdict === 'task') return false
    if (isBoilerplate(el, holdsMostText)) return true
    if (!styleOpen || !view) return false
    // Computed style is the costly check; it stops when its share of the budget is spent.
    if ((checks++ & 63) === 0 && performance.now() >= styleUntil) {
      styleOpen = false
      return false
    }
    try {
      return isHiddenByStyle(view.getComputedStyle(el))
    } catch {
      return false
    }
  }
}
