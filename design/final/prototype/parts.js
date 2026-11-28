/* Shared data and chrome parts for the Tiger prototype. Vanilla JS, no build step.
   Field names follow packages/shared/src/domain.ts and ipc.ts where a real object exists. */

/* ── people (UserRef). photo = avatarUrl present; the mock draws a stand-in portrait ── */
const PEOPLE = {
  saeki: { name: "佐伯 遥", short: "佐伯", mono: "佐", me: true },
  mori: { name: "森 拓海", short: "森", mono: "森", photo: "a" },
  ono: { name: "小野 美咲", short: "小野", mono: "小", photo: "b" },
  kashiwagi: { name: "柏木 蓮", short: "柏木", mono: "柏" },
};

/* ── Spaces (Space.hue is a SpaceHue key; the seal is one character chosen at creation) ── */
const SPACES = {
  fund: { name: "資金調達 2027", seal: "資", hue: "amber", members: 4, items: 41 },
  hire: { name: "採用", seal: "採", hue: "green", members: 3, items: 18 },
  product: { name: "プロダクト", seal: "製", hue: "indigo", members: 4, items: 27 },
};

/* ── pages a tab can show. fav = stand-in favicon; block = CaptureBlockReason ── */
const PAGES = {
  pitch: { fav: "gdoc", title: "投資家向けピッチ v3", url: ["docs.", "google.com", "/document/d/1mKx7RfQe8"] },
  dilution: { fav: "gsheet", title: "希薄化シミュレーション", url: ["docs.", "google.com", "/spreadsheets/d/1Zt4wPq0Lm"] },
  slack: { fav: "chat", title: "#fundraising — コトノハ", url: ["kotonoha.", "slack.com", "/archives/C06FUND"] },
  notion: { fav: "notes", title: "資本政策メモ", url: ["www.", "notion.so", "/kotonoha/shihon-seisaku-8f2a"] },
  pdf: { fav: "pdf", title: "国内介護ソフト市場規模 2026.pdf", url: ["drive.", "google.com", "/file/d/1Qx9KaigoMarket/view"] },
  news: { fav: "news", title: "介護テックのシード調達、3年ぶりに増加", url: ["", "care-keizai.jp", "/articles/2026/11/seed-funding"] },
  gmail: { fav: "mail", title: "受信トレイ (3)", url: ["mail.", "google.com", "/mail/u/0/#inbox"], block: "email" },
  bank: { fav: "bank", title: "つばめ銀行 ビジネスダイレクト", url: ["biz.", "tsubamebank.co.jp", "/account/statement"], block: "banking" },
  cal: { fav: "cal", title: "カレンダー — 2026年11月", url: ["calendar.", "google.com", "/calendar/u/0/r/month"] },
  hireplan: { fav: "notes", title: "採用計画 2027", url: ["www.", "notion.so", "/kotonoha/saiyo-keikaku-2027-41c0"] },
  mizunara: { fav: "web", title: "ミズナラ・キャピタル｜投資方針", url: ["", "mizunara-capital.jp", "/policy"] },
  jkiss: { fav: "web", title: "J-KISS 型新株予約権の手引き", url: ["", "startup-houmu.jp", "/guide/j-kiss"] },
  kpi: { fav: "gsheet", title: "月次KPI 2026年10月", url: ["docs.", "google.com", "/spreadsheets/d/1KpiOct2026"] },
  compete: { fav: "gdoc", title: "競合比較", url: ["docs.", "google.com", "/document/d/1CmpKaigo6"] },
  mhlwpdf: { fav: "pdf", title: "介護報酬改定の概要.pdf", url: ["www.", "mhlw.go.jp", "/content/12300000/001234567.pdf"] },
  investors: { fav: "gsheet", title: "投資家リスト 2027", url: ["docs.", "google.com", "/spreadsheets/d/1InvList27"] },
  plan: { fav: "gdoc", title: "事業計画 2027–2029", url: ["docs.", "google.com", "/document/d/1BizPlan2729"] },
  schedule: { fav: "gdoc", title: "シード調達スケジュール", url: ["docs.", "google.com", "/document/d/1SeedSched"] },
  mhlw: { fav: "web", title: "介護保険事業状況報告｜厚生労働省", url: ["www.", "mhlw.go.jp", "/topics/kaigo/osirase/jigyo"] },
  search1: { fav: "search", title: "訪問介護 記録 時間 調査 — 検索", url: ["www.", "google.com", "/search?q=訪問介護+記録+時間+調査"] },
  demo: { fav: "video", title: "デモ動画：記録の下書き", url: ["", "kotonoha.example", "/demo/draft"], audible: true },
  termsheet: { fav: "gdoc", title: "タームシート比較メモ", url: ["docs.", "google.com", "/document/d/1TermCmp"] },
  glogin: { fav: "web", title: "ログイン — Google アカウント", url: ["accounts.", "google.com", "/v3/signin/identifier"], block: "auth" },
  pwm: { fav: "key", title: "保管庫 — パスワード管理", url: ["my.", "1password.com", "/vaults/all"], block: "password-manager" },
  local: { fav: "web", title: "コトノハ管理画面（開発）", url: ["", "localhost:5173", "/admin"], block: "local-network" },
  pr: { fav: "code", title: "#482 請求ソフト連携の再試行", url: ["", "github.com", "/kotonoha/app/pull/482"] },
  spec: { fav: "notes", title: "請求ソフト連携 仕様", url: ["www.", "notion.so", "/kotonoha/seikyu-renkei-b71d"] },
  faq: { fav: "notes", title: "想定問答：シードラウンド", url: ["www.", "notion.so", "/kotonoha/soutei-mondo-55e2"] },
  interviews: { fav: "notes", title: "インタビュー記録：訪問介護6事業所", url: ["www.", "notion.so", "/kotonoha/interview-6-9a10"] },
  etax: { fav: "web", title: "e-Tax｜国税電子申告・納税システム", url: ["www.", "e-tax.nta.go.jp", "/"], block: "banking" },
  capnote: { fav: "web", title: "シード期の資本政策で先に決めること", url: ["", "startup-note.jp", "/articles/cap-table-first"] },
  search2: { fav: "search", title: "新株予約権 税制適格 要件 — 検索", url: ["www.", "google.com", "/search?q=新株予約権+税制適格+要件"] },
  cal12: { fav: "cal", title: "カレンダー — 2026年12月", url: ["calendar.", "google.com", "/calendar/u/0/r/month/2026/12/1"] },
  invoice: { fav: "analytics", title: "請求書 11月分 — 会計", url: ["app.", "kaikei-cloud.jp", "/invoices/2026-11"] },
  design: { fav: "design", title: "ピッチ資料の図版", url: ["www.", "figma.com", "/design/Kp3/pitch-figures"] },
  slackpin: { fav: "chat", title: "コトノハ — チャット", url: ["kotonoha.", "slack.com", "/"] },
  notionpin: { fav: "notes", title: "コトノハ — ノート", url: ["www.", "notion.so", "/kotonoha"] },
  codepin: { fav: "code", title: "kotonoha/app", url: ["", "github.com", "/kotonoha/app"] },
  drive: { fav: "drive", title: "マイドライブ", url: ["drive.", "google.com", "/drive/my-drive"] },
  ntp: { fav: "tab", title: "新しいタブ", url: ["", "", ""] },
  welcome: { fav: "tab", title: "はじめに", url: ["", "", ""] },
};

