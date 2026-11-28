/**
 * Save a screenshot of rig screens at 1440x900 into test-results/rig/<screen>.<theme>.png.
 *
 *   pnpm rig:shots                         every screen, light and dark
 *   pnpm rig:shots app/page-fresh          one screen, both themes
 *   pnpm rig:shots app/palette --dark      one screen, one theme
 *
 * Exits non-zero if a screen reports an error (uncaught exception, console error, rig failure).
 */
import { type RigTheme, startRig } from './rig.ts'

const args = process.argv.slice(2)
const themes: RigTheme[] = args.includes('--dark') ? ['dark'] : args.includes('--light') ? ['light'] : ['light', 'dark']
const wanted = args.filter((a) => !a.startsWith('--'))

const rig = await startRig()
let failed = 0
try {
  const all = await rig.screens()
  const screens = wanted.length ? wanted : all
  for (const name of screens) {
    if (!all.includes(name)) {
      console.error(`unknown screen: ${name}`)
      failed++
      continue
    }
    for (const theme of themes) {
      const { path, errors } = await rig.shot(name, theme)
      if (errors.length) {
        failed++
        console.error(`✗ ${name} (${theme}): ${errors.join(' | ')}`)
      } else console.log(`✓ ${name} (${theme}) → ${path}`)
    }
  }
} finally {
  await rig.close()
}
process.exit(failed ? 1 : 0)
