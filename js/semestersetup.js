/* ── Semester setup: the first-run flow ───────────────────────────
   You → classes → class times → syllabi → study goal → done.
   Class times are edited as "slots" (a set of days sharing one time
   range, e.g. Mon/Wed 9:00–10:15), which is how students think about a
   schedule, and converted to one meeting per day when saved.
──────────────────────────────────────────────────────────────── */
const SETUP_STEPS = ['You', 'Classes', 'Class times', 'Syllabi', 'Study goal'];
const SETUP_DAYS = [[1, 'M'], [2, 'T'], [3, 'W'], [4, 'Th'], [5, 'F'], [6, 'Sa'], [0, 'Su']];

function suggestedSemesterName(d = new Date()) {
  const m = d.getMonth(), y = d.getFullYear();
  return m <= 4 ? `Spring ${y}` : m <= 6 ? `Summer ${y}` : `Fall ${y}`;
}
function openSemesterSetup() {
  const cur = currentSemester();
  const reuse = cur && !state.courses.some(c => c.semesterId === cur.id);
  window._setup = {
    step: 0,
    reuseSemesterId: reuse ? cur.id : null,
    displayName: state.settings.displayName || '',
    semester: {
      name: reuse && cur.name !== 'New Semester' ? cur.name : suggestedSemesterName(),
      startDate: reuse ? cur.startDate : todayIso(),
      endDate: reuse ? cur.endDate : addDays(todayIso(), 110),
    },
    courses: [setupNewCourse([])],
    weeklyStudyGoalMinutes: state.settings.weeklyStudyGoalMinutes || 300,
  };
  renderSetupStep();
}
function setupNewCourse(existing = window._setup?.courses || []) {
  return { _wid: uid(), name: '', code: '', credits: 3, color: nextCourseColor(existing.map(c => c.color)), slots: [], instructor: '', location: '', syllabusStatus: '', _pendingAssignments: [] };
}
function setupCourses() { return window._setup.courses.filter(c => c.name.trim()); }

function renderSetupStep() {
  const w = window._setup;
  const done = w.step >= SETUP_STEPS.length;
  const body = done ? setupStepDone() : [setupStepYou, setupStepClasses, setupStepTimes, setupStepSyllabi, setupStepGoal][w.step]();
  openModal(`
    <div class="modal-head">
      <h3>${done ? 'You’re all set' : 'Set up your semester'}</h3>
      <button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button>
    </div>
    ${done ? '' : `<div class="setup-progress" aria-label="Step ${w.step + 1} of ${SETUP_STEPS.length}">
      ${SETUP_STEPS.map((label, i) => `<div class="setup-step ${i < w.step ? 'done' : ''} ${i === w.step ? 'current' : ''}"><span class="setup-dot">${i < w.step ? icon('check', 10, 2.8) : i + 1}</span><span class="setup-label">${label}</span></div>`).join('')}
    </div>`}
    <div class="modal-body setup-body">${body}</div>
    <div class="modal-foot">
      ${done
        ? `<button class="btn btn-primary" onclick="closeModal()">Go to my dashboard</button>`
        : `${w.step > 0 ? `<button class="btn btn-ghost" style="margin-right:auto" onclick="setupBack()">${icon('arrow-left', 13, 1.9)} Back</button>` : ''}
           ${w.step === 3 || w.step === 2 ? `<button class="btn" onclick="setupNext(true)">Skip</button>` : ''}
           <button class="btn btn-primary" onclick="setupNext()">${w.step === SETUP_STEPS.length - 1 ? 'Finish setup' : 'Continue'}</button>`}
    </div>
  `, { wide: true });
  const first = $('.setup-body input:not([type=hidden])');
  if (first && !done && w.step < 2) setTimeout(() => { if (!first.value) first.focus(); }, 60);
}
function setupBack() { window._setup.step--; renderSetupStep(); }
function setupNext(skip) {
  const w = window._setup;
  if (w.step === 0) {
    const name = $('#setup-name').value.trim();
    if (!name) { toast('Give this semester a name', 'error'); return; }
    const startDate = $('#setup-start').value, endDate = $('#setup-end').value;
    if (!startDate || !endDate || endDate <= startDate) { toast('The end date needs to be after the start date', 'error'); return; }
    w.semester = { name, startDate, endDate };
    w.displayName = $('#setup-you').value.trim();
  }
  if (w.step === 1 && !skip && !setupCourses().length) { toast('Add at least one class to continue. You can upload its syllabus in a later step.', 'error'); return; }
  if (w.step === 4) { w.weeklyStudyGoalMinutes = Math.round(Number($('#setup-goal').value) * 60); setupFinish(); }
  w.step++;
  renderSetupStep();
}