/* capture.reason.* in packages/client/src/i18n/ja.ts, as a noun phrase for the toolbar */
const BLOCK = {
  banking: { short: "金融サービスのページ", full: "金融サービスのページは共有できません。" },
  email: { short: "メールのページ", full: "メールのページは共有できません。" },
  "password-manager": { short: "パスワード管理のページ", full: "パスワード管理のページは共有できません。" },
  auth: { short: "ログインやアカウントのページ", full: "ログインやアカウントのページは共有できません。" },
  "local-network": { short: "社内やローカルのアドレス", full: "社内やローカルのアドレスは共有できません。" },
  "user-rule": { short: "あなたが共有しない設定にしたサイト", full: "あなたが共有しない設定にしたサイトです。" },
  incognito: { short: "プライベートウインドウ", full: "プライベートウィンドウのページは共有できません。" },
};

/* ── shared items of 資金調達 2027, newest change first (Item: sourceType, sharedBy, currentVersion.number, updatedAt) ── */
const SOURCE = {
  "google-doc": { icon: "doc", label: "Google ドキュメント" },
  "google-sheet": { icon: "grid", label: "Google スプレッドシート" },
  "google-slides": { icon: "slides", label: "Google スライド" },
  slack: { icon: "hash", label: "Slack" },
  notion: { icon: "note", label: "Notion" },
  pdf: { icon: "pdf", label: "PDF" },
  web: { icon: "globe", label: "Web" },
};
const ITEMS = [
  { id: "pitch", title: "投資家向けピッチ v3", type: "google-doc", host: "docs.google.com", by: "saeki", at: "今日 12:14", v: 2 },
  { id: "slack", title: "#fundraising", type: "slack", host: "kotonoha.slack.com", by: "ono", at: "昨日 18:40", v: 5 },
  { id: "pdf", title: "国内介護ソフト市場規模 2026.pdf", type: "pdf", host: "drive.google.com", by: "mori", at: "11/23 09:02", v: 1, extra: "14ページ" },
  { id: "mizunara", title: "面談メモ：ミズナラ・キャピタル", type: "notion", host: "notion.so", by: "ono", at: "11/21 17:26", v: 2 },
  { id: "termsheet", title: "タームシート比較メモ", type: "google-doc", host: "docs.google.com", by: "saeki", at: "11/21 15:48", v: 2, gone: { by: "saeki", at: "11/21 16:30" } },
  { id: "notion", title: "資本政策メモ", type: "notion", host: "notion.so", by: "saeki", at: "11/20 10:15", v: 2 },
  { id: "kpi", title: "月次KPI 2026年10月", type: "google-sheet", host: "docs.google.com", by: "mori", at: "11/18 19:31", v: 4 },
  { id: "compete", title: "競合比較", type: "google-doc", host: "docs.google.com", by: "kashiwagi", at: "11/15 13:07", v: 2 },
  { id: "mhlwpdf", title: "介護報酬改定の概要.pdf", type: "pdf", host: "mhlw.go.jp", by: "kashiwagi", at: "11/12 11:44", v: 1, extra: "32ページ" },
  { id: "investors", title: "投資家リスト 2027", type: "google-sheet", host: "docs.google.com", by: "ono", at: "11/10 16:20", v: 7 },
  { id: "interviews", title: "インタビュー記録：訪問介護6事業所", type: "notion", host: "notion.so", by: "kashiwagi", at: "11/06 14:52", v: 1 },
  { id: "schedule", title: "シード調達スケジュール", type: "google-doc", host: "docs.google.com", by: "saeki", at: "11/04 09:30", v: 3 },
  { id: "capnote", title: "シード期の資本政策で先に決めること", type: "web", host: "startup-note.jp", by: "mori", at: "11/02 23:11", v: 1 },
  { id: "faq", title: "想定問答：シードラウンド", type: "notion", host: "notion.so", by: "mori", at: "10/28 20:40", v: 6 },
  { id: "plan", title: "事業計画 2027–2029", type: "google-doc", host: "docs.google.com", by: "saeki", at: "10/27 09:15", v: 2 },
];

