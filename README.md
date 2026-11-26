# Tiger

Tiger is a standalone browser (Electron now, Chromium fork later) whose AI layer builds one shared team context from the pages members explicitly share to a Space. Nothing leaves a member's machine until they click share, or attach the current page to one AI message; banking, email, password managers and private windows are never captured.

Product context and decision status: `docs/HANDOFF.md`. Invariants and architecture: `CLAUDE.md`. Research with evidence: `docs/research/*.md`.

Labels used below: **verified** = run in the Linux build container, with the command shown. **not run** = needs a Mac, a real account or a real key that the container did not have. Nothing in this repo has been run on macOS yet.

## 1. Status of the MVP features (HANDOFF section 6)

The browser's UI is a developer harness (section 11). "Works" means the behaviour is tested through the real server and the real Electron app, not that a designed screen exists.

| # | Feature | Status | Evidence and gaps |
|---|---|---|---|
| 1 | Sign in, create a Space, invite members | Working and tested, except Google sign-in | Dev login, Space creation, invite tokens (hashed, 14 days, revocable, email-bound) and non-member isolation (404 on all 20 scoped routes) pass server tests. The in-app flow passes `mvp.e2e.ts`. Google sign-in passes only against a fake Google. The harness has no button to create an invite; use the `curl` in section 4. It can accept one. |
| 2 | Share this tab to a Space | Working and tested | Capture, preview, confirm, store, index (real e5 embeddings in server tests), unshare. Blocklist and private windows enforced in the main process (E2E). Slack and Notion extraction handlers are written against fixture DOMs only; not checked on live pages. Google Docs/Sheets/Slides export fetch is tested with fakes, not with real cookies. |
| 3 | Space chat with a model picker | Claude: working, tested live. OpenAI, Gemini: built, unverified | Anthropic streamed live over the WebSocket with claude-haiku-5-5 (cache write then read confirmed); Sonnet 5.5, Opus 5.5 and Fable 5.2 each returned text through the router once. OpenAI and Gemini adapters were never called with a key. It is a harness panel, not a side panel. |
| 4 | Thread visible to all members, answers cite shared items | Working and tested | Two members over real WebSockets in server and client tests; citations validated against the source list, bad markers stripped, quote kept per citation. The E2E suite uses one member. Not tested: a Space above 40k tokens in chat (retrieval mode is tested separately). |
| 5 | Export an AI answer to a Google Doc | Built, unverified against Google | Full flow (PKCE, loopback, `drive.file`, multipart upload, HTML fallback) passes against a strict fake Google. The harness button exports the current page's Markdown or a sample, not an answer; the answer export exists only in `packages/client` (`export.ts`). Not run: real consent screen, real upload, whether Markdown import keeps tables and Japanese. |
| 6 | Per-item unshare and an audit list | Unshare: working and tested. Audit list: server only | Unshare deletes content, versions, chunks and empties stored quotes; an audit tombstone remains (server and E2E tests). `GET /v1/spaces/:id/audit` is tested; the harness has no audit view. |
| 7 | A working browser | Engine working on Linux, nothing on Mac | Tabs, back/forward, find, zoom, popups with `window.opener`, history, bookmarks store, downloads, permission prompts, session restore, cookie persistence across restart: E2E on Linux/Xvfb. Whether Google Docs, Slack, Notion and Microsoft 365 are usable for real work is not known (section 9). |

Not built: auto-capture rules, Slack read connector, Chromium fork, extensions, admin console, billing, mobile, the designed UI.

## 2. Prerequisites

- Node 22 or newer (the container has 22.23.5) and pnpm 10.28.0 (`packageManager` in `package.json`; `corepack enable` then pnpm picks it up; not run on a Mac).
- Docker Desktop for the database on a Mac. The Linux container used a local Postgres instead.
- Postgres 16 with pgvector 0.8 or newer and pg_trgm; the compose image provides both.
- Network access to Hugging Face for the first use of the real embedder (the model is cached afterwards; its download size and time were not measured here).
- An Anthropic key only if you want a real model. Without any key the server offers a deterministic mock model.

## 3. First run

All commands run from the repository root unless a `cd` is shown. macOS-specific steps are **not run**.

```sh
pnpm install                          # not re-run for this README; node_modules already existed here
docker compose up -d db               # not run: Docker Hub rate-limited the image pull in the container
docker compose ps                     # wait until db is "healthy"
```

`docker-compose.yml` starts `pgvector/pgvector:0.8.7-pg16`, creates `tiger_dev` and `tiger_test` and the `vector` and `pg_trgm` extensions through `apps/server/scripts/docker-init.sql`, and listens on `127.0.0.1:5432` with user and password `tiger`. `docker compose config -q` passed, but the container was never started, so its locale, extensions and healthcheck are unverified. If port 5432 is taken by a local Postgres on the Mac, stop that one first.

