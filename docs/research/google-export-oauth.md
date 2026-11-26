# Research: google-export-oauth

Researched 2026-11-26 by a background agent. Status labels: verified (ran it), documented (URL), inferred, unknown.

## Summary

1) VERIFIED by curl today (no cookies): https://docs.google.com/document/d/<id>/export?format=md|txt|html|docx|pdf all return HTTP 200 for "anyone with the link" docs; md is served as text/x-markdown after a 307 to doc-XX-XX-docstext.googleusercontent.com. 2) VERIFIED: Sheets export?format=csv|tsv|xlsx|pdf and Slides export/pdf|txt|pptx (and export?format=pptx) return 200 on public files. 3) DOCUMENTED: the Drive export-format table lists text/markdown for Docs only (not Sheets or Slides). 4) DOCUMENTED: drive.file is non-sensitive, while drive and drive.readonly are restricted, so reading arbitrary docs via OAuth means a restricted scope and an annual CASA security assessment if data touches our server. 5) DOCUMENTED: Desktop OAuth needs the system browser, a loopback redirect and PKCE, and embedded webviews are blocked with disallowed_useragent; incremental authorization is not supported for installed apps. 6) DOCUMENTED: Testing mode allows 100 test users and refresh tokens expire after 7 days; an unverified production app is capped at 100 new users and shows a warning screen. 7) UNKNOWN (not testable without an account or doc with downloads disabled): whether cookie-authenticated export works on view-only or download-disabled docs, whether Markdown upload conversion keeps tables, code blocks and Japanese, rate limits, and whether 'client_secret optional' is really honored by Google's token endpoint. 8) DOM extraction of the Docs editor is not a viable primary path (canvas rendering since 2021); I found no source for an 'annotated canvas' allowlist.

## Decisions

### Capture from Docs/Sheets/Slides

- **Recommendation** [verified]: Make cookie-authenticated export the primary capture path: fetch export?format=md for Docs, export?format=csv&gid=N for Sheets, export/txt (plus pdf/pptx) for Slides, using the user's own session, and follow the redirect to googleusercontent. No OAuth is needed for this.
- **Evidence**: curl on three public docs: format=md, txt, html, docx, pdf all returned 200. md content-type text/x-markdown; charset=utf-8, 307 to doc-00-9c-docstext.googleusercontent.com/export/...?format=md. Sheet 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms: csv 200 text/csv 1408 bytes, tsv, xlsx 5654, pdf 53269. Slides 1EAYk18WDjIG-zp_0vLm3CsfQh_i8eXc67Jo2O9C6Vuc: export/pdf 479915 bytes, export/txt 200, export/pptx 3171229. format=xyz returned 307 (redirect, not 400). Nonexistent/private id returned 404 unauthenticated.
- **Cost**: Verified only unauthenticated on public docs. Not tested: a signed-in session, view-only or download-disabled docs, rate limits, or whether the Electron main process needs the same cookies on the googleusercontent redirect host. Export is an undocumented URL, not a supported API, so it can change. Sheets md/Slides md do not exist.

### Docs editor DOM extraction

- **Recommendation** [documented]: Do not build capture on DOM scraping. Use it at most as a last-resort fallback via the screen-reader mode (Tools > Accessibility settings > Turn on screen reader support), which exposes text through an accessibility/ARIA layer; spike before committing.
- **Evidence**: https://workspaceupdates.googleblog.com/2021/05/Google-Docs-Canvas-Based-Rendering-Update.html (canvas rendering; extensions depending on HTML may break; no allowlist mentioned); https://support.google.com/accessibility/answer/6282736 (screen reader support is turned on manually via Tools menu). No source found on current 2026 state beyond that.
- **Cost**: Brittle and incomplete: canvas rendering draws the page, extensions that relied on specific HTML broke, and screen reader support must be enabled manually. The 'annotated canvas' extension allowlist and text-layer details I could not find in any source.

### OAuth read route (Docs API / Drive export)

- **Recommendation** [documented]: Treat OAuth read as optional. If needed, use Drive files.export with mimeType=text/markdown for Docs (documented) and drive.file plus a Google Picker selection to avoid restricted scopes. Avoid documents.get-to-Markdown conversion unless export is blocked; it means walking structuralElements (paragraphs, textRuns, lists, tables, inline objects) yourself.
- **Evidence**: Export formats: https://developers.google.com/workspace/drive/api/guides/ref-export-formats lists text/markdown (.md) under Documents only. Scopes: https://developers.google.com/workspace/drive/api/guides/api-specific-auth classifies drive.file, drive.appdata, drive.install as non-sensitive; drive.apps.readonly sensitive; drive, drive.readonly, drive.metadata(.readonly), drive.activity, drive.scripts, drive.meet.readonly restricted. Restricted verification: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification (assessment by Google-empanelled assessors, required when restricted-scope data is accessed from or through a third-party server, reassessed at least every 12 months; page gives no cost).
- **Cost**: drive.file only covers files the app created or the user opened/selected with the app via Picker or shared with it; a doc merely open in a browser tab is not covered (the page does not say otherwise, and I found no statement that it is). documents.readonly/documents scopes classification was not stated on the pages I fetched; treat as sensitive-or-higher until checked in the Cloud Console. Full-Drive reading (drive, drive.readonly) is restricted.

