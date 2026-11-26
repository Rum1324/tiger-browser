import { describe, expect, it } from 'vitest'
import { chunkMarkdown, estimateTokens } from '../../src/retrieval'

describe('chunkMarkdown', () => {
  it('splits by heading and carries the heading path, never merging sections', () => {
    const md = [
      '# 製品',
      '',
      '概要です。',
      '',
      '## 価格',
      '',
      '月額980円。',
      '',
      '## Support',
      '',
      'Email us.',
      '',
      '# 別の章',
      '',
      '本文。',
    ].join('\n')
    const chunks = chunkMarkdown(md)
    expect(chunks.map((c) => [c.headingPath, c.text])).toEqual([
      ['製品', '概要です。'],
      ['製品 > 価格', '月額980円。'],
      ['製品 > Support', 'Email us.'],
      ['別の章', '本文。'],
    ])
    expect(chunks.map((c) => c.ord)).toEqual([0, 1, 2, 3])
  })

  it('packs Japanese sentences up to the target and cuts only at sentence ends', () => {
    const sentence = 'これは長さを揃えるための一文であり、検索の単位として扱われます。'
    const md = `# 章\n\n${sentence.repeat(30)}`
    const chunks = chunkMarkdown(md, { targetChars: 100 })
    expect(chunks.length).toBeGreaterThan(5)
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(100)
      expect(c.text.endsWith('。')).toBe(true)
      expect(c.text.startsWith('これは')).toBe(true)
    }
    // No text is lost or duplicated.
    expect(chunks.map((c) => c.text).join('')).toBe(sentence.repeat(30))
  })

  it('splits Latin sentences but not decimals, versions or abbreviations without a space', () => {
    const md = 'Version 2.3.1 costs 3.5 dollars. It works! Does it? Yes. See v1.2 for details.'
    expect(chunkMarkdown(md, { targetChars: 30 }).map((c) => c.text)).toEqual([
      'Version 2.3.1 costs 3.5 dollars.',
      'It works! Does it? Yes.',
      'See v1.2 for details.',
    ])
  })

  it('treats newlines as boundaries and keeps their line breaks inside a chunk', () => {
    const chunks = chunkMarkdown('- 一つ目\n- 二つ目\n- three', { targetChars: 300 })
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.text).toBe('- 一つ目\n- 二つ目\n- three')
  })

  it('keeps a table whole and does not glue prose onto it', () => {
    const table = ['| 名前 | 価格 |', '| --- | --- |', '| A | 100 |', '| B | 200 |'].join('\n')
    const md = `# 料金\n\n表です。\n\n${table}\n\n注記: 税別。`
    const chunks = chunkMarkdown(md, { targetChars: 40 })
    const withTable = chunks.find((c) => c.text.includes('| A | 100 |'))
    expect(withTable?.text).toContain(table)
    // The short lead-in joins its table; the note after it starts a new chunk.
    expect(withTable?.text.startsWith('表です。')).toBe(true)
    expect(chunks.at(-1)?.text).toBe('注記: 税別。')
  })

  it('splits an oversized table by rows and repeats the header in every piece', () => {
    const rows = Array.from({ length: 40 }, (_, i) => `| item${i} | ${i * 10} |`)
    const table = ['| name | value |', '| --- | --- |', ...rows].join('\n')
    const chunks = chunkMarkdown(table, { maxBlockChars: 200 })
    expect(chunks.length).toBeGreaterThan(2)
    for (const c of chunks) {
      expect(c.text.startsWith('| name | value |\n| --- | --- |')).toBe(true)
      expect(c.text.length).toBeLessThanOrEqual(200)
    }
    const seen = chunks.flatMap((c) => c.text.match(/item\d+/g) ?? [])
    expect(seen).toEqual(rows.map((_, i) => `item${i}`))
  })

  it('keeps a fenced code block whole, ignoring headings and blank lines inside it', () => {
    const code = ['```ts', '# not a heading', '', 'const a = 1', '', 'const b = 2', '```'].join(
      '\n',
    )
    const md = `# Example\n\nRun this.\n\n${code}\n\nDone.`
    const chunks = chunkMarkdown(md, { targetChars: 30 })
    expect(chunks.find((c) => c.text.includes(code))).toBeDefined()
    expect(chunks.every((c) => c.headingPath === 'Example')).toBe(true)
  })

  it('splits an oversized code block by lines and closes every piece', () => {
    const body = Array.from({ length: 60 }, (_, i) => `line_${i}();`)
    const code = ['```js', ...body, '```'].join('\n')
    const chunks = chunkMarkdown(code, { maxBlockChars: 150 })
    expect(chunks.length).toBeGreaterThan(2)
    for (const c of chunks) {
      expect(c.text.startsWith('```js')).toBe(true)
      expect(c.text.endsWith('```')).toBe(true)
      expect(c.text.length).toBeLessThanOrEqual(150)
    }
    const seen = chunks.flatMap((c) => c.text.match(/line_\d+/g) ?? [])
    expect(seen).toEqual(body.map((_, i) => `line_${i}`))
  })

  it('hard-splits a single sentence that is longer than the token cap', () => {
    const md = 'あ'.repeat(3000)
    const chunks = chunkMarkdown(md, { maxTokens: 200 })
    expect(chunks.length).toBeGreaterThan(10)
    for (const c of chunks) expect(estimateTokens(c.text)).toBeLessThanOrEqual(200)
    expect(chunks.map((c) => c.text).join('')).toBe(md)
  })

  it('reserves token room for the title and heading prefix', () => {
    const text = 'あ'.repeat(240)
    const bare = chunkMarkdown(text, { maxTokens: 200 })
    const titled = chunkMarkdown(`# ${'題'.repeat(60)}\n\n${text}`, {
      title: '題'.repeat(60),
      maxTokens: 200,
    })
    expect(titled.length).toBeGreaterThan(bare.length)
  })

  it('handles empty input, heading-only sections and CRLF', () => {
    expect(chunkMarkdown('')).toEqual([])
    expect(chunkMarkdown('   \n\n')).toEqual([])
    expect(chunkMarkdown('# Only a heading')).toEqual([])
    const crlf = chunkMarkdown('# A\r\n\r\nfirst.\r\n\r\n## B\r\n\r\nsecond.')
    expect(crlf.map((c) => [c.headingPath, c.text])).toEqual([
      ['A', 'first.'],
      ['A > B', 'second.'],
    ])
  })

  it('resets the heading path when a shallower heading arrives', () => {
    const md = '# A\n\n## B\n\n### C\n\nc text\n\n## D\n\nd text'
    expect(chunkMarkdown(md).map((c) => c.headingPath)).toEqual(['A > B > C', 'A > D'])
  })
})
