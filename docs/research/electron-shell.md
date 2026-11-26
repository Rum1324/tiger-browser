# Research: electron-shell

Researched 2026-11-26 by a background agent. Status labels: verified (ran it), documented (URL), inferred, unknown.

## Summary

1. [verified] On Electron 45.5.0 (Chrome 156, Node 24.22.3), a BaseWindow with one chrome-UI view and one view per tab works. Children are stacked in addChildView order. Adding a child that is already present moves it to the top, and addChildView(view, index) places it at an exact position. setBorderRadius gives rounded tab corners. A transparent view is made with setBackgroundColor('#00000000'). All of this is shown in screenshots.
2. [verified] A transparent overlay view takes every click inside its bounds. CSS pointer-events:none in the overlay does not let clicks through. Clicks reach the tab only after setVisible(false) or removeChildView. The right pattern is an overlay sized tightly to the popover, hidden with setVisible(false) when nothing is shown.
3. [verified on Linux/Xvfb only — this reverses your expectation] CSS backdrop-filter inside the overlay view DID blur the tab view's pixels behind it. The new native View.setBackgroundBlur(radius) API also works. Both need re-testing on a macOS GPU build before the design depends on them.
4. [verified] Sessions: a 'persist:tabs' partition keeps cookies and localStorage across quit and relaunch. A partition without the 'persist:' prefix is in-memory (storagePath null) and is empty after relaunch. A separate 'persist:chrome-ui' session works. Electron grants every permission (for example Notification) unless you install permission handlers, so the handlers are mandatory.
5. [verified] Electron 45 removed the Node shims, Buffer and setImmediate from sandboxed preloads. require() now loads only 'electron', so every preload must be bundled into one self-contained CJS file.
6. [verified] Page extraction: a sandboxed preload in the isolated world and webContents.executeJavaScriptInIsolatedWorld both returned the real title and text from a hostile page, and the page could not see the reads. executeJavaScript and webFrameMain.executeJavaScript run in the page's own JS context, so they returned 'FAKE TITLE' and the page logged every access. I recommend a bundled isolated-world preload; it also worked on a live Wikipedia page.
7. [verified] Recommended stack: electron-vite 6.0.0 (Vite 8) plus electron-builder 26.18.0. It scaffolded, typechecked and built main, two sandboxed preloads and a React renderer inside a pnpm workspace, packaged with electron-builder, and the packaged app ran and loaded a workspace package. The scaffold's defaults (sandbox:false, preload deps left as external files) must be changed. Forge 8.0.1's Vite plugin is still labelled experimental.
8. [verified] Playwright _electron 1.63 with Electron 45 under Xvfb: each WebContentsView shows up as its own Page in both electronApp.windows() and context().pages(). You can fill and click in the chrome UI, read a tab's URL, title and DOM, and screenshot hidden views. Launch FAILS against a binary with security fuses flipped, so E2E must run on an unfused build.
9. [verified] require('node:sqlite') works in Electron 45's main process (SQLite 3.54.1), so no native module is needed. better-sqlite3 13.2.0 rebuilt in 2s and loaded, but it is unnecessary. Recommendation: node:sqlite.
10. [verified/documented] Chrome gaps:
- Work out of the box: PDF viewer, find-in-page and zoom APIs, downloads (no UI), Japanese IME.
- Need our own code: context menu, find/zoom/download UI, getDisplayMedia (fails with NotSupportedError until a handler is set), spellcheck menu.
- Widevine fails on stock Electron; it needs the castlabs fork, which lags (45.2.1+wvcus vs 45.5.0).
- Not available: autofill/password saving and Chrome Web Store extensions.
- Passkeys exist only on macOS via the new app.configureWebAuthn, which needs signing, entitlements and associated domains.

## Decisions

### Window architecture