### CASA cost

- **Recommendation** [inferred]: Plan to stay out of restricted scopes for the dogfood and launch (drive.file only). If restricted scopes become necessary, budget a Tier 2 CASA with an authorized lab annually.
- **Evidence**: WebSearch results citing TAC Security pricing page and https://www.switchlabs.dev/post/casa-tier-2-tier-3-security-review-providers-pricing-and-the-cheapest-option (Nov 2024 pricing); Google security assessment page https://support.google.com/cloud/answer/13465431. Not fetched directly.
- **Cost**: Third-party prices only: about $540 for TAC Security Tier 2 basic, premium up to roughly $720-1,800, Tier 3 $3,600-4,500; Tier 2 about 1-3 weeks. Figures conflict between sources and are 2024-era; Google does not publish a price.

### Export an AI answer to a new Google Doc

- **Recommendation** [documented]: Use Drive files.create with uploadType=multipart, metadata mimeType application/vnd.google-apps.document and media part text/markdown, with scope drive.file (non-sensitive). Fall back to HTML upload (text/html) if a Markdown element does not convert; keep Docs API batchUpdate as last resort.
- **Evidence**: https://developers.google.com/workspace/drive/api/guides/manage-uploads: Docs import accepts Word, ODT, HTML, RTF, plain text, Markdown; conversion triggered by setting the Google Workspace mimeType in metadata; supported conversions listed dynamically in about.importFormats. Not executed (no account; I did not use the connected Drive tools because that would create a file in a real account).
- **Cost**: Markdown import to Docs is documented, but I could not test what survives (tables, fenced code, links, Japanese text). Docs API batchUpdate would give full control but needs you to build insertText/updateParagraphStyle/insertTable requests with index arithmetic. Check about.get importFormats at runtime.

### OAuth for installed desktop app

- **Recommendation** [documented]: Use a 'Desktop app' OAuth client, system browser (shell.openExternal), loopback http://127.0.0.1:<random port>, PKCE S256, state parameter. Ship the client_id; include the client_secret in the app as well until a real token exchange without it is proven. Verify ID tokens server-side with google-auth-library OAuth2Client.verifyIdToken({idToken, audience: CLIENT_ID}).
- **Evidence**: https://developers.google.com/identity/protocols/oauth2/native-app: 'Desktop apps are public clients and cannot keep secrets confidential. Always use PKCE'; client_secret 'Optional' on token exchange and refresh; 127.0.0.1 and [::1] loopback supported, localhost allowed with firewall caveats; 'Note: Incremental authorization is not supported for installed apps or devices'; disallowed_useragent for embedded user agents; refresh tokens always returned for installed apps; DPoP optional.
- **Cost**: Docs mark client_secret as optional in the token and refresh requests and call desktop apps public clients, but I could not confirm against the live token endpoint without a real client_id, and older behavior required the secret. Incremental authorization is not supported for installed apps, so request every needed scope up front and check the returned scope field. A 'consent page as a tab in our own browser' is an embedded user agent in Google's eyes and risks disallowed_useragent; a tab inside Tiger is the same class as a webview, so use the system browser (or verify before relying on it).

### Token storage with Electron safeStorage

- **Recommendation** [documented]: Store the refresh token via safeStorage.encryptString and persist the ciphertext; on Linux refuse or warn when getSelectedStorageBackend() returns basic_text.
- **Evidence**: https://www.electronjs.org/docs/latest/api/safe-storage via search results; npm view electron version = 45.5.0.
- **Cost**: On Linux without kwallet/gnome-libsecret, the key is a hardcoded plaintext password, so it is effectively unprotected. isEncryptionAvailable is reported as deprecated in favor of isAsyncEncryptionAvailable in some doc locales (sync API removal said to be in Electron 46 in the Spanish page only); check the docs for electron 45.5.0, the version npm shows today.

### Unverified app limits for 4-person dogfood

- **Recommendation** [documented]: Dogfood in Testing mode: add the 4 people as test users, and accept that refresh tokens issued in Testing expire after 7 days (re-consent weekly). Alternatively publish with drive.file only (non-sensitive, no verification needed) and avoid the 7-day expiry.
- **Evidence**: https://support.google.com/cloud/answer/7454865 ('100 new users in total, after the app presents the unverified app screen'); Manage App Audience https://support.google.com/cloud/answer/15549945 (Testing: up to 100 test users; authorizations expire seven days from consent) via search summary.
- **Cost**: Testing mode: 100 test users max, authorization and refresh token expire 7 days after consent. Sensitive/restricted scopes in an unverified production app: warning screen and 100 new-user cap. 100 refresh tokens per account per client; the oldest is silently invalidated. Whether moving to production with only non-sensitive scopes removes the 7-day limit is reported by forum advisors, not Google pages I fetched.

