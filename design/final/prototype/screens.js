/* Screens. index.html?screen=<id>&theme=light|dark
   Story: 株式会社コトノハ, four founders, Thursday 2026-11-26. 佐伯 遥 is the member at this Mac. */
const SCREENS = {};

/* ───────── states of the sidebar in 資金調達 2027 ───────── */
const PINS = ["gmail", "cal", "slackpin", "notionpin", "codepin", "drive"];
const FUND = {
  space: "fund",
  pins: PINS,
  tabs: ["pitch", "pdf", "notion", "slack", "news", "mizunara", "bank", "hireplan"],
  marks: { pitch: "fresh", pdf: "fresh", notion: "fresh", slack: "stale", hireplan: "else:hire" },
  current: "pitch",
  active: "pitch",
};
const BY_PITCH = ["佐伯 遥", "第2版", "今日 12:14"];
const BAR_FRESH = { space: "fund", url: PAGES.pitch.url, state: "fresh", by: BY_PITCH };
const BAR_STALE = { space: "fund", url: PAGES.pitch.url, state: "stale", v: 2 };
const FUND_STALE = { ...FUND, marks: { ...FUND.marks, pitch: "stale" } };

const MODEL = { label: "Claude Sonnet 5.5", company: "Anthropic" };
/* charCount of the page as it is now (ExtractedPage.charCount) */
const PITCH_CHARS = pitchMarkdown({ edited: true }).join("\n").length;

/* ───────── ask panel parts ───────── */
function personMsg(who, time, text, extra = "") {
  return `<article class="msg msg--person"><header class="msg-head">${avatar(who, 24)}<span class="msg-name">${PEOPLE[who].name}</span><time>${time}</time></header><div class="msg-text">${text}</div>${extra}</article>`;
}
function aiHead(time, model = MODEL.label, asker = "") {
  return `<header class="msg-head">${seal("ai", 24)}<span class="msg-name">Tiger</span><span class="msg-model">${model}${asker ? `<i class="sep">・</i>${asker}の質問` : ""}</span><time>${time}</time></header>`;
}
function sourceRow(n, id, { page = "", gone = "", quote = "" } = {}) {
  const it = ALL_ITEMS.find((x) => x.id === id);
  const by = gone ? byline([gone]) : byline([SOURCE[it.type].label, PEOPLE[it.by].name, `第${it.v}版`, it.at, page]);
  return `<li class="source${gone ? " source--gone" : ""}">${cite(n, { gone: !!gone })}<a class="source-text" href="#"><span class="source-title">${it.title}</span>${by}</a>${quote ? `<p class="source-quote">${quote}</p>` : ""}</li>`;
}
function answerActions() {
  return `<div class="msg-actions">
    <button class="btn btn--sm btn--line">${icon("cross", 14)}スレッドに投稿</button>
    <button class="btn btn--sm btn--line">${icon("exportOut", 14)}Google ドキュメントに書き出す</button>
    <button class="btn btn--sm btn--line btn--icon" aria-label="回答をコピー">${icon("copy", 14)}</button>
  </div>`;
}

/* the ledger: what the AI will read for the next question.
   page = { title, state: "fresh"|"can"|"attached"|"blocked", note } */
function ledger({ open = true, items = 41, space = "fund", page, others = 7 }) {
  const sp = SPACES[space];
  if (!open) {
    const att = page.state === "attached" ? `<span class="ledger-plus">＋</span>${icon("frame", 16)}<b>添付1ページ</b>（この質問だけ）` : "";
    return `<section class="ledger ledger--line" aria-label="この質問でAIが読むもの"><button class="ledger-row">
      <span class="ledger-sum">AIが読むもの${seal(space, 16)}<b>共有${items}件</b>${att}</span>${icon("chevDown", 14)}</button></section>`;
  }
  const pageRow = {
    fresh: `<div class="ledger-row"><span class="ledger-ico">${icon("frame")}</span><span class="ledger-what">このページ</span><span class="ledger-note">共有済みの内容は最新です</span></div>`,
    can: `<div class="ledger-row"><span class="ledger-ico">${icon("frame")}</span><span class="ledger-what">このページ</span><span class="ledger-note">${page.note || "添付していません"}</span><button class="btn btn--sm btn--line">内容を確かめて添付…</button></div>`,
    attached: `<div class="ledger-row ledger-row--attached"><span class="ledger-ico">${icon("frame")}</span><span class="ledger-what"><b>${page.title}を添付</b></span><span class="ledger-note">${page.note}</span><button class="btn btn--sm btn--quiet">はずす</button></div>`,
    blocked: `<div class="ledger-row ledger-row--off"><span class="ledger-ico">${icon("lock")}</span><span class="ledger-what">このページ</span><span class="ledger-note">${page.note}</span></div>`,
  }[page.state];
  return `<section class="ledger" aria-label="この質問でAIが読むもの">
    <header class="ledger-head"><span>この質問でAIが読むもの</span><button class="ibtn ibtn--paper" aria-label="たたむ">${icon("chevDown", 14)}</button></header>
    <button class="ledger-row"><span class="ledger-ico">${seal(space, 20)}</span><span class="ledger-what"><b>スペースの共有 ${items}件</b></span><span class="ledger-note">${sp.members}人が共有したページ</span>${icon("chevRight", 14)}</button>
    ${pageRow}
    <div class="ledger-row ledger-row--off"><span class="ledger-ico">${icon("laptop")}</span><span class="ledger-what">ほかのタブ ${others}件</span><span class="ledger-note">読めません</span></div>
  </section>`;
}
function composer({ text = "", placeholder = "スペースに質問する", model = MODEL, chip = "", streaming = false, modelOpen = false, disabled = false, post = false }) {
  const input = text
    ? `<div class="composer-input">${text}<span class="caret"></span></div>`
    : `<div class="composer-input composer-input--empty">${placeholder}</div>`;
  const send = streaming
    ? `<button class="btn btn--sm btn--line send">${icon("stop", 14)}止める</button>`
    : post
      ? `<button class="btn btn--sm btn--ink send">投稿${kbd(["kReturn"])}</button>`
      : `<button class="btn btn--sm btn--ink send"${disabled ? " disabled" : ""}>${model.company} に送信${disabled ? "" : kbd(["kReturn"])}</button>`;
  return `<div class="composer">${chip}${input}
    <div class="composer-foot">${post ? "" : `<button class="model-btn${modelOpen ? " is-open" : ""}" aria-label="この質問に使うモデル">${model.label}${icon("chevDown", 14)}</button>`}${send}</div>
  </div>`;
}
function askPanel({ space = "fund", body, led, comp, extra = "", end = false }) {
  const sp = SPACES[space];
  return `<aside class="panel" aria-label="スペースに聞く">
    <header class="panel-head"><span class="panel-title">スペースに聞く</span><span class="scope">${seal(space, 20)}${sp.name}</span><span class="grow"></span><button class="btn btn--sm btn--quiet">新しい質問</button><button class="ibtn ibtn--paper" aria-label="パネルを閉じる">${icon("close")}</button></header>
    <div class="panel-note">${icon("person", 14)}このスレッドはあなただけに見えます<button class="link">スペースに共有…</button></div>
    <div class="thread${end ? " thread--end" : ""}">${body}</div>
    ${led}${comp}${extra}
  </aside>`;
}

