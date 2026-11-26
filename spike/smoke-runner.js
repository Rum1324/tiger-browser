'use strict';
// Runs inside the Electron main process when SPIKE_SMOKE=1 (started by smoke.js).
// Loads each service's unauthenticated sign-in page, records final URL / title / HTTP status /
// block text, and writes screenshots + results.json into smoke-out/<ua-mode>/.
// It never types anything into any form.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { SMOKE_TARGETS } = require('./checks');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function startLocalServer(captured) {
  // Local pages: header echo (what UA / client hints we actually send) and a window.opener test.
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname.startsWith('/echo')) captured.push({ path: u.pathname, headers: req.headers });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (u.pathname === '/echo') return res.end('<title>echo</title><body>echo<script>fetch("/echo-fetch")</script>');
    if (u.pathname === '/opener') return res.end(`<title>opener-waiting</title><body>opener test
      <script>
        window.addEventListener('message', e => { if (e.data === 'popup-has-opener') document.title = 'OPENER-OK'; });
        const w = window.open('/popup', 'spikepopup', 'width=500,height=600');
        document.body.append(' popup handle: ' + (w ? 'object' : 'null'));
        if (!w) document.title = 'POPUP-BLOCKED';
      </script>`);
    if (u.pathname === '/popup') return res.end(`<title>popup</title><body>popup
      <script>
        if (window.opener) window.opener.postMessage('popup-has-opener', '*'); else document.title = 'popup-no-opener';
        setTimeout(() => window.close(), 1500);
      </script>`);
    res.statusCode = 404; res.end('nf');
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

function waitForStop(wc, timeoutMs) {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve('timeout'), timeoutMs);
    const done = () => { clearTimeout(t); resolve('stopped'); };
    wc.once('did-stop-loading', done);
  });
}

async function visit(ctx, target, outDir, results) {
  const { createTab, closeTab, scanTab, tabs } = ctx;
  const tab = createTab(null, { checkId: null });
  const wc = tab.view.webContents;
  if (target.ua) wc.setUserAgent(target.ua);
  const navs = [];
  wc.on('did-navigate', (_e, url, code) => navs.push({ url, code }));
  wc.on('did-redirect-navigation', (d) => { if (d.isMainFrame) navs.push({ redirect: d.url }); });
  const started = Date.now();
  const stopP = waitForStop(wc, 35000);
  wc.loadURL(target.url).catch(() => {});
  const how = await stopP;
  await sleep(target.settleMs || 7000); // SPAs (Notion, Slack, M365) render after load
  let block = await scanTab(tab);
  if (!block) block = tab.block;
  let text = '';
  try { text = await wc.executeJavaScript('document.body ? document.body.innerText.replace(/\\s+/g," ").slice(0, 400) : ""'); } catch { /* ignore */ }
  const png = path.join(outDir, `${target.id}.png`);
  try { fs.writeFileSync(png, (await wc.capturePage()).toPNG()); } catch (e) { console.error('capture failed', e.message); }
  const r = {
    id: target.id, requested: target.url, finalUrl: wc.getURL(), title: wc.getTitle(), httpStatus: tab.status,
    navigations: navs, load: how, ms: Date.now() - started,
    block: block ? { id: block.id, hard: block.hard, match: block.match } : null,
    expectBlock: target.expectBlock || null,
    selftestOk: target.expectBlock ? !!(block && block.id === target.expectBlock) : undefined,
    uaOverride: target.ua || null, textStart: text, screenshot: path.relative(path.dirname(outDir), png),
  };
  results.push(r);
  console.log(`[smoke] ${r.id}: ${r.httpStatus} ${r.finalUrl.slice(0, 120)} | ${r.title} | block=${r.block ? r.block.id : '-'}`);
  return tab;
}

async function run(ctx) {
  const { app, win, tabs, createTab, closeTab, env, UA_MODE } = ctx;
  const outDir = path.join(__dirname, 'smoke-out', UA_MODE);
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  const captured = [];
  const server = await startLocalServer(captured);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // 1. headers actually sent + navigator properties
    let t = await visit(ctx, { id: 'local-header-echo', url: `${base}/echo`, settleMs: 1500 }, outDir, results);
    try {
      results[results.length - 1].navigator = await t.view.webContents.executeJavaScript(`(async () => ({
        userAgent: navigator.userAgent, webdriver: navigator.webdriver,
        brands: navigator.userAgentData && navigator.userAgentData.brands,
        windowChromeKeys: window.chrome ? Object.keys(window.chrome) : null,
        platformAuthenticator: window.PublicKeyCredential ? await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable() : null,
        notificationPermission: typeof Notification !== 'undefined' ? Notification.permission : null,
        languages: navigator.languages }))()`);
    } catch { /* ignore */ }
    results[results.length - 1].headersReceived = captured.slice();
    closeTab(t.id);

    // 2. window.open -> tab, with window.opener preserved, and window.close() closes the tab
    const before = tabs.size;
    t = await visit(ctx, { id: 'local-window-opener', url: `${base}/opener`, settleMs: 800 }, outDir, results);
    const r = results[results.length - 1];
    r.tabsAfterOpen = tabs.size; r.tabsBefore = before;
    await sleep(2500);
    r.titleAfterPopup = t.view.webContents.getTitle();
    r.tabsAfterPopupClosed = tabs.size;
    try { fs.writeFileSync(path.join(outDir, 'window-with-ui.png'), (await win.capturePage()).toPNG()); } catch { /* ignore */ }
    closeTab(t.id);

    // 3. real services
    for (const target of SMOKE_TARGETS) {
      const tab = await visit(ctx, target, outDir, results);
      if (target.id === 'google-signin') {
        try { fs.writeFileSync(path.join(outDir, 'window-with-ui-google.png'), (await win.capturePage()).toPNG()); } catch { /* ignore */ }
      }
      closeTab(tab.id);
      // close leftover popups
      for (const id of [...tabs.keys()]) closeTab(id);
    }
  } catch (e) {
    console.error('[smoke] error', e);
    results.push({ error: String(e && e.stack || e) });
  } finally {
    server.close();
  }
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ uaMode: UA_MODE, env, results, at: new Date().toISOString() }, null, 2));
  console.log('[smoke] wrote', path.join(outDir, 'results.json'));
  setTimeout(() => app.quit(), 300);
}

module.exports = { run };
