/* ── Dashboard / Home ─────────────────────────────────────────────
   Top: what's happening now or next, today's timeline, and three
   at-a-glance numbers. Below: customizable widgets in two columns.
   A semester with no classes yet gets the welcome screen instead.
──────────────────────────────────────────────────────────────── */
function toggleTodayMode() { state.todayMode = !state.todayMode; touch(); }

const DASH_WIDGET_DEFS = {
  dueThisWeek: { col: 'main', label: 'Due this week' },
  studyGroups: { col: 'main', label: 'Study groups: sessions, your tasks, new messages' },
  orgs: { col: 'side', label: 'Clubs & teams: events and announcements' },
  exams: { col: 'side', label: 'Exam countdown' },
  focus: { col: 'side', label: 'Focus time and weekly goal' },
  workload: { col: 'main', label: 'Two-week workload' },
  quickNote: { col: 'side', label: 'Quick note' },
  projects: { col: 'main', label: 'Active projects' },
  notes: { col: 'side', label: 'Recent notes' },
  quickAdd: { col: 'main', label: 'Quick add' },
};
const DASH_WIDGET_LABELS = Object.fromEntries(Object.entries(DASH_WIDGET_DEFS).map(([k, v]) => [k, v.label]));

function dashCourseScope(a) { return !a.courseId || activeCourses().some(c => c.id === a.courseId); }
function nowMinutes() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function fmtIn(mins) {
  if (mins < 1) return 'now';
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `in ${h}h${m ? ` ${m}m` : ''}`;
}

// Everything scheduled for today, in order: classes, time blocks, group
// sessions, then assignments due (timed ones in place, the rest at the end).
function todayTimeline() {
  const t = todayIso();
  const timed = [
    ...meetingsOnDate(t).map(m => ({ kind: 'class', start: m.start, end: m.end, title: m.course.name, sub: [m.course.code, m.course.location].filter(Boolean).join(' · '), color: m.course.color, action: `openCourse('${m.course.id}')` })),
    ...customEventsOnDate(t).filter(e => e.start).map(e => ({ kind: 'block', start: e.start, end: e.end, title: e.title, sub: e.courseId ? (getCourse(e.courseId)?.code || '') : 'Time block', color: e.color || '#5a6b7b', action: `openEventModal('${e.id}')` })),
    ...groupSessionsOnDate(t).filter(s => s.start).map(s => ({ kind: 'group', start: s.start, end: s.end, title: s.title, sub: s.groupName, color: '#6b6b6b', action: `openGroup('${s.code}','schedule')` })),
    ...orgEventsOnDate(t).filter(e => e.start).map(e => ({ kind: 'org', start: e.start, end: e.end, title: e.title, sub: e.orgName, color: e.color, action: e.action })),
    ...state.assignments.filter(a => a.dueDate === t && !isAssignmentDone(a) && dashCourseScope(a) && a.dueTime && a.dueTime !== '23:59')
      .map(a => ({ kind: 'due', start: a.dueTime, end: null, title: a.title, sub: `Due · ${getCourse(a.courseId)?.code || ''}`, color: getCourseColor(a.courseId), action: `openAssignmentModal('${a.id}')` })),
  ].sort((a, b) => a.start.localeCompare(b.start));
  const untimed = state.assignments.filter(a => a.dueDate === t && !isAssignmentDone(a) && dashCourseScope(a) && (!a.dueTime || a.dueTime === '23:59'))
    .map(a => ({ kind: 'due', start: null, end: null, title: a.title, sub: `Due tonight · ${getCourse(a.courseId)?.code || ''}`, color: getCourseColor(a.courseId), action: `openAssignmentModal('${a.id}')` }));
  return [...timed, ...untimed];
}

function pageDashboard() {
  if (state.todayMode) return pageDashboardToday();
  const name = state.settings.displayName ? `, ${esc(state.settings.displayName.split(' ')[0])}` : '';
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const sem = computeSemesterProgress();
  const sub = `${fmtDateLong(todayIso())}${sem && activeCourses().length ? ` · Week ${sem.week} of ${sem.totalWeeks}` : ''}`;
  const head = pageHead(`${greeting}${name}`, sub, `
    ${state.settings.sampleData ? `<button class="btn btn-sm" onclick="removeSampleSemester()">${icon('x', 12, 2.2)} Clear sample data</button>` : ''}
    <button class="btn btn-sm" onclick="openQuickCapture()">${icon('camera', 13, 1.8)} Capture</button>
    <button class="btn btn-sm" onclick="toggleTodayMode()">${icon('sun', 13, 2)} Focus on today</button>
    <button class="btn btn-icon btn-sm" onclick="openDashboardCustomizeModal()" title="Customize dashboard" aria-label="Customize dashboard">${icon('settings', 16, 1.6)}</button>
  `);
  if (!activeCourses().length) return `${head}${welcomeHero()}`;

  const order = (state.settings.dashboardWidgets || Object.keys(DASH_WIDGET_DEFS)).filter(id => DASH_WIDGET_DEFS[id]);
  const hidden = state.settings.hiddenWidgets || [];
  const shown = order.filter(id => !hidden.includes(id));
  const renderCol = (col) => shown.filter(id => DASH_WIDGET_DEFS[id].col === col).map(id => DASH_WIDGETS[id]()).filter(Boolean).join('');
  return `
    ${head}
    ${gettingStartedCard()}
    ${installPromptCard()}
    ${wrappedDashboardBanner()}
    ${dashHero()}
    <div class="dash-grid">
      <div class="dash-col">${renderCol('main')}</div>
      <div class="dash-col">${renderCol('side')}</div>
    </div>
  `;
}

