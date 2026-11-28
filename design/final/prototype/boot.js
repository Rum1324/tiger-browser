/* Draws the two page lines, anchors free overlays and boots a screen. Loaded last, after every
   file that registers screens (screens.js, screens2.js, sheet.js). */

/* ───────── the two lines around a page card ─────────
   Ring (inner lane, 3 px, Space colour): closed = the Space holds this version; open = it holds an
   older one (the top edge is missing between two stubs). Frame (outer lane, 2 px, ink, dashed):
   the page is attached to the next question. Both are chrome pixels in the gutter. */
function drawEdges(root = document) {
  root.querySelectorAll(".card--page, .mini-card").forEach((card) => {
    const mini = card.classList.contains("mini-card");
    const ring = mini ? { closed: "closed", open: "open" }[card.parentElement.dataset.kind] || "" : card.dataset.ring;
    const frame = mini ? card.parentElement.dataset.kind === "frame" : card.dataset.frame === "on";
    if (!ring && !frame) return;
    const cs = getComputedStyle(card);
    const px = (name) => parseFloat(cs.getPropertyValue(name));
    const R = mini ? 4 : px("--r-card");
    const RW = mini ? 2 : px("--ring");
    const GAP = px("--ring-gap");
    const FW = mini ? 1.5 : px("--frame");
    const LID = mini ? 5 : px("--ring-lid");
    const P = 7;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    let out = "";
    if (ring) {
      const o = RW / 2;
      const x0 = P - o, y0 = P - o, x1 = P + w + o, y1 = P + h + o, r = R + o;
      const cx = (x0 + x1) / 2;
      if (ring === "closed" && card.dataset.anim === "close") {
        /* two arms from the bottom centre that meet at the top centre (motion 6.1) */
        const arm = (xa, sweep) =>
          `<path class="edge-ring edge-ring--arm" pathLength="1" style="stroke-width:${RW}" d="M${cx} ${y1}H${xa === x0 ? x0 + r : x1 - r}A${r} ${r} 0 0 ${sweep} ${xa} ${y1 - r}V${y0 + r}A${r} ${r} 0 0 ${sweep} ${xa === x0 ? x0 + r : x1 - r} ${y0}H${cx}"/>`;
        out += arm(x0, 1) + arm(x1, 0);
      } else if (ring === "closed") out += `<rect class="edge-ring" x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="${r}" style="stroke-width:${RW}"/>`;
      else
        out += `<path class="edge-ring" style="stroke-width:${RW}" d="M${x0 + r + LID} ${y0}H${x0 + r}A${r} ${r} 0 0 0 ${x0} ${y0 + r}V${y1 - r}A${r} ${r} 0 0 0 ${x0 + r} ${y1}H${x1 - r}A${r} ${r} 0 0 0 ${x1} ${y1 - r}V${y0 + r}A${r} ${r} 0 0 0 ${x1 - r} ${y0}H${x1 - r - LID}"/>`;
    }
    if (frame) {
      const d = (mini ? (ring ? RW + GAP : 0) : RW + GAP) + FW / 2;
      const fw = w + 2 * d, fh = h + 2 * d, r = R + d;
      const per = 2 * (fw + fh) - 8 * r + 2 * Math.PI * r;
      const dash = px("--frame-dash") * (mini ? 0.5 : 1);
      const n = Math.round(per / (dash + px("--frame-space") * (mini ? 0.5 : 1)));
      const space = per / n - dash;
      out += `<rect class="edge-frame" x="${P - d}" y="${P - d}" width="${fw}" height="${fh}" rx="${r}" style="stroke-width:${FW}" stroke-dasharray="${dash} ${space}"/>`;
    }
    card.insertAdjacentHTML("beforeend", `<svg class="edge" width="${w + 2 * P}" height="${h + 2 * P}" viewBox="0 0 ${w + 2 * P} ${h + 2 * P}" aria-hidden="true">${out}</svg>`);
  });
}

/* anchors a free overlay (popover, menu) to its trigger.
   Declarative form: data-anchor="<selector of the trigger>" data-side="below|above"
   data-align="left|right" on the surface; 6 px between trigger and surface. */
function place() {
  const at = (el, trigger, { above = false, alignRight = false, gap = 6, dx = 0 } = {}) => {
    if (!el || !trigger) return;
    const t = trigger.getBoundingClientRect();
    const s = el.parentElement.getBoundingClientRect();
    if (above) el.style.bottom = `${Math.round(s.bottom - t.top + gap)}px`;
    else el.style.top = `${Math.round(t.bottom - s.top + gap)}px`;
    if (alignRight) el.style.right = `${Math.round(s.right - t.right - dx)}px`;
    else el.style.left = `${Math.round(t.left - s.left + dx)}px`;
  };
  at(document.getElementById("pop-state"), document.querySelector(".st-main.is-open"), { alignRight: true });
  at(document.getElementById("model-menu"), document.querySelector(".model-btn.is-open"), { above: true });
  document.querySelectorAll("[data-anchor]").forEach((el) =>
    at(el, document.querySelector(el.dataset.anchor), {
      above: el.dataset.side === "above",
      alignRight: el.dataset.align === "right",
      gap: el.dataset.gap ? Number(el.dataset.gap) : 6,
      dx: el.dataset.dx ? Number(el.dataset.dx) : 0,
    }),
  );
}

(function boot() {
  const q = new URLSearchParams(location.search);
  const id = q.get("screen");
  const root = document.getElementById("root");
  const theme = q.get("theme") || (id && /^\d+-dark-|-dark$/.test(id) ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  if (!id || !SCREENS[id]) {
    root.innerHTML = `<nav class="index"><h1>Tiger</h1><ul>${Object.keys(SCREENS)
      .map((k) => `<li><a href="?screen=${k}">${k}</a></li>`)
      .join("")}</ul></nav>`;
    return;
  }
  /* &hue=<SpaceHue> previews 資金調達 2027 in any of the nine hues */
  if (q.get("hue")) SPACES.fund.hue = q.get("hue");
  document.title = `Tiger — ${id}`;
  root.innerHTML = SCREENS[id]();
  /* the component sheet is a document, not a window: it may be taller than 900 px */
  if (root.querySelector(".specsheet")) document.body.classList.add("is-sheet");
  const sc = document.querySelector(".pocket-scroll[data-scroll]");
  if (sc) sc.scrollTop = Number(sc.dataset.scroll);
  document.fonts.ready.then(() => {
    document.querySelectorAll(".card.is-closing").forEach((c) => (c.dataset.anim = "close"));
    drawEdges();
    place();
    /* the ghost of the tab row starts on its tab and lands on the first slot of the shelf */
    const ghost = document.getElementById("ghost");
    if (ghost) {
      const side = ghost.parentElement.getBoundingClientRect();
      const slot = document.querySelector(".items .item").getBoundingClientRect();
      const tab = document.querySelector(".tab.is-active").getBoundingClientRect();
      ghost.style.top = `${slot.top - side.top + 6}px`;
      ghost.style.setProperty("--from", `${tab.top - slot.top - 6}px`);
    }
    const t = q.get("t");
    if (t !== null) for (const a of document.getAnimations()) (a.pause(), (a.currentTime = Number(t)));
    document.documentElement.dataset.ready = "1";
  });
})();
