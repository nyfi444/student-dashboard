/* ── Shared UI primitives: toast, modal, small render helpers ───── */
function toast(msg, type = 'success', duration = 2600) {
  const stack = $('#toast-stack');
  const icons = { success: icon('check', 11, 2.6), error: icon('x', 11, 2.6), info: icon('sparkles', 11, 1.9) };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="ic">${icons[type] || icons.info}</span><span>${esc(msg)}</span>`;
  stack.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; setTimeout(() => el.remove(), 250); }, duration);
}

let _modalCloseHandler = null;
function openModal(html, { wide = false, onClose } = {}) {
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
  setTimeout(() => { $('#modal').innerHTML = ''; }, 180);
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
  return `<div class="page-head"><div><h2>${esc(title)}</h2>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div><div class="head-actions">${actionsHtml}</div></div>`;
}
function aiButton(label, onclick, id) {
  return `<button class="btn btn-sm" ${id ? `id="${id}"` : ''} onclick="${onclick}" style="background:var(--champagne);color:var(--ink);border:none">${icon('sparkles', 13, 1.5)} ${esc(label)}</button>`;
}
function setBtnLoading(btn, loading, labelWhenDone) {
  if (!btn) return;
  if (loading) { btn.dataset.origHtml = btn.innerHTML; btn.innerHTML = '<span class="spin" style="display:inline-flex">' + icon('refresh-cw', 13, 2) + '</span> Working<span class="loading-dots"></span>'; btn.disabled = true; }
  else { btn.innerHTML = labelWhenDone || btn.dataset.origHtml || btn.innerHTML; btn.disabled = false; }
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
