/* ── Clubs & teams: the Calendar tab (Tier A item 10) ──────────────
   Agenda and Month views of a club's events, category filters, an
   "I'm going" filter, and the officer tools that plan a semester:
   Duplicate, Extend this series, and repeats every week or every other
   week. Loaded after js/orgs.js; everything here runs at call time.

   Nothing on this tab is stored. The view (Agenda or Month) is
   remembered on this device (localStorage 'shq.orgCalView'); the month,
   the picked day and the filters live in _orgCal and reset when you
   open a different club. No setState, so switching views never writes
   to the planner doc.

   Series: events that repeat share a seriesId and nothing else, so the
   cadence is read from their dates (orgSeriesStep): the most common gap,
   7 or 14 days. Duplicates, extensions and every-other-week repeats are
   ordinary events.{id} entries in the existing shape.

   orgEventsTab(o) -> the tab.
   orgSeriesStep(o, seriesId) -> 7 | 14. orgSeriesLabel(o, e) ->
     'Weekly' | 'Every other week'. ORG_SERIES_LABELS[7 | 14].
   orgDuplicateDate(o, e) -> a week on, moved past today and past any
     date this event (its series, or its title) already has.
   orgRepeatFieldsHtml() / orgRepeatToggle(on): the new-event modal's
     "Repeat [every week] [8 times]" row (#oe-repeat, #oe-step, #oe-weeks).
   orgEventOfficerActions(o, e) -> Duplicate and Extend this series
     buttons for the event sheet.
   duplicateOrgEvent(code, id), openOrgExtendModal(code, id),
   extendOrgSeries(code, id), orgSeriesNext(o, seriesId, n).
   orgMonthGrid(o, st, events, need): the Month view.
   Tab actions: setOrgCalView, setOrgCalFilter, toggleOrgCalMine,
   clearOrgCalFilter, shiftOrgCalMonth, orgCalToday, pickOrgCalDay,
   orgCalKey, openOrgCalMenu.
   Styles: the "Club Calendar" section of css/clubs.css.
──────────────────────────────────────────────────────────────── */
// Chip labels for ORG_EVENT_CATEGORIES keys, in that order. Only the
// categories a club actually uses get a chip.
const ORG_CAL_FILTERS = [['meeting', 'Meetings'], ['practice', 'Practices'], ['game', 'Games'], ['social', 'Social'], ['service', 'Service'], ['deadline', 'Dues & deadlines'], ['other', 'Other']];
const ORG_CAL_VIEW_KEY = 'shq.orgCalView';
const ORG_REPEAT_COUNTS = [2, 4, 6, 8, 10, 12, 15];
// One action never adds more than this many events: every event lives in
// the club's one document, which has a size ceiling.
const ORG_REPEAT_MAX = 15;
const ORG_SERIES_LABELS = { 7: 'Weekly', 14: 'Every other week' };
let _orgCal = { code: '', view: '', month: '', day: '', filter: 'all', mine: false };

/* ── Series cadence ────────────────────────────────────────────── */
// The most common gap between the series' dates, as 7 or 14. One moved
// or deleted date doesn't flip it; a tie (or a single date) is weekly.
function orgSeriesStep(o, seriesId) {
  if (!seriesId) return 7;
  const dates = [...new Set(Object.values(o?.events || {}).filter(x => x && x.seriesId === seriesId && /^\d{4}-\d{2}-\d{2}$/.test(x.date || '')).map(x => x.date))].sort();
  const tally = { 7: 0, 14: 0 };
  for (let i = 1; i < dates.length; i++) {
    const gap = Math.round((new Date(`${dates[i]}T00:00:00`) - new Date(`${dates[i - 1]}T00:00:00`)) / 86400000);
    if (gap >= 4 && gap <= 10) tally[7]++;
    else if (gap >= 11 && gap <= 17) tally[14]++;
  }
  return tally[14] > tally[7] ? 14 : 7;
}
function orgSeriesLabel(o, e) { return ORG_SERIES_LABELS[orgSeriesStep(o, e?.seriesId)]; }
// Duplicate lands a week after the original, then a week at a time past
// today and past any date that already has this event: the same series,
// or (with no series) the same title. Saving it never doubles a day.
function orgDuplicateDate(o, e) {
  const t = todayIso();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e?.date || '')) return t;
  const taken = new Set(orgEventList(o).filter(x => (e.seriesId ? x.seriesId === e.seriesId : x.title === e.title)).map(x => x.date));
  let d = addDays(e.date, 7);
  for (let i = 0; (d < t || taken.has(d)) && i < 1000; i++) d = addDays(d, 7);
  return d < t ? t : d;
}
// The next n dates after the series' last one, at its cadence.
function orgSeriesNext(o, seriesId, n) {
  const series = orgEventList(o).filter(x => x.seriesId === seriesId);
  const last = series[series.length - 1] || null;
  if (!last) return { last: null, step: 7, dates: [] };
  const step = orgSeriesStep(o, seriesId);
  const have = new Set(series.map(x => x.date));
  const dates = [];
  let d = last.date;
  while (dates.length < Math.min(n, ORG_REPEAT_MAX)) { d = addDays(d, step); if (!have.has(d)) dates.push(d); }
  return { last, step, dates };
}

