/* ── Courses + Syllabus Upload/AI Auto-fill ──────────────────────── */
const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Distinct, muted course colors. New courses take the first one not already
// used this semester, so a fresh schedule never starts as all-black blocks.
const COURSE_PALETTE = ['#3b6ea5', '#b5534a', '#4f8a5b', '#8a6bb5', '#c0892f', '#2f8b8b', '#b0507e', '#5a6b7b', '#7a8c3a', '#a0613a'];
function nextCourseColor(taken = activeCourses().map(c => (c.color || '').toLowerCase())) {
  return COURSE_PALETTE.find(p => !taken.includes(p.toLowerCase())) || COURSE_PALETTE[taken.length % COURSE_PALETTE.length];
}

// The next time this class meets (or the meeting happening right now).
function nextMeeting(course, from = new Date()) {
  const nowMin = from.getHours() * 60 + from.getMinutes();
  const sem = currentSemester();
  for (let i = 0; i < 8; i++) {
    const dIso = addDays(todayIso(), i);
    if (typeof isBreakDate === 'function' && isBreakDate(dIso)) continue;
    if (sem && (dIso < sem.startDate || dIso > sem.endDate)) continue;
    const dow = new Date(dIso + 'T00:00:00').getDay();
    const m = (course.meetings || [])
      .filter(x => x.day === dow && (i > 0 || toMin(x.end || x.start) > nowMin))
      .sort((a, b) => a.start.localeCompare(b.start))[0];
    if (m) return { ...m, date: dIso, inProgress: i === 0 && toMin(m.start) <= nowMin };
  }
  return null;
}
function fmtNextMeeting(m) {
  if (!m) return '';
  if (m.inProgress) return `In class now, until ${fmtTime(m.end)}`;
  const n = daysBetween(m.date);
  return `${n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : fmtDate(m.date, { weekday: 'long' })} ${fmtTime(m.start)}`;
}

function pageCourses() {
  if (state.subRoute) {
    const c = getCourse(state.subRoute);
    if (c) return pageCourseHub(c);
  }
  const courses = activeCourses();
  const credits = courses.reduce((s, c) => s + (Number(c.credits) || 0), 0);
  return `
    ${pageHead('Courses', `${courses.length} course${courses.length === 1 ? '' : 's'} · ${credits} credits · Click a class to open its page`, `
      <button class="btn btn-sm" onclick="openJoinClassModal()">${icon('users', 13, 1.8)} Join a shared class</button>
      ${aiButton('Upload syllabus', 'openSyllabusUploadModal()')}
      <button class="btn btn-primary" onclick="openCourseModal()">+ Add course</button>
    `)}
    ${courses.length ? expandable('course-grid', 'Courses', `<div class="grid grid-2 course-grid">${courses.map(courseCard).join('')}</div>`, { max: 620, count: courses.length }) : emptyStateHtml({
      icon: 'graduation-cap',
      title: 'Add your classes',
      body: 'Semester setup reads each syllabus and fills in meeting times, deadlines, and exam dates, or you can add a class by hand.',
      actions: [{ label: 'Set up my semester', onclick: 'openSemesterSetup()', icon: 'sparkles' }, { label: '+ Add a course', onclick: 'openCourseModal()' }],
    })}
  `;
}