/* the answer used in 02, 07 and 12 */
function answerCompare() {
  return `<article class="msg msg--ai">${aiHead("14:28")}
    <div class="voice">
      <p>食い違いは2か所あります。</p>
      <table>
        <thead><tr><th>項目</th><th class="num">ピッチ v3</th><th class="num">市場レポート</th></tr></thead>
        <tbody>
          <tr><td>TAM</td><td class="num">4,800億円${cite(1)}</td><td class="num">3,150億円${cite(2)}</td></tr>
          <tr><td>年成長率</td><td class="num">18%${cite(1)}</td><td class="num">12.4%${cite(2)}</td></tr>
        </tbody>
      </table>
      <ul>
        <li>TAMの差は定義の違いです。ピッチは請求代行（BPO）を含み${cite(1)}、レポートは含みません${cite(2)}。</li>
        <li>${fig("SAM 1,400億円", 1, "は、")}レポートの区分と一致しています${cite(2)}。</li>
      </ul>
    </div>
    <ol class="sources" aria-label="出典">${sourceRow(1, "pitch")}${sourceRow(2, "pdf", { page: "p.9" })}</ol>
    ${answerActions()}
  </article>`;
}
const Q_COMPARE = personMsg("saeki", "14:28", "ピッチの市場規模、森さんのレポートと食い違いますか。");

/* ───────── 01 browse: a shared page, up to date ───────── */
SCREENS["01-browse"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar(FUND),
    toolbarHtml: toolbar(BAR_FRESH),
    stageHtml: pageCard(mockDoc(), { ring: "closed" }),
  });

/* ───────── 02 ask panel ───────── */
SCREENS["02-ask-panel"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar(FUND),
    toolbarHtml: toolbar({ ...BAR_FRESH, panel: true }),
    stageHtml:
      pageCard(mockDoc(), { ring: "closed" }) +
      askPanel({
        body: Q_COMPARE + answerCompare(),
        led: ledger({ page: { state: "fresh" } }),
        comp: composer({ text: "TAMを3,150億円に揃えた場合の一文を書いて" }),
      }),
  });