Linux without Docker (what was used here): `bash apps/server/scripts/dev-db.sh`, which needs the `postgres` OS user.

**Migrations.** The server applies pending migrations on every start (`apps/server/migrations`, plain SQL, advisory lock, one transaction per file). To run them alone: `cd apps/server && pnpm migrate`.

**Server with the mock provider** (verified, started and called with `curl` on 2026-11-26 against a local Postgres):

```sh
cd apps/server
cp .env.example .env                  # defaults point at tiger_dev on 127.0.0.1:5432
RETRIEVAL_EMBEDDER=hash pnpm start    # then: curl localhost:8787/v1/health  ->  {"ok":true,"version":"0.0.0"}
```

With no provider key and `NODE_ENV` not `production`, the server offers `mock/...` as the only model; it answers deterministically and cites `[n]` for up to three sources. `RETRIEVAL_EMBEDDER=hash` uses a fast deterministic embedder for local play: search quality is not meaningful. Leave it out to use the real model `multilingual-e5-small` (q8), which downloads on first use into `~/.cache/tiger/models`; the first share or question then waits for the download (not timed here).

**Server with a real Anthropic key** (verified through the test suite; the dev server itself was not started with a key in this README):

```sh
cd apps/server
ANTHROPIC_API_KEY=sk-ant-... pnpm start   # or put the key in apps/server/.env; the file is not committed
```

`GET /v1/models` then lists the Claude models as available and the best one becomes the default (`anthropic/claude-sonnet-5-5` first). The key is read only by the server; it never reaches the browser. `pnpm dev` is the same with `tsx watch`.

**Browser in dev mode** (the server must be running; dev mode itself is verified on Linux, on a Mac **not run**):

```sh
pnpm dev:browser                      # electron-vite dev; the UI loads from the Vite dev server
```

The harness shows a dev sign-in form (any email, no password; it works only while the server has `AUTH_DEV_LOGIN=1`), then: create or pick a Space, open a page in a tab, "share this tab" (a preview of exactly what will be stored, then confirm), ask in a thread, attach the current page to a private-thread message, unshare an item. The browser talks to `http://localhost:8787` unless `TIGER_SERVER_URL` is set.

The harness cannot be pointed at a second server instance or restarted into another user without clearing its profile; to simulate a second founder use a second profile: `TIGER_USER_DATA_DIR=/tmp/tiger-b pnpm dev:browser` (the variable is verified by the E2E suite; two simultaneous dev instances were not tried).

## 4. Inviting another founder (REST, verified with curl)

```sh
T=$(curl -s -XPOST localhost:8787/v1/auth/dev -H 'content-type: application/json' \
      -d '{"email":"you@example.com","name":"You"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
S=$(curl -s -XPOST localhost:8787/v1/spaces -H "authorization: Bearer $T" -H 'content-type: application/json' \
      -d '{"name":"Founders"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
curl -s -XPOST localhost:8787/v1/spaces/$S/invites -H "authorization: Bearer $T" -H 'content-type: application/json' -d '{}'
```

The response holds `url` (`<PUBLIC_URL>/invite#<token>`), shown once. Open that URL in a Tiger tab of the invited member: the app intercepts a navigation to the configured server's `/invite` path and offers to join (E2E-tested). Set `PUBLIC_URL` to an address the other founders can reach. Over a network this needs HTTPS or a trusted LAN; there is no deployment recipe yet.

## 5. Tests

Start the database first. Server and client tests use `postgres://tiger:tiger@127.0.0.1:5432/tiger_test` (override with `TEST_DATABASE_URL`); each test file gets its own migrated schema. Counts are from 2026-11-26 in the Linux container; the working tree was being edited at the time, so counts may move.

