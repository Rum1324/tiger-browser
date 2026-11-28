/* Shared data and chrome parts for the Rooms prototype. Vanilla JS, no build step. */

const PEOPLE = {
  saeki: { name: "佐伯 遥", short: "佐伯", mono: "佐", me: true },
  mori: { name: "森 拓海", short: "森", mono: "森" },
  ono: { name: "小野 美咲", short: "小野", mono: "小" },
  kashiwagi: { name: "柏木 蓮", short: "柏木", mono: "柏" },
};

const ROOMS = {
  fund: { name: "資金調達 2027", seal: "資", members: 4, items: 41 },
  hire: { name: "採用", seal: "採", members: 3, items: 18 },
  product: { name: "プロダクト", seal: "プ", members: 4, items: 27 },
};

const TABS = {
  pitch: { icon: "doc", title: "投資家向けピッチ v3", host: "docs.google.com" },
  slack: { icon: "hash", title: "#fundraising — Slack", host: "kotonoha.slack.com" },
  notion: { icon: "note", title: "資本政策メモ", host: "notion.so" },
  pdf: { icon: "pdf", title: "国内介護ソフト市場規模 2026.pdf", host: "drive.google.com" },
  news: { icon: "news", title: "介護テックのシード調達、3年ぶりに増加", host: "care-keizai.jp" },
  gmail: { icon: "mail", title: "受信トレイ (3) — Gmail", host: "mail.google.com", blocked: true },
  bank: { icon: "bank", title: "つばめ銀行 ビジネスダイレクト", host: "biz.tsubamebank.co.jp", blocked: true },
  cal: { icon: "calendar", title: "カレンダー — 2026年11月", host: "calendar.google.com" },
  welcome: { icon: "note", title: "はじめに", host: "" },
  newtab: { icon: "glasses", title: "新しいタブ", host: "" },
  hireplan: { icon: "note", title: "採用計画 2027", host: "notion.so" },
  jd: { icon: "doc", title: "求人票：バックエンドエンジニア", host: "docs.google.com" },
  hireslack: { icon: "hash", title: "#hiring — Slack", host: "kotonoha.slack.com" },
  memo: { icon: "doc", title: "一次面接メモ（下書き）", host: "docs.google.com" },
  loan: { icon: "search", title: "住宅ローン 借り換え 比較", host: "" },
};

/* ── atoms ── */
function avatar(id, size = 20, extra = "") {
  const p = PEOPLE[id];
  return `<span class="av av--${size}${p.me ? " av--me" : ""} ${extra}" title="${p.name}">${p.mono}</span>`;
}

function seal(room, size = 24, extra = "") {
  if (room === "ai") return `<span class="seal seal--${size} seal--ai ${extra}" title="Tiger">虎</span>`;
  return `<span class="seal seal--${size} ${extra}" data-room="${room}" title="${ROOMS[room].name}">${ROOMS[room].seal}</span>`;
}

function kbd(keys) {
  return `<span class="keys">${keys
    .map((k) => (ICONS[k] ? `<kbd class="key">${icon(k, 12)}</kbd>` : `<kbd class="key">${k}</kbd>`))
    .join("")}</span>`;
}

function lights(inactive = false) {
  return `<div class="lights${inactive ? " is-inactive" : ""}" aria-hidden="true"><i></i><i></i><i></i></div>`;
}

function cite(n) {
  return `<button class="cite" aria-label="出典${n}">${n}</button>`;
}

/* keeps a figure, its citation and the punctuation after it on one line (kinsoku) */
function fig(text, n, tail = "") {
  const chip = n === "添付" ? `<span class="cite cite--attach">添付</span>` : cite(n);
  return `<span class="nb">${text}${chip}${tail}</span>`;
}

function stateChip(state, text) {
  const map = {
    shared: ["people", text || "共有中 · 4人"],
    private: ["person", text || "自分だけ"],
    blocked: ["lock", text || "共有不可"],
    incognito: ["glasses", text || "プライベート"],
  };
  const [ic, label] = map[state];
  return `<span class="state state--${state}">${icon(ic, 14)}${label}</span>`;
}

/* ── sidebar ── */
function tabRow(id, s) {
  const t = TABS[id];
  const active = s.active === id;
  let trail = "";
  if (s.presence && s.presence[id]) {
    trail = `<span class="tab-trail" title="${PEOPLE[s.presence[id]].name} が閲覧中">${avatar(s.presence[id], 18, "av--here")}</span>`;
  } else if (t.blocked) {
    trail = `<span class="tab-trail tab-lock" title="共有できないページ">${icon("lock", 14)}</span>`;
  }
  const cls = active ? "tab is-active" : "tab";
  return `<li><a class="${cls}" href="#" ${active ? 'aria-current="page"' : ""}><span class="tab-ico">${icon(t.icon)}</span><span class="tab-title">${t.title}</span>${trail}</a></li>`;
}

