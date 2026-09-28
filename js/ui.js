/* ── Shared UI primitives: toast, modal, small render helpers ───── */
// action: optional { label, run } shown as a button (e.g. Undo).
function toast(msg, type = 'success', duration = 2600, action = null) {
  const stack = $('#toast-stack');
  // Inverse ink, compact. Info carries no icon; success and error keep a
  // small glyph so the state is never color alone.
  const icons = { success: icon('check', 14), error: icon('x', 14) };
  const el = document.createElement('div');
  el.className = `toast ${type}${action ? ' has-action' : ''}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `${icons[type] ? `<span class="ic">${icons[type]}</span>` : ''}<span>${esc(msg)}</span>${action ? `<button class="toast-action">${esc(action.label)}</button>` : ''}`;
  const dismiss = () => { el.style.opacity = '0'; el.style.transition = 'opacity var(--dur-2)'; setTimeout(() => el.remove(), 200); };
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
  modal.scrollTop = 0; // .is-scrolled is cleared by the className reset above
  // Every dialog is named by its first heading, wherever that heading sits.
  // One that already has an id keeps it; otherwise it gets one here.
  const title = modal.querySelector('h2, h3');
  if (title) { if (!title.id) title.id = 'modal-title'; modal.setAttribute('aria-labelledby', title.id); } else modal.removeAttribute('aria-labelledby');
  $('#overlay').classList.add('show');
  $('#modal-wrap').classList.add('show');
  _modalCloseHandler = onClose || null;
  enhanceAccessibility(modal);
  // Move focus into the dialog (unless something inside already grabbed it).
  // The first field that is actually rendered: a hidden file input can't take focus.
  if (!modal.contains(document.activeElement)) setTimeout(() => {
    if (modal.contains(document.activeElement)) return;
    const first = [...modal.querySelectorAll('.modal-body input:not([type=hidden]):not([disabled]), .modal-body textarea:not([disabled]), .modal-body select:not([disabled])')].find(el => el.getClientRects().length && !el.closest('[hidden]'));
    (first || modal).focus({ preventScroll: true });
  }, 30);
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
// `title` is the heading that names the dialog for screen readers. The
// default asks the plain question; a caller with a sharper one passes it in.
function confirmDialog(message, onConfirm, confirmLabel = 'Delete', title = 'Are you sure?') {
  openModal(`
    <div class="modal-head"><h3 id="confirm-title">${esc(title)}</h3>${closeXButton()}</div>
    <div class="modal-body">
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
  const label = String(type || '');
  return `<span class="tag" style="background:color-mix(in srgb, ${c} 10%, transparent);color:${c}">${esc(label.charAt(0).toUpperCase() + label.slice(1))}</span>`;
}
function priorityDot(p) {
  const cls = { high: 'priority-high', medium: 'priority-med', low: 'priority-low' }[p] || 'priority-med';
  return `<span class="${cls}" title="${p} priority">●</span>`;
}
function emptyState(icon, text, actionHtml = '', sub = '') {
  return `<div class="empty"><div class="ic">${icon}</div><p>${esc(text)}</p>${sub ? `<div class="empty-sub">${esc(sub)}</div>` : ''}${actionHtml}</div>`;
}
/* ── Empty state: what a page shows before it has anything ────────
   One shared look for every first visit: a calm card with a serif
   title, one sentence, and the one or two buttons that lead to the
   obvious next step. `actions` is [{ label, onclick, primary, icon }];
   the first one is primary unless told otherwise. `onclick` is code
   written by the caller, never user data. `compact` fits the same
   thing inside another card. `extra` is optional html under the
   buttons, for a quieter third choice like a sample-data link. */
