/* ── Small shared helpers used across every page module ─────────── */
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const esc = (v = "") => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

const today = () => new Date();
const iso = (d) => { const dt = new Date(d); return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).toISOString().slice(0, 10); };
const todayIso = () => iso(today());
const addDays = (isoStr, n) => { const d = new Date(isoStr + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const daysBetween = (isoStr) => Math.round((new Date(isoStr + 'T00:00:00') - new Date(todayIso() + 'T00:00:00')) / 86400000);
const startOfWeek = (isoStr) => { const d = new Date(isoStr + 'T00:00:00'); const day = d.getDay(); d.setDate(d.getDate() - day); return iso(d); };

function fmtDate(isoStr, opts) {
  if (!isoStr) return '';
  const d = new Date(isoStr + 'T00:00:00');
  return new Intl.DateTimeFormat('en-US', opts || { month: 'short', day: 'numeric' }).format(d);
}
function fmtDateLong(isoStr) { return fmtDate(isoStr, { weekday: 'long', month: 'long', day: 'numeric' }); }
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}
function relativeDay(isoStr) {
  const n = daysBetween(isoStr);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return fmtDate(isoStr, { weekday: 'long' });
  if (n < 0) return fmtDate(isoStr) + ' (overdue)';
  return fmtDate(isoStr);
}
function fmtRelativeTime(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'Yesterday';
  if (day < 7) return `${day}d ago`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(ms));
}
function fmtDuration(mins) {
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* Perceived-brightness check so text stays legible on any accent swatch */
function readableTextOn(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#241b2e' : '#ffffff';
}
function lighten(hex, amt) {
  const c = hex.replace('#', '');
  const r = clamp(parseInt(c.substr(0, 2), 16) + amt, 0, 255);
  const g = clamp(parseInt(c.substr(2, 2), 16) + amt, 0, 255);
  const b = clamp(parseInt(c.substr(4, 2), 16) + amt, 0, 255);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}