- **Recommendation** [verified]: BaseWindow + WebContentsView: chrome UI view at the bottom (full window), one view per tab above it (inset bounds, setBorderRadius), overlay views on top. Keep all tab views attached; show the active tab with setVisible(true) and the others with setVisible(false). Re-stack with addChildView(existing), which moves a view to the top.
- **Evidence**: views/main.js run under Xvfb: children order logged ['chrome','tab','overlay']; screenshot A shows the chrome around a rounded tab; after addChildView(chrome) the order became ['tab','chrome'] and screenshot C shows the chrome covering the tab; addChildView(tab,1) restored the order.
- **Cost**: The clipped rounded-corner area still captures clicks (documented). The screenshot is a software-composited Linux run; macOS look and performance not verified.

### Popover overlays and mouse events

- **Recommendation** [verified]: Use an overlay WebContentsView sized to the popover plus its shadow margin, with a transparent background, kept loaded and toggled with setVisible. Never leave a full-size transparent overlay over a tab.
- **Evidence**: X11 XTest clicks: a click at a transparent overlay point went to the overlay (target=''); with pointer-events:none on html/body it still went to the overlay; after overlay.setVisible(false) it went to the tab ('CLICK tab 60,320'); after removeChildView it also went to the tab.
- **Cost**: One extra renderer process per overlay. Popover shadows bigger than the view bounds are clipped.

### Backdrop blur across views

- **Recommendation** [verified]: Use native view.setBackgroundBlur(r) with a semi-transparent background color, or CSS backdrop-filter. Both blurred the tab view's pixels on Linux. Do not lock the visual design to either until it is checked on a signed macOS build with GPU.
- **Evidence**: Screenshot A: a popover with backdrop-filter:blur(12px) shows blurred tab stripes, while the stripes outside it stay sharp. Screenshot D: overlay.setBackgroundColor('#40ffffff') plus setBackgroundBlur(20) blurs the whole tab underneath. Linux Xvfb software compositing only.
- **Cost**: On macOS each web view may have its own compositor/CALayer, so CSS blur across views may not work there (inferred, unverified).

### Sessions

- **Recommendation** [verified]: Tabs use session.fromPartition('persist:tabs') (one per profile). Incognito uses a fresh non-'persist:' partition per incognito window (e.g. 'incognito-<uuid>'). Chrome UI uses 'persist:chrome-ui', served from a custom tiger:// protocol registered on that session only.
- **Evidence**: sessions/main.js write then read across two process launches: tabs document.cookie 'who=tabs; api=set-from-main' and localStorage survived; incognito storagePath=null, isPersistent()=false, and it was empty after relaunch; ui partition persisted separately.
- **Cost**: Extensions cannot load into in-memory sessions (documented). A cookie set from the main process needs an expirationDate to persist; call cookies.flushStore() before quit.

### Security baseline

- **Recommendation** [verified]: sandbox:true, contextIsolation:true, nodeIntegration:false, webviewTag:false on every view. Default-deny permission request and check handlers on every session. setWindowOpenHandler → deny and open as an internal tab. Allow only http(s) in will-navigate, will-frame-navigate and will-redirect. Cancel file:// in webRequest. Serve the chrome UI from tiger:// with a strict CSP. Validate IPC senderFrame by protocol, host and top-level frame. Use the async safeStorage API. Flip fuses in release builds only.
- **Evidence**: security/main.js:
- inline script blocked by CSP
- tab's invoke of a UI-only channel rejected; UI's accepted
- window.open intercepted
- file:// link: 'Not allowed to load local resource'
- tiger:// navigation from tab blocked by will-frame-navigate
- fetch('tiger://ui') from tab blocked by CORS
- geolocation denied, notifications granted (on allowlist)
- safeStorage async roundtrip OK (backend basic_text in container).
- **Cost**: app.enableSandbox() aborts when running as root with --no-sandbox (CI containers), so it is guarded by an env var. In Node, new URL('tiger://ui/x').origin === 'null' (my first sender check wrongly rejected the UI), so compare protocol+host instead. Sync safeStorage is deprecated in 45 and removed in 46.

### Page extraction

