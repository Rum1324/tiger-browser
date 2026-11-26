# Lens

**Thesis.** The page is the product and Tiger is its mount: one command field drives the browser, and
a frame with a readout strip, drawn in chrome pixels the page cannot touch, says who can read this tab
right now.

## Three decisions

1. **No sidebar. The active tab is the command field.** One 52 px toolbar; inactive tabs are chips in a
   well. ⌘K opens it into a palette for a URL, a search or a question (⏎ opens, ⌘⏎ asks).
2. **The page sits in a mount.** A 4 px frame on three sides, a 28 px strip below. The page rectangle
   never changes.
3. **A native inspector, not a chat app.** A 400 px trailing pane: 聞く and このページ. Hue is only a
   Space colour, only on things that Space can read.

## The private/shared line

Four frame states, coded by shape and colour:

- No frame: この Mac のみ.
- Dashed ink: attached to the next message only.
- Solid Space colour: shared (dashed while the preview is open).
- Hatch, inverse strip: cannot be shared (bank, mail, private window).

The strip keeps the same columns: state, Space, チーム, AI. Tab chips and the field repeat the ring. The
composer's ledger lists what the model reads next; its page switch turns off after each send.

## Signature: the frame closes

On 「4人に共有」 (shots 03, 09a–c, captions are annotations; live at `?screen=09-signature-live`):

- 0 ms: sheet fades, scales to 0.98. 140 ms, cubic-bezier(.4,0,1,1).
- 100 ms: strip fills with the Space colour, left to right. 220 ms, cubic-bezier(.2,.8,.2,1).
- 180 ms: two arms rise from the strip's ends and meet at top centre. 420 ms, cubic-bezier(.3,0,.1,1).
- 620 ms: strip reads 共有しました, with 取り消す.

Unsharing runs backwards. Reduced motion: states swap. The page never moves.

## Type

Sizes 11, 12, 13, 15, 20; 28 for generated documents. Weights 400 and 600.

UI: SF Pro, Hiragino Sans. Model output: New York, Hiragino Mincho ProN at 15 px, leading 1.8, gothic
600 for emphasis. Markdown and hosts: SF Mono. Mock: Inter, Noto Sans JP, Source Serif 4, Noto Serif JP
500, Geist Mono.

## Bad at

- Many tabs: sixteen chips fit, four with the inspector open; the rest are behind ⌘K.
- Status bars get ignored. The frame, not the strip, carries the one-second read.
- A private page looks like Safari: quiet on purpose, plain in a thumbnail.
- The frame vocabulary must be learned; first run teaches it.
- Hiragino Mincho W3 may be too light at 15 px (inferred).

## Feasibility

- Frame, strip and rings are chrome UI pixels around the page view (bounds inset 4 px,
  `setBorderRadius(10)`). Nothing draws on, tints or blurs the page. Mock only.
- Sheet and palette sit on the overlay view, opaque; the scrim is plain alpha.
- The inspector resizes the page view in three steps over 150 ms. Frame changes never resize it.
- Every surface has an opaque token; nothing depends on vibrancy.
