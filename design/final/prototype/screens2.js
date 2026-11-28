/* Screens, part 2: every remaining state. Same story, same day (Thursday 2026-11-26), same member
   (佐伯 遥). Uses the parts of parts.js and the panel, sheet and dialog builders of screens.js.
   New components are specified in DESIGN.md sections 10 to 12 and drawn on the component sheet. */

const EMAIL = {
  saeki: "saeki@kotonoha.example",
  mori: "mori@kotonoha.example",
  ono: "ono@kotonoha.example",
  kashiwagi: "kashiwagi@kotonoha.example",
};

/* ───────── controls added in part 2 ───────── */
/* checkbox: a 16 px box and its label in one 28 px target */
function check(label, { on = false, cls = "" } = {}) {
  return `<button class="check${on ? " is-on" : ""} ${cls}" role="checkbox" aria-checked="${on}"><span class="check-box">${on ? icon("check", 12, "", 1.75) : ""}</span><span>${label}</span></button>`;
}
/* choice: the segmented control inside a 1 px box. on = key of the chosen item, or null when the
   member has not chosen yet (a required choice has no default). */
function choice(items, on, { label = "", cls = "" } = {}) {
  return `<div class="seg seg--box ${cls}" role="radiogroup" aria-label="${label}">${items
    .map(([k, t]) => `<button class="seg-item${k === on ? " is-on" : ""}" role="radio" aria-checked="${k === on}">${k === on ? icon("check", 12, "", 1.75) : ""}${t}</button>`)
    .join("")}</div>`;
}
/* notice: the one transient message. Chrome pixels above the sidebar footer; never over the page.
   One line of 600, an optional second line (a file name, a remedy), at most one action. */
function notice(text, { detail = "", action = "", ic = "check" } = {}) {
  return `<div class="notice" role="status">${icon(ic, 14)}<span class="notice-text"><b>${text}</b>${detail ? `<span class="notice-detail">${detail}</span>` : ""}</span>${action ? `<button class="notice-act">${action}</button>` : ""}<button class="st-x notice-x" aria-label="閉じる">${icon("close", 12, "", 1.25)}</button></div>`;
}

/* ───────── 15a a site asks for the microphone ───────── */
function mockMeet() {
  return `
  <div class="m-meet">
    <header class="m-meet-bar"><span class="m-meet-brand">${favicon("video", 20)}ミーティング</span><span class="m-meet-user">${EMAIL.saeki}</span></header>
    <div class="m-meet-body">
      <div class="m-meet-stage">
        <span class="m-meet-av">佐</span>
        <p>マイクとカメラはオフです</p>
        <div class="m-meet-ctl"><i>${icon("mic")}</i><i>${icon("camera")}</i></div>
      </div>
      <div class="m-meet-side">
        <h1>接続テスト：ミズナラ・キャピタル面談</h1>
        <p>本番は12月3日（木）15:00〜16:00</p>
        <p class="m-meet-quiet">ほかの参加者はまだいません</p>
        <span class="m-meet-join">今すぐ参加</span>
        <span class="m-meet-alt">画面を共有して参加</span>
      </div>
    </div>
  </div>`;
}
function permPopover() {
  return `<div class="overlay overlay--free"><section class="pop pop--perm" role="dialog" aria-label="サイトからの許可の求め" data-anchor=".where" data-side="below" data-align="left">
    <header class="pop-id"><span class="who-glyph who-glyph--28">${icon("mic")}</span><h3><b class="pop-origin">meet.google.com</b><span>マイクの使用を求めています</span></h3></header>
    <p>許可すると、このサイトがマイクの音声を受け取ります。Tiger とスペースには送られません。</p>
    <dl class="pop-rule"><dt>求めているサイト</dt><dd>https://meet.google.com</dd></dl>
    <div class="pop-foot pop-foot--split">${check("次回からも同じにする")}<div class="foot-btns"><button class="btn btn--sm btn--line">許可しない</button><button class="btn btn--sm btn--ink">許可</button></div></div>
  </section></div>`;
}
const FUND_MEET = {
  ...FUND,
  tabs: ["pitch", "pdf", "notion", "slack", "meet", "mizunara", "bank", "hireplan"],
  marks: { ...FUND.marks, meet: "asks:mic" },
  current: null,
  active: "meet",
};
SCREENS["15a-permission-prompt"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar(FUND_MEET),
    toolbarHtml: toolbar({ space: "fund", url: PAGES.meet.url, state: "local", whereOpen: true, lead: `<span class="url-perm" title="マイクの使用を求めています">${icon("mic", 14)}<i></i></span>` }),
    stageHtml: pageCard(mockMeet()) + permPopover(),
  });

/* ───────── 15b downloads ───────── */
function dlButton({ open = false, progress = null } = {}) {
  return `<button class="ibtn dl-btn${open ? " is-open" : ""}" aria-label="ダウンロード${progress !== null ? `：${Math.round(progress * 100)}%` : ""}" aria-expanded="${open}">${icon("download")}${progress !== null ? `<span class="dl-meter"><i style="width:${progress * 100}%"></i></span>` : ""}</button>`;
}
/* Download.state: progressing | paused | completed | cancelled | interrupted */
function dlRow({ ic, name, meta, state = "completed", progress = null, hover = false }) {
  const off = state === "cancelled" || state === "interrupted";
  const acts =
    state === "progressing" || state === "paused"
      ? `<button class="ibtn ibtn--paper" aria-label="${name} のダウンロードをキャンセル">${icon("close")}</button>`
      : state === "completed"
        ? `<button class="ibtn ibtn--paper" aria-label="${name} をフォルダに表示">${icon("folder")}</button>`
        : "";
  return `<li class="dl${off ? " is-off" : ""}${hover ? " is-hover" : ""}"><span class="dl-ico">${icon(ic)}</span>
    <${state === "completed" ? 'a href="#"' : "div"} class="dl-text"><span class="dl-name">${name}</span>${byline(meta)}${progress !== null ? `<span class="meter" role="progressbar" aria-valuenow="${Math.round(progress * 100)}"><i style="width:${progress * 100}%"></i></span>` : ""}</${state === "completed" ? "a" : "div"}>${acts}</li>`;
}
function downloadsPopover() {
  return `<div class="overlay overlay--free"><section class="pop pop--list" role="dialog" aria-label="ダウンロード" data-anchor=".dl-btn" data-side="below" data-align="right">
    <header class="pop-head"><h3>ダウンロード</h3><button class="link">一覧を消去</button></header>
    <ul class="dls">
      ${dlRow({ ic: "pdf", name: "国内介護ソフト市場規模_2026.pdf", meta: ["ダウンロード中", "4.2 / 18.6 MB", `<span class="mono">drive.google.com</span>`], state: "progressing", progress: 0.226 })}
      ${dlRow({ ic: "grid", name: "希薄化シミュレーション.xlsx", meta: ["48 KB", "14:22", `<span class="mono">docs.google.com</span>`], hover: true })}
      ${dlRow({ ic: "grid", name: "tsubame_meisai_202611.csv", meta: ["12 KB", "14:20", `<span class="mono">biz.tsubamebank.co.jp</span>`] })}
      ${dlRow({ ic: "pdf", name: "kaigo-hoshu-kaitei-gaiyo.pdf", meta: ["中断されました", "11:44", `<span class="mono">www.mhlw.go.jp</span>`], state: "interrupted" })}
      ${dlRow({ ic: "folder", name: "pitch-figures.zip", meta: ["キャンセルしました", "昨日 19:05", `<span class="mono">www.figma.com</span>`], state: "cancelled" })}
    </ul>
    <footer class="pop-note">${icon("laptop", 14)}<span>ファイルは、このMacの「ダウンロード」フォルダに保存します。スペースには共有されません。</span></footer>
  </section></div>`;
}
SCREENS["15b-downloads"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar({ ...FUND, active: "pdf", current: "pdf" }),
    toolbarHtml: toolbar({ space: "fund", url: PAGES.pdf.url, state: "fresh", by: ["森 拓海", "第1版", "11/23 09:02"], actions: dlButton({ open: true, progress: 0.226 }) }),
    stageHtml: pageCard(mockPdf(), { ring: "closed" }) + downloadsPopover(),
  });
