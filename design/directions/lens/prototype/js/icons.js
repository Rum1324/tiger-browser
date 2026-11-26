/* One icon set, drawn for Lens: 16 px grid, 1.5 px stroke, round caps and joins, no fills
   (except the three dots of "more"). Source glyphs are neutral shapes, not third-party logos. */
const ICON_PATHS = {
  /* navigation */
  back: '<path d="M10 3.5 5.5 8l4.5 4.5"/>',
  forward: '<path d="M6 3.5 10.5 8 6 12.5"/>',
  reload: '<path d="M13 8a5 5 0 1 1-1.46-3.54"/><path d="M11.75 1.9v2.75H9"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  chevron: '<path d="M4.5 6.5 8 10l3.5-3.5"/>',
  chevronRight: '<path d="M6.5 4.5 10 8l-3.5 3.5"/>',
  close: '<path d="M4.25 4.25l7.5 7.5M11.75 4.25l-7.5 7.5"/>',
  check: '<path d="M3.5 8.5l3 3 6-7"/>',
  search: '<circle cx="7" cy="7" r="4.25"/><path d="M10.2 10.2 13.25 13.25"/>',
  more: '<circle cx="3.5" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1" fill="currentColor" stroke="none"/>',

  /* Lens verbs */
  frame: '<path d="M2.5 5.75V4.5a2 2 0 0 1 2-2h1.25M10.25 2.5h1.25a2 2 0 0 1 2 2v1.25M13.5 10.25v1.25a2 2 0 0 1-2 2h-1.25M5.75 13.5H4.5a2 2 0 0 1-2-2v-1.25"/><path d="M8 5.75v4.5M5.75 8h4.5"/>',
  frameOff: '<path d="M2.5 5.75V4.5a2 2 0 0 1 2-2h1.25M10.25 2.5h1.25a2 2 0 0 1 2 2v1.25M13.5 10.25v1.25a2 2 0 0 1-2 2h-1.25M5.75 13.5H4.5a2 2 0 0 1-2-2v-1.25"/><path d="M5.75 8h4.5"/>',
  inspector: '<rect x="2" y="3" width="12" height="10" rx="2"/><path d="M10 3v10"/>',
  clip: '<path d="M12.6 7.6 8.2 12a2.9 2.9 0 0 1-4.1-4.1l4.9-4.9a1.95 1.95 0 0 1 2.75 2.75L6.9 10.6a.97.97 0 0 1-1.37-1.37L9.6 5.15"/>',
  send: '<path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7"/>',
  stop: '<rect x="4.5" y="4.5" width="7" height="7" rx="1.5"/>',
  undo: '<path d="M5.5 3 2.5 6l3 3"/><path d="M2.5 6h6.75a3.75 3.75 0 0 1 0 7.5H7"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-1A1.5 1.5 0 0 0 9 3H4.5A1.5 1.5 0 0 0 3 4.5V9a1.5 1.5 0 0 0 1.5 1.5h1"/>',
  exportOut: '<path d="M12.5 9.5V12A1.5 1.5 0 0 1 11 13.5H4A1.5 1.5 0 0 1 2.5 12V5A1.5 1.5 0 0 1 4 3.5h2.5"/><path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5"/>',
  thread: '<path d="M2.5 4.5A1.5 1.5 0 0 1 4 3h8a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 12 11H7.25L4.5 13.25V11H4a1.5 1.5 0 0 1-1.5-1.5z"/>',
  history: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/>',
  enter: '<path d="M12.5 4v4A1.5 1.5 0 0 1 11 9.5H4"/><path d="M6.5 7 4 9.5 6.5 12"/>',
  lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7"/>',
  eyeOff: '<path d="M6.3 4.3A6 6 0 0 1 8 4c3.8 0 6 4 6 4a10 10 0 0 1-1.6 2.1M10.6 11.4A6 6 0 0 1 8 12c-3.8 0-6-4-6-4a10 10 0 0 1 2.3-2.7"/><path d="M2.75 2.75l10.5 10.5"/>',
  people: '<circle cx="6" cy="5.5" r="2.25"/><path d="M2 13c0-2.2 1.8-3.75 4-3.75s4 1.55 4 3.75"/><path d="M10.5 3.4a2.25 2.25 0 0 1 0 4.2M11.75 9.6c1.4.5 2.25 1.75 2.25 3.4"/>',
  person: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5c0-2.5 2.2-4.25 5-4.25s5 1.75 5 4.25"/>',
  link: '<path d="M6.75 9.25a2.75 2.75 0 0 0 3.9 0l2-2a2.75 2.75 0 0 0-3.9-3.9l-.6.6"/><path d="M9.25 6.75a2.75 2.75 0 0 0-3.9 0l-2 2a2.75 2.75 0 0 0 3.9 3.9l.6-.6"/>',
  info: '<circle cx="8" cy="8" r="5.5"/><path d="M8 7.25v3.5"/><circle cx="8" cy="5.1" r=".6" fill="currentColor" stroke="none"/>',
  swap: '<path d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13"/>',

  /* neutral source glyphs */
  doc: '<path d="M4.5 2.5h5l3 3V12.5a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/><path d="M9.5 2.5v3h3M6 8.5h4M6 11h4"/>',
  pdf: '<path d="M4.5 2.5h5l3 3V12.5a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/><path d="M9.5 2.5v3h3"/><path d="M6 8.75h4v2.5H6z"/>',
  sheet: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M2.5 9.75h11M6.5 3v10"/>',
  hash: '<path d="M6.5 2.75 5.25 13.25M10.75 2.75 9.5 13.25M3 6h10.25M2.75 10H13"/>',
  blocks: '<rect x="2.5" y="2.75" width="11" height="4" rx="1"/><rect x="2.5" y="9.25" width="4.5" height="4" rx="1"/><rect x="9" y="9.25" width="4.5" height="4" rx="1"/>',
  news: '<path d="M2.75 3.5h8.5V12a1.5 1.5 0 0 0 1.5 1.5H4.25a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M11.25 6.5h2.25V12a1.5 1.5 0 0 1-.75 1.3M5.25 6.25h3.5M5.25 8.5h3.5M5.25 10.75h3.5"/>',
  bank: '<path d="M2.5 6.25 8 2.75l5.5 3.5zM4.25 6.25v5M8 6.25v5M11.75 6.25v5M3 11.25h10M2.5 13.25h11"/>',
  mail: '<rect x="2.5" y="3.5" width="11" height="9" rx="1.5"/><path d="M3 4.75 8 8.5l5-3.75"/>',
  globe: '<circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c1.7 1.5 2.5 3.3 2.5 5.5S9.7 12 8 13.5M8 2.5C6.3 4 5.5 5.8 5.5 8S6.3 12 8 13.5"/>',
};

function icon(name, size = 16, cls = '') {
  const body = ICON_PATHS[name];
  if (!body) throw new Error('unknown icon ' + name);
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
