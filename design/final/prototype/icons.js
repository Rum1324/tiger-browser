/* Tiger icon set. Own drawings: 16 px grid, 1.5 px stroke at every size, round caps and joins.
   One set for everything, including modifier keys, so no glyph depends on font coverage. */
const ICONS = {
  sidebar: '<rect x="2" y="3" width="12" height="10" rx="2.5"/><path d="M6 3v10"/>',
  back: '<path d="M9.75 3.75 5.5 8l4.25 4.25"/>',
  fwd: '<path d="M6.25 3.75 10.5 8l-4.25 4.25"/>',
  reload:
    '<path d="M13.25 8a5.25 5.25 0 1 1-1.54-3.71L13.25 5.8"/><path d="M13.25 2.75V5.8H10.2"/>',
  /* share = an arrow rising through an opening in a line: the tab crosses the threshold */
  cross: '<path d="M2.5 10h3M10.5 10h3M8 13.25V3.25M4.75 6.5 8 3.25l3.25 3.25"/>',
  /* unshare = the same arrow coming back down */
  uncross: '<path d="M2.5 6h3M10.5 6h3M8 2.75v10M4.75 9.5 8 12.75l3.25-3.25"/>',
  chat: '<path d="M13.5 7.5c0 2.76-2.46 5-5.5 5-.8 0-1.57-.16-2.26-.44L2.5 13l.9-2.6a4.6 4.6 0 0 1-.9-2.9c0-2.76 2.46-5 5.5-5s5.5 2.24 5.5 5Z"/>',
  person:
    '<circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.25c.6-2.3 2.6-3.75 5-3.75s4.4 1.45 5 3.75"/>',
  people:
    '<circle cx="6" cy="5.75" r="2.25"/><path d="M1.75 13c.5-2.1 2.2-3.4 4.25-3.4s3.75 1.3 4.25 3.4M10.5 3.7a2.25 2.25 0 0 1 0 4.1M12 9.9c1.2.5 2 1.6 2.3 3.1"/>',
  lock: '<rect x="3.25" y="7.25" width="9.5" height="6.25" rx="1.75"/><path d="M5.5 7.25V5.5a2.5 2.5 0 0 1 5 0v1.75"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  close: '<path d="m4.25 4.25 7.5 7.5M11.75 4.25l-7.5 7.5"/>',
  chevDown: '<path d="m4.5 6.25 3.5 3.5 3.5-3.5"/>',
  chevRight: '<path d="m6.25 4.5 3.5 3.5-3.5 3.5"/>',
  search: '<circle cx="7.25" cy="7.25" r="4.25"/><path d="m10.4 10.4 3.1 3.1"/>',
  globe:
    '<circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c1.6 1.5 2.4 3.4 2.4 5.5S9.6 12 8 13.5C6.4 12 5.6 10.1 5.6 8S6.4 4 8 2.5Z"/>',
  doc: '<path d="M4.75 2.25h4.5l3 3v7.5a1 1 0 0 1-1 1h-6.5a1 1 0 0 1-1-1v-9.5a1 1 0 0 1 1-1Z"/><path d="M9.25 2.25v3h3M6 8.5h4M6 11h4"/>',
  pdf: '<path d="M4.75 2.25h4.5l3 3v7.5a1 1 0 0 1-1 1h-6.5a1 1 0 0 1-1-1v-9.5a1 1 0 0 1 1-1Z"/><path d="M9.25 2.25v3h3"/><path d="M3.75 9h8.5v2.75H3.75z" fill="currentColor" stroke="none"/>',
  hash: '<path d="M6.25 2.75 5 13.25M11 2.75 9.75 13.25M3 6h10.5M2.5 10H13"/>',
  note: '<rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2"/><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3"/>',
  news: '<rect x="2.5" y="3" width="11" height="10" rx="1.75"/><path d="M5 6h3v3H5zM10.25 6h1M10.25 8.75h1M5 11h6.25"/>',
  bank: '<path d="M2.5 6.5 8 3l5.5 3.5M3.5 6.75h9M4.75 7v4.5M8 7v4.5M11.25 7v4.5M2.75 13h10.5"/>',
  mail: '<rect x="2.25" y="3.5" width="11.5" height="9" rx="2"/><path d="m2.75 5.25 5.25 3.75 5.25-3.75"/>',
  calendar:
    '<rect x="2.5" y="3.25" width="11" height="10.25" rx="2"/><path d="M2.5 6.75h11M5.5 2v2.25M10.5 2v2.25"/>',
  grid: '<rect x="2.5" y="3" width="11" height="10" rx="1.75"/><path d="M2.5 6.5h11M2.5 9.75h11M6.5 3v10"/>',
  more: '<circle cx="3.5" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.5" cy="8" r=".9" fill="currentColor"/>',
  check: '<path d="m3.5 8.5 3 3 6-7"/>',
  undo: '<path d="M5.5 3.5 2.75 6.25 5.5 9"/><path d="M2.75 6.25h6.5a3.5 3.5 0 0 1 0 7H7"/>',
  exportOut:
    '<path d="M9 2.75h4.25V7M13.25 2.75 7.5 8.5M11.5 9.5v2.75a1 1 0 0 1-1 1H3.75a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1H6.5"/>',
  copy: '<rect x="5.25" y="5.25" width="8" height="8" rx="1.75"/><path d="M10.75 5.25v-1.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1.5"/>',
  send: '<path d="M8 13V3.25M3.75 7.25 8 3l4.25 4.25"/>',
  sliders:
    '<path d="M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6"/><circle cx="10" cy="5" r="1.5"/><circle cx="6" cy="11" r="1.5"/>',
  eyeOff:
    '<path d="M6.3 4.1A6 6 0 0 1 8 3.85c4 0 6.25 4.15 6.25 4.15s-.6 1.1-1.75 2.2M10.9 11.4c-.8.45-1.8.75-2.9.75C4 12.15 1.75 8 1.75 8s.9-1.65 2.6-2.9M2.75 2.75l10.5 10.5"/>',
  clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.25l2 1.25"/>',
  glasses:
    '<circle cx="4.75" cy="10" r="2.25"/><circle cx="11.25" cy="10" r="2.25"/><path d="M7 10h2M2.5 6h11M5 6l.75-2.5h4.5L11 6"/>',
  shield: '<path d="M8 2.25 3 4v4c0 2.9 2.1 5 5 5.75 2.9-.75 5-2.85 5-5.75V4L8 2.25Z"/>',
  swap: '<path d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13"/>',
  arrowRight: '<path d="M3 8h9.5M9 4.5 12.5 8 9 11.5"/>',
  info: '<circle cx="8" cy="8" r="5.5"/><path d="M8 7.25v3.5"/><circle cx="8" cy="5.2" r=".6" fill="currentColor" stroke="none"/>',
  stop: '<rect x="4.5" y="4.5" width="7" height="7" rx="1.5"/>',
  /* a page of Tiger's own, a new tab */
  page: '<rect x="2.75" y="3.25" width="10.5" height="9.5" rx="2"/><path d="M2.75 6.25h10.5"/>',
  /* this Mac */
  laptop: '<rect x="3.25" y="3.5" width="9.5" height="6.75" rx="1.5"/><path d="M1.75 12.5h12.5"/>',
  /* attached to the next question only: a miniature of the dashed page frame */
  frame: '<rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2.5" stroke-dasharray="2.6 2.2" stroke-dashoffset="1.3"/>',
  slides: '<rect x="2.25" y="3.25" width="11.5" height="8" rx="1.75"/><path d="M8 11.25v2.25M5.75 13.5h4.5"/>',
  pin: '<path d="M9.5 2.5 13.5 6.5 11.25 7.25 9 9.5 8.75 12.25 3.75 7.25 6.5 7 8.75 4.75 9.5 2.5ZM6.25 9.75 2.75 13.25"/>',
  sound: '<path d="M2.75 6.5h2L8 3.75v8.5L4.75 9.5h-2v-3ZM10.5 6a2.8 2.8 0 0 1 0 4M12.25 4.25a5.3 5.3 0 0 1 0 7.5"/>',
  history: '<path d="M2.75 8a5.25 5.25 0 1 0 1.6-3.77L2.75 5.8"/><path d="M2.75 2.75V5.8H5.8M8 5.25V8l2 1.25"/>',
  bookmark: '<path d="M4.25 2.75h7.5v10.5L8 10.5l-3.75 2.75V2.75Z"/>',
  reader: '<path d="M2.75 3.5h3.5A1.75 1.75 0 0 1 8 5.25v7.5a1.5 1.5 0 0 0-1.5-1.5H2.75V3.5ZM13.25 3.5h-3.5A1.75 1.75 0 0 0 8 5.25v7.5a1.5 1.5 0 0 1 1.5-1.5h3.75V3.5Z"/>',
  retry: '<path d="M2.75 8a5.25 5.25 0 1 1 1.54 3.71L2.75 10.2"/><path d="M2.75 13.25V10.2H5.8"/>',
  filter: '<path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3"/>',
  thread: '<path d="M3 4.25h10M3 8h10M3 11.75h6"/>',
  invite: '<circle cx="6.5" cy="5.5" r="2.5"/><path d="M1.75 13.25c.5-2.3 2.4-3.75 4.75-3.75 1 0 1.95.27 2.75.75M12 9.25v4.5M9.75 11.5h4.5"/>',
  trash: '<path d="M3 4.5h10M6.25 4.5V3a.5.5 0 0 1 .5-.5h2.5a.5.5 0 0 1 .5.5v1.5M4.25 4.5l.5 8a1 1 0 0 0 1 1h4.5a1 1 0 0 0 1-1l.5-8M6.75 7v4M9.25 7v4"/>',
  keep: '<path d="M3.25 2.75h9.5v10.5h-9.5zM5.5 6h5M5.5 8.5h5M5.5 11h2.5"/>',
  dot: '<circle cx="8" cy="8" r="2" fill="currentColor" stroke="none"/>',
  warn: '<path d="M8 2.75 14 13H2L8 2.75Z"/><path d="M8 6.75v3"/><circle cx="8" cy="11.4" r=".6" fill="currentColor" stroke="none"/>',
  offline: '<path d="M2 6.25c1.7-1.6 3.8-2.4 6-2.4s4.3.8 6 2.4M4.25 8.75c1-.95 2.3-1.5 3.75-1.5s2.75.55 3.75 1.5M6.5 11.25c.4-.4.9-.6 1.5-.6s1.1.2 1.5.6M2.75 2.75l10.5 10.5"/>',
  key: '<circle cx="5.5" cy="10.5" r="2.75"/><path d="m7.5 8.5 5.75-5.75M10.75 5.25l1.75 1.75M9 7l1.25 1.25"/>',
  at: '<circle cx="8" cy="8" r="2.5"/><path d="M10.5 5.5v3.25a1.5 1.5 0 0 0 3 0V8A5.5 5.5 0 1 0 11 12.6"/>',
  kOpt: '<path d="M2.75 4.25h3.5l3.5 7.5h3.5M9.75 4.25h3.5"/>',
  kEsc: '<path d="M4 4h8M4 8h5M4 12h8M4 4v8"/>',
  /* modifier keys */
  kCmd: '<path d="M6 6h4v4H6zM6 6H4.25A1.75 1.75 0 1 1 6 4.25V6ZM10 6V4.25A1.75 1.75 0 1 1 11.75 6H10ZM10 10h1.75A1.75 1.75 0 1 1 10 11.75V10ZM6 10v1.75A1.75 1.75 0 1 1 4.25 10H6Z"/>',
  kShift: '<path d="M8 2.75 2.75 8.5H5.5v4.25h5V8.5h2.75L8 2.75Z"/>',
  kCtrl: '<path d="m4 8 4-4 4 4"/>',
  kReturn: '<path d="M12.5 3.5v4.25a1.5 1.5 0 0 1-1.5 1.5H4M6.5 6.5 3.75 9.25 6.5 12"/>',
  kUp: '<path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7"/>',
  kDown: '<path d="M8 3.5v9M4.5 9 8 12.5 11.5 9"/>',
};

function icon(name, size = 16, cls = "", weight = 1.5) {
  const body = ICONS[name];
  if (!body) throw new Error("unknown icon: " + name);
  /* the stroke stays 1.5 CSS px at every rendered size (1.25 inside key caps) */
  const stroke = Math.round((weight * 16 * 100) / size) / 100;
  return `<svg class="i ${cls}" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
