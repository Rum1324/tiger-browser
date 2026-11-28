# Rooms

**Thesis.** A Space is a room: the window frame wears its colour, and a page is shared only once its tab has crossed a visible line in the sidebar, so place, not a badge, tells you who can see what.

## Three decisions

1. **Hue means room, nothing else.** Sidebar, toolbar and gutter take the Space's tint. People, private things and the AI stay neutral; a private window has no hue.
2. **The threshold.** Shared tabs sit on the tinted ground, private tabs in a neutral pocket labelled 「自分だけ」. New tabs are born private. Sharing moves the row.
3. **The Space speaks in Mincho.** AI answers and seals (資, 採, 虎) are Mincho; people and chrome are Gothic.

## The private/shared mechanism

Three agreeing signals, plus one for the AI:

- Tab position: above or below the threshold.
- A state chip in the address field: 共有中・4人, 自分だけ, 共有不可.
- A 3 px room-colour ring around the page card and its tab row, drawn in the chrome-owned gutter: a page cannot fake or cover it.
- The composer ledger states what the AI reads for this message: shared items, the current page (a one-message switch), never private tabs.

## Signature: crossing

After the share is confirmed:

- 0 ms: sheet fades (160 ms, ease-in).
- 120 ms: the tab row lifts (scale 1.02, shadow, 90 ms), then travels up over the pocket edge (360 ms, `cubic-bezier(.34,1.3,.64,1)`); neighbours close the gap (240 ms).
- 260 ms: the row takes the ring; the page ring wipes left to right (360 ms, ease-out); the chip cross-fades (160 ms).
- 600 ms: toast with undo.

Unsharing reverses it. Reduced motion: a 160 ms cross-fade. Switching Space re-tints the frame in 280 ms.

## Type

Scale 11/12/13/15/20 px (28 for generated documents), two weights per face.
Gothic: Inter + Noto Sans JP in the mock; SF Pro + Hiragino Sans (W3, W6) in production.
Mincho: Noto Serif JP 500/700, bundled in production (inferred: Hiragino Mincho W3 is too light at 15 px).
Mono for Markdown and hosts.
`palt` on labels, `text-autospace` instead of typed spaces, `auto-phrase` on short text.

## Bad at

- Hue fails colour-blind users and runs out near eight Spaces; seals and text must carry it.
- Sidebar plus panel leave 776 px for the page at 1440.
- A tinted frame can clash with a site's palette.
- The shared zone holds open tabs only; the breadcrumb hides the full URL until ⌘L; no bookmarks bar.
- Presence on shared tabs reveals which shared page you have open; needs opt-in.

## Feasibility

- Ring, sill and panel sit in chrome-owned space; the page stays one rounded rectangle (`View.setBorderRadius`, verified in the spike's Electron 45.5 typings).
- Palette, sheet and toast are opaque overlays: no blur or scrim over page pixels.
- The panel opens by resizing the page view in three steps over 150 ms.
- Tints are opaque (vibrancy optional); crossing is DOM-only.
