import {
  elementToMarkdown,
  fencedCode,
  inlineMarkdown,
  type MdContext,
  preformattedText,
} from './markdown'
import { collapseSpaces } from './text'

/**
 * Notion page view (notion.so and notion.site). Blocks carry `data-block-id` and a
 * `notion-<type>-block` class; text lives in `[data-content-editable-leaf]` elements whose formatting
 * is inline style. Written against fixture DOMs from Notion's public structure, not a live workspace.
 * Collapsed toggles are not in the DOM, so their children cannot be captured.
 */

export interface NotionResult {
  title: string
  markdown: string
}

const BLOCK_SEL = '[data-block-id]'

function blockType(el: Element): string {
  const m = /(?:^|\s)notion-([a-z_]+)-block(?:\s|$)/.exec(el.getAttribute('class') ?? '')
  return m?.[1] ?? 'unknown'
}

/** Blocks whose nearest block ancestor inside `root` is `parent` (null: top level). */
function childBlocks(root: Element, parent: Element | null): Element[] {
  const scope = parent ?? root
  return Array.from(scope.querySelectorAll(BLOCK_SEL)).filter((el) => {
    const up = el.parentElement?.closest(BLOCK_SEL) ?? null
    if (parent) return up === parent
    return up === null || !root.contains(up)
  })
}

/** The block's own text leaf, not one belonging to a nested child block. */
function ownLeaf(block: Element): Element | null {
  for (const leaf of Array.from(block.querySelectorAll('[data-content-editable-leaf="true"]'))) {
    if (leaf.closest(BLOCK_SEL) === block) return leaf
  }
  return null
}

/** Notion marks formatting with inline styles; turn them into elements the Markdown converter knows. */
function semanticizeStyles(root: Element): void {
  const doc = root.ownerDocument
  for (const span of Array.from(root.querySelectorAll('span[style]'))) {
    const style = (span.getAttribute('style') ?? '').toLowerCase()
    let tag: string | null = null
    if (/font-family:[^;]*mono/.test(style)) tag = 'code'
    else if (/font-weight:\s*(600|700|bold)/.test(style)) tag = 'strong'
    else if (/font-style:\s*italic/.test(style)) tag = 'em'
    else if (/text-decoration:[^;]*line-through/.test(style)) tag = 's'
    if (!tag) continue
    const repl = doc.createElement(tag)
    while (span.firstChild) repl.appendChild(span.firstChild)
    span.replaceWith(repl)
  }
}

interface Out {
  text: string
  /** List family: consecutive items of one family are a tight list; a change of family starts a new one. */
  list: 'bullet' | 'number' | null
}

function indent(text: string, by: number): string {
  const pad = ' '.repeat(by)
  return text
    .split('\n')
    .map((l) => (l ? pad + l : l))
    .join('\n')
}

function join(outs: Out[]): string {
  let s = ''
  outs.forEach((o, i) => {
    if (!o.text) return
    if (!s) s = o.text
    else s += o.list !== null && outs[i - 1]?.list === o.list ? `\n${o.text}` : `\n\n${o.text}`
  })
  return s
}

function renderBlocks(root: Element, parent: Element | null, ctx: MdContext): Out[] {
  const outs: Out[] = []
  let number = 0
  for (const block of childBlocks(root, parent)) {
    if (ctx.stopped) break
    const type = blockType(block)
    number = type === 'numbered_list' ? number + 1 : 0
    const out = renderBlock(root, block, type, number, ctx)
    if (out) outs.push(out)
  }
  return outs
}

function leafText(block: Element, ctx: MdContext): string {
  const leaf = ownLeaf(block)
  return leaf ? inlineMarkdown(leaf, ctx) : ''
}

function withChildren(
  root: Element,
  block: Element,
  head: string,
  by: number,
  ctx: MdContext,
): string {
  const kids = join(renderBlocks(root, block, ctx))
  return kids ? `${head}\n${indent(kids, by)}` : head
}