function mockPdf() {
  return `
  <div class="m-pdf">
    <header class="m-pdf-bar"><span class="m-pdf-name">${favicon("pdf", 20)}国内介護ソフト市場規模 2026.pdf</span><span class="m-pdf-page">9 / 14</span><span class="m-pdf-tools"><i>${icon("search")}</i><i>${icon("download")}</i></span></header>
    <div class="m-pdf-canvas">
      <article class="m-sheet">
        <p class="m-meta">国内介護ソフト市場規模 2026｜ケア経済研究所｜9</p>
        <h2>3. 市場規模の推計</h2>
        <p>国内の介護事業所向け業務ソフトの市場規模（TAM）は、2026年度に3,150億円と推計した。請求代行（BPO）は、ソフトウェアの売上と区別できないため、本推計には含めていない。</p>
        <table>
          <thead><tr><th>区分</th><th>定義</th><th>規模</th></tr></thead>
          <tbody><tr><td>全体</td><td>介護事業所向け業務ソフト（請求代行を除く）</td><td class="num">3,150億円</td></tr><tr><td>訪問・通所</td><td>職員50人未満の事業所</td><td class="num">1,400億円</td></tr><tr><td>施設</td><td>入所系の事業所</td><td class="num">1,240億円</td></tr></tbody>
        </table>
        <p>2023年度から2026年度の年平均成長率は12.4%である。記録の電子化に対する加算が見込まれる2027年度以降は、訪問・通所の区分で伸びが大きくなるとみられる。</p>
        <h2>4. 推計の方法</h2>
        <p>事業所数は厚生労働省の介護保険事業状況報告を用い、1事業所あたりの年間支出は、312事業所への聞き取りから区分ごとに求めた。</p>
      </article>
    </div>
  </div>`;
}

/* ───────── 15c find in page ───────── */
function findField({ text = "", count = "", none = false, focus = true } = {}) {
  return `<div class="find${focus ? " is-focus" : ""}" role="search" aria-label="ページ内を検索">${icon("search")}<span class="find-input${text ? "" : " is-empty"}">${text || "ページ内を検索"}${focus ? `<span class="caret"></span>` : ""}</span><span class="find-count${none ? " is-none" : ""}">${count}</span><span class="find-rule"></span><button class="ibtn ibtn--paper" aria-label="前へ"${none ? " disabled" : ""}>${icon("chevUp")}</button><button class="ibtn ibtn--paper" aria-label="次へ"${none ? " disabled" : ""}>${icon("chevDown")}</button><button class="ibtn ibtn--paper" aria-label="検索を閉じる">${icon("close")}</button></div>`;
}
/* the engine paints the matches inside the page; the mock marks them the way Chromium does */
function mockNewsFound(word, active) {
  let n = 0;
  return mockNews().replace(new RegExp(word, "g"), () => `<mark class="m-find${++n === active ? " is-active" : ""}">${word}</mark>`);
}
SCREENS["15c-find-in-page"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar({ ...FUND, active: "news", current: null }),
    toolbarHtml: toolbar({ space: "fund", url: PAGES.news.url, state: "local", actions: findField({ text: "記録", count: "2/4" }) }),
    stageHtml: pageCard(mockNewsFound("記録", 2)),
  });

/* ───────── 16a Space switcher, 16a2 create a Space ───────── */
function spaceMenu() {
  const row = (k, role, on = false) => {
    const sp = SPACES[k];
    return `<button class="menu-item menu-item--2${on ? " is-on" : ""}" role="menuitemradio" aria-checked="${on}">${seal(k, 28)}<span class="menu-text"><span class="menu-name">${sp.name}</span>${byline([`メンバー${sp.members}人`, `共有${sp.items}件`, role])}</span>${on ? icon("check", 14, "menu-check") : ""}</button>`;
  };
  return `<div class="overlay overlay--free"><section class="menu menu--space" role="menu" aria-label="スペース" data-anchor=".space-head" data-side="below" data-align="left" data-gap="4">
    <h3 class="menu-sec">スペース</h3>
    ${row("fund", "オーナー", true)}${row("hire", "メンバー")}${row("product", "メンバー")}
    ${menuRule}
    ${menuItem("keep", "スペースホーム", { keys: ["kShift", "kCmd", "H"] })}
    ${menuItem("people", "メンバーと招待")}
    ${menuItem("sliders", "名前・印・色を変える…")}
    ${menuRule}
    ${menuItem("plus", "新しいスペース…")}
    ${menuItem("link", "招待リンクで参加…")}
    ${menuRule}
    ${menuItem("glasses", "新しいプライベートウインドウ", { keys: ["kShift", "kCmd", "N"] })}
  </section></div>`;
}
SCREENS["16a-space-switcher"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar({ ...FUND, menu: true }),
    toolbarHtml: toolbar(BAR_FRESH),
    stageHtml: pageCard(mockDoc(), { ring: "closed" }) + spaceMenu(),
  });

const HUES = [
  ["amber", "琥珀"], ["coral", "柿"], ["rose", "紅梅"], ["violet", "藤"], ["indigo", "藍"], ["sky", "空"], ["teal", "浅葱"], ["green", "若竹"], ["graphite", "墨"],
];
function swatches(on) {
  return `<ul class="swatches" role="radiogroup" aria-label="スペースの色">${HUES.map(
    ([k, n]) => `<li><button class="swatch${k === on ? " is-on" : ""}" role="radio" aria-checked="${k === on}" data-space="${k}"><span class="swatch-chip">${k === on ? icon("check", 14) : ""}</span><span class="swatch-name">${n}</span></button></li>`,
  ).join("")}</ul>`;
}
function createSpaceDialog() {
  return `<div class="overlay"><div class="scrim"></div><section class="dialog dialog--form" role="dialog" aria-label="新しいスペース" data-space="coral">
    <h2>新しいスペース</h2>
    <p class="dialog-lede">スペースは、プロジェクトごとの共有の場です。ここに入るのは、あなたやメンバーが共有したページだけです。</p>
    <div class="form-row">
      <label class="field field--grow"><span class="field-label">名前</span><span class="input is-focus">営業<span class="caret"></span></span></label>
      <label class="field"><span class="field-label">印</span><span class="input input--seal">営</span></label>
    </div>
    <div class="field"><span class="field-label">色</span>${swatches("coral")}</div>
    <p class="dialog-note dialog-note--mini">${miniEdge("closed")}<span>ウインドウのふちと、共有したページを囲む線がこの色になります。色はスペースだけを表します。</span></p>
    <footer class="foot-btns foot-btns--split"><span class="field-help">あなたがオーナーになります。</span><button class="btn btn--line">キャンセル</button><button class="btn btn--space">スペースをつくる${kbd(["kReturn"])}</button></footer>
  </section></div>`;
}
SCREENS["16a2-create-space"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar(FUND),
    toolbarHtml: toolbar(BAR_FRESH),
    stageHtml: pageCard(mockDoc(), { ring: "closed" }) + createSpaceDialog(),
  });