function dashHero() {
  const t = todayIso();
  const items = todayTimeline();
  const nowMin = nowMinutes();
  const current = items.find(i => i.start && i.end && i.kind !== 'due' && toMin(i.start) <= nowMin && toMin(i.end) > nowMin);
  const upcoming = items.find(i => i.start && toMin(i.start) > nowMin);
  const nextDeadline = state.assignments.filter(a => !isAssignmentDone(a) && dashCourseScope(a) && a.dueDate && a.dueDate >= t)
    .sort((a, b) => (a.dueDate + (a.dueTime || '')).localeCompare(b.dueDate + (b.dueTime || '')))[0];

  let focus;
  if (current) focus = { eyebrow: `Happening now · until ${fmtTime(current.end)}`, item: current };
  else if (upcoming) focus = { eyebrow: `Up next · ${fmtIn(toMin(upcoming.start) - nowMin)} · ${fmtTime(upcoming.start)}`, item: upcoming };
  else if (nextDeadline) {
    const c = getCourse(nextDeadline.courseId);
    focus = { eyebrow: `Next deadline · ${relativeDay(nextDeadline.dueDate)}`, item: { title: nextDeadline.title, sub: [c?.name, nextDeadline.type].filter(Boolean).join(' · '), color: c?.color, action: `openAssignmentModal('${nextDeadline.id}')` } };
  }

  const weekEnd = addDays(t, 7);
  const dueWeek = state.assignments.filter(a => !isAssignmentDone(a) && dashCourseScope(a) && a.dueDate >= t && a.dueDate <= weekEnd);
  const overdue = state.assignments.filter(a => !isAssignmentDone(a) && dashCourseScope(a) && a.dueDate && a.dueDate < t);
  const goal = state.settings.weeklyStudyGoalMinutes || 0;
  const weekMin = state.timerSessions.filter(s => s.date >= startOfWeek(t)).reduce((s, x) => s + x.minutes, 0);
  const cardsDue = typeof srsDueTotal === 'function' ? srsDueTotal() : 0;

  return `
    <div class="dash-hero">
      <div class="card dash-today">
        <div class="dash-next" ${focus ? `style="--course:${esc(focus.item.color || '#5a6b7b')}"` : ''}>
          ${focus ? `
            <div class="sg-eyebrow"><span class="course-dot"></span>${esc(focus.eyebrow)}</div>
            <button class="dash-next-title" onclick="${focus.item.action}">${esc(focus.item.title)}</button>
            ${focus.item.sub ? `<div class="small muted">${esc(focus.item.sub)}</div>` : ''}
          ` : `
            <div class="sg-eyebrow">Today</div>
            <div class="dash-next-title is-static">You’re all clear.</div>
            <div class="small muted">Nothing scheduled and nothing due. Get ahead, or take the win.</div>
          `}
        </div>
        <div class="dash-timeline">
          <div class="dash-timeline-head"><span>Today</span><button class="sg-link" onclick="setState({route:'calendar',calView:'day',calDate:todayIso()})">Calendar →</button></div>
          ${items.length ? items.map(i => {
            const past = i.end ? toMin(i.end) <= nowMin : i.start ? toMin(i.start) < nowMin - 30 : false;
            const live = i === current;
            return `<button class="dash-tl-row ${past ? 'past' : ''} ${live ? 'live' : ''}" style="--course:${esc(i.color || '#5a6b7b')}" onclick="${i.action}">
              <span class="dash-tl-time">${i.start ? fmtTime(i.start).replace(':00', '') : 'Tonight'}</span>
              <span class="dash-tl-bar"></span>
              <span class="dash-tl-body"><span class="dash-tl-title">${esc(i.title)}</span><span class="dash-tl-sub">${esc(i.sub || '')}</span></span>
              ${i.kind === 'due' ? `<span class="dash-tl-tag">Due</span>` : i.kind === 'group' ? `<span class="dash-tl-tag">${icon('users', 11, 1.8)}</span>` : i.kind === 'org' ? `<span class="dash-tl-tag">${icon('shield', 11, 1.8)}</span>` : ''}
            </button>`;
          }).join('') : `<div class="small muted dash-tl-empty">No classes or events today.</div>`}
        </div>
      </div>
      <div class="dash-tiles">
        <button class="card dash-tile" onclick="state._assignView='todo';setState({route:'assignments',subRoute:null})">
          <span class="dash-tile-num">${dueWeek.length}</span><span class="dash-tile-lbl">Due in the next 7 days</span>
        </button>
        <button class="card dash-tile ${overdue.length ? 'is-alert' : ''}" onclick="state._assignView='todo';setState({route:'assignments',subRoute:null})">
          <span class="dash-tile-num">${overdue.length}</span><span class="dash-tile-lbl">${overdue.length ? 'Overdue, catch up' : 'Overdue'}</span>
        </button>
        <button class="card dash-tile" onclick="${cardsDue ? `openReview()` : `setState({route:'timer',subRoute:null})`}">
          ${cardsDue
            ? `<span class="dash-tile-num">${cardsDue}</span><span class="dash-tile-lbl">Flashcards to review</span>`
            : `<span class="dash-tile-num">${fmtDuration(weekMin)}</span><span class="dash-tile-lbl">Focus time this week${goal ? ` of ${fmtDuration(goal)}` : ''}</span>`}
        </button>
      </div>
    </div>`;
}

