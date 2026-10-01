/* ── Clubs & teams: events ────────────────────────────────────────
   Event rows, answers (Going or Can't), the Next up hero, the Overview
   agenda and its tags, and the event sheets (view, add, edit, delete,
   .ics). Loaded after js/orgs/sync.js and before js/orgs.js.

   Before, during, after (Tier A item 7). Phases come from eventTimeState
   (js/spaces/eventcard.js); orgEventPast (js/orgs/sync.js) is its 'after'.
   The Calendar tab itself (Agenda and Month, filters, Duplicate and
   Extend this series) is js/orgs/calendar.js; orgAgendaRow and the sheets
   stay here.

   Rows, the hero and the Month day list show at most two tags
   (orgEventTags with a budget): the time chip (spaceWhenChip: tonight,
   Happening now), Required, then Weekly only if there is room. The
   category is a glyph in the meta line (orgMetaCat). Once an
   event ends, officers get Post a recap on the sheet, the rows and the
   Overview's "just ended" card:
     postOrgRecap(code, eventId) opens openAnnouncementModal with a
       prefill built from the event (never an inline string).
     orgRecapPosted(o, e) -> true when an announcement posted after the
       event ended names it, which retires the card.
     orgRecapPrompt(o) -> the Overview card for officers, or ''.
──────────────────────────────────────────────────────────────── */
/* ── Calendar, dashboard, Heads up ─────────────────────────────── */
// Events that belong on your own calendar: anything you haven't said no to.
function orgEventsOnDate(dateIso) {
  if (typeof allOrgs !== 'function') return [];
  return allOrgs().filter(o => !o.hideCalendar).flatMap(o => orgEventList(o).filter(e => e.date === dateIso && myOrgRsvp(o, e.id) !== 'no').map(e => ({
    id: e.id, code: o.code, title: e.title, start: e.start || null, end: e.end || null, color: orgColor(o), kind: 'org', orgName: o.name, required: !!e.required, category: e.category,
    action: `openOrgEvent('${o.code}','${e.id}')`, date: e.date, mine: orgIsDuesEvent(e) ? '' : myOrgRsvp(o, e.id), rsvpKind: 'club',
  })));
}
function orgUpcomingForMe(days = 7) {
  const end = addDays(todayIso(), days);
  return allOrgs().flatMap(o => upcomingOrgEvents(o).filter(e => e.date <= end && myOrgRsvp(o, e.id) !== 'no').map(e => ({ o, e })))
    .sort((a, b) => (a.e.date + (a.e.start || '')).localeCompare(b.e.date + (b.e.start || '')));
}
/* ── Event rows, answers and the Next up hero ─────────────────── */
// Who gave which answer, current members only.
function orgRsvpPeople(o, e) {
  const out = { yes: [], no: [], none: [] };
  orgPeople(o).forEach(p => { const v = o.rsvp?.[p.uid]?.[e.id]; out[v === 'yes' || v === 'no' ? v : 'none'].push(p); });
  return out;
}
// "You, Maya and 3 others are going". Officers, who count heads, see the
// real numbers; members at zero see an invitation instead of "0 going".
function orgFacePile(o, e, { size = 26, past = false } = {}) {
  const who = orgRsvpPeople(o, e);
  const faces = orgFaceColors(o);
  const officer = isOrgOfficer(o);
  return spaceFacePile({
    people: who.yes, meUid: myOrgUid(o), size, colorOf: (uid) => faces[uid] || orgColor(o), verb: past ? 'said' : 'going',
    zeroText: past ? 'No one said they’d go' : officer ? '0 going' : 'Be the first to say you’re going',
    detail: !past && officer && who.none.length ? `${who.none.length} haven’t answered` : '',
    onclick: `showOrgEventModal('${o.code}','${e.id}')`,
    label: `See who’s going to ${e.title}`,
  });
}
// The sheet's lists: Going, Can't, and (officers only, since they follow
// up) Haven't answered. Members get a one-line count instead.
function orgAttendanceLists(o, e) {
  const past = orgEventPast(e);
  const who = orgRsvpPeople(o, e);
  const faces = orgFaceColors(o);
  const colorOf = (uid) => faces[uid] || orgColor(o);
  const u = myOrgUid(o);
  const row = (p) => ({ uid: p.uid, name: p.uid === u && p.name !== 'You' ? `${p.name} (you)` : p.name, sub: orgRoleLabel(o, p) });
  const officer = isOrgOfficer(o);
  const lists = [
    { key: 'yes', label: past ? 'Said they’d go' : 'Going', short: past ? 'Went' : 'Going', people: who.yes.map(row), colorOf, empty: past ? 'No one said they’d go.' : 'No one yet. Be the first.' },
    { key: 'no', label: 'Can’t make it', short: 'Can’t', people: who.no.map(row), colorOf,
      footHtml: !officer && who.none.length ? `<div class="small muted mt-8">${who.none.length} ${who.none.length === 1 ? 'person hasn’t' : 'people haven’t'} answered yet.</div>` : '' },
  ];
  if (officer) lists.push({ key: 'none', label: 'Haven’t answered', short: 'No answer', people: who.none.map(row), colorOf, empty: 'Everyone has answered.',
    footHtml: who.none.length && !past && !orgIsDuesEvent(e) ? `<button class="btn btn-sm mt-8" onclick="remindToRsvp('${o.code}','${e.id}')">${icon('megaphone', 14)} Remind them to RSVP</button>` : '' });
  return spaceRsvpLists({ key: spaceRsvpKey('club', o.code, e.id), lists });
}
function remindToRsvp(code, eventId) {
  const o = findOrg(code);
  const e = o && orgEventList(o).find(x => x.id === eventId);
  if (!e || orgIsDuesEvent(e)) return;
  openAnnouncementModal(code, `Please RSVP for ${e.title} on ${fmtDate(e.date, { weekday: 'long', month: 'short', day: 'numeric' })}${e.start ? ` at ${fmtTime(e.start)}` : ''}. Open Clubs & Teams in Semester HQ and tap Going or Can’t.`);
}
// The shared control (js/spaces/rsvp.js) with a club's answers: Going and
// Can't. A dues event gets its pay button instead.
function orgRsvpControl(o, e, mine = myOrgRsvp(o, e.id), { size = 'row', stillComing = false, clearable = false } = {}) {
  if (orgIsDuesEvent(e)) return orgDuesAction(o, e, { size });
  return spaceRsvp({ kind: 'club', code: o.code, id: e.id, title: e.title, mine, size, clearable,
    stillComing: stillComing && spaceStillComingDue('club', o.code, e.id, e, mine) });
}
// toggle (default true) clears your answer when you tap the one you already
// gave; the shared control always passes false.
async function setOrgRsvp(code, eventId, val, toggle = true) {
  const o = findOrg(code);
  if (!o || !safeId(eventId) || !['yes', 'no'].includes(val)) return false;
  const u = myOrgUid(o);
  const current = myOrgRsvp(o, eventId);
  const next = spaceRsvpNextValue(current, val, toggle);
  if (next === 'yes' && current !== 'yes') playUiSound('tap');
  const ok = await orgWrite(code, { [`rsvp.${u}.${eventId}`]: next === null ? GW_DELETE : next });
  // Answering from inside the event's sheet: refresh it so you show up in the right list.
  const open = window._orgEventModal;
  if (ok && open?.code === code && open.eventId === eventId && $('#modal .space-sheet')) showOrgEventModal(code, eventId);
  return ok;
}
// The club's next event as the Overview hero.
function orgNextHero(o, e, need = null) {
  const dues = orgIsDuesEvent(e);
  // The countdown chip (or the Happening now strip) carries the when.
  return spaceEventHero({
    date: e.date, start: e.start, end: e.end, where: e.location, notes: e.notes,
    eyebrow: dues ? 'Next up · Due' : eventTimeState(e).phase === 'now' ? 'On now' : 'Next up',
    tags: orgEventTags(o, e, { budget: 2, used: 1, need }),
    title: e.title,
    onOpen: `showOrgEventModal('${o.code}','${e.id}')`,
    rsvpHtml: orgRsvpControl(o, e, myOrgRsvp(o, e.id), { size: 'hero', stillComing: true }),
    facesHtml: dues ? '' : orgFacePile(o, e, { past: orgEventPast(e) }),
    afterHtml: dues ? '' : orgRecapButton(o, e),
    actionsHtml: `<button class="btn btn-ghost btn-sm" onclick="downloadOrgIcs('${o.code}','${e.id}')">${icon('download', 14)} Add to calendar app</button>`,
    className: 'org-next-hero',
  });
}