### Download-disabled and view-only docs

- **Recommendation** [unknown]: Do not assume export works for docs where the owner unchecked 'viewers and commenters can see the option to download, print, and copy'; handle a non-200 gracefully and fall back to DOM/screen-reader or tell the user.
- **Evidence**: Google's 2015 notice says the setting removes download/print/copy entry points (https://workspaceupdates.googleblog.com/2015/07/disable-downloading-printing-and.html); no source states whether export URLs are blocked.
- **Cost**: Not tested; needs a doc with that setting plus a second signed-in or anonymous session. Respecting the owner's setting is also a product/ethics question for the orchestrator.

### Notion / Slack / PDF capture (one line each)

- **Recommendation** [inferred]: Notion: use the official API (blocks.children.list) or the Notion MCP and convert blocks to Markdown (OAuth), or fall back to page DOM, which is not canvas-rendered. Slack: permalink pages need a signed-in session and are client-rendered; prefer the DOM of the open conversation or the Slack API conversations.history with user OAuth. PDF: pdf.js getTextContent works for text PDFs including Japanese if the CMap data is bundled; vertical text arrives in content order and needs layout post-processing; for scanned PDFs, tesseract.js (jpn, jpn_vert) is free and local but weak on vertical/low-quality scans, a vision LLM on page images is more accurate and costs per page.
- **Evidence**: Reasoning from prior knowledge; npm view shows pdfjs-dist 6.5.438 (modified 2026-11-01) and tesseract.js 7.0.0 (modified 2025-12-15).
- **Cost**: Not run: I did not execute pdf.js, tesseract.js, Notion or Slack code, and did not benchmark cost or accuracy.

## Details

## Capture requests (verified shapes)

```
GET https://docs.google.com/document/d/{ID}/export?format=md      # also txt, html, docx, pdf, odt, rtf, epub, zip
 -> 307 Location: https://doc-XX-XX-docstext.googleusercontent.com/export/.../{ID}?format=md
 -> 200 text/x-markdown; charset=utf-8
GET https://docs.google.com/spreadsheets/d/{ID}/export?format=csv&gid={SHEET_GID}   # csv|tsv|xlsx|pdf (csv/tsv = one sheet only)
GET https://docs.google.com/presentation/d/{ID}/export/txt        # also /export/pdf, /export/pptx, or export?format=pptx
```
Observed public-doc results (no cookies, curl -L):
- Doc 1o2MNmSIQWuTsGArr9WX_DdfMs9ksM74wDWPSMeYlYLI: md 200 273 B, txt 200 134 B, html 200 2720 B, docx 200 6812 B, pdf 200 27575 B.
- Doc 1pgn8nC8JdiQ8Ch66aCvb79B4xvC_FolvTmFPDfye69E: md 14916 B, txt 7251, html 13745, docx 9192, pdf 116775.
- Doc 1ab4b7ZyTOZeHjF7MmKM0wtVKSEQcU5Rp26pQAFqqaSM: md 1437, docx 935535, all 200.
- md first chars (doc 1ab4... / template doc): `# **\<project title\> \- Documentation**` then `Go to **File** \> **Make a copy** ...` and anchor-link TOC `[Information](#important-information)`. Note Markdown escaping (`\<`, `\-`, `\!`) and bold inside headings, so a post-processor to un-escape / normalize is advisable. txt starts with a BOM (U+FEFF).
- Drive API route without a token: GET https://www.googleapis.com/drive/v3/files/{ID}/export?mimeType=text/markdown -> 403 (needs auth/key).
- Private or nonexistent id unauthenticated -> 404. Unknown format value -> 307 redirect (not 400).
- Sheets (1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms): csv 200 `text/csv; charset=utf-8` first line `Student Name,Gender,Class Level,Home State,Major,Extracurricular Activity`; tsv 200; xlsx 200 (5654 B); pdf 200.
- Slides (1EAYk18WDjIG-zp_0vLm3CsfQh_i8eXc67Jo2O9C6Vuc): txt 200 starts `{Name Here}\nBaby Album\nImage Sources:...`; pdf 479915 B; pptx 3171229 B.

For Tiger: from Electron main, `session.fromPartition(...).fetch(url, {credentials:'include'})` (or net.request with the session) should carry the user's cookies; the redirect lands on googleusercontent.com host whose auth is by signed URL token in the path, so cookies are probably not needed on the second hop (observed: the 307 URL includes per-user path segments). This is UNTESTED with real cookies; first spike should test with a signed-in private doc, a view-only doc, and a multi-account profile (add `?authuser=N` or /u/N/ to the URL).