const DASH_WIDGETS = {
  dueThisWeek: () => {
    const t = todayIso(), weekEnd = addDays(t, 7);
    const rows = [
      ...state.assignments.filter(a => !isAssignmentDone(a) && dashCourseScope(a) && a.dueDate && a.dueDate <= weekEnd).map(a => ({ kind: 'a', id: a.id, title: a.title, date: a.dueDate, time: a.dueTime, course: getCourse(a.courseId), type: a.type })),
      ...state.todos.filter(td => !td.done && td.dueDate && td.dueDate <= weekEnd).map(td => ({ kind: 't', id: td.id, title: td.title, date: td.dueDate, course: getCourse(td.courseId), type: 'to-do' })),
      ...appDueItems(addDays(t, -30), weekEnd).map(i => ({ kind: 'app', id: i.app.id, title: i.label, date: i.date, time: i.time, course: null, type: i.app.type.toLowerCase() })),
      ...milestoneDueItems(addDays(t, -30), weekEnd).map(({ p, m }) => ({ kind: 'ms', id: m.id, pid: p.id, title: m.title, date: m.dueDate, course: getCourse(p.courseId), type: `milestone · ${p.title}` })),
    ].sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    const groups = [];
    rows.forEach(r => {
      const key = r.date < t ? 'overdue' : r.date;
      let g = groups.find(x => x.key === key);
      if (!g) groups.push(g = { key, label: key === 'overdue' ? 'Overdue' : fmtSessionDay(key), items: [] });
      g.items.push(r);
    });
    return `
      <div class="card card-pad">
        <div class="flex-between mb-8"><h3 class="sg-h3">Due this week</h3><button class="sg-link" onclick="setState({route:'assignments',subRoute:null})">All assignments →</button></div>
        ${groups.length ? groups.map(g => `
          <div class="dash-day ${g.key === 'overdue' ? 'is-overdue' : ''}">
            <div class="dash-day-label">${esc(g.label)}</div>
            ${g.items.map(r => `
              <div class="dash-due-row" data-item-id="${r.id}" style="--course:${esc(r.course?.color || '#8a8a8a')}" onclick="${r.kind === 'a' ? `openAssignmentModal('${r.id}')` : r.kind === 'app' ? `openApplicationModal('${r.id}')` : r.kind === 'ms' ? `openProject('${r.pid}')` : `openTodoModal('${r.id}')`}">
                ${r.kind === 'app' ? `<span class="row-check dash-app-ic" aria-hidden="true">${icon('briefcase', 12, 1.8)}</span>` : `<button type="button" class="row-check" role="checkbox" aria-checked="false" aria-label="Mark ${esc(r.title)} as done" onclick="event.stopPropagation();${r.kind === 'a' ? `toggleAssignmentDone('${r.id}')` : r.kind === 'ms' ? `toggleMilestone('${r.pid}','${r.id}')` : `toggleTodo('${r.id}')`}"></button>`}
                <div class="row-title"><div>${esc(r.title)}</div><div class="assign-meta"><span class="assign-course">${r.kind === 'app' ? 'Applications' : `<span class="course-dot"></span>${esc(r.course ? (r.course.code || r.course.name) : 'Personal')}`}</span><span>${esc(r.type)}</span></div></div>
                ${r.time && r.time !== '23:59' && g.key !== 'overdue' ? `<span class="row-meta">${fmtTime(r.time)}</span>` : ''}
              </div>`).join('')}
          </div>`).join('') : `<div class="dash-clear">${icon('cloud-sun', 20, 1.5)}<span>Nothing due in the next 7 days.</span></div>`}
      </div>`;
  },
  studyGroups: () => dashboardGroupsWidget(),
  orgs: () => dashboardOrgsWidget(),
  exams: () => {
    const exams = state.assignments.filter(a => a.type === 'exam' && dashCourseScope(a) && a.dueDate && a.dueDate >= todayIso())
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 3);
    return `
      <div class="card card-pad">
        <div class="flex-between mb-8"><h3 class="sg-h3">Exams</h3><button class="sg-link" onclick="setState({route:'exams',subRoute:null})">All →</button></div>
        ${exams.length ? exams.map(e => {
          const d = daysBetween(e.dueDate);
          const c = getCourse(e.courseId);
          const prep = examPrep(e);
          return `<button class="dash-exam-row" style="--course:${esc(c?.color || '#5a6b7b')}" onclick="openExamPrep('${e.id}')">
            <span class="dash-exam-days ${d <= 3 ? 'soon' : ''}"><strong>${d === 0 ? 'Today' : d}</strong>${d === 0 ? '' : `<span>day${d === 1 ? '' : 's'}</span>`}</span>
            <span style="min-width:0;text-align:left"><span class="sg-strong dash-ellipsis">${esc(e.title)}</span><span class="small muted dash-ellipsis"><span class="course-dot"></span> ${esc(c ? (c.code || c.name) : '')} · ${fmtDate(e.dueDate, { weekday: 'short', month: 'short', day: 'numeric' })}${prep != null ? ` · ${prep}% prepped` : ''}</span></span>
          </button>`;
        }).join('') : `<p class="small muted">No exams on your list. Syllabus upload adds them automatically.</p>`}
      </div>`;
  },
  focus: () => {
    const t = todayIso();
    const goal = state.settings.weeklyStudyGoalMinutes || 0;
    const weekMin = state.timerSessions.filter(s => s.date >= startOfWeek(t)).reduce((s, x) => s + x.minutes, 0);
    const pct = goal ? clamp(Math.round((weekMin / goal) * 100), 0, 100) : 0;
    const days = new Set(state.timerSessions.map(s => s.date));
    let streak = 0;
    for (let d = days.has(t) ? t : addDays(t, -1); days.has(d); d = addDays(d, -1)) streak++;
    const week = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(t), i)).map(d => ({ d, m: state.timerSessions.filter(s => s.date === d).reduce((s, x) => s + x.minutes, 0) }));
    const max = Math.max(30, ...week.map(x => x.m));
    return `
      <div class="card card-pad">
        <div class="flex-between mb-8"><h3 class="sg-h3">Focus</h3>${streak ? `<span class="small muted">${streak}-day streak</span>` : ''}</div>
        <div class="dash-focus">
          <div class="dash-focus-ring">${progressRing(goal ? pct : null, 'var(--accent)', 84)}<div><strong>${fmtDuration(weekMin)}</strong><span>${goal ? `of ${fmtDuration(goal)}` : 'this week'}</span></div></div>
          <div class="dash-focus-week">${week.map(x => `<span class="dash-focus-day ${x.d === t ? 'today' : ''}" title="${fmtDate(x.d, { weekday: 'long' })}: ${fmtDuration(x.m)}"><span style="height:${x.m ? 8 + (x.m / max) * 44 : 3}px"></span><em>${fmtDate(x.d, { weekday: 'narrow' })}</em></span>`).join('')}</div>
        </div>
        <button class="btn btn-sm mt-16" style="width:100%;justify-content:center" onclick="setState({route:'timer',subRoute:null})">${icon('play', 11, 1.5)} Start a focus session</button>
      </div>`;
  },
  workload: () => {
    const w = weeklyWorkload(14);
    return `
      <div class="card card-pad">
        <div class="flex-between mb-8"><h3 class="sg-h3">Workload</h3><span class="small muted">Next two weeks</span></div>
        <div class="dash-workload">
          ${w.map(d => `
            <div class="dash-wl-col ${d.isToday ? 'today' : ''}" onclick="setState({route:'calendar',calView:'day',calDate:'${d.date}'})" title="${fmtDate(d.date, { weekday: 'long', month: 'short', day: 'numeric' })}: ${d.count} due${d.exam ? ', including an exam' : ''}">
              <div class="dash-wl-bar-wrap"><div class="dash-wl-bar ${d.exam ? 'exam' : ''}" style="height:${d.count ? 10 + (d.count / w.maxCount) * 38 : 3}px"></div></div>
              <div class="dash-wl-count">${d.count || ''}</div>
              <div class="dash-wl-day">${d.label}</div>
            </div>`).join('')}
        </div>
      </div>`;
  },
  quickNote: () => `
    <div class="sticky-note size-${state.settings.stickyNoteSize || 'md'}">
      <div class="small" style="font-weight:600;opacity:.7">Quick note</div>
      <textarea class="sticky-note-input" id="dash-quick-note" placeholder="Jot something down…" oninput="saveQuickNoteDebounced(this.value)">${esc(state.quickNote || '')}</textarea>
    </div>`,
  projects: () => {
    const projects = visibleProjects().filter(p => !projectIsDone(p)).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')).slice(0, 3);
    if (!projects.length) return '';
    return `
      <div class="card card-pad">
        <div class="flex-between mb-8"><h3 class="sg-h3">Projects</h3><button class="sg-link" onclick="setState({route:'projects',subRoute:null})">All →</button></div>
        ${projects.map(p => `
          <div class="mb-8 hub-link" style="cursor:pointer" onclick="openProject('${p.id}')">
            <div class="flex-between small" style="margin-bottom:4px"><span class="sg-strong">${esc(p.title)}</span><span class="muted">${p.dueDate ? `${esc(daysLeftLabel(p.dueDate))} · ` : ''}${projectProgress(p)}%</span></div>
            <div class="progress"><div style="width:${projectProgress(p)}%"></div></div>
            ${nextMilestone(p) ? `<div class="small muted mt-4">Next: ${esc(nextMilestone(p).title)}${nextMilestone(p).dueDate ? ` · ${esc(relativeDay(nextMilestone(p).dueDate).replace(' (overdue)', ''))}` : ''}</div>` : ''}
          </div>`).join('')}
      </div>`;
  },
  notes: () => {
    const recent = state.notes.filter(n => n.type === 'note').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 4);
    return `
      <div class="card card-pad">
        <div class="flex-between mb-8"><h3 class="sg-h3">Recent notes</h3><button class="sg-link" onclick="createNote('root')">+ New</button></div>
        ${recent.length ? recent.map(n => `
          <div class="sg-person hub-link" onclick="setState({route:'notebook',notebookSelected:'${n.id}',subRoute:null})">
            <span class="sg-activity-ic">${icon('file-text', 13, 1.8)}</span>
            <div class="row-title small">${esc(n.name || 'Untitled note')}</div>
            <span class="small muted">${fmtRelativeTime(n.updatedAt)}</span>
          </div>`).join('') : `<p class="small muted">No notes yet.</p>`}
      </div>`;
  },
  quickAdd: () => quickAddBar('dash', { mode: 'auto' }),
};

