/* ── Dashboard / Home ─────────────────────────────────────────── */
function toggleTodayMode() { state.todayMode = !state.todayMode; touch(); }

function pageDashboard() {
  if (state.todayMode) return pageDashboardToday();
  const name = state.settings.displayName ? `, ${esc(state.settings.displayName)}` : '';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const weekEnd = addDays(todayIso(), 7);
  const dueThisWeek = state.assignments
    .filter(a => activeCourses().some(c => c.id === a.courseId) && !isAssignmentDone(a) && a.dueDate >= todayIso() && a.dueDate <= weekEnd)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const overdue = state.assignments.filter(a => activeCourses().some(c => c.id === a.courseId) && !isAssignmentDone(a) && a.dueDate < todayIso());

  const upcomingExams = state.assignments
    .filter(a => a.type === 'exam' && activeCourses().some(c => c.id === a.courseId) && daysBetween(a.dueDate) >= 0 && daysBetween(a.dueDate) <= 21)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 3);

  const dow = new Date().getDay();
  const todaysItems = [
    ...activeCourses().flatMap(c => c.meetings.filter(m => m.day === dow).map(m => ({ start: m.start, end: m.end, title: c.name, color: c.color }))),
    ...state.events.filter(e => e.date === todayIso()).map(e => ({ start: e.startTime, end: e.endTime, title: e.title, color: e.color })),
  ].sort((a, b) => (a.start || '').localeCompare(b.start || ''));

  const weekMinutes = state.timerSessions.filter(s => s.date >= startOfWeek(todayIso())).reduce((sum, s) => sum + s.minutes, 0);
  const sem = computeSemesterProgress();
  const workload = weeklyWorkload();
  const projects = state.projects.filter(p => !p.courseId || activeCourses().some(c => c.id === p.courseId)).slice(0, 3);
  const recentNotes = [...state.notes.filter(n => n.type === 'note')].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 3);

  const noteSizeClass = `size-${state.settings.stickyNoteSize || 'md'}`;

  const DASH_WIDGETS = {
    stats: () => `
      <div class="grid grid-3 mb-16">
        <div class="stat-card"><div class="flex-between"><div class="num">${dueThisWeek.length}</div><span>${icon('clipboard-list', 15)}</span></div><div class="lbl">Due this week</div></div>
        <div class="stat-card"><div class="flex-between"><div class="num" style="color:${overdue.length ? 'var(--danger)' : 'inherit'}">${overdue.length}</div><span>${icon('file-text', 15)}</span></div><div class="lbl">Overdue</div></div>
        <div class="stat-card"><div class="flex-between"><div class="num">${fmtDuration(weekMinutes)}</div><span>${icon('timer', 15)}</span></div><div class="lbl">Study time this week</div></div>
      </div>`,
    semesterProgress: () => sem ? `
      <div class="card card-pad mb-16">
        <div class="flex-between mb-8"><span class="small dim" style="font-weight:600">${esc(sem.name)}</span><span class="small muted">Week ${sem.week} of ${sem.totalWeeks} · ${sem.pct}% complete</span></div>
        <div class="progress"><div style="width:${sem.pct}%"></div></div>
      </div>` : '',
    degreeProgress: () => { const d = computeDegreeProgress(); return d ? `
      <div class="card card-pad mb-16">
        <div class="flex-between mb-8"><span class="small dim" style="font-weight:600">Degree progress</span><span class="small muted">${d.completedCredits} / ${d.total} credits · ${d.pct}%</span></div>
        <div class="progress"><div style="width:${d.pct}%"></div></div>
      </div>` : ''; },
    workload: () => `
      <div class="card card-pad mb-16">
        <div class="small dim mb-8" style="font-weight:600">This week's workload</div>
        <div class="dash-workload">
          ${workload.map(d => `
            <div class="dash-wl-col ${d.isToday ? 'today' : ''}" onclick="setState({route:'calendar',calView:'day',calDate:'${d.date}'})" title="${d.count} item${d.count === 1 ? '' : 's'}">
              <div class="dash-wl-bar-wrap"><div class="dash-wl-bar" style="height:${d.count ? 14 + (d.count / workload.maxCount) * 34 : 3}px"></div></div>
              <div class="dash-wl-count">${d.count || ''}</div>
              <div class="dash-wl-day">${d.label}</div>
            </div>
          `).join('')}
        </div>
      </div>`,
    quickNote: () => `
      <div class="sticky-note ${noteSizeClass} mb-16">
        <div class="small" style="font-weight:600;opacity:.7">Quick note</div>
        <textarea class="sticky-note-input" placeholder="Jot something down…" oninput="saveQuickNoteDebounced(this.value)">${esc(state.quickNote || '')}</textarea>
      </div>`,
    dueThisWeek: () => `
      <div class="card card-pad mb-16">
        <div class="flex-between mb-8"><h3 style="font-size:15px">What's due this week</h3><span class="pill" style="background:var(--accent-light);color:var(--accent)">${dueThisWeek.length}</span></div>
        ${dueThisWeek.length ? dueThisWeek.map(a => `
          <div class="list-row" onclick="openAssignmentModal('${a.id}')">
            <button type="button" class="row-check ${isAssignmentDone(a) ? 'checked' : ''}" role="checkbox" aria-checked="${isAssignmentDone(a)}" aria-label="Mark ${esc(a.title)} as ${isAssignmentDone(a) ? 'not done' : 'done'}" onclick="event.stopPropagation();toggleAssignmentDone('${a.id}')">${isAssignmentDone(a) ? checkGlyph(true) : ''}</button>
            <div class="row-title">${esc(a.title)} ${typeTag(a.type)}</div>
            ${courseChip(a.courseId)}
            <div class="row-meta">${relativeDay(a.dueDate)}</div>
          </div>`).join('') : emptyState(icon('cloud-sun', 26, 1.4), 'Nothing due in the next 7 days.')}
        ${overdue.length ? `<div class="divider"></div><div class="small" style="color:var(--danger);font-weight:600;margin-bottom:6px">Overdue</div>${overdue.map(a => `
          <div class="list-row dash-overdue-row" onclick="openAssignmentModal('${a.id}')">
            <button type="button" class="row-check" role="checkbox" aria-checked="false" aria-label="Mark ${esc(a.title)} as done" onclick="event.stopPropagation();toggleAssignmentDone('${a.id}')"></button>
            <div class="row-title">${esc(a.title)}</div>${courseChip(a.courseId)}
            <div class="row-meta" style="color:var(--danger)">${relativeDay(a.dueDate)}</div>
          </div>`).join('')}` : ''}
      </div>`,
    todaySchedule: () => `
      <div class="card card-pad mb-16">
        <h3 style="font-size:15px" class="mb-8">Today's schedule</h3>
        ${todaysItems.length ? todaysItems.map(m => `
          <div class="list-row">
            <div class="pill-dot" style="background:${m.color}"></div>
            <div class="row-title">${esc(m.title)}</div>
            <div class="row-meta">${m.start ? fmtTime(m.start) + (m.end ? ' – ' + fmtTime(m.end) : '') : ''}</div>
          </div>`).join('') : emptyState(icon('book-open', 26, 1.4), 'No classes today.')}
        <div class="divider"></div>
        <div class="flex-between mb-8"><h3 style="font-size:15px">Upcoming exams</h3></div>
        ${upcomingExams.length ? upcomingExams.map(a => `
          <div class="list-row" onclick="openAssignmentModal('${a.id}')">
            <div class="pill-dot" style="background:${getCourseColor(a.courseId)}"></div>
            <div class="row-title">${esc(a.title)}</div>
            <div class="row-meta">${daysBetween(a.dueDate)}d away</div>
          </div>`).join('') : emptyState(icon('check-square', 26, 1.4), 'No exams in the next 3 weeks.')}
      </div>`,
    projects: () => `
      <div class="card card-pad mb-16">
        <div class="flex-between mb-8"><h3 style="font-size:15px">Active projects</h3><a class="small" style="color:var(--accent);cursor:pointer" onclick="setState({route:'projects'})">View all →</a></div>
        ${projects.length ? projects.map(p => `
          <div class="mb-8" style="cursor:pointer" onclick="openProjectModal('${p.id}')">
            <div class="flex-between small" style="margin-bottom:3px"><span>${esc(p.title)}</span><span class="muted">${projectProgress(p)}%</span></div>
            <div class="progress"><div style="width:${projectProgress(p)}%"></div></div>
          </div>
        `).join('') : emptyState(icon('folder', 22, 1.4), 'No active projects.')}
      </div>`,
    notes: () => `
      <div class="card card-pad mb-16">
        <div class="flex-between mb-8"><h3 style="font-size:15px">Recent notes</h3><a class="small" style="color:var(--accent);cursor:pointer" onclick="setState({route:'notebook'})">View all →</a></div>
        ${recentNotes.length ? recentNotes.map(n => `
          <div class="list-row" onclick="setState({route:'notebook',notebookSelected:'${n.id}'})">
            <span class="nb-note-ic">${icon('file-text', 14)}</span>
            <div class="row-title">${esc(n.name)}</div>
            <div class="row-meta">${fmtRelativeTime(n.updatedAt)}</div>
          </div>
        `).join('') : emptyState(icon('book-open', 22, 1.4), 'No notes yet.')}
      </div>`,
    quickAdd: () => `
      <div class="card card-pad mb-16">
        <div class="flex-gap">
          <input class="input" id="quick-add-input" placeholder="Quick add a to-do… (press Enter)" onkeydown="if(event.key==='Enter')quickAddTodo()">
          <select class="select" id="quick-add-course" style="width:170px">
            <option value="">No course</option>${courseOptions()}
          </select>
          <button class="btn btn-primary" onclick="quickAddTodo()">Add</button>
        </div>
      </div>`,
  };
  const order = state.settings.dashboardWidgets || Object.keys(DASH_WIDGETS);
  const hidden = state.settings.hiddenWidgets || [];

  return `
    ${pageHead(`${greeting}${name}`, fmtDateLong(todayIso()), `
      <button class="btn btn-sm" onclick="toggleTodayMode()">${icon('sun', 13, 2)} Today</button>
      <button class="btn btn-icon btn-sm" onclick="openDashboardCustomizeModal()" title="Customize dashboard" aria-label="Customize dashboard">${icon('settings', 16, 1.6)}</button>
    `)}
    ${order.filter(id => DASH_WIDGETS[id] && !hidden.includes(id)).map(id => DASH_WIDGETS[id]()).join('')}
  `;
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
    </div>` : emptyState(icon('check-square', 24, 1.4), "Nothing overdue or urgent — you're caught up.")}

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

const DASH_WIDGET_LABELS = {
  stats: 'Quick stats (due, overdue, study time)',
  semesterProgress: 'Semester progress',
  degreeProgress: 'Degree progress',
  workload: 'Weekly workload chart',
  quickNote: 'Quick note',
  dueThisWeek: 'What\'s due this week / overdue',
  todaySchedule: 'Today\'s schedule & upcoming exams',
  projects: 'Active projects',
  notes: 'Recent notes',
  quickAdd: 'Quick add to-do',
};
function openDashboardCustomizeModal() {
  const size = state.settings.stickyNoteSize || 'md';
  const order = state.settings.dashboardWidgets || Object.keys(DASH_WIDGET_LABELS);
  openModal(`
    <div class="modal-head"><h3>Customize dashboard</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label>Theme</label>
        <div class="segmented">
          <button class="${!state.settings.dark ? 'active' : ''}" onclick="toggleDark(false);openDashboardCustomizeModal()">${icon('sun', 13, 2)} Light</button>
          <button class="${state.settings.dark ? 'active' : ''}" onclick="toggleDark(true);openDashboardCustomizeModal()">${icon('moon', 13, 2)} Dark</button>
        </div>
      </div>
      <div class="field"><label>Quick note size</label>
        <div class="segmented">
          <button class="${size === 'sm' ? 'active' : ''}" onclick="setStickyNoteSize('sm')">Small</button>
          <button class="${size === 'md' ? 'active' : ''}" onclick="setStickyNoteSize('md')">Medium</button>
          <button class="${size === 'lg' ? 'active' : ''}" onclick="setStickyNoteSize('lg')">Large</button>
        </div>
      </div>
      <div class="field" style="margin-bottom:0"><label>Widgets — show/hide and reorder</label>
        <div id="dash-widget-list">${order.map((id, i) => dashWidgetRow(id, i, order.length)).join('')}</div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">Done</button></div>
  `);
}
function dashWidgetRow(id, i, total) {
  const on = !(state.settings.hiddenWidgets || []).includes(id);
  return `<div class="list-row">
    <button type="button" class="row-check ${on ? 'checked' : ''}" role="checkbox" aria-checked="${on}" aria-label="${on ? 'Hide' : 'Show'} ${esc(DASH_WIDGET_LABELS[id] || id)} widget" onclick="toggleDashWidget('${id}')">${on ? checkGlyph(true) : ''}</button>
    <div class="row-title">${esc(DASH_WIDGET_LABELS[id] || id)}</div>
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

function quickAddTodo() {
  const input = $('#quick-add-input');
  const title = input.value.trim();
  if (!title) return;
  const courseId = $('#quick-add-course').value || null;
  state.todos.unshift({ id: uid(), courseId, title, done: false, dueDate: todayIso(), priority: 'medium', recurring: null });
  touch();
  toast('Added to your to-do list');
}

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

function weeklyWorkload() {
  const start = todayIso();
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const counts = days.map(d => {
    const count = state.assignments.filter(a => a.dueDate === d && activeCourses().some(c => c.id === a.courseId)).length;
    return { date: d, count, isToday: d === todayIso(), label: fmtDate(d, { weekday: 'short' })[0] };
  });
  counts.maxCount = Math.max(1, ...counts.map(c => c.count));
  return counts;
}
