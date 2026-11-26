import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

/**
 * The DOM entry is bundled into a sandboxed preload that can require nothing but `electron`. Bundling
 * it for the browser platform fails on any Node built-in import, so this proves it stays browser-safe.
 */
describe('browser-safe entries', () => {
  for (const entry of ['src/index.ts', 'src/google.ts', 'src/finalize.ts']) {
    it(`${entry} bundles for the browser with no Node built-ins`, async () => {
      const result = await build({
        entryPoints: [new URL(`../${entry}`, import.meta.url).pathname],
        bundle: true,
        platform: 'browser',
        format: 'cjs',
        write: false,
        logLevel: 'silent',
        metafile: true,
      })
      const inputs = Object.keys(result.metafile.inputs)
      expect(inputs.some((i) => i.startsWith('node:'))).toBe(false)
      const code = result.outputFiles[0]?.text ?? ''
      expect(code).not.toMatch(/require\(["'](node:)?(fs|path|module|url|os|child_process)["']\)/)
      if (entry === 'src/index.ts')
        console.log(`preload bundle size for ${entry}: ${(code.length / 1024).toFixed(0)} KiB`)
    })
  }
})
