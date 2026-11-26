import { Readability } from '@mozilla/readability'
import { sourceTypeForUrl } from '@tiger/shared/classify'
import { cloneVisible, liveSkipFilter, stripBoilerplate, stripUnsafe } from './clean'
import { declaredLang, resolveLang } from './lang'
import { createContext, elementToMarkdown, type MdContext } from './markdown'
import { extractNotion } from './notion'
import { extractSlack } from './slack'
import { clip, collapseSpaces, tidyMarkdown } from './text'
import type { DomExtractOptions, Extraction } from './types'

export type { DomExtractOptions, Extraction } from './types'

/**
 * Browser-safe entry: bundled into the sandboxed extraction preload and run in the isolated world.
 * No Node APIs. The live document is read, never written: all cleaning happens on a deep clone.
 */

/** Default wall-clock budget. Conversion stops at the deadline and the result is marked truncated. */
export const DEFAULT_TIME_BUDGET_MS = 2_000
/**
 * Text collected before conversion stops. Twice the contract limit, so `finalizePage` can still cut on
 * a block boundary; this bounds work, the contract limit is enforced there.
 */
export const DEFAULT_MAX_CHARS = 1_200_000
/** Readability is not interruptible; beyond this many elements the cheaper landmark path is used. */
export const READABILITY_MAX_ELEMENTS = 30_000

/** Above this much landmark text, Readability may keep a smaller share (a long page with heavy furniture). */
const VERY_LONG_PAGE_CHARS = 60_000

const READABILITY_VERSION = 'readability@0.6'
const DOM_EXTRACTOR = 'tiger-dom@1'

export function extractFromDocument(
  doc: Document,
  url: string,
  options: DomExtractOptions = {},
): Extraction | null {
  const start = performance.now()
  const deadline = start + (options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS)
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS

  const declared = declaredLang(doc)
  const kind = appKind(url)
  const appPage = kind === 'slack' || kind === 'notion'

  if (!appPage && doc.getElementsByTagName('*').length > READABILITY_MAX_ELEMENTS) {
    return extractLive(doc, url, declared, deadline, maxChars)
  }

  const clone = cloneVisible(doc, deadline)
  stripUnsafe(clone)
  const ctx = createContext(baseUrl(clone, url), { deadline, maxChars })

  if (kind === 'slack') {
    const slack = extractSlack(clone, ctx)
    if (slack) {
      return finish(ctx, {
        title: slack.title,
        markdown: slack.markdown,
        // Slack's html lang is the member's UI language, not the conversation's.
        lang: resolveLang(null, slack.markdown) ?? declared,
        byline: null,
        siteName: slack.siteName,
        extractor: 'slack-dom@1',
      })
    }
  }
  if (kind === 'notion') {
    const notion = extractNotion(clone, ctx)
    if (notion) {
      return finish(ctx, {
        title: notion.title,
        markdown: notion.markdown,
        lang: resolveLang(null, notion.markdown) ?? declared,
        byline: null,
        siteName: 'Notion',
        extractor: 'notion-dom@1',
      })
    }
  }

  const meta = readMeta(clone)
  stripBoilerplate(clone)
  const main = mainContent(clone)

  const markdown = main.element ? elementToMarkdown(main.element, ctx) : ''
  return finish(ctx, {
    title: withoutSiteSuffix(main.title || meta.title, meta.siteName || main.siteName),
    markdown,
    lang: resolveLang(declared, stripLinkTargets(markdown)),
    byline: main.byline || meta.byline,
    siteName: meta.siteName || main.siteName,
    extractor: main.extractor,
  })
}

/**
 * Very large DOMs: cloning alone could spend the budget, and Readability would not run on them anyway.
 * Convert the page's main landmark in place through a read-only filter that makes the same decisions
 * as the cleaners. Nothing on the page is written.
 */
function extractLive(
  doc: Document,
  url: string,
  declared: string | null,
  deadline: number,
  maxChars: number,
): Extraction | null {
  const ctx = createContext(baseUrl(doc, url), { deadline, maxChars })
  const filter = liveSkipFilter(doc, deadline)
  ctx.skip = filter.skip
  ctx.skipText = filter.skipText
  const meta = readMeta(doc)
  const markdown = elementToMarkdown(landmarkOf(doc), ctx)
  return finish(ctx, {
    title: withoutSiteSuffix(meta.title, meta.siteName),
    markdown,
    lang: resolveLang(declared, stripLinkTargets(markdown)),
    byline: meta.byline,
    siteName: meta.siteName,
    extractor: DOM_EXTRACTOR,
  })
}

