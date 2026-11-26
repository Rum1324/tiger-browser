/*
 * WCAG contrast check for every text colour role in tokens.css, per theme.
 *
 *   node design/directions/paper/check-contrast.cjs
 *
 * Text roles must reach 4.5:1 on each surface they are used on. Exits 1 on any failure.
 * Hairlines and the hatch are not text and are not checked.
 */
const fs = require('node:fs')
const path = require('node:path')

const css = fs.readFileSync(path.join(__dirname, 'tokens.css'), 'utf8')

function block(selector) {
  const out = {}
  const re = new RegExp(`${selector.replace(/[[\]'=]/g, '\\$&')}\\s*{([^}]*)}`, 'g')
  for (const m of css.matchAll(re)) for (const d of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim()
  return out
}

const root = block(':root')
const themes = {
  light: root,
  dark: { ...root, ...block("[data-theme='dark']") },
  'private (light theme)': { ...root, ...block("[data-window='private']") },
  'private (dark theme)': {
    ...root,
    ...block("[data-theme='dark']"),
    ...block("[data-window='private']"),
    ...block("[data-theme='dark'] [data-window='private']"),
  },
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
function parse(v) {
  if (v.startsWith('#')) return [...hex(v), 1]
  const m = /rgba?\(([^)]+)\)/.exec(v)
  const p = m[1].split(',').map((x) => parseFloat(x))
  return [p[0], p[1], p[2], p[3] ?? 1]
}
const over = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3]))
const lum = (rgb) =>
  rgb
    .slice(0, 3)
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0)
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

let failed = 0
for (const [name, t] of Object.entries(themes)) {
  const c = (k) => parse(t[k])
  const surfaces = ['--paper', '--paper-page', '--paper-sunk', '--paper-float']
  const pairs = []
  for (const s of surfaces) for (const ink of ['--ink', '--ink-2', '--ink-3']) pairs.push([ink, s, c(ink), c(s)])
  if (!name.startsWith('private')) {
    // shu as text: on chrome, page and float; and on a row tinted with the citation wash
    for (const s of ['--paper', '--paper-page', '--paper-float']) pairs.push(['--shu', s, c('--shu'), c(s)])
    const washed = over(c('--shu-wash'), c('--paper'))
    pairs.push(['--shu', '--paper + --shu-wash', c('--shu'), washed])
    pairs.push(['--ink-2', '--paper + --shu-wash', c('--ink-2'), washed])
    pairs.push(['--on-shu', '--shu', c('--on-shu'), c('--shu')])
  }
  pairs.push(['--ink-on-ink', '--ink', c('--ink-on-ink'), c('--ink')])

  console.log(`\n${name}`)
  for (const [fg, bg, a, b] of pairs) {
    const r = ratio(a, b)
    const ok = r >= 4.5
    if (!ok) failed++
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${r.toFixed(2).padStart(5)}  ${fg} on ${bg}`)
  }
}
console.log(failed ? `\n${failed} pair(s) below 4.5:1` : '\nall text pairs at or above 4.5:1')
process.exitCode = failed ? 1 : 0
