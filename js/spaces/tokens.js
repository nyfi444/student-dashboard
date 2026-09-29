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

// The inline variables for a `.space` root. Contrast is settled here, in
// JS, so the CSS never has to guess how light or dark a picked color is:
//   --space           the fill (readablePair: darkened until white or ink
//                     reads on it at 4.5:1); washes and patterns mix it
//   --space-ink       the text on that fill
//   --space-textsafe  the color darkened until it reads at 4.5:1 on white;
//                     light-mode text mixes, underlines and small marks use it
//   --space-fill-dark the color lifted toward white until it clears 3:1 on
//                     the lightest dark-mode --surface of the 17 themes, and
//                     a text color reads on it at 4.5:1
//   --space-ink-lift  the text on --space-fill-dark
//   --pattern-alpha-dark  the dark cover pattern's strength (fainter for bright colors)
// Dark-mode washes mix --space-textsafe, so a bright pick stays a quiet tint.
// No color falls back to the theme accent, with a quieter dark pattern.
const SPACE_DARK_SURFACE = '#161F19';   // Sage Library dark --surface, the lightest of the 17 themes
const _spaceVarsCache = new Map();
function spaceContrast(a, b) { const x = colorLum(a), y = colorLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function spaceTextSafe(hex) {
  for (let k = 0; k <= 50; k++) { const c = spaceMixHex(hex, '#000000', k * 0.02); if (spaceContrast(c, '#ffffff') >= 4.5) return c; }
  return '#000000';
}
function spaceDarkPair(hex) {
  for (let k = 9; k <= 50; k++) {   // from 18% lighter, the lift dark mode always had
    const c = spaceMixHex(hex, '#ffffff', k * 0.02);
    if (spaceContrast(c, SPACE_DARK_SURFACE) < 3) continue;
    if (spaceContrast(c, '#ffffff') >= 4.5) return { fill: c, on: '#fff' };
    if (spaceContrast(c, INK_ON_COLOR) >= 4.5) return { fill: c, on: INK_ON_COLOR };
  }
  return { fill: '#ffffff', on: INK_ON_COLOR };
}
// The computed colors for a hex, for tests and anything that needs the numbers.
function spaceColorSet(hex) {
  const key = String(hex).toLowerCase();
  if (_spaceVarsCache.has(key)) return _spaceVarsCache.get(key);
  const pair = readablePair(key), dark = spaceDarkPair(key);
  // Dark mode draws the cover pattern in the lifted fill; a bright one gets a
  // fainter pattern so the band's eyebrow and description stay at 4.5:1.
  const patternDark = Math.max(0.1, Math.min(0.26, 0.036 / colorLum(dark.fill))).toFixed(2);
  const set = { fill: pair.fill, ink: pair.on, textsafe: spaceTextSafe(key), fillDark: dark.fill, inkLift: dark.on, patternDark };
  _spaceVarsCache.set(key, set);
  return set;
}
function spaceVars(hex) {
  if (!HEX_COLOR.test(hex || '')) return '--space:var(--accent);--space-ink:var(--accent-text);--space-ink-lift:var(--accent-text);--pattern-alpha-dark:.12;--space-wash-dark-src:color-mix(in srgb, var(--accent) 55%, #000)';
  const c = spaceColorSet(hex);
  return `--space:${c.fill};--space-ink:${c.ink};--space-textsafe:${c.textsafe};--space-fill-dark:${c.fillDark};--space-ink-lift:${c.inkLift};--pattern-alpha-dark:${c.patternDark}`;
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
