/*
 * Regenerates every screenshot in shots/.
 *
 *   node /home/user/tiger-browser/design/directions/lens/render.cjs              all screens
 *   node .../render.cjs 02-sidepanel-chat 07-dark                               only these
 *
 * Needs the preinstalled Playwright and nothing else. Fonts are local woff2 subsets
 * (prototype/fonts, written by fetch-fonts.cjs). The script exits non-zero if any text on any
 * screen is drawn with a system fallback font, if a font fails to load, or if a screen overflows.
 */
const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');

/* Playwright is installed globally in this environment, not in the workspace. */
function loadPlaywright() {
  const roots = [__dirname, process.cwd(), '/opt/node-tools/', '/opt/node22/lib/node_modules/'];
  for (const r of roots) {
    try {
      return createRequire(path.join(r, 'x.cjs'))('playwright');
    } catch {}
  }
  return require('playwright');
}
const { chromium } = loadPlaywright();

const root = __dirname;
const index = 'file://' + path.join(root, 'prototype', 'index.html');
const out = path.join(root, 'shots');

const SCREENS = [
  '01-browse',
  '02-sidepanel-chat',
  '02b-sidepanel-streaming',
  '03-share-preview',
  '04-space-home',
  '05-blocked-private',
  '06-first-run',
  '07-dark',
  '07b-dark-sidepanel',
  '08-command',
  '09-signature-a',
  '09-signature-b',
  '09-signature-c',
  '10-page-inspector',
];

(async () => {
  const only = process.argv.slice(2);
  const list = only.length ? SCREENS.filter((s) => only.includes(s)) : SCREENS;
  fs.mkdirSync(out, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const problems = [];
  page.on('pageerror', (e) => problems.push(`script error: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`));

  for (const id of list) {
    await page.goto(`${index}?screen=${id}`);
    await page.waitForSelector('html[data-ready="1"]');
    /* force every declared face to load so no frame is captured in fallback */
    await page.evaluate(async () => {
      await Promise.all([...document.fonts].map((f) => f.load().catch(() => null)));
      await document.fonts.ready;
    });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    const report = await page.evaluate(() => ({
      failed: [...document.fonts].filter((f) => f.status !== 'loaded').map((f) => `${f.family} ${f.weight}`),
      overflow: document.documentElement.scrollWidth > 1440 || document.documentElement.scrollHeight > 900,
    }));
    if (report.failed.length) problems.push(`${id}: fonts not loaded: ${[...new Set(report.failed)].join(', ')}`);
    if (report.overflow) problems.push(`${id}: document overflows 1440 x 900`);

    /* Tofu check: ask Chromium which platform fonts actually drew each text node. */
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root: doc } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: doc.nodeId, selector: '#app *' });
    const bad = new Map();
    for (const nodeId of nodeIds) {
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId }).catch(() => ({ fonts: [] }));
      for (const f of fonts) if (!f.isCustomFont) bad.set(nodeId, f.familyName);
    }
    for (const [nodeId, family] of bad) {
      const { outerHTML } = await cdp.send('DOM.getOuterHTML', { nodeId });
      problems.push(`${id}: fallback font "${family}" in ${outerHTML.replace(/\s+/g, ' ').slice(0, 140)}`);
    }

    await page.screenshot({ path: path.join(out, `${id}.png`), omitBackground: true });
    console.log(`shots/${id}.png`);
  }
  await browser.close();

  if (problems.length) {
    console.error('\nProblems:\n' + [...new Set(problems)].map((p) => '  - ' + p).join('\n'));
    process.exit(1);
  }
})();
