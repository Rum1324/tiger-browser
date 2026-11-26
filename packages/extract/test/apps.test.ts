import { describe, expect, it } from 'vitest'
import { extractFromDocument } from '../src/index'
import { slackTsToIso } from '../src/slack'
import { fixture, loadDocument } from './helpers/dom'

describe('Slack conversation view', () => {
  const url = 'https://app.slack.com/client/T01ACME/C0PLATFORM'
  const r = extractFromDocument(loadDocument(fixture('slack-channel.html'), url), url)

  it('uses the Slack handler with the channel and workspace', () => {
    expect(r?.extractor).toBe('slack-dom@1')
    expect(r?.title).toBe('#eng-platform')
    expect(r?.siteName).toBe('Acme · Slack')
  })

  it('attributes each message to its author and UTC time, with Markdown bodies', () => {
    expect(r?.markdown).toContain(
      [
        '## Tuesday, November 14th',
        '',
        '**Kenji Sato** · 2023-11-14 22:13 UTC',
        'Heads up: the **payments-api** deploy is blocked on the migration `0042_add_ledger`. @Aiko Tanaka can you take a look? :pray:',
        '',
        '- staging: green',
        '- prod: waiting',
      ].join('\n'),
    )
    expect(r?.markdown).toContain('Reactions: :eyes: 2')
  })

  it('gives a continuation message the previous author and keeps code blocks', () => {
    expect(r?.markdown).toContain(
      '**Kenji Sato** · 2023-11-14 22:15 UTC\nError from the job:\n\n```\nERROR: relation "ledger_entries" already exists\n  at migrate (0042_add_ledger.sql:3)\n```',
    )
  })

  it('keeps Japanese messages without injected spaces', () => {
    expect(r?.markdown).toContain(
      '**佐藤 花** · 2023-11-14 23:13 UTC\n明日の**障害対応**訓練は１０時からです。\n\n> 場所は会議室Ｂ',
    )
  })

  it('records the thread summary and the open thread with its replies', () => {
    expect(r?.markdown).toContain('_Thread: 3 replies · Last reply today at 11:02 PM_')
    const thread = r?.markdown.split('## Thread in #eng-platform')[1] ?? ''
    expect(thread).toContain(
      '**Aiko Tanaka** · 2023-11-14 22:30 UTC\nLooking now. The table was created by a hotfix last week.',
    )
    expect(thread).toContain(
      '**Aiko Tanaka** · 2023-11-14 23:02 UTC\nFixed: migration now uses `CREATE TABLE IF NOT EXISTS`. Deploy is unblocked.',
    )
  })

  it('never captures the composers, the sidebar or avatars', () => {
    expect(r?.markdown).not.toMatch(/DRAFT-NOT-SENT|unsent reply/)
    expect(r?.markdown).not.toContain('random')
    expect(r?.markdown).not.toContain('slack-edge.com/T1')
  })

  it('converts Slack timestamps to UTC and rejects junk', () => {
    expect(slackTsToIso('1700000000.000100')).toBe('2023-11-14 22:13 UTC')
    expect(slackTsToIso('abc')).toBeNull()
  })

  it('falls back to generic extraction on slack.com pages that are not a conversation', () => {
    const page = 'https://slack.com/intl/ja-jp/help/articles/123'
    const doc = loadDocument(
      '<html lang="ja"><head><title>ヘルプ</title></head><body><main><h1>チャンネルを作成する</h1><p>サイドバーの「チャンネルを追加」をクリックして、新しいチャンネルを作成します。名前は後から変更できます。</p></main></body></html>',
      page,
    )
    const out = extractFromDocument(doc, page)
    expect(out?.extractor).not.toBe('slack-dom@1')
    expect(out?.markdown).toContain(
      'サイドバーの「チャンネルを追加」をクリックして、新しいチャンネルを作成します。',
    )
  })
})

describe('Notion page', () => {
  const url = 'https://www.notion.so/acme/Q3-Onboarding-Plan-1111'
  const r = extractFromDocument(loadDocument(fixture('notion-page.html'), url), url)

  it('uses the Notion handler and the page title', () => {
    expect(r?.extractor).toBe('notion-dom@1')
    expect(r?.title).toBe('Q3 Onboarding Plan')
    expect(r?.siteName).toBe('Notion')
    expect(r?.lang).toBe('en')
  })

  it('converts text blocks with inline formatting and links', () => {
    expect(
      r?.markdown.startsWith(
        'This page tracks onboarding for the **three new engineers** joining in July. Owner: [Team Directory](https://www.notion.so/acme/Team-Directory-abc123).',
      ),
    ).toBe(true)
  })

  it('converts headings, nested bullets, to-dos and numbered lists', () => {
    expect(r?.markdown).toContain(
      '# Goals\n\n- Ship a first PR in week one\n  - Pick from the `good-first-issue` label\n- Shadow on-call for *one* rotation',
    )
    expect(r?.markdown).toContain(
      '## Week one checklist\n\n- [x] Laptop and accounts\n- [ ] Read the architecture overview',
    )
    expect(r?.markdown).toContain('1. Clone the monorepo\n2. Run the setup script')
  })

  it('separates lists of different kinds with a blank line', () => {
    expect(r?.markdown).toContain('- [ ] Read the architecture overview\n\n1. Clone the monorepo')
  })

  it('converts code, quote, callout, divider, toggle, table and image blocks', () => {
    expect(r?.markdown).toContain('```shell\npnpm install\npnpm dev\n```')
    expect(r?.markdown).toContain('> Ask questions early. Nobody expects you to know the codebase.')
    expect(r?.markdown).toContain('> 💡 The setup script needs VPN access.')
    expect(r?.markdown).toContain('\n---\n')
    expect(r?.markdown).toContain('- FAQ\n  オンボーディング期間は**２週間**です。')
    expect(r?.markdown).toContain('| Name | Start |\n| --- | --- |\n| Lee | July 1 |')
    expect(r?.markdown).toContain(
      '![Architecture diagram](https://prod-files-secure.s3.us-west-2.amazonaws.com/acme/arch.png)\n\nSystem overview, 2026',
    )
  })

  it('leaves out the sidebar, top bar, page controls and comments', () => {
    for (const noise of [
      'Engineering Wiki',
      'Meeting Notes',
      'Add icon',
      'Share',
      'SIDEBAR-COMMENT',
      'Copy',
    ]) {
      expect(r?.markdown).not.toContain(noise)
    }
  })
})

describe('app routing', () => {
  it('agrees with the shared sourceTypeForUrl for the DOM-handled apps', async () => {
    const { sourceTypeForUrl } = await import('@tiger/shared')
    const { appKind } = await import('../src/index')
    for (const url of [
      'https://app.slack.com/client/T1/C1',
      'https://acme.slack.com/archives/C1/p1700000000000100',
      'https://slack.com/help',
      'https://www.notion.so/acme/Page-1',
      'https://acme.notion.site/Public-Page-1',
      'https://notslack.com/x',
      'https://example.com/notion.so',
      'https://docs.google.com/document/d/abc/edit',
      'not a url',
    ]) {
      const shared = sourceTypeForUrl(url)
      const expected = shared === 'slack' || shared === 'notion' ? shared : null
      expect(appKind(url), url).toBe(expected)
    }
  })
})