function setupStepYou() {
  const w = window._setup;
  return `
    <p class="setup-lede">A few basics first. You can change any of this later in Settings.</p>
    <div class="field"><label for="setup-you">What should we call you?</label><input class="input" id="setup-you" value="${esc(w.displayName)}" placeholder="First name" autocomplete="given-name"></div>
    <div class="field"><label for="setup-name">Semester</label><input class="input" id="setup-name" value="${esc(w.semester.name)}" placeholder="Fall 2026"></div>
    <div class="field-row">
      <div class="field"><label for="setup-start">First day of classes</label><input class="input" type="date" id="setup-start" value="${esc(w.semester.startDate)}"></div>
      <div class="field"><label for="setup-end">Last day of finals</label><input class="input" type="date" id="setup-end" value="${esc(w.semester.endDate)}"></div>
    </div>`;
}
function setupStepClasses() {
  const w = window._setup;
  return `
    <p class="setup-lede">List your classes. Only the name is required. If you have syllabi handy, you can upload them in a couple of steps and the rest fills in.</p>
    ${w.courses.map((c, i) => `
      <div class="setup-course" style="--course:${esc(c.color)}">
        <div class="setup-course-row">
          <span class="course-dot setup-course-dot"></span>
          <input class="input" placeholder="Class name, like Organic Chemistry" value="${esc(c.name)}" aria-label="Class name" oninput="window._setup.courses[${i}].name=this.value" onkeydown="if(event.key==='Enter'){window._setup.courses.push(setupNewCourse());renderSetupStep();setTimeout(()=>$$('.setup-course input')[${(i + 1) * 3}]?.focus(),80)}">
          <input class="input setup-code" placeholder="Code" value="${esc(c.code)}" aria-label="Course code" oninput="window._setup.courses[${i}].code=this.value">
          <input class="input setup-credits" type="number" min="0" max="12" value="${c.credits}" aria-label="Credits" title="Credits" oninput="window._setup.courses[${i}].credits=Number(this.value)||0">
          <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove class" onclick="window._setup.courses.splice(${i},1);if(!window._setup.courses.length)window._setup.courses.push(setupNewCourse());renderSetupStep()">${icon('x', 13, 2.2)}</button>
        </div>
        <div class="setup-swatches" role="group" aria-label="Color">${COURSE_PALETTE.map(p => `<button class="setup-swatch ${p === c.color ? 'active' : ''}" style="background:${p}" aria-label="Color ${p}" onclick="window._setup.courses[${i}].color='${p}';renderSetupStep()"></button>`).join('')}</div>
      </div>`).join('')}
    <button class="btn btn-sm" onclick="window._setup.courses.push(setupNewCourse());renderSetupStep()">+ Add another class</button>
    <div class="small muted mt-8">Columns: name, course code, credits.</div>`;
}
function setupStepTimes() {
  const courses = setupCourses();
  if (!courses.length) return `<p class="setup-lede">No classes yet, so there’s nothing to schedule. Skip ahead and upload syllabi instead.</p>`;
  return `
    <p class="setup-lede">When does each class meet? Tap the days, then set the time. Classes that meet at different times on different days can have more than one row.</p>
    ${courses.map(c => {
      const ci = window._setup.courses.indexOf(c);
      if (!c.slots.length) c.slots.push({ days: [], start: '10:00', end: '11:15' });
      return `
        <div class="setup-course" style="--course:${esc(c.color)}">
          <div class="sg-strong mb-8"><span class="course-dot"></span> ${esc(c.name)}${c.code ? ` <span class="muted">${esc(c.code)}</span>` : ''}</div>
          ${c.slots.map((s, si) => `
            <div class="setup-slot">
              <div class="setup-days">${SETUP_DAYS.map(([d, l]) => `<button class="setup-day ${s.days.includes(d) ? 'active' : ''}" aria-pressed="${s.days.includes(d)}" onclick="setupToggleDay(${ci},${si},${d})">${l}</button>`).join('')}</div>
              <input class="input" type="time" value="${esc(s.start)}" aria-label="Start time" onchange="window._setup.courses[${ci}].slots[${si}].start=this.value">
              <span class="muted">to</span>
              <input class="input" type="time" value="${esc(s.end)}" aria-label="End time" onchange="window._setup.courses[${ci}].slots[${si}].end=this.value">
              ${c.slots.length > 1 ? `<button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove time" onclick="window._setup.courses[${ci}].slots.splice(${si},1);renderSetupStep()">${icon('x', 13, 2.2)}</button>` : ''}
            </div>`).join('')}
          <button class="sg-link mt-8" onclick="window._setup.courses[${ci}].slots.push({days:[],start:'13:00',end:'14:15'});renderSetupStep()">+ Different time on other days</button>
        </div>`;
    }).join('')}`;
}
function setupToggleDay(ci, si, d) {
  const s = window._setup.courses[ci].slots[si];
  s.days = s.days.includes(d) ? s.days.filter(x => x !== d) : [...s.days, d];
  renderSetupStep();
}
function setupStepSyllabi() {
  const courses = setupCourses();
  if (!courses.length) return `<p class="setup-lede">Add a class first, then come back to upload its syllabus.</p>`;
  if (!aiEnabled()) return `<p class="setup-lede">Syllabus reading isn’t available on this deployment. You can skip this step.</p>`;
  return `
    <p class="setup-lede">Upload a syllabus (PDF or photos) for each class, and Semester HQ pulls out meeting times and every deadline and exam. You’ll be able to review everything afterward.</p>
    ${courses.map(c => {
      const ci = window._setup.courses.indexOf(c);
      const found = c._pendingAssignments.length;
      return `
        <div class="setup-course setup-syllabus" style="--course:${esc(c.color)}">
          <div style="min-width:0;flex:1">
            <div class="sg-strong"><span class="course-dot"></span> ${esc(c.name)}</div>
            <div class="small ${found ? '' : 'muted'}">${c.syllabusStatus ? esc(c.syllabusStatus) : 'No syllabus yet'}</div>
          </div>
          <label class="btn btn-sm ${found ? '' : 'btn-primary'}">${icon('upload', 13, 1.8)} ${found ? 'Replace' : 'Upload'}
            <input type="file" accept="application/pdf,image/*" multiple style="display:none" onchange="setupUploadSyllabus(${ci}, this.files)">
          </label>
        </div>`;
    }).join('')}`;
}
async function setupUploadSyllabus(ci, files) {
  if (!files || !files.length) return;
  const c = window._setup.courses[ci];
  c.syllabusStatus = 'Reading…';
  renderSetupStep();
  try {
    const list = Array.from(files);
    let data;
    if (list[0].type === 'application/pdf') {
      const text = await withTimeout(extractPdfText(list[0]), 30000, 'Timed out reading this PDF');
      if (!text.trim()) throw new Error('No text found in that PDF. Try uploading photos of it instead.');
      c.syllabusStatus = 'Pulling out dates and grading…';
      renderSetupStep();
      data = await aiParseSyllabus({ text });
    } else {
      const images = await Promise.all(list.map(async f => ({ base64: await fileToBase64(f), mediaType: f.type || 'image/jpeg' })));
      c.syllabusStatus = 'Pulling out dates and grading…';
      renderSetupStep();
      data = await aiParseSyllabus({ images });
    }
    c.code = c.code || data.code || '';
    c.instructor = data.instructor || c.instructor;
    c.location = data.location || c.location;
    if (data.credits) c.credits = data.credits;
    if (Array.isArray(data.meetings) && data.meetings.length) c.slots = meetingsToSlots(data.meetings);
    c._pendingAssignments = (data.assignments || []).filter(a => a && a.title);
    const bits = [
      c._pendingAssignments.length ? `${c._pendingAssignments.length} deadline${c._pendingAssignments.length === 1 ? '' : 's'}` : '',
      data.meetings?.length ? 'class times' : '',
    ].filter(Boolean);
    c.syllabusStatus = bits.length ? `Found ${bits.join(' and ')}` : 'Read it, but didn’t find any dates';
  } catch (e) {
    c.syllabusStatus = e.message || 'Couldn’t read that syllabus.';
  }
  if (window._setup && document.querySelector('.setup-body')) renderSetupStep();
}
function meetingsToSlots(meetings) {
  const slots = [];
  meetings.forEach(m => {
    if (m == null || m.day == null || !m.start) return;
    const s = slots.find(x => x.start === m.start && x.end === m.end);
    if (s) { if (!s.days.includes(Number(m.day))) s.days.push(Number(m.day)); }
    else slots.push({ days: [Number(m.day)], start: m.start, end: m.end || addMinutesHHMM(m.start, 60) });
  });
  return slots;
}
function setupStepGoal() {
  const hours = Math.round((window._setup.weeklyStudyGoalMinutes || 0) / 60);
  return `
    <p class="setup-lede">How many hours a week do you want to study outside class? A common rule of thumb is about 2 hours per credit, but pick something you’ll actually hit.</p>
    <div class="setup-goal">
      <div class="setup-goal-num"><strong id="setup-goal-val">${hours}</strong><span>hours / week</span></div>
      <input type="range" id="setup-goal" min="0" max="30" step="1" value="${hours}" oninput="$('#setup-goal-val').textContent=this.value" aria-label="Weekly study goal in hours">
      <div class="flex-gap wrap" style="justify-content:center">${[3, 5, 8, 12].map(h => `<button class="chip" onclick="$('#setup-goal').value=${h};$('#setup-goal-val').textContent=${h}">${h} hrs</button>`).join('')}</div>
    </div>`;
}
function setupStepDone() {
  const r = window._setup.result || { courses: 0, assignments: 0 };
  return `
    <div class="setup-done">
      <div class="setup-done-mark">${icon('check', 26, 2.4)}</div>
      <h3 class="welcome-title" style="font-size:30px">${esc(window._setup.semester.name)} is ready.</h3>
      <p class="muted">${r.courses} class${r.courses === 1 ? '' : 'es'}${r.assignments ? ` · ${r.assignments} deadlines` : ''}</p>
      <div class="setup-next">
        <button class="gs-step" onclick="closeModal();setState({route:'studygroups',subRoute:null})"><span class="gs-check">${icon('users', 13, 1.8)}</span><span><span class="gs-label">Start a study group</span><span class="gs-sub">Invite classmates with a link</span></span></button>
        <button class="gs-step" onclick="closeModal();openAssignmentUploadModal()"><span class="gs-check">${icon('upload', 13, 1.8)}</span><span><span class="gs-label">Add more deadlines</span><span class="gs-sub">Upload an assignment sheet</span></span></button>
        <button class="gs-step" onclick="closeModal();setState({route:'calendar',calView:'week',subRoute:null})"><span class="gs-check">${icon('calendar', 13, 1.8)}</span><span><span class="gs-label">See your week</span><span class="gs-sub">Classes are already on your calendar</span></span></button>
      </div>
    </div>`;
}
function setupFinish() {
  const w = window._setup;
  let semId = w.reuseSemesterId;
  if (semId && state.semesters.some(s => s.id === semId)) {
    Object.assign(state.semesters.find(s => s.id === semId), w.semester);
  } else {
    semId = uid();
    state.semesters.push({ id: semId, ...w.semester, archived: false });
  }
  if (w.displayName) state.settings.displayName = w.displayName;
  let assignments = 0;
  const courses = setupCourses();
  courses.forEach(c => {
    const id = uid();
    const meetings = c.slots.flatMap(s => s.days.map(day => ({ day, start: s.start, end: s.end }))).filter(m => m.start && m.end);
    state.courses.push({
      id, semesterId: semId, name: c.name.trim(), code: c.code.trim(), instructor: c.instructor || '',
      color: c.color, credits: Number(c.credits) || 0, location: c.location || '', status: 'in-progress', requirementType: 'required',
      meetings, resources: [], syllabusRaw: '',
    });
    c._pendingAssignments.forEach(a => {
      assignments++;
      state.assignments.push({
        id: uid(), courseId: id, title: a.title, type: ASSIGNMENT_TYPES.includes(a.type) ? a.type : 'assignment',
        dueDate: a.dueDate || null, dueTime: a.dueTime || '23:59', startByDate: null,
        maxPoints: a.maxPoints || null, earnedPoints: null, status: 'not-started', rubric: [], notes: '', attachments: [], recurringTemplateId: null,
      });
    });
  });
  state.settings.weeklyStudyGoalMinutes = w.weeklyStudyGoalMinutes;
  state.currentSemesterId = semId;
  state.route = 'dashboard'; state.subRoute = null;
  w.result = { courses: courses.length, assignments };
  touch();
}

/* ── Sample semester: a fully populated term for looking around ─── */
function loadSampleSemester() {
  if (state.settings.sampleData) return;
  const t = todayIso();
  const prevSemesterId = state.currentSemesterId;
  const semId = uid();
  state.semesters.push({ id: semId, name: `${suggestedSemesterName()} (sample)`, startDate: addDays(t, -24), endDate: addDays(t, 86), archived: false, sample: true });
  const course = (name, code, color, instructor, location, meetings) => ({
    id: uid(), semesterId: semId, name, code, instructor, color, credits: code.startsWith('MKT') ? 3 : 4, location, status: 'in-progress', requirementType: 'required',
    meetings, resources: [], syllabusRaw: '', sample: true,
  });
  const chem = course('Organic Chemistry', 'CHEM 210', COURSE_PALETTE[0], 'Dr. Patel', 'Science Hall 204', [{ day: 1, start: '09:00', end: '10:15' }, { day: 3, start: '09:00', end: '10:15' }]);
  const psy = course('Intro to Psychology', 'PSY 101', COURSE_PALETTE[1], 'Prof. Nguyen', 'Lecture Hall B', [{ day: 2, start: '11:00', end: '12:15' }, { day: 4, start: '11:00', end: '12:15' }]);
  const calc = course('Calculus II', 'MATH 152', COURSE_PALETTE[2], 'Dr. Rivera', 'Math Building 118', [{ day: 1, start: '13:00', end: '13:50' }, { day: 3, start: '13:00', end: '13:50' }, { day: 5, start: '13:00', end: '13:50' }]);
  const mkt = course('Marketing Strategy', 'MKT 300', COURSE_PALETTE[3], 'Prof. Okafor', 'Business School 310', [{ day: 2, start: '15:30', end: '16:45' }]);
  state.courses.push(chem, psy, calc, mkt);
  const A = (c, title, type, d, extra = {}) => ({ id: uid(), courseId: c.id, title, type, dueDate: addDays(t, d), dueTime: '23:59', startByDate: null, maxPoints: 100, earnedPoints: null, status: 'not-started', rubric: [], notes: '', attachments: [], recurringTemplateId: null, sample: true, ...extra });
  const done = () => ({ status: 'done' });
  state.assignments.push(
    A(chem, 'Lab report 1', 'lab', -17, done()), A(chem, 'Homework 1', 'assignment', -14, done()), A(chem, 'Quiz 1', 'quiz', -10, done()),
    A(chem, 'Lab report 2', 'lab', -3, done()), A(chem, 'Homework 2', 'assignment', -1), A(chem, 'Lab report 3', 'lab', 2, { dueTime: '17:00' }),
    A(chem, 'Midterm 1', 'exam', 9, { dueTime: '09:00' }), A(chem, 'Homework 3', 'assignment', 12), A(chem, 'Final exam', 'exam', 80, { dueTime: '08:00' }),
    A(psy, 'Discussion post: memory', 'discussion', -9, { ...done(), maxPoints: 10 }), A(psy, 'Quiz 1', 'quiz', -6, { ...done(), maxPoints: 20 }), A(psy, 'Chapter 5 reading', 'reading', 1, { maxPoints: null }),
    A(psy, 'Discussion post: sleep', 'discussion', 3, { status: 'in-progress', maxPoints: 10 }), A(psy, 'Quiz 2', 'quiz', 6, { maxPoints: 20 }), A(psy, 'Exam 1', 'exam', 16, { dueTime: '11:00' }),
    A(calc, 'Webwork 4', 'assignment', -12, done()), A(calc, 'Webwork 5', 'assignment', -5, done()), A(calc, 'Quiz 3', 'quiz', -4, { ...done(), maxPoints: 10 }),
    A(calc, 'Webwork 6', 'assignment', 0, { dueTime: '22:00' }), A(calc, 'Exam 1', 'exam', 13, { dueTime: '13:00' }),
    A(mkt, 'Case study: Nike', 'paper', 11, { startByDate: addDays(t, -1) }), A(mkt, 'Group project proposal', 'project', 5), A(mkt, 'Case study: Patagonia', 'paper', -8, done()),
  );
  state.todos.push(
    { id: uid(), courseId: chem.id, title: 'Email Dr. Patel about the lab makeup', done: false, dueDate: t, priority: 'high', recurring: null, sample: true },
    { id: uid(), courseId: null, title: 'Buy blue books for midterms', done: false, dueDate: addDays(t, 2), priority: 'medium', recurring: null, sample: true },
    { id: uid(), courseId: null, title: 'Register for spring classes', done: false, dueDate: addDays(t, 4), priority: 'high', recurring: null, sample: true },
  );
  const dow = new Date().getDay();
  state.events.push({ id: uid(), title: 'Library: Chem midterm prep', date: t, startTime: dow === 0 || dow === 6 ? '14:00' : '19:00', endTime: dow === 0 || dow === 6 ? '16:00' : '20:30', courseId: chem.id, type: 'block', color: COURSE_PALETTE[0], sample: true });
  [[chem, -1, 50], [calc, 0, 25], [psy, -2, 75], [chem, -3, 40], [mkt, -4, 30]].forEach(([c, d, m]) => state.timerSessions.push({ id: uid(), courseId: c.id, date: addDays(t, d), minutes: m, mode: 'pomodoro', sample: true }));
  state.decks.push({ id: uid(), name: 'Functional groups', courseId: chem.id, sample: true, cards: [
    { id: uid(), front: 'Alcohol', back: 'R–OH', mastery: 'mastered' }, { id: uid(), front: 'Ketone', back: 'C=O bonded to two carbons', mastery: 'learning' },
    { id: uid(), front: 'Aldehyde', back: 'C=O at the end of a chain (R–CHO)', mastery: 'new' }, { id: uid(), front: 'Amine', back: 'R–NH₂', mastery: 'new' },
    { id: uid(), front: 'Carboxylic acid', back: 'R–COOH', mastery: 'learning' },
  ] });
  state.notes.push({ id: uid(), type: 'note', name: 'Lecture 7: Stereochemistry', parentId: 'root', courseId: chem.id, pinned: true, sample: true, updatedAt: Date.now() - 3600000,
    content: '<h2>Stereochemistry</h2><ul><li>Chiral centers have four different substituents</li><li>Assign R/S by priority (Cahn-Ingold-Prelog)</li><li>Enantiomers are non-superimposable mirror images</li></ul>' });
  state.projects.push({ id: uid(), title: 'Nike case study', courseId: mkt.id, dueDate: addDays(t, 11), sample: true, milestones: [
    { id: uid(), title: 'Research the brand', done: true, tasks: [] }, { id: uid(), title: 'Outline', done: false, tasks: [] }, { id: uid(), title: 'First draft', done: false, tasks: [] },
  ] });
  state.settings.sampleData = { prevSemesterId };
  state.currentSemesterId = semId;
  touch();
  toast('Sample semester loaded. Clear it any time from the dashboard.', 'info', 4200);
}
function removeSampleSemester() {
  const info = state.settings.sampleData;
  if (!info) return;
  confirmDialog('Clear the sample semester? Anything you added yourself stays.', () => {
    const sampleSemIds = state.semesters.filter(s => s.sample).map(s => s.id);
    const sampleCourseIds = state.courses.filter(c => c.sample).map(c => c.id);
    state.courses = state.courses.filter(c => !c.sample);
    ['assignments', 'todos', 'events', 'timerSessions', 'decks', 'notes', 'projects'].forEach(k => { state[k] = state[k].filter(x => !x.sample && !sampleCourseIds.includes(x.courseId)); });
    state.semesters = state.semesters.filter(s => !s.sample);
    const prev = state.semesters.find(s => s.id === info.prevSemesterId) || state.semesters[0];
    if (!prev) { const id = uid(); state.semesters.push({ id, name: suggestedSemesterName(), startDate: todayIso(), endDate: addDays(todayIso(), 110), archived: false }); state.currentSemesterId = id; }
    else if (sampleSemIds.includes(state.currentSemesterId) || !state.semesters.some(s => s.id === state.currentSemesterId)) state.currentSemesterId = prev.id;
    delete state.settings.sampleData;
    state.subRoute = null;
    touch();
    toast('Sample semester cleared');
  }, 'Clear sample');
}
