import { collapseSpaces, dropsSegmentBreak } from './text'

/**
 * HTML to GitHub-flavoured Markdown, written for this package rather than taken from Turndown so that
 * the rules that matter for retrieval are ours: no whitespace injected between Japanese characters,
 * ruby readings dropped, data: URIs never emitted, links made absolute, and a work budget honoured.
 */

export interface MdContext {
  base: URL | null
  /** `performance.now()` value after which conversion stops. */
  deadline: number
  maxChars: number
  chars: number
  nodes: number
  stopped: boolean
  /**
   * Read-only filter for converting a live DOM without cloning it: true skips the element and its
   * subtree. Unset when the input is an already-cleaned clone.
   */
  skip: ((el: Element) => boolean) | null
  /**
   * Live DOM only: true when the element's own text nodes cannot be seen (zero font size, text in the
   * background colour) while its child elements are judged on their own.
   */
  skipText: ((el: Element) => boolean) | null
  /** Per-extraction cache; a module-level cache would go stale when a live page changes. */
  blockMemo: WeakMap<Element, boolean>
}

export function createContext(
  base: string | null,
  opts: { deadline: number; maxChars: number },
): MdContext {
  let parsed: URL | null = null
  if (base) {
    try {
      parsed = new URL(base)
    } catch {
      parsed = null
    }
  }
  return {
    base: parsed,
    deadline: opts.deadline,
    maxChars: opts.maxChars,
    chars: 0,
    nodes: 0,
    stopped: false,
    skip: null,
    skipText: null,
    blockMemo: new WeakMap(),
  }
}

/** Convert the children of `root` to Markdown. */
export function elementToMarkdown(root: Element, ctx: MdContext): string {
  return joinBlocks(renderChildren(root, ctx))
}

/** Convert the inline content of `el` to one line of Markdown (used for titles, cells, Slack names). */
export function inlineMarkdown(el: Element, ctx: MdContext): string {
  const line = new Inline()
  renderInlineChildren(el, line, ctx)
  return line.finish().replace(/\n+/g, ' ').trim()
}

// ── Element classes ─────────────────────────────────────────────────────────

const BLOCK = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'center',
  'dd',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'hr',
  'li',
  'main',
  'menu',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
  'caption',
  'legend',
  'listing',
  'xmp',
])

/** Never content, even if the cleaner missed them. */
const SKIP = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'head',
  'title',
  'meta',
  'link',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'svg',
  'math',
  'canvas',
  'audio',
  'video',
  'source',
  'track',
  'map',
  'input',
  'textarea',
  'select',
  'option',
  'optgroup',
  'datalist',
  'rt',
  'rp',
  'dialog',
])

/** Marker element the cleaner leaves in place of a checkbox, so task lists survive input removal. */
export const TASK_TAG = 'tiger-task'

/**
 * Children in the flat tree, as rendered: an element with an open shadow root shows its shadow tree
 * (its unslotted light children are never on screen), and a <slot> inside a shadow tree shows the nodes
 * assigned to it, or its fallback content. On a clone there are no shadow roots and this is childNodes.
 */
function flatChildren(el: Element): ArrayLike<Node> {
  const root = (el as Element & { shadowRoot: ShadowRoot | null }).shadowRoot
  if (root) return root.childNodes
  if (el.localName === 'slot' && (el.getRootNode() as { host?: Element }).host) {
    const assigned = (el as HTMLSlotElement).assignedNodes?.() ?? []
    if (assigned.length > 0) return assigned
  }
  return el.childNodes
}

function tagOf(el: Element): string {
  return el.localName.toLowerCase()
}

function isBlockTag(tag: string): boolean {
  // Custom elements are almost always layout components; treating them as blocks keeps their text from
  // running into the neighbour's.
  return BLOCK.has(tag) || (tag.includes('-') && tag !== TASK_TAG)
}

/** Whether an inline-level element holds block content and must be rendered as a block container. */
function containsBlock(el: Element, ctx: MdContext): boolean {
  const cached = ctx.blockMemo.get(el)
  if (cached !== undefined) return cached
  let found = false
  const kids = flatChildren(el)
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i] as Node
    if (c.nodeType !== 1) continue
    const tag = tagOf(c as Element)
    if (SKIP.has(tag)) continue
    if (isBlockTag(tag) || containsBlock(c as Element, ctx)) {
      found = true
      break
    }
  }
  ctx.blockMemo.set(el, found)
  return found
}