function sidebar(s) {
  const room = ROOMS[s.room];
  const solo = !!s.solo;
  const who = solo
    ? `<span class="zone-note">あなたとAI</span>`
    : s.who
      ? `<span class="zone-who">${s.who.map((id) => avatar(id, 18)).join("")}</span>`
      : `<span class="zone-who" title="森・小野はいまこのスペースにいます">${avatar("mori", 18)}${avatar("ono", 18)}${avatar("kashiwagi", 18, "av--away")}</span>`;
  const sharedRows = s.shared.map((id) => tabRow(id, s)).join("");
  const slot = s.slot ? `<li class="tab-slot" aria-hidden="true"></li>` : "";
  const ghost = s.ghost ? `<li class="tab-ghost" aria-hidden="true"></li>` : "";
  const empty = s.shared.length
    ? ""
    : `<p class="zone-empty">まだ何もありません。共有したページがここに並びます。</p>`;
  const switcher = (s.rooms || ["fund", "hire", "product"])
    .map(
      (r, i) =>
        `<button class="door${r === s.room ? " is-current" : ""}" aria-label="${ROOMS[r].name} に切り替え">${seal(r, 24)}</button>`,
    )
    .join("");
  return `
  <aside class="sidebar">
    <div class="sb-top">${lights(s.inactive)}<button class="ibtn" aria-label="サイドバーを隠す">${icon("sidebar")}</button></div>
    <button class="space-head${s.home ? " is-active" : ""}" aria-label="スペースホームを開く">
      ${seal(s.room, 28)}
      <span class="space-head-text">
        <span class="space-name">${s.roomName || room.name}</span>
        <span class="space-sub">メンバー${s.members || room.members}人 · 共有${s.items ?? room.items}件</span>
      </span>
      ${icon("chevDown", 14, "space-chev")}
    </button>

    <section class="zone${s.thresholdLit ? " is-lit" : ""}" aria-label="${solo ? "スペースに共有" : "チームに共有"}">
      <header class="zone-head">
        <span class="zone-label">${icon("people", 14)}${solo ? "スペースに共有" : "チームに共有"}</span>
        ${who}
      </header>
      <ul class="tabs">${sharedRows}${slot}</ul>
      ${empty}
    </section>

    <section class="pocket${s.thresholdLit ? " is-lit" : ""}" aria-label="自分だけ">
      <header class="zone-head">
        <span class="zone-label">${icon("person", 14)}自分だけ</span>
        <span class="zone-note">どこにも送られません</span>
      </header>
      <ul class="tabs">${ghost}${s.priv.map((id) => tabRow(id, s)).join("")}</ul>
      <button class="tab tab--new"><span class="tab-ico">${icon("plus")}</span><span class="tab-title">新しいタブ</span>${kbd(["kCmd", "T"])}</button>
    </section>

    <footer class="sb-foot">
      <div class="doors">${switcher}<button class="ibtn" aria-label="スペースをつくる">${icon("plus")}</button></div>
      <button class="ibtn" aria-label="設定">${icon("sliders")}</button>
    </footer>
    ${
      s.flying
        ? `<div class="tab is-flying" id="flying"><span class="tab-ico">${icon(TABS[s.flying].icon)}</span><span class="tab-title">${TABS[s.flying].title}</span></div>`
        : ""
    }
  </aside>`;
}

/* ── toolbar ── */
function toolbar(s) {
  const nav = `
    <div class="nav">
      <button class="ibtn" aria-label="戻る"${s.noHistory ? " disabled" : ""}>${icon("back")}</button>
      <button class="ibtn" aria-label="進む" disabled>${icon("fwd")}</button>
      <button class="ibtn" aria-label="再読み込み"${s.noHistory ? " disabled" : ""}>${icon("reload")}</button>
    </div>`;
  const crumb = s.placeholder
    ? `<span class="crumb crumb--placeholder">${s.placeholder}</span>`
    : `<span class="crumb">${s.host ? `<span class="crumb-host">${s.host}</span><span class="crumb-sep">/</span>` : ""}<span class="crumb-leaf">${s.leaf}</span></span>`;
  const address = `
    <button class="address" aria-label="アドレスとコマンド">
      ${stateChip(s.state, s.stateText)}
      ${crumb}
      ${s.prov ? `<span class="prov">${s.prov}</span>` : ""}
    </button>`;
  let share = "";
  if (s.share === "shared")
    share = `<button class="btn btn--frame" aria-label="共有の状態">${icon("cross")}共有中${icon("chevDown", 14)}</button>`;
  if (s.share === "can")
    share = `<button class="btn btn--room${s.sharePressed ? " is-pressed" : ""}">${icon("cross")}スペースに共有</button>`;
  if (s.share === "blocked")
    share = `<button class="btn btn--frame" disabled aria-disabled="true">${icon("lock")}共有できません</button>`;
  const ask =
    s.ask === false
      ? ""
      : `<button class="btn btn--paper${s.panel ? " is-pressed" : ""}" aria-pressed="${s.panel ? "true" : "false"}">${icon("chat")}スペースに聞く</button>`;
  return `<header class="toolbar">${nav}${address}<div class="actions">${s.actions || ""}${share}${ask}</div></header>`;
}

/* ── window shell ── */
function windowShell({ room, id = "", cls = "", style = "", sidebarHtml, toolbarHtml, stageHtml }) {
  return `<div class="window ${cls}" ${id ? `id="${id}"` : ""} data-room="${room}" style="${style}">
    ${sidebarHtml}${toolbarHtml}<main class="stage">${stageHtml}</main>
  </div>`;
}

function pageCard(inner, { shared = false, cls = "", sill = "", ringClip = "" } = {}) {
  return `<section class="card card--page${shared ? " is-shared" : ""}${ringClip ? " is-ringing" : ""} ${cls}" ${ringClip ? `style="--ring-clip:${ringClip}"` : ""}>${sill}<div class="view">${inner}</div></section>`;
}