/* ───────── Space home: sections ───────── */
function homeTabs(on) {
  const t = (k, label, n) => `<button class="viewtab${on === k ? " is-on" : ""}" role="tab" aria-selected="${on === k}">${label}${n !== undefined ? `<span>${n}</span>` : ""}</button>`;
  return `<nav class="viewtabs" role="tablist" aria-label="スペースホームの表示">${t("items", "台帳", 41)}${t("members", "メンバー", 4)}${t("activity", "記録")}</nav>`;
}
function homeHead({ invite = true } = {}) {
  return `<header class="home-head">
    ${seal("fund", 40)}
    <div class="home-id"><h1>資金調達 2027</h1><p class="home-sub">ここにあるものを読めるのは、佐伯 遥、森 拓海、小野 美咲、柏木 蓮と、AIです。</p></div>
    ${invite ? `<button class="btn btn--line">${icon("invite")}招待</button>` : ""}
  </header>`;
}

/* ───────── 16b members and invites (the owner's view) ───────── */
function memberRow(id, role, joined, { hover = false } = {}) {
  const p = PEOPLE[id];
  const act = hover
    ? `<button class="btn btn--sm btn--line">スペースから外す…</button>`
    : `<button class="ibtn ibtn--paper" aria-label="${p.name} の操作">${icon("more")}</button>`;
  return `<tr${hover ? ' class="is-hover"' : ""}><td><div class="book-cell">${avatar(id, 28)}<div class="book-title"><span>${p.name}${p.me ? `<span class="tag">あなた</span>` : ""}</span><span class="byline mono">${EMAIL[id]}</span></div></div></td><td>${role}</td><td class="num">${joined}</td><td class="book-act">${act}</td></tr>`;
}
function inviteRow({ to, sub, by, until }) {
  return `<tr><td><div class="book-cell"><span class="book-ico">${icon(to ? "mail" : "link")}</span><div class="book-title"><span${to ? ' class="mono"' : ""}>${to || "宛先なしのリンク"}</span>${byline(sub)}</div></div></td><td>${by}</td><td class="num">${until}</td><td class="book-act"><button class="btn btn--sm btn--line">招待を取り消す</button></td></tr>`;
}
function membersHome() {
  return `<div class="home home--members">
    <section class="home-main">
      ${homeHead({ invite: false })}
      <div class="home-bar">${homeTabs("members")}</div>
      <table class="book book--people">
        <thead><tr><th>メンバー</th><th>役割</th><th>参加した日</th><th></th></tr></thead>
        <tbody>${memberRow("saeki", "オーナー", "10/20")}${memberRow("mori", "メンバー", "10/20")}${memberRow("ono", "メンバー", "10/21")}${memberRow("kashiwagi", "メンバー", "10/27", { hover: true })}</tbody>
      </table>
      <h2 class="home-h2">招待中<span>2</span></h2>
      <table class="book book--people">
        <thead><tr><th>宛先</th><th>招待した人</th><th>有効期限</th><th></th></tr></thead>
        <tbody>${inviteRow({ to: "hayakawa@hayakawa-kaikei.example", sub: ["このアドレスでサインインした人だけが使えます"], by: "佐伯 遥", until: "12/9 まで" })}${inviteRow({ to: "", sub: ["今日 14:44 に作成", "1人が1回だけ使えます"], by: "佐伯 遥", until: "12/10 まで" })}</tbody>
      </table>
      <div class="roles">
        <section><h3 class="field-label">オーナーができること</h3><ul class="after"><li>メンバーを招待し、招待を取り消す</li><li>メンバーをスペースから外す</li><li>誰が共有したものでも、共有を解除する</li><li>スペースの名前・印・色を変える</li></ul></section>
        <section><h3 class="field-label">メンバーができること</h3><ul class="after"><li>ページを共有し、自分の共有を解除する</li><li>スペースに質問し、スレッドに投稿する</li><li>台帳と記録を読む</li><li>自分からスペースを出る</li></ul></section>
      </div>
    </section>
    <aside class="home-side sheet-side sheet-side--space" aria-label="メンバーを招待">
      ${sideList(
        "メンバーを招待",
        `<span class="input input--sm is-empty">メールアドレス（任意）</span>
         <p class="side-note">入れると、そのアドレスでサインインした人だけが使えます。空のままなら、リンクを受け取った人が使えます。</p>
         <button class="btn btn--space side-go">${icon("link")}招待リンクをつくる</button>`,
      )}
      ${sideList(
        "いまつくったリンク",
        `<div class="linkbox"><p class="side-url">https://tiger.kotonoha.example/invite#q7Jx2mVd9KfL0aTzR4uWb8Yc</p><button class="btn btn--sm btn--line">${icon("copy", 14)}リンクをコピー</button></div>
         <p class="side-note">このリンクは一度だけ表示されます。1人が1回だけ使えます。12/10 まで有効です。</p>`,
      )}
      ${sideList("参加した人が読めるもの", `<ul class="after"><li>共有41件。これまでに共有されたものも含みます。</li><li>スペースのスレッドのすべて。</li><li>メンバーの名前とメールアドレス。</li></ul>`)}
      ${sideList("読めないもの", `<ul class="after"><li>あなたやメンバーが開いているタブ。</li><li>それぞれの「あなただけ」のスレッドと、添付したページ。</li></ul>`)}
    </aside>
  </div>`;
}
SCREENS["16b-members-and-invites"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar(FUND_HOME),
    toolbarHtml: toolbar({ space: "fund", internal: ["資金調達 2027", "メンバー"], state: "home", ask: false, noReload: true }),
    stageHtml: pageCard(membersHome(), { ring: "closed", cls: "card--home" }),
  });

/* 16d (beyond the brief): the third section of Space home, so that its tab leads somewhere drawn.
   AuditEvent rows in words, and SpaceUsage for the month. */
