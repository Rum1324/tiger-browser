/* Stand-ins for third-party pages. Neutral rendering: no logos, no brand colours.
   They are web content, so they keep their own light styling in a dark window. */

/* tiny toolbar pictograms for the document editor mock: rows of text lines */
function lines(widths, x = 3, bullets = false) {
  const step = 10 / Math.max(widths.length - 1, 1);
  const d = widths.map((w, i) => {
    const y = (3 + i * step).toFixed(2);
    return (bullets ? `M3 ${y}h.01` : '') + `M${bullets ? 6 : x} ${y}h${bullets ? w : w}`;
  }).join('');
  return `<svg class="ic" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="${d}"/></svg>`;
}

function webDocs() {
  const tools = ['100%', '標準テキスト', 'Noto Sans', '11'];
  return `
  <div class="web gd" lang="ja">
    <div class="gd-head">
      <span class="gd-mark">${icon('doc', 18)}</span>
      <div class="gd-titles">
        <div class="gd-title">投資家向けピッチ v3</div>
        <div class="gd-menu"><span>ファイル</span><span>編集</span><span>表示</span><span>挿入</span><span>表示形式</span><span>ツール</span><span>ヘルプ</span></div>
      </div>
      <span class="gd-saved">ドライブに保存しました</span>
      <span class="gd-share">${icon('lock', 14)}共有</span>
      <span class="gd-me">三</span>
    </div>
    <div class="gd-tools">
      <span class="gd-tool gd-tool--ic">${icon('search', 14)}</span>
      <span class="gd-tool gd-tool--ic">${icon('undo', 14)}</span>
      <span class="gd-tool gd-tool--ic gd-tool--flip">${icon('undo', 14)}</span>
      <i></i>
      ${tools.map((t) => `<span class="gd-tool">${t}${icon('chevron', 12)}</span>`).join('<i></i>')}
      <i></i>
      <span class="gd-tool gd-tool--b">B</span><span class="gd-tool gd-tool--i">I</span><span class="gd-tool gd-tool--u">U</span><span class="gd-tool gd-tool--a">A</span>
      <i></i>
      <span class="gd-tool gd-tool--ic">${icon('link', 14)}</span>
      <span class="gd-tool gd-tool--ic">${icon('thread', 14)}</span>
      <i></i>
      <span class="gd-tool gd-tool--ic">${lines([10, 7, 10, 5])}</span>
      <span class="gd-tool gd-tool--ic">${lines([10, 10, 10, 10], 3)}</span>
      <span class="gd-tool gd-tool--ic">${lines([7, 7, 7], 3, true)}</span>
      <span class="grow"></span>
      <span class="gd-tool">編集${icon('chevron', 12)}</span>
    </div>
    <div class="gd-body">
      <nav class="gd-outline">
        <div class="gd-outline__h">ドキュメントの概要</div>
        <span class="is-on">ラウンド概要</span><span>課題</span><span>解決策</span><span>トラクション</span><span>資金使途</span>
      </nav>
      <div class="gd-canvas">
        <article class="gd-paper">
          <h1>投資家向けピッチ v3</h1>
          <p class="gd-meta">株式会社ミナモ ・ プレシードラウンド ・ 2026年11月25日 更新</p>
          <h2>ラウンド概要</h2>
          <table>
            <tr><th>項目</th><th>内容</th></tr>
            <tr><td>調達額</td><td>8,000万円</td></tr>
            <tr><td>形式</td><td>J-KISS 型新株予約権</td></tr>
            <tr><td>バリュエーションキャップ</td><td>6億円</td></tr>
            <tr><td>想定ランウェイ</td><td>18か月</td></tr>
          </table>
          <h2>課題</h2>
          <p>介護施設では、職員1人あたり1日平均72分が記録業務に使われています。夜勤帯は申し送りが口頭に偏り、記録漏れが事故報告の約3割に関係しています。</p>
          <h2>解決策</h2>
          <p>Minamo は、申し送りの音声から介護記録の下書きを自動で作成します。職員は内容を確かめて承認するだけで、既存の介護ソフトにそのまま書き出せます。</p>
          <h2>トラクション</h2>
          <ul><li>導入施設 12（2026年10月末）</li><li>MRR 96万円、月次解約率 0%</li><li>記録時間は導入前より 41% 短縮</li></ul>
          <h2>資金使途</h2>
          <p>開発 60%、営業 30%、運営 10%。</p>
        </article>
      </div>
    </div>
  </div>`;
}

function webBank() {
  const rows = [
    ['11/25', '振込 カ)クラウドキバン', '', '184,800', '38,412,907'],
    ['11/25', '振込 シヤカイホケンリヨウ', '', '612,340', '38,597,707'],
    ['11/20', '入金 イ)アオバカイ', '176,000', '', '39,210,047'],
    ['11/20', '入金 シヤフク)ヒナタエン', '132,000', '', '39,034,047'],
    ['11/15', '給与振込 4件', '', '1,480,000', '38,902,047'],
    ['11/10', '振込 オフイスチンリヨウ', '', '330,000', '40,382,047'],
  ];
  return `
  <div class="web bk" lang="ja">
    <div class="bk-head">
      <span class="bk-mark">${icon('bank', 18)}</span>
      <span class="bk-name">つばめ銀行 <b>法人ダイレクト</b></span>
      <span class="bk-sp"></span>
      <span class="bk-user">株式会社ミナモ ・ 三上 遥 様</span>
      <span class="bk-out">ログアウト</span>
    </div>
    <div class="bk-nav"><span class="is-on">口座照会</span><span>振込・振替</span><span>総合振込</span><span>税金・各種料金</span><span>各種手続き</span></div>
    <div class="bk-body">
      <div class="bk-card">
        <div class="bk-card__label">普通預金 渋谷支店 2041877</div>
        <div class="bk-card__amount">38,412,907<span>円</span></div>
        <div class="bk-card__sub">2026年11月26日 12:14 現在 ・ お引き出し可能額 38,412,907円</div>
      </div>
      <div class="bk-h">入出金明細</div>
      <table class="bk-table">
        <tr><th>日付</th><th>お取引内容</th><th class="n">お預り</th><th class="n">お支払い</th><th class="n">残高</th></tr>
        ${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td class="n">${r[2]}</td><td class="n">${r[3]}</td><td class="n">${r[4]}</td></tr>`).join('')}
      </table>
    </div>
  </div>`;
}

function webSearch() {
  const hits = [
    ['shibuya-kenshin.jp › dock', '人間ドックのご予約｜渋谷健診センター', '日帰りコースは平日 8:30 から。空き状況の確認と予約がオンラインでできます。'],
    ['kenko-navi.jp › shibuya', '渋谷区で受けられる人間ドック 28件', '土曜に受診できる施設、胃カメラを選べる施設を一覧で比較できます。'],
    ['kenshin-guide.jp › tokyo › shibuya', '渋谷区の健康診査ガイド', '区の健康診査の対象と受診期間、実施医療機関の一覧です。'],
  ];
  return `
  <div class="web sr" lang="ja">
    <div class="sr-bar"><span class="sr-box">${icon('search', 14)}人間ドック 予約 渋谷</span></div>
    <div class="sr-list">
      ${hits.map((h) => `<div class="sr-hit"><div class="sr-url">${h[0]}</div><div class="sr-title">${h[1]}</div><div class="sr-desc">${h[2]}</div></div>`).join('')}
    </div>
  </div>`;
}
