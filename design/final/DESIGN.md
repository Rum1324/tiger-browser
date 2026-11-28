# Tiger — design system, part 1

As of 2026-11-28. Base: the Rooms direction, with the dashed page frame from Lens and the typographic
provenance from Paper. This part covers the boundary system, the review resolutions, the window, the
components used by the 26 core screens, and motion. Part 2 (next pass) is listed in section 9.

Regenerate everything: `node design/final/render.cjs` (shots at 2x into `shots/`),
`node design/final/contrast.cjs` (token pairs, every Space hue, both themes),
`node design/final/prototype/fonts/fetch-fonts.cjs` (after changing copy).
Open one screen: `design/final/prototype/index.html?screen=02-ask-panel` (`&theme=dark`, `&hue=indigo`).

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
  ⌘J opens the panel and attaches nothing.
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
| C-M11 | ⌘Z on the undo toast | No toast, no shortcut. After a share the capsule reads 「共有しました」 with a 「取り消す」 button for 8 s. | spec, 6.1 |
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
| Space header | 44 high, padding 0 6 0 4, gap 8, radius 8. Seal 28. | Name 15/600 `palt`; sub line 12/400: `メンバー4人・共有41件` | Name `--space-ink`; sub `--space-ink-2`; hover `--space-frame-2`; Space home open `--space-frame-3` |
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
| Answer actions | 28 high buttons, gap 6: 「スレッドに投稿」, 「Google ドキュメントに書き出す」 (system browser for consent), copy (icon) | 12/600 | Paper, 1 px `--line-strong` |
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

## 8. Screens (`shots/*.png`, 2880 × 1800)

| File | What it shows |
| --- | --- |
| 01-browse | A Google Doc the Space holds at 第2版, unchanged since: closed ring, 「共有中」 with byline, solid seal on the tab, current item filled on the shelf. |
| 02-ask-panel | The private thread: a cited answer with a table and a list in Mincho, sources with bylines, the expanded ledger, the model button, 「Anthropic に送信」. |
| 03-share-preview | First share of a spreadsheet: the exact Markdown, readers and recipients, what happens after, capture time. |
| 03b-share-update | A new version: the two changed lines marked, the old lines above them. |
| 04-space-home | The ledger with a tombstone and a hover action; the team thread with people, a share event and the AI. |
| 05-cannot-share | A bank page (navy and crimson) inside the amber frame; the reason popover with the matched rule. |
| 05b-private-window | No Space, no hue, no shelf, no ask button; what the window does and does not do. |
| 06-first-run | Create the first Space (name, seal, one of nine colours) and learn the four page edges. |
| 07-dark-01-browse, -02-ask-panel, -04-space-home, -05b-private-window | The same screens in the dark theme. |
| 08-command | The palette over a news page, on the scrim: tabs, shared items with bylines, history, search, ask. |
| 09-attach-preview | The attach sheet over a stale page: exact text, 送り先 Anthropic, あなただけ. |
| 09b-attached | After confirming: dashed frame outside the open ring, chip in the composer and the capsule, ledger row. |
| 10a-stale | Shared, then edited: ring open, hollow seals, 「新しい版を共有…」. |
| 10b-shared-elsewhere | A page held by 採用 while the window is in 資金調達 2027. |
| 10c-after-navigation | The tab that showed the pitch followed a link: the same row, a new URL, 「このMacのみ」. |
| 11-unshare-confirm | What is deleted, what stays, what cannot be taken back. |
| 11b-citation-unavailable | An answer whose second source was unshared. |
| 12-model-menu | Catalogue by receiving company, three tiers, Google unavailable on this server. |
| 13a-streaming-with-stop | Named steps, streamed text, 「止める」. |
| 13b-answer-failed | Budget used up, in another Space (プロダクト, 藍): the meter, the owner, what was not sent. |
| 13c-answer-stopped | The text so far, 「ここで止めました」, ask again. |
| 14-many-tabs | Forty tabs: six pinned, the pocket scrolled, the threshold in place, a saturated chat page in the frame. |
| 14b-sidebar-collapsed | The rail, with the panel open. |

Mock data: the tier of each model is shown with all three values of `ModelInfo.tier`; the
catalogue of 2026-11-26 uses only `best` and `fast` (**verified** by reading
`packages/llm/src/catalog.json`). The 「送らないもの」 line for Sheets (formulas as values, other
sheets) is **inferred** from CSV export and must be checked against the extractor.

## 9. Not in this part

Sharing a private thread with the Space (the include or exclude step for questions that carried a
page); the invite accept step; the menu behind 「共有中」 (送った内容を見る, 版の履歴, 共有を解除…) and
the reader for a stored version; downloads, find in page, site permission prompts, page load
errors, offline and reconnecting; share and attach failures (`capture.error.*`, `error.*`) in the
capsule; settings and the protection list; the punycode warning; the sheet under 760 px; export
to Google Docs through the system browser; English strings; the second half of this specification.