function activityHome() {
  const ev = (at, who, ic, what, target = "") => `<tr><td class="num">${at}</td><td>${who}</td><td><div class="book-cell"><span class="book-ico">${icon(ic)}</span><div class="book-title"><span>${what}</span>${target ? byline([target]) : ""}</div></div></td></tr>`;
  return `<div class="home home--members">
    <section class="home-main">
      ${homeHead()}
      <div class="home-bar">${homeTabs("activity")}<span class="bar-rule"></span><span class="bar-note">共有、解除、参加、書き出しを、起きた順に残します。消せません。</span></div>
      <table class="book book--log">
        <thead><tr><th>日時</th><th>人</th><th>できごと</th></tr></thead>
        <tbody>
          ${ev("今日 14:43", "佐伯 遥", "thread", "スレッドをスペースに共有", "数字合わせ：ピッチと市場レポート")}
          ${ev("今日 14:41", "佐伯 遥", "exportOut", "回答を Google ドキュメントに書き出し", "TAMを3,150億円に揃えた一文")}
          ${ev("今日 14:36", "佐伯 遥", "cross", "ページを共有", "希薄化シミュレーション")}
          ${ev("今日 12:14", "佐伯 遥", "cross", "新しい版を共有", "投資家向けピッチ v3")}
          ${ev("昨日 18:40", "小野 美咲", "cross", "新しい版を共有", "#fundraising")}
          ${ev("11/25 10:02", "佐伯 遥", "invite", "メンバーを招待")}
          ${ev("11/23 09:02", "森 拓海", "cross", "ページを共有", "国内介護ソフト市場規模 2026.pdf")}
          ${ev("11/21 16:30", "佐伯 遥", "uncross", "共有を解除", "タームシート比較メモ")}
          ${ev("11/21 15:48", "佐伯 遥", "cross", "新しい版を共有", "タームシート比較メモ")}
          ${ev("10/27 09:40", "柏木 蓮", "person", "スペースに参加")}
          ${ev("10/20 09:12", "佐伯 遥", "plus", "スペースを作成")}
        </tbody>
      </table>
    </section>
    <aside class="home-side sheet-side" aria-label="今月の利用">
      ${sideList(
        "11月のAI利用",
        `<div class="halt-meter" role="img" aria-label="今月の利用 62%"><i style="width:62%"></i></div>
         <div class="halt-row"><span>使った量</span><span>1,240,000 / 2,000,000 トークン</span></div>
         <div class="halt-row"><span>内訳</span><span>入力 1,102,000・出力 138,000</span></div>
         <p class="side-note">上限に達すると、月が替わるまでこのスペースでは質問できません。共有と閲覧は続けられます。</p>`,
      )}
      ${sideList("記録に残るもの", `<ul class="after"><li>誰が、いつ、何をしたか。</li><li>共有を解除したページの題名とURL。本文は残りません。</li><li>招待した相手のメールアドレスは、オーナーにだけ見えます。</li></ul>`)}
    </aside>
  </div>`;
}
SCREENS["16d-activity"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar(FUND_HOME),
    toolbarHtml: toolbar({ space: "fund", internal: ["資金調達 2027", "記録"], state: "home", ask: false, noReload: true }),
    stageHtml: pageCard(activityHome(), { ring: "closed", cls: "card--home" }),
  });

/* ───────── 16c accept an invite (the link was opened; engine event invite.open) ───────── */
function inviteDialog() {
  return `<div class="overlay"><div class="scrim"></div><section class="dialog" role="dialog" aria-label="スペースへの招待" data-space="teal">
    <header class="dialog-id">${seal("cs", 40)}<div><h2>「導入支援」に招待されています</h2><p class="dialog-by">${byline(["柏木 蓮が招待", "メンバー3人", "共有12件", "12/9 まで有効"])}</p></div></header>
    <div class="dialog-cols">
      <section><h3 class="field-label">${icon("arrowRight", 14)}参加すると</h3><ul class="after"><li>メンバーが共有したページと、スペースのスレッドを読めます。これまでの分も含みます。</li><li>メンバーに、あなたの名前、メールアドレス、写真が見えます。</li></ul></section>
      <section><h3 class="field-label">${icon("laptop", 14)}変わらないこと</h3><ul class="after"><li>このMacで開いているタブは、誰にも伝わりません。</li><li>共有するまで、ページの内容はこのMacから出ません。</li><li>いつでも自分からスペースを出られます。</li></ul></section>
    </div>
    <p class="dialog-note">${EMAIL.saeki} として参加します。</p>
    <footer class="foot-btns"><button class="btn btn--line">あとで</button><button class="btn btn--space">参加する${kbd(["kReturn"])}</button></footer>
  </section></div>`;
}
SCREENS["16c-accept-invite"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar(FUND),
    toolbarHtml: toolbar(BAR_FRESH),
    stageHtml: pageCard(mockDoc(), { ring: "closed" }) + inviteDialog(),
  });

/* ───────── 17 share a private thread with the Space ─────────
   One block per question with its answers (attachedQuestions() in packages/client). A block built
   from an attached page carries the dashed line and has no default: decision is null until the
   member chooses. decision: "in" | "out" | null. */
