# Tiger — design system

As of 2026-11-28. Base: the Rooms direction, with the dashed page frame from Lens and the typographic
provenance from Paper. Sections 1 to 7 (the lead's pass) cover the boundary system, the review
resolutions, the window, the core components and motion. Sections 8 to 15 (the second pass) cover
every remaining screen and state, the components they added, the copy in Japanese and English, the
keyboard, the icons, and what the design needs that the code does not have yet.

Regenerate everything: `node design/final/render.cjs` (52 screens at 2x into `shots/`, the component
sheet in both themes, and `icons.svg`), `node design/final/contrast.cjs` (token pairs, every Space
hue, both themes), `node design/final/prototype/fonts/fetch-fonts.cjs` (after changing copy).
Open one screen: `design/final/prototype/index.html?screen=02-ask-panel` (`&theme=dark`, `&hue=indigo`).
The component sheet: `?screen=components`.

Files: `tokens.css` (every value), `prototype/app.css` and `surfaces.css` (lead's components),
`prototype/part2.css` (components of the second pass), `prototype/sheet.css` (layout of the component
sheet only), `prototype/icons.js` (the icon set; `icons.svg` is generated from it),
`prototype/parts.js`, `screens.js`, `screens2.js`, `sheet.js`, `boot.js` (the screens).

Claims are labelled **verified** (I ran it), **documented** (source given), **inferred**, **unknown**.

## 1. Thesis

The window is the Space you are standing in, and the edge of the page says who can read it: no line
for this Mac only, a solid line in the Space's colour for the version the Space holds, a dashed ink
line for what goes with the next question only, and a byline in type for who shared which version when.

## 2. The boundary system

### 2.1 Vocabulary

Six marks. Each has one meaning and is drawn only in pixels Tiger owns (sidebar, toolbar, the 8 px
gutter, the panel, the overlay layer). Nothing is drawn on, tinted over or blurred behind a page.

| Mark | Meaning | Never means |
| --- | --- | --- |
| **Hue** (frame tint, seal, ring, citation chip, confirm button) | this Space | a person, the AI, an error, focus, selection, "new" |
| **Neutral paper** (the pocket, cards, sheets) | this Mac, or Tiger's own neutral surface | shared |
| **Solid line in the Space colour** around a page (the ring, 3 px) | the Space holds this page | focus, selection |
| **The same line, open at the top** | the Space holds an older version of this page | loading, error |
| **Dashed ink line** around a page (the frame, 2 px), and the same dashes on a chip or a sheet edge | attached to the next question only | stale, disabled, drop target |
| **Seal** (one Mincho character on the Space colour; hollow when the version is old) | which Space, named in a character so hue is never the only carrier | a person |

A **byline** is provenance in type: `共有した人・第n版・日時`. It replaces badges and avatar rows.
The AI is ink: the seal 虎, the Mincho voice, never a hue, never a sparkle.

### 2.2 State of the page in the active tab

The state belongs to a page at a version, not to a tab. It is derived on this Mac only, per render:

```
tab      = TabsState.tabs[activeTabId]                      (packages/shared/src/ipc.ts)
S        = the Space of this window (Tab.spaceId)
if TabsState.privateWindow || tab.isPrivate                 -> private
else if !tab.capture.allowed                                -> blocked(tab.capture.reason, tab.capture.rule)
else u = urlShare.forTab(tab.id)                            (packages/client/src/stores/items.ts)
  u.status == "pending"                                     -> pending
  u.status == "error"                                       -> unknown (retry)
  here = u.locations.find(l => l.spaceId == S)
  here && checkStale(tab.id, S).status == "stale"           -> stale(here)
  here                                                      -> fresh(here)
  u.locations.length > 0                                    -> elsewhere(u.locations[0])   newest change first
  else                                                      -> local
attached = drafts[privateThreadId].some(p => canonicalUrl(p.url) == canonicalUrl(tab.url))
```

`attached` is independent of the share state and is drawn in its own lane.

| State | Page edge (gutter) | Capsule, right half | Tab row in the pocket | Ask panel, 「このページ」 row | Shot |
| --- | --- | --- | --- | --- | --- |
| **local** | 1 px hairline `--space-line` | laptop glyph, **このMacのみ**, button 「スペースに共有…」 | favicon, title | 「添付していません」, button 「内容を確かめて添付…」 | 10c, 03, 08 |
| **fresh** | ring closed, `--space-accent` | solid seal, **共有中**, byline `佐伯 遥・第2版・今日 12:14`, chevron (menu) | solid seal of this Space | 「共有済みの内容は最新です」 (`share.stale.fresh`), no attach button | 01, 02 |
| **stale** | ring open at the top | hollow seal, **第2版を共有中**, 「ページが共有後に更新されています」 (`share.stale.stale`), solid button 「新しい版を共有…」 | hollow seal | the same sentence, button 「内容を確かめて添付…」 | 10a, 03b |
| **elsewhere** | hairline (the ring speaks for this Space only) | seal of the other Space, **「採用」で共有中**, byline, button 「このスペースにも共有…」 | seal of the other Space | as local | 10b |
| **blocked** | hairline | lock, **共有できません**, reason as a noun phrase from `capture.reason.*` (「金融サービスのページ」); click opens the reason popover with `capture.rule` | lock | lock, 「このページ」, the reason; no button | 05 |
| **private window** | hairline; the whole frame is neutral ink | glasses, **プライベート**, 「共有も添付もできません」; no ask button | no marks | no panel | 05b |
| **pending** | hairline | 「共有の状態を確認しています…」 | none | row disabled | spec only |
| **unknown** (index failed) | hairline | 「共有の状態を確認できません」, button 「再試行」 (`refresh()`) | none | row disabled | spec only |
| **+ attached** | dashed ink frame in the outer lane, with whatever ring the state has | chip `[dashed glyph] 次の質問に添付 ×` left of the state; the state's sentence gives way to its label | dashed glyph before the seal | 「このページを添付」, `14:31の内容・この質問だけ`, 「はずす」 | 09b |

### 2.3 Rules

1. **One state per URL.** On every committed navigation (link, Back, in-app route change) the edge,
   the capsule and the tab mark are replaced in the same frame from the local index. Nothing moves
   and nothing animates for longer than 160 ms. A page is never shown inside the previous page's ring.
2. **The ring answers one question:** can the Space this window is in read what is inside this line?
   Closed: yes, this version. Open: an older version. No ring: no. A page shared only in another
   Space has no ring; its seal and words say where it is.
3. **Staleness is checked locally** (`checkStale`: a fresh local extraction, hash compared with
   `ItemIndexEntry.contentHash`; sends nothing): on tab activation, on load, 2 s after the page's
   last burst of DOM changes, and always before a sheet opens. Until a check returns, the last
   known state stays. (**inferred**: the cost of repeated extraction on heavy pages is **unknown**.)
4. **Dashes mean one question.** The dashed frame is shown while the draft of the member's private
   thread holds an attachment whose URL is this tab's URL, whether or not the panel is open. It goes
   when the question is sent, when the attachment is removed, or when the tab commits another URL
   (the chip in the composer stays: the text was already read at 14:31).
5. **Two lanes, fixed.** Ring: 0 to 3 px outside the card, radius 13. Frame: 4 to 6 px outside,
   radius 16, dash 7, gap about 5 (adjusted so the pattern closes evenly). The gutter is 8 px, so
   both fit on every side and beside the panel. They never share a lane, so "shared and attached"
   and "stale and attached" (09b) need no extra rule.
6. **Hue is the Space.** No other use of chroma in Tiger's own UI. Errors, destructive buttons,
   focus rings, selection and diff marks are ink (`--inverse`, `--mark`, weight, a 2 px bar).
7. **The pocket is this Mac.** Every tab of this window sits in the neutral pocket, in the member's
   own order, and never moves because of sharing. Which tabs are open is never sent and never shown
   to anyone: no presence, no "viewing now", no counts of other people's tabs anywhere.
8. **The shelf is the Space.** 「スペースの共有」 lists shared items (records on the server), newest
   change first, each with a byline. An item is not a tab: it does not disappear when a tab
   navigates, and it appears for every member. The row of the item the active tab shows is filled
   (`--space-frame-3`); that fill and the tab's seal tie the two together.
9. **Full-colour favicons and photos sit on neutral paper only** (pocket, palette, thread). On the
   tinted ground everything is monochrome type and glyphs, so the Space's hue never competes with
   a site's.
10. **Content leaves through one door.** Sharing and attaching both open the same sheet: the exact
    `ExtractedPage.markdown`, its line count, `charCount`, `extractor` and capture time on the left;
    who can read it and which companies receive it on the right. Section 2.6.
11. **Private is said in words.** 「このMacのみ」 sits in the slot where 「共有中」 would be, on every
    local page, with its own glyph. It is quiet on purpose: the commonest and safest state has no line.
12. **Blocked is quiet.** A page that can never leave gets a lock and a sentence, not a banner.
    The reason popover opens on the first visit to a site and on click.

### 2.4 What replaced "the tab row crosses the line"

The sidebar still has a threshold, and it is now between two kinds of thing rather than two
positions of one thing:

- above, on the tinted ground: **スペースの共有**, what the Space holds, as records with bylines;
- below, in the neutral pocket: **このMacのタブ**, what this Mac has open.

Sharing no longer moves the tab. A copy crosses: a ghost of the tab row rises over the pocket's edge
and lands as the newest item (section 6). The tab stays where the member put it and gains the seal.
That is also what a share is in the data: a snapshot at a version, not a live link.

Through navigation: the tab row keeps its place and takes the mark of its new URL (10c); the item
stays on the shelf. Through a page changing after it was shared: the item keeps its byline (第2版 is
still what the Space holds); the tab's seal turns hollow and the ring opens (10a).

With many tabs (14): the shelf has a fixed height (four rows by default; the threshold can be
dragged from two to eight, per Space), the pocket takes the rest and scrolls inside itself with its
header, the pinned row and 「新しいタブ」 fixed. The threshold never scrolls away. Collapsed (14b): a
52 px rail with the Space seal, the shelf count, and favicons with corner marks.

### 2.5 Provenance in type

- **Byline format:** `名前・第n版・日時`. Family name in the sidebar and palette, full name
  elsewhere. Dates: `今日 12:14`, `昨日 18:40`, then `11/23 09:02`; tabular figures; 12 px.
- **Where:** under every item title on the shelf; in the capsule after the state; under every
  source of an answer (with the source type first and the page number last); in the palette; in the
  header of the unshare dialog; in the destination row of the update sheet.
- **AI messages:** `虎 Tiger  Claude Sonnet 5.5・佐伯 遥の質問  12:16` (`Message.model`,
  `Message.author`). People write in Gothic; the answer is Mincho.
- **The ledger (台帳, Space home):** columns 題名と出どころ / 共有した人 / 最終共有 / 版. Names
  are type, no discs. Rows are 44 px with the source type and host as the second line.
- **Tombstones:** an unshared item stays in its place in the ledger in `--ink-3`, not struck
  through: title, `11/21 16:30 に佐伯 遥が共有を解除・全2版`, 「解除済み」 in the version column,
  「本文は削除済み」 where the actions were. The title and URL are kept by the audit event
  (`AuditEvent.target`, **documented** in `packages/shared/src/domain.ts`); the dialog says so.
- **Unavailable citation (11b):** the chip keeps its number, loses the Space wash and is struck
  (a digit, not kanji); its source row keeps the title and says who unshared it and when; the
  quote is gone; one sentence under the sources says which part of the answer can no longer be checked.

### 2.6 The sheet: the one door

Same component for 「スペースに共有」 (03), 「新しい版を共有」 (03b) and 「この質問に添付」 (09).

- Opens only from an explicit act: the capsule button, ⇧⌘S, the ledger button, the palette command.
  ⌘\ opens the panel and attaches nothing (the engine binds `toggle-side-panel` to ⌘\; an earlier
  draft of this document said ⌘J).
- Left: title, `Markdown n行・n文字・<extractor> で取得`, the numbered Markdown in mono, then
  「送らないもの」. For an update or an attachment of a shared page, lines that differ from the
  version the Space holds are marked with a 2 px ink bar and weight 600; the update sheet shows the
  old line above in `--ink-3`, labelled 第2版. No red, no green, no strike-through.
- Right, share: Space wash, entered across a 3 px solid line in the Space colour. 共有先 (picker),
  **読める人と送り先**: each member by name, then 「Tiger のサーバー — 保存と検索」 and the provider
  companies that have a key on this server (「Anthropic・OpenAI — 質問されたとき」), 元のページ (the
  full URL, wrapped, mono), 共有したあと (three sentences). Confirm button in the Space colour.
- Right, attach: neutral `--paper-2`, entered across a 2 px dashed ink line. 送り先: the company of
  the selected model (`PROVIDER_COMPANY`), with `provider.sendsTo`; 読める人: あなただけ; what
  happens after. Confirm button in ink with the dashed glyph.
- Footer of both: 「14:36に読み取った内容を、そのまま送ります。」 (`ExtractedPage.capturedAt`).
- The overlay has the bounds of the stage and paints a flat scrim (`--scrim`, no blur), so the page
  cannot be clicked or typed into while the sheet is open (**documented**: the overlay takes every
  click inside its bounds). The sheet belongs to its tab: switching tab, navigating or switching
  Space closes it and discards the extraction (`cancel()`).
- Not printed because I could not verify them: a data region, and any statement about model
  training. They belong on this sheet once they are facts.

## 3. The two reviews: every blocker and major

| # | Issue | Resolution | Shot |
| --- | --- | --- | --- |
| C-B1 | Share state tied to the tab row; navigation undefined | State belongs to URL at version (2.2). Tabs never move; the shelf holds items (2.4). Rule 1 defines navigation. | 10c, 14 |
| C-B2 | Ring binary, truth has three states; 「共有中」 twice in one toolbar | None / closed / open. Label 「第2版を共有中」 with a hollow seal, the sentence next to it, the action 「新しい版を共有…」 solid. State and action live in one capsule; the word appears once. | 01, 10a |
| C-M1 | Selected shared row white like the pocket | White is the pocket's alone. Rows on the tinted ground are filled with `--space-frame-3`. | 01 |
| C-M2 | Frames are Dia's salmon and mint | Hero Space is 琥珀 (amber). Frames are L 0.916 with 1.3 to 1.8 times the old chroma; 若竹 moved to tint hue 128; 柿 to 58. | 01, 13b |
| C-M3 | Hue never met a real hue | Coloured stand-in favicons, two photo stand-ins, a navy and crimson bank page (05), an aubergine chat page (14). Policy: rule 9. No third-party logos: the favicons are generic glyphs in real-world hues. | 05, 14 |
| C-M4 | Monogram stutter, 28 discs, 10 px kanji | Ledger and Space header name people in type. No presence anywhere. Photo when `avatarUrl` exists; monogram fallback (given-name character when family names collide), 11 to 13 px in 20 to 28 px discs. | 04 |
| C-M5 | Black sill on the safest state; not buildable | No sill. Lock, words, popover. Nothing depends on the page view's corner shape. | 05 |
| C-M6 | Ledger and input take 32% of the panel | Expanded ledger is three 28 px rows (207 px with the composer, 25%); after the first question it folds to one 28 px line (125 px, 15%). It unfolds when the set changes. | 02, 12 |
| C-M7 | Opaque sheet on a white page with no scrim | Flat scrim over the stage; sheet edge is a 1 px ring at 0.22 alpha plus the shadow. | 03, 08 |
| C-M8 | Mincho set with auto-phrase; never shown long | Answers: `word-break: normal`, `line-break: strict`, justified. 02 shows a table, a list and Latin terms. Tables and code in an answer are Gothic or mono 13. | 02 |
| C-M9 | `palt` on by default | Off on `body`; on for a listed set of one-line labels only. | all |
| C-M10 | Four sizes within 3 px; Japanese at 11 px | 12 / 13 / 15 / 20 (28 for generated documents). 11 px is for Latin and digits only. | all |
| C-M11 | ⌘Z on the undo toast | No toast, no shortcut. After a share the capsule reads 「共有しました」 with a 「取り消す」 button for 8 s. | 03c-shared |
| U-B1 | Attaching sends content with no preview | The attach sheet (2.6). The switch is gone: the ledger row is a button that opens the sheet. First-run copy rewritten. | 09, 09b, 06 |
| U-M1 | Consent surface hides the outside companies | 「読める人と送り先」 lists Tiger's server and the provider companies; the send button reads 「Anthropic に送信」; the model menu is grouped by receiving company. | 03, 02, 12 |
| U-M2 | Page title in the address field | The capsule shows the URL only: registrable domain in ink 600, subdomain and path in `--space-ink-2`, truncated from the right with a fade, never inside the domain. Titles live on tab rows. The palette (⌘L) and a 300 ms hover tooltip show the full URL. Punycode hosts get a 「見た目が似た文字を含むアドレス」 warning before the URL (**spec only**, not drawn). | 01 |
| U-M3 | Protection notice inside the card can be faked | Protection state is only in the capsule, the tab row and a chrome popover. | 05 |
| U-M4 | Frame tint says "in the Space" on a private page; absence is weak | Rule 11 and rule 7: words in the capsule on every local page, and every tab in a neutral pocket labelled このMacのタブ. The tint now means where questions and shares go, which is true on every page. | 10c |
| U-M5 | Dark frames nearly neutral; private window indistinguishable | Dark frames: L 0.30, chroma 1.5 times the light frame (amber is `#3e2a00`). Private window in dark: a neutral frame lighter than every Space (L 0.40), its own header, no shelf, no ask button. The seal names the Space in a character in the capsule. | 07-dark-* |
| U-M6 | Threshold scrolls away at 30 tabs; no pinned tabs | 2.4. Pinned row of six, 40 tabs drawn. | 14, 14b |
| U-M7 | Page stays live under the consent sheet | Overlay covers the stage; sheet bound to its tab; capture time stated (2.6). | 03 |
| U-M8 | No model catalogue | Menu grouped by company, tier in type, unavailable provider with its reason, default marked, "next question only". | 12 |
| U-M9 | Unshare is one click, consequences unstated | Dialog: 消えるもの / 残るもの, and what cannot be taken back. Unavailable citation drawn. | 11, 11b |

Where a reviewer is wrong, in one sentence each:

- **Dashed ring for stale (C-B2):** dashes are reserved for "this question only", and a stale page
  is still held by the Space, so its line stays solid and opens instead.
- **Dashed neutral ring on every private page (U-M4):** it would put the system's loudest line on
  its commonest and safest state and make it collide with the attach frame.
- **A 28 px banner for blocked pages as a fallback (C-M5):** any band on the page side of the
  toolbar reads as page content, which is the spoofing problem U-M3 describes.
- **「東京リージョン」 and 「学習には使われません」 on the sheet (U-M1):** neither is a fact I can
  verify today, and a consent surface must not print a promise the product has not made.
- **Favicons in greyscale until hover (C-M3):** they sit on neutral paper, where colour helps a
  member find a tab among forty and cannot be mistaken for the Space.
- **Keep ⌘Z for undo, toast in the sidebar (U minor):** an unshare deletes content, versions and
  embeddings, so it never rides on an editing shortcut.

Minors taken: fade instead of ellipsis on titles; PDF and ⌘ glyphs redrawn; full-width colon, no
Latin em dash, in answers; one wording for one state (2.2); 「共有を解除」 everywhere (matches
`error.item_not_found`); empty image link `![…]()` no longer emitted in the mock; sheet sized
`min(980px, 100% − 48px)`; "me" is an outlined disc, solid ink is the AI's alone; a 印 field in
first run (プロダクト is 製); the model row no longer underlines; outlines mean share state only
(composer and inputs use a 1 px control line; selection in the swatches is a fill and a check);
ledger actions are 「•••」 at rest; radii reduced to 4 / 6 / 8 / 10 / 14; one relayout when the panel
opens; native window shape (the 16 px corner is mock only); the palette never preselects 「共有」.

## 4. The window

All values are CSS px at 1x; tokens in `tokens.css`. Measured from the rendered prototype (**verified**
with `getBoundingClientRect`).

```
┌ sidebar 248 ─┬ toolbar ───────────────────────────────── h 48 ┐
│ top row 48   │ nav 88 │ capsule (flex, h 34)        │ ask 130 │
│ Space 44     ├────────────────────────────────────────────────┤
│ shelf        │ 4                                              │
│ 28 + 4 × 44  │  page card (flex, r 10)      8   panel 400     │
│ pocket       │  1176 × 840, or 768 × 840        (r 10)        │
│ (rest)       │                                                │
│ foot 44      │ 8                                            8 │
└──────────────┴────────────────────────────────────────────────┘
```

| Part | Size | Min / max | Notes |
| --- | --- | --- | --- |
| Window | 1440 × 900 in shots | min 720 × 480 | Native shape and radius, `titleBarStyle: hiddenInset` (**inferred**); traffic lights at x 20, y 18. |
| Sidebar | 248 wide | 200 to 320, drag the right edge; 52 as a rail | Padding 0 4 8 8. Content 236 wide. |
| Toolbar | 48 high, from x 248 | | Padding 0 8 0 4, gap 8. Nav: three 28 px buttons. Capsule: flex, 34 high, y 7. Ask button: 30 high. |
| Gutter | 8 | fixed | Left of the card, right of the card, bottom, and between card and panel. Top: 4 px of stage plus the 7 px under the capsule. |
| Page card | flex | min 480 wide | Radius 10 (`View.setBorderRadius(10)`, **documented** in CLAUDE.md). x 256, y 52. |
| Ask panel | 400 wide | 360 to 520, drag the left edge | Radius 10, below the toolbar, right of the page. |
| Thread column (Space home) | 400 | fixed | Inside the home card, left border 1 px. |

**Below 1100 px of window width.** Budget: `page = W − sidebar − 16 − (panel + 8)`, and the page
keeps 480.

- 1100 and up: everything as drawn.
- 960 to 1099 with the panel open: the sidebar becomes the rail (14b) while the panel is open and
  returns when it closes.
- 720 to 959: the panel does not resize the page. It opens in the overlay layer over the right
  400 px of the stage (it takes the clicks in its bounds; the page keeps its size, so no relayout).
- The capsule gives up text in this order as it narrows: the state's sentence, the byline, the
  path, the subdomain. The state label, the seal, the action and the registrable domain never go.
- Sheets are `min(980px, 100% − 48px)` wide and at most `min(748px, 100% − 48px)` high; under 760
  px of stage width the right column moves below the Markdown as a footer (**spec only**).

## 5. Components

Type styles are written `size/weight` in px. `palt` only where stated. Colour roles are token names.

### 5.1 Sidebar

| Component | Geometry | Type | Colour |
| --- | --- | --- | --- |
| Space header | 44 high, padding 0 6 0 4, gap 8, radius 8. Seal 28. Two controls in one row: the seal and name (flex) open Space home; a 28 px chevron button at the right opens the Space menu (11.5). | Name 15/600 `palt`; sub line 12/400: `メンバー4人・共有41件` | Name `--space-ink`; sub `--space-ink-2`; hover `--space-frame-2`; Space home open `--space-frame-3`; menu open: row `--space-frame-2`, chevron button `--space-frame-3` |
| Zone header | 28 high, padding 0 6 0 8 | Label 12/600 +0.02em; count 11/600 tabular; link 12/400 | On the frame `--space-ink-2`; in the pocket `--ink-2`, count `--ink-3` |
| Shelf item | 44 high, padding 6 8 0, gap 8, radius 6. Glyph 16 by `sourceType`. | Title 13/400 (600 when current), fade tail; byline 12/400 | Title `--ink` (`--space-ink` when current); byline and glyph `--space-ink-2`; hover `--space-frame-2`; current `--space-frame-3` |
| Pocket | Radius 10, padding 0 4 4, 1 px inset `--pocket-line`. Hugs its rows until it meets the footer, then its list scrolls. | | `--pocket` (paper; a darker recess in dark) |
| Pinned row | Six tiles, 34.7 × 32, gap 4, radius 6. Favicon 16. A 6 px square at the top right when the page is shared here. | | Tile `--paper-3`; active `--paper-4` with 1 px `--line-strong`; mark `--space-solid` |
| Tab row | 32 high, 1 px apart, padding 0 6, gap 8, radius 6. Favicon 16, title, trailing marks 16 with 4 px between: sound, dashed glyph, lock or seal. Close button 20 on hover. | 13/400 `palt`, fade tail 20 px | `--ink`; hover `--paper-2`; active `--paper-3` with 1 px `--line`; lock and sound `--ink-3` |
| New tab | 32 high, fixed under the list | 13/400; keys 11/600 | `--ink-3` |
| Footer | 44 high. Space seals 24 in 28 px targets, gap 6; the current one has a 2 px bar under it. Own avatar 24 at the right (settings, account). | | Bar `--space-ink` |
| Rail (collapsed) | 52 wide. Seal 28; shelf button 44 × 44 with the count; pocket 44 wide with 36 × 32 favicon rows; corner mark 7 px (solid, hollow, or a 10 px lock). | Count 11/600 | as above |

### 5.2 Toolbar

| Component | Geometry | Type | Colour |
| --- | --- | --- | --- |
| Icon button | 28 × 28, radius 6, glyph 16 at 1.5 px stroke | | `--space-ink-2`; hover `--space-frame-2`; disabled `--space-ink-off` |
| Capsule | 34 high, radius 10, 1 px inset. Left: the URL, padding 0 12. A 1 × 16 rule. Right: the state cluster, padding 0 4. | URL 13/400, registrable domain 13/600, no `palt` | Field `--space-field`, line `--space-line`; domain `--ink`; rest `--space-ink-2` |
| State cluster | Mark 20 (seal, or a 16 px glyph), label, byline, then a chevron or an action. The label part is a 28 px button, radius 6. | Label 13/600 `palt`; byline 12/400 `palt` tabular | Label `--space-ink` when a Space holds the page, `--ink` otherwise; byline `--space-ink-2` |
| In-capsule action | 26 high (target 34 by `::after`), padding 0 12 0 8, radius 6, crossing glyph 14 | 12/600 | Paper with 1 px `--space-line`; solid variant `--space-solid` / `--on-space-solid` (stale only) |
| Attach chip | 26 high, radius 6, dashed glyph 16, close 20 | 12/600 | `--paper`, `--ink` |
| Ask button | 30 high, padding 0 12, radius 8, chat glyph | 13/600 | `--paper` with 1 px `--space-line`; pressed `--space-frame-3`, `--space-ink` |

### 5.3 Page card and its lines

| Component | Geometry | Colour |
| --- | --- | --- |
| Card | Radius 10; 1 px `--space-line` when it has no ring | `--paper` behind the page view |
| Ring, closed | SVG `rect`, stroke 3, centred 1.5 px outside the card, radius 11.5 on the centre line | `--space-accent` (3:1 or better on the frame and on white, every hue, **verified** by `contrast.cjs`) |
| Ring, open | The same path without the top edge between two 44 px stubs (`--ring-lid`), butt caps | `--space-accent` |
| Frame | SVG `rect`, stroke 2, centred 5 px outside the card, radius 15 on the centre line, `stroke-dasharray` 7 and about 5 | `--ink` |

### 5.4 Ask panel

| Component | Geometry | Type | Colour |
| --- | --- | --- | --- |
| Header | 44 high, padding 0 8 0 16, gap 8. Title, seal 20 and Space name, 「新しい質問」 (28 high), close. | 13/600 | Space name `--space-ink` |
| Visibility line | 32 high, 1 px rules above and below | 12/400; link 12/600 underlined | `--paper-2`, `--ink-2` |
| Message header | 24 high. Photo or monogram 24 (outlined for the member), or the ink seal 24. Name, then model, then time. | Name 13/600; model 12/400; time 11/400 tabular | `--ink`; model and time `--ink-3` |
| Person's text | 4 px under the header | 13/400, line height 1.7, Gothic | `--ink` |
| Attachment line | 6 px under the text. Dashed glyph 16. | 12/400, title 600: `投資家向けピッチ v3 を添付・481文字・Anthropic に送信` | `--ink-2`, title `--ink` |
| Answer | 6 px under the header | Mincho 15/500, line height 1.8, justified; emphasis 700; lists hang 1.2em; tables Gothic 13 with 12/600 headers; code mono 13 | `--ink` |
| Citation chip | 16 × 16 min, radius 4, 2 px either side; target 28 by `::after` | 11/600 tabular | `--space-wash-2`, 1 px `--space-wash-line`, `--space-ink`. Attachment: 18 high, 12 px 「添付」, 1 px dashed `--ink-2`. Unavailable: paper, 1 px `--line-strong`, `--ink-3`, struck. |
| Source row | Grid 24 + rest, padding 7 0 6, 1 px rule under. Optional quote with a 2 px rule. | Title 13/400; byline 12/400 | Title `--ink`; byline `--ink-3` |
| Answer actions | 28 high buttons, gap 6: 「スレッドに投稿」 and 「書き出す ▾」, which opens the export menu with the three exits (11.11). The outcome of an export is a block under the row (10.9). | 12/600 | Paper, 1 px `--line-strong`; menu open `--paper-3` |
| Progress steps | 14 px glyph and a line each, 3 px apart; the current step has a 6 px ink dot | 12/400; current 12/600 | `--ink-2`; current `--ink` |
| Halt block (failed, stopped) | Padding 8 12, radius 8, 1 px `--line`. Glyph and a heading, the sentence from `ai.*`, then facts and one action. Budget: a 4 px meter and two rows from `SpaceUsage`. | Heading 13/600; text 12/400 | `--paper-2`; meter `--ink` on `--paper-4` |
| Ledger, expanded | Top rule; header 24; three rows of 28: Space items (seal 20), this page (dashed glyph or lock), other tabs (laptop). | Header 12/600; subject 13/400 or 600; note 12/400 | Notes `--ink-3`; unavailable rows `--ink-3` |
| Ledger, folded | One 28 px row: `AIが読むもの [seal] 共有41件 ＋ [dashed glyph] 添付1ページ（この質問だけ）`, chevron | 12/400, counts 600 | `--ink-2`, counts `--ink` |
| Composer | Margin 6 12 12, padding 8 8 8 12, radius 10, 1 px `--line-control`; no ring when focused, only the caret. Attach chips, text (min 24), then the foot: model button left, send right. | Text 13/400, line height 1.7 | `--paper` |
| Model button | 28 high, padding 0 6, radius 6, chevron | 12/600 | `--ink-2`; open `--paper-3`, `--ink` |
| Send | 28 high, radius 6: 「Anthropic に送信 ↵」; while streaming 「止める」 with the stop glyph, outlined; in a Space thread without @Tiger 「投稿 ↵」 | 12/600 | `--inverse` / `--on-inverse`; disabled `--paper-3` / `--ink-off` |

### 5.5 Overlay surfaces

| Component | Geometry | Type | Colour |
| --- | --- | --- | --- |
| Scrim | The stage, flat | | `--scrim` |
| Sheet | `min(980, 100% − 48)` wide, 560 to 748 high, radius 14, columns flex and 336. Left padding 20 20 12 24; Markdown box radius 8, 18 px lines, number column 44. Right padding 20 20 16, sections 16 apart. | Title 15/600; meta 12/400; Markdown mono 12; line numbers mono 11; section labels 12/600; reader rows 28 high 13/400 | `--paper`; Markdown box `--paper-2`; share side `--space-wash` with a 3 px `--space-accent` inset; attach side `--paper-2` with a 2 px dashed `--ink` border; changed line `--mark` with a 2 px `--ink` bar |
| Dialog | 560 wide, padding 24 24 20, radius 14. Two columns with a 1 px rule under each label. | Title 15/600; lists 12/400 | Confirm `--inverse`; note `--paper-2` |
| Popover | 336 wide, padding 16 16 12, radius 10; 6 px under its trigger, right edges aligned | Title 13/600; text 12/400, line height 1.7; rule value mono 11 | `--paper`, `--shadow-menu` |
| Model menu | 360 wide, radius 10, opens upward from the model button. Company header 30 (company 12/600, sentence 12/400), rows 30, footer 12. | Model 13/400 (600 when selected); tier and 「既定」 12/400 | Selected `--paper-3` with a check; unavailable `--ink-off`; footer `--paper-2` |
| Palette | `min(680, 100% − 48)` wide, 64 px from the top of the stage, radius 14. Field 52; section labels 28; rows 36; footer 36. | Input 15/400; titles 13/400, match 600 with a 2 px underline; host mono 11; hints 12 | Selected row `--paper-3` with a 3 px `--ink` bar at the left |

### 5.6 Chrome-rendered pages

| Page | Layout |
| --- | --- |
| Space home (04) | Card with the closed ring (what is written here is read by the Space). Left: header 76 (seal 40, name 20/600, one sentence naming the readers), bar 44 (台帳, three filters, a 240 px filter field), the ledger (header 30, rows 44; columns flex / 112 / 112 / 72 / 132). Right: thread column 400. Share events in a thread are 28 px rows in `--space-wash`. |
| First run (06) | Left, at the top left, not centred: steps in type, title 20/600, three fields (名前, 印, 色 as nine named swatches), one button. Right 500: the four page edges as miniatures with one sentence each, and the blocklist in one line. |
| Private new tab (05b) | Title 20/600, one sentence, three statements with a glyph each. No promise about saved passwords or passkeys: the engine has neither. |

### 5.7 Atoms

- **Seal:** 16 / 20 / 24 / 28 / 40 px squares, radius 4 / 4 / 6 / 8 / 10, Mincho 700 at
  11 / 12 / 13 / 15 / 20. Solid `--space-solid` with `--on-space-solid`; hollow `--paper` with a
  1.5 px `--space-accent` inset and `--space-ink`; AI `--inverse` with `--on-inverse`.
- **Avatar:** 20 / 24 / 28 px disc. Photo, or monogram 11 / 12 / 13 px 600 on `--paper-3` with a
  1 px `--line-strong` inset. The member: `--paper` with a 1.5 px `--ink` inset.
- **Key cap:** 18 high, min 18 wide, radius 4, `--paper-2`, 1 px `--line-strong`, 11/600; glyphs
  12 px at 1.25 stroke.
- **Icons:** one own set, 16 px grid, 1.5 px stroke, round caps and joins (`prototype/icons.js`).
  The crossing glyph (an arrow rising through a gap in a line) is share; reversed, unshare. The
  dashed square is attach.
- **Elevation:** shadows only on the overlay layer and the travelling ghost row:
  `--shadow-menu` (popover, menu), `--shadow-sheet` (sheet, dialog, palette), `--shadow-lift`.
- **Radii:** 4 key, chip, small seal; 6 row, small button; 8 control; 10 card, pocket, capsule,
  menu; 14 sheet. Concentric: capsule 10 = in-capsule button 6 + padding 4; ring 13 = card 10 + 3.

## 6. Motion

Durations and easings are tokens. Reduced motion: every sequence below becomes one 160 ms
cross-fade; nothing travels. Only chrome pixels animate; the page view is never moved or scaled
except the single `setBounds` named in 6.3.

### 6.1 Sharing (after 「スペースに共有」 in the sheet)

Prototyped from T onward in CSS and SVG (`app.css`, "motion: sharing"): `?screen=03c-crossing&play=1`
plays it, `&t=150` freezes it (**verified**: rendered at t = 150 ms as `shots/03c-crossing.png`).
The other sequences in this section are specified, not prototyped.

| At | What | Duration, easing |
| --- | --- | --- |
| 0 | Sheet fades and scales to 0.98; scrim fades. Capsule reads 「共有しています…」 until the server answers (`sending` cannot be cancelled). | 160 ms, `--ease-in` |
| T (answer, `done`) | **The ring closes:** two arms start at the bottom centre, run out along the bottom, up both sides and meet at the top centre. | 420 ms, `--ease-close` |
| T | **A copy crosses:** a ghost of the tab row lifts (scale 1.02, `--shadow-lift`, 90 ms), travels from the tab to the first slot of the shelf (360 ms, `--ease-cross`), and cross-fades into the item row (160 ms). The other items move down 45 px; the last one fades. | 240 ms, `--ease-out` for the neighbours |
| T + 120 | The tab row gains its seal (opacity and scale from 0.8). The capsule cross-fades to `[seal] 共有しました ・第1版 [取り消す]`. | 160 ms, `--ease-out` |
| T + 8 s | The capsule settles to 「共有中」 with the byline and the chevron. | 160 ms |

A new version (`outcome: "version"`): the two stubs grow toward the top centre and meet (240 ms,
`--ease-close`); the item moves to the first slot (240 ms); the seal fills (160 ms); the capsule
reads 「新しい版として共有しました」 (`share.outcome.version`). `unchanged`: nothing moves; the
capsule reads 「内容は前回の共有から変わっていません」 for 4 s.

A page found stale: the top edge retracts from the centre to the stubs (240 ms,
`--ease-in-out`); the seals empty (160 ms); the capsule cross-fades. No sound, no notification.

Unsharing: the ring retracts along the path it was drawn (240 ms), the item row turns into its
tombstone in the ledger (cross-fade 160 ms) and leaves the shelf (height to 0, 240 ms).

### 6.2 Attaching (after 「この質問に添付」)

| At | What | Duration, easing |
| --- | --- | --- |
| 0 | Sheet fades and scales to 0.98. | 160 ms, `--ease-in` |
| 100 | **The frame is drawn once round,** clockwise from the top left (`stroke-dashoffset`), then stands still. No marching. | 360 ms, `--ease-out` |
| 100 | The chip rises 4 px into the composer; the ledger unfolds if it was folded; the capsule gains its chip. | 160 ms, `--ease-out` |
| on send | The frame fades; the chip becomes the attachment line of the message. | 160 ms |

### 6.3 Opening the panel

One relayout of the live page, not three: at 0 the page view gets its final bounds in a single
`setBounds`; the panel fades in and moves 12 px from the right in the space that opened (160 ms,
`--ease-out`). Closing: the panel fades (90 ms), then one `setBounds`. The ring and frame are
redrawn at the new size without animation.

### 6.4 Switching Space

The frame re-tints (280 ms, `--ease-in-out`, every Space role at once); the shelf cross-fades
(160 ms); the pocket's list is replaced (out 90 ms, in 160 ms with 8 px of travel in the direction
of the switch); the bar under the seals slides (240 ms, `--ease-out`). The page view of the new
Space's active tab is shown at 0. Private windows never animate a tint: they have none.

### 6.5 Navigation, hover, press

Navigation: rule 1, no motion. Hover fills: 90 ms. Press: 90 ms. Menus and popovers: fade 90 ms in
place, no scale. An answer streams as text; the current step has a still dot (no pulse, no skeleton).

## 7. Type

- **UI (Gothic):** SF Pro Text with Hiragino Sans W3 and W6 on macOS (the system stack). The mock
  renders Inter with Noto Sans JP 400 and 600.
- **The Space's voice (Mincho):** AI answers and seals. Production: Noto Serif JP 500 and 700
  bundled (OFL), falling back to Hiragino Mincho ProN (**inferred**: its W3 is too light at 15 px;
  test on a Retina panel). Never for tables, code, labels or people.
- **Mono:** SF Mono in production, Geist Mono in the mock: Markdown previews, hosts, rule names.
- **Scale:** 12 labels, bylines, notes; 13 UI; 15 titles and answers; 20 screen titles; 28
  generated documents. 11 for Latin and digits only. Two weights per face.
- **Japanese setting:** `lang="ja"`; `line-break: strict`; `text-autospace: normal` and no typed
  spaces between Japanese and Latin; `palt` on one-line labels only; body and answers are full
  width; answers are justified (`text-justify: inter-character`); a citation chip keeps the two
  characters before it and the punctuation after it on its line, so a justified line stretches by
  two characters at most; long titles fade over 20 px instead of ending in 「…」; 「・」 separates
  the parts of a byline; full-width colon, no Latin dash.
- **Tone:** です・ます, verb stems on buttons, 共有 not シェア, 解除 for unshare, cause then remedy
  in errors. Existing strings in `packages/client/src/i18n/ja.ts` are used as they are where they
  fit: `share.stale.*`, `capture.reason.*`, `ai.ai_aborted`, `ai.budget_exceeded`,
  `provider.sendsTo`. New strings in the prototype need keys in both `ja.ts` and `en.ts`.


## 8. Screens (`shots/*.png`: 52 screens at 2880 × 1800, plus the component sheet)

| File | What it shows |
| --- | --- |
| 01-browse | A Google Doc the Space holds at 第2版, unchanged since: closed ring, 「共有中」 with byline, solid seal on the tab, current item filled on the shelf. |
| 02-ask-panel | The private thread: a cited answer with a table and a list in Mincho, sources with bylines, the expanded ledger, the model button, 「Anthropic に送信」. |
| 03-share-preview | First share of a spreadsheet: the exact Markdown, readers and recipients, what happens after, capture time. |
| 03b-share-update | A new version: the two changed lines marked, the old lines above them. |
| 03c-crossing | The share sequence frozen 150 ms after the server's answer. Live: `?screen=03c-crossing&play=1`. |
| 03c-shared | Where it settles: closed ring, the new item first on the shelf, 「共有しました」 with 「取り消す」 in the capsule. No toast. |
| 04-space-home | The ledger with a tombstone and a hover action; the team thread. The bar now starts with the three sections of Space home (section 9, item 1). |
| 05-cannot-share | A bank page inside the amber frame; the reason popover with the matched rule. |
| 05b-private-window | No Space, no hue, no shelf, no ask button. |
| 06-first-run | Create the first Space and learn the four page edges. |
| 07-dark-01-browse, 07-dark-02-ask-panel, 07-dark-04-space-home, 07-dark-05b-private-window | The same screens in the dark theme. |
| 08-command | The palette over a news page, on the scrim. |
| 09-attach-preview, 09b-attached | The attach sheet; then the dashed frame, the chips and the ledger row. |
| 10a-stale, 10b-shared-elsewhere, 10c-after-navigation | The other states of a page. |
| 11-unshare-confirm, 11b-citation-unavailable | Unsharing, and an answer whose source was unshared. |
| 12-model-menu | Catalogue by receiving company. |
| 13a-streaming-with-stop, 13b-answer-failed, 13c-answer-stopped | An answer in progress, failed (budget), stopped. |
| 14-many-tabs, 14b-sidebar-collapsed | Forty tabs; the rail. |
| **15a-permission-prompt** | A meeting page asks for the microphone: popover under the address, mark in the capsule and on the tab row. |
| **15b-downloads** | The downloads button in the toolbar with its meter; the list with every `Download.state`. |
| **15c-find-in-page** | The find field in the toolbar; the engine's highlights in the page. |
| **15d-notice** | The one transient message, in sidebar pixels above the footer (a download finished). |
| **16a-space-switcher** | The Space menu: Spaces with role, Space actions, new Space, join by link, private window. |
| **16a2-create-space** | The create dialog: name, seal, one of nine colours, drawn in the colour being chosen. |
| **16b-members-and-invites** | Space home, section メンバー, as an owner sees it: members and roles, pending invites, the invite column with the link that is shown once. |
| **16c-accept-invite** | The accept step after an invite link is opened: which Space, who invited, what joining changes and what it does not. |
| **16d-activity** | Space home, section 記録: the audit log in words and the month's AI usage. Beyond the brief, so that the third tab leads to a drawn screen. |
| **17-share-thread-confirm** | Sharing a private thread: every question with its answers; the two built from attached pages carry the dashed line; one is still undecided and the confirm button is off. |
| **17b-share-thread-ready** | The same sheet with every decision made: one block left out, the button on. |
| **18a-export-menu** | 「書き出す」 on an answer: Google ドキュメント, Markdown をコピー, ファイルに保存. |
| **18b-google-not-connected** | The step before the system browser: what Tiger can and cannot do with Drive, where the connection is kept. |
| **18c-export-done** | The outcome block under the answer, with the document and 「開く」. |
| **19-settings** | Language, theme, search engine, sites never to capture, the built-in list, default model, Tiger account, Google Drive. |
| **20a-sign-in** | Signed out: no Space, so no hue. What sign-in gives Tiger and what it does not. |
| **20b-offline-reconnecting** | The server cannot be reached: status line under the Space, the panel says what does not work, a question that was not sent. |
| **20c-page-load-error** | A page that did not load (DNS), drawn by Tiger in the page card. |
| **20d-tab-crashed** | The page process ended. |
| **21-item-detail** | A shared item: the stored Markdown exactly as members and the AI read it, the version history, who can read it, unshare. |
| **22-new-tab** | What the Space shared lately on the left, what this Mac opened lately on the right. |
| **23-dark-17-share-thread-confirm, 23-dark-19-settings, 23-dark-21-item-detail** | Dark renderings. |
| **components, components-dark** | Every component in every state, 1440 wide and about 7,900 px tall, built from the same functions as the screens. |

Mock data notes from the first pass still hold (model tiers, the Sheets 「送らないもの」 line).

## 9. Changes to the system made in the second pass

Each is a fix or an addition at the system level; every shot was regenerated after them.

1. **Space home has sections.** The single heading 「台帳」 in the bar became three view tabs:
   台帳 / メンバー / 記録 (router: `space-home` with `section` `items` / `members` / `activity`).
   Reason: there was no drawn way from the ledger to the members. 04 changed accordingly.
2. **The Space header is two controls.** The name opens Space home; the chevron opens the Space
   menu. Before, one button carried both a "home" label and a menu chevron.
3. **Answer actions.** 「Google ドキュメントに書き出す」 and the copy icon became one button,
   「書き出す ▾」, with the three exits in a menu. 02, 07-dark-02, 09, 09b, 12, 14b changed.
4. **A ledger title faded although it was not cut** (the title box shrank to its text, and the
   fade mask always covers the last 20 px of the box). `.book-title` now fills its cell. 04 and
   07-dark-04 changed: titles are sharp to the last character unless really truncated.
5. **Short notes break at phrase boundaries.** One to three lines of 12 px (list notes in sheets
   and dialogs, popover text, help text) use `word-break: auto-phrase`, so no line ends on a
   stranded syllable (「ありま／す」). Answers and running text keep the rule of section 7.
6. **Keyboard.** The panel shortcut is ⌘\ (what the engine binds), not ⌘J.
7. **The capsule has an `unknown` state drawn** (index failed: 「共有の状態を確認できません」 with
   「もう一度確認」) and a note slot for a page that is not there (「ページがありません」).
8. **Tab rows have two more marks:** a site permission request is waiting (the permission's glyph
   with a still dot), and the page process ended (warning glyph).
9. **Tokens added:** `--w-find`, `--w-pop-list`, and five mock-content colours (a dark page,
   Chromium's find highlight). No new colour role was needed for Tiger's own UI.
10. **Files.** `boot.js` holds the drawing of the two lines and the boot that `screens.js` ended
    with; `screens2.js`, `sheet.js`, `part2.css`, `sheet.css` are new; `render.cjs` also renders the
    component sheet at full height and writes `icons.svg`; `contrast.cjs` checks eight more pairs
    (all pass, **verified**).

## 10. Components added in the second pass

Same conventions as section 5: sizes in CSS px, type as `size/weight`, colours as token names.
Every component below is on the component sheet (`shots/components.png`) in every state.

### 10.1 Controls

| Component | Geometry | Type | Colour and states |
| --- | --- | --- | --- |
| Checkbox `.check` | One target 28 high: box 16 × 16, radius 4, gap 8, label | 12/400 `palt` | Box `--paper` with 1 px `--line-control`; hover `--paper-2`; on: `--inverse` with a 12 px check in `--on-inverse`; disabled: `--paper-2`, 1 px `--line-strong`, label `--ink-off`. Space toggles. |
| Choice `.seg.seg--box` | Box padding 2, radius 8, 1 px `--line-strong`; items 28 high, padding 0 12, radius 6, 2 px apart. Total height 32. | 12/400; chosen 12/600 | Chosen: `--paper-3` and a 12 px check before the label. Hover `--paper-2`. **A required choice has no default:** no item is chosen, the box line is `--line-control`, and 「選んでください」 with a 6 px ink dot stands before it. Left and right arrows move, Space chooses. `role="radiogroup"`. |
| Input, small `.input.input--sm` | 30 high, padding 0 12, radius 8 | 13/400; mono 12 for hosts | 1 px `--line-control`; focus 1.5 px `--ink`; placeholder `--ink-3`. Error: 1.5 px `--ink` and a line under it, 12/600 `--ink`, with the warning glyph (no red). |
| Large button `.btn--lg` | 36 high, padding 0 16 | 13/600 | Used once: 「Google でサインイン」. |
| Menu button | A `.btn--sm.btn--line` with a 12 px chevron at 70% | 12/600 | Open: `--paper-3`. |
| Meter `.meter` | 2 high, radius 1, 3 px under the text it belongs to | | Track `--paper-4`, fill `--ink`. No animation other than the width. |

### 10.2 Notice (the toast)

There is one transient message component and it never covers a page.

- **Where:** in the sidebar, directly above the footer, 236 wide (the sidebar's content width),
  over the bottom of the pocket if the pocket reaches that far. These are Tiger's own pixels: no
  overlay layer, no click is taken from the page.
- **When the sidebar is the 52 px rail:** the same notice is shown by the overlay layer with tight
  bounds, 320 wide, 12 px in from the bottom left of the stage (`.notice--float`, with
  `--shadow-menu`). It takes clicks only inside its own rectangle.
- **Geometry:** min height 36 (48 with a second line), radius 8, padding 0 4 0 8, gap 6. Glyph 14,
  text, optional action (28 high, underlined), close (20 px, target 32).
- **Type:** first line 12/600, one line, fade tail. Second line 12/400, one line, fade tail (a file
  name, a remedy).
- **Colour:** `--inverse` / `--on-inverse`; glyph, second line and close `--on-inverse-2`. A failure
  uses the warning glyph and the same colours.
- **Behaviour:** one at a time; a new one replaces the old one (cross-fade 160 ms). It leaves after
  6 s; it stays while the pointer is over it or it has keyboard focus. `role="status"`; it never
  takes focus. Esc does not close it (Esc belongs to the page or the open surface).
- **Use it only when the message has no home.** A page-level outcome goes in the capsule (2.2), an
  answer-level outcome goes under the answer (10.9), a connection state goes under the Space header
  (10.3). Homeless messages: a download finished while its popover is closed, 「「導入支援」に参加しました」
  after accepting an invite, an invite link that could not be read.

### 10.3 Sidebar additions

| Component | Geometry | Type | Colour |
| --- | --- | --- | --- |
| Connection line `.conn` | 28 high, radius 6, padding 0 8, 4 px under the Space header; glyph 14, text, time at the right | 12/600; time 12/400 tabular | `--space-frame-2`; text `--space-ink`; time `--space-ink-2` |
| Tab mark: site asks | The permission's glyph, 14, with a 6 px ink dot at its top right (1.5 px ring in `--pocket`) | | `--ink` |
| Tab mark: crashed | Warning glyph 14 | | `--ink-3` |
| Tab favicon: load error | Warning glyph 16 in the favicon slot; the title is the host | | `--ink-3` |
| Own avatar, settings open | The 28 px disc behind the avatar | | `--space-frame-3` |

The connection line shows `ConnectionState` (packages/client `realtime.ts`): nothing for `online`;
「接続しています…」 for `connecting`; 「再接続しています…」 with 「14:38から」 for `reconnecting`;
「オフラインです。」 for `offline`; 「もう一度サインインしてください。」 for `unauthorized` (the line is then a button
that opens sign-in). 「接続しました。」 shows for 4 s after a reconnect, then the line leaves (160 ms).
No pulse, no spinner.

### 10.4 Toolbar additions

| Component | Geometry | Type | Colour and states |
| --- | --- | --- | --- |
| Find field `.find` | 320 × 34 (`--w-find`, `--h-capsule`), radius 10, padding 0 3 0 12, between the capsule and the ask button. Search glyph 16, text, count, a 1 × 16 rule, three 28 px buttons (previous, next, close). | Text 13/400; count 11/600 tabular (`2/4`); no match: 「見つかりません」 12/400 | Rest: `--space-field`, 1 px `--space-line`. Focus: `--paper`, 1.5 px `--ink`. Previous and next are disabled (`--ink-off`) with no match. |
| Downloads button `.dl-btn` | An icon button 28 × 28 in the toolbar's action slot, left of the ask button. Shown while `Download[]` is not empty. While a download runs: the glyph moves up 2 px and a 2 px meter, 16 wide, sits under it. | | Glyph `--space-ink-2`; meter track `--space-line`, fill `--space-ink`; open: `--space-frame-3`, `--space-ink`. |
| Site permission mark `.url-perm` | 22 × 22, radius 4, at the left of the URL inside the capsule; the permission's glyph 14 and a 6 px ink dot while a request waits | | `--paper`, 1 px `--space-line`, `--ink` |

Why the find field is in the toolbar: a strip above the page would move a live page (a relayout),
and an overlay would cover page pixels and take clicks there. In the toolbar it costs neither. The
capsule gives up text in the order of section 4. Under 1100 px of window width the ask button
loses its label while find is open; under 960 px the find field replaces the capsule's state
cluster (the URL stays). (**inferred**, not rendered.)

### 10.5 Popovers and menus

All are in the overlay layer with bounds tight around the surface (`overlay.setOpen` with a
rectangle), so the page stays clickable around them. Opaque, `--shadow-menu`, radius 10, fade
90 ms, no scale. Esc closes and returns focus to the trigger. A click outside closes.

| Component | Geometry | Type | Colour |
| --- | --- | --- | --- |
| Permission popover `.pop.pop--perm` | 336 wide, padding 16 16 12; 6 px under the capsule, left edges aligned. Head: glyph tile 28 (radius 8, 1 px `--line-strong`) and two lines. Text. A fact row (34 high, radius 6). Foot: checkbox at the left, two small buttons at the right. | Origin 13/600; request 13/400; text 12/400 lh 1.7; fact label 12, value mono 11 | `--paper`; fact row `--paper-2` |
| List popover `.pop.pop--list` | 376 wide (`--w-pop-list`), padding 4 4 0; 6 px under its button, right edges aligned. Head 36 (title, a link). Rows 44 min (53 with a meter), radius 6, padding 0 4 0 8, gap 8: glyph 16, two lines, one 28 px action. Footer note: padding 8 12, top rule. | Title 13/600; name 13/400 fade tail; second line 12/400, hosts mono 11 | Row hover `--paper-2`; cancelled and interrupted rows `--ink-3`; footer `--paper-2`, `--ink-2` |
| Fact list in a popover `.pop-facts` | Rows of 92 + rest, padding 7 0, 1 px rules | 12/400 | Label `--ink-2`, value `--ink` |
| Menu, section label `.menu-sec` | 28 high, padding 0 8 | 12/600 +0.02em | `--ink-3` |
| Menu, two-line item `.menu-item--2` | 44 high, padding 0 8, gap 8: a 28 px seal or a 16 px glyph, name and byline, trailing check or 「leaves Tiger」 glyph 14 | Name 13/400 (600 when current); byline 12/400 | Hover `--paper-3`; check `--ink`; trailing glyph `--ink-3` |
| Menu footer `.menu-foot` | Padding 8 12, top rule, bottom corners 10 | 12/400 lh 1.45 | `--paper-2`, `--ink-2` |
| Space menu `.menu--space` | 300 wide, 4 px under the Space header, left edges aligned; single-line items keep their glyph in a 28 px column so every label starts at the same x as a Space name | | |
| Export menu `.menu--export` | 320 wide; 6 px under the answer's action row, aligned with the panel's content edge (16 px in) | | |
| Menu behind 「共有中」 | 260 wide, under the state button, right edges aligned: 共有した内容を見る (opens 21), 台帳で見る, a rule, 共有を解除… (only for the sharer or an owner; opens 11). When stale it starts with 新しい版を共有… | | |

Menus: Up and Down move, Return chooses, typing a character jumps to the first item that starts
with it, Esc closes. The first item is focused when a menu opens from the keyboard; none is
highlighted when it opens from a click.

### 10.6 Dialog additions

| Part | Geometry | Type | Colour |
| --- | --- | --- | --- |
| Identity head `.dialog-id` | Seal 40, gap 12, title and a byline | Title 15/600; byline 12/400 | The dialog carries `data-space` of the Space it is about, so the seal and the confirm button are in that Space's colour, whatever window it opens in. |
| Form `.dialog--form` | 560 wide. Fields 20 apart; name field flex and a 36 px seal field in one row, gap 16; nine swatches of 52 × 61 in one row. A note row with the miniature window (76 × 54). Footer: note at the left, buttons at the right. | Labels 12/600; inputs 15/400 | As first run (5.6) |
| Error `.dialog-error` | Padding 12, radius 8, a 2 px ink bar at the left, warning glyph | 13/400 lh 1.7 | `--paper-2`, `--ink` |

### 10.7 Space home sections

| Component | Geometry | Type | Colour |
| --- | --- | --- | --- |
| View tabs `.viewtabs` | In the 44 px bar, 16 apart, each as tall as the bar and at least 28 wide; count after the label | 13/400, current 13/600; count 11/400 tabular | `--ink-2`, current `--ink` with a 2 px `--ink` bar on the bar's bottom rule; count `--ink-3` |
| Bar rule | 1 × 16 between the tabs and what follows | | `--line-strong` |
| People table `.book.book--people` | The ledger table (5.6): header 30, rows 44. Columns flex / 112 / 112 / 164. First cell: avatar 28 (or a 16 px glyph), name and a second line. | Name 13/400; e-mail mono 11; 「あなた」 as a tag (18 high, radius 4, `--paper-3`, 12/400) | As the ledger |
| Log table `.book.book--log` | Columns 156 / 112 / flex. Third cell: glyph 16, the event in words, the target as second line. | 13/400; second line 12/400 | As the ledger |
| Sub heading `.home-h2` | 48 high, text on the bottom, padding 0 20 8 24 | 13/600; count 11/400 | |
| Roles `.roles` | Two columns, gap 24, padding 24 20 0 24; label with a 1 px rule under it; a dash list | Label 12/600; items 12/400 | Items `--ink-2` |
| Side column `.home-side` | 400 wide (`--w-thread`), padding 20 20 16, sections 16 apart. For メンバー it is the Space side of a sheet: `--space-wash`, entered across a 3 px `--space-accent` line. For 記録 it is `--paper-2` with a 1 px rule. | Labels 12/600; notes 12/400 | |
| Link box `.linkbox` | Padding 8 12, radius 8, 1 px `--line-strong`; the URL in mono 11, wrapped; one small button | | `--paper` |

### 10.8 The thread sheet (sharing a private thread)

The sheet of 2.6 with another left pane: instead of numbered Markdown, the thread as members will
see it, one block per question with its answers (`attachedQuestions()` in packages/client).

| Part | Geometry | Type | Colour |
| --- | --- | --- | --- |
| Sheet `.sheet.sheet--thread` | 980 wide, up to `100% − 48` high (753 at 1440 × 900), columns flex and 336 | | Right side: the Space side (2.6) |
| Block `.xchg` | Padding 6 4 12 12, 1 px rule under. Head 32: kind, time, then at the right the choice (10.1). Body: messages 6 apart, each a 20 px mark (avatar or 虎) and text; a sources line; a note. | Kind 12/600; time 12/400; question 13/400 lh 1.7; answer Mincho 15/500 lh 1.8; sources 12/400 with 16 px chips; note 12/400, its first sentence 12/600 | `--paper` |
| Block from an attached page `.xchg--attached` | The same, with a 2 px dashed `--ink` line down its left edge (8 px short of top and bottom), the dashed glyph before the kind, and a note that names the page and its size | | |
| Undecided `.is-undecided` | 「選んでください」 with a 6 px dot before an empty choice | 12/600 | Block `--paper-2`; choice box `--line-control` |
| Left out `.is-out` | The body collapses to one line: the question, 12/400, fade tail | | Kind, glyph and line `--ink-3` / `--ink-off` |

Rules: a plain block starts as 「共有する」. A block from an attached page starts with no choice and
the confirm button stays disabled until every such block has one (`ready`). Leaving a question
out leaves its answers out. The count in the sub line and the foot note follow every change.
Tab moves through the choices in order; Left and Right change one; ⌘↵ confirms when enabled.

### 10.9 Outcome block (where an answer went)

`.outcome`: under the action row of the answer, margin-top 8, padding 8 12, radius 8, `--paper-2`
with 1 px `--line`. Head: check glyph and a sentence, 13/600. Row (28): the file's glyph, its
title 13/400 with fade tail, one small button. Then a byline, 12/400, wrapping allowed. It stays
until the panel closes or another export starts (`ExportStatus`). A failure uses the halt block
of 5.4 in the same place, with the sentence from `export.google.*` and 「もう一度」.

### 10.10 Page messages (a page that is not there)

`.ntp.ntp--msg`: drawn by Tiger inside the page card when `Tab.loadError` is set or `Tab.crashed`
is true, with the page view hidden. Same layout as the private new tab (5.6): padding 96 0 0 112,
max width 720. Title 20/600; lede 13/400 with the host in 600; a list of two points, each a 16 px
glyph, a 13/600 line and a 12/400 line; buttons (30 high, `.btn--line`) 32 px under the list; the
engine's error name in mono 11, `--ink-3`, 24 px under the buttons.

### 10.11 Settings

| Part | Geometry | Type | Colour |
| --- | --- | --- | --- |
| Section list `.setnav` | 232 wide, padding 28 12 20 20, right rule. Title 20/600. Items 32 high, radius 6, padding 0 8. Version and server at the bottom, 12/400. | 13/400, current 13/600 | Current `--paper-3`; hover `--paper-2`; foot `--ink-3` |
| Body `.setbody` | Padding 30 40 0; sections up to 800 wide, 20 apart | | |
| Section heading `.set-h` | 28 high, 1 px `--line-strong` under | 12/600 +0.02em | `--ink-3` |
| Row `.set-row` | Grid 296 + rest, gap 24, min height 48, padding 8 0, 1 px `--line` under. Label and help at the left; the control at the left edge of the right column. `--top` aligns to the top. | Label 13/400; help 12/400 lh 1.45 | Help `--ink-2` |
| Host list `.hosts` | Up to 380 wide, radius 8, 1 px `--line-strong`; rows 32 with a 28 px remove button | Host mono 12 | |
| Account row `.acct` | Up to 380 wide: mark 28, two lines, a button at the right | | |

### 10.12 Item detail and new tab

| Part | Geometry | Type | Colour |
| --- | --- | --- | --- |
| Item detail `.itemd` | Columns flex and 336. Main padding 16 20 12 24: crumb (12), head (glyph 20, title 20/600, byline), caption (13/600 and a 12 px meta line), the Markdown box of 2.6, the 「送らないもの」 line. Side: `--paper-2`, 1 px rule, padding 20 20 16, sections 16 apart, footer at the bottom. | | The card has the closed ring: what is on it is what the Space holds. |
| Version row `.ver` | 28 high, radius 6, grid 40 / 84 / flex / auto, gap 6 | 12/400 tabular, current 12/600 | Current `--paper-3` with a 3 px `--ink` bar at the left; others `--ink-2` |
| New tab `.newtab` | Two columns, gap 64, padding 72 96 0. Column head 36 with a 1 px `--line-strong` rule: a 20 px mark, 13/600, a link at the right. Rows 44 with 1 px rules: 20 px glyph or favicon, title 13/400 fade tail, byline. A line of key caps 40 px under the lists. | | Left column carries the Space's seal; right column the laptop glyph. Favicons are full colour (neutral paper, rule 9). |

## 11. Screens of the second pass

For every screen: where it comes from in the code, what is on it, what each control does, its
states, the keyboard, and the copy. In the copy tables a key without a mark exists today in
`apps/browser/src/renderer/src/i18n/ja.ts` or `packages/client/src/i18n/ja.ts` with this text;
**†** is a new key; **‡** is an existing key whose text this design replaces. English is given for
every string. `{…}` are placeholders.

### 11.1 15a — a site asks for a permission

**Data:** engine event `permission.request` (`PermissionRequest`: `origin`, `permission`, `tabId`);
answer with `permission.respond { requestId, allow, remember }`. The UI shows the active tab's
oldest request; requests of other tabs wait and mark their tab rows (`waitingTabIds`).

**Layout:** the permission popover (10.5) under the capsule; the mark `.url-perm` at the left of
the URL; the tab row mark. The page stays live and clickable around the popover.

| Control | Does |
| --- | --- |
| 「許可」 (`.btn--sm.btn--ink`) | `respond(allow: true, remember: checkbox)` |
| 「許可しない」 (`.btn--sm.btn--line`) | `respond(allow: false, remember: checkbox)` |
| 「次回からも同じにする」 | Sets `remember`. Not shown for `screen-capture` (`canRemember` is false: it is asked every time). |
| The mark in the capsule | Reopens the popover if it was closed without an answer |

**States:** one popover at a time; after an answer the next waiting request of this tab opens.
Switching tab closes it without answering (the request stays queued). If the tab closes, the
request is dropped. There is no "in use" indicator and no way to list or revoke remembered
decisions: the engine has no command for either (section 14).

**Keyboard:** focus starts on 「許可しない」. Tab order: checkbox, 許可しない, 許可. Return activates the
focused button. Esc closes without answering.

| Key | 日本語 | English |
| --- | --- | --- |
| † `permission.request.microphone` | マイクの使用を求めています | wants to use your microphone |
| † `permission.request.camera` | カメラの使用を求めています | wants to use your camera |
| † `permission.request.camera-and-microphone` | カメラとマイクの使用を求めています | wants to use your camera and microphone |
| † `permission.request.notifications` | 通知の送信を求めています | wants to send you notifications |
| † `permission.request.geolocation` | 現在地の利用を求めています | wants to know your location |
| † `permission.request.clipboard-read` | クリップボードの読み取りを求めています | wants to read your clipboard |
| † `permission.request.screen-capture` | 画面の共有を求めています | wants to share your screen |
| † `permission.note.microphone` | 許可すると、このサイトがマイクの音声を受け取ります。Tiger とスペースには送られません。 | If you allow it, this site receives the sound from your microphone. Nothing is sent to Tiger or the Space. |
| † `permission.note.camera` | 許可すると、このサイトがカメラの映像を受け取ります。Tiger とスペースには送られません。 | If you allow it, this site receives the picture from your camera. Nothing is sent to Tiger or the Space. |
| † `permission.note.camera-and-microphone` | 許可すると、このサイトがカメラの映像とマイクの音声を受け取ります。Tiger とスペースには送られません。 | If you allow it, this site receives picture and sound. Nothing is sent to Tiger or the Space. |
| † `permission.note.notifications` | 許可すると、このサイトが通知を表示できます。 | If you allow it, this site can show notifications. |
| † `permission.note.geolocation` | 許可すると、このサイトがこのMacのおおよその現在地を受け取ります。 | If you allow it, this site receives the approximate location of this Mac. |
| † `permission.note.clipboard-read` | 許可すると、このサイトがコピーした内容を読めます。 | If you allow it, this site can read what you copied. |
| † `permission.note.screen-capture` | 許可すると、共有する画面やウインドウを選ぶ macOS の画面が開きます。毎回たずねます。 | If you allow it, macOS asks which screen or window to share. Tiger asks every time. |
| † `permission.site` | 求めているサイト | Requesting site |
| `permission.remember` | 次回からも同じにする | Remember for this site |
| `permission.deny` | 許可しない | Don't allow |
| `permission.allow` | 許可 | Allow |
| † `permission.waiting` | サイトが許可を求めています | A site is asking for permission |
| † `permission.dialog` (label of the popover) | サイトからの許可の求め | Permission request from a site |

The popover's accessible name is the sentence 「{origin} が{request}」 (`permission.ask` today).

### 11.2 15b — downloads

**Data:** `downloads.list`, event `downloads.changed` (`Download`: `filename`, `url`, `state`,
`receivedBytes`, `totalBytes`, `startedAt`, `savePath`). Commands: `downloads.cancel`,
`downloads.open`, `downloads.showInFolder`, `downloads.clear`. Shortcut `open-downloads` (⇧⌘J).

**Layout:** the downloads button (10.4) and the list popover (10.5), newest first.

| Row state | Second line | Action | Click on the row |
| --- | --- | --- | --- |
| `progressing` | 「ダウンロード中・4.2 / 18.6 MB・host」 and the meter | × cancel | nothing |
| `paused` | 「一時停止中・4.2 / 18.6 MB・host」, meter still | × cancel | nothing |
| `completed` | 「48 KB・14:22・host」 | folder: show in Finder | opens the file |
| `interrupted` | 「中断されました・11:44・host」, row in `--ink-3` | none | nothing |
| `cancelled` | 「キャンセルしました・昨日 19:05・host」, row in `--ink-3` | none | nothing |

Sizes: under 1 MB in KB without decimals, otherwise MB with one decimal. Times as bylines (2.5).
The host is the host of `Download.url`, mono 11. Glyph by file extension: `pdf` for .pdf, `grid`
for .csv .xlsx .numbers, `folder` for archives, `doc` otherwise. 「一覧を消去」 calls
`downloads.clear` (running downloads stay). Empty: one line, 「ダウンロードはありません。」, and the
button leaves the toolbar when the popover closes. When a download finishes while the popover is
closed, the notice of 10.2 appears (15d) with 「開く」.

**Keyboard:** ⇧⌘J opens and closes. Up and Down move through rows; Return opens a completed file;
⌘⌫ cancels a running one; Tab reaches the row's action and the footer link; Esc closes.

| Key | 日本語 | English |
| --- | --- | --- |
| `downloads.title` | ダウンロード | Downloads |
| `downloads.clear` | 一覧を消去 | Clear list |
| `downloads.state.progressing` | ダウンロード中 | Downloading |
| `downloads.state.paused` | 一時停止中 | Paused |
| `downloads.state.cancelled` | キャンセルしました | Cancelled |
| `downloads.state.interrupted` | 中断されました | Interrupted |
| † `downloads.progress` | {received} / {total} MB | {received} / {total} MB |
| † `downloads.cancelNamed` | {name} のダウンロードをキャンセル | Cancel download of {name} |
| † `downloads.showNamed` | {name} をフォルダに表示 | Show {name} in folder |
| `downloads.empty` | ダウンロードはありません。 | No downloads. |
| † `downloads.note` | ファイルは、このMacの「ダウンロード」フォルダに保存します。スペースには共有されません。 | Files are saved in the Downloads folder on this Mac. They are not shared with the Space. |
| † `downloads.button` | ダウンロード：{percent}% | Downloads: {percent}% |
| † `notice.downloaded` | ダウンロードしました | Downloaded |
| `downloads.open` | 開く | Open |
| `common.close` | 閉じる | Close |

### 11.3 15c — find in page

**Data:** `page.find { tabId, text, forward, findNext }`, `page.stopFind`, event
`page.findResult { matches, activeMatch }`. Shortcut `find` (⌘F). The highlights are painted by
the engine inside the page; Tiger does not style them.

**Layout:** the find field (10.4). Nothing else moves.

| Control | Does |
| --- | --- |
| The field | Every change of text starts a new search (`findNext: false`). Empty text stops the search. |
| ∧ / ∨ | Previous / next match (`findNext: true`) |
| × | Closes: `page.stopFind`, the highlights go, focus returns to the page |

**States:** empty (placeholder, no count); counting (`2/4`); no match (「見つかりません」, both arrows
disabled, the field keeps its ink line: no red). Switching tab closes it; the text is kept and
searched again when ⌘F is pressed in the new tab.

**Keyboard:** ⌘F opens, or focuses the field and selects its text when open. Return next,
⇧Return previous, ⌘G next, ⇧⌘G previous, Esc closes.

| Key | 日本語 | English |
| --- | --- | --- |
| `find.placeholder` | ページ内を検索 | Find in page |
| `find.count` | {active}/{total} | {active}/{total} |
| `find.none` | 見つかりません | No matches |
| `find.previous` | 前へ | Previous |
| `find.next` | 次へ | Next |
| `find.close` | 検索を閉じる | Close find |

### 11.4 15d — the notice

Specified in 10.2. On this screen: glyph `download`, 「ダウンロードしました」, the file name as second
line, 「開く」 (`downloads.open`), close. The downloads button is idle (no meter).

| Key | 日本語 | English |
| --- | --- | --- |
| † `notice.downloaded` | ダウンロードしました | Downloaded |
| † `notice.joined` | 「{space}」に参加しました | You joined “{space}” |
| † `notice.inviteUnreadable` | 招待リンクを読み取れません | This invite link can't be read |
| † `notice.inviteUnreadable.detail` | リンクを確かめてください。 | Check the link. |

### 11.5 16a — the Space menu

**Opens from:** the chevron in the Space header (or Down on the focused header). Space home itself
is the header's name, ⇧⌘H, or the menu's first action.

| Item | Does |
| --- | --- |
| A Space row (seal 28, name, `メンバー{n}人・共有{n}件・{role}`) | `spaces.select(id)`: the window becomes that Space (motion 6.4). The current one has a check. Spaces are in the order of the footer seals. |
| スペースホーム ⇧⌘H | Route `space-home`, section `items` |
| メンバーと招待 | Route `space-home`, section `members` (16b) |
| 名前・印・色を変える… | The create dialog (16a2) filled with the Space's values, title 「スペースの名前・印・色」, confirm 「保存」 (`updateSpace`). Owners only; for members the item is absent. |
| 新しいスペース… | The create dialog (16a2) |
| 招待リンクで参加… | A dialog with one field (「招待リンクを貼り付け」) and 「参加する」: `acceptInvite(link)`. A link that `parseInviteToken` cannot read shows the field error 「招待リンクを読み取れません。」 |
| 新しいプライベートウインドウ ⇧⌘N | `window.create { private: true }` |

More than seven Spaces: the Space list scrolls inside 7 rows (308 px); the actions stay.

| Key | 日本語 | English |
| --- | --- | --- |
| `spaces.title` | スペース | Spaces |
| `spaces.memberCount` | メンバー{count}人 | {count} members |
| `spaces.items` | 共有{count}件 | {count} shared |
| `members.owner` / `members.member` | オーナー / メンバー | Owner / Member |
| ‡ `command.spaceHome` | スペースホーム | Space home |
| † `spaceMenu.members` | メンバーと招待 | Members and invites |
| † `spaceMenu.edit` | 名前・印・色を変える… | Name, seal and colour… |
| † `spaceMenu.new` | 新しいスペース… | New Space… |
| † `spaceMenu.join` | 招待リンクで参加… | Join with an invite link… |
| `window.newPrivate` | 新しいプライベートウインドウ | New private window |
| `spaces.switch` (the chevron) | スペースを切り替える | Switch Space |
| † `sidebar.openHome` (the name) | スペースホームを開く | Open Space home |

### 11.6 16a2 — create a Space

**Data:** `createSpace { name, hue }`. The seal is not in the contract yet (section 14): until it
is, the seal is the first character of the name and the field is read-only.

**Layout:** the form dialog (10.6), 560 × 437, centred on the scrim. The dialog carries the hue
being chosen, so the seal field, the miniature and the confirm button change colour with the
swatch. The window behind does not change until the Space exists.

| Control | Does |
| --- | --- |
| 名前 | 1 to 80 characters. Focused on open. The seal follows the first character until the member edits the seal. |
| 印 | One character (any script). Mincho 700 on the Space's solid. |
| 色 | Nine swatches, radio group; the first free hue among the member's Spaces is preselected. Left and Right move. |
| スペースをつくる ↵ | `spaces.create(name, hue)`; on success the dialog closes and the window switches to the new Space (6.4). Disabled while the name is empty; 「つくっています…」 while the request runs. |
| キャンセル, Esc, click on the scrim | Closes; nothing is kept. |

Errors appear as a line under the footer note, 12/600 with the warning glyph, from `error.*`.

| Key | 日本語 | English |
| --- | --- | --- |
| `spaces.create` | 新しいスペース | New Space |
| † `spaces.createLede` | スペースは、プロジェクトごとの共有の場です。ここに入るのは、あなたやメンバーが共有したページだけです。 | A Space is the shared place of one project. Only pages that you or another member share go into it. |
| ‡ `spaces.name` | 名前 | Name |
| † `spaces.seal` | 印 | Seal |
| `spaces.color` | 色 | Colour |
| `hue.amber` … `hue.graphite` | 琥珀・柿・紅梅・藤・藍・空・浅葱・若竹・墨 | Amber, Persimmon, Plum blossom, Wisteria, Indigo, Sky, Asagi, Young bamboo, Ink |
| † `spaces.colorNote` | ウインドウのふちと、共有したページを囲む線がこの色になります。色はスペースだけを表します。 | The window frame and the line around shared pages take this colour. Colour only ever means a Space. |
| † `spaces.ownerNote` | あなたがオーナーになります。 | You will be the owner. |
| † `spaces.createConfirm` | スペースをつくる | Create Space |
| † `spaces.creating` | つくっています… | Creating… |
| `common.cancel` | キャンセル | Cancel |

### 11.7 16b — members and invites

**Data:** `getSpace` → `members: SpaceMember[]` (`user`, `role`, `joinedAt`), `pendingInvites:
Invite[]` (owners only: `email`, `createdBy`, `createdAt`, `expiresAt`). `createInvite { email? }`
returns the link once (`lastInvite.url`); `revokeInvite`; `removeMember`. Invites last 14 days and
work once. Roles are `owner` and `member`; a new member is a `member`.

**Layout:** Space home with the メンバー tab: the header (5.6) without the 「招待」 button, the
bar with the view tabs, the people table, 「招待中」 with its table, the roles, and at the right
the invite column (10.7). The card keeps the closed ring. The capsule reads 「資金調達 2027 / メンバー」
and 「メンバー4人に見えます」.

| Control | Does | Who |
| --- | --- | --- |
| Row action 「•••」, on hover 「スペースから外す…」 | The confirm dialog (component sheet: できなくなること / 残るもの), then `removeMember` | Owners, on other rows |
| On the member's own row: 「スペースを出る…」 | The same dialog in the first person, then `removeMember(self)` and the window moves to the next Space. Refused for the last owner with `error.last_owner`, shown as the dialog's error. | Everyone |
| メールアドレス（任意） | Optional. Validated as an address on confirm. | Owners |
| 招待リンクをつくる | `createInvite(email?)`. The link box appears with the link selected. | Owners |
| リンクをコピー | `clipboard.writeText(url)`; the button reads 「コピーしました」 for 2 s | Owners |
| 招待を取り消す | `revokeInvite` at once (it can be made again); the row leaves | Owners |

**As a member sees it:** the same page without the 「招待中」 table and with the invite column
replaced by one section: 「メンバーを招待できるのはオーナーです。」 and the two lists (参加した人が読めるもの,
読めないもの). The roles stay.

**The link is shown once.** The server keeps only its hash. Leaving the page drops the box;
「招待中」 keeps the row (「宛先なしのリンク」) so it can be revoked, but the link cannot be shown again.

**Changing a role** is not possible today (no route). When it is, the role cell becomes a menu
button (a `.model-btn` with 「オーナー」 / 「メンバー」), owners only.

| Key | 日本語 | English |
| --- | --- | --- |
| † `home.ledger` | 台帳 | Ledger |
| `home.members` | メンバー | Members |
| `home.activity` | 記録 | Activity |
| † `home.readers` | ここにあるものを読めるのは、{names}と、AIです。 | What is here can be read by {names}, and by the AI. |
| `pageState.members` | メンバー{count}人に見えます | Visible to {count} members |
| `members.title` | メンバー | Members |
| † `members.role` | 役割 | Role |
| † `members.joined` | 参加した日 | Joined |
| `members.owner` / `members.member` / `members.you` | オーナー / メンバー / あなた | Owner / Member / You |
| ‡ `members.remove` | スペースから外す… | Remove from Space… |
| † `members.leave` | スペースを出る… | Leave Space… |
| † `members.actions` | {name} の操作 | Actions for {name} |
| `invites.pending` | 招待中 | Pending |
| † `invites.to` / `invites.by` / `invites.until` | 宛先 / 招待した人 / 有効期限 | To / Invited by / Valid until |
| † `invites.emailOnly` | このアドレスでサインインした人だけが使えます | Only someone signed in with this address can use it |
| † `invites.noAddress` | 宛先なしのリンク | Link with no address |
| † `invites.createdAt` | {date} に作成 | Made {date} |
| † `invites.once` | 1人が1回だけ使えます | One person can use it, once |
| ‡ `invites.expires` | {date} まで | until {date} |
| `invites.revoke` | 招待を取り消す | Revoke invite |
| † `roles.ownerCan` | オーナーができること | What an owner can do |
| † `roles.owner.1…4` | メンバーを招待し、招待を取り消す／メンバーをスペースから外す／誰が共有したものでも、共有を解除する／スペースの名前・印・色を変える | Invite members and revoke invites / Remove members from the Space / Unshare anything, whoever shared it / Change the Space's name, seal and colour |
| † `roles.memberCan` | メンバーができること | What a member can do |
| † `roles.member.1…4` | ページを共有し、自分の共有を解除する／スペースに質問し、スレッドに投稿する／台帳と記録を読む／自分からスペースを出る | Share pages and unshare their own / Ask the Space and post in threads / Read the ledger and the activity / Leave the Space |
| † `invites.heading` | メンバーを招待 | Invite a member |
| `invites.email` | メールアドレス（任意） | Email (optional) |
| † `invites.emailNote` | 入れると、そのアドレスでサインインした人だけが使えます。空のままなら、リンクを受け取った人が使えます。 | With an address, only someone signed in with it can use the link. Without one, whoever receives the link can. |
| ‡ `invites.create` | 招待リンクをつくる | Create invite link |
| † `invites.justMade` | いまつくったリンク | The link you just made |
| `invites.copyLink` | リンクをコピー | Copy link |
| `export.copied` | コピーしました | Copied |
| ‡ `invites.linkOnce` | このリンクは一度だけ表示されます。1人が1回だけ使えます。{date} まで有効です。 | This link is shown only once. One person can use it, once. Valid until {date}. |
| † `invites.canRead` | 参加した人が読めるもの | What someone who joins can read |
| † `invites.canRead.1…3` | 共有{count}件。これまでに共有されたものも含みます。／スペースのスレッドのすべて。／メンバーの名前とメールアドレス。 | All {count} shared items, including everything shared before they joined. / Every thread of the Space. / Members' names and email addresses. |
| † `invites.cannotRead` | 読めないもの | What they cannot read |
| † `invites.cannotRead.1…2` | あなたやメンバーが開いているタブ。／それぞれの「あなただけ」のスレッドと、添付したページ。 | The tabs you or other members have open. / Each member's private threads, and the pages attached to them. |
| † `invites.ownersOnly` | メンバーを招待できるのはオーナーです。 | Only an owner can invite members. |
| † `members.removeTitle` | {name}をスペースから外しますか | Remove {name} from the Space? |
| † `members.removeLoses` | できなくなること：共有{count}件とスレッドを読むこと／このスペースに質問すること | They will no longer be able to: read the {count} shared items and the threads / ask this Space |
| † `members.removeKeeps` | 残るもの：{name}が共有した{n}件と、投稿／記録の「メンバーを外した」 | What stays: the {n} items {name} shared, and their posts / the activity entry “Removed a member” |

### 11.8 16c — accept an invite

**Data:** engine event `invite.open { token }` (the member opened an invite link, in Tiger or from
another app); `acceptInvite { token }` returns the `Space`. Errors: `invite_not_found`,
`invite_expired`, `invite_revoked`, `invite_used`, `invite_email_mismatch`.

**Layout:** a dialog (5.5 and 10.6), 560 × 339, on the scrim, over whatever the window shows. It
carries the invited Space's hue. Head: seal 40, 「「導入支援」に招待されています」, byline
`柏木 蓮が招待・メンバー3人・共有12件・12/9 まで有効`. Two columns (参加すると / 変わらないこと).
A note with the account that will join. Buttons.

**The head needs a preview the server does not give yet** (section 14). Until it does, the head
is the plain seal with the link glyph, the title 「スペースへの招待」 and no byline; everything else
is as drawn.

| Control | Does |
| --- | --- |
| 参加する ↵ | `acceptPendingInvite()`. While it runs: 「参加しています…」, both buttons disabled. On success the dialog closes, the window switches to the Space (6.4) and the notice 「「導入支援」に参加しました」 shows. |
| あとで, Esc, click on the scrim | `dismissPendingInvite()`. The invite stays valid until it expires; opening the link again reopens the dialog. |

**Errors:** the columns and the note are replaced by the error block (10.6) with the sentence
from `error.invite_*`; the title becomes 「この招待は使えません」; one button, 「閉じる」 (component
sheet). `invite_email_mismatch` adds 「サインアウト」 as a second button. Signed out: the dialog
opens after sign-in (20a), which shows 「サインインすると、招待を開きます。」 above its button.

| Key | 日本語 | English |
| --- | --- | --- |
| † `invite.title` | 「{space}」に招待されています | You are invited to “{space}” |
| † `invite.by` | {name}が招待 | Invited by {name} |
| † `invite.ifJoin` | 参加すると | If you join |
| † `invite.ifJoin.1` | メンバーが共有したページと、スペースのスレッドを読めます。これまでの分も含みます。 | You can read the pages members shared and the Space's threads, including everything from before. |
| † `invite.ifJoin.2` | メンバーに、あなたの名前、メールアドレス、写真が見えます。 | Members see your name, email address and photo. |
| † `invite.unchanged` | 変わらないこと | What does not change |
| † `invite.unchanged.1` | このMacで開いているタブは、誰にも伝わりません。 | Nobody learns which tabs are open on this Mac. |
| † `invite.unchanged.2` | 共有するまで、ページの内容はこのMacから出ません。 | No page content leaves this Mac until you share it. |
| † `invite.unchanged.3` | いつでも自分からスペースを出られます。 | You can leave the Space at any time. |
| † `invite.as` | {email} として参加します。 | You will join as {email}. |
| `invite.dismiss` | あとで | Not now |
| `invite.accept` | 参加する | Join |
| † `invite.joining` | 参加しています… | Joining… |
| `invite.offerTitle` (no preview) | スペースへの招待 | Space invite |
| † `invite.unusable` | この招待は使えません | This invite can't be used |
| `error.invite_expired` etc. | (as in packages/client) | (as in packages/client) |
| † `invite.afterSignIn` | サインインすると、招待を開きます。 | Sign in to open the invite. |

### 11.9 16d — activity (記録)

**Data:** `listAudit` (`AuditEvent`: `actor`, `action`, `target.title`, `at`), `getUsage`
(`SpaceUsage`). Every member can read both. The log is read-only; newest first; 200 at a time,
then 「さらに表示」 as a row.

| `AuditAction` | Glyph | 日本語 | English |
| --- | --- | --- | --- |
| `space.created` | `plus` | スペースを作成 | Created the Space |
| `member.invited` | `invite` | メンバーを招待 | Invited a member |
| `member.joined` | `person` | スペースに参加 | Joined the Space |
| `member.removed` | `leave` | メンバーを外した | Removed a member |
| `item.shared` | `cross` | ページを共有 | Shared a page |
| `item.reshared` | `cross` | 新しい版を共有 | Shared a new version |
| `item.unshared` | `uncross` | 共有を解除 | Unshared a page |
| `thread.shared` | `thread` | スレッドをスペースに共有 | Shared a thread with the Space |
| `export.google_doc` | `exportOut` | 回答を Google ドキュメントに書き出し | Exported an answer to Google Docs |

The second line of the event cell is `target.title` when there is one. A row whose target still
exists is a link (an item opens 21, a thread opens in the home thread column); a row of an
unshared item is text.

Side column: the month's usage as the meter of 5.4 (`(inputTokens + outputTokens) /
budgetTokens`), two fact rows, one note; with `budgetTokens: null`, 「上限なし」 and no meter. The
budget cannot be changed in the app today (no route).

| Key | 日本語 | English |
| --- | --- | --- |
| † `activity.note` | 共有、解除、参加、書き出しを、起きた順に残します。消せません。 | Shares, unshares, joins and exports, in the order they happened. They cannot be deleted. |
| † `activity.when` / `activity.who` / `activity.what` | 日時 / 人 / できごと | When / Who / Event |
| † `activity.usageTitle` | {month}月のAI利用 | AI usage in {month} |
| † `activity.used` | 使った量 | Used |
| `activity.tokens` | {used} / {budget} トークン | {used} / {budget} tokens |
| † `activity.split` | 内訳：入力 {input}・出力 {output} | Input {input}, output {output} |
| `activity.unlimited` | 上限なし | No limit |
| † `activity.limitNote` | 上限に達すると、月が替わるまでこのスペースでは質問できません。共有と閲覧は続けられます。 | At the limit, this Space cannot ask until the month changes. Sharing and reading go on. |
| † `activity.kept` | 記録に残るもの | What the record keeps |
| † `activity.kept.1…3` | 誰が、いつ、何をしたか。／共有を解除したページの題名とURL。本文は残りません。／招待した相手のメールアドレスは、オーナーにだけ見えます。 | Who did what, and when. / The title and URL of an unshared page; its text is not kept. / The address of someone invited is visible to owners only. |

### 11.10 17, 17b — share a private thread with the Space

**Data:** `client.shareThread` (packages/client `stores/share-thread.ts`): `begin(threadId)` →
`deciding { messages, questions: AttachedQuestion[], excluded, ready }`; `decide(questionId,
"include" | "exclude")`; `setExcluded(messageId, bool)`; `preview()`; `confirm()` →
`shareThread { includeAttachedMessageIds, excludeMessageIds }`. The server copies the chosen
messages into a new Space thread. Attachments are not copied: neither the page nor the record
that a page was attached. The private thread stays as it is.

**Opens from:** 「スペースに共有…」 in the panel's visibility line; the palette command. Never from
a Space thread (`shareThread.notPrivate`).

**Layout:** the thread sheet (10.8) over the stage, panel included. Left: 「スペースのメンバーに見せる内容」,
a sub line with the counts, the blocks. Right, the Space side: 共有先 (static: the thread's own
Space, 「新しいスレッドとして・メンバー4人」), 読める人と送り先 (each member; the provider
companies with a key, 「@Tiger に質問されたとき」), 共有されないもの, 共有したあと, then the foot note
and the buttons.

| Control | Does |
| --- | --- |
| Choice on a plain block | 「共有する」 (default) / 「含めない」: `setExcluded(questionId, …)`; the answers follow the question |
| Choice on a block from an attached page | No default. `decide(questionId, "include" | "exclude")` |
| スレッドを共有 ⌘↵ | `confirm()`. Disabled until `ready`; the foot note says how many blocks still need a choice. |
| キャンセル, Esc | `cancel()`. A click on the scrim does not close this sheet (choices would be lost); it does nothing. |

**States:** `loading`: the left pane shows 「スレッドを読み込んでいます…」, the right side is drawn, the
confirm button is disabled. `deciding`: as drawn (17: one block undecided; 17b: ready). All left
out: the foot note reads `shareThread.nothingToShare` and the button is disabled. `sending`:
「共有しています…」, nothing can be changed. `done`: the sheet closes; in the private thread a share
event row (5.6, Space wash, crossing glyph) reads 「このスレッドの6件を、新しいスレッドとしてスペースに共有」
with the time and 「開く」; the sidebar's Space header is unchanged. `error`: the foot note becomes
the sentence from `error.*` in 12/600 with the warning glyph; the choices are kept.
`thread_has_private_attachments` (a page was attached in another window meanwhile): the sheet
reloads the thread and keeps the choices already made.

**What members see** is exactly the left pane without the heads and notes: question, answer with
its citation chips, sources. A 「添付」 chip in an answer stays a chip without a target.

| Key | 日本語 | English |
| --- | --- | --- |
| `shareThread.title` (name of the sheet) | スレッドをスペースに共有 | Share thread with the Space |
| † `shareThread.heading` | スペースのメンバーに見せる内容 | What members of the Space will see |
| † `shareThread.summary` | あなただけのスレッドの{total}件から・{count}件を共有 | From the {total} messages of your private thread: sharing {count} |
| † `shareThread.summary.undecided` | {n}件は未選択 | {n} not decided |
| † `shareThread.summary.out` | {n}件は含めない | {n} left out |
| † `shareThread.plain` | 質問と回答 | Question and answer |
| `shareThread.attachedQuestion` | ページを添付した質問 | Question with an attached page |
| `shareThread.include` | 共有する | Share |
| `shareThread.exclude` | 含めない | Leave out |
| † `shareThread.choose` | 選んでください | Choose |
| `ask.sources` | 出典 | Sources |
| † `shareThread.attached` | 「{title}」{chars}文字を添付。 | “{title}” attached, {chars} characters. |
| ‡ `shareThread.decide` | 回答と一緒に共有するか、両方とも除外するかを選んでください。ページ自体は共有されません。 | Choose whether to share this question with its answer, or leave both out. The page itself is not shared. |
| † `shareThread.quoted` | 回答が引用した部分は、回答の中に残ります。ページ自体は共有されません。 | What the answer quoted stays inside the answer. The page itself is not shared. |
| † `shareThread.outLine` | 「{title}」を添付・{question} | “{title}” attached · {question} |
| `share.target` | 共有先 | Share to |
| † `shareThread.asNew` | 新しいスレッドとして | As a new thread |
| † `share.readers` | 読める人と送り先 | Who can read it, and where it goes |
| † `shareThread.whenAsked` | @Tiger に質問されたとき | When someone asks @Tiger |
| † `shareThread.notShared` | 共有されないもの | What is not shared |
| † `shareThread.notShared.1…2` | 添付したページそのもの。回答が引用した部分は、回答の中に残ります。／「含めない」にした質問と回答。 | The attached pages themselves. What an answer quoted stays inside the answer. / The questions and answers you left out. |
| † `shareThread.after` | 共有したあと | After sharing |
| † `shareThread.after.1…3` | 新しいスレッドとしてスペースに入ります。あなただけのスレッドは、そのまま残ります。／取り消すには、スペースのスレッドを削除します。／記録に「スレッドを共有」が残ります。 | It enters the Space as a new thread. Your private thread stays as it is. / To take it back, delete the Space thread. / The activity keeps “Shared a thread”. |
| † `shareThread.ready` | 左に表示している{count}件を、そのまま共有します。 | The {count} messages shown at the left are shared as they are. |
| † `shareThread.blocked` | ページを添付した質問が、あと{n}組選ばれていません。 | {n} questions with an attached page still need a choice. |
| ‡ `shareThread.confirm` | スレッドを共有 | Share thread |
| `shareThread.cancel` | キャンセル | Cancel |
| `shareThread.loading` / `shareThread.sending` | スレッドを読み込んでいます… / 共有しています… | Loading the thread… / Sharing… |
| `shareThread.nothingToShare` | すべて除外されているため、共有する内容がありません。 | Everything is left out, so there is nothing to share. |
| † `shareThread.event` | このスレッドの{count}件を、新しいスレッドとしてスペースに共有 | Shared {count} messages of this thread with the Space as a new thread |

### 11.11 18a, 18b, 18c — export

**Data:** `client.exports` (packages/client `export.ts`): `googleDoc({ spaceId, title, markdown,
messageId })`, `saveFile`, `copyMarkdown`; `answerToMarkdown` adds the numbered sources.
`GoogleConnection { connected, email, configured }`; `google.connect` runs the consent in the
system browser (scope `drive.file`), `google.cancel` stops waiting. The server records a Google
export in the audit log (`export.google_doc`).

**18a, the menu** (10.5), from 「書き出す ▾」 under an answer in the panel or in a Space thread:

| Item | Second line | Does |
| --- | --- | --- |
| Google ドキュメント (trailing 「leaves Tiger」 glyph) | connected: 「{email} のドライブに作ります」; not connected: 「Google アカウントへの接続が必要です」; `configured: false`: 「Google ドキュメントへの書き出しは設定されていません。」 and the item is disabled | Connected: `toGoogleDoc({ title, message })`, title = the question, at most 300 characters. Not connected: opens 18b. |
| Markdown をコピー | 出典の一覧つきで、クリップボードへ | `copy(message)` |
| ファイルに保存… | Markdown（.md）。保存先を選びます | `toFile(...)`: the system save dialog, suggested name from the question |

The footer says what leaves and what is recorded. While an export runs the button reads
「書き出しています…」 and is disabled.

**18b, not connected:** a popover (336 wide) in the same place. Title, two sentences, three facts
(できること / できないこと / 接続の保存先), 「キャンセル」 and 「ブラウザで接続する」 (`connectGoogle()`).
Then the same popover waits: 「ブラウザで続けてください」, the sentence, a still dot with
「Google の応答を待っています…」, and 「待つのをやめる」 (`cancelGoogle()`) (component sheet). On success
the export starts at once and the popover closes. On failure the popover returns to its first
state with the sentence from `google.flow.*` above the buttons, 12/600 with the warning glyph.

**18c, done:** the outcome block (10.9). Google: 「Google ドキュメントに書き出しました」, the document
title, 「開く」 (opens the URL in a new tab of this Space: that tab is 「このMacのみ」 until it is
shared), byline `{email} のドライブ・今日 14:41・スペースの記録に残りました`. If the record failed
(`recordError`): the last part reads 「記録を残せませんでした」. Copy: 「コピーしました」, byline
`Markdown・出典の一覧つき`. File: 「保存しました」, the file name, 「フォルダに表示」. Cancelled save
dialog: no block.

**Keyboard:** the menu as every menu (10.5). In 18b, focus starts on 「ブラウザで接続する」.

| Key | 日本語 | English |
| --- | --- | --- |
| † `answer.post` | スレッドに投稿 | Post to thread |
| `export.title` | 書き出す | Export |
| ‡ `export.googleDoc` | Google ドキュメント | Google Docs |
| † `export.googleSub` | {email} のドライブに作ります | Creates it in the Drive of {email} |
| † `export.googleNeeds` | Google アカウントへの接続が必要です | Needs a connection to your Google account |
| `export.google.not-configured` | Google ドキュメントへの書き出しは設定されていません。 | Export to Google Docs is not set up. |
| `export.copy` | Markdown をコピー | Copy as Markdown |
| † `export.copySub` | 出典の一覧つきで、クリップボードへ | With the list of sources, to the clipboard |
| ‡ `export.saveFile` | ファイルに保存… | Save as file… |
| † `export.saveSub` | Markdown（.md）。保存先を選びます | Markdown (.md). You choose where. |
| † `export.foot` | 書き出すのは、この回答と出典の一覧です。Google ドキュメントへの書き出しは、スペースの記録に残ります。 | What is exported is this answer and its list of sources. An export to Google Docs is kept in the Space's activity. |
| `export.working` | 書き出しています… | Exporting… |
| † `google.connectTitle` | Google ドライブに接続します | Connect to Google Drive |
| † `google.connectBody` | Google ドキュメントへの書き出しには、あなたの Google アカウントへの接続が必要です。Google の画面は、いつものブラウザで開きます。 | Exporting to Google Docs needs a connection to your Google account. Google's page opens in your usual browser. |
| † `google.can` / `google.can.value` | できること / Tiger が作ったファイルの作成と更新 | Tiger can / create and update the files Tiger made |
| † `google.cannot` / `google.cannot.value` | できないこと / ドライブのほかのファイルを見ること | Tiger cannot / see any other file in your Drive |
| † `google.stored` / `google.stored.value` | 接続の保存先 / このMacのキーチェーン。サーバーには送りません | Kept in / the keychain of this Mac. Not sent to the server. |
| † `google.connectGo` | ブラウザで接続する | Connect in browser |
| † `google.waitTitle` | ブラウザで続けてください | Continue in your browser |
| † `google.waitBody` | Google の画面を、いつものブラウザで開きました。許可すると、ここに戻って書き出します。 | Google's page is open in your usual browser. When you allow it, Tiger comes back here and exports. |
| † `google.waiting` | Google の応答を待っています… | Waiting for Google… |
| † `google.stopWaiting` | 待つのをやめる | Stop waiting |
| `google.flow.denied` etc. | (as in packages/client) | (as in packages/client) |
| `export.done` | Google ドキュメントに書き出しました | Exported to Google Docs |
| `export.openDoc` | 開く | Open |
| † `export.where` | {email} のドライブ | Drive of {email} |
| † `export.recorded` | スペースの記録に残りました | Kept in the Space's activity |
| ‡ `export.recordFailed` | 記録を残せませんでした | The activity entry could not be saved |
| `export.copied` / `export.saved` | コピーしました / 保存しました | Copied / Saved |
| `downloads.showInFolder` | フォルダに表示 | Show in folder |

### 11.12 19 — settings

**Data:** `settings.get` / `settings.update` (`Settings`: `locale`, `theme`, `searchEngine`,
`userBlockedHosts`, `defaultModel`, `serverUrl`), `AppInfo`, `GoogleConnection`, the session's
`User`. A surface (route `settings`): it replaces the page card, the page view is hidden, no tab
is active, the member's own avatar in the footer is pressed. Opens with ⌘, or the avatar; ⌘, again,
Esc or Back returns to the page. The capsule reads 「Tiger / 設定」 and has no state cluster.

**Layout** (10.11): the section list at the left (一般, プライバシー, モデル, アカウント; the
current one follows the scroll position, a click scrolls to the section), the body at the right.
Every change is saved at once; there is no save button and no message.

| Row | Control | Does |
| --- | --- | --- |
| 言語 | Choice: 日本語 / English | `settings.update({ locale })`; signed in, `updateMe({ locale })` follows |
| テーマ | Choice: システムに合わせる / ライト / ダーク | `settings.update({ theme })`; the window re-tints in 280 ms |
| 検索エンジン | Choice: Google / DuckDuckGo / Bing | `settings.update({ searchEngine })` |
| 共有しないサイト | The host list with a remove button per row; a field and 「追加」 | `addBlockedHost(input)` after `normalizeHost` (a URL or `Example.com.` becomes `example.com`). Not a host: the field error (10.1). Already there: nothing happens. Return adds. Remove asks nothing. |
| はじめから共有できないページ | Text, and 「保護リストを見る」 | Opens a popover (336 wide) listing the categories with their host counts from `packages/shared/src/classify.ts`; read-only |
| 既定のモデル | A picker (48 high, up to 380 wide): the company glyph tile, the model, `提供元・tier` | Opens the model menu of 12 with one more first row, 「サーバーの既定に戻す」; choosing sets `defaultModel` (`null` for the server's). Unavailable providers stay disabled. |
| Tiger | Avatar, name, e-mail (mono 11), 「サインアウト」 | `signOut()`, then 20a. Signed out: 「サインインしていません」 and 「サインイン」. |
| Google ドライブ | Glyph tile, 「接続中」 and the address, 「接続を解除」 | `disconnectGoogle()`. Not connected: 「接続していません」 and 「Google ドライブに接続」 (the popover of 18b). `configured: false`: the row reads 「この Tiger では設定されていません。」 with no button. |

Not in settings on purpose: saved passwords, autofill, passkeys (the engine has none), and site
permissions (the engine cannot list or revoke them, section 14).

**Keyboard:** Tab moves through the controls in reading order; arrows inside a choice; ⌘, toggles.

| Key | 日本語 | English |
| --- | --- | --- |
| `settings.title` | 設定 | Settings |
| `settings.general` / `settings.privacy` / `settings.models` / `settings.account` | 一般 / プライバシー / モデル / アカウント | General / Privacy / Models / Account |
| `settings.language`, `language.ja`, `language.en` | 言語、日本語、English | Language, 日本語, English |
| `settings.theme`, `theme.system`, `theme.light`, `theme.dark` | テーマ、システムに合わせる、ライト、ダーク | Theme, Match system, Light, Dark |
| `settings.searchEngine` | 検索エンジン | Search engine |
| † `settings.searchNote` | アドレス欄に入れた言葉は、ここで選んだ検索エンジンに送られます。 | What you type in the address field is sent to the search engine chosen here. |
| `settings.blockedHosts` | 共有しないサイト | Sites never shared |
| ‡ `settings.blockedHostsNote` | ここに加えたサイトのページは、共有も添付もできなくなります。サブドメインも含みます。 | Pages of the sites listed here can be neither shared nor attached. Subdomains are included. |
| `settings.blockedHostsAdd` | 追加 | Add |
| † `settings.blockedHostsRemoveNamed` | {host} を削除 | Remove {host} |
| † `settings.hostInvalid` | サイトのアドレスではありません。example.com の形で入力してください。 | That is not a site address. Enter it like example.com. |
| † `settings.builtin` | はじめから共有できないページ | Pages that can never be shared |
| † `settings.builtinNote` | この一覧は変えられません。画面の上だけでなく、Tiger の本体で止めています。 | This list cannot be changed. It is enforced in Tiger itself, not only on screen. |
| † `settings.builtinList` | 金融サービス、メール、パスワード管理、ログインやアカウント、行政手続き、社内やローカルのアドレス、プライベートウインドウ。 | Financial services, email, password managers, sign-in and account pages, government procedures, internal and local addresses, private windows. |
| † `settings.builtinLink` | 保護リストを見る | See the protected list |
| † `settings.defaultModel` | 既定のモデル | Default model |
| † `settings.defaultModelNote` | 質問ごとに変えられます。質問と、関係する共有の部分は、選んだモデルの提供元に送られます。 | You can change it for each question. The question and the relevant parts of what is shared are sent to the provider of the model you choose. |
| ‡ `models.tier.best` / `balanced` / `fast` | 最高性能 / バランス / 高速 | Best / Balanced / Fast |
| ‡ `models.serverDefault` | サーバーの既定に戻す | Use the server default |
| `signIn.signOut` | サインアウト | Sign out |
| † `settings.googleDrive` | Google ドライブ | Google Drive |
| † `settings.googleNote` | 書き出しにだけ使います。Tiger が作ったファイルだけを扱えます。 | Used for exports only. Tiger can handle only the files it made. |
| † `settings.connected` / `settings.notConnected` | 接続中 / 接続していません | Connected / Not connected |
| `export.disconnectGoogle` / `export.connectGoogle` | 接続を解除 / Google ドライブに接続 | Disconnect / Connect Google Drive |
| ‡ `settings.version` | Tiger {version} | Tiger {version} |

### 11.13 20a — sign in

**Data:** session `status`: `signedOut`, `signingIn`, `offline`, `booting`; `signInWithGoogle()`
(`auth.googleSignIn`: the consent runs in the system browser and returns an ID token). Route
`sign-in`; also shown instead of Space home or an item when there is no session.

**Layout:** the window has no Space, so `data-space="none"`: a neutral frame. Sidebar: a plain
seal with the person glyph, 「サインインしていません」, 「スペースは使えません」; the pocket with this
Mac's tabs; in the footer one line, 「タブはこのMacにだけあります」. The card is the two-column
layout of first run (5.6): at the left the step line (step one in 600), title 20/600, one
sentence, the button (10.1, large, ink, with the 「leaves Tiger」 glyph), a help line, then under
a rule 「サインインせずに使う」 with its help line. At the right, on `--paper-2`, what reaches Tiger
and what does not, and one line on what this version cannot do.

| Control | Does |
| --- | --- |
| Google でサインイン | `signInWithGoogle()`. The button is replaced by a row: a still dot, 「ブラウザで続けてください…」, and 「待つのをやめる」 (`google.cancel`). |
| サインインせずに使う | Route `page`. The browser works as a plain browser: no shelf, no ask button, no share action; the capsule's state reads 「このMacのみ」 with the note 「サインインすると共有できます」. |

**States:** failure: the halt block of 5.4 under the button, with the sentence from
`google.flow.*` or `error.*` (`error.google_auth_unavailable`, `signIn.offline`) and 「もう一度」.
`booting`: the card is empty except for the title; no spinner.

| Key | 日本語 | English |
| --- | --- | --- |
| † `setup.steps` | Google でサインイン・スペースをつくる・メンバーを招待 | Sign in with Google · Create a Space · Invite members |
| ‡ `signIn.title` | Tiger にサインイン | Sign in to Tiger |
| ‡ `signIn.note` | サインインすると、スペースをつくり、メンバーが共有したページをもとに質問できます。 | Signed in, you can create Spaces and ask questions answered from the pages members shared. |
| `signIn.google` | Google でサインイン | Sign in with Google |
| † `signIn.browserNote` | Google の画面は、いつものブラウザで開きます。終わると、ここに戻ります。 | Google's page opens in your usual browser. When you are done, you come back here. |
| † `signIn.waiting` | ブラウザで続けてください… | Continue in your browser… |
| `firstRun.skip` | サインインせずに使う | Use without signing in |
| † `signIn.skipNote` | ふつうのブラウザとして使えます。共有と質問は使えません。 | It works as an ordinary browser. Sharing and asking are not available. |
| † `signIn.receives` | サインインで Tiger に届くもの、届かないもの | What reaches Tiger when you sign in, and what does not |
| † `signIn.receives.1` | 名前、メールアドレス、プロフィール写真／参加したスペースのメンバーに見えます。 | Your name, email address and profile photo / Members of the Spaces you join can see them. |
| † `signIn.receives.2` | Google のパスワードは受け取りません／サインインは Google の画面で行い、Tiger には結果だけが届きます。 | Tiger never receives your Google password / You sign in on Google's page; Tiger only gets the result. |
| † `signIn.receives.3` | ドライブやメールの中身は見ません／Google ドキュメントへの書き出しは、はじめて使うときに、別に確かめます。 | Tiger does not look into your Drive or mail / Exporting to Google Docs asks separately, the first time you use it. |
| † `signIn.receives.4` | 開いているページは、このMacに残ります／共有するか、質問に添付するまで、ページの内容は送りません。 | The pages you open stay on this Mac / No page content is sent until you share it or attach it to a question. |
| † `signIn.noAutofill` | サイトのパスワードの自動入力とパスキーには、まだ対応していません。 | Password autofill for sites and passkeys are not supported yet. |
| † `sidebar.signedOut` / `sidebar.noSpaces` | サインインしていません / スペースは使えません | Not signed in / Spaces are not available |
| † `sidebar.tabsLocal` | タブはこのMacにだけあります | Tabs exist only on this Mac |
| † `pageState.signInToShare` | サインインすると共有できます | Sign in to share |

### 11.14 20b — offline and reconnecting

**Data:** `ConnectionState` (the realtime socket) and the session's `offline`. The browser itself
keeps working: pages load from the internet as long as this Mac is online; what stops is
everything that needs Tiger's server.

| Place | While not `online` |
| --- | --- |
| Under the Space header | The connection line (10.3) |
| Shelf, tab marks, capsule | Stay as last known from the local index. Nothing is greyed: what was true at 14:38 is shown, and the line above says since when. |
| Capsule actions (スペースに共有…, 新しい版を共有…) | Disabled (`--paper-3`, `--ink-off`); the tooltip reads the panel sentence below |
| Ask panel | A second note line above the visibility line, on `--mark`; the composer is disabled with 「つながると、質問できます」 |
| A question sent just before | A halt block (5.4) in place of the answer: 「送れませんでした」, `error.network`, 「もう一度送る」, 「質問をコピー」, and under it 「この質問は、どのモデルの提供元にも送られていません。」 |
| Space home | The ledger and threads from the cache; posting is disabled the same way |

Reconnecting is automatic; there is no retry button in the sidebar. On `online`: 「接続しました。」
for 4 s, the notes go, a question waiting behind 「もう一度送る」 is not resent on its own.

| Key | 日本語 | English |
| --- | --- | --- |
| `connection.connecting` | 接続しています… | Connecting… |
| `connection.reconnecting` | 再接続しています… | Reconnecting… |
| `connection.offline` | オフラインです。 | You are offline. |
| `connection.online` | 接続しました。 | Connected. |
| `connection.unauthorized` | もう一度サインインしてください。 | Please sign in again. |
| † `connection.since` | {time}から | since {time} |
| † `connection.panel` | サーバーに接続できません。共有と質問は、つながるまで使えません。 | The server cannot be reached. Sharing and asking are unavailable until it can. |
| † `ask.sendFailed` | 送れませんでした | Not sent |
| `error.network` | サーバーに接続できません。ネットワークを確認してください。 | The server cannot be reached. Check your network. |
| † `ask.resend` | もう一度送る | Send again |
| † `ask.copyQuestion` | 質問をコピー | Copy question |
| † `ask.notSent` | この質問は、どのモデルの提供元にも送られていません。 | This question was not sent to any model provider. |
| † `ask.offlinePlaceholder` | つながると、質問できます | You can ask once connected |

### 11.15 20c — a page that did not load

**Data:** `Tab.loadError { code, description }` (Chromium net errors). Tiger draws the page
message (10.10) in the page card. Tab row: warning glyph for the favicon, the host as title.
Capsule: the URL that was asked for, 「このMacのみ」 with the note 「ページがありません」, no share action.

| Error family (`code`) | Lede | Points |
| --- | --- | --- |
| Name not resolved (−105, −137) | 「{host} のサーバーが見つかりませんでした。」 | アドレスを確かめる; ネットワークを確かめる |
| Offline (−106) | 「このMacはインターネットにつながっていません。」 | ネットワークを確かめる |
| Timed out (−7, −118) | 「{host} からの応答に時間がかかりすぎました。」 | ネットワークを確かめる; 少し待つ |
| Refused, reset, closed (−100 to −102) | 「{host} に接続できませんでした。」 | ネットワークを確かめる; 少し待つ |
| Certificate (−200 to −218) | 「{host} との通信を保護できません。証明書に問題があります。」 | No way round it is offered in this version; only 「戻る」 and 「再読み込み」 |
| Anything else | 「{host} を開けませんでした。」 | ネットワークを確かめる |

Buttons: 「再読み込み ⌘R」 (`tabs.reload`); 「「{host}」を {engine} で検索」 (`tabs.navigate` with the
host as search text; not shown for certificate errors and offline). The last line is
`description` and `code`, e.g. `ERR_NAME_NOT_RESOLVED (-105)`. Focus starts on 「再読み込み」.

| Key | 日本語 | English |
| --- | --- | --- |
| † `loadError.title` | このページを開けません | This page can't be opened |
| † `loadError.dns` | {host} のサーバーが見つかりませんでした。 | The server of {host} could not be found. |
| † `loadError.offline` | このMacはインターネットにつながっていません。 | This Mac is not connected to the internet. |
| † `loadError.timeout` | {host} からの応答に時間がかかりすぎました。 | {host} took too long to respond. |
| † `loadError.refused` | {host} に接続できませんでした。 | Could not connect to {host}. |
| † `loadError.certificate` | {host} との通信を保護できません。証明書に問題があります。 | The connection to {host} cannot be made secure. There is a problem with its certificate. |
| † `loadError.other` | {host} を開けませんでした。 | {host} could not be opened. |
| † `loadError.checkAddress` | アドレスを確かめる／入力したアドレスに誤りがないか、確かめてください。 | Check the address / Make sure the address you entered has no mistake. |
| † `loadError.checkNetwork` | ネットワークを確かめる／ほかのページが開けるか、確かめてください。開けない場合は、このMacの接続に原因があります。 | Check the network / See whether other pages open. If they do not, the cause is this Mac's connection. |
| † `loadError.wait` | 少し待つ／サイトの側の問題かもしれません。しばらくしてから、再読み込みしてください。 | Wait a little / The problem may be on the site's side. Reload after a while. |
| `nav.reload` | 再読み込み | Reload |
| † `loadError.search` | 「{host}」を {engine} で検索 | Search {engine} for “{host}” |
| † `pageState.noPage` | ページがありません | No page |

### 11.16 20d — the page process ended

**Data:** `Tab.crashed`. The page message (10.10). Tab row: favicon and title stay, the warning
mark at the right. Capsule: the URL; the state the URL had (here 「このMacのみ」) with the note
「ページが止まっています」; share and attach actions are off because nothing can be read. A page the
Space holds keeps its ring: the ring is about the URL at a version, and that has not changed.

Buttons: 「再読み込み ⌘R」 (focus), 「タブを閉じる ⌘W」.

| Key | 日本語 | English |
| --- | --- | --- |
| † `crashed.title` | このタブのページが止まりました | The page in this tab stopped |
| † `crashed.lede` | ページを表示していたプロセスが終了しました。ほかのタブとスペースには影響ありません。 | The process that showed this page ended. Other tabs and the Space are not affected. |
| † `crashed.reload` | 再読み込みで、もう一度開けます／ページに保存されていない入力は、失われていることがあります。 | Reload to open it again / Anything you typed that the page had not saved may be lost. |
| † `crashed.shared` | 共有したものは変わりません／スペースが持っている版は、そのまま読めます。 | What you shared is unchanged / The versions the Space holds can still be read. |
| `tab.close` | タブを閉じる | Close tab |
| † `pageState.stopped` | ページが止まっています | The page has stopped |
| † `tab.crashedMark` | このタブのページが止まりました | The page in this tab stopped |

### 11.17 21 — a shared item

**Data:** `getItem` → `ItemDetail` (`title`, `url`, `sourceType`, `sharedBy`, `currentVersion`,
`versionCount`, `status`, `markdown`, `extractor`); `listItemVersions` → `ItemVersionRef[]`
(`number`, `capturedAt`, `capturedBy`, `charCount`). Route `item { itemId }`: a surface in the
page card, with the closed ring. Opens from a ledger row, a shelf item's 「共有した内容を見る」, a
source row of an answer, the menu behind 「共有中」, a row of the new tab or of the activity.
Back (toolbar, ⌘[) returns to where it was opened. The capsule: 「資金調達 2027 / 台帳 / {title}」 and
「メンバー4人に見えます」.

**Layout** (10.12). Left: the crumb, the title with its source glyph and the full byline, then
「スペースが持っている本文」 with `Markdown n行・n文字・extractor で取得・第n版`, the numbered
Markdown (the box scrolls inside itself; text can be selected and copied), and one line on what
is not in it. Right: 出どころ (the full URL, wrapped, mono; 「ページを開く」), 版の履歴, 読める人と送り先,
and at the bottom the unshare note and button.

| Control | Does |
| --- | --- |
| ページを開く → | Opens `url` in a new tab of this Space. The tab shows the page's own state (fresh or stale) once the local check has run. |
| A version row | The current version is marked. Earlier versions are not buttons: their text cannot be fetched today (section 14). The note under the list says so. |
| 共有を解除… | The dialog of 11 (`unshareItem`). Shown to the member who shared it and to owners; for others the footer reads only 「解除できるのは、共有した人とオーナーです。」 |
| 台帳 (crumb) | Space home, section 台帳 |

**States:** `status: "indexing"`: a line under the byline, 「検索の準備をしています。AIは、まだこの版を読めません。」
with a still dot. `failed`: 「検索の準備ができませんでした。」 with the warning glyph. Loading: title
and byline from the ledger row at once, the box empty until the text arrives. Unshared meanwhile
(`item_not_found`): the main column is replaced by the tombstone sentence of 2.5 and 「台帳に戻る」.

| Key | 日本語 | English |
| --- | --- | --- |
| † `item.crumb` | 共有したページ | Shared page |
| † `item.heading` | スペースが持っている本文 | The text the Space holds |
| † `item.meta` | Markdown {lines}行・{chars}文字・{extractor} で取得・第{version}版 | Markdown, {lines} lines, {chars} characters, read by {extractor}, version {version} |
| † `item.only` | メンバーとAIが読むのは、この文章だけです。画像の中身、コメント、編集履歴は入っていません。 | Members and the AI read this text and nothing else. The contents of images, comments and edit history are not in it. |
| ‡ `item.source` | 出どころ | Source |
| `ledger.open` | ページを開く | Open page |
| `item.versions` | 版の履歴 | Versions |
| `byline.version` | 第{version}版 | v{version} |
| `share.chars` | {count}文字 | {count} characters |
| † `item.versionsNote` | 本文を表示できるのは、いまの版です。過去の回答の引用は、読んだ版を指したままです。 | Only the current version's text can be shown. Citations in earlier answers still point at the version they read. |
| † `share.readers` | 読める人と送り先 | Who can read it, and where it goes |
| † `item.sharer` | 共有した人 | Shared by |
| † `share.server` / `share.server.note` | Tiger のサーバー / 保存と検索 | Tiger's server / storage and search |
| † `share.providers.note` | 質問されたとき | when someone asks |
| † `item.unshareNote` | 解除すると、本文とすべての版、検索用のデータが消えます。台帳の記録だけが残ります。 | Unsharing deletes the text, every version and the search data. Only the ledger entry remains. |
| ‡ `ledger.unshare` | 共有を解除… | Unshare… |
| † `item.unshareWho` | 解除できるのは、共有した人とオーナーです。 | Only the member who shared it, or an owner, can unshare it. |
| † `item.indexing` | 検索の準備をしています。AIは、まだこの版を読めません。 | Preparing search. The AI cannot read this version yet. |
| † `item.failed` | 検索の準備ができませんでした。 | Search could not be prepared. |
| † `item.backToLedger` | 台帳に戻る | Back to the ledger |

### 11.18 22 — new tab

**Data:** the surface `new-tab` (a blank active tab). Left: `listItems` of this Space, newest
change first, six rows. Right: `history.search("", 6)` on this Mac. Nothing is fetched for the
right column: it never leaves the machine.

**Layout** (10.12). The capsule is focused with its placeholder; typing goes there. The tab row
reads 「新しいタブ」 with the page glyph.

| Control | Does |
| --- | --- |
| A row at the left | Opens the item (21). ⌘-click opens the source page in this tab. |
| 台帳を開く | Space home, section 台帳 |
| A row at the right | `tabs.navigate` to that URL in this tab |
| 履歴を検索 | The palette in history mode (`open-history`, ⌘Y) |
| The key caps | Not buttons: a legend |

**States:** an empty Space: the left column reads the shelf's empty sentence (`zone.sharedEmpty`).
No history: 「まだ履歴はありません。」. Signed out: the left column is replaced by one line and a
「サインイン」 link. Private window: this page is 05b instead.

**Keyboard:** focus is in the address field. Down moves into the left list, Right and Left
between the columns, Return opens.

| Key | 日本語 | English |
| --- | --- | --- |
| ‡ `address.placeholder` | 検索、またはアドレスを入力 | Search or enter address |
| † `newTab.spaceRecent` | {space} の最近の共有 | Recently shared in {space} |
| † `newTab.openLedger` | 台帳を開く | Open the ledger |
| † `newTab.localRecent` | このMacで最近開いたページ | Recently opened on this Mac |
| `command.history` | 履歴を検索 | Search history |
| † `newTab.localNote` | 履歴はこのMacにだけあります。メンバーには伝わりません。 | History exists only on this Mac. Members do not learn of it. |
| † `newTab.noHistory` | まだ履歴はありません。 | No history yet. |
| † `newTab.key.address` | アドレスと検索 | Address and search |
| `palette.label` | コマンド | Commands |
| `ask.open` | スペースに聞く | Ask the Space |
| † `newTab.key.share` | ページを共有 | Share page |
| `tab.new` | 新しいタブ | New tab |

### 11.19 The dark renderings (23-dark-17, 23-dark-19, 23-dark-21)

Nothing is specified separately: the same components on the dark roles of `tokens.css`. Points
checked in the shots (**verified** by looking): the dashed line of an attached block is `--ink`
(light) on `--paper`; the undecided block is `--paper-2`, one step lighter; the choice keeps its
check; the Space side of the sheet is the dark wash with the light accent line; in settings the
chosen item of a choice is `--paper-3`; the version row's bar is light ink.

## 12. Keyboard

Bindings come from the engine (`apps/browser/src/main/menus.ts`, **verified** by reading it); the
UI decides what each does.

| Keys | Action |
| --- | --- |
| ⌘T, ⌘W, ⇧⌘T | New tab, close tab, reopen closed tab |
| ⌘N, ⇧⌘N | New window, new private window |
| ⌘L | Focus the address field (the palette opens on typing) |
| ⌘K | Command palette |
| ⌘\ | Ask panel, open or closed |
| ⇧⌘H | Space home, open or back to the page |
| ⇧⌘S | Share this page: the sheet of 2.6 |
| ⌘F, ⌘G, ⇧⌘G | Find in page, next, previous |
| ⇧⌘J | Downloads |
| ⌘Y | History (palette in history mode) |
| ⌘D | Bookmark this tab |
| ⌘, | Settings |
| ⌘R, ⇧⌘R | Reload, reload without cache |
| ⌥⌘→, ⌥⌘← | Next tab, previous tab |
| ⌘↵ | Confirm a share sheet or the thread sheet |
| ↵ | Confirm an attach sheet, a dialog's default button, send a question |
| Esc | Close the top surface: popover, menu, palette, dialog, sheet, find, then settings or Space home |

Focus: every control shows the 2 px `--focus` outline at 2 px when reached by keyboard
(`:focus-visible`), on every ground. A surface that opens takes focus and gives it back to its
trigger when it closes. Sheets and dialogs trap Tab; popovers and menus do not (Tab closes them
and moves on).

## 13. Icons

One set, in one file: `prototype/icons.js` is the source and `icons.svg` is generated from it by
`render.cjs` (80 icons, each a `<symbol id="i-name">`; opening the file shows them with their
names). 16 px grid, 1.5 px stroke at every rendered size (1.25 px inside key caps), round caps and
joins, no fills except where stated. No third-party marks: favicons in the mock are generic
glyphs.

| Group | Names |
| --- | --- |
| Navigation and window | `sidebar` `back` `fwd` `reload` `retry` `close` `plus` `minus` `more` `chevDown` `chevUp` `chevRight` `arrowRight` `search` `filter` `sliders` |
| The boundary | `cross` (share: an arrow rising through an opening in a line) `uncross` (unshare) `frame` (attached to one question) `laptop` (this Mac) `lock` (cannot be shared) `glasses` (private window) `eyeOff` (not sent) `keep` (what remains; the ledger) `shield` |
| People and talk | `person` `people` `invite` `leave` `chat` `thread` `at` |
| Sources | `doc` `pdf` `grid` `slides` `hash` `note` `news` `globe` `mail` `calendar` `bank` `page` `reader` `folder` `link` |
| Acts and states | `check` `undo` `copy` `send` `stop` `exportOut` (leaves Tiger for another company or the system browser) `download` `trash` `history` `clock` `bookmark` `pin` `swap` `info` `warn` `offline` `dot` `key` |
| Site permissions | `mic` `camera` `bell` `location` `clipboard` `screen` `sound` |
| Keys | `kCmd` `kShift` `kCtrl` `kOpt` `kEsc` `kReturn` `kUp` `kDown` |

Added in the second pass: `mic` `camera` `bell` `location` `clipboard` `screen` `download`
`folder` `link` `chevUp` `leave` `minus`.

## 14. What the design needs that the code does not have yet

Each is drawn as it should be, with the fallback stated where the screen is specified.

| Need | Where | Today | Fallback in the design |
| --- | --- | --- | --- |
| `Space.seal` (one character) in `domain.ts`, `createSpace`, `updateSpace` | Seals everywhere; 16a2 | Not in the contract | The first character of `Space.name`; the 印 field is read-only |
| A preview of an invite before accepting (Space name, hue, counts, inviter, expiry) | 16c | `acceptInvite` only | Plain head, 「スペースへの招待」 |
| Changing a member's role | 16b | No route | The role is text |
| Listing and revoking remembered site permissions | 15a, 19 | `permission.respond` only | Not drawn; 「次回からも同じにする」 cannot be undone in the app, which should be fixed before release |
| The text of an earlier version | 21 | `getItem` returns the current one | Earlier rows are not buttons |
| Resuming an interrupted download | 15b | `cancel`, `open`, `showInFolder`, `clear` | The row is a record |
| Changing a Space's token budget | 16d, 13b | No route | Read-only meter |
| Whether a shared answer keeps a marker where it cited an attached page | 17 | Content is copied verbatim | The 「添付」 chip is drawn as a chip without a target (**inferred**) |

## 15. Still not drawn

Specified in this document but without a shot of their own: the menu behind 「共有中」 (component
sheet), the 「招待リンクで参加…」 dialog, the member's view of 16b, the remove and leave dialogs
(component sheet), the built-in list popover, share and attach failures in the sheet
(`capture.error.*`: the sheet's left pane shows the sentence and 「もう一度読み取る」), the punycode
warning, sheets under 760 px, the find field and notice under 1100 px, bookmarks, history as its
own page (it is the palette), printing and zoom (native), English renderings of any screen.
Motion for the second pass is the vocabulary of section 6 (fade 90 to 160 ms, no travel); nothing
new moves.

## 15. Review resolutions (binding for implementation)

Two reviewers examined the complete set (use, privacy and buildability; craft). Neither found a
blocker. The decisions below resolve every major issue and override any earlier section they
contradict. They were made by the orchestrator in place of a further design pass, so they are stated
as rules and values; the screenshots do not show them yet. The implemented screens are reviewed for
craft against this section.

### 15.1 Consent and recipients
1. **Every path that sends text to a model names the company.** The send control reads
   `<会社名> に送信` in the ask panel, in the Space-thread composer (which gets the same model control as
   the panel), and nowhere else: the command palette never sends. Choosing 「AIに質問」 in the palette
   opens the ask panel with the typed text in the composer.
2. **A confirmed attachment is bound to the company it was confirmed for.** If the member changes to a
   model of another company while an attachment is pending, the attachment returns to the unconfirmed
   state and the sheet must be confirmed again with the new company named.
3. **The share sheet states two further consequences**, as plain lines under the reader list:
   「あとから参加したメンバーも読めます」 and 「質問のたびに、そのとき選ばれた AI 提供元に送られます」.
4. **The reader list scrolls inside itself** once it exceeds four rows; its heading carries the count
   (「読める人 6人」). The footer sentence and the buttons never move.
5. **Long pages in the sheet:** the preview is the whole text in a scrolling column, rendered in
   windows of 200 lines; the header shows line count and `charCount`; when `truncated` is true the
   header adds 「長いため 600,000 字で切り詰めました」.
6. **The ledger row for the current page** uses the outline document glyph. The dashed square appears
   only when the page is attached to the next question.
7. **Activity (16d) never lists an export made from a private thread.** The server already withholds it.

### 15.2 State
8. **The current Space belongs to the window** (`spaces.current` in the client). `Tab.spaceId` is not
   used by this design.
9. **Staleness is checked** when a tab becomes active, when the share or ask surface opens, and from
   the menu behind the state (「更新を確認」); at most once per 60 seconds per tab, never on a timer.
   Google Docs, Sheets and Slides are checked only on the member's request, because the check is a
   fetch from Google. The capsule may therefore lag; its menu shows 「最終確認 n分前」.
10. **Citations show 第n版** from `Citation.versionNumber`. An unavailable citation reads 「共有解除済み」
    with no name or date.
11. **Answer failures:** the halt block renders the client's message for each of the ten
    `MESSAGE_ERROR_CODES`. 「もう一度」 is offered for `ai_failed`, `ai_busy`, `ai_timeout`,
    `ai_interrupted`, `ai_unavailable`; 「モデルを変える」 for `model_unavailable` and
    `ai_context_too_long`; no action for `ai_refused` and `budget_exceeded`; `ai_aborted` reads
    「停止しました」 and keeps the partial text.
12. **A send that fails with a network error** is not shown as failed until the thread has been
    refetched: if the message is there, it is shown as sent; if not, the composer keeps the text and
    says 「送信できませんでした。もう一度送れます」.

### 15.3 Layers and input
13. **One overlay surface at a time.** Opening a second replaces the first. Notices are drawn in the
    toolbar capsule, never in the overlay.
14. **Menus and popovers use the overlay at full-window bounds** with a transparent ground, so a click
    anywhere outside closes them (the click is consumed). Tight bounds are for non-interactive hover
    cards only.
15. **The ask panel is always docked.** Window minimum is 960 x 600. At 1280 and wider: sidebar 248,
    panel 408. From 1100 to 1279: the sidebar becomes the 52 px rail while the panel is open. From 960
    to 1099: rail, and the panel is 360. The page is never narrower than 532.
16. **Keyboard:** `focus-next-region` (F6, and ⌃⌘→ / ⌃⌘← on macOS) moves focus sidebar, toolbar, page,
    ask panel, because Tab cannot leave a web page. ⌘L, ⌘K, ⌘G, ⇧⌘G, ⌘R, ⇧⌘R and ⌘↵ (confirm the open
    sheet) arrive as engine shortcut events.
17. **Remembered site permissions** are listed in Settings with 「取り消す」 for each
    (`permissions.list`, `permissions.revoke`). The checkbox 「次回からも同じにする」 stays.
18. **Invites** open from `tiger://invite/<token>` anywhere on the Mac, and from the server's invite
    page, which offers 「Tiger で開く」 and shows the token to paste. The accept dialog shows the invite
    preview (Space name, hue, member and item counts, who invited, expiry) before anything is joined.

### 15.4 Craft
19. **Answers are not justified.** Mincho answers are set ragged-right with `line-break: strict` and
    `word-break: auto-phrase`; a citation chip is kept with the two characters before it by a
    no-wrap span.
20. **Seals at 1x:** a seal smaller than 20 px shows no character, only the Space colour in a rounded
    square; from 20 px up it shows the character. Tab rows use the 16 px square, the Space header and
    the switcher use 24 px with the character.
21. **墨 (graphite) is not offered as a Space colour.** It is reserved for the private window. The
    picker offers the other eight.
22. **Spacing between Japanese and Latin** is never typed. Strings contain no ASCII space next to a
    Japanese character; `text-autospace: normal` supplies the gap. A test enforces this on the
    Japanese dictionary.
23. **Text the member must read is never set in `--ink-off`.** Reasons (why a provider is unavailable,
    why sending is disabled) use `--ink-3`. `--ink-off` is for inactive control labels only.

### Needs from engineering (built alongside the UI)
`Citation.versionNumber`; the invite preview route; `tiger://invite` protocol handling and the server's
invite page; `permissions.list` / `permissions.revoke`; the shortcut actions `find-next`,
`find-previous`, `reload`, `reload-hard`, `confirm-sheet`, `focus-next-region`; attachment confirmation
bound to the provider; network-error reconciliation on send; the staleness policy in 15.2.

