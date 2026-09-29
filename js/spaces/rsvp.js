/* ── Spaces: RSVP, shared by study groups and clubs ─────────────────
   One control for both features. It renders only; each feature keeps its
   own write, reached through SPACE_RSVP_ADAPTERS:
     group  setSessionRsvp(code, sid, val, toggle)   sessions.<sid>.rsvp.<uid>
            answers yes | maybe | no
     club   setOrgRsvp(code, eventId, val, toggle)    rsvp.<uid>.<eventId>
            answers yes | no (club "maybe" waits for Tier B)
   Nothing here adds a field: the only values written are those answers,
   and "Still coming? Yes" is remembered per device in localStorage.

   spaceRsvp({ kind, code, id, title, mine, size, stillComing, clearable })
     size 'hero' (40px buttons, 44px on phones) or 'row' (32px, compact).
     Unanswered: Going / Maybe / Can't buttons (Going / Can't for clubs).
     Answered: a status pill ("You're going", "Maybe", "Can't make it";
     just "Going" in a row) and, in the hero, a Change link. Change (or
     tapping the row pill) reopens the buttons in place. stillComing adds
     "Still coming? Yes / Can't anymore" (see spaceStillComingDue).
     clearable adds "Clear answer" while changing (the event sheet only).
     Root markup: div.space-rsvp.sg-rsvp.is-<size>[.is-answered]
     [.is-changing][data-rsvp-key]; buttons .space-rsvp-btn with
     aria-pressed; pill .space-rsvp-pill.is-<answer>.
   setSpaceRsvp(kind, code, id, val, { toggle = true, from })
     Writes through the adapter. toggle=false never clears an answer
     (spaceRsvpNextValue); every button the control draws passes false.
     from (the tapped element) lets focus land back on the control after
     the page redraws.
   spaceRsvpNextValue(current, val, toggle = true) -> val, or null to clear.
   spaceRsvpMine(kind, code, id) -> '' | 'yes' | 'maybe' | 'no'
   spaceStillComingDue(kind, code, id, ev, mine) -> boolean
     True on the day of an event you said yes to, until it starts, unless
     you answered "Yes" to the prompt (or said yes at all) on this device
     today. A yes given on the day never asks again.
   spaceStillComing(kind, code, id, yes, el)
     yes: keeps your yes (never clears it) and hides the prompt for today.
     no: writes "no". Reopens Heads up when it was answered from there.
   spaceRsvpLists({ key, lists, active })
     The event sheet's segmented lists. lists: [{ key, label, short,
     people: [{ uid, name, sub }], colorOf, empty, footHtml }].
   spaceEventSheet({ kind, code, id, color, glyph, spaceName, title, date,
                     start, end, where, notes, tags, rsvpHtml, facesHtml,
                     actionsHtml, listsHtml, footHtml })
     The whole event sheet (modal content). Plain text: spaceName, title,
     notes (linkified). Trusted HTML: tags, the *Html options.
──────────────────────────────────────────────────────────────── */
const SPACE_RSVP_CHOICES = {
  group: [['yes', 'Going', 'check'], ['maybe', 'Maybe', 'help-circle'], ['no', 'Can’t', 'x']],
  club: [['yes', 'Going', 'check'], ['no', 'Can’t', 'x']],
};
const SPACE_RSVP_STATUS = { yes: ['You’re going', 'Going', 'check'], maybe: ['Maybe', 'Maybe', 'help-circle'], no: ['Can’t make it', 'Can’t', 'x'] };
const SPACE_RSVP_ADAPTERS = {
  group: {
    write: (code, id, val, toggle) => setSessionRsvp(code, id, val, toggle),
    mine: (code, id) => { const g = findGroup(code); return (g && g.sessions?.[id]?.rsvp?.[myUidFor(g)]) || ''; },
    event: (code, id) => findGroup(code)?.sessions?.[id] || null,
  },
  club: {
    write: (code, id, val, toggle) => setOrgRsvp(code, id, val, toggle),
    mine: (code, id) => { const o = findOrg(code); return o ? myOrgRsvp(o, id) : ''; },
    event: (code, id) => { const o = findOrg(code); return (o && typeof orgEventList === 'function' && orgEventList(o).find(e => e.id === id)) || null; },
  },
};
// Short-lived UI state that has to survive a redraw (every Firestore
// snapshot redraws the page from strings): an open Change, the Going burst
// and where focus goes back to. Keyed by `${kind}:${code}:${id}`.
const _spaceRsvpUi = new Map();
const SPACE_RSVP_CHANGE_MS = 30000, SPACE_RSVP_BURST_MS = 900, SPACE_RSVP_FOCUS_MS = 4000;
let _spaceRsvpFocusQueued = false;

