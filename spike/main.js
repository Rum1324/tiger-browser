'use strict';
// Tiger day-1 spike: a minimal Electron browser to check whether Google / Slack / Notion / M365
// sign-in and editing work inside an Electron shell. Plain JS, no build step.
//   SPIKE_UA=chrome-like (default) | electron-default | firefox-google
//   SPIKE_SMOKE=1 is set by `npm run smoke` (unattended run, see smoke.js / smoke-runner.js).

const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu, dialog, shell, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { CHECKS, detectBlock, checkForUrl } = require('./checks');

const UA_MODES = ['chrome-like', 'electron-default', 'firefox-google'];
const UA_MODE = UA_MODES.includes(process.env.SPIKE_UA) ? process.env.SPIKE_UA : 'chrome-like';
const SMOKE = process.env.SPIKE_SMOKE === '1';
const SPIKE_DIR = __dirname;
const PARTITION = 'persist:tiger-spike';
const TOP_H = 76;      // tab strip + toolbar height in the chrome UI (keep in sync with ui/index.html)
const PANEL_W = 420;   // checklist panel width

// One profile per UA mode, so an A/B run is not polluted by cookies from the other mode.
if (SMOKE && process.env.SPIKE_SMOKE_PROFILE) {
  app.setPath('userData', process.env.SPIKE_SMOKE_PROFILE);
} else {
  app.setPath('userData', path.join(app.getPath('appData'), `tiger-spike-${UA_MODE}`));
}

