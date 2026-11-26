/* Chrome parts: window shell, toolbar, mount (frame + readout strip). */

const kbd = (s) => `<kbd class="kbd">${s}</kbd>`;
const swatch = (space, cls = '') => `<i class="sw ${cls}" data-space="${space}"></i>`;

function avatar(id, size = '') {
  const m = MEMBERS[id];
  return `<span class="av ${size}" title="${m.name}">${m.mono}</span>`;
}
function aiAvatar(size = '') {
  return `<span class="av av--ai ${size}">C</span>`;
}

function glyph(tab, size = 16) {
  if (tab.glyph === 'space') return swatch('fund', 'sw--glyph');
  return icon(tab.glyph, size);
}

/* The state glyph: a miniature mount (thin frame, thick bottom edge). Same four states as the page frame.
   idle = empty, once = dashed, pending = dashed in the Space colour, shared = filled, sealed = hatched. */
function stateGlyph(state) {
  return `<i class="st st--${state}"></i>`;
}

/* ---------- toolbar ---------- */
function trafficLights() {
  return `<div class="tl"><i></i><i></i><i></i></div>`;
}

function tabChip(id, { tight = false, shared } = {}) {
  const t = TABS[id];
  const isShared = shared ?? t.shared;
  const cls = ['tab', isShared ? 'tab--shared' : '', t.sealed ? 'tab--sealed' : '', tight ? 'tab--tight' : ''].join(' ');
  const state = isShared ? '資金調達 2027 に共有中' : t.sealed ? '共有できません' : 'この Mac のみ';
  return `<button class="${cls}" title="${t.title}：${state}">${glyph(t)}${tight ? '' : `<span class="tab__t">${t.title}</span>`}</button>`;
}

function commandField(id, { state = 'idle', hint = true } = {}) {
  const t = TABS[id];
  return `
  <div class="field field--${state}">
    <span class="field__g">${glyph(t)}</span>
    <span class="field__host">${t.host}</span><span class="field__sep">/</span><span class="field__title">${t.title}</span>
    <span class="grow"></span>
    <button class="ib ib--s" aria-label="再読み込み">${icon('reload', 14)}</button>
    ${hint ? kbd('⌘K') : ''}
  </div>`;
}

/**
 * tabs: ordered tab ids; active: id of the active tab (rendered as the command field).
 * shared: ids to render as shared regardless of TABS defaults.
 */
function toolbar({ tabs, active, space = 'fund', tight = false, inspector = false, fieldState = 'idle', shared = [], canShare = true, canAsk = true, noSpace = false }) {
  const strip = tabs
    .map((id) => (id === active ? commandField(id, { state: fieldState }) : tabChip(id, { tight, shared: shared.includes(id) || undefined })))
    .join('');
  const sp = SPACES[space];
  return `
  <header class="tb">
    ${trafficLights()}
    <button class="spacesw" aria-label="Space を切り替え">
      ${noSpace ? `<i class="sw sw--none"></i><span class="spacesw__n spacesw__n--none">Space なし</span>` : `${swatch(space)}<span class="spacesw__n">${sp.name}</span>`}
      ${icon('chevron', 12)}
    </button>
    <div class="nav">
      <button class="ib" aria-label="戻る">${icon('back')}</button>
      <button class="ib" aria-label="進む" disabled>${icon('forward')}</button>
    </div>
    <div class="tabs">${strip}<button class="ib tabs__new" aria-label="新しいタブ">${icon('plus')}</button></div>
    <div class="acts">
      <button class="btn btn--tool" ${canShare ? '' : 'disabled'}>${icon('frame')}<span>共有</span></button>
      <button class="btn btn--tool ${inspector ? 'is-on' : ''}" ${canAsk ? '' : 'disabled'} aria-pressed="${inspector}">${icon('inspector')}<span>聞く</span></button>
    </div>
  </header>`;
}

