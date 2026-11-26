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
