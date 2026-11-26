import { describe, expect, it } from 'vitest'
import { stripUnsafe } from '../src/clean'
import { extractFromDocument } from '../src/index'
import { fixture, loadDocument } from './helpers/dom'

function extract(name: string, url: string) {
  const r = extractFromDocument(loadDocument(fixture(name), url), url)
  if (!r) throw new Error(`no extraction for ${name}`)
  return r
}

describe('English article', () => {
  const url = 'https://fieldnotes.example.com/2026/01/tide-pools'
  const r = extract('english-article.html', url)

  it('picks the article with Readability and reads its metadata', () => {
    expect(r.extractor).toBe('readability@0.6')
    expect(r.title).toBe('How Tide Pools Survive the Winter')
    expect(r.siteName).toBe('Coastal Field Notes')
    expect(r.byline).toBe('Maya Okafor')
    expect(r.lang).toBe('en-US')
  })

  it('keeps headings, emphasis, nested lists, ordered lists and quotes as Markdown', () => {
    expect(r.markdown).toContain('## Three strategies')
    expect(r.markdown).toContain(
      'suggest that *shelter* matters more than **temperature tolerance**.',
    )
    expect(r.markdown).toContain(
      '- Retreat into crevices\n  - Sculpins wedge themselves under ledges\n  - Hermit crabs cluster in the deepest pools\n- Close up and wait',
    )
    expect(r.markdown).toContain(
      '1. Sample monthly at the lowest tide.\n2. Count every animal larger than 5 mm.\n3. Log',
    )
    expect(r.markdown).toContain('> We expected cold to be the killer.')
  })

  it('makes links and images absolute and never emits data: URIs', () => {
    expect(r.markdown).toContain('[Bodega Marine Lab](https://marine.example.edu/lab)')
    expect(r.markdown).toContain(
      '[open data page](https://fieldnotes.example.com/2026/data/tidepools.csv)',
    )
    expect(r.markdown).toContain(
      '![A tide pool at low tide in January](https://fieldnotes.example.com/images/pool-january.jpg)',
    )
    expect(r.markdown).toContain('![tracking pixel] The full dataset')
    expect(r.markdown).not.toContain('data:')
  })

  it('drops navigation, ads, cookie banners, related links, footers, scripts and form values', () => {
    for (const noise of [
      'cookie policy',
      'Accept all cookies',
      'BUY CHEAP FLIGHTS',
      'celebrity homes',
      'Related stories',
      'Kelp forests',
      'All rights reserved',
      'Subscribe',
      'ANALYTICS-TOKEN',
      'reader@example.com',
    ]) {
      expect(r.markdown).not.toContain(noise)
    }
  })
})

