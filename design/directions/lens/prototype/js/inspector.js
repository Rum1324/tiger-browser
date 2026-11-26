/* The inspector: a native-style trailing pane. Two segments: 聞く (ask the Space) and このページ. */

const cite = (n) => `<cite class="cite">${n}</cite>`;
const citeOnce = () => `<cite class="cite cite--once">添付</cite>`;

function inspBar(on, { closable = true } = {}) {
  return `
  <div class="insp__bar">
    <div class="seg" role="tablist">
      <button class="${on === 'ask' ? 'is-on' : ''}" role="tab">聞く</button>
      <button class="${on === 'page' ? 'is-on' : ''}" role="tab">このページ</button>
    </div>
    <span class="grow"></span>
    ${closable ? `<button class="ib" aria-label="インスペクタを閉じる">${icon('close')}</button>` : ''}
  </div>`;
}

function sourceRow(n, id) {
  const it = ITEMS.find((i) => i.id === id);
  const src = SOURCES[it.src];
  return `
  <a class="src">
    ${cite(n)}
    <span class="src__t">${it.title}</span>
    <span class="src__m">${src.label.replace('Google ', '')} ・ ${MEMBERS[it.by].name} ・ ${it.when}</span>
  </a>`;
}

function reads({ count = 41, page = 'on', title = '投資家向けピッチ v3' }) {
  const pageRow = {
    on: `
      <div class="reads__row">
        ${stateGlyph('once')}
        <span class="reads__t">このページ<small>${title}</small></span>
        <span class="switch is-on" role="switch" aria-checked="true"><i></i></span>
      </div>
      <p class="reads__note">この1通にだけ添付します。チームには共有されません。</p>`,
    off: `
      <div class="reads__row">
        ${stateGlyph('idle')}
        <span class="reads__t">このページ<small>${title}</small></span>
        <span class="switch" role="switch" aria-checked="false"><i></i></span>
      </div>
      <p class="reads__note">オフです。AI はこのページを読みません。</p>`,
    shared: `
      <div class="reads__row">
        ${stateGlyph('shared')}
        <span class="reads__t">このページ<small>${title}</small></span>
        <span class="reads__fixed">共有済み</span>
      </div>
      <p class="reads__note">第1版（12:06 の内容）を、共有物の1つとして読みます。</p>`,
  }[page];
  return `
  <div class="reads">
    <div class="reads__h">次の1通で AI が読むもの</div>
    <div class="reads__row">
      ${stateGlyph('shared')}
      <span class="reads__t">資金調達 2027 の共有 ${count}件<small>4人から</small></span>
      <span class="reads__fixed">常に</span>
    </div>
    ${pageRow}
    <div class="reads__never">ほかのタブ、履歴、共有していないページは読みません。</div>
  </div>`;
}

/* Present but quiet: the model is chosen per message, in the composer, in words. */
function modelPicker() {
  return `<div class="models" role="radiogroup" aria-label="モデル"><button role="radio" aria-checked="true">Claude</button><button role="radio" aria-checked="false">GPT</button><button role="radio" aria-checked="false">Gemini</button></div>`;
}

function composer({ draft = '', placeholder = '資金調達 2027 に質問', readsOpts = {}, busy = false }) {
  return `
  <div class="composer">
    ${reads(readsOpts)}
    <div class="composer__box">
      <div class="composer__input ${draft ? '' : 'is-empty'}">${draft || placeholder}${draft ? '<i class="caret"></i>' : ''}</div>
      <div class="composer__bar">
        ${modelPicker()}
        <span class="grow"></span>
        ${busy ? `<button class="send send--stop">${icon('stop', 14)}停止</button>` : `<button class="send" aria-label="送信">${icon('send')}</button>`}
      </div>
    </div>
  </div>`;
}

function inspectorAsk() {
  return `
  <aside class="insp">
    ${inspBar('ask')}
    <div class="insp__body">
      <div class="msg">
        <div class="msg__h">${avatar(ME)}<b>三上 遥</b><time>12:04</time></div>
        <p class="msg__q">このピッチの調達額と資金使途は、タームシート案や10月のKPIと食い違っていませんか。</p>
        <div class="msg__att">${stateGlyph('once')}このページを添付 ・ 12:04 の内容</div>
      </div>
      <div class="msg msg--ai">
        <div class="msg__h">${aiAvatar()}<b>Claude</b><span class="msg__m">共有 3件と添付を参照</span></div>
        <div class="ai">
          <p>食い違いが2点あります。</p>
          <ol>
            <li><strong>調達額</strong>ピッチは 8,000万円ですが${citeOnce()}、タームシート案の上限は 7,000万円です${cite(1)}。</li>
            <li><strong>ランウェイ</strong>ピッチは18か月としていますが、10月のバーン 470万円で計算すると約17か月です${cite(2)}。</li>
          </ol>
          <p>資金使途（開発 60%、営業 30%、運営 10%）は資本政策表 v4 と一致しています${cite(3)}。</p>
        </div>
        <div class="srcs">
          ${sourceRow(1, 'term')}
          ${sourceRow(2, 'kpi')}
          ${sourceRow(3, 'cap')}
          <a class="src"><cite class="cite cite--once">添付</cite><span class="src__t">このページ</span><span class="src__m">共有していません ・ 12:04 の内容</span></a>
        </div>
        <div class="msg__acts">
          <button class="btn btn--s">${icon('thread', 14)}スレッドに投稿</button>
          <button class="btn btn--s">${icon('exportOut', 14)}ドキュメントに書き出す</button>
          <button class="ib ib--s" aria-label="コピー">${icon('copy', 14)}</button>
        </div>
      </div>
    </div>
    ${composer({ draft: 'タームシートの上限に合わせると、ピッチのどの数字を直す必要がありますか', readsOpts: { count: 41, page: 'on' } })}
  </aside>`;
}

