/* Regenerates every screenshot in shots/.

   node /home/user/tiger-browser/design/directions/rooms/render.cjs            all screens
   node .../render.cjs 02-sidepanel-chat 07-dark                              only these

   Needs Playwright (preinstalled globally) and nothing else: fonts are local woff2 subsets. */
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");

const root = __dirname;
const index = "file://" + path.join(root, "prototype", "index.html");
const out = path.join(root, "shots");

const SCREENS = [
  "01-browse",
  "02-sidepanel-chat",
  "02b-sidepanel-streaming",
  "03-share-preview",
  "04-space-home",
  "05-blocked-private",
  "06-first-run",
  "07-dark",
  "07b-dark-sidepanel",
  "08-command",
  "09-signature-a",
  "09-signature-b",
  "09-signature-c",
  "10-room-hire",
];

(async () => {
  const only = process.argv.slice(2);
  const list = only.length ? SCREENS.filter((s) => only.includes(s)) : SCREENS;
  fs.mkdirSync(out, { recursive: true });
  const charset = new Set(fs.readFileSync(path.join(root, "prototype", "fonts", "charset.txt"), "utf8"));

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`script error: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`request failed: ${r.url()}`));

  for (const id of list) {
    await page.goto(`${index}?screen=${id}`);
    await page.evaluate(() => document.fonts.ready);
    /* force every declared face to load, then wait again, so no frame is captured in fallback */
    await page.evaluate(async () => {
      await Promise.all([...document.fonts].map((f) => f.load().catch(() => null)));
      await document.fonts.ready;
    });
    const report = await page.evaluate(() => ({
      text: document.body.innerText,
      failed: [...document.fonts].filter((f) => f.status !== "loaded").map((f) => `${f.family} ${f.weight}`),
      overflow: document.documentElement.scrollWidth > 1440 || document.documentElement.scrollHeight > 900,
    }));
    const missing = [...new Set([...report.text].filter((ch) => ch > " " && ch !== "\u00a0" && !charset.has(ch)))];
    if (missing.length) problems.push(`${id}: characters outside the font subset: ${missing.join(" ")}`);
    if (report.failed.length) problems.push(`${id}: fonts not loaded: ${report.failed.join(", ")}`);
    if (report.overflow) problems.push(`${id}: document overflows 1440 x 900`);
    await page.screenshot({ path: path.join(out, `${id}.png`) });
    console.log(`shots/${id}.png`);
  }
  await browser.close();
  if (problems.length) {
    console.error("\n" + problems.join("\n"));
    process.exitCode = 1;
  }
})();
