/* Screens. index.html?screen=<id>&theme=light|dark */

const BASE = {
  room: "fund",
  shared: ["notion", "pdf", "slack", "pitch"],
  priv: ["news", "gmail", "bank", "cal"],
  presence: { pitch: "mori", slack: "ono" },
};
/* before 投資家向けピッチ v3 is shared */
const BEFORE = {
  room: "fund",
  shared: ["notion", "pdf", "slack"],
  priv: ["pitch", "news", "gmail", "bank", "cal"],
  presence: { slack: "ono" },
  items: 40,
};

const PITCH_SHARED_BAR = {
  state: "shared",
  host: "docs.google.com",
  leaf: "投資家向けピッチ v3",
  prov: `${icon("cross", 14)}佐伯 遥 · 2時間前 · 第1版<span class="prov-drift">その後の編集2か所は未共有</span>`,
  share: "shared",
};
const PITCH_PRIVATE_BAR = {
  state: "private",
  host: "docs.google.com",
  leaf: "投資家向けピッチ v3",
  share: "can",
};

function models() {
  return `<div class="models" role="radiogroup" aria-label="この質問に使うモデル">
    <button class="model is-on" role="radio" aria-checked="true">Claude</button>
    <button class="model" role="radio" aria-checked="false">GPT</button>
    <button class="model" role="radio" aria-checked="false">Gemini</button>
  </div>`;
}

/* ───────── 02: ask panel ───────── */
function sourceRow(n, title, meta) {
  return `<li><a class="source" href="#">${cite(n)}<span class="source-text"><span class="source-title">${title}</span><span class="source-meta">${meta}</span></span></a></li>`;
}