function courseWork(c) {
  const items = state.assignments.filter(a => a.courseId === c.id);
  const done = items.filter(isAssignmentDone);
  const open = items.filter(a => !isAssignmentDone(a));
  return { items, done, open, pct: items.length ? (done.length / items.length) * 100 : null };
}
function courseCard(c) {
  const w = courseWork(c);
  const next = nextMeeting(c);
  const overdue = w.open.filter(a => a.dueDate && a.dueDate < todayIso()).length;
  const nextDue = w.open.filter(a => a.dueDate && a.dueDate >= todayIso()).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const due = typeof srsDueCount === 'function' ? state.decks.filter(d => d.courseId === c.id).reduce((s, d) => s + srsDueCount(d), 0) : 0;
  return `
    <div class="card course-card" role="button" tabindex="0" onclick="openCourse('${c.id}')" onkeydown="if(event.key==='Enter')openCourse('${c.id}')" style="--course:${esc(c.color || '#5a6b7b')}">
      <div class="course-card-top">
        <div style="min-width:0">
          <div class="course-code"><span class="course-dot"></span>${esc(c.code || 'Course')}${c.instructor ? ` · ${esc(c.instructor)}` : ''}${c.sharedClass ? ` <span class="class-shared-tag">${icon('users', 10, 2)} Shared</span>` : ''}</div>
          <div class="course-name">${esc(c.name)}</div>
        </div>
        <div class="course-ring" title="${w.done.length} of ${w.items.length} assignments finished">
          ${progressRing(w.pct, c.color, 58)}
          <div class="course-ring-num">${w.items.length ? `<strong>${Math.round(w.pct)}%</strong><span>done</span>` : `<span class="muted">No<br>work yet</span>`}</div>
        </div>
      </div>
      <div class="course-lines">
        <div><span class="course-ic">${icon('clock', 13, 1.8)}</span><span>${next ? esc(fmtNextMeeting(next)) + (c.location ? ` · ${esc(c.location)}` : '') : '<span class="muted">No class times added</span>'}</span></div>
        <div><span class="course-ic">${icon('clipboard-list', 13, 1.8)}</span><span>${nextDue ? `Next due: <span class="sg-strong">${esc(nextDue.title)}</span>, ${esc(relativeDay(nextDue.dueDate))}` : '<span class="muted">Nothing due soon</span>'}</span></div>
      </div>
      <div class="course-foot small muted">
        <span>${w.open.length} open${overdue ? ` · <span class="sg-overdue">${overdue} overdue</span>` : ''}${due ? ` · ${due} card${due === 1 ? '' : 's'} to review` : ''}${c.details?.absenceLimit != null && countedAbsences(c) ? ` · <span class="${countedAbsences(c) >= c.details.absenceLimit ? 'sg-overdue' : ''}">${countedAbsences(c)}/${c.details.absenceLimit} absences</span>` : ''}</span>
        <span class="course-open">Open class page ${icon('chevron-right', 12, 2)}</span>
      </div>
    </div>`;
}
function openCourse(id) { setState({ route: 'courses', subRoute: id }); window.scrollTo(0, 0); }