function tick(ctx: MdContext): boolean {
  if (ctx.stopped) return false
  ctx.nodes += 1
  if ((ctx.nodes & 255) === 0 && performance.now() > ctx.deadline) ctx.stopped = true
  if (ctx.chars > ctx.maxChars) ctx.stopped = true
  return !ctx.stopped
}

// ── Inline content ──────────────────────────────────────────────────────────

type Part =
  | { k: 'text'; v: string }
  | { k: 'ws'; nl: boolean }
  | { k: 'mark'; v: string }
  | { k: 'br' }

/** HTML whitespace runs or runs of anything else; U+3000 and NBSP are content, not gaps. */
const TOKEN = /([ \t\n\r\f]+)|[^ \t\n\r\f]+/g

class Inline {
  parts: Part[] = []

  /** Raw DOM text: HTML whitespace runs become collapsible gaps, everything else is escaped. */
  text(raw: string, ctx: MdContext): void {
    ctx.chars += raw.length
    for (const m of raw.matchAll(TOKEN)) {
      if (m[1] !== undefined) this.ws(/[\n\r]/.test(m[1]))
      else this.parts.push({ k: 'text', v: escapeInline(m[0].replace(/\u00a0/g, ' ')) })
    }
  }

  /** Already-formatted text that must not be escaped (code spans, images). */
  literal(v: string): void {
    if (v) this.parts.push({ k: 'text', v })
  }

  ws(nl: boolean): void {
    const last = this.parts[this.parts.length - 1]
    if (last && last.k === 'ws') {
      last.nl = last.nl || nl
      return
    }
    this.parts.push({ k: 'ws', nl })
  }

  mark(v: string): void {
    this.parts.push({ k: 'mark', v })
  }

  br(): void {
    this.parts.push({ k: 'br' })
  }

  hasText(): boolean {
    return this.parts.some((p) => p.k === 'text' && p.v.trim() !== '')
  }

  /** Move leading and trailing gaps out, so emphasis markers hug the text they wrap. */
  takeEdges(): { lead: Part | null; trail: Part | null } {
    let lead: Part | null = null
    let trail: Part | null = null
    if (this.parts[0]?.k === 'ws') lead = this.parts.shift() ?? null
    if (this.parts[this.parts.length - 1]?.k === 'ws') trail = this.parts.pop() ?? null
    return { lead, trail }
  }

  append(other: Inline): void {
    for (const p of other.parts) {
      if (p.k === 'ws') this.ws(p.nl)
      else this.parts.push(p)
    }
  }

  finish(): string {
    let out = ''
    let prevChar: string | undefined
    const parts = this.parts
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i] as Part
      if (p.k === 'text') {
        out += p.v
        prevChar = p.v[p.v.length - 1]
      } else if (p.k === 'mark') {
        out += p.v
      } else if (p.k === 'br') {
        out = out.replace(/ +$/, '')
        out += '\n'
        prevChar = undefined
      } else {
        if (prevChar === undefined) continue
        const next = nextTextChar(parts, i + 1)
        if (next === undefined) continue
        if (p.nl && dropsSegmentBreak(prevChar, next)) continue
        out += ' '
        prevChar = ' '
      }
    }
    return out
      .split('\n')
      .map((line) => escapeLineStart(line.trim()))
      .join('\n')
      .trim()
  }
}

function nextTextChar(parts: Part[], from: number): string | undefined {
  for (let j = from; j < parts.length; j++) {
    const q = parts[j] as Part
    if (q.k === 'text') return q.v[0]
    if (q.k === 'br') return undefined
  }
  return undefined
}

