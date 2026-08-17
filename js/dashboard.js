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
  const todaysClasses = activeCourses()
    .flatMap(c => c.meetings.filter(m => m.day === dow).map(m => ({ ...m, course: c })))
    .sort((a, b) => a.start.localeCompare(b.start));

  const openTodos = state.todos.filter(t => !t.done && (t.courseId === null || activeCourses().some(c => c.id === t.courseId)));

  return `
    ${pageHead(`${greeting}${name}`, fmtDateLong(todayIso()))}

    <div class="grid grid-4 mb-8">
      <div class="stat-card"><div class="num">${gpa != null ? gpa.toFixed(2) : '—'}</div><div class="lbl">Current GPA</div></div>
      <div class="stat-card"><div class="num">${dueThisWeek.length}</div><div class="lbl">Due this week</div></div>
      <div class="stat-card"><div class="num" style="color:${overdue.length ? 'var(--danger)' : 'inherit'}">${overdue.length}</div><div class="lbl">Overdue</div></div>
      <div class="stat-card"><div class="num">${openTodos.length}</div><div class="lbl">Open to-dos</div></div>
    </div>

    <div class="grid grid-2" style="align-items:start">
      <div class="card card-pad">
        <div class="flex-between mb-8"><h3 style="font-size:15px">What's due this week</h3><span class="pill" style="background:var(--accent-light);color:var(--accent)">${dueThisWeek.length}</span></div>
        ${dueThisWeek.length ? dueThisWeek.map(a => `
          <div class="list-row" onclick="openAssignmentModal('${a.id}')">
            <div class="row-check ${a.status === 'done' ? 'checked' : ''}" onclick="event.stopPropagation();toggleAssignmentDone('${a.id}')">${a.status === 'done' ? checkGlyph(true) : ''}</div>
            <div class="row-title">${esc(a.title)} ${typeTag(a.type)}</div>
            ${courseChip(a.courseId)}
            <div class="row-meta">${relativeDay(a.dueDate)}</div>
          </div>`).join('') : emptyState(icon('cloud-sun',26,1.4), 'Nothing due in the next 7 days.')}
        ${overdue.length ? `<div class="divider"></div><div class="small" style="color:var(--danger);font-weight:600;margin-bottom:6px">Overdue</div>${overdue.map(a => `
          <div class="list-row" onclick="openAssignmentModal('${a.id}')">
            <div class="row-check" onclick="event.stopPropagation();toggleAssignmentDone('${a.id}')"></div>
            <div class="row-title">${esc(a.title)}</div>${courseChip(a.courseId)}
            <div class="row-meta" style="color:var(--danger)">${relativeDay(a.dueDate)}</div>
          </div>`).join('')}` : ''}
      </div>

      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">Today's schedule</h3>
        ${todaysClasses.length ? todaysClasses.map(m => `
          <div class="list-row">
            <div class="pill-dot" style="background:${m.course.color}"></div>
            <div class="row-title">${esc(m.course.name)}</div>
            <div class="row-meta">${fmtTime(m.start)} – ${fmtTime(m.end)}</div>
          </div>`).join('') : emptyState(icon('book-open',26,1.4), 'No classes today.')}

        <div class="divider"></div>
        <div class="flex-between mb-8"><h3 style="font-size:15px">Upcoming exams</h3></div>
        ${upcomingExams.length ? upcomingExams.map(a => `
          <div class="list-row" onclick="openAssignmentModal('${a.id}')">
            <div class="pill-dot" style="background:${getCourseColor(a.courseId)}"></div>
            <div class="row-title">${esc(a.title)}</div>
            <div class="row-meta">${daysBetween(a.dueDate)}d away</div>
          </div>`).join('') : emptyState(icon('check-square',26,1.4), 'No exams in the next 3 weeks.')}
      </div>
    </div>

    <div class="card card-pad mt-16">
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
