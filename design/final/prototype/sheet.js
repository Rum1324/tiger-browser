/* The component sheet: every component in every state, built from the same functions the screens
   use, so it cannot drift from them. index.html?screen=components (&theme=dark).
   Captions are the class or state name an engineer will look for (mono, Latin only at 11 px). */

function specItem(cap, html, { ground = "", w = "", cls = "" } = {}) {
  return `<figure class="spec-item ${cls}"${w ? ` style="width:${w}px"` : ""}><div class="spec-box${ground ? ` spec-box--${ground}` : ""}">${html}</div><figcaption>${cap}</figcaption></figure>`;
}
function specSec(ja, en, note, body) {
  return `<section class="spec"><header class="spec-head"><h2>${ja}</h2><span class="spec-en">${en}</span><p>${note}</p></header>${body}</section>`;
}
const specRow = (items, cls = "") => `<div class="spec-row ${cls}">${items.join("")}</div>`;
/* the capsule alone: toolbar() without its navigation and actions */
const specCapsule = (cap, s, w = 648) => specItem(cap, `<div class="spec-capsule">${toolbar({ space: "fund", url: PAGES.pitch.url, ask: false, ...s })}</div>`, { ground: "frame", w });
/* a page card with its lines, drawn by drawEdges() at real stroke widths */
const specEdge = (cap, ja, ring, frame) =>
  specItem(
    cap,
    `<div class="spec-win"><section class="card card--page" data-ring="${ring}" data-frame="${frame ? "on" : ""}"><div class="view"><i></i><i></i><i></i><i></i></div></section></div><p class="spec-mean">${ja}</p>`,
    { cls: "spec-item--bare" },
  );

