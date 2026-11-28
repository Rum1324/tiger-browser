import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The visual test rig: the renderer served by Vite for plain Chromium (no Electron). Open
 * /rig.html?screen=<name>&theme=light|dark. `pnpm rig` serves it; `pnpm rig:shots` saves
 * screenshots of every screen at 1440x900 in both themes.
 */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  server: { host: '127.0.0.1', strictPort: false },
  logLevel: 'warn',
})
