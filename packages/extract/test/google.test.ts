import { describe, expect, it } from 'vitest'
import {
  csvToMarkdownTable,
  fromGoogleExport,
  type GoogleExportPlan,
  planGoogleExport,
} from '../src/google'
import { fixture } from './helpers/dom'

const DOC =
  'https://docs.google.com/document/d/1o2MNmSIQWuTsGArr9WX_DdfMs9ksM74wDWPSMeYlYLI/edit?tab=t.0#heading=h.abc'
const SHEET =
  'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=1234567'
const SLIDES =
  'https://docs.google.com/presentation/d/1EAYk18WDjIG-zp_0vLm3CsfQh_i8eXc67Jo2O9C6Vuc/edit#slide=id.p1'

function plan(url: string): GoogleExportPlan {
  const p = planGoogleExport(url)
  if (!p) throw new Error(`no plan for ${url}`)
  return p
}

describe('planGoogleExport', () => {
  it('plans the Markdown export for a Doc', () => {
    expect(plan(DOC)).toEqual({
      kind: 'google-doc',
      fileId: '1o2MNmSIQWuTsGArr9WX_DdfMs9ksM74wDWPSMeYlYLI',
      gid: null,
      requests: [
        {
          url: 'https://docs.google.com/document/d/1o2MNmSIQWuTsGArr9WX_DdfMs9ksM74wDWPSMeYlYLI/export?format=md',
          format: 'md',
        },
      ],
    })
  })

  it('exports the Sheet tab being viewed as CSV', () => {
    const p = plan(SHEET)
    expect(p.kind).toBe('google-sheet')
    expect(p.gid).toBe('1234567')
    expect(p.requests[0]?.url).toBe(
      'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/export?format=csv&gid=1234567',
    )
    expect(plan('https://docs.google.com/spreadsheets/d/abc/edit?gid=42').gid).toBe('42')
    expect(plan('https://docs.google.com/spreadsheets/d/abc/edit').requests[0]?.url).toBe(
      'https://docs.google.com/spreadsheets/d/abc/export?format=csv',
    )
  })

  it('exports Slides as plain text', () => {
    expect(plan(SLIDES).requests).toEqual([
      {
        url: 'https://docs.google.com/presentation/d/1EAYk18WDjIG-zp_0vLm3CsfQh_i8eXc67Jo2O9C6Vuc/export/txt',
        format: 'txt',
      },
    ])
  })

  it('keeps the signed-in account index so multi-account profiles export from the right account', () => {
    expect(plan('https://docs.google.com/document/u/1/d/abc/edit').requests[0]?.url).toBe(
      'https://docs.google.com/document/d/abc/export?format=md&authuser=1',
    )
    expect(
      plan('https://docs.google.com/presentation/d/abc/edit?authuser=2').requests[0]?.url,
    ).toBe('https://docs.google.com/presentation/d/abc/export/txt?authuser=2')
  })

  it('returns null for anything that is not an editor URL', () => {
    for (const url of [
      'https://docs.google.com/document/d/e/2PACX-1vQ/pub',
      'https://drive.google.com/file/d/abc/view',
      'http://docs.google.com/document/d/abc/edit',
      'https://docs.google.com/forms/d/abc/edit',
      'https://example.com/document/d/abc/edit',
      'not a url',
    ]) {
      expect(planGoogleExport(url)).toBeNull()
    }
  })
})

