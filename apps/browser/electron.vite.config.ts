import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

// Everything is bundled into the main process, workspace packages included. pdfjs-dist is the one
// runtime dependency: its code is bundled too, but the package is shipped for the CMaps and standard
// fonts that @tiger/extract/pdf reads from disk.
export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: ['pdfjs-dist'] },
      rollupOptions: { input: { index: resolve('src/main/index.ts') } },
    },
  },
  preload: {
    // Sandboxed preloads can only require('electron'): each entry must be one self-contained CJS file.
    build: {
      externalizeDeps: false,
      isolatedEntries: true,
      rollupOptions: {
        input: {
          ui: resolve('src/preload/ui.ts'),
          tab: resolve('src/preload/tab.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    build: {
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } },
    },
    plugins: [react()],
  },
})
