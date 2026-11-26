import { defineConfig } from 'vitest/config'

// Each file launches its own Electron app; running them in parallel would fight over the X display
// and the fixture ports, so files run one after another.
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