function askPanel({ streaming = false } = {}) {
  const answer = streaming
    ? `
        <ul class="steps" aria-label="進みぐあい">
          <li>${icon("check", 14)}共有41件から4件を選びました</li>
          <li>${icon("check", 14)}添付されたページを読みました</li>
          <li class="is-now"><i></i>答えを書いています</li>
        </ul>
        <div class="voice">
          <p>食い違いは2か所です。</p>
          <p><b>TAM</b> ― ピッチは${fig("4,800億円", 1, "、")}レポートは<span class="caret"></span></p>
        </div>`
    : `
        <div class="voice">
          <p>食い違いは2か所です。</p>
          <p><b>TAM</b> ― ピッチは${fig("4,800億円", 1, "、")}レポートは${fig("3,150億円", 2, "。")}ピッチは請求代行を含めています。</p>
          <p><b>成長率</b> ― ピッチは${fig("年18%", 1, "、")}レポートは${fig("年平均12.4%", 2, "。")}</p>
          <p>編集中の${fig("SAM 1,150億円", "添付")}は、まだ共有されていません。</p>
        </div>
        <ul class="sources" aria-label="出典">
          ${sourceRow(1, "投資家向けピッチ v3", "Google ドキュメント · 佐伯 遥が共有 · 今日12:14 · 第1版")}
          ${sourceRow(2, "国内介護ソフト市場規模 2026.pdf", "PDF 14ページ · 森 拓海が共有 · 11/23 · p.9")}
        </ul>
        <div class="msg-actions">
          <button class="btn btn--quiet btn--sm">${icon("cross", 14)}スレッドに出す</button>
          <button class="btn btn--quiet btn--sm">${icon("exportOut", 14)}ドキュメントに書き出す</button>
          <button class="btn btn--quiet btn--sm">${icon("copy", 14)}コピー</button>
        </div>`;
  const input = streaming
    ? `<div class="input">
        <div class="input-text input-text--placeholder">続けて質問する</div>
        <div class="input-bar">${models()}<button class="btn btn--inverse btn--sm">${icon("stop", 14)}止める</button></div>
      </div>`
    : `<div class="input is-typing">
        <div class="input-text">では、SAMを主役にした一文を書いて<span class="caret"></span></div>
        <div class="input-bar">${models()}<button class="btn btn--inverse btn--sm">送信${icon("kReturn", 14)}</button></div>
      </div>`;
  return `
  <aside class="card card--panel" aria-label="スペースに聞く">
    <header class="panel-head">
      <h2>スペースに聞く</h2>
      <span class="scope-chip">${seal("fund", 20)}資金調達 2027</span>
      <span class="grow"></span>
      <button class="ibtn ibtn--paper" aria-label="新しい質問">${icon("plus")}</button>
      <button class="ibtn ibtn--paper" aria-label="パネルを閉じる">${icon("close")}</button>
    </header>
    <div class="panel-scope">
      <span class="panel-scope-text">${icon("person", 14)}このチャットは自分だけに見えます</span>
      <button class="link">${icon("cross", 14)}チャットを共有…</button>
    </div>

    <div class="panel-body">
      <div class="msg">
        <div class="msg-meta">${avatar("saeki", 20)}<b>佐伯 遥</b><time>14:31</time><span class="msg-attached">${icon("doc", 14)}今のページを添付</span></div>
        <p class="msg-text">この市場規模、森さんのPDFと食い違うところはある？</p>
      </div>

      <div class="msg msg--ai">
        <div class="msg-meta">${seal("ai", 20)}<b>Tiger</b><span class="msg-model">Claude</span><time>14:31</time></div>
        ${answer}
      </div>
    </div>

    <footer class="composer">
      <div class="ledger" aria-label="この質問でAIが読めるもの">
        <div class="ledger-title">${streaming ? "次の質問でAIが読めるもの" : "この質問でAIが読めるもの"}</div>
        <div class="ledger-row">
          <span class="ledger-ico">${seal("fund", 20)}</span>
          <span class="ledger-text"><b>スペースの共有アイテム41件</b><span>資金調達 2027 · 4人が共有 · このページの第1版を含む</span></span>
          <button class="ibtn ibtn--paper" aria-label="読む範囲を絞る">${icon("chevDown", 14)}</button>
        </div>
        <div class="ledger-row">
          <span class="ledger-ico">${icon("doc")}</span>
          <span class="ledger-text"><b>このページの今の内容</b>${
            streaming
              ? "<span>オフ。質問のたびに選び直します</span>"
              : "<span>第1版のあとの編集2か所を含みます</span><span>今回だけ送り、スペースには残しません</span>"
          }</span>
          <button class="switch${streaming ? "" : " is-on"}" role="switch" aria-checked="${!streaming}" aria-label="このページの今の内容を添付"><i></i></button>
        </div>
        <div class="ledger-row ledger-row--off">
          <span class="ledger-ico">${icon("lock")}</span>
          <span class="ledger-text"><span>自分だけのタブ4件は読めません</span></span>
        </div>
      </div>
      ${input}
    </footer>
  </aside>`;
}