// ---------------------------------------------------------------- User-Agent strategy
// Electron's default UA: "... (KHTML, like Gecko) <app-name>/<ver> Chrome/156.0.8078.109 Electron/45.5.0 Safari/537.36".
// chrome-like: drop the app-name and Electron tokens and reduce the Chrome version to MAJOR.0.0.0,
// which is byte-for-byte the shape of a reduced Chrome UA (same approach as Min's UASwitcher.js).
// Sec-CH-UA is left as Chromium sends it ("Chromium" + GREASE, no "Google Chrome" brand): honest
// "a Chromium browser", not a Google Chrome impersonation.
// firefox-google: chrome-like everywhere, plus a Firefox UA header on accounts.google.com only
// (Min's fallback; navigator.userAgent stays Chrome-like, so this is a mismatch Google could detect).
const ORIGINAL_UA = app.userAgentFallback;
function chromeLikeUA(ua) {
  return ua
    .replace(/\(KHTML, like Gecko\)\s.*?Chrome\//, '(KHTML, like Gecko) Chrome/')
    .replace(/\sElectron\/\S+/, '')
    .replace(/Chrome\/(\d+)\.[\d.]+/, 'Chrome/$1.0.0.0');
}
function firefoxUA() {
  // Same estimate as Min: Firefox 91 on 2021-08-10, a release roughly every 4.1 weeks.
  const v = 91 + Math.floor((Date.now() - 1628553600000) / (4.1 * 7 * 24 * 3600 * 1000));
  const plat = process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10.15'
    : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${plat}; rv:${v}.0) Gecko/20100101 Firefox/${v}.0`;
}
const UA = UA_MODE === 'electron-default' ? ORIGINAL_UA : chromeLikeUA(ORIGINAL_UA);
app.userAgentFallback = UA;

// ---------------------------------------------------------------- persistent state
const statePath = () => path.join(app.getPath('userData'), 'spike-state.json');
let state = { launchCount: 0, checks: {}, events: [] };
function loadState() {
  try { state = Object.assign(state, JSON.parse(fs.readFileSync(statePath(), 'utf8'))); } catch { /* first run */ }
  for (const c of CHECKS) if (!state.checks[c.id]) state.checks[c.id] = { status: 'untested', note: '' };
}
function saveState() {
  try { fs.writeFileSync(statePath(), JSON.stringify(state, null, 2)); } catch (e) { console.error('saveState', e.message); }
}
// Sign-in pages put the account's email address and session tokens in the query string
// (accounts.google.com/...&idnf=<email>...). The report must not carry them, so every recorded URL is
// cut down to origin + path plus the few parameters that describe the flow.
const SAFE_PARAMS = ['flowName', 'flowEntry', 'rrk', 'service', 'hl'];
function redactUrl(raw) {
  try {
    const u = new URL(raw);
    const kept = SAFE_PARAMS.filter(k => u.searchParams.has(k)).map(k => `${k}=${u.searchParams.get(k)}`);
    return `${u.origin}${u.pathname}${kept.length ? '?' + kept.join('&') : ''}`;
  } catch { return typeof raw === 'string' ? raw.split('?')[0] : raw; }
}
function logEvent(type, data) {
  if (data && typeof data.url === 'string') data = Object.assign({}, data, { url: redactUrl(data.url) });
  const ev = Object.assign({ at: new Date().toISOString(), type }, data);
  state.events.push(ev);
  if (state.events.length > 300) state.events.splice(0, state.events.length - 300);
  console.log('[event]', type, JSON.stringify(data));
  changed();
  return ev;
}

// ---------------------------------------------------------------- environment / report
const env = {
  uaMode: UA_MODE,
  userAgentHeader: UA,
  originalElectronUA: ORIGINAL_UA,
  versions: { electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node, v8: process.versions.v8 },
  os: { platform: process.platform, arch: os.arch(), release: os.release(), systemVersion: process.getSystemVersion ? process.getSystemVersion() : null },
  locale: null, navigator: null, cookiesAtLaunch: null,
};
const REPORT_JSON = path.join(SPIKE_DIR, 'spike-report.json');
const REPORT_MD = path.join(SPIKE_DIR, 'spike-report.md');

function buildRun() {
  return {
    updatedAt: new Date().toISOString(),
    launchCount: state.launchCount,
    env,
    checks: CHECKS.map(c => Object.assign({ id: c.id, label: `${c.ja} (${c.en})` }, state.checks[c.id])),
    events: state.events.slice(-120),
  };
}
function renderMd(report) {
  const icon = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP', untested: '-' };
  let md = `# Tiger Electron spike report\n\nGenerated: ${report.generatedAt}\n`;
  for (const [mode, run] of Object.entries(report.runs)) {
    const e = run.env;
    md += `\n## UA mode: ${mode} (launches: ${run.launchCount}, updated ${run.updatedAt})\n\n`;
    md += `- Electron ${e.versions.electron} / Chromium ${e.versions.chromium} / Node ${e.versions.node}\n`;
    md += `- OS: ${e.os.platform} ${e.os.systemVersion || e.os.release} (${e.os.arch}), locale ${e.locale}\n`;
    md += `- UA header: \`${e.userAgentHeader}\`\n`;
    if (e.navigator) md += `- navigator.userAgent: \`${e.navigator.userAgent}\`\n- Sec-CH-UA brands: \`${JSON.stringify(e.navigator.brands)}\`\n`;
    if (e.cookiesAtLaunch) md += `- Login cookies present at launch: \`${JSON.stringify(e.cookiesAtLaunch)}\`\n`;
    md += `\n| Check | Result | Note | Auto-detected block |\n|---|---|---|---|\n`;
    for (const c of run.checks) {
      const auto = c.auto ? `${c.auto.id} @ ${c.auto.url}` : '';
      md += `| ${c.label} | ${icon[c.status] || c.status} | ${(c.note || '').replace(/\|/g, '/').replace(/\n/g, ' ')} | ${auto.replace(/\|/g, '/')} |\n`;
    }
    const notable = run.events.filter(ev => ev.type !== 'navigate').slice(-25);
    if (notable.length) {
      md += `\nEvents (last ${notable.length}):\n\n`;
      for (const ev of notable) { const { at, type, ...rest } = ev; md += `- ${at} ${type} ${JSON.stringify(rest)}\n`; }
    }
  }
  return md;
}
let reportPaths = { json: REPORT_JSON, md: REPORT_MD };
function writeReport() {
  if (SMOKE) return; // the smoke run writes its own files into smoke-out/
  let report = { generatedAt: new Date().toISOString(), runs: {} };
  try { report.runs = JSON.parse(fs.readFileSync(REPORT_JSON, 'utf8')).runs || {}; } catch { /* new */ }
  report.runs[UA_MODE] = buildRun();
  const md = renderMd(report);
  try {
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
    fs.writeFileSync(REPORT_MD, md);
    reportPaths = { json: REPORT_JSON, md: REPORT_MD };
  } catch (e) { // spike folder not writable: fall back to the profile folder
    const j = path.join(app.getPath('userData'), 'spike-report.json');
    const m = path.join(app.getPath('userData'), 'spike-report.md');
    fs.writeFileSync(j, JSON.stringify(report, null, 2)); fs.writeFileSync(m, md);
    reportPaths = { json: j, md: m };
  }
  return md;
}

