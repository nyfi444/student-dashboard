/* ── Grades & GPA ─────────────────────────────────────────────── */
const GRADE_SCALE = [
  { min: 93, letter: 'A', points: 4.0 }, { min: 90, letter: 'A-', points: 3.7 },
  { min: 87, letter: 'B+', points: 3.3 }, { min: 83, letter: 'B', points: 3.0 }, { min: 80, letter: 'B-', points: 2.7 },
  { min: 77, letter: 'C+', points: 2.3 }, { min: 73, letter: 'C', points: 2.0 }, { min: 70, letter: 'C-', points: 1.7 },
  { min: 67, letter: 'D+', points: 1.3 }, { min: 63, letter: 'D', points: 1.0 }, { min: 60, letter: 'D-', points: 0.7 },
  { min: 0, letter: 'F', points: 0 },
];
function letterFor(pct) { return GRADE_SCALE.find(g => pct >= g.min) || GRADE_SCALE.at(-1); }

function categoryPercent(course, categoryId) {
  const items = state.assignments.filter(a => a.courseId === course.id && a.category === categoryId && a.maxPoints);
  const graded = items.filter(a => a.earnedPoints != null);
  if (!graded.length) return null;
  const pct = graded.reduce((s, a) => s + (a.earnedPoints / a.maxPoints), 0) / graded.length * 100;
  return { pct, gradedCount: graded.length, totalCount: items.length };
}
function computeCourseGrade(course) {
  if (course.finalGradeOverride != null) return { pct: course.finalGradeOverride, complete: true, breakdown: [] };
  let weightedSum = 0, weightUsed = 0;
  const breakdown = course.gradingBreakdown.map(cat => {
    const r = categoryPercent(course, cat.id);
    if (r) { weightedSum += r.pct * cat.weight; weightUsed += Number(cat.weight); }
    return { ...cat, result: r };
  });
  if (weightUsed === 0) return { pct: null, complete: false, breakdown };
  return { pct: weightedSum / weightUsed, complete: weightUsed >= 99, breakdown };
}
function computeGPA() {
  const graded = activeCourses().map(c => ({ c, g: computeCourseGrade(c) })).filter(x => x.g.pct != null);
  if (!graded.length) return null;
  const totalCredits = graded.reduce((s, x) => s + (x.c.credits || 1), 0);
  const points = graded.reduce((s, x) => s + letterFor(x.g.pct).points * (x.c.credits || 1), 0);
  return totalCredits ? points / totalCredits : null;
}

function pageGrades() {
  const gpa = computeGPA();
  return `
    ${pageHead('Grades & GPA', 'Weighted by each course’s grading breakdown', `
      <div class="segmented">
        <button class="${state.settings.gradeScale === '4.0' ? 'active' : ''}" onclick="setGradeScale('4.0')">4.0 scale</button>
        <button class="${state.settings.gradeScale === 'percentage' ? 'active' : ''}" onclick="setGradeScale('percentage')">Percentage</button>
      </div>
    `)}
    <div class="grid grid-3 mb-16">
      <div class="stat-card"><div class="num ${gpa != null ? 'num-hero' : 'stat-dash'}">${gpa != null ? gpa.toFixed(2) : '—'}</div><div class="lbl">${gpa != null ? 'Semester GPA' : 'Add a grade to see your GPA'}</div></div>
      <div class="stat-card"><div class="num">${activeCourses().reduce((s, c) => s + (c.credits || 0), 0)}</div><div class="lbl">Total credits</div></div>
      <div class="stat-card"><div class="num">${activeCourses().length}</div><div class="lbl">Courses</div></div>
    </div>
    <div class="grid grid-2">
      ${activeCourses().map(gradeCourseCard).join('') || emptyState(icon('target',26,1.4), 'No courses yet', '', 'Add a course and log a few grades — your GPA will show up here automatically.')}
    </div>
  `;
}
function setGradeScale(s) { state.settings.gradeScale = s; touch(); }
function gradeCourseCard(c) {
  const g = computeCourseGrade(c);
  const display = g.pct == null ? null : state.settings.gradeScale === '4.0' ? letterFor(g.pct).letter + ` (${letterFor(g.pct).points.toFixed(1)})` : g.pct.toFixed(1) + '%';
  return `
    <div class="card card-pad">
      <div class="flex-between">
        <div><div style="font-weight:700">${esc(c.name)}</div><div class="small muted">${c.credits || 0} credits</div></div>
        ${display
          ? `<div style="font-family:var(--font-serif);font-size:22px;font-weight:600;color:${c.color}">${display}</div>`
          : `<div class="small stat-dash" style="font-style:italic">No grades yet</div>`}
      </div>
      <div class="divider"></div>
      ${g.breakdown.map(b => `
        <div class="mb-8">
          <div class="flex-between small" style="margin-bottom:3px"><span>${esc(b.name)} <span class="muted">(${b.weight}%)</span></span><span class="muted">${b.result ? b.result.pct.toFixed(0) + '%' : '—'}</span></div>
          <div class="progress"><div style="width:${b.result ? b.result.pct : 0}%;background:${c.color}"></div></div>
        </div>
      `).join('') || `<div class="small muted">No grading breakdown set — edit the course to add categories.</div>`}
      <div class="field mt-16" style="margin-bottom:0">
        <label>Manual override (optional)</label>
        <input class="input" type="number" placeholder="e.g. 91 for a known final grade" value="${c.finalGradeOverride ?? ''}" onchange="setGradeOverride('${c.id}', this.value)">
      </div>
    </div>
  `;
}
function setGradeOverride(courseId, val) {
  const c = getCourse(courseId);
  c.finalGradeOverride = val === '' ? null : Number(val);
  touch();
}
