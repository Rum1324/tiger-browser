import { app } from 'electron'

/**
 * Process-level switches. All of them are read once at startup.
 *
 * TIGER_NO_SANDBOX=1 disables Chromium's OS sandbox. It exists only for tests and local runs inside
 * a root container, where Chromium refuses to start sandboxed; it is never set by the app itself.
 * Running as root also needs the `--no-sandbox` command-line switch, because Chromium checks it before
 * any app code runs (Playwright passes it). Renderer-level isolation (contextIsolation, no Node,
 * no bridge in pages) is unaffected.
 */
export const env = {
  noSandbox: process.env.TIGER_NO_SANDBOX === '1',
  userDataDir: process.env.TIGER_USER_DATA_DIR || null,
  downloadsDir: process.env.TIGER_DOWNLOADS_DIR || null,
  serverUrl: process.env.TIGER_SERVER_URL || 'http://localhost:8787',
  /**
   * TIGER_UI=harness loads the developer harness (harness.html) instead of the product UI. Honoured
   * only in an unpackaged run (see uiEntryPage); the end-to-end suite sets it.
   */
  uiEntry: process.env.TIGER_UI === 'harness' ? ('harness' as const) : ('app' as const),
}

/** The renderer page the UI and overlay views load: the product UI, or the harness in development. */
export function uiEntryPage(): 'index.html' | 'harness.html' {
  return env.uiEntry === 'harness' && !app.isPackaged ? 'harness.html' : 'index.html'
}

/** The Vite dev server, trusted as a UI origin only in an unpackaged development run. */
export function devServerUrl(): string | null {
  const url = process.env.ELECTRON_RENDERER_URL
  return url && !app.isPackaged ? url : null
}