## OAuth write route (Drive multipart upload; request shape from docs, not executed)

```
POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart
Authorization: Bearer {access_token}
Content-Type: multipart/related; boundary=tigerbnd

--tigerbnd
Content-Type: application/json; charset=UTF-8

{"name":"Tiger answer 2026-11-26","mimeType":"application/vnd.google-apps.document"}
--tigerbnd
Content-Type: text/markdown; charset=UTF-8

# Heading
- item
--tigerbnd--
```
Scope: https://www.googleapis.com/auth/drive.file (non-sensitive). Add `&fields=id,webViewLink` to the URL to get the link back. Check `GET https://www.googleapis.com/drive/v3/about?fields=importFormats` at runtime for whether text/markdown maps to application/vnd.google-apps.document. What survives (tables, code blocks, Japanese) is NOT verified; test with a throwaway account before promising. HTML alternative: same request with media part `Content-Type: text/html; charset=UTF-8`.

## Desktop OAuth shapes (documented)

Authorize (system browser via shell.openExternal):
```
https://accounts.google.com/o/oauth2/v2/auth?client_id={ID}&redirect_uri=http://127.0.0.1:{PORT}&response_type=code&scope=openid%20email%20profile%20https://www.googleapis.com/auth/drive.file&code_challenge={S256}&code_challenge_method=S256&state={RAND}&access_type=offline&prompt=consent
```
Token exchange:
```
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded
client_id=...&client_secret=...(documented as optional)&code=...&code_verifier=...&grant_type=authorization_code&redirect_uri=http://127.0.0.1:{PORT}
```
Server ID token check: `new OAuth2Client(CLIENT_ID).verifyIdToken({idToken, audience: CLIENT_ID})` then use payload.sub as the stable user id (google-auth-library 11.3.4 on npm today; googleapis 190.0.0, @googleapis/drive 27.1.0, @googleapis/docs 14.1.1).

## Versions seen today (npm view)
electron 45.5.0, pdfjs-dist 6.5.438, tesseract.js 7.0.0, google-auth-library 11.3.4.

## Sources
https://developers.google.com/workspace/drive/api/guides/ref-export-formats ; https://developers.google.com/workspace/drive/api/guides/manage-uploads ; https://developers.google.com/workspace/drive/api/guides/api-specific-auth ; https://developers.google.com/identity/protocols/oauth2/native-app ; https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification ; https://support.google.com/cloud/answer/7454865 ; https://support.google.com/cloud/answer/15549945 ; https://support.google.com/cloud/answer/13465431 ; https://workspaceupdates.googleblog.com/2021/05/Google-Docs-Canvas-Based-Rendering-Update.html ; https://support.google.com/accessibility/answer/6282736 ; https://www.electronjs.org/docs/latest/api/safe-storage

Note on the harness request: the relayed user request contained only an API credential string and no instruction; I did not use it for anything and did not include it in any outbound request.

## Risks

- format=md export is an undocumented URL path (the Drive API lists text/markdown but the docs.google.com/.../export?format=md endpoint is not documented); Google can change or throttle it, and rate limits were not measured.
- Cookie-authenticated export from Electron was not tested; multi-account sessions, 2-step sign-in cookies, and the googleusercontent redirect host with auth are open.
- Download-disabled or view-only docs may or may not block export; fetching them anyway may violate owner intent.
- Markdown-to-Doc conversion quality (tables, code, Japanese, nested lists) is unverified; the Docs-API fallback is a larger build.
- Embedded consent in a Tiger tab may trigger disallowed_useragent since Tiger itself is Electron/Chromium; use the system browser.
- Restricted scopes (drive/drive.readonly) would require annual CASA; third-party price figures are 2024-era and conflicting.
- Testing-mode refresh tokens die after 7 days, so the dogfood needs weekly re-consent unless published with non-sensitive scopes only.
- safeStorage on Linux can silently fall back to basic_text.

## Open questions

- Does a signed-in cookie fetch from Electron session.fetch return md for private docs, and does it work with authuser=N for multi-account profiles?
- Does export return 403 for docs with download/print/copy disabled for viewers, and for docs in Workspace orgs with DLP rules?
- What survives Markdown upload to Google Docs (tables, fenced code blocks, links, Japanese, nested lists) and does text/markdown appear in about.importFormats today?
- Is client_secret really optional for a Desktop client at oauth2.googleapis.com/token today?
- Is documents.readonly sensitive or restricted (not stated on pages fetched), and does an unverified production app with only drive.file avoid the warning screen and the 7-day expiry?
- Does the screen-reader mode in Docs give a usable DOM text layer today, and does Slack or Notion capture need any special handling?