function escapeInline(s: string): string {
  return s
    .replace(/[\\`*[\]]/g, '\\$&')
    .replace(/(^|[^A-Za-z0-9])_|_(?=$|[^A-Za-z0-9])/g, (m) => m.replace('_', '\\_'))
    .replace(/<(?=[A-Za-z/!?])/g, '\\<')
}

function escapeLineStart(line: string): string {
  return line
    .replace(/^(#{1,6})(?=\s|$)/, '\\$1')
    .replace(/^>/, '\\>')
    .replace(/^([-+])(?=\s)/, '\\$1')
    .replace(/^(\d+)([.)])(?=\s|$)/, '$1\\$2')
    .replace(/^(=+|-+)$/, '\\$1')
    .replace(/^(~~~)/, '\\$1')
}

function renderInlineChildren(el: Element, line: Inline, ctx: MdContext): void {
  const textOff = ctx.skipText?.(el) ?? false
  const kids = flatChildren(el)
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i] as Node
    if (ctx.stopped) return
    if (n.nodeType === 3) {
      if (!textOff) line.text((n as Text).data, ctx)
    }
    else if (n.nodeType === 1 && !ctx.skip?.(n as Element)) renderInline(n as Element, line, ctx)
  }
}

function wrap(el: Element, line: Inline, ctx: MdContext, open: string, close: string): void {
  const inner = new Inline()
  renderInlineChildren(el, inner, ctx)
  if (!inner.hasText()) {
    line.append(inner)
    return
  }
  const { lead, trail } = inner.takeEdges()
  if (lead?.k === 'ws') line.ws(lead.nl)
  line.mark(open)
  line.append(inner)
  line.mark(close)
  if (trail?.k === 'ws') line.ws(trail.nl)
}

function renderInline(el: Element, line: Inline, ctx: MdContext): void {
  if (!tick(ctx)) return
  const tag = tagOf(el)
  if (tag === 'input') {
    // Only reached on a live DOM (the cleaner replaces checkboxes on clones). Never read a value.
    const input = el as HTMLInputElement
    if ((el.getAttribute('type') ?? '').toLowerCase() === 'checkbox')
      line.mark(input.checked ? '[x] ' : '[ ] ')
    return
  }
  if (SKIP.has(tag)) return
  switch (tag) {
    case 'br':
      line.br()
      return
    case 'wbr':
      return
    case 'strong':
    case 'b':
      wrap(el, line, ctx, '**', '**')
      return
    case 'em':
    case 'i':
    case 'cite':
    case 'dfn':
      wrap(el, line, ctx, '*', '*')
      return
    case 'del':
    case 's':
    case 'strike':
      wrap(el, line, ctx, '~~', '~~')
      return
    case 'code':
    case 'kbd':
    case 'samp':
    case 'tt':
    case 'var':
      line.literal(codeSpan(el.textContent ?? ''))
      return
    case 'a':
      renderLink(el, line, ctx)
      return
    case 'img':
      line.literal(imageMarkdown(el, ctx))
      return
    case 'q':
      line.literal('"')
      renderInlineChildren(el, line, ctx)
      line.literal('"')
      return
    case 'ruby':
      // Base text only: the reading in <rt> would otherwise be glued to the word it annotates.
      renderInlineChildren(el, line, ctx)
      return
    case TASK_TAG:
      line.mark(el.getAttribute('checked') !== null ? '[x] ' : '[ ] ')
      return
    default:
      if (isBlockTag(tag)) {
        // A block that ended up inside inline content (e.g. a div in a table cell): keep it on its own line.
        line.br()
        renderInlineChildren(el, line, ctx)
        line.br()
        return
      }
      renderInlineChildren(el, line, ctx)
  }
}

function codeSpan(raw: string): string {
  const text = raw.replace(/[\r\n]+/g, ' ')
  if (!text.trim()) return ''
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length))
  const fence = '`'.repeat(longest + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}

export function absoluteUrl(raw: string | null, ctx: MdContext): string | null {
  if (!raw) return null
  const value = raw.trim()
  if (!value) return null
  try {
    const url = ctx.base ? new URL(value, ctx.base) : new URL(value)
    if (url.protocol === 'javascript:' || url.protocol === 'data:' || url.protocol === 'blob:')
      return null
    return url.href
  } catch {
    return null
  }
}

function markdownUrl(url: string): string {
  return url.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
}

function renderLink(el: Element, line: Inline, ctx: MdContext): void {
  const href = el.getAttribute('href')
  const url = absoluteUrl(href, ctx)
  // In-page anchors point nowhere once the text leaves the page; keep only their text.
  const samePageAnchor =
    href?.trim().startsWith('#') ||
    (url !== null &&
      ctx.base !== null &&
      stripHash(url) === stripHash(ctx.base.href) &&
      url.includes('#'))
  if (!url || samePageAnchor) {
    renderInlineChildren(el, line, ctx)
    return
  }
  wrap(el, line, ctx, '[', `](${markdownUrl(url)})`)
}

function stripHash(u: string): string {
  const i = u.indexOf('#')
  return i < 0 ? u : u.slice(0, i)
}

const LAZY_SRC_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-url']

function imageSource(el: Element): string | null {
  const candidates = [el.getAttribute('src'), ...LAZY_SRC_ATTRS.map((a) => el.getAttribute(a))]
  const srcset = el.getAttribute('srcset') ?? el.getAttribute('data-srcset')
  if (srcset) candidates.push(srcset.split(',')[0]?.trim().split(/\s+/)[0] ?? null)
  for (const c of candidates) {
    if (c && !/^\s*(data|blob):/i.test(c)) return c
  }
  return null
}

function imageMarkdown(el: Element, ctx: MdContext): string {
  const alt = collapseSpaces(el.getAttribute('alt') ?? '')
  const cls = el.getAttribute('class') ?? ''
  // Emoji images (Slack, Twemoji, WordPress) carry the meaning in their alt text.
  if (el.hasAttribute('data-stringify-emoji') || /\bemoji\b/i.test(cls)) {
    return escapeInline(el.getAttribute('data-stringify-emoji') ?? alt)
  }
  const width = el.getAttribute('width')
  const height = el.getAttribute('height')
  if (width === '1' && height === '1') return ''
  const url = absoluteUrl(imageSource(el), ctx)
  const altText = alt.replace(/[[\]\\]/g, '\\$&')
  if (!url) return altText ? `![${altText}]` : ''
  return `![${altText}](${markdownUrl(url)})`
}

// ── Blocks ──────────────────────────────────────────────────────────────────

export interface Block {
  kind: 'p' | 'h' | 'list' | 'code' | 'quote' | 'table' | 'hr'
  text: string
}

export function joinBlocks(blocks: Block[]): string {
  return blocks
    .map((b) => b.text)
    .filter((t) => t !== '')
    .join('\n\n')
}

export function renderChildren(el: Element, ctx: MdContext): Block[] {
  const out: Block[] = []
  let line = new Inline()
  const flush = () => {
    const text = line.finish()
    if (text) out.push({ kind: 'p', text })
    line = new Inline()
  }
  const textOff = ctx.skipText?.(el) ?? false
  const kids = flatChildren(el)
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i] as Node
    if (ctx.stopped) break
    if (n.nodeType === 3) {
      if (!textOff) line.text((n as Text).data, ctx)
      continue
    }
    if (n.nodeType !== 1) continue
    const child = n as Element
    const tag = tagOf(child)
    if (SKIP.has(tag) && tag !== 'input') continue
    if (ctx.skip?.(child)) continue
    if (isBlockTag(tag) || containsBlock(child, ctx)) {
      flush()
      for (const b of renderBlock(child, ctx)) out.push(b)
    } else {
      renderInline(child, line, ctx)
    }
  }
  flush()
  return out
}

function renderBlock(el: Element, ctx: MdContext): Block[] {
  if (!tick(ctx)) return []
  const tag = tagOf(el)
  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const text = inlineMarkdown(el, ctx)
      return text ? [{ kind: 'h', text: `${'#'.repeat(Number(tag[1]))} ${text}` }] : []
    }
    case 'ul':
    case 'ol':
    case 'menu':
    case 'dir':
      return renderList(el, tag === 'ol', ctx)
    case 'li':
      return renderList(el, false, ctx, [el])
    case 'pre':
    case 'listing':
    case 'xmp':
      return codeBlock(el, ctx)
    case 'blockquote': {
      const inner = joinBlocks(renderChildren(el, ctx))
      if (!inner) return []
      const text = inner
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n')
      return [{ kind: 'quote', text }]
    }
    case 'table':
      return renderTable(el, ctx)
    case 'hr':
      return [{ kind: 'hr', text: '---' }]
    case 'dt': {
      const text = inlineMarkdown(el, ctx)
      return text ? [{ kind: 'p', text: `**${text}**` }] : []
    }
    default:
      return renderChildren(el, ctx)
  }
}

