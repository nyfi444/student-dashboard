/* ── Study Groups: the Sessions tab and the session sheet ────────
   RSVPs, the next-session hero, the Sessions tab, sessionCard, the
   details sheet, new/edit/delete and calendar files. Moved out of
   js/studygroups.js as is; every name stays global. Loaded after
   js/groups/home.js and before js/studygroups.js.
──────────────────────────────────────────────────────────────── */
/* ── Sessions ──────────────────────────────────────────────────── */
// The shared control (js/spaces/rsvp.js) with a group's answers: Going,
// Maybe, Can't. size 'row' everywhere a list shows sessions, 'hero' in the
// next-session card and the session sheet.
function rsvpControl(g, s, { size = 'row', stillComing = false, clearable = false } = {}) {
  const mine = s.rsvp?.[myUidFor(g)] || '';
  return spaceRsvp({ kind: 'group', code: g.code, id: s.id, title: s.title, mine, size, clearable,
    stillComing: stillComing && spaceStillComingDue('group', g.code, s.id, s, mine) });
}
// toggle (default true, the old behavior) clears your answer when you tap
// the one you already gave. The shared control always passes false, so
// "Still coming? Yes" and "Change, same answer" can never un-RSVP you.
async function setSessionRsvp(code, sid, val, toggle = true) {
  const g = findGroup(code);
  if (!g?.sessions?.[sid] || !['yes', 'maybe', 'no'].includes(val)) return false;
  const u = myUidFor(g);
  const current = g.sessions[sid].rsvp?.[u];
  const next = spaceRsvpNextValue(current, val, toggle);
  if (next === 'yes' && current !== 'yes' && typeof playUiSound === 'function') playUiSound('tap');
  const ok = await groupWrite(code, { [`sessions.${sid}.rsvp.${u}`]: next === null ? GW_DELETE : next });
  // Answering from inside the session's sheet: refresh it so you land in the right list.
  const open = window._groupSessionModal;
  if (ok && open?.code === code && open.sid === sid && $('#modal .space-sheet')) showGroupSessionModal(code, sid);
  return ok;
}
// Who gave which answer, current members only: someone who left keeps a
// key in s.rsvp, but shouldn't be counted or shown as "Former member".
function sessionRsvpPeople(g, s) {
  const out = { yes: [], maybe: [], no: [], none: [] };
  groupPeople(g).forEach(p => { const v = s.rsvp?.[p.uid]; (out[v === 'yes' || v === 'maybe' || v === 'no' ? v : 'none']).push(p); });
  return out;
}
// "You, Maya and 3 others are going". Groups have no officers, so everyone
// sees the counts; only the empty hero line changes.
function groupFacePile(g, s, { size = 26, zero = true } = {}) {
  const who = sessionRsvpPeople(g, s);
  return spaceFacePile({
    people: who.yes, meUid: myUidFor(g), size, colorOf: (uid) => personColor(g, uid),
    zeroText: zero ? 'Be the first to say you’re going' : '0 going',
    detail: who.maybe.length ? `${who.maybe.length} maybe` : '',
    onclick: `showGroupSessionModal('${g.code}','${s.id}')`,
    label: `See who’s going to ${s.title}`,
  });
}
/* ── Session sheet: the details, who's coming, and who hasn't said ──
   Session cards used to hide the RSVP names in a tooltip. This is the
   same sheet as a club event's (spaceEventSheet), so calendar blocks,
   dashboard rows and "coming up" lists all open the same thing. */