function emptyStateHtml({ icon: iconName = null, title = '', body = '', actions = [], compact = false, extra = '' } = {}) {
  const buttons = actions.filter(a => a && a.label && a.onclick).map((a, i) => {
    const primary = a.primary != null ? a.primary : i === 0;
    return `<button class="btn${primary ? ' btn-primary' : ''}${compact ? ' btn-sm' : ''}" onclick="${a.onclick}">${a.icon ? icon(a.icon, compact ? 14 : 16) : ''}${esc(a.label)}</button>`;
  }).join('');
  const disc = iconName ? icon(iconName, 20) : '';
  return `<div class="${compact ? 'empty-state compact' : 'card empty-state'}">
    ${disc ? `<span class="empty-state-ic" aria-hidden="true">${disc}</span>` : ''}
    <h3 class="empty-state-title">${esc(title)}</h3>
    ${body ? `<p class="empty-state-body">${esc(body)}</p>` : ''}
    ${buttons ? `<div class="empty-state-actions">${buttons}</div>` : ''}
    ${extra ? `<div class="empty-state-extra">${extra}</div>` : ''}
  </div>`;
}
/* ── Inline error: a failure that stays on the page ───────────────
   A toast disappears in a few seconds, which is fine for "saved" and
   useless for "this did not load". This sits where the content should
   have been, says what went wrong in one line, and offers a retry.
   `retryOnclick` is code written by the caller; `extra` is optional
   html for a second way out (leave, remove, go back). */