/* ── Getting started ───────────────────────────────────────────── */
function onboardingSteps() {
  const firstCourse = activeCourses()[0];
  return [
    { done: activeCourses().length > 0, label: 'Add your classes', sub: 'Upload a syllabus, or add them by hand', action: 'openSemesterSetup()' },
    { done: state.assignments.some(a => !a.sample), label: 'Get every deadline in', sub: 'Upload a syllabus or assignment sheet', action: 'openAssignmentUploadModal()' },
    { done: state.decks.some(d => !d.sample), label: 'Make a flashcard deck', sub: 'Review it right before you’d forget', action: `setState({route:'studytools',subRoute:null});openDeckModal(null${firstCourse ? `,'${firstCourse.id}'` : ''})` },
    { done: (state.studyGroups || []).some(e => !e.sample), label: 'Start or join a study group', sub: 'Find a time that works for everyone', action: "setState({route:'studygroups',subRoute:null})" },
    { done: state.timerSessions.length > 0, label: 'Log a focus session', sub: 'Build a study streak', action: "setState({route:'timer',subRoute:null})" },
  ];
}
function gettingStartedCard() {
  if (state.settings.onboardingDismissed || state.settings.sampleData) return '';
  const steps = onboardingSteps();
  const done = steps.filter(s => s.done).length;
  if (done === steps.length) return '';
  return `
    <div class="card getting-started">
      <div class="gs-head">
        <div><div class="sg-eyebrow">Getting started</div><div class="gs-title">${done} of ${steps.length} done</div></div>
        <div class="gs-progress"><div class="progress"><div style="width:${(done / steps.length) * 100}%"></div></div></div>
        <button class="btn btn-ghost btn-icon btn-sm" aria-label="Hide getting started" title="Hide" onclick="state.settings.onboardingDismissed=true;touch()">${icon('x', 13, 2.2)}</button>
      </div>
      <div class="gs-steps">
        ${steps.map(s => `
          <button class="gs-step ${s.done ? 'done' : ''}" ${s.done ? 'disabled' : `onclick="${s.action}"`}>
            <span class="gs-check">${s.done ? icon('check', 12, 2.6) : ''}</span>
            <span><span class="gs-label">${esc(s.label)}</span><span class="gs-sub">${esc(s.sub)}</span></span>
          </button>`).join('')}
      </div>
    </div>`;
}
function welcomeHero() {
  const steps = [
    ['graduation-cap', 'Add your classes', 'Upload each syllabus. Semester HQ reads it and fills in class times, every deadline, and exam dates.'],
    ['check-square', 'Stay ahead of every deadline', 'See what’s next and what’s due this week, and get a heads-up before anything sneaks up on you.'],
    ['users', 'Bring your study group', 'Find a time everyone’s free, plan sessions, split up tasks, and share notes.'],
  ];
  return `
    <div class="card welcome">
      <div class="welcome-copy">
        <div class="sg-eyebrow">${icon('sparkles', 13, 1.8)} Welcome to Semester HQ</div>
        <h3 class="welcome-title">Let’s build your semester.</h3>
        <p class="muted">Two minutes of setup now, and your whole term lives in one place: schedule, deadlines, notes, flashcards, and study groups.</p>
        <div class="sg-hero-actions">
          <button class="btn btn-primary" onclick="openSemesterSetup()">${icon('sparkles', 13, 1.7)} Set up my semester</button>
          <button class="btn" onclick="openSyllabusUploadModal()">${icon('upload', 13, 1.8)} Upload a syllabus</button>
          <button class="btn" onclick="openJoinClassModal()">${icon('users', 13, 1.8)} Join a class a classmate shared</button>
        </div>
        <button class="btn btn-ghost btn-sm sg-sample-btn" onclick="loadSampleSemester()">${icon('eye', 13, 1.8)} Look around with a sample semester first</button>
      </div>
      <div class="welcome-steps">
        ${steps.map(([ic, t, d], i) => `
          <div class="welcome-step">
            <span class="welcome-num">${i + 1}</span>
            <div><div class="sg-strong">${icon(ic, 14, 1.8)} ${t}</div><div class="small muted">${d}</div></div>
          </div>`).join('')}
      </div>
    </div>`;
}

