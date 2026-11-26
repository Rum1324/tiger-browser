/*
 * Paper icon set. One grid (16 px), one stroke (1.5 px), round caps and joins, no fills.
 * Source glyphs (doc, table, hash, pdf, globe, bank, mail) are neutral drawings, not vendor logos.
 */
;(() => {
  const P = {
    back: '<path d="M9.75 3.25 5 8l4.75 4.75"/>',
    fwd: '<path d="M6.25 3.25 11 8l-4.75 4.75"/>',
    reload:
      '<path d="M13.25 8A5.25 5.25 0 1 1 8 2.75c1.47 0 2.88.59 3.93 1.6l1.32 1.32"/><path d="M13.25 2.5v3.17h-3.17"/>',
    sidebar: '<rect x="2.25" y="3.25" width="11.5" height="9.5" rx="2"/><path d="M6.25 3.25v9.5"/>',
    chevDown: '<path d="M4.25 6.25 8 10l3.75-3.75"/>',
    chevRight: '<path d="M6.25 4.25 10 8l-3.75 3.75"/>',
    plus: '<path d="M8 3.25v9.5M3.25 8h9.5"/>',
    close: '<path d="m4 4 8 8M12 4l-8 8"/>',
    search: '<circle cx="7" cy="7" r="4.25"/><path d="m10.25 10.25 3.25 3.25"/>',
    lock: '<rect x="3.25" y="7.25" width="9.5" height="6" rx="1.5"/><path d="M5.5 7.25V5.5a2.5 2.5 0 0 1 5 0v1.75"/>',
    /* share: an arrow raised across a line. unshare: lowered back across it. */
    share: '<path d="M2.5 9.75h3.25M10.25 9.75h3.25"/><path d="M8 13.25v-10M4.75 6 8 2.75 11.25 6"/>',
    unshare: '<path d="M2.5 6.25h3.25M10.25 6.25h3.25"/><path d="M8 2.75v10M4.75 10 8 13.25 11.25 10"/>',
    ask: '<path d="M2.75 5A2.25 2.25 0 0 1 5 2.75h6A2.25 2.25 0 0 1 13.25 5v3.75A2.25 2.25 0 0 1 11 11H8.25l-3.5 2.5V11A2 2 0 0 1 2.75 9z"/>',
    ruled:
      '<rect x="2.25" y="2.25" width="11.5" height="11.5" rx="1.5"/><path d="M5.5 2.25v11.5M5.5 6h8.25M5.5 9.75h8.25"/>',
    doc: '<rect x="3.25" y="2.25" width="9.5" height="11.5" rx="1.5"/><path d="M5.75 5.75h4.5M5.75 8h4.5M5.75 10.25h2.5"/>',
    pdf: '<path d="M9.25 2.25h-4.5a1.5 1.5 0 0 0-1.5 1.5v8.5a1.5 1.5 0 0 0 1.5 1.5h6.5a1.5 1.5 0 0 0 1.5-1.5v-6.5z"/><path d="M9.25 2.25v3.5h3.5"/><path d="M5.75 10.25h4.5"/>',
    table: '<rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.5"/><path d="M2.25 6.75h11.5M6.5 6.75v6"/>',
    hash: '<path d="M6.25 2.75 5 13.25M11 2.75 9.75 13.25M2.75 6h10.75M2.25 10H13"/>',
    globe:
      '<circle cx="8" cy="8" r="5.25"/><path d="M2.75 8h10.5M8 2.75c1.6 1.4 2.4 3.15 2.4 5.25S9.6 11.85 8 13.25c-1.6-1.4-2.4-3.15-2.4-5.25S6.4 4.15 8 2.75z"/>',
    bank: '<path d="M2.75 6.25 8 3l5.25 3.25zM4.5 8.5v2.5M8 8.5v2.5M11.5 8.5v2.5M2.75 13.25h10.5"/>',
    mail: '<rect x="2.25" y="3.75" width="11.5" height="8.5" rx="1.5"/><path d="m2.75 5 5.25 4 5.25-4"/>',
    check: '<path d="m3.5 8.5 3 3 6-6.75"/>',
    undo: '<path d="M5.75 3.5 3 6.25 5.75 9"/><path d="M3.25 6.25H9.5a3.5 3.5 0 0 1 0 7H7"/>',
    exportOut:
      '<path d="M9.25 2.75h4v4M13 3 7.75 8.25"/><path d="M11.25 9.5v2.25a1.5 1.5 0 0 1-1.5 1.5h-5.5a1.5 1.5 0 0 1-1.5-1.5v-5.5a1.5 1.5 0 0 1 1.5-1.5H6.5"/>',
    copy: '<rect x="5.75" y="5.75" width="7.5" height="7.5" rx="1.5"/><path d="M10.25 5.75v-1.5a1.5 1.5 0 0 0-1.5-1.5h-4.5a1.5 1.5 0 0 0-1.5 1.5v4.5a1.5 1.5 0 0 0 1.5 1.5h1.5"/>',
    send: '<path d="M8 12.75v-9.5M4 7l4-4 4 4"/>',
    clock: '<circle cx="8" cy="8" r="5.25"/><path d="M8 5v3.25l2 1.25"/>',
    sliders:
      '<path d="M2.75 5h5M11.5 5h1.75M2.75 11h1.75M8.25 11h5"/><circle cx="9.5" cy="5" r="1.75"/><circle cx="6.25" cy="11" r="1.75"/>',
    block: '<circle cx="8" cy="8" r="5.25"/><path d="m4.3 4.3 7.4 7.4"/>',
    users:
      '<circle cx="6" cy="5.5" r="2.25"/><path d="M2 13c.35-2.1 1.9-3.25 4-3.25S9.65 10.9 10 13"/><path d="M10.25 3.4a2.25 2.25 0 0 1 0 4.2M12 10.1c1.1.5 1.8 1.5 2 2.9"/>',
    arrowRight: '<path d="M3.25 8h9.5M9 4.25 12.75 8 9 11.75"/>',
    filter: '<path d="M2.75 4.5h10.5M4.75 8h6.5M6.75 11.5h2.5"/>',
    more: '<path d="M3.5 8h.01M8 8h.01M12.5 8h.01"/>',
  }

  window.icon = (name, cls = '') => {
    if (!P[name]) throw new Error(`icon: ${name}`)
    return `<svg class="ic ${cls}" viewBox="0 0 16 16" aria-hidden="true">${P[name]}</svg>`
  }
})()
