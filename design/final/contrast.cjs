/* Checks the text and state-indicator colour pairs used by the prototype against WCAG contrast.

   node /home/user/tiger-browser/design/final/contrast.cjs            failures only
   node .../contrast.cjs --all | --amber                             every pair | the hero Space

   Tokens are resolved by the browser (OKLCH to sRGB), per theme and per Space hue, so the numbers
   are the ones that ship. Text pairs must reach 4.5:1; state indicators (the ring, the dashed frame) 3:1. */
const path = require("node:path");
const { chromium } = require("playwright");

const index = "file://" + path.join(__dirname, "prototype", "index.html") + "?screen=01-browse";

/* [foreground token, background token, minimum, where it is used] */
const PAIRS = [
  ["--ink", "--paper", 4.5, "body text on cards"],
  ["--ink-2", "--paper", 4.5, "secondary text on cards"],
  ["--ink-3", "--paper", 4.5, "bylines, notes on cards"],
  ["--ink-3", "--paper-2", 4.5, "table header, line numbers, menu footers"],
  ["--ink-2", "--paper-3", 4.5, "segmented control, mention"],
  ["--ink-3", "--paper-3", 4.5, "lowest text step on a hover or selected fill"],
  ["--ink", "--mark", 4.5, "changed line in a preview"],
  ["--on-inverse", "--inverse", 4.5, "AI seal, send button, destructive confirm"],
  ["--on-inverse", "--inverse-2", 4.5, "ink button, hover"],
  ["--ink", "--pocket", 4.5, "tab titles in the pocket"],
  ["--ink-2", "--pocket", 4.5, "pocket label"],
  ["--ink-3", "--pocket", 4.5, "pocket count, new tab"],
  ["--ink", "--space-frame", 4.5, "item titles on the frame"],
  ["--ink", "--space-frame-3", 4.5, "current item on the frame"],
  ["--ink", "--space-field", 4.5, "registrable domain in the capsule"],
  ["--space-ink", "--space-frame", 4.5, "Space name"],
  ["--space-ink", "--space-field", 4.5, "state label in the capsule"],
  ["--space-ink-2", "--space-frame", 4.5, "zone label, bylines on the frame"],
  ["--space-ink-2", "--space-frame-3", 4.5, "byline of the current item"],
  ["--space-ink-2", "--space-field", 4.5, "path and byline in the capsule"],
  ["--space-ink", "--space-frame-3", 4.5, "pressed frame button"],
  ["--on-space-solid", "--space-solid", 4.5, "seal, confirm button"],
  ["--on-space-solid", "--space-solid-2", 4.5, "confirm button, hover"],
  ["--space-ink", "--space-wash-2", 4.5, "citation chip"],
  ["--space-ink", "--space-wash", 4.5, "share event in a thread"],
  ["--space-ink-2", "--space-wash", 4.5, "notes on the Space side of a sheet"],
  ["--space-ink", "--paper", 4.5, "glyph of a hollow seal"],
  ["--space-accent", "--space-frame", 3, "ring against the frame"],
  ["--space-accent", "--paper", 3, "ring against a white page, hollow seal outline"],
  ["--ink", "--space-frame", 3, "dashed frame against the frame"],
  ["--line-control", "--paper", 3, "boundary of inputs"],
];

const SPACES = ["amber", "coral", "rose", "violet", "indigo", "sky", "teal", "green", "graphite", "private"];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(index);
  let worst = Infinity;
  let failures = 0;
  for (const theme of ["light", "dark"]) {
    for (const room of SPACES) {
      const rows = await page.evaluate(
        ({ theme, room, PAIRS }) => {
          document.documentElement.dataset.theme = theme;
          const host = document.createElement("div");
          if (room === "private") { host.dataset.space = "none"; host.dataset.window = "private"; } else host.dataset.space = room;
          document.body.appendChild(host);
          const cv = document.createElement("canvas");
          cv.width = cv.height = 1;
          const ctx = cv.getContext("2d", { willReadFrequently: true });
          const cs = getComputedStyle(host);
          const paint = (token, under) => {
            ctx.clearRect(0, 0, 1, 1);
            if (under) {
              ctx.fillStyle = cs.getPropertyValue(under).trim();
              ctx.fillRect(0, 0, 1, 1);
            }
            ctx.fillStyle = cs.getPropertyValue(token).trim();
            ctx.fillRect(0, 0, 1, 1);
            return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
          };
          const lum = ([r, g, b]) => {
            const f = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
          };
          const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
          const out = PAIRS.map(([fg, bg, min, use]) => {
            const [bgToken, under] = bg.split("@");
            const b = paint(bgToken, under);
            const f = (() => {
              /* foreground may itself be translucent: composite over the resolved background */
              ctx.clearRect(0, 0, 1, 1);
              ctx.fillStyle = hex(b);
              ctx.fillRect(0, 0, 1, 1);
              ctx.fillStyle = cs.getPropertyValue(fg).trim();
              ctx.fillRect(0, 0, 1, 1);
              return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
            })();
            const [hi, lo] = [lum(f), lum(b)].sort((x, y) => y - x);
            return { fg, bg, min, use, ratio: (hi + 0.05) / (lo + 0.05), f: hex(f), b: hex(b) };
          });
          host.remove();
          return out;
        },
        { theme, room, PAIRS },
      );
      for (const r of rows) {
        const ok = r.ratio >= r.min;
        if (r.min > 0) worst = Math.min(worst, r.ratio / r.min);
        if (!ok) failures++;
        if (!ok || process.argv.includes("--all") || (room === "amber" && process.argv.includes("--amber")))
          console.log(
            `${ok ? "ok  " : "FAIL"} ${theme.padEnd(5)} ${room.padEnd(9)} ${r.ratio.toFixed(2).padStart(5)}:1 (min ${r.min}) ${r.fg} ${r.f} on ${r.bg} ${r.b} — ${r.use}`,
          );
      }
    }
  }
  await browser.close();
  console.log(failures ? `\n${failures} pair(s) below the minimum` : `all pairs pass; tightest margin is ${worst.toFixed(2)}x its minimum`);
  process.exitCode = failures ? 1 : 0;
})();
