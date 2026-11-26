/* Screen compositions. Each returns the HTML for #app. */

const MD_LINES = PITCH_MD.length;
const MD_CHARS = PITCH_MD.join('\n').length;
const BASE_TABS = ['slack', 'notion', 'docs', 'pdf', 'news'];

/* ---------- overlays ---------- */
function shareSheet() {
  const people = ['mikami', 'kubo', 'hayase', 'noguchi'];
  const md = PITCH_MD.map((l, i) => {
    const cls = l.startsWith('#') ? 'md-h' : l.startsWith('|') ? 'md-t' : l.startsWith('-') ? 'md-l' : '';
    return `<div class="md__l"><i>${i + 1}</i><span class="${cls}">${l}</span></div>`;
  }).join('');
  return `
  <div class="overlay overlay--scrim">
    <div class="sheet" role="dialog" aria-label="Space に共有">
      <header class="sheet__h">
        <div>
          <h1>このページを Space に共有</h1>
          <p>送るのは左の Markdown だけです。「共有」を押すまで、何もこの Mac の外に出ません。</p>
        </div>
      </header>
      <div class="sheet__b">
        <section class="md">
          <div class="md__bar"><b>送る内容</b><span>Markdown ・ ${MD_LINES}行 ・ ${MD_CHARS}文字</span><span class="grow"></span><span>画像、コメント、変更履歴は含みません</span></div>
          <div class="md__code">${md}<i class="md__thumb"></i></div>
        </section>
        <section class="dest">
          <div class="dest__g">
            <h3>共有先</h3>
            <button class="pick">${swatch('fund')}<span>資金調達 2027</span>${icon('chevron', 12)}</button>
          </div>
          <div class="dest__g">
            <h3>読めるようになる人 <span>4人</span></h3>
            <div class="who">
              ${people.map((p) => `<div class="who__r">${avatar(p)}<span>${MEMBERS[p].name}</span>${p === ME ? '<small>自分</small>' : ''}</div>`).join('')}
            </div>
            <p class="dest__p">この Space の AI も、質問に答えるときに読みます。</p>
          </div>
          <div class="dest__g">
            <h3>記録されること</h3>
            <div class="kv kv--stack"><span>ソース</span><span class="mono">docs.google.com/document/d/1xKq8mT…7Rw/edit</span></div>
            <div class="kv"><span>共有した人</span><span>三上 遥</span></div>
            <div class="kv"><span>日時 ・ 版</span><span>2026/11/26 12:06 ・ 第1版</span></div>
          </div>
        </section>
      </div>
      <footer class="sheet__f">
        <span class="sheet__undo">あとから解除できます。解除すると内容と版を削除します。</span>
        <span class="grow"></span>
        <button class="btn">キャンセル${kbd('esc')}</button>
        <button class="btn btn--space is-focus">4人に共有${kbd('⏎')}</button>
      </footer>
    </div>
  </div>`;
}

function palette() {
  const row = (ic, title, meta, key = '', cls = '') => `
    <div class="pal__r ${cls}">${ic}<span class="pal__t">${title}</span><span class="pal__m">${meta}</span><span class="grow"></span>${key}</div>`;
  return `
  <div class="overlay">
    <div class="pal" role="dialog" aria-label="コマンド">
      <div class="pal__field">
        ${icon('search')}
        <span class="pal__q">タームシート<i class="caret"></i></span>
        <span class="grow"></span>
        <span class="pal__scope">${swatch('fund')}資金調達 2027</span>
      </div>
      <div class="pal__list">
        <div class="pal__sec">開く</div>
        ${row(icon('pdf'), 'タームシート案.pdf', `開いているタブ${stateGlyph('shared')}共有中`, kbd('⏎'), 'is-sel')}
        ${row(icon('search'), '「タームシート」を検索', 'Web')}
        ${row(icon('globe'), 'タームシートの読み方と交渉の要点', 'startup-houmu.jp/termsheet')}
        <div class="pal__sec">Space に聞く</div>
        ${row(icon('inspector'), '「タームシート」について 資金調達 2027 に聞く', '共有 41件 ・ Claude', kbd('⌘⏎'))}
        <div class="pal__sec">共有物</div>
        ${row(icon('pdf'), 'タームシート案（J-KISS）', 'PDF ・ 久保 蓮 ・ 11/24 ・ 第1版')}
        ${row(icon('doc'), '面談メモ：Kaede Capital', 'Google ドキュメント ・ 三上 遥 ・ 11/20')}
        <div class="pal__sec">このタブと Space</div>
        ${row(icon('frame'), 'このタブを 資金調達 2027 に共有…', '投資家向けピッチ v3', kbd('⇧⌘S'))}
        ${row(swatch('hire', 'sw--glyph'), 'Space を切り替え：採用', '共有 18件 ・ 3人', kbd('⌃2'))}
        ${row(swatch('prod', 'sw--glyph'), 'Space を切り替え：プロダクト', '共有 63件 ・ 4人', kbd('⌃3'))}
      </div>
      <div class="pal__foot">
        <span>${kbd('⏎')}開く</span><span>${kbd('⌘⏎')}Space に聞く</span><span>${kbd('↑↓')}移動</span><span class="grow"></span><span>${kbd('esc')}閉じる</span>
      </div>
    </div>
  </div>`;
}

