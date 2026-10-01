/* ── Heads up ───────────────────────────────────────────────────────
   What needs attention right now, gathered from everywhere in the planner
   (overdue and due-today work, to-dos, exams coming up, study group
   sessions, club events, project milestones, application deadlines,
   flashcards due) and shown in the app behind the bell in the header.

   Semester HQ does not send notifications. There is no browser permission
   prompt, no push subscription, no background delivery: the planner never
   interrupts you, and nothing about your schedule leaves the app to get
   somewhere it could buzz a phone. You see what's due when you come look.
──────────────────────────────────────────────────────────────── */
/* ── What needs attention ──────────────────────────────────────── */
function attentionItems() {
  const t = todayIso(), tomorrow = addDays(t, 1);
  const inScope = (a) => !a.courseId || activeCourses().some(c => c.id === a.courseId);
  const open = state.assignments.filter(a => !isAssignmentDone(a) && inScope(a));
  const item = (group, title, sub, action, color) => ({ group, title, sub, action, color });
  const out = [];
  open.filter(a => a.dueDate && a.dueDate < t).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .forEach(a => out.push(item('Overdue', a.title, `${getCourse(a.courseId)?.code || ''} · was due ${fmtSessionDay(a.dueDate)}`, `openAssignmentModal('${a.id}')`, getCourseColor(a.courseId))));
  state.todos.filter(td => !td.done && td.dueDate && td.dueDate < t)
    .forEach(td => out.push(item('Overdue', td.title, `To-do · was due ${fmtSessionDay(td.dueDate)}`, `openTodoModal('${td.id}')`, getCourseColor(td.courseId))));
  open.filter(a => a.dueDate === t).sort((a, b) => (a.dueTime || '').localeCompare(b.dueTime || ''))
    .forEach(a => out.push(item('Today', a.title, `${getCourse(a.courseId)?.code || ''} · ${a.dueTime && a.dueTime !== '23:59' ? `due ${fmtTime(a.dueTime)}` : 'due tonight'}`, `openAssignmentModal('${a.id}')`, getCourseColor(a.courseId))));
  state.todos.filter(td => !td.done && td.dueDate === t)
    .forEach(td => out.push(item('Today', td.title, 'To-do', `openTodoModal('${td.id}')`, getCourseColor(td.courseId))));
  // Today's sessions and events you said yes to ask "Still coming?" right
  // here (js/spaces/rsvp.js), until you answer it once on this device.
  const still = (x) => typeof spaceStillComingDue === 'function' && spaceStillComingDue(x.rsvpKind, x.code, x.id, x, x.mine) ? { kind: x.rsvpKind, code: x.code, id: x.id } : null;
  // A session or required event you haven't answered says so on its row
  // instead of getting a second one. needs is the same list as each
  // space's "What needs you" strip (js/spaces/needs.js).
  const needs = typeof spaceNeedsAll === 'function' ? spaceNeedsAll() : [];
  const asking = new Set(needs.filter(n => n.type === 'session' || n.type === 'event').map(n => `${n.space.code}:${n.id}`));
  const ask = (x) => asking.has(`${x.code}:${x.id}`) ? ' · needs your RSVP' : '';
  if (typeof groupSessionsOnDate === 'function') groupSessionsOnDate(t).forEach(s => out.push({ ...item('Today', s.title, `${s.groupName}${s.start ? ` · ${fmtTime(s.start)}` : ''}${ask(s)}`, s.action, s.color), prompt: still(s) }));
  if (typeof orgEventsOnDate === 'function') {
    orgEventsOnDate(t).forEach(e => out.push({ ...item('Today', e.title, `${e.orgName}${e.start ? ` · ${fmtTime(e.start)}` : ''}${e.required ? ' · required' : ''}${ask(e)}`, e.action, e.color), prompt: still(e) }));
    allOrgs().forEach(o => {
      const n = orgUnreadCount(o);
      if (!n) return;
      const seen = orgSeen()[o.code] || 0;
      const pinned = orgAnnouncementList(o).some(a => a.pinned && (a.at || 0) > seen && a.uid !== myOrgUid(o));
      const title = pinned ? (n === 1 ? 'Pinned announcement' : `Pinned announcement and ${n - 1} more`) : `${n} new announcement${n === 1 ? '' : 's'}`;
      out.push(item('Today', title, o.name, `openOrg('${o.code}','announcements')`, orgColor(o)));
    });
  }
  // Group tasks assigned to you (overdue by two weeks at most) and, from
  // tomorrow on, the sessions and required events you haven't answered:
  // the same list as each space's "What needs you" strip. Tasks nobody has
  // taken and "Add your availability" stay on the strip.
  needs.forEach(n => {
    const sp = n.space;
    if (n.type === 'task') {
      const group = n.date < t ? 'Overdue' : n.date === t ? 'Today' : n.date === tomorrow ? 'Tomorrow' : 'Coming up';
      out.push(item(group, n.title, `${sp.name} · ${n.date < t ? `was due ${fmtSessionDay(n.date)}` : n.date === t ? 'due today' : `due ${fmtSessionDay(n.date)}`}`, `openGroup('${sp.code}','tasks')`, sp.color));
    } else if ((n.type === 'session' || n.type === 'event') && n.date > t && !(n.type === 'event' && sp.hideCalendar)) {
      const action = n.type === 'session' ? `showGroupSessionModal('${sp.code}','${n.id}')` : `openOrgEvent('${sp.code}','${n.id}')`;
      out.push(item(n.date === tomorrow ? 'Tomorrow' : 'Coming up', n.title, `${sp.name} · ${fmtSessionDay(n.date)}${n.start ? ` ${fmtTime(n.start)}` : ''}${n.type === 'event' ? ' · required' : ''} · needs your RSVP`, action, sp.color));
    } else if (n.type === 'form') {
      // An open form you haven't answered: Today when it closes today.
      const closesToday = n.closesAt && new Date(n.closesAt).toDateString() === new Date().toDateString();
      out.push(item(closesToday ? 'Today' : 'Coming up', n.title, `${sp.name} · form to answer${n.closesAt ? ` · ${formClosesLabel({ closesAt: n.closesAt }).replace(/^C/, 'c')}` : ''}`, `openFormFill('${sp.kind}','${sp.code}','${n.id}')`, sp.color));
    }
  });
  milestoneDueItems(t, t).forEach(({ p, m }) => out.push(item('Today', m.title, `Milestone · ${p.title}`, `openProject('${p.id}')`, projectColor(p))));
  milestoneDueItems(addDays(t, -60), addDays(t, -1)).forEach(({ p, m }) => out.push(item('Overdue', m.title, `Milestone · ${p.title} · was due ${fmtSessionDay(m.dueDate)}`, `openProject('${p.id}')`, projectColor(p))));
  open.filter(a => a.dueDate === tomorrow)
    .forEach(a => out.push(item('Tomorrow', a.title, `${getCourse(a.courseId)?.code || ''} · ${a.type}`, `openAssignmentModal('${a.id}')`, getCourseColor(a.courseId))));
  open.filter(a => a.type === 'exam' && a.dueDate > tomorrow && daysBetween(a.dueDate) <= 7)
    .forEach(a => out.push(item('Coming up', a.title, `${getCourse(a.courseId)?.code || ''} · exam in ${daysBetween(a.dueDate)} days${examPrep(a) != null ? ` · ${examPrep(a)}% prepped` : ''}`, `openExamPrep('${a.id}')`, getCourseColor(a.courseId))));
  open.filter(a => a.startByDate && a.startByDate <= t && a.dueDate > tomorrow)
    .forEach(a => out.push(item('Coming up', a.title, `Time to start · due ${fmtSessionDay(a.dueDate)}`, `openAssignmentModal('${a.id}')`, getCourseColor(a.courseId))));
  applications().filter(a => a.stage === 'saved' && a.deadline && a.deadline < t)
    .forEach(a => out.push(item('Overdue', `Apply: ${a.org}`, `${a.type} · deadline was ${fmtSessionDay(a.deadline)}`, `openApplicationModal('${a.id}')`, '#6b6b6b')));
  appDueItems(t, addDays(t, 7)).forEach(i => out.push(item(i.date === t ? 'Today' : i.date === tomorrow ? 'Tomorrow' : 'Coming up', i.label, `${i.app.type} · ${fmtSessionDay(i.date)}${i.time ? ` ${fmtTime(i.time)}` : ''}`, `openApplicationModal('${i.app.id}')`, '#6b6b6b')));
  const cards = typeof srsDueTotal === 'function' ? srsDueTotal() : 0;
  if (cards) out.push(item('Today', `${cards} flashcard${cards === 1 ? '' : 's'} to review`, 'Spaced repetition', 'openReview()', 'var(--accent)'));
  return out;
}
function attentionCount() {
  try { return attentionItems().filter(i => i.group === 'Overdue' || i.group === 'Today').length; } catch { return 0; }
}
function openHeadsUp() {
  const items = attentionItems();
  const groups = ['Overdue', 'Today', 'Tomorrow', 'Coming up'].map(g => [g, items.filter(i => i.group === g)]).filter(([, list]) => list.length);
  openModal(`
    <div class="modal-head"><h3>Heads up</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      ${groups.length ? groups.map(([g, list]) => `
        <div class="dash-day ${g === 'Overdue' ? 'is-overdue' : ''}">
          <div class="dash-day-label">${g}</div>
          ${list.map(i => i.prompt ? headsUpPromptRow(i) : `<button class="headsup-row" style="--course:${esc(i.color || '#8a8a8a')}" onclick="closeModal();setTimeout(()=>{${i.action}},200)"><span class="dash-tl-bar"></span><span class="dash-tl-body"><span class="dash-tl-title">${esc(i.title)}</span><span class="dash-tl-sub">${esc(i.sub)}</span></span>${icon('chevron-right', 13, 2)}</button>`).join('')}
        </div>`).join('') : `<div class="dash-clear">${icon('cloud-sun', 20, 1.5)}<span>Nothing needs your attention right now.</span></div>`}
    </div>
  `);
}
// A row that asks "Still coming?": a div holding the open button and two
// answer buttons side by side (buttons can't nest inside a button).
function headsUpPromptRow(i) {
  const p = i.prompt;
  const args = `'${p.kind}','${esc(p.code)}','${esc(p.id)}'`;
  return `<div class="headsup-row headsup-prompt" style="--course:${esc(i.color || '#8a8a8a')}">
    <button class="headsup-prompt-open" onclick="closeModal();setTimeout(()=>{${i.action}},200)"><span class="dash-tl-bar"></span><span class="dash-tl-body"><span class="dash-tl-title">${esc(i.title)}</span><span class="dash-tl-sub">${esc(i.sub)} · Still coming?</span></span></button>
    <span class="headsup-prompt-acts"><button class="btn btn-sm" onclick="event.stopPropagation();spaceStillComing(${args},true,this)">Yes</button><button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();spaceStillComing(${args},false,this)">Can’t anymore</button></span>
  </div>`;
}