// ---------------------------------------------------------------- window + tabs
let win = null;
let panelVisible = true;
const tabs = new Map();
let activeId = null;
let nextTabId = 1;
let pushTimer = null;
function changed() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => { pushTimer = null; pushState(); saveState(); writeReport(); }, 150);
}
function snapshot() {
  const t = tabs.get(activeId);
  const nh = t && !t.destroyed && !t.wc.isDestroyed() ? t.wc.navigationHistory : null;
  return {
    uaMode: UA_MODE, env, reportPaths, panelVisible,
    activeId,
    canGoBack: nh ? nh.canGoBack() : false,
    canGoForward: nh ? nh.canGoForward() : false,
    tabs: [...tabs.values()].map(x => ({ id: x.id, title: x.title, url: x.url, loading: x.loading, checkId: x.checkId, blocked: !!x.block })),
    checks: CHECKS.map(c => Object.assign({}, c, state.checks[c.id])),
    events: state.events.slice(-40),
  };
}
function pushState() { if (win && !win.isDestroyed()) win.webContents.send('state', snapshot()); }

function layout() {
  if (!win || win.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  const pw = panelVisible ? PANEL_W : 0;
  for (const t of tabs.values()) {
    const vis = t.id === activeId;
    t.view.setVisible(vis);
    if (vis) t.view.setBounds({ x: 0, y: TOP_H, width: Math.max(200, w - pw), height: Math.max(100, h - TOP_H) });
  }
}

function webPrefs() {
  // Tabs run untrusted web content: no Node, isolated, sandboxed, persistent partition.
  return { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true,
    preload: path.join(SPIKE_DIR, 'ui', 'tab-preload.js') }; // only fixes Notification.permission, see that file
}

function createTab(url, opts = {}) {
  const id = nextTabId++;
  const view = opts.adopt
    ? new WebContentsView({ webPreferences: opts.adopt.webPreferences, webContents: opts.adopt.webContents })
    : new WebContentsView({ webPreferences: webPrefs() });
  view.setBackgroundColor('#ffffff');
  const tab = { id, view, wc: view.webContents, destroyed: false, url: url || '', title: '新しいタブ', loading: false, checkId: opts.checkId || null, status: null, block: null, openerId: opts.openerId || null };
  tabs.set(id, tab);
  win.contentView.addChildView(view);
  wireTab(tab);
  activeId = id;
  layout();
  if (url) tab.wc.loadURL(url).catch(err => logEvent('load-error', { tab: id, url, error: String(err.message || err) }));
  tab.wc.focus();
  changed();
  return tab;
}

function closeTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  tabs.delete(id);
  try { win.contentView.removeChildView(t.view); } catch { /* window gone */ }
  // Never read t.view.webContents here: in Electron 45 that getter hangs the main process once an
  // adopted popup webContents has been destroyed (found by the smoke run). Use our own t.wc ref.
  if (!t.destroyed && !t.wc.isDestroyed()) t.wc.close();
  if (activeId === id) {
    const rest = [...tabs.keys()];
    activeId = t.openerId && tabs.has(t.openerId) ? t.openerId : (rest.length ? rest[rest.length - 1] : null);
  }
  layout();
  changed();
}

function activate(id) {
  if (!tabs.has(id)) return;
  activeId = id;
  layout();
  tabs.get(id).wc.focus();
  changed();
}

