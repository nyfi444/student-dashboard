/* ── Appearance: themes, seasonal editions, app icons, sound, motion ──
   A theme sets the whole palette (page, surfaces, text, accent) for both
   light and dark mode. Classic is the original black-and-white look and
   keeps working with the custom background presets in Settings. Seasonal
   editions can only be picked during their season, but stay yours once
   chosen.
──────────────────────────────────────────────────────────────── */
const THEMES = [
  { id: 'classic', name: 'Classic', note: 'Ink on white' },
  { id: 'bone', name: 'Bone & Ink', note: 'Warm paper, deep ink',
    light: { bg: '#F8F6F2', surface: '#FFFDF9', surface2: '#F1EDE5', border: '#E6DFD8', text: '#121212', accent: '#121212', accentLight: '#EDE7DE', accentText: '#F8F6F2' },
    dark: { bg: '#12110F', surface: '#1B1916', surface2: '#25221E', border: '#35312C', text: '#F3EFE8', accent: '#F3EFE8', accentLight: '#2E2A25', accentText: '#12110F' } },
  { id: 'midnight', name: 'Midnight', note: 'Navy and moonlight',
    light: { bg: '#F4F6FA', surface: '#FFFFFF', surface2: '#EAEEF5', border: '#DCE2EC', text: '#141B2D', accent: '#1B2A4A', accentLight: '#E3E9F4', accentText: '#F4F6FA' },
    dark: { bg: '#0B1020', surface: '#121A2E', surface2: '#1A2440', border: '#28334F', text: '#E6ECFA', accent: '#E6ECFA', accentLight: '#1F2A47', accentText: '#0B1020' } },
  { id: 'sage', name: 'Sage Library', note: 'Quiet greens',
    light: { bg: '#F2F4EF', surface: '#FBFCF9', surface2: '#E7ECE4', border: '#D9E0D5', text: '#17211B', accent: '#2F4A3A', accentLight: '#E1E9DF', accentText: '#F2F4EF' },
    dark: { bg: '#0F1511', surface: '#161F19', surface2: '#1F2A22', border: '#2D3A31', text: '#E3EDE5', accent: '#CFE3D2', accentLight: '#223026', accentText: '#0F1511' } },
  { id: 'rosewater', name: 'Rosewater', note: 'Blush and bordeaux',
    light: { bg: '#FBF5F4', surface: '#FFFBFA', surface2: '#F4E9E8', border: '#EAD9D8', text: '#24161A', accent: '#6E2E3A', accentLight: '#F3E2E4', accentText: '#FBF5F4' },
    dark: { bg: '#170F11', surface: '#211618', surface2: '#2C1E21', border: '#3C2A2E', text: '#F5E6E8', accent: '#F2D5D9', accentLight: '#33232A', accentText: '#170F11' } },
  { id: 'espresso', name: 'Espresso', note: 'Cream and coffee',
    light: { bg: '#F6F1EC', surface: '#FFFCF8', surface2: '#EDE5DC', border: '#E0D5C9', text: '#231A14', accent: '#3B2A20', accentLight: '#EBE0D4', accentText: '#F6F1EC' },
    dark: { bg: '#130E0B', surface: '#1C1612', surface2: '#271F19', border: '#382D25', text: '#F0E4D6', accent: '#EBDCCB', accentLight: '#2E251E', accentText: '#130E0B' } },
  { id: 'autumn', name: 'Autumn Term', note: 'Limited edition', season: { label: 'fall', months: [8, 9, 10], until: 'November 30' },
    light: { bg: '#F7F1E8', surface: '#FFFBF4', surface2: '#EFE5D7', border: '#E4D5C1', text: '#23170F', accent: '#8C3B1F', accentLight: '#F1DFD2', accentText: '#FBF6EE' },
    dark: { bg: '#150E0A', surface: '#1F1510', surface2: '#2A1D16', border: '#3D2B20', text: '#F4E6D7', accent: '#F0C6A8', accentLight: '#35231A', accentText: '#150E0A' } },
  { id: 'winter', name: 'Winter Finals', note: 'Limited edition', season: { label: 'winter', months: [11, 0, 1], until: 'February 28' },
    light: { bg: '#F1F4F7', surface: '#FFFFFF', surface2: '#E5EBF0', border: '#D6DEE6', text: '#131C25', accent: '#2E4057', accentLight: '#E0E7EE', accentText: '#F1F4F7' },
    dark: { bg: '#0C1116', surface: '#131A21', surface2: '#1B242D', border: '#29343F', text: '#E3ECF4', accent: '#D4E1EC', accentLight: '#1F2A35', accentText: '#0C1116' } },
  { id: 'spring', name: 'Spring Bloom', note: 'Limited edition', season: { label: 'spring', months: [2, 3, 4], until: 'May 31' },
    light: { bg: '#FAF6F7', surface: '#FFFCFD', surface2: '#F2E9EC', border: '#E7D9DE', text: '#23171D', accent: '#7A4A68', accentLight: '#F1E4EC', accentText: '#FAF6F7' },
    dark: { bg: '#150F13', surface: '#1F161C', surface2: '#2A1F26', border: '#3B2D35', text: '#F3E6EE', accent: '#E8C9DC', accentLight: '#33242E', accentText: '#150F13' } },
  { id: 'summer', name: 'Summer Session', note: 'Limited edition', season: { label: 'summer', months: [5, 6, 7], until: 'August 31' },
    light: { bg: '#FAF7EF', surface: '#FFFDF7', surface2: '#EFEBDF', border: '#E3DDCC', text: '#1B1E1C', accent: '#1F5F6B', accentLight: '#E0ECEC', accentText: '#FAF7EF' },
    dark: { bg: '#0D1314', surface: '#141C1E', surface2: '#1C2628', border: '#2A3739', text: '#E4EFEE', accent: '#BFE0E2', accentLight: '#1E2C2E', accentText: '#0D1314' } },
];
const THEME_VAR_NAMES = ['--bg', '--bg-text', '--surface', '--surface-2', '--border', '--text', '--text-dim', '--text-faint', '--accent', '--accent-dark', '--accent-light', '--accent-text', '--danger', '--danger-light', '--success', '--success-light', '--warn', '--warn-light', '--badge', '--ink', '--cloud'];
const APP_ICONS = [
  { id: 'classic', name: 'Classic' }, { id: 'bone', name: 'Bone' }, { id: 'sandstone', name: 'Sandstone' }, { id: 'midnight', name: 'Midnight' },
  { id: 'sage', name: 'Sage' }, { id: 'rosewater', name: 'Rosewater' }, { id: 'espresso', name: 'Espresso' }, { id: 'autumn', name: 'Autumn' },
];