function componentSheet() {
  const S = { space: "fund", marks: {}, active: null };
  const tabs = (list, s = {}) => `<div class="spec-pocket"><ul class="tabs">${list.map((id) => tabRow(id, { ...S, ...s })).join("")}</ul></div>`;
  const items = (list, s = {}) => `<ul class="items">${list.map((id) => itemRow(id, { ...S, ...s })).join("")}</ul>`;

  /* 1 ─ the six states of a page edge */
  const edges = specSec(
    "ページのふち",
    "The edge of a page",
    "ページを囲む線が、読める人を表します。線は余白（8px）に描き、ページの上には何も描きません。",
    specRow([
      specEdge("local · blocked · private", "線なし：このMacのみ", "", false),
      specEdge("fresh", "実線：スペースがこの版を持っている", "closed", false),
      specEdge("stale", "上が開いた実線：スペースにあるのは前の版", "open", false),
      specEdge("local + attached", "破線：次の質問にだけ添付", "", true),
      specEdge("fresh + attached", "実線と破線：共有中で、添付もしている", "closed", true),
      specEdge("stale + attached", "開いた実線と破線：前の版が共有中で、いまの内容を添付", "open", true),
    ], "spec-row--edges"),
  );

  /* 2 ─ seals and people */
  const seals = specSec(
    "印と人",
    "Seals and avatars",
    "印はスペースを一文字と色で表します。中抜きは「前の版」。AIは墨の「虎」。人は写真か、無彩色の頭文字です。",
    specRow([
      specItem("seal 16 / 20 / 24 / 28 / 40", [16, 20, 24, 28, 40].map((n) => seal("fund", n)).join("")),
      specItem("seal--hollow 16 / 20", seal("fund", 16, { hollow: true }) + seal("fund", 20, { hollow: true })),
      specItem("seal--ai 16 / 20 / 24", seal("ai", 16) + seal("ai", 20) + seal("ai", 24)),
      specItem("seal--plain (no Space)", `<span class="seal seal--28 seal--plain">${icon("glasses")}</span><span class="seal seal--28 seal--plain">${icon("person")}</span>`, { ground: "frame" }),
      specItem(
        "nine hues: amber coral rose violet indigo sky teal green graphite",
        HUES.map(([k, n]) => `<span class="seal seal--24" data-space="${k}" title="${n}">${n[0]}</span>`).join(""),
      ),
      specItem("av 20 / 24 / 28: photo", avatar("mori", 20) + avatar("mori", 24) + avatar("ono", 28)),
      specItem("av: monogram", avatar("kashiwagi", 20) + avatar("kashiwagi", 24) + avatar("kashiwagi", 28)),
      specItem("av--me (the member)", avatar("saeki", 20) + avatar("saeki", 24) + avatar("saeki", 28)),
    ]),
  );

  /* 3 ─ buttons */
  const B = (cls, label, extra = "", attr = "") => `<button class="btn ${cls}" ${attr}>${extra}${label}</button>`;
  const buttons = specSec(
    "ボタン",
    "Buttons",
    "色のボタンはスペースに入れるときだけ。墨は、スペースの外へ送るときと、取り消せない操作。ほかは線のボタンです。",
    specRow([
      specItem("btn--space", B("btn--space", "スペースに共有", icon("cross")) + B("btn--space h", "スペースに共有", icon("cross")) + B("btn--space", `スペースに共有${kbd(["kCmd", "kReturn"])}`, icon("cross")) + B("btn--space", "スペースに共有", icon("cross"), "disabled")),
      specItem("btn--ink", B("btn--ink", "この質問に添付", icon("frame")) + B("btn--ink h", "共有を解除", icon("uncross")) + B("btn--ink", "許可") + B("btn--ink", "共有を解除", "", "disabled")),
      specItem("btn--line", B("btn--line", "キャンセル") + B("btn--line h", "キャンセル") + B("btn--line", "招待", icon("invite")) + B("btn--line is-kbd-focus", "キャンセル")),
      specItem("btn--quiet", B("btn--sm btn--quiet", "新しい質問") + B("btn--sm btn--quiet h", "はずす")),
      specItem("btn--sm", B("btn--sm btn--line", "スレッドに投稿", icon("cross", 14)) + B("btn--sm btn--line export-btn", `書き出す${icon("chevDown", 12, "btn-chev")}`, icon("exportOut", 14)) + B("btn--sm btn--line export-btn is-open", `書き出す${icon("chevDown", 12, "btn-chev")}`, icon("exportOut", 14)) + B("btn--sm btn--line btn--icon", "", icon("copy", 14), 'aria-label="コピー"')),
      specItem("btn--lg", B("btn--ink btn--lg", "Google でサインイン", icon("exportOut"))),
      specItem("send: ask · post · stop · disabled", `<button class="btn btn--sm btn--ink">Anthropic に送信${kbd(["kReturn"])}</button><button class="btn btn--sm btn--ink">投稿${kbd(["kReturn"])}</button><button class="btn btn--sm btn--line">${icon("stop", 14)}止める</button><button class="btn btn--sm btn--ink" disabled>Anthropic に送信</button>`),
      specItem("link", `<button class="link">保護リストを見る</button><button class="link h">スペースに共有…</button>`),
      specItem("model-btn · .is-open", `<button class="model-btn">Claude Sonnet 5.5${icon("chevDown", 14)}</button><button class="model-btn is-open">Claude Sonnet 5.5${icon("chevDown", 14)}</button>`),
    ]) +
      specRow([
        specItem("btn--paper (ask) · .is-pressed", `<button class="btn btn--paper">${icon("chat")}スペースに聞く</button><button class="btn btn--paper is-pressed">${icon("chat")}スペースに聞く</button>`, { ground: "frame" }),
        specItem("ibtn · :hover · :disabled", `<button class="ibtn">${icon("back")}</button><button class="ibtn h">${icon("reload")}</button><button class="ibtn" disabled>${icon("fwd")}</button><button class="ibtn">${icon("sidebar")}</button>`, { ground: "frame" }),
        specItem("dl-btn: idle · running · open", dlButton({}) + dlButton({ progress: 0.4 }) + dlButton({ open: true, progress: 0.4 }), { ground: "frame" }),
        specItem("st-act · --solid · --quiet", `<button class="st-act">${icon("cross", 14)}スペースに共有…</button><button class="st-act st-act--solid">${icon("cross", 14)}新しい版を共有…</button><button class="st-act st-act--quiet">${icon("undo", 14)}取り消す</button>`, { ground: "field" }),
        specItem("ibtn--paper · :hover", `<button class="ibtn ibtn--paper">${icon("more")}</button><button class="ibtn ibtn--paper h">${icon("close")}</button><button class="ibtn ibtn--paper">${icon("folder")}</button>`),
        specItem("key caps", kbd(["kCmd", "K"]) + kbd(["kShift", "kCmd", "S"]) + kbd(["kReturn"]) + kbd(["esc"]) + kbd(["kUp", "kDown"])),
      ]),
  );

  /* 4 ─ fields and choices */
  const fields = specSec(
    "入力と選択",
    "Fields and choices",
    "入力欄の境界は1pxの線、フォーカスは1.5pxの墨。色のふちどりは使いません（色の線は共有の状態だけ）。",
    specRow([
      specItem("input: empty · focus · filled", `<span class="input is-empty">スペースの名前</span><span class="input is-focus">営業<span class="caret"></span></span><span class="input">資金調達 2027</span>`, { cls: "spec-item--col", w: 300 }),
      specItem("input--sm · .is-error", `<span class="input input--sm is-empty">メールアドレス（任意）</span><span class="input input--sm is-error mono">kaikei cloud</span><p class="field-error">${icon("warn", 14)}サイトのアドレスではありません。example.com の形で入力してください。</p>`, { cls: "spec-item--col", w: 300 }),
      specItem("search (ledger filter)", `<div class="search">${icon("search", 14)}<span>題名・人・サイトで絞り込む</span></div>`, { w: 280 }),
      specItem("find: empty · count · no match", findField({}) + findField({ text: "記録", count: "2/4" }) + findField({ text: "議事録", count: "見つかりません", none: true }), { ground: "frame", cls: "spec-item--col" }),
      specItem("check: off · on · :hover · :disabled", check("次回からも同じにする") + check("次回からも同じにする", { on: true }) + check("次回からも同じにする", { cls: "h" }) + `<button class="check" disabled><span class="check-box"></span><span>次回からも同じにする</span></button>`, { cls: "spec-item--col" }),
      specItem("seg--box (choice): chosen · none yet", choice([["system", "システムに合わせる"], ["light", "ライト"], ["dark", "ダーク"]], "system") + choice([["in", "共有する"], ["out", "含めない"]], null) + choice([["in", "共有する"], ["out", "含めない"]], "out"), { cls: "spec-item--col" }),
      specItem("seg (filter)", `<div class="seg"><button class="seg-item is-on">すべて<span>41</span></button><button class="seg-item">自分が共有<span>12</span></button><button class="seg-item">解除済み<span>1</span></button></div>`),
      specItem("viewtabs", `<div class="spec-tabs">${homeTabs("members")}</div>`),
      specItem("swatch · .is-on", `<ul class="swatches">${HUES.slice(0, 4).map(([k, n], i) => `<li><button class="swatch${i === 1 ? " is-on" : ""}" data-space="${k}"><span class="swatch-chip">${i === 1 ? icon("check", 14) : ""}</span><span class="swatch-name">${n}</span></button></li>`).join("")}</ul>`),
      specItem("picker · --static", `<button class="picker">${seal("fund", 28)}<span class="picker-text"><span class="picker-name">資金調達 2027</span><span class="byline">共有41件<i class="sep">・</i>メンバー4人</span></span>${icon("chevDown", 14)}</button><div class="picker picker--static"><span class="who-glyph who-glyph--28">${icon("exportOut")}</span><span class="picker-text"><span class="picker-name">Anthropic</span><span class="byline">Claude Sonnet 5.5 を選択中</span></span></div>`, { cls: "spec-item--col", w: 300 }),
    ]) +
      specRow([
        specItem("composer: empty", composer({}), { w: 400, cls: "spec-item--flush" }),
        specItem("composer: text, attachment chip", composer({ text: Q_ATTACH_TEXT, chip: ATTACH_CHIP }), { w: 400, cls: "spec-item--flush" }),
        specItem("composer: streaming · disabled", composer({ placeholder: "回答を書いています。止めると、ここまでの文章は残ります。", streaming: true }) + composer({ disabled: true, placeholder: "つながると、質問できます" }), { w: 400, cls: "spec-item--flush spec-item--col" }),
      ]),
  );

  /* 5 ─ chips and marks */
  const chips = specSec(
    "チップと印",
    "Chips and marks",
    "引用の番号はスペースの色、添付は破線、解除済みは無彩色に取り消し線。バッジは使いません。",
    specRow([
      specItem("cite · cite--gone · cite--attach", `<span class="spec-voice">4,800億円${cite(1)}、3,150億円${cite(2, { gone: true })}、1,150億円<span class="cite cite--attach">添付</span></span>`),
      specItem("attach-chip (composer)", ATTACH_CHIP),
      specItem("st-attach (capsule)", `<span class="st-attach">${icon("frame", 16)}次の質問に添付<button class="st-x" aria-label="添付をやめる">${icon("close", 12, "", 1.25)}</button></span>`, { ground: "field" }),
      specItem("msg-attach (sent question)", `<p class="msg-attach">${icon("frame")}<span><b>投資家向けピッチ v3</b> を添付<i class="sep">・</i>${PITCH_CHARS}文字<i class="sep">・</i>Anthropic に送信</span></p>`),
      specItem("byline", byline(["Google ドキュメント", "佐伯 遥", "第2版", "今日 12:14"])),
      specItem("tag · mention", `<span class="tag">あなた</span><span class="mention">@Tiger</span>`),
      specItem("url-perm (site asks)", `<span class="url-perm">${icon("mic", 14)}<i></i></span><span class="url-perm">${icon("camera", 14)}<i></i></span><span class="url-perm">${icon("location", 14)}<i></i></span><span class="url-perm">${icon("bell", 14)}<i></i></span><span class="url-perm">${icon("clipboard", 14)}<i></i></span><span class="url-perm">${icon("screen", 14)}<i></i></span>`, { ground: "field" }),
      specItem("url-warn (http)", `<span class="url-warn">${icon("warn", 14)}保護されていない通信</span>`, { ground: "field" }),
      specItem("event (a share, in a thread)", `<div class="event">${icon("cross", 14)}<span>佐伯 遥が「投資家向けピッチ v3」の第2版を共有</span><time>12:14</time></div>`, { w: 400 }),
      specItem("conn (sidebar status)", `<p class="conn">${icon("offline", 14)}<span class="conn-text">再接続しています…</span><span class="conn-note">14:38から</span></p><p class="conn">${icon("check", 14)}<span class="conn-text">接続しました。</span></p>`, { ground: "frame", w: 260, cls: "spec-item--col" }),
    ]),
  );

  /* 6 ─ tab rows */
  const M = { pitch: "fresh", slack: "stale", hireplan: "else:hire", notion: "stale attached", meet: "asks:mic", dilution: "crashed" };
  const tabrows = specSec(
    "タブの行",
    "Tab rows",
    "タブは無彩色のポケットにあり、共有で動きません。行の右端の印は、そのURLの状態です。",
    specRow([
      specItem("tab · .is-hover · .is-active", tabs(["news", "compete", "mizunara"], { hover: "compete", active: "mizunara" }), { w: 244, cls: "spec-item--flush" }),
      specItem("marks: fresh · stale · elsewhere · stale + attached", tabs(["pitch", "slack", "hireplan", "notion"], { marks: M }), { w: 244, cls: "spec-item--flush" }),
      specItem("marks: blocked · audible · site asks · crashed · load error", tabs(["bank", "demo", "meet", "dilution", "dead"], { marks: M }), { w: 244, cls: "spec-item--flush" }),
      specItem("tab--new", `<div class="spec-pocket"><button class="tab tab--new"><span class="tab-ico">${icon("plus")}</span><span class="tab-title">新しいタブ</span>${kbd(["kCmd", "T"])}</button></div>`, { w: 244, cls: "spec-item--flush" }),
      specItem("pin · .is-active · shared here", `<div class="spec-pocket"><ul class="pins">${["gmail", "cal", "slackpin", "notionpin", "codepin", "drive"].map((id) => pinTile(id, { ...S, active: "cal", marks: { notionpin: "fresh" } })).join("")}</ul></div>`, { w: 244, cls: "spec-item--flush" }),
      specItem("rail-tab: active · fresh · stale · elsewhere · blocked", `<div class="spec-pocket spec-pocket--rail"><ul class="rail-tabs">${[["slack", " is-active", `<i class="rail-pip rail-pip--hollow"></i>`], ["pitch", "", `<i class="rail-pip"></i>`], ["plan", "", `<i class="rail-pip rail-pip--hollow"></i>`], ["hireplan", "", `<i class="rail-pip" data-space="green"></i>`], ["bank", "", `<i class="rail-pip rail-pip--lock">${icon("lock", 10, "", 1.25)}</i>`]].map(([id, on, pip]) => `<li><a class="rail-tab${on}" href="#">${favicon(PAGES[id].fav)}${pip}</a></li>`).join("")}</ul></div>`, { cls: "spec-item--flush" }),
    ]),
  );

  /* 7 ─ list rows */
  const bk = (rows, cls = "", head = ["題名と出どころ", "共有した人", "最終共有", "版", ""]) => `<table class="book ${cls}"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
  const lists = specSec(
    "リストの行",
    "List rows",
    "二行の行は44px、一行は28〜36px。出どころは、共有した人・版・日時を「・」でつないだ一行で示します。",
    specRow([
      specItem("item · :hover · .is-current · .is-landing", items(["slack", "pdf", "pitch", "dilution"], { current: "pitch", landing: "dilution", hoverItem: "pdf" }), { ground: "frame", w: 252, cls: "spec-item--flush" }),
      specItem("ledger row · hover (own item) · tombstone", bk(bookRow(ITEMS[1]) + bookRow({ ...ITEMS[5], hover: true }) + bookRow(ITEMS[4])), { w: 760, cls: "spec-item--flush" }),
      specItem("member · hover (owner sees) · invite", bk(memberRow("saeki", "オーナー", "10/20") + memberRow("kashiwagi", "メンバー", "10/27", { hover: true }) + inviteRow({ to: "", sub: ["今日 14:44 に作成", "1人が1回だけ使えます"], by: "佐伯 遥", until: "12/10 まで" }), "book--people", ["メンバー・宛先", "役割・招待した人", "参加した日・期限", ""]), { w: 760, cls: "spec-item--flush" }),
    ]) +
      specRow([
        specItem("source · with quote · source--gone", `<ol class="sources">${sourceRow(1, "pitch", { quote: "TAM｜国内の介護事業所向け業務ソフト｜4,800億円" })}${sourceRow(2, "pdf", { page: "p.9" })}${sourceRow(3, "termsheet", { gone: "11/21 16:30 に佐伯 遥が共有を解除<i class=\"sep\">・</i>引用した文は残っていません" })}</ol>`, { w: 368 }),
        specItem("who (readers and recipients)", `<ul class="whos">${who("saeki", "佐伯 遥", "あなた")}${who("mori", "森 拓海", "メンバー")}${who(seal("ai", 20), "Tiger のサーバー", "保存と検索")}${who(`<span class="who-glyph">${icon("exportOut")}</span>`, "Anthropic・OpenAI", "質問されたとき")}</ul>`, { w: 296 }),
        specItem("ver · .is-on", `<ol class="vers">${`<li class="ver is-on"><span class="ver-n">第2版</span><span class="ver-at">今日 12:14</span><span class="ver-by">佐伯 遥</span><span class="ver-c">464文字</span></li><li class="ver"><span class="ver-n">第1版</span><span class="ver-at">11/24 18:02</span><span class="ver-by">佐伯 遥</span><span class="ver-c">431文字</span></li>`}</ol>`, { w: 336, ground: "quiet", cls: "spec-item--flush" }),
        specItem("dl: progressing · completed (hover) · interrupted · cancelled", `<ul class="dls">${dlRow({ ic: "pdf", name: "国内介護ソフト市場規模_2026.pdf", meta: ["ダウンロード中", "4.2 / 18.6 MB", `<span class="mono">drive.google.com</span>`], state: "progressing", progress: 0.226 })}${dlRow({ ic: "grid", name: "希薄化シミュレーション.xlsx", meta: ["48 KB", "14:22", `<span class="mono">docs.google.com</span>`], hover: true })}${dlRow({ ic: "pdf", name: "kaigo-hoshu-kaitei-gaiyo.pdf", meta: ["中断されました", "11:44", `<span class="mono">www.mhlw.go.jp</span>`], state: "interrupted" })}${dlRow({ ic: "folder", name: "pitch-figures.zip", meta: ["キャンセルしました", "昨日 19:05", `<span class="mono">www.figma.com</span>`], state: "cancelled" })}</ul>`, { w: 368, cls: "spec-item--flush" }),
      ]) +
      specRow([
        specItem(
          "ledger (composer): Space · this page: fresh / can attach / attached / blocked · other tabs",
          `<section class="ledger" style="border-top:0"><header class="ledger-head"><span>この質問でAIが読むもの</span><button class="ibtn ibtn--paper" aria-label="たたむ">${icon("chevDown", 14)}</button></header>
            <button class="ledger-row"><span class="ledger-ico">${seal("fund", 20)}</span><span class="ledger-what"><b>スペースの共有 41件</b></span><span class="ledger-note">4人が共有したページ</span>${icon("chevRight", 14)}</button>
            <div class="ledger-row"><span class="ledger-ico">${icon("frame")}</span><span class="ledger-what">このページ</span><span class="ledger-note">共有済みの内容は最新です</span></div>
            <div class="ledger-row"><span class="ledger-ico">${icon("frame")}</span><span class="ledger-what">このページ</span><span class="ledger-note">添付していません</span><button class="btn btn--sm btn--line">内容を確かめて添付…</button></div>
            <div class="ledger-row ledger-row--attached"><span class="ledger-ico">${icon("frame")}</span><span class="ledger-what"><b>このページを添付</b></span><span class="ledger-note">14:31の内容・この質問だけ</span><button class="btn btn--sm btn--quiet">はずす</button></div>
            <div class="ledger-row ledger-row--off"><span class="ledger-ico">${icon("lock")}</span><span class="ledger-what">このページ</span><span class="ledger-note">金融サービスのページ</span></div>
            <div class="ledger-row ledger-row--off"><span class="ledger-ico">${icon("laptop")}</span><span class="ledger-what">ほかのタブ 7件</span><span class="ledger-note">読めません</span></div></section>`,
          { w: 400, cls: "spec-item--flush" },
        ),
        specItem("ledger--line (folded)", ledger({ open: false, page: { state: "fresh" } }) + ledger({ open: false, page: { state: "attached" } }), { w: 400, cls: "spec-item--flush" }),
        specItem("pal-row · .is-on", `<ul class="spec-pal">${palRow({ ic: favicon("pdf"), title: "国内介護ソフト<mark>市場</mark>規模 2026.pdf", sub: "drive.google.com", trail: `${seal("fund", 16)}<span class="pal-hint">タブに切り替え</span>${kbd(["kReturn"])}`, on: true })}${palRow({ ic: icon("note"), title: "介護ソフト<mark>市場</mark>の区分メモ", by: byline(["柏木", "第2版", "11/14 10:08"]) })}</ul>`, { w: 480, cls: "spec-item--flush" }),
      ]),
  );

  /* 8 ─ the capsule: one state per URL */
  const BY = ["佐伯 遥", "第2版", "今日 12:14"];
  const capsule = specSec(
    "カプセル：ページの状態",
    "The capsule: one state per URL",
    "左はどこにいるか、右は誰が読めるか。状態はURLと版で決まり、タブを移っても、その場で置き換わります。",
    specRow([
      specCapsule("local", { url: PAGES.dilution.url, state: "local" }),
      specCapsule("fresh", { state: "fresh", by: BY }),
      specCapsule("stale", { state: "stale", v: 2 }),
      specCapsule("elsewhere", { url: PAGES.hireplan.url, state: "elsewhere", other: "hire", by: ["森 拓海", "第4版", "昨日 16:05"] }),
      specCapsule("blocked (capture.reason)", { url: PAGES.bank.url, state: "blocked", reason: "banking" }),
      specCapsule("pending", { url: PAGES.news.url, state: "pending" }),
      specCapsule("unknown (index failed): retry", { url: PAGES.news.url, state: "unknown" }),
      specCapsule("done (8 s after a share)", { url: PAGES.dilution.url, state: "done", label: "共有しました", by: ["佐伯 遥", "第1版", "今日 14:36"] }),
      specCapsule("stale + attached", { state: "stale", v: 2, attached: true }),
      specCapsule("no page: load error · crashed", { url: PAGES.dead.url, state: "local", noShare: true, note: "ページがありません" }),
      specCapsule("site asks for a permission", { url: PAGES.meet.url, state: "local", lead: `<span class="url-perm">${icon("mic", 14)}<i></i></span>` }),
      specCapsule("http: not secure", { url: ["", "kotonoha-staging.example", "/admin"], state: "local", insecure: true }),
      specCapsule("focus (typing an address)", { placeholder: "検索、またはアドレスを入力", focus: true, state: "" }),
      specCapsule("Space home and its pages", { internal: ["資金調達 2027", "スペースホーム"], state: "home" }),
    ]),
  );

  /* 9 ─ menus and popovers */
  const menus = specSec(
    "メニューとポップオーバー",
    "Menus and popovers",
    "ページの上に出るものは、すべてオーバーレイの層にあります。不透明で、1pxのふちと影。ぼかしは使いません。",
    specRow([
      specItem(
        "menu: item · :hover · keys · check · :disabled · menu-item--2",
        `<div class="menu" style="width:280px">${menuItem("keep", "スペースホーム", { keys: ["kShift", "kCmd", "H"] })}${menuItem("people", "メンバーと招待", { cls: "is-hover" })}${menuItem("reader", "送った内容を見る", { check: true })}<button class="menu-item" disabled><span class="menu-ico">${icon("uncross")}</span><span class="menu-text"><span>共有を解除…</span></span></button>${menuRule}<button class="menu-item menu-item--2 is-on">${seal("fund", 28)}<span class="menu-text"><span class="menu-name">資金調達 2027</span>${byline(["メンバー4人", "共有41件", "オーナー"])}</span>${icon("check", 14, "menu-check")}</button></div>`,
        { cls: "spec-item--float" },
      ),
      specItem(
        "the menu behind 共有中 (fresh, stale)",
        `<div class="menu" style="width:260px">${menuItem("reader", "共有した内容を見る")}${menuItem("keep", "台帳で見る")}${menuRule}${menuItem("uncross", "共有を解除…")}</div>`,
        { cls: "spec-item--float" },
      ),
      specItem(
        "model rows: .is-on · default · :disabled",
        `<div class="menu menu--models" style="position:static"><header class="model-head"><b>Anthropic</b><span>内容は Anthropic に送られます。</span></header><button class="model-row"><span class="model-check"></span><span class="model-name">Claude Opus 5.5</span><span class="model-tier">最高性能</span></button><button class="model-row is-on"><span class="model-check">${icon("check", 14)}</span><span class="model-name">Claude Sonnet 5.5</span><span class="model-def">既定</span><span class="model-tier">バランス</span></button><header class="model-head is-off"><b>Google</b><span>このサーバーにキーがなく、使えません。</span></header><button class="model-row" disabled><span class="model-check"></span><span class="model-name">Gemini 4 Carbon</span><span class="model-tier">最高性能</span></button><footer class="model-foot"><span>選んだモデルは、次の質問にだけ使います。</span><button class="link">既定を変える…</button></footer></div>`,
        { cls: "spec-item--float" },
      ),
      specItem(
        "pop--google: waiting for the system browser",
        `<section class="pop" style="position:static"><h3>ブラウザで続けてください</h3><p>Google の画面を、いつものブラウザで開きました。許可すると、ここに戻って書き出します。</p><p class="pop-wait"><i></i>Google の応答を待っています…</p><div class="pop-foot pop-foot--split"><span class="grow"></span><div class="foot-btns"><button class="btn btn--sm btn--line">待つのをやめる</button></div></div></section>`,
        { cls: "spec-item--float" },
      ),
      specItem(
        "pop--perm: screen capture (no remember)",
        `<section class="pop pop--perm" style="position:static"><header class="pop-id"><span class="who-glyph who-glyph--28">${icon("screen")}</span><h3><b class="pop-origin">meet.google.com</b><span>画面の共有を求めています</span></h3></header><p>許可すると、共有する画面やウインドウを選ぶ macOS の画面が開きます。毎回たずねます。</p><div class="pop-foot pop-foot--split"><span class="grow"></span><div class="foot-btns"><button class="btn btn--sm btn--line">許可しない</button><button class="btn btn--sm btn--ink">許可</button></div></div></section>`,
        { cls: "spec-item--float" },
      ),
    ]),
  );

  /* 10 ─ notices and the honest states of an answer */
  const notices = specSec(
    "お知らせと、回答の状態",
    "Notices, outcomes, failures",
    "一時的なお知らせはサイドバーの下（Tiger の画素）に出します。ページの上には出しません。失敗は墨で、原因と次の手を書きます。",
    specRow([
      specItem("notice · with action · failure", notice("「導入支援」に参加しました") + notice("ダウンロードしました", { detail: "希薄化シミュレーション.xlsx", action: "開く", ic: "download" }) + notice("招待リンクを読み取れません", { detail: "リンクを確かめてください。", ic: "warn" }), { ground: "frame", w: 260, cls: "spec-item--col" }),
      specItem("outcome: Google · copied · file", exportOutcome() + `<div class="outcome"><div class="outcome-head">${icon("check")}コピーしました</div>${byline(["Markdown", "出典の一覧つき"])}</div><div class="outcome"><div class="outcome-head">${icon("check")}保存しました</div><div class="outcome-row"><span class="outcome-ico">${icon("doc")}</span><span class="outcome-title">TAMを3,150億円に揃えた一文.md</span><button class="btn btn--sm btn--line">フォルダに表示</button></div></div>`, { w: 368, cls: "spec-item--col" }),
      specItem("steps (an answer in progress)", `<ul class="steps"><li>${icon("check", 14)}共有41件から3件を選びました</li><li>${icon("check", 14)}添付の1ページを読みました</li><li class="is-now"><i></i>回答を書いています</li></ul>`, { w: 240 }),
      specItem("halt: stopped · failed · refused", `<div class="halt"><div class="halt-head">${icon("stop")}ここで止めました</div><p>回答を中止しました。続きが必要な場合はもう一度質問してください。</p><div class="halt-actions"><button class="btn btn--sm btn--line">${icon("retry", 14)}もう一度質問</button></div></div><div class="halt"><div class="halt-head">${icon("warn")}回答できませんでした</div><p>AI を今使えません。しばらくしてからお試しください。</p><div class="halt-actions"><button class="btn btn--sm btn--line">${icon("retry", 14)}もう一度質問</button></div></div><div class="halt"><div class="halt-head">${icon("warn")}回答できませんでした</div><p>サーバーの再起動で回答が途中で止まりました。もう一度質問してください。</p><div class="halt-actions"><button class="btn btn--sm btn--line">${icon("retry", 14)}もう一度質問</button></div></div>`, { w: 368, cls: "spec-item--col" }),
      specItem("halt: budget · offline", `<div class="halt"><div class="halt-head">${icon("warn")}回答できませんでした</div><p>このスペースは今月の AI 利用上限に達しました。上限の変更はオーナーに依頼してください。</p><div class="halt-meter"><i style="width:100%"></i></div><div class="halt-row"><span>11月の利用</span><span>2,000,000 / 2,000,000 トークン</span></div></div><div class="halt"><div class="halt-head">${icon("offline")}送れませんでした</div><p>サーバーに接続できません。ネットワークを確認してください。</p><div class="halt-actions"><button class="btn btn--sm btn--line">${icon("retry", 14)}もう一度送る</button></div></div>`, { w: 368, cls: "spec-item--col" }),
    ]),
  );

  /* 11 ─ sheets and dialogs */
  const mdDemo = `<div class="md" style="margin:0"><div class="md-line"><span class="md-no">17</span><span class="md-text">| TAM | 国内の介護事業所向け業務ソフト | 4,800億円 |</span></div><div class="md-line md-line--old"><span class="md-no">第2版</span><span class="md-text">| SAM | 訪問・通所の中小事業所（職員50人未満） | 1,400億円 |</span></div><div class="md-line md-line--diff"><span class="md-no">18</span><span class="md-text">| SAM | 訪問・通所の中小事業所（職員50人未満） | 1,150億円 |</span></div><div class="md-line"><span class="md-no">19</span><span class="md-text">| SOM | 3年で獲得できる範囲 | 38億円 |</span></div></div>`;
  const X = (o) => xchg({ time: "14:41", q: "オプションプールを10%にすると、シード後の持分はどうなりますか。", a: `シード後の持分は、佐伯 遥が${fig("29.6%", "添付", "に")}なります。`, ...o });
  const sheets = specSec(
    "シートとダイアログ",
    "Sheets and dialogs",
    "内容が外へ出るときは、必ず同じシートを通ります。左に送る文章そのもの、右に読める人と送り先。スペースへは実線を、質問ひとつへは破線をまたぎます。",
    specRow([
      specItem("md-line · --old · --diff", mdDemo, { w: 560, cls: "spec-item--flush" }),
      specItem("sheet-side--space (into the Space)", `<aside class="sheet-side sheet-side--space spec-side">${sideList("共有先", `<div class="picker picker--static">${seal("fund", 28)}<span class="picker-text"><span class="picker-name">資金調達 2027</span><span class="byline">共有41件<i class="sep">・</i>メンバー4人</span></span></div>`)}<footer class="sheet-foot"><p class="foot-note">14:36に読み取った内容を、そのまま送ります。</p><div class="foot-btns"><button class="btn btn--line">キャンセル</button><button class="btn btn--space">${icon("cross")}スペースに共有${kbd(["kCmd", "kReturn"])}</button></div></footer></aside>`, { w: 336, cls: "spec-item--flush" }),
      specItem("sheet-side--once (with one question)", `<aside class="sheet-side sheet-side--once spec-side">${sideList("送り先", `<div class="picker picker--static"><span class="who-glyph who-glyph--28">${icon("exportOut")}</span><span class="picker-text"><span class="picker-name">Anthropic</span><span class="byline">Claude Sonnet 5.5 を選択中</span></span></div>`)}<footer class="sheet-foot"><p class="foot-note">14:31に読み取った内容を、そのまま送ります。</p><div class="foot-btns"><button class="btn btn--line">キャンセル</button><button class="btn btn--ink">${icon("frame")}この質問に添付${kbd(["kReturn"])}</button></div></footer></aside>`, { w: 336, cls: "spec-item--flush" }),
    ]) +
      specRow([
        specItem("xchg: in · out", `<div class="xchgs" style="margin:0">${X({ decision: "in" })}${X({ decision: "out" })}</div>`, { w: 620, cls: "spec-item--flush" }),
        specItem("xchg--attached: undecided · in · out", `<div class="xchgs" style="margin:0">${X({ attached: ["希薄化シミュレーション", 478], decision: null })}${X({ attached: ["希薄化シミュレーション", 478], decision: "in" })}${X({ attached: ["希薄化シミュレーション", 478], decision: "out" })}</div>`, { w: 620, cls: "spec-item--flush" }),
      ]) +
      specRow([
        specItem(
          "dialog: an invite that cannot be used (error.invite_expired)",
          `<section class="dialog" style="position:static"><header class="dialog-id"><span class="seal seal--40 seal--plain">${icon("link", 20)}</span><div><h2>この招待は使えません</h2><p class="dialog-by">${byline(["スペースへの招待"])}</p></div></header><p class="dialog-error">${icon("warn")}<span>招待の期限が切れています。オーナーに新しい招待を依頼してください。</span></p><footer class="foot-btns"><button class="btn btn--line">閉じる</button></footer></section>`,
          { cls: "spec-item--float" },
        ),
        specItem(
          "dialog: confirm (remove a member)",
          `<section class="dialog" style="position:static"><h2>柏木 蓮をスペースから外しますか</h2><p class="dialog-by">${seal("fund", 16)}${byline(["資金調達 2027", "メンバー", "10/27 に参加"])}</p><div class="dialog-cols"><section><h3 class="field-label">${icon("trash", 14)}できなくなること</h3><ul class="after"><li>共有41件とスレッドを読むこと</li><li>このスペースに質問すること</li></ul></section><section><h3 class="field-label">${icon("keep", 14)}残るもの</h3><ul class="after"><li>柏木 蓮が共有した6件と、投稿</li><li>記録の「メンバーを外した」</li></ul></section></div><footer class="foot-btns"><button class="btn btn--line">キャンセル</button><button class="btn btn--ink">スペースから外す</button></footer></section>`,
          { cls: "spec-item--float" },
        ),
      ]),
  );

  /* 12 ─ icons */
  const icons = specSec(
    "アイコン",
    "Icons",
    "自前の一式。16pxの格子、線幅1.5px、丸い端。名前は icons.svg の symbol id（i-名前）と同じです。",
    `<ul class="spec-icons">${Object.keys(ICONS)
      .map((k) => `<li>${icon(k)}<span>${k}</span></li>`)
      .join("")}</ul>`,
  );

  return `<div class="specsheet" data-space="amber">
    <header class="spec-top"><h1>Tiger コンポーネント</h1><p>すべての部品と、そのすべての状態。画面と同じ関数から描いています。寸法と色の役割は DESIGN.md、値は tokens.css にあります。</p><p class="spec-meta">2026-11-28<i class="sep">・</i>資金調達 2027（琥珀）で表示</p></header>
    ${edges}${seals}${buttons}${fields}${chips}${capsule}${tabrows}${lists}${menus}${notices}${sheets}${icons}
  </div>`;
}
SCREENS["components"] = componentSheet;
SCREENS["components-dark"] = componentSheet;
