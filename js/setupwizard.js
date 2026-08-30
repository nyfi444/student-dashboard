/* ── Semester setup wizard: name+dates → courses → class times →
   syllabi → colors → weekly study goal → done ──────────────────── */
const WIZARD_STEPS = ['Semester', 'Courses', 'Class times', 'Syllabi', 'Colors', 'Study goal', 'Done'];

function openSemesterSetupWizard() {
  window._wizard = {
    step: 0,
    semester: { name: '', startDate: todayIso(), endDate: addDays(todayIso(), 110) },
    courses: [],
    weeklyStudyGoalMinutes: state.settings.weeklyStudyGoalMinutes || 300,
  };
  renderWizardStep();
}
function wizNewCourse() { return { _wid: uid(), name: '', code: '', credits: 3, color: '#000000', meetings: [], resources: [], syllabusStatus: '' }; }

function renderWizardStep() {
  const w = window._wizard;
  const stepBody = [wizStep0, wizStep1, wizStep2, wizStep3, wizStep4, wizStep5, wizStepDone][w.step]();
  const isLast = w.step === WIZARD_STEPS.length - 1;
  openModal(`
    <div class="modal-head"><h3>Semester setup</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="small muted mb-16">Step ${w.step + 1} of ${WIZARD_STEPS.length} — ${WIZARD_STEPS[w.step]}</div>
      ${stepBody}
    </div>
    <div class="modal-foot">
      ${w.step > 0 && !isLast ? `<button class="btn" onclick="wizBack()">Back</button>` : ''}
      ${!isLast ? `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="wizNext()">Next</button>` : `<button class="btn btn-primary" onclick="wizFinish()">Done — go to dashboard</button>`}
    </div>
  `, { wide: true });
  if (w.step === 4) w.courses.forEach((c, i) => wireColorWheel(`wiz-color-${i}`, () => window._wizard.courses[i].color, (hex) => { window._wizard.courses[i].color = hex; }));
}
function wizBack() { window._wizard.step--; renderWizardStep(); }
function wizNext() {
  const w = window._wizard;
  if (w.step === 0) {
    const name = $('#wiz-name').value.trim();
    if (!name) { toast('Name this semester', 'error'); return; }
    w.semester = { name, startDate: $('#wiz-start').value, endDate: $('#wiz-end').value };
  }
  if (w.step === 5) w.weeklyStudyGoalMinutes = Number($('#wiz-studygoal').value) || 0;
  w.step++;
  renderWizardStep();
}