/* ── Overview agenda: the week strip's day, the tags, the rows ──── */
// The day the week strip filtered the agenda to. A view choice on this
// tab only, so it lives here rather than in state, and a different club
// or a day outside this week resets it.
let _orgAgendaDay = null;
function orgAgendaDay(o) {
  const d = _orgAgendaDay, t = todayIso();
  return d && d.code === o.code && d.date >= t && d.date <= addDays(t, 6) ? d.date : '';
}
// Tapping the selected day again goes back to everything coming up.
function orgPickAgendaDay(code, dateIso) {
  const same = _orgAgendaDay?.code === code && _orgAgendaDay.date === dateIso;
  _orgAgendaDay = same ? null : { code, date: dateIso };
  render();
  const i = daysBetween(dateIso);
  requestAnimationFrame(() => $$('#content .space-weekstrip .space-week-daybtn')[i]?.focus({ preventScroll: true }));
}
// The events that ask for your answer: exactly the 'event' items of
// spaceNeeds, so a weekly series asks once and every count agrees.
// An event that has started or ended never asks.
function orgNeedIds(o) {
  const byId = new Map(orgEventList(o).map(e => [e.id, e]));
  return new Set(spaceNeeds('club', o).items.filter(i => i.type === 'event' && byId.has(i.id) && eventTimeState(byId.get(i.id)).phase === 'before').map(i => i.id));
}
// The event's tags. need: a Set from orgNeedIds (pass it when tagging many rows).
// Full set (budget 0): Required, Weekly, the category (cat) and Needs your answer.
// With a budget (rows, the hero, the Month day list) it shows at most that
// many, in this order: the time chip (when: Tonight, Happening now),
// Required, then the Weekly or series label only while fewer than two are
// shown. used counts a slot already spent elsewhere (the hero's eyebrow
// says On now or Next up, and its chip carries the countdown). No
// category (rows put its glyph in the meta line) and no Needs your answer
// (the unanswered RSVP already asks).
function orgEventTags(o, e, { cat = false, need = null, budget = 0, when = false, used = 0 } = {}) {
  const dues = orgIsDuesEvent(e);
  const req = e.required && !dues ? spaceTag('required', 'Required') : '';
  const series = e.seriesId ? spaceTag('weekly', orgSeriesLabel(o, e)) : '';
  if (budget) {
    const out = [when ? spaceWhenChip(e) : '', req].filter(Boolean);
    if (series && used + out.length < 2) out.push(series);
    return out.slice(0, Math.max(0, budget - used)).join('');
  }
  const c = orgCat(e);
  const asks = eventTimeState(e).phase === 'before' && (need || orgNeedIds(o)).has(e.id);
  return [
    req, series,
    cat && !dues && c[0] !== 'other' ? spaceTag('cat', c[1], c[2]) : '',
    asks ? spaceTag('need', 'Needs your answer') : '',
  ].join('');
}
// The category as a 13px glyph at the start of a row's meta line; the
// name is read, not shown.
function orgMetaCat(e) {
  const c = orgCat(e);
  if (orgIsDuesEvent(e) || c[0] === 'other') return '';
  return `<span class="org-meta-cat">${icon(c[2], 13)}<span class="sr-only">${esc(c[1])}, </span></span>`;
}
// One flat agenda row: date tile, title, when and where, tags, and the
// compact RSVP (or the dues button) at the end. The Calendar tab
// (js/orgs/calendar.js) passes opts:
//   className: extra row class (org-cal-social for the larger social row)
//   facesHtml: a face pile on its own line under the tags; the "7 going"
//     count leaves the meta line, since the faces say it
function orgAgendaRow(o, e, need = null, { className = '', facesHtml = '' } = {}) {
  const past = orgEventPast(e);
  const dues = orgIsDuesEvent(e);
  const counts = orgRsvpCounts(o, e.id);
  // Members never see "0 going"; officers count heads.
  const going = dues || facesHtml ? '' : past ? `${counts.yes} said they’d go` : counts.yes || isOrgOfficer(o) ? `${counts.yes} going` : '';
  const when = e.start ? `${fmtTime(e.start)}${e.end ? ` to ${fmtTime(e.end)}` : ''}` : dues ? 'Due' : 'All day';
  return spaceAgendaRow({
    date: e.date, title: e.title, past, className,
    // A dues row says Due beside a flag, where others have their time.
    metaHtml: [dues && !e.start ? `<span class="org-cat">${icon('flag', 12)} Due</span>` : `${orgMetaCat(e)}${esc(when)}`, e.location ? esc(e.location) : '', going ? `<span class="org-row-going">${going}</span>` : ''].filter(Boolean).join(' · '),
    tags: `${orgEventTags(o, e, { budget: 2, when: !past, need })}${facesHtml ? `<span class="org-cal-faces">${facesHtml}</span>` : ''}`,
    trailingHtml: past ? orgRecapLink(o, e) : orgRsvpControl(o, e),
    onclick: `showOrgEventModal('${o.code}','${e.id}')`,
  });
}
/* ── Events ────────────────────────────────────────────────────── */
function showOrgEventModal(code, eventId) {
  const o = findOrg(code);
  const e = o && orgEventList(o).find(x => x.id === eventId);
  if (!e) return;
  const past = orgEventPast(e);
  const dues = orgIsDuesEvent(e);
  const officer = isOrgOfficer(o);
  window._orgEventModal = { code, eventId };
  const cat = orgCat(e);
  const later = e.seriesId ? orgEventList(o).filter(x => x.seriesId === e.seriesId && x.date > e.date).length : 0;
  // A dues event has no lists, unless someone answered before it became one:
  // officers still see those answers rather than losing them.
  const anyAnswers = orgRsvpCounts(o, e.id).yes + orgRsvpCounts(o, e.id).no > 0;
  openModal(spaceEventSheet({
    kind: 'club', code: o.code, id: e.id, color: orgColor(o), glyph: cat[2], spaceName: o.name,
    title: e.title, date: e.date, start: e.start, end: e.end, where: e.location, notes: e.notes,
    tags: `${spaceTag('cat', cat[1], cat[2])}${e.required && !dues ? spaceTag('required', 'Required') : ''}${e.seriesId ? spaceTag('weekly', `${orgSeriesLabel(o, e)}${later ? `, ${later} more after this` : ''}`) : ''}`,
    rsvpHtml: past ? '' : orgRsvpControl(o, e, myOrgRsvp(o, e.id), { size: 'hero', stillComing: true, clearable: true }),
    facesHtml: dues ? '' : orgFacePile(o, e, { size: 24, past }),
    recapHtml: dues ? '' : orgRecapButton(o, e),
    actionsHtml: `${past ? '' : `${joinLinkButton(e.location)}${chatShareButton('club', o.code, e.id)}<button class="btn btn-ghost btn-sm" onclick="downloadOrgIcs('${o.code}','${e.id}')">${icon('download', 14)} Add to calendar app</button>`}${officer ? orgEventOfficerActions(o, e) : ''}`,
    listsHtml: dues && !(officer && anyAnswers) ? '' : orgAttendanceLists(o, e),
    footHtml: officer ? `<button class="btn btn-danger" style="margin-right:auto" onclick="deleteOrgEvent('${o.code}','${e.id}')">Delete</button><button class="btn" onclick="openOrgEventModal('${o.code}','${e.id}')">Edit</button><button class="btn btn-primary" onclick="closeModal()">Done</button>` : '',
  }), { onClose: () => { window._orgEventModal = null; } });
}
// opts (new events only):
//   prefill: an event to copy (Duplicate). Everything but the date and the
//     series comes along; the caller picks the date (orgDuplicateDate).
//   date: an ISO date to start on (Add an event on this day, Month view).
function openOrgEventModal(code, eventId, { prefill = null, date = '' } = {}) {
  const o = findOrg(code);
  if (!o || !isOrgOfficer(o)) return;
  const e = eventId ? orgEventList(o).find(x => x.id === eventId) : null;
  const later = e?.seriesId ? orgEventList(o).filter(x => x.seriesId === e.seriesId && x.date > e.date).length : 0;
  const blank = { title: '', category: 'meeting', date: todayIso(), start: '19:00', end: '20:00', location: '', required: false, notes: '' };
  const v = e || (prefill ? { ...blank, ...prefill, date: prefill.date || todayIso() } : blank);
  if (!e && /^\d{4}-\d{2}-\d{2}$/.test(date || '')) v.date = date;
  openModal(`
    <div class="modal-head"><h3>${e ? 'Edit event' : prefill ? 'Duplicate event' : `New event for ${esc(o.name)}`}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body">
      <div class="field-row">
        <div class="field"><label for="oe-title">What</label><input class="input" id="oe-title" maxlength="120" value="${esc(v.title)}" placeholder="Chapter meeting"></div>
        <div class="field" style="max-width:220px"><label for="oe-cat">Type</label><select class="select" id="oe-cat">${ORG_EVENT_CATEGORIES.map(([k, l]) => `<option value="${k}" ${v.category === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="oe-date">Date</label><input class="input" type="date" id="oe-date" value="${v.date}"></div>
        <div class="field"><label for="oe-start">Starts</label><input class="input" type="time" id="oe-start" value="${v.start || ''}"></div>
        <div class="field"><label for="oe-end">Ends</label><input class="input" type="time" id="oe-end" value="${v.end || ''}"></div>
      </div>
      <div class="field"><label for="oe-where">Where</label><input class="input" id="oe-where" maxlength="120" value="${esc(v.location)}" placeholder="Student Union 210, or a Zoom link"></div>
      <div class="field"><label for="oe-notes">Details <span class="muted">(optional)</span></label><textarea class="input" id="oe-notes" maxlength="1000" placeholder="Wear your jersey. Dues are due at the door.">${esc(v.notes)}</textarea></div>
      <label class="checkbox-row small"><input type="checkbox" id="oe-required" ${v.required ? 'checked' : ''}><span>Required for members</span></label>
      ${!e ? orgRepeatFieldsHtml() : ''}
      ${e && later > 0 ? `<label class="checkbox-row small mt-8"><input type="checkbox" id="oe-series"><span>Also update the ${later} later event${later === 1 ? '' : 's'} in this series (they keep their dates)</span></label>` : ''}
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="oe-save" onclick="saveOrgEvent('${o.code}',${e ? `'${e.id}'` : 'null'})">${e ? 'Save' : 'Add to calendar'}</button></div>
  `);
}
async function saveOrgEvent(code, eventId) {
  const o = findOrg(code);
  if (!o || !isOrgOfficer(o)) return;
  const title = $('#oe-title').value.trim();
  const date = $('#oe-date').value;
  if (!title || !date) { toast('Add a name and a date', 'error'); return; }
  const base = { title: title.slice(0, 120), category: $('#oe-cat').value, start: $('#oe-start').value || '', end: $('#oe-end').value || '', location: $('#oe-where').value.trim().slice(0, 120), notes: $('#oe-notes').value.trim().slice(0, 1000), required: $('#oe-required').checked };
  const ops = {};
  let laterCount = 0, repeatStep = 7;
  if (eventId) {
    Object.entries({ ...base, date }).forEach(([k, val]) => { ops[`events.${eventId}.${k}`] = val; });
    // Practice moved from 6 to 7 for the rest of the season: the later
    // events in the series take the new details but keep their own dates.
    const cur = orgEventList(o).find(x => x.id === eventId);
    if ($('#oe-series')?.checked && cur?.seriesId) {
      const later = orgEventList(o).filter(x => x.seriesId === cur.seriesId && x.date > cur.date);
      laterCount = later.length;
      later.forEach(x => Object.entries(base).forEach(([k, val]) => { ops[`events.${x.id}.${k}`] = val; }));
    }
  } else {
    // "Repeat every other week, 4 times": 4 events, 14 days apart, one seriesId.
    const times = $('#oe-repeat')?.checked ? Math.min(ORG_REPEAT_MAX, Number($('#oe-weeks').value) || 1) : 1;
    repeatStep = Number($('#oe-step')?.value) === 14 ? 14 : 7;
    const seriesId = times > 1 ? uid() : null;
    for (let i = 0; i < times; i++) {
      const id = uid();
      ops[`events.${id}`] = { id, ...base, date: addDays(date, i * repeatStep), seriesId, createdBy: myOrgUid(o), createdAt: Date.now() };
    }
  }
  setBtnLoading($('#oe-save'), true);
  if (await orgWrite(code, ops)) { closeModal(); const n = Object.keys(ops).length; toast(eventId ? (laterCount ? `Updated this and ${laterCount} later event${laterCount === 1 ? '' : 's'}` : 'Event updated') : n > 1 ? `Added ${n} events, ${ORG_SERIES_LABELS[repeatStep].toLowerCase()}` : 'Event added. Members will see it on their calendar.'); }
  else setBtnLoading($('#oe-save'), false, eventId ? 'Save' : 'Add to calendar');
}
function deleteOrgEvent(code, eventId) {
  const o = findOrg(code);
  const e = o && orgEventList(o).find(x => x.id === eventId);
  if (!e) return;
  const series = e.seriesId ? orgEventList(o).filter(x => x.seriesId === e.seriesId && x.date >= e.date) : [];
  openModal(`
    <div class="modal-body" style="padding-top:22px"><p style="font-size:14px">Delete “${esc(e.title)}” on ${esc(fmtDate(e.date))}? It comes off every member’s calendar.</p></div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      ${series.length > 1 ? `<button class="btn btn-danger" onclick="removeOrgEvents('${code}',${JSON.stringify(series.map(x => x.id)).replace(/"/g, '&quot;')})">This and ${series.length - 1} after</button>` : ''}
      <button class="btn btn-danger" onclick="removeOrgEvents('${code}',['${e.id}'])">Delete event</button>
    </div>
  `);
}
async function removeOrgEvents(code, ids) {
  const ops = {};
  ids.filter(safeId).forEach(id => { ops[`events.${id}`] = GW_DELETE; });
  closeModal();
  if (await orgWrite(code, ops)) toast(ids.length > 1 ? `Deleted ${ids.length} events` : 'Event deleted');
}
function downloadOrgIcs(code, eventId) {
  const o = findOrg(code);
  if (!o) return;
  const list = orgEventList(o).filter(e => (eventId ? e.id === eventId : !orgEventPast(e)));
  const icsText = (v) => String(v || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Semester HQ//Clubs//EN'];
  list.forEach(e => {
    const d = e.date.replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${e.id}@${o.code}.semester-hq`, `DTSTAMP:${stamp}`,
      ...(e.start ? [`DTSTART:${d}T${e.start.replace(':', '')}00`, `DTEND:${d}T${(e.end || addMinutesHHMM(e.start, 60)).replace(':', '')}00`] : [`DTSTART;VALUE=DATE:${d}`]),
      `SUMMARY:${icsText(`${o.name}: ${e.title}`)}`, ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []), ...(e.notes ? [`DESCRIPTION:${icsText(e.notes)}`] : []), 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  a.download = `${o.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'club'}${eventId ? '-event' : ''}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ── After: Post a recap (officers) ────────────────────────────── */
function _orgEndMs(e) { const st = eventTimeState(e); return new Date(`${e.date}T${st.endsAt}:00`).getTime(); }
function orgRecapPosted(o, e) {
  const end = _orgEndMs(e);
  const t = String(e.title || '').toLowerCase();
  return !!t && orgAnnouncementList(o).some(a => (a.at || 0) >= end && a.text.toLowerCase().includes(t));
}
// Rows only offer it for the past week, and not once a recap names the
// event; the sheet always has it.
function orgRecapLink(o, e) {
  if (!isOrgOfficer(o) || orgIsDuesEvent(e) || !spaceRecentlyEnded(e, 7 * 24) || orgRecapPosted(o, e)) return '';
  return `<button type="button" class="sg-link org-recap-link" onclick="event.stopPropagation();postOrgRecap('${o.code}','${e.id}')">${icon('megaphone', 12)} Post a recap</button>`;
}
function orgRecapButton(o, e) {
  if (!isOrgOfficer(o) || orgIsDuesEvent(e)) return '';
  const done = orgRecapPosted(o, e);
  return `<div class="org-recap-row"><button class="btn btn-sm" onclick="postOrgRecap('${o.code}','${e.id}')">${icon('megaphone', 14)} ${done ? 'Post another recap' : 'Post a recap'}</button><span class="small muted">${done ? 'There’s one in Announcements.' : 'Thank people for coming and share what happened.'}</span></div>`;
}
function postOrgRecap(code, eventId) {
  const o = findOrg(code);
  const e = o && orgEventList(o).find(x => x.id === eventId);
  if (!e || !isOrgOfficer(o)) return;
  const st = eventTimeState(e);
  const when = st.days === 0 ? (_evMin(e.start) >= 17 * 60 ? ' tonight' : ' today') : st.days === -1 ? ' yesterday' : ` on ${fmtDate(e.date, { weekday: 'long', month: 'short', day: 'numeric' })}`;
  const text = `Thanks to everyone who came to ${e.title}${when}! Here’s the recap:\n\n`;
  openAnnouncementModal(code, text.slice(0, ORG_ANNOUNCEMENT_MAX));
  requestAnimationFrame(() => { const el = $('#an-text'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
}
// The Overview's "just ended" card, officers only: the latest event that
// ended in the last 18 hours, until a recap names it or you say Not now.
function orgRecapPrompt(o) {
  if (!isOrgOfficer(o)) return '';
  const e = orgEventList(o).filter(x => !orgIsDuesEvent(x) && orgEventPast(x) && spaceRecentlyEnded(x)).pop();
  if (!e) return '';
  const key = `club:${o.code}:${e.id}`;
  if (orgRecapPosted(o, e) || spaceRecapDismissed(key)) return '';
  return spaceRecapCard({
    date: e.date, start: e.start, end: e.end, title: e.title,
    facesHtml: orgFacePile(o, e, { size: 22, past: true }),
    bodyHtml: `<div class="org-recap-row"><button class="btn btn-primary btn-sm" onclick="postOrgRecap('${o.code}','${e.id}')">${icon('megaphone', 14)} Post a recap</button><span class="small muted">It goes to Announcements.</span></div>`,
    dismissJs: `spaceRecapDismiss('${key}')`,
  });
}
