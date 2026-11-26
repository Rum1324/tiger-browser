import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs'
import { normalizeLangTag, resolveLang } from './lang'
import { clip, collapseSpaces, dropsSegmentBreak, tidyMarkdown } from './text'
import type { Extraction } from './types'

/**
 * PDF text extraction for the Electron main process (Node). Text PDFs only: a page image has no text
 * layer and OCR is out of scope, so a scanned PDF is reported, not guessed at.
 */

export const PDF_EXTRACTOR = `pdfjs@${pdfjs.version}`

// pdf.js runs its "worker" on the main thread in Node. Registering the worker module here avoids its
// dynamic import of a relative file path, which breaks once the main process is bundled.
;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker ??= pdfjsWorker

export interface PdfOptions {
  /**
   * Directory of pdf.js binary CMaps (trailing separator). Japanese PDFs that use predefined CMaps
   * such as UniJIS-UTF16-H cannot be decoded without them. Defaults to the copy inside pdfjs-dist;
   * a packaged app passes the path where it ships them.
   */
  cMapDir?: string
  standardFontDir?: string
  /** Pages beyond this are not read; the result is marked truncated. */
  maxPages?: number
  timeBudgetMs?: number
}

export type PdfFailure = 'no-text-layer' | 'encrypted' | 'invalid'

export type PdfResult =
  | { extraction: Extraction; pageCount: number }
  | { extraction: null; reason: PdfFailure; detail: string; pageCount: number | null }

const DEFAULT_MAX_PAGES = 2_000
const DEFAULT_TIME_BUDGET_MS = 30_000

function pdfjsDir(): string {
  const require = createRequire(import.meta.url)
  return dirname(require.resolve('pdfjs-dist/package.json'))
}

function withSep(dir: string): string {
  return dir.endsWith('/') || dir.endsWith(sep) ? dir : dir + sep
}

interface Item {
  str: string
  x: number
  y: number
  width: number
  size: number
  eol: boolean
}

function toItems(content: Awaited<ReturnType<pdfjs.PDFPageProxy['getTextContent']>>): Item[] {
  const items: Item[] = []
  for (const it of content.items) {
    if (!('str' in it)) continue
    const [a = 0, b = 0, , , e = 0, f = 0] = it.transform as number[]
    items.push({
      str: it.str,
      x: e,
      y: f,
      width: it.width,
      size: Math.hypot(a, b) || it.height || 1,
      eol: it.hasEOL,
    })
  }
  return items
}

/**
 * Rebuild lines and paragraphs from positioned text runs. Runs on one baseline join without a space
 * when the gap is small or both sides are CJK; a vertical gap well above the line height starts a
 * new paragraph.
 */
export function layoutText(items: Item[]): string {
  const lines: { text: string; y: number; size: number }[] = []
  let cur = ''
  let curY = Number.NaN
  let curSize = 0
  let lastEnd = Number.NaN
  const push = () => {
    if (cur.trim()) lines.push({ text: cur.replace(/[ \t]+/g, ' ').trim(), y: curY, size: curSize })
    cur = ''
    curY = Number.NaN
    lastEnd = Number.NaN
  }
  for (const it of items) {
    const sameLine =
      !Number.isNaN(curY) && Math.abs(it.y - curY) <= Math.max(it.size, curSize) * 0.5
    if (!Number.isNaN(curY) && !sameLine) push()
    if (it.str) {
      if (Number.isNaN(curY)) {
        curY = it.y
        curSize = it.size
      } else if (cur && !cur.endsWith(' ') && !it.str.startsWith(' ')) {
        const gap = it.x - lastEnd
        if (gap > it.size * 0.25 && !dropsSegmentBreak(cur[cur.length - 1], it.str[0])) cur += ' '
      }
      cur += it.str
      lastEnd = it.x + it.width
      curSize = Math.max(curSize, it.size)
    }
    if (it.eol) push()
  }
  push()

  const paragraphs: string[] = []
  let para = ''
  let prev: { y: number; size: number } | null = null
  for (const line of lines) {
    const gap = prev ? Math.abs(prev.y - line.y) : 0
    if (prev && gap > Math.max(prev.size, line.size) * 1.8) {
      paragraphs.push(para)
      para = ''
    }
    if (!para) para = line.text
    else
      para += dropsSegmentBreak(para[para.length - 1], line.text[0]) ? line.text : `\n${line.text}`
    prev = line
  }
  if (para) paragraphs.push(para)
  return paragraphs.join('\n\n')
}

export async function extractPdf(bytes: Uint8Array, options: PdfOptions = {}): Promise<PdfResult> {
  const base = pdfjsDir()
  const deadline = performance.now() + (options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS)
  const task = pdfjs.getDocument({
    // pdf.js may transfer the buffer it is given; copy so the caller's bytes stay usable.
    data: new Uint8Array(bytes),
    cMapUrl: withSep(options.cMapDir ?? join(base, 'cmaps')),
    cMapPacked: true,
    standardFontDataUrl: withSep(options.standardFontDir ?? join(base, 'standard_fonts')),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  })
  let doc: pdfjs.PDFDocumentProxy
  try {
    doc = await task.promise
  } catch (err) {
    const name = (err as { name?: string }).name
    if (name === 'PasswordException') {
      return {
        extraction: null,
        reason: 'encrypted',
        detail: 'The PDF is password-protected.',
        pageCount: null,
      }
    }
    return {
      extraction: null,
      reason: 'invalid',
      detail: `Not a readable PDF: ${(err as Error).message}`,
      pageCount: null,
    }
  }
  try {
    const pageCount = doc.numPages
    const limit = Math.min(pageCount, options.maxPages ?? DEFAULT_MAX_PAGES)
    const sections: string[] = []
    let textChars = 0
    let truncated = limit < pageCount
    for (let n = 1; n <= limit; n++) {
      if (performance.now() > deadline) {
        truncated = true
        break
      }
      const page = await doc.getPage(n)
      const text = layoutText(toItems(await page.getTextContent({ disableNormalization: true })))
      page.cleanup()
      textChars += text.replace(/\s+/g, '').length
      if (text) sections.push(`## Page ${n}\n\n${text}`)
    }
    if (textChars === 0) {
      return {
        extraction: null,
        reason: 'no-text-layer',
        detail:
          'This PDF has no text layer (probably a scanned image). OCR is not supported, so no text can be extracted.',
        pageCount,
      }
    }
    const meta = await doc.getMetadata().catch(() => null)
    const info = (meta?.info ?? {}) as { Title?: unknown; Author?: unknown; Language?: unknown }
    const markdown = tidyMarkdown(sections.join('\n\n'))
    const firstLine = markdown.split('\n').find((l) => l.trim() && !l.startsWith('## Page')) ?? ''
    const title = typeof info.Title === 'string' && info.Title.trim() ? info.Title : firstLine
    const extraction: Extraction = {
      title: clip(collapseSpaces(title), 500),
      markdown,
      lang: resolveLang(
        normalizeLangTag(typeof info.Language === 'string' ? info.Language : null),
        markdown,
      ),
      byline:
        typeof info.Author === 'string' && info.Author.trim()
          ? clip(collapseSpaces(info.Author), 200)
          : null,
      siteName: null,
      extractor: PDF_EXTRACTOR,
    }
    if (truncated) extraction.truncated = true
    return { extraction, pageCount }
  } finally {
    await task.destroy()
  }
}