/* プロダクト: a second Space with another hue and another owner */
const PRODUCT_ITEMS = [
  { id: "p-spec", title: "請求ソフト連携 仕様", type: "notion", host: "notion.so", by: "mori", at: "今日 11:02", v: 4 },
  { id: "p-slack", title: "#product", type: "slack", host: "kotonoha.slack.com", by: "kashiwagi", at: "昨日 19:10", v: 9 },
  { id: "p-eval", title: "記録下書きの評価 10月", type: "google-sheet", host: "docs.google.com", by: "mori", at: "11/22 14:20", v: 2 },
  { id: "p-req", title: "導入14事業所の要望一覧", type: "notion", host: "notion.so", by: "kashiwagi", at: "11/19 10:36", v: 3 },
];
/* the item that exists once 03-share-preview is confirmed (shown in 03c) */
const NEW_ITEM = { id: "dilution", title: "希薄化シミュレーション", type: "google-sheet", host: "docs.google.com", by: "saeki", at: "今日 14:36", v: 1 };
const ALL_ITEMS = [...ITEMS, ...PRODUCT_ITEMS, NEW_ITEM];

/* ── atoms ── */
/* Stand-in favicons: generic glyphs in real-world hues, not the marks of any product.
   They are page content (a live favicon paints itself); colours are --mock-* tokens. */
