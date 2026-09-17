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
  if (typeof groupSessionsOnDate === 'function') groupSessionsOnDate(t).forEach(s => out.push(item('Today', s.title, `${s.groupName}${s.start ? ` · ${fmtTime(s.start)}` : ''}`, `openGroup('${s.code}','schedule')`, '#6b6b6b')));
  if (typeof orgEventsOnDate === 'function') {
    orgEventsOnDate(t).forEach(e => out.push(item('Today', e.title, `${e.orgName}${e.start ? ` · ${fmtTime(e.start)}` : ''}${e.required ? ' · required' : ''}`, e.action, e.color)));
    allOrgs().forEach(o => { const n = orgUnreadCount(o); if (n) out.push(item('Today', `${n} new announcement${n === 1 ? '' : 's'}`, o.name, `openOrg('${o.code}','announcements')`, orgColor(o))); });
  }
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
          ${list.map(i => `<button class="headsup-row" style="--course:${esc(i.color || '#8a8a8a')}" onclick="closeModal();setTimeout(()=>{${i.action}},200)"><span class="dash-tl-bar"></span><span class="dash-tl-body"><span class="dash-tl-title">${esc(i.title)}</span><span class="dash-tl-sub">${esc(i.sub)}</span></span>${icon('chevron-right', 13, 2)}</button>`).join('')}
        </div>`).join('') : `<div class="dash-clear">${icon('cloud-sun', 20, 1.5)}<span>Nothing needs your attention right now.</span></div>`}
    </div>
  `);
}
