import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Integration tests migrate a fresh Postgres schema and start the real server.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
