/* ── Study Groups: the Sessions tab and the session sheet ────────
   RSVPs, the next-session hero, the Sessions tab, sessionCard, the
   details sheet, new/edit/delete and calendar files. Moved out of
   js/studygroups.js as is; every name stays global. Loaded after
   js/groups/home.js and before js/studygroups.js.

   Before, during, after (Tier A item 7). Phases come from eventTimeState
   (js/spaces/eventcard.js); sessionIsPast (js/groups/sync.js) is its
   'after'.
     Before: the hero's countdown chip, spaceWhenChip on rows for today
       and tomorrow, and agenda chips in the session dialog that add a
       line to the existing notes field (SESSION_AGENDA_LINES).
     Now: the hero's Happening now strip and big Join call, the row chip.
     After: a recap is an ordinary Files note (kind 'note') titled
       sessionRecapTitle(s), "Recap: Midterm 2 review, Sep 29", written
       through addGroupItem (the existing items create rule). Recaps are
       found by that exact title, so a renamed session loses its match.
       sessionRecaps(g, s) -> the matching notes, newest first.
       openSessionRecapModal(code, sid, back) / saveSessionRecap(code, sid,
       back): the "What did we cover?" dialog; back reopens the sheet.
       groupRecapPrompt(g) -> the home's "just ended" card, or ''.
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
function groupFacePile(g, s, { size = 26, zero = true, past = false } = {}) {
  const who = sessionRsvpPeople(g, s);
  return spaceFacePile({
    people: who.yes, meUid: myUidFor(g), size, colorOf: (uid) => personColor(g, uid), verb: past ? 'said' : 'going',
    zeroText: past ? 'No one said they’d go' : zero ? 'Be the first to say you’re going' : '0 going',
    detail: !past && who.maybe.length ? `${who.maybe.length} maybe` : '',
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
    facesHtml: groupFacePile(g, s, { size: 24, past }),
    recapHtml: sessionRecapBlock(g, s, { back: true }),
    // Join and Share to chat stay out; Add to calendar app goes in the
    // sheet's ··· menu (spaceEventSheet). Edit sits in the footer, between
    // Delete and Done, the same as a club event sheet.
    actionsHtml: past ? '' : `${joinLinkButton(s.where)}${chatShareButton('group', g.code, s.id)}<button class="btn btn-ghost btn-sm" onclick="downloadSessionIcs('${g.code}','${s.id}')">${icon('download', 14)} Add to calendar app</button>`,
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
// The home's hero. An unanswered RSVP control is the ask on its own: no
// "Needs your answer" badge, the same as club rows.
function nextSessionHero(g, s) {
  // The countdown chip (or the Happening now strip) carries the when.
  return spaceEventHero({
    date: s.date, start: s.start, end: s.end, where: s.where, notes: s.notes,
    eyebrow: eventTimeState(s).phase === 'now' ? 'In session' : 'Next session',
    tags: s.seriesId ? spaceTag('weekly', 'Weekly') : '',
    title: s.title,
    onOpen: `showGroupSessionModal('${g.code}','${s.id}')`,
    rsvpHtml: rsvpControl(g, s, { size: 'hero', stillComing: true }),
    facesHtml: groupFacePile(g, s, { past: sessionIsPast(s) }),
    afterHtml: sessionRecapBlock(g, s),
    actionsHtml: sessionIsPast(s) ? '' : `<button class="btn btn-ghost btn-sm sg-ics" onclick="downloadSessionIcs('${g.code}','${s.id}')">${icon('download', 14)} Add to calendar app</button>`,
    className: 'sg-next-hero',
  });
}
/* ── The Sessions tab ──────────────────────────────────────────────
   Upcoming | Past, a ··· menu (Add all to calendar app, Find a time) and
   New session. Sessions are grouped by week under serif headings that
   stick below the tab row ("This week", "Next week", "Oct 12 to 18"),
   each week one flat card of rows, like the club Calendar. Past runs
   newest first, and each row shows its recap or "Add a recap".
   At 1240px and up a sticky 380px panel beside the list shows the picked
   session as a hero (the next one, or the latest past one, by default);
   a row then picks instead of opening the sheet, and the panel's title
   opens the sheet. Per visit, in memory only (no settings key):
   _sgSched = { code, view: 'upcoming' | 'past', pick: session id }. */
