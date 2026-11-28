import { sha256Hex } from '@tiger/client'
import type {
  AuditEvent,
  Bookmark,
  Citation,
  Download,
  ExtractedPage,
  HistoryEntry,
  Invite,
  Item,
  ItemVersionRef,
  Message,
  ModelInfo,
  ModelRef,
  Settings,
  SourceType,
  Space,
  SpaceMember,
  SpaceUsage,
  Thread,
  User,
  UserRef,
} from '@tiger/shared'

/**
 * A realistic world for tests and the visual rig: コトノハ, a four-founder care-tech startup in
 * Tokyo raising its seed round. People, Spaces and pages follow the final design's prototype
 * (design/final/prototype/parts.js) so a screen in the rig can be compared with its design shot.
 *
 * Every object is built to the contracts in @tiger/shared, and the fixture server validates them
 * through the real client, so a fixture that drifts from the contract fails loudly.
 */

/** Deterministic UUIDv7-shaped ids, so screenshots and assertions are stable. */
export const uid = (n: number): string => `0190f0a0-0000-7000-8000-${n.toString(16).padStart(12, '0')}`

/** 2026-11-26 12:14 JST is "now" in the fixture world. */
export const NOW = Date.parse('2026-11-26T03:14:00.000Z')
export const at = (minutesAgo: number): string => new Date(NOW - minutesAgo * 60_000).toISOString()
const DAY = 24 * 60

// ── People ──────────────────────────────────────────────────────────────────

export const people = {
  saeki: { id: uid(1), name: '佐伯 遥', avatarUrl: null, email: 'haruka.saeki@kotonoha.example' },
  mori: { id: uid(2), name: '森 拓海', avatarUrl: null, email: 'takumi.mori@kotonoha.example' },
  ono: { id: uid(3), name: '小野 美咲', avatarUrl: null, email: 'misaki.ono@kotonoha.example' },
  kashiwagi: {
    id: uid(4),
    name: '柏木 蓮',
    avatarUrl: null,
    email: 'ren.kashiwagi@kotonoha.example',
  },
} as const
export type PersonKey = keyof typeof people

export const ref = (p: PersonKey): UserRef => ({
  id: people[p].id,
  name: people[p].name,
  avatarUrl: people[p].avatarUrl,
})

/** The member using the browser in the fixture world. */
export const me: User = { ...ref('saeki'), email: people.saeki.email, locale: 'ja' }

// ── Spaces ──────────────────────────────────────────────────────────────────

export const spaceIds = { fund: uid(101), hire: uid(102), product: uid(103) } as const
export type SpaceKey = keyof typeof spaceIds

// ── Pages: what a tab can show, and what its capture returns ────────────────

export interface FixturePage {
  key: string
  url: string
  title: string
  sourceType: SourceType
  /** The Markdown the engine's capture returns today. */
  markdown: string
  siteName: string | null
}

const page = (
  key: string,
  url: string,
  title: string,
  sourceType: SourceType,
  markdown: string,
  siteName: string | null = null,
): FixturePage => ({ key, url, title, sourceType, markdown, siteName })

