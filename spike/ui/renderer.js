'use strict';
/* global spike */
const $ = (id) => document.getElementById(id);
let current = null;
const checkEls = new Map();

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
  }
  for (const k of kids) n.append(k);
  return n;
}

function buildChecks(checks) {
  const root = $('checks');
  root.textContent = '';
  checkEls.clear();
  for (const c of checks) {
    const note = el('textarea', { placeholder: 'メモ (note): 何が起きたか', onchange: (e) => spike.setCheck(c.id, { note: e.target.value }) });
    const mk = (status, text) => el('button', { class: `btn-${status}`, onclick: () => spike.setCheck(c.id, { status }) }, text);
    const pass = mk('pass', 'Pass'); const fail = mk('fail', 'Fail'); const skip = mk('skip', 'Skip');
    const auto = el('div', { class: 'auto' });
    const actionBtn = c.action === 'export-test'
      ? el('button', { onclick: async (e) => { const b = e.currentTarget; b.disabled = true; const r = await spike.exportTest(); b.disabled = false; auto.textContent = r.message; } }, '書き出しテスト (run)')
      : el('button', { onclick: () => spike.openCheck(c.id), title: c.url || 'Docs タブで続ける' }, '開く (open)');
    const box = el('div', { class: 'check' },
      el('div', { class: 'row' },
        el('div', { class: 'label' }, c.ja + ' ', el('span', { class: 'en' }, `(${c.en})`)),
        actionBtn),
      el('div', { class: 'hint' }, c.hint || ''),
      el('div', { class: 'row' }, pass, fail, skip),
      auto, note);
    root.append(box);
    checkEls.set(c.id, { box, pass, fail, skip, note, auto });
  }
}

function render(s) {
  current = s;
  if (checkEls.size !== s.checks.length) buildChecks(s.checks);
  // tabs
  const tabsEl = $('tabs');
  tabsEl.textContent = '';
  for (const t of s.tabs) {
    const node = el('span', { class: `tab${t.id === s.activeId ? ' active' : ''}${t.loading ? ' loading' : ''}${t.blocked ? ' blocked' : ''}`, title: t.url, onmousedown: (e) => { if (e.button === 1) spike.closeTab(t.id); else spike.activate(t.id); } },
      el('span', { class: 'spin' }), el('span', { class: 't' }, (t.blocked ? '⚠ ' : '') + (t.title || t.url || '新しいタブ')),
      el('button', { class: 'x', title: '閉じる (Close)', onmousedown: (e) => { e.stopPropagation(); spike.closeTab(t.id); } }, '×'));
    tabsEl.append(node);
  }
  const active = s.tabs.find(t => t.id === s.activeId);
  if (document.activeElement !== $('address')) $('address').value = active ? active.url : '';
  $('back').disabled = !s.canGoBack; $('forward').disabled = !s.canGoForward;
  $('empty').style.display = s.tabs.length ? 'none' : 'flex';
  $('empty').style.right = s.panelVisible ? '420px' : '0';
  $('panel').classList.toggle('hidden', !s.panelVisible);
  $('uabadge').textContent = `UA: ${s.uaMode}`;
  const e = s.env;
  $('env').textContent = `Electron ${e.versions.electron} / Chromium ${e.versions.chromium} / Node ${e.versions.node} / ${e.os.platform} ${e.os.systemVersion || e.os.release} / UA: ${e.userAgentHeader}`;
  // checks
  for (const c of s.checks) {
    const r = checkEls.get(c.id);
    r.box.className = `check ${c.status}`;
    r.pass.classList.toggle('on', c.status === 'pass');
    r.fail.classList.toggle('on', c.status === 'fail');
    r.skip.classList.toggle('on', c.status === 'skip');
    if (c.action !== 'export-test') r.auto.textContent = c.auto ? `自動検出 (auto-detected): ${c.auto.id} — ${c.auto.url}` : '';
    if (document.activeElement !== r.note) r.note.value = c.note || '';
  }
  $('mdpath').textContent = s.reportPaths.md;
  $('jsonpath').textContent = s.reportPaths.json;
  $('log').textContent = s.events.slice().reverse().map(ev => {
    const { at, type, ...rest } = ev;
    return `${at.slice(11, 19)} ${type} ${JSON.stringify(rest)}`;
  }).join('\n');
}

$('newtab').onclick = () => { spike.newTab(null); $('address').focus(); };
$('back').onclick = () => spike.back();
$('forward').onclick = () => spike.forward();
$('reload').onclick = () => spike.reload();
$('address').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) spike.go($('address').value); });
$('address').addEventListener('focus', () => $('address').select());
$('panelToggle').onclick = () => spike.setPanel(!(current && current.panelVisible));
$('copy').onclick = async () => { await spike.copyReport(); $('savedmsg').textContent = 'コピーしました (copied)'; setTimeout(() => { $('savedmsg').textContent = ''; }, 2500); };
$('reveal').onclick = () => spike.revealReport();
spike.onFocusAddress(() => { $('address').focus(); $('address').select(); });
spike.onState(render);
spike.getState().then(render);