const SG_SCHED_WIDE = '(min-width: 1240px)';
const SG_SCHED_PAST_MAX = 40;
let _sgSched = { code: '', view: 'upcoming', pick: '' };
function sgSchedState(code) {
  if (_sgSched.code !== code) _sgSched = { code, view: 'upcoming', pick: '' };
  return _sgSched;
}
function sgSchedWide() { try { return window.matchMedia(SG_SCHED_WIDE).matches; } catch { return false; } }
function setGroupSchedView(code, view) {
  const st = sgSchedState(code);
  st.view = view === 'past' ? 'past' : 'upcoming';
  st.pick = '';
  render();
}
// A row's title (or a click on the row): the panel on a wide screen, the
// sheet everywhere else.
function pickGroupSession(code, sid) {
  if (!sgSchedWide() || state.route !== 'studygroups' || state.groupTab !== 'schedule' || !findGroup(code)?.sessions?.[sid]) { showGroupSessionModal(code, sid); return; }
  sgSchedState(code).pick = sid;
  render();
}
// "Add a recap" on a past row: the session's sheet, on its recap field.
function openSessionRecapFromRow(code, sid) {
  showGroupSessionModal(code, sid);
  setTimeout(() => { const f = $('#modal .space-sheet-recap .space-recap-field'); if (f) { f.focus({ preventScroll: true }); f.scrollIntoView({ block: 'nearest' }); } }, 80);
}
function openGroupSchedMenu(btn, code) {
  const g = findGroup(code);
  if (!g) return;
  const any = upcomingSessions(g).length > 0;
  openMenu(btn, `
    <button class="menu-item" ${any ? '' : 'disabled'} onclick="downloadSessionIcs('${code}')">${icon('download', 16)}<span>Add all to calendar app</span></button>
    <button class="menu-item" onclick="setGroupTab('availability')">${icon('grid', 16)}<span>Find a time</span></button>`);
}
// "This week", "Next week", "Last week", else "Oct 12 to 18" (or
// "Sep 27 to Oct 3" across a month, with the year when it isn't this one).
function sgWeekLabel(weekIso) {
  const days = Math.round((new Date(`${weekIso}T00:00:00`) - new Date(`${startOfWeek(todayIso())}T00:00:00`)) / 86400000);
  const w = Math.round(days / 7);
  if (w === 0) return 'This week';
  if (w === 1) return 'Next week';
  if (w === -1) return 'Last week';
  const a = new Date(`${weekIso}T00:00:00`), b = new Date(`${addDays(weekIso, 6)}T00:00:00`);
  const mon = (d) => d.toLocaleDateString('en-US', { month: 'short' });
  const year = b.getFullYear() !== new Date().getFullYear() ? `, ${b.getFullYear()}` : '';
  return `${mon(a)} ${a.getDate()} to ${a.getMonth() === b.getMonth() ? '' : `${mon(b)} `}${b.getDate()}${year}`;
}
function sgSessionWeeks(list) {
  const weeks = [];
  list.forEach(s => {
    const key = startOfWeek(s.date);
    let w = weeks[weeks.length - 1];
    if (!w || w.key !== key) weeks.push(w = { key, items: [] });
    w.items.push(s);
  });
  return weeks;
}
function groupScheduleTab(g) {
  const st = sgSchedState(g.code);
  const upcoming = upcomingSessions(g);
  const pastAll = sessionList(g).filter(sessionIsPast).reverse();
  const past = st.view === 'past';
  const list = past ? pastAll.slice(0, SG_SCHED_PAST_MAX) : upcoming;
  if (!list.some(s => s.id === st.pick)) st.pick = list[0]?.id || '';
  const picked = list.find(s => s.id === st.pick);
  const views = [['upcoming', 'Upcoming', upcoming.length], ['past', 'Past', pastAll.length]].map(([k, label, n]) =>
    `<button type="button" aria-pressed="${st.view === k}" onclick="setGroupSchedView('${g.code}','${k}')">${label}${n ? `<span class="sg-sched-n">${n}</span>` : ''}</button>`).join('');
  const body = list.length
    ? sgSessionWeeks(list).map(w => `
      <section class="sg-sched-week" aria-labelledby="sg-wk-${w.key}">
        <h3 class="sg-sched-weekh" id="sg-wk-${w.key}">${esc(sgWeekLabel(w.key))}</h3>
        <div class="card sg-sessions">${w.items.map(s => sessionCard(g, s, { past, picked: s.id === st.pick })).join('')}</div>
      </section>`).join('')
    : past
      ? `<div class="card card-pad sg-sched-none"><p>No past sessions yet. After each one, its recap lives here.</p></div>`
      : `<div class="card card-pad sg-sched-none"><p>Nothing scheduled yet. Find a time shows when everyone is free.</p><div class="sg-sched-none-actions"><button class="btn btn-sm" onclick="setGroupTab('availability')">${icon('grid', 14)} Find a time</button><button class="btn btn-primary btn-sm" onclick="openSessionModal('${g.code}')">${icon('plus', 14)} Schedule one</button></div></div>`;
  return `
    <div class="sg-sched">
      <div class="sg-sched-bar">
        <div class="segmented sg-sched-views" role="group" aria-label="Show sessions">${views}</div>
        <div class="sg-sched-bar-end">
          <button type="button" class="btn btn-ghost btn-sm btn-icon sg-sched-more" aria-label="Session options" aria-haspopup="menu" aria-expanded="false" onclick="openGroupSchedMenu(this,'${g.code}')">${icon('more-horizontal', 16)}</button>
          <button type="button" class="btn btn-primary btn-sm sg-new-session" onclick="openSessionModal('${g.code}')">${icon('plus', 14)} New session</button>
        </div>
      </div>
      <div class="sg-sched-body${picked ? ' has-panel' : ''}">
        <div class="sg-sched-list">${body}</div>
        ${picked ? `<aside class="sg-sched-panel" aria-label="${esc(`Picked session: ${picked.title}`)}">${sessionPanelHero(g, picked, { next: !past && picked.id === upcoming[0]?.id})}</aside>` : ''}
      </div>
      <p class="sg-sched-foot">Sessions show up on every member’s Semester HQ calendar.</p>
    </div>`;
}
// The panel: the event hero for the picked session.
function sessionPanelHero(g, s, { next = false } = {}) {
  const phase = eventTimeState(s).phase;
  const past = phase === 'after';
  return spaceEventHero({
    date: s.date, start: s.start, end: s.end, where: s.where, notes: s.notes,
    eyebrow: phase === 'now' ? 'In session' : past ? 'Past session' : next ? 'Next session' : 'Session',
    tags: s.seriesId ? spaceTag('weekly', 'Weekly') : '',
    title: s.title,
    onOpen: `showGroupSessionModal('${g.code}','${s.id}')`,
    rsvpHtml: past ? '' : rsvpControl(g, s, { size: 'hero', stillComing: true }),
    facesHtml: groupFacePile(g, s, { past }),
    afterHtml: sessionRecapBlock(g, s),
    className: 'sg-panel-hero',
  });
}
// One session as an agenda row: date tile, title, a meta line, then
// Needs your answer, Weekly and who's going; the compact RSVP at the end.
// Past rows carry their recap (two lines) or "Add a recap" instead.
// The title is the row's one tab stop; the rest of the row is a mouse-only
// click, as in spaceAgendaRow. Edit and Add to calendar app live in the
// session sheet's ··· menu.
let _sgSessionRowSeq = 0;
function sessionCard(g, s, { past = false, picked = false } = {}) {
  const id = `sg-sess-${++_sgSessionRowSeq}`;
  const open = `pickGroupSession('${g.code}','${s.id}')`;
  const going = sessionRsvpPeople(g, s).yes.length;
  const range = _evTimeRange(s.start, s.end) || 'Any time';
  const meta = [
    esc(past ? fmtDate(s.date, { weekday: 'long' }) : fmtSessionDay(s.date)),
    esc(range),
    s.where ? esc(groupWhereShort(s.where)) : '',
    past && going ? `${going} said they’d go` : '',
  ].filter(Boolean).join(' · ');
  const tags = past ? (s.seriesId ? spaceTag('weekly', 'Weekly') : '') : [
    spaceWhenChip(s),
    s.seriesId ? spaceTag('weekly', 'Weekly') : '',
    going ? groupFacePile(g, s, { size: 20 }) : '',
  ].join('');
  const describedBy = [`${id}-d`, `${id}-m`, tags ? `${id}-t` : ''].filter(Boolean).join(' ');
  return `
    <div class="space-agenda-row sg-session${past ? ' is-past' : ''}${picked ? ' is-picked' : ''}" data-row-click tabindex="-1" onclick="${open}">
      ${spaceDateBlock(s.date, { size: 'tile', id: `${id}-d` })}
      <div class="space-agenda-main">
        <button type="button" class="space-agenda-title" onclick="event.stopPropagation();${open}" aria-describedby="${describedBy}"${picked ? ' aria-current="true"' : ''}>${esc(s.title)}</button>
        <div class="space-agenda-meta" id="${id}-m">${meta}</div>
        ${tags ? `<div class="space-agenda-tags" id="${id}-t">${tags}</div>` : ''}
        ${past ? sessionRecapSnippet(g, s) : ''}
      </div>
      ${past ? '' : `<div class="space-agenda-end sg-session-end" onclick="event.stopPropagation()">${rsvpControl(g, s)}</div>`}
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
      <div class="field"><label for="ss-notes">Agenda or notes <span class="muted">(optional)</span></label><textarea class="input" id="ss-notes" maxlength="1000" placeholder="Bring your chapter 5 problems…" oninput="syncSessionAgendaChips()">${esc(v.notes)}</textarea>
        <div class="sg-agenda-chips" role="group" aria-label="Add a line to the agenda"><span class="sg-agenda-chips-label">Add to the agenda</span>${SESSION_AGENDA_LINES.map((l, i) => `<button type="button" class="chip" data-agenda="${i}" aria-pressed="${sessionNotesHave(v.notes, l)}" onclick="addSessionAgendaLine(${i})">${icon('plus', 12)} ${esc(l)}</button>`).join('')}</div>
      </div>
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

/* ── Before: agenda lines ──────────────────────────────────────── */
// A one-tap agenda. Each chip adds its line to the notes (the field the
// session already has, 1000 characters at most); tapping it again takes
// the line back out.
const SESSION_AGENDA_LINES = ['Quiz each other', 'Explain the hard one', 'Plan next steps'];
function sessionNotesHave(notes, line) { return String(notes || '').split('\n').some(x => x.trim() === line); }
function addSessionAgendaLine(i) {
  const el = $('#ss-notes');
  const line = SESSION_AGENDA_LINES[i];
  if (!el || !line) return;
  if (sessionNotesHave(el.value, line)) {
    el.value = el.value.split('\n').filter(x => x.trim() !== line).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  } else {
    const next = `${el.value.replace(/\s+$/, '')}${el.value.trim() ? '\n' : ''}${line}`;
    if (next.length > 1000) { toast('The notes are full. Trim them to add this.', 'error'); return; }
    el.value = next;
  }
  syncSessionAgendaChips();
}
function syncSessionAgendaChips() {
  const v = $('#ss-notes')?.value || '';
  $$('#modal .sg-agenda-chips [data-agenda]').forEach(b => b.setAttribute('aria-pressed', String(sessionNotesHave(v, SESSION_AGENDA_LINES[+b.dataset.agenda]))));
}

/* ── After: recaps ─────────────────────────────────────────────── */
const SESSION_RECAP_MAX = 2000;
function sessionRecapTitle(s) { return `Recap: ${s.title}, ${fmtDate(s.date, { month: 'short', day: 'numeric' })}`; }
function sessionRecaps(g, s) {
  const t = sessionRecapTitle(s);
  return groupItems(g).filter(it => it.kind === 'note' && it.title === t);
}
function _sessionRecapBy(g, it) {
  const me = it.sharedByUid === myUidFor(g);
  return `${me ? 'You' : esc(String(it.sharedBy || 'Someone').split(' ')[0])}${it.sharedAt ? ` · ${esc(fmtDate(_evIso(new Date(it.sharedAt)), { month: 'short', day: 'numeric' }))}` : ''}`;
}
// Past rows: the newest recap in two lines, or a quiet Add a recap.
function sessionRecapSnippet(g, s) {
  const list = sessionRecaps(g, s);
  if (!list.length) return `<button type="button" class="sg-link sg-recap-add" onclick="event.stopPropagation();openSessionRecapFromRow('${g.code}','${s.id}')">${icon('pencil', 12)} Add a recap</button>`;
  const text = spaceRecapText(list[0].content);
  const by = `Recap by ${_sessionRecapBy(g, list[0])}${list.length > 1 ? ` and ${list.length - 1} more` : ''}`;
  return `<p class="sg-sched-recap"><span class="sg-sched-recap-by">${by}${text ? ':' : ''}</span>${text ? ` ${esc(text)}` : ''}</p>`;
}
// The sheet (and the hero, once it ends): every recap in full, then the
// field for another. back: the field reopens this sheet after saving.
function sessionRecapBlock(g, s, { back = false } = {}) {
  const list = sessionRecaps(g, s);
  const open = `openSessionRecapModal('${g.code}','${s.id}',${back})`;
  // Saved recaps are flat text on the sheet (author and time, then the
  // body, a hairline between them); the field-shaped button only shows
  // while there is no recap yet, so nothing looks like a second, empty one.
  const notes = list.map(it => `
    <article class="sg-recap-note">
      <div class="sg-recap-note-by">${personAvatar(it.sharedByUid || '', it.sharedBy || 'Someone', 18, personColor(g, it.sharedByUid))}<span>${_sessionRecapBy(g, it)}</span></div>
      <div class="space-recap-note-body">${sanitizeHtml(String(it.content || ''))}</div>
    </article>`).join('');
  return `
    <div class="space-recap sg-recap${list.length ? ' has-notes' : ''}">
      <div class="space-recap-head"><span class="sg-h3">${list.length ? 'Recap' : 'What did we cover?'}</span><span class="small muted">Saved to Files</span></div>
      ${list.length ? `<div class="sg-recap-notes">${notes}</div><button type="button" class="sg-link sg-recap-more" onclick="${open}">${icon('plus', 14)} Add to the recap</button>` : spaceRecapField(open, 'A few lines for anyone who missed it')}
    </div>`;
}
function openSessionRecapModal(code, sid, back = false) {
  const g = findGroup(code);
  const s = g?.sessions?.[sid];
  if (!s || !safeId(sid)) return;
  const cancel = back ? `showGroupSessionModal('${g.code}','${s.id}')` : 'closeModal()';
  openModal(`
    <div class="modal-head"><h3>What did we cover?</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body">
      <p class="small muted sg-recap-for">${esc(s.title)} · ${esc(fmtDate(s.date, { weekday: 'short', month: 'short', day: 'numeric' }))}</p>
      <div class="field"><label for="sr-text" class="sr-only">What did we cover?</label><textarea class="input sg-recap-input" id="sr-text" rows="3" maxlength="${SESSION_RECAP_MAX}" placeholder="Went through enzyme inhibitors, quizzed each other on chapter 8. Next time: the practice exam."></textarea></div>
      <p class="small muted">It saves to Files as “${esc(sessionRecapTitle(s))}”, so everyone in ${esc(g.name)} can read it.</p>
    </div>
    <div class="modal-foot"><button class="btn" onclick="${cancel}">Cancel</button><button class="btn btn-primary" id="sr-save" onclick="saveSessionRecap('${g.code}','${s.id}',${!!back})">${icon('check', 14)} Save to Files</button></div>
  `);
  setTimeout(() => $('#sr-text')?.focus(), 60);
}
async function saveSessionRecap(code, sid, back = false) {
  const g = findGroup(code);
  const s = g?.sessions?.[sid];
  const text = ($('#sr-text')?.value || '').trim().slice(0, SESSION_RECAP_MAX);
  if (!s) return;
  if (!text) { toast('Write a line or two first', 'error'); return; }
  const btn = $('#sr-save');
  setBtnLoading(btn, true);
  const ok = await addGroupItem(code, { kind: 'note', title: sessionRecapTitle(s), content: `<p>${esc(text).replace(/\n/g, '<br>')}</p>` });
  if (!ok) { setBtnLoading(btn, false, 'Save to Files'); return; }
  toast('Recap saved to Files');
  if (back) showGroupSessionModal(code, sid); else closeModal();
  renderPreservingInput();
}
// The home's "just ended" card: the last session you said you'd go to (or
// made), for 18 hours after it ends, until someone writes a recap or you
// say Not now on this device.
function groupRecapPrompt(g) {
  const u = myUidFor(g);
  const s = sessionList(g).filter(x => sessionIsPast(x) && spaceRecentlyEnded(x)).pop();
  if (!s || !(s.rsvp?.[u] === 'yes' || s.createdBy === u)) return '';
  const key = `group:${g.code}:${s.id}`;
  if (sessionRecaps(g, s).length || spaceRecapDismissed(key)) return '';
  return spaceRecapCard({
    date: s.date, start: s.start, end: s.end, title: s.title,
    facesHtml: groupFacePile(g, s, { size: 22, past: true }),
    bodyHtml: `${spaceRecapField(`openSessionRecapModal('${g.code}','${s.id}')`)}<p class="space-recap-hint">It saves to Files, so anyone who missed it can catch up.</p>`,
    // Not now takes the card away: focus goes to the hero's title.
    dismissJs: `sgFocusAfter(['.sg-next-hero .space-hero-title','.sg-besthero .btn-primary','.sg-next-empty .btn-primary'],'.sg-home .space-recap-card');spaceRecapDismiss('${key}')`,
  });
}