/* ---------- Tiger's own pages ---------- */
function spaceHome() {
  const msg = (who, time, body) => `
    <div class="msg">
      <div class="msg__h">${avatar(who)}<b>${MEMBERS[who].name}</b><time>${time}</time></div>
      <p class="msg__q">${body}</p>
    </div>`;
  const itemRow = (it) => {
    const src = SOURCES[it.src];
    return `
    <div class="audit__r ${it.fresh ? 'is-fresh' : ''}">
      <span class="audit__title">${icon(src.glyph)}<span>${it.title}</span></span>
      <span class="audit__src">${src.label}</span>
      <span class="audit__by">${avatar(it.by, 'av--s')}${MEMBERS[it.by].name}</span>
      <span class="audit__when">${it.when}</span>
      <span class="audit__ver">第${it.ver}版</span>
      <button class="audit__un">共有を解除</button>
    </div>`;
  };
  return `
  <div class="sp">
    <header class="sp__head">
      ${swatch('fund', 'sw--l')}
      <h1>資金調達 2027</h1>
      <span class="sp__meta">共有 42件 ・ メンバー 4人</span>
      <span class="grow"></span>
      <button class="btn">${icon('people')}メンバー</button>
      <button class="btn">${icon('plus')}招待</button>
    </header>
    <div class="sp__cols">
      <section class="sp__thread">
        <div class="sech"><h2>スレッド</h2><span>今日</span></div>
        <div class="sp__msgs">
          ${msg('hayase', '12:21', 'Kaede Capital の佐伯さんから、来週の面談の前に調達額の上限を確認したいと連絡がありました。')}
          ${msg('kubo', '12:24', 'タームシート案は上限 7,000万円で出しています。ピッチと揃っているか見てもらえますか。')}
          ${msg('mikami', '12:26', '<span class="mention">@Claude</span> ピッチ v3 とタームシート案で、条件が食い違っている箇所を挙げてください。')}
          <div class="msg msg--ai">
            <div class="msg__h">${aiAvatar()}<b>Claude</b><time>12:26</time><span class="msg__m">三上 遥に回答 ・ 共有 2件を参照</span></div>
            <div class="ai">
              <p>食い違いは2点です。</p>
              <ol>
                <li><strong>調達額</strong>ピッチ v3 は 8,000万円${cite(1)}、タームシート案は上限 7,000万円です${cite(2)}。</li>
                <li><strong>キャップ</strong>ピッチ v3 は 6億円${cite(1)}、タームシート案は 5.5億円です${cite(2)}。</li>
              </ol>
              <p>形式はどちらも J-KISS 型新株予約権で、一致しています。</p>
            </div>
            <div class="srcs">
              ${sourceRow(1, 'pitch')}
              ${sourceRow(2, 'term')}
            </div>
          </div>
          ${msg('kubo', '12:31', 'キャップは 5.5億円が最新です。ピッチ側を直してもらえると助かります。')}
        </div>
        <div class="composer composer--thread">
          <div class="composer__box">
            <div class="composer__input is-empty">スレッドに書く。@Claude で AI に質問</div>
            <div class="composer__bar">
              ${modelPicker()}
              <span class="composer__see">4人全員に見えます ・ AI は共有 42件を読みます</span>
              <span class="grow"></span>
              <button class="send" aria-label="投稿">${icon('send')}</button>
            </div>
          </div>
        </div>
      </section>
      <section class="sp__items">
        <div class="sech">
          <h2>共有物</h2><span>42件 ・ ここにあるものだけを、メンバーと AI が読めます</span>
          <span class="grow"></span>
          <div class="seg seg--s"><button class="is-on">すべて</button><button>ドキュメント 14</button><button>Slack 9</button><button>Notion 12</button><button>PDF 7</button></div>
        </div>
        <div class="audit">
          <div class="audit__r audit__r--h"><span>タイトル</span><span>ソース</span><span>共有した人</span><span>日時</span><span>版</span><span></span></div>
          ${ITEMS.map(itemRow).join('')}
          <div class="audit__r audit__r--tomb">
            <span class="audit__title">${icon('frameOff')}<span>給与テーブル案</span></span>
            <span class="audit__src">Notion</span>
            <span class="audit__by">${avatar('hayase', 'av--s')}早瀬 美月</span>
            <span class="audit__when">11/19</span>
            <span class="audit__tombnote">解除済み ・ 内容は削除、記録のみ</span>
          </div>
        </div>
        <div class="audit__more">ほか 29件 ・ 解除の記録 1件</div>
      </section>
    </div>
  </div>`;
}

