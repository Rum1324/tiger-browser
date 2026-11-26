import { describe, expect, it } from 'vitest'
import { extractFromDocument } from '../src/index'
import { createContext, elementToMarkdown } from '../src/markdown'
import { loadDocument } from './helpers/dom'

function md(body: string, url = 'https://example.com/dir/page'): string {
  const doc = loadDocument(`<html><body>${body}</body></html>`, url)
  return elementToMarkdown(
    doc.body,
    createContext(url, { deadline: performance.now() + 5_000, maxChars: 1e9 }),
  )
}

describe('HTML to Markdown', () => {
  it('uses a longer fence when a code line starts with backticks', () => {
    expect(md('<pre><code class="language-md">```js\nx\n```</code></pre>')).toBe(
      '````md\n```js\nx\n```\n````',
    )
  })

  it('keeps line structure of highlighters that wrap each line in a div, and <br> in pre', () => {
    expect(md('<pre><div class="line">a = 1</div><div class="line">b = 2</div></pre>')).toBe(
      '```\na = 1\nb = 2\n```',
    )
    expect(md('<pre>one<br>two</pre>')).toBe('```\none\ntwo\n```')
  })

  it('escapes Markdown syntax that appears in text', () => {
    expect(md('<p>5 * 3 = 15 and [not a link] with snake_case and _under_</p>')).toBe(
      '5 \\* 3 = 15 and \\[not a link\\] with snake_case and \\_under\\_',
    )
    expect(md('<p># not a heading</p><p>1. not a list</p><p>- nor this</p>')).toBe(
      '\\# not a heading\n\n1\\. not a list\n\n\\- nor this',
    )
    expect(md('<p>a &lt;div&gt; tag</p>')).toBe('a \\<div> tag')
  })

  it('wraps code spans that contain backticks', () => {
    expect(md('<p>Use <code>a`b</code> here</p>')).toBe('Use ``a`b`` here')
  })

  it('hoists spaces out of emphasis so markers hug the text', () => {
    expect(md('<p>a<strong> bold </strong>b</p>')).toBe('a **bold** b')
    expect(md('<p>x<em></em>y</p>')).toBe('xy')
  })

  it('resolves relative URLs against <base href> and drops javascript: links', () => {
    const url = 'https://example.com/a/b'
    const doc = loadDocument(
      '<html><head><base href="https://cdn.example.org/root/"></head><body><main><p><a href="x/y">rel</a> <a href="javascript:void(0)">js</a> <img src="i.png" alt="pic"></p></main></body></html>',
      url,
    )
    expect(extractFromDocument(doc, url)?.markdown).toBe(
      '[rel](https://cdn.example.org/root/x/y) js ![pic](https://cdn.example.org/root/i.png)',
    )
  })

  it('emits images as alt text with URL, lazy sources included, and never a data: URI', () => {
    expect(md('<img alt="lazy" src="data:image/png;base64,AAAA" data-src="/real.jpg">')).toBe(
      '![lazy](https://example.com/real.jpg)',
    )
    expect(md('<p>x <img alt="inline" src="data:image/png;base64,AAAA"> y</p>')).toBe(
      'x ![inline] y',
    )
    expect(md('<img src="data:image/png;base64,AAAA">')).toBe('')
    expect(md('<img src="/p.gif" width="1" height="1">')).toBe('')
  })

  it('renders emoji images as their text', () => {
    expect(md('<p>done <img class="emoji" alt="🎉" src="/e.png"></p>')).toBe('done 🎉')
  })

  it('renders checkbox task lists from the cleaner marker', () => {
    const url = 'https://example.com/t'
    const doc = loadDocument(
      '<html><body><main><ul><li><input type="checkbox" checked> write tests</li><li><input type="checkbox"> ship</li></ul></main></body></html>',
      url,
    )
    expect(extractFromDocument(doc, url)?.markdown).toBe('- [x] write tests\n- [ ] ship')
  })

  it('keeps a space between Latin words split across lines, and none between Japanese ones', () => {
    expect(md('<p>hello\nworld</p>')).toBe('hello world')
    expect(md('<p>日本\n語</p>')).toBe('日本語')
    expect(md('<p><span>日本</span><span>語</span>の<a href="/x">リンク</a>です</p>')).toBe(
      '日本語の[リンク](https://example.com/x)です',
    )
    expect(md('<p>日本語 English 混在</p>')).toBe('日本語 English 混在')
    // Korean separates words with real spaces, so a line break between Hangul stays a space.
    expect(md('<p>한국어\n문장</p>')).toBe('한국어 문장')
  })

  it('renders ordered lists with a start attribute and loose items with paragraphs', () => {
    expect(md('<ol start="4"><li><p>first</p><p>more</p></li><li>second</li></ol>')).toBe(
      '4. first\n\n   more\n5. second',
    )
  })

  it('renders definition lists and horizontal rules', () => {
    expect(md('<dl><dt>Term</dt><dd>Meaning</dd></dl><hr>')).toBe('**Term**\n\nMeaning\n\n---')
  })

  it('keeps cells under their headers when an earlier row spans rows (rowspan)', () => {
    expect(
      md(
        '<table><tr><th>地域</th><th>月</th><th>売上</th></tr>' +
          '<tr><td rowspan="2">東京</td><td>1月</td><td>100</td></tr>' +
          '<tr><td>2月</td><td>200</td></tr>' +
          '<tr><td>大阪</td><td>1月</td><td>50</td></tr></table>',
      ),
    ).toBe(
      [
        '| 地域 | 月 | 売上 |',
        '| --- | --- | --- |',
        '| 東京 | 1月 | 100 |',
        '| 東京 | 2月 | 200 |',
        '| 大阪 | 1月 | 50 |',
      ].join('\n'),
    )
  })

  it('combines rowspan and colspan, and a rowspan in the middle column', () => {
    expect(
      md(
        '<table><tr><th>a</th><th>b</th><th>c</th><th>d</th></tr>' +
          '<tr><td>1</td><td rowspan="3" colspan="2">wide</td><td>x</td></tr>' +
          '<tr><td>2</td><td>y</td></tr>' +
          '<tr><td>3</td><td>z</td></tr></table>',
      ),
    ).toBe(
      [
        '| a | b | c | d |',
        '| --- | --- | --- | --- |',
        '| 1 | wide |  | x |',
        '| 2 | wide |  | y |',
        '| 3 | wide |  | z |',
      ].join('\n'),
    )
  })

  it('keeps a rowspan in the last column in place when the next row is short', () => {
    expect(
      md(
        '<table><tr><th>a</th><th>b</th><th>c</th></tr>' +
          '<tr><td>1</td><td>2</td><td rowspan="3">note</td></tr>' +
          '<tr><td>3</td></tr><tr><td>4</td><td>5</td></tr><tr><td>6</td><td>7</td><td>8</td></tr></table>',
      ),
    ).toBe(
      [
        '| a | b | c |',
        '| --- | --- | --- |',
        '| 1 | 2 | note |',
        '| 3 |  | note |',
        '| 4 | 5 | note |',
        '| 6 | 7 | 8 |',
      ].join('\n'),
    )
  })

  it('flattens layout tables into blocks instead of a grid', () => {
    expect(
      md('<table role="presentation"><tr><td><p>left</p></td><td><p>right</p></td></tr></table>'),
    ).toBe('left\n\nright')
  })
})