/* ───────── 03: share sheet ───────── */
function mdLine(text, i) {
  let cls = "";
  let html = text;
  if (/^#{1,2} /.test(text)) {
    cls = "md-h";
    html = text.replace(/^(#{1,2}) /, '<span class="md-mark">$1</span> ');
  } else if (/^\|/.test(text)) {
    html = text.replace(/\|/g, '<span class="md-mark">|</span>');
  } else if (/^- /.test(text)) {
    html = text.replace(/^- /, '<span class="md-mark">-</span> ');
  } else if (/^!\[/.test(text)) {
    html = text.replace(/^!\[(.*)\]\(\)/, '<span class="md-mark">![</span>$1<span class="md-mark">]()</span>');
  }
  return `<div class="md-line ${cls}"><span class="md-no">${i + 1}</span><span class="md-text">${html}</span></div>`;
}

function shareSheet() {
  const md = pitchMarkdown();
  const chars = md.join("\n").length;
  const who = [
    ["saeki", "あなた"],
    ["mori", "スペースにいます"],
    ["ono", "スペースにいます"],
    ["kashiwagi", "3時間前"],
  ]
    .map(([id, note]) => `<li>${avatar(id, 24)}<span class="who-name">${PEOPLE[id].name}</span><span class="who-note">${note}</span></li>`)
    .join("");
  return `
  <div class="sheet share" role="dialog" aria-label="スペースに共有" data-room="fund">
    <div class="share-left">
      <header class="share-head">
        <h2>このMacから送る内容</h2>
        <p>Markdown ${md.length}行 · ${chars}文字 · Google ドキュメントのAPIで取得</p>
      </header>
      <div class="md" tabindex="0" aria-label="送信されるMarkdown">
        ${md.map(mdLine).join("")}
      </div>
      <p class="share-omit">${icon("eyeOff", 14)}送らないもの：画像1点の中身、コメント5件、編集履歴。画像は説明文だけを送ります。</p>
    </div>

    <div class="share-right">
      <div class="share-block">
        <div class="field-label">共有先</div>
        <button class="dest">${seal("fund", 28)}<span class="dest-text"><b>資金調達 2027</b><span>共有40件 · メンバー4人</span></span>${icon("chevDown", 14)}</button>
      </div>
      <div class="share-block">
        <div class="field-label">見える人<span class="field-count">4人とAI</span></div>
        <ul class="who">${who}<li>${seal("ai", 24)}<span class="who-name">Tiger</span><span class="who-note">質問されたときに読みます</span></li></ul>
      </div>
      <div class="share-block">
        <div class="field-label">元のページ</div>
        <p class="share-url">docs.google.com/document/d/1mKx7Rf…Qe8</p>
      </div>
      <div class="share-block">
        <div class="field-label">共有したあと</div>
        <ul class="after">
          <li>第1版として保存します。</li>
          <li>ページを編集しても、自動では送りません。更新のときも同じ確認をします。</li>
          <li>いつでも取り消せます。本文・版・検索用データを消し、取り消した記録だけを残します。</li>
        </ul>
      </div>
      <div class="share-actions">
        <button class="btn btn--paper">キャンセル</button>
        <button class="btn btn--room is-focus">${icon("cross")}スペースに共有${kbd(["kCmd", "kReturn"])}</button>
      </div>
    </div>
  </div>`;
}

/* ───────── 04: space home ───────── */
const ITEMS = [
  ["doc", "投資家向けピッチ v3", "docs.google.com", "Google ドキュメント", "saeki", "今日 12:14", "第1版"],
  ["hash", "#fundraising", "kotonoha.slack.com", "Slack", "ono", "昨日 18:40", "第5版"],
  ["pdf", "国内介護ソフト市場規模 2026.pdf", "drive.google.com", "PDF 14ページ", "mori", "11/23 09:02", "第1版"],
  ["note", "面談メモ：ミズナラ・キャピタル", "notion.so/kotonoha", "Notion", "ono", "11/21 17:26", "第2版"],
  ["grid", "希薄化シミュレーション（個人メモ）", "11/21に取り消し · 本文は削除済み", "Google スプレッドシート", "saeki", "11/21 15:48", "—", "tomb"],
  ["note", "資本政策メモ", "notion.so/kotonoha", "Notion", "saeki", "11/20 10:15", "第2版"],
  ["grid", "月次KPI 2026年10月", "docs.google.com", "Google スプレッドシート", "mori", "11/18 19:31", "第4版"],
  ["doc", "競合比較表", "docs.google.com", "Google ドキュメント", "kashiwagi", "11/15 13:07", "第2版"],
  ["pdf", "介護報酬改定の概要.pdf", "mhlw.go.jp", "PDF 32ページ", "kashiwagi", "11/12 11:44", "第1版"],
  ["grid", "投資家リスト 2027", "docs.google.com", "Google スプレッドシート", "ono", "11/10 16:20", "第7版"],
  ["note", "インタビュー記録：訪問介護6事業所", "notion.so/kotonoha", "Notion", "kashiwagi", "11/06 14:52", "第1版"],
  ["doc", "シード調達スケジュール", "docs.google.com", "Google ドキュメント", "saeki", "11/04 09:30", "第3版"],
  ["hash", "#investor-updates", "kotonoha.slack.com", "Slack", "ono", "11/02 18:05", "第3版"],
  ["note", "想定問答：シードラウンド", "notion.so/kotonoha", "Notion", "mori", "10/28 20:40", "第6版"],
  ["doc", "事業計画 2027–2029", "docs.google.com", "Google ドキュメント", "saeki", "10/27 09:15", "第2版"],
];

function auditRow(r) {
  const [ic, title, url, app, who, when, ver, kind] = r;
  const tomb = kind === "tomb";
  const mine = PEOPLE[who].me;
  const action = tomb
    ? `<span class="audit-tomb">記録のみ</span>`
    : mine
      ? `<button class="btn btn--quiet btn--sm">${icon("uncross", 14)}共有をやめる</button>`
      : `<button class="ibtn ibtn--paper" aria-label="${title}の操作">${icon("more")}</button>`;
  return `<tr class="${tomb ? "is-tomb" : ""}">
    <td class="audit-title"><span class="audit-cell"><span class="audit-ico">${icon(ic)}</span><span class="audit-name"><span class="audit-name-1">${title}</span><span class="audit-name-2">${url}</span></span></span></td>
    <td class="audit-app">${app}</td>
    <td class="audit-who"><span class="audit-cell">${avatar(who, 20)}<span>${PEOPLE[who].name}</span></span></td>
    <td class="audit-when">${when}</td>
    <td class="audit-ver">${ver}</td>
    <td class="audit-act">${action}</td>
  </tr>`;
}

function threadMsg(who, time, html) {
  return `<div class="tmsg">${avatar(who, 28)}<div class="tmsg-body"><div class="tmsg-meta"><b>${PEOPLE[who].name}</b><time>${time}</time></div><p class="msg-text">${html}</p></div></div>`;
}

function spaceHome() {
  return `
  <section class="card card--page is-shared home" aria-label="資金調達 2027">
    <div class="home-items">
      <header class="home-head">
        ${seal("fund", 40)}
        <div class="home-id">
          <h1>資金調達 2027</h1>
          <p>このスペースの中身は、メンバー4人とAIに見えます。</p>
        </div>
        <div class="home-members">
          <span class="home-avs">${avatar("saeki", 24)}${avatar("mori", 24)}${avatar("ono", 24)}${avatar("kashiwagi", 24, "av--away")}</span>
          <button class="btn btn--quiet">${icon("plus")}招待</button>
        </div>
      </header>
      <div class="home-bar">
        <h2>共有アイテム</h2>
        <div class="seg" role="tablist">
          <button class="seg-item is-on" role="tab" aria-selected="true">すべて<span>41</span></button>
          <button class="seg-item" role="tab">自分が共有<span>12</span></button>
          <button class="seg-item" role="tab">取り消し済み<span>1</span></button>
        </div>
        <span class="grow"></span>
        <span class="home-search">${icon("search", 14)}タイトル・人・アプリで絞り込む</span>
      </div>
      <div class="audit-wrap">
        <table class="audit">
          <thead><tr><th>タイトルと元のサイト</th><th>元アプリ</th><th>共有した人</th><th>共有日時</th><th>版</th><th><span class="sr">操作</span></th></tr></thead>
          <tbody>${ITEMS.map(auditRow).join("")}</tbody>
        </table>
      </div>
    </div>

    <aside class="home-thread" aria-label="スレッド">
      <header class="panel-head">
        <h2>スレッド</h2>
        <span class="thread-scope">${icon("people", 14)}4人全員に見えます</span>
      </header>
      <div class="panel-body thread-body">
        <div class="thread-day"><span>今日 11月26日（木）</span></div>
        ${threadMsg("mori", "10:12", "市場規模レポートを読み終えました。p.9の市場の定義が、ピッチと違っています。")}
        ${threadMsg("ono", "10:20", "ミズナラ・キャピタルの面談は12/3（木）15:00で確定です。")}
        <div class="thread-event">${icon("cross", 14)}<span>佐伯 遥が「投資家向けピッチ v3」を共有</span><time>12:14</time></div>
        ${threadMsg("saeki", "12:16", `<span class="mention">@Tiger</span> ピッチとレポートの食い違いを挙げて。`)}
        <div class="tmsg tmsg--ai">${seal("ai", 28)}<div class="tmsg-body">
          <div class="tmsg-meta"><b>Tiger</b><span class="msg-model">Claude</span><time>12:16</time></div>
          <div class="voice">
            <p>食い違いは2か所です。</p>
            <p><b>TAM</b> ― ピッチは${fig("4,800億円", 1, "、")}レポートは${fig("3,150億円", 2, "。")}</p>
            <p><b>成長率</b> ― ピッチは${fig("年18%", 1, "、")}レポートは${fig("年平均12.4%", 2, "。")}</p>
          </div>
          <ul class="sources" aria-label="出典">
            ${sourceRow(1, "投資家向けピッチ v3", "Google ドキュメント · 佐伯 遥が共有 · 今日12:14 · 第1版")}
            ${sourceRow(2, "国内介護ソフト市場規模 2026.pdf", "PDF · 森 拓海が共有 · 11/23 · p.9")}
          </ul>
        </div></div>
        ${threadMsg("mori", "12:31", "TAMは請求代行を外した3,150億円に揃えましょう。市場規模の節は僕が直します。")}
      </div>
      <footer class="composer">
        <div class="ledger ledger--line">
          <span class="ledger-ico">${seal("fund", 20)}</span>
          <span class="ledger-text"><span>Tigerが読むのは、共有41件とこのスレッドだけです</span></span>
        </div>
        <div class="input">
          <div class="input-text input-text--placeholder">メッセージを書く。@Tiger でAIに質問</div>
          <div class="input-bar">${models()}<button class="btn btn--inverse btn--sm">送信${icon("kReturn", 14)}</button></div>
        </div>
      </footer>
    </aside>
  </section>`;
}

/* ───────── 05: blocked page, private window ───────── */
function blockedSill() {
  return `<div class="sill">${icon("lock")}<p><b>このページは共有できません。</b>銀行のページは保護リストにあり、スペースへの共有もAIへの添付もできません。内容がこのMacから出ることはありません。</p><a class="link" href="#">保護リストを見る</a></div>`;
}

function incognitoWindow() {
  const sb = `
  <aside class="sidebar">
    <div class="sb-top">${lights()}<button class="ibtn" aria-label="サイドバーを隠す">${icon("sidebar")}</button></div>
    <div class="space-head space-head--static">
      <span class="seal seal--28 seal--plain">${icon("glasses", 16)}</span>
      <span class="space-head-text"><span class="space-name">プライベート</span><span class="space-sub">スペースなし · 履歴なし</span></span>
    </div>
    <section class="pocket pocket--only" aria-label="このウィンドウのタブ">
      <header class="zone-head"><span class="zone-label">${icon("lock", 14)}このウィンドウだけ</span></header>
      <ul class="tabs">
        <li><a class="tab is-active" href="#" aria-current="page"><span class="tab-ico">${icon("glasses")}</span><span class="tab-title">新しいタブ</span></a></li>
        <li><a class="tab" href="#"><span class="tab-ico">${icon("search")}</span><span class="tab-title">住宅ローン 借り換え 比較</span></a></li>
      </ul>
      <button class="tab tab--new"><span class="tab-ico">${icon("plus")}</span><span class="tab-title">新しいタブ</span>${kbd(["kCmd", "T"])}</button>
    </section>
  </aside>`;
  const tb = toolbar({ state: "incognito", placeholder: "検索またはURLを入力", ask: false, noHistory: true });
  const page = `
  <div class="ntp">
    <h1>プライベートウィンドウ</h1>
    <p class="ntp-lede">このウィンドウで開いたページは、どのスペースにも共有できず、AIにも添付できません。</p>
    <ul class="ntp-list">
      <li>${icon("lock")}<span><b>「スペースに共有」と「スペースに聞く」はありません。</b>枠に色がないのは、どのスペースにも属していないからです。</span></li>
      <li>${icon("clock")}<span><b>閉じると消えます。</b>履歴、Cookie、ログイン状態を残しません。</span></li>
      <li>${icon("info")}<span><b>見えなくなるわけではありません。</b>訪問先のサイトや回線の管理者には、通信が見えることがあります。</span></li>
    </ul>
  </div>`;
  return windowShell({
    room: "incognito",
    cls: "window--small",
    style: "left:604px;top:330px;--win-w:812px;--win-h:540px;",
    sidebarHtml: sb,
    toolbarHtml: tb,
    stageHtml: pageCard(page),
  });
}

/* ───────── 06: first run ───────── */
function setupPage() {
  const hues = [
    ["fund", "柿"],
    ["ochre", "黄土"],
    ["hire", "若竹"],
    ["sky", "空"],
    ["product", "藍"],
    ["plum", "梅"],
  ];
  return `
  <div class="setup">
    <div class="setup-main">
      <p class="setup-meta">サインイン済み · haruka@kotonoha.jp</p>
      <h1>最初のスペースをつくる</h1>
      <p class="setup-lede">スペースは、プロジェクトごとの部屋です。あなたが共有したページだけが入り、AIはその中身をもとに答えます。</p>

      <div class="field">
        <label class="field-label" for="space-name">名前</label>
        <div class="field-input is-typing" id="space-name">資金調達 2027<span class="caret"></span></div>
      </div>

      <div class="field">
        <span class="field-label">色</span>
        <div class="swatches" role="radiogroup" aria-label="スペースの色">
          ${hues.map(([r, n], i) => `<button class="swatch${i === 0 ? " is-on" : ""}" data-room="${r}" role="radio" aria-checked="${i === 0}"><i></i>${n}</button>`).join("")}
        </div>
        <p class="field-help">ウィンドウの枠がこの色になり、いまどのスペースにいるかが分かります。</p>
      </div>

      <div class="field">
        <label class="field-label" for="space-invite">メンバー<span class="field-opt">あとからでも招待できます</span></label>
        <div class="field-input field-input--placeholder" id="space-invite">メールアドレス（複数はカンマで区切る）</div>
        <p class="field-help">ひとりでも使えます。その場合、共有したページを読めるのはあなたとAIだけです。</p>
      </div>

      <div class="setup-actions">
        <button class="btn btn--room btn--lg">ひとりで始める</button>
        <button class="btn btn--quiet btn--lg">招待して始める</button>
      </div>
    </div>

    <div class="setup-aside">
      <h2>はじめに知っておくこと</h2>
      <ul class="promises">
        <li>${icon("person")}<div><b>開いたページは、まず自分だけ</b><p>共有するまで、ページの内容はこのMacから出ません。</p></div></li>
        <li>${icon("cross")}<div><b>共有は1ページずつ、中身を見てから</b><p>送られる文章と、見える人を確かめてから共有します。あとで取り消せます。</p></div></li>
        <li>${icon("chat")}<div><b>AIが読むのは、共有したものだけ</b><p>Claude・GPT・Geminiのどれに聞いても、同じスペースの中身をもとに答えます。</p></div></li>
        <li>${icon("lock")}<div><b>銀行とメールは共有できません</b><p>銀行、メール本文、パスワード管理のページは、はじめから対象外です。</p></div></li>
      </ul>
    </div>
  </div>`;
}

/* ───────── 08: palette ───────── */
function palRow({ ic, sealRoom, main, sub = "", tag = "", keys = null, selected = false }) {
  const lead = sealRoom ? seal(sealRoom, 20) : icon(ic);
  const tagHtml = tag === "shared" ? `<span class="tag tag--shared">共有中</span>` : tag === "private" ? `<span class="tag">自分だけ</span>` : "";
  return `<a class="pal-row${selected ? " is-selected" : ""}" href="#" ${selected ? 'aria-selected="true"' : ""}><span class="pal-lead">${lead}</span><span class="pal-main">${main}</span><span class="pal-sub">${sub}</span>${tagHtml}${keys ? kbd(keys) : ""}</a>`;
}

function palette() {
  return `
  <div class="sheet palette" role="dialog" aria-label="アドレスとコマンド" data-room="fund">
    <div class="pal-input">
      ${icon("globe")}
      <span class="pal-url"><mark>https://care-keizai.jp/articles/2026/11/25/seed-funding-recovery</mark></span>
      <kbd class="key key--word">esc</kbd>
    </div>
    <div class="pal-list">
      <div class="pal-label">このタブ</div>
      ${palRow({ ic: "cross", main: "スペースに共有…", sub: "送る内容を確かめてから。資金調達 2027の4人とAIに見えます", keys: ["kCmd", "kShift", "S"], selected: true })}
      ${palRow({ ic: "chat", main: "このページについてスペースに聞く", sub: "この質問にだけ添付", keys: ["kCmd", "J"] })}
      <div class="pal-label">開く</div>
      ${palRow({ ic: "doc", main: "投資家向けピッチ v3", sub: "docs.google.com", tag: "shared" })}
      ${palRow({ ic: "pdf", main: "国内介護ソフト市場規模 2026.pdf", sub: "drive.google.com", tag: "shared" })}
      ${palRow({ ic: "calendar", main: "カレンダー — 2026年11月", sub: "calendar.google.com", tag: "private" })}
      ${palRow({ ic: "search", main: "「介護テック シード 調達」を検索", sub: "Google" })}
      <div class="pal-label">スペースを切り替え</div>
      ${palRow({ sealRoom: "hire", main: "採用", sub: "共有18件 · メンバー3人", keys: ["kCtrl", "2"] })}
      ${palRow({ sealRoom: "product", main: "プロダクト", sub: "共有27件 · メンバー4人", keys: ["kCtrl", "3"] })}
    </div>
    <footer class="pal-foot">
      <span>${kbd(["kUp", "kDown"])}選ぶ</span><span>${kbd(["kReturn"])}実行</span><span>${kbd(["kCmd", "kReturn"])}新しいタブで開く</span>
      <span class="grow"></span><span>文字を打つと、URL・検索・スペースへの質問になります</span>
    </footer>
  </div>`;
}

function toast() {
  return `<div class="toast" role="status">${icon("check")}<span>「投資家向けピッチ v3」を資金調達 2027に共有しました</span><button class="toast-undo">取り消す${kbd(["kCmd", "Z"])}</button></div>`;
}

/* ───────── screens ───────── */
const SCREENS = {
  "01-browse": () =>
    windowShell({
      room: "fund",
      sidebarHtml: sidebar({ ...BASE, active: "pitch" }),
      toolbarHtml: toolbar(PITCH_SHARED_BAR),
      stageHtml: pageCard(mockDoc(), { shared: true }),
    }),

  "02-sidepanel-chat": () =>
    windowShell({
      room: "fund",
      sidebarHtml: sidebar({ ...BASE, active: "pitch" }),
      toolbarHtml: toolbar({ ...PITCH_SHARED_BAR, panel: true }),
      stageHtml: pageCard(mockDoc(), { shared: true }) + askPanel(),
    }),

  "02b-sidepanel-streaming": () =>
    windowShell({
      room: "fund",
      sidebarHtml: sidebar({ ...BASE, active: "pitch" }),
      toolbarHtml: toolbar({ ...PITCH_SHARED_BAR, panel: true }),
      stageHtml: pageCard(mockDoc(), { shared: true }) + askPanel({ streaming: true }),
    }),

  "03-share-preview": () =>
    windowShell({
      room: "fund",
      sidebarHtml: sidebar({ ...BEFORE, active: "pitch" }),
      toolbarHtml: toolbar({ ...PITCH_PRIVATE_BAR, sharePressed: true }),
      stageHtml: pageCard(mockDoc({ edited: false })),
    }) + `<div class="overlay overlay--stage">${shareSheet()}</div>`,

  "04-space-home": () =>
    windowShell({
      room: "fund",
      sidebarHtml: sidebar({ ...BASE, active: null, home: true }),
      toolbarHtml: toolbar({ state: "shared", stateText: "4人に見える", host: "資金調達 2027", leaf: "スペースホーム", ask: false }),
      stageHtml: spaceHome(),
    }),

  "05-blocked-private": () =>
    windowShell({
      room: "fund",
      sidebarHtml: sidebar({ ...BASE, active: "bank", inactive: true }),
      toolbarHtml: toolbar({ state: "blocked", stateText: "共有不可 · 銀行", host: "biz.tsubamebank.co.jp", leaf: "入出金明細", share: "blocked" }),
      stageHtml: pageCard(mockBank(), { sill: blockedSill() }),
    }) + `<div class="overlay">${incognitoWindow()}</div>`,

  "06-first-run": () =>
    windowShell({
      room: "fund",
      sidebarHtml: sidebar({ room: "fund", shared: [], priv: ["welcome"], active: "welcome", solo: true, members: 1, items: 0, rooms: ["fund"] }),
      toolbarHtml: toolbar({ state: "private", host: "Tiger", leaf: "はじめに", ask: false, noHistory: true }),
      stageHtml: pageCard(setupPage()),
    }),

  "08-command": () =>
    windowShell({
      room: "fund",
      sidebarHtml: sidebar({ ...BASE, active: "news" }),
      toolbarHtml: toolbar({ state: "private", host: "care-keizai.jp", leaf: "介護テックのシード調達、3年ぶりに増加 記録業務の自動化に資金", share: "can" }),
      stageHtml: pageCard(mockNews()),
    }) + `<div class="overlay">${palette()}</div>`,

  /* signature: a tab crosses the threshold */
  "09-signature-a": () =>
    windowShell({
      room: "fund",
      sidebarHtml: sidebar({ ...BEFORE, active: "pitch" }),
      toolbarHtml: toolbar(PITCH_PRIVATE_BAR),
      stageHtml: pageCard(mockDoc({ edited: false })),
    }),
  "09-signature-b": () =>
    windowShell({
      room: "fund",
      sidebarHtml: sidebar({ ...BEFORE, priv: ["news", "gmail", "bank", "cal"], active: null, flying: "pitch", slot: true, ghost: true }),
      toolbarHtml: toolbar({ ...PITCH_PRIVATE_BAR, state: "shared", share: "shared" }),
      stageHtml: pageCard(mockDoc({ edited: false }), { ringClip: "56%" }),
    }),
  "09-signature-c": () =>
    windowShell({
      room: "fund",
      sidebarHtml: sidebar({ ...BASE, presence: { slack: "ono" }, active: "pitch" }),
      toolbarHtml: toolbar({ ...PITCH_SHARED_BAR, prov: `${icon("cross", 14)}佐伯 遥 · たったいま · 第1版` }),
      stageHtml: pageCard(mockDoc({ edited: false }), { shared: true }),
    }) + `<div class="overlay overlay--stage">${toast()}</div>`,
};
/* a second room, to show that the frame is the Space indicator */
SCREENS["10-room-hire"] = () =>
  windowShell({
    room: "hire",
    sidebarHtml: sidebar({
      room: "hire",
      shared: ["hireplan", "jd", "hireslack"],
      priv: ["memo", "cal"],
      active: "hireplan",
      presence: { hireplan: "kashiwagi" },
      who: ["mori", "kashiwagi"],
      rooms: ["fund", "hire", "product"],
    }),
    toolbarHtml: toolbar({
      state: "shared",
      stateText: "共有中 · 3人",
      host: "notion.so",
      leaf: "採用計画 2027",
      prov: `${icon("cross", 14)}森 拓海 · 昨日 · 第4版`,
      share: "shared",
    }),
    stageHtml: pageCard(mockNote(), { shared: true }),
  });

SCREENS["07-dark"] = SCREENS["04-space-home"];
SCREENS["07b-dark-sidepanel"] = SCREENS["02-sidepanel-chat"];

const DARK = new Set(["07-dark", "07b-dark-sidepanel"]);

(function boot() {
  const q = new URLSearchParams(location.search);
  const id = q.get("screen");
  const root = document.getElementById("root");
  const theme = q.get("theme") || (DARK.has(id) ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  if (!id || !SCREENS[id]) {
    root.innerHTML = `<nav class="index"><h1>Tiger — Rooms</h1><ul>${Object.keys(SCREENS)
      .map((k) => `<li><a href="?screen=${k}">${k}</a></li>`)
      .join("")}</ul></nav>`;
    return;
  }
  document.title = `Tiger Rooms — ${id}`;
  root.innerHTML = SCREENS[id]();

  /* place the tab that is in flight so it straddles the threshold:
     most of it over the shared zone, its lower edge still over the pocket */
  const fly = document.getElementById("flying");
  if (fly) {
    const sb = fly.parentElement.getBoundingClientRect();
    const pocket = document.querySelector(".pocket").getBoundingClientRect();
    fly.style.top = `${Math.round(pocket.top - sb.top - fly.offsetHeight * 0.8)}px`;
  }
})();
