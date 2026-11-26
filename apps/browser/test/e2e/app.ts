import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EngineCommandName, EngineRequest, EngineResponse, TabsState } from '@tiger/shared'
import { _electron, type ElectronApplication, type Page } from 'playwright-core'

const require = createRequire(import.meta.url)
const APP_DIR = join(__dirname, '../..')
const ELECTRON = require('electron') as unknown as string

export interface LaunchOptions {
  userDataDir: string
  downloadsDir?: string
  /** Extra Chromium switches, e.g. host resolver rules. */
  args?: string[]
  /** Extra environment variables for the app process. */
  env?: Record<string, string>
}

export interface TigerApp {
  app: ElectronApplication
  ui: Page
  invoke<K extends EngineCommandName>(
    name: K,
    ...args: EngineRequest<K> extends undefined ? [] : [EngineRequest<K>]
  ): Promise<EngineResponse<K>>
  /** Run `invoke` from a given UI page (another window's UI). */
  invokeFrom<K extends EngineCommandName>(
    page: Page,
    name: K,
    ...args: EngineRequest<K> extends undefined ? [] : [EngineRequest<K>]
  ): Promise<EngineResponse<K>>
  tabsState(page?: Page): Promise<TabsState>
  /** The Page of the tab view whose URL matches. */
  tabPage(match: (url: string) => boolean, timeoutMs?: number): Promise<Page>
  /** Main-window UI pages in creation order (overlays excluded). */
  uiPages(): Page[]
  close(): Promise<void>
}

export function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `tiger-e2e-${prefix}-`))
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

export async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false> | T | null | undefined | false,
  timeoutMs = 10_000,
  label = 'condition',
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: unknown
  while (Date.now() < deadline) {
    try {
      const v = await fn()
      if (v) return v as T
    } catch (err) {
      last = err
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`timed out waiting for ${label}${last ? `: ${String(last)}` : ''}`)
}

const isMainUi = (url: string) => url.startsWith('tiger://ui/') && !url.includes('#overlay')

export async function launch(opts: LaunchOptions): Promise<TigerApp> {
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [APP_DIR, ...(opts.args ?? [])],
    cwd: APP_DIR,
    env: {
      ...process.env,
      TIGER_NO_SANDBOX: '1',
      TIGER_USER_DATA_DIR: opts.userDataDir,
      TIGER_DOWNLOADS_DIR: opts.downloadsDir ?? join(opts.userDataDir, 'Downloads'),
      ELECTRON_RENDERER_URL: '',
      ...opts.env,
    },
    timeout: 30_000,
  })
  const uiPages = () => app.windows().filter((p) => isMainUi(p.url()))
  const ui = await waitFor(() => uiPages()[0], 20_000, 'the UI view')
  await ui.waitForFunction(() => typeof window.tiger?.invoke === 'function')

  const invokeFrom = (async (page: Page, name: string, req?: unknown) =>
    page.evaluate(
      ([n, r]) => (window.tiger.invoke as (n: string, r?: unknown) => Promise<unknown>)(n, r),
      [name, req] as const,
    )) as TigerApp['invokeFrom']

  const t: TigerApp = {
    app,
    ui,
    invoke: ((name: EngineCommandName, req?: unknown) =>
      (invokeFrom as (p: Page, n: string, r?: unknown) => Promise<unknown>)(
        ui,
        name,
        req,
      )) as TigerApp['invoke'],
    invokeFrom,
    tabsState: (page = ui) => invokeFrom(page, 'tabs.get'),
    tabPage: (match, timeoutMs = 10_000) =>
      waitFor(
        () => app.windows().find((p) => !p.url().startsWith('tiger:') && match(p.url())),
        timeoutMs,
        'tab page',
      ),
    uiPages,
    close: async () => {
      await app.close().catch(() => {})
    },
  }
  return t
}

/** Wait until the tab's state satisfies `pred` (as the engine reports it through tabs.get). */
export async function waitForTab(
  t: TigerApp,
  tabId: string,
  pred: (tab: TabsState['tabs'][number]) => boolean,
  label = 'tab state',
  page?: Page,
): Promise<TabsState['tabs'][number]> {
  return waitFor(
    async () => {
      const s = await t.tabsState(page)
      const tab = s.tabs.find((x) => x.id === tabId)
      return tab && pred(tab) ? tab : null
    },
    15_000,
    label,
  )
}