function wireTab(tab) {
  const wc = tab.wc; // UA comes from the session (setupSession), popups included

  // window.open / target=_blank -> new tab. We return action 'allow' with createWindow so the new
  // tab keeps window.opener: OAuth popups ("Continue with Google" in Notion/Slack, M365, Google
  // Identity Services) post their result back to the opener and break if opened as a plain tab.
  wc.setWindowOpenHandler(({ url, disposition }) => {
    logEvent('window-open', { from: tab.url, url, disposition });
    return {
      action: 'allow',
      outlivesOpener: true,
      createWindow: (options) => createTab(null, { adopt: options, checkId: tab.checkId, openerId: tab.id }).wc,
    };
  });
  wc.on('did-start-loading', () => { tab.loading = true; changed(); });
  wc.on('did-stop-loading', () => { tab.loading = false; changed(); scanTab(tab); });
  wc.on('did-navigate', (_e, url, code, text) => {
    tab.url = url; tab.status = code; tab.block = null;
    logEvent('navigate', { tab: tab.id, url, status: code, statusText: text });
  });
  wc.on('did-navigate-in-page', (_e, url, isMain) => { if (isMain) { tab.url = url; changed(); } });
  wc.on('page-title-updated', (_e, title) => { tab.title = title; changed(); });
  wc.on('did-finish-load', () => { scanTab(tab); captureNavigatorOnce(wc); });
  wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (isMain && code !== -3) logEvent('load-failed', { tab: tab.id, url, code, desc });
  });
  wc.on('render-process-gone', (_e, d) => logEvent('renderer-gone', { tab: tab.id, url: tab.url, reason: d.reason }));
  // A page calling window.close() destroys its webContents. Remove the tab on the next tick:
  // touching the view synchronously inside 'destroyed' can wedge the main process.
  wc.on('destroyed', () => { tab.destroyed = true; setImmediate(() => { if (tabs.has(tab.id)) closeTab(tab.id); }); });
  wc.on('before-input-event', (e, input) => {
    // Cmd/Ctrl+L focuses the address bar even when the page has focus.
    if (input.type === 'keyDown' && (input.meta || input.control) && input.key.toLowerCase() === 'l') {
      e.preventDefault(); win.webContents.focus(); win.webContents.send('focus-address');
    }
  });
}

let navigatorCaptured = false;
async function captureNavigatorOnce(wc) {
  if (navigatorCaptured) return;
  try {
    const nav = await wc.executeJavaScript(`(async () => ({
      userAgent: navigator.userAgent,
      brands: navigator.userAgentData ? navigator.userAgentData.brands : null,
      fullVersionList: navigator.userAgentData ? (await navigator.userAgentData.getHighEntropyValues(['fullVersionList','platformVersion'])) : null,
      webdriver: navigator.webdriver,
      languages: navigator.languages,
      windowChromeKeys: window.chrome ? Object.keys(window.chrome) : null,
      platformAuthenticator: window.PublicKeyCredential ? await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable() : null,
      notificationPermission: typeof Notification !== 'undefined' ? Notification.permission : null,
    }))()`);
    env.navigator = nav;
    navigatorCaptured = true;
    changed();
  } catch { /* page navigated away; try on next load */ }
}

async function scanTab(tab) {
  const wc = tab.wc;
  if (tab.destroyed || wc.isDestroyed() || !tab.url.startsWith('http')) return null;
  let text = '';
  try { text = await wc.executeJavaScript('document.body ? document.body.innerText.slice(0, 30000) : ""', true); } catch { return null; }
  const hit = detectBlock(wc.getURL(), text);
  if (!hit) return null;
  hit.url = redactUrl(hit.url);
  if (tab.block && tab.block.id === hit.id && tab.block.url === hit.url) return hit;
  tab.block = hit;
  const checkId = tab.checkId || checkForUrl(hit.url);
  logEvent(hit.hard ? 'block-detected' : 'possible-block', { tab: tab.id, check: checkId, pattern: hit.id, match: hit.match, url: hit.url, status: tab.status });
  if (hit.hard && checkId && state.checks[checkId]) {
    const c = state.checks[checkId];
    c.status = 'fail';
    c.auto = { id: hit.id, match: hit.match, url: hit.url, at: new Date().toISOString() };
    if (!c.note.includes(hit.id)) c.note = `[自動検出 auto] ${hit.id}${c.note ? ' / ' + c.note : ''}`;
  }
  changed();
  return hit;
}
setInterval(() => { for (const t of tabs.values()) if (!t.loading) scanTab(t); }, 2500).unref();