function renderList(el: Element, ordered: boolean, ctx: MdContext, only?: Element[]): Block[] {
  const items: Element[][] = []
  if (only) items.push(only)
  else {
    const kids = flatChildren(el)
    for (let i = 0; i < kids.length; i++) {
      if ((kids[i] as Node).nodeType !== 1) continue
      const c = kids[i] as Element
      const tag = tagOf(c)
      if (SKIP.has(tag) || ctx.skip?.(c)) continue
      // A list nested directly in a list (invalid but common) belongs to the previous item.
      if (tag !== 'li' && items.length > 0 && (tag === 'ul' || tag === 'ol')) {
        items[items.length - 1]?.push(c)
      } else {
        items.push([c])
      }
    }
  }
  const startAttr = Number.parseInt(el.getAttribute('start') ?? '', 10)
  let n = ordered && Number.isFinite(startAttr) ? startAttr : 1
  const lines: string[] = []
  for (const group of items) {
    if (ctx.stopped) break
    const blocks: Block[] = []
    for (const part of group) {
      if (tagOf(part) === 'li') blocks.push(...renderChildren(part, ctx))
      else blocks.push(...renderBlock(part, ctx))
    }
    let body = ''
    for (const b of blocks) {
      if (!b.text) continue
      if (!body) body = b.text
      else body += b.kind === 'list' ? `\n${b.text}` : `\n\n${b.text}`
    }
    if (!body) continue
    const marker = ordered ? `${n}.` : '-'
    n += 1
    const indent = ' '.repeat(marker.length + 1)
    const [first, ...rest] = body.split('\n')
    lines.push(`${marker} ${first}`)
    for (const r of rest) lines.push(r ? indent + r : '')
  }
  return lines.length ? [{ kind: 'list', text: lines.join('\n') }] : []
}

