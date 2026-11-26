import { app } from 'electron'

/**
 * Process-level switches. All of them are read once at startup.
 *
 * TIGER_NO_SANDBOX=1 disables Chromium's OS sandbox. It exists only for tests and local runs inside
 * a root container, where Chromium refuses to start sandboxed; it is never set by the app itself.
 * Renderer-level isolation (contextIsolation, no Node, sandboxed preloads) is unaffected.
 */
export const env = {
  noSandbox: process.env.TIGER_NO_SANDBOX === '1',
  userDataDir: process.env.TIGER_USER_DATA_DIR || null,
  downloadsDir: process.env.TIGER_DOWNLOADS_DIR || null,
  serverUrl: process.env.TIGER_SERVER_URL || 'http://localhost:8787',
}

/** The Vite dev server, trusted as a UI origin only in an unpackaged development run. */
export function devServerUrl(): string | null {
  const url = process.env.ELECTRON_RENDERER_URL
  return url && !app.isPackaged ? url : null
}