function normalizeUrl(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.startsWith('about:')) return s;
  if (!/\s/.test(s) && /^[^/]+\.[a-z]{2,}(\/|$|:)/i.test(s)) return 'https://' + s;
  return 'https://www.google.com/search?q=' + encodeURIComponent(s);
}

// ---------------------------------------------------------------- session: downloads, permissions, Firefox UA
const permissionDecisions = new Map(); // "origin permission" -> boolean (persisted in state.permissions)
ipcMain.on('perm:notifications', (e, origin) => {
  const d = permissionDecisions.get(origin + ' notifications');
  e.returnValue = d === undefined ? 'default' : (d ? 'granted' : 'denied');
});
function setupSession(ses) {
  ses.setUserAgent(UA);
  if (UA_MODE === 'firefox-google') {
    const ff = firefoxUA();
    ses.webRequest.onBeforeSendHeaders({ urls: ['https://accounts.google.com/*'] }, (details, cb) => {
      details.requestHeaders['User-Agent'] = ff;
      cb({ requestHeaders: details.requestHeaders });
    });
  }
  ses.on('will-download', (_e, item) => {
    const dir = app.getPath('downloads');
    let name = item.getFilename() || 'download';
    let target = path.join(dir, name);
    for (let i = 1; fs.existsSync(target); i++) target = path.join(dir, name.replace(/(\.[^.]*)?$/, ` (${i})$1`));
    item.setSavePath(target);
    logEvent('download-started', { url: item.getURL().slice(0, 200), file: target });
    item.once('done', (_ev, st) => {
      logEvent('download-done', { file: target, state: st, bytes: item.getReceivedBytes() });
      const c = state.checks.download;
      if (st === 'completed' && !c.note.includes(path.basename(target))) c.note = `[auto] saved ${path.basename(target)}${c.note ? ' / ' + c.note : ''}`;
      changed();
    });
  });
  for (const [k, v] of Object.entries(state.permissions || {})) permissionDecisions.set(k, v);
  // Electron's default check handler answers 'granted' for everything; report notifications as
  // granted only after the user allowed them here.
  ses.setPermissionCheckHandler((_wc, permission, origin) =>
    permission === 'notifications' ? permissionDecisions.get(origin + ' notifications') === true : true);
  const ASK = new Set(['notifications', 'media', 'clipboard-read']);
  const DENY = new Set(['geolocation', 'midi', 'midiSysex', 'idle-detection']); // not needed for the spike; avoid modal noise
  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    const origin = (() => { try { return new URL(details.requestingUrl || wc.getURL()).origin; } catch { return '?'; } })();
    if (DENY.has(permission)) { logEvent('permission-auto-denied', { origin, permission }); return callback(false); }
    if (!ASK.has(permission)) return callback(true); // e.g. clipboard-sanitized-write, fullscreen, pointerLock
    const key = origin + ' ' + permission;
    if (permissionDecisions.has(key)) return callback(permissionDecisions.get(key));
    if (SMOKE) { logEvent('permission-request', { origin, permission, decision: 'deny (smoke)' }); return callback(false); }
    const r = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['許可 (Allow)', 'ブロック (Block)'], defaultId: 0, cancelId: 1,
      message: `${origin} が「${permission}」の許可を求めています`, detail: 'Tiger spike permission prompt',
    });
    const ok = r.response === 0;
    permissionDecisions.set(key, ok);
    state.permissions = Object.fromEntries(permissionDecisions);
    logEvent('permission-request', { origin, permission, decision: ok ? 'allow' : 'block' });
    if (permission === 'notifications') {
      const c = state.checks.notification;
      if (!c.note.includes('prompt shown')) c.note = `[auto] prompt shown for ${origin}${c.note ? ' / ' + c.note : ''}`;
    }
    callback(ok);
  });
}