function spaceRsvpKey(kind, code, id) { return `${kind}:${code}:${id}`; }
function spaceRsvpNextValue(current, val, toggle = true) { return toggle && current === val ? null : val; }
function spaceRsvpMine(kind, code, id) { try { return SPACE_RSVP_ADAPTERS[kind]?.mine(code, id) || ''; } catch { return ''; } }
function _spaceRsvpState(key) { let s = _spaceRsvpUi.get(key); if (!s) { s = {}; _spaceRsvpUi.set(key, s); } return s; }

function spaceRsvp(o) {
  const kind = o.kind === 'club' ? 'club' : 'group';
  const size = o.size === 'hero' ? 'hero' : 'row';
  const key = spaceRsvpKey(kind, o.code, o.id);
  const choices = SPACE_RSVP_CHOICES[kind];
  const mine = choices.some(c => c[0] === o.mine) ? o.mine : '';
  const ui = _spaceRsvpUi.get(key) || {};
  const now = Date.now();
  const changing = !!mine && ui.change > now;
  const args = `'${kind}','${esc(o.code)}','${esc(o.id)}'`;
  const title = esc(o.title || 'this');
  if (ui.focus && ui.focus.until > now && !_spaceRsvpFocusQueued && typeof requestAnimationFrame === 'function') {
    _spaceRsvpFocusQueued = true;
    requestAnimationFrame(() => { _spaceRsvpFocusQueued = false; spaceRsvpRestoreFocus(); });
  }
  const buttons = choices.map(([val, label, ic]) => `<button type="button" class="space-rsvp-btn is-${val}" aria-pressed="${mine === val}" onclick="event.stopPropagation();setSpaceRsvp(${args},'${val}',{toggle:false,from:this})">${size === 'hero' ? icon(ic, 15) : ''}<span>${label}</span></button>`).join('');
  let answered = '';
  if (mine) {
    const [long, short, ic] = SPACE_RSVP_STATUS[mine];
    const since = now - (ui.pop || 0);
    const fresh = since < SPACE_RSVP_BURST_MS ? ` is-fresh" style="--rsvp-t:-${since}ms` : '';
    const burstSince = now - (ui.burst || 0);
    const burst = mine === 'yes' && burstSince < SPACE_RSVP_BURST_MS ? `<span class="space-rsvp-burst" aria-hidden="true" style="--rsvp-t:-${burstSince}ms">${'<i></i>'.repeat(8)}</span>` : '';
    answered = size === 'hero'
      ? `<div class="space-rsvp-answered"><span class="space-rsvp-pill is-${mine}${fresh}">${icon(ic, 14)}<span>${long}</span>${burst}</span><button type="button" class="sg-link space-rsvp-change" onclick="event.stopPropagation();spaceRsvpChange(this)" aria-label="${long}. Change your answer for ${title}">Change</button></div>`
      : `<div class="space-rsvp-answered"><button type="button" class="space-rsvp-pill is-${mine}${fresh}" onclick="event.stopPropagation();spaceRsvpChange(this)" aria-label="${long}. Change your answer for ${title}">${icon(ic, 12)}<span>${short}</span>${burst}</button></div>`;
  }
  const clear = o.clearable && mine ? `<button type="button" class="sg-link space-rsvp-clear" onclick="event.stopPropagation();setSpaceRsvp(${args},'${mine}',{toggle:true,from:this})">Clear answer</button>` : '';
  const still = o.stillComing && mine === 'yes' ? `
    <div class="space-rsvp-still" role="group" aria-label="Still coming to ${title}?">
      <span class="space-rsvp-still-q">Still coming?</span>
      <button type="button" class="btn btn-sm" onclick="event.stopPropagation();spaceStillComing(${args},true,this)">Yes</button>
      <button type="button" class="btn btn-sm btn-ghost" onclick="event.stopPropagation();spaceStillComing(${args},false,this)">Can’t anymore</button>
    </div>` : '';
  return `<div class="space-rsvp sg-rsvp is-${size}${mine ? ' is-answered' : ''}${changing ? ' is-changing' : ''}" data-rsvp-key="${esc(key)}" role="group" aria-label="RSVP to ${title}">
    <div class="space-rsvp-buttons">${buttons}${clear}</div>${answered}${still}
  </div>`;
}

// Reopen the buttons in place. The open state is remembered for 30s so a
// redraw from someone else's answer doesn't snap it shut mid-tap.
function spaceRsvpChange(el) {
  const root = el?.closest?.('.space-rsvp');
  if (!root) return;
  _spaceRsvpState(root.dataset.rsvpKey).change = Date.now() + SPACE_RSVP_CHANGE_MS;
  root.classList.add('is-changing');
  (root.querySelector('.space-rsvp-btn[aria-pressed="true"]') || root.querySelector('.space-rsvp-btn'))?.focus({ preventScroll: true });
}