function renderBlock(
  root: Element,
  block: Element,
  type: string,
  n: number,
  ctx: MdContext,
): Out | null {
  switch (type) {
    case 'header':
    case 'sub_header':
    case 'sub_sub_header': {
      const t = leafText(block, ctx)
      const level = type === 'header' ? 1 : type === 'sub_header' ? 2 : 3
      return t ? { text: `${'#'.repeat(level)} ${t}`, list: null } : null
    }
    case 'bulleted_list':
    case 'toggle':
      return {
        text: withChildren(root, block, `- ${leafText(block, ctx)}`, 2, ctx),
        list: 'bullet',
      }
    case 'numbered_list': {
      const marker = `${n}.`
      return {
        text: withChildren(
          root,
          block,
          `${marker} ${leafText(block, ctx)}`,
          marker.length + 1,
          ctx,
        ),
        list: 'number',
      }
    }
    case 'to_do': {
      const checked =
        block.querySelector('[role="checkbox"]')?.getAttribute('aria-checked') === 'true'
      return {
        text: withChildren(
          root,
          block,
          `- [${checked ? 'x' : ' '}] ${leafText(block, ctx)}`,
          2,
          ctx,
        ),
        list: 'bullet',
      }
    }
    case 'quote': {
      const t = leafText(block, ctx)
      return t
        ? {
            text: t
              .split('\n')
              .map((l) => `> ${l}`)
              .join('\n'),
            list: null,
          }
        : null
    }
    case 'callout': {
      const icon = collapseSpaces(block.querySelector('.notion-record-icon')?.textContent ?? '')
      const t = leafText(block, ctx)
      if (!t) return null
      return { text: `> ${icon ? `${icon} ` : ''}${t.split('\n').join('\n> ')}`, list: null }
    }
    case 'code': {
      const leaf = ownLeaf(block)
      if (!leaf) return null
      const code = preformattedText(leaf, ctx)
      const label = collapseSpaces(
        block.querySelector('[role="button"]')?.textContent ?? '',
      ).toLowerCase()
      const lang =
        label && label !== 'plain text' && /^[\w+#. -]{1,32}$/.test(label)
          ? label.replace(/\s+/g, '')
          : null
      return code.trim() ? { text: fencedCode(code, lang), list: null } : null
    }
    case 'divider':
      return { text: '---', list: null }
    case 'image': {
      const img = block.querySelector('img')
      const caption = leafText(block, ctx)
      const imgMd = img ? elementToMarkdown(wrapForImage(img), ctx) : ''
      return { text: [imgMd, caption].filter(Boolean).join('\n\n'), list: null }
    }
    case 'table': {
      const table = block.querySelector('table')
      return table ? { text: elementToMarkdown(wrapForImage(table), ctx), list: null } : null
    }
    case 'page':
    case 'alias': {
      // A link to a sub-page renders as its title.
      const t = leafText(block, ctx) || collapseSpaces(block.textContent ?? '')
      return t ? { text: t, list: null } : null
    }
    default: {
      const kids = renderBlocks(root, block, ctx)
      const own = leafText(block, ctx)
      if (kids.length)
        return { text: join([...(own ? [{ text: own, list: null }] : []), ...kids]), list: null }
      if (own) return { text: own, list: null }
      // Unknown block types (embeds, databases) still contribute whatever text they render.
      const md = elementToMarkdown(block, ctx)
      return md ? { text: md, list: null } : null
    }
  }
}

/** elementToMarkdown converts children, so give a single element a parent of its own on the clone. */
function wrapForImage(el: Element): Element {
  const wrapper = el.ownerDocument.createElement('div')
  wrapper.appendChild(el.cloneNode(true))
  return wrapper
}

export function extractNotion(doc: Document, ctx: MdContext): NotionResult | null {
  const root = doc.querySelector('.notion-page-content')
  if (!root) return null
  semanticizeStyles(root)
  const titleLeaf = doc.querySelector(
    '.notion-page-block [data-content-editable-leaf="true"], .notion-page-block h1',
  )
  const title =
    collapseSpaces(titleLeaf?.textContent ?? '') ||
    collapseSpaces(doc.title).replace(/\s*\|\s*Notion$/, '')
  const markdown = join(renderBlocks(root, null, ctx))
  if (!markdown && !title) return null
  return { title, markdown }
}
