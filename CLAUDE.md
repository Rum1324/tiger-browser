# Tiger — team AI browser (working title)

A standalone browser (Electron now, Chromium fork later) whose AI layer builds one shared team context
from what members explicitly share. Product context and decision status: `docs/HANDOFF.md`.

## Product invariants — never violate

1. **Default private.** Page content leaves the machine only on an explicit user action: "share to Space",
   or attaching the current page to one AI message. Enforced in the Electron main process, not only in UI.
2. **Blocklist.** Banking, email bodies, password managers, incognito tabs can never be captured or attached.
3. **Provenance.** Every shared item records who shared it, the source URL, and when. Unshare deletes the
   content, its versions, and its embeddings; only an audit tombstone remains.
4. **Keys stay on the server.** LLM provider keys and provider calls never exist in the browser client.
5. **Engine-agnostic shell.** The React chrome UI talks to the engine only through the typed IPC contract in
   `packages/shared`. No Electron import outside `apps/browser/src/main` and `apps/browser/src/preload`.
6. **Connectors are exits.** Push finished work out (Google Docs etc.). No two-way sync.

## Layout

```
apps/browser    Electron app: src/main (tabs = WebContentsView, sessions, IPC), src/preload, src/renderer (React)
apps/server     Fastify REST + WebSocket, Postgres (pgvector), retrieval, LLM routing
packages/shared zod schemas + types: domain, REST contract, IPC contract, blocklist
packages/extract page -> Markdown (+ Google Docs handler); pure TS, no Electron/Node APIs
packages/llm    provider-agnostic chat router: Anthropic / OpenAI / Gemini / mock
design/         design research, directions (HTML prototypes + screenshots), chosen tokens
spike/          standalone day-1 login check (own package.json, not in the pnpm workspace)
docs/           HANDOFF.md
```

## Architecture decisions (evidence in `docs/research/*.md`)

- **Shell**: Electron 45, `BaseWindow` + `WebContentsView`. The chrome UI view fills the window at the
  bottom of the stack; one view per tab sits above it at the bounds the UI reports (`page.setBounds`),
  with `setBorderRadius`; one overlay view on top is shown only while a popover, palette or sheet is open
  (a visible overlay takes every click inside its bounds). Blur across views is verified on Linux only:
  no design may depend on it.
- **Build**: electron-vite 6 + Vite 8 + React 19, electron-builder 26. Every preload is one bundled CJS
  file (Electron 45 sandboxed preloads can `require` only `electron`).
- **Sessions**: `persist:tabs` for normal windows, a fresh in-memory partition per private window,
  `persist:chrome-ui` for the UI, which is served from `tiger://`. Default-deny permission handlers on
  every session.
- **User agent**: Chromium's own shape (`Chrome/<major>.0.0.0`, no app or Electron token), identical on
  every request. Popups become tabs through `setWindowOpenHandler` → `action: 'allow'` + `createWindow`
  so `window.opener` survives. Keep your own `webContents` reference per tab (Electron 45 hangs when
  `view.webContents` is read after destruction).
- **Capture**: DOM pages are extracted by a sandboxed preload in the isolated world. Google Docs, Sheets
  and Slides are canvas-rendered, so they are read through `…/export?format=md|csv|txt` fetched with the
  member's own session cookies. PDFs go through pdf.js text extraction.
- **Local data**: `node:sqlite` in the main process; secrets through async `safeStorage`.
- **Server**: Fastify 5, postgres.js, plain SQL migrations in `apps/server/migrations`, UUIDv7 ids.
- **Retrieval**: pgvector ≥ 0.8 (HNSW, `hnsw.iterative_scan = relaxed_order` on filtered queries) with
  `multilingual-e5-small` q8 embeddings (384 dims, `query: ` / `passage: ` prefixes) computed on the
  server. Vector first; the pg_trgm keyword leg is gated to exact-token queries. Small Spaces are
  injected whole behind a prompt-cache breakpoint instead of retrieved.
- **LLM**: provider-agnostic router; model catalog and prices are dated config, not code. Citations are
  numbered sources in the prompt and `[n]` markers in the answer, validated against the source list.
  Anthropic is verified live; OpenAI and Gemini are implemented from documentation and unverified until
  a key exists.
- **Google exit**: Drive `files.create` multipart upload of Markdown converted to a Google Doc, scope
  `drive.file`, OAuth through the system browser with loopback redirect and PKCE.

## Local development database

`bash apps/server/scripts/dev-db.sh` creates `tiger_dev` and `tiger_test` on the local Postgres 16
(`postgres://tiger:tiger@127.0.0.1:5432/tiger_test`). The schema is `apps/server/migrations/0001_init.sql`.

## Conventions

- TypeScript strict everywhere. Contracts are zod schemas in `packages/shared`; both sides import them.
- UI strings go through the i18n dictionary (Japanese and English). Japanese is the primary market.
- No secrets in the repo. A real Anthropic key for live tests is in `/root/.config/tiger/secrets.env`
  (`set -a; . /root/.config/tiger/secrets.env; set +a`). Never print it, log it, or copy it into any file.
- Tests: Vitest (unit/integration), Playwright `_electron` under `xvfb-run` (E2E). A feature is done when a
  test exercises it, not when it compiles.
- Local environment facts: Linux container, no Docker daemon running by default, Postgres 16 cluster present
  (`pg_ctlcluster 16 main start`), Xvfb present, Playwright 1.63 preinstalled globally (do not reinstall).

## Rules for subagents

- Do not run `git commit`, `git push`, `git checkout`, or `git stash`. The orchestrator owns git.
- Stay inside the directories your brief names. Other agents are editing the rest in parallel.
- Wrap every dependency install: `flock /tmp/tiger-pnpm.lock pnpm <args>`.
- Your knowledge may be stale (today is 2026-11-26). Check versions and API shapes against the registry or
  official docs before relying on memory.
- Label each claim in your report: **verified** (you ran it), **documented** (cite the URL), **inferred**, **unknown**.
  Report failures and negative results as plainly as successes.
