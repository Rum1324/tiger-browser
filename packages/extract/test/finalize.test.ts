import { ExtractedPage, MAX_MARKDOWN_CHARS } from '@tiger/shared'
import { describe, expect, it } from 'vitest'
import { finalizePage, splitBlocks, truncateOnBlock } from '../src/finalize'
import type { Extraction } from '../src/types'

const base: Extraction = {
  title: 'Title',
  markdown: 'Hello',
  lang: 'en',
  byline: null,
  siteName: null,
  extractor: 'readability@0.6',
}
const at = '2026-11-26T09:00:00.000Z'

describe('finalizePage', () => {
  it('produces a valid ExtractedPage with source type and char count', () => {
    const page = finalizePage(
      { ...base, markdown: '# 見出し\n\n本文です。' },
      { url: 'https://example.com/a', capturedAt: new Date(at) },
    )
    expect(ExtractedPage.parse(page)).toEqual(page)
    expect(page).toMatchObject({
      sourceType: 'web',
      charCount: 12,
      truncated: false,
      capturedAt: at,
    })
  })

  it('classifies app URLs through the shared sourceTypeForUrl', () => {
    const f = (url: string) => finalizePage(base, { url, capturedAt: at }).sourceType
    expect(f('https://docs.google.com/document/d/abc/edit')).toBe('google-doc')
    expect(f('https://docs.google.com/spreadsheets/d/abc/edit')).toBe('google-sheet')
    expect(f('https://docs.google.com/presentation/d/abc/edit')).toBe('google-slides')
    expect(f('https://app.slack.com/client/T1/C1')).toBe('slack')
    expect(f('https://www.notion.so/acme/Page-1')).toBe('notion')
    expect(f('https://example.com/report.pdf')).toBe('pdf')
  })

  it('truncates at MAX_MARKDOWN_CHARS on a block boundary and says so', () => {
    const para = `${'あ'.repeat(999)}\n`
    const blocks = Array.from({ length: 700 }, (_, i) => `## Section ${i}\n\n${para.trim()}`)
    const markdown = blocks.join('\n\n')
    expect(markdown.length).toBeGreaterThan(MAX_MARKDOWN_CHARS)
    const page = finalizePage(
      { ...base, markdown },
      { url: 'https://example.com/long', capturedAt: at },
    )
    expect(page.truncated).toBe(true)
    expect(page.charCount).toBe(page.markdown.length)
    expect(page.charCount).toBeLessThanOrEqual(MAX_MARKDOWN_CHARS)
    expect(page.charCount).toBeGreaterThan(MAX_MARKDOWN_CHARS - 1_100)
    // The cut lands after a whole paragraph, never inside one.
    expect(page.markdown.endsWith('あ'.repeat(999))).toBe(true)
    expect(markdown.startsWith(page.markdown)).toBe(true)
  })

  it('carries a truncation reported by the extractor even when the text fits', () => {
    expect(
      finalizePage({ ...base, truncated: true }, { url: 'https://example.com/', capturedAt: at })
        .truncated,
    ).toBe(true)
  })

  it('clips over-long metadata to the contract limits', () => {
    const page = finalizePage(
      { ...base, title: 't'.repeat(600), byline: 'b'.repeat(300), siteName: 's'.repeat(300) },
      { url: 'https://example.com/', capturedAt: at },
    )
    expect(page.title).toHaveLength(500)
    expect(page.byline).toHaveLength(200)
    expect(page.siteName).toHaveLength(200)
  })

  it('rejects an invalid URL instead of producing a payload the server would refuse', () => {
    expect(() => finalizePage(base, { url: 'not a url', capturedAt: at })).toThrow()
  })
})

describe('block-aware truncation', () => {
  it('never splits a fenced code block that contains blank lines', () => {
    const md = 'Intro\n\n```js\nconst a = 1\n\nconst b = 2\n```\n\nOutro'
    expect(splitBlocks(md)).toEqual(['Intro', '```js\nconst a = 1\n\nconst b = 2\n```', 'Outro'])
    expect(truncateOnBlock(md, 30)).toEqual({ text: 'Intro', cut: true })
  })

  it('cuts a single oversized block at a line and closes its fence', () => {
    const md = `\`\`\`\n${Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')}\n\`\`\``
    const { text, cut } = truncateOnBlock(md, 120)
    expect(cut).toBe(true)
    expect(text.length).toBeLessThanOrEqual(120)
    expect(text.startsWith('```\nline 0\n')).toBe(true)
    expect(text.endsWith('\n```')).toBe(true)
  })

  it('does not split a surrogate pair', () => {
    const { text } = truncateOnBlock('😀'.repeat(10), 5)
    expect(text).toBe('😀😀')
  })
})
