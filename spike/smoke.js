#!/usr/bin/env node
'use strict';
// `npm run smoke`: unattended. Runs the spike once per UA mode against unauthenticated
// sign-in pages, then writes smoke-out/smoke-summary.md. On Linux without a display it
// wraps Electron in xvfb-run automatically.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const electronPath = require('electron'); // path to the Electron binary

const MODES = (process.env.SMOKE_MODES || 'chrome-like,electron-default').split(',').filter(m => m && m !== 'none');
const outRoot = path.join(__dirname, 'smoke-out');
fs.mkdirSync(outRoot, { recursive: true });

async function main() {
for (const mode of MODES) {
  const profile = path.join(outRoot, `profile-${mode}`);
  fs.rmSync(profile, { recursive: true, force: true }); // fresh, logged-out profile every run
  fs.rmSync(path.join(outRoot, mode), { recursive: true, force: true });
  const env = Object.assign({}, process.env, { SPIKE_SMOKE: '1', SPIKE_UA: mode, SPIKE_SMOKE_PROFILE: profile });
  delete env.ELECTRON_RUN_AS_NODE;
  const sb = process.platform === 'linux' ? ['--no-sandbox'] : []; // see launch.js
  let cmd = electronPath; let args = [__dirname, ...sb];
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    cmd = 'xvfb-run'; args = ['-a', '-s', '-screen 0 1440x900x24', electronPath, __dirname, ...sb];
  }
  console.log(`\n=== smoke: SPIKE_UA=${mode} ===`);
  const status = await new Promise(resolve => {
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = ''; let err = '';
    child.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.startsWith('[smoke]')) console.log(l); } });
    child.stderr.on('data', d => { err = (err + d).slice(-4000); });
    const killer = setTimeout(() => { console.error('timeout: killing electron'); child.kill('SIGKILL'); }, 12 * 60 * 1000);
    child.on('close', code => { clearTimeout(killer); if (code !== 0) console.error(`electron exited with ${code}\n${err.split('\n').slice(-15).join('\n')}`); resolve(code); });
  });
}
}

main().then(() => {
// Summary table across modes.
let md = `# Smoke run (unauthenticated)\n\nGenerated ${new Date().toISOString()}\n`;
// Summarise every mode that has results (also ones from an earlier run with SMOKE_MODES=...).
const summaryModes = fs.readdirSync(outRoot).filter(d => fs.existsSync(path.join(outRoot, d, 'results.json')));
for (const mode of summaryModes) {
  let data;
  try { data = JSON.parse(fs.readFileSync(path.join(outRoot, mode, 'results.json'), 'utf8')); } catch { md += `\n## ${mode}: no results\n`; continue; }
  md += `\n## ${mode}\n\n- UA header: \`${data.env.userAgentHeader}\`\n- Electron ${data.env.versions.electron} / Chromium ${data.env.versions.chromium} / Node ${data.env.versions.node} / ${data.env.os.platform}\n\n`;
  md += '| id | HTTP | final URL | title | block | self-test |\n|---|---|---|---|---|---|\n';
  for (const r of data.results) {
    if (r.error) { md += `| error | | ${r.error.split('\n')[0]} | | | |\n`; continue; }
    const st = r.selftestOk === undefined ? '' : (r.selftestOk ? 'ok' : 'FAILED');
    md += `| ${r.id} | ${r.httpStatus ?? ''} | ${(r.finalUrl || '').slice(0, 90)} | ${(r.title || '').replace(/\|/g, '/').slice(0, 50)} | ${r.block ? r.block.id : ''} | ${st} |\n`;
  }
}
fs.writeFileSync(path.join(outRoot, 'smoke-summary.md'), md);
console.log(`\nSummary: ${path.join(outRoot, 'smoke-summary.md')}`);
});