- **Recommendation** [verified]: Use a bundled, sandboxed preload in the isolated world. It listens on ipcRenderer for 'tiger:extract', reads the DOM and replies with ipcRenderer.send. Expose nothing via contextBridge. Fallback without a preload: webContents.executeJavaScriptInIsolatedWorld(1001, [{code}]).
- **Evidence**: extract/main.js against a page that overrides Document.prototype.title, HTMLElement.prototype.innerText, String.prototype.slice and JSON.stringify:
- (a) preload isolated world and (c) executeJavaScriptInIsolatedWorld returned 'Real Title' / 'Real body text.'
- (b) executeJavaScript and (d) webFrameMain.executeJavaScript returned 'FAKE TITLE' / 'FAKE BODY'
- page __observed = only the 2x2 reads from (b)/(d)
Live https Wikipedia page: all methods returned the title and 18,365 chars.
- **Cost**: The preload runs only in the main frame unless nodeIntegrationInSubFrames is set. Google Docs draws to canvas, so body.innerText will not contain document text (needs a separate strategy). The live-page test used --ignore-certificate-errors because this container's proxy intercepts TLS.

### Build tooling

- **Recommendation** [verified]: electron-vite 6.0.0 + Vite 8 + @vitejs/plugin-react 6 + electron-builder 26.18.0 in a pnpm workspace. Preload config: build.externalizeDeps:false and build.isolatedEntries:true with one input per preload. Main config: externalizeDeps.exclude for workspace packages so they get bundled.
- **Evidence**: pnpm create @quick-start/electron@1.0.31 --template react-ts → bumped electron to 45.5.0 → pnpm build (tsc + electron-vite) OK. out/preload/index.js and tab.js each contain only require("electron"). The built app ran under Playwright with sandbox:true (window.electron exposed, require undefined). The pnpm workspace app with @tiger/shared bundled into main was packaged with electron-builder --linux dir; the packaged binary printed 'hello main from @tiger/shared'.
- **Cost**: Single-maintainer project (alex8088); a major version roughly yearly with breaking config changes. The scaffold defaults to sandbox:false with external preload deps, both of which must change. Scoped package names produce a binary named '@tigerdesktop', so set productName/executableName. Forge's Vite plugin is labelled experimental (electronforge.io).

### Packaging, signing, auto-update

- **Recommendation** [documented]: electron-builder for dmg+zip (mac), with signing via CSC_LINK/CSC_KEY_PASSWORD (Developer ID Application cert), notarization through electron-builder's built-in @electron/notarize (APPLE_API_KEY/APPLE_API_KEY_ID/APPLE_API_ISSUER or APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID) and hardened runtime. Auto-update with electron-updater 6.8.11 from a private S3/R2 'generic' provider or GitHub releases. update-electron-app only fits a public GitHub repo or static storage.
- **Evidence**: npm view: electron-builder 26.18.0 (2026-11-21), electron-updater 6.8.11 (2026-11-21), update-electron-app 3.3.0 (2026-06-28), @electron/notarize 3.1.2, @electron/osx-sign 2.7.2. The update-electron-app README requires a code-signed app plus either a public GitHub repo or static storage. Electron 42 breaking changes: macOS notifications use UNNotification and need code signing.
- **Cost**: Needs an Apple Developer Program membership ($99/yr) and a macOS CI runner for signing and notarization. electron-updater on mac needs the zip target next to the dmg (from memory, not verified here). Signing and notarization were not run (no Mac here).

### E2E testing

- **Recommendation** [verified]: Playwright _electron: find each view's Page by URL in electronApp.windows(), and use electronApp.evaluate for main-process state (webContents.getAllWebContents()). Run E2E against the unfused dev or test binary.
- **Evidence**: e2e/test.cjs: launched in 365 ms; windows().length=3 and context().pages().length=3 (UI + 2 tab views, one hidden); fill and click in the UI changed the tab to /three, and its Page title/h1 were read; hidden view screenshot OK. A copy of electron with RunAsNode, EnableNodeCliInspectArguments and NODE_OPTIONS fuses off: launch timed out after 15 s.
- **Cost**: A Page does not expose its view's webContents id; mapping goes through URL or a test hook. page.screenshot captures one view, not the composited window. Which of the flipped fuses breaks launch was not isolated.

