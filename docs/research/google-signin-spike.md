# Research: google-signin-spike

Researched 2026-11-26 by a background agent. Status labels: verified (ran it), documented (URL), inferred, unknown.

## Summary

1. [verified] Built and tested spike/ (Electron 45.5.0, Chromium 156.0.8078.109, Node 24.22.3) under xvfb-run here. It runs with `cd spike && npm install && npm start`, and `npm run smoke` completes in both UA modes. The detector self-tests caught Google's real Japanese "ログインできませんでした / このブラウザまたはアプリは安全でない可能性があります" page and Slack's unsupported-browser page, and marked the matching checks Fail with the URL.
2. [verified] In both electron-default and chrome-like modes, no service blocked anything before credentials were entered. Google sign-in, Docs, Drive, the OAuth authorize endpoint, Slack, Notion, Microsoft login and Word for the web all returned 200 with normal sign-in pages, and none showed disallowed_useragent. Clicking Notion's and Slack's "Google" button reached Google's OAuth identifier page in both modes.
3. [verified] Google does sniff the Electron token. For the same URL, the default Electron UA got `flowName=WebLiteSignIn`; the chrome-like and firefox-google UAs got `flowName=GlifWebSignIn`. The real decision ("Couldn't sign you in") happens after email and password are entered, and no account was available here to reach that step. This container therefore cannot answer the day-1 question; the founder's Mac run decides it.
4. [verified] What Electron 45 exposes by default: the UA header and navigator.userAgent both carry `<app>/<ver> ... Electron/45.5.0`. Sec-CH-UA is `"Not:A-Brand";v="8", "Chromium";v="156"`, with no Google Chrome brand. navigator.webdriver is false. window.chrome exists but has no keys. The chrome-like mode removes the app and Electron tokens and reduces the version to 156.0.0.0, the same shape as Chromium's own UA (Min does the same). Sec-CH-UA is left unchanged.
5. [documented] Google's stated rules ban sign-in from embedded frameworks (CEF), automation, header rewriting/proxying, and use of another browser's UA on accounts.google.com. A third-party Obsidian report (Aug 2026) says a clean Electron 43 harness signed into Google even with the Electron UA, while a malformed `Chrome` UA got a 401. Maintained wrappers fake the UA: Min sends a Firefox UA to accounts.google.com, and Ferdium sends a Chrome UA with the version number removed. Wavebox moved off Electron to a full Chromium fork in 2019.
6. [verified] Popups: `setWindowOpenHandler` → `action:'allow'` + `createWindow` → a WebContentsView tab keeps `window.opener` (local test page title became OPENER-OK), and `window.close()` closes the tab. This is what Google, Notion and Microsoft popup sign-ins need. Cursor's built-in Electron browser breaks OAuth precisely because it blocks window.open.
7. [verified] Found an Electron 45 bug: once an adopted popup's webContents is destroyed, reading `WebContentsView.webContents` freezes the main process. Mitigation: keep your own wc reference; the spike does this.
8. [verified] Electron only reports notification permission as granted (the default) or denied; it has no 'default' (not yet asked) state. In a stock Electron profile, sites therefore never offer "enable notifications". The spike adds a small main-world shim so pages see 'default', and Tiger will need the same fix (or a Chromium patch).
9. [documented/inferred] Passkeys: `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` returns false until `app.configureWebAuthn` is called. Touch ID needs a signed app with a keychain-access-group. iCloud Keychain passkeys go through Associated Domains, which requires google.com's apple-app-site-association file to list our app, so that is impossible for third-party sites in stock Electron. Only Apple's restricted web-browser public-key-credential entitlement (the browser route Chrome uses, which Electron does not use) would fix it. Expect "Try another way" (password plus phone prompt, TOTP, or a USB security key) to be the 2FA path in Electron.
10. [inferred] Recommendation: keep Electron unless the Mac run shows Google's "Couldn't sign you in" in chrome-like mode. Run the three modes in order: chrome-like, then electron-default, then firefox-google. If only firefox-google works, Electron still works but depends on a UA workaround Google could block. If every mode is blocked, go for the Chromium fork.

## Decisions

### Default UA strategy for Tiger