const FAVS = {
  gdoc: `<rect x="2" y="1.5" width="12" height="13" rx="2.5" style="fill:var(--mock-blue)"/><path d="M5 5.5h6M5 8h6M5 10.5h3.5" style="stroke:var(--mock-white);stroke-width:1.2;fill:none;stroke-linecap:round"/>`,
  gsheet: `<rect x="2" y="1.5" width="12" height="13" rx="2.5" style="fill:var(--mock-green)"/><path d="M5 5h6v6H5zM5 8h6M8 5v6" style="stroke:var(--mock-white);stroke-width:1.1;fill:none"/>`,
  pdf: `<rect x="2" y="1.5" width="12" height="13" rx="2.5" style="fill:var(--mock-red)"/><path d="M5 5h6M5 7.25h4" style="stroke:var(--mock-white);stroke-width:1.2;fill:none;stroke-linecap:round"/><rect x="4.5" y="9.25" width="7" height="2.5" rx=".6" style="fill:var(--mock-white)"/>`,
  chat: `<rect x="1.5" y="1.5" width="13" height="13" rx="3.5" style="fill:var(--mock-aubergine)"/><path d="M6.6 4.5 5.9 11.5M10.1 4.5 9.4 11.5M4.5 6.6h7.2M4.3 9.4h7.2" style="stroke:var(--mock-white);stroke-width:1.2;fill:none;stroke-linecap:round"/>`,
  notes: `<rect x="2" y="2" width="12" height="12" rx="2.5" style="fill:var(--mock-white);stroke:var(--mock-black);stroke-width:1.2"/><rect x="4.75" y="4.75" width="2.75" height="2.75" style="fill:var(--mock-black)"/><path d="M9 5.25h2.25M9 7h2.25M4.75 9.5h6.5M4.75 11.25h4.5" style="stroke:var(--mock-black);stroke-width:1.1;fill:none;stroke-linecap:round"/>`,
  mail: `<rect x="1.5" y="3" width="13" height="10" rx="2.25" style="fill:var(--mock-red)"/><path d="M3.75 5.75 8 9l4.25-3.25" style="stroke:var(--mock-white);stroke-width:1.4;fill:none;stroke-linejoin:round;stroke-linecap:round"/>`,
  cal: `<rect x="2" y="2" width="12" height="12" rx="2.5" style="fill:var(--mock-white);stroke:var(--mock-line);stroke-width:1"/><path d="M2 5.5V4.5A2.5 2.5 0 0 1 4.5 2h7A2.500 2.500 0 0 1 14 4.500v1z" style="fill:var(--mock-blue)"/><path d="M6 8.2h4L7.6 12" style="stroke:var(--mock-ink);stroke-width:1.2;fill:none;stroke-linecap:round;stroke-linejoin:round"/>`,
  news: `<rect x="1.5" y="1.5" width="13" height="13" rx="3" style="fill:var(--mock-teal)"/><path d="M5 5h6M5 5v6M5 8h4.500M5 11h6" style="stroke:var(--mock-white);stroke-width:1.4;fill:none;stroke-linecap:round"/>`,
  bank: `<rect x="1.5" y="1.5" width="13" height="13" rx="3" style="fill:var(--mock-navy)"/><path d="M3.750 6.250c1.900.2 3.300 1.300 4.250 3.500.950-2.200 2.350-3.300 4.250-3.500" style="stroke:var(--mock-crimson);stroke-width:1.8;fill:none;stroke-linecap:round;stroke-linejoin:round"/>`,
  code: `<rect x="1.5" y="1.5" width="13" height="13" rx="3.5" style="fill:var(--mock-black)"/><path d="M6.500 6 4.500 8l2 2M9.500 6l2 2-2 2" style="stroke:var(--mock-white);stroke-width:1.3;fill:none;stroke-linecap:round;stroke-linejoin:round"/>`,
  design: `<rect x="1.5" y="1.5" width="13" height="13" rx="3.5" style="fill:var(--mock-violet)"/><circle cx="8" cy="8" r="2.6" style="stroke:var(--mock-white);stroke-width:1.3;fill:none"/>`,
  analytics: `<rect x="1.5" y="1.5" width="13" height="13" rx="3" style="fill:var(--mock-orange)"/><path d="M5 11V8.500M8 11V5M11 11V7" style="stroke:var(--mock-white);stroke-width:1.6;fill:none;stroke-linecap:round"/>`,
  video: `<rect x="1.5" y="1.5" width="13" height="13" rx="3" style="fill:var(--mock-teal)"/><path d="M6.500 5.250v5.500L11 8z" style="fill:var(--mock-white)"/>`,
  drive: `<path d="M1.750 4.250A1.250 1.250 0 0 1 3 3h3.250l1.500 1.750H13a1.250 1.250 0 0 1 1.250 1.250v6A1.250 1.250 0 0 1 13 13.250H3a1.250 1.250 0 0 1-1.250-1.250z" style="fill:var(--mock-yellow)"/>`,
};
function favicon(kind, size = 16) {
  if (kind === "web" || kind === "search" || kind === "key" || kind === "tab") {
    const map = { web: "globe", search: "search", key: "key", tab: "page" };
    return `<span class="fav fav--glyph">${icon(map[kind], size)}</span>`;
  }
  return `<svg class="fav" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true">${FAVS[kind]}</svg>`;
}