function showGroupSessionModal(code, sid) {
  const g = findGroup(code);
  const s = g?.sessions?.[sid];
  if (!g || !s || !safeId(sid)) return;
  const u = myUidFor(g);
  const past = sessionIsPast(s);
  const who = sessionRsvpPeople(g, s);
  window._groupSessionModal = { code, sid };
  const later = s.seriesId ? sessionList(g).filter(x => x.seriesId === s.seriesId && x.date > s.date).length : 0;
  const colorOf = (uid) => personColor(g, uid);
  const nameOf = (p) => ({ ...p, name: p.uid === u && p.name !== 'You' ? `${p.name} (you)` : p.name });
  const lists = [
    { key: 'yes', label: past ? 'Said they’d go' : 'Going', short: past ? 'Went' : 'Going', people: who.yes.map(nameOf), colorOf, empty: past ? 'No one said they’d go.' : 'No one yet. Be the first.' },
    { key: 'maybe', label: 'Maybe', people: who.maybe.map(nameOf), colorOf },
    { key: 'no', label: 'Can’t make it', short: 'Can’t', people: who.no.map(nameOf), colorOf },
    { key: 'none', label: 'Haven’t answered', short: 'No answer', people: who.none.map(nameOf), colorOf, empty: 'Everyone has answered.',
      footHtml: who.none.length && !past && !g.local ? `<button class="btn btn-sm mt-8" onclick="copyRsvpNudge('${g.code}','${s.id}')">${icon('copy', 14)} Copy a reminder for them</button>` : '' },
  ];
  openModal(spaceEventSheet({
    kind: 'group', code: g.code, id: s.id, color: groupColor(g), glyph: 'book-open', spaceName: g.name,
    title: s.title, date: s.date, start: s.start, end: s.end, where: s.where, notes: s.notes,
    tags: s.seriesId ? spaceTag('weekly', `Weekly${later ? `, ${later} more after this` : ''}`) : '',
    rsvpHtml: past ? '' : rsvpControl(g, s, { size: 'hero', stillComing: true, clearable: true }),
    facesHtml: past ? '' : groupFacePile(g, s, { size: 24 }),
    actionsHtml: past ? '' : `${joinLinkButton(s.where)}<button class="btn btn-ghost btn-sm" onclick="downloadSessionIcs('${g.code}','${s.id}')">${icon('download', 14)} Add to calendar app</button>`,
    listsHtml: spaceRsvpLists({ key: spaceRsvpKey('group', g.code, s.id), lists }),
    footHtml: `<button class="btn btn-danger" style="margin-right:auto" onclick="deleteSession('${g.code}','${s.id}')">Delete</button><button class="btn" onclick="openSessionModal('${g.code}','${s.id}')">Edit</button><button class="btn btn-primary" onclick="closeModal()">Done</button>`,
  }), { onClose: () => { window._groupSessionModal = null; } });
}
function copyRsvpNudge(code, sid) {
  const g = findGroup(code);
  const s = g?.sessions?.[sid];
  if (!s) return;
  copyText(`Can everyone RSVP for “${s.title}” (${fmtSessionWhen(s)}) in Semester HQ? Open “${g.name}” → Sessions and tap Going, Maybe, or Can’t. ${groupInviteLink(code)}`, 'Reminder copied. Paste it in your group chat.');
}
// need: the session is one the needs strip would ask about; the home leaves
// it out of the strip and badges it here instead.
function nextSessionHero(g, s, { need = false } = {}) {
  // The countdown chip (or the Happening now strip) carries the when.
  return spaceEventHero({
    date: s.date, start: s.start, end: s.end, where: s.where, notes: s.notes,
    eyebrow: 'Next session',
    tags: `${need ? spaceTag('need', 'Needs your answer') : ''}${s.seriesId ? spaceTag('weekly', 'Weekly') : ''}`,
    title: s.title,
    onOpen: `showGroupSessionModal('${g.code}','${s.id}')`,
    rsvpHtml: rsvpControl(g, s, { size: 'hero', stillComing: true }),
    facesHtml: groupFacePile(g, s),
    actionsHtml: `<button class="btn btn-ghost btn-sm sg-ics" onclick="downloadSessionIcs('${g.code}','${s.id}')">${icon('download', 14)} Add to calendar app</button>`,
    className: 'sg-next-hero',
  });
}
function groupScheduleTab(g) {
  const upcoming = upcomingSessions(g);
  const past = sessionList(g).filter(sessionIsPast).reverse();
  // The sessions that count toward the home's "need you" number get the
  // same "Needs your answer" tag here.
  const needIds = new Set(spaceNeeds('group', g).items.filter(i => i.type === 'session').map(i => i.id));
  const allIcs = upcoming.length > 1;
  // On phones the toolbar button hides and the quiet link under the list
  // takes its place, so New session and Find a time share one row.
  return `
    <div class="sg-toolbar">
      <div class="small muted">Sessions show up on every member’s Semester HQ calendar.</div>
      <div class="flex-gap wrap sg-sched-actions">${allIcs ? `<button class="btn btn-sm sg-ics-all" onclick="downloadSessionIcs('${g.code}')">${icon('download', 14)} Add all to calendar app</button>` : ''}<button class="btn btn-sm sg-find-time" onclick="setGroupTab('availability')">${icon('grid', 14)} Find a time</button><button class="btn btn-primary btn-sm sg-new-session" onclick="openSessionModal('${g.code}')">${icon('plus', 14)} New session</button></div>
    </div>
    ${upcoming.length ? `<div class="card sg-sessions">${upcoming.map(s => sessionCard(g, s, { needIds })).join('')}</div>` : emptyState(icon('calendar', 24), 'No upcoming sessions', `<button class="btn btn-primary btn-sm mt-8" onclick="openSessionModal('${g.code}')">Schedule one</button>`, 'Not sure when? Find a time shows when everyone is free.')}
    ${allIcs ? `<button type="button" class="sg-link sg-ics-all-link" onclick="downloadSessionIcs('${g.code}')">${icon('download', 14)} Add all to calendar app</button>` : ''}
    ${past.length ? `<details class="sg-past"><summary class="small muted">Past sessions (${past.length})</summary><div class="card sg-sessions">${past.slice(0, 30).map(s => sessionCard(g, s, { past: true })).join('')}</div></details>` : ''}
  `;
}
// One session as an agenda row, like the ones on the group home: date
// tile, title, when and where, the notes as a quote, Weekly and who's
// going, then the compact RSVP and the calendar-file and edit buttons.
// The title is the one tab stop that opens the sheet; the rest of the row
// is a mouse-only click, as in spaceAgendaRow.
let _sgSessionRowSeq = 0;
function sessionCard(g, s, { past = false, needIds = null } = {}) {
  const id = `sg-sess-${++_sgSessionRowSeq}`;
  const open = `showGroupSessionModal('${g.code}','${s.id}')`;
  const going = sessionRsvpPeople(g, s).yes.length;
  const meta = [
    esc(fmtSessionDay(s.date)),
    esc(_evTimeRange(s.start, s.end) || 'Any time'),
    s.where ? spaceWhereHtml(s.where) : '',
    past && going ? `${going} said they’d go` : '',
  ].filter(Boolean).join(' · ');
  const tags = [
    !past && needIds?.has(s.id) ? spaceTag('need', 'Needs your answer') : '',
    s.seriesId ? spaceTag('weekly', 'Weekly') : '',
    !past && going ? groupFacePile(g, s, { size: 20 }) : '',
  ].join('');
  const describedBy = [`${id}-d`, `${id}-m`, tags ? `${id}-t` : ''].filter(Boolean).join(' ');
  return `
    <div class="space-agenda-row sg-session${past ? ' is-past' : ''}" data-row-click tabindex="-1" onclick="${open}">
      ${spaceDateBlock(s.date, { size: 'tile', id: `${id}-d` })}
      <div class="space-agenda-main">
        <button type="button" class="space-agenda-title" onclick="event.stopPropagation();${open}" aria-describedby="${describedBy}">${esc(s.title)}</button>
        <div class="space-agenda-meta" id="${id}-m">${meta}</div>
        ${s.notes ? `<div class="sg-session-notes" onclick="if(event.target.closest('a'))event.stopPropagation()">${linkifyText(s.notes)}</div>` : ''}
        ${tags ? `<div class="space-agenda-tags" id="${id}-t">${tags}</div>` : ''}
      </div>
      <div class="space-agenda-end sg-session-end" onclick="event.stopPropagation()">
        ${past ? '' : rsvpControl(g, s)}
        <span class="sg-session-tools">
          ${!past ? `<button class="btn btn-ghost btn-icon btn-sm" data-tip="Add to your calendar app (.ics)" aria-label="Download ${esc(s.title)} as a calendar file" onclick="event.stopPropagation();downloadSessionIcs('${g.code}','${s.id}')">${icon('download', 14)}</button>` : ''}
          <button class="btn btn-ghost btn-icon btn-sm" aria-label="Edit ${esc(s.title)}" data-tip="Edit" onclick="event.stopPropagation();openSessionModal('${g.code}','${s.id}')">${icon('pencil', 14)}</button>
        </span>
      </div>
    </div>`;
}
function openSessionModal(code, sid, prefill = {}) {
  const g = findGroup(code);
  if (!g) return;
  const s = sid ? g.sessions[sid] : null;
  const later = s?.seriesId ? sessionList(g).filter(x => x.seriesId === s.seriesId && x.date > s.date).length : 0;
  const v = {
    title: s?.title ?? prefill.title ?? '', date: s?.date ?? prefill.date ?? todayIso(),
    start: s?.start ?? prefill.start ?? '17:00', end: s?.end ?? prefill.end ?? '18:30',
    where: s?.where ?? '', notes: s?.notes ?? '',
  };
  openModal(`
    <div class="modal-head"><h3>${s ? 'Edit session' : 'New study session'}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body">
      <div class="field"><label for="ss-title">What are you working on?</label><input class="input" id="ss-title" value="${esc(v.title)}" maxlength="120" placeholder="Midterm review, problem set 4…"></div>
      <div class="field-row">
        <div class="field"><label for="ss-date">Date</label><input class="input" type="date" id="ss-date" value="${esc(v.date)}"></div>
        <div class="field"><label for="ss-start">Start</label><input class="input" type="time" id="ss-start" value="${esc(v.start)}"></div>
        <div class="field"><label for="ss-end">End</label><input class="input" type="time" id="ss-end" value="${esc(v.end)}"></div>
      </div>
      <div class="field"><label for="ss-where">Where</label><input class="input" id="ss-where" value="${esc(v.where)}" maxlength="300" placeholder="Library room 204, or paste a Zoom / Meet link"></div>
      <div class="field"><label for="ss-notes">Agenda or notes <span class="muted">(optional)</span></label><textarea class="input" id="ss-notes" maxlength="1000" placeholder="Bring your chapter 5 problems…">${esc(v.notes)}</textarea></div>
      ${!s ? `<div class="field-row" style="align-items:center"><label class="checkbox-row small" style="margin:0"><input type="checkbox" id="ss-repeat" onchange="$('#ss-weeks').disabled=!this.checked"><span>Repeat weekly for</span></label><select class="select" id="ss-weeks" style="max-width:110px" disabled aria-label="How many weeks">${SESSION_REPEAT_WEEKS.map(n => `<option value="${n}" ${n === 6 ? 'selected' : ''}>${n} weeks</option>`).join('')}</select></div>` : ''}
      ${s && later > 0 ? `<label class="checkbox-row small"><input type="checkbox" id="ss-series"><span>Also update the ${later} later session${later === 1 ? '' : 's'} in this weekly series (they keep their dates)</span></label>` : ''}
      ${!s ? `<p class="small muted mt-8">Everyone in ${esc(g.name)} will see this on their calendar and can RSVP.</p>` : ''}
    </div>
    <div class="modal-foot">
      ${s ? `<button class="btn btn-danger" style="margin-right:auto" onclick="deleteSession('${code}','${sid}')">Delete</button>` : ''}
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveSession('${code}','${sid || ''}')">${s ? 'Save' : 'Schedule'}</button>
    </div>
  `);
  setTimeout(() => { const el = $('#ss-title'); if (el && !el.value) el.focus(); }, 60);
}
async function saveSession(code, sid) {
  const title = $('#ss-title').value.trim();
  const date = $('#ss-date').value;
  const start = $('#ss-start').value, end = $('#ss-end').value;
  if (!title) { toast('Give the session a title', 'error'); return; }
  if (!date) { toast('Pick a date', 'error'); return; }
  if (start && end && end <= start) { toast('The end time needs to be after the start time', 'error'); return; }
  const g = findGroup(code);
  const u = myUidFor(g);
  const fields = { title, date, start, end: start ? end : '', where: $('#ss-where').value.trim(), notes: $('#ss-notes').value.trim() };
  const applySeries = !!$('#ss-series')?.checked;
  closeModal();
  if (sid) {
    const ops = Object.fromEntries(Object.entries(fields).map(([k, val]) => [`sessions.${sid}.${k}`, val]));
    const cur = g.sessions[sid];
    // The rest of a weekly series moves with this one (new time, new room,
    // new agenda), but each later session keeps its own date.
    const later = applySeries && cur?.seriesId ? sessionList(g).filter(x => x.seriesId === cur.seriesId && x.date > cur.date) : [];
    later.forEach(x => Object.entries(fields).forEach(([k, val]) => { if (k !== 'date') ops[`sessions.${x.id}.${k}`] = val; }));
    if (await groupWrite(code, ops)) toast(later.length ? `Updated this and ${later.length} later session${later.length === 1 ? '' : 's'}` : 'Session updated');
  } else {
    const weeks = $('#ss-repeat')?.checked ? Number($('#ss-weeks')?.value) || 1 : 1;
    const seriesId = weeks > 1 ? uid() : null;
    const ops = {};
    for (let i = 0; i < weeks; i++) {
      const id = uid();
      ops[`sessions.${id}`] = { id, ...fields, date: addDays(date, i * 7), seriesId, createdBy: u, createdByName: myGroupName(), createdAt: Date.now(), rsvp: { [u]: 'yes' } };
    }
    if (await groupWrite(code, ops)) toast(weeks > 1 ? `Scheduled ${weeks} weekly sessions. They’re on everyone’s calendar now.` : 'Scheduled. It’s on everyone’s calendar now.');
  }
}
function deleteSession(code, sid) {
  const g = findGroup(code);
  const s = g?.sessions?.[sid];
  if (!s) return;
  const series = s.seriesId ? sessionList(g).filter(x => x.seriesId === s.seriesId && x.date >= s.date) : [];
  if (series.length <= 1) { confirmDialog('Delete this session for everyone in the group?', () => removeGroupSessions(code, [sid])); return; }
  openModal(`
    <div class="modal-body" style="padding-top:22px"><p style="font-size:14px">Delete “${esc(s.title)}” on ${esc(fmtDate(s.date))}? It comes off everyone’s calendar.</p></div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="removeGroupSessions('${code}',${JSON.stringify(series.map(x => x.id)).replace(/"/g, '&quot;')})">This and ${series.length - 1} after</button>
      <button class="btn btn-danger" onclick="removeGroupSessions('${code}',['${sid}'])">Just this one</button>
    </div>
  `);
}
async function removeGroupSessions(code, ids) {
  const ops = {};
  ids.filter(safeId).forEach(id => { ops[`sessions.${id}`] = GW_DELETE; });
  closeModal();
  if (await groupWrite(code, ops)) toast(ids.length > 1 ? `Deleted ${ids.length} sessions` : 'Session deleted');
}
function downloadSessionIcs(code, sid) {
  const g = findGroup(code);
  if (!g) return;
  const list = sid ? [g.sessions?.[sid]].filter(Boolean) : upcomingSessions(g);
  if (!list.length) return;
  const dt = (date, t) => date.replace(/-/g, '') + (t ? 'T' + t.replace(':', '') + '00' : '');
  const icsText = (v) => String(v || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Semester HQ//Study Groups//EN'];
  list.forEach(s => lines.push(
    'BEGIN:VEVENT',
    `UID:${s.id}-${code}@semester-hq.com`,
    `DTSTAMP:${stamp}`,
    s.start ? `DTSTART:${dt(s.date, s.start)}` : `DTSTART;VALUE=DATE:${dt(s.date)}`,
    s.start ? `DTEND:${dt(s.date, s.end || addMinutesHHMM(s.start, 60))}` : `DTEND;VALUE=DATE:${dt(addDays(s.date, 1))}`,
    `SUMMARY:${icsText(`${s.title} (${g.name})`)}`,
    ...(s.where ? [`LOCATION:${icsText(s.where)}`] : []),
    ...(s.notes ? [`DESCRIPTION:${icsText(s.notes)}`] : []),
    'END:VEVENT',
  ));
  lines.push('END:VCALENDAR');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  a.download = `${(sid ? list[0].title : g.name).replace(/[^\w\- ]+/g, '').trim() || 'study-sessions'}.ics`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
