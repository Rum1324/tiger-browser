# Team AI Browser — Claude Code handoff

As of 2026-11-26. Owner: Sota (Y Industries, 4-founder pre-seed team, Japan market, full-time from summer 2027).
This file is the full context from the ideation thread. Read it all before planning. Status labels: **[decided]** = founder's explicit call, **[proposed]** = recommendation, open to change, **[open]** = unresolved.

---

## 1. One-line product

A browser built for teams: everyone keeps using the web apps they already use (Google Docs, Slack, Notion, etc.), and an AI layer inside the browser builds **one shared team context** from what members choose to share, so any teammate can ask any model (Claude / GPT / Gemini) with the same background.

## 2. Why (founder's problem statement)

1. AI chats (ChatGPT, Claude, Gemini) are locked to one person's account. Teammates cannot see or edit each other's AI context.
2. The same background has to be re-pasted into every tool and every chat.
3. For non-code work there is no GitHub-like shared base; juggling multiple projects alone is painful.
4. Existing apps (Google Workspace, Slack, Notion) were not built AI-first; they bolt AI on through connectors.
5. Files like PDF/Word are heavy and awkward to feed to AI (e.g. Claude's ~20-image limit when converting photos to LaTeX).
   - Note from analysis: the limit comes from model context/request caps, not the file format itself. Preprocessing (OCR → text) fixes it. Do not treat "AI-native format" as the moat.

## 3. Founder's principles **[decided]**

- **Must work without the whole team switching.** One person can adopt it alone and still get value; teammates who stay on Slack/Docs are not blocked.
- **The new platform is home base. Connectors are exits, not the core.** Connectors exist to push finished work out to legacy apps (Google Docs, Word, PDF, Slack) when you must, not to bolt AI onto old apps.
- **Keep the legacy app UIs.** When you use Google Docs you want Google Docs. The AI sits between the user and the app — i.e. it is a browser.
- **Multi-model.** Claude, Gemini, ChatGPT selectable in one place.
- **Team-first, not individual-first AI.** The differentiator is shared context.

## 4. Competitive landscape (researched 2026-11-26)

Key finding: **no shipped product offers an AI browser with context/memory shared across a team.** Adjacent players:

| Product                                                                                                              | What it is                                                                                                                                      | Gap vs. this idea                                                        |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Island (enterprise browser)                                                                                          | Mar 2026 added AI: approved company knowledge in AI chat, shared internal AI apps, admin approvals. $400M Series F, $6.4B valuation (Sep 2026). | Governance/security-first, sold to big IT. No shared per-member context. |
| Chrome Enterprise + Gemini                                                                                           | Apr 2026: Auto Browse, Chrome Skills, Gemini side panel; admin controls; Premium $6/user/mo.                                                    | Skills are personal; Gemini context isolated per tab; Gemini only.       |
| Dia (Atlassian, $610M acq. Sep 2025)                                                                                 | "AI browser for work", personal work memory, cross-tab context.                                                                                 | Team sharing only announced, not shipped. Will tie to Jira/Confluence.   |
| ChatGPT Atlas (enterprise)                                                                                           | OpenAI's browser with ChatGPT.                                                                                                                  | OpenAI-only; team features unverified.                                   |
| Comet (Perplexity), Claude in Chrome                                                                                 | Individual AI browsing agents.                                                                                                                  | Per-person.                                                              |
| Tabl                                                                                                                 | "Multi-player browser": shared windows, tab presence. Planned "AI clone" of each user.                                                          | No AI shipped.                                                           |
| Glue                                                                                                                 | AI-first Slack-like team chat, GPT-5/Claude/Gemini/Kimi, $12/user/mo. $20M Series A.                                                            | Chat only, no browser, no docs.                                          |
| Notion 3.2                                                                                                           | Docs + multi-model AI (GPT-5.2 / Claude Opus 4.5 / Gemini 3).                                                                                   | Not a browser; you must move data into Notion.                           |
| ClickUp Brain MAX                                                                                                    | Desktop "AI super app", multi-model.                                                                                                            | Tied to ClickUp's PM tool.                                               |
| Claude Docs/Slides, ChatGPT shared projects, M365 Copilot Cowork, Google Workspace Gemini, Lark, LINE WORKS AiStudio | Suite-native AI.                                                                                                                                | Single vendor or require switching suite.                                |

Why the gap exists (inference): it is a **privacy problem more than a technical one**. Streaming members' browsing into a team AI means deciding what is shared vs. private; that line is the product. Big vendors start from admin control (Island) or haven't shipped (Atlassian).

Threats: Atlassian/Dia shipping team memory; OpenAI/Google adding team features to Atlas/Chrome; Slack/Google closing APIs.

## 5. Core design

### 5.1 Sharing model (the hardest and most important part) **[proposed]**

- Default **private**. Nothing leaves a member's machine unless shared.
- Share at three granularities: (a) a single page/tab snapshot ("send to team context"), (b) a site/app bound to a **Space** (e.g. "all Google Docs in folder X go to Space 'Fundraising'"), (c) a chat thread with AI.
- **Spaces** = project-level shared context (like a GitHub repo for non-code work). Members belong to multiple Spaces. AI queries are scoped to a Space.
- Every captured item records who shared it, from which URL, when. Members can unshare/delete.
- Hard blocklist by default: banking, email bodies, password managers, personal domains, incognito.

### 5.2 Capture → structured store

- On share, extract page content to **structured text (Markdown + metadata)**, not screenshots/PDF blobs. For Google Docs, prefer the Docs API export when the user has OAuth'd; fall back to DOM extraction.
- Images/PDF: OCR → text; keep a thumbnail reference, not the heavy file.
- Store per Space: full-text index + vector embeddings. Re-capture on change (diff, versioned).

### 5.3 AI layer

- Side panel in every tab + a Space-level chat (team members and AI in the same thread, Slack-like).
- Model router: Claude / GPT / Gemini selectable per message; same Space context injected regardless of model.
- Agent actions on the current page (fill, edit, summarize) via DOM, user-confirmed.

### 5.4 Connectors = exits **[decided direction]**

- Out (new → legacy): push an AI-produced document to Google Docs / Word / PDF / Slack message. Easy; build early.
- In (legacy → new, read-only): pull Slack channel messages / Docs edits from teammates who have not adopted, so the Space context isn't half-blind. Medium; build second.
- Two-way sync: **do not build** in MVP (conflict resolution cost).

## 6. MVP scope **[proposed]**

**[decided] The MVP is our own standalone browser, not a Chrome extension.**

- "From scratch" means our own browser app (UI, tabs, profiles, AI layer, sync), built on an existing engine. Writing a rendering engine from scratch is out of scope: Ladybird-class projects take years before sites like Google Docs work.
- **[proposed] Engine path:** start with **Electron** (Chromium engine, TypeScript, fastest to a usable app for a 2-CS-founder team), keep the browser-shell code engine-agnostic, migrate to a **Chromium fork** (Arc/Dia/Brave route) once the product is validated.
  - Electron gives: real tabs via `WebContentsView`, per-profile sessions, full DOM access for capture, our own side panel and Space chat.
  - Electron costs: Chromium version lags Chrome; we own security updates; no Chrome Web Store extensions by default; larger binary.
  - Chromium fork gives: native-grade performance, extension support, deeper control. Costs: rebuilding/merging Chromium every ~4 weeks, signing, and a much heavier build setup.
- **Day-1 risk to verify:** Google may block sign-in from embedded/unknown browsers (its policy against OAuth in embedded user-agents). Before building features, confirm that Google account login + Google Docs editing work inside the Electron shell. If blocked, that decides the engine question toward a Chromium fork early.
- Also verify: Slack, Notion, Microsoft 365 login and editing inside the shell.

MVP features (target: 4 founders use it daily for 2 weeks):

1. Sign in, create a Space, invite members.
2. "Share this tab to Space" button → extract to Markdown → store + index.
3. Side panel chat scoped to a Space, model picker (Claude / GPT / Gemini via API).
4. Space chat thread visible to all members, with AI replies citing shared items.
5. Export an AI answer to a new Google Doc (OAuth, Docs API).
6. Per-item unshare + audit list of what's in a Space.

7. (Before 1–6) A working browser: tabs, address bar, back/forward, bookmarks, persistent logins, downloads. Google Docs, Slack, Notion usable daily.

Out of MVP: auto-capture rules, Slack read connector, Chromium fork, extension support, admin console, billing, mobile.

## 7. Suggested stack **[proposed — Claude Code may revise with reasons]**

- Browser shell: Electron + TypeScript (React for chrome UI), `WebContentsView` per tab, preload scripts for page extraction (Readability-style + Google Docs specific handler), auto-update, macOS first (team uses Macs; confirm), Windows second.
- Backend: TypeScript (Node) or Python; Postgres + pgvector; object storage for thumbnails.
- Auth: Google OAuth (also gives Docs/Drive scopes).
- LLM: provider-agnostic router; prompt caching for Space context; per-Space token budget.
- Realtime chat: WebSocket (or Supabase/Liveblocks-style service to save time).
- Japanese text: ensure extraction handles vertical text and Japanese PDFs (later wedge: paper/PDF-heavy JP orgs).

## 8. Business notes

- First customer under this design: **an individual juggling several projects**, who later invites teammates (Superhuman-style single-player-first growth).
- Revenue: per-seat subscription + AI usage credits (LLM cost scales with usage; credits cap it). Reference points: Glue $12/user/mo; Notion Business $20 with credit pools; Context $20 for 2,000 credits.
- Risks: platform API closure (Google/Slack), incumbents adding team memory, LLM cost > seat price for heavy users, enterprise security review in Japan.
- Possible Japan wedges: university labs / teachers (overlaps backlog idea on LMS), PDF/paper-heavy orgs (municipalities, schools, care providers).

## 9. Open questions **[open]**

- Exact default sharing UX: per-tab manual vs. per-site rules — validate with founders' 2-week dogfood.
- Should personal (unshared) browsing also get a private AI memory, or stay out entirely?
- Electron → Chromium fork timing: decide after the day-1 Google sign-in check and MVP usage.
- Which model is default; who pays API cost in free tier.
- Data residency (Japan) requirements for first customers.

## 10. First tasks for Claude Code

1. Propose repo structure (browser app + backend monorepo) and confirm stack choices in §7.
2. Spike: minimal Electron browser; verify Google login + Docs editing, Slack, Notion work (§6 day-1 risk). Report result before continuing.
3. Build the base browser (§6 item 0).
4. Implement Space + share-tab + Markdown extraction (with a Google Docs handler) end to end.
5. Add side-panel chat with model router and Space-scoped retrieval with citations.
6. Add "export to Google Doc".
7. Write a short README on running the browser locally and packaging it.