function wizStep0() {
  const w = window._wizard;
  return `
    <div class="field"><label>Semester name</label><input class="input" id="wiz-name" value="${esc(w.semester.name)}" placeholder="Sophomore Fall"></div>
    <div class="field-row">
      <div class="field"><label>Start date</label><input class="input" type="date" id="wiz-start" value="${w.semester.startDate}"></div>
      <div class="field"><label>End date</label><input class="input" type="date" id="wiz-end" value="${w.semester.endDate}"></div>
    </div>
  `;
}
function wizStep1() {
  const w = window._wizard;
  return `
    <div class="small muted mb-8">Add each course you're taking — you can fill in details like grading later.</div>
    <div id="wiz-courses">${w.courses.map((c, i) => `
      <div class="field-row" style="align-items:center;margin-bottom:6px">
        <input class="input" placeholder="Course name" value="${esc(c.name)}" oninput="window._wizard.courses[${i}].name=this.value">
        <input class="input" placeholder="Code" style="max-width:110px" value="${esc(c.code)}" oninput="window._wizard.courses[${i}].code=this.value">
        <input class="input" type="number" placeholder="Credits" style="max-width:90px" value="${c.credits}" oninput="window._wizard.courses[${i}].credits=Number(this.value)||0">
        <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove course" onclick="window._wizard.courses.splice(${i},1);renderWizardStep()">${icon('x',13,2.2)}</button>
      </div>
    `).join('') || '<div class="small muted mb-8">No courses added yet.</div>'}</div>
    <button class="btn btn-sm mt-8" onclick="window._wizard.courses.push(wizNewCourse());renderWizardStep()">+ Add course</button>
  `;
}
function wizStep2() {
  const w = window._wizard;
  if (!w.courses.length) return `<div class="small muted">No courses to schedule yet — go back and add some, or skip ahead.</div>`;
  return w.courses.map((c, ci) => `
    <div class="card card-pad mb-16">
      <div style="font-weight:600;margin-bottom:8px">${esc(c.name || 'Untitled course')}</div>
      <div id="wiz-meet-${ci}">${c.meetings.map((m, mi) => `
        <div class="field-row" style="align-items:center;margin-bottom:6px">
          <select class="select" style="max-width:110px" onchange="window._wizard.courses[${ci}].meetings[${mi}].day=Number(this.value)">${DOW_NAMES.map((d, di) => `<option value="${di}" ${di === m.day ? 'selected' : ''}>${d}</option>`).join('')}</select>
          <input class="input" type="time" value="${m.start}" style="max-width:120px" onchange="window._wizard.courses[${ci}].meetings[${mi}].start=this.value">
          <input class="input" type="time" value="${m.end}" style="max-width:120px" onchange="window._wizard.courses[${ci}].meetings[${mi}].end=this.value">
          <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove meeting" onclick="window._wizard.courses[${ci}].meetings.splice(${mi},1);renderWizardStep()">${icon('x',13,2.2)}</button>
        </div>
      `).join('')}</div>
      <button class="btn btn-sm" onclick="window._wizard.courses[${ci}].meetings.push({day:1,start:'10:00',end:'11:00'});renderWizardStep()">+ Add meeting time</button>
    </div>
  `).join('');
}
function wizStep3() {
  const w = window._wizard;
  if (!w.courses.length) return `<div class="small muted">No courses yet — go back and add some, or skip ahead.</div>`;
  if (!aiEnabled()) return `<div class="small" style="background:var(--warn-light);color:var(--warn);padding:10px 12px;border-radius:10px">AI syllabus parsing isn’t set up on this deployment yet. You can skip this step and add syllabi later from Courses.</div>`;
  return w.courses.map((c, ci) => `
    <div class="card card-pad mb-16">
      <div style="font-weight:600;margin-bottom:8px">${esc(c.name || 'Untitled course')}</div>
      <div class="upload-drop" onclick="$('#wiz-syl-${ci}').click()">
        <div class="small">Click to choose a PDF syllabus</div>
        <input type="file" id="wiz-syl-${ci}" accept="application/pdf" style="display:none" onchange="wizUploadSyllabus(${ci}, this.files[0])">
      </div>
      <div class="small muted mt-8">${esc(c.syllabusStatus)}</div>
    </div>
  `).join('');
}
async function wizUploadSyllabus(ci, file) {
  if (!file) return;
  const w = window._wizard;
  w.courses[ci].syllabusStatus = 'Reading PDF…';
  renderWizardStep();
  try {
    const text = await extractPdfText(file);
    w.courses[ci].syllabusStatus = 'Asking AI to fill in course details…';
    const data = await aiParseSyllabus({ text });
    const c = w.courses[ci];
    c.name = data.name || c.name;
    c.code = data.code || c.code;
    c.instructor = data.instructor || c.instructor;
    c.location = data.location || c.location;
    c.credits = data.credits || c.credits;
    if (Array.isArray(data.meetings) && data.meetings.length) c.meetings = data.meetings;
    c._pendingAssignments = data.assignments || [];
    c.syllabusStatus = 'Filled in from syllabus ✓';
  } catch (e) {
    w.courses[ci].syllabusStatus = e.message || 'Could not read that syllabus.';
  }
  renderWizardStep();
}
function wizStep4() {
  const w = window._wizard;
  if (!w.courses.length) return `<div class="small muted">No courses yet — go back and add some, or skip ahead.</div>`;
  return w.courses.map((c, i) => `
    <div class="field-row mb-16" style="align-items:center">
      <div style="width:100px;font-weight:600">${esc(c.name || 'Untitled')}</div>
      <div style="flex:1">${colorWheelHtml(`wiz-color-${i}`, c.color)}</div>
    </div>
  `).join('');
}
function wizStep5() {
  const w = window._wizard;
  return `<div class="field"><label>Weekly study goal (minutes)</label><input class="input" type="number" id="wiz-studygoal" value="${w.weeklyStudyGoalMinutes}"></div><div class="small muted">Shown on your dashboard and in Today mode.</div>`;
}
function wizStepDone() {
  const w = window._wizard;
  return `
    <div class="empty">
      <div class="ic">${icon('check-square', 30, 1.4)}</div>
      <p>Your semester is ready.</p>
      <div class="empty-sub">${esc(w.semester.name)} · ${w.courses.length} course${w.courses.length === 1 ? '' : 's'}</div>
    </div>
  `;
}
function wizFinish() {
  const w = window._wizard;
  const newSem = { id: uid(), name: w.semester.name, startDate: w.semester.startDate, endDate: w.semester.endDate, archived: false };
  state.semesters.push(newSem);
  w.courses.filter(c => c.name.trim()).forEach(c => {
    state.courses.push({
      id: uid(), semesterId: newSem.id, name: c.name.trim(), code: c.code || '', instructor: c.instructor || '',
      color: c.color || '#000000', credits: c.credits || 0, location: c.location || '', status: 'in-progress', requirementType: 'elective',
      meetings: c.meetings || [], resources: [], syllabusRaw: '',
    });
    (c._pendingAssignments || []).forEach(a => {
      state.assignments.push({
        id: uid(), courseId: state.courses.at(-1).id, title: a.title, type: ASSIGNMENT_TYPES.includes(a.type) ? a.type : 'assignment',
        dueDate: a.dueDate || addDays(todayIso(), 7), dueTime: a.dueTime || '23:59', startByDate: null,
        maxPoints: a.maxPoints || null, earnedPoints: null, status: 'not-started', rubric: [], notes: '', attachments: [], recurringTemplateId: null,
      });
    });
  });
  state.settings.weeklyStudyGoalMinutes = w.weeklyStudyGoalMinutes;
  setState({ currentSemesterId: newSem.id });
  closeModal();
  toast(`${newSem.name} is ready!`);
}