/* ── New-event modal: Repeat ───────────────────────────────────── */
function orgRepeatFieldsHtml() {
  return `
      <div class="org-repeat mt-8">
        <label class="checkbox-row small"><input type="checkbox" id="oe-repeat" onchange="orgRepeatToggle(this.checked)"><span>Repeat</span></label>
        <select class="select" id="oe-step" disabled aria-label="How often"><option value="7">every week</option><option value="14">every other week</option></select>
        <select class="select" id="oe-weeks" disabled aria-label="How many times in all">${ORG_REPEAT_COUNTS.map(n => `<option value="${n}"${n === 8 ? ' selected' : ''}>${n} times</option>`).join('')}</select>
      </div>`;
}
function orgRepeatToggle(on) { ['#oe-step', '#oe-weeks'].forEach(s => { const el = $(s); if (el) el.disabled = !on; }); }

/* ── Officer actions on the event sheet ────────────────────────── */
function orgEventOfficerActions(o, e) {
  return `<button class="btn btn-ghost btn-sm" onclick="duplicateOrgEvent('${o.code}','${e.id}')">${icon('copy', 14)} Duplicate</button>${e.seriesId ? `<button class="btn btn-ghost btn-sm" onclick="openOrgExtendModal('${o.code}','${e.id}')">${icon('refresh-cw', 14)} Extend this series</button>` : ''}`;
}
// Opens the new-event form filled in from this one (no series, a week on),
// so the officer sees what will be added before it is.
function duplicateOrgEvent(code, eventId) {
  const o = findOrg(code);
  const e = o && orgEventList(o).find(x => x.id === eventId);
  if (!e || !isOrgOfficer(o)) return;
  const { title, category, start, end, location, notes, required } = e;
  openOrgEventModal(code, null, { prefill: { title, category, start, end, location, notes, required: !!required, date: orgDuplicateDate(o, e) } });
}
function orgExtendPreviewText(o, seriesId, n) {
  const { dates, step } = orgSeriesNext(o, seriesId, n);
  if (!dates.length) return '';
  const f = (d) => fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${dates.length === 1 ? f(dates[0]) : `${f(dates[0])} to ${f(dates[dates.length - 1])}`}, ${ORG_SERIES_LABELS[step].toLowerCase()}.`;
}
function orgExtendPreview(code, eventId) {
  const o = findOrg(code);
  const e = o && orgEventList(o).find(x => x.id === eventId);
  const el = $('#ox-preview');
  if (e?.seriesId && el) el.textContent = orgExtendPreviewText(o, e.seriesId, Number($('#ox-count')?.value) || 4);
}
function openOrgExtendModal(code, eventId) {
  const o = findOrg(code);
  const e = o && orgEventList(o).find(x => x.id === eventId);
  if (!e?.seriesId || !isOrgOfficer(o)) return;
  const { last, step } = orgSeriesNext(o, e.seriesId, 1);
  if (!last) return;
  openModal(`
    <div class="modal-head"><h3>Extend this series</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body">
      <p class="org-extend-lead">${esc(last.title)} is ${ORG_SERIES_LABELS[step].toLowerCase()}, and the last one is ${esc(fmtDate(last.date, { weekday: 'long', month: 'short', day: 'numeric' }))}. New dates keep its time, place and details.</p>
      <div class="field"><label for="ox-count">Add</label><select class="select" id="ox-count" style="max-width:160px" onchange="orgExtendPreview('${o.code}','${e.id}')">${ORG_REPEAT_COUNTS.map(n => `<option value="${n}"${n === 4 ? ' selected' : ''}>${n} more</option>`).join('')}</select></div>
      <p class="small muted" id="ox-preview" aria-live="polite">${esc(orgExtendPreviewText(o, e.seriesId, 4))}</p>
    </div>
    <div class="modal-foot"><button class="btn" onclick="showOrgEventModal('${o.code}','${e.id}')">Back</button><button class="btn btn-primary" id="ox-save" onclick="extendOrgSeries('${o.code}','${e.id}')">Add dates</button></div>
  `);
}
async function extendOrgSeries(code, eventId) {
  const o = findOrg(code);
  const e = o && orgEventList(o).find(x => x.id === eventId);
  if (!e?.seriesId || !isOrgOfficer(o)) return;
  const n = Math.max(1, Math.min(ORG_REPEAT_MAX, Number($('#ox-count')?.value) || 4));
  const { last, dates } = orgSeriesNext(o, e.seriesId, n);
  if (!last || !dates.length) return;
  const ops = {};
  dates.forEach(date => {
    const id = uid();
    ops[`events.${id}`] = { id, title: last.title, category: last.category, start: last.start || '', end: last.end || '', location: last.location || '', notes: last.notes || '', required: !!last.required, date, seriesId: e.seriesId, createdBy: myOrgUid(o), createdAt: Date.now() };
  });
  setBtnLoading($('#ox-save'), true);
  if (await orgWrite(code, ops)) { closeModal(); toast(`Added ${dates.length} more ${dates.length === 1 ? 'date' : 'dates'}, through ${fmtDate(dates[dates.length - 1])}`); }
  else setBtnLoading($('#ox-save'), false, 'Add dates');
}

/* ── Tab state (this device, this visit) ───────────────────────── */
function orgCalState(o) {
  if (!_orgCal.view) { let v = ''; try { v = localStorage.getItem(ORG_CAL_VIEW_KEY) || ''; } catch {} _orgCal.view = v === 'month' ? 'month' : 'agenda'; }
  if (_orgCal.code !== o.code) Object.assign(_orgCal, { code: o.code, month: '', day: '', filter: 'all', mine: false });
  return _orgCal;
}
function _orgCalFor(code) { return _orgCal.code === code ? _orgCal : null; }
function setOrgCalView(code, view) {
  const st = _orgCalFor(code);
  if (!st || !['agenda', 'month'].includes(view)) return;
  st.view = view;
  try { localStorage.setItem(ORG_CAL_VIEW_KEY, view); } catch {}
  render();
  requestAnimationFrame(() => $(`#content .org-cal-views button[data-view="${view}"]`)?.focus({ preventScroll: true }));
}
function setOrgCalFilter(code, key) { const st = _orgCalFor(code); if (!st) return; st.filter = key === 'all' || ORG_CAL_FILTERS.some(f => f[0] === key) ? key : 'all'; render(); }
function toggleOrgCalMine(code) { const st = _orgCalFor(code); if (!st) return; st.mine = !st.mine; render(); }
function clearOrgCalFilter(code) { const st = _orgCalFor(code); if (!st) return; st.filter = 'all'; st.mine = false; render(); }
function orgCalMatch(o, e, st) { return (st.filter === 'all' || e.category === st.filter) && (!st.mine || myOrgRsvp(o, e.id) === 'yes'); }
function orgCalFiltered(st) { return st.filter !== 'all' || st.mine; }

