/*
 * Contrast audit for the Lens tokens.
 *
 *   node /home/user/tiger-browser/design/directions/lens/check-contrast.cjs
 *
 * Reads tokens.css, resolves the light and dark themes, and checks every text/background pair the
 * prototype uses against WCAG 2.x: 4.5:1 for text, 3:1 for the frame and other non-text marks.
 * Translucent tokens are composited over the surface they sit on. Exits non-zero on any failure.
 */
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
function block(selectorRe) {
  const out = {};
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorRe.test(m[1])) continue;
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  }
  return out;
}
const base = block(/^\s*:root\s*$/m);
const themes = {
  light: { ...base, ...block(/\[data-theme=["']light["']\]/) },
  dark: { ...base, ...block(/\[data-theme=["']light["']\]/), ...block(/\[data-theme=["']dark["']\]/) },
};

function parse(v) {
  v = v.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 1];
  m = /^rgba?\(([^)]+)\)$/.exec(v);
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x));
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  throw new Error('cannot parse colour ' + v);
}
const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
const lum = (c) => {
  const f = (x) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/* [foreground, background, minimum, where it is used] */
const PAIRS = [
  ['--ink', '--chrome', 4.5, 'toolbar text'],
  ['--ink-2', '--chrome', 4.5, 'inactive tab titles'],
  ['--ink-3', '--chrome', 4.5, 'key hints on the toolbar'],
  ['--ink', '--mount', 4.5, 'strip values, idle'],
  ['--ink-2', '--mount', 4.5, 'strip labels, idle'],
  ['--ink', '--field', 4.5, 'command field'],
  ['--ink-2', '--field', 4.5, 'command field host'],
  ['--ink-3', '--field', 4.5, 'placeholders'],
  ['--ink', '--pane', 4.5, 'inspector text'],
  ['--ink-2', '--pane', 4.5, 'inspector secondary'],
  ['--ink-3', '--pane', 4.5, 'inspector meta'],
  ['--ink', '--surface', 4.5, 'Tiger pages and sheets'],
  ['--ink-2', '--surface', 4.5, 'secondary on surface'],
  ['--ink-3', '--surface', 4.5, 'meta on surface'],
  ['--ink', '--sunken', 4.5, 'Markdown preview'],
  ['--ink-2', '--sunken', 4.5, 'ledger notes'],
  ['--ink-3', '--sunken', 4.5, 'line numbers, ledger meta'],
  ['--on-inverse', '--inverse', 4.5, 'sealed strip, default button'],
  ['--on-inverse-2', '--inverse', 4.5, 'sealed strip labels'],
  ...['fund', 'hire', 'prod'].flatMap((s) => [
    ['--on-space', `--space-${s}`, 4.5, `shared strip text (${s})`],
    ['--on-space-2', `--space-${s}`, 4.5, `shared strip labels (${s})`],
    [`--space-${s}-ink`, `--space-${s}-tint`, 4.5, `citation chip (${s})`],
    [`--space-${s}`, '--mount', 3, `frame against the idle mount (${s})`],
    [`--space-${s}-line`, '--chrome', 3, `tab ring against the toolbar (${s})`],
    [`--space-${s}-line`, '--mount', 3, `dashed pending ring against the idle mount (${s})`],
  ]),
  ['--on-space', '--space-plum', 4.5, 'swatch only'],
  ['--on-space', '--space-slate', 4.5, 'swatch only'],
  ['--ink', '--mount', 3, 'dashed ring against the idle mount'],
];

let failed = 0;
for (const [name, t] of Object.entries(themes)) {
  console.log(`\n${name}`);
  for (const [fg, bg, min, where] of PAIRS) {
    const b = parse(t[bg]);
    const f = over(parse(t[fg]), b);
    const r = ratio(f, b);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`  ${ok ? 'pass' : 'FAIL'}  ${r.toFixed(2).padStart(5)} (min ${min})  ${fg} on ${bg}  ${where}`);
  }
}
console.log(failed ? `\n${failed} pair(s) below the minimum` : '\nAll pairs pass');
process.exit(failed ? 1 : 0);