export const pages = {
  pitch: page(
    'pitch',
    'https://docs.google.com/document/d/1mKx7RfQe8/edit',
    '投資家向けピッチ v3',
    'google-doc',
    '# 投資家向けピッチ v3\n\n## 課題\n訪問介護の記録作業は、1訪問あたり平均18分かかっています。\n\n## 解決策\n音声から記録の下書きを作り、確認だけで提出できるようにします。\n\n## 調達\nシードで1.5億円（J-KISS）を予定しています。',
    'Google ドキュメント',
  ),
  dilution: page(
    'dilution',
    'https://docs.google.com/spreadsheets/d/1Zt4wPq0Lm/edit',
    '希薄化シミュレーション',
    'google-sheet',
    '| ラウンド | 調達額 | 持分 |\n|---|---|---|\n| シード | 1.5億円 | 15% |',
    'Google スプレッドシート',
  ),
  slack: page(
    'slack',
    'https://kotonoha.slack.com/archives/C06FUND',
    '#fundraising — コトノハ',
    'slack',
    '**小野 美咲**: ミズナラ・キャピタルとの2回目の面談は12月3日に決まりました。\n**森 拓海**: KPIの10月分を更新しました。',
    'Slack',
  ),
  notion: page(
    'notion',
    'https://www.notion.so/kotonoha/shihon-seisaku-8f2a',
    '資本政策メモ',
    'notion',
    '# 資本政策メモ\n\nストックオプションのプールは10%を確保する。\n\n（11月25日追記）従業員向けは税制適格を前提にする。',
    'Notion',
  ),
  news: page(
    'news',
    'https://care-keizai.jp/articles/2026/11/seed-funding',
    '介護テックのシード調達、3年ぶりに増加',
    'web',
    '# 介護テックのシード調達、3年ぶりに増加\n\n2026年の介護テック分野のシード調達は前年比で増加した。',
    '介護経済新聞',
  ),
  gmail: page(
    'gmail',
    'https://mail.google.com/mail/u/0/#inbox',
    '受信トレイ (3)',
    'web',
    '',
  ),
  // A host on the built-in banking list (the prototype's bank is fictional, so no rule matches it).
  bank: page(
    'bank',
    'https://www.paypay-bank.co.jp/business/statement',
    'PayPay銀行 ビジネス口座',
    'web',
    '',
  ),
  hireplan: page(
    'hireplan',
    'https://www.notion.so/kotonoha/saiyo-keikaku-2027-41c0',
    '採用計画 2027',
    'notion',
    '# 採用計画 2027\n\nエンジニア2名、カスタマーサクセス1名を採用する。',
    'Notion',
  ),
  kpi: page(
    'kpi',
    'https://docs.google.com/spreadsheets/d/1KpiOct2026/edit',
    '月次KPI 2026年10月',
    'google-sheet',
    '| 指標 | 10月 |\n|---|---|\n| 導入事業所 | 38 |\n| 継続率 | 97% |',
    'Google スプレッドシート',
  ),
  mhlwpdf: page(
    'mhlwpdf',
    'https://www.mhlw.go.jp/content/12300000/001234567.pdf',
    '介護報酬改定の概要.pdf',
    'pdf',
    '# 介護報酬改定の概要\n\n記録の電子化に対する加算が新設される。',
  ),
  investors: page(
    'investors',
    'https://docs.google.com/spreadsheets/d/1InvList27/edit',
    '投資家リスト 2027',
    'google-sheet',
    '| 投資家 | 状況 |\n|---|---|\n| ミズナラ・キャピタル | 2回目面談 |',
    'Google スプレッドシート',
  ),
  insecure: page(
    'insecure',
    'http://kaigo-hoken.example.jp/guide',
    '介護保険のしくみ',
    'web',
    '# 介護保険のしくみ\n\n介護保険は40歳以上が加入する。',
  ),
} satisfies Record<string, FixturePage>
export type PageKey = keyof typeof pages

// ── Shared items with versions ──────────────────────────────────────────────

export interface FixtureItem {
  item: Item
  versions: ItemVersionRef[]
  /** Markdown of the current version, as stored on the server. */
  markdown: string
}

interface ItemSpec {
  n: number
  space: SpaceKey
  page: PageKey
  by: PersonKey
  sharedMinutesAgo: number
  /** One entry per version, oldest first: who captured it and when. */
  versions: { by: PersonKey; minutesAgo: number }[]
  /** The stored Markdown when it differs from today's capture (the page changed: stale). */
  storedMarkdown?: string
  status?: Item['status']
}

