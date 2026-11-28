/**
 * Put each design shot next to the rig's rendering of the same screen:
 * test-results/rig/compare/<screen>.png (design left, implementation right, 1440x900 each).
 *
 *   pnpm rig:compare                 every screen that has a design shot
 *   pnpm rig:compare 01-browse 08-command
 *
 * Exits non-zero if a screen reports an error or names a shot that is not on disk.
 */
import { startRig } from './rig.ts'

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const rig = await startRig()
let failed = 0
try {
  const shots = await rig.shots()
  const screens = wanted.length ? wanted : Object.keys(shots)
  for (const name of screens) {
    const r = await rig.compare(name)
    if (!r) {
      failed++
      console.error(`✗ ${name}: no design shot for this screen`)
    } else if (r.errors.length) {
      failed++
      console.error(`✗ ${name}: ${r.errors.join(' | ')}`)
    } else console.log(`✓ ${name} → ${r.path}`)
  }
} finally {
  await rig.close()
}
process.exit(failed ? 1 : 0)
