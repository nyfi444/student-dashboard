/* ── Spaces: what a group or club needs from you ──────────────────
   One source for "What needs you". Everything is read from fields the
   group and club documents already carry, and every one-tap action goes
   through a write path that already exists (setSessionRsvp, setOrgRsvp,
   toggleGroupTask, setGroupTaskAssignee, fillAvailabilityFromSchedule).
   Nothing here is pushed, emailed or scheduled: it waits in the planner.

   spaceNeeds(kind, space) -> { kind, code, name, color, items, count }
     kind 'group' or 'club'; space is findGroup(code) or findOrg(code).
     items: [{ key, type, title, date, start, eyebrow, overdue, id, ... }]
       Groups: 'session'  a session in the next 7 days you haven't answered
                          (a weekly series asks once, for its next one)
               'task'     your open task due within 7 days, or overdue by
                          14 days at most
               'claim'    up to 3 open tasks nobody has taken
               'avail'    "Add your availability", once 2 or more other
                          members have added theirs and you haven't
       Clubs:  'event'    a required event in the next 7 days you haven't
                          answered (dues events never ask)
               'pinned'   a pinned announcement you haven't read
     count is items.length: the same number the strip, the index card and
     the dashboard show.
   spaceNeedsAll() -> every item from every group and club, each carrying
     space: { kind, code, name, color, hideCalendar }. Heads up reads it.
   spaceNeedsStrip(kind, space, { needs }) -> html
     The strip at the top of an Overview. Each card acts in one tap and
     clears in place. Empty: "You're all caught up in <name>."
   spaceNeedsPills(kind, spaces) -> html   per-space counts for the
     dashboard widgets; each pill opens that space's Overview.
   groupTasksOnDate(dateIso) -> calendar items: your open group tasks due
     that day, in the group's color (kind 'grouptask').
──────────────────────────────────────────────────────────────── */
const SPACE_NEEDS_DAYS = 7;          // how far ahead sessions, events and tasks count
const SPACE_NEEDS_OVERDUE_DAYS = 14; // an older overdue group task stops asking
const SPACE_NEEDS_CLAIM_MAX = 3;     // open tasks offered with "I'll take it"
const SPACE_NEEDS_SHOW = 6;          // cards before "+N more" on a desktop
const SPACE_NEEDS_CLEAR_MS = 400;    // the clear animation, before the write lands
const SPACE_NEEDS_FOLD_MS = 220;     // the check shows this long, then the card folds
const SPACE_NEEDS_ICON = { session: 'calendar', event: 'calendar', task: 'check-square', claim: 'user-plus', avail: 'grid', pinned: 'pin' };

// A short day for eyebrows: Today, Tomorrow, Thu, Oct 12.
function _needsDay(dIso) {
  const n = daysBetween(dIso);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n > 1 && n < 7) return fmtDate(dIso, { weekday: 'short' });
  return fmtDate(dIso, { month: 'short', day: 'numeric' });
}
function _needsWhen(dIso, start) { return `${_needsDay(dIso)}${start ? ` ${fmtTime(start)}` : ''}`; }
function _needsDue(due) {
  const n = daysBetween(due);
  if (n < 0) return `overdue ${-n === 1 ? 'since yesterday' : `${-n} days`}`;
  return `due ${_needsDay(due).replace(/^(Today|Tomorrow)$/, (m) => m.toLowerCase())}`;
}