function xMsg(who, text) {
  if (who === "ai") return `<div class="x-msg x-msg--ai">${seal("ai", 20)}<div class="x-text voice"><p>${text}</p></div></div>`;
  return `<div class="x-msg">${avatar(who, 20)}<div class="x-text">${text}</div></div>`;
}
function xchg({ time, attached = "", decision, q, a, sources = "" }) {
  const out = decision === "out";
  const kind = attached
    ? `<span class="xchg-kind">${icon("frame")}ページを添付した質問</span>${byline([time])}`
    : `<span class="xchg-kind">質問と回答</span>${byline([time])}`;
  const att = attached ? `<b>「${attached[0]}」${attached[1]}文字を添付。</b>` : "";
  const ask = decision === null ? `<span class="xchg-ask"><i></i>選んでください</span>` : "";
  const body = out
    ? `<p class="xchg-gone">${att ? `「${attached[0]}」を添付<i class="sep">・</i>` : ""}${q}</p>`
    : `<div class="xchg-body">${xMsg("saeki", q)}${xMsg("ai", a)}${sources ? `<p class="x-sources">出典${sources}</p>` : ""}</div>${
        attached ? `<p class="xchg-note">${att}${decision === null ? "回答と一緒に共有するか、両方とも除外するかを選んでください。ページ自体は共有されません。" : "回答が引用した部分は、回答の中に残ります。ページ自体は共有されません。"}</p>` : ""
      }`;
  return `<section class="xchg${attached ? " xchg--attached" : ""}${out ? " is-out" : ""}${decision === null ? " is-undecided" : ""}">
    <header class="xchg-head">${kind}<span class="grow"></span>${ask}${choice([["in", "共有する"], ["out", "含めない"]], decision, { label: "この質問と回答" })}</header>
    ${body}
  </section>`;
}
function xSrc(n, title) {
  return `<span class="x-src">${cite(n)}${title}</span>`;
}
function threadSheet({ last = null } = {}) {
  const ready = last !== null;
  const side = `<aside class="sheet-side sheet-side--space">
    ${sideList("共有先", `<div class="picker picker--static">${seal("fund", 28)}<span class="picker-text"><span class="picker-name">資金調達 2027</span><span class="byline">新しいスレッドとして<i class="sep">・</i>メンバー4人</span></span></div>`)}
    ${sideList(
      "読める人と送り先",
      `<ul class="whos">
        ${who("saeki", "佐伯 遥", "あなた")}${who("mori", "森 拓海", "メンバー")}${who("ono", "小野 美咲", "メンバー")}${who("kashiwagi", "柏木 蓮", "メンバー")}
        ${who(`<span class="who-glyph">${icon("exportOut")}</span>`, "Anthropic・OpenAI", "@Tiger に質問されたとき")}
      </ul>`,
    )}
    ${sideList("共有されないもの", `<ul class="after"><li>添付したページそのもの。回答が引用した部分は、回答の中に残ります。</li><li>「含めない」にした質問と回答。</li></ul>`)}
    ${sideList("共有したあと", `<ul class="after"><li>新しいスレッドとしてスペースに入ります。あなただけのスレッドは、そのまま残ります。</li><li>取り消すには、スペースのスレッドを削除します。</li><li>記録に「スレッドを共有」が残ります。</li></ul>`)}
    <footer class="sheet-foot"><p class="foot-note">${ready ? "左に表示している6件を、そのまま共有します。" : "ページを添付した質問が、あと1組選ばれていません。"}</p><div class="foot-btns"><button class="btn btn--line">キャンセル</button><button class="btn btn--space"${ready ? "" : " disabled"}>${icon("cross")}スレッドを共有${ready ? kbd(["kCmd", "kReturn"]) : ""}</button></div></footer>
  </aside>`;
  return `<div class="overlay"><div class="scrim"></div><section class="sheet sheet--thread" role="dialog" aria-label="スレッドをスペースに共有">
    <div class="sheet-main">
      <header class="sheet-head"><h2>スペースのメンバーに見せる内容</h2><p class="sheet-sub">あなただけのスレッドの8件から<i class="sep">・</i>6件を共有${ready ? `<i class="sep">・</i>2件は含めない` : `<i class="sep">・</i>2件は未選択`}</p></header>
      <div class="xchgs" role="document" aria-label="共有する質問と回答">
        ${xchg({ time: "14:28", decision: "in", q: "ピッチの市場規模、森さんのレポートと食い違いますか。", a: `食い違いは2か所です。TAMは、ピッチが${fig("4,800億円", 1, "、")}レポートが${fig("3,150億円", 2, "。")}年成長率は、ピッチが${fig("18%", 1, "、")}レポートが${fig("12.4%", 2, "です。")}`, sources: xSrc(1, "投資家向けピッチ v3") + xSrc(2, "国内介護ソフト市場規模 2026.pdf") })}
        ${xchg({ time: "14:32", attached: ["投資家向けピッチ v3", PITCH_CHARS], decision: "in", q: Q_ATTACH_TEXT, a: `編集中の版では、食い違いが1か所ふえます。${fig("SAM 1,150億円", "添付", "は、")}レポートの区分にある${fig("1,400億円", 2, "と")}合いません。`, sources: xSrc(2, "国内介護ソフト市場規模 2026.pdf") })}
        ${xchg({ time: "14:36", decision: "in", q: "TAMを3,150億円に揃えた場合の一文を書いて", a: `国内の介護事業所向け業務ソフトの市場は${fig("3,150億円", 2, "（請求代行を除く）で、")}年${fig("12.4%", 2, "で")}伸びています。`, sources: xSrc(2, "国内介護ソフト市場規模 2026.pdf") })}
        ${xchg({ time: "14:41", attached: ["希薄化シミュレーション", 478], decision: last, q: "オプションプールを10%にすると、シード後の持分はどうなりますか。", a: `オプションプールを10%にすると、シード後の持分は、佐伯 遥が${fig("29.6%", "添付", "、")}森 拓海が${fig("22.2%", "添付", "、")}小野 美咲と柏木 蓮がそれぞれ${fig("11.1%", "添付", "に")}なります。` })}
      </div>
    </div>
    ${side}</section></div>`;
}
const ASK_PRIVATE = () =>
  askPanel({
    body: Q_COMPARE + answerCompare(),
    led: ledger({ open: false, page: { state: "can" } }),
    comp: composer({}),
  });
const shareThreadScreen = (last) => () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar(FUND_STALE),
    toolbarHtml: toolbar({ ...BAR_STALE, panel: true }),
    stageHtml: pageCard(mockDoc({ edited: true }), { ring: "open" }) + ASK_PRIVATE() + threadSheet({ last }),
  });
SCREENS["17-share-thread-confirm"] = shareThreadScreen(null);
SCREENS["17b-share-thread-ready"] = shareThreadScreen("out");

/* ───────── 18 export: the three exits ───────── */
const Q_LINE = personMsg("saeki", "14:36", "TAMを3,150億円に揃えた場合の一文を書いて");
function answerLine(actions) {
  return `<article class="msg msg--ai">${aiHead("14:36")}
    <div class="voice"><p>国内の介護事業所向け業務ソフトの市場は${fig("3,150億円", 2, "（請求代行を除く）で、")}年${fig("12.4%", 2, "で")}伸びています。</p></div>
    <ol class="sources" aria-label="出典">${sourceRow(2, "pdf", { page: "p.9" })}</ol>
    ${answerActions(actions)}
  </article>`;
}
function exportMenu({ connected = true } = {}) {
  const item = (ic, name, sub, trail = "") => `<button class="menu-item menu-item--2" role="menuitem"><span class="menu-ico">${icon(ic)}</span><span class="menu-text"><span class="menu-name">${name}</span><span class="byline">${sub}</span></span>${trail}</button>`;
  return `<div class="overlay overlay--free"><section class="menu menu--export" role="menu" aria-label="書き出す" data-anchor=".msg-actions" data-side="below" data-align="left">
    ${item("doc", "Google ドキュメント", connected ? `${EMAIL.saeki} のドライブに作ります` : "Google アカウントへの接続が必要です", icon("exportOut", 14, "menu-out"))}
    ${item("copy", "Markdown をコピー", "出典の一覧つきで、クリップボードへ")}
    ${item("download", "ファイルに保存…", "Markdown（.md）。保存先を選びます")}
    <footer class="menu-foot">書き出すのは、この回答と出典の一覧です。Google ドキュメントへの書き出しは、スペースの記録に残ります。</footer>
  </section></div>`;
}
function googlePopover() {
  return `<div class="overlay overlay--free"><section class="pop pop--google" role="dialog" aria-label="Google ドライブに接続" data-anchor=".msg-actions" data-side="below" data-align="left">
    <h3>Google ドライブに接続します</h3>
    <p>Google ドキュメントへの書き出しには、あなたの Google アカウントへの接続が必要です。Google の画面は、いつものブラウザで開きます。</p>
    <dl class="pop-facts">
      <div><dt>できること</dt><dd>Tiger が作ったファイルの作成と更新</dd></div>
      <div><dt>できないこと</dt><dd>ドライブのほかのファイルを見ること</dd></div>
      <div><dt>接続の保存先</dt><dd>このMacのキーチェーン。サーバーには送りません</dd></div>
    </dl>
    <div class="pop-foot pop-foot--split"><span class="grow"></span><div class="foot-btns"><button class="btn btn--sm btn--line">キャンセル</button><button class="btn btn--sm btn--ink">${icon("exportOut", 14)}ブラウザで接続する</button></div></div>
  </section></div>`;
}
function exportOutcome() {
  return `<div class="outcome" role="status">
    <div class="outcome-head">${icon("check")}Google ドキュメントに書き出しました</div>
    <div class="outcome-row"><span class="outcome-ico">${favicon("gdoc")}</span><span class="outcome-title">TAMを3,150億円に揃えた一文</span><button class="btn btn--sm btn--line">開く${icon("arrowRight", 14)}</button></div>
    ${byline([`${EMAIL.saeki} のドライブ`, "今日 14:41", "スペースの記録に残りました"])}
  </div>`;
}
const exportScreen = (actions, over = "") => () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar(FUND),
    toolbarHtml: toolbar({ ...BAR_FRESH, panel: true }),
    stageHtml:
      pageCard(mockDoc(), { ring: "closed" }) +
      askPanel({
        body: Q_LINE + answerLine(actions),
        led: ledger({ open: false, page: { state: "fresh" } }),
        comp: composer({}),
      }) +
      over,
  });