### Local persistence

- **Recommendation** [verified]: node:sqlite (DatabaseSync) in the main process, or a utilityProcess for heavy work, for bookmarks, history and settings. No native module.
- **Evidence**: ver.js in Electron 45: node:sqlite worked, sqlite_version 3.54.1, no warning printed. better-sqlite3@13.2.0 via electron-rebuild -v 45.5.0 took 2s and loaded.
- **Cost**: node:sqlite is synchronous and blocks the main thread on big queries, so move heavy queries to a utilityProcess. Its API stability under Node 24 is still release-candidate/experimental per Node docs (not verified here).

### Chrome feature gaps

- **Recommendation** [verified]: See the table in details. Build ourselves: context menu, downloads UI, find bar, zoom UI, print entry, permission prompts, screen-share picker, spellcheck suggestions. Use the castlabs ECS fork if Widevine is needed. No password manager or Chrome Web Store for v1.
- **Evidence**: gaps/main.js:
- getDisplayMedia without handler: NotSupportedError; with setDisplayMediaRequestHandler: track 'Entire screen'
- Widevine EME: NotSupportedError; ClearKey: supported
- findInPage: 1 match; zoom 1.5 OK; will-download completed
- PDF rendered via the built-in extension with default webPreferences (screenshot gaps/pdf.png)
- printToPDF OK
- context-menu event fired, but misspelledWord was empty (no dictionary downloaded here)
- no 'ja' among 57 spellcheck languages
- UVPA=false on Linux
Castlabs release page: latest 45.2.1+wvcus (Nov 5).
- **Cost**: Spellcheck suggestions, WebAuthn on macOS and the system picker were not verified here.

## Details

## Versions observed (2026-11-26)
- electron 45.5.0, released 2026-11-24 (45.0.0 on 2026-10-21): Chrome 156.0.8078.109, Node 24.22.3, NODE_MODULE_VERSION 150. Electron 46 is at alpha.13 (Chrome 160, Node 26).
- The npm package has no postinstall since Electron 42. The binary downloads on the first `require('electron')` or `npx electron`, and the scaffold adds `"postinstall": "install-electron"`. Effect: pnpm does not need to approve build scripts for electron.

## Item 1: window, views and overlays (views/main.js)
```js
const win = new BaseWindow({ width: 1280, height: 800, backgroundColor: '#1e1e24' });
const chrome = new WebContentsView({ webPreferences: UI_PREFS });
win.contentView.addChildView(chrome);            // bottom
chrome.setBounds({ x: 0, y: 0, width: W, height: H });
const tab = new WebContentsView({ webPreferences: TAB_PREFS });
win.contentView.addChildView(tab);               // above chrome
tab.setBounds({ x: 8, y: 80, width: W - 16, height: H - 88 });
tab.setBorderRadius(12);
const pop = new WebContentsView({ webPreferences: UI_PREFS });
pop.setBackgroundColor('#00000000');             // transparent (ARGB)
win.contentView.addChildView(pop);               // top
pop.setBounds(popoverRectPlusShadow);
pop.setVisible(false);                           // when closed: required, otherwise it eats clicks
// optional glass: pop.setBackgroundColor('#40ffffff'); pop.setBackgroundBlur(20);
// re-stack: win.contentView.addChildView(existingView) moves it to the top; addChildView(v, index) places it exactly
// animate: view.setBounds(rect, { animate: { duration: 200, easing: 'ease-out' } })  (BoundsOptions in 45 typings; not tested)
```
Click results (X11 XTest):

| Click | Received by |
|---|---|
| Transparent overlay area | overlay |
| Popover | overlay (target=pop) |
| Transparent area after pointer-events:none on the overlay's html/body | overlay |
| After setVisible(false) | tab |
| After removeChildView | tab |

Screenshots:
- views/A-chrome-tab-overlay.png: rounded tab, CSS blur visible through the popover
- views/C-chrome-readded-on-top.png
- views/D-native-setBackgroundBlur.png

