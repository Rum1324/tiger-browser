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

/* edited = the state two hours after sharing: two edits that are not in 第1版 */
function mockDoc({ edited = true } = {}) {
  const market = PITCH.market.map((r) => r.slice());
  if (edited) market[1][2] = "1,150億円";
  const growth = edited ? "年成長率は18%と見込んでいます（自社パイプラインの実績から推計）。" : PITCH.growth;
  const tools = ["100%", "標準テキスト", "Noto Sans JP", "11"]
    .map((t) => `<span class="m-tool m-tool--text">${t}${icon("chevDown", 12)}</span>`)
    .join('<span class="m-tool-sep"></span>');
  return `
  <div class="m-doc">
    <div class="m-doc-head">
      <span class="m-doc-ico">${icon("doc", 22)}</span>
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

/* the exact Markdown produced by packages/extract for 第1版 (before the two edits) */
function pitchMarkdown() {
  const m = PITCH.market;
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
    PITCH.growth,
    ``,
    `## 4. 調達の概要`,
    ``,
    ...PITCH.raise.map((r) => `- ${r}`),
    ``,
    `![図1：記録業務にかかる時間の内訳]()`,
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
      <span class="m-bank-brand">${icon("bank", 18)}つばめ銀行<small>ビジネスダイレクト</small></span>
      <nav><span class="is-on">口座照会</span><span>振込・振替</span><span>総合振込</span><span>各種手続き</span></nav>
      <span class="m-bank-user">株式会社コトノハ 佐伯 遥 様｜ログアウト</span>
    </header>
    <div class="m-bank-body">
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
