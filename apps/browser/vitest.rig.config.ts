import { defineConfig } from 'vitest/config'

// The visual rig in plain Chromium (Playwright) against the Vite-served renderer; no Electron.
export default defineConfig({
  test: {
    include: ['test/rig/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
