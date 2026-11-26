import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { finalizePage } from '../src/finalize'
import { extractPdf } from '../src/pdf'
import { makePdf, type PdfLine } from './helpers/make-pdf'

const page1: PdfLine[] = [
  { text: '社内規程の改定について', font: 'jp', size: 20, x: 72, y: 760 },
  { text: '２０２６年４月１日から、在宅勤務の上限を', font: 'jp', size: 12, x: 72, y: 720 },
  { text: '週３日に変更します。ｶﾅ表記も変えません。', font: 'jp', size: 12, x: 72, y: 704 },
  { text: 'Contact: hr@example.com', font: 'latin', size: 12, x: 72, y: 660 },
]
const page2: PdfLine[] = [
  { text: '第２条　対象者は全社員とする。', font: 'jp', size: 12, x: 72, y: 760 },
]

describe('extractPdf', () => {
  it('extracts Japanese text through the CMaps, one section per page', async () => {
    const r = await extractPdf(makePdf([page1, page2], { title: '社内規程の改定' }))
    if (!r.extraction) throw new Error(r.detail)
    expect(r.pageCount).toBe(2)
    expect(r.extraction.extractor).toBe('pdfjs@6.5.438')
    expect(r.extraction.title).toBe('社内規程の改定')
    expect(r.extraction.lang).toBe('ja')
    expect(r.extraction.markdown).toBe(
      [
        '## Page 1',
        '',
        '社内規程の改定について',
        '',
        // Two source lines of one paragraph join without a space between Japanese characters.
        '２０２６年４月１日から、在宅勤務の上限を週３日に変更します。ｶﾅ表記も変えません。',
        '',
        'Contact: hr@example.com',
        '',
        '## Page 2',
        '',
        // pdf.js reports U+3000 as an ASCII space in text content; full-width digits survive.
        '第２条 対象者は全社員とする。',
      ].join('\n'),
    )
  })

  it('needs the CMaps: without them the Japanese text cannot be decoded', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'tiger-no-cmaps-'))
    const r = await extractPdf(makePdf([page1]), { cMapDir: empty })
    expect(r.extraction?.markdown ?? '').not.toContain('社内規程')
  })

  it('reports a scanned PDF with no text layer instead of returning text', async () => {
    const r = await extractPdf(makePdf(['image-only', 'image-only']))
    expect(r.extraction).toBeNull()
    if (r.extraction) return
    expect(r.reason).toBe('no-text-layer')
    expect(r.detail).toMatch(/OCR is not supported/)
    expect(r.pageCount).toBe(2)
  })

  it('reports bytes that are not a PDF', async () => {
    const r = await extractPdf(new TextEncoder().encode('<html>not a pdf</html>'))
    expect(r.extraction).toBeNull()
    if (!r.extraction) expect(r.reason).toBe('invalid')
  })

  it('does not detach the caller’s buffer', async () => {
    const bytes = makePdf([page2])
    await extractPdf(bytes)
    expect(bytes.byteLength).toBeGreaterThan(0)
  })

  it('stops at maxPages and marks the result truncated', async () => {
    const r = await extractPdf(makePdf([page1, page2]), { maxPages: 1 })
    expect(r.extraction?.truncated).toBe(true)
    expect(r.extraction?.markdown).not.toContain('## Page 2')
  })

  it('finalizes as a pdf source even when the URL has no .pdf suffix', async () => {
    const r = await extractPdf(makePdf([page2]))
    if (!r.extraction) throw new Error('expected text')
    const page = finalizePage(r.extraction, {
      url: 'https://intranet.example.com/download?id=7',
      capturedAt: '2026-11-26T01:02:03Z',
    })
    expect(page.sourceType).toBe('pdf')
  })
})
