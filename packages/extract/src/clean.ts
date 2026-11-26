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
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.visibility === 'collapse' ||
    Number.parseFloat(style.opacity) === 0
  )
}

/** `rgb(r, g, b)` / `rgba(r, g, b, a)` as computed styles report colours; null for anything else. */
function parseRgb(value: string): [number, number, number, number] | null {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(
    value,
  )
  if (!m) return null
  let a = 1
  if (m[4] !== undefined) a = m[4].endsWith('%') ? Number.parseFloat(m[4]) / 100 : Number(m[4])
  return [Number(m[1]), Number(m[2]), Number(m[3]), a]
}

/** A `clip-path: inset(...)` or `clip: rect(...)` that leaves nothing of the box to see. */
function clippedAway(style: CSSStyleDeclaration): boolean {
  const inset = /^inset\(\s*([\d.]+)%(?:\s+([\d.]+)%)?/.exec(style.clipPath ?? '')
  if (inset) {
    const v = Number(inset[1])
    const h = inset[2] !== undefined ? Number(inset[2]) : v
    if (v >= 50 || h >= 50) return true
  }
  if (style.position === 'absolute' || style.position === 'fixed') {
    const rect =
      /^rect\(\s*(-?[\d.]+)px,?\s+(-?[\d.]+)px,?\s+(-?[\d.]+)px,?\s+(-?[\d.]+)px\s*\)$/.exec(
        style.clip ?? '',
      )
    if (rect) {
      const [top, right, bottom, left] = rect.slice(1).map(Number) as [
        number,
        number,
        number,
        number,
      ]
      if (bottom <= top || right <= left) return true
    }
  }
  return false
}

const clips = (style: CSSStyleDeclaration) =>
  (style.overflowX !== 'visible' && style.overflowX !== '') ||
  (style.overflowY !== 'visible' && style.overflowY !== '')

/**
 * What the member can see, judged on the live page. Layout checks (boxes, size, position, colour) run
 * only where layout exists: jsdom has none, and there only computed style and attributes apply.
 */
export interface Visibility {
  /** The element and everything under it are not seen. */
  hidden(el: Element): boolean
  /** The element's own text nodes are not seen; its child elements are judged on their own. */
  textHidden(el: Element): boolean
}

export function visibilityOf(doc: Document): Visibility | null {
  const view = doc.defaultView
  if (!view || typeof view.getComputedStyle !== 'function') return null
  const style = (el: Element): CSSStyleDeclaration | null => {
    try {
      return view.getComputedStyle(el)
    } catch {
      return null
    }
  }
  const body = doc.body
  // jsdom reports no boxes at all; a real page's body has one.
  const layout =
    body !== null && typeof body.getClientRects === 'function' && body.getClientRects().length > 0
  const rootStyle = doc.documentElement ? style(doc.documentElement) : null
  // The canvas behind a page that paints no background: white, unless the page asks for dark only.
  const canvasKnown = !/^\s*dark\s*$/.test(rootStyle?.colorScheme ?? '')
  const backgrounds = new Map<Element, [number, number, number] | null>()

  const parentOf = (el: Element): Element | null =>
    el.parentElement ?? (el.parentNode as { host?: Element } | null)?.host ?? null

  /** The opaque colour painted behind `el`, or null when it cannot be told (images, translucency). */
  const background = (el: Element | null): [number, number, number] | null => {
    if (!el) return canvasKnown ? [255, 255, 255] : null
    const cached = backgrounds.get(el)
    if (cached !== undefined) return cached
    const s = style(el)
    let out: [number, number, number] | null
    if (!s || (s.backgroundImage && s.backgroundImage !== 'none')) out = null
    else {
      const c = parseRgb(s.backgroundColor)
      if (c && c[3] >= 0.99) out = [c[0], c[1], c[2]]
      else if (c && c[3] > 0) out = null
      else out = background(parentOf(el))
    }
    backgrounds.set(el, out)
    return out
  }

  const inClosedDetails = (el: Element): boolean => el.closest('details:not([open])') !== null

  const hidden = (el: Element): boolean => {
    const s = style(el)
    if (!s) return false
    if (isHiddenByStyle(s)) return true
    // A light child of an open shadow host that no slot takes is never rendered.
    const parent = el.parentElement as (Element & { shadowRoot: ShadowRoot | null }) | null
    if (parent?.shadowRoot && !(el as Element & { assignedSlot: unknown }).assignedSlot) return true
    if (clippedAway(s)) return true
    if (!layout) return false
    // The content of a closed <details> is kept: the member can open it.
    if (s.display !== 'contents' && el.getClientRects().length === 0) return !inClosedDetails(el)
    if (s.display === 'contents') return false
    const r = el.getBoundingClientRect()
    if ((r.width === 0 || r.height === 0) && clips(s)) return true
    if (r.width <= 1 && r.height <= 1 && clips(s)) return true
    // Wholly left of or above the document, where no scrolling reaches.
    if (
      (r.width > 0 || r.height > 0) &&
      (r.right + view.scrollX <= 0 || r.bottom + view.scrollY <= 0)
    )
      return true
    return false
  }

  const textHidden = (el: Element): boolean => {
    let hasText = false
    let firstText: Text | null = null
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && (n as Text).data.trim()) {
        hasText = true
        firstText = n as Text
        break
      }
    }
    if (!hasText || !firstText) return false
    const s = style(el)
    if (!s) return false
    if (Number.parseFloat(s.fontSize) < 1) return true
    const color = parseRgb(s.color)
    if (color && color[3] === 0) return true
    if (!layout) return false
    // Text a closed shadow root never slots has no boxes (the root itself is unreadable from here).
    if (!inClosedDetails(el)) {
      const range = doc.createRange()
      range.selectNodeContents(firstText)
      if (range.getClientRects().length === 0) return true
    }
    if (color) {
      const bg = background(el)
      if (bg) {
        const diff =
          Math.abs(bg[0] - color[0]) + Math.abs(bg[1] - color[1]) + Math.abs(bg[2] - color[2])
        if (diff <= 6) return true
      }
    }
    return false
  }

  return { hidden, textHidden }
}