/* ── The tab ───────────────────────────────────────────────────── */
function orgEventsTab(o) {
  const st = orgCalState(o);
  const all = orgEventList(o);
  const officer = isOrgOfficer(o);
  if (!all.length) {
    return emptyState(icon('calendar', 24), 'No events yet', officer ? `<button class="btn btn-primary btn-sm" onclick="openOrgEventModal('${o.code}')">${icon('plus', 14)} Add an event</button>` : '', officer ? 'Meetings can repeat every week or every other week, so you only add them once.' : 'When officers add events, they show up here and on your calendar.');
  }
  const have = new Set(all.map(e => e.category));
  const cats = ORG_CAL_FILTERS.filter(([k]) => have.has(k));
  if (st.filter !== 'all' && !have.has(st.filter)) st.filter = 'all';
  const need = orgNeedIds(o);
  const shown = all.filter(e => orgCalMatch(o, e, st));
  return `
    <div class="org-cal">
      ${orgCalToolbar(o, st, cats)}
      ${st.view === 'month' ? orgMonthGrid(o, st, shown, need) : orgCalAgenda(o, st, shown, need)}
      <p class="org-cal-foot">${o.hideCalendar ? 'These events are hidden from your calendar.' : 'Events you haven’t said no to show on your calendar.'}</p>
    </div>`;
}
function orgCalToolbar(o, st, cats) {
  const code = o.code;
  const views = [['agenda', 'Agenda', 'list'], ['month', 'Month', 'grid']].map(([k, label, ic]) =>
    `<button type="button" data-view="${k}" aria-pressed="${st.view === k}" onclick="setOrgCalView('${code}','${k}')">${icon(ic, 14)}<span>${label}</span></button>`).join('');
  const chip = (key, label) => `<button type="button" class="chip" aria-pressed="${st.filter === key}" onclick="setOrgCalFilter('${code}','${key}')">${esc(label)}</button>`;
  const chips = cats.length > 1 ? `${chip('all', 'All')}${cats.map(([k, l]) => chip(k, l)).join('')}<span class="org-cal-chip-sep" aria-hidden="true"></span>` : '';
  return `
    <div class="org-cal-bar">
      <div class="segmented org-cal-views" role="group" aria-label="Calendar view">${views}</div>
      <div class="org-cal-bar-end">
        <button type="button" class="btn btn-ghost btn-sm btn-icon org-cal-more" aria-label="Calendar options" aria-haspopup="menu" aria-expanded="false" onclick="openOrgCalMenu(this,'${code}')">${icon('more-horizontal', 16)}</button>
        ${isOrgOfficer(o) ? `<button class="btn btn-primary btn-sm" onclick="openOrgEventModal('${code}')">${icon('plus', 14)} Event</button>` : ''}
      </div>
    </div>
    <div class="chip-row org-cal-chips" role="group" aria-label="Show">
      ${chips}<button type="button" class="chip org-cal-mine" aria-pressed="${st.mine}" onclick="toggleOrgCalMine('${code}')">${icon('check', 14)}<span>I’m going</span></button>
    </div>`;
}
function openOrgCalMenu(btn, code) {
  const o = findOrg(code);
  if (!o) return;
  const any = upcomingOrgEvents(o).length > 0;
  const on = !o.hideCalendar;
  openMenu(btn, `
    <button class="menu-item" ${any ? '' : 'disabled'} onclick="downloadOrgIcs('${code}')">${icon('download', 16)}<span>Add all to calendar app</span></button>
    <button class="menu-item" role="menuitemcheckbox" aria-checked="${on}" onclick="setOrgOnCalendar('${code}',${!on})">${icon('calendar', 16)}<span>Show on my calendar</span><span class="menu-kbd">${on ? icon('check', 14) : ''}</span></button>`);
}
// Social events get the bigger row with faces. Dues rows (flag, Due and
// Pay dues) come from orgAgendaRow.
function orgCalRow(o, e, need) {
  if (e.category === 'social' && !orgEventPast(e)) return orgAgendaRow(o, e, need, { className: 'org-cal-social', facesHtml: orgFacePile(o, e, { size: 26 }) });
  return orgAgendaRow(o, e, need);
}
function orgCalNone(o, st, what) {
  return `<div class="card card-pad org-cal-none"><p>${what}</p>${orgCalFiltered(st) ? `<button type="button" class="btn btn-sm" onclick="clearOrgCalFilter('${o.code}')">Show everything</button>` : isOrgOfficer(o) ? `<button class="btn btn-primary btn-sm" onclick="openOrgEventModal('${o.code}')">${icon('plus', 14)} Add an event</button>` : ''}</div>`;
}
function orgCalMonthHeading(monthIso, tag = 'h3', cls = 'org-cal-month') {
  return `<${tag} class="${cls}">${esc(fmtDate(monthIso, { month: 'long' }))} <span class="org-cal-year">${monthIso.slice(0, 4)}</span></${tag}>`;
}