async function recordLoginCookies(ses) {
  // Evidence for the "login persists" check: which login cookies exist at launch (names only, never values).
  const probes = { google: ['google.com', ['SID', '__Secure-1PSID']], slack: ['slack.com', ['d']], notion: ['notion.so', ['token_v2']], microsoft: ['login.microsoftonline.com', ['ESTSAUTHPERSISTENT', 'ESTSAUTH']] };
  const out = {};
  for (const [svc, [domain, names]] of Object.entries(probes)) {
    try {
      const cs = (await ses.cookies.get({ domain })).filter(c => names.includes(c.name));
      out[svc] = cs.length ? cs.map(c => `${c.name}${c.session ? '(session-only)' : ''}`).join(',') : false;
    } catch { out[svc] = 'error'; }
  }
  env.cookiesAtLaunch = out;
}

// ---------------------------------------------------------------- menu (Edit menu is required for Cmd+C/V/X/A on macOS)
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const tabWc = () => { const t = tabs.get(activeId); return t ? t.wc : null; };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: '新しいタブ (New Tab)', accelerator: 'CmdOrCtrl+T', click: () => { createTab(null); win.webContents.send('focus-address'); } },
      { label: 'タブを閉じる (Close Tab)', accelerator: 'CmdOrCtrl+W', click: () => activeId && closeTab(activeId) },
      { type: 'separator' }, isMac ? { role: 'close' } : { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: '再読み込み (Reload)', accelerator: 'CmdOrCtrl+R', click: () => tabWc() && tabWc().reload() },
      { label: '戻る (Back)', accelerator: 'CmdOrCtrl+[', click: () => tabWc() && tabWc().navigationHistory.goBack() },
      { label: '進む (Forward)', accelerator: 'CmdOrCtrl+]', click: () => tabWc() && tabWc().navigationHistory.goForward() },
      { label: 'アドレスバー (Address bar)', accelerator: 'CmdOrCtrl+L', click: () => { win.webContents.focus(); win.webContents.send('focus-address'); } },
      { type: 'separator' },
      { label: 'ページの開発者ツール (Page DevTools)', accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', click: () => tabWc() && tabWc().openDevTools({ mode: 'detach' }) },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
    ] },
    { role: 'windowMenu' },
  ]));
}