/* ── Class page: one page for everything about a class ─────────── */
function pageCourseHub(c) {
  if (c.sharedClass && !window._classCheckedThisView?.[c.id]) { (window._classCheckedThisView = window._classCheckedThisView || {})[c.id] = true; setTimeout(() => checkClassUpdates(c.id), 0); }
  const w = courseWork(c);
  const t = todayIso();
  const next = nextMeeting(c);
  const open = [...w.open].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const finished = [...w.done].sort((a, b) => (b.dueDate || '').localeCompare(a.dueDate || ''));
  const overdue = open.filter(a => a.dueDate && a.dueDate < t).length;
  const dueWeek = open.filter(a => a.dueDate >= t && a.dueDate <= addDays(t, 7)).length;
  const notes = state.notes.filter(n => n.type === 'note' && n.courseId === c.id).sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 5);
  const decks = state.decks.filter(d => d.courseId === c.id);
  const weekMin = state.timerSessions.filter(s => s.courseId === c.id && s.date >= startOfWeek(t)).reduce((s, x) => s + x.minutes, 0);
  const exams = w.items.filter(a => a.type === 'exam' && a.dueDate && a.dueDate >= t).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return `
    <div style="--course:${esc(c.color || '#5a6b7b')}">
    <button class="btn btn-ghost btn-sm sg-back" onclick="setState({subRoute:null})">${icon('arrow-left', 14, 1.9)} All courses</button>
    <div class="sg-head">
      <div style="min-width:0">
        <div class="sg-eyebrow"><span class="course-dot"></span>${[c.code, c.instructor, `${Number(c.credits) || 0} credits`].filter(Boolean).map(esc).join(' · ')}</div>
        <h2 class="sg-title">${esc(c.name)}</h2>
        <p class="small muted sg-desc">${next ? `${icon('clock', 12, 1.8)} ${esc(fmtNextMeeting(next))}` : 'No class times yet'}${c.location ? ` · ${icon('map-pin', 12, 1.8)} ${esc(c.location)}` : ''}</p>
      </div>
      <div class="sg-head-actions">
        ${signInHeaderButton()}
        <button class="btn" onclick="openAssignmentModal(null,'${c.id}')">+ Assignment</button>
        <button class="btn btn-icon" aria-label="Edit course" title="Edit course" onclick="openCourseModal('${c.id}')">${icon('pencil', 15, 1.7)}</button>
      </div>
    </div>

    ${c.sample ? '' : classShareBar(c)}
    <div class="sg-overview">
      <div class="sg-col">
        <div class="card card-pad hub-progress">
          <div class="hub-ring">${progressRing(w.pct, c.color, 104)}<div class="hub-ring-label">${w.items.length ? `<strong>${Math.round(w.pct)}%</strong><span>finished</span>` : '<span class="muted small">No work<br>added yet</span>'}</div></div>
          <div class="hub-stats">
            <div class="hub-stat"><strong>${open.length}</strong><span>Open</span></div>
            <div class="hub-stat ${overdue ? 'is-alert' : ''}"><strong>${overdue}</strong><span>Overdue</span></div>
            <div class="hub-stat"><strong>${dueWeek}</strong><span>Due this week</span></div>
            <div class="hub-stat"><strong>${fmtDuration(weekMin)}</strong><span>Focus this week</span></div>
          </div>
        </div>

        <div class="card card-pad">
          <div class="flex-between mb-8"><h3 class="sg-h3">Coming up</h3><button class="sg-link" onclick="state._assignCourseFilter='${c.id}';setState({route:'assignments',subRoute:null})">All assignments →</button></div>
          ${open.length ? open.slice(0, 8).map(hubAssignmentRow).join('') : `<p class="small muted">Nothing open for this class. <button class="sg-link" onclick="openAssignmentModal(null,'${c.id}')">Add an assignment</button></p>`}
        </div>

        ${finished.length ? `<div class="card card-pad">
          <details class="hub-finished">
            <summary class="flex-between"><h3 class="sg-h3">Finished</h3><span class="small muted">${finished.length} done</span></summary>
            <div class="mt-8">${finished.slice(0, 25).map(a => `
              <div class="list-row sg-task compact" onclick="openAssignmentModal('${a.id}')">
                <button type="button" class="row-check checked" role="checkbox" aria-checked="true" aria-label="Mark ${esc(a.title)} as not done" onclick="event.stopPropagation();toggleAssignmentDone('${a.id}')">${checkGlyph(true)}</button>
                <div class="row-title"><div class="sg-done">${esc(a.title)}</div></div>
                <div class="row-meta">${a.dueDate ? fmtDate(a.dueDate) : ''}</div>
              </div>`).join('')}</div>
          </details>
        </div>` : ''}
      </div>

      <div class="sg-col">
        ${exams.length ? `<div class="card card-pad hub-exam">
          <div class="sg-eyebrow">Next exam</div>
          <div class="hub-exam-row"><div class="hub-exam-days"><strong>${daysBetween(exams[0].dueDate)}</strong><span>day${daysBetween(exams[0].dueDate) === 1 ? '' : 's'}</span></div>
          <div style="min-width:0"><div class="sg-strong">${esc(exams[0].title)}</div><div class="small muted">${esc(fmtDateLong(exams[0].dueDate))}</div></div></div>
        </div>` : ''}
        ${syllabusCard(c)}
        <div class="card card-pad">
          <h3 class="sg-h3 mb-8">Class schedule</h3>
          ${(c.meetings || []).length ? [...c.meetings].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start)).map(m => `<div class="sg-person"><span class="hub-day">${DOW_NAMES[m.day]}</span><div class="row-title small">${fmtTime(m.start)} – ${fmtTime(m.end)}</div></div>`).join('') : `<p class="small muted">No meeting times. <button class="sg-link" onclick="openCourseModal('${c.id}')">Add them</button></p>`}
          ${(c.resources || []).length ? `<div class="divider"></div><div class="flex-gap wrap">${c.resources.map(r => `<a class="btn btn-sm" href="${esc(r.url)}" target="_blank" rel="noopener">${icon('link', 12, 1.8)} ${esc(r.label)}</a>`).join('')}</div>` : ''}
        </div>
        <div class="card card-pad">
          <div class="flex-between mb-8"><h3 class="sg-h3">Notes</h3><button class="sg-link" onclick="createCourseNote('${c.id}')">+ New note</button></div>
          ${notes.length ? notes.map(n => `<div class="sg-person hub-link" onclick="setState({route:'notebook',notebookSelected:'${n.id}',subRoute:null})"><span class="sg-activity-ic">${icon(n.pinned ? 'pin' : 'file-text', 13, 1.8)}</span><div class="row-title small">${esc(n.name || 'Untitled note')}</div><span class="small muted">${fmtRelativeTime(n.updatedAt)}</span></div>`).join('') : `<p class="small muted">Notes you tag with this class collect here.</p>`}
        </div>
        <div class="card card-pad">
          <div class="flex-between mb-8"><h3 class="sg-h3">Study</h3><button class="sg-link" onclick="startCourseFocus('${c.id}')">${icon('play', 11, 1.5)} Focus session</button></div>
          ${decks.length ? decks.map(d => { const due = srsDueCount(d); return `<div class="sg-person"><span class="sg-activity-ic">${icon('layers', 13, 1.8)}</span><div class="row-title small">${esc(d.name)} <span class="muted">· ${due ? `${due} to review` : `${d.cards.length} cards`}</span></div><button class="btn btn-sm ${due ? 'btn-primary' : ''}" onclick="openReview(['${d.id}'])" ${d.cards.length ? '' : 'disabled'}>${due ? 'Review' : 'Study'}</button></div>`; }).join('') : `<p class="small muted">No flashcard decks for this class. <button class="sg-link" onclick="setState({route:'studytools',subRoute:null});openDeckModal(null,'${c.id}')">Make one</button></p>`}
        </div>
      </div>
    </div>
    </div>`;
}
function hubAssignmentRow(a) {
  const overdue = a.dueDate && a.dueDate < todayIso();
  return `<div class="list-row sg-task compact" data-item-id="${a.id}" onclick="openAssignmentModal('${a.id}')">
    <button type="button" class="row-check" role="checkbox" aria-checked="false" aria-label="Mark ${esc(a.title)} as done" onclick="event.stopPropagation();toggleAssignmentDone('${a.id}')"></button>
    <div class="row-title"><div>${esc(a.title)} ${typeTag(a.type)}</div></div>
    <div class="row-meta ${overdue ? 'sg-overdue' : ''}">${a.dueDate ? esc(relativeDay(a.dueDate)) : 'No date'}</div>
  </div>`;
}
function createCourseNote(courseId) {
  const id = uid();
  state.notes.push({ id, type: 'note', name: 'Untitled note', parentId: 'root', courseId, pinned: false, content: '', updatedAt: Date.now() });
  setState({ route: 'notebook', notebookSelected: id, subRoute: null });
}
function startCourseFocus(courseId) {
  window._timer.courseId = courseId;
  setState({ route: 'timer', subRoute: null });
}

