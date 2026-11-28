/* Regenerates every screenshot of the final design.

   node /home/user/tiger-browser/design/final/render.cjs                 all screens at 2x into shots/
   node .../render.cjs 02-ask-panel 09b-attached                         only these
   node .../render.cjs --scale=1 --out=/some/dir 01-browse               cheap 1x proof elsewhere
   node .../render.cjs --scale=1 --out=/some/dir --clip=0,0,620,420 01-browse    a region (x,y,w,h)

   Needs Playwright (preinstalled globally) and nothing else: fonts are local woff2 subsets.
   Fails (exit 1) when a character falls outside the font subset, a font does not load, the
   document overflows the window, a text box is clipped, or a pointer target is under 28 px. */
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");

const root = __dirname;
const index = "file://" + path.join(root, "prototype", "index.html");

const SCREENS = [
  "01-browse",
  "02-ask-panel",
  "03-share-preview",
  "03b-share-update",
  "04-space-home",
  "05-cannot-share",
  "05b-private-window",
  "06-first-run",
  "07-dark-01-browse",
  "07-dark-02-ask-panel",
  "07-dark-04-space-home",
  "07-dark-05b-private-window",
  "08-command",
  "09-attach-preview",
  "09b-attached",
  "10a-stale",
  "10b-shared-elsewhere",
  "10c-after-navigation",
  "11-unshare-confirm",
  "11b-citation-unavailable",
  "12-model-menu",
  "13a-streaming-with-stop",
  "13b-answer-failed",
  "13c-answer-stopped",
  "14-many-tabs",
  "14b-sidebar-collapsed",
];

(async () => {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const scale = Number(opt("scale", "2"));
  const out = path.resolve(opt("out", path.join(root, "shots")));
  const clipArg = opt("clip", "");
  const theme = opt("theme", "");
  const clip = clipArg ? (([x, y, width, height]) => ({ x, y, width, height }))(clipArg.split(",").map(Number)) : undefined;
  const only = args.filter((a) => !a.startsWith("--"));
  const list = only.length ? only : SCREENS;
  fs.mkdirSync(out, { recursive: true });
  const charset = new Set(fs.readFileSync(path.join(root, "prototype", "fonts", "charset.txt"), "utf8"));

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: scale });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`script error: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`request failed: ${r.url()}`));

  for (const id of list) {
    await page.goto(`${index}?screen=${id}${theme ? `&theme=${theme}` : ""}`);
    await page.evaluate(async () => {
      await document.fonts.ready;
      /* force every declared face to load, then wait again, so no frame is captured in fallback */
      await Promise.all([...document.fonts].map((f) => f.load().catch(() => null)));
      await document.fonts.ready;
    });
    await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, { timeout: 5000 }).catch(() => problems.push(`${id}: screen did not finish drawing`));
    const report = await page.evaluate(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const label = (el) => (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24) || el.className;
      /* one-line text that is cut without the fade mask */
      const clipped = [...document.querySelectorAll(".st-label, .btn, .st-act, .zone-label, .space-name, .msg-name, .ledger-what, .model-name, .who-name, .picker-name, th, .seg-item, .pal-title, .field-label")]
        .filter((el) => visible(el) && el.scrollWidth > el.clientWidth + 1)
        .map(label);
      const small = [...document.querySelectorAll(".window button, .window a")]
        .filter((el) => visible(el) && !el.closest(".view .m-doc, .view .m-news, .view .m-bank, .view .m-note, .view .m-grid, .view .m-chat"))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          /* hit area extended by ::after or by the row the control sits in */
          const pad = el.matches(".cite, .link, .zone-link, .st-x, .source-text") ? 6 : el.matches(".st-act") ? 4 : 0;
          return Math.min(r.width, r.height) + 2 * pad < 27.5;
        })
        .map((el) => `${label(el)} (${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)})`);
      return {
        text: document.body.innerText,
        failed: [...document.fonts].filter((f) => f.status !== "loaded").map((f) => `${f.family} ${f.weight}`),
        overflow: document.documentElement.scrollWidth > 1440 || document.documentElement.scrollHeight > 900,
        clipped,
        small,
      };
    });
    const missing = [...new Set([...report.text].filter((ch) => ch > " " && ch !== " " && !charset.has(ch)))];
    if (missing.length) problems.push(`${id}: characters outside the font subset: ${missing.join(" ")}`);
    if (report.failed.length) problems.push(`${id}: fonts not loaded: ${report.failed.join(", ")}`);
    if (report.overflow) problems.push(`${id}: document overflows 1440 x 900`);
    if (report.clipped.length) problems.push(`${id}: clipped text: ${[...new Set(report.clipped)].join(" | ")}`);
    if (report.small.length) problems.push(`${id}: targets under 28 px: ${[...new Set(report.small)].join(" | ")}`);
    await page.screenshot({ path: path.join(out, `${id}.png`), clip });
    console.log(path.join(out, `${id}.png`));
  }
  await browser.close();
  if (problems.length) {
    console.error("\n" + problems.join("\n"));
    process.exitCode = 1;
  }
})();
