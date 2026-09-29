/* ── Spaces: colors, patterns and crests (render only) ─────────────
   Every study group and club page, card and sheet sits in a `.space`
   root that carries its color as CSS variables. css/spaces.css turns
   those into washes, lines, fills and text colors by mixing them with
   the theme's own --bg, --surface, --border and --text, so a space
   looks right in all 17 themes, light and dark.

   Nothing here is stored. The pattern is picked by hashing the code,
   and the crest is worked out from the name or course each time.
──────────────────────────────────────────────────────────────── */
// The six cover patterns, in the order css/spaces.css numbers them.
const SPACE_PATTERNS = ['Ruled', 'Graph', 'Dot grid', 'Margin', 'Pennant', 'Tide'];

// A small, stable string hash (FNV-1a), so a code always gets the same pattern.
function spaceHash(str) {
  let h = 2166136261;
  for (const ch of String(str || '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function spacePattern(code) { return spaceHash(code) % SPACE_PATTERNS.length; }

// Mix a hex color toward another (both #rrggbb), amount 0 to 1 of `toward`.
function spaceMixHex(hex, toward, amount) {
  if (!HEX_COLOR.test(hex || '') || !HEX_COLOR.test(toward || '')) return hex;
  const parse = (h) => { const x = h.length === 4 ? h.slice(1).split('').map(c => c + c).join('') : h.slice(1); return [0, 2, 4].map(i => parseInt(x.slice(i, i + 2), 16)); };
  const a = parse(hex), b = parse(toward);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, '0')).join('');
}
// Four steps of the space color, for faces that aren't officers or picked
// colors: 0 is the color itself, then lighter each step.
function spaceTint(hex, i = 0) { return spaceMixHex(hex, '#ffffff', [0, 0.18, 0.34, 0.48][((i % 4) + 4) % 4]); }

// The inline variables for a `.space` root. A hex color gives --space and
// the ink that reads on it (--space-ink, and --space-ink-lift for the
// lighter fill dark mode uses). No color falls back to the theme accent.
function spaceVars(hex) {
  if (!HEX_COLOR.test(hex || '')) return '--space:var(--accent);--space-ink:var(--accent-text);--space-ink-lift:var(--accent-text)';
  return `--space:${esc(hex)};--space-ink:${inkOnColor(hex)};--space-ink-lift:${inkOnColor(spaceMixHex(hex, '#ffffff', 0.18))}`;
}

// Monogram from a name: "Women in Business" → "WB", "Chess" → "CH".
function spaceMonogram(name) {
  const words = String(name || '').split(/\s+/).filter(w => /^[A-Za-z0-9]/.test(w) && !/^(of|the|and|in|for|at|a|an|&)$/i.test(w));
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
}
// A study group's crest: the course code split into letters and number
// ("BIO 201" → BIO over 201), else the name's initials. Raw text, not escaped.
function spaceGroupCrest(g) {
  const m = String(g?.courseLabel || '').trim().match(/^([A-Za-z]{2,4})[\s-]*(\d{2,4}[A-Za-z]?)\b/);
  if (m) return { main: m[1].toUpperCase(), sub: m[2].toUpperCase() };
  return { main: spaceMonogram(g?.name), sub: '' };
}