function openCourseModal(id) {
  const c = id ? getCourse(id) : { id: uid(), semesterId: state.currentSemesterId, name: '', code: '', instructor: '', color: nextCourseColor(), credits: 3, location: '', status: 'in-progress', requirementType: 'elective', meetings: [], resources: [], syllabusRaw: '' };
  const draft = JSON.parse(JSON.stringify(c));
  if (!draft.status) draft.status = 'in-progress';
  if (!draft.resources) draft.resources = [];
  window._courseDraft = draft;

  openModal(`
    <div class="modal-head"><h3>${id ? 'Edit course' : 'Add course'}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="field-row">
        <div class="field"><label>Course name</label><input class="input" id="cf-name" value="${esc(draft.name)}" placeholder="Intro to Psychology"></div>
        <div class="field"><label>Code</label><input class="input" id="cf-code" value="${esc(draft.code)}" placeholder="PSY 101"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Instructor</label><input class="input" id="cf-instructor" value="${esc(draft.instructor)}"></div>
        <div class="field"><label>Location</label><input class="input" id="cf-location" value="${esc(draft.location)}"></div>
      </div>
      <div class="field-row">
        <div class="field" style="max-width:120px"><label>Credits</label><input class="input" type="number" id="cf-credits" value="${draft.credits || ''}"></div>
        <div class="field"><label>Color</label>${colorWheelHtml('cf-color', draft.color)}</div>
      </div>
      <div class="field-row">
        <div class="field"><label>Status</label><select class="select" id="cf-status">${COURSE_STATUSES.map(s => `<option value="${s}" ${s === draft.status ? 'selected' : ''}>${COURSE_STATUS_LABELS[s]}</option>`).join('')}</select></div>
        <div class="field"><label>Requirement</label><select class="select" id="cf-requirement"><option value="required" ${draft.requirementType === 'required' ? 'selected' : ''}>Required</option><option value="elective" ${draft.requirementType === 'elective' ? 'selected' : ''}>Elective</option></select></div>
      </div>

      <div class="field"><label>Class meetings</label>
        <div id="cf-meetings">${draft.meetings.map((m, i) => meetingRow(m, i)).join('')}</div>
        <button class="btn btn-sm mt-8" onclick="addMeetingRow()">+ Add meeting time</button>
      </div>

      <div class="field" style="margin-bottom:0"><label>Resources <span class="small muted">(one-click links)</span></label>
        <div id="cf-resources">${draft.resources.map((r, i) => resourceRow(r, i)).join('')}</div>
        <button class="btn btn-sm mt-8" onclick="addResourceRow()">+ Add resource</button>
      </div>
    </div>
    <div class="modal-foot">
      ${id ? `<button class="btn btn-danger" style="margin-right:auto" onclick="deleteCourse('${id}')">Delete</button>` : ''}
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveCourseModal(${id ? `'${id}'` : 'null'})">Save course</button>
    </div>
  `, { wide: true });
  wireColorWheel('cf-color', () => _courseDraft.color, (hex) => { _courseDraft.color = hex; });
}
function resourceRow(r, i) {
  return `<div class="field-row" style="align-items:center;margin-bottom:6px">
    <select class="select" style="max-width:150px" onchange="_courseDraft.resources[${i}].kind=this.value;_courseDraft.resources[${i}].label=RESOURCE_KINDS.find(k=>k.key===this.value).label">
      ${RESOURCE_KINDS.map(k => `<option value="${k.key}" ${k.key === r.kind ? 'selected' : ''}>${k.label}</option>`).join('')}
    </select>
    <input class="input" value="${esc(r.url)}" placeholder="https://…  or  mailto:prof@school.edu" oninput="_courseDraft.resources[${i}].url=this.value">
    <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove resource" onclick="_courseDraft.resources.splice(${i},1);$('#cf-resources').innerHTML=_courseDraft.resources.map(resourceRow).join('')">${icon('x',13,2.2)}</button>
  </div>`;
}
function addResourceRow() { _courseDraft.resources.push({ id: uid(), kind: 'other', label: 'Other', url: '' }); $('#cf-resources').innerHTML = _courseDraft.resources.map(resourceRow).join(''); }
function meetingRow(m, i) {
  return `<div class="field-row" style="align-items:center;margin-bottom:6px" data-mrow="${i}">
    <select class="select" style="max-width:110px" onchange="_courseDraft.meetings[${i}].day=Number(this.value)">${DOW_NAMES.map((d, di) => `<option value="${di}" ${di === m.day ? 'selected' : ''}>${d}</option>`).join('')}</select>
    <input class="input" type="time" value="${m.start}" style="max-width:120px" onchange="_courseDraft.meetings[${i}].start=this.value">
    <input class="input" type="time" value="${m.end}" style="max-width:120px" onchange="_courseDraft.meetings[${i}].end=this.value">
    <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove meeting" onclick="removeMeetingRow(${i})">${icon('x',13,2.2)}</button>
  </div>`;
}
function addMeetingRow() { _courseDraft.meetings.push({ day: 1, start: '10:00', end: '11:00' }); $('#cf-meetings').insertAdjacentHTML('beforeend', meetingRow(_courseDraft.meetings.at(-1), _courseDraft.meetings.length - 1)); }
function removeMeetingRow(i) { _courseDraft.meetings.splice(i, 1); $('#cf-meetings').innerHTML = _courseDraft.meetings.map(meetingRow).join(''); }
function saveCourseModal(existingId) {
  const d = _courseDraft;
  d.name = $('#cf-name').value.trim();
  d.code = $('#cf-code').value.trim();
  d.instructor = $('#cf-instructor').value.trim();
  d.location = $('#cf-location').value.trim();
  d.credits = Number($('#cf-credits').value) || 0;
  d.status = $('#cf-status').value;
  d.requirementType = $('#cf-requirement').value;
  d.resources = d.resources.filter(r => r.url.trim());
  if (!d.name) { toast('Give the course a name', 'error'); return; }
  if (existingId) {
    const idx = state.courses.findIndex(c => c.id === existingId);
    state.courses[idx] = d;
  } else {
    state.courses.push(d);
  }
  touch();
  closeModal();
  toast(existingId ? 'Course updated' : 'Course added');
}
function deleteCourse(id) {
  confirmDialog('Delete this course? Its assignments and todos will stay but become unassigned. You can restore it from Recently Deleted for 30 days.', () => {
    const course = state.courses.find(c => c.id === id);
    if (course) trashItem('course', course.name || 'Untitled course', course);
    state.courses = state.courses.filter(c => c.id !== id);
    state.assignments.forEach(a => { if (a.courseId === id) a.courseId = null; });
    state.todos.forEach(t => { if (t.courseId === id) t.courseId = null; });
    if (state.subRoute === id) state.subRoute = null;
    touch();
    toast('Course deleted');
  });
}