const PHOTOS = {
  a: `<rect width="24" height="24" style="fill:var(--photo-bg-a)"/><path d="M2.5 24c.4-5 4.3-7.6 9.5-7.6s9.1 2.6 9.5 7.6z" style="fill:var(--photo-cloth-a)"/><rect x="10.2" y="13" width="3.6" height="4.5" rx="1.6" style="fill:var(--photo-skin-2)"/><ellipse cx="12" cy="10" rx="4.3" ry="4.9" style="fill:var(--photo-skin)"/><path d="M7.4 9.6C7 6.2 9 4.2 12.2 4.2c3 0 4.8 2 4.4 5.3-.9-1.7-2-2.5-4.6-2.6-2.300 0-3.800.9-4.6 2.7z" style="fill:var(--photo-hair)"/>`,
  b: `<rect width="24" height="24" style="fill:var(--photo-bg-b)"/><path d="M6.300 18.500C5.400 13 6 4.600 12 4.600s6.600 8.400 5.700 13.900z" style="fill:var(--photo-hair-2)"/><path d="M2.500 24c.4-4.800 4.300-7.200 9.500-7.200s9.100 2.400 9.500 7.200z" style="fill:var(--photo-cloth-b)"/><rect x="10.300" y="13.200" width="3.400" height="4.300" rx="1.600" style="fill:var(--photo-skin-2)"/><ellipse cx="12" cy="10.400" rx="4" ry="4.700" style="fill:var(--photo-skin)"/><path d="M7.900 10.200c.2-3 1.700-4.600 4.100-4.600 2.500 0 4 1.700 4.100 4.600-1.300-.6-2.600-1.800-3.300-3.100-1 1.500-2.700 2.700-4.900 3.100z" style="fill:var(--photo-hair-2)"/>`,
};
function avatar(id, size = 20, extra = "") {
  const p = PEOPLE[id];
  if (p.photo)
    return `<span class="av av--${size} av--photo ${extra}" title="${p.name}"><svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${PHOTOS[p.photo]}</svg></span>`;
  return `<span class="av av--${size}${p.me ? " av--me" : ""} ${extra}" title="${p.name}">${p.mono}</span>`;
}

/* the seal names a Space by one character and by hue. hollow = the Space holds an older version */
function seal(space, size = 24, { hollow = false, extra = "" } = {}) {
  if (space === "ai") return `<span class="seal seal--${size} seal--ai ${extra}" title="Tiger">虎</span>`;
  const s = SPACES[space];
  return `<span class="seal seal--${size}${hollow ? " seal--hollow" : ""} ${extra}" data-space="${s.hue}" title="${s.name}">${s.seal}</span>`;
}

function kbd(keys) {
  return `<span class="keys">${keys
    .map((k) => (ICONS[k] ? `<kbd class="key">${icon(k, 12, "", 1.25)}</kbd>` : `<kbd class="key">${k}</kbd>`))
    .join("")}</span>`;
}

function lights(inactive = false) {
  return `<div class="lights${inactive ? " is-inactive" : ""}" aria-hidden="true"><i></i><i></i><i></i></div>`;
}

/* [n] citation chip. gone = Citation.available is false */
function cite(n, { gone = false } = {}) {
  return `<button class="cite${gone ? " cite--gone" : ""}" aria-label="出典${n}${gone ? "（共有を解除済み）" : ""}">${n}</button>`;
}
/* a citation chip never starts a line and never loses its punctuation (kinsoku): the last two
   characters of the figure, the chip and the punctuation after it stay together. The unit is kept
   short so a justified line is never stretched far. */
function fig(text, n, tail = "", opts) {
  const chip = n === "添付" ? `<span class="cite cite--attach">添付</span>` : cite(n, opts);
  return `${text.slice(0, -2)}<span class="nb">${text.slice(-2)}${chip}${tail}</span>`;
}

/* who · version · when, set in type */
function byline(parts, cls = "") {
  return `<span class="byline ${cls}">${parts.filter(Boolean).join('<i class="sep">・</i>')}</span>`;
}
function itemByline(it, { full = false, source = false } = {}) {
  const who = full ? PEOPLE[it.by].name : PEOPLE[it.by].short;
  return byline([source ? SOURCE[it.type].label : "", who, `第${it.v}版`, it.at]);
}

/* ── sidebar ──
   s.space      key of SPACES
   s.items      ids shown in スペースの共有 (default: newest four)
   s.current    id of the item whose URL the active tab shows (if the Space holds it)
   s.pins       page ids of pinned tabs
   s.tabs       page ids of tabs in this Space on this Mac, in the member's order
   s.active     active tab (page id)
   s.marks      { pageId: "fresh" | "stale" | "attached" | "else:<space>" } from the local item index */