function spaceNeeds(kind, space) {
  const empty = { kind, code: space?.code || '', name: space?.name || '', color: '', items: [], count: 0 };
  if (!space) return empty;
  const t = todayIso(), end = addDays(t, SPACE_NEEDS_DAYS);
  const items = [];
  // A weekly series asks once: the next unanswered one. The week after
  // shows up once that one is answered.
  const series = new Set();
  const firstOfSeries = (x) => !x.seriesId || (!series.has(x.seriesId) && !!series.add(x.seriesId));
  if (kind === 'group') {
    const g = space, u = myUidFor(g);
    upcomingSessions(g).filter(s => s.date <= end && !s.rsvp?.[u]).filter(firstOfSeries).forEach(s => items.push({
      key: `session:${s.id}`, type: 'session', id: s.id, title: s.title, date: s.date, start: s.start || '',
      eyebrow: `${s.seriesId ? 'Weekly session' : 'Session'} · ${_needsWhen(s.date, s.start)}`,
    }));
    const open = taskList(g).filter(t2 => !t2.done);
    open.filter(x => x.assignee === u && x.due && x.due <= end && x.due >= addDays(t, -SPACE_NEEDS_OVERDUE_DAYS))
      .sort(byDueThenCreated).forEach(x => items.push({
        key: `task:${x.id}`, type: 'task', id: x.id, title: x.title, date: x.due, start: '', overdue: x.due < t,
        eyebrow: `Your task · ${_needsDue(x.due)}`,
      }));
    open.filter(x => !x.assignee && (!x.due || x.due >= addDays(t, -SPACE_NEEDS_OVERDUE_DAYS))).sort(byDueThenCreated)
      .slice(0, SPACE_NEEDS_CLAIM_MAX).forEach(x => items.push({
        key: `claim:${x.id}`, type: 'claim', id: x.id, title: x.title, date: x.due || null, start: '', overdue: !!x.due && x.due < t,
        eyebrow: `Up for grabs${x.due ? ` · ${_needsDue(x.due)}` : ''}`,
      }));
    const members = new Set(g.memberUids || []);
    const others = Object.entries(g.avail || {}).filter(([id, e]) => id !== u && (!members.size || members.has(id)) && availHasAny(e)).length;
    if (others >= 2 && !availHasAny(g.avail?.[u])) items.push({
      key: 'avail', type: 'avail', id: 'avail', title: 'Add your availability', date: null, start: '',
      eyebrow: `Find a time · ${others} have added theirs`, others,
    });
    return { ...empty, color: groupColor(g) || '', items, count: items.length };
  }
  const o = space, me = myOrgUid(o);
  upcomingOrgEvents(o).filter(e => e.required && !orgIsDuesEvent(e) && e.date <= end && !myOrgRsvp(o, e.id)).filter(firstOfSeries).forEach(e => items.push({
    key: `event:${e.id}`, type: 'event', id: e.id, title: e.title, date: e.date, start: e.start || '',
    eyebrow: `Required · ${_needsWhen(e.date, e.start)}`,
  }));
  const seen = orgSeen()[o.code] || 0;
  orgAnnouncementList(o).filter(a => a.pinned && (a.at || 0) > seen && a.uid !== me).forEach(a => items.push({
    key: `pinned:${a.id}`, type: 'pinned', id: a.id, title: a.text.replace(/\s+/g, ' ').trim().slice(0, 160), date: null, start: '',
    eyebrow: `Pinned · ${a.name}`, at: a.at || 0,
  }));
  return { ...empty, color: orgColor(o), items, count: items.length };
}
function spaceNeedsAll() {
  const out = [];
  const add = (kind, s) => {
    const n = spaceNeeds(kind, s);
    const space = { kind, code: s.code, name: s.name, color: n.color || '#6b6b6b', hideCalendar: !!s.hideCalendar };
    n.items.forEach(i => out.push({ ...i, space }));
  };
  if (typeof allGroups === 'function') allGroups().forEach(g => add('group', g));
  if (typeof allOrgs === 'function') allOrgs().forEach(o => add('club', o));
  return out;
}

/* ── Calendar: your group tasks on their due dates ───────────── */
// itemsOnDate runs for every cell of the year view, so the tasks are
// indexed by date once per synchronous render and the index is dropped
// right after it.
let _groupTaskIdx = null;
function groupTasksOnDate(dateIso) {
  if (typeof allGroups !== 'function') return [];
  if (!_groupTaskIdx) {
    _groupTaskIdx = {};
    allGroups().forEach(g => {
      const u = myUidFor(g), color = groupColor(g) || '#6b6b6b';
      taskList(g).filter(x => !x.done && x.assignee === u && /^\d{4}-\d{2}-\d{2}$/.test(x.due || '')).forEach(x => {
        (_groupTaskIdx[x.due] = _groupTaskIdx[x.due] || []).push({
          id: x.id, code: g.code, title: x.title, start: null, end: null, color, kind: 'grouptask', groupName: g.name,
          action: `openGroup('${g.code}','tasks')`,
        });
      });
    });
    setTimeout(() => { _groupTaskIdx = null; }, 0);
  }
  return (_groupTaskIdx[dateIso] || []).map(x => ({ ...x }));
}