const ITEM_SPECS: ItemSpec[] = [
  {
    n: 201,
    space: 'fund',
    page: 'pitch',
    by: 'saeki',
    sharedMinutesAgo: 3 * DAY,
    versions: [
      { by: 'saeki', minutesAgo: 3 * DAY },
      { by: 'saeki', minutesAgo: 0 },
    ],
  },
  {
    n: 202,
    space: 'fund',
    page: 'slack',
    by: 'ono',
    sharedMinutesAgo: 9 * DAY,
    versions: [1, 2, 3, 4, 5].map((v) => ({ by: 'ono' as const, minutesAgo: (11 - 2 * v) * DAY })),
  },
  {
    n: 203,
    space: 'fund',
    page: 'notion',
    by: 'saeki',
    sharedMinutesAgo: 6 * DAY,
    versions: [
      { by: 'saeki', minutesAgo: 6 * DAY },
      { by: 'saeki', minutesAgo: 6 * DAY - 120 },
    ],
    // Shared before the 11/25 addition: today's capture differs, so the tab shows "stale".
    storedMarkdown: '# 資本政策メモ\n\nストックオプションのプールは10%を確保する。',
  },
  {
    n: 204,
    space: 'fund',
    page: 'kpi',
    by: 'mori',
    sharedMinutesAgo: 30 * DAY,
    versions: [1, 2, 3, 4].map((v) => ({ by: 'mori' as const, minutesAgo: (32 - 3 * v) * DAY })),
  },
  {
    n: 205,
    space: 'fund',
    page: 'mhlwpdf',
    by: 'kashiwagi',
    sharedMinutesAgo: 14 * DAY,
    versions: [{ by: 'kashiwagi', minutesAgo: 14 * DAY }],
  },
  {
    n: 206,
    space: 'fund',
    page: 'investors',
    by: 'ono',
    sharedMinutesAgo: 40 * DAY,
    versions: [1, 2, 3, 4, 5, 6, 7].map((v) => ({
      by: 'ono' as const,
      minutesAgo: (44 - 4 * v) * DAY,
    })),
    status: 'indexing',
  },
  {
    n: 207,
    space: 'hire',
    page: 'hireplan',
    by: 'kashiwagi',
    sharedMinutesAgo: 5 * DAY,
    versions: [{ by: 'kashiwagi', minutesAgo: 5 * DAY }],
  },
]

async function buildItem(spec: ItemSpec): Promise<FixtureItem> {
  const p = pages[spec.page]
  const markdown = spec.storedMarkdown ?? p.markdown
  const versions: ItemVersionRef[] = []
  for (const [i, v] of spec.versions.entries()) {
    const isCurrent = i === spec.versions.length - 1
    const text = isCurrent ? markdown : `${markdown}\n\n(第${i + 1}版)`
    versions.push({
      id: uid(spec.n * 100 + i + 1),
      number: i + 1,
      charCount: text.length,
      contentHash: await sha256Hex(text),
      capturedAt: at(v.minutesAgo),
      capturedBy: ref(v.by),
    })
  }
  const current = versions[versions.length - 1] as ItemVersionRef
  return {
    markdown,
    versions: versions.slice().reverse(),
    item: {
      id: uid(spec.n),
      spaceId: spaceIds[spec.space],
      url: p.url,
      title: p.title,
      sourceType: p.sourceType,
      sharedBy: ref(spec.by),
      sharedAt: at(spec.sharedMinutesAgo),
      updatedAt: current.capturedAt,
      status: spec.status ?? 'ready',
      versionCount: versions.length,
      currentVersion: current,
    },
  }
}

// ── Threads and messages ────────────────────────────────────────────────────

const message = (m: Partial<Message> & Pick<Message, 'id' | 'threadId' | 'role' | 'author' | 'content' | 'createdAt'>): Message => ({
  model: null,
  citations: [],
  attachments: [],
  status: 'complete',
  errorCode: null,
  usage: null,
  streamSeq: null,
  ...m,
})

const sonnet: ModelRef = { provider: 'anthropic', id: 'claude-sonnet-4-5' }

function citation(n: number, it: FixtureItem, quote: string, available = true): Citation {
  return {
    n,
    itemId: it.item.id,
    itemVersionId: it.item.currentVersion.id,
    title: it.item.title,
    url: it.item.url,
    sourceType: it.item.sourceType,
    sharedBy: it.item.sharedBy,
    sharedAt: it.item.sharedAt,
    quote: available ? quote : '',
    available,
  }
}

// ── The world ───────────────────────────────────────────────────────────────

