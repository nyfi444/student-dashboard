/* ── Minimal line-icon set — replaces all emoji/glyphs app-wide ──
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
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.2 6.2l2.2 2.2M17.6 15.6l2.2 2.2M2.5 12h3M18.5 12h3M4.2 17.8l2.2-2.2M17.6 8.4l2.2-2.2"/>',
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
  'chevron-left': '<path d="M15 5.5 8 12l7 6.5"/>',
  'chevron-right': '<path d="M9 5.5 16 12l-7 6.5"/>',
  'cloud-sun': '<circle cx="8" cy="7.5" r="2.7"/><path d="M8 2.5v1.3M4 5.4l.9.9M12 5.4l-.9.9"/><path d="M8.5 20h8a3.5 3.5 0 0 0 .6-6.95A5 5 0 0 0 8 12.2"/>',
  flag: '<path d="M6 21V4"/><path d="M6 4.5c1.6-1 3.4-1 5 0s3.4 1 5 0v9c-1.6 1-3.4 1-5 0s-3.4-1-5 0Z"/>',
  'panel-left': '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>',
  play: '<path d="M6.5 4.5v15l13-7.5Z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="5" width="4.5" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4.5" height="14" rx="1" fill="currentColor" stroke="none"/>',
};
function icon(name, size = 16, strokeWidth = 1.7) {
  const path = ICON_PATHS[name];
  if (!path) return '';
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}
function checkGlyph(on, size = 12) { return on ? icon('check', size, 2.4) : ''; }
