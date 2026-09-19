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
let _modalReturnFocus = null;
function openModal(html, { wide = false, onClose } = {}) {
  _modalGen++;
  const modal = $('#modal');
  const wasOpen = $('#modal-wrap').classList.contains('show');
  if (!wasOpen) _modalReturnFocus = document.activeElement;
  modal.className = 'modal' + (wide ? ' wide' : '');
  modal.innerHTML = html;
  const title = modal.querySelector('.modal-head h3');
  if (title) { title.id = 'modal-title'; modal.setAttribute('aria-labelledby', 'modal-title'); } else modal.removeAttribute('aria-labelledby');
  $('#overlay').classList.add('show');
  $('#modal-wrap').classList.add('show');
  _modalCloseHandler = onClose || null;
  enhanceAccessibility(modal);
  // Move focus into the dialog (unless something inside already grabbed it).
  if (!modal.contains(document.activeElement)) setTimeout(() => { if (!modal.contains(document.activeElement)) (modal.querySelector('.modal-body input:not([type=hidden]):not([disabled]), .modal-body textarea, .modal-body select') || modal).focus({ preventScroll: true }); }, 30);
}
function closeModal() {
  const wasOpen = $('#modal-wrap').classList.contains('show');
  $('#overlay').classList.remove('show');
  $('#modal-wrap').classList.remove('show');
  if (wasOpen && _modalReturnFocus && document.contains(_modalReturnFocus)) { try { _modalReturnFocus.focus({ preventScroll: true }); } catch {} }
  _modalReturnFocus = null;
  if (_modalCloseHandler) { _modalCloseHandler(); _modalCloseHandler = null; }
  // Snapshot the generation so a stale timeout can't wipe out a modal that
  // opened again (e.g. closeModal() immediately followed by openModal())
  // before this delay elapses.
  const gen = _modalGen;
  setTimeout(() => { if (_modalGen === gen) $('#modal').innerHTML = ''; }, 180);
}
// What Escape and the backdrop call. While the semester setup is open it
// keeps a draft of what was typed instead of losing it; anything else closes.
function requestCloseModal() {
  const setupOpen = window._setup && $('#modal-wrap').classList.contains('show') && $('#modal .setup-body');
  if (setupOpen && typeof closeSemesterSetup === 'function') { closeSemesterSetup(); return; }
  closeModal();
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
  return `<span class="course-chip tinted" style="--c:${c.color}">${esc(c.code || c.name)}</span>`;
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
  return `<div class="page-head"><div><h2>${esc(title)}</h2>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div><div class="head-actions"><button class="btn btn-icon btn-sm mobile-search" aria-label="Search" onclick="openCommandPalette()">${typeof searchIcon === 'function' ? searchIcon() : ''}</button><button class="btn btn-icon btn-sm mobile-search" aria-label="Quick capture" onclick="openQuickCapture()">${icon('camera', 15, 1.8)}</button>${typeof bellButton === 'function' ? bellButton('btn-sm mobile-search') : ''}${signInHeaderButton()}${actionsHtml}</div></div>`;
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
// In the demo these show a lock and explain Plus when clicked (see requireAi).
function aiButton(label, onclick, id) {
  const locked = typeof aiLooksUnlocked === 'function' && !aiLooksUnlocked();
  return `<button class="btn btn-sm" ${id ? `id="${id}"` : ''} onclick="${onclick}" style="background:var(--badge);color:var(--ink);border:none" ${locked ? 'title="Included with Semester HQ Plus"' : ''}>${icon(locked ? 'lock' : 'sparkles', 13, 1.6)} ${esc(label)}</button>`;
}
function setBtnLoading(btn, loading, labelWhenDone) {
  if (!btn) return;
  if (loading) { btn.dataset.origHtml = btn.innerHTML; btn.innerHTML = '<span class="spin" style="display:inline-flex">' + icon('refresh-cw', 13, 2) + '</span> Working<span class="loading-dots"></span>'; btn.disabled = true; }
  else { btn.innerHTML = labelWhenDone || btn.dataset.origHtml || btn.innerHTML; btn.disabled = false; }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { requestCloseModal(); return; }
  // Keep Tab inside an open dialog.
  if (e.key === 'Tab' && $('#modal-wrap').classList.contains('show')) {
    const f = [...$('#modal').querySelectorAll('button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && (document.activeElement === f[0] || !$('#modal').contains(document.activeElement))) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
  // Enter/Space activates anything made clickable by enhanceAccessibility.
  const t = e.target;
  const activatable = t?.getAttribute?.('role') === 'button' || (e.key === 'Enter' && t?.hasAttribute?.('data-row-click'));
  if ((e.key === 'Enter' || e.key === ' ') && activatable && !/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && !e.defaultPrevented) {
    e.preventDefault();
    t.click();
  }
});

// The app renders plenty of clickable rows and cards as <div onclick>. This
// makes every one of them reachable and usable from the keyboard and screen
// readers, and gives placeholder-only fields an accessible name.
/* ── "You already have these" ─────────────────────────────────────
   Shown before an upload adds something whose name matches what's
   already in the planner. Skipping is the default: the copy already
   there may have notes, steps, or a different due date on it. `run` is
   called with true to skip the repeats, false to add them anyway. */
/* ── A file you already have here ─────────────────────────────────
   Uploading the same screenshot or handout twice is easy to do and
   there's no way to notice afterwards, so anything arriving with a
   name that's already in this place stops and asks first. Names are
   compared the loose way (see normalizedTitle), so "Lab 3.png" and
   "lab-3.PNG" count as the same file, and only within one place:
   the same handout shared to two clubs is two different things.
   run(true) replaces what's there, run(false) keeps both. */
function askAboutDuplicateFile(name, where, { onReplace = null, onKeepBoth } = {}) {
  window._dupFileKeepBoth = onKeepBoth;
  window._dupFileReplace = onReplace;
  openModal(`
    <div class="modal-head"><h3>You already have that one</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <p class="small"><strong>${esc(name)}</strong> is already ${esc(where)}.</p>
      <p class="small muted mt-8">${onReplace ? 'Replace it with this new copy, or keep both if they’re genuinely different files.' : 'Add it again if they’re genuinely different files, or cancel and use the one that’s already there.'}</p>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn" onclick="closeModal();window._dupFileKeepBoth&&window._dupFileKeepBoth()">Keep both</button>
      ${onReplace ? `<button class="btn btn-primary" onclick="closeModal();window._dupFileReplace&&window._dupFileReplace()">Replace</button>` : ''}
    </div>
  `);
}
// Finds an existing entry whose name matches, across the several shapes files
// take in the app (attachments, club files, group resources).
function findFileByName(list, name) {
  const key = normalizedTitle(String(name || '').replace(/\.[a-z0-9]{1,6}$/i, ''));
  if (!key) return null;
  return (list || []).find(f => {
    const candidates = [f.fileName, f.name, f.title].filter(Boolean);
    return candidates.some(c => normalizedTitle(String(c).replace(/\.[a-z0-9]{1,6}$/i, '')) === key);
  }) || null;
}

function askAboutDuplicates(duplicates, total, noun, run) {
  if (!duplicates.length) { run(false); return; }
  const all = duplicates.length >= total;
  const named = duplicates.slice(0, 6).map(d => `<li>${esc(d.title || d.name || '')}</li>`).join('');
  window._duplicateChoice = run;
  openModal(`
    <div class="modal-head"><h3>Already in your planner</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <p class="small">${all ? `Every ${noun} here matches something you already have:` : `${duplicates.length} of these ${duplicates.length === 1 ? 'matches' : 'match'} something you already have:`}</p>
      <ul class="dup-list small">${named}${duplicates.length > 6 ? `<li class="muted">and ${duplicates.length - 6} more</li>` : ''}</ul>
      <p class="small muted mt-8">Skipping keeps what’s already there, including any notes, steps, or dates you changed.</p>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Go back</button>
      <button class="btn" onclick="closeModal();window._duplicateChoice(false)">Add anyway</button>
      <button class="btn btn-primary" onclick="closeModal();window._duplicateChoice(true)">${all ? 'Skip them' : `Skip ${duplicates.length}, add the rest`}</button>
    </div>
  `);
}

/* ── Long sections: cap them, and open one on its own ─────────────
   Settings, the dashboard, and the assignments list all stack more than
   fits on a screen. Anything taller than its cap is trimmed with a
   "Show all", which lifts that one section out full size instead of
   making someone scroll past everything else to reach the next thing.
   Nothing is hidden permanently: a section that fits is left alone. */
let _openSection = null;
function expandable(key, title, html, { max = 360, style = '', count = null } = {}) {
  const label = count ? `Show all ${count}` : 'Show all';
  return `<div class="xp" data-xp="${esc(key)}" data-xp-title="${esc(title)}" style="--xp-max:${max}px;${style}">
    <div class="xp-body">${html}</div>
    <button class="xp-fade" onclick="openSection('${esc(key)}')" aria-label="${esc(label)} of ${esc(title)}"><span class="xp-fade-btn">${esc(label)} ${icon('maximize', 12, 2)}</span></button>
  </div>`;
}
function openSection(key) { _openSection = key; render(); }
function closeSection() { _openSection = null; render(); }
// Runs after every render: measures what's too tall, and moves the section
// being viewed on its own into the full-screen layer.
function applyExpandables(root) {
  const layer = $('#focus-layer');
  if (!layer) return;
  layer.innerHTML = '';
  layer.hidden = true;
  const target = _openSection ? root.querySelector(`[data-xp="${CSS.escape(_openSection)}"]`) : null;
  if (_openSection && !target) _openSection = null;
  if (target) {
    layer.hidden = false;
    layer.innerHTML = `<div class="focus-sheet" role="dialog" aria-modal="true" aria-label="${esc(target.dataset.xpTitle || 'Section')}">
      <div class="focus-head"><h3>${esc(target.dataset.xpTitle || '')}</h3><button class="btn btn-sm" onclick="closeSection()">${icon('minimize', 12, 2)} Collapse</button></div>
      <div class="focus-body"></div>
    </div>`;
    layer.querySelector('.focus-body').appendChild(target);
    target.classList.add('is-open');
    return;
  }
  root.querySelectorAll('.xp').forEach(el => {
    const body = el.querySelector('.xp-body');
    el.classList.toggle('is-clipped', !!body && body.scrollHeight > body.clientHeight + 8);
  });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && _openSection) { e.preventDefault(); closeSection(); } });

function enhanceAccessibility(root) {
  if (!root) return;
  root.querySelectorAll('[onclick]:not(button):not(a):not(input):not(select):not(textarea):not(label):not([role])').forEach(el => {
    if (el.closest('.sg-grid')) return;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    // A row holding its own buttons (a checkbox, a menu) can't itself be a
    // button, so it stays focusable and opens with Enter instead.
    if (el.querySelector('button, a[href], input, select, textarea, [onclick]')) el.setAttribute('data-row-click', '');
    else el.setAttribute('role', 'button');
  });
  root.querySelectorAll('input:not([type=hidden]):not([aria-label]), textarea:not([aria-label]), select:not([aria-label])').forEach(el => {
    if (el.id && root.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return;
    if (el.closest('label')) return;
    const prev = el.previousElementSibling;
    const name = el.getAttribute('placeholder') || el.getAttribute('title') || (prev && (prev.tagName === 'LABEL' || prev.classList.contains('label')) ? prev.textContent.trim() : '');
    if (name) el.setAttribute('aria-label', name);
  });
}