const LANG_PATTERNS = [
  /(?:^|\s)(?:language|lang)-([\w+#.-]+)/i,
  /(?:^|\s)highlight-(?:source-)?([\w+#-]+)/i,
  /brush:\s*([\w+#-]+)/i,
]

function languageOf(el: Element | null): string | null {
  for (let e = el, depth = 0; e && depth < 3; e = e.parentElement, depth++) {
    const direct = e.getAttribute('data-lang') ?? e.getAttribute('data-language')
    if (direct && /^[\w+#.-]{1,32}$/.test(direct)) return direct.toLowerCase()
    const cls = e.getAttribute('class') ?? ''
    for (const re of LANG_PATTERNS) {
      const m = re.exec(cls)
      if (m?.[1]) return m[1].toLowerCase()
    }
  }
  return null
}

const LINE_BLOCKS = new Set(['div', 'p', 'li', 'tr'])

/** Text of a <pre>, keeping line structure from <br> and per-line block wrappers used by highlighters. */
export function preformattedText(el: Element, ctx: MdContext): string {
  let out = ''
  const walk = (node: Element) => {
    const textOff = ctx.skipText?.(node) ?? false
    const kids = flatChildren(node)
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i] as Node
      if (n.nodeType === 3) {
        if (textOff) continue
        const data = (n as Text).data
        ctx.chars += data.length
        out += data
      } else if (n.nodeType === 1) {
        const tag = tagOf(n as Element)
        if (SKIP.has(tag) || ctx.skip?.(n as Element)) continue
        if (tag === 'br') {
          out += '\n'
          continue
        }
        walk(n as Element)
        if (LINE_BLOCKS.has(tag) && !out.endsWith('\n')) out += '\n'
      }
    }
  }
  walk(el)
  return out.replace(/\r\n?/g, '\n').replace(/^\n/, '').replace(/\s+$/, '')
}

export function fencedCode(code: string, lang: string | null): string {
  const longest = Math.max(2, ...(code.match(/^\s*`{3,}/gm) ?? []).map((r) => r.trim().length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}${lang ?? ''}\n${code}\n${fence}`
}

function codeBlock(el: Element, ctx: MdContext): Block[] {
  const code = preformattedText(el, ctx)
  if (!code.trim()) return []
  const lang = languageOf(el.querySelector('code')) ?? languageOf(el)
  return [{ kind: 'code', text: fencedCode(code, lang) }]
}

// ── Tables ──────────────────────────────────────────────────────────────────

function ownRows(table: Element): Element[] {
  const rows: Element[] = []
  for (let c = table.firstElementChild; c; c = c.nextElementSibling) {
    const tag = tagOf(c)
    if (tag === 'tr') rows.push(c)
    else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
      for (let r = c.firstElementChild; r; r = r.nextElementSibling)
        if (tagOf(r) === 'tr') rows.push(r)
    }
  }
  return rows
}

function ownCells(row: Element): Element[] {
  const cells: Element[] = []
  for (let c = row.firstElementChild; c; c = c.nextElementSibling) {
    const tag = tagOf(c)
    if (tag === 'td' || tag === 'th') cells.push(c)
  }
  return cells
}

function isLayoutTable(table: Element, rows: Element[]): boolean {
  const role = table.getAttribute('role')
  if (role === 'presentation' || role === 'none') return true
  if (table.querySelector('table, h1, h2, h3, h4, h5, h6, pre, blockquote')) return true
  const maxCols = Math.max(0, ...rows.map((r) => ownCells(r).length))
  return maxCols <= 1
}

function cellText(cell: Element, ctx: MdContext): string {
  const text = joinBlocks(renderChildren(cell, ctx))
  return text.replace(/\n+/g, '<br>').replace(/\|/g, '\\|').trim()
}

const MAX_SPAN = 50

function spanOf(cell: Element, attr: 'colspan' | 'rowspan'): number {
  const n = Number.parseInt(cell.getAttribute(attr) ?? '1', 10)
  // rowspan="0" spans to the end of the section; the row count bounds it anyway.
  if (attr === 'rowspan' && n === 0) return MAX_SPAN
  return Math.min(Math.max(Number.isFinite(n) ? n : 1, 1), MAX_SPAN)
}

/**
 * The table as a grid, each cell at its real column: a cell spanning rows occupies its columns in the
 * rows below, so later cells there move right instead of sliding under the wrong header. A row-spanning
 * value is repeated in each row it covers (every row then reads on its own); the extra columns of a
 * colspan are left empty.
 */
function tableGrid(rows: Element[], ctx: MdContext): string[][] {
  const grid: string[][] = []
  // Column → value carried down and the number of further rows it covers.
  const carry = new Map<number, { text: string; rows: number }>()
  for (const row of rows) {
    const out: string[] = []
    const place = () => {
      for (;;) {
        const c = carry.get(out.length)
        if (!c) return
        out.push(c.text)
        c.rows -= 1
        if (c.rows <= 0) carry.delete(out.length - 1)
      }
    }
    for (const cell of ownCells(row)) {
      place()
      const text = cellText(cell, ctx)
      const colspan = spanOf(cell, 'colspan')
      const rowspan = spanOf(cell, 'rowspan')
      for (let s = 0; s < colspan; s++) {
        const value = s === 0 ? text : ''
        if (rowspan > 1) carry.set(out.length, { text: value, rows: rowspan - 1 })
        out.push(value)
      }
    }
    // Carried cells beyond this row's own cells still take their columns (and use up a row).
    const lastCarried = Math.max(-1, ...carry.keys())
    while (out.length <= lastCarried) {
      if (carry.has(out.length)) place()
      else out.push('')
    }
    grid.push(out)
  }
  return grid
}

function renderTable(table: Element, ctx: MdContext): Block[] {
  const rows = ownRows(table)
  if (rows.length === 0) return []
  if (isLayoutTable(table, rows)) {
    const blocks: Block[] = []
    for (const r of rows) for (const c of ownCells(r)) blocks.push(...renderChildren(c, ctx))
    return blocks
  }
  const grid = tableGrid(rows, ctx)
  const cols = Math.max(...grid.map((r) => r.length))
  for (const r of grid) while (r.length < cols) r.push('')
  const lines: string[] = []
  const caption = table.querySelector('caption')
  const blocks: Block[] = []
  if (caption) {
    const text = inlineMarkdown(caption, ctx)
    if (text) blocks.push({ kind: 'p', text })
  }
  // GFM requires a header row; without <th> the first row is the best stand-in.
  const header = grid.shift()
  lines.push(`| ${(header ?? []).join(' | ')} |`)
  lines.push(`| ${Array.from({ length: cols }, () => '---').join(' | ')} |`)
  for (const r of grid) lines.push(`| ${r.join(' | ')} |`)
  blocks.push({ kind: 'table', text: lines.join('\n') })
  return blocks
}