SCREENS["18a-export-menu"] = () => exportScreen({ open: true }, exportMenu())();
SCREENS["18b-google-not-connected"] = () => exportScreen({ open: true }, googlePopover())();
SCREENS["18c-export-done"] = () => exportScreen({ outcome: exportOutcome() })();

/* ───────── 19 settings (a surface: it replaces the page card, like Space home) ───────── */
function setRow(label, help, control, cls = "") {
  return `<div class="set-row ${cls}"><div class="set-label"><b>${label}</b>${help ? `<p>${help}</p>` : ""}</div><div class="set-ctl">${control}</div></div>`;
}
function settingsPage() {
  const nav = [
    ["一般", true],
    ["プライバシー"],
    ["モデル"],
    ["アカウント"],
  ]
    .map(([t, on]) => `<li><a class="setnav-item${on ? " is-on" : ""}" href="#"${on ? ' aria-current="true"' : ""}>${t}</a></li>`)
    .join("");
  const host = (h) => `<li class="hostrow"><span class="mono">${h}</span><button class="ibtn ibtn--paper" aria-label="${h} を削除">${icon("close")}</button></li>`;
  return `<div class="settings">
    <nav class="setnav" aria-label="設定の項目"><h1>設定</h1><ul>${nav}</ul>
      <p class="setnav-about"><span>Tiger 0.9.0</span><span>Chromium 154</span><span class="mono">tiger.kotonoha.example</span></p></nav>
    <div class="setbody">
      <section class="set-sec" aria-label="一般"><h2 class="set-h">一般</h2>
        ${setRow("言語", "", choice([["ja", "日本語"], ["en", "English"]], "ja", { label: "言語" }))}
        ${setRow("テーマ", "", choice([["system", "システムに合わせる"], ["light", "ライト"], ["dark", "ダーク"]], "system", { label: "テーマ" }))}
        ${setRow("検索エンジン", "アドレス欄に入れた言葉は、ここで選んだ検索エンジンに送られます。", choice([["google", "Google"], ["duckduckgo", "DuckDuckGo"], ["bing", "Bing"]], "google", { label: "検索エンジン" }))}
      </section>
      <section class="set-sec" aria-label="プライバシー"><h2 class="set-h">プライバシー</h2>
        ${setRow(
          "共有しないサイト",
          "ここに加えたサイトのページは、共有も添付もできなくなります。サブドメインも含みます。",
          `<ul class="hosts">${host("kaikei-cloud.jp")}${host("line.me")}</ul>
           <div class="hostadd"><span class="input input--sm is-empty mono">example.com</span><button class="btn btn--line">追加</button></div>`,
          "set-row--top",
        )}
        ${setRow("はじめから共有できないページ", "この一覧は変えられません。画面の上だけでなく、Tiger の本体で止めています。", `<p class="set-text">金融サービス、メール、パスワード管理、ログインやアカウント、行政手続き、社内やローカルのアドレス、プライベートウインドウ。</p><button class="link">保護リストを見る</button>`, "set-row--top")}
      </section>
      <section class="set-sec" aria-label="モデル"><h2 class="set-h">モデル</h2>
        ${setRow("既定のモデル", "質問ごとに変えられます。質問と、関係する共有の部分は、選んだモデルの提供元に送られます。", `<button class="picker picker--set"><span class="who-glyph who-glyph--28">${icon("exportOut")}</span><span class="picker-text"><span class="picker-name">Claude Sonnet 5.5</span><span class="byline">Anthropic<i class="sep">・</i>バランス</span></span>${icon("chevDown", 14)}</button>`)}
      </section>
      <section class="set-sec" aria-label="アカウント"><h2 class="set-h">アカウント</h2>
        ${setRow("Tiger", "", `<div class="acct">${avatar("saeki", 28)}<span class="picker-text"><span class="picker-name">佐伯 遥</span><span class="byline mono">${EMAIL.saeki}</span></span><button class="btn btn--line">サインアウト</button></div>`)}
        ${setRow("Google ドライブ", "書き出しにだけ使います。Tiger が作ったファイルだけを扱えます。", `<div class="acct"><span class="who-glyph who-glyph--28">${icon("doc")}</span><span class="picker-text"><span class="picker-name">接続中</span><span class="byline mono">${EMAIL.saeki}</span></span><button class="btn btn--line">接続を解除</button></div>`)}
      </section>
    </div>
  </div>`;
}
const FUND_SURFACE = { ...FUND, active: null, current: null };
const settingsScreen = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar({ ...FUND_SURFACE, settings: true }),
    toolbarHtml: toolbar({ space: "fund", internal: ["Tiger", "設定"], state: "", ask: false, noReload: true }),
    stageHtml: pageCard(settingsPage(), { cls: "card--settings" }),
  });
SCREENS["19-settings"] = settingsScreen;