| Command | Result seen here | What it proves |
|---|---|---|
| `pnpm typecheck` | not run as a whole; each package passed on its own in the builders' runs | Strict TypeScript across packages. |
| `cd packages/shared && pnpm test` | 23 passed | Contract schemas, blocklist rules, URL classification and canonicalisation. |
| `cd packages/extract && pnpm test` | 101 passed | Page to Markdown: exact output for English and Japanese fixtures, hidden content and form values never leak, zero DOM mutations, Google export parsing, PDF text, scanned PDF reported as no text layer. Slack and Notion only on fixtures. |
| `cd packages/llm && pnpm test` | 86 passed, 4 skipped | Router, retry before first byte only, price catalog by date, mock provider, Anthropic/OpenAI/Gemini mapping against faked SDK clients. The 4 skipped are live Anthropic tests. |
| `cd packages/client && pnpm test` | 83 passed, 1 expected fail | Typed REST and WebSocket client and stores, against the real server in-process with two members and a fake bridge. Nothing here runs inside Electron. |
| `cd apps/server && pnpm test` | 219 passed, 2 skipped (key unset) | Every contract route registered; access matrix; invites; share, unshare cascade, tombstone; indexing and retrieval with the real e5 model; HNSW filtered search on a 1 percent Space; chat pipeline with the mock provider; prompt-injection text stays inside its wrapper. The 2 skipped are live Anthropic tests. |
| `cd apps/browser && pnpm test` | 147 passed | Main-process logic on a real `node:sqlite` file, IPC validation, permission policy, capture boundary with fakes, Google flow against a fake Google. |
| `cd apps/browser && pnpm test:e2e` | 48 passed (6 files) | Real Electron under `xvfb-run`: tabs, popups, persistence across restart, capture and blocklist (including a bank host and private windows), a page cannot see `tiger` or `require`, real X11 clicks with the overlay, downloads, permission prompts, the whole MVP flow against a real server process and a request log that shows page content leaves only in share and attach, Google export against a fake. **Linux only**; not run on a Mac. |
| `cd apps/browser && pnpm test:package` | passed in the builder's run, not re-run now | Builds `dist/linux-unpacked`, launches the fused binary, checks the bridge, capture and PDF. |

Live Anthropic tests (spend a few thousand tokens): `ANTHROPIC_API_KEY=... pnpm exec vitest run test/chat/live.test.ts` in `apps/server` and `pnpm exec vitest run` in `packages/llm` with the key set. Do not paste the key into files or logs.

## 6. Configuration

Server variables are read from the environment; `pnpm start` and `pnpm dev` also load `apps/server/.env` if present. Invalid values stop the server with the variable name (never the value). `apps/server/.env.example` lists most of them.

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | Postgres URL (required) | none; `.env.example` uses `tiger_dev` |
| `NODE_ENV` | `development`, `test` or `production` | `development` |
| `HOST`, `PORT` | Listen address | `127.0.0.1`, `8787` |
| `PUBLIC_URL` | Base URL clients use; invite links are built from it | `http://localhost:8787` |
| `CORS_ORIGINS` | Comma-separated allowed browser origins | `tiger://ui` (`.env.example` adds `http://localhost:5173`) |
| `AUTH_DEV_LOGIN` | `1` enables passwordless `POST /v1/auth/dev`; refused when `NODE_ENV=production` | `0` (`.env.example`: `1`) |
| `GOOGLE_OAUTH_CLIENT_ID` | Audience for Google ID tokens; empty disables Google sign-in | empty |
| `SESSION_TTL_DAYS` | Session lifetime | `30` |
| `SPACE_TOKEN_BUDGET` | Monthly input+output token budget given to each new Space | empty (unlimited) |
| `AUTH_RATE_LIMIT_PER_MINUTE` | Per-IP limit on sign-in and invite acceptance | `20` |
| `SHARE_RATE_LIMIT_PER_MINUTE` | Shares per member per minute | `30` |
| `WS_HEARTBEAT_MS` | WebSocket ping interval | `30000` |
| `LOG_LEVEL` | `fatal` to `trace`, or `silent` | `info` |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` | Provider keys; server only | empty |
| `RETRIEVAL_EMBEDDER` | `e5` (real) or `hash` (tests and offline play) | `e5` |
| `RETRIEVAL_MODEL_CACHE_DIR` | Where e5 files are cached | `~/.cache/tiger/models` |
| `RETRIEVAL_WHOLE_SPACE_MAX_TOKENS` | A Space this small is sent whole instead of retrieved | `40000` |
| `RETRIEVAL_KEYWORD_WEIGHT` | Weight of the pg_trgm keyword leg (0 to 4); 0 turns it off | `0.5` |
| `CHAT_DEFAULT_MODEL` | `provider/model-id` when the client names none | empty: best available (`anthropic/claude-sonnet-5-5` first), else mock |
| `CHAT_TITLE_MODEL` | Model that writes thread titles | empty: cheapest available |
| `CHAT_ENABLE_MOCK` | `1` always offer the mock model, `0` never | empty: only when no key is set and not production |
| `CHAT_THREAD_TITLES` | `0` turns generated titles off | `1` |
| `TEST_DATABASE_URL` | Database for server and client tests | `postgres://tiger:tiger@127.0.0.1:5432/tiger_test` |
| `TIGER_TEST_MODEL_CACHE` | e5 cache for server tests | `<tmpdir>/tiger-test-models` |