describe('Japanese news article without a lang attribute', () => {
  const url = 'https://www.mainichi-shinpo.example.jp/national/20261120-1'
  const r = extract('japanese-news.html', url)

  it('detects Japanese from the text', () => {
    expect(r.lang).toBe('ja')
    expect(r.title).toBe('東京都、来年度から公立小中学校の給食を無償化へ')
    expect(r.siteName).toBe('まいにち新報')
  })

  it('joins source line breaks and inline elements without injecting spaces', () => {
    expect(r.markdown).toContain(
      '東京都は２０日、来年度から都内の公立小中学校で給食費を完全無償化する方針を明らかにした。対象となる児童・生徒は約８５万人で、必要な予算は年間**約７００億円**と見込まれる。',
    )
  })

  it('keeps ruby base text and drops the reading', () => {
    expect(r.markdown).toContain('小池知事は記者会見で「子育て世帯の負担を軽減し、')
    expect(r.markdown).not.toContain('こいけ')
    expect(r.markdown).not.toContain('けいげん')
    expect(r.markdown).not.toMatch(/小池[(（]/)
  })

  it('preserves full-width and half-width characters as written', () => {
    expect(r.markdown).toContain(
      '新たにＡＢＣシステム（Version 2.1）を導入し、ｶﾅ表記の旧データも移行する。',
    )
    expect(r.markdown).toContain('０３－１２３４－５６７８')
    expect(r.byline).toBe('社会部　山田花子')
  })

  it('keeps the list and the link, and drops ads, rankings and share buttons', () => {
    expect(r.markdown).toContain('- 対象：都内の公立小学校・中学校\n- 開始時期：２０２７年４月')
    expect(r.markdown).toContain(
      '[対象拡大を求める声](https://www.mainichi-shinpo.example.jp/national/20261120-2)',
    )
    for (const noise of [
      '今だけ半額',
      'アクセスランキング',
      'LINEで送る',
      'クッキー',
      'プロ野球',
    ]) {
      expect(r.markdown).not.toContain(noise)
    }
  })
})

describe('tables and code', () => {
  const r = extract('tables-code.html', 'https://docs.gateway.example.com/docs/retries')

  it('strips the site name from the title', () => {
    expect(r.title).toBe('Retry policies')
    expect(r.siteName).toBe('Gateway Docs')
  })

  it('renders GFM tables with escaped pipes, colspan and line breaks in cells', () => {
    expect(r.markdown).toContain(
      [
        '| Field | Type | Default | Description |',
        '| --- | --- | --- | --- |',
        '| `max_attempts` | integer | 3 | Total attempts, including the first call |',
        '| `backoff` | string | `exponential` | One of `fixed` \\| `exponential` |',
        '| `retry_on` | list | Status codes that trigger a retry<br>(502, 503, 504) |  |',
      ].join('\n'),
    )
    expect(r.markdown).toContain(
      '| Plan | Max attempts |\n| --- | --- |\n| Free | 3 |\n| Team | 10 |',
    )
  })

  it('fences code with its language, keeping blank lines and backticks inside the code', () => {
    // Backticks that do not start a line cannot close a fence, so three are enough here.
    expect(r.markdown).toContain(
      "```typescript\nimport { route } from '@gateway/sdk'\n\nexport default route('/orders', {\n  retry: { max_attempts: 5, backoff: 'exponential' },\n  // ```fences``` inside code must not break the block\n})\n```",
    )
    expect(r.markdown).toContain(
      '```yaml\nroutes:\n  - path: /orders\n    retry:\n      max_attempts: 5\n```',
    )
    expect(r.markdown).toContain(
      "```bash\ncurl -s https://gateway.example.com/health | jq '.status'\n```",
    )
  })

  it('keeps in-page anchors as text and makes other links absolute', () => {
    expect(r.markdown).toContain(
      '[limits page](https://docs.gateway.example.com/docs/limits#retries) and the field table above.',
    )
    expect(r.markdown).not.toContain('Introduction')
  })
})

describe('form inputs holding secrets', () => {
  const r = extract('form-secrets.html', 'https://cloud.example.com/settings')

  it('captures the page text but no value of any input, textarea, select or draft', () => {
    expect(r.markdown).toContain('Rotate keys every ninety days')
    expect(r.markdown).toContain('[key management guide](https://cloud.example.com/docs/keys)')
    expect(r.markdown).not.toMatch(/SECRET|CSRF|hunter2|sk-live/)
  })

  it('also drops values typed by the member after load (DOM properties, not attributes)', () => {
    const url = 'https://cloud.example.com/settings'
    const doc = loadDocument(fixture('form-secrets.html'), url)
    const input = doc.querySelector('#key') as HTMLInputElement
    input.value = 'TYPED-SECRET-AFTER-LOAD'
    const area = doc.querySelector('#notes') as HTMLTextAreaElement
    area.value = 'TYPED-SECRET-IN-TEXTAREA'
    const out = extractFromDocument(doc, url)
    expect(out?.markdown).toContain('Rotate keys')
    expect(out?.markdown).not.toContain('TYPED-SECRET')
  })
})

describe('stripUnsafe on a clone', () => {
  it('removes every form control and keeps only checkbox state', () => {
    const doc = loadDocument(fixture('form-secrets.html'), 'https://cloud.example.com/settings')
    const clone = doc.cloneNode(true) as Document
    stripUnsafe(clone)
    expect(
      clone.querySelectorAll('input, textarea, select, option, datalist, output'),
    ).toHaveLength(0)
    expect(clone.body.textContent).not.toMatch(/SECRET-VALUE|SECRET-PW|CSRF|RECOVERY|SECRET-REGION/)
    // The original still has them: only the clone is cleaned.
    expect(doc.querySelectorAll('input, textarea, select').length).toBeGreaterThan(0)
  })
})

describe('hidden content', () => {
  const r = extract('hidden.html', 'https://example.com/releases/4.2')

  it('drops content hidden by inline style, stylesheet, hidden, aria-hidden, template and noscript', () => {
    expect(r.markdown).toContain('Version 4.2 adds offline mode')
    expect(r.markdown).toContain('Existing duplicates are removed')
    expect(r.markdown).not.toContain('HIDDEN-')
  })

  it('keeps the content of a closed <details>, which the member can open', () => {
    expect(r.markdown).toContain('Attachments larger than 50 MB are not kept offline.')
  })
})

describe('the live page is never modified', () => {
  it('leaves the DOM and form state untouched, with no mutation records', async () => {
    const url = 'https://cloud.example.com/settings'
    const doc = loadDocument(fixture('form-secrets.html'), url)
    const input = doc.querySelector('#key') as HTMLInputElement
    input.value = 'typed-by-member'
    const before = doc.documentElement.outerHTML
    const records: MutationRecord[] = []
    const observer = new (doc.defaultView as Window & typeof globalThis).MutationObserver((r) =>
      records.push(...r),
    )
    observer.observe(doc, { subtree: true, childList: true, attributes: true, characterData: true })

    extractFromDocument(doc, url)
    extractFromDocument(loadDocument(fixture('english-article.html'), url), url)

    await new Promise((resolve) => setTimeout(resolve, 0))
    records.push(...observer.takeRecords())
    observer.disconnect()
    expect(records).toHaveLength(0)
    expect(doc.documentElement.outerHTML).toBe(before)
    expect(input.value).toBe('typed-by-member')
  })
})

describe('pages with nothing readable', () => {
  it('returns null for an empty page and a page of only chrome', () => {
    const url = 'https://example.com/'
    expect(extractFromDocument(loadDocument('<html><body></body></html>', url), url)).toBeNull()
    expect(
      extractFromDocument(
        loadDocument(
          '<html><body><nav><a href="/a">A</a></nav><script>x()</script><button>OK</button></body></html>',
          url,
        ),
        url,
      ),
    ).toBeNull()
  })
})

describe('language detection', () => {
  const url = 'https://example.com/p'
  const page = (lang: string | null, body: string) =>
    `<html${lang ? ` lang="${lang}"` : ''}><head><title>t</title></head><body><main>${body}</main></body></html>`
  const ja =
    '<p>今日は東京で会議があり、新しいプロジェクトの計画について話し合いました。来週も続けます。</p>'.repeat(
      3,
    )
  const en =
    '<p>The committee met on Tuesday to review the budget, and it agreed that the plan for the new library is the best option for the town.</p>'.repeat(
      2,
    )

  it('prefers the text when an English template declares lang="en" on Japanese content', () => {
    expect(extractFromDocument(loadDocument(page('en', ja), url), url)?.lang).toBe('ja')
  })
  it('detects English without a lang attribute', () => {
    expect(extractFromDocument(loadDocument(page(null, en), url), url)?.lang).toBe('en')
  })
  it('keeps a declared regional tag when the text agrees', () => {
    expect(extractFromDocument(loadDocument(page('ja-jp', ja), url), url)?.lang).toBe('ja-JP')
  })
  it('returns null rather than guessing for short ambiguous text', () => {
    expect(
      extractFromDocument(loadDocument(page(null, '<p>OK 123</p>'), url), url)?.lang,
    ).toBeNull()
  })
})