/**
 * Clone the document with what the member cannot see removed, and open shadow roots flattened into the
 * clone as they render (a deep clone never copies shadow trees). Visibility is read from the live page
 * (computed style and layout), then applied to the clone by document order, which a deep clone
 * preserves exactly.
 */
export function cloneVisible(doc: Document, deadline: number): Document {
  // Indexes are positions among the body's descendants, the same in the live page and its deep clone.
  const liveElements = doc.body ? Array.from(doc.body.getElementsByTagName('*')) : []
  const hiddenIndexes: number[] = []
  const textHiddenIndexes: number[] = []
  const hostIndexes: number[] = []
  const vis = liveElements.length <= COMPUTED_STYLE_MAX_ELEMENTS ? visibilityOf(doc) : null
  const start = performance.now()
  const stopAt = Math.min(deadline, start + (deadline - start) * COMPUTED_STYLE_BUDGET_SHARE)
  if (vis) {
    let hiddenRoot: Element | null = null
    for (let i = 0; i < liveElements.length; i++) {
      const el = liveElements[i] as Element
      if ((i & 127) === 0 && performance.now() > stopAt) break
      // Descendants of a hidden element go with it; no need to ask for their style.
      if (hiddenRoot?.contains(el)) continue
      if (vis.hidden(el)) {
        hiddenIndexes.push(i)
        hiddenRoot = el
        continue
      }
      if (vis.textHidden(el)) textHiddenIndexes.push(i)
      if ((el as Element & { shadowRoot: ShadowRoot | null }).shadowRoot) hostIndexes.push(i)
    }
  } else {
    // Without computed style, shadow hosts are still flattened.
    for (let i = 0; i < liveElements.length; i++) {
      if ((liveElements[i] as Element & { shadowRoot: ShadowRoot | null }).shadowRoot)
        hostIndexes.push(i)
    }
  }
  const clone = doc.cloneNode(true) as Document
  if (!clone.body) return clone
  const cloneElements = Array.from(clone.body.getElementsByTagName('*'))
  // Each host's light children as cloned, before anything is removed: slots pick from these.
  const hostChildren = hostIndexes.map((i) => {
    const live = liveElements[i] as Element
    const copy = cloneElements[i] as Element
    const map = new Map<Node, Node>()
    for (let k = 0; k < live.childNodes.length; k++) {
      const c = copy.childNodes[k]
      if (c) map.set(live.childNodes[k] as Node, c)
    }
    return map
  })
  for (const i of textHiddenIndexes) {
    const el = cloneElements[i] as Element
    for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) n.remove()
  }
  for (const i of hiddenIndexes) cloneElements[i]?.remove()
  hostIndexes.forEach((i, h) => {
    const live = liveElements[i] as Element & { shadowRoot: ShadowRoot }
    const copy = cloneElements[i] as Element
    const lightMap = hostChildren[h] as Map<Node, Node>
    copy.replaceChildren(flattenShadow(live.shadowRoot, lightMap, clone, vis, deadline))
  })
  return clone
}