- **Recommendation** [verified]: Ship chrome-like: remove the app-name and Electron/x tokens and reduce the version to Chrome/<major>.0.0.0. Leave Sec-CH-UA as Chromium sends it (Chromium plus GREASE, no Google Chrome brand). Use the same UA in every request; never switch it per host in the middle of a navigation.
- **Evidence**: The spike's local echo server recorded the chrome-like header `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36` with sec-ch-ua `"Not:A-Brand";v="8", "Chromium";v="156"`, and navigator.userAgent matched it. Google served GlifWebSignIn to chrome-like and WebLiteSignIn to the default Electron UA (smoke-out/*/results.json). Min does the same stripping (main/UASwitcher.js line 12).
- **Cost**: Google's 2020 guidance says a browser must not use another browser's UA on accounts.google.com. Our UA is the same string Chromium itself sends, which is defensible, but Google can still tighten detection, for example through the empty window.chrome or the brand list. Changing the UA during a navigation cancels the navigation; Ferdium documents this for SAML POSTs.

### Fallback if Google blocks chrome-like

- **Recommendation** [documented]: Next, try SPIKE_UA=firefox-google: Min's approach of sending a Firefox UA header only to accounts.google.com. If only that works, treat Electron as viable but fragile and keep the fork decision open.
- **Evidence**: Min main/UASwitcher.js lines 45-65 (Firefox UA plus Sec-CH-UA rewrite for accounts.google.com, citing minbrowser/min#868). Ferdium src/models/UserAgent.ts lines 79-99 sets a Chrome UA with the version removed for accounts.google.com, and only on did-navigate. Here the spike's firefox-google mode ran and reached GlifWebSignIn unauthenticated.
- **Cost**: The header UA and navigator.userAgent disagree (Firefox in the header, Chrome in JavaScript). Google can detect that mismatch, and it is exactly the impersonation the guidance forbids.

### Popups / window.open

- **Recommendation** [verified]: Turn window.open into a tab by returning {action:'allow', outlivesOpener:true, createWindow: opts => new WebContentsView({webPreferences: opts.webPreferences, webContents: opts.webContents}).webContents}. Do not use deny plus loadURL in a new tab, because that loses window.opener.
- **Evidence**: The smoke local-window-opener test: the opener's title became OPENER-OK after the popup's postMessage through window.opener, and the tab count went 2 to 1 after the popup's window.close(). The Notion 'Google' click opened accounts.google.com OAuth (Notion client) as a tab in both UA modes.
- **Cost**: Popups open full-size as tabs instead of small windows, and OAuth pages that assume a small window will look odd.

### Electron 45 WebContentsView hang

- **Recommendation** [verified]: Store tab.wc = view.webContents when the tab is created, and never read view.webContents after a 'destroyed' event. Remove the tab with setImmediate.
- **Evidence**: Instrumented run: right after an adopted popup called window.close(), `t.view.webContents.isDestroyed()` never returned, so the main-process event loop stopped (a 1 s tick logger went silent). After switching to the cached reference, the whole smoke run completes.
- **Cost**: Only seen on Linux/xvfb. Not yet reported upstream.

### Notification permission

- **Recommendation** [verified]: Pair a permission check handler, which returns true only after the user allowed notifications for that origin, with a tab preload that uses contextBridge.executeInMainWorld to make Notification.permission and permissions.query return 'default'/'prompt' until the user decides.
- **Evidence**: probe2.js measured three cases. With no check handler, Notification.permission and permissions.query were both 'granted'. With a handler returning false, both were 'denied'. With a handler returning undefined, both were 'denied'. With the shim, https pages report 'default' (smoke results, notificationPermission field).
- **Cost**: Pages can detect the shim (Function.toString). A proper fix needs an Electron or Chromium patch.

### Passkeys / WebAuthn on macOS

- **Recommendation** [documented]: Do not promise passkey sign-in on day 1. The spike leaves platform authenticators off and records what 2FA Google offers. For the product: call app.configureWebAuthn({touchID:{keychainAccessGroup}}) in a signed build (device-bound credentials, registered again per browser). iCloud Keychain passkeys for arbitrary sites require Apple's restricted com.apple.developer.web-browser.public-key-credential entitlement, which stock Electron does not use. That is a point in favour of the fork.
- **Evidence**: electron.d.ts (45.5.0) lines 1147-1229: isUserVerifyingPlatformAuthenticatorAvailable() returns false until configureWebAuthn is called. platformPasskeys requires the Associated Domains entitlement, an embedded provisioning profile, and the relying party's apple-app-site-association file listing <TEAM_ID>.<BUNDLE_ID>. Touch ID requires keychain-access-groups. The smoke run measured platformAuthenticator=false (Linux). Apple developer forum threads show macOS browsers requesting the browser entitlement in 2026.
- **Cost**: USB security keys and phone (hybrid/QR) passkeys in Electron on macOS are untested here (no hardware). The founder's run must report what Google actually offered.

### Microsoft 365 with Conditional Access

- **Recommendation** [inferred]: Personal or unmanaged M365 should work like any Chromium browser. Tenants that require a compliant or registered device will block a non-Edge/Chrome/Safari browser. Plan to open the system browser for those sign-ins, or accept that the fork route is needed for them.
- **Evidence**: Microsoft Entra Conditional Access documentation: device-based CA works through Edge, Chrome (with an extension or policy), and Firefox/Safari with the macOS Enterprise SSO plug-in. Electron has no such integration. Unauthenticated smoke: login.microsoftonline.com and word.cloud.microsoft both returned 200 with no unsupported-browser page in either UA mode.
- **Cost**: Not testable without a managed tenant.

### OAuth consent in our own tab (Docs export feature)

- **Recommendation** [documented]: For our own Google OAuth (Docs API export), use the system browser with a loopback or custom-scheme redirect, which is what Google recommends for desktop apps. Do not rely on the in-tab consent page, even though it currently loads.
- **Evidence**: Google's 2021 announcement 'Upcoming security changes to Google's OAuth 2.0 authorization endpoint in embedded webviews' says disallowed_useragent targets embedded webviews. In the smoke run, the OAuth Playground authorize URL and Notion's and Slack's Google OAuth loaded the identifier page in all modes with no disallowed_useragent.
- **Cost**: The OAuth app's own sign-in then happens in the user's default browser, not in Tiger, so the Google session there is separate.

## Versions

| Name | Version | Source |
| --- | --- | --- |
| electron | 45.5.0 | npm view electron version; node_modules/electron/package.json |
| chromium (bundled) | 156.0.8078.109 | process.versions.chrome in the spike |
| node (bundled in Electron) | 24.22.3 | process.versions.node in the spike |
| node (host, needed to install/run) | >=22.12.0 required; tested on 22.23.5 | electron package.json engines; node -v |
| npm | 10.9.9 | npm -v |

## Details

## How to run (founder, Mac)
`cd spike && npm install && npm start` (needs Node >= 22.12; Electron 45 downloads its binary on first `require('electron')`, because Electron 45 has no postinstall step). README.md (12 lines, Japanese) covers the 5-minute procedure. Send back `spike/spike-report.md`, or use the panel's "Markdown をコピー" button. Each UA mode has its own profile at `~/Library/Application Support/tiger-spike-<mode>`, so the A/B comparison is not polluted by cookies from the other mode. If chrome-like is blocked, run `SPIKE_UA=electron-default npm start` and `SPIKE_UA=firefox-google npm start`.

## Smoke results (unauthenticated, this container, 2026-11-26)
| target | chrome-like | electron-default |
|---|---|---|
| accounts.google.com ServiceLogin?hl=ja | 200, identifier page, **flowName=GlifWebSignIn** | 200, identifier page, **flowName=WebLiteSignIn** (different, older sign-in page) |
| docs.google.com/document/create, drive | 200, redirected to sign-in (Glif) | same |
| OAuth authorize (OAuth Playground client) | 200, identifier page, no disallowed_useragent | same |
| Notion login, then click "Google" | Google OAuth (Notion client) opened as a popup tab, opener kept | same |
| Slack signin, then click "Google" | same-tab redirect to Google OAuth identifier page | same |
| slack.com/signin, app.slack.com/client | 200, login / workspace-signin, no unsupported page | same |
| login.microsoftonline.com, word.cloud.microsoft | 200, normal pages | same |
| self-test: accounts.google.com/signin/rejected?rrk=46&hl=ja | detected google-insecure-browser (ok) | ok |
| self-test: app.slack.com/client with a Chrome 60 UA | detected slack-unsupported-browser (ok) | ok |
firefox-google mode (google-signin, oauth only): GlifWebSignIn, no block.

## Block strings (captured live, used by checks.js)
- Google (accounts.google.com/signin/rejected?rrk=46): EN "Couldn’t sign you in" / "This browser or app may not be secure." / "Try using a different browser. If you’re already using a supported browser, you can try again to sign in."; JA "ログインできませんでした" / "このブラウザまたはアプリは安全でない可能性があります。" / "別のブラウザをお試しください。サポートされているブラウザをすでに使用している場合は、もう一度ログインをお試しください。"
- Google malformed request (what Obsidian's "Chrome" UA triggered): EN "The server cannot process the request because it is malformed"; JA "リクエストの形式が正しくないため、サーバーで処理できません".
- disallowed_useragent: the literal token appears in every locale.
- Slack (app.slack.com): EN "Please update your browser or use the Slack app" / "We are no longer supporting this version of your browser"; JA "ブラウザを更新するか、Slack アプリを使用してください" / "お使いのバージョンのブラウザは、もうサポート対象ではありません". On slack.com/signin (HTTP 403): EN "your browser is not supported!"; JA "お使いのブラウザはサポートされていません！".
- A generic "browser … not supported / ブラウザ…サポートされていません" pattern is logged only; it does not auto-fail a check.

## Per-check assessment (mechanism, then mitigation)
- **Google sign-in**: May fail with "Couldn't sign you in", because Google classifies the client after the identifier/password step using the UA token (confirmed: it already picks a different flow for an Electron UA), client hints, JS fingerprints (empty window.chrome) and automation signals. Mitigation: chrome-like UA (default); fallback: firefox-google. If every mode is blocked, go for the Chromium fork. Not verifiable here (needs a real account).
- **Docs new / type / comment**: Low risk once signed in. It is the same Chromium 156 renderer, and Docs only needs a recent Chromium version. Watch the Chromium lag: Electron's major version runs about 1-2 behind Chrome stable.
- **Docs Japanese IME**: Chromium's IME path is the same as Chrome's. Risk is focus handling between the chrome UI webContents and the WebContentsView (candidate window position, a lost first keystroke). The spike focuses the tab view on open and activate. Not verifiable here (no IME under xvfb).
- **Docs paste**: On macOS, Cmd+C/V/X/A only work if the app menu has the Edit role. The spike sets `role:'editMenu'`. Image paste uses Chromium's clipboard path. Not verified on a Mac.
- **Drive / upload**: The `<input type=file>` uses Electron's native file chooser, so it should work. Drag-and-drop from Finder into a WebContentsView should also work. Not verified.
- **Download**: `will-download` with setSavePath goes straight to ~/Downloads (no dialog) and is logged in the report. Docs exports (PDF/docx) are blob or redirect downloads, which Chromium handles.
- **Slack**: The risk is the unsupported-browser page triggered by UA version sniffing; Slack checks only the version, not the Electron token (both modes passed unauthenticated). "Sign in with Google" goes through Google (see above). Huddles need camera/mic permission (asked in a dialog).
- **Notion**: Email-code login is low risk. "Continue with Google" is a popup that needs window.opener, which is verified to work.
- **M365 / Word online**: Personal accounts should work. Tenants with device-based Conditional Access will block. Word for the web shows "browser not supported" only for old versions. Popups for MSAL also depend on window.opener, which works.
- **Passkey / 2FA**: Google prompts for a passkey first when the account has one. In the spike, platform authenticators are off, so expect "Try another way" (phone prompt, TOTP, SMS, or a USB key). iCloud Keychain passkeys will not appear (see decisions).
- **Notification prompt**: Fixed by the shim plus check handler. macOS also asks for an OS-level notification permission for "Electron.app" on the first notification.
- **Persistence**: The `persist:tiger-spike` partition, `cookies.flushStore()` on before-quit, and a launch-time record of which login cookies exist (names only, never values; Google SID/__Secure-1PSID, Slack d, Notion token_v2, Microsoft ESTSAUTH*), shown in the report. Not verifiable here without a login.
- **OAuth consent in a tab (extra check)**: Loads for Notion's client and the OAuth Playground client in every mode. disallowed_useragent targets embedded webviews (Android WebView, WKWebView). Our tab is a full Chromium browser with a real UA, so it is not expected; the auto-detector would catch it.

## What this container could and could not verify
Verified: build and install, `npm start` under xvfb (driven over CDP: open, Fail, a note in Japanese, and the report write), the smoke run in 3 UA modes, the headers actually sent, navigator properties, popup/opener behaviour, notification permission states, block detection on real Google and Slack block pages, legible Japanese UI (IPAGothic here; Hiragino on a Mac), screenshots in smoke-out/. Not verifiable: any authenticated flow, Google's post-password decision, 2FA/passkeys, IME, macOS clipboard/menu, macOS notifications, Finder upload/download dialogs, real cookie persistence, M365 Conditional Access. `xdotool` is absent, so UI clicks were driven over CDP instead.

## Other notes
- Linux requires `--no-sandbox` (the SUID chrome-sandbox is not set up by npm; as root Chromium refuses to start). launch.js and smoke.js add it on Linux only. On macOS nothing is added.
- The geolocation request from google.com's homepage is auto-denied, to keep the modal dialog out of the founder's way.
- The repo already contains a WIP commit d308334 by another session (08:40) with an early version of spike/. I made no git changes, so the current files show as modified/untracked.
- Sources: Google guidance https://developers.googleblog.com/guidance-to-developers-affected-by-our-effort-to-block-less-secure-browsers-and-applications/ ; Google help https://support.google.com/accounts/answer/7675428 ; OAuth webview policy https://developers.googleblog.com/upcoming-security-changes-to-googles-oauth-20-authorization-endpoint-in-embedded-webviews/ ; Min https://github.com/minbrowser/min/blob/master/main/UASwitcher.js and https://github.com/minbrowser/min/issues/868 ; Ferdium https://github.com/ferdium/ferdium-app/blob/develop/src/models/UserAgent.ts and https://github.com/ferdium/ferdium-app/blob/develop/src/helpers/userAgent-helpers.ts ; Obsidian Electron 43 report https://forum.obsidian.md/t/cant-sign-in-to-google-in-web-viewer-401-malformed/117394 ; Cursor popup/OAuth https://forum.cursor.com/t/browser-not-working-with-google-sso/156837 ; Wavebox https://github.com/wavebox/waveboxapp ; Apple entitlement threads https://developer.apple.com/forums/thread/852550 ; Trello passkey hang https://jira.atlassian.com/browse/TRELLO-1899 ; Entra CA https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-conditional-access-conditions

## Risks

- The day-1 question is still open: no authenticated sign-in was possible here, and Google's block decision happens after the password step. Unauthenticated parity between UA modes does not mean sign-in passes.
- Google already treats an Electron-token UA differently (WebLiteSignIn); the chrome-like UA is a policy-grey workaround that Google could defeat with JS fingerprints (empty window.chrome, the brand list) at any time.
- iCloud Keychain passkeys are effectively unavailable in stock Electron (they need a restricted Apple browser entitlement Electron does not use). Users whose Google accounts are passkey-only will hit friction.
- Device-based Conditional Access in Microsoft Entra tenants will likely block Electron; this matters for enterprise customers in Japan.
- Electron 45 main-process hang when reading WebContentsView.webContents after a popup is destroyed: worked around, but a sign of immature popup/WebContentsView code paths.
- Electron reports notification permission only as granted/denied, so a shim or Chromium patch is needed; the shim can be detected.
- Linux runs need --no-sandbox (spike only); the product must ship a properly set-up sandbox.
- The founder may use the Node version installed on the Mac; Electron 45 requires Node >= 22.12 (engines field set, README says so).

## Open questions

- Does Google let the founder sign in through password + 2FA in chrome-like mode on macOS? This is the deciding result. If chrome-like is blocked, does electron-default or firefox-google get through?
- What second factor did Google offer inside Electron (passkey prompt that fails, phone prompt, TOTP, security key)? Does a USB security key or phone QR (hybrid) work in Electron 45 on macOS?
- Does Japanese IME in Google Docs behave correctly in a WebContentsView (candidate window position, first keystroke after a focus change)?
- Does the team's Microsoft 365 tenant (if any) enforce device-based Conditional Access?
- Should spike-report.* stay git-ignored? I ignored it so personal notes are not committed by accident; the brief only required node_modules and smoke-out to be ignored.
- Report the WebContentsView.webContents hang to Electron upstream?