function currentTheme() { return THEMES.find(t => t.id === state.settings.theme) || THEMES[0]; }
function themeInSeason(t, d = new Date()) { return !t.season || t.season.months.includes(d.getMonth()); }

function applyTheme() {
  const root = document.documentElement;
  const theme = currentTheme();
  const dark = !!state.settings.dark;
  root.classList.toggle('dark', dark);
  THEME_VAR_NAMES.forEach(v => root.style.removeProperty(v));
  const vars = {};
  if (theme.light) {
    const p = dark ? theme.dark : theme.light;
    Object.assign(vars, {
      '--bg': p.bg, '--bg-text': p.text, '--surface': p.surface, '--surface-2': p.surface2, '--border': p.border,
      '--text': p.text, '--text-dim': `color-mix(in srgb, ${p.text} 76%, ${p.surface})`, '--text-faint': `color-mix(in srgb, ${p.text} 66%, ${p.surface})`,
      '--accent': p.accent, '--accent-dark': p.accent, '--accent-light': p.accentLight, '--accent-text': p.accentText,
      '--danger': p.accent, '--danger-light': p.accentLight, '--success': p.text, '--success-light': p.surface2,
      '--warn': `color-mix(in srgb, ${p.text} 70%, ${p.surface})`, '--warn-light': p.surface2, '--badge': p.surface2,
      '--ink': p.text, '--cloud': dark ? p.surface2 : p.surface,
    });
  }
  // A custom page color from Settings → Background still wins over the theme.
  const lightBg = state.settings.background?.color;
  const darkBg = state.settings.darkBackground?.color;
  if (dark) {
    if (!theme.light || (darkBg && darkBg !== '#fafafa')) { vars['--bg'] = darkBgFromPreset(darkBg); vars['--bg-text'] = darkTextFromPreset(darkBg); }
  } else if (!theme.light || (lightBg && lightBg !== '#fafafa')) {
    vars['--bg'] = bgCssValue(state.settings.background);
  }
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  root.classList.toggle('reduce-motion', !!state.settings.reduceMotion);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', vars['--bg'] || (dark ? '#0f0f0f' : '#fafafa'));
  applyAppIcon();
  try { localStorage.setItem('shq_boot_look', JSON.stringify({ dark, vars, icon: state.settings.appIcon && state.settings.appIcon !== 'classic' ? state.settings.appIcon : null })); } catch {}
}
function setTheme(id) {
  const t = THEMES.find(x => x.id === id);
  if (!t) return;
  if (!themeInSeason(t) && state.settings.theme !== id) { toast(`${t.name} is only available in the ${t.season.label}.`, 'info'); return; }
  state.settings.theme = id;
  // Picking a theme brings its own page color back, replacing a custom one.
  state.settings.background = { color: '#fafafa' };
  state.settings.darkBackground = { color: '#fafafa' };
  applyTheme();
  playUiSound('tap');
  touch();
}

