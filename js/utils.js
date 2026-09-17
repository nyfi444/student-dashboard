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
// Big libraries (PDF reading/export, file storage) load the first time
// they're needed instead of on every app open.
const _scriptLoads = {};
function loadScriptOnce(src) {
  if (!_scriptLoads[src]) {
    _scriptLoads[src] = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src; el.async = true;
      el.onload = resolve;
      el.onerror = () => { delete _scriptLoads[src]; reject(new Error('Couldn’t load a needed file. Check your connection and try again.')); };
      document.head.appendChild(el);
    });
  }
  return _scriptLoads[src];
}
const PDFJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const HTML2PDF_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.14.0/html2pdf.bundle.min.js';
const FIREBASE_STORAGE_SRC = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage-compat.js';
async function ensurePdfJs() { if (typeof pdfjsLib === 'undefined') await loadScriptOnce(PDFJS_SRC); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
// Backs the "No due date" checkbox next to a date <input> (assignments, to-dos):
// disables + clears the field when checked, hands it back when unchecked. The
// field's own value (now always '' when disabled) is what save handlers read,
// via `.value || null`. This just makes clearing it an explicit, visible option
// instead of something only discoverable by knowing a date input can be blanked.
// An imported deadline (a syllabus, an assignment sheet, a pasted schedule)
// only gets a due date when the document actually gave one. These used to fall
// back to a week out, which quietly invented a deadline nobody wrote down: the
// item then sat in "This week" looking real, and the student had no way to tell
// a made-up date from a parsed one. No date in means no date out, and the item
// lands under "No due date" until someone sets one on purpose.
function cleanDueDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null; }
function cleanDueTime(v, fallback = '23:59') { return /^\d{2}:\d{2}$/.test(v || '') ? v : fallback; }
function toggleNoDueDate(inputId, checked) {
  const input = $('#' + inputId);
  if (!input) return;
  input.disabled = checked;
  if (checked) input.value = '';
}
// Some PDFs (scanned, malformed, or stuck behind a slow/blocked CDN worker
// fetch) make pdf.js hang indefinitely with no error, so this races it against
// a timer so upload UIs can always surface something instead of hanging forever.
function withTimeout(promise, ms, message = 'timed out') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

/* ── File names and types for uploads ─────────────────────────────
   Some devices hand over a file with no type, or a generic one, and a
   stored file named only by its random id opens as gibberish with no
   extension, so the computer can guess the wrong app for it. These keep
   the real name and the right type attached everywhere a file is stored. */
const MIME_BY_EXT = {
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text', rtf: 'application/rtf', csv: 'text/csv', tsv: 'text/tab-separated-values', txt: 'text/plain', md: 'text/markdown',
  pages: 'application/vnd.apple.pages', key: 'application/vnd.apple.keynote', numbers: 'application/vnd.apple.numbers', epub: 'application/epub+zip', zip: 'application/zip',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', mp4: 'video/mp4', mov: 'video/quicktime',
};
function fileExt(name) { const m = String(name || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/); return m ? m[1] : ''; }
// The extension wins when it's a known one: it's what the person sees, and
// what their computer uses to decide which app opens the file.
function mimeForFile(name, type) {
  return MIME_BY_EXT[fileExt(name)] || (type && type !== 'application/octet-stream' ? type : 'application/octet-stream');
}
// Short label for a file row: "PDF", "DOCX", or just "File".
function fileTypeLabel(name) { const ext = fileExt(name); return ext && MIME_BY_EXT[ext] ? ext.toUpperCase() : 'File'; }
// Path-safe version of a file name for a storage path, extension kept.
function storageSafeName(name) {
  const ext = fileExt(name);
  const base = String(name || 'file').replace(/\.[^.]*$/, '').normalize('NFKD').replace(/[^\w\s.-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'file';
  return ext ? `${base}.${ext}` : base;
}
// Storage metadata that makes a download open or save under its real name.
// A name with no extension (an attachment renamed "Rubric") gets the one its
// type calls for, so the saved copy still opens in the right app.
function storageFileMetadata(name, type) {
  let clean = String(name || 'file').replace(/[\r\n"]+/g, '').trim().slice(0, 180) || 'file';
  if (!MIME_BY_EXT[fileExt(clean)]) {
    const ext = Object.keys(MIME_BY_EXT).find(k => MIME_BY_EXT[k] === type);
    if (ext) clean += `.${ext}`;
  }
  const ascii = clean.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/[\\;]/g, '').replace(/\s{2,}/g, ' ') || 'file';
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return { contentType: mimeForFile(clean, type), contentDisposition: `inline; filename="${ascii}"; filename*=UTF-8''${encoded}` };
}

function lighten(hex, amt) {
  const c = hex.replace('#', '');
  const r = clamp(parseInt(c.substr(0, 2), 16) + amt, 0, 255);
  const g = clamp(parseInt(c.substr(2, 2), 16) + amt, 0, 255);
  const b = clamp(parseInt(c.substr(4, 2), 16) + amt, 0, 255);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}
/* Blends toward white by a fraction (0-1). Unlike lighten()'s flat channel
   add, this never clips to pure white for colors that are already light
   (e.g. the Petal/Sage accents), so tinted badges/pills stay visibly tinted. */
function tint(hex, pct) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
  const mix = (ch) => Math.round(ch + (255 - ch) * pct);
  return '#' + [mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}
