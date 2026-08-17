/* ── Dashboard / Home ─────────────────────────────────────────── */
function pageDashboard() {
  const name = state.settings.displayName ? `, ${esc(state.settings.displayName)}` : '';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const weekEnd = addDays(todayIso(), 7);
  const dueThisWeek = state.assignments
    .filter(a => activeCourses().some(c => c.id === a.courseId) && a.status !== 'done' && a.dueDate >= todayIso() && a.dueDate <= weekEnd)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const overdue = state.assignments.filter(a => activeCourses().some(c => c.id === a.courseId) && a.status !== 'done' && a.dueDate < todayIso());

  const gpa = computeGPA();
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

  return `
    ${pageHead(`${greeting}${name}`, fmtDateLong(todayIso()))}

    <div class="grid grid-4 mb-16">
      <div class="stat-card"><div class="flex-between"><div class="num ${gpa != null ? 'num-hero' : 'stat-dash'}">${gpa != null ? gpa.toFixed(2) : '—'}</div>${icon('target', 15)}</div><div class="lbl">${gpa != null ? 'Current GPA' : 'Add a grade to see your GPA'}</div></div>
      <div class="stat-card"><div class="flex-between"><div class="num">${dueThisWeek.length}</div>${icon('clipboard-list', 15)}</div><div class="lbl">Due this week</div></div>
      <div class="stat-card"><div class="flex-between"><div class="num" style="color:${overdue.length ? 'var(--danger)' : 'inherit'}">${overdue.length}</div>${icon('file-text', 15)}</div><div class="lbl">Overdue</div></div>
      <div class="stat-card"><div class="flex-between"><div class="num">${fmtDuration(weekMinutes)}</div>${icon('timer', 15)}</div><div class="lbl">Study time this week</div></div>
    </div>

    ${sem ? `
    <div class="card card-pad mb-16">
      <div class="flex-between mb-8"><span class="small dim" style="font-weight:600">${esc(sem.name)}</span><span class="small muted">Week ${sem.week} of ${sem.totalWeeks} · ${sem.pct}% complete</span></div>
      <div class="progress"><div style="width:${sem.pct}%"></div></div>
    </div>` : ''}

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
    </div>

    <div class="grid grid-2 mb-16" style="align-items:start">
      <div class="card card-pad">
        <div class="flex-between mb-8"><h3 style="font-size:15px">What's due this week</h3><span class="pill" style="background:var(--accent-light);color:var(--accent)">${dueThisWeek.length}</span></div>
        ${dueThisWeek.length ? dueThisWeek.map(a => `
          <div class="list-row" onclick="openAssignmentModal('${a.id}')">
            <div class="row-check ${a.status === 'done' ? 'checked' : ''}" onclick="event.stopPropagation();toggleAssignmentDone('${a.id}')">${a.status === 'done' ? checkGlyph(true) : ''}</div>
            <div class="row-title">${esc(a.title)} ${typeTag(a.type)}</div>
            ${courseChip(a.courseId)}
            <div class="row-meta">${relativeDay(a.dueDate)}</div>
          </div>`).join('') : emptyState(icon('cloud-sun', 26, 1.4), 'Nothing due in the next 7 days.')}
        ${overdue.length ? `<div class="divider"></div><div class="small" style="color:var(--danger);font-weight:600;margin-bottom:6px">Overdue</div>${overdue.map(a => `
          <div class="list-row dash-overdue-row" onclick="openAssignmentModal('${a.id}')">
            <div class="row-check" onclick="event.stopPropagation();toggleAssignmentDone('${a.id}')"></div>
            <div class="row-title">${esc(a.title)}</div>${courseChip(a.courseId)}
            <div class="row-meta" style="color:var(--danger)">${relativeDay(a.dueDate)}</div>
          </div>`).join('')}` : ''}
      </div>

      <div class="card card-pad">
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
      </div>
    </div>

    ${(projects.length || recentNotes.length) ? `
    <div class="grid grid-2 mb-16" style="align-items:start">
      <div class="card card-pad">
        <div class="flex-between mb-8"><h3 style="font-size:15px">Active projects</h3><a class="small" style="color:var(--accent);cursor:pointer" onclick="setState({route:'projects'})">View all →</a></div>
        ${projects.length ? projects.map(p => `
          <div class="mb-8" style="cursor:pointer" onclick="openProjectModal('${p.id}')">
            <div class="flex-between small" style="margin-bottom:3px"><span>${esc(p.title)}</span><span class="muted">${projectProgress(p)}%</span></div>
            <div class="progress"><div style="width:${projectProgress(p)}%"></div></div>
          </div>
        `).join('') : emptyState(icon('folder', 22, 1.4), 'No active projects.')}
      </div>
      <div class="card card-pad">
        <div class="flex-between mb-8"><h3 style="font-size:15px">Recent notes</h3><a class="small" style="color:var(--accent);cursor:pointer" onclick="setState({route:'notebook'})">View all →</a></div>
        ${recentNotes.length ? recentNotes.map(n => `
          <div class="list-row" onclick="setState({route:'notebook',notebookSelected:'${n.id}'})">
            <span class="nb-note-ic">${icon('file-text', 14)}</span>
            <div class="row-title">${esc(n.name)}</div>
            <div class="row-meta">${fmtRelativeTime(n.updatedAt)}</div>
          </div>
        `).join('') : emptyState(icon('book-open', 22, 1.4), 'No notes yet.')}
      </div>
    </div>` : ''}

    <div class="card card-pad">
      <div class="flex-gap">
        <input class="input" id="quick-add-input" placeholder="Quick add a to-do… (press Enter)" onkeydown="if(event.key==='Enter')quickAddTodo()">
        <select class="select" id="quick-add-course" style="width:170px">
          <option value="">No course</option>${courseOptions()}
        </select>
        <button class="btn btn-primary" onclick="quickAddTodo()">Add</button>
      </div>
    </div>
  `;
}

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
