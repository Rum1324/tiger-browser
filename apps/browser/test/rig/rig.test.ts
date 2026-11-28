import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DESIGN_SHOTS_DIR, type Rig, SHOTS_DIR, startRig } from './rig'

/**
 * The visual rig in plain Chromium: every catalogued screen opens in both themes without an error
 * and is saved as a screenshot; the harness screens prove the rig draws real UI; every design shot
 * on disk has a screen of the same name.
 */
describe('visual rig', () => {
  let rig: Rig
  let screens: string[] = []
  beforeAll(async () => {
    rig = await startRig()
    screens = await rig.screens()
  })
  afterAll(async () => {
    await rig?.close()
  })

  it('every screen opens in light and dark without an error and is saved at 1440x900', async () => {
    expect(screens.length).toBeGreaterThan(50)
    const failures: string[] = []
    for (const name of screens) {
      for (const theme of ['light', 'dark'] as const) {
        const { path, errors } = await rig.shot(name, theme)
        if (errors.length) failures.push(`${name} (${theme}): ${errors.join(' | ')}`)
        else if (!existsSync(path) || statSync(path).size < 2000)
          failures.push(`${name} (${theme}): no screenshot`)
      }
    }
    expect(failures).toEqual([])
  }, 600_000)

  it('the harness screens draw the developer harness over the fixture world', async () => {
    const { page, errors } = await rig.open('harness/signed-in', 'light')
    expect(errors).toEqual([])
    await page.getByText('投資家向けピッチ v3').first().waitFor()
    // The page view stand-in sits where the harness reported the page bounds.
    expect(await page.locator('[data-rig-page]').count()).toBe(1)
    await page.close()
  })

  it('an app screen reports its page slot and opens overlay surfaces by name', async () => {
    const fresh = await rig.open('01-browse', 'light')
    expect(fresh.errors).toEqual([])
    const box = await fresh.page.locator('[data-rig-page]').boundingBox()
    const slot = await fresh.page.locator('[data-region="page"]').boundingBox()
    expect(box && slot).toBeTruthy()
    expect(box).toEqual(slot)
    expect(await fresh.page.locator('[data-testid="page-state"]').getAttribute('data-state')).toBe(
      'fresh',
    )
    await fresh.page.close()

    const palette = await rig.open('08-command', 'dark')
    expect(palette.errors).toEqual([])
    expect(await palette.page.locator('html').getAttribute('data-theme')).toBe('dark')
    await palette.page.locator('[data-testid="overlay-palette"]').waitFor()
    expect(await palette.page.locator('[data-rig-page]').count()).toBe(1)
    await palette.page.close()

    const covered = await rig.open('19-settings', 'light')
    expect(await covered.page.locator('[data-rig-page]').count()).toBe(0)
    await covered.page.close()
  })

  it('every design shot has a screen of the same name; compare puts the two side by side', async () => {
    const shots = await rig.shots()
    const { readdirSync } = await import('node:fs')
    const onDisk = existsSync(DESIGN_SHOTS_DIR)
      ? readdirSync(DESIGN_SHOTS_DIR)
          .filter((f) => f.endsWith('.png') && !f.startsWith('components'))
          .map((f) => f.replace(/\.png$/, ''))
      : []
    const covered = new Set(Object.values(shots))
    expect(onDisk.filter((n) => !covered.has(n))).toEqual([])
    if (onDisk.includes('01-browse')) {
      const r = await rig.compare('01-browse')
      expect(r?.errors).toEqual([])
      expect(r && existsSync(r.path)).toBe(true)
      expect(r?.path).toBe(join(SHOTS_DIR, 'compare', '01-browse.png'))
    }
  })
})