Browser (main process) variables:

| Variable | Purpose | Default |
|---|---|---|
| `TIGER_SERVER_URL` | Server the UI talks to | `http://localhost:8787` |
| `TIGER_USER_DATA_DIR` | Profile directory (cookies, SQLite, tokens) | Electron's per-user default |
| `TIGER_DOWNLOADS_DIR` | Download destination | the OS downloads folder |
| `TIGER_GOOGLE_CLIENT_ID` | Desktop OAuth client id; unset means every Google feature reports not-configured | unset |
| `TIGER_GOOGLE_CLIENT_SECRET` | That client's secret, sent when present | unset |
| `TIGER_NO_SANDBOX` | `1` disables Chromium's OS sandbox; only for root containers and tests | unset |
| `ELECTRON_RENDERER_URL` | Set by electron-vite in dev; trusted as the UI origin only when unpackaged | set by tooling |
| `TIGER_GOOGLE_AUTH_ENDPOINT`, `_TOKEN_ENDPOINT`, `_REVOKE_ENDPOINT`, `_UPLOAD_ENDPOINT`, `TIGER_GOOGLE_TEST_OPENER`, `TIGER_GOOGLE_AUTH_TIMEOUT_MS` | Point at a fake Google for tests; ignored by packaged builds | unset; timeout 5 minutes |

## 7. Google setup (sign-in and Docs export)

Nothing here has run against real Google. From the google-account builder's steps:

1. In https://console.cloud.google.com pick or create a project and enable the Google Drive API (APIs and Services, Library). Without it, export fails with "The Google Drive API is not enabled for this OAuth client's Cloud project".
2. Google Auth Platform, Branding: app name "Tiger", support email, developer contact. Audience: External (or Internal if everyone is in one Workspace). Leave the status at Testing for dogfood.
3. Data Access: add `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` and `https://www.googleapis.com/auth/drive.file`. Do not add `drive` or `drive.readonly` (restricted scopes, annual security assessment).
4. Audience, Test users: add each founder's Google account (up to 100). In Testing mode, grants expire after 7 days (documented, not verified), after which export reports not-connected and the member connects again.
5. Clients, Create client: type "Desktop app", name "Tiger desktop". Copy the client id and secret. Desktop clients accept `http://127.0.0.1` on any port, so no redirect URI is registered (documented, unverified).
6. Start the browser with `TIGER_GOOGLE_CLIENT_ID` and `TIGER_GOOGLE_CLIENT_SECRET` in the environment, and the server with `GOOGLE_OAUTH_CLIENT_ID` set to the same client id (the server verifies ID tokens against it).
7. First live check in the harness: sign in with Google (a token length is shown), Connect (your email appears), Export a captured page, open the returned Doc and check tables and Japanese, then Disconnect and confirm Tiger is gone from https://myaccount.google.com/permissions.

If Drive refuses the Markdown upload (HTTP 400, 415 or 422, inferred) the app retries once as HTML converted locally. Refresh tokens are stored with Electron `safeStorage`; on Linux without a keyring this falls back to a weak backend (inferred). On a Mac it uses the Keychain (not run).

## 8. Packaging for macOS (not run)

Only the Linux unpacked build was built and launched. macOS and Windows builds, signing and notarization have not been run.

```sh
pnpm --filter @tiger/browser package      # electron-vite build, then electron-builder: dmg and zip on a Mac
pnpm --filter @tiger/browser package:dir  # unpacked app only (verified on Linux; output apps/browser/dist/)
```

`apps/browser/electron-builder.yml` sets hardened runtime, `build/entitlements.mac.plist`, `notarize: true` and the Electron fuses (no `runAsNode`, asar integrity on). Signing and notarization are driven only by environment variables; with none set the build is unsigned:

| Variable | Use |
|---|---|
| `CSC_LINK`, `CSC_KEY_PASSWORD` | Developer ID Application certificate (file or base64) and its password |
| `CSC_NAME` | Alternative: certificate name from the local keychain |
| `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | Notarization with an App Store Connect API key |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarization with an Apple ID instead |

Things you will hit: the app id is `app.tiger.browser`; an unsigned or un-notarized build will be blocked by Gatekeeper on other Macs (inferred); the packaged app has no build-time place for the Google client id, so it must be in the environment of the launched process, which a Finder double-click does not provide (launch from a terminal or add a launcher); the packaged server URL is `http://localhost:8787` unless `TIGER_SERVER_URL` is set. Passkeys with Touch ID additionally need a signed app with a keychain access group (documented in `docs/research/google-signin-spike.md`, not done).

