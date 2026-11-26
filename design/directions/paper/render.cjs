/*
 * Renders every Paper screen to shots/*.png.
 *
 *   node /home/user/tiger-browser/design/directions/paper/render.cjs            # all screens
 *   node /home/user/tiger-browser/design/directions/paper/render.cjs 02 07      # only names containing 02 or 07
 *
 * Playwright comes from the global install (do not add it to this repo). Viewport 1440 x 900 at 2x.
 * Offline: loads prototype/index.html from disk with the fonts bundled by fetch-fonts.cjs.
 */
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

let chromium
try {
  ;({ chromium } = require('playwright'))
} catch {
  ;({ chromium } = require('/opt/node-tools/node_modules/playwright'))
}

const DIR = __dirname
const SHOTS = path.join(DIR, 'shots')
const INDEX = pathToFileURL(path.join(DIR, 'prototype', 'index.html')).href

const SCREENS = [
  '01-browse',
  '02-sidepanel-chat',
  '03-share-preview',
  '04-space-home',
  '05-blocked-private',
  '06-first-run',
  '07-dark',
  '08-command',
  '09-signature-a',
  '09-signature-b',
  '09-signature-c',
  '10-attach-on',
  '11-streaming',
]

;(async () => {
  const only = process.argv.slice(2)
  const todo = only.length ? SCREENS.filter((s) => only.some((o) => s.includes(o))) : SCREENS
  const charsetFile = path.join(DIR, 'prototype', 'fonts', 'charset.txt')
  const charset = new Set(fs.existsSync(charsetFile) ? fs.readFileSync(charsetFile, 'utf8') : '')

  fs.mkdirSync(SHOTS, { recursive: true })
  const browser = await chromium.launch()
  // Reduced motion: the prototype's transitions and draw animations are skipped, so every shot is a settled state.
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`))
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`))

  for (const name of todo) {
    await page.goto(`${INDEX}?screen=${name}`)
    await page.evaluate(() => document.fonts.ready)
    // Force every declared face that covers text on the page to load before the shot.
    await page.evaluate(async () => {
      const text = document.body.innerText
      await Promise.all(
        [...document.fonts].map((f) => f.load().catch(() => null)),
      )
      return text.length
    })
    await page.evaluate(() => document.fonts.ready)

    // Glyph audit: anything rendered that the bundled fonts were not subset for would fall back
    // to a system font (IPAGothic here). Fail loudly instead of shipping a mixed-font shot.
    const used = await page.evaluate(() => [...new Set(document.body.innerText)].join(''))
    const missing = [...used].filter((ch) => ch > ' ' && ch !== '\u00a0' && ch !== '\u2060' && !charset.has(ch))
    if (missing.length) problems.push(`${name}: not in bundled fonts: ${missing.join(' ')} (run fetch-fonts.cjs)`)

    // Layout audit: text clipped by its own box is a bug unless the element opts into ellipsis.
    const overflow = await page.evaluate(() => {
      const out = []
      for (const el of document.querySelectorAll('.window *')) {
        const cs = getComputedStyle(el)
        if (cs.textOverflow === 'ellipsis' || cs.display === 'inline') continue
        if (el.closest('.web, .md__lines, .sr')) continue
        if (cs.overflowX !== 'visible' && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)
          out.push(`${el.className || el.tagName}: width ${el.scrollWidth} > ${el.clientWidth}`)
        if (cs.overflowY !== 'visible' && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1)
          out.push(`${el.className || el.tagName}: height ${el.scrollHeight} > ${el.clientHeight}`)
      }
      // Content pushed out of a flex row (clipped by an ancestor) shows up as a box past its parent.
      for (const el of document.querySelectorAll('.panel *, .slip *, .sheet__main > *, .bar > *')) {
        const r = el.getBoundingClientRect()
        const host = el.closest('.panel, .slip, .sheet__main, .bar').getBoundingClientRect()
        if (r.width && (r.right > host.right + 1 || r.bottom > host.bottom + 1))
          out.push(`${el.className || el.tagName}: outside its container`)
      }
      // Pointer targets: every control is at least 28 px tall (citation chips extend theirs with ::after).
      for (const el of document.querySelectorAll(
        '.window button, .window [role=tab], .window [role=radio], .window a.tab, .window a.nav, .window .tab__x, .window .lg a, .window .lg__more a, .window label:not(.fr__label)',
      )) {
        const r = el.getBoundingClientRect()
        if (r.height && r.height < 28 - 0.5) out.push(`${el.className || el.tagName}: target ${r.height.toFixed(1)} px tall`)
      }
      return out
    })
    for (const o of overflow) problems.push(`${name}: overflow ${o}`)

    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), omitBackground: true })
    console.log(`shot ${name}.png`)
  }

  await browser.close()
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`)
    process.exitCode = 1
  }
})()
