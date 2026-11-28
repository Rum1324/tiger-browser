/* Checks the text and state-indicator colour pairs used by the prototype against WCAG contrast.

   node /home/user/tiger-browser/design/directions/rooms/contrast.cjs

   Tokens are resolved by the browser (OKLCH to sRGB), per theme and per room, so the numbers
   are the ones that ship. Text pairs must reach 4.5:1; state indicators (the ring) 3:1. */
const path = require("node:path");
const { chromium } = require("playwright");

const index = "file://" + path.join(__dirname, "prototype", "index.html") + "?screen=01-browse";

/* [foreground token, background token, minimum, where it is used] */
const PAIRS = [
  ["--ink", "--paper", 4.5, "body text on cards"],
  ["--ink-2", "--paper", 4.5, "secondary text on cards"],
  ["--ink-3", "--paper", 4.5, "tertiary text on cards"],
  ["--ink-3", "--paper-2", 4.5, "table header, line numbers"],
  ["--ink-2", "--paper-3", 4.5, "segmented control, mention"],
  ["--ink-3", "--paper-3", 4.5, "lowest text step on hover fill"],
  ["--on-inverse", "--inverse", 4.5, "toast, blocked chip, AI seal"],
  ["--on-inverse-2", "--inverse", 4.5, "blocked sill body text"],
  ["--danger", "--paper", 4.5, "destructive text"],
  ["--ink", "--room-frame", 4.5, "tab titles on the frame"],
  ["--ink", "--pocket@--room-frame", 4.5, "tab titles in the pocket"],
  ["--ink-2", "--pocket@--room-frame", 4.5, "pocket label"],
  ["--ink-3", "--pocket@--room-frame", 4.5, "pocket note, new tab"],
  ["--room-ink", "--room-frame", 4.5, "Space name"],
  ["--room-ink-2", "--room-frame", 4.5, "zone label, Space sub line"],
  ["--room-ink-2", "--room-field", 4.5, "host and provenance in the address field"],
  ["--room-ink", "--room-frame-2", 4.5, "frame button"],
  ["--room-ink", "--room-frame-3", 4.5, "pressed frame button"],
  ["--on-room-solid", "--room-solid", 4.5, "shared chip, seal, primary button"],
  ["--on-room-solid", "--room-solid-2", 4.5, "primary button, hover"],
  ["--room-ink", "--room-wash-2", 4.5, "citation chip, scope chip"],
  ["--room-ink", "--room-wash", 4.5, "share event in thread"],
  ["--room-ink-2", "--room-wash", 4.5, "event time"],
  ["--room-accent", "--room-frame", 3, "ring against the frame"],
  ["--room-accent", "--paper", 3, "ring against the page card"],
  ["--line-control", "--paper", 3, "boundary of inputs and switches"],
  ["--line-strong", "--paper", 0, "decorative outline (no minimum)"],
];

const ROOMS = ["fund", "hire", "product", "ochre", "sky", "plum", "incognito"];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(index);
  let worst = Infinity;
  let failures = 0;
  for (const theme of ["light", "dark"]) {
    for (const room of ROOMS) {
      if (room === "incognito" && theme === "dark") continue;
      const rows = await page.evaluate(
        ({ theme, room, PAIRS }) => {
          document.documentElement.dataset.theme = theme;
          const host = document.createElement("div");
          host.dataset.room = room;
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
        if (!ok || process.argv.includes("--all") || (room === "fund" && process.argv.includes("--fund")))
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
