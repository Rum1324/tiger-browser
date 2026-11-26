/* Router: index.html?screen=<id>[&theme=dark]. Then draws the frame rings that need real geometry. */
(function () {
  const params = new URLSearchParams(location.search);
  const id = params.get('screen') || '01-browse';
  const theme = params.get('theme') || 'light';
  const build = SCREENS[id];
  const app = document.getElementById('app');
  if (!build) {
    app.textContent = 'unknown screen: ' + id + '. Known: ' + Object.keys(SCREENS).join(', ');
    return;
  }
  document.title = 'Lens ・ ' + id;
  app.innerHTML = build({ theme });
  document.querySelectorAll('[data-ring]').forEach(drawRing);
  /* The palette grows out of the tab well: same left edge, same width, so it reads as the field opening. */
  document.querySelectorAll('.pal').forEach((pal) => {
    const well = pal.closest('.win').querySelector('.tabs').getBoundingClientRect();
    pal.style.left = well.left - 2 + 'px';
    pal.style.top = well.top - 2 + 'px';
    pal.style.width = well.width + 4 + 'px';
  });
  if (id === '09-signature-live') app.addEventListener('click', () => location.reload());
  document.documentElement.dataset.ready = '1';

  /**
   * Rings are chrome pixels in the 3 px frame between the mount edge and the page.
   * once    : dashed, ink. The page goes to the model once, with the next message.
   * pending : dashed, Space colour. The share preview is open; nothing has been sent.
   * drawing : the signature mid-flight. Two arms rise from the strip and meet at top centre.
   * live    : the same arms, animated with the motion tokens (see chrome.css).
   */
  function drawRing(el) {
    const kind = el.dataset.ring;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const cs = getComputedStyle(el);
    const f = parseFloat(cs.getPropertyValue('--frame')) || 3;
    const r = (parseFloat(cs.getPropertyValue('--r-mount')) || 13) - f / 2;
    const o = f / 2;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ring ring--' + kind);
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    if (kind === 'drawing' || kind === 'live') {
      const p = kind === 'live' ? 1 : parseFloat(el.dataset.progress || '0.5');
      const strip = el.querySelector('.strip');
      const y0 = h - strip.offsetHeight;
      const arm = (d) => `<path d="${d}" pathLength="1" stroke-dasharray="${p} 1"/>`;
      svg.innerHTML =
        arm(`M${o} ${y0}V${o + r}A${r} ${r} 0 0 1 ${o + r} ${o}H${w / 2}`) +
        arm(`M${w - o} ${y0}V${o + r}A${r} ${r} 0 0 0 ${w - o - r} ${o}H${w / 2}`);
    } else {
      /* dash 8, gap 5, fitted so the pattern closes without a short dash */
      const per = 2 * (w - 2 * o - 2 * r) + 2 * (h - 2 * o - 2 * r) + 2 * Math.PI * r;
      const n = Math.round(per / 13);
      const unit = per / n;
      svg.innerHTML = `<rect x="${o}" y="${o}" width="${w - f}" height="${h - f}" rx="${r}" stroke-dasharray="${(unit * 0.62).toFixed(3)} ${(unit * 0.38).toFixed(3)}"/>`;
    }
    el.appendChild(svg);
  }
})();
