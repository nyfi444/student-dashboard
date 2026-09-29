/* ── Spaces core: primitives shared by study groups and clubs ─────
   Loaded right before the study group files and long before orgs.js (see
   index.html), so everything here is ready for both. Plain top-level
   globals on purpose: inline onclick handlers and other files (projects,
   classes, syllabus, group plans) call these by name, so none of them may
   be renamed or wrapped. Nothing here reads or writes a group or a club;
   each feature keeps its own writes (groupWrite, orgWrite).
──────────────────────────────────────────────────────────────── */
/* ── Ids and codes ─────────────────────────────────────────────── */
const LOCAL_UID = 'local-me';
// Group data is written by other members, so any id that ends up inside an
// onclick="…('id')" handler has to be checked, not just escaped: esc() turns a
// quote into &#39;, which the browser decodes right back into a quote before
// running the handler. Items with ids outside this shape are simply skipped.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const safeId = (id) => typeof id === 'string' && SAFE_ID.test(id);
function normalizeCode(v) { return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }

/* ── Small helpers ─────────────────────────────────────────────── */
function toMin(hhmm) { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return h * 60 + (m || 0); }
function fromMin(min) { return `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }
function addMinutesHHMM(t, mins) { return fromMin(Math.min(toMin(t) + mins, 23 * 60 + 59)); }
function fmtFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtSessionDay(dIso) {
  const n = daysBetween(dIso);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return fmtDate(dIso, { weekday: 'long' });
  return fmtDate(dIso, { weekday: 'short', month: 'short', day: 'numeric' });
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }
function linkifyText(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+/g, (m) => `<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`);
}
function linkifyWhere(where) {
  return isHttpUrl(where) ? `<a href="${esc(where.trim())}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${esc(hostOf(where) || 'Join link')}</a>` : esc(where);
}
// A session or event whose "where" is a link gets a real button, not just an
// underlined hostname: for a call it says so, for anything else it opens.
function joinLinkButton(where, size = 'btn-sm') {
  if (!isHttpUrl(where)) return '';
  const host = hostOf(where);
  const call = /zoom\.us|meet\.google|teams\.microsoft|webex|discord|whereby|gather/i.test(host);
  return `<a class="btn ${size} sg-join-btn" href="${esc(where.trim())}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${icon(call ? 'play' : 'link', 14)} ${call ? 'Join call' : 'Open link'}</a>`;
}
function dateTile(dIso) {
  const d = new Date(dIso + 'T00:00:00');
  return `<div class="sg-date-tile"><span>${d.toLocaleDateString('en-US', { month: 'short' })}</span><strong>${d.getDate()}</strong></div>`;
}
/* ── Colors and avatars ─────────────────────────────────────────── */
// Colors a group or club can wear (its crest, its events on the calendar).
const GROUP_COLORS = ['#1B2A4A', '#8C3B1F', '#2F4A3A', '#6E2E3A', '#3b6ea5', '#7A4A68', '#1F5F6B', '#5a4a1f'];
const PERSON_COLORS = ['#3b6ea5', '#c0503f', '#3f8a55', '#8a5cc2', '#d08a1e', '#2a9396', '#c24f8a', '#6b7a2e', '#5a6b7b', '#a0613a'];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
// Text on a user-picked fill: white where it reads at 4.5:1, ink otherwise.
// readablePair() also nudges the fill darker when neither reaches 4.5:1
// (mid greens and pinks), so avatar initials and date tiles always pass.
const INK_ON_COLOR = '#141414';
function colorLum(hex) {
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function inkOnColor(hex) {
  return 1.05 / (colorLum(hex) + 0.05) >= 4.5 ? '#fff' : INK_ON_COLOR;
}
function readablePair(hex) {
  if (!HEX_COLOR.test(hex || '')) return { fill: hex, on: '#fff' };
  const L = colorLum(hex);
  if (1.05 / (L + 0.05) >= 4.5) return { fill: hex, on: '#fff' };
  if ((L + 0.05) / (colorLum(INK_ON_COLOR) + 0.05) >= 4.5) return { fill: hex, on: INK_ON_COLOR };
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  for (let k = 0.96; k > 0.5; k -= 0.02) {
    const d = '#' + [r, g, b].map(v => Math.round(v * k).toString(16).padStart(2, '0')).join('');
    if (1.05 / (colorLum(d) + 0.05) >= 4.5) return { fill: d, on: '#fff' };
  }
  return { fill: hex, on: INK_ON_COLOR };
}
// Inline custom properties for a coloured container: --name, --name-fill
// (the readable fill) and --on-name (its text colour).
function colorVars(name, hex) {
  const { fill, on } = readablePair(hex);
  return `--${name}:${esc(hex)};--${name}-fill:${esc(fill)};--on-${name}:${on}`;
}
function personAvatar(id, name, size = 26, color = '#6b6b6b') {
  const initial = esc((String(name || '?').trim()[0] || '?').toUpperCase());
  const { fill, on } = readablePair(HEX_COLOR.test(color) ? color : '#6b6b6b');
  return `<span class="avatar sg-avatar" style="width:${size}px;height:${size}px;font-size:${Math.max(12, Math.round(size * 0.42))}px;--shade:${fill};color:${on}" title="${esc(name)}">${initial}</span>`;
}
// The overlapping face pile, render only: list is [{ uid, name }] and
// colorOf(uid) gives each face its color. avatarStack (study groups) feeds it.
function avatarStackHtml(list, max = 4, size = 26, colorOf = () => '#6b6b6b') {
  if (!list.length) return '';
  return `<span class="sg-stack">${list.slice(0, max).map(p => personAvatar(p.uid, p.name, size, colorOf(p.uid))).join('')}${list.length > max ? `<span class="avatar sg-avatar sg-avatar-more" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px">+${list.length - max}</span>` : ''}</span>`;
}
/* ── Field-level write ops (groupWrite and orgWrite both apply them) ─ */
const GW_DELETE = { __op: 'delete' };
const gwUnion = (...v) => ({ __op: 'union', v });
const gwRemove = (...v) => ({ __op: 'remove', v });
function applyLocalOp(obj, segs, val) {
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    if (typeof cur[segs[i]] !== 'object' || cur[segs[i]] === null) cur[segs[i]] = {};
    cur = cur[segs[i]];
  }
  const k = segs[segs.length - 1];
  if (val === GW_DELETE) delete cur[k];
  else if (val?.__op === 'union') cur[k] = [...new Set([...(cur[k] || []), ...val.v])];
  else if (val?.__op === 'remove') cur[k] = (cur[k] || []).filter(x => !val.v.includes(x));
  else cur[k] = val;
}
/* ── Tabs ──────────────────────────────────────────────────────── */
// A phone-width tab strip opens scrolled to its start, which can leave a later
// active tab (and its underline) off screen. Centre it by setting scrollLeft
// directly; scrollIntoView would also move the page. Groups and clubs both use it.
function centerActiveSgTab() {
  const a = document.querySelector('#content .sg-tabs button.active');
  if (!a) return;
  const s = a.parentElement;
  if (s.scrollWidth <= s.clientWidth) return;
  const left = a.getBoundingClientRect().left - s.getBoundingClientRect().left + s.scrollLeft;
  s.scrollLeft = Math.max(0, left - s.clientWidth / 2 + a.offsetWidth / 2);
}
/* ── Copy and CSV ──────────────────────────────────────────────── */
function copyText(text, successMsg) {
  const done = () => toast(successMsg || 'Copied');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch { toast('Couldn’t copy. Select the text and copy it manually.', 'error'); }
  ta.remove();
}
function csvCell(v) { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }
function downloadCsv(name, rows) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
