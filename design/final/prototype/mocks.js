/* Mock web pages drawn inside a tab. These stand in for third-party sites:
   neutral rendering, no logos. They are page content, not Tiger UI. */

const PITCH = {
  title: "投資家向けピッチ v3",
  meta: "株式会社コトノハ｜シードラウンド｜2027年3月クローズ予定",
  problem:
    "訪問介護の職員は、勤務時間の23%を記録と転記に使っています。記録は紙と音声メモに散らばり、請求ソフトへは手で入力し直しています。",
  solution:
    "音声と手書きメモから介護記録の下書きをつくり、請求ソフトへ転記します。導入14事業所で、記録時間は1人あたり1日41分減りました。",
  market: [
    ["TAM", "国内の介護事業所向け業務ソフト", "4,800億円"],
    ["SAM", "訪問・通所の中小事業所（職員50人未満）", "1,400億円"],
    ["SOM", "3年で獲得できる範囲", "38億円"],
  ],
  growth: "年成長率は18%と見込んでいます。",
  raise: ["調達額：1.5億円（シード）", "使途：開発60%、導入支援25%、営業15%", "ランウェイ：18か月"],
};

/* edited = the page after two edits that are not in the shared 第2版 */
function mockDoc({ edited = false } = {}) {
  const market = PITCH.market.map((r) => r.slice());
  if (edited) market[1][2] = `<span class="m-edit">1,150億円</span>`;
  const growth = edited ? "年成長率は18%と見込んでいます（自社パイプラインの実績から推計）。" : PITCH.growth;
  const tools = ["100%", "標準テキスト", "Noto Sans JP", "11"]
    .map((t) => `<span class="m-tool m-tool--text">${t}${icon("chevDown", 12)}</span>`)
    .join('<span class="m-tool-sep"></span>');
  return `
  <div class="m-doc">
    <div class="m-doc-head">
      <span class="m-doc-ico">${favicon("gdoc", 26)}</span>
      <div class="m-doc-id">
        <div class="m-doc-title">${PITCH.title}</div>
        <div class="m-doc-menu"><span>ファイル</span><span>編集</span><span>表示</span><span>挿入</span><span>表示形式</span><span>ツール</span><span>ヘルプ</span></div>
      </div>
      <div class="m-doc-right">
        <span class="m-doc-saved">ドライブに保存しました</span>
        <span class="m-doc-share">${icon("lock", 14)}共有</span>
        <span class="m-doc-av">佐</span>
      </div>
    </div>
    <div class="m-doc-tools">
      <span class="m-tool">${icon("undo", 14)}</span><span class="m-tool m-tool--flip">${icon("undo", 14)}</span>
      <span class="m-tool-sep"></span>${tools}<span class="m-tool-sep"></span>
      <span class="m-tool m-tool--glyph"><b>B</b></span><span class="m-tool m-tool--glyph"><i>I</i></span><span class="m-tool m-tool--glyph"><u>U</u></span>
    </div>
    <div class="m-doc-canvas">
      <article class="m-sheet">
        <h1>${PITCH.title}</h1>
        <p class="m-meta">${PITCH.meta}</p>
        <h2>1. 課題</h2>
        <p>${PITCH.problem}</p>
        <h2>2. 解決策</h2>
        <p>${PITCH.solution}</p>
        <h2>3. 市場規模</h2>
        <table>
          <thead><tr><th>区分</th><th>定義</th><th>規模</th></tr></thead>
          <tbody>${market.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td class="num">${r[2]}</td></tr>`).join("")}</tbody>
        </table>
        <p>${growth}</p>
        <h2>4. 調達の概要</h2>
        <ul>${PITCH.raise.map((r) => `<li>${r}</li>`).join("")}</ul>
        <figure class="m-fig">
          <div class="m-bars"><i style="height:62%"></i><i style="height:23%"></i><i style="height:15%"></i></div>
          <figcaption>図1：記録業務にかかる時間の内訳</figcaption>
        </figure>
      </article>
    </div>
  </div>`;
}

/* the exact Markdown produced by packages/extract (extractor google-docs-export@1).
   edited = the page as it is now; otherwise the shared 第2版. */
function pitchMarkdown({ edited = false } = {}) {
  const m = PITCH.market.map((r) => r.slice());
  if (edited) m[1][2] = "1,150億円";
  const growth = edited ? "年成長率は18%と見込んでいます（自社パイプラインの実績から推計）。" : PITCH.growth;
  return [
    `# ${PITCH.title}`,
    ``,
    PITCH.meta,
    ``,
    `## 1. 課題`,
    ``,
    PITCH.problem,
    ``,
    `## 2. 解決策`,
    ``,
    PITCH.solution,
    ``,
    `## 3. 市場規模`,
    ``,
    `| 区分 | 定義 | 規模 |`,
    `| --- | --- | --- |`,
    ...m.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} |`),
    ``,
    growth,
    ``,
    `## 4. 調達の概要`,
    ``,
    ...PITCH.raise.map((r) => `- ${r}`),
    ``,
    `![図1：記録業務にかかる時間の内訳]`,
  ];
}

