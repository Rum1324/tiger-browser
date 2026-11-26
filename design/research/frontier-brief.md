# Tiger: frontier UI brief

As of 2026-11-26. Tags: **[seen]** = in an image I viewed (filename given), **[read]** = in fetched text, **[inferred]** = my judgement or prior knowledge, not re-checked. `[Rn]` points to the reference list.

Numbers are approximate, measured from marketing images. Where scale is unknown, I give a share of the window converted to 1440 px.

**The market has moved**
- Arc shuts down on 2026-12-22. Its Spaces, Folders and Tab Groups move to Dia, where "the AI is optional" [read R1].
- ChatGPT Atlas shut down on 2026-08-09 and was merged into the ChatGPT/Codex desktop app [read R2].
- The "Tabl" browser could not be found. tabl.com is now a tour company [read R3].
- NotebookLM's share card now reads "Gemini Notebook" [seen R4 `notebooklm-og.png`].

## 1. Frontier browser chrome

1. **Sidebar width is 17–24% of the window, about 248 px at 1440.**
   - Zen: 265 of 1542 px, and 177 of 1025 px in its other render [seen R5 `zen-hero.png`, `zen-workspaces.png`].
   - Dia's sidebar mode: about 250 px [seen R6 `dia-5.png`].
2. **Tab rows are 34–36 px tall at 1x.**
   - Favicons are 16 px and labels about 13 px regular.
   - The selected row gets no extra weight, just a near-white fill (#FBFEFD on mint) with a radius of about 8 [seen `dia-5.png`; Zen pitch 35 px in `zen-workspaces.png`].
3. **Pinned apps: a 3-column tile grid above the tabs.** Zen about 75×55, radius 10; Dia about 76×40, radius 8; sidebar-tinted, no shadows [seen `zen-hero.png`, `dia-5.png`].
4. **The page is an inset rounded card.**
   - Zen insets the page 6–10 px with a radius of 6–8 [seen `zen-glance.png`].
   - Dia's content card sits about 2 px off the sidebar with a radius of about 10 [seen `dia-5.png`].
   - Safari 26 runs the page to the window edge and clips it with the window's radius of about 22 pt [seen R7 `apple-safari-26.jpg`].
   - All three fit our engine.
5. **The Space colour tints the whole frame.** Dia: Work salmon #EDDBD3, Personal mint #D7EEE6, name in the tint's dark shade [seen `dia-5.png`]. Zen: translucent purple wash [seen `zen-workspaces.png`].
6. **The toolbar is a breadcrumb, not a URL field.**
   - Dia shows "Made with Dia / The Geography of Ischia": the parent in grey, the leaf darker, both about 13 px.
   - The toolbar row is about 44 px [seen `dia-5.png`, `dia-1.png`].
7. **Safari 26 groups controls into glass capsules.**
   - URL capsule about 520×34 pt with a warm wash.
   - Back and forward share one 31 pt capsule.
   - Toolbar about 52 pt [seen `apple-safari-26.jpg`, scaled from a 1512 pt screen].
   - Apple describes the tabs as "floating in the toolbar" [read R8].
8. **macOS 26 sidebars float inside the window.** The Shortcuts library is an inset panel with a radius of about 16 pt and rows on a 28 pt pitch [seen R8 `apple-macos26-notes.jpg`].
9. **Horizontal tabs survive, grouped.**
   - Dia: tab strip about 38 px plus a toolbar of about 40 px. Groups sit in containers with radius 8, and pinned favicons cluster at the left [seen `dia-3.png`].
   - Comet: warm off-white chrome (#F4F2EF strip, #FEFDFA toolbar), traffic lights recoloured to its brand (#C78559, #DDAD7A, #6A7F7D), and an omnibox that reads "Ask anything or navigate…" [seen R9 `comet-og.png`].
10. **Chrome and page share one surface.** Dia: both #F6F6F6 [seen `dia-3.png`]. Linear steps #080A0B → #0F0F11 → #0F1112 and separates with borders [seen R10 `linear-cl-1.png`].
11. **Colour is semantic and scarce.** Linear: green/red only for added/removed [seen `linear-cl-2.png`]. Dia: one red Space name, one blue Chat button [seen `dia-5.png`, `dia-3.png`].
12. **AI is a labelled toolbar button, never a sparkle.** Dia: blue "Chat" beside grey "Share", 32 px, radius 8 [seen `dia-3.png`]. Comet: "Assistant" far right [seen `comet-og.png`].
13. **A distinct face marks generated output.** Dia uses serif italic plus mono captions [seen `dia-1.png`]; Granola uses a slab serif [seen R11 `granola-og.png`].
14. **Density.** Browser sidebars run about 9 rows per 320 px [seen `zen-hero.png`]. Glue is denser, 12–13 px labels on a 22–25 px pitch [seen R12 `glue-og.jpg`].

## 2. Private, shared, presence, provenance: the mechanisms

| Product | Mechanism |
| --- | --- |
| **Figma** [inferred] | Presence is *spatial*: cursors show where people are; clicking an avatar follows their view. |
| **Notion** [inferred] | Access is inherited from where a page lives, and the Share menu names the source of the permission. |
| **Linear** | Every object carries one line: author · repo#id · branch, in mono [seen `linear-cl-1.png`]. Automated actors get named identities ("Linear" as comment author) [read R10]. |
| **Slack Connect** [read R13] | The boundary is marked on three levels: an org badge on the external person's avatar, a hover indicator plus a banner on the conversation, and an "External Connections" sidebar section. |
| **Google Docs** [inferred] | The Share button itself shows the current audience (lock, people, globe), and "General access" states the reach in words. |
| **1Password** [inferred] | Sharing is a *place*: an item lives in exactly one vault, Private or Shared, and moving it is an explicit act. |
| **Dia / Arc** [seen `dia-5.png`] | Ambient tint shows the context before you act in it. |
| **macOS privacy dot** [inferred] | The capture signal lives in space the content cannot draw over. For Tiger, "this tab feeds team context" belongs in the chrome, never in the page. |
| **Superhuman** [seen R14 `superhuman-inline.png`] | The AI claim carries its provenance in place: "Knowledge Checker · 2 sources". |

## 3. AI surfaces

**Done well**
- **Superhuman: inline diffs.** The old value is struck in red, the new one shown in violet. You accept with a check or dismiss with an X, and the sources sit in the footer [seen `superhuman-inline.png`].
- **Notion Calendar: ⌘K with visible keys.** Each command has a single-letter shortcut, and the selected row gets a 3 px left bar instead of a glow [seen R15 `notion-calendar-commandbar.png`].
- **Raycast: list and detail split.** Section labels, 20 px icons, and a selection fill with a radius of about 8 [seen R16 `raycast-og.png`].
- **Glue: the AI as a participant.** It posts with an avatar and a timestamp, and @mentions render as chips [seen `glue-og.jpg`].
- **Linear: honest agent states.** Its changelog says a coding session now shows "an error when their sandbox fails to start … instead of looking busy" [read R10].
- **Apple Shortcuts: the model step as an ordinary action card** ("Use Private Cloud Compute model") with variable tokens. No special AI chrome [seen `apple-macos26-notes.jpg`].
- **Comet: an agent you can watch.** Its sidecar shows where the agent clicks and has stop and guide buttons [read R17].

**Done badly**
- **Gradient word as the AI signifier** [seen `notebooklm-og.png`]. Glue's gradient-flame AI avatar does the same [seen `glue-og.jpg`].
- **Neon rim glow on a command window** [seen `raycast-og.png`]. Fine in marketing, wrong in a product.
- **Skeleton bars as the entire waiting state** [seen `comet-2.png`].
- **Model picker** (none seen): use a quiet text label in the composer ("Claude · Opus") that opens a plain menu [inferred].

## 4. Slop checklist (tell → why → craft)

1. **Purple-to-blue "AI" gradient.** It is every template's default [seen `notebooklm-og.png`]. *Craft:* one flat brand hue; mark AI with type and provenance.
2. **Sparkle icons.** They signal "magic" and explain nothing. *Craft:* verb labels ("Ask Space").
3. **Glass on everything.** Apple reserves glass for floating controls, and our engine cannot blur the page. *Craft:* vibrancy on the chrome; glass only for chrome-over-chrome.
4. **Emoji as icons.** Mixed styles and colour weights [seen 😊 workspace in `zen-hero.png`]. *Craft:* one icon set; emoji only as user content.
5. **Cards in cards with one uniform radius.** Hierarchy collapses. *Craft:* concentric radii (inner = outer − padding) and at most one card level.
6. **Centred empty state with a blob illustration.** Generic. *Craft:* left-aligned, one sentence, one action.
7. **Default sans with no type scale.** *Craft:* a scale (11/13/15/20/28), two weights, and a second face for AI output [seen `dia-1.png`].
8. **Grey-on-grey low contrast.** *Craft:* 4.5:1 for text, with depth from luminance steps plus 1 px borders [seen `linear-cl-1.png`].
9. **Glows and gradients with no meaning.** *Craft:* colour only for state [seen `linear-cl-2.png`].
10. **Pill-shaped everything.** Capsules are Apple's grammar for *floating* groups. *Craft:* 6–8 px radius for in-flow controls.
11. **Mixed icon stroke weights.** *Craft:* one 1.5 px stroke on a 16 px grid.
12. **Filler copy** ("Supercharge your workflow"). *Craft:* nouns and numbers ("Aki shared 12 pages").
13. **Shadows on every surface.** *Craft:* shadows only on floating layers [seen: shadowless tiles in `dia-5.png`].
14. **Badge clutter** (NEW, BETA, AI). *Craft:* only actionable counts.
15. **Avatar soup.** *Craft:* show a person only where they actually are.
16. **Endless skeleton loaders.** *Craft:* streamed tokens, a named step ("Reading 4 sources") and a stop button.
17. **Chat bubbles for every AI action.** *Craft:* inline edits; chat only for conversation.
18. **Rainbow tags.** *Craft:* 2–3 semantic hues and neutral tags.
19. **Uniform 16–24 px padding.** *Craft:* a density scale: tight lists, airy reading.
20. **Hero-sized headings in the app.** *Craft:* titles of 15–20 px in-app.
21. **#000 dark mode with neon accents.** *Craft:* near-black #0F1011 with desaturated accents [seen `linear-cl-1.png`].
22. **Icon-only toolbars.** *Craft:* label the primary actions [seen "Share" and "Chat" in `dia-3.png`].
23. **Frosted modal scrims over the page.** Impossible in our engine anyway. *Craft:* an opaque sheet with a crisp 1 px edge and a shadow.

## 5. Japanese UI typography

- **System stack** [inferred]: macOS pairs SF Pro with Hiragino Sans automatically (W3 text, W6 bold). Stack: `-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif`.
- **Webfonts for mocks** (Google Fonts) [inferred]: Noto Sans JP (default, closest to Hiragino); IBM Plex Sans JP (pairs with Plex Mono for provenance); LINE Seed JP (warm, weak small); Zen Kaku Gothic New (display); BIZ UDPGothic (dense tables).
- **Mixing Latin and Japanese** [inferred]:
  - Japanese looks 5–10% larger at the same size. Compensate with `size-adjust` on the Japanese `@font-face` and check that baselines align.
  - Use `font-feature-settings: "palt"` on headings and labels, not body text.
  - Tracking: 0–0.02em for UI and 0.04–0.08em for airy body text. Never tighten kana.
  - Do not put full spaces between Japanese and Latin words.
- **Line-height** [inferred]: UI 1.4–1.5; body 1.7–1.9, against 1.4–1.5 in western UI.
- **Line breaking:**
  - `word-break: auto-phrase` breaks at phrase (文節) boundaries using BudouX. It is Japanese-only, needs `lang="ja"`, and runs in Chrome 119+, so it is available in our Chromium [read R18, R19].
  - Add `line-break: strict` (kinsoku) and `text-wrap: balance` on headings, `text-wrap: pretty` on body [inferred].
- **Density** [inferred]: Japanese business software (kintone, freee, Backlog) is dense, with 12–13 px text, visible labels and tables; very airy layouts read as empty. Target Linear density (13 px, 28–32 px rows), not Dia's.
- **Tone** [inferred]: short です/ます messages ("チームに共有しました"); verb stems on buttons ("共有", "取り消す"); 共有 over シェア; no exclamation marks; errors give cause then remedy ("接続できませんでした。もう一度お試しください。").

## 6. Engine constraints every design must respect (Electron, later a Chromium fork)

- The web page in a tab is a separate native view: a rectangle. The browser's own UI ("chrome UI") cannot draw on top of it and cannot blur or tint its pixels.
- Popovers, menus, the command palette and sheets CAN appear above the page through a separate transparent overlay layer, but they cannot blur page pixels behind them (blur over the chrome UI's own pixels is fine).
- The page rectangle can have rounded corners and can be inset from the window edge. Resizing it (for a side panel) is cheap and can be animated in steps; treat fluid 60fps reflow of a heavy page as a cost.
- The window can use macOS vibrancy (desktop blurred behind the chrome UI). The title bar is hidden-inset: traffic lights sit inside our UI at top-left.
- Target window for mocks: 1440 x 900 CSS px at 2x.

Implication [inferred]: inset page cards work; page-refracting glass does not; overlays need opaque surfaces; side panels snap open in 2–3 steps over about 150 ms.

## 7. White space: team-context signatures nobody ships

1. **The page frame shows sharing state.**
   - The 6–8 px frame around the inset page belongs to the chrome. Paint it in the Space tint while a tab feeds team context, and keep it neutral when the tab is private.
   - Like the OS camera dot, it cannot be spoofed and costs no page pixels. Zen and Dia use the frame only as decoration [seen `zen-glance.png`, `dia-5.png`].
2. **Presence across the web, not inside one document.**
   - Teammate faces on sidebar tab rows, and a "seen by 2" note in the breadcrumb.
   - Figma does this within a file. With Tabl gone, nobody does it for URLs [read R3; inferred].
3. **Provenance in the breadcrumb.**
   - Dia's breadcrumb plus Linear's author line gives "Fundraising ▸ shared by Aki · 2h · docs.google.com".
   - AI answers cite the shared snapshots they used, the way Superhuman shows "2 sources" [seen `dia-5.png`, `linear-cl-1.png`, `superhuman-inline.png`].
4. **The Space switcher carries contribution state.**
   - Switching Space re-tints the frame, as Dia does.
   - The Space name also shows a live count ("3 tabs streaming"), so the privacy boundary is part of the navigation [inferred].
5. **A scope chip for asking.**
   - The composer shows a token you can narrow: "Space: Fundraising · 41 items · from 4 people". Modelled on Shortcuts' variable tokens [seen `apple-macos26-notes.jpg`].
   - No AI panel today shows *whose* context an answer draws on.

---

## Reference images
All in `/tmp/claude-0/-home-user-tiger-browser/7fb777b9-ce60-5e03-9bbf-edbf28d5b761/scratchpad/design-refs/`:
dia-1.png, dia-3.png, dia-5.png, zen-hero.png, zen-workspaces.png, zen-glance.png, comet-og.png, comet-2.png, apple-safari-26.jpg, apple-macos26-notes.jpg, linear-cl-1.png, linear-cl-2.png, notion-calendar-commandbar.png, notion-calendar.png, superhuman-inline.png, glue-og.jpg, raycast-og.png, granola-og.png, things-og.jpg, notebooklm-og.png

## References
- R1 https://arc.net (farewell page)
- R2 https://en.wikipedia.org/wiki/ChatGPT_Atlas
- R3 https://tabl.com
- R4 https://notebooklm.google
- R5 https://zen-browser.app
- R6 https://www.diabrowser.com
- R7 https://www.apple.com/newsroom/images/2025/06/macos-tahoe-26-makes-the-mac-more-capable-productive-and-intelligent-than-ever/article/Apple-WWDC25-macOS-Tahoe-26-Safari-250609_big.jpg.large_2x.jpg
- R8 https://www.apple.com/newsroom/2025/06/macos-tahoe-26-makes-the-mac-more-capable-productive-and-intelligent-than-ever/ and https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/
- R9 https://www.perplexity.ai/comet
- R10 https://linear.app/changelog
- R11 https://www.granola.ai
- R12 https://glue.ai
- R13 https://slack.com/help/articles/115004151203-A-guide-to-Slack-Connect
- R14 https://superhuman.com
- R15 https://www.notion.com/product/calendar
- R16 https://www.raycast.com
- R17 https://hub-prod.perplexity.ai/hub/blog/comet-assistant-puts-you-in-control (via search summary)
- R18 https://developer.mozilla.org/en-US/docs/Web/CSS/word-break
- R19 https://developer.chrome.com/blog/css-i18n-features
- Also viewed: https://culturedcode.com/things/ (`things-og.jpg`).
- No usable images for SigmaOS, Figma UI3, the Claude and ChatGPT desktop apps, Perplexity, Slack, Craft or Notion Mail. Claims about them are inferred.