describe('fromGoogleExport', () => {
  it('turns a Docs Markdown export into clean Markdown', () => {
    const r = fromGoogleExport(
      plan(DOC),
      [
        {
          status: 200,
          contentType: 'text/x-markdown; charset=utf-8',
          body: fixture('google/doc-export.md'),
        },
      ],
      { title: '運用手順 - Google ドキュメント' },
    )
    expect(r?.extractor).toBe('google-docs-export@1')
    expect(r?.title).toBe('運用手順')
    expect(r?.siteName).toBe('Google Docs')
    expect(r?.lang).toBe('ja')
    const md = r?.markdown ?? ''
    expect(
      md.startsWith(
        '# \\<project title> - Documentation\n\nGo to **File** > **Make a copy** to start. Prices rose 10% - see [Information](#important-information)!',
      ),
    ).toBe(true)
    expect(md).toContain(
      '## 第1章　概要\n\n本書は社内向けの**運用手順**をまとめたものです。全角ＡＢＣと半角ｶﾅはそのまま残します。',
    )
    // Escapes that keep a line from turning into a list stay.
    expect(md).toContain('1\\. This line is not a list item in the source.')
    expect(md).toContain('\\- Neither is this one.')
    expect(md).toContain('| 項目 | 担当 |\n| :---- | :---- |\n| 申請 | 総務部 |')
    // Code is left exactly as exported.
    expect(md).toContain('```\nconst a = 1 \\- 2\n```')
    expect(md).not.toContain('data:')
    expect(md).not.toContain('[image1]')
  })

  it('turns the CSV export into a Markdown table', () => {
    const r = fromGoogleExport(
      plan(SHEET),
      [{ status: 200, contentType: 'text/csv', body: fixture('google/sheet-export.csv') }],
      {
        title: '名簿 - Google スプレッドシート',
      },
    )
    expect(r?.extractor).toBe('google-sheets-export@1')
    expect(r?.title).toBe('名簿')
    expect(r?.markdown).toBe(
      [
        '| 名前 | 部署 | メモ |',
        '| --- | --- | --- |',
        '| 山田 | 営業, 東京 | 複数行<br>のメモ |',
        '| 佐藤 | 開発 | パイプ \\| を含む "引用" |',
      ].join('\n'),
    )
  })

  it('turns the Slides text export into slide sections', () => {
    const r = fromGoogleExport(
      plan(SLIDES),
      [{ status: 200, contentType: 'text/plain', body: fixture('google/slides-export.txt') }],
      {
        title: 'Q3 Kickoff - Google Slides',
      },
    )
    expect(r?.extractor).toBe('google-slides-export@1')
    expect(r?.title).toBe('Q3 Kickoff')
    expect(r?.markdown).toBe(
      '## Slide 1\n\nQ3 Kickoff\nAgenda\n\n## Slide 2\n\nGoals\n- Ship v2\n- Hire two engineers\n\n## Slide 4\n\n次のステップ\n来週までに見積もりを提出',
    )
  })

  it('returns null for an HTML sign-in page, whatever the response claims to be', () => {
    const signin = fixture('google/signin.html')
    expect(
      fromGoogleExport(plan(DOC), [
        { status: 200, contentType: 'text/html; charset=utf-8', body: signin },
      ]),
    ).toBeNull()
    // Masquerading: served with an export content type, but the body is the sign-in page.
    expect(
      fromGoogleExport(plan(DOC), [{ status: 200, contentType: 'text/x-markdown', body: signin }]),
    ).toBeNull()
    expect(
      fromGoogleExport(plan(SHEET), [
        { status: 200, contentType: 'text/csv', body: `\n\n  ${signin}` },
      ]),
    ).toBeNull()
    expect(
      fromGoogleExport(plan(SLIDES), [{ status: 200, contentType: null, body: signin }]),
    ).toBeNull()
    // An HTML content type is enough, even when the body does not start like a document.
    expect(
      fromGoogleExport(plan(DOC), [
        {
          status: 200,
          contentType: 'text/html',
          body: 'Sorry, unable to open the file at this time.',
        },
      ]),
    ).toBeNull()
    expect(
      fromGoogleExport(plan(DOC), [
        {
          status: 200,
          contentType: 'text/plain',
          body: '# ok',
          finalUrl: 'https://accounts.google.com/ServiceLogin?continue=x',
        },
      ]),
    ).toBeNull()
  })

  it('returns null for error statuses and empty exports', () => {
    expect(
      fromGoogleExport(plan(DOC), [{ status: 403, contentType: 'text/plain', body: 'Forbidden' }]),
    ).toBeNull()
    expect(
      fromGoogleExport(plan(DOC), [{ status: 404, contentType: 'text/x-markdown', body: '# x' }]),
    ).toBeNull()
    expect(
      fromGoogleExport(plan(SHEET), [{ status: 200, contentType: 'text/csv', body: ',,\n,,\n' }]),
    ).toBeNull()
    expect(fromGoogleExport(plan(DOC), [])).toBeNull()
  })

  it('falls back to the first heading for the title when the tab title is unknown', () => {
    const r = fromGoogleExport(plan(DOC), [
      { status: 200, contentType: 'text/x-markdown', body: '\uFEFF# Plan\n\nBody text here.' },
    ])
    expect(r?.title).toBe('Plan')
    expect(r?.markdown).toBe('# Plan\n\nBody text here.')
  })
})

describe('csvToMarkdownTable', () => {
  it('pads ragged rows and escapes backslashes', () => {
    expect(csvToMarkdownTable('a,b,c\n1\n2,x\\y')).toBe(
      '| a | b | c |\n| --- | --- | --- |\n| 1 |  |  |\n| 2 | x\\\\y |  |',
    )
  })
})