function setSpaceRsvp(kind, code, id, val, { toggle = true, from } = {}) {
  const adapter = SPACE_RSVP_ADAPTERS[kind];
  if (!adapter || !safeId(String(id || ''))) return Promise.resolve(false);
  const key = spaceRsvpKey(kind, code, id);
  const ui = _spaceRsvpState(key);
  const current = spaceRsvpMine(kind, code, id);
  const next = spaceRsvpNextValue(current, val, toggle);
  delete ui.change;
  if (next && next !== current) {
    ui.pop = Date.now();
    if (next === 'yes') ui.burst = Date.now();
  }
  // A yes given on the day already answers "Still coming?", so the prompt
  // only asks about a yes from before today.
  if (next === 'yes') {
    let ev = null;
    try { ev = adapter.event?.(code, id); } catch { ev = null; }
    if (ev && eventTimeState(ev).days === 0) {
      try { localStorage.setItem(_spaceStillKey(kind, code, id), _spaceTodayIso()); } catch { /* private window */ }
    }
  }
  if (next !== current) spaceRsvpAnnounce(next, spaceRsvpTitle(kind, code, id));
  if (from?.closest) {
    // Only the control used last gets focus back after the redraw.
    for (const [k, other] of _spaceRsvpUi) if (k !== key) delete other.focus;
    const inModal = !!from.closest('#modal');
    const scope = document.querySelector(inModal ? '#modal' : '#content') || document;
    const ctl = from.closest('.space-rsvp');
    const idx = ctl ? [...scope.querySelectorAll('.space-rsvp')].filter(el => el.dataset.rsvpKey === key).indexOf(ctl) : 0;
    ui.focus = { until: Date.now() + SPACE_RSVP_FOCUS_MS, inModal, idx: Math.max(0, idx) };
  }
  return adapter.write(code, id, val, toggle);
}

// One polite live region for RSVP answers: focus stays on the control, so the
// new answer is said here. Created once, inside the toast stack.
function spaceRsvpTitle(kind, code, id) {
  try { const ev = SPACE_RSVP_ADAPTERS[kind]?.event?.(code, id); return ev?.title || ''; } catch { return ''; }
}
function spaceRsvpAnnounce(val, title) {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  let live = document.getElementById('space-rsvp-live');
  if (!live) {
    live = document.createElement('div');
    live.id = 'space-rsvp-live'; live.className = 'sr-only'; live.setAttribute('role', 'status');
    stack.appendChild(live);
  }
  const t = title ? ` ${title}` : '';
  const msg = val === 'yes' ? `You’re going to${t || ' it'}.` : val === 'maybe' ? `Maybe for${t || ' it'}.` : val === 'no' ? `Can’t make${t || ' it'}.` : `Answer cleared${title ? ` for ${title}` : ''}.`;
  live.textContent = '';
  setTimeout(() => { live.textContent = msg; }, 60);
}

// After a redraw, put focus back on the control you just used (its Change
// link, its pill, or its chosen button), but only if focus fell to <body>.
function spaceRsvpRestoreFocus() {
  const now = Date.now();
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected) return;
  for (const [key, ui] of _spaceRsvpUi) {
    if (!ui.focus || ui.focus.until < now) continue;
    const scope = document.querySelector(ui.focus.inModal ? '#modal' : '#content');
    if (!scope) continue;
    const list = [...scope.querySelectorAll('.space-rsvp')].filter(el => el.dataset.rsvpKey === key);
    const ctl = list[ui.focus.idx] || list[0];
    const target = ctl && (ctl.querySelector('.space-rsvp-change, button.space-rsvp-pill') || ctl.querySelector('.space-rsvp-btn[aria-pressed="true"]') || ctl.querySelector('.space-rsvp-btn'));
    if (target && target.getClientRects().length) { target.focus({ preventScroll: true }); return; }
  }
}

/* ── "Still coming?" on the day ───────────────────────────────── */
function _spaceStillKey(kind, code, id) { return `shq.stillComing.${kind}.${code}.${id}`; }
function _spaceTodayIso() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function spaceStillComingDue(kind, code, id, ev, mine) {
  if (mine !== 'yes' || !ev) return false;
  const st = eventTimeState(ev);
  if (st.days !== 0 || st.phase !== 'before' || st.allDay) return false;
  try { return localStorage.getItem(_spaceStillKey(kind, code, id)) !== _spaceTodayIso(); } catch { return true; }
}
async function spaceStillComing(kind, code, id, yes, el) {
  const fromHeadsUp = !!el?.closest?.('.headsup-prompt');
  if (yes) {
    try { localStorage.setItem(_spaceStillKey(kind, code, id), _spaceTodayIso()); } catch { /* private window: it asks again next time */ }
    // Keeps your yes; toggle=false can never clear it.
    await setSpaceRsvp(kind, code, id, 'yes', { toggle: false });
    if (typeof toast === 'function') toast('See you there');
  } else {
    await setSpaceRsvp(kind, code, id, 'no', { toggle: false });
  }
  if (typeof render === 'function') render();
  if (fromHeadsUp && typeof openHeadsUp === 'function') openHeadsUp();
}

