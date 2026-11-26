/*
 * Chrome UI templates: everything Tiger itself paints. Plain functions returning HTML strings.
 * State `s` is a plain object built per screen in main.js.
 */
;(() => {
  const D = window.DATA
  const I = window.icon
  const P = D.people

  const sei = (id) => (P[id].you ? 'あなた' : P[id].sei)
  const full = (id) => `${P[id].sei} ${P[id].mei}`
  const ed = (n) => `第${n}版`
  /* A person is a kanji in a circle. Filled means "here now"; outlined is a name tag only. */
  const who = (id, here = false) => `<span class="who${here ? ' who--here' : ''}">${P[id].mono}</span>`
  const kbd = (k) => `<kbd>${k}</kbd>`

  /* ---------- Sidebar: the margin of the sheet ---------- */

  function tabRow(id, s) {
    const t = D.tabs[id]
    const sh = s.sharedInfo[id]
    const active = s.active === id
    const cls = ['tab']
    if (sh) cls.push('tab--shared')
    if (t.blocked) cls.push('tab--blocked')
    if (active) cls.push('is-active')
    if (s.drag === id) cls.push('is-ghost')

    let by = ''
    if (sh) {
      const dirty = s.dirty && id === 'pitch' ? ' · <b>変更あり</b>' : ''
      by = `<span class="tab__by">${sei(sh.by)} · ${ed(sh.ed)} · ${sh.when}${dirty}</span>`
    } else if (t.blocked) {
      by = `<span class="tab__by">保護 · ${t.blocked}</span>`
    }
    let tail = ''
    if (t.blocked) tail = I('lock', 'tab__tail')
    else if (t.here) tail = `<span class="tab__tail">${t.here.map((p) => who(p, true)).join('')}</span>`
    else if (active) tail = `<span class="tab__tail tab__x">${I('close')}</span>`

    return `<a class="${cls.join(' ')}"${active ? ' aria-current="page"' : ''}>${I(t.glyph, 'tab__glyph')}<span class="tab__title">${t.title}</span>${tail}${by}</a>`
  }

  function side(s) {
    const sp = D.space
    const lights = `<span class="lights"><i class="light light--close"></i><i class="light light--min"></i><i class="light light--zoom"></i></span>`

    if (s.firstRun) {
      return `
<aside class="side">
  <div class="side__top">${lights}<button class="ib" aria-label="サイドバーを隠す">${I('sidebar')}</button></div>
  <div class="space space--draft">
    <span class="space__name">資金調達 2027</span>
    <span class="space__meta">作成中 · あなただけ</span>
  </div>
  <section class="tabs tabs--shared">
    <h2 class="tabs__label"><b>共有</b><span>0件</span></h2>
    <p class="tabs__empty">タブをこの線の上へ上げると、内容を確認してから共有できます。</p>
  </section>
  <div class="shareline" role="separator"></div>
  <section class="tabs tabs--local">
    <h2 class="tabs__label"><b>この Mac のみ</b><span>どこにも送りません</span></h2>
    <a class="tab is-active" aria-current="page">${I('ruled', 'tab__glyph')}<span class="tab__title">はじめに</span></a>
    <button class="tab tab--new">${I('plus', 'tab__glyph')}<span class="tab__title">新しいタブ</span>${kbd('⌘T')}</button>
  </section>
  <div class="side__foot">${who('hayase', true)}<span class="side__me">${full('hayase')}</span><button class="ib" aria-label="設定">${I('sliders')}</button></div>
</aside>`
    }

    const slot = s.drag
      ? `<div class="tab tab--slot"><span>ここで離すと、内容を確認してから共有</span></div>`
      : ''

    return `
<aside class="side${s.drag ? ' is-dragging' : ''}">
  <div class="side__top">${lights}<button class="ib" aria-label="サイドバーを隠す">${I('sidebar')}</button></div>
  <button class="space" aria-haspopup="menu">
    <span class="space__name">${sp.name}</span>${I('chevDown', 'space__chev')}
    <span class="space__meta">${sp.members}人 · 共有 ${s.items}件</span>
  </button>
  <a class="nav${s.active === 'home' ? ' is-active' : ''}"${s.active === 'home' ? ' aria-current="page"' : ''}>${I('ruled')}<span>スレッドと台帳</span><span class="nav__count">${s.active === 'home' ? '' : '2'}</span></a>
  <section class="tabs tabs--shared" aria-label="共有しているタブ">
    <h2 class="tabs__label"><b>共有</b><span>${sp.members}人と AI が読めます</span></h2>
    ${s.shared.map((id) => tabRow(id, s)).join('')}
    ${slot}
  </section>
  <div class="shareline" role="separator" aria-label="共有線"></div>
  <section class="tabs tabs--local" aria-label="この Mac のみのタブ">
    <h2 class="tabs__label"><b>この Mac のみ</b><span>どこにも送りません</span></h2>
    ${s.local.map((id) => tabRow(id, s)).join('')}
    <button class="tab tab--new">${I('plus', 'tab__glyph')}<span class="tab__title">新しいタブ</span>${kbd('⌘T')}</button>
  </section>
  <div class="side__foot">${who('hayase', true)}<span class="side__me">${full('hayase')}</span><button class="ib" aria-label="設定">${I('sliders')}</button></div>
</aside>`
  }

  /* The row under the pointer while it is dragged across the line (signature, frame a). */
  function dragLayer(s) {
    if (!s.drag) return ''
    const t = D.tabs[s.drag]
    return `
<div class="dragrow">${I(t.glyph, 'tab__glyph')}<span class="tab__title">${t.title}</span></div>
<svg class="cursor" viewBox="0 0 16 20" aria-hidden="true"><path d="M2 1.5v14l3.6-3.3 2.4 5.6 2.3-1-2.4-5.5h5z"/></svg>`
  }

  /* ---------- Toolbar: one quiet row ---------- */

  function bar(s) {
    let addr = ''
    let state = ''
    let act = ''

    if (s.firstRun) {
      addr = `<span class="addr__host">Tiger</span><span class="addr__sep">/</span><span class="addr__title">はじめに</span>`
    } else if (s.active === 'home') {
      addr = `<span class="addr__host">${D.space.name}</span><span class="addr__sep">/</span><span class="addr__title">スレッドと台帳</span>`
      state = `<span class="state state--shared"><i class="mark"></i><span class="state__main">${D.space.members}人が読めます</span></span>`
      act = `<button class="btn">${I('users')}招待…</button>`
    } else {
      const t = D.tabs[s.active]
      const sh = s.sharedInfo[s.active]
      addr = `<span class="addr__host">${t.host}</span><span class="addr__sep">/</span><span class="addr__title">${t.title.replace(' — Slack', '')}</span>`
      if (s.inking) {
        state = `<span class="state state--shared" role="status"><i class="mark"></i><span class="state__main">共有しました</span><span class="state__sub">${ed(sh.ed)} · ${D.space.name}</span></span>`
        act = `<button class="btn">${I('undo')}取り消す</button>`
      } else if (sh) {
        const dirty = s.dirty && s.active === 'pitch'
        state = `<button class="state state--shared" aria-haspopup="dialog"><i class="mark"></i><span class="state__main">${D.space.members}人に共有中</span><span class="state__sub">${ed(sh.ed)} · ${dirty ? '変更あり' : sh.when}</span>${I('chevDown', 'state__chev')}</button>`
        if (dirty) act = `<button class="btn${s.overlay === 'share' ? ' is-on' : ''}">${I('share')}更新を共有…</button>`
      } else if (t.blocked) {
        state = `<button class="state state--blocked${s.overlay === 'blocked' ? ' is-on' : ''}" aria-haspopup="dialog"><i class="mark mark--hatch"></i><span class="state__main">共有できません</span><span class="state__sub">${t.blocked}</span>${I('chevDown', 'state__chev')}</button>`
      } else {
        state = `<span class="state state--local"><span class="state__main">この Mac のみ</span></span>`
        act = `<button class="btn">${I('share')}共有…</button>`
      }
    }

    const ask = s.firstRun
      ? ''
      : `<button class="btn btn--ask${s.panel ? ' is-on' : ''}" aria-pressed="${!!s.panel}">${I('ask')}Space に聞く</button>`

    return `
<header class="bar">
  <div class="bar__nav">
    <button class="ib" aria-label="戻る">${I('back')}</button>
    <button class="ib is-off" aria-label="進む" disabled>${I('fwd')}</button>
    <button class="ib" aria-label="再読み込み">${I('reload')}</button>
  </div>
  <button class="addr" aria-label="アドレスとコマンド">${addr}</button>
  <span class="grow"></span>
  ${state}
  ${act}
  ${ask}
</header>`
  }

  /* The 8 px strip left of the page. The page cannot paint here. */
  function gutter(s) {
    if (s.firstRun) return `<div class="gutter"></div>`
    if (s.active === 'home') return `<div class="gutter gutter--shared"></div>`
    const t = D.tabs[s.active]
    if (t.blocked) return `<div class="gutter gutter--protected"></div>`
    if (s.inking === 'draw') return `<div class="gutter gutter--shared gutter--drawing"></div>`
    if (s.sharedInfo[s.active]) return `<div class="gutter gutter--shared"></div>`
    return `<div class="gutter"></div>`
  }

  /* ---------- Side panel: ask the Space ---------- */

  /* U+2060 keeps a citation on the same line as the words it supports. */
  const cite = (n, hot = false) => `\u2060<a class="cite${hot ? ' is-hot' : ''}" href="#ref-${n}">${n}</a>`

  function refs(list, tight = false) {
    return `<ol class="refs${tight ? ' refs--tight' : ''}" aria-label="参照した共有">${list
      .map(
        (r, i) => `
      <li class="ref${r.hot ? ' is-hot' : ''}" id="ref-${i + 1}">
        <span class="ref__n">${i + 1}</span>
        <span class="ref__body"><a class="ref__title">${I(r.glyph)}${r.title}</a><span class="ref__by">${r.by}</span>${r.quote ? `<q class="ref__quote">${r.quote}</q>` : ''}</span>
      </li>`,
      )
      .join('')}</ol>`
  }

  function models(on = 'Claude') {
    return `<div class="models" role="radiogroup" aria-label="この質問に使うモデル">${['Claude', 'GPT', 'Gemini']
      .map((m) => `<button role="radio" aria-checked="${m === on}" class="${m === on ? 'is-on' : ''}">${m}</button>`)
      .join('')}</div>`
  }

  function panelAsk(s) {
    return `
<aside class="panel" aria-label="Space に聞く">
  <header class="panel__head">
    <h2>Space に聞く</h2><span class="panel__scope">${D.space.name}</span>
    <span class="grow"></span>
    <button class="ib" aria-label="新しい質問">${I('plus')}</button>
    <button class="ib" aria-label="閉じる">${I('close')}</button>
  </header>

  <div class="panel__body">
    <article class="msg">
      <header class="msg__by"><b>あなた</b><time>14:31</time></header>
      <p class="msg__text">このピッチの調達希望額は、共有されている資本政策表と合っていますか？</p>
      <p class="msg__saw">AI が読んだもの：共有 41件。ページの添付なし。</p>
    </article>

    ${s.streaming ? `<article class="msg msg--ai" aria-busy="true">
      <header class="msg__by"><b>Claude</b><time>14:31</time><span class="msg__meta">回答中</span></header>
      <p class="step" role="status"><i class="mark"></i><span>「資本政策表 2027」を読んでいます</span><small>参照 2件目</small></p>
      <div class="ai">
        <p>合っていません。ピッチ v3 は調達希望額を1.5億円としています${cite(1)}。一方、資本政策表 2027 は調達額<i class="caret"></i></p>
      </div>
    </article>` : `    <article class="msg msg--ai">
      <header class="msg__by"><b>Claude</b><time>14:31</time><span class="msg__meta">共有 41件から2件を参照</span></header>
      <div class="ai">
        <p>合っていません。ピッチ v3 は調達希望額を1.5億円としています${cite(1)}。一方、資本政策表 2027 は調達額1.2億円、プレマネー6億円を前提に、希薄化を16.7%と計算しています${cite(2, true)}。</p>
        <p>プレマネーを変えずに1.5億円を調達すると、希薄化は20.0%になります。どちらかの数字をそろえる必要があります。</p>
      </div>
      ${refs([
        { glyph: 'doc', title: '投資家向けピッチ v3', by: 'Google ドキュメント · あなたが共有 · 第2版 · 今日 12:24' },
        {
          glyph: 'table',
          title: '資本政策表 2027',
          by: 'Notion · 夏目 葵が共有 · 第2版 · 今日 13:58',
          quote: '調達額 120,000,000円／プレマネー 600,000,000円／希薄化 16.7%',
          hot: true,
        },
      ])}
      <div class="msg__acts">
        <button class="tbtn">Google ドキュメントに書き出す</button>
        <button class="tbtn">スレッドに投稿</button>
        <button class="tbtn">コピー</button>
      </div>
    </article>`}
  </div>

  <div class="composer">
    <section class="sees" aria-label="この質問で AI が読むもの">
      <h3>この質問で AI が読むもの</h3>
      <div class="sees__row"><i class="mark"></i><span class="sees__what"><b>共有 41件</b><small>${D.space.name} · 4人が共有したページ</small></span><button class="tbtn sees__narrow">絞り込む</button></div>
      <label class="sees__row sees__row--opt${s.attach ? ' is-on' : ''}"><span class="check" role="checkbox" aria-checked="${!!s.attach}">${s.attach ? I('check') : ''}</span><span class="sees__what"><b>このページの今の内容${s.attach ? 'を添付中' : 'を添付'}</b><small>${s.attach ? '約350字。この質問だけに使い、Space には残しません。' : 'この質問だけに使い、Space には残しません。'}</small></span></label>
      <p class="sees__not">ほかのタブ、履歴、この Mac のみのページは読みません。</p>
    </section>
    <div class="field">
      <div class="field__input"><span class="placeholder">続けて質問する</span></div>
      <div class="field__foot">${models('Claude')}${s.streaming ? `<button class="btn">停止${kbd('esc')}</button>` : `<button class="btn btn--ink" aria-label="送信">送信${kbd('↵')}</button>`}</div>
    </div>
  </div>
</aside>`
  }

  /* ---------- Share preview: the consent sheet ---------- */

  function markdownLines() {
    const p = D.pitch
    const out = []
    const push = (t, mark) => out.push({ t, mark })
    push(`# ${p.title}`)
    push('')
    push(p.meta)
    for (const sct of p.sections) {
      push('')
      push(`## ${sct.h}`)
      push('')
      if (sct.p) push(sct.p)
      if (sct.table)
        sct.table.forEach((r, i) => {
          push(`| ${r.join(' | ')} |`)
          if (i === 0) push('| --- | --- |')
        })
      if (sct.list) for (const l of sct.list) push(`- ${l.t3 || l.t}`, l.v3)
    }
    return out
  }

  function sheetShare() {
    const lines = markdownLines()
    const chars = lines.reduce((n, l) => n + l.t.length, 0)
    const md = lines
      .map((l, i) => {
        const cls = l.mark ? ' class="is-changed"' : ''
        const t = l.t.replace(/^(#{1,2} )(.*)$/, '<b>$1$2</b>')
        return `<li${cls}><span class="md__n">${i + 1}</span><code>${t || '&nbsp;'}</code>${l.mark ? `<em>${l.mark}</em>` : ''}</li>`
      })
      .join('')
    const member = (id) => `<li>${full(id)}${P[id].you ? '<small>あなた</small>' : ''}</li>`

    return `
<section class="sheet sheet--share" role="dialog" aria-modal="true" aria-labelledby="share-h">
  <div class="sheet__main">
    <header class="sheet__head">
      <h2 id="share-h">共有の確認</h2>
      <p>下の Markdown が、このまま ${D.space.name} に保存されます。</p>
    </header>
    <div class="md">
      <div class="md__bar"><b>送る内容</b><span>Markdown · ${lines.length}行 · ${chars}字</span><span class="grow"></span><span class="seg" role="tablist"><span role="tab" aria-selected="true" class="is-on">Markdown</span><span role="tab">整形して表示</span></span></div>
      <ol class="md__lines">${md}</ol>
    </div>
  </div>
  <aside class="slip" aria-label="送り先と条件">
    <dl>
      <div><dt>送り先</dt>
        <dd><span class="slip__space"><i class="mark"></i>${D.space.name}</span></dd></div>
      <div><dt>読める人</dt>
        <dd><ul class="slip__people">${['hayase', 'natsume', 'miura', 'okabe'].map(member).join('')}</ul>
          <p class="slip__fine">Space で質問したときは、AI も読みます。</p></dd></div>
      <div><dt>出典</dt>
        <dd><code class="slip__url">docs.google.com/document/d/1Qx7k…</code>
          <p class="slip__fine">URL、共有者、日時を一緒に記録します。</p></dd></div>
      <div><dt>版</dt>
        <dd>第3版<p class="slip__fine">第2版（今日 12:24）から追加1行、変更1行。前の版も台帳に残ります。</p></dd></div>
      <div><dt>送らないもの</dt>
        <dd>見た目と画像、コメント 5件、提案中の編集 2件、編集履歴</dd></div>
    </dl>
    <div class="slip__acts">
      <button class="btn btn--shu is-focus">共有する${kbd('↵')}</button>
      <button class="btn">キャンセル${kbd('esc')}</button>
    </div>
    <p class="slip__fine">台帳からいつでも解除できます。解除すると本文、すべての版、索引を削除し、解除の記録だけが残ります。</p>
  </aside>
</section>`
  }

  /* ---------- Command palette / omnibox ---------- */

  function palette() {
    const row = (o) => `
    <li class="pal__row${o.on ? ' is-on' : ''}" role="option" aria-selected="${!!o.on}">
      ${o.mono ? `<span class="mono-tile">${o.mono}</span>` : I(o.glyph)}
      <span class="pal__label">${o.label}</span>
      <span class="pal__hint">${o.hint || ''}</span>
      ${o.shared ? `<span class="pal__shared"><i class="mark"></i>${o.shared}</span>` : ''}
      ${o.key ? kbd(o.key) : ''}
    </li>`
    return `
<section class="sheet pal" role="dialog" aria-label="コマンド">
  <div class="pal__input">${I('search')}<span class="pal__caret"></span><span class="placeholder">URL、検索、コマンド</span><span class="pal__scope">${D.space.name}</span></div>
  <ul class="pal__list" role="listbox">
    <li class="pal__sec">このタブ　介護テックの資金調達、7〜9月は12%増</li>
    ${row({ glyph: 'ask', label: 'Space に聞く', hint: 'AI が読むのは共有 41件。ページの添付は選べます', key: '⌘J', on: true })}
    ${row({ glyph: 'share', label: 'このタブを共有…', hint: '内容を確認してから 資金調達 2027 へ', key: '⇧⌘S' })}
    <li class="pal__sec">開く　最近のページ</li>
    ${row({ glyph: 'doc', label: '投資家向けピッチ v3', hint: 'docs.google.com/document/d/1Qx7k…', shared: 'あなた · 第2版' })}
    ${row({ glyph: 'table', label: '資本政策表 2027', hint: 'notion.so/hibari/cap-table-2027', shared: '夏目 · 第2版' })}
    ${row({ glyph: 'hash', label: '#fundraising', hint: 'app.slack.com/client/T04H1BR/C07FUND' })}
    ${row({ glyph: 'pdf', label: '訪問介護の市場規模 2026.pdf', hint: 'drive.google.com/file/d/1mK…', shared: '三浦 · 第1版' })}
    <li class="pal__sec">Space を切り替える</li>
    ${row({ mono: '採', label: '採用', hint: '3人 · 共有 18件', key: '⌃2' })}
    ${row({ mono: 'プ', label: 'プロダクト', hint: '4人 · 共有 67件', key: '⌃3' })}
  </ul>
  <footer class="pal__foot"><span>${kbd('↑')}${kbd('↓')}選ぶ</span><span>${kbd('↵')}実行</span><span>${kbd('⌘')}${kbd('↵')}入力した文を Space に聞く</span><span class="grow"></span><span>${kbd('esc')}閉じる</span></footer>
</section>`
  }

  /* ---------- Blocklist reason, and the private window ---------- */

  function popBlocked() {
    return `
<section class="pop pop--blocked" role="dialog" aria-labelledby="blk-h">
  <h2 id="blk-h">このページは共有できません</h2>
  <p class="pop__host"><code>direct.tsubamebank.jp</code></p>
  <ul class="pop__says">
    <li>このドメインは保護リストの「銀行・決済」です。</li>
    <li>Tiger はこのページを読み取りません。</li>
    <li>Space への共有も、AI への添付もできません。</li>
  </ul>
  <dl class="pop__list">
    <dt>常に保護するもの</dt>
    <dd><span class="is-on">銀行・決済</span><span>メール本文</span><span>パスワード管理</span><span>プライベートウインドウ</span></dd>
  </dl>
  <p class="pop__fine">この4種類は外せません。ドメインの追加は設定からできます。</p>
</section>`
  }

  function privateWindow() {
    return `
<div class="pwin" data-window="private" role="group" aria-label="プライベートウインドウ">
  <aside class="pwin__side">
    <div class="side__top"><span class="lights"><i class="light light--close"></i><i class="light light--min"></i><i class="light light--zoom"></i></span></div>
    <div class="space space--private"><span class="space__name">プライベート</span><span class="space__meta">Space なし · 記録なし</span></div>
    <section class="tabs">
      <a class="tab is-active" aria-current="page">${I('plus', 'tab__glyph')}<span class="tab__title">新しいタブ</span><span class="tab__tail tab__x">${I('close')}</span></a>
      <a class="tab">${I('globe', 'tab__glyph')}<span class="tab__title">確定申告の医療費控除 — 検索</span></a>
    </section>
    <p class="pwin__noline">共有線はありません。</p>
  </aside>
  <div class="pwin__main">
    <header class="bar">
      <div class="bar__nav"><button class="ib is-off" disabled>${I('back')}</button><button class="ib is-off" disabled>${I('fwd')}</button><button class="ib">${I('reload')}</button></div>
      <button class="addr"><span class="placeholder">検索または URL</span></button>
      <span class="grow"></span>
      <span class="state state--blocked"><i class="mark mark--hatch"></i><span class="state__main">共有・添付できません</span></span>
    </header>
    <div class="stage">
      <div class="gutter gutter--protected"></div>
      <div class="page"><div class="pntp">
        <h1>プライベートウインドウ</h1>
        <dl>
          <dt>どの Space にも入りません</dt>
          <dd>このウインドウのページは共有できません。AI への添付もできません。</dd>
          <dt>記録しません</dt>
          <dd>閉じると、履歴、Cookie、フォームの入力を消します。</dd>
          <dt>残るもの</dt>
          <dd>ダウンロードしたファイルと、追加したブックマーク。</dd>
        </dl>
      </div></div>
    </div>
  </div>
</div>`
  }

  /* ---------- Space home: thread and ledger ---------- */

  function spaceHome() {
    const msg = (id, time, text) => `
      <article class="msg">
        <header class="msg__by"><b>${full(id)}</b><time>${time}</time></header>
        <p class="msg__text">${text}</p>
      </article>`

    const rows = D.ledger
      .map((r) => {
        if (r.gone)
          return `
        <tr class="is-gone">
          <td class="lg__t"><span class="lg__link">${I(r.glyph)}<span class="lg__title"><s>${r.title}</s></span><span class="lg__src">${r.gone}</span></span></td>
          <td class="lg__by">${P[r.by].sei}</td>
          <td class="lg__when">${r.when}</td>
          <td class="lg__ed">—</td>
          <td class="lg__act"></td>
        </tr>`
        return `
        <tr${r.fresh ? ' class="is-fresh"' : ''}>
          <td class="lg__t"><a class="lg__link">${I(r.glyph)}<span class="lg__title">${r.title}</span><span class="lg__src">${r.app} · ${r.host}</span></a></td>
          <td class="lg__by">${sei(r.by)}</td>
          <td class="lg__when">${r.when}</td>
          <td class="lg__ed"><a>${ed(r.ed)}</a></td>
          <td class="lg__act">${P[r.by].you ? `<button class="tbtn tbtn--bare">解除</button>` : ''}</td>
        </tr>`
      })
      .join('')

    return `
<div class="home">
  <header class="home__head">
    <h1>${D.space.name}</h1>
    <ul class="home__members" aria-label="メンバー">
      <li>${who('hayase', true)}早瀬 湊<small>あなた</small></li>
      <li>${who('natsume', true)}夏目 葵</li>
      <li>${who('miura')}三浦 陸</li>
      <li>${who('okabe')}岡部 詩織</li>
    </ul>
    <p class="home__meta">黒丸は、いまこの Space を開いている人</p>
  </header>

  <div class="home__cols">
    <section class="thread" aria-label="スレッド">
      <h2 class="colhead"><b>スレッド</b><span>書いたことは4人に見えます</span></h2>
      <div class="thread__scroll">
        <p class="thread__day"><span>今日　11月26日（木）</span></p>
        ${msg('natsume', '13:58', '資本政策表を第2版にしました。プレ6億円、調達1.2億円で、希薄化は16.7%です。')}
        ${msg('hayase', '14:36', 'ピッチ v3 は1.5億円のままでした。<span class="at">@Claude</span> どちらの金額なら青葉キャピタルの条件に収まりますか。')}
        <article class="msg msg--ai">
          <header class="msg__by"><b>Claude</b><time>14:36</time><span class="msg__meta">共有 41件から3件を参照</span></header>
          <div class="ai">
            <p>どちらでも収まります。青葉キャピタルの条件は<span class="nb">「希薄化20%以内」</span>です${cite(1)}。プレマネー6億円なら、1.2億円で16.7%${cite(2)}、1.5億円で20.0%と上限ちょうどです。ピッチ v3 は18か月のランウェイを1.5億円で見積もっています${cite(3)}。1.2億円にする場合は、資金使途の見直しが必要です。</p>
          </div>
          ${refs(
            [
              { glyph: 'table', title: '面談メモ：青葉キャピタル', by: 'Notion · 岡部 詩織 · 第1版 · 11月24日' },
              { glyph: 'table', title: '資本政策表 2027', by: 'Notion · 夏目 葵 · 第2版 · 今日 13:58' },
              { glyph: 'doc', title: '投資家向けピッチ v3', by: 'Google ドキュメント · 早瀬 湊 · 第2版 · 今日 12:24' },
            ],
            true,
          )}
        </article>
        ${msg('miura', '14:41', '1.5億円で進めましょう。採用計画から見て、18か月は削れません。')}
        <p class="event"><i class="mark"></i><span>早瀬 湊が「投資家向けピッチ v3」の第3版を共有</span><time>14:52</time></p>
      </div>
      <div class="field">
        <div class="field__input"><span class="placeholder">${D.space.name} に書く。@ で AI を呼べます</span></div>
        <div class="field__foot"><span class="field__note">AI を呼ぶと、共有 41件を読んで答えます。</span><span class="grow"></span><button class="btn btn--ink">送信${kbd('↵')}</button></div>
      </div>
    </section>

    <section class="ledger" aria-label="台帳">
      <h2 class="colhead"><b>台帳</b><span>共有 41件 · 解除 1件</span><span class="grow"></span><button class="tbtn">${I('filter')}絞り込む</button></h2>
      <table class="lg">
        <thead><tr><th>題名と出典</th><th>共有者</th><th>最終共有</th><th>版</th><th><span class="sr">操作</span></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="lg__more"><a>ほか 30件を表示</a><span>自分が共有したものだけ解除できます。解除すると本文、全版、索引を削除します。</span></p>
    </section>
  </div>
</div>`
  }

  /* ---------- First run ---------- */

  function firstRun() {
    const sug = (name, mail) =>
      `<label class="fr__sug"><span class="check" role="checkbox" aria-checked="false"></span><span>${name}</span><code>${mail}</code></label>`
    return `
<div class="fr">
  <div class="fr__form">
    <p class="fr__step">ようこそ、早瀬さん。Google アカウントでサインインしました。</p>
    <h1>最初の Space をつくる</h1>
    <p class="fr__lead">Space は、プロジェクトごとの共有の置き場です。あなたが共有したページだけが入り、AI はそれを読んで答えます。</p>

    <label class="fr__label" for="fr-name">名前</label>
    <div class="input is-focus" id="fr-name"><span>資金調達 2027</span><i class="caret"></i></div>

    <div class="fr__label">メンバー<small>任意</small></div>
    <div class="fr__sugs">
      <p>hibarilabs.jp の3人</p>
      ${sug('夏目 葵', 'natsume@hibarilabs.jp')}
      ${sug('三浦 陸', 'miura@hibarilabs.jp')}
      ${sug('岡部 詩織', 'okabe@hibarilabs.jp')}
    </div>
    <div class="input"><span class="placeholder">メールアドレスで招待</span></div>

    <div class="fr__acts">
      <button class="btn btn--ink btn--lg">ひとりで始める${kbd('↵')}</button>
      <span>メンバーを選ぶと「招待して始める」に変わります。<br />あとからでも招待できます。</span>
    </div>
  </div>

  <aside class="fr__notes" aria-label="Tiger の約束">
    <h2>ひとりでも使えます</h2>
    <p>共有したページは、まずあなた自身の質問に答えるための資料になります。メンバーが入ると、同じ資料を全員の AI が読めます。</p>
    <h2>既定はすべて「この Mac のみ」</h2>
    <p>ページの内容がこの Mac を出るのは、あなたが共有か添付を選んだときだけです。送る前に、送る文面をそのまま確認できます。</p>
    <h2>共有できないもの</h2>
    <p>銀行・決済、メール本文、パスワード管理、プライベートウインドウは、常に対象外です。</p>
    <div class="fr__legend" aria-label="印の意味">
      <p><i class="mark"></i><span><b>朱の線</b>　Space のメンバーと AI が読める</span></p>
      <p><i class="mark mark--none"></i><span><b>線なし</b>　この Mac のみ</span></p>
      <p><i class="mark mark--hatch"></i><span><b>斜線</b>　保護。共有も添付もできない</span></p>
    </div>
  </aside>

  <footer class="fr__next" aria-label="このあと">
    <b>このあと</b>
    <span><i>1</i>ページを開く</span>
    <span><i>2</i>タブを共有線の上へ上げる${kbd('⇧⌘S')}</span>
    <span><i>3</i>Space に聞く${kbd('⌘J')}</span>
  </footer>
</div>`
  }

  window.VIEWS = { side, bar, gutter, panelAsk, sheetShare, palette, popBlocked, privateWindow, spaceHome, firstRun, dragLayer }
})()