// ---------------------------------------------------------------- IPC from the chrome UI
function wireIpc() {
  const tabWc = () => { const t = tabs.get(activeId); return t ? t.wc : null; };
  ipcMain.handle('state:get', () => snapshot());
  ipcMain.on('tab:new', (_e, url, checkId) => createTab(normalizeUrl(url), { checkId }));
  ipcMain.on('tab:activate', (_e, id) => activate(id));
  ipcMain.on('tab:close', (_e, id) => closeTab(id));
  ipcMain.on('nav:go', (_e, input) => {
    const url = normalizeUrl(input);
    if (!url) return;
    if (!activeId) return createTab(url);
    tabWc().loadURL(url).catch(() => {});
    tabWc().focus();
  });
  ipcMain.on('nav:back', () => { const w = tabWc(); if (w && w.navigationHistory.canGoBack()) w.navigationHistory.goBack(); });
  ipcMain.on('nav:forward', () => { const w = tabWc(); if (w && w.navigationHistory.canGoForward()) w.navigationHistory.goForward(); });
  ipcMain.on('nav:reload', () => { const w = tabWc(); if (w) w.reload(); });
  ipcMain.on('check:open', (_e, id) => {
    const c = CHECKS.find(x => x.id === id);
    if (!c) return;
    // Sub-checks without their own URL (Docs typing etc.) continue in the current Docs tab if any.
    if (!c.url) {
      const docs = [...tabs.values()].find(t => t.url.includes('docs.google.com/document'));
      if (docs) { docs.checkId = id; return activate(docs.id); }
      return createTab('https://docs.google.com/document/create', { checkId: id });
    }
    createTab(c.url, { checkId: id });
  });
  ipcMain.on('check:set', (_e, id, patch) => {
    const c = state.checks[id];
    if (!c) return;
    if (patch.status) { c.status = patch.status; c.at = new Date().toISOString(); }
    if (typeof patch.note === 'string') c.note = patch.note.slice(0, 2000);
    changed();
  });
  // Capture path check: Tiger plans to read a Google Doc as Markdown through the member's own signed-in
  // session (no OAuth). Only status, content type and length are recorded, never the document text.
  ipcMain.handle('check:exportTest', async () => {
    const c = state.checks['docs-export'];
    const t = tabs.get(activeId);
    const m = t && /^https:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([^/]+)/.exec(t.url || '');
    if (!m) {
      logEvent('export-test', { ok: false, reason: 'active tab is not a Google Doc' });
      return { ok: false, message: 'Google ドキュメントのタブを開いてから押してください。' };
    }
    const ses = session.fromPartition(PARTITION);
    const results = [];
    for (const format of ['md', 'txt']) {
      const r = { format };
      try {
        const res = await ses.fetch(`https://docs.google.com/document/d/${m[1]}/export?format=${format}`, { redirect: 'follow' });
        const body = await res.text();
        r.status = res.status;
        r.contentType = res.headers.get('content-type') || '';
        r.finalHost = (() => { try { return new URL(res.url).hostname; } catch { return ''; } })();
        r.chars = body.length;
        // A sign-in or error page comes back as HTML; a real export does not.
        r.looksLikeExport = res.status === 200 && !/text\/html/i.test(r.contentType) && body.trim().length > 0;
      } catch (e) {
        r.error = String(e && e.message ? e.message : e).slice(0, 200);
        r.looksLikeExport = false;
      }
      results.push(r);
    }
    const ok = results[0].looksLikeExport;
    logEvent('export-test', { ok, results });
    if (c) {
      c.status = ok ? 'pass' : 'fail';
      c.at = new Date().toISOString();
      const line = results.map(r => `${r.format}: ${r.error ? 'error ' + r.error : `HTTP ${r.status}, ${r.contentType}, ${r.chars} chars`}`).join(' | ');
      c.note = `[自動 auto] ${line}`;
    }
    changed();
    return { ok, message: ok ? `成功: Markdown ${results[0].chars} 文字を取得` : '失敗: 結果をメモ欄に記録しました' };
  });
  ipcMain.handle('report:save', () => { writeReport(); return reportPaths; });
  ipcMain.handle('report:copy', () => { const md = writeReport(); clipboard.writeText(md || ''); return reportPaths; });
  ipcMain.on('report:reveal', () => { writeReport(); shell.showItemInFolder(reportPaths.md); });
  ipcMain.on('panel:set', (_e, v) => { panelVisible = !!v; layout(); changed(); });
}

// ---------------------------------------------------------------- boot
function createMainWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600, title: `Tiger spike (${UA_MODE})`,
    backgroundColor: '#f4f4f5',
    webPreferences: { preload: path.join(SPIKE_DIR, 'ui', 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.loadFile(path.join(SPIKE_DIR, 'ui', 'index.html'));
  win.on('resize', layout);
  win.on('closed', () => { win = null; });
  return win;
}

app.whenReady().then(async () => {
  loadState();
  state.launchCount += 1;
  env.locale = app.getLocale();
  env.preferredLanguages = app.getPreferredSystemLanguages ? app.getPreferredSystemLanguages() : null;
  const ses = session.fromPartition(PARTITION);
  setupSession(ses);
  await recordLoginCookies(ses);
  logEvent('launch', { launchCount: state.launchCount, uaMode: UA_MODE, cookiesAtLaunch: env.cookiesAtLaunch });
  buildMenu();
  wireIpc();
  createMainWindow();
  win.webContents.once('did-finish-load', () => {
    if (SMOKE) require('./smoke-runner').run({ app, win, tabs, createTab, closeTab, scanTab, env, state, UA_MODE, logEvent, layout });
    else createTab('https://www.google.com/?hl=ja');
  });
});

app.on('before-quit', () => {
  // Make sure cookies written in the last seconds reach disk before we quit.
  try { session.fromPartition(PARTITION).cookies.flushStore(); } catch { /* ignore */ }
  saveState(); writeReport();
});
app.on('window-all-closed', () => app.quit());
