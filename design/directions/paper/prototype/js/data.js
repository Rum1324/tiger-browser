/*
 * Mock data: Hibari, a four-founder startup raising its seed round. "Now" is Thu 26 Nov 2026, 14:31.
 * All people, companies, banks and domains are fictional.
 */
window.DATA = {
  people: {
    hayase: { sei: '早瀬', mei: '湊', mono: '早', you: true },
    natsume: { sei: '夏目', mei: '葵', mono: '夏' },
    miura: { sei: '三浦', mei: '陸', mono: '三' },
    okabe: { sei: '岡部', mei: '詩織', mono: '岡' },
  },

  space: { name: '資金調達 2027', mono: '資', members: 4, items: 41 },
  spaces: [
    { name: '資金調達 2027', mono: '資', members: 4, items: 41, key: '⌃1', current: true },
    { name: '採用', mono: '採', members: 3, items: 18, key: '⌃2' },
    { name: 'プロダクト', mono: 'プ', members: 4, items: 67, key: '⌃3' },
  ],

  tabs: {
    pitch: {
      glyph: 'doc',
      title: '投資家向けピッチ v3',
      host: 'docs.google.com',
      app: 'Google ドキュメント',
      shared: { by: 'hayase', ed: 2, when: '2時間前' },
    },
    cap: {
      glyph: 'table',
      title: '資本政策表 2027',
      host: 'notion.so',
      app: 'Notion',
      shared: { by: 'natsume', ed: 2, when: '33分前' },
      here: ['natsume'],
    },
    market: {
      glyph: 'pdf',
      title: '訪問介護の市場規模 2026.pdf',
      host: 'drive.google.com',
      app: 'PDF',
      shared: { by: 'miura', ed: 1, when: '11月20日' },
    },
    slack: { glyph: 'hash', title: '#fundraising — Slack', host: 'app.slack.com', app: 'Slack' },
    news: {
      glyph: 'globe',
      title: '介護テックの資金調達、7〜9月は12%増',
      host: 'kaigo-keiei.jp',
      app: 'Web',
    },
    bank: {
      glyph: 'bank',
      title: 'つばめ銀行 — 口座一覧',
      host: 'direct.tsubamebank.jp',
      app: 'Web',
      blocked: '銀行・決済',
    },
    mail: {
      glyph: 'mail',
      title: '受信トレイ（3）— メール',
      host: 'mail.google.com',
      app: 'Web',
      blocked: 'メール本文',
    },
  },

  /* The ledger: every item in the Space, newest share first. `gone` is an audit tombstone. */
  ledger: [
    { glyph: 'doc', title: '投資家向けピッチ v3', app: 'Google ドキュメント', host: 'docs.google.com', by: 'hayase', when: '今日 14:52', ed: 3, fresh: true },
    { glyph: 'table', title: '資本政策表 2027', app: 'Notion', host: 'notion.so', by: 'natsume', when: '今日 13:58', ed: 2 },
    { glyph: 'table', title: '面談メモ：青葉キャピタル', app: 'Notion', host: 'notion.so', by: 'okabe', when: '11月24日 18:20', ed: 1 },
    { glyph: 'hash', title: '#fundraising 11月24日のスレッド', app: 'Slack', host: 'app.slack.com', by: 'okabe', when: '11月24日 16:05', ed: 1 },
    { glyph: 'table', title: '投資家リスト（シード〜プレA）', app: 'Notion', host: 'notion.so', by: 'natsume', when: '11月22日 10:12', ed: 4 },
    { glyph: 'doc', title: 'タームシート比較メモ', app: 'Google ドキュメント', host: 'docs.google.com', by: 'natsume', when: '11月21日 09:47', gone: '11月23日に夏目が解除 · 本文と全2版を削除済み' },
    { glyph: 'pdf', title: '訪問介護の市場規模 2026.pdf', app: 'PDF', host: 'drive.google.com', by: 'miura', when: '11月20日 11:40', ed: 1 },
    { glyph: 'doc', title: '月次KPIレポート（10月）', app: 'Google ドキュメント', host: 'docs.google.com', by: 'miura', when: '11月18日 09:30', ed: 3 },
    { glyph: 'pdf', title: 'J-KISS型新株予約権の手引き.pdf', app: 'PDF', host: 'drive.google.com', by: 'hayase', when: '11月15日 21:04', ed: 1 },
    { glyph: 'table', title: '競合比較：介護記録ソフト6社', app: 'Notion', host: 'notion.so', by: 'okabe', when: '11月14日 15:26', ed: 2 },
    { glyph: 'globe', title: 'シード期の資本政策で先に決めること', app: 'Web', host: 'startup-note.jp', by: 'hayase', when: '11月12日 23:11', ed: 1 },
    { glyph: 'hash', title: '#fundraising 11月10日のスレッド', app: 'Slack', host: 'app.slack.com', by: 'miura', when: '11月10日 19:02', ed: 1 },
  ],

  /* The pitch document. `v3` lines exist only in the unshared edit that becomes 第3版. */
  pitch: {
    title: '投資家向けピッチ v3',
    meta: 'Hibari 株式会社｜2026年11月｜社外秘',
    sections: [
      { h: '1. 課題', p: '訪問介護の現場では、記録の作成に1人あたり1日72分かかっています。その6割は、手書きメモからの転記です。' },
      { h: '2. 解決策', p: 'Hibari は、音声と写真から介護記録の下書きをつくり、既存の介護ソフトへ書き出します。現場の手順は変えません。' },
      {
        h: '3. トラクション（2026年10月末）',
        table: [
          ['指標', '数値'],
          ['有料導入', '14事業所'],
          ['MRR', '126万円'],
          ['月次解約率', '0.8%'],
          ['記録時間の削減', '平均41分／日'],
        ],
      },
      {
        h: '4. 調達概要',
        list: [
          { t: '調達希望額：1.5億円（シード）' },
          { t: '想定希薄化：20.0%（プレマネー6億円）', v3: '追加' },
          { t: '資金使途：開発55%、営業30%、運営15%' },
          { t: 'ランウェイ：18か月', t3: 'ランウェイ：18か月（2028年5月まで）', v3: '変更' },
        ],
      },
    ],
  },
}
