# Paper

**Thesis.** Tiger is a sheet of ruled paper: what stays on your Mac is plain ink, what the Space can read
carries one vermilion rule (朱), and nothing else in the window has a colour.

## Three decisions

1. **One ink.** Vermilion means "this Space's members and AI can read this", nothing else. Errors, focus
   and selection are ink. The one vermilion fill is the confirm button.
2. **The line is a line.** The tab list is ruled in two. Above: tabs whose page is in the Space, with
   sharer, edition (第2版) and age. Below: this Mac only. Sharing moves a tab across the line, always
   through the preview.
3. **Provenance is set in type.** No badges, no decorative avatars. Bylines name the sharer, editions the
   version, the ledger (台帳) is the audit. People write in gothic; models answer in mincho with numbered
   citations and an open reference list.

## How the private/shared line shows

A 2 px vermilion margin rule marks shared content: beside shared tab rows, in the 8 px gutter left of a
shared page (chrome-owned, so pages cannot fake it), dashed beside Markdown awaiting consent. The same
slot shows a hatched band for protected pages (bank, mail, private window) and nothing for "this Mac
only". The toolbar says it in words: 4人に共有中, この Mac のみ, 共有できません. The composer lists
exactly what the model will read.

## Signature: crossing the line

Drag a tab up over the line, or press ⇧⌘S. Shots 09a, 03, 09b, 09c.

- Lift: row gains a shadow, 120 ms, cubic-bezier(0.2, 0.8, 0.2, 1). Line thickens to 2 px and a dashed
  slot opens, 180 ms.
- Drop: the preview sheet fades in and rises 8 px, 180 ms. Nothing has left yet.
- Confirm: the rule draws down the row in 280 ms and down the page in 420 ms, cubic-bezier(0.3, 0, 0.1, 1).
  The toolbar reads 共有しました with Undo.
- Reduced motion: states swap.

## Type

UI in SF Pro + Hiragino Sans; model output in Hiragino Mincho ProN; source text in SF Mono. Mock: Inter,
Noto Sans JP, Noto Serif JP, JetBrains Mono. Sizes 11, 13, 15, 20, 28; weights 400 and 600. Line height
1.5 UI, 1.75 messages, 1.9 mincho.

## Bad at

- Space identity is a name, not a colour: two windows in different Spaces look alike.
- Vermilion can read as "error" at first; colour-blind users rely on shape and words.
- Tabs order by state: a shared tab that navigates away drops below the line.
- Quiet by design; mincho at 15 px wants Retina.

## Feasibility

- Every mark is chrome pixels (sidebar, toolbar, gutter). Nothing draws on, blurs or tints the page.
- Sheet, palette, popover: opaque, hairline-edged, shadowed, overlay layer. No scrim.
- The side panel resizes the page once. Rule drawing animates chrome only; the dragged row never
  leaves the sidebar.
- `render.cjs` fails on missing glyphs, clipped text and targets under 28 px; `check-contrast.cjs` on
  text under 4.5:1.