function tabMark(id, s) {
  const p = PAGES[id];
  const m = (s.marks || {})[id];
  const out = [];
  if (p.audible) out.push(`<span class="tab-sound" title="音が出ています">${icon("sound", 14)}</span>`);
  if (m && m.includes("attached")) out.push(`<span class="tab-frame" title="次の質問に添付">${icon("frame", 16)}</span>`);
  if (p.block) out.push(`<span class="tab-lock" title="${BLOCK[p.block].full}">${icon("lock", 14)}</span>`);
  else if (m && m.includes("fresh")) out.push(seal(s.space, 16));
  else if (m && m.includes("stale")) out.push(seal(s.space, 16, { hollow: true }));
  else if (m && m.includes("else:")) out.push(seal(m.split("else:")[1].split(" ")[0], 16));
  return out.length ? `<span class="tab-trail">${out.join("")}</span>` : "";
}
function tabRow(id, s) {
  const p = PAGES[id];
  const active = s.active === id;
  const hover = s.hover === id;
  const close = hover ? `<span class="tab-close" aria-label="タブを閉じる">${icon("close", 14)}</span>` : "";
  return `<li><a class="tab${active ? " is-active" : ""}${hover ? " is-hover" : ""}" href="#" ${active ? 'aria-current="page"' : ""}><span class="tab-ico">${favicon(p.fav)}</span><span class="tab-title">${p.title}</span>${tabMark(id, s)}${close}</a></li>`;
}
function pinTile(id, s) {
  const p = PAGES[id];
  const m = (s.marks || {})[id];
  const pip = p.block ? "" : m === "fresh" ? `<i class="pin-pip"></i>` : "";
  return `<li><a class="pin${s.active === id ? " is-active" : ""}" href="#" title="${p.title}">${favicon(p.fav)}${pip}</a></li>`;
}
function itemRow(id, s) {
  const it = ALL_ITEMS.find((x) => x.id === id);
  const cur = s.current === id;
  return `<li><a class="item${cur ? " is-current" : ""}${s.landing === id ? " is-landing" : ""}" href="#">
    <span class="item-ico">${icon(SOURCE[it.type].icon)}</span>
    <span class="item-text"><span class="item-title">${it.title}</span>${byline([PEOPLE[it.by].short, `第${s.itemV?.[id] ?? it.v}版`, s.itemAt?.[id] ?? it.at])}</span>
  </a></li>`;
}

function sidebar(s) {
  const sp = SPACES[s.space];
  const items = s.items || ["pitch", "slack", "pdf", "mizunara"];
  const count = s.itemCount ?? sp.items;
  const doors = (s.doors || ["fund", "hire", "product"])
    .map((r) => `<button class="door${r === s.space ? " is-current" : ""}" aria-label="${SPACES[r].name} に切り替え">${seal(r, 24)}</button>`)
    .join("");
  const shelf = `
    <section class="shelf" aria-label="スペースの共有">
      <header class="zone-head">
        <span class="zone-label">スペースの共有</span><span class="zone-count">${count}</span>
        <a class="zone-link" href="#">すべて見る</a>
      </header>
      ${
        items.length
          ? `<ul class="items">${items.map((id) => itemRow(id, s)).join("")}</ul>`
          : `<p class="zone-empty">まだ何もありません。共有したページが、共有した人・版・日時つきでここに並びます。</p>`
      }
    </section>`;
  const pins = s.pins && s.pins.length ? `<ul class="pins">${s.pins.map((id) => pinTile(id, s)).join("")}</ul>` : "";
  const total = (s.pins ? s.pins.length : 0) + s.tabs.length;
  return `
  <aside class="sidebar">
    <div class="sb-top">${lights(s.inactive)}<button class="ibtn" aria-label="サイドバーをたたむ">${icon("sidebar")}</button></div>
    <button class="space-head${s.home ? " is-active" : ""}" aria-label="スペースホームを開く">
      ${seal(s.space, 28)}
      <span class="space-head-text">
        <span class="space-name">${sp.name}</span>
        <span class="space-sub">メンバー${s.members ?? sp.members}人<i class="sep">・</i>共有${count}件</span>
      </span>
      ${icon("chevDown", 14, "space-chev")}
    </button>
    ${shelf}
    <section class="pocket${s.scrolled ? " is-scrolled" : ""}" aria-label="このMacのタブ">
      <header class="zone-head zone-head--pocket">
        <span class="zone-label">${icon("laptop", 14)}このMacのタブ</span><span class="zone-count">${total}</span>
      </header>
      ${s.pocketNote ? `<p class="zone-empty zone-empty--pocket">${s.pocketNote}</p>` : ""}
      ${pins}
      <div class="pocket-scroll"${s.scrollTop ? ` data-scroll="${s.scrollTop}"` : ""}>
        <ul class="tabs">${s.tabs.map((id) => tabRow(id, s)).join("")}</ul>
      </div>
      ${s.scrollbar ? `<i class="scrollbar" style="top:${s.scrollbar[0]}px;height:${s.scrollbar[1]}px"></i>` : ""}
      <button class="tab tab--new"><span class="tab-ico">${icon("plus")}</span><span class="tab-title">新しいタブ</span>${kbd(["kCmd", "T"])}</button>
    </section>
    <footer class="sb-foot">
      <div class="doors">${doors}<button class="ibtn" aria-label="スペースをつくる">${icon("plus")}</button></div>
      <button class="me" aria-label="佐伯 遥：設定とアカウント">${avatar("saeki", 24)}</button>
    </footer>
    ${s.ghost ? `<div class="tab tab--ghost" id="ghost"><span class="tab-ico">${favicon(PAGES[s.ghost].fav)}</span><span class="tab-title">${PAGES[s.ghost].title}</span></div>` : ""}
  </aside>`;
}