function miniMount(state, title, body) {
  return `
  <div class="lg">
    <div class="lg__m lg__m--${state}" ${state === 'once' ? 'data-ring="once"' : ''}><div class="lg__p"><i></i><i></i><i></i></div><div class="lg__s">${stateGlyph(state)}</div></div>
    <div class="lg__c"><b>${title}</b><span>${body}</span></div>
  </div>`;
}

function firstRun() {
  const colors = ['fund', 'hire', 'prod', 'plum', 'slate'];
  return `
  <div class="fr">
    <div class="fr__form">
      <div class="fr__hello">haruka@minamo.jp でサインインしました</div>
      <h1>最初の Space を作成</h1>
      <p class="fr__lead">Space は、あなたが共有したページだけを AI が読める場所です。ひとりで使えます。メンバーはあとから招待できます。</p>
      <label class="lbl">名前</label>
      <div class="input is-focus">資金調達 2027<i class="caret"></i></div>
      <label class="lbl">色</label>
      <div class="colors">${colors.map((c, i) => `<i class="colors__c ${i === 0 ? 'is-on' : ''}" data-c="${c}"></i>`).join('')}<span>ページの枠とタブに付く色です</span></div>
      <label class="lbl">メンバー<small>任意</small></label>
      <div class="input is-empty">メールアドレス（カンマで区切って複数）</div>
      <div class="fr__me">${avatar(ME)}<span>三上 遥</span><small>自分 ・ 管理者</small></div>
      <div class="fr__go">
        <button class="btn btn--primary btn--l">ひとりで始める${kbd('⏎')}</button>
        <span>招待しなくても、共有、質問、書き出しのすべてを使えます。</span>
      </div>
    </div>
    <div class="fr__legend">
      <h2>ページの枠が、いま誰に見えているかを示します</h2>
      ${miniMount('idle', '枠なし ・ この Mac のみ', 'すべてのタブはここから始まります。どこにも送られません。')}
      ${miniMount('once', '破線 ・ 次の1通に添付', 'AI が1回だけ読みます。チームには共有されません。')}
      ${miniMount('shared', 'Space の色 ・ 共有中', '確認した内容を、Space のメンバーと AI が読めます。')}
      ${miniMount('sealed', '斜線 ・ 共有できません', '銀行、メールの本文、パスワード管理、プライベートウインドウ。')}
    </div>
  </div>`;
}

