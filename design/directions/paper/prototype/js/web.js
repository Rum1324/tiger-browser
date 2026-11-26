/*
 * Web content mocks: what a WebContentsView would paint inside the page rectangle.
 * Drawn in neutral greys with generic glyphs. These are not Tiger UI and use none of its marks.
 */
;(() => {
  const D = window.DATA
  const I = window.icon

  /* A Google-Docs-like editor. `v3` shows the unshared edit that becomes 第3版. */
  function docs({ v3 = false } = {}) {
    const p = D.pitch
    const body = p.sections
      .map((s) => {
        let inner = ''
        if (s.p) inner = `<p>${s.p}</p>`
        if (s.table)
          inner = `<table>${s.table
            .map((r, i) => `<tr>${r.map((c) => (i === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join('')}</tr>`)
            .join('')}</table>`
        if (s.list)
          inner = `<ul>${s.list
            .filter((l) => v3 || !l.v3 || l.v3 === '変更')
            .map((l) => `<li>${v3 && l.t3 ? l.t3 : l.t}</li>`)
            .join('')}</ul>`
        return `<h2>${s.h}</h2>${inner}`
      })
      .join('')

    const tools = [28, 28, 28, 0, 56, 0, 92, 0, 40, 0, 20, 20, 20, 20, 0, 20, 20, 20, 0, 20, 20]
      .map((w) => (w ? `<i style="width:${w}px"></i>` : '<b></b>'))
      .join('')

    return `
<div class="web web-docs">
  <header class="wd-head">
    <span class="wd-logo">${I('doc')}</span>
    <div class="wd-titles">
      <div class="wd-title">${p.title}<span class="wd-saved">ドライブに保存しました</span></div>
      <nav class="wd-menu"><span>ファイル</span><span>編集</span><span>表示</span><span>挿入</span><span>表示形式</span><span>ツール</span><span>拡張機能</span><span>ヘルプ</span></nav>
    </div>
    <div class="wd-right"><span class="wd-ghost">コメント</span><span class="wd-solid">共有</span><span class="wd-avatar"></span></div>
  </header>
  <div class="wd-tools">${tools}</div>
  <div class="wd-canvas">
    <article class="wd-page">
      <h1>${p.title}</h1>
      <p class="wd-meta">${p.meta}</p>
      ${body}
    </article>
  </div>
</div>`
  }

  /* A trade-news article. */
  function news() {
    return `
<div class="web web-news">
  <header class="wn-head">
    <span class="wn-brand">介護経営ジャーナル</span>
    <nav><span>経営</span><span>制度・報酬</span><span>人材</span><span>テクノロジー</span><span>資金調達</span></nav>
    <span class="wn-login">ログイン</span>
  </header>
  <article class="wn-article">
    <p class="wn-kicker">資金調達　2026年11月25日 07:00</p>
    <h1>介護テックの資金調達、7〜9月は12%増　記録と請求の自動化に集中</h1>
    <p class="wn-lead">国内の介護テック企業による2026年7〜9月の資金調達額は、前年同期比12%増の148億円だった。件数は31件で横ばい。1件あたりの調達額が大きくなっている。</p>
    <div class="wn-figure"><div class="wn-bars"><i style="height:46%"></i><i style="height:52%"></i><i style="height:49%"></i><i style="height:61%"></i><i style="height:58%"></i><i style="height:74%"></i><i style="height:70%"></i><i style="height:83%"></i></div><p>介護テックの四半期別調達額（2024年10〜12月期から2026年7〜9月期）</p></div>
    <p>資金が集まったのは、介護記録の作成と介護報酬の請求を自動化する領域だ。調達額の上位10件のうち6件を占めた。訪問介護では記録に1日1時間以上を費やす事業所が多く、人手不足のなかで削減効果を説明しやすい。</p>
    <h2>シードは1〜2億円が中心</h2>
    <p>シードラウンドの中央値は1.4億円で、1年前の0.9億円から上がった。投資家は導入事業所数よりも、月次解約率と記録時間の削減幅を重視しているという。</p>
    <p>一方で、シリーズAに進めた企業は前年の9社から6社に減った。既存の介護ソフトとの連携が、導入を広げる条件になっている。</p>
  </article>
</div>`
  }

  /* An internet-banking account page. Amounts are masked the way such pages mask them. */
  function bank() {
    const rows = [
      ['11月25日', '振込　カ）ヒバリ', '入金'],
      ['11月25日', 'クラウドサービス利用料', '出金'],
      ['11月20日', '給与振込', '出金'],
      ['11月18日', '振込　シヤ）ツバキカイ', '入金'],
      ['11月15日', '社会保険料', '出金'],
      ['11月10日', 'オフィス賃料', '出金'],
    ]
    return `
<div class="web web-bank">
  <header class="wb-head">
    <span class="wb-brand">${I('bank')}つばめ銀行<small>法人インターネットバンキング</small></span>
    <span class="wb-user">Hibari 株式会社　早瀬 湊 様<span>ログアウト</span></span>
  </header>
  <nav class="wb-nav"><span class="on">口座一覧</span><span>振込・振替</span><span>入出金明細</span><span>各種手続き</span></nav>
  <main class="wb-main">
    <h1>口座一覧</h1>
    <div class="wb-accts">
      <div><p>普通預金　本店営業部　•••• 4471</p><b>¥ ••,•••,•••</b><span>残高を表示</span></div>
      <div><p>定期預金　本店営業部　•••• 9026</p><b>¥ •,•••,•••</b><span>残高を表示</span></div>
    </div>
    <h2>最近の入出金（普通預金 •••• 4471）</h2>
    <table>
      <tr><th>日付</th><th>摘要</th><th>区分</th><th class="num">金額</th></tr>
      ${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td class="num">¥ •••,•••</td></tr>`).join('')}
    </table>
  </main>
</div>`
  }

  window.WEB = { docs, news, bank }
})()