/* ───────── sheets: the one door content leaves through ───────── */
function mdPane(lines, { title, sub, omit, marks = {}, was = {} }) {
  let n = 0;
  const esc = (l) => l.replace(/</g, "&lt;") || "&nbsp;";
  const rows = lines
    .map((l) => {
      n++;
      const m = marks[n] ? ` md-line--${marks[n]}` : "";
      const old = was[n] ? `<div class="md-line md-line--old"><span class="md-no">第2版</span><span class="md-text">${esc(was[n])}</span></div>` : "";
      return `${old}<div class="md-line${m}"><span class="md-no">${n}</span><span class="md-text">${esc(l)}</span></div>`;
    })
    .join("");
  return `<div class="sheet-main">
    <header class="sheet-head"><h2>${title}</h2><p class="sheet-sub">${sub}</p></header>
    <div class="md" role="document" aria-label="送る内容">${rows}</div>
    <p class="omit">${icon("eyeOff", 14)}<span>${omit}</span></p>
  </div>`;
}
function sideList(title, rows) {
  return `<section class="side-sec"><h3 class="field-label">${title}</h3>${rows}</section>`;
}
function who(idOrHtml, name, note) {
  const mark = PEOPLE[idOrHtml] ? avatar(idOrHtml, 20) : idOrHtml;
  return `<li class="who">${mark}<span class="who-name">${name}</span><span class="who-note">${note}</span></li>`;
}
function gridMarkdown() {
  const [head, ...rows] = GRID_ROWS;
  const line = (r) => `| ${r.join(" | ")} |`.replace("|  |", "| |");
  return ["# 希薄化シミュレーション", "", "## 希薄化", "", line(head), "| --- | --- | --- | --- |", ...rows.map(line)];
}
function shareSheet() {
  const md = gridMarkdown();
  const chars = md.join("\n").length;
  const side = `<aside class="sheet-side sheet-side--space">
    ${sideList("共有先", `<button class="picker">${seal("fund", 28)}<span class="picker-text"><span class="picker-name">資金調達 2027</span><span class="byline">共有41件<i class="sep">・</i>メンバー4人</span></span>${icon("chevDown", 14)}</button>`)}
    ${sideList(
      "読める人と送り先",
      `<ul class="whos">
        ${who("saeki", "佐伯 遥", "あなた")}${who("mori", "森 拓海", "メンバー")}${who("ono", "小野 美咲", "メンバー")}${who("kashiwagi", "柏木 蓮", "メンバー")}
        ${who(seal("ai", 20), "Tiger のサーバー", "保存と検索")}
        ${who(`<span class="who-glyph">${icon("exportOut")}</span>`, "Anthropic・OpenAI", "質問されたとき")}
      </ul>
      <p class="side-note">メンバーが質問すると、関係する部分が、その人の選んだモデルの提供元に送られます。</p>`,
    )}
    ${sideList("元のページ", `<p class="side-url">https://docs.google.com/spreadsheets/d/1Zt4wPq0Lm</p>`)}
    ${sideList(
      "共有したあと",
      `<ul class="after"><li>第1版として保存します。</li><li>ページを編集しても、自動では送りません。新しい版も同じ確認をします。</li><li>いつでも解除できます。本文・版・検索用データを消し、台帳の記録だけが残ります。</li></ul>`,
    )}
    <footer class="sheet-foot"><p class="foot-note">14:36に読み取った内容を、そのまま送ります。</p><div class="foot-btns"><button class="btn btn--line">キャンセル</button><button class="btn btn--space">${icon("cross")}スペースに共有${kbd(["kCmd", "kReturn"])}</button></div></footer>
  </aside>`;
  return `<div class="overlay"><div class="scrim"></div><section class="sheet" role="dialog" aria-label="スペースに共有">
    ${mdPane(md, { title: "このMacから送る内容", sub: `Markdown ${md.length}行<i class="sep">・</i>${chars}文字<i class="sep">・</i>google-sheets-export@1 で取得`, omit: "送らないもの：数式（計算結果の値だけを送ります）、ほかのシート2枚、コメント、編集履歴。" })}
    ${side}</section></div>`;
}
const FUND_NAV = {
  ...FUND,
  tabs: ["dilution", "pdf", "notion", "slack", "news", "mizunara", "bank", "hireplan"],
  marks: { pdf: "fresh", notion: "fresh", slack: "stale", hireplan: "else:hire" },
  current: null,
  active: "dilution",
};
SCREENS["03-share-preview"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar(FUND_NAV),
    toolbarHtml: toolbar({ space: "fund", url: PAGES.dilution.url, state: "local" }),
    stageHtml: pageCard(mockGrid()) + shareSheet(),
  });

/* 03b: a new version of a page the Space already holds. Same sheet, the changed lines marked. */
function updateSheet() {
  const md = pitchMarkdown({ edited: true });
  const before = pitchMarkdown();
  const side = `<aside class="sheet-side sheet-side--space">
    ${sideList("共有先", `<div class="picker picker--static">${seal("fund", 28)}<span class="picker-text"><span class="picker-name">資金調達 2027</span><span class="byline">第2版を共有中<i class="sep">・</i>佐伯 遥<i class="sep">・</i>今日 12:14</span></span></div>`)}
    ${sideList(
      "読める人と送り先",
      `<ul class="whos">
        ${who("saeki", "佐伯 遥", "あなた")}${who("mori", "森 拓海", "メンバー")}${who("ono", "小野 美咲", "メンバー")}${who("kashiwagi", "柏木 蓮", "メンバー")}
        ${who(seal("ai", 20), "Tiger のサーバー", "保存と検索")}
        ${who(`<span class="who-glyph">${icon("exportOut")}</span>`, "Anthropic・OpenAI", "質問されたとき")}
      </ul>`,
    )}
    ${sideList("元のページ", `<p class="side-url">https://docs.google.com/document/d/1mKx7RfQe8</p>`)}
    ${sideList(
      "共有したあと",
      `<ul class="after"><li>第3版として保存します。これからの回答は第3版を読みます。</li><li>過去の回答の引用は、読んだ版（第2版）を指したままです。</li><li>解除すると、すべての版が消えます。</li></ul>`,
    )}
    <footer class="sheet-foot"><p class="foot-note">14:36に読み取った内容を、そのまま送ります。</p><div class="foot-btns"><button class="btn btn--line">キャンセル</button><button class="btn btn--space">${icon("cross")}新しい版を共有${kbd(["kCmd", "kReturn"])}</button></div></footer>
  </aside>`;
  return `<div class="overlay"><div class="scrim"></div><section class="sheet" role="dialog" aria-label="新しい版を共有">
    ${mdPane(md, { title: "新しい版としてこのMacから送る内容", sub: `Markdown ${md.length}行<i class="sep">・</i>${PITCH_CHARS}文字<i class="sep">・</i>google-docs-export@1 で取得<i class="sep">・</i>第2版と2行ちがいます`, omit: "送らないもの：画像1点の中身（説明文だけを送ります）、コメント5件、編集履歴。", marks: { 18: "diff", 21: "diff" }, was: { 18: before[17], 21: before[20] } })}
    ${side}</section></div>`;
}
SCREENS["03b-share-update"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar(FUND_STALE),
    toolbarHtml: toolbar(BAR_STALE),
    stageHtml: pageCard(mockDoc({ edited: true }), { ring: "open" }) + updateSheet(),
  });

/* ───────── 04 Space home ───────── */
function bookRow(it) {
  const src = SOURCE[it.type];
  const mine = PEOPLE[it.by].me;
  if (it.gone) {
    return `<tr class="is-gone"><td><div class="book-cell"><span class="book-ico">${icon(src.icon)}</span><div class="book-title"><span>${it.title}</span>${byline([`${it.gone.at} に${PEOPLE[it.gone.by].name}が共有を解除`, `全${it.v}版`])}</div></div></td><td>${PEOPLE[it.by].name}</td><td class="num">${it.at}</td><td>解除済み</td><td class="book-act"><span class="book-gone">本文は削除済み</span></td></tr>`;
  }
  return `<tr${it.hover ? ' class="is-hover"' : ""}><td><div class="book-cell"><span class="book-ico">${icon(src.icon)}</span><div class="book-title"><span>${it.title}</span>${byline([src.label + (it.extra ? ` ${it.extra}` : ""), it.host])}</div></div></td><td>${PEOPLE[it.by].name}</td><td class="num">${it.at}</td><td>第${it.v}版</td><td class="book-act">${
    it.hover && mine ? `<button class="btn btn--sm btn--line">共有を解除…</button>` : `<button class="ibtn ibtn--paper" aria-label="${it.title} の操作">${icon("more")}</button>`
  }</td></tr>`;
}
function spaceHome() {
  const rows = ITEMS.map((it) => bookRow(it.id === "notion" ? { ...it, hover: true } : it)).join("");
  const thread = `
    <div class="day"><span>今日 11月26日（木）</span></div>
    ${personMsg("mori", "10:12", "市場レポートを読み終えました。p.9のTAMの定義が、ピッチと違います。")}
    ${personMsg("ono", "10:20", "ミズナラ・キャピタルの面談は12/3（木）15:00で確定です。")}
    <div class="event">${icon("cross", 14)}<span>佐伯 遥が「投資家向けピッチ v3」の第2版を共有</span><time>12:14</time></div>
    ${personMsg("saeki", "12:16", `<span class="mention">@Tiger</span>ピッチとレポートの食い違いを挙げて。`)}
    <article class="msg msg--ai">${aiHead("12:16", MODEL.label, "佐伯 遥")}
      <div class="voice"><p>食い違いは2か所です。TAMは、ピッチが${fig("4,800億円", 1, "、")}レポートが${fig("3,150億円", 2, "。")}年成長率は、ピッチが${fig("18%", 1, "、")}レポートが${fig("12.4%", 2, "です。")}</p></div>
      <ol class="sources" aria-label="出典">${sourceRow(1, "pitch")}${sourceRow(2, "pdf", { page: "p.9" })}</ol>
    </article>
    ${personMsg("mori", "12:31", "TAMは請求代行を外した3,150億円に揃えましょう。市場規模の節は僕が直します。")}`;
  return `<div class="home">
    <section class="home-main">
      <header class="home-head">
        ${seal("fund", 40)}
        <div class="home-id"><h1>資金調達 2027</h1><p class="home-sub">ここにあるものを読めるのは、佐伯 遥、森 拓海、小野 美咲、柏木 蓮と、AIです。</p></div>
        <button class="btn btn--line">${icon("invite")}招待</button>
      </header>
      <div class="home-bar">
        <h2>台帳</h2>
        <div class="seg" role="tablist"><button class="seg-item is-on" role="tab" aria-selected="true">すべて<span>41</span></button><button class="seg-item" role="tab">自分が共有<span>12</span></button><button class="seg-item" role="tab">解除済み<span>1</span></button></div>
        <div class="search">${icon("search", 14)}<span>題名・人・サイトで絞り込む</span></div>
      </div>
      <table class="book">
        <thead><tr><th>題名と出どころ</th><th>共有した人</th><th>最終共有</th><th>版</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
    <aside class="home-thread" aria-label="スレッド">
      <header class="panel-head"><span class="panel-title">スレッド</span><span class="thread-title">数字合わせ：ピッチと市場レポート</span><span class="grow"></span><button class="ibtn ibtn--paper" aria-label="スレッドの一覧">${icon("thread")}</button></header>
      <div class="thread thread--end">${thread}</div>
      <p class="thread-note">${seal("ai", 16)}<span>@Tiger が読むのは、共有41件とこのスレッドだけです。ページは添付できません。</span></p>
      ${composer({ placeholder: "メッセージを書く。@Tiger でAIに質問", post: true })}
    </aside>
  </div>`;
}
const FUND_HOME = { ...FUND, home: true, active: null, current: null };
SCREENS["04-space-home"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar(FUND_HOME),
    toolbarHtml: toolbar({ space: "fund", internal: ["資金調達 2027", "スペースホーム"], state: "home", ask: false, noReload: true }),
    stageHtml: pageCard(spaceHome(), { ring: "closed", cls: "card--home" }),
  });

/* ───────── 05 cannot share, 05b private window ───────── */
function blockedPopover() {
  return `<div class="overlay overlay--free"><section class="pop pop--state" role="dialog" aria-label="共有できない理由" id="pop-state">
    <h3>金融サービスのページは共有できません。</h3>
    <p>このページの内容は、スペースへの共有にも、質問への添付にも使えません。画面の上だけでなく、Tiger の本体で止めています。</p>
    <dl class="pop-rule"><dt>一致したルール</dt><dd>tsubamebank.co.jp</dd></dl>
    <div class="pop-foot"><button class="link">保護リストを見る</button></div>
  </section></div>`;
}
SCREENS["05-cannot-share"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar({ ...FUND, active: "bank", current: null }),
    toolbarHtml: toolbar({ space: "fund", url: PAGES.bank.url, state: "blocked", reason: "banking", open: true }),
    stageHtml: pageCard(mockBank()) + blockedPopover(),
  });

function privateNtp() {
  return `<div class="ntp">
    <h1>プライベートウインドウ</h1>
    <p class="ntp-lede">このウインドウを閉じると、ここで開いたページの履歴、Cookie、サイトのデータを消します。</p>
    <ul class="ntp-list">
      <li>${icon("lock")}<div><b>共有も添付もできません。</b><p>このウインドウのページは、スペースにもAIにも送れません。Tiger の本体で止めています。</p></div></li>
      <li>${icon("keep")}<div><b>残るもの。</b><p>ダウンロードしたファイルと、追加したブックマークは残ります。</p></div></li>
      <li>${icon("info")}<div><b>見えなくなるわけではありません。</b><p>訪問先のサイト、勤務先や学校のネットワーク、回線の事業者には、アクセスが見えることがあります。</p></div></li>
    </ul>
  </div>`;
}
function privateSidebar() {
  const tabs = [
    ["tab", "新しいタブ", true],
    ["search", "住宅ローン 借り換え 比較 — 検索"],
    ["web", "借り換えシミュレーション｜すまい相談室"],
  ];
  return `
  <aside class="sidebar">
    <div class="sb-top">${lights()}<button class="ibtn" aria-label="サイドバーをたたむ">${icon("sidebar")}</button></div>
    <div class="space-head space-head--private"><span class="seal seal--28 seal--plain">${icon("glasses")}</span>
      <span class="space-head-text"><span class="space-name">プライベート</span><span class="space-sub">スペースの外<i class="sep">・</i>履歴を残しません</span></span></div>
    <section class="pocket pocket--private" aria-label="このウインドウのタブ">
      <header class="zone-head zone-head--pocket"><span class="zone-label">${icon("laptop", 14)}このウインドウのタブ</span><span class="zone-count">3</span></header>
      <ul class="tabs">${tabs.map(([f, t, on]) => `<li><a class="tab${on ? " is-active" : ""}" href="#"><span class="tab-ico">${favicon(f)}</span><span class="tab-title">${t}</span></a></li>`).join("")}</ul>
      <button class="tab tab--new"><span class="tab-ico">${icon("plus")}</span><span class="tab-title">新しいタブ</span>${kbd(["kCmd", "T"])}</button>
    </section>
    <footer class="sb-foot"><span class="private-foot">${icon("glasses", 14)}共有も添付もできないウインドウ</span></footer>
  </aside>`;
}
SCREENS["05b-private-window"] = () =>
  windowShell({
    space: "private",
    sidebarHtml: privateSidebar(),
    toolbarHtml: toolbar({ placeholder: "検索、またはアドレスを入力", state: "private", ask: false, canBack: false, noReload: true }),
    stageHtml: pageCard(privateNtp(), { cls: "card--ntp" }),
  });

/* ───────── 06 first run ───────── */
function miniEdge(kind) {
  return `<span class="mini" data-kind="${kind}"><span class="mini-card"></span></span>`;
}
function firstRun() {
  const hues = [
    ["amber", "琥珀"], ["coral", "柿"], ["rose", "紅梅"], ["violet", "藤"], ["indigo", "藍"], ["sky", "空"], ["teal", "浅葱"], ["green", "若竹"], ["graphite", "墨"],
  ];
  return `<div class="setup">
    <section class="setup-form">
      <p class="setup-step"><span>Google でサインイン 済み</span><i class="sep">・</i><b>スペースをつくる</b><i class="sep">・</i><span>メンバーを招待</span></p>
      <h1>最初のスペースをつくる</h1>
      <p class="setup-lede">スペースは、プロジェクトごとの共有の場です。ここに入るのは、あなたやメンバーが共有したページだけです。</p>
      <label class="field"><span class="field-label">名前</span><span class="input is-focus">資金調達 2027<span class="caret"></span></span></label>
      <div class="field field--row">
        <label><span class="field-label">印</span><span class="input input--seal">資</span></label>
        <p class="field-help">スペースを一文字で表します。タブ、引用、共有の記録につきます。</p>
      </div>
      <div class="field"><span class="field-label">色</span>
        <ul class="swatches" role="radiogroup" aria-label="スペースの色">${hues
          .map(([k, n], i) => `<li><button class="swatch${i === 0 ? " is-on" : ""}" role="radio" aria-checked="${i === 0}" data-space="${k}"><span class="swatch-chip">${i === 0 ? icon("check", 14) : ""}</span><span class="swatch-name">${n}</span></button></li>`)
          .join("")}</ul>
        <p class="field-help">色はスペースだけを表します。ウインドウのふちがこの色になります。</p>
      </div>
      <div class="setup-go"><button class="btn btn--space">スペースをつくる${kbd(["kReturn"])}</button><span class="field-help">メンバーはあとで招待できます。</span></div>
    </section>
    <section class="setup-legend" aria-label="ページのふちの読みかた">
      <h2>ページのふちが、読める人を表します</h2>
      <ul class="legend">
        <li>${miniEdge("none")}<div><b>ふちなし<i class="sep">・</i>このMacのみ</b><p>共有するまで、ページの内容はこのMacから出ません。開いているタブは、誰にも伝わりません。</p></div></li>
        <li>${miniEdge("closed")}<div><b>スペースの色の実線<i class="sep">・</i>スペースが読める</b><p>メンバーとAIが、共有した版を読めます。送る前に、送る文章をそのまま確かめます。</p></div></li>
        <li>${miniEdge("open")}<div><b>上が開いた実線<i class="sep">・</i>ページが共有後に更新されています</b><p>スペースにあるのは前の版です。新しい版は、もう一度確かめてから共有します。</p></div></li>
        <li>${miniEdge("frame")}<div><b>破線<i class="sep">・</i>次の質問にだけ添付</b><p>質問ひとつにだけ付けて、選んだモデルの提供元に送ります。スペースには入りません。</p></div></li>
      </ul>
      <p class="legend-foot">${icon("lock", 14)}<span>銀行、メール、パスワード管理、ログインのページと、プライベートウインドウは、共有も添付もできません。</span></p>
    </section>
  </div>`;
}
SCREENS["06-first-run"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar({ space: "fund", items: [], itemCount: 0, members: 1, tabs: ["welcome"], active: "welcome", doors: ["fund"], pocketNote: "タブはここに並びます。開いていることは、誰にも伝わりません。" }),
    toolbarHtml: toolbar({ space: "fund", internal: ["Tiger", "はじめに"], state: "", ask: false, canBack: false, noReload: true }),
    stageHtml: pageCard(firstRun(), { cls: "card--setup" }),
  });

/* ───────── 08 command palette ───────── */
function palRow({ ic, title, sub = "", trail = "", on = false, by = "" }) {
  return `<li><a class="pal-row${on ? " is-on" : ""}" href="#"><span class="pal-ico">${ic}</span><span class="pal-title">${title}</span>${by}${sub ? `<span class="pal-sub">${sub}</span>` : ""}<span class="pal-trail">${trail}</span></a></li>`;
}
function palette() {
  const hit = (s) => s.replace("市場", "<mark>市場</mark>");
  return `<div class="overlay"><div class="scrim"></div><section class="palette" role="dialog" aria-label="コマンド">
    <div class="pal-field">${icon("search")}<span class="pal-input">市場<span class="caret"></span></span>${kbd(["esc"])}</div>
    <div class="pal-body">
      <h3 class="pal-sec">開いているタブ</h3>
      <ul>${palRow({ ic: favicon("pdf"), title: hit("国内介護ソフト市場規模 2026.pdf"), sub: "drive.google.com", trail: `${seal("fund", 16)}<span class="pal-hint">タブに切り替え</span>${kbd(["kReturn"])}`, on: true })}</ul>
      <h3 class="pal-sec">スペースの共有</h3>
      <ul>${palRow({ ic: icon("pdf"), title: hit("国内介護ソフト市場規模 2026.pdf"), by: byline(["森", "第1版", "11/23 09:02"]) })}${palRow({ ic: icon("note"), title: hit("介護ソフト市場の区分メモ"), by: byline(["柏木", "第2版", "11/14 10:08"]) })}</ul>
      <h3 class="pal-sec">履歴</h3>
      <ul>${palRow({ ic: favicon("search"), title: hit("介護ソフト 市場規模 2026 — 検索"), sub: "google.com", trail: `<span class="pal-hint">昨日</span>` })}${palRow({ ic: favicon("news"), title: hit("訪問介護の市場、事業所数は3年連続で減少"), sub: "care-keizai.jp", trail: `<span class="pal-hint">11/22</span>` })}</ul>
      <h3 class="pal-sec">検索と質問</h3>
      <ul>${palRow({ ic: icon("search"), title: `「市場」を Google で検索`, trail: "" })}${palRow({ ic: icon("chat"), title: `「市場」をスペースに聞く`, sub: "共有41件から答えます", trail: kbd(["kCmd", "kReturn"]) })}</ul>
    </div>
    <footer class="pal-foot"><span>${kbd(["kUp", "kDown"])}選ぶ</span><span>${kbd(["kReturn"])}開く</span><span>${kbd(["kCmd", "kReturn"])}スペースに聞く</span><span class="grow"></span><span>探すのは題名とアドレスです</span></footer>
  </section></div>`;
}
SCREENS["08-command"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar({ ...FUND, active: "news", current: null }),
    toolbarHtml: toolbar({ space: "fund", url: PAGES.news.url, state: "local" }),
    stageHtml: pageCard(mockNews()) + palette(),
  });

/* ───────── 09 attach: preview, then the dashed frame ───────── */
const Q_ATTACH_TEXT = "編集中の数字で、森さんのレポートと食い違うところはありますか。";
function attachSheet() {
  const md = pitchMarkdown({ edited: true });
  const chars = md.join("\n").length;
  const side = `<aside class="sheet-side sheet-side--once">
    ${sideList("送り先", `<div class="picker picker--static"><span class="who-glyph who-glyph--28">${icon("exportOut")}</span><span class="picker-text"><span class="picker-name">Anthropic</span><span class="byline">Claude Sonnet 5.5 を選択中</span></span></div><p class="side-note">内容は Anthropic に送られます。モデルを変えると、送り先も変わります。</p>`)}
    ${sideList("読める人", `<ul class="whos">${who("saeki", "佐伯 遥", "あなただけ")}</ul><p class="side-note">スペースには入りません。メンバーには見えません。</p>`)}
    ${sideList("元のページ", `<p class="side-url">https://docs.google.com/document/d/1mKx7RfQe8</p>`)}
    ${sideList(
      "添付したあと",
      `<ul class="after"><li>次の質問ひとつにだけ付けます。送ると添付は外れます。</li><li>あなたのスレッドに残ります。スペースの共有や台帳には入りません。</li><li>スペースにあるのは第2版のままです。</li></ul>`,
    )}
    <footer class="sheet-foot"><p class="foot-note">14:31に読み取った内容を、そのまま送ります。</p><div class="foot-btns"><button class="btn btn--line">キャンセル</button><button class="btn btn--ink">${icon("frame")}この質問に添付${kbd(["kReturn"])}</button></div></footer>
  </aside>`;
  return `<div class="overlay"><div class="scrim"></div><section class="sheet" role="dialog" aria-label="この質問に添付">
    ${mdPane(md, { title: "この質問にだけ添付する内容", sub: `Markdown ${md.length}行<i class="sep">・</i>${chars}文字<i class="sep">・</i>google-docs-export@1 で取得<i class="sep">・</i>共有中の第2版と2行ちがいます`, omit: "送らないもの：画像1点の中身（説明文だけを送ります）、コメント5件、編集履歴。", marks: { 18: "diff", 21: "diff" } })}
    ${side}</section></div>`;
}
SCREENS["09-attach-preview"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar(FUND_STALE),
    toolbarHtml: toolbar({ ...BAR_STALE, panel: true }),
    stageHtml:
      pageCard(mockDoc({ edited: true }), { ring: "open" }) +
      askPanel({
        body: Q_COMPARE + answerCompare(),
        led: ledger({ page: { state: "can", note: "ページが共有後に更新されています" } }),
        comp: composer({ text: Q_ATTACH_TEXT }),
      }) +
      attachSheet(),
  });
const ATTACH_CHIP = `<span class="attach-chip">${icon("frame")}<b>投資家向けピッチ v3</b>${byline([`${PITCH_CHARS}文字`, "14:31の内容"])}<button class="st-x" aria-label="添付をはずす">${icon("close", 12, "", 1.25)}</button></span>`;
SCREENS["09b-attached"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar({ ...FUND_STALE, marks: { ...FUND_STALE.marks, pitch: "stale attached" } }),
    toolbarHtml: toolbar({ ...BAR_STALE, panel: true, attached: true }),
    stageHtml:
      pageCard(mockDoc({ edited: true }), { ring: "open", frame: true }) +
      askPanel({
        body: Q_COMPARE + answerCompare(),
        led: ledger({ page: { state: "attached", title: "このページ", note: "14:31の内容・この質問だけ" } }),
        comp: composer({ text: Q_ATTACH_TEXT, chip: ATTACH_CHIP }),
      }),
  });

/* ───────── 10 states of a page ───────── */
SCREENS["10a-stale"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar(FUND_STALE),
    toolbarHtml: toolbar(BAR_STALE),
    stageHtml: pageCard(mockDoc({ edited: true }), { ring: "open" }),
  });
SCREENS["10b-shared-elsewhere"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar({ ...FUND, active: "hireplan", current: null }),
    toolbarHtml: toolbar({ space: "fund", url: PAGES.hireplan.url, state: "elsewhere", other: "hire", by: ["森 拓海", "第4版", "昨日 16:05"] }),
    stageHtml: pageCard(mockNote()),
  });
SCREENS["10c-after-navigation"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar(FUND_NAV),
    toolbarHtml: toolbar({ space: "fund", url: PAGES.dilution.url, state: "local" }),
    stageHtml: pageCard(mockGrid()),
  });

/* ───────── 11 unshare, 11b a citation whose item is gone ───────── */
function unshareDialog() {
  return `<div class="overlay"><div class="scrim"></div><section class="dialog" role="alertdialog" aria-label="共有を解除">
    <h2>「投資家向けピッチ v3」の共有を解除しますか</h2>
    <p class="dialog-by">${seal("fund", 16)}${byline(["資金調達 2027", "佐伯 遥", "第2版", "今日 12:14"])}</p>
    <div class="dialog-cols">
      <section><h3 class="field-label">${icon("trash", 14)}消えるもの</h3><ul class="after"><li>スペースに保存した本文（第1版と第2版）</li><li>検索用のデータ</li><li>過去の回答3件が引用した文</li></ul></section>
      <section><h3 class="field-label">${icon("keep", 14)}残るもの</h3><ul class="after"><li>台帳の記録：題名、URL、共有した人、解除した人と日時</li><li>過去の回答の引用番号。「解除済み」と表示します</li><li>元の Google ドキュメント。何も変わりません</li></ul></section>
    </div>
    <p class="dialog-note">メンバーがすでに読んだ内容や、書き出したドキュメントからは消せません。</p>
    <footer class="foot-btns"><button class="btn btn--line">キャンセル</button><button class="btn btn--ink">${icon("uncross")}共有を解除</button></footer>
  </section></div>`;
}
SCREENS["11-unshare-confirm"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar(FUND),
    toolbarHtml: toolbar(BAR_FRESH),
    stageHtml: pageCard(mockDoc(), { ring: "closed" }) + unshareDialog(),
  });
SCREENS["11b-citation-unavailable"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar({ ...FUND, items: ["pitch", "slack", "mizunara", "notion"], itemCount: 40, tabs: FUND.tabs.filter((t) => t !== "pdf"), marks: { ...FUND.marks, pdf: undefined } }),
    toolbarHtml: toolbar({ ...BAR_FRESH, panel: true }),
    stageHtml:
      pageCard(mockDoc(), { ring: "closed" }) +
      askPanel({
        body:
          Q_COMPARE +
          `<article class="msg msg--ai">${aiHead("14:28")}
          <div class="voice">
            <p>食い違いは2か所あります。</p>
            <p>TAMは、ピッチが${fig("4,800億円", 1, "、")}レポートが${fig("3,150億円", 2, "です。", { gone: true })}年成長率は、ピッチが${fig("18%", 1, "、")}レポートが${fig("12.4%", 2, "です。", { gone: true })}</p>
            <p>${fig("SAM 1,400億円", 1, "は、")}レポートの区分と一致しています${cite(2, { gone: true })}。</p>
          </div>
          <ol class="sources" aria-label="出典">${sourceRow(1, "pitch", { quote: "TAM｜国内の介護事業所向け業務ソフト｜4,800億円" })}${sourceRow(2, "pdf", { gone: "今日 15:02 に森 拓海が共有を解除<i class=\"sep\">・</i>引用した文は残っていません" })}</ol>
          <p class="answer-note">${icon("info", 14)}<span>出典2は解除されました。この回答の2に基づく部分は、もう確かめられません。</span></p>
        </article>`,
        led: ledger({ open: false, items: 40, page: { state: "fresh" } }),
        comp: composer({}),
      }),
  });

/* ───────── 12 model menu ───────── */
function modelMenu() {
  const row = (label, tier, { on = false, def = false, off = false } = {}) =>
    `<button class="model-row${on ? " is-on" : ""}" role="menuitemradio" aria-checked="${on}"${off ? " disabled" : ""}><span class="model-check">${on ? icon("check", 14) : ""}</span><span class="model-name">${label}</span>${def ? `<span class="model-def">既定</span>` : ""}<span class="model-tier">${tier}</span></button>`;
  const head = (co, note, off = false) => `<header class="model-head${off ? " is-off" : ""}"><b>${co}</b><span>${note}</span></header>`;
  return `<div class="overlay overlay--free"><section class="menu menu--models" role="menu" aria-label="この質問に使うモデル" id="model-menu">
    ${head("Anthropic", "内容は Anthropic に送られます。")}
    ${row("Claude Fable 5.2", "最高性能")}${row("Claude Opus 5.5", "最高性能")}${row("Claude Sonnet 5.5", "バランス", { on: true, def: true })}${row("Claude Haiku 5.5", "高速")}
    ${head("OpenAI", "内容は OpenAI に送られます。")}
    ${row("GPT-6.2 Astra", "最高性能")}${row("GPT-6.2 Sol", "バランス")}${row("GPT-6 Luna", "高速")}
    ${head("Google", "このサーバーにキーがなく、使えません。", true)}
    ${row("Gemini 4 Carbon", "最高性能", { off: true })}${row("Gemini 4 Hydrogen", "高速", { off: true })}
    <footer class="model-foot"><span>選んだモデルは、次の質問にだけ使います。</span><button class="link">既定を変える…</button></footer>
  </section></div>`;
}
SCREENS["12-model-menu"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar(FUND),
    toolbarHtml: toolbar({ ...BAR_FRESH, panel: true }),
    stageHtml:
      pageCard(mockDoc(), { ring: "closed" }) +
      askPanel({
        body: Q_COMPARE + answerCompare(),
        led: ledger({ open: false, page: { state: "fresh" } }),
        comp: composer({ text: "TAMを3,150億円に揃えた場合の一文を書いて", modelOpen: true }),
      }) +
      modelMenu(),
  });

/* ───────── 13 an answer in progress, failed, stopped ───────── */
const Q_ATTACHED = personMsg(
  "saeki",
  "14:32",
  Q_ATTACH_TEXT,
  `<p class="msg-attach">${icon("frame")}<span><b>投資家向けピッチ v3</b> を添付<i class="sep">・</i>${PITCH_CHARS}文字<i class="sep">・</i>Anthropic に送信</span></p>`,
);
SCREENS["13a-streaming-with-stop"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar(FUND_STALE),
    toolbarHtml: toolbar({ ...BAR_STALE, panel: true }),
    stageHtml:
      pageCard(mockDoc({ edited: true }), { ring: "open" }) +
      askPanel({
        body:
          Q_ATTACHED +
          `<article class="msg msg--ai">${aiHead("14:32")}
          <ul class="steps" aria-label="進みぐあい"><li>${icon("check", 14)}共有41件から3件を選びました</li><li>${icon("check", 14)}添付の1ページを読みました</li><li class="is-now"><i></i>回答を書いています</li></ul>
          <div class="voice"><p>編集中の版では、食い違いが1か所ふえます。</p><p>${fig("SAM 1,150億円", "添付", "は、")}レポートの区分にある${fig("1,400億円", 2, "と")}合いません。職員50人未満の<span class="caret"></span></p></div>
        </article>`,
        led: ledger({ open: false, page: { state: "can" } }),
        comp: composer({ placeholder: "回答を書いています。止めると、ここまでの文章は残ります。", streaming: true }),
      }),
  });
SCREENS["13c-answer-stopped"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar(FUND_STALE),
    toolbarHtml: toolbar({ ...BAR_STALE, panel: true }),
    stageHtml:
      pageCard(mockDoc({ edited: true }), { ring: "open" }) +
      askPanel({
        body:
          Q_ATTACHED +
          `<article class="msg msg--ai">${aiHead("14:32")}
          <div class="voice"><p>編集中の版では、食い違いが1か所ふえます。</p><p>${fig("SAM 1,150億円", "添付", "は、")}レポートの区分にある${fig("1,400億円", 2, "と")}合いません。職員50人未満の事業所だけを数えると</p></div>
          <div class="halt"><div class="halt-head">${icon("stop")}ここで止めました</div><p>回答を中止しました。続きが必要な場合はもう一度質問してください。</p>
            <div class="halt-actions"><button class="btn btn--sm btn--line">${icon("retry", 14)}もう一度質問</button></div></div>
          <ol class="sources" aria-label="出典">${sourceRow(2, "pdf", { page: "p.9" })}</ol>
        </article>`,
        led: ledger({ open: false, page: { state: "can" } }),
        comp: composer({}),
      }),
  });

const PRODUCT = {
  space: "product",
  items: ["p-spec", "p-slack", "p-eval", "p-req"],
  pins: PINS,
  tabs: ["spec", "pr", "local", "demo", "design"],
  marks: { spec: "fresh" },
  current: "p-spec",
  active: "spec",
};
SCREENS["13b-answer-failed"] = () =>
  windowShell({
    space: "product",
    sidebarHtml: sidebar(PRODUCT),
    toolbarHtml: toolbar({ space: "product", url: PAGES.spec.url, state: "fresh", by: ["森 拓海", "第4版", "今日 11:02"], panel: true }),
    stageHtml:
      pageCard(mockSpec(), { ring: "closed" }) +
      askPanel({
        space: "product",
        body:
          personMsg("saeki", "14:40", "請求ソフト連携の再試行は、何回まで、どの間隔で行う仕様ですか。") +
          `<article class="msg msg--ai">${aiHead("14:40")}
          <div class="halt"><div class="halt-head">${icon("warn")}回答できませんでした</div>
            <p>このスペースは今月の AI 利用上限に達しました。上限の変更はオーナーに依頼してください。</p>
            <div class="halt-meter" role="img" aria-label="今月の利用 100%"><i style="width:100%"></i></div>
            <div class="halt-row"><span>11月の利用</span><span>2,000,000 / 2,000,000 トークン</span></div>
            <div class="halt-row"><span>オーナー</span><span>森 拓海</span></div>
            <div class="halt-actions"><button class="btn btn--sm btn--line">${icon("copy", 14)}質問をコピー</button></div></div>
          <p class="answer-note">${icon("info", 14)}<span>この質問は、どのモデルの提供元にも送られていません。</span></p>
        </article>`,
        led: ledger({ open: false, items: 27, space: "product", page: { state: "fresh" } }),
        comp: composer({ disabled: true, placeholder: "今月の上限に達しているため、質問できません" }),
        end: false,
      }),
  });

/* ───────── 14 many tabs, 14b collapsed sidebar ───────── */
const MANY = {
  ...FUND,
  tabs: [
    "pitch", "pdf", "notion", "dilution", "slack", "mizunara", "news", "jkiss", "gmail", "bank", "kpi", "compete", "mhlwpdf", "hireplan",
    "investors", "plan", "schedule", "mhlw", "search1", "demo", "termsheet", "glogin", "pwm", "local", "pr", "spec", "faq", "interviews",
    "etax", "capnote", "search2", "cal12", "invoice", "design",
  ],
  marks: {
    pitch: "fresh", pdf: "fresh", notion: "fresh", slack: "stale", kpi: "fresh", compete: "fresh", hireplan: "else:hire", investors: "fresh",
    plan: "stale", schedule: "fresh", spec: "else:product", faq: "fresh", interviews: "fresh", capnote: "fresh", mhlwpdf: "fresh",
  },
};
const BAR_SLACK = { space: "fund", url: PAGES.slack.url, state: "stale", v: 5 };
SCREENS["14-many-tabs"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar({ ...MANY, active: "slack", current: "slack", hover: "compete", scrolled: true, scrollTop: 99, scrollbar: [78, 132] }),
    toolbarHtml: toolbar(BAR_SLACK),
    stageHtml: pageCard(mockChat(), { ring: "open" }),
  });
SCREENS["14b-sidebar-collapsed"] = () =>
  windowShell({
    space: "fund",
    cls: "is-rail",
    sidebarHtml: rail({ ...MANY, active: "slack", railMax: 17 }),
    toolbarHtml: toolbar({ ...BAR_SLACK, rail: true, panel: true }),
    stageHtml:
      pageCard(mockChat(), { ring: "open" }) +
      askPanel({
        body: Q_COMPARE + answerCompare(),
        led: ledger({ page: { state: "can", note: "ページが共有後に更新されています" }, others: 39 }),
        comp: composer({}),
      }),
  });

/* ───────── 07 dark ───────── */
SCREENS["07-dark-01-browse"] = SCREENS["01-browse"];
SCREENS["07-dark-02-ask-panel"] = SCREENS["02-ask-panel"];
SCREENS["07-dark-04-space-home"] = SCREENS["04-space-home"];
SCREENS["07-dark-05b-private-window"] = SCREENS["05b-private-window"];

/* ───────── the two lines around a page card ─────────
   Ring (inner lane, 3 px, Space colour): closed = the Space holds this version; open = it holds an
   older one (the top edge is missing between two stubs). Frame (outer lane, 2 px, ink, dashed):
   the page is attached to the next question. Both are chrome pixels in the gutter. */
function drawEdges(root = document) {
  root.querySelectorAll(".card--page, .mini-card").forEach((card) => {
    const mini = card.classList.contains("mini-card");
    const ring = mini ? { closed: "closed", open: "open" }[card.parentElement.dataset.kind] || "" : card.dataset.ring;
    const frame = mini ? card.parentElement.dataset.kind === "frame" : card.dataset.frame === "on";
    if (!ring && !frame) return;
    const cs = getComputedStyle(card);
    const px = (name) => parseFloat(cs.getPropertyValue(name));
    const R = mini ? 4 : px("--r-card");
    const RW = mini ? 2 : px("--ring");
    const GAP = px("--ring-gap");
    const FW = mini ? 1.5 : px("--frame");
    const LID = mini ? 5 : px("--ring-lid");
    const P = 7;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    let out = "";
    if (ring) {
      const o = RW / 2;
      const x0 = P - o, y0 = P - o, x1 = P + w + o, y1 = P + h + o, r = R + o;
      if (ring === "closed") out += `<rect class="edge-ring" x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="${r}" style="stroke-width:${RW}"/>`;
      else
        out += `<path class="edge-ring" style="stroke-width:${RW}" d="M${x0 + r + LID} ${y0}H${x0 + r}A${r} ${r} 0 0 0 ${x0} ${y0 + r}V${y1 - r}A${r} ${r} 0 0 0 ${x0 + r} ${y1}H${x1 - r}A${r} ${r} 0 0 0 ${x1} ${y1 - r}V${y0 + r}A${r} ${r} 0 0 0 ${x1 - r} ${y0}H${x1 - r - LID}"/>`;
    }
    if (frame) {
      const d = (mini ? (ring ? RW + GAP : 0) : RW + GAP) + FW / 2;
      const fw = w + 2 * d, fh = h + 2 * d, r = R + d;
      const per = 2 * (fw + fh) - 8 * r + 2 * Math.PI * r;
      const dash = px("--frame-dash") * (mini ? 0.5 : 1);
      const n = Math.round(per / (dash + px("--frame-space") * (mini ? 0.5 : 1)));
      const space = per / n - dash;
      out += `<rect class="edge-frame" x="${P - d}" y="${P - d}" width="${fw}" height="${fh}" rx="${r}" style="stroke-width:${FW}" stroke-dasharray="${dash} ${space}"/>`;
    }
    card.insertAdjacentHTML("beforeend", `<svg class="edge" width="${w + 2 * P}" height="${h + 2 * P}" viewBox="0 0 ${w + 2 * P} ${h + 2 * P}" aria-hidden="true">${out}</svg>`);
  });
}

/* anchors a free overlay (popover, menu) to its trigger */
function place() {
  const at = (el, trigger, { above = false, alignRight = false } = {}) => {
    if (!el || !trigger) return;
    const t = trigger.getBoundingClientRect();
    const s = el.parentElement.getBoundingClientRect();
    if (above) el.style.bottom = `${Math.round(s.bottom - t.top + 6)}px`;
    else el.style.top = `${Math.round(t.bottom - s.top + 6)}px`;
    if (alignRight) el.style.right = `${Math.round(s.right - t.right)}px`;
    else el.style.left = `${Math.round(t.left - s.left)}px`;
  };
  at(document.getElementById("pop-state"), document.querySelector(".st-main.is-open"), { alignRight: true });
  at(document.getElementById("model-menu"), document.querySelector(".model-btn.is-open"), { above: true });
}

(function boot() {
  const q = new URLSearchParams(location.search);
  const id = q.get("screen");
  const root = document.getElementById("root");
  const theme = q.get("theme") || (id && id.startsWith("07-dark") ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  if (!id || !SCREENS[id]) {
    root.innerHTML = `<nav class="index"><h1>Tiger</h1><ul>${Object.keys(SCREENS)
      .map((k) => `<li><a href="?screen=${k}">${k}</a></li>`)
      .join("")}</ul></nav>`;
    return;
  }
  /* &hue=<SpaceHue> previews 資金調達 2027 in any of the nine hues */
  if (q.get("hue")) SPACES.fund.hue = q.get("hue");
  document.title = `Tiger — ${id}`;
  root.innerHTML = SCREENS[id]();
  const sc = document.querySelector(".pocket-scroll[data-scroll]");
  if (sc) sc.scrollTop = Number(sc.dataset.scroll);
  document.fonts.ready.then(() => {
    drawEdges();
    place();
    document.documentElement.dataset.ready = "1";
  });
})();