/* ---------- screens ---------- */
const SCREENS = {
  '01-browse': ({ theme }) =>
    win({ theme, toolbarHTML: toolbar({ tabs: BASE_TABS, active: 'docs' }), mountHTML: mount({ frame: 'idle', page: webDocs() }) }),

  '02-sidepanel-chat': ({ theme }) =>
    win({
      theme,
      toolbarHTML: toolbar({ tabs: BASE_TABS, active: 'docs', tight: true, inspector: true, fieldState: 'once' }),
      mountHTML: mount({ frame: 'once', page: webDocs() }),
      inspectorHTML: inspectorAsk(),
    }),

  /* Mid-answer. The message carrying the page has been sent, so the frame is idle again. */
  '02b-sidepanel-streaming': ({ theme }) =>
    win({
      theme,
      toolbarHTML: toolbar({ tabs: BASE_TABS, active: 'docs', tight: true, inspector: true }),
      mountHTML: mount({ frame: 'idle', page: webDocs() }),
      inspectorHTML: inspectorAskStreaming(),
    }),

  '03-share-preview': ({ theme }) =>
    win({
      theme,
      toolbarHTML: toolbar({ tabs: BASE_TABS, active: 'docs', fieldState: 'pending' }),
      mountHTML: mount({ frame: 'pending', page: webDocs() }),
      overlayHTML: shareSheet(),
    }),

  '04-space-home': ({ theme }) =>
    win({
      theme,
      toolbarHTML: toolbar({ tabs: ['slack', 'docs', 'space', 'pdf', 'news'], active: 'space', shared: ['docs'], fieldState: 'shared' }),
      mountHTML: mount({ frame: 'shared', stripKind: 'space', page: spaceHome(), pageCls: 'page--own' }),
    }),

  '05-blocked-private': ({ theme }) => `
    <div class="desk">
      ${win({
        theme,
        cls: 'win--back',
        toolbarHTML: toolbar({ tabs: ['slack', 'docs', 'bank', 'pdf', 'news'], active: 'bank', tight: true, inspector: true, shared: ['docs'], fieldState: 'sealed', canShare: false }),
        mountHTML: mount({ frame: 'sealed', page: webBank() }),
        inspectorHTML: inspectorPageSealed(),
      })}
      ${privateWindow()}
    </div>`,

  '06-first-run': ({ theme }) =>
    win({
      theme,
      space: 'fund',
      toolbarHTML: toolbar({ tabs: ['welcome'], active: 'welcome', noSpace: true, canShare: false, canAsk: false }),
      mountHTML: mount({ frame: 'idle', stripKind: 'firstRun', page: firstRun(), pageCls: 'page--own' }),
    }),

  '07-dark': () => SCREENS['04-space-home']({ theme: 'dark' }),
  '07b-dark-sidepanel': () => SCREENS['02-sidepanel-chat']({ theme: 'dark' }),

  '08-command': ({ theme }) =>
    win({
      theme,
      toolbarHTML: toolbar({ tabs: BASE_TABS, active: 'docs' }),
      mountHTML: mount({ frame: 'idle', page: webDocs() }),
      overlayHTML: palette(),
    }),

  /* Signature: the frame closes. a = confirm pressed, b = 300 ms, c = settled. */
  '09-signature-a': ({ theme }) =>
    win({
      theme,
      toolbarHTML: toolbar({ tabs: BASE_TABS, active: 'docs', fieldState: 'pending' }),
      mountHTML: mount({ frame: 'pending', page: webDocs() }),
      overlayHTML: `<div class="overlay"><div class="tcode">0 ms ・ 「4人に共有」を押した直後。プレビューが閉じ、枠は破線のまま</div></div>`,
    }),
  '09-signature-b': ({ theme }) =>
    win({
      theme,
      toolbarHTML: toolbar({ tabs: BASE_TABS, active: 'docs', fieldState: 'pending' }),
      mountHTML: mount({ frame: 'drawing', stripKind: 'sharing', page: webDocs(), progress: 0.8 }),
      overlayHTML: `<div class="overlay"><div class="tcode">300 ms ・ 帯が Space の色で満ち、枠が左右から上へ閉じていく</div></div>`,
    }),
  '09-signature-c': ({ theme }) =>
    win({
      theme,
      toolbarHTML: toolbar({ tabs: BASE_TABS, active: 'docs', fieldState: 'shared' }),
      mountHTML: mount({ frame: 'shared', stripKind: 'justShared', page: webDocs() }),
      overlayHTML: `<div class="overlay"><div class="tcode">620 ms ・ 枠が閉じた。ページの大きさは一度も変わっていない</div></div>`,
    }),

  /* The same transition, animated. Not a screenshot: open it in a browser. Click to replay. */
  '09-signature-live': ({ theme }) =>
    win({
      theme,
      toolbarHTML: toolbar({ tabs: BASE_TABS, active: 'docs', fieldState: 'shared' }),
      mountHTML: mount({ frame: 'live', stripKind: 'justShared', page: webDocs() }),
    }),

  '10-page-inspector': ({ theme }) =>
    win({
      theme,
      toolbarHTML: toolbar({ tabs: BASE_TABS, active: 'docs', tight: true, inspector: true, fieldState: 'shared' }),
      mountHTML: mount({ frame: 'shared', page: webDocs() }),
      inspectorHTML: inspectorPageShared(),
    }),
};

function privateWindow() {
  return `
  <div class="win win--private" data-theme="dark" data-space="none" lang="ja">
    <div class="main">
      <header class="tb">
        ${trafficLights()}
        <span class="privtag">${icon('eyeOff')}プライベート</span>
        <div class="nav">
          <button class="ib" aria-label="戻る">${icon('back')}</button>
          <button class="ib" aria-label="進む" disabled>${icon('forward')}</button>
        </div>
        <div class="tabs">${commandField('search', { state: 'sealed', hint: false })}<button class="ib tabs__new" aria-label="新しいタブ">${icon('plus')}</button></div>
      </header>
      ${mount({ frame: 'sealed', stripKind: 'private', page: webSearch() })}
    </div>
  </div>`;
}
