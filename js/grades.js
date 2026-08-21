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
      <div class="stat-card"><div class="num ${gpa == null ? 'stat-dash' : ''}">${gpa != null ? gpa.toFixed(2) : '—'}</div><div class="lbl">${gpa != null ? 'Semester GPA' : 'Add a grade to see your GPA'}</div></div>
      <div class="stat-card"><div class="num">${activeCourses().reduce((s, c) => s + (c.credits || 0), 0)}</div><div class="lbl">Total credits</div></div>
      <div class="stat-card"><div class="num ${currentSemester()?.targetGPA == null ? 'stat-dash' : ''}">${currentSemester()?.targetGPA != null ? currentSemester().targetGPA.toFixed(2) : '—'}</div><div class="lbl">Target GPA</div></div>
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
          ? `<div style="font-family:var(--font-serif);font-style:italic;font-size:24px;color:${c.color}">${display}</div>`
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
      <button class="btn btn-sm mt-8" onclick="openGradeCalcModal('${c.id}')">${icon('target', 13, 2)} What grade do I need?</button>
    </div>
  `;
}
function setGradeOverride(courseId, val) {
  const c = getCourse(courseId);
  c.finalGradeOverride = val === '' ? null : Number(val);
  touch();
}

/* ── "What grade do I need?" calculator ──────────────────────────
   Treats the remaining item's weight as the share of the final grade
   not yet accounted for, so current grade + remaining weight is
   assumed to add up to 100% of the course. ──────────────────────── */
function openGradeCalcModal(courseId) {
  const c = getCourse(courseId);
  const g = computeCourseGrade(c);
  openModal(`
    <div class="modal-head"><h3>What grade do I need?</h3><button class="close-x" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="small muted mb-16">${esc(c.name)}</div>
      <div class="field"><label>Current grade so far (%)</label><input class="input" type="number" id="gc-current" value="${g.pct != null ? g.pct.toFixed(1) : ''}" oninput="renderGradeCalcResults('${courseId}')"></div>
      <div class="field"><label>Weight of what's left (%)</label><input class="input" type="number" id="gc-weight" placeholder="e.g. 30 for a final exam" oninput="renderGradeCalcResults('${courseId}')"></div>
      <div class="field"><label>Desired final grade (%)</label><input class="input" type="number" id="gc-desired" placeholder="e.g. 90" oninput="renderGradeCalcResults('${courseId}')"></div>
      <div class="divider"></div>
      <div id="gc-result-need"></div>
      <div class="divider"></div>
      <div class="field" style="margin-bottom:8px"><label>Or: if you score this on what's left (%)</label><input class="input" type="number" id="gc-hypothetical" placeholder="e.g. 80" oninput="renderGradeCalcResults('${courseId}')"></div>
      <div id="gc-result-hypo"></div>
    </div>
    <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">Done</button></div>
  `);
}
function renderGradeCalcResults(courseId) {
  const c = getCourse(courseId);
  const current = Number($('#gc-current').value);
  const weight = Number($('#gc-weight').value);
  const desired = Number($('#gc-desired').value);
  const hypothetical = Number($('#gc-hypothetical').value);
  const validBase = weight > 0 && weight <= 100 && !isNaN(current);
  const keptShare = validBase ? (1 - weight / 100) : 0;

  const needEl = $('#gc-result-need');
  if (validBase && $('#gc-desired').value !== '' && !isNaN(desired)) {
    const needed = (desired - current * keptShare) / (weight / 100);
    needEl.innerHTML = needed > 100
      ? `<div class="small" style="color:var(--danger)">Not possible — you'd need ${needed.toFixed(1)}% on the remaining ${weight}%. Consider adjusting your target.</div>`
      : needed < 0
      ? `<div class="small" style="color:var(--success)">You've already secured a ${desired}% or better — even a 0% would work.</div>`
      : `<div class="small" style="font-size:15px"><strong>You need ${needed.toFixed(1)}%</strong> on the remaining ${weight}% to finish with ${desired}% (${letterFor(desired).letter}).</div>`;
  } else {
    needEl.innerHTML = `<div class="small muted">Fill in your current grade, remaining weight, and desired grade.</div>`;
  }

  const hypoEl = $('#gc-result-hypo');
  if (validBase && $('#gc-hypothetical').value !== '' && !isNaN(hypothetical)) {
    const final = current * keptShare + hypothetical * (weight / 100);
    hypoEl.innerHTML = `<div class="small" style="font-size:15px"><strong>Your final grade would be ${final.toFixed(1)}%</strong> (${letterFor(final).letter}).</div>`;
  } else {
    hypoEl.innerHTML = '';
  }
}