/* ───────── 20a sign in (no session: no Space, no hue) ───────── */
function plainSidebar({ tabs, active = -1, head, foot }) {
  return `
  <aside class="sidebar">
    <div class="sb-top">${lights()}<button class="ibtn" aria-label="サイドバーをたたむ">${icon("sidebar")}</button></div>
    <div class="space-head space-head--private"><span class="seal seal--28 seal--plain">${icon(head[0])}</span>
      <span class="space-head-text"><span class="space-name">${head[1]}</span><span class="space-sub">${head[2]}</span></span></div>
    <section class="pocket pocket--private" aria-label="このMacのタブ">
      <header class="zone-head zone-head--pocket"><span class="zone-label">${icon("laptop", 14)}このMacのタブ</span><span class="zone-count">${tabs.length}</span></header>
      <ul class="tabs">${tabs.map(([f, t], i) => `<li><a class="tab${i === active ? " is-active" : ""}" href="#"><span class="tab-ico">${favicon(f)}</span><span class="tab-title">${t}</span></a></li>`).join("")}</ul>
      <button class="tab tab--new"><span class="tab-ico">${icon("plus")}</span><span class="tab-title">新しいタブ</span>${kbd(["kCmd", "T"])}</button>
    </section>
    <footer class="sb-foot"><span class="private-foot">${foot}</span></footer>
  </aside>`;
}
function signIn() {
  return `<div class="setup">
    <section class="setup-form">
      <p class="setup-step"><b>Google でサインイン</b><i class="sep">・</i><span>スペースをつくる</span><i class="sep">・</i><span>メンバーを招待</span></p>
      <h1>Tiger にサインイン</h1>
      <p class="setup-lede">サインインすると、スペースをつくり、メンバーが共有したページをもとに質問できます。</p>
      <div class="setup-go setup-go--stack">
        <button class="btn btn--ink btn--lg">${icon("exportOut")}Google でサインイン</button>
        <span class="field-help">Google の画面は、いつものブラウザで開きます。終わると、ここに戻ります。</span>
      </div>
      <p class="setup-alt"><button class="link">サインインせずに使う</button><span class="field-help">ふつうのブラウザとして使えます。共有と質問は使えません。</span></p>
    </section>
    <section class="setup-legend" aria-label="サインインで届くもの、届かないもの">
      <h2>サインインで Tiger に届くもの、届かないもの</h2>
      <ul class="legend legend--glyph">
        <li>${icon("person")}<div><b>名前、メールアドレス、プロフィール写真</b><p>参加したスペースのメンバーに見えます。</p></div></li>
        <li>${icon("lock")}<div><b>Google のパスワードは受け取りません</b><p>サインインは Google の画面で行い、Tiger には結果だけが届きます。</p></div></li>
        <li>${icon("doc")}<div><b>ドライブやメールの中身は見ません</b><p>Google ドキュメントへの書き出しは、はじめて使うときに、別に確かめます。</p></div></li>
        <li>${icon("laptop")}<div><b>開いているページは、このMacに残ります</b><p>共有するか、質問に添付するまで、ページの内容は送りません。</p></div></li>
      </ul>
      <p class="legend-foot">${icon("key", 14)}<span>サイトのパスワードの自動入力とパスキーには、まだ対応していません。</span></p>
    </section>
  </div>`;
}
SCREENS["20a-sign-in"] = () =>
  windowShell({
    space: "none",
    sidebarHtml: plainSidebar({
      head: ["person", "サインインしていません", "スペースは使えません"],
      tabs: [
        ["search", "介護 記録 音声入力 — 検索"],
        ["news", "介護テックのシード調達、3年ぶりに増加"],
      ],
      foot: `${icon("laptop", 14)}タブはこのMacにだけあります`,
    }),
    toolbarHtml: toolbar({ space: "none", internal: ["Tiger", "サインイン"], state: "", ask: false, canBack: false, noReload: true }),
    stageHtml: pageCard(signIn(), { cls: "card--setup" }),
  });

/* ───────── 20b the server cannot be reached; the realtime connection is retrying ───────── */
SCREENS["20b-offline-reconnecting"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar({ ...FUND, conn: ["再接続しています…", "14:38から"] }),
    toolbarHtml: toolbar({ ...BAR_FRESH, panel: true }),
    stageHtml:
      pageCard(mockDoc(), { ring: "closed" }) +
      askPanel({
        body:
          Q_LINE +
          `<article class="msg msg--ai">${aiHead("14:39")}
          <div class="halt"><div class="halt-head">${icon("offline")}送れませんでした</div>
            <p>サーバーに接続できません。ネットワークを確認してください。</p>
            <div class="halt-actions"><button class="btn btn--sm btn--line">${icon("retry", 14)}もう一度送る</button><button class="btn btn--sm btn--line">${icon("copy", 14)}質問をコピー</button></div></div>
          <p class="answer-note">${icon("info", 14)}<span>この質問は、どのモデルの提供元にも送られていません。</span></p>
        </article>`,
        led: ledger({ open: false, page: { state: "fresh" } }),
        comp: composer({ disabled: true, placeholder: "つながると、質問できます" }),
        extra: "",
      }).replace(`<div class="panel-note">`, `<div class="panel-note panel-note--conn">${icon("offline", 14)}サーバーに接続できません。共有と質問は、つながるまで使えません。</div><div class="panel-note">`),
  });

/* ───────── 20c the page did not load, 20d the page process ended ─────────
   Drawn by Tiger inside the page card when Tab.loadError is set or Tab.crashed is true. */
function pageMessage({ title, lede, points, actions, detail }) {
  return `<div class="ntp ntp--msg">
    <h1>${title}</h1>
    <p class="ntp-lede">${lede}</p>
    <ul class="ntp-list">${points.map(([ic, b, p]) => `<li>${icon(ic)}<div><b>${b}</b><p>${p}</p></div></li>`).join("")}</ul>
    <div class="ntp-actions">${actions}</div>
    ${detail ? `<p class="ntp-detail">${detail}</p>` : ""}
  </div>`;
}
const FUND_DEAD = { ...FUND, tabs: ["pitch", "pdf", "notion", "slack", "news", "dead", "bank", "hireplan"], current: null, active: "dead" };
SCREENS["20c-page-load-error"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar(FUND_DEAD),
    toolbarHtml: toolbar({ space: "fund", url: PAGES.dead.url, state: "local", noShare: true, note: "ページがありません" }),
    stageHtml: pageCard(
      pageMessage({
        title: "このページを開けません",
        lede: `<b>startup-houmu.jp</b> のサーバーが見つかりませんでした。`,
        points: [
          ["search", "アドレスを確かめる", "入力したアドレスに誤りがないか、確かめてください。"],
          ["offline", "ネットワークを確かめる", "ほかのページが開けるか、確かめてください。開けない場合は、このMacの接続に原因があります。"],
        ],
        actions: `<button class="btn btn--line">${icon("reload")}再読み込み${kbd(["kCmd", "R"])}</button><button class="btn btn--line">${icon("search")}「startup-houmu.jp」を Google で検索</button>`,
        detail: "ERR_NAME_NOT_RESOLVED（-105）",
      }),
      { cls: "card--ntp" },
    ),
  });
SCREENS["20d-tab-crashed"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar({ ...FUND_NAV, marks: { ...FUND_NAV.marks, dilution: "crashed" } }),
    toolbarHtml: toolbar({ space: "fund", url: PAGES.dilution.url, state: "local", noShare: true, note: "ページが止まっています" }),
    stageHtml: pageCard(
      pageMessage({
        title: "このタブのページが止まりました",
        lede: "ページを表示していたプロセスが終了しました。ほかのタブとスペースには影響ありません。",
        points: [
          ["reload", "再読み込みで、もう一度開けます", "ページに保存されていない入力は、失われていることがあります。"],
          ["keep", "共有したものは変わりません", "スペースが持っている版は、そのまま読めます。"],
        ],
        actions: `<button class="btn btn--line">${icon("reload")}再読み込み${kbd(["kCmd", "R"])}</button><button class="btn btn--line">${icon("close")}タブを閉じる${kbd(["kCmd", "W"])}</button>`,
        detail: "",
      }),
      { cls: "card--ntp" },
    ),
  });