## Item 2: sessions (sessions/main.js)
- 'persist:tabs' maps to userData/Partitions/tabs.
- 'incognito-1' has storagePath null.
- 'persist:chrome-ui' is its own store.
- Relaunch read-back: tabs "who=tabs; api=set-from-main", incognito "", ui "who=ui".

## Item 3: security baseline (security/main.js; all behaviours below were observed)
```js
protocol.registerSchemesAsPrivileged([{ scheme: 'tiger', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }]);
app.enableSandbox(); // not usable when running as root with --no-sandbox (CI); guard it
const TAB_PREFS = { session: tabsSes, preload: TAB_PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false,
  nodeIntegrationInSubFrames: false, webviewTag: false, webSecurity: true, allowRunningInsecureContent: false,
  navigateOnDragDrop: false, safeDialogs: true, spellcheck: true };
const UI_PREFS = { session: uiSes, preload: UI_PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: false };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
uiSes.protocol.handle('tiger', req => { /* serve built renderer files from app.asar */ return new Response(body, { headers: { 'content-type': mime, 'content-security-policy': CSP } }); });
// in dev, point the UI at the Vite dev server and relax CSP only there.
function hardenTabSession(ses) {
  ses.setPermissionRequestHandler((wc, permission, cb, details) => cb(policy(permission, details.requestingUrl))); // ask the user via chrome UI and remember per origin
  ses.setPermissionCheckHandler((wc, permission, origin) => policyCheck(permission, origin));
  ses.setDevicePermissionHandler(() => false);
  ses.webRequest.onBeforeRequest({ urls: ['file://*/*'] }, (_d, cb) => cb({ cancel: true }));
  // since 45, screen capture arrives as 'display-capture' (not 'media')
}
function hardenTab(wc) {
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) openTab(url); return { action: 'deny' }; });
  const ok = u => { try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; } };
  wc.on('will-navigate', e => { if (!ok(e.url)) e.preventDefault(); });
  wc.on('will-frame-navigate', e => { if (!ok(e.url) && !e.url.startsWith('about:')) e.preventDefault(); });
  wc.on('will-redirect', e => { if (!ok(e.url)) e.preventDefault(); });
  wc.on('will-attach-webview', e => e.preventDefault());
}
app.on('web-contents-created', (_e, wc) => wc.on('will-attach-webview', e => e.preventDefault()));
// IPC: validate the sender. NOTE new URL('tiger://ui/x').origin === 'null' in Node
function isUiFrame(f) { try { const u = new URL(f.url); return u.protocol === 'tiger:' && u.host === 'ui' && f.parent === null; } catch { return false; } }
ipcMain.handle('ui:anything', (e, arg) => { if (!isUiFrame(e.senderFrame)) throw new Error('forbidden'); /* ... */ });
// secrets: async only (sync API deprecated in 45, removed in 46)
await safeStorage.isAsyncEncryptionAvailable(); const buf = await safeStorage.encryptStringAsync(s); const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(buf);
// on Linux check safeStorage.getSelectedStorageBackend() !== 'basic_text' before storing API keys
```
Release fuses (@electron/fuses 2.1.3, or electron-builder `electronFuses`):
- RunAsNode=false
- EnableNodeCliInspectArguments=false
- EnableNodeOptionsEnvironmentVariable=false
- EnableCookieEncryption=true
- GrantFileProtocolExtraPrivileges=false
- EnableEmbeddedAsarIntegrityValidation=true
- OnlyLoadAppFromAsar=true

Only flip them in release builds, because Playwright cannot launch a fused binary.

Observed results:
- Electron's default with no permission handler is to grant everything (Notification was 'granted').
- Tab main world: typeof require/process = undefined.
- A `<webview>` in the page is inert.

## Item 4: extraction (extract/)
Sandboxed preload `require` surface on 45 (probed):
- Only 'electron', which exports contextBridge, crashReporter, ipcRenderer, nativeImage, sharedTexture, webFrame, webUtils.
- events, timers, url, buffer, path and others fail with 'module not found'.
- Buffer and setImmediate are undefined; process (limited) and global remain.
- Bundle as a single CJS file. No ESM preload with sandbox.