function inlineErrorHtml(message, retryOnclick = '', { retryLabel = 'Try again', extra = '' } = {}) {
  return `<div class="inline-error" role="alert">
    <span class="inline-error-ic" aria-hidden="true">${icon('alert-circle', 16)}</span>
    <div class="inline-error-msg">${esc(message)}</div>
    ${retryOnclick ? `<button class="btn btn-sm" onclick="${retryOnclick}">${icon('refresh-cw', 14)}${esc(retryLabel)}</button>` : ''}
    ${extra}
  </div>`;
}
// On a desktop the title sits left and every action sits right, as before.
// On a phone every page used to stack search, capture, the bell, Log in and
// then its own buttons, wrapping into two or three rows before the page even
// started. There, the tools ride next to the title, the row below keeps
// Log in and the page's one primary button, and everything else moves into
// a "More" sheet (openHeadMore) that lists each action by name.
//
// Header actions: the primary, at most 2 labelled ghosts and at most 2 icon
// ghosts stay visible. A renderer marks every other secondary `head-menu`;
// enhancePageHeads() then shows the ··· button, which lists them in a
// popover on a desktop and in the sheet on a phone. Nothing is counted.
// opts.titleHtml is trusted markup used instead of the escaped title (the
// calendar needs it); opts.className adds classes to .page-head.
function pageHead(title, sub, actionsHtml = '', opts = {}) {
  const tools = `<button class="btn btn-icon btn-sm mobile-search" aria-label="Search" data-tip="Search" onclick="openCommandPalette()">${icon('search', 20)}</button><button class="btn btn-icon btn-sm mobile-search" aria-label="Quick capture" data-tip="Quick capture" onclick="openQuickCapture()">${icon('camera', 20)}</button>${typeof bellButton === 'function' ? bellButton('btn-sm mobile-search') : ''}<button type="button" class="btn btn-icon btn-sm head-more-top" aria-label="More actions" data-tip="More actions" aria-haspopup="true" onclick="openHeadMore(this)">${icon('more-horizontal', 20)}</button>`;
  const titleHtml = opts.titleHtml != null ? opts.titleHtml : esc(title);
  return `<div class="page-head${opts.className ? ' ' + esc(opts.className) : ''}">
    <div class="page-head-top"><div class="page-head-title"><h2>${titleHtml}</h2>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div><div class="head-tools">${tools}</div></div>
    <div class="head-actions">${signInHeaderButton()}${actionsHtml}<button type="button" class="btn btn-ghost btn-icon head-more" aria-label="More actions" aria-haspopup="true" data-tip="More" onclick="openHeadMore(this)">${icon('more-horizontal', 16)}</button></div>
  </div>`;
}
// Runs after every render: a header that declared overflow (.head-menu)
// shows its ··· button on a desktop. On a phone, a row 2 that would show
// nothing but the ··· (no primary, no head-keep, no Log in) gets .only-more:
// the CSS hides that row and shows the ··· beside the header tools instead.
function enhancePageHeads(root) {
  if (!root) return;
  root.querySelectorAll('.head-actions').forEach(row => {
    row.classList.toggle('has-overflow', !!row.querySelector(':scope > .head-menu'));
    const hasTop = !!row.closest('.page-head')?.querySelector(':scope > .page-head-top .head-more-top');
    // What a phone still shows in row 2: anything but the ···, the desktop
    // Capture copy, and the secondary buttons the phone moves into the sheet.
    // While the demo line shows, the phone hides Log in (it is in that line).
    const skip = document.querySelector('#content > .demo-bar') ? '.head-more, .desktop-capture, .head-login' : '.head-more, .desktop-capture';
    const stays = [...row.children].some(el => !el.matches(skip) && !(el.matches('.btn') && !el.matches('.btn-primary, .head-keep')));
    row.classList.toggle('only-more', hasTop && !stays && headMoreItems(row).length > 0);
  });
}
// The right edge of a to-do or assignment row. Overdue says so in words
// with an icon (never color alone), today gets a filled tag, and everything
// later stays quiet. 11:59 PM is "due that day" and isn't printed.
function dueBadgeHtml(date, time, done, emptyLabel = '') {
  const t = time && time !== '23:59' && !done ? `<span class="due-time">${fmtTime(time)}</span>` : '';
  if (!date) return time && !done ? t : emptyLabel ? `<span class="due-none">${esc(emptyLabel)}</span>` : '';
  if (done) return `<span class="due-when">${esc(fmtDate(date))}</span>`;
  const when = esc(relativeDay(date).replace(' (overdue)', ''));
  if (date < todayIso()) return `<span class="due-tag is-overdue">${icon('clock', 12)}Overdue</span><span class="due-time">${when}</span>`;
  if (date === todayIso()) return `<span class="due-tag is-today">Today</span>${t}`;
  return `<span class="due-when">${when}</span>${t}`;
}
// The ··· button. On a desktop it opens a popover menu of the header's
// .head-menu items; on a phone it opens the "More" sheet listing every
// action the phone header hides, by name. Each item runs its own onclick
// unchanged; the menu or sheet closes first, so an action that opens its
// own modal isn't closed straight after.
function headMoreItems(row) {
  return [...row.children].filter(el => el.matches('.btn, a.btn, .head-menu') && !el.matches('.btn-primary, .head-keep, .head-more, .desktop-capture, .mobile-search'));
}
function headItemLabel(el) {
  return (el.textContent || '').trim() || el.getAttribute('aria-label') || el.getAttribute('data-tip') || el.getAttribute('title') || '';
}
function openHeadMore(btn) {
  // The row-1 copy of the ··· (.head-more-top) reads its own header's row 2.
  const row = btn.closest('.head-actions') || btn.closest('.page-head')?.querySelector(':scope > .head-actions');
  if (!row) return;
  if (window.matchMedia('(min-width: 761px)').matches) {
    const items = [...row.querySelectorAll(':scope > .head-menu')];
    const html = items.map(el => {
      const c = el.cloneNode(true);
      c.removeAttribute('id');
      [...c.classList].forEach(k => { if (k === 'btn' || k.startsWith('btn-') || k === 'head-menu' || k === 'is-on') c.classList.remove(k); });
      c.classList.add('menu-item');
      c.setAttribute('role', 'menuitem');
      c.removeAttribute('title'); c.removeAttribute('data-tip');
      if (el.matches('.btn-danger')) c.classList.add('is-danger');
      if (!(el.textContent || '').trim()) c.insertAdjacentHTML('beforeend', `<span>${esc(headItemLabel(el))}</span>`);
      return c.outerHTML;
    }).join('');
    if (html) openMenu(btn, html, { align: 'end' });
    return;
  }
  const title = btn.closest('.page-head')?.querySelector('h2')?.textContent || 'More';
  const items = headMoreItems(row);
  const html = items.map(el => {
    const c = el.cloneNode(true);
    c.removeAttribute('id'); c.removeAttribute('data-tip'); c.removeAttribute('title');
    c.classList.remove('btn-sm', 'btn-icon', 'btn-primary', 'btn-ghost', 'head-menu', 'is-on'); c.classList.add('head-sheet-item');
    if (!(el.textContent || '').trim()) c.insertAdjacentHTML('beforeend', `<span>${esc(headItemLabel(el))}</span>`);
    return c.outerHTML;
  }).join('');
  openModal(`<div class="modal-head"><h3>${esc(title)}</h3>${closeXButton()}</div><div class="modal-body head-sheet">${html}</div>`);
  const sheet = document.querySelector('#modal .head-sheet');
  if (sheet) sheet.addEventListener('click', e => { if (e.target.closest('.head-sheet-item')) closeModal(); }, true);
}