function applyAppIcon() {
  const id = APP_ICONS.some(i => i.id === state.settings.appIcon) ? state.settings.appIcon : 'classic';
  const touchHref = id === 'classic' ? 'assets/apple-touch-icon.png' : `assets/icons/${id}-180.png`;
  const iconHref = id === 'classic' ? 'assets/favicon.png' : `assets/icons/${id}-192.png`;
  document.querySelectorAll('link[rel="apple-touch-icon"]').forEach((l, i) => { if (i === 0) l.href = touchHref; else l.remove(); });
  document.querySelectorAll('link[rel="icon"]').forEach((l, i) => { if (i === 0) l.href = iconHref; else l.remove(); });
  const manifest = document.querySelector('link[rel="manifest"]');
  if (manifest) manifest.href = id === 'classic' ? 'manifest.json' : `assets/icons/manifest-${id}.json`;
}
function setAppIcon(id) {
  if (!APP_ICONS.some(i => i.id === id)) return;
  state.settings.appIcon = id;
  applyTheme();
  playUiSound('tap');
  touch();
  toast('App icon updated. If Semester HQ is already on your home screen, remove it and add it again to see the new icon.', 'success', 6000);
}

/* ── Sound effects: tiny synthesized cues, nothing to download ──── */
let _audioCtx = null;
function playUiSound(kind) {
  if (state.settings.sounds === false) return;
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const notes = { complete: [[880, 0, 0.07], [1318.5, 0.07, 0.09]], tap: [[1046.5, 0, 0.04]], send: [[660, 0, 0.05], [990, 0.05, 0.07]], success: [[784, 0, 0.08], [1046.5, 0.08, 0.08], [1318.5, 0.16, 0.12]] }[kind] || [[880, 0, 0.05]];
    notes.forEach(([freq, at, len]) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      const t0 = ctx.currentTime + at;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(kind === 'tap' ? 0.025 : 0.05, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + len + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0); osc.stop(t0 + len + 0.15);
    });
  } catch {}
}
// A quick lift-and-check on the row that was just finished. Marked by id so it
// plays once on the freshly rendered row, not on every checked item.
function celebrateItem(id) {
  playUiSound('complete');
  if (state.settings.reduceMotion) return;
  requestAnimationFrame(() => document.querySelectorAll(`[data-item-id="${CSS.escape(id)}"]`).forEach(el => {
    el.classList.remove('just-done'); void el.offsetWidth; el.classList.add('just-done');
  }));
}

