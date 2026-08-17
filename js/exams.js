/* ── Exam tracker: countdowns pulled straight from assignments ──── */
function pageExams() {
  const exams = state.assignments
    .filter(a => a.type === 'exam' && activeCourses().some(c => c.id === a.courseId))
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  const upcoming = exams.filter(e => daysBetween(e.dueDate) >= 0);
  const past = exams.filter(e => daysBetween(e.dueDate) < 0);

  return `
    ${pageHead('Exam Tracker', `${upcoming.length} upcoming`, `<button class="btn btn-primary" onclick="openAssignmentModal(null);setTimeout(()=>{if($('#af-type'))$('#af-type').value='exam'},0)">+ Add exam</button>`)}
    <div class="grid grid-3 mb-16">
      ${upcoming.length ? upcoming.map(examCard).join('') : `<div style="grid-column:1/-1">${emptyState(icon('check-square',26,1.4), 'No exams on the horizon.')}</div>`}
    </div>
    ${past.length ? `<h3 style="font-size:15px" class="mb-8 muted">Past exams</h3><div class="card">${past.map(e => `
      <div class="list-row" style="border-bottom:1px solid var(--border)" onclick="openAssignmentModal('${e.id}')">
        ${courseChip(e.courseId)}<div class="row-title">${esc(e.title)}</div>
        <div class="row-meta">${fmtDate(e.dueDate)}</div>
        ${e.earnedPoints != null && e.maxPoints ? `<span class="small">${e.earnedPoints}/${e.maxPoints}</span>` : ''}
      </div>`).join('')}</div>` : ''}
  `;
}
function examCard(e) {
  const d = daysBetween(e.dueDate);
  const urgent = d <= 3;
  return `
    <div class="card card-pad" style="border-top:3px solid ${getCourseColor(e.courseId)};cursor:pointer" onclick="openAssignmentModal('${e.id}')">
      ${courseChip(e.courseId)}
      <div style="font-weight:700;margin-top:8px">${esc(e.title)}</div>
      <div class="small muted">${fmtDateLong(e.dueDate)}${e.dueTime ? ' · ' + fmtTime(e.dueTime) : ''}</div>
      <div style="font-family:var(--font-serif);font-size:30px;font-weight:600;margin-top:10px;color:${urgent ? 'var(--danger)' : 'var(--text)'}">${d === 0 ? 'Today' : d + 'd'}</div>
      ${e.notes ? `<div class="small muted mt-8">${esc(e.notes)}</div>` : ''}
    </div>
  `;
}