/* The second question, mid-answer: named step, streamed text with a caret, stop button. */
function inspectorAskStreaming() {
  return `
  <aside class="insp">
    ${inspBar('ask')}
    <div class="insp__body">
      <div class="msg">
        <div class="msg__h">${avatar(ME)}<b>三上 遥</b><time>12:05</time></div>
        <p class="msg__q">タームシートの上限に合わせると、ピッチのどの数字を直す必要がありますか</p>
        <div class="msg__att">${stateGlyph('once')}このページを添付 ・ 12:05 の内容</div>
      </div>
      <div class="msg msg--ai">
        <div class="msg__h">${aiAvatar()}<b>Claude</b><span class="msg__m">回答中</span></div>
        <div class="step"><i></i>共有 41件のうち 3件と、添付を読みました</div>
        <div class="ai">
          <p>直す数字は2つです。</p>
          <dl class="diff">
            <dt>調達額</dt><dd><del>8,000万円</del><span class="arrow">→</span><ins>7,000万円</ins>${cite(1)}</dd>
            <dt>想定ランウェイ</dt><dd><del>18か月</del><span class="arrow">→</span><ins>15か月</ins>${cite(2)}</dd>
          </dl>
          <p>ランウェイは、10月のバーン 470万円が続くと仮定して計算しました。資金使途の比率は変えずに済みますが、開発費の<i class="caret"></i></p>
        </div>
      </div>
    </div>
    ${composer({ readsOpts: { count: 41, page: 'off' }, busy: true })}
  </aside>`;
}

/* このページ: what Tiger knows about this tab's visibility. Finder's "Get Info" for sharing. */
function inspectorPageShared() {
  const people = ['mikami', 'kubo', 'hayase', 'noguchi'];
  return `
  <aside class="insp">
    ${inspBar('page')}
    <div class="insp__body insp__body--form">
      <section class="info">
        <div class="info__state">${stateGlyph('shared')}<b>資金調達 2027 に共有中</b></div>
        <p class="info__p">共有されているのは、12:06 に取り込んだ第1版です。そのあとの編集は、次の版を共有するまでこの Mac の外に出ません。</p>
      </section>
      <section class="info">
        <h3>読める人 <span>4人と、この Space の AI</span></h3>
        <div class="who">
          ${people.map((p) => `<div class="who__r">${avatar(p)}<span>${MEMBERS[p].name}</span>${p === ME ? '<small>自分 ・ 共有した人</small>' : ''}</div>`).join('')}
        </div>
      </section>
      <section class="info">
        <h3>版</h3>
        <div class="kv"><span>第1版</span><span>今日 12:06 ・ 三上 遥</span></div>
        <div class="kv"><span>現在のページ</span><span>第1版と同じ内容</span></div>
        <button class="btn btn--s" disabled>新しい版を共有…</button>
      </section>
      <section class="info">
        <h3>送った内容</h3>
        <div class="kv"><span>形式</span><span>Markdown ・ ${PITCH_MD.length}行 ・ ${PITCH_MD.join('\n').length}文字</span></div>
        <div class="kv"><span>ソース</span><span class="mono">docs.google.com/document/d/1xKq…7Rw</span></div>
        <div class="kv"><span>引用</span><span>AI の回答で 0回</span></div>
        <button class="btn btn--s">送った内容を見る</button>
      </section>
      <section class="info info--end">
        <button class="btn btn--s btn--danger">共有を解除</button>
        <p class="info__p">内容、版、索引を削除します。解除した記録だけが残ります。</p>
      </section>
    </div>
  </aside>`;
}

function inspectorPageSealed() {
  const kinds = [
    ['bank', '銀行・決済', true],
    ['mail', 'メールの本文', false],
    ['lock', 'パスワード管理', false],
    ['eyeOff', 'プライベートウインドウ', false],
  ];
  return `
  <aside class="insp">
    ${inspBar('page')}
    <div class="insp__body insp__body--form">
      <section class="info">
        <div class="info__state">${stateGlyph('sealed')}<b>このページは共有できません</b></div>
        <p class="info__p">銀行のページは Tiger が保護しています。共有、AI への添付、AI による読み取りはできません。この保護は設定でも解除できません。</p>
      </section>
      <section class="info">
        <h3>判定</h3>
        <div class="kv"><span>ドメイン</span><span class="mono">direct.tsubame-bank.co.jp</span></div>
        <div class="kv"><span>種類</span><span>銀行・決済</span></div>
      </section>
      <section class="info">
        <h3>保護されるもの</h3>
        <div class="kinds">
          ${kinds.map(([ic, label, on]) => `<div class="kinds__r ${on ? 'is-on' : ''}">${icon(ic)}<span>${label}</span>${on ? '<small>このページ</small>' : ''}</div>`).join('')}
        </div>
        <p class="info__p">保護はこの Mac の中で行います。ページの側から変えることはできません。</p>
      </section>
      <section class="info info--end">
        <h3>Space には質問できます</h3>
        <p class="info__p">「聞く」では、資金調達 2027 の共有 42件だけを読んで答えます。</p>
      </section>
    </div>
  </aside>`;
}