// Theme picker tiles, shared by Settings and the dashboard's Customize panel.
// afterPick runs after a tile is chosen (the Customize panel re-opens itself).
function themeTilesHtml(afterPick = '') {
  const cur = currentTheme();
  return `<div class="theme-grid">
    ${THEMES.map(t => {
      const p = t.light ? (state.settings.dark ? t.dark : t.light) : (state.settings.dark ? { bg: '#0f0f0f', surface: '#1a1a1a', accent: '#f2f2f2', text: '#fff' } : { bg: '#fafafa', surface: '#ffffff', accent: '#141414', text: '#000' });
      const locked = !themeInSeason(t) && cur.id !== t.id;
      return `<button class="theme-tile ${cur.id === t.id ? 'active' : ''} ${locked ? 'locked' : ''}" onclick="setTheme('${t.id}');${afterPick}" aria-pressed="${cur.id === t.id}" ${locked ? `aria-disabled="true" title="Returns in the ${t.season.label}"` : ''}>
        <span class="theme-preview" style="background:${p.bg}"><span class="theme-card" style="background:${p.surface}"><span style="background:${p.accent}"></span><span style="background:${p.text};opacity:.18"></span></span><span class="theme-dot" style="background:${p.accent}"></span></span>
        <span class="theme-name">${esc(t.name)}</span>
        <span class="theme-note">${t.season ? (locked ? `Returns in the ${t.season.label}` : `Limited · until ${t.season.until}`) : esc(t.note)}</span>
      </button>`;
    }).join('')}
  </div>`;
}
// A short row of page colors for whichever mode is on. The full set lives in Settings.
const QUICK_PAGE_COLORS = ['Default', 'White', 'Warm White', 'Cream', 'Sand', 'Blush', 'Rose', 'Apricot', 'Sage', 'Mint', 'Jade', 'Sky', 'Periwinkle', 'Lavender', 'Stone', 'Cool Gray'];
function pageColorSwatchesHtml(afterPick = '') {
  const dark = !!state.settings.dark;
  const current = dark ? state.settings.darkBackground : state.settings.background;
  return `<div class="page-color-row" role="group" aria-label="Page color">
    ${QUICK_PAGE_COLORS.map(label => {
      const i = BACKGROUND_PRESETS.findIndex(p => p.label === label);
      if (i < 0) return '';
      const p = BACKGROUND_PRESETS[i];
      const on = bgMatchesPreset(current, p) || (label === 'Default' && !current?.color);
      const swatch = label === 'Default' ? 'var(--bg-default-swatch, conic-gradient(var(--surface) 0 50%, var(--surface-2) 0))' : dark ? darkBgFromPreset(p.color) : p.color;
      return `<button type="button" class="page-color ${on ? 'active' : ''}" style="background:${swatch}" aria-pressed="${on}" aria-label="${label === 'Default' ? 'Theme default' : esc(label)}" title="${label === 'Default' ? 'Theme default' : esc(label)}" onclick="${dark ? 'setDarkBackgroundPreset' : 'setBackgroundPreset'}(${i});${afterPick}">${on ? icon('check', 12, 2.6) : ''}</button>`;
    }).join('')}
  </div>`;
}

function appearanceSettingsCard() {
  const icon = state.settings.appIcon || 'classic';
  return `
    <div class="card card-pad">
      <h3 style="font-size:15px" class="mb-8">Appearance</h3>
      <div class="field"><label>Theme</label>${themeTilesHtml()}</div>
      <div class="checkbox-row mb-8"><input type="checkbox" id="st-dark" ${state.settings.dark ? 'checked' : ''} onchange="toggleDark(this.checked)"><label for="st-dark">Dark mode</label></div>
      <div class="checkbox-row mb-8"><input type="checkbox" id="st-sounds" ${state.settings.sounds !== false ? 'checked' : ''} onchange="state.settings.sounds=this.checked;save();if(this.checked)playUiSound('complete')"><label for="st-sounds">Sound effects</label></div>
      <div class="checkbox-row"><input type="checkbox" id="st-motion" ${state.settings.reduceMotion ? 'checked' : ''} onchange="state.settings.reduceMotion=this.checked;applyTheme();save()"><label for="st-motion">Reduce motion</label></div>
      <div class="field mt-16"><label>App icon</label>
        <div class="icon-grid">${APP_ICONS.map(i => `<button class="icon-tile ${icon === i.id ? 'active' : ''}" onclick="setAppIcon('${i.id}')" aria-pressed="${icon === i.id}" aria-label="${esc(i.name)} icon"><img src="assets/icons/${i.id}-180.png" alt="" width="52" height="52" loading="lazy"><span>${esc(i.name)}</span></button>`).join('')}</div>
        <p class="small muted mt-8">Shows on your home screen when you install Semester HQ.</p>
      </div>
      <div class="field mt-16" style="margin-bottom:0"><label for="st-name">Display name</label><input class="input" id="st-name" value="${esc(state.settings.displayName)}" oninput="state.settings.displayName=this.value" onchange="touch()"></div>
    </div>`;
}