/* collapsed sidebar: a 52 px rail. The same two zones, favicons only. */
function rail(s) {
  const sp = SPACES[s.space];
  const mark = (id) => {
    const p = PAGES[id];
    const m = (s.marks || {})[id];
    if (p.block) return `<i class="rail-pip rail-pip--lock">${icon("lock", 10, "", 1.25)}</i>`;
    if (m === "fresh") return `<i class="rail-pip"></i>`;
    if (m === "stale") return `<i class="rail-pip rail-pip--hollow"></i>`;
    if (m && m.startsWith("else:")) return `<i class="rail-pip" data-space="${SPACES[m.slice(5)].hue}"></i>`;
    return "";
  };
  return `
  <aside class="sidebar sidebar--rail">
    <div class="sb-top">${lights()}</div>
    <button class="rail-btn rail-space" aria-label="${sp.name}：スペースホームを開く">${seal(s.space, 28)}</button>
    <button class="rail-btn rail-shelf" aria-label="スペースの共有 ${sp.items}件">${icon("keep")}<span class="rail-count">${sp.items}</span></button>
    <section class="pocket pocket--rail" aria-label="このMacのタブ">
      <span class="rail-head" title="このMacのタブ">${icon("laptop", 14)}</span>
      <ul class="rail-tabs">${[...(s.pins || []), ...s.tabs]
        .slice(0, s.railMax || 15)
        .map((id) => `<li><a class="rail-tab${s.active === id ? " is-active" : ""}" href="#" title="${PAGES[id].title}">${favicon(PAGES[id].fav)}${mark(id)}</a></li>`)
        .join("")}</ul>
      <span class="rail-more">+${(s.pins || []).length + s.tabs.length - (s.railMax || 15)}</span>
      <button class="rail-tab rail-new" aria-label="新しいタブ">${icon("plus")}</button>
    </section>
    <footer class="sb-foot sb-foot--rail">
      <button class="ibtn" aria-label="サイドバーをひらく">${icon("sidebar")}</button>
    </footer>
  </aside>`;
}

/* ── toolbar ──
   The capsule holds two facts about the page in the active tab: where it is (left) and who can
   read it (right). s.state is one of:
   local | fresh | stale | elsewhere | blocked | private | pending | home */