/** `Retry policies - Gateway Docs` → `Retry policies`; the site name is kept separately. */
export function withoutSiteSuffix(title: string, siteName: string | null): string {
  if (!siteName) return title
  for (const sep of [' - ', ' | ', ' – ', ' — ', '｜', ' :: ', ' · ']) {
    const suffix = `${sep}${siteName}`
    if (title.endsWith(suffix) && title.length > suffix.length)
      return title.slice(0, -suffix.length).trim()
  }
  return title
}

function landmarkOf(doc: Document): Element {
  const main = doc.querySelector('main, [role="main"]')
  if (main) return main
  const articles = doc.getElementsByTagName('article')
  if (articles.length === 1) return articles[0] as Element
  return doc.body ?? doc.documentElement
}

/**
 * Which app handler a URL gets, from the shared URL classification. Imported from the zod-free
 * `@tiger/shared/classify` entry because this module is bundled into the per-tab preload.
 */
export function appKind(rawUrl: string): 'slack' | 'notion' | null {
  const type = sourceTypeForUrl(rawUrl)
  return type === 'slack' || type === 'notion' ? type : null
}

function finish(ctx: MdContext, ex: Extraction): Extraction | null {
  const markdown = tidyMarkdown(ex.markdown)
  if (!markdown) return null
  const out: Extraction = {
    title: clip(collapseSpaces(ex.title), 500),
    markdown,
    lang: ex.lang,
    byline: ex.byline ? clip(collapseSpaces(ex.byline), 200) || null : null,
    siteName: ex.siteName ? clip(collapseSpaces(ex.siteName), 200) || null : null,
    extractor: ex.extractor,
  }
  if (ctx.stopped) out.truncated = true
  return out
}

function baseUrl(doc: Document, url: string): string {
  const href = doc.querySelector('base[href]')?.getAttribute('href')
  if (!href) return url
  try {
    return new URL(href, url).href
  } catch {
    return url
  }
}

function stripLinkTargets(md: string): string {
  return md.replace(/\]\([^)]*\)/g, ']')
}

interface Meta {
  title: string
  byline: string | null
  siteName: string | null
}

function metaContent(doc: Document, selector: string): string | null {
  const v = doc.querySelector(selector)?.getAttribute('content')
  const s = v ? collapseSpaces(v) : ''
  return s || null
}

function readMeta(doc: Document): Meta {
  const title =
    metaContent(doc, 'meta[property="og:title"]') ??
    metaContent(doc, 'meta[name="twitter:title"]') ??
    collapseSpaces(doc.title)
  const author = metaContent(doc, 'meta[name="author"]')
  return {
    title,
    byline: author && !/^https?:/i.test(author) ? author : null,
    siteName:
      metaContent(doc, 'meta[property="og:site_name"]') ??
      metaContent(doc, 'meta[name="application-name"]'),
  }
}

interface Main {
  element: Element | null
  title: string
  byline: string | null
  siteName: string | null
  extractor: string
}

function textLength(el: Element | null): number {
  return (el?.textContent ?? '').replace(/[ \t\n\r\f]+/g, '').length
}

/**
 * Readability on a second clone (it rewrites the document it is given), accepted only when it kept
 * a fair share of the cleaned page's text. Otherwise the page's own landmark (<main>, <article>) or
 * the whole cleaned body is used, which over-includes rather than drops content.
 */
function mainContent(doc: Document): Main {
  const fallback = landmarkOf(doc)
  const fallbackLength = textLength(fallback)
  const elementCount = doc.getElementsByTagName('*').length

  if (elementCount <= READABILITY_MAX_ELEMENTS) {
    const work = doc.cloneNode(true) as Document
    let article: ReturnType<Readability<Node>['parse']> = null
    try {
      article = new Readability<Node>(work, { keepClasses: true, serializer: (n) => n }).parse()
    } catch {
      article = null
    }
    const content = article?.content
    if (article && content && content.nodeType === 1) {
      const kept = textLength(content as Element)
      // A share of the landmark text, never an absolute size: Readability drops blocks classed
      // `comment`, `footer` and the like, which on forums and issue trackers hold the answers.
      const share = fallbackLength > VERY_LONG_PAGE_CHARS ? 0.25 : 0.5
      if (kept > 0 && kept >= fallbackLength * share) {
        return {
          element: content as Element,
          title: collapseSpaces(article.title ?? ''),
          byline: article.byline ? collapseSpaces(article.byline) : null,
          siteName: article.siteName ? collapseSpaces(article.siteName) : null,
          extractor: READABILITY_VERSION,
        }
      }
    }
  }
  return { element: fallback, title: '', byline: null, siteName: null, extractor: DOM_EXTRACTOR }
}
