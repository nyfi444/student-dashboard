/* ── Minimal line-icon set, replaces all emoji/glyphs app-wide ──
   Hand-drawn 24x24 stroke icons so the whole app reads as one
   consistent design system instead of mixed emoji + text symbols.
──────────────────────────────────────────────────────────────── */
const ICON_PATHS = {
  home: '<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v10h12V10"/><path d="M10 20v-6h4v6"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3.2v3.6M16 3.2v3.6M3.5 10h17"/>',
  'check-square': '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
  'graduation-cap': '<path d="M2 9.5 12 5l10 4.5-10 4.5-10-4.5Z"/><path d="M6 12v4.5c0 1.2 2.7 3 6 3s6-1.8 6-3V12"/><path d="M21 10v5.5"/>',
  'clipboard-list': '<rect x="5.5" y="4.5" width="13" height="16" rx="2"/><path d="M9 4V3.2A1.2 1.2 0 0 1 10.2 2h3.6A1.2 1.2 0 0 1 15 3.2V4"/><path d="M8.5 10h7M8.5 13.5h7M8.5 17h4.5"/>',
  'file-text': '<path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/><path d="M14 3.5V8h4"/><path d="M8.5 12.5h7M8.5 15.5h7M8.5 18.5h4"/>',
  folder: '<path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.2l1.6 2H19a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5A1.5 1.5 0 0 1 3.5 17.5v-11Z"/>',
  'folder-open': '<path d="M3.5 8.5A1.5 1.5 0 0 1 5 7h3.7l1.6 2H19a1.5 1.5 0 0 1 1.45 1.87l-1.2 5.5A1.5 1.5 0 0 1 17.8 17.6H5A1.5 1.5 0 0 1 3.5 16.1v-7.6Z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  'book-open': '<path d="M12 6.5c-1.6-1.3-4-2-7-2v12.5c3 0 5.4.7 7 2 1.6-1.3 4-2 7-2V4.5c-3 0-5.4.7-7 2Z"/><path d="M12 6.5V19"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/><path d="M9.5 2.5h5M12 2.5V5"/>',
  layers: '<path d="M12 3.5 21 8l-9 4.5L3 8l9-4.5Z"/><path d="M3 12l9 4.5 9-4.5"/><path d="M3 16l9 4.5 9-4.5"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5"/><path d="M16 5.8a3.2 3.2 0 0 1 0 6.2"/><path d="M18.5 14.3c2 .5 3.5 2.2 3.5 4.7"/>',
  // A toothed gear, so Settings never reads as the sun ('Focus on today').
  settings: '<path d="M12.22 2.5h-.44a1.9 1.9 0 0 0-1.9 1.9v.17a1.9 1.9 0 0 1-.95 1.64l-.41.24a1.9 1.9 0 0 1-1.9 0l-.14-.08a1.9 1.9 0 0 0-2.6.7l-.21.36a1.9 1.9 0 0 0 .7 2.6l.14.09a1.9 1.9 0 0 1 .95 1.63v.49a1.9 1.9 0 0 1-.95 1.65l-.14.08a1.9 1.9 0 0 0-.7 2.6l.21.36a1.9 1.9 0 0 0 2.6.7l.14-.08a1.9 1.9 0 0 1 1.9 0l.41.24a1.9 1.9 0 0 1 .95 1.64v.17a1.9 1.9 0 0 0 1.9 1.9h.44a1.9 1.9 0 0 0 1.9-1.9v-.17a1.9 1.9 0 0 1 .95-1.64l.41-.24a1.9 1.9 0 0 1 1.9 0l.14.08a1.9 1.9 0 0 0 2.6-.7l.21-.37a1.9 1.9 0 0 0-.7-2.6l-.14-.08a1.9 1.9 0 0 1-.95-1.65v-.47a1.9 1.9 0 0 1 .95-1.65l.14-.09a1.9 1.9 0 0 0 .7-2.6l-.21-.36a1.9 1.9 0 0 0-2.6-.7l-.14.08a1.9 1.9 0 0 1-1.9 0l-.41-.24a1.9 1.9 0 0 1-.95-1.64V4.4a1.9 1.9 0 0 0-1.9-1.9Z"/><circle cx="12" cy="12" r="3"/>',
  check: '<path d="M5 12.5 10 17.5 19 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4.5 7h15"/><path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2"/><path d="M7 7l1 12.5a1.5 1.5 0 0 0 1.5 1.4h5a1.5 1.5 0 0 0 1.5-1.4L17 7"/><path d="M10.5 11v6M13.5 11v6"/>',
  pencil: '<path d="M4 20l.7-3.8L15.9 5a1.6 1.6 0 0 1 2.3 0l.8.8a1.6 1.6 0 0 1 0 2.3L7.8 19.3 4 20Z"/><path d="M14.5 6.4l3.1 3.1"/>',
  'map-pin': '<path d="M12 21.5s7-6.3 7-11.8A7 7 0 0 0 5 9.7c0 5.5 7 11.8 7 11.8Z"/><circle cx="12" cy="9.8" r="2.3"/>',
  sparkles: '<path d="M11 3l1 3.6L15.5 8 12 9.4 11 13l-1-3.6L6.5 8 10 6.6 11 3Z"/><path d="M18.3 13l.6 2 2 .6-2 .6-.6 2-.6-2-2-.6 2-.6.6-2Z"/>',
  'refresh-cw': '<path d="M20 11A8 8 0 0 0 6.3 6.3L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M4 13a8 8 0 0 0 13.7 4.7L20 15.5"/><path d="M20 20v-4.5h-4.5"/>',
  upload: '<path d="M12 15.5V4.5M8 8.5 12 4.5 16 8.5"/><path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  download: '<path d="M12 4.5v11M8 12l4 4 4-4"/><path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  // Open a capped section out to full size, and put it back again.
  maximize: '<path d="M9 4.5H4.5V9M15 4.5h4.5V9M9 19.5H4.5V15M15 19.5h4.5V15"/>',
  minimize: '<path d="M4.5 9H9V4.5M19.5 9H15V4.5M4.5 15H9v4.5M19.5 15H15v4.5"/>',
  'chevron-left': '<path d="M15 5.5 8 12l7 6.5"/>',
  'chevron-right': '<path d="M9 5.5 16 12l-7 6.5"/>',
  // A coffee cup, for breaks and holidays on the calendar.
  coffee: '<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><path d="M6 2v2M10 2v2M14 2v2"/>',
  'cloud-sun': '<circle cx="8" cy="7.5" r="2.7"/><path d="M8 2.5v1.3M4 5.4l.9.9M12 5.4l-.9.9"/><path d="M8.5 20h8a3.5 3.5 0 0 0 .6-6.95A5 5 0 0 0 8 12.2"/>',
  flag: '<path d="M6 21V4"/><path d="M6 4.5c1.6-1 3.4-1 5 0s3.4 1 5 0v9c-1.6 1-3.4 1-5 0s-3.4-1-5 0Z"/>',
  'panel-left': '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1 0 1.6-.6 1.6-1.4 0-.4-.2-.7-.2-1.1 0-.8.7-1.4 1.5-1.4h1.6c2.6 0 4.5-1.8 4.5-4.6 0-4.7-4-8.5-9-8.5Z"/><circle cx="7.7" cy="10.5" r="1.15" fill="currentColor" stroke="none"/><circle cx="11.3" cy="7.3" r="1.15" fill="currentColor" stroke="none"/><circle cx="15.7" cy="8.3" r="1.15" fill="currentColor" stroke="none"/>',
  play: '<path d="M6.5 4.5v15l13-7.5Z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="5" width="4.5" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4.5" height="14" rx="1" fill="currentColor" stroke="none"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v3M12 18.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.8 6.8 0 0 0 20 14.5Z"/>',
  paperclip: '<path d="M8 12.5 15.5 5a3 3 0 0 1 4.2 4.2l-9 9a5 5 0 0 1-7-7l8.5-8.4"/>',
  star: '<path d="M12 3.5l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6-4.5-4.1 6-.7Z"/>',
  pin: '<path d="M9 4.5h6l.7 4.3 2.3 1.6-1 2.6H7l-1-2.6 2.3-1.6Z"/><path d="M12 13v7"/>',
  link: '<path d="M9.5 14.5 14.5 9.5"/><path d="M11 7.5l1.5-1.5a3.5 3.5 0 0 1 5 5L16 12.5"/><path d="M13 16.5 11.5 18a3.5 3.5 0 0 1-5-5L8 11.5"/>',
  shuffle: '<path d="M3 7h3.5L15 17h6"/><path d="M17.5 5.5 21 7l-3.5 1.5M17.5 18.5 21 17l-3.5-1.5"/><path d="M3 17h3.5L11 12"/><path d="M12.5 9.5 15 7"/>',
  'grip-vertical': '<circle cx="9" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.1" fill="currentColor" stroke="none"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.7"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>',
  'message-circle': '<path d="M20.5 11.5a8 8 0 0 1-11.8 7L3.5 20l1.5-4.7A8 8 0 1 1 20.5 11.5Z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
  send: '<path d="M21 3 10.5 13.5"/><path d="M21 3l-6.5 18-4-7.5L3 9.5Z"/>',
  'user-plus': '<circle cx="9.5" cy="8" r="3.5"/><path d="M3 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M19 8v6M16 11h6"/>',
  'log-out': '<path d="M9.5 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3.5"/><path d="M15.5 16.5 20 12l-4.5-4.5M20 12H9.5"/>',
  'arrow-left': '<path d="M19 12H5M11 5.5 4.5 12l6.5 6.5"/>',
  'more-horizontal': '<circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2H4.5Z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  briefcase: '<rect x="3.5" y="7" width="17" height="12.5" rx="2"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/><path d="M3.5 12.5h17"/>',
  bookmark: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-3.8L6 20V5a1 1 0 0 1 1-1Z"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.5-2h5.6l1.5 2h2.2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5Z"/><circle cx="12" cy="13" r="3.4"/>',
  share: '<path d="M12 15V4M8 7.5 12 4l4 3.5"/><path d="M5.5 12v6.5A1.5 1.5 0 0 0 7 20h10a1.5 1.5 0 0 0 1.5-1.5V12"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z"/><path d="M9 12l2 2 4-4"/>',
  megaphone: '<path d="M4 10v4a1 1 0 0 0 1 1h2l5 4V5L7 9H5a1 1 0 0 0-1 1Z"/><path d="M16 8.5a5 5 0 0 1 0 7"/><path d="M18.5 6a8.5 8.5 0 0 1 0 12"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8.5 20h7M10 17h4"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  // Added with the v2 design: search, the notebook format group, log in, notices.
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  'list-ordered': '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 6h1v4M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  'text-quote': '<path d="M17 6H3M21 12H8M21 18H8M3 12v6"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  minus: '<path d="M5 12h14"/>',
  highlighter: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  type: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
  'remove-formatting': '<path d="M4 7V4h16v3"/><path d="M5 20h6"/><path d="M13 4 8 20"/><path d="m15 15 5 5M20 15l-5 5"/>',
  'log-in': '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  'alert-circle': '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  'help-circle': '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7"/><path d="M12 17h.01"/>',
  'arrow-up-right': '<path d="M7.5 16.5 16.5 7.5"/><path d="M9 7.5h7.5V15"/>',
  video: '<rect x="3" y="6.5" width="12.5" height="11" rx="2.5"/><path d="m15.5 10.5 5-3v9l-5-3"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'arrow-up-down': '<path d="m21 16-4 4-4-4M17 20V4M3 8l4-4 4 4M7 4v16"/>',
  'folder-plus': '<path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.2l1.6 2H19a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5A1.5 1.5 0 0 1 3.5 17.5v-11Z"/><path d="M12 10.5v5M9.5 13h5"/>',
  // Notebook pictures and tables (js/notebook-media.js).
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.7"/><path d="m4 18 5.5-5.5 4 4 2.5-2.5 4.5 4.5"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M3.5 14.5h17M10 4.5v15"/>',
  'img-left': '<rect x="3.5" y="5" width="8" height="7" rx="1.5"/><path d="M14.5 6h6M14.5 9h6M14.5 12h6M3.5 16h17M3.5 19.5h12"/>',
  'img-right': '<rect x="12.5" y="5" width="8" height="7" rx="1.5"/><path d="M3.5 6h6M3.5 9h6M3.5 12h6M3.5 16h17M3.5 19.5h12"/>',
  'img-center': '<rect x="7" y="4" width="10" height="8" rx="1.5"/><path d="M3.5 16h17M3.5 19.5h17"/>',
  'img-full': '<rect x="3.5" y="4" width="17" height="10" rx="1.5"/><path d="M3.5 18h17"/>',
};
// One stroke weight on screen at every size: about 1.25px whether the icon
// is drawn at 12 or 22. The width argument is kept for callers but only
// 'check' uses it (as a floor), so a checkmark stays bold inside a filled box.
// Output is aria-hidden, so a button's name is always its own text or label.
function icon(name, size = 16, strokeWidth) {
  const path = ICON_PATHS[name];
  if (!path) return '';
  const sw = name === 'check' ? Math.max(strokeWidth || 0, 2) : Math.min(2.2, Math.max(1.4, 30 / size));
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${+sw.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;
}
function checkGlyph(on, size = 12) { return on ? icon('check', size, 2.4) : ''; }