function urlText(parts) {
  const [sub, domain, path] = parts;
  return `<span class="url"><span class="url-sub">${sub}</span><span class="url-domain">${domain}</span><span class="url-path">${path}</span></span>`;
}
function stateCluster(s) {
  const sp = s.space;
  const attach = s.attached
    ? `<span class="st-attach">${icon("frame", 16)}次の質問に添付<button class="st-x" aria-label="添付をやめる">${icon("close", 12, "", 1.25)}</button></span>`
    : "";
  const act = (label, cls = "") => `<button class="st-act ${cls}">${icon("cross", 14)}${label}</button>`;
  switch (s.state) {
    case "local":
      return `<span class="st st--local">${attach}<span class="st-main"><span class="st-glyph">${icon("laptop")}</span><span class="st-label">このMacのみ</span></span>${s.noShare ? "" : act("スペースに共有…")}</span>`;
    case "fresh":
      return `<span class="st st--fresh">${attach}<button class="st-main" aria-label="共有の状態">${seal(sp, 20)}<span class="st-label">${s.label || "共有中"}</span>${byline(s.by)}${icon("chevDown", 14, "st-chev")}</button></span>`;
    case "done":
      return `<span class="st st--fresh"><span class="st-main">${seal(sp, 20)}<span class="st-label">${s.label}</span>${byline(s.by)}</span><button class="st-act st-act--quiet">${icon("undo", 14)}取り消す</button></span>`;
    case "stale":
      return `<span class="st st--stale">${attach}<button class="st-main" aria-label="共有の状態">${seal(sp, 20, { hollow: true })}<span class="st-label">第${s.v}版を共有中</span>${s.attached ? "" : `<span class="byline">ページが共有後に更新されています</span>`}</button>${act("新しい版を共有…", "st-act--solid")}</span>`;
    case "elsewhere":
      return `<span class="st st--else">${attach}<button class="st-main" aria-label="共有の状態">${seal(s.other, 20)}<span class="st-label">「${SPACES[s.other].name}」で共有中</span>${byline(s.by)}</button>${act("このスペースにも共有…")}</span>`;
    case "blocked":
      return `<span class="st st--blocked"><button class="st-main${s.open ? " is-open" : ""}" aria-label="共有できない理由"><span class="st-glyph">${icon("lock")}</span><span class="st-label">共有できません</span><span class="byline">${BLOCK[s.reason].short}</span>${icon("chevDown", 14, "st-chev")}</button></span>`;
    case "private":
      return `<span class="st st--blocked"><span class="st-main"><span class="st-glyph">${icon("glasses")}</span><span class="st-label">プライベート</span><span class="byline">共有も添付もできません</span></span></span>`;
    case "pending":
      return `<span class="st st--local"><span class="st-main"><span class="st-label st-label--quiet">共有の状態を確認しています…</span></span></span>`;
    case "home":
      return `<span class="st st--fresh"><span class="st-main">${seal(sp, 20)}<span class="st-label">メンバー${SPACES[sp].members}人に見えます</span></span></span>`;
    default:
      return "";
  }
}
function toolbar(s) {
  const nav = `
    <div class="nav">
      ${s.rail ? `<span class="nav-lights"></span>` : ""}
      <button class="ibtn" aria-label="戻る"${s.canBack === false ? " disabled" : ""}>${icon("back")}</button>
      <button class="ibtn" aria-label="進む"${s.canFwd ? "" : " disabled"}>${icon("fwd")}</button>
      <button class="ibtn" aria-label="再読み込み"${s.noReload ? " disabled" : ""}>${icon("reload")}</button>
    </div>`;
  const where = s.placeholder
    ? `<span class="url url--placeholder">${s.placeholder}</span>`
    : s.internal
      ? `<span class="url"><span class="url-domain">${s.internal[0]}</span><span class="url-path">${s.internal[1] ? " / " + s.internal[1] : ""}</span></span>`
      : urlText(s.url);
  const capsule = `
    <div class="capsule${s.focus ? " is-focus" : ""}" role="group" aria-label="このページ">
      <button class="where" aria-label="アドレスとコマンド">${s.insecure ? `<span class="url-warn">${icon("warn", 14)}保護されていない通信</span>` : ""}${where}</button>
      ${s.state ? `<span class="capsule-rule"></span>${stateCluster(s)}` : ""}
    </div>`;
  const ask =
    s.ask === false
      ? ""
      : `<button class="btn btn--paper ask${s.panel ? " is-pressed" : ""}" aria-pressed="${s.panel ? "true" : "false"}">${icon("chat")}スペースに聞く</button>`;
  return `<header class="toolbar">${nav}${capsule}<div class="actions">${s.actions || ""}${ask}</div></header>`;
}

/* ── window shell ── */
function windowShell({ space, id = "", cls = "", attrs = "", sidebarHtml, toolbarHtml, stageHtml }) {
  const hue = space === "none" || space === "private" ? "none" : SPACES[space].hue;
  return `<div class="window ${cls}" ${id ? `id="${id}"` : ""} data-space="${hue}" ${space === "private" ? 'data-window="private"' : ""} ${attrs}>
    ${sidebarHtml}${toolbarHtml}<main class="stage">${stageHtml}</main>
  </div>`;
}

/* The page card. ring: "closed" (the Space holds this version), "open" (it holds an older one),
   or none. frame: true while the page is attached to the next question.
   Both lines are drawn by drawEdges() in the gutter, outside the page view. */
function pageCard(inner, { ring = "", frame = false, cls = "" } = {}) {
  return `<section class="card card--page ${cls}" data-ring="${ring}" data-frame="${frame ? "on" : ""}"><div class="view">${inner}</div></section>`;
}

/* ── menus, popovers ── */
function menu(rows, { cls = "", style = "" } = {}) {
  return `<div class="menu ${cls}" role="menu" style="${style}">${rows.join("")}</div>`;
}
function menuItem(ic, label, { keys, sub, cls = "", check = false } = {}) {
  return `<button class="menu-item ${cls}" role="menuitem"><span class="menu-ico">${ic ? icon(ic) : ""}</span><span class="menu-text"><span>${label}</span>${sub ? `<span class="menu-sub">${sub}</span>` : ""}</span>${keys ? kbd(keys) : ""}${check ? icon("check", 14, "menu-check") : ""}</button>`;
}
const menuRule = `<div class="menu-rule" role="separator"></div>`;