/* ── Menus: one popover for every "···" and split button ──────────
   openMenu(anchorEl, html, { align }) shows `html` (a list of
   .menu-item buttons, .menu-sep and .menu-label) in a fixed menu under
   the anchor, end-aligned by default ('start' lines up the left edges),
   clamped to the window and flipped above when there's no room below.
   Arrow keys, Home and End move between items; Escape, a click outside
   or choosing an item closes it and returns focus to the anchor. Each
   item runs its own onclick, after the menu has closed. Returns the menu
   element. closeMenu() closes whichever menu is open. */
let _menu = null;
function closeMenu(returnFocus = true) {
  if (!_menu) return;
  const { el, anchor, cleanup } = _menu;
  _menu = null;
  cleanup();
  el.remove();
  if (anchor) { anchor.setAttribute('aria-expanded', 'false'); if (returnFocus && document.contains(anchor)) { try { anchor.focus({ preventScroll: true }); } catch {} } }
}
function openMenu(anchorEl, html, { align = 'end' } = {}) {
  const reopen = _menu && _menu.anchor === anchorEl;
  closeMenu(false);
  if (reopen) { try { anchorEl.focus({ preventScroll: true }); } catch {} return null; }
  const el = document.createElement('div');
  el.className = 'menu menu-surface';
  el.setAttribute('role', 'menu');
  el.innerHTML = html;
  el.querySelectorAll('.menu-item').forEach(it => { if (!it.hasAttribute('role')) it.setAttribute('role', 'menuitem'); it.setAttribute('tabindex', '-1'); });
  el.style.visibility = 'hidden';
  document.body.appendChild(el);
  // Place: below the anchor, end-aligned, clamped 8px inside the window.
  const r = anchorEl.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = align === 'start' ? r.left : r.right - w;
  left = Math.max(8, Math.min(left, vw - w - 8));
  let top = r.bottom + 4;
  if (top + h > vh - 8 && r.top - 4 - h >= 8) top = r.top - 4 - h;
  top = Math.max(8, Math.min(top, vh - h - 8));
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  el.style.visibility = '';
  if (anchorEl) { anchorEl.setAttribute('aria-expanded', 'true'); }
  const items = () => [...el.querySelectorAll('.menu-item:not(:disabled)')];
  const onKey = e => {
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
    // Back on the anchor first, so the browser's own Tab moves on from the ···.
    else if (e.key === 'Tab') { closeMenu(true); }
  };
  const onDown = e => { if (!el.contains(e.target) && !anchorEl.contains(e.target)) closeMenu(false); };
  const onScroll = e => { if (!el.contains(e.target)) closeMenu(false); };
  const onResize = () => closeMenu(false);
  // An item closes the menu first, then its own onclick runs (capture phase).
  el.addEventListener('click', e => { if (e.target.closest('.menu-item')) closeMenu(false); }, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onResize);
  _menu = { el, anchor: anchorEl, cleanup: () => {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize);
  } };
  items()[0]?.focus({ preventScroll: true });
  return el;
}

// The close button every dialog uses: a quiet 32px square with a tooltip.
function closeXButton(onclick = 'closeModal()') {
  return `<button class="close-x" aria-label="Close" data-tip="Close" onclick="${onclick}">${icon('x', 16)}</button>`;
}

/* ── Keyboard shortcut label: ⌘ on Apple devices, Ctrl+ elsewhere ── */
function modKey() {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+';
}

/* ── Tooltips: one designed tip for every [data-tip] ───────────────
   Icon-only controls carry data-tip plus aria-label (never title, so two
   tips never show). Pointer hover opens it after 500ms, or at once if a
   tip closed in the last 800ms; keyboard focus opens it too. data-tip-kbd
   adds a shortcut: data-tip-kbd="B" reads "⌘B". Called once from app.js. */