/* ── Agenda ────────────────────────────────────────────────────── */
function orgCalAgenda(o, st, events, need) {
  const upcoming = events.filter(e => !orgEventPast(e));
  const past = events.filter(orgEventPast).reverse();
  const months = [];
  upcoming.forEach(e => { const key = e.date.slice(0, 7); let g = months[months.length - 1]; if (!g || g.key !== key) months.push(g = { key, items: [] }); g.items.push(e); });
  const body = months.length
    ? months.map(g => `<section class="org-cal-group" aria-label="${esc(fmtDate(`${g.key}-01`, { month: 'long', year: 'numeric' }))}">${orgCalMonthHeading(`${g.key}-01`)}<div class="card card-pad org-cal-card">${g.items.map(e => orgCalRow(o, e, need)).join('')}</div></section>`).join('')
    : orgCalNone(o, st, orgCalFiltered(st) ? 'Nothing coming up that matches.' : 'Nothing coming up yet.');
  return `
    ${body}
    ${past.length ? `<details class="space-disclosure org-cal-past"><summary>Past events <span class="space-disclosure-n">· ${past.length}</span></summary><div class="card card-pad">${past.slice(0, 40).map(e => orgCalRow(o, e, need)).join('')}</div></details>` : ''}`;
}

/* ── Month ─────────────────────────────────────────────────────── */
// The picked day, or today in this month, or its first day with an event.
function orgCalPickedDay(st, month, byDay, today) {
  const key = month.slice(0, 7);
  if (st.day && st.day.slice(0, 7) === key) return st.day;
  if (today.slice(0, 7) === key) return today;
  return Object.keys(byDay).filter(d => d.slice(0, 7) === key).sort()[0] || month;
}
function orgMonthGrid(o, st, events, need) {
  const code = o.code;
  const today = todayIso();
  const { month, cells } = calMonthCells(st.month || today);
  const byDay = {};
  events.forEach(e => (byDay[e.date] = byDay[e.date] || []).push(e));
  const day = orgCalPickedDay(st, month, byDay, today);
  const inMonth = events.filter(e => e.date.slice(0, 7) === month.slice(0, 7)).length;
  const grid = cells.map(d => {
    const list = byDay[d] || [];
    const out = d.slice(0, 7) !== month.slice(0, 7);
    const isToday = d === today;
    const sel = d === day;
    const cls = ['org-month-cell', out ? 'is-out' : '', d < today ? 'is-past' : '', isToday ? 'is-today' : '', sel ? 'is-selected' : ''].filter(Boolean).join(' ');
    const label = `${fmtDateLong(d)}${isToday ? ', today' : ''}${list.length ? `, ${list.length} event${list.length === 1 ? '' : 's'}: ${list.map(e => `${e.title}${e.required && !orgIsDuesEvent(e) ? ', required' : ''}`).join('; ')}` : ', nothing planned'}`;
    const slivers = list.slice(0, 3).map(e => {
      const past = orgEventPast(e);
      return `<span class="org-sliver${e.required && !orgIsDuesEvent(e) ? ' is-required' : ''}${past ? ' is-past' : ''}">${e.start ? `<span class="org-sliver-time">${calShortTime(e.start)}</span>` : ''}${esc(e.title)}</span>`;
    }).join('');
    const dots = list.slice(0, 3).map(e => `<i class="${orgEventPast(e) ? 'is-past' : ''}"></i>`).join('');
    return `<button type="button" class="${cls}" data-day="${d}" aria-pressed="${sel}"${isToday ? ' aria-current="date"' : ''} tabindex="${sel ? 0 : -1}" aria-label="${esc(label)}" onclick="pickOrgCalDay('${code}','${d}',true)" onkeydown="orgCalKey(event,'${code}','${d}')">
        <span class="org-month-num">${Number(d.slice(8))}</span>
        <span class="org-month-evs" aria-hidden="true">${slivers}${list.length > 3 ? `<span class="org-month-more">+${list.length - 3}</span>` : ''}</span>
        <span class="org-month-dots" aria-hidden="true">${dots}</span>
      </button>`;
  }).join('');
  const dayList = byDay[day] || [];
  const canAdd = isOrgOfficer(o) && day >= today;
  return `
    <div class="org-month-head">
      <div class="org-month-titles">
        ${orgCalMonthHeading(month, 'h3', 'org-month-title')}
        <span class="org-month-count">${inMonth ? `${inMonth} event${inMonth === 1 ? '' : 's'}` : 'Nothing planned'}</span>
      </div>
      <div class="cal-stepper org-month-stepper" role="group" aria-label="Change month">
        <button type="button" class="btn btn-sm btn-icon" aria-label="Previous month" data-tip="Previous month" onclick="shiftOrgCalMonth('${code}',-1)">${icon('chevron-left', 16)}</button>
        <button type="button" class="btn btn-sm" onclick="orgCalToday('${code}')">Today</button>
        <button type="button" class="btn btn-sm btn-icon" aria-label="Next month" data-tip="Next month" onclick="shiftOrgCalMonth('${code}',1)">${icon('chevron-right', 16)}</button>
      </div>
    </div>
    <div class="org-month-wrap">
      <div class="card org-month-card">
        <div class="org-month-dow" aria-hidden="true">${DOW_NAMES.map(n => `<span>${n}</span>`).join('')}</div>
        <div class="org-month" role="group" aria-label="${esc(fmtDate(month, { month: 'long', year: 'numeric' }))}. Arrow keys move between days.">${grid}</div>
      </div>
      <section class="card card-pad org-month-day" aria-live="polite" aria-label="Events on ${esc(fmtDateLong(day))}">
        <div class="org-month-day-head">
          <h4 class="sg-h3">${day === today ? 'Today · ' : ''}${esc(fmtDateLong(day))}</h4>
          ${canAdd ? `<button type="button" class="btn btn-ghost btn-sm" onclick="openOrgEventModal('${code}',null,{date:'${day}'})">${icon('plus', 14)} Add</button>` : ''}
        </div>
        ${dayList.length ? `<div class="org-month-day-rows">${dayList.map(e => orgCalRow(o, e, need)).join('')}</div>` : `<p class="org-month-day-none">${day < today ? 'Nothing on this day.' : orgCalFiltered(st) ? 'Nothing that matches on this day.' : 'Nothing planned yet.'}</p>`}
      </section>
    </div>`;
}
function pickOrgCalDay(code, dIso, focus = false) {
  const st = _orgCalFor(code);
  if (!st || !/^\d{4}-\d{2}-\d{2}$/.test(dIso || '')) return;
  st.day = dIso;
  st.month = `${dIso.slice(0, 7)}-01`;
  render();
  if (focus) requestAnimationFrame(() => $(`#content .org-month-cell[data-day="${dIso}"]`)?.focus({ preventScroll: true }));
}
// Arrows move a day or a week, Home and End go to the week's ends, and
// Page Up and Page Down change the month. Only the picked day is a tab stop.
function orgCalKey(ev, code, dIso) {
  const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  const dow = new Date(`${dIso}T00:00:00`).getDay();
  let next = '';
  if (ev.key in moves) next = addDays(dIso, moves[ev.key]);
  else if (ev.key === 'Home') next = addDays(dIso, -dow);
  else if (ev.key === 'End') next = addDays(dIso, 6 - dow);
  else if (ev.key === 'PageUp' || ev.key === 'PageDown') next = monthShift(dIso, ev.key === 'PageUp' ? -1 : 1);
  if (!next) return;
  ev.preventDefault();
  pickOrgCalDay(code, next, true);
}
function shiftOrgCalMonth(code, dir) {
  const st = _orgCalFor(code);
  if (!st) return;
  st.month = monthShift(`${(st.month || todayIso()).slice(0, 7)}-01`, dir);
  st.day = '';
  render();
}
function orgCalToday(code) { const st = _orgCalFor(code); if (!st) return; st.month = ''; st.day = todayIso(); render(); }
