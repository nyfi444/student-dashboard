/* ── Clubs & teams: events ────────────────────────────────────────
   Event rows, answers (Going or Can't), the Next up hero, the Overview
   agenda and its tags, the Calendar tab, and the event sheets (view, add,
   edit, delete, .ics). Loaded after js/orgs/sync.js and before js/orgs.js.
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
function orgEventRow(o, e, { showOrg = false, need = null } = {}) {
  const counts = orgRsvpCounts(o, e.id);
  const past = orgEventPast(e);
  const dues = orgIsDuesEvent(e);
  // Count text only (no faces in rows). Members never see "0 going".
  const count = dues ? '' : past ? `${counts.yes} said they’d go` : counts.yes || isOrgOfficer(o) ? `${counts.yes} going` : '';
  const trailing = past ? '' : dues ? orgDuesAction(o, e) : orgRsvpControl(o, e);
  return `
    <div class="list-row sg-session-row org-event-row ${past ? 'is-past' : ''}" style="--course:${esc(orgColor(o))}" onclick="showOrgEventModal('${o.code}','${e.id}')">
      ${spaceDateBlock(e.date, { size: 'tile' })}
      <div class="row-title">
        <div class="sg-strong">${esc(e.title)}</div>
        <div class="row-meta">${[showOrg ? esc(o.name) : '', orgCatHtml(e), esc(_evTimeRange(e.start, e.end)), e.location ? esc(e.location) : '', count ? `<span class="org-row-going">${count}</span>` : ''].filter(Boolean).join(' · ')}</div>
        ${(() => { const t = orgEventTags(o, e, { need }); return t ? `<div class="space-agenda-tags org-event-tags">${t}</div>` : ''; })()}
      </div>
      ${trailing}
    </div>`;
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
function orgFacePile(o, e, { size = 26 } = {}) {
  const who = orgRsvpPeople(o, e);
  const faces = orgFaceColors(o);
  const officer = isOrgOfficer(o);
  return spaceFacePile({
    people: who.yes, meUid: myOrgUid(o), size, colorOf: (uid) => faces[uid] || orgColor(o),
    zeroText: officer ? '0 going' : 'Be the first to say you’re going',
    detail: officer && who.none.length ? `${who.none.length} haven’t answered` : '',
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
    eyebrow: dues ? 'Next up · Due' : 'Next up',
    tags: orgEventTags(o, e, { need }),
    title: e.title,
    onOpen: `showOrgEventModal('${o.code}','${e.id}')`,
    rsvpHtml: orgRsvpControl(o, e, myOrgRsvp(o, e.id), { size: 'hero', stillComing: true }),
    facesHtml: dues ? '' : orgFacePile(o, e),
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
function orgNeedIds(o) { return new Set(spaceNeeds('club', o).items.filter(i => i.type === 'event').map(i => i.id)); }
// Required, Weekly, the category (agenda rows only) and Needs your answer.
// need: a Set from orgNeedIds (pass it when tagging many rows).
function orgEventTags(o, e, { cat = false, need = null } = {}) {
  const dues = orgIsDuesEvent(e);
  const c = orgCat(e);
  const asks = (need || orgNeedIds(o)).has(e.id);
  return [
    e.required && !dues ? spaceTag('required', 'Required') : '',
    e.seriesId ? spaceTag('weekly', 'Weekly') : '',
    cat && !dues && c[0] !== 'other' ? spaceTag('cat', c[1], c[2]) : '',
    asks ? spaceTag('need', 'Needs your answer') : '',
  ].join('');
}
// One flat agenda row: date tile, title, when and where, tags, and the
// compact RSVP (or the dues button) at the end.
function orgAgendaRow(o, e, need = null) {
  const past = orgEventPast(e);
  const dues = orgIsDuesEvent(e);
  const counts = orgRsvpCounts(o, e.id);
  // Members never see "0 going"; officers count heads.
  const going = dues ? '' : past ? `${counts.yes} said they’d go` : counts.yes || isOrgOfficer(o) ? `${counts.yes} going` : '';
  const when = e.start ? `${fmtTime(e.start)}${e.end ? ` to ${fmtTime(e.end)}` : ''}` : dues ? 'Due' : 'All day';
  return spaceAgendaRow({
    date: e.date, title: e.title, past,
    metaHtml: [esc(when), e.location ? esc(e.location) : '', going ? `<span class="org-row-going">${going}</span>` : ''].filter(Boolean).join(' · '),
    tags: orgEventTags(o, e, { cat: true, need }),
    trailingHtml: past ? '' : orgRsvpControl(o, e),
    onclick: `showOrgEventModal('${o.code}','${e.id}')`,
  });
}
function orgEventsTab(o) {
  const need = orgNeedIds(o);
  const all = orgEventList(o);
  const upcoming = all.filter(e => !orgEventPast(e));
  const past = all.filter(orgEventPast).reverse();
  const byMonth = [];
  upcoming.forEach(e => { const key = e.date.slice(0, 7); let g = byMonth.find(x => x.key === key); if (!g) byMonth.push(g = { key, label: fmtDate(e.date, { month: 'long', year: 'numeric' }), items: [] }); g.items.push(e); });
  return `
    <div class="sg-toolbar">
      <div class="small muted">${o.hideCalendar ? 'These events are hidden from your calendar.' : 'Events you haven’t said no to are on your calendar.'}</div>
      <div class="flex-gap">
        ${upcoming.length ? `<button class="btn btn-sm" onclick="downloadOrgIcs('${o.code}')">${icon('download', 14)} Add all to calendar app</button>` : ''}
        ${isOrgOfficer(o) ? `<button class="btn btn-primary btn-sm" onclick="openOrgEventModal('${o.code}')">${icon('plus', 14)} Event</button>` : ''}
      </div>
    </div>
    ${byMonth.length ? byMonth.map(g => `<div class="sg-section-label">${esc(g.label)}</div><div class="card card-pad mb-16">${g.items.map(e => orgEventRow(o, e, { need })).join('')}</div>`).join('') : emptyState(icon('calendar', 24), 'No upcoming events', isOrgOfficer(o) ? `<button class="btn btn-primary btn-sm" onclick="openOrgEventModal('${o.code}')">${icon('plus', 14)} Add an event</button>` : '', isOrgOfficer(o) ? 'Weekly meetings can repeat, so you only add them once.' : '')}
    ${past.length ? `<details class="sg-past"><summary class="small muted">Past events (${past.length})</summary><div class="card card-pad">${past.slice(0, 40).map(e => orgEventRow(o, e, { need })).join('')}</div></details>` : ''}
  `;
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
    tags: `${spaceTag('cat', cat[1], cat[2])}${e.required && !dues ? spaceTag('required', 'Required') : ''}${e.seriesId ? spaceTag('weekly', `Weekly${later ? `, ${later} more after this` : ''}`) : ''}`,
    rsvpHtml: past ? '' : orgRsvpControl(o, e, myOrgRsvp(o, e.id), { size: 'hero', stillComing: true, clearable: true }),
    facesHtml: past || dues ? '' : orgFacePile(o, e, { size: 24 }),
    actionsHtml: past ? '' : `${joinLinkButton(e.location)}<button class="btn btn-ghost btn-sm" onclick="downloadOrgIcs('${o.code}','${e.id}')">${icon('download', 14)} Add to calendar app</button>`,
    listsHtml: dues && !(officer && anyAnswers) ? '' : orgAttendanceLists(o, e),
    footHtml: officer ? `<button class="btn btn-danger" style="margin-right:auto" onclick="deleteOrgEvent('${o.code}','${e.id}')">Delete</button><button class="btn" onclick="openOrgEventModal('${o.code}','${e.id}')">Edit</button><button class="btn btn-primary" onclick="closeModal()">Done</button>` : '',
  }), { onClose: () => { window._orgEventModal = null; } });
}
function openOrgEventModal(code, eventId) {
  const o = findOrg(code);
  if (!o || !isOrgOfficer(o)) return;
  const e = eventId ? orgEventList(o).find(x => x.id === eventId) : null;
  const later = e?.seriesId ? orgEventList(o).filter(x => x.seriesId === e.seriesId && x.date > e.date).length : 0;
  const v = e || { title: '', category: 'meeting', date: todayIso(), start: '19:00', end: '20:00', location: '', required: false, notes: '' };
  openModal(`
    <div class="modal-head"><h3>${e ? 'Edit event' : `New event for ${esc(o.name)}`}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
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
      ${!e ? `<div class="field-row mt-8" style="align-items:center"><label class="checkbox-row small" style="margin:0"><input type="checkbox" id="oe-repeat" onchange="$('#oe-weeks').disabled=!this.checked"><span>Repeat weekly for</span></label><select class="select" id="oe-weeks" style="max-width:110px" disabled aria-label="How many weeks">${[2, 4, 6, 8, 10, 12, 15].map(n => `<option value="${n}" ${n === 8 ? 'selected' : ''}>${n} weeks</option>`).join('')}</select></div>` : ''}
      ${e && later > 0 ? `<label class="checkbox-row small mt-8"><input type="checkbox" id="oe-series"><span>Also update the ${later} later event${later === 1 ? '' : 's'} in this weekly series (they keep their dates)</span></label>` : ''}
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
  let laterCount = 0;
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
    const weeks = $('#oe-repeat')?.checked ? Number($('#oe-weeks').value) || 1 : 1;
    const seriesId = weeks > 1 ? uid() : null;
    for (let i = 0; i < weeks; i++) {
      const id = uid();
      ops[`events.${id}`] = { id, ...base, date: addDays(date, i * 7), seriesId, createdBy: myOrgUid(o), createdAt: Date.now() };
    }
  }
  setBtnLoading($('#oe-save'), true);
  if (await orgWrite(code, ops)) { closeModal(); const n = Object.keys(ops).length; toast(eventId ? (laterCount ? `Updated this and ${laterCount} later event${laterCount === 1 ? '' : 's'}` : 'Event updated') : n > 1 ? `Added ${n} weekly events` : 'Event added. Members will see it on their calendar.'); }
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