/* ── The strip ────────────────────────────────────────────────── */
// Keys cleared on this screen in the last moments: a redraw that lands
// before the write keeps them hidden, and the strip that just emptied
// greets you with the check instead of appearing flat.
const _spaceNeedsCleared = new Map();   // `${kind}:${code}:${key}` -> time
const _spaceNeedsOpen = new Set();      // strips showing every card
let _spaceNeedsFocus = null;            // { strip, idx, left, until }

function _needsArgs(kind, code, key) { return `'${kind}','${esc(code)}','${esc(key)}'`; }
function _needsActions(kind, space, it) {
  const code = space.code, a = (act) => `onclick="spaceNeedsAct(this,${_needsArgs(kind, code, it.key)},'${act}')"`;
  const t = esc(it.title);
  if (it.type === 'session') return `
    <button class="btn btn-sm space-need-btn" ${a('yes')} aria-label="Going to ${t}">${icon('check', 14)} Going</button>
    <button class="btn btn-sm space-need-btn" ${a('maybe')} aria-label="Maybe for ${t}">Maybe</button>
    <button class="btn btn-sm space-need-btn" ${a('no')} aria-label="Can’t make ${t}">Can’t</button>`;
  if (it.type === 'event') return `
    <button class="btn btn-sm space-need-btn" ${a('yes')} aria-label="Going to ${t}">${icon('check', 14)} Going</button>
    <button class="btn btn-sm space-need-btn" ${a('no')} aria-label="Can’t make ${t}">Can’t</button>`;
  if (it.type === 'task') return `<button class="btn btn-sm space-need-btn" ${a('done')} aria-label="Mark ${t} as done">${icon('check', 14)} Done</button>`;
  if (it.type === 'claim') return `<button class="btn btn-sm space-need-btn" ${a('claim')} aria-label="Take ${t}">${icon('user-plus', 14)} I’ll take it</button>`;
  if (it.type === 'avail') return scheduleBusyRanges().length
    ? `<button class="btn btn-sm space-need-btn" ${a('fill')} aria-label="Fill your availability from your class schedule">${icon('calendar', 14)} Fill from my schedule</button>`
    : `<button class="btn btn-sm space-need-btn" onclick="setGroupTab('availability')" aria-label="Add your availability in Find a time">${icon('grid', 14)} Add my times</button>`;
  if (it.type === 'pinned') return `<button class="btn btn-sm space-need-btn" ${a('read')} aria-label="Read the pinned announcement">Read it</button>`;
  return '';
}
// Where tapping the title goes: the sheet or the tab the item lives in.
function _needsOpenJs(kind, code, it) {
  const c = esc(code), id = esc(it.id);
  if (it.type === 'session') return `showGroupSessionModal('${c}','${id}')`;
  if (it.type === 'event') return `showOrgEventModal('${c}','${id}')`;
  if (it.type === 'task' || it.type === 'claim') return `setGroupTab('tasks')`;
  if (it.type === 'avail') return `setGroupTab('availability')`;
  if (it.type === 'pinned') return `spaceNeedsAct(this,${_needsArgs(kind, code, it.key)},'read')`;
  return '';
}
function spaceNeedsStrip(kind, space, { needs } = {}) {
  if (!space) return '';
  const n = needs || spaceNeeds(kind, space);
  const strip = `${kind}:${space.code}`;
  const now = Date.now();
  for (const [k, at] of _spaceNeedsCleared) if (now - at > 4000) _spaceNeedsCleared.delete(k);
  const items = n.items.filter(it => !((now - (_spaceNeedsCleared.get(`${strip}:${it.key}`) || 0)) < 1500));
  if (_spaceNeedsFocus && _spaceNeedsFocus.strip === strip && _spaceNeedsFocus.until > now) requestAnimationFrame(spaceNeedsRestore);
  if (!items.length) {
    const fresh = [..._spaceNeedsCleared.entries()].some(([k, at]) => k.startsWith(strip + ':') && now - at < 2500);
    return `<div class="space-needs-clear${fresh ? ' is-fresh' : ''}" data-needs="${esc(strip)}" tabindex="-1" role="status"><span class="space-needs-check" aria-hidden="true">${icon('check', 14, 2.4)}</span>You’re all caught up in ${esc(space.name)}.</div>`;
  }
  const open = _spaceNeedsOpen.has(strip);
  const extra = Math.max(0, items.length - SPACE_NEEDS_SHOW);
  return `
    <section class="space-needs${open ? ' is-open' : ''}" data-needs="${esc(strip)}" aria-label="What needs you">
      <div class="space-needs-head"><span class="eyebrow">What needs you · ${items.length}</span></div>
      <div class="space-needs-track" role="list">
        ${items.map((it, i) => `
          <div class="card card-sm space-need is-${it.type}${i >= SPACE_NEEDS_SHOW ? ' is-extra' : ''}" role="listitem" data-need-key="${esc(it.key)}">
            <div class="space-need-top"><span class="space-need-ic" aria-hidden="true">${icon(SPACE_NEEDS_ICON[it.type] || 'bell', 14)}</span><span class="space-need-eyebrow${it.overdue ? ' is-overdue' : ''}">${esc(it.eyebrow)}</span></div>
            <button type="button" class="space-need-title" onclick="${_needsOpenJs(kind, space.code, it)}">${esc(it.title)}</button>
            <div class="space-need-acts">${_needsActions(kind, space, it)}</div>
            <span class="space-need-done" aria-hidden="true">${icon('check', 18, 2.4)}</span>
          </div>`).join('')}
        ${extra ? `<button type="button" class="space-needs-more" onclick="spaceNeedsMore('${esc(strip)}',this)" aria-expanded="${open}">${open ? 'Show fewer' : `+${extra} more`}</button>` : ''}
      </div>
    </section>`;
}
function spaceNeedsMore(strip, btn) {
  if (_spaceNeedsOpen.has(strip)) _spaceNeedsOpen.delete(strip); else _spaceNeedsOpen.add(strip);
  const el = btn?.closest('.space-needs');
  if (!el) return;
  const open = _spaceNeedsOpen.has(strip);
  el.classList.toggle('is-open', open);
  btn.setAttribute('aria-expanded', String(open));
  btn.textContent = open ? 'Show fewer' : `+${el.querySelectorAll('.space-need.is-extra').length} more`;
}
// One tap: the card flashes a check and folds away, then the write lands
// and the redraw leaves it out (or brings it back if the write failed).
function spaceNeedsAct(btn, kind, code, key, act) {
  const card = btn?.closest('.space-need');
  const stripEl = btn?.closest('.space-needs');
  const strip = `${kind}:${code}`;
  if (act === 'read') { spaceNeedsReadPinned(code, key.replace(/^pinned:/, ''), card); return; }
  const run = () => {
    const id = key.split(':')[1];
    if (act === 'fill') { fillAvailabilityFromSchedule(code); setGroupTab('availability'); return; }
    if (key.startsWith('session:')) return setSessionRsvp(code, id, act, false);
    if (key.startsWith('event:')) return setOrgRsvp(code, id, act, false);
    if (act === 'done') { const g = findGroup(code); if (g?.taskItems?.[id] && !g.taskItems[id].done) toggleGroupTask(code, id); return; }
    if (act === 'claim') { const g = findGroup(code); if (g) setGroupTaskAssignee(code, id, myUidFor(g)); }
  };
  if (!card || card.classList.contains('is-clearing')) { if (!card) run(); return; }
  if (act === 'fill') { run(); return; }   // moves to Find a time; nothing to fold
  const cards = stripEl ? [...stripEl.querySelectorAll('.space-need')] : [];
  _spaceNeedsCleared.set(`${strip}:${key}`, Date.now());
  _spaceNeedsFocus = { strip, idx: Math.max(0, cards.indexOf(card)), left: stripEl?.querySelector('.space-needs-track')?.scrollLeft || 0, until: Date.now() + 1500 };
  card.querySelectorAll('button').forEach(b => { b.disabled = true; });
  if (spaceNeedsReducedMotion()) { run(); return; }
  card.classList.add('is-clearing');
  setTimeout(() => card.classList.add('is-gone'), SPACE_NEEDS_FOLD_MS);
  setTimeout(run, SPACE_NEEDS_CLEAR_MS);
}
function spaceNeedsReducedMotion() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } }
// After the redraw: the next card (or the caught-up line) takes focus if
// focus fell to the page, and the phone row keeps its scroll position.
function spaceNeedsRestore() {
  const f = _spaceNeedsFocus;
  if (!f || f.until < Date.now()) return;
  const el = [...document.querySelectorAll('#content [data-needs]')].find(x => x.dataset.needs === f.strip);
  if (!el) return;
  const track = el.querySelector('.space-needs-track');
  if (track && f.left) track.scrollLeft = f.left;
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected) return;
  const cards = [...el.querySelectorAll('.space-need')];
  const target = cards.length ? (cards[Math.min(f.idx, cards.length - 1)].querySelector('.space-need-btn') || cards[0]) : el;
  target?.focus({ preventScroll: true });
}
// "Read it": the pinned announcement in a sheet. It counts as read up to
// its own time (orgSeen stays on this device's settings), so the card
// clears without marking newer announcements read.
function spaceNeedsReadPinned(code, annId, card) {
  const o = findOrg(code);
  const a = o && orgAnnouncementList(o).find(x => x.id === annId);
  if (!a) return;
  if ((a.at || 0) > (orgSeen()[code] || 0)) { orgSeen()[code] = a.at || 0; save(); }
  _spaceNeedsCleared.set(`club:${code}:pinned:${annId}`, Date.now());
  if (card && !spaceNeedsReducedMotion()) { card.classList.add('is-clearing'); setTimeout(() => card.classList.add('is-gone'), SPACE_NEEDS_FOLD_MS); }
  openModal(`
    <div class="modal-head"><h3>Pinned announcement</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body space space-needs-read" style="${spaceVars(orgColor(o))}">
      <div class="space-needs-read-meta">${personAvatar(a.uid || a.name, a.name, 24, orgColor(o))}<span><span class="sg-strong">${esc(a.name)}</span> · ${esc(fmtRelativeTime(a.at))}</span></div>
      <div class="org-ann-text">${linkifyText(a.text)}</div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal();openOrg('${esc(code)}','announcements')">All announcements</button><button class="btn btn-primary" onclick="closeModal()">Done</button></div>
  `);
  setTimeout(() => { if (typeof render === 'function') render(); }, card && !spaceNeedsReducedMotion() ? SPACE_NEEDS_CLEAR_MS : 0);
}

/* ── Dashboard: one count per space ───────────────────────────── */
function spaceNeedsPills(kind, spaces) {
  const rows = (spaces || []).map(s => ({ s, n: spaceNeeds(kind, s) })).filter(x => x.n.count);
  if (!rows.length) return '';
  const open = (s) => kind === 'group' ? `openGroup('${esc(s.code)}')` : `openOrg('${esc(s.code)}')`;
  return `<div class="space-dash-needs">${rows.map(({ s, n }) => `
    <button type="button" class="space-dash-need space" style="${spaceVars(n.color)}" onclick="${open(s)}" aria-label="${esc(s.name)}: ${n.count} thing${n.count === 1 ? '' : 's'} need${n.count === 1 ? 's' : ''} you">
      <span class="space-dash-dot" aria-hidden="true"></span><span class="space-dash-name">${esc(s.name)}</span><span class="space-need-pill">${n.count} need${n.count === 1 ? 's' : ''} you</span>
    </button>`).join('')}</div>`;
}