export interface FixtureWorld {
  me: User
  token: string
  spaces: Space[]
  members: Record<string, SpaceMember[]>
  invites: Record<string, Invite[]>
  items: FixtureItem[]
  threads: Thread[]
  messages: Record<string, Message[]>
  models: { models: ModelInfo[]; defaultModel: ModelRef | null }
  usage: Record<string, SpaceUsage>
  audit: Record<string, AuditEvent[]>
  settings: Settings
  history: HistoryEntry[]
  bookmarks: Bookmark[]
  downloads: Download[]
  pages: Record<string, FixturePage>
  ids: {
    privateThread: string
    spaceThread: string
    attachedQuestion: string
    plainQuestion: string
    streamingAnswer: string
  }
}

export async function buildWorld(): Promise<FixtureWorld> {
  const items = await Promise.all(ITEM_SPECS.map(buildItem))
  const byPage = (k: PageKey) => items.find((i) => i.item.url === pages[k].url) as FixtureItem

  const space = (key: SpaceKey, name: string, hue: Space['hue'], by: PersonKey, memberCount: number, daysAgo: number): Space => ({
    id: spaceIds[key],
    name,
    hue,
    createdBy: people[by].id,
    createdAt: at(daysAgo * DAY),
    memberCount,
    itemCount: items.filter((i) => i.item.spaceId === spaceIds[key]).length,
    myRole: by === 'saeki' ? 'owner' : 'member',
  })
  const spaces = [
    space('fund', '資金調達 2027', 'amber', 'saeki', 4, 60),
    space('hire', '採用', 'green', 'kashiwagi', 3, 45),
    space('product', 'プロダクト', 'indigo', 'mori', 4, 90),
  ]
  const member = (p: PersonKey, role: SpaceMember['role'], daysAgo: number): SpaceMember => ({
    user: { ...ref(p), email: people[p].email },
    role,
    joinedAt: at(daysAgo * DAY),
  })
  const members: Record<string, SpaceMember[]> = {
    [spaceIds.fund]: [
      member('saeki', 'owner', 60),
      member('mori', 'member', 59),
      member('ono', 'member', 59),
      member('kashiwagi', 'member', 40),
    ],
    [spaceIds.hire]: [
      member('kashiwagi', 'owner', 45),
      member('saeki', 'member', 45),
      member('ono', 'member', 44),
    ],
    [spaceIds.product]: [
      member('mori', 'owner', 90),
      member('saeki', 'member', 90),
      member('ono', 'member', 88),
      member('kashiwagi', 'member', 80),
    ],
  }
  const invites: Record<string, Invite[]> = {
    [spaceIds.fund]: [
      {
        id: uid(301),
        spaceId: spaceIds.fund,
        email: 'advisor@shiraume-law.example',
        createdBy: ref('saeki'),
        createdAt: at(2 * DAY),
        expiresAt: new Date(NOW + 12 * DAY * 60_000).toISOString(),
        acceptedAt: null,
      },
    ],
  }

  const privateThread = uid(401)
  const spaceThread = uid(402)
  const threads: Thread[] = [
    {
      id: spaceThread,
      spaceId: spaceIds.fund,
      visibility: 'space',
      owner: ref('ono'),
      title: 'ミズナラ・キャピタル面談の準備',
      createdAt: at(DAY),
      lastMessageAt: at(50),
    },
    {
      id: privateThread,
      spaceId: spaceIds.fund,
      visibility: 'private',
      owner: ref('saeki'),
      title: '',
      createdAt: at(120),
      lastMessageAt: at(10),
    },
  ]

  const pitch = byPage('pitch')
  const kpi = byPage('kpi')
  const slack = byPage('slack')
  const mhlw = byPage('mhlwpdf')
  const plainQuestion = uid(501)
  const attachedQuestion = uid(503)
  const streamingAnswer = uid(506)
  const messages: Record<string, Message[]> = {
    [spaceThread]: [
      message({
        id: uid(511),
        threadId: spaceThread,
        role: 'user',
        author: ref('ono'),
        content: '12月3日の面談で聞かれそうな数字をまとめてください。',
        createdAt: at(60),
      }),
      message({
        id: uid(512),
        threadId: spaceThread,
        role: 'assistant',
        author: ref('ono'),
        model: sonnet,
        content:
          '導入事業所は10月時点で38事業所、継続率は97%です[1]。記録作業は1訪問あたり平均18分かかっており、これを短くすることが提案の中心です[2]。2回目の面談は12月3日に決まっています[3]。',
        citations: [
          citation(1, kpi, '導入事業所 | 38 / 継続率 | 97%'),
          citation(2, pitch, '1訪問あたり平均18分かかっています'),
          citation(3, slack, '2回目の面談は12月3日に決まりました'),
        ],
        usage: { inputTokens: 5210, outputTokens: 182, cachedInputTokens: 4800 },
        createdAt: at(59),
      }),
      message({
        id: uid(513),
        threadId: spaceThread,
        role: 'user',
        author: ref('mori'),
        content: '介護報酬改定で追い風になる点はありますか？',
        createdAt: at(52),
      }),
      message({
        id: uid(514),
        threadId: spaceThread,
        role: 'assistant',
        author: ref('mori'),
        model: sonnet,
        content: '記録の電子化に対する加算が新設されます[1]。以前共有されていた試算は共有が解除されています[2]。',
        citations: [
          citation(1, mhlw, '記録の電子化に対する加算が新設される'),
          { ...citation(2, pitch, ''), itemId: uid(299), itemVersionId: uid(29901), title: '希薄化シミュレーション（個人メモ）', url: pages.dilution.url, sourceType: 'google-sheet', quote: '', available: false },
        ],
        createdAt: at(50),
      }),
    ],
    [privateThread]: [
      message({
        id: plainQuestion,
        threadId: privateThread,
        role: 'user',
        author: ref('saeki'),
        content: 'ピッチの課題スライドを一文で言うと？',
        createdAt: at(30),
      }),
      message({
        id: uid(502),
        threadId: privateThread,
        role: 'assistant',
        author: ref('saeki'),
        model: sonnet,
        content: '訪問介護の記録に1訪問18分かかっている、という一文です[1]。',
        citations: [citation(1, pitch, '1訪問あたり平均18分かかっています')],
        createdAt: at(29),
      }),
      message({
        id: attachedQuestion,
        threadId: privateThread,
        role: 'user',
        author: ref('saeki'),
        content: 'この記事の数字はピッチと矛盾しませんか？',
        attachments: [
          {
            url: pages.news.url,
            title: pages.news.title,
            sourceType: 'web',
            charCount: pages.news.markdown.length,
          },
        ],
        createdAt: at(20),
      }),
      message({
        id: uid(504),
        threadId: privateThread,
        role: 'assistant',
        author: ref('saeki'),
        model: sonnet,
        content: '矛盾はありません。記事はシード調達の件数の増加を伝えており、ピッチの数字とは別の指標です。',
        createdAt: at(19),
      }),
      message({
        id: uid(505),
        threadId: privateThread,
        role: 'user',
        author: ref('saeki'),
        content: '想定問答に足すべき質問を3つ挙げてください。',
        createdAt: at(11),
      }),
      message({
        id: streamingAnswer,
        threadId: privateThread,
        role: 'assistant',
        author: ref('saeki'),
        model: sonnet,
        content: '1. 継続率97%の内訳（事業所規模別）',
        status: 'streaming',
        streamSeq: 3,
        createdAt: at(10),
      }),
    ],
  }

  const models: FixtureWorld['models'] = {
    models: [
      { provider: 'anthropic', id: 'claude-opus-4-5', label: 'Claude Opus 4.5', tier: 'best', contextWindow: 200_000, available: true },
      { ...sonnet, label: 'Claude Sonnet 4.5', tier: 'balanced', contextWindow: 200_000, available: true },
      { provider: 'anthropic', id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', tier: 'fast', contextWindow: 200_000, available: true },
      { provider: 'openai', id: 'gpt-5.1', label: 'GPT-5.1', tier: 'best', contextWindow: 400_000, available: false },
      { provider: 'google', id: 'gemini-3-pro', label: 'Gemini 3 Pro', tier: 'best', contextWindow: 1_000_000, available: false },
    ],
    defaultModel: sonnet,
  }

  const usage: Record<string, SpaceUsage> = Object.fromEntries(
    spaces.map((s, i) => [
      s.id,
      {
        spaceId: s.id,
        periodStart: '2026-10-31T15:00:00.000Z',
        inputTokens: [412_000, 38_000, 120_500][i] ?? 0,
        outputTokens: [21_400, 2_100, 9_800][i] ?? 0,
        budgetTokens: i === 0 ? 2_000_000 : null,
      },
    ]),
  )

  const audit: Record<string, AuditEvent[]> = {
    [spaceIds.fund]: [
      { id: uid(601), spaceId: spaceIds.fund, actor: ref('saeki'), action: 'item.reshared', target: { type: 'item', id: pitch.item.id, title: pitch.item.title, url: pitch.item.url }, at: at(0) },
      { id: uid(602), spaceId: spaceIds.fund, actor: ref('saeki'), action: 'item.unshared', target: { type: 'item', id: uid(299), title: '希薄化シミュレーション（個人メモ）', url: pages.dilution.url }, at: at(5 * DAY - 40) },
      { id: uid(603), spaceId: spaceIds.fund, actor: ref('ono'), action: 'thread.shared', target: { type: 'thread', id: spaceThread, title: 'ミズナラ・キャピタル面談の準備', url: null }, at: at(DAY) },
      { id: uid(604), spaceId: spaceIds.fund, actor: ref('kashiwagi'), action: 'member.joined', target: { type: 'member', id: people.kashiwagi.id, title: people.kashiwagi.name, url: null }, at: at(40 * DAY) },
    ],
  }

  const settings: Settings = {
    locale: 'ja',
    theme: 'light',
    searchEngine: 'google',
    serverUrl: 'http://rig.tiger.invalid',
    userBlockedHosts: ['kaikei-cloud.jp'],
    lastSpaceId: spaceIds.fund,
    defaultModel: null,
  }

  const history: HistoryEntry[] = [
    { id: 'h1', url: pages.news.url, title: pages.news.title, visitedAt: at(15), visitCount: 3 },
    { id: 'h2', url: 'https://startup-houmu.jp/guide/j-kiss', title: 'J-KISS 型新株予約権の手引き', visitedAt: at(2 * DAY), visitCount: 5 },
    { id: 'h3', url: 'https://mizunara-capital.jp/policy', title: 'ミズナラ・キャピタル｜投資方針', visitedAt: at(3 * DAY), visitCount: 2 },
  ]
  const bookmarks: Bookmark[] = [
    { id: 'b1', url: 'https://kotonoha.slack.com/', title: 'コトノハ — チャット', faviconUrl: null, spaceId: null, createdAt: at(80 * DAY) },
    { id: 'b2', url: 'https://github.com/kotonoha/app', title: 'kotonoha/app', faviconUrl: null, spaceId: spaceIds.product, createdAt: at(70 * DAY) },
  ]
  const downloads: Download[] = [
    { id: 'd1', url: 'https://www.mhlw.go.jp/content/12300000/001234567.pdf', filename: '介護報酬改定の概要.pdf', savePath: '/Users/saeki/Downloads/介護報酬改定の概要.pdf', state: 'completed', receivedBytes: 2_412_000, totalBytes: 2_412_000, startedAt: at(14 * DAY) },
    { id: 'd2', url: 'https://kaikei-cloud.jp/invoices/2026-11.pdf', filename: '請求書_2026-11.pdf', savePath: null, state: 'progressing', receivedBytes: 310_000, totalBytes: 820_000, startedAt: at(1) },
  ]

  return {
    me,
    token: 'rig-session-token-0123456789abcdef',
    spaces,
    members,
    invites,
    items,
    threads,
    messages,
    models,
    usage,
    audit,
    settings,
    history,
    bookmarks,
    downloads,
    pages,
    ids: { privateThread, spaceThread, attachedQuestion, plainQuestion, streamingAnswer },
  }
}

/** What the engine's capture returns for a fixture page (blocked pages never get here). */
export function extractedPage(p: FixturePage): ExtractedPage {
  return {
    url: p.url,
    title: p.title,
    sourceType: p.sourceType,
    markdown: p.markdown,
    lang: 'ja',
    byline: null,
    siteName: p.siteName,
    extractor: p.sourceType.startsWith('google-') ? 'google-docs-export@1' : 'readability@1',
    capturedAt: new Date(NOW).toISOString(),
    charCount: p.markdown.length,
    truncated: false,
  }
}
