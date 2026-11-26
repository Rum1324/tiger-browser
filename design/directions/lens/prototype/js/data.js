/* Fictional data: a four-founder startup (株式会社ミナモ) raising a pre-seed round. Today is 2026-11-26. */
const ME = 'mikami';

const MEMBERS = {
  mikami: { name: '三上 遥', mono: '三' },
  kubo: { name: '久保 蓮', mono: '久' },
  hayase: { name: '早瀬 美月', mono: '早' },
  noguchi: { name: '野口 拓海', mono: '野' },
};

const SPACES = {
  fund: { name: '資金調達 2027', items: 41, members: 4, key: '⌃1' },
  hire: { name: '採用', items: 18, members: 3, key: '⌃2' },
  prod: { name: 'プロダクト', items: 63, members: 4, key: '⌃3' },
};

const SOURCES = {
  gdoc: { label: 'Google ドキュメント', glyph: 'doc' },
  gsheet: { label: 'Google スプレッドシート', glyph: 'sheet' },
  slack: { label: 'Slack', glyph: 'hash' },
  notion: { label: 'Notion', glyph: 'blocks' },
  pdf: { label: 'PDF', glyph: 'pdf' },
};

/* Shared items of 資金調達 2027, newest first. The audit view lists these. */
const ITEMS = [
  { id: 'pitch', title: '投資家向けピッチ v3', src: 'gdoc', by: 'mikami', when: '12:06', ver: 1, fresh: true },
  { id: 'slack', title: '#fundraising 11/18〜11/25', src: 'slack', by: 'hayase', when: '昨日 18:40', ver: 3 },
  { id: 'term', title: 'タームシート案（J-KISS）', src: 'pdf', by: 'kubo', when: '11/24', ver: 1 },
  { id: 'kaede', title: '面談メモ：Kaede Capital', src: 'gdoc', by: 'mikami', when: '11/20', ver: 1 },
  { id: 'list', title: '投資家リスト 2027', src: 'notion', by: 'hayase', when: '11/19', ver: 4 },
  { id: 'cap', title: '資本政策表 v4', src: 'gsheet', by: 'kubo', when: '11/15', ver: 3 },
  { id: 'comp', title: '競合比較メモ', src: 'notion', by: 'kubo', when: '11/12', ver: 1 },
  { id: 'kpi', title: '月次KPI 2026年10月', src: 'gsheet', by: 'noguchi', when: '11/04', ver: 2 },
  { id: 'qa', title: '投資家向け想定問答', src: 'gdoc', by: 'hayase', when: '11/02', ver: 2 },
  { id: 'upd', title: '#investor-updates 10月', src: 'slack', by: 'mikami', when: '10/30', ver: 1 },
  { id: 'contract', title: '投資契約書ドラフト', src: 'pdf', by: 'kubo', when: '10/28', ver: 1 },
  { id: 'plan', title: '事業計画 2027〜2029', src: 'gsheet', by: 'mikami', when: '10/21', ver: 5 },
  { id: 'hearing', title: '導入施設ヒアリングまとめ', src: 'notion', by: 'noguchi', when: '10/14', ver: 2 },
];

/* Open tabs. `shared` = a snapshot of this page is in the current Space. */
const TABS = {
  slack: { glyph: 'hash', title: '#fundraising', host: 'app.slack.com', shared: true },
  notion: { glyph: 'blocks', title: '採用計画 2027', host: 'notion.so' },
  docs: { glyph: 'doc', title: '投資家向けピッチ v3', host: 'docs.google.com' },
  pdf: { glyph: 'pdf', title: 'タームシート案.pdf', host: 'drive.google.com', shared: true },
  news: { glyph: 'news', title: 'スタートアップ調達額、7〜9月は12%増', host: 'keizai-shimpo.jp' },
  bank: { glyph: 'bank', title: '法人ダイレクト', host: 'direct.tsubame-bank.co.jp', sealed: true },
  space: { glyph: 'space', title: '資金調達 2027', host: 'tiger://space' },
  welcome: { glyph: 'frame', title: 'はじめに', host: 'tiger://welcome' },
  search: { glyph: 'search', title: '人間ドック 予約 渋谷', host: 'search.kensaku.jp' },
};

/* The exact Markdown the share preview shows: the extraction of the page mock in web.js. */
const PITCH_MD = [
  '# 投資家向けピッチ v3',
  '',
  '株式会社ミナモ ・ プレシードラウンド ・ 2026年11月25日 更新',
  '',
  '## ラウンド概要',
  '',
  '| 項目 | 内容 |',
  '| --- | --- |',
  '| 調達額 | 8,000万円 |',
  '| 形式 | J-KISS 型新株予約権 |',
  '| バリュエーションキャップ | 6億円 |',
  '| 想定ランウェイ | 18か月 |',
  '',
  '## 課題',
  '',
  '介護施設では、職員1人あたり1日平均72分が記録業務に使われています。夜勤帯は申し送りが口頭に偏り、記録漏れが事故報告の約3割に関係しています。',
  '',
  '## 解決策',
  '',
  'Minamo は、申し送りの音声から介護記録の下書きを自動で作成します。職員は内容を確かめて承認するだけで、既存の介護ソフトにそのまま書き出せます。',
  '',
  '## トラクション',
  '',
  '- 導入施設 12（2026年10月末）',
  '- MRR 96万円、月次解約率 0%',
  '- 記録時間は導入前より 41% 短縮',
  '',
  '## 資金使途',
  '',
  '開発 60%、営業 30%、運営 10%。',
];