function mockNews() {
  return `
  <div class="m-news">
    <header class="m-news-bar">
      <span class="m-news-brand">ケア経済ジャーナル</span>
      <nav><span>経営</span><span>制度</span><span>テクノロジー</span><span>人材</span><span class="is-on">調達</span></nav>
      <span class="m-news-login">ログイン</span>
    </header>
    <article class="m-news-body">
      <p class="m-news-kicker">調達｜2026年11月25日 06:00</p>
      <h1>介護テックのシード調達、3年ぶりに増加 記録業務の自動化に資金</h1>
      <p class="m-news-lede">2026年1〜10月に国内の介護テック企業がシード期に調達した額は86億円で、前年の同じ期間を31%上回った。件数は47件。記録や請求の自動化を手がける企業が全体の4割を占めた。</p>
      <figure class="m-news-fig">
        <div class="m-news-chart"><i style="height:58%"><b>2023</b></i><i style="height:44%"><b>2024</b></i><i style="height:52%"><b>2025</b></i><i style="height:76%" class="is-now"><b>2026</b></i></div>
        <figcaption>介護テック企業のシード調達額（各年1〜10月、億円）</figcaption>
      </figure>
      <p>背景には、2027年度の介護報酬改定で記録の電子化に加算がつく見通しがある。訪問介護では職員1人が1日に書く記録が平均11件にのぼり、事業所の6割がいまも紙を併用している。</p>
      <p>投資家の関心は、導入後の継続率に移っている。あるベンチャーキャピタルの担当者は「現場が3か月使い続けるかを最初に見る」と話す。</p>
    </article>
  </div>`;
}