let _tipsWired = false;
function wireTooltips() {
  if (_tipsWired) return;
  _tipsWired = true;
  let tipEl = null, timer = null, current = null, lastHide = 0;
  const canHover = window.matchMedia('(hover: hover)').matches;
  const hide = () => {
    clearTimeout(timer); timer = null;
    if (tipEl) { tipEl.remove(); tipEl = null; lastHide = Date.now(); }
    current = null;
  };
  const show = target => {
    if (!target || !document.contains(target)) return;
    const text = target.getAttribute('data-tip');
    if (!text) return;
    if (tipEl) tipEl.remove();
    tipEl = document.createElement('div');
    tipEl.className = 'tip';
    tipEl.setAttribute('role', 'tooltip');
    const kbd = target.getAttribute('data-tip-kbd');
    tipEl.innerHTML = `${esc(text)}${kbd ? `<kbd>${esc(modKey() + kbd)}</kbd>` : ''}`;
    tipEl.style.visibility = 'hidden';
    document.body.appendChild(tipEl);
    const r = target.getBoundingClientRect();
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = r.top - 6 - h;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    tipEl.style.left = `${Math.round(left)}px`;
    tipEl.style.top = `${Math.round(Math.max(8, top))}px`;
    tipEl.style.visibility = '';
  };
  const schedule = target => {
    if (current === target) return;
    hide();
    current = target;
    const delay = Date.now() - lastHide < 800 ? 0 : 500;
    timer = setTimeout(() => show(target), delay);
  };
  if (canHover) {
    document.addEventListener('pointerover', e => {
      if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      const t = e.target.closest?.('[data-tip]');
      if (t) schedule(t);
    });
    document.addEventListener('pointerout', e => {
      const t = e.target.closest?.('[data-tip]');
      if (t && t === current && !t.contains(e.relatedTarget)) hide();
    });
  }
  document.addEventListener('focusin', e => {
    const t = e.target.closest?.('[data-tip]');
    if (t && t.matches(':focus-visible')) schedule(t); else if (current) hide();
  });
  document.addEventListener('focusout', e => { if (current && e.target.closest?.('[data-tip]') === current) hide(); });
  document.addEventListener('pointerdown', () => { if (current) hide(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && current) hide(); }, true);
  window.addEventListener('scroll', () => { if (current) hide(); }, true);
  window.addEventListener('blur', hide);
}

// One scroll listener for the dialog: its header gets a hairline once the
// body scrolls under it. openModal() resets the class and scroll position.
(function wireModalScroll() {
  const modal = typeof document !== 'undefined' && document.getElementById('modal');
  if (!modal) return;
  modal.addEventListener('scroll', () => modal.classList.toggle('is-scrolled', modal.scrollTop > 0), { passive: true });
})();
// A persistent, always-visible way to log in, not just buried in a modal or
// Settings, since it's the same click for a brand-new account or an existing
// paid one (Google sign-in / resolveLicenseStatus handles both, see
// firebase.js). Links to the dedicated login.html page rather than opening
// an in-app modal, so logging in or signing up is always a real page, never
// a popup layered on top of whatever you were doing.
function signInHeaderButton() {
  if (!fbConfigured() || _fbUser) return '';
  return `<a class="btn btn-ghost btn-sm head-keep head-login" href="login.html">Log in</a>`;
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
// `cls` adds classes, e.g. 'head-menu' when the button sits in a page head.
function aiButton(label, onclick, id, cls = '') {
  const locked = typeof aiLooksUnlocked === 'function' && !aiLooksUnlocked();
  return `<button class="btn btn-sm${cls ? ' ' + cls : ''}" ${id ? `id="${id}"` : ''} onclick="${onclick}" ${locked ? 'data-tip="Included with Semester HQ Plus"' : ''}>${esc(label)}${locked ? `<span class="ai-lock">${icon('lock', 12)}</span>` : ''}</button>`;
}
function setBtnLoading(btn, loading, labelWhenDone) {
  if (!btn) return;
  if (loading) { btn.dataset.origHtml = btn.innerHTML; btn.innerHTML = '<span class="spin" style="display:inline-flex">' + icon('refresh-cw', 14) + '</span> Working<span class="loading-dots"></span>'; btn.disabled = true; }
  else { btn.innerHTML = labelWhenDone || btn.dataset.origHtml || btn.innerHTML; btn.disabled = false; }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (_menu) return; requestCloseModal(); return; }
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
    <div class="modal-head"><h3>You already have that one</h3>${closeXButton()}</div>
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
    <div class="modal-head"><h3>Already in your planner</h3>${closeXButton()}</div>
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
  // Every dialog's close button gets the designed tip, whoever built it.
  root.querySelectorAll('.close-x:not([data-tip])').forEach(el => { el.setAttribute('data-tip', 'Close'); el.removeAttribute('title'); if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', 'Close'); });
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