/* ── Event sheet: who's going, and the details ────────────────── */
const _spaceSheetList = new Map();
function spaceSheetPick(btn) {
  const wrap = btn.closest('.space-sheet-lists');
  if (!wrap) return;
  const k = btn.dataset.list;
  _spaceSheetList.set(wrap.dataset.listKey, k);
  wrap.querySelectorAll('.space-sheet-seg button').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
  wrap.querySelectorAll('.space-sheet-panel').forEach(p => { p.hidden = p.dataset.list !== k; });
}
function spaceRsvpLists(o) {
  const lists = (o.lists || []).filter(Boolean);
  if (!lists.length) return '';
  const remembered = _spaceSheetList.get(o.key);
  const active = lists.some(l => l.key === remembered) ? remembered : (o.active && lists.some(l => l.key === o.active) ? o.active : lists[0].key);
  return `
    <div class="space-sheet-lists" data-list-key="${esc(o.key)}">
      <div class="segmented space-sheet-seg" role="group" aria-label="Answers">
        ${lists.map(l => `<button type="button" data-list="${esc(l.key)}" aria-pressed="${l.key === active}" onclick="spaceSheetPick(this)"><span class="space-seg-long">${esc(l.label)}</span><span class="space-seg-short">${esc(l.short || l.label)}</span><span class="space-seg-n">${l.people.length}</span></button>`).join('')}
      </div>
      ${lists.map(l => `
        <div class="space-sheet-panel" data-list="${esc(l.key)}"${l.key === active ? '' : ' hidden'}>
          ${l.people.length ? l.people.map(p => `<div class="sg-person space-sheet-person">${personAvatar(p.uid, p.name, 28, (l.colorOf || (() => '#6b6b6b'))(p.uid))}<div class="row-title">${esc(p.name)}</div>${p.sub ? `<span class="small muted">${esc(p.sub)}</span>` : ''}</div>`).join('') : `<div class="small muted space-sheet-empty">${esc(l.empty || 'No one yet.')}</div>`}
          ${l.footHtml || ''}
        </div>`).join('')}
    </div>`;
}
function spaceEventSheet(o) {
  const st = eventTimeState(o);
  const range = _evTimeRange(o.start, o.end);
  const state = st.phase === 'now'
    ? `<div class="space-sheet-state is-now"><span class="space-now-dot" aria-hidden="true"></span>Happening now${st.allDay ? ' · all day' : ` · until ${esc(fmtTime(st.endsAt))}`}</div>`
    : st.phase === 'after'
      ? '<div class="space-sheet-state is-after">Ended</div>'
      : `<div class="space-sheet-state"><span class="space-chip">${esc(_evCap(st.label))}</span>${st.days > 1 ? `<span class="small muted">${esc(fmtDate(o.date, { weekday: 'long' }))}</span>` : ''}</div>`;
  return `
    <div class="space space-sheet" style="${spaceVars(o.color)}">
      <div class="space-sheet-cover space-cover" data-pattern="${spacePattern(o.code)}">
        <span class="space-sheet-glyph">${icon(o.glyph || 'calendar', 18)}</span>
        <span class="space-sheet-space">${esc(o.spaceName || '')}</span>
      </div>
      <div class="modal-head"><h3 class="space-sheet-title">${esc(o.title)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
      <div class="modal-body">
        ${o.tags ? `<div class="space-sheet-tags">${o.tags}</div>` : ''}
        <div class="space-hero-meta space-sheet-meta">
          <span>${icon('calendar', 13)} ${esc(fmtDateLong(o.date))}</span>
          ${range ? `<span>${icon('clock', 13)} ${esc(range)}</span>` : ''}
          ${o.where ? `<span>${icon('map-pin', 13)} ${spaceWhereHtml(o.where)}</span>` : ''}
        </div>
        ${state}
        ${o.notes ? `<div class="space-hero-notes">${linkifyText(o.notes)}</div>` : ''}
        ${o.rsvpHtml || o.facesHtml ? `<div class="space-sheet-rsvp">${o.rsvpHtml || ''}${o.facesHtml || ''}</div>` : ''}
        ${o.actionsHtml ? `<div class="space-sheet-actions">${o.actionsHtml}</div>` : ''}
        ${o.listsHtml ? `<div class="divider"></div>${o.listsHtml}` : ''}
      </div>
      ${o.footHtml ? `<div class="modal-foot">${o.footHtml}</div>` : ''}
    </div>`;
}
