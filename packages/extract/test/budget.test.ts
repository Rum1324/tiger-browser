import { MAX_MARKDOWN_CHARS } from '@tiger/shared'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { finalizePage } from '../src/finalize'
import { DEFAULT_TIME_BUDGET_MS, extractFromDocument } from '../src/index'

/** About 5 MB of HTML: a long article with inline markup, plus the usual site chrome. */
function bigPage(): string {
  const nav = Array.from(
    { length: 200 },
    (_, i) => `<li><a href="/s/${i}">Section ${i}</a></li>`,
  ).join('')
  const paras: string[] = []
  for (let i = 0; paras.join('').length < 5_000_000; i++) {
    const block = Array.from(
      { length: 50 },
      (_, j) =>
        `<p id="p${i}-${j}">Paragraph ${i}-${j} discusses <a href="/ref/${i}/${j}">reference ${j}</a> and <em>results</em> from the <strong>trial</strong>; the numbers were stable across every run we made.</p>`,
    ).join('')
    paras.push(`<section><h2>Part ${i}</h2>${block}</section>`)
  }
  const traps =
    '<div class="cookie-banner">We use cookies BIG-COOKIE</div><form><input name="k" value="BIG-SECRET-INPUT"><textarea>BIG-SECRET-TEXTAREA</textarea></form><div style="display:none">BIG-HIDDEN-INLINE</div><p class="gone">BIG-HIDDEN-CSS</p><div aria-hidden="true">BIG-HIDDEN-ARIA</div>'
  return `<!DOCTYPE html><html lang="en"><head><title>Huge report</title><style>.gone{display:none}</style></head><body><nav><ul>${nav}</ul></nav><main><article><h1>Huge report</h1>${traps}${paras.join('')}</article></main><footer>footer</footer></body></html>`
}

describe('very large DOM', () => {
  const html = bigPage()
  const url = 'https://reports.example.com/huge'
  const doc = new JSDOM(html, { url }).window.document

  it('is about 5 MB with tens of thousands of elements', () => {
    expect(html.length).toBeGreaterThanOrEqual(5_000_000)
    expect(doc.getElementsByTagName('*').length).toBeGreaterThan(100_000)
  })

  it('finishes within the time budget, keeps the start of the content and marks the cut', () => {
    const t0 = performance.now()
    const r = extractFromDocument(doc, url)
    const elapsed = performance.now() - t0
    console.log(
      `5 MB DOM extracted in ${elapsed.toFixed(0)} ms, ${r?.markdown.length} chars, truncated=${r?.truncated}`,
    )
    // Budget plus one second for the clone and cleaning passes, which run before conversion starts.
    expect(elapsed).toBeLessThan(DEFAULT_TIME_BUDGET_MS + 1_000)
    expect(r).not.toBeNull()
    expect(
      r?.markdown.startsWith('# Huge report\n\n## Part 0\n\nParagraph 0-0 discusses [reference 0]'),
    ).toBe(true)
    expect(r?.markdown).not.toContain('Section 1')
    expect(r?.markdown).not.toMatch(/BIG-(SECRET|HIDDEN|COOKIE)/)
    expect(r?.truncated).toBe(true)

    const page = finalizePage(r as NonNullable<typeof r>, {
      url,
      capturedAt: new Date('2026-11-26T00:00:00Z'),
    })
    expect(page.truncated).toBe(true)
    expect(page.charCount).toBe(page.markdown.length)
    expect(page.charCount).toBeLessThanOrEqual(MAX_MARKDOWN_CHARS)
  })

  it('reads the large page without modifying it', async () => {
    const before = doc.body.childNodes.length
    const records: MutationRecord[] = []
    const observer = new (doc.defaultView as Window & typeof globalThis).MutationObserver((r) =>
      records.push(...r),
    )
    observer.observe(doc, { subtree: true, childList: true, attributes: true, characterData: true })
    extractFromDocument(doc, url, { timeBudgetMs: 300 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    records.push(...observer.takeRecords())
    observer.disconnect()
    expect(records).toHaveLength(0)
    expect(doc.body.childNodes.length).toBe(before)
  })

  it('honours a tight custom budget by converting less', () => {
    const full = extractFromDocument(doc, url)
    const t0 = performance.now()
    const r = extractFromDocument(doc, url, { timeBudgetMs: 0 })
    const elapsed = performance.now() - t0
    console.log(`zero budget: ${elapsed.toFixed(0)} ms, ${r?.markdown.length} chars`)
    expect(r?.truncated).toBe(true)
    expect(r?.markdown.startsWith('# Huge report')).toBe(true)
    expect(r?.markdown.length).toBeLessThan((full?.markdown.length ?? 0) / 10)
  })

  it('stops at the size budget when time is not the limit', () => {
    const r = extractFromDocument(doc, url, { timeBudgetMs: 60_000, maxChars: 50_000 })
    expect(r?.truncated).toBe(true)
    expect(r?.markdown.length).toBeGreaterThan(40_000)
    expect(r?.markdown.length).toBeLessThan(80_000)
  })
})