/* ───────── 21 a shared item: what the Space holds ───────── */
function itemDetail() {
  const md = pitchMarkdown();
  const chars = md.join("\n").length;
  const rows = md.map((l, i) => `<div class="md-line"><span class="md-no">${i + 1}</span><span class="md-text">${l.replace(/</g, "&lt;") || "&nbsp;"}</span></div>`).join("");
  const ver = (n, at, by, c, on = false) => `<li class="ver${on ? " is-on" : ""}"${on ? ' aria-current="true"' : ""}><span class="ver-n">第${n}版</span><span class="ver-at">${at}</span><span class="ver-by">${by}</span><span class="ver-c">${c}文字</span></li>`;
  return `<div class="itemd">
    <section class="itemd-main">
      <p class="crumb"><a class="link" href="#">台帳</a>${icon("chevRight", 12)}<span>共有したページ</span></p>
      <header class="itemd-head"><span class="itemd-ico">${icon("doc", 20)}</span><div><h1>投資家向けピッチ v3</h1>${byline(["Google ドキュメント", "佐伯 遥", "第2版", "今日 12:14"])}</div></header>
      <div class="itemd-cap"><h2>スペースが持っている本文</h2><p class="sheet-sub">Markdown ${md.length}行<i class="sep">・</i>${chars}文字<i class="sep">・</i>google-docs-export@1 で取得<i class="sep">・</i>第2版</p></div>
      <div class="md" role="document" aria-label="スペースが持っている本文">${rows}</div>
      <p class="omit">${icon("eyeOff", 14)}<span>メンバーとAIが読むのは、この文章だけです。画像の中身、コメント、編集履歴は入っていません。</span></p>
    </section>
    <aside class="itemd-side">
      ${sideList("出どころ", `<p class="side-url">https://docs.google.com/document/d/1mKx7RfQe8</p><button class="btn btn--sm btn--line side-go">ページを開く${icon("arrowRight", 14)}</button>`)}
      ${sideList("版の履歴", `<ol class="vers">${ver(2, "今日 12:14", "佐伯 遥", chars, true)}${ver(1, "11/24 18:02", "佐伯 遥", 431)}</ol><p class="side-note">本文を表示できるのは、いまの版です。過去の回答の引用は、読んだ版を指したままです。</p>`)}
      ${sideList(
        "読める人と送り先",
        `<ul class="whos">${who("saeki", "佐伯 遥", "共有した人")}${who("mori", "森 拓海", "メンバー")}${who("ono", "小野 美咲", "メンバー")}${who("kashiwagi", "柏木 蓮", "メンバー")}
          ${who(seal("ai", 20), "Tiger のサーバー", "保存と検索")}${who(`<span class="who-glyph">${icon("exportOut")}</span>`, "Anthropic・OpenAI", "質問されたとき")}</ul>`,
      )}
      <footer class="sheet-foot"><p class="foot-note">解除すると、本文とすべての版、検索用のデータが消えます。台帳の記録だけが残ります。</p><div class="foot-btns foot-btns--start"><button class="btn btn--line">${icon("uncross")}共有を解除…</button></div></footer>
    </aside>
  </div>`;
}
const itemScreen = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar({ ...FUND, active: null }),
    toolbarHtml: toolbar({ space: "fund", internal: ["資金調達 2027", "台帳 / 投資家向けピッチ v3"], state: "home", ask: false, noReload: true }),
    stageHtml: pageCard(itemDetail(), { ring: "closed", cls: "card--home" }),
  });
SCREENS["21-item-detail"] = itemScreen;

/* ───────── 22 new tab ───────── */
function newTab() {
  const it = (id) => {
    const x = ITEMS.find((i) => i.id === id);
    return `<li><a class="nt-row" href="#"><span class="nt-ico">${icon(SOURCE[x.type].icon)}</span><span class="nt-text"><span class="nt-title">${x.title}</span>${itemByline(x, { full: true })}</span></a></li>`;
  };
  const h = (fav, title, host, at) => `<li><a class="nt-row" href="#"><span class="nt-ico">${favicon(fav)}</span><span class="nt-text"><span class="nt-title">${title}</span><span class="byline"><span class="mono">${host}</span><i class="sep">・</i>${at}</span></span></a></li>`;
  return `<div class="newtab">
    <section class="nt-col" aria-label="スペースの最近の共有">
      <header class="nt-head">${seal("fund", 20)}<h2>資金調達 2027 の最近の共有</h2><a class="link" href="#">台帳を開く</a></header>
      <ul class="nt-list">${["pitch", "slack", "pdf", "mizunara", "notion", "kpi"].map(it).join("")}</ul>
    </section>
    <section class="nt-col" aria-label="このMacの履歴">
      <header class="nt-head"><span class="nt-glyph">${icon("laptop")}</span><h2>このMacで最近開いたページ</h2><a class="link" href="#">履歴を検索</a></header>
      <ul class="nt-list">
        ${h("gsheet", "希薄化シミュレーション", "docs.google.com", "14:36")}
        ${h("news", "介護テックのシード調達、3年ぶりに増加", "care-keizai.jp", "13:58")}
        ${h("web", "J-KISS 型新株予約権の手引き", "startup-houmu.jp", "13:41")}
        ${h("search", "新株予約権 税制適格 要件 — 検索", "google.com", "13:40")}
        ${h("web", "ミズナラ・キャピタル｜投資方針", "mizunara-capital.jp", "11:20")}
        ${h("cal", "カレンダー — 2026年12月", "calendar.google.com", "10:05")}
      </ul>
      <p class="nt-note">履歴はこのMacにだけあります。メンバーには伝わりません。</p>
    </section>
    <p class="nt-keys"><span>${kbd(["kCmd", "L"])}アドレスと検索</span><span>${kbd(["kCmd", "K"])}コマンド</span><span>${kbd(["kCmd", "\\"])}スペースに聞く</span><span>${kbd(["kShift", "kCmd", "S"])}ページを共有</span></p>
  </div>`;
}
SCREENS["22-new-tab"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar({ ...FUND, tabs: [...FUND.tabs, "ntp"], active: "ntp", current: null }),
    toolbarHtml: toolbar({ space: "fund", placeholder: "検索、またはアドレスを入力", focus: true, state: "", canBack: false, noReload: true }),
    stageHtml: pageCard(newTab(), { cls: "card--ntp" }),
  });

/* ───────── 23 dark ───────── */
SCREENS["23-dark-17-share-thread-confirm"] = SCREENS["17-share-thread-confirm"];
SCREENS["23-dark-19-settings"] = SCREENS["19-settings"];
SCREENS["23-dark-21-item-detail"] = SCREENS["21-item-detail"];

/* ───────── 15d the notice: a download finished while its popover was closed ───────── */
SCREENS["15d-notice"] = () =>
  windowShell({
    space: "fund",
    sidebarHtml: sidebar({ ...FUND, active: "pdf", current: "pdf", notice: notice("ダウンロードしました", { detail: "希薄化シミュレーション.xlsx", action: "開く", ic: "download" }) }),
    toolbarHtml: toolbar({ space: "fund", url: PAGES.pdf.url, state: "fresh", by: ["森 拓海", "第1版", "11/23 09:02"], actions: dlButton({}) }),
    stageHtml: pageCard(mockPdf(), { ring: "closed" }),
  });