/* ── Syllabus upload → AI parse → review & confirm ────────────── */
function openSyllabusUploadModal(targetCourseId = null) {
  if (!requireAi('Syllabus upload')) return;
  window._sylTargetCourseId = targetCourseId && getCourse(targetCourseId) ? targetCourseId : null;
  const target = window._sylTargetCourseId ? getCourse(targetCourseId) : null;
  window._sylActiveTab = 'file';
  delete _uploadZones.syllabus;
  openModal(`
    <div class="modal-head"><h3>${target ? `Upload the ${esc(target.code || target.name)} syllabus` : 'Upload syllabus'} <span class="ai-badge">AI</span></h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      ${!aiEnabled() ? `<div class="small" style="background:var(--warn-light);color:var(--warn);padding:10px 12px;border-radius:10px;margin-bottom:14px">AI parsing isn’t set up on this deployment yet.</div>` : ''}
      <p class="small muted mb-8">${target ? 'Semester HQ pulls out office hours, contact info, the attendance and late policies, and any deadlines this class doesn’t have yet. You’ll review it before anything is saved.' : 'Semester HQ fills in class times, every deadline, office hours, and the attendance and late policies. You’ll review it before anything is saved.'}</p>
      <div class="segmented mb-8" id="syl-tabs">
        <button class="active" onclick="sylTab('file')" data-tab="file">Upload a file</button>
        <button onclick="sylTab('paste')" data-tab="paste">Paste text</button>
      </div>
      <div id="syl-file">${uploadZoneHtml('syllabus', 'Choose your syllabus, or drop it here', 'PDF, Word, PowerPoint, or photos. Pick several photos for a handout with more than one page.')}</div>
      <div id="syl-paste" style="display:none">
        <textarea class="input" id="syl-text" placeholder="Paste your syllabus text here…" style="min-height:180px"></textarea>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="syl-parse-btn" onclick="runSyllabusParse()" ${aiEnabled() ? '' : 'disabled'}>${icon('sparkles', 13, 1.5)} Parse with AI</button>
    </div>
  `, { wide: true });
}
function askAboutDuplicateCourse(course, data) {
  window._sylDuplicateData = data;
  const label = course.code || course.name;
  openModal(`
    <div class="modal-head"><h3>You already have this class</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <p class="small"><strong>${esc(label)}</strong> is already in this semester. Adding this syllabus to it keeps one class page with its assignments, notes, and office hours, and only pulls in deadlines it doesn’t have yet.</p>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn" onclick="closeModal();openSyllabusReviewModal(window._sylDuplicateData, true)">Add a separate class</button>
      <button class="btn btn-primary" onclick="closeModal();openSyllabusMergeModal('${course.id}', window._sylDuplicateData)">Add to ${esc(label)}</button>
    </div>
  `);
}
function sylTab(tab) {
  ['file', 'paste'].forEach(t => { $(`#syl-${t}`).style.display = t === tab ? '' : 'none'; });
  $$('#syl-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  window._sylActiveTab = tab;
}
async function runSyllabusParse() {
  const btn = $('#syl-parse-btn');
  let material;
  if (window._sylActiveTab === 'paste') {
    const text = $('#syl-text').value.trim();
    if (!text) { toast('Paste your syllabus text first', 'error'); return; }
    material = { text };
  } else {
    material = uploadZoneMaterial('syllabus', 'Choose your syllabus file first');
    if (!material) return;
  }
  // Uploading the same syllabus file to the same class twice is easy to do
  // and costs an AI parse, so it asks first. Only a name match on the same
  // class counts: a different class's "syllabus.pdf" is a different file.
  const target = window._sylTargetCourseId ? getCourse(window._sylTargetCourseId) : null;
  const repeated = target && (material.fileNames || []).find(n => findFileByName([{ name: target.syllabusFileName }], n));
  if (repeated && !window._sylRepeatOk) {
    askAboutDuplicateFile(repeated, `the syllabus already read for ${target.code || target.name}`, {
      onKeepBoth: () => { window._sylRepeatOk = true; runSyllabusParse(); },
    });
    return;
  }
  window._sylRepeatOk = false;
  setBtnLoading(btn, true);
  try {
    const data = await aiParseSyllabus({ ...material, fileType: fileExt((material.fileNames || [])[0] || '') || (window._sylActiveTab === 'paste' ? 'paste' : '') });
    if (target && (material.fileNames || []).length) target.syllabusFileName = material.fileNames[0];
    closeModal();
    if (window._sylTargetCourseId && getCourse(window._sylTargetCourseId)) {
      keepSyllabusFile(window._sylTargetCourseId, material.files);
      openSyllabusMergeModal(window._sylTargetCourseId, data);
    } else {
      // The class doesn't exist until the student confirms, so the original
      // is held until commitSyllabusCourse knows its id.
      window._sylPendingFiles = material.files || [];
      openSyllabusReviewModal(data);
    }
  } catch (e) {
    toast(e.message || 'Could not parse that syllabus', 'error', 4000);
  } finally { setBtnLoading(btn, false); }
}

function openSyllabusReviewModal(data, forceNew = false) {
  // The same syllabus uploaded twice, or a class that was added by hand
  // first: offer to fill that one in instead of making a second copy.
  const existing = forceNew ? null : findDuplicateCourse(data.name, data.code);
  if (existing) { askAboutDuplicateCourse(existing, data); return; }
  const draft = {
    id: uid(), semesterId: state.currentSemesterId,
    name: data.name || '', code: data.code || '', instructor: data.instructor || '', location: data.location || '',
    credits: data.credits || 3, color: nextCourseColor(),
    meetings: Array.isArray(data.meetings) ? data.meetings : [],
    status: 'in-progress', requirementType: 'required', resources: [],
    syllabusRaw: '', details: sanitizeCourseDetails(data.details),
  };
  window._courseDraft = draft;
  window._sylAssignments = (data.assignments || []).map(a => ({ ...a, _include: true, id: uid() }));
  // What the parser offered, before the student touched any of it. Compared
  // against what they actually save (commitSyllabusCourse) this is the real
  // accuracy measurement — see reportSyllabusKept in js/ai.js.
  window._sylOffered = {
    assignments: window._sylAssignments.map(a => ({ id: a.id, title: a.title || '', dueDate: a.dueDate || '', type: a.type || '' })),
    name: draft.name, code: draft.code, instructor: draft.instructor, location: draft.location,
  };
  const dd = draft.details;
  const detailBits = [
    dd.email ? esc(dd.email) : '', dd.officeHours.length ? `Office hours ${dd.officeHours.map(h => `${DOW_NAMES[h.day]} ${fmtTime(h.start)}`).join(', ')}` : '',
    dd.absenceLimit != null ? `${dd.absenceLimit} absence${dd.absenceLimit === 1 ? '' : 's'} allowed` : '', dd.latePolicy ? 'Late work policy' : '',
    dd.policies.length ? `${dd.policies.length} other polic${dd.policies.length === 1 ? 'y' : 'ies'}` : '', dd.tas.length ? `${dd.tas.length} TA${dd.tas.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean);

  openModal(`
    <div class="modal-head"><h3>Review & confirm <span class="ai-badge">AI</span></h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="small muted mb-8">Double-check what the AI pulled out before adding it. Edit anything that's off.</div>
      <div class="field-row">
        <div class="field"><label>Course name</label><input class="input" id="cf-name" value="${esc(draft.name)}"></div>
        <div class="field"><label>Code</label><input class="input" id="cf-code" value="${esc(draft.code)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Instructor</label><input class="input" id="cf-instructor" value="${esc(draft.instructor)}"></div>
        <div class="field"><label>Location</label><input class="input" id="cf-location" value="${esc(draft.location)}"></div>
      </div>
      ${detailBits.length ? `<div class="field"><label>Class details found</label><ul class="syl-found">${detailBits.map(b => `<li>${icon('check', 12, 2.4)} ${b}</li>`).join('')}</ul><div class="small muted">These go on the class page. You can edit them there any time.</div></div>` : ''}
      <div class="field"><label>Assignments found (${window._sylAssignments.length})</label>
        <div id="syl-assignment-list" style="max-height:220px;overflow-y:auto">
          ${window._sylAssignments.map((a, i) => `
            <div class="list-row">
              <button type="button" class="row-check ${a._include ? 'checked' : ''}" role="checkbox" aria-checked="${a._include}" aria-label="${a._include ? 'Exclude' : 'Include'} ${esc(a.title)}" onclick="toggleSylAssignment(${i})">${a._include ? checkGlyph(true) : ''}</button>
              <div class="row-title">${esc(a.title)} ${typeTag(a.type || 'assignment')}</div>
              <div class="row-meta">${a.dueDate ? fmtDate(a.dueDate) : 'no date'}</div>
            </div>`).join('') || '<div class="small muted">None detected. You can add assignments manually later.</div>'}
        </div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="commitSyllabusCourse()">Create course</button>
    </div>
  `, { wide: true });
}
function toggleSylAssignment(i) {
  window._sylAssignments[i]._include = !window._sylAssignments[i]._include;
  $('#syl-assignment-list').innerHTML = window._sylAssignments.map((a, idx) => `
    <div class="list-row">
      <button type="button" class="row-check ${a._include ? 'checked' : ''}" role="checkbox" aria-checked="${a._include}" aria-label="${a._include ? 'Exclude' : 'Include'} ${esc(a.title)}" onclick="toggleSylAssignment(${idx})">${a._include ? checkGlyph(true) : ''}</button>
      <div class="row-title">${esc(a.title)} ${typeTag(a.type || 'assignment')}</div>
      <div class="row-meta">${a.dueDate ? fmtDate(a.dueDate) : 'no date'}</div>
    </div>`).join('');
}
function commitSyllabusCourse() {
  const d = _courseDraft;
  d.name = $('#cf-name').value.trim();
  d.code = $('#cf-code').value.trim();
  d.instructor = $('#cf-instructor').value.trim();
  d.location = $('#cf-location').value.trim();
  if (!d.name) { toast('Give the course a name', 'error'); return; }
  state.courses.push(d);
  (window._sylAssignments || []).filter(a => a._include && a.title).forEach(a => {
    state.assignments.push({
      id: uid(), courseId: d.id, title: a.title, type: ASSIGNMENT_TYPES.includes(a.type) ? a.type : 'assignment',
      dueDate: cleanDueDate(a.dueDate), dueTime: cleanDueTime(a.dueTime),
      maxPoints: a.maxPoints || null, status: 'not-started', rubric: [], notes: '', attachments: [], recurringTemplateId: null,
    });
  });
  reportSyllabusReview(d);
  if (window._sylPendingFiles?.length) { keepSyllabusFile(d.id, window._sylPendingFiles); window._sylPendingFiles = null; }
  touch();
  closeModal();
  toast(`Added ${d.name} with ${(window._sylAssignments || []).filter(a => a._include).length} assignments`);
  openCourse(d.id);
}

// Counts only: how many of the deadlines the parser found were kept as they
// were, corrected, or dropped, plus whether the four course fields were
// retyped. Nothing that was typed or uploaded leaves the browser.
function reportSyllabusReview(saved) {
  const offered = window._sylOffered;
  window._sylOffered = null;
  if (!offered) return;
  const same = (a, b) => (a || '').trim() === (b || '').trim();
  const current = new Map((window._sylAssignments || []).map(a => [a.id, a]));
  let kept = 0, edited = 0, removed = 0;
  offered.assignments.forEach(a => {
    const now = current.get(a.id);
    if (!now || !now._include) { removed++; return; }
    if (same(now.title, a.title) && same(now.dueDate, a.dueDate) && same(now.type, a.type)) kept++;
    else edited++;
  });
  const fields = ['name', 'code', 'instructor', 'location'];
  const fieldsEdited = fields.filter(f => offered[f] && !same(saved[f], offered[f])).length;
  reportSyllabusKept({ offered: offered.assignments.length + fields.filter(f => offered[f]).length, kept: kept + (fields.filter(f => offered[f]).length - fieldsEdited), edited: edited + fieldsEdited, removed });
}
