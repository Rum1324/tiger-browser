import {
  type ExtractedPage,
  ExtractedPage as ExtractedPageSchema,
  MAX_MARKDOWN_CHARS,
  sourceTypeForUrl,
} from '@tiger/shared'
import { clip } from './text'
import type { Extraction } from './types'

export interface FinalizeInput {
  url: string
  capturedAt: string | Date
  /** Override for tests; production always uses the contract limit. */
  maxChars?: number
}

/**
 * The single place an extraction becomes the payload that may leave the machine. The result is
 * validated against the shared contract, so anything that would be rejected fails here, locally.
 */
export function finalizePage(extraction: Extraction, input: FinalizeInput): ExtractedPage {
  const limit = Math.min(input.maxChars ?? MAX_MARKDOWN_CHARS, MAX_MARKDOWN_CHARS)
  const { text, cut } = truncateOnBlock(extraction.markdown, limit)
  const capturedAt =
    input.capturedAt instanceof Date ? input.capturedAt.toISOString() : input.capturedAt
  // A PDF served without a .pdf path (e.g. /download?id=…) is still a PDF.
  const sourceType = extraction.extractor.startsWith('pdfjs') ? 'pdf' : sourceTypeForUrl(input.url)
  return ExtractedPageSchema.parse({
    url: input.url,
    title: clip(extraction.title, 500),
    sourceType,
    markdown: text,
    lang: extraction.lang ? clip(extraction.lang, 16) : null,
    byline: extraction.byline ? clip(extraction.byline, 200) : null,
    siteName: extraction.siteName ? clip(extraction.siteName, 200) : null,
    extractor: clip(extraction.extractor, 64),
    capturedAt,
    charCount: text.length,
    truncated: cut || extraction.truncated === true,
  })
}

/** Split Markdown into blocks at blank lines, never inside a fenced code block. */
export function splitBlocks(md: string): string[] {
  const blocks: string[] = []
  let current: string[] = []
  let fence: string | null = null
  for (const line of md.split('\n')) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (f) {
      if (fence === null) fence = f
      else if (f[0] === fence[0] && f.length >= fence.length) fence = null
    }
    if (fence === null && line.trim() === '' && !f) {
      if (current.length) blocks.push(current.join('\n'))
      current = []
    } else current.push(line)
  }
  if (current.length) blocks.push(current.join('\n'))
  return blocks
}

export function truncateOnBlock(md: string, limit: number): { text: string; cut: boolean } {
  if (md.length <= limit) return { text: md, cut: false }
  const kept: string[] = []
  let size = 0
  for (const block of splitBlocks(md)) {
    const add = (kept.length ? 2 : 0) + block.length
    if (size + add > limit) break
    kept.push(block)
    size += add
  }
  // A heading whose section was cut away would only mislead retrieval.
  while (kept.length > 1 && /^#{1,6}\s/.test(kept[kept.length - 1] as string)) kept.pop()
  if (kept.length) return { text: kept.join('\n\n'), cut: true }
  // One block larger than the whole budget: cut it at a line boundary, closing a fence it opened.
  const first = splitBlocks(md)[0] ?? md
  const fence = /^\s*(`{3,}|~{3,})/.exec(first)?.[1]
  const closer = fence ? `\n${fence}` : ''
  const room = limit - closer.length
  let text = clip(first, room)
  const nl = text.lastIndexOf('\n')
  if (nl > room / 2) text = text.slice(0, nl)
  return { text: text + closer, cut: true }
}