/**
 * A shadow tree as it renders, cloned into `target`: slots replaced by the nodes assigned to them
 * (taken from `lightMap`, the host's light children already in the clone) or their fallback content,
 * nested open roots flattened the same way, and hidden parts left out.
 */
function flattenShadow(
  root: ShadowRoot,
  lightMap: Map<Node, Node>,
  target: Document,
  vis: Visibility | null,
  deadline: number,
): DocumentFragment {
  const frag = target.createDocumentFragment()
  const copy = (node: Node, into: Node, map: Map<Node, Node>): void => {
    if (performance.now() > deadline) return
    if (node.nodeType === 3) {
      into.appendChild(target.importNode(node, false))
      return
    }
    if (node.nodeType !== 1) return
    const el = node as Element & { shadowRoot: ShadowRoot | null }
    if (vis?.hidden(el)) return
    if (el.localName === 'slot') {
      const assigned = (el as unknown as HTMLSlotElement).assignedNodes()
      if (assigned.length > 0) {
        for (const a of assigned) {
          const mapped = map.get(a)
          // A light child removed as hidden has no parent left in the clone.
          if (mapped?.parentNode) into.appendChild(mapped)
        }
      } else {
        for (const c of Array.from(el.childNodes)) copy(c, into, map)
      }
      return
    }
    const out = target.importNode(el, false)
    const textOff = vis?.textHidden(el) ?? false
    if (el.shadowRoot) {
      // A nested host: its light children are cloned here, then placed by its own slots.
      const nestedMap = new Map<Node, Node>()
      const holder = target.createDocumentFragment()
      for (const c of Array.from(el.childNodes)) {
        const before = holder.childNodes.length
        copy(c, holder, map)
        const made = holder.childNodes[before]
        if (made && holder.childNodes.length === before + 1) nestedMap.set(c, made)
      }
      out.appendChild(flattenShadow(el.shadowRoot, nestedMap, target, vis, deadline))
    } else {
      for (const c of Array.from(el.childNodes)) {
        if (c.nodeType === 3 && textOff) continue
        copy(c, out, map)
      }
    }
    into.appendChild(out)
  }
  for (const c of Array.from(root.childNodes)) copy(c, frag, lightMap)
  return frag
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
export function liveSkipFilter(
  doc: Document,
  deadline: number,
): { skip: (el: Element) => boolean; skipText: (el: Element) => boolean } {
  const body = doc.body ?? doc.documentElement
  const holdsMostText = textShare(body)
  const vis = visibilityOf(doc)
  const start = performance.now()
  const styleUntil = Math.min(deadline, start + (deadline - start) * COMPUTED_STYLE_BUDGET_SHARE)
  let styleOpen = vis !== null
  let checks = 0
  // Visibility is the costly check; it stops when its share of the budget is spent.
  const styleBudget = () => {
    if (styleOpen && (checks++ & 63) === 0 && performance.now() >= styleUntil) styleOpen = false
    return styleOpen
  }
  const skip = (el: Element) => {
    const verdict = unsafeVerdict(el)
    if (verdict === 'remove') return true
    if (verdict === 'task') return false
    if (isBoilerplate(el, holdsMostText)) return true
    if (!vis || !styleBudget()) return false
    return vis.hidden(el)
  }
  const skipText = (el: Element) => (vis && styleBudget() ? vis.textHidden(el) : false)
  return { skip, skipText }
}
