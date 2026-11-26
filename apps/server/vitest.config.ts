import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Each test file migrates its own Postgres schema; the first migration of a run can be slow.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
})
