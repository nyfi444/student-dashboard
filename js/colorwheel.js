/* ── Color math + a reusable hue/saturation wheel picker ─────────
   Powers course colors and calendar event colors, the app's own
   chrome stays fixed black/white, but tagging colors are wide open
   to any hex. Wheel is pure CSS (conic-gradient hue ring + radial
   white center) with pointer math for angle/distance → hue/sat.
──────────────────────────────────────────────────────────────── */
function hexToRgb(hex) {
  hex = (hex || '#000000').replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  return { r: parseInt(hex.slice(0, 2), 16) || 0, g: parseInt(hex.slice(2, 4), 16) || 0, b: parseInt(hex.slice(4, 6), 16) || 0 };
}
function rgbToHex(r, g, b) { return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
// document.queryCommandValue('foreColor'/'hiliteColor') returns an rgb(...) string
// (or a bare color name/'transparent'), never a hex. This bridges that back to hex
// for feeding into colorWheelHtml, falling back when there's nothing usable to parse.
function rgbStringToHex(str, fallback) {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(str || '');
  return m ? rgbToHex(+m[1], +m[2], +m[3]) : fallback;
}
function hsvToHex(h, s, v) {
  s = Math.max(0, Math.min(1, s)); v = Math.max(0, Math.min(1, v)); h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60)[r, g, b] = [c, x, 0]; else if (h < 120)[r, g, b] = [x, c, 0]; else if (h < 180)[r, g, b] = [0, c, x];
  else if (h < 240)[r, g, b] = [0, x, c]; else if (h < 300)[r, g, b] = [x, 0, c]; else[r, g, b] = [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}
function hexToHsv(hex) {
  const { r, g, b } = hexToRgb(hex);
  const rf = r / 255, gf = g / 255, bf = b / 255;
  const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf), d = max - min;
  let h = 0;
  if (d !== 0) { if (max === rf) h = 60 * (((gf - bf) / d) % 6); else if (max === gf) h = 60 * ((bf - rf) / d + 2); else h = 60 * ((rf - gf) / d + 4); }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function colorWheelHtml(id, hex) {
  const { h, s, v } = hexToHsv(hex);
  const left = 50 + s * Math.cos(h * Math.PI / 180) * 50;
  const top = 50 + s * Math.sin(h * Math.PI / 180) * 50;
  return `
    <div class="cw-wheel" id="${id}">
      <div class="cw-marker" id="${id}-marker" style="left:${left}%;top:${top}%;background:${hex}"></div>
    </div>
    <input type="range" class="cw-brightness" id="${id}-bright" min="0" max="100" value="${Math.round(v * 100)}" style="accent-color:${hex}">
    <div class="cw-hexrow">
      <span class="cw-swatch" id="${id}-swatch" style="background:${hex}"></span>
      <input class="input" id="${id}-hex" value="${hex}" style="font-family:monospace;font-size:12px">
    </div>
  `;
}

/* Wires pointer/brightness/hex events for a wheel rendered by colorWheelHtml.
   onChange(hex) fires on every update; caller owns the source-of-truth value. */
function wireColorWheel(id, getHex, onChange) {
  const wheel = $('#' + id);
  if (!wheel) return;
  const marker = $('#' + id + '-marker');
  const bright = $('#' + id + '-bright');
  const swatch = $('#' + id + '-swatch');
  const hexInput = $('#' + id + '-hex');

  const paint = (hex) => {
    const { h, s } = hexToHsv(hex);
    marker.style.left = (50 + s * Math.cos(h * Math.PI / 180) * 50) + '%';
    marker.style.top = (50 + s * Math.sin(h * Math.PI / 180) * 50) + '%';
    marker.style.background = hex;
    swatch.style.background = hex;
    hexInput.value = hex;
    bright.style.accentColor = hex;
  };

  const setFromPoint = (clientX, clientY) => {
    const rect = wheel.getBoundingClientRect();
    const R = rect.width / 2;
    const dx = clientX - (rect.left + R), dy = clientY - (rect.top + R);
    let angle = Math.atan2(dy, dx) * 180 / Math.PI; if (angle < 0) angle += 360;
    const dist = Math.min(1, Math.sqrt(dx * dx + dy * dy) / R);
    const { v } = hexToHsv(getHex());
    const hex = hsvToHex(angle, dist, v);
    paint(hex);
    onChange(hex);
  };
  wheel.onpointerdown = (e) => {
    setFromPoint(e.clientX, e.clientY);
    const move = (e2) => setFromPoint(e2.clientX, e2.clientY);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  bright.oninput = () => {
    const { h, s } = hexToHsv(getHex());
    const hex = hsvToHex(h, s, Number(bright.value) / 100);
    paint(hex);
    onChange(hex);
  };
  hexInput.onchange = () => {
    let val = hexInput.value.trim();
    if (val && !val.startsWith('#')) val = '#' + val;
    if (/^#[0-9a-fA-F]{6}$/.test(val)) { paint(val); onChange(val); }
    else hexInput.value = getHex();
  };
}

/* ── The full spectrum, laid out flat ─────────────────────────────
   The wheel above is precise but it hides behind a button, which made
   the handful of preset swatches next to it look like the whole choice.
   These two gradient bars sit out in the open instead: drag the rainbow
   for the hue, drag the second bar from pale through pure to dark. Same
   any-color-at-all result, but nothing about it reads as a short list.

   Position along the shade bar maps to saturation for the first half and
   to brightness for the second, so one bar covers pastel to near-black. */
const SHADE_FLOOR = 0.25; // darkest end of the shade bar, still a usable color
function shadePosition(hex) {
  const { s, v } = hexToHsv(hex);
  if (v > 0.94 && s < 0.99) return (s / 2);
  return 0.5 + ((1 - v) / (1 - SHADE_FLOOR)) * 0.5;
}
function shadeToHex(hue, t) {
  t = Math.max(0, Math.min(1, t));
  return t <= 0.5 ? hsvToHex(hue, t / 0.5, 1) : hsvToHex(hue, 1, 1 - ((t - 0.5) / 0.5) * (1 - SHADE_FLOOR));
}
function spectrumHtml(id, hex, { shade = true } = {}) {
  const { h } = hexToHsv(hex);
  return `
    <div class="spectrum" id="${id}">
      <div class="spec-bar spec-hue" data-spec="hue" role="slider" tabindex="0" aria-label="Color" aria-valuetext="${esc(hex)}">
        <span class="spec-knob" data-knob="hue" style="left:${(h / 360) * 100}%;background:${hsvToHex(h, 1, 1)}"></span>
      </div>
      ${shade ? `
        <div class="spec-bar spec-shade" data-spec="shade" role="slider" tabindex="0" aria-label="Shade" aria-valuetext="${esc(hex)}" style="--spec-hue:${hsvToHex(h, 1, 1)}">
          <span class="spec-knob" data-knob="shade" style="left:${shadePosition(hex) * 100}%;background:${hex}"></span>
        </div>` : ''}
    </div>`;
}
/* Wires both bars. onChange(hex) fires on every move; the caller still owns
   the value, same contract as wireColorWheel. */
function wireSpectrum(id, getHex, onChange) {
  const root = document.getElementById(id);
  if (!root) return;
  const hueBar = root.querySelector('[data-spec="hue"]');
  const shadeBar = root.querySelector('[data-spec="shade"]');
  const paint = (hex) => {
    const { h } = hexToHsv(hex);
    const hueKnob = root.querySelector('[data-knob="hue"]');
    const shadeKnob = root.querySelector('[data-knob="shade"]');
    if (hueKnob) { hueKnob.style.left = (h / 360) * 100 + '%'; hueKnob.style.background = hsvToHex(h, 1, 1); }
    if (shadeKnob) { shadeKnob.style.left = shadePosition(hex) * 100 + '%'; shadeKnob.style.background = hex; }
    if (shadeBar) shadeBar.style.setProperty('--spec-hue', hsvToHex(h, 1, 1));
    root.querySelectorAll('[role="slider"]').forEach(el => el.setAttribute('aria-valuetext', hex));
  };
  const fraction = (bar, clientX) => {
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };
  const drag = (bar, toHex) => {
    if (!bar) return;
    const set = (clientX) => { const hex = toHex(fraction(bar, clientX)); paint(hex); onChange(hex); };
    bar.onpointerdown = (e) => {
      bar.setPointerCapture?.(e.pointerId);
      set(e.clientX);
      const move = (e2) => { e2.preventDefault(); set(e2.clientX); };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
    };
    // Arrow keys nudge, so the bars aren't drag-only.
    bar.onkeydown = (e) => {
      const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      if (!step) return;
      e.preventDefault();
      const rect = bar.getBoundingClientRect();
      const knob = bar.querySelector('.spec-knob');
      const at = parseFloat(knob.style.left) / 100 || 0;
      const hex = toHex(Math.max(0, Math.min(1, at + step * 0.02)));
      paint(hex); onChange(hex);
    };
  };
  drag(hueBar, (t) => { const { s, v } = hexToHsv(getHex()); return hsvToHex(t * 360, s < 0.08 ? 0.75 : s, v < 0.3 ? 0.85 : v); });
  drag(shadeBar, (t) => shadeToHex(hexToHsv(getHex()).h, t));
}