function pageDashboardToday() {
  const t = todayIso();
  const dow = new Date().getDay();
  const classesToday = activeCourses().flatMap(c => c.meetings.filter(m => m.day === dow).map(m => ({ start: m.start, end: m.end, title: c.name, color: c.color })))
    .sort((a, b) => (a.start || '').localeCompare(b.start || ''));

  const tasksToday = state.todos.filter(td => !td.done && td.dueDate === t);
  const dueToday = state.assignments.filter(a => activeCourses().some(c => c.id === a.courseId) && !isAssignmentDone(a) && a.dueDate === t);
  const nextExam = state.assignments
    .filter(a => a.type === 'exam' && activeCourses().some(c => c.id === a.courseId) && daysBetween(a.dueDate) >= 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

  const priorityPool = [
    ...state.todos.filter(td => !td.done && td.dueDate <= t).map(td => ({ kind: 'todo', id: td.id, title: td.title, priority: td.priority, date: td.dueDate })),
    ...state.assignments.filter(a => activeCourses().some(c => c.id === a.courseId) && !isAssignmentDone(a) && a.dueDate <= t).map(a => ({ kind: 'assignment', id: a.id, title: a.title, priority: a.priority || 'medium', date: a.dueDate })),
  ].sort((x, y) => (x.date.localeCompare(y.date)) || ({ high: 0, medium: 1, low: 2 }[x.priority] - { high: 0, medium: 1, low: 2 }[y.priority]));
  const priority = priorityPool[0];

  const goalMin = state.settings.weeklyStudyGoalMinutes || 0;
  const weekMinutes = state.timerSessions.filter(s => s.date >= startOfWeek(t)).reduce((sum, s) => sum + s.minutes, 0);
  const goalPct = goalMin ? clamp(Math.round((weekMinutes / goalMin) * 100), 0, 100) : 0;

  return `
    ${pageHead('Today', fmtDateLong(t), `
      <button class="btn btn-sm btn-primary" onclick="toggleTodayMode()">${icon('panel-left', 13, 2)} Full dashboard</button>
    `)}

    ${priority ? `
    <div class="card card-pad mb-16" style="border:1.5px solid var(--ink)">
      <div class="small" style="font-weight:600;opacity:.7;margin-bottom:4px">Your one priority right now</div>
      <div class="flex-between">
        <div style="font-size:17px;font-weight:600">${esc(priority.title)}</div>
        ${priorityDot(priority.priority)}
      </div>
    </div>` : emptyState(icon('check-square', 24, 1.4), "Nothing overdue or urgent, you're caught up.")}

    <div class="grid grid-2 mb-16" style="align-items:start">
      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">Classes today</h3>
        ${classesToday.length ? classesToday.map(m => `
          <div class="list-row"><div class="pill-dot" style="background:${m.color}"></div><div class="row-title">${esc(m.title)}</div><div class="row-meta">${m.start ? fmtTime(m.start) + (m.end ? ' – ' + fmtTime(m.end) : '') : ''}</div></div>
        `).join('') : emptyState(icon('book-open', 22, 1.4), 'No classes today.')}
      </div>
      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">Tasks today</h3>
        ${tasksToday.length ? tasksToday.map(td => `
          <div class="list-row" onclick="toggleTodo('${td.id}')"><button type="button" class="row-check ${td.done ? 'checked' : ''}" role="checkbox" aria-checked="${td.done}" aria-label="Mark ${esc(td.title)} as ${td.done ? 'not done' : 'done'}" onclick="event.stopPropagation();toggleTodo('${td.id}')">${td.done ? checkGlyph(true) : ''}</button><div class="row-title">${esc(td.title)}</div>${priorityDot(td.priority)}</div>
        `).join('') : emptyState(icon('check-square', 22, 1.4), 'No tasks for today.')}
      </div>
    </div>

    <div class="grid grid-2 mb-16" style="align-items:start">
      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">Due today</h3>
        ${dueToday.length ? dueToday.map(a => `
          <div class="list-row" onclick="openAssignmentModal('${a.id}')"><button type="button" class="row-check ${isAssignmentDone(a) ? 'checked' : ''}" role="checkbox" aria-checked="${isAssignmentDone(a)}" aria-label="Mark ${esc(a.title)} as ${isAssignmentDone(a) ? 'not done' : 'done'}" onclick="event.stopPropagation();toggleAssignmentDone('${a.id}')">${isAssignmentDone(a) ? checkGlyph(true) : ''}</button><div class="row-title">${esc(a.title)} ${typeTag(a.type)}</div>${courseChip(a.courseId)}</div>
        `).join('') : emptyState(icon('clipboard-list', 22, 1.4), 'Nothing due today.')}
      </div>
      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">Upcoming exam</h3>
        ${nextExam
          ? `<div class="list-row" onclick="openAssignmentModal('${nextExam.id}')"><div class="pill-dot" style="background:${getCourseColor(nextExam.courseId)}"></div><div class="row-title">${esc(nextExam.title)}</div><div class="row-meta">${daysBetween(nextExam.dueDate)}d away</div></div>`
          : emptyState(icon('flag', 22, 1.4), 'No exams scheduled.')}
      </div>
    </div>

    <div class="card card-pad">
      <div class="flex-between mb-8"><h3 style="font-size:15px">This week's study goal</h3><span class="small muted">${fmtDuration(weekMinutes)} / ${fmtDuration(goalMin)}</span></div>
      <div class="progress"><div style="width:${goalPct}%"></div></div>
    </div>
  `;
}

const saveQuickNoteDebounced = debounce((v) => { state.quickNote = v; save(); }, 400);

function openDashboardCustomizeModal() {
  const size = state.settings.stickyNoteSize || 'md';
  const order = (state.settings.dashboardWidgets || Object.keys(DASH_WIDGET_DEFS)).filter(id => DASH_WIDGET_DEFS[id]);
  // Re-opened after every pick, so keep the scroll position and the focused control.
  const reopening = !!$('#modal .customize-body') && $('#modal-wrap').classList.contains('show');
  const keepScroll = reopening ? $('#modal').scrollTop : 0;
  const keepFocus = reopening && document.activeElement?.closest('#modal') ? [...$('#modal').querySelectorAll('button')].indexOf(document.activeElement) : -1;
  openModal(`
    <div class="modal-head"><h3>Customize dashboard</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body customize-body">
      <div class="field">
        <div class="flex-between mb-8"><label style="margin:0">Colors</label>
          <div class="segmented" role="group" aria-label="Light or dark">
            <button class="${!state.settings.dark ? 'active' : ''}" aria-pressed="${!state.settings.dark}" onclick="toggleDark(false);openDashboardCustomizeModal()">${icon('sun', 13, 2)} Light</button>
            <button class="${state.settings.dark ? 'active' : ''}" aria-pressed="${!!state.settings.dark}" onclick="toggleDark(true);openDashboardCustomizeModal()">${icon('moon', 13, 2)} Dark</button>
          </div>
        </div>
        ${themeTilesHtml('openDashboardCustomizeModal()')}
      </div>
      <div class="field"><label>Page color <span class="muted">(${state.settings.dark ? 'dark' : 'light'} mode)</span></label>
        ${pageColorSwatchesHtml('openDashboardCustomizeModal()')}
        <button class="sg-link small mt-8" onclick="closeModal();setState({route:'settings',subRoute:null})">More colors and app icons in Settings →</button>
      </div>
      <div class="field"><label>Quick note size</label>
        <div class="segmented">
          <button class="${size === 'sm' ? 'active' : ''}" onclick="setStickyNoteSize('sm')">Small</button>
          <button class="${size === 'md' ? 'active' : ''}" onclick="setStickyNoteSize('md')">Medium</button>
          <button class="${size === 'lg' ? 'active' : ''}" onclick="setStickyNoteSize('lg')">Large</button>
        </div>
      </div>
      ${state.settings.onboardingDismissed ? `<div class="field"><button class="btn btn-sm" onclick="state.settings.onboardingDismissed=false;touch();openDashboardCustomizeModal()">Show the getting started checklist again</button></div>` : ''}
      <div class="field" style="margin-bottom:0"><label>Widgets: show, hide, and reorder</label>
        <div id="dash-widget-list">${order.map((id, i) => dashWidgetRow(id, i, order.length)).join('')}</div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">Done</button></div>
  `, { wide: true });
  if (reopening) {
    $('#modal').scrollTop = keepScroll;
    if (keepFocus >= 0) $('#modal').querySelectorAll('button')[keepFocus]?.focus({ preventScroll: true });
  }
}
function dashWidgetRow(id, i, total) {
  const on = !(state.settings.hiddenWidgets || []).includes(id);
  return `<div class="list-row">
    <button type="button" class="row-check ${on ? 'checked' : ''}" role="checkbox" aria-checked="${on}" aria-label="${on ? 'Hide' : 'Show'} ${esc(DASH_WIDGET_LABELS[id] || id)} widget" onclick="toggleDashWidget('${id}')">${on ? checkGlyph(true) : ''}</button>
    <div class="row-title">${esc(DASH_WIDGET_LABELS[id] || id)} <span class="small muted">${DASH_WIDGET_DEFS[id].col === 'side' ? 'Right column' : 'Left column'}</span></div>
    <button class="btn btn-ghost btn-icon btn-sm" aria-label="Move up" onclick="moveDashWidget(${i},-1)" ${i === 0 ? 'disabled' : ''}>↑</button>
    <button class="btn btn-ghost btn-icon btn-sm" aria-label="Move down" onclick="moveDashWidget(${i},1)" ${i === total - 1 ? 'disabled' : ''}>↓</button>
  </div>`;
}
function toggleDashWidget(id) {
  const hidden = state.settings.hiddenWidgets || (state.settings.hiddenWidgets = []);
  const i = hidden.indexOf(id);
  if (i === -1) hidden.push(id); else hidden.splice(i, 1);
  touch(); openDashboardCustomizeModal();
}
function moveDashWidget(i, dir) {
  const order = state.settings.dashboardWidgets;
  const j = i + dir;
  if (j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  touch(); openDashboardCustomizeModal();
}
function setStickyNoteSize(size) { state.settings.stickyNoteSize = size; touch(); openDashboardCustomizeModal(); }


function computeSemesterProgress() {
  const sem = state.semesters.find(s => s.id === state.currentSemesterId);
  if (!sem || !sem.startDate || !sem.endDate) return null;
  const total = new Date(sem.endDate + 'T00:00:00') - new Date(sem.startDate + 'T00:00:00');
  if (total <= 0) return null;
  const elapsed = clamp(Date.now() - new Date(sem.startDate + 'T00:00:00'), 0, total);
  const pct = Math.round((elapsed / total) * 100);
  const totalWeeks = Math.max(1, Math.ceil(total / (7 * 86400000)));
  const week = clamp(Math.ceil(elapsed / (7 * 86400000)) || 1, 1, totalWeeks);
  return { name: sem.name, pct, week, totalWeeks };
}

function weeklyWorkload(days = 7) {
  const start = todayIso();
  const counts = Array.from({ length: days }, (_, i) => addDays(start, i)).map(d => {
    const due = state.assignments.filter(a => a.dueDate === d && !isAssignmentDone(a) && activeCourses().some(c => c.id === a.courseId));
    return { date: d, count: due.length, exam: due.some(a => a.type === 'exam'), isToday: d === todayIso(), label: fmtDate(d, { weekday: 'narrow' }) };
  });
  counts.maxCount = Math.max(1, ...counts.map(c => c.count));
  return counts;
}
