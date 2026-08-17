/* ── Color math + a reusable hue/saturation wheel picker ─────────
   Powers the customizable page background in Settings. Wheel is
   pure CSS (conic-gradient hue ring + radial white center) with
   pointer math for angle/distance → hue/saturation, same approach
   used by Nyla OS's ColorWheelPicker.
──────────────────────────────────────────────────────────────── */
function hexToRgb(hex) {
  hex = (hex || '#000000').replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  return { r: parseInt(hex.slice(0, 2), 16) || 0, g: parseInt(hex.slice(2, 4), 16) || 0, b: parseInt(hex.slice(4, 6), 16) || 0 };
}
function rgbToHex(r, g, b) { return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
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