## 9. The day-1 spike (`spike/`)

`spike/` is a standalone Electron 45.5 app (its own `package.json`, not in the pnpm workspace) that opens real Google, Slack, Notion and Microsoft 365 sign-in and editing pages in a Tiger-shaped shell and records pass or fail. It exists because Google can refuse sign-in from embedded browsers. If Google blocks Tiger's Chrome-shaped user agent when you sign in by hand, that moves the engine decision toward a Chromium fork now; if it does not, Electron stays and the fork waits for validation.

Run on a Mac (not run there; steps from `spike/README.md`, in Japanese):

```sh
cd spike && npm install && npm start      # Node 22.12 or newer; downloads Electron on first run
```

Work through the checklist top to bottom, most importantly Google sign-in, Google Docs and the Markdown export. If Google blocks it, try `SPIKE_UA=electron-default npm start`, then `SPIKE_UA=firefox-google npm start`. The result is written to `spike/spike-report.md`; send that file back. Decision rule from the research: keep Electron unless chrome-like mode shows "Couldn't sign you in".

What is known without a human: an automated smoke run in the container (`npm run smoke`, verified) reached the Google, Slack, Notion and Microsoft sign-in pages in every user-agent mode with no block before credentials; Google serves a different sign-in flow to the default Electron user agent than to the Chrome-shaped one; popups with `window.opener` work. The `spike/spike-report.md` in the repo comes from container runs driven by a script, with one scripted "FAIL" note and no real login: it is not a founder result. Whether a real login on a real account is accepted is unknown.

## 10. Repository layout

```
apps/browser    Electron app: src/main (tabs = WebContentsView, sessions, IPC, Google), src/preload, src/renderer (React harness)
apps/server     Fastify REST + WebSocket, Postgres (pgvector), src/retrieval, src/chat, migrations/
packages/shared zod schemas and types: domain, REST contract, IPC contract, blocklist, URL classification
packages/client Typed REST and realtime client plus stores used by the UI (no Electron or React import in the core)
packages/extract Page to Markdown (DOM, Google export, PDF); pure TypeScript
packages/llm    Provider-agnostic chat router: Anthropic / OpenAI / Gemini / mock; dated model catalog
design/         Design research and HTML prototypes
spike/          Day-1 login check (own package.json)
docs/           HANDOFF.md and research notes
```

Hard rule: no Electron import outside `apps/browser/src/main` and `apps/browser/src/preload`.

## 11. Known limits that affect daily use

- **The designed UI is not built.** The renderer is a plain developer harness: dev sign-in form, Space picker, share preview, thread panel, one Google panel. No side panel, no bookmarks bar UI, no audit view, no member list, no invite creation, no export of an answer to Google Docs. The logic below it is tested; the pixels are not designed.
- **No password autofill or password manager, no passkeys.** Electron has neither; passkeys also need `app.configureWebAuthn` and a signed app (documented in the spike research). Founders will type passwords.
- **No Chrome extensions** (1Password, ad blockers, Grammarly). Only a Chromium fork gives that.
- **No Widevine DRM** in stock Electron (inferred; not tested): Netflix-class video will not play.
- **Chromium lags Chrome and we own security updates.** Electron 45.5 here is Chromium 156.
- **OpenAI and Gemini are unverified.** Model IDs, prices, usage fields and caching come from documentation only and are marked `verified: false` in the catalog. Reasoning settings for them are not tuned.
- **Slack and Notion capture is unproven on live pages.** Content inside iframes, closed shadow roots, collapsed Notion toggles and virtualised Slack messages is not captured. Scanned PDFs have no OCR. Google capture needs a signed-in session in the tab.
- **Mock answers and the hash embedder are for development.** Real retrieval quality was measured on a 40-item synthetic corpus only; the hybrid keyword leg did not beat vector-only there.
- **Server is single-instance.** Rate limits and the realtime hub live in process. The token budget check is not atomic. There is no Space delete route, no email sending (invites are links), and a session that expires while a WebSocket is open keeps receiving until reconnect.
- **The browser sends the URLs of open tabs to the server** for "already shared" lookups, never page content, and never for private windows or blocklisted pages. Whether that is acceptable under "default private" is an open product decision.
- **Stopping an answer** uses `POST /v1/messages/:id/abort` (server test `abort.test.ts`); the harness stop button is not covered by a test I ran.
- **Everything native to macOS is unrun**: menus, Touch ID, Keychain-backed `safeStorage`, notarization, Dock behaviour, IME input in Japanese inside real pages (the spike checklist covers IME and should be filled in).
