/* ── Shared UI primitives: toast, modal, small render helpers ───── */
// action: optional { label, run } shown as a button (e.g. Undo).
function toast(msg, type = 'success', duration = 2600, action = null) {
  const stack = $('#toast-stack');
  const icons = { success: icon('check', 11, 2.6), error: icon('x', 11, 2.6), info: icon('sparkles', 11, 1.9) };
  const el = document.createElement('div');
  el.className = `toast ${type}${action ? ' has-action' : ''}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `<span class="ic">${icons[type] || icons.info}</span><span>${esc(msg)}</span>${action ? `<button class="toast-action">${esc(action.label)}</button>` : ''}`;
  const dismiss = () => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; setTimeout(() => el.remove(), 250); };
  if (action) el.querySelector('.toast-action').onclick = () => { action.run(); dismiss(); };
  stack.appendChild(el);
  setTimeout(dismiss, action ? Math.max(duration, 5000) : duration);
}

let _modalCloseHandler = null;
let _modalGen = 0;
function openModal(html, { wide = false, onClose } = {}) {
  _modalGen++;
  $('#modal').className = 'modal' + (wide ? ' wide' : '');
  $('#modal').innerHTML = html;
  $('#overlay').classList.add('show');
  $('#modal-wrap').classList.add('show');
  _modalCloseHandler = onClose || null;
  bindPage($('#modal'));
}
function closeModal() {
  $('#overlay').classList.remove('show');
  $('#modal-wrap').classList.remove('show');
  if (_modalCloseHandler) { _modalCloseHandler(); _modalCloseHandler = null; }
  // Snapshot the generation so a stale timeout can't wipe out a modal that
  // opened again (e.g. closeModal() immediately followed by openModal())
  // before this delay elapses.
  const gen = _modalGen;
  setTimeout(() => { if (_modalGen === gen) $('#modal').innerHTML = ''; }, 180);
}
function confirmDialog(message, onConfirm, confirmLabel = 'Delete') {
  openModal(`
    <div class="modal-body" style="padding-top:22px">
      <p style="font-size:14px">${esc(message)}</p>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" id="confirm-yes">${esc(confirmLabel)}</button>
    </div>
  `);
  $('#confirm-yes').onclick = () => { closeModal(); onConfirm(); };
}

function courseChip(courseId, { small } = {}) {
  const c = getCourse(courseId);
  if (!c) return `<span class="course-chip" style="background:var(--surface-2);color:var(--text-faint)">No course</span>`;
  return `<span class="course-chip" style="background:${c.color}22;color:${c.color}">${esc(c.code || c.name)}</span>`;
}
function typeTag(type) {
  const colors = { exam: 'var(--danger)', quiz: 'var(--warn)', project: 'var(--accent)', paper: 'var(--accent)', reading: 'var(--text-faint)', discussion: 'var(--success)', lab: 'var(--accent)', assignment: 'var(--text-dim)' };
  const c = colors[type] || 'var(--text-dim)';
  return `<span class="tag" style="background:${c}18;color:${c}">${esc(type)}</span>`;
}
function priorityDot(p) {
  const cls = { high: 'priority-high', medium: 'priority-med', low: 'priority-low' }[p] || 'priority-med';
  return `<span class="${cls}" title="${p} priority">●</span>`;
}
function emptyState(icon, text, actionHtml = '', sub = '') {
  return `<div class="empty"><div class="ic">${icon}</div><p>${esc(text)}</p>${sub ? `<div class="empty-sub">${esc(sub)}</div>` : ''}${actionHtml}</div>`;
}
function pageHead(title, sub, actionsHtml = '') {
  return `<div class="page-head"><div><h2>${esc(title)}</h2>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div><div class="head-actions"><button class="btn btn-icon btn-sm mobile-search" aria-label="Search" onclick="openCommandPalette()">${typeof searchIcon === 'function' ? searchIcon() : ''}</button>${typeof bellButton === 'function' ? bellButton('btn-sm mobile-search') : ''}${signInHeaderButton()}${actionsHtml}</div></div>`;
}
// A persistent, always-visible way to log in, not just buried in a modal or
// Settings, since it's the same click for a brand-new account or an existing
// paid one (Google sign-in / resolveLicenseStatus handles both, see
// firebase.js). Links to the dedicated login.html page rather than opening
// an in-app modal, so logging in or signing up is always a real page, never
// a popup layered on top of whatever you were doing.
function signInHeaderButton() {
  if (!fbConfigured() || _fbUser) return '';
  return `<a class="btn btn-sm" href="login.html">${icon('sparkles', 13, 2)} Log in</a>`;
}
// Circular progress indicator (0-100, or null for an empty ring).
function progressRing(pct, color, size = 76) {
  const r = (size - 8) / 2, circ = 2 * Math.PI * r;
  const frac = pct == null ? 0 : clamp(pct, 0, 100) / 100;
  return `<svg class="progress-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="6"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color || 'var(--accent)'}" stroke-width="6" stroke-linecap="round"
      stroke-dasharray="${(circ * frac).toFixed(2)} ${circ.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`;
}
function aiButton(label, onclick, id) {
  return `<button class="btn btn-sm" ${id ? `id="${id}"` : ''} onclick="${onclick}" style="background:var(--badge);color:var(--ink);border:none">${icon('sparkles', 13, 1.5)} ${esc(label)}</button>`;
}
function setBtnLoading(btn, loading, labelWhenDone) {
  if (!btn) return;
  if (loading) { btn.dataset.origHtml = btn.innerHTML; btn.innerHTML = '<span class="spin" style="display:inline-flex">' + icon('refresh-cw', 13, 2) + '</span> Working<span class="loading-dots"></span>'; btn.disabled = true; }
  else { btn.innerHTML = labelWhenDone || btn.dataset.origHtml || btn.innerHTML; btn.disabled = false; }
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