/* ---------- readout strip ---------- */
/* Always the same order and the same columns: state, Space, チーム, AI. The eye learns where to look. */
const STRIPS = {
  idle: {
    state: 'この Mac のみ',
    slots: [['Space', '資金調達 2027'], ['チーム', 'このタブは見えていません'], ['AI', 'このタブは読みません']],
    act: `<button class="strip__act">Space に共有…${kbd('⇧⌘S')}</button>`,
  },
  once: {
    state: '次の1通に添付',
    slots: [['Space', '資金調達 2027'], ['チーム', 'このタブは見えていません'], ['AI', '次の1通でだけ読みます']],
    act: `<button class="strip__act">添付をやめる</button>`,
  },
  pending: {
    state: '確認中',
    slots: [['Space', '資金調達 2027'], ['チーム', 'まだ何も送っていません'], ['AI', 'まだ読めません']],
    act: '',
  },
  sharing: {
    state: '共有しています',
    slots: [['Space', '資金調達 2027'], ['チーム', '4人に届けています'], ['AI', '索引を作成中']],
    act: '',
  },
  justShared: {
    state: '共有しました',
    slots: [['Space', '資金調達 2027'], ['チーム', '4人が読めます'], ['AI', '共有 42件の1つとして読みます'], ['版', '第1版 ・ 12:06 ・ 三上 遥']],
    act: `<button class="strip__act">${icon('undo', 14)}取り消す${kbd('⌘Z')}</button>`,
  },
  shared: {
    state: '共有中',
    slots: [['Space', '資金調達 2027'], ['チーム', '4人が読めます'], ['AI', '共有 42件の1つとして読みます'], ['版', '第1版 ・ 12:06 ・ 三上 遥']],
    act: `<button class="strip__act">共有を解除</button>`,
  },
  space: {
    state: 'Space のページ',
    slots: [['Space', '資金調達 2027'], ['チーム', '4人が同じ内容を見ています'], ['AI', '共有 42件を読みます']],
    act: '',
  },
  sealed: {
    state: '共有できません',
    slots: [['理由', '銀行のページ'], ['チーム', '見えません'], ['AI', '読めません。添付もできません']],
    act: '',
  },
  firstRun: {
    state: 'この Mac のみ',
    slots: [['Space', 'まだありません'], ['チーム', '何も見えていません'], ['AI', '何も読みません']],
    act: '',
  },
  private: {
    state: 'プライベート',
    slots: [['チーム', '見えません'], ['AI', '読めません'], ['閉じると', '履歴と Cookie を消去']],
    act: '',
    free: true,
  },
};
const STRIP_GLYPH = { idle: 'idle', firstRun: 'idle', once: 'once', pending: 'pending', sharing: 'shared', justShared: 'shared', shared: 'shared', space: 'shared', sealed: 'sealed', private: 'sealed' };

function strip(kind) {
  const s = STRIPS[kind];
  return `
  <footer class="strip ${s.free ? 'strip--free' : ''}">
    <span class="strip__state">${stateGlyph(STRIP_GLYPH[kind])}${s.state}</span>
    ${s.slots.map(([l, v]) => `<span class="slot"><b>${l}</b><span>${v}</span></span>`).join('')}
    <span class="grow"></span>
    ${s.act}
  </footer>`;
}

/**
 * The mount: frame + page + strip, one object.
 * frame: idle | once | pending | drawing | live | shared | sealed
 */
function mount({ frame = 'idle', stripKind = frame, page, pageCls = '', progress = 0 }) {
  const ring = { once: 'once', pending: 'pending', drawing: 'drawing', live: 'live' }[frame] || '';
  return `
  <section class="mount mount--${frame}" ${ring ? `data-ring="${ring}" data-progress="${progress}"` : ''}>
    <div class="page ${pageCls}">${page}</div>
    ${strip(stripKind)}
  </section>`;
}

/* ---------- window shell ---------- */
function win({ theme = 'light', space = 'fund', toolbarHTML, mountHTML, inspectorHTML = '', overlayHTML = '', cls = '', style = '' }) {
  return `
  <div class="win ${cls}" data-theme="${theme}" data-space="${space}" style="${style}" lang="ja">
    <div class="main">${toolbarHTML}${mountHTML}</div>
    ${inspectorHTML}
    ${overlayHTML}
  </div>`;
}