function mockBank() {
  const rows = [
    ["11月25日", "振込 カ)ミナトクラウド", "132,000", "", "18,402,115"],
    ["11月25日", "振込 ヤマシロカイゴサービス(カ", "", "264,000", "18,534,115"],
    ["11月21日", "給与振込 4件", "1,480,000", "", "18,270,115"],
    ["11月20日", "振込 イリヨウホウジン アオバカイ", "", "396,000", "19,750,115"],
    ["11月18日", "口座振替 シャカイホケンリヨウ", "412,380", "", "19,354,115"],
    ["11月14日", "振込 カ)ハルカゼケア", "", "198,000", "19,766,495"],
    ["11月10日", "カード利用 クラウドサーバー", "86,240", "", "19,568,495"],
    ["11月05日", "振込 カ)コトノハ シホンキン", "", "5,000,000", "19,654,735"],
  ];
  return `
  <div class="m-bank">
    <header class="m-bank-bar">
      <span class="m-bank-brand">${favicon("bank", 20)}つばめ銀行<small>ビジネスダイレクト</small></span>
      <nav><span class="is-on">口座照会</span><span>振込・振替</span><span>総合振込</span><span>各種手続き</span></nav>
      <span class="m-bank-user">株式会社コトノハ 佐伯 遥 様｜ログアウト</span>
    </header>
    <div class="m-bank-body">
      <p class="m-bank-warn">つばめ銀行を装ったメールやSMSにご注意ください。当行がメールで暗証番号をおたずねすることはありません。</p>
      <h1>入出金明細</h1>
      <div class="m-bank-acct">
        <div><span>口座</span><b>本店営業部 普通 1048273</b></div>
        <div><span>残高（11月26日 14:20現在）</span><b class="m-bank-bal">18,402,115円</b></div>
        <div><span>照会期間</span><b>2026年11月1日〜11月26日</b></div>
      </div>
      <table>
        <thead><tr><th>日付</th><th>摘要</th><th class="num">お支払い</th><th class="num">お預かり</th><th class="num">残高</th></tr></thead>
        <tbody>${rows
          .map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td class="num">${r[2]}</td><td class="num">${r[3]}</td><td class="num">${r[4]}</td></tr>`)
          .join("")}</tbody>
      </table>
    </div>
  </div>`;
}

function mockNote() {
  const rows = [
    ["バックエンドエンジニア", "2名", "面接中 3名", "森 拓海"],
    ["導入支援", "2名", "12月1日に募集開始", "佐伯 遥"],
    ["デザイナー", "1名", "書類選考 5名", "柏木 蓮"],
  ];
  return `
  <div class="m-note">
    <header class="m-note-bar"><span>コトノハ</span><span class="m-note-sep">/</span><span>採用</span><span class="m-note-sep">/</span><span class="is-on">採用計画 2027</span><span class="m-note-edit">昨日 森 拓海が編集</span></header>
    <article class="m-note-body">
      <h1>採用計画 2027</h1>
      <dl class="m-note-props"><dt>目標</dt><dd>2027年6月までに5名</dd><dt>予算</dt><dd>年3,400万円</dd><dt>更新</dt><dd>2026年11月25日</dd></dl>
      <h2>募集中の職種</h2>
      <table>
        <thead><tr><th>職種</th><th>人数</th><th>状況</th><th>担当</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
      <h2>選考の流れ</h2>
      <ol><li>書類選考（3営業日以内に返信）</li><li>一次面接：職種の担当者と60分</li><li>実技課題：持ち帰り、目安は3時間</li><li>最終面接：創業メンバー2名と90分</li></ol>
      <h2>決めていないこと</h2>
      <ul><li>リモート勤務の比率</li><li>ストックオプションの配分</li></ul>
    </article>
  </div>`;
}


const GRID_ROWS = [
  ["", "調達前", "シード後", "シリーズA後（想定）"],
  ["佐伯 遥", "40.0%", "32.0%", "25.6%"],
  ["森 拓海", "30.0%", "24.0%", "19.2%"],
  ["小野 美咲", "15.0%", "12.0%", "9.6%"],
  ["柏木 蓮", "15.0%", "12.0%", "9.6%"],
  ["オプションプール", "—", "4.0%", "3.2%"],
  ["シード投資家", "—", "16.0%", "12.8%"],
  ["シリーズA投資家", "—", "—", "20.0%"],
  ["合計", "100.0%", "100.0%", "100.0%"],
  ["発行済株式数", "1,000,000", "1,250,000", "1,562,500"],
  ["調達額", "—", "1.5億円", "6.0億円"],
  ["プレマネー評価額", "—", "7.9億円", "24.0億円"],
  ["ポストマネー評価額", "—", "9.4億円", "30.0億円"],
];
function mockGrid() {
  const rows = GRID_ROWS;
  const cols = ["A", "B", "C", "D", "E", "F", "G"];
  return `
  <div class="m-grid">
    <div class="m-doc-head">
      <span class="m-doc-ico">${favicon("gsheet", 26)}</span>
      <div class="m-doc-id">
        <div class="m-doc-title">希薄化シミュレーション</div>
        <div class="m-doc-menu"><span>ファイル</span><span>編集</span><span>表示</span><span>挿入</span><span>表示形式</span><span>データ</span><span>ツール</span></div>
      </div>
      <div class="m-doc-right"><span class="m-doc-saved">ドライブに保存しました</span><span class="m-doc-share">${icon("lock", 14)}共有</span><span class="m-doc-av">佐</span></div>
    </div>
    <div class="m-grid-fx"><b>C2</b><span>=B2*(1-C$6-C$7)</span></div>
    <table>
      <thead><tr><th style="width:44px"></th>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
      <tbody>${rows
        .map(
          (r, i) =>
            `<tr><th>${i + 1}</th>${r.map((c, j) => `<td class="${j ? "num" : ""}${i === 0 || j === 0 ? " is-head" : ""}${i === 1 && j === 2 ? " is-sel" : ""}">${c}</td>`).join("")}<td></td><td></td><td></td></tr>`,
        )
        .join("")}${[14, 15, 16, 17, 18, 19, 20, 21, 22, 23]
        .map((n) => `<tr><th>${n}</th>${cols.map(() => "<td></td>").join("")}</tr>`)
        .join("")}</tbody>
    </table>
    <div class="m-grid-tabs"><span class="is-on">希薄化</span><span>前提</span><span>オプションプール</span></div>
  </div>`;
}

function mockChat() {
  return `
  <div class="m-chat">
    <aside class="m-chat-side">
      <div class="m-chat-team">コトノハ</div>
      <h3>チャンネル</h3>
      <ul><li># general</li><li class="is-on"># fundraising</li><li># product</li><li># hiring</li><li># sales-care</li></ul>
      <h3>ダイレクトメッセージ</h3>
      <ul><li>森 拓海</li><li>小野 美咲</li><li>柏木 蓮</li></ul>
    </aside>
    <section class="m-chat-main">
      <header class="m-chat-bar"># fundraising <small>メンバー4人・シードラウンドの連絡</small></header>
      <div class="m-chat-log">
        <div class="m-chat-msg">${avatar("ono", 28)}<div><b>小野 美咲</b><time>昨日 18:32</time><p>ミズナラ・キャピタルの面談は12/3（木）15:00で確定です。先方は2名、オンラインです。</p></div></div>
        <div class="m-chat-msg">${avatar("mori", 28)}<div><b>森 拓海</b><time>昨日 18:40</time><p>了解です。デモ環境は前日までに請求ソフト連携を入れておきます。</p></div></div>
        <div class="m-chat-new">新着</div>
        <div class="m-chat-msg">${avatar("kashiwagi", 28)}<div><b>柏木 蓮</b><time>今日 13:52</time><p>導入先の継続率、10月末で14事業所中13です。ピッチの数字はこれで更新してください。</p></div></div>
        <div class="m-chat-msg">${avatar("ono", 28)}<div><b>小野 美咲</b><time>今日 14:05</time><p>青葉会さんから参考コメントをもらえました。スレッドに貼ります。</p></div></div>
      </div>
      <div class="m-chat-box">#fundraising へのメッセージ</div>
    </section>
  </div>`;
}


function mockSpec() {
  const rows = [
    ["1回目", "30秒後", "同じ内容で再送"],
    ["2回目", "5分後", "同じ内容で再送"],
    ["3回目", "30分後", "再送し、失敗したら担当者に通知"],
  ];
  return `
  <div class="m-note">
    <header class="m-note-bar"><span>コトノハ</span><span class="m-note-sep">/</span><span>プロダクト</span><span class="m-note-sep">/</span><span class="is-on">請求ソフト連携 仕様</span><span class="m-note-edit">今日 森 拓海が編集</span></header>
    <article class="m-note-body">
      <h1>請求ソフト連携 仕様</h1>
      <dl class="m-note-props"><dt>状態</dt><dd>レビュー中</dd><dt>担当</dt><dd>森 拓海</dd><dt>更新</dt><dd>2026年11月26日</dd></dl>
      <h2>転記の再試行</h2>
      <table>
        <thead><tr><th>回</th><th>待ち時間</th><th>動作</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
      <h2>失敗として扱う条件</h2>
      <ol><li>請求ソフトが5xxを返したとき</li><li>30秒以内に応答がないとき</li><li>利用者番号が請求ソフトに存在しないとき（再試行しない）</li></ol>
      <h2>決めていないこと</h2>
      <ul><li>月末締めの前後だけ、間隔を短くするか</li><li>通知の宛先を事業所ごとに変えられるようにするか</li></ul>
    </article>
  </div>`;
}