```js
// preload-extract.js (isolated world, exposes nothing)
const { ipcRenderer } = require('electron');
ipcRenderer.on('tiger:extract', (_e, reqId) => {
  ipcRenderer.send('tiger:extract:result', reqId, { url: location.href, title: document.title, text: document.body?.innerText.slice(0, 200000) ?? '' });
});
// main
ipcMain.on('tiger:extract:result', (e, id, data) => { if (!e.senderFrame || e.senderFrame.parent !== null || !knownTabIds.has(e.sender.id)) return; resolve(id, data); });
wc.send('tiger:extract', id);
// zero-preload alternative, also untamperable:
await wc.executeJavaScriptInIsolatedWorld(1001, [{ code: '({title:document.title,text:document.body.innerText})' }]);
```
Results against the hostile page:
- (a) and (c): Real Title / 'Real body text.' The page's __observed array saw nothing from them.
- (b) and (d): FAKE TITLE / FAKE BODY, and the page logged the reads.

The isolated world shares the DOM, so the page can still change what the content says. It just cannot intercept our reads.

## Item 5: tooling
Registry versions:

| Package | Version | Last published / note |
|---|---|---|
| electron-vite | 6.0.0 | 2026-10-15; vite ^6/7/8 peer |
| @quick-start/create-electron | 1.0.31 | |
| @electron-forge/* | 8.0.1 | 2026-09-29; Vite plugin "experimental" |
| electron-builder | 26.18.0 | |
| electron-updater | 6.8.11 | |
| update-electron-app | 3.3.0 | |
| vite | 8.3.8 | |
| @vitejs/plugin-react | 6.3.0 | |
| typescript | 7.0.2 latest | scaffold uses 5.9.3 |
| tsup | 9.0.0 | |
| tsdown | 0.23.7 | |
| electron-chrome-extensions | 4.10.0 | |
| electron-context-menu | 5.1.0 | |
| playwright | 1.65.1 on npm | 1.63.0 installed |

electron.vite.config.ts (verified):
```ts
export default defineConfig({
  main: { build: { externalizeDeps: { exclude: ['@tiger/shared'] } } },
  preload: { build: { externalizeDeps: false, isolatedEntries: true,
    rollupOptions: { input: { index: resolve('src/preload/index.ts'), tab: resolve('src/preload/tab.ts') } } } },
  renderer: { resolve: { alias: { '@renderer': resolve('src/renderer/src') } }, plugins: [react()] }
})
```
pnpm-workspace.yaml contains apps/*, packages/* and onlyBuiltDependencies. electron-builder detected pm=pnpm and packaged the workspace app. Workspace deps that are already bundled are still copied into app.asar unless moved to devDependencies.

## Item 6: E2E (e2e/test.cjs)
```js
const app = await _electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', 'out/main/index.js'] });
while (app.windows().length < N) await sleep(100);   // one Page per WebContentsView
const ui = app.windows().find(p => p.url().startsWith('tiger://'));
const tab = app.windows().find(p => p.url().includes('example'));
await app.evaluate(({ webContents }) => webContents.getAllWebContents().map(w => ({ id: w.id, url: w.getURL() })));
```
Gotchas:
- firstWindow() is the first webContents created, so create the UI view first.
- --no-sandbox is needed as root in CI.
- A fused binary times out on launch.
- Hidden views can still be driven and screenshotted.

## Item 7: storage
`const { DatabaseSync } = require('node:sqlite')` works in the Electron 45 main process (SQLite 3.54.1).

## Item 8: Chrome feature gaps

| Feature | Status | What it takes |
|---|---|---|
| Widevine | Not in stock Electron (EME NotSupportedError, verified) | castlabs ECS fork (latest 45.2.1+wvcus, lags upstream) plus castlabs VMP signing (EVS) of the packaged app |
| WebAuthn / passkeys | macOS needs code | app.configureWebAuthn({ touchID: { keychainAccessGroup }, platformPasskeys: true }) (new API), plus entitlements, embedded provisioning profile, Associated Domains and the site's AASA file, plus a 'select-webauthn-account' handler. Security keys may work through roaming FIDO2, but the PIN UI is unverified. Linux UVPA=false. |
| Spellcheck | Needs code | Underline is built in; suggestions need context-menu wiring (params.dictionarySuggestions, replaceMisspelling). Hunspell dictionaries download from a Google CDN on Win/Linux; macOS uses the native checker. No Japanese dictionary. |
| PDF viewer | Works by default | Verified, sandbox on |
| Notifications | Works | Needs a permission handler. macOS needs a signed app (UNNotification since 42). |
| getDisplayMedia | Needs code | ses.setDisplayMediaRequestHandler(handler, { useSystemPicker: true }) (system picker on macOS 15+), or a picker built on desktopCapturer.getSources. Grant 'display-capture'. |
| Downloads | Default saves with a dialog | Build the UI on ses 'will-download', DownloadItem progress/done, item.setSavePath |
| Context menu | None by default | wc.on('context-menu') + Menu, or electron-context-menu |
| Find-in-page | Needs UI | API wc.findInPage / 'found-in-page' / stopFindInPage works |
| Zoom | Needs UI/shortcuts | setZoomFactor/zoomLevel works; menu roles zoomIn/zoomOut/resetZoom. Zoom is per-origin by default within a session. |
| Print | Needs code | wc.print() opens the system dialog (no Chrome print preview); printToPDF works |
| Chrome extensions | Partial | Unpacked only, persistent sessions only, partial API, no Web Store. electron-chrome-extensions adds chrome.tabs etc. |
| Autofill / passwords | Not available | Build your own or integrate a password manager |
| Japanese IME | Chromium-native, works by default | Composition not tested here (no IME in Xvfb) |

## Risks

- The CSS backdrop-filter and setBackgroundBlur results come only from Linux software compositing. macOS may composite each web view separately, so blur across views could fail there. Re-test on a Mac before committing to glass UI.
- Google Docs renders document text to canvas, so DOM innerText extraction will miss document content. That needs a separate approach (export API, accessibility mode, or Docs-specific handling).
- Castlabs Widevine builds lag upstream Electron (45.2.1 vs 45.5.0) and need VMP signing, which couples our Electron upgrade cadence to castlabs.
- Platform passkeys on macOS need a provisioning profile, Associated Domains and per-site AASA files. They only work for the user's own credential provider via ASAuthorizationController, and clientDataJSON reports origin https://<rpId>, which may break some relying parties.
- Electron grants all permissions by default. Any session created without handlers (including future partitions) is wide open.
- Release fuses break Playwright _electron launch, so CI must test an unfused build and separately smoke-test the fused artifact.
- electron-vite is maintained by a single person; Forge's Vite plugin is experimental. Either way there is a tooling bus-factor risk.
- The Electron 47 removal of positional console-message args and the 46 removal of sync safeStorage mean code must use the event-object and async forms now.
- No autofill or password saving, and no Chrome Web Store, are daily-use friction for Google, Slack and Notion users moving from Chrome.

## Open questions

- Does CSS backdrop-filter, and does View.setBackgroundBlur, blur another WebContentsView's pixels on macOS with GPU compositing? Needs a Mac run of views/main.js.
- Do hardware security keys (USB FIDO2 with a PIN) work in Electron 45 on macOS and Windows without Chrome's PIN dialog?
- Do spellcheck suggestions appear once hunspell dictionaries download? Not reachable here because the proxy intercepts TLS.
- Is Widevine actually needed for the target apps (Docs, Slack, Notion do not need it)? If not, skip castlabs entirely.
- What is the extraction strategy for canvas-rendered Google Docs (Docs API export via the user's OAuth vs. accessibility tree vs. CDP Accessibility domain)?
- Which single fuse breaks Playwright launch (most likely EnableNodeCliInspectArguments)?
- Should the chrome UI run in one WebContentsView with overlays as separate views, or should popovers temporarily shrink or cover the tab within the chrome view? This trades process count against UX.
