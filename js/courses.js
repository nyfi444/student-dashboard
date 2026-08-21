/* ── Courses + Syllabus Upload/AI Auto-fill ──────────────────────── */
const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function computeDegreeProgress() {
  const total = state.settings.degreeTotalCredits || 0;
  if (!total) return null;
  const completedCredits = state.courses.filter(c => c.status === 'completed').reduce((s, c) => s + (c.credits || 0), 0);
  const inProgressCredits = state.courses.filter(c => c.status === 'in-progress').reduce((s, c) => s + (c.credits || 0), 0);
  return { completedCredits, inProgressCredits, total, pct: clamp(Math.round((completedCredits / total) * 100), 0, 100) };
}

function pageCourses() {
  const courses = activeCourses();
  const credits = courses.reduce((s, c) => s + (c.credits || 0), 0);
  const gpa = computeGPA();
  const degree = computeDegreeProgress();
  return `
    ${pageHead('Courses', `${courses.length} course${courses.length === 1 ? '' : 's'} this semester`, `
      ${aiButton('Upload syllabus', 'openSyllabusUploadModal()')}
      <button class="btn btn-primary" onclick="openCourseModal()">+ Add course</button>
    `)}
    <div class="grid grid-3 mb-16">
      <div class="stat-card"><div class="num">${courses.length}</div><div class="lbl">Active courses</div></div>
      <div class="stat-card"><div class="num">${credits}</div><div class="lbl">Total credits</div></div>
      <div class="stat-card"><div class="num ${gpa == null ? 'stat-dash' : ''}">${gpa != null ? gpa.toFixed(2) : '—'}</div><div class="lbl">Semester GPA</div></div>
    </div>
    ${degree ? `
    <div class="card card-pad mb-16">
      <div class="flex-between mb-8"><span class="small dim" style="font-weight:600">Degree progress</span><span class="small muted">${degree.completedCredits} / ${degree.total} credits · ${degree.pct}%</span></div>
      <div class="progress"><div style="width:${degree.pct}%"></div></div>
      <div class="small muted mt-8">Set your target total in Settings → Degree.</div>
    </div>` : ''}
    ${courses.length ? `<div class="grid grid-3">${courses.map(courseCard).join('')}</div>` : emptyState(icon('graduation-cap',26,1.4), 'Your courses will live here', `<button class="btn btn-primary mt-8" onclick="openCourseModal()">+ Add course</button>`, 'Add one by hand or upload a syllabus and let AI fill in the schedule and grading breakdown.')}
  `;
}

function courseCard(c) {
  const meetStr = c.meetings.length ? c.meetings.map(m => `${DOW_NAMES[m.day]} ${fmtTime(m.start)}`).join(', ') : 'No scheduled meetings';
  const totalWeight = c.gradingBreakdown.reduce((s, g) => s + Number(g.weight || 0), 0);
  const resources = c.resources || [];
  const pinnedNotes = state.notes.filter(n => n.type === 'note' && n.courseId === c.id && n.pinned);
  return `
    <div class="card card-pad" style="border-top:3px solid ${c.color}">
      <div class="flex-between">
        <div>
          <div style="font-weight:700;font-size:14.5px">${esc(c.name)}</div>
          <div class="small muted">${esc(c.code || '')}${c.instructor ? ' · ' + esc(c.instructor) : ''}</div>
        </div>
        <div class="flex-gap">
          <button class="btn btn-ghost btn-icon btn-sm" onclick="openCourseModal('${c.id}')">${icon('pencil',14)}</button>
          <button class="btn btn-ghost btn-icon btn-sm" onclick="deleteCourse('${c.id}')">${icon('trash',14)}</button>
        </div>
      </div>
      <div class="flex-gap wrap mt-8">
        <span class="tag" style="background:var(--surface-2);color:var(--text-dim)">${COURSE_STATUS_LABELS[c.status] || COURSE_STATUS_LABELS['in-progress']}</span>
        ${c.requirementType ? `<span class="tag" style="background:var(--surface-2);color:var(--text-dim)">${c.requirementType[0].toUpperCase() + c.requirementType.slice(1)}</span>` : ''}
      </div>
      <div class="small muted mt-8">${esc(meetStr)}</div>
      ${c.location ? `<div class="small muted flex-gap">${icon('map-pin', 12)} ${esc(c.location)}</div>` : ''}
      <div class="divider"></div>
      <div class="small dim" style="margin-bottom:4px">Grading breakdown ${totalWeight !== 100 ? `<span style="color:var(--warn)">(${totalWeight}%)</span>` : ''}</div>
      ${c.gradingBreakdown.map(g => `<div class="flex-between small" style="padding:2px 0"><span class="muted">${esc(g.name)}</span><span>${g.weight}%</span></div>`).join('') || `<div class="small muted">Not set</div>`}
      ${resources.length ? `<div class="divider"></div><div class="small dim" style="margin-bottom:4px">Resources</div><div class="flex-gap wrap">${resources.map(r => `<a class="btn btn-sm" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a>`).join('')}</div>` : ''}
      ${pinnedNotes.length ? `<div class="divider"></div><div class="small dim" style="margin-bottom:4px">${icon('pin',12,2)} Pinned</div>${pinnedNotes.map(n => `<div class="small" style="cursor:pointer;padding:2px 0" onclick="setState({route:'notebook',notebookSelected:'${n.id}'})">${esc(n.name)}</div>`).join('')}` : ''}
      <div class="flex-between mt-16">
        <span class="small dim">${c.credits || 0} credits</span>
        <a class="btn btn-sm btn-ghost" onclick="setState({route:'grades'})" style="color:var(--accent)">View grade →</a>
      </div>
    </div>
  `;
}

function openCourseModal(id) {
  const c = id ? getCourse(id) : { id: uid(), semesterId: state.currentSemesterId, name: '', code: '', instructor: '', color: '#000000', credits: 3, location: '', status: 'in-progress', requirementType: 'elective', meetings: [], gradingBreakdown: [], resources: [], finalGradeOverride: null, syllabusRaw: '' };
  const draft = JSON.parse(JSON.stringify(c));
  if (!draft.status) draft.status = 'in-progress';
  if (!draft.resources) draft.resources = [];
  window._courseDraft = draft;

  openModal(`
    <div class="modal-head"><h3>${id ? 'Edit course' : 'Add course'}</h3><button class="close-x" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
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

      <div class="field"><label>Grading breakdown</label>
        <div id="cf-grading">${draft.gradingBreakdown.map((g, i) => gradingRow(g, i)).join('')}</div>
        <button class="btn btn-sm mt-8" onclick="addGradingRow()">+ Add category</button>
        <div class="small muted mt-8" id="cf-weight-total"></div>
      </div>

      <div class="field" style="margin-bottom:0"><label>Resources <span class="small muted">(one-click links)</span></label>
        <div id="cf-resources">${draft.resources.map((r, i) => resourceRow(r, i)).join('')}</div>
        <button class="btn btn-sm mt-8" onclick="addResourceRow()">+ Add resource</button>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveCourseModal(${id ? `'${id}'` : 'null'})">Save course</button>
    </div>
  `, { wide: true });
  wireColorWheel('cf-color', () => _courseDraft.color, (hex) => { _courseDraft.color = hex; });
  updateWeightTotal();
}
function resourceRow(r, i) {
  return `<div class="field-row" style="align-items:center;margin-bottom:6px">
    <select class="select" style="max-width:150px" onchange="_courseDraft.resources[${i}].kind=this.value;_courseDraft.resources[${i}].label=RESOURCE_KINDS.find(k=>k.key===this.value).label">
      ${RESOURCE_KINDS.map(k => `<option value="${k.key}" ${k.key === r.kind ? 'selected' : ''}>${k.label}</option>`).join('')}
    </select>
    <input class="input" value="${esc(r.url)}" placeholder="https://…  or  mailto:prof@school.edu" oninput="_courseDraft.resources[${i}].url=this.value">
    <button class="btn btn-ghost btn-icon btn-sm" onclick="_courseDraft.resources.splice(${i},1);$('#cf-resources').innerHTML=_courseDraft.resources.map(resourceRow).join('')">${icon('x',13,2.2)}</button>
  </div>`;
}
function addResourceRow() { _courseDraft.resources.push({ id: uid(), kind: 'other', label: 'Other', url: '' }); $('#cf-resources').innerHTML = _courseDraft.resources.map(resourceRow).join(''); }
function meetingRow(m, i) {
  return `<div class="field-row" style="align-items:center;margin-bottom:6px" data-mrow="${i}">
    <select class="select" style="max-width:110px" onchange="_courseDraft.meetings[${i}].day=Number(this.value)">${DOW_NAMES.map((d, di) => `<option value="${di}" ${di === m.day ? 'selected' : ''}>${d}</option>`).join('')}</select>
    <input class="input" type="time" value="${m.start}" style="max-width:120px" onchange="_courseDraft.meetings[${i}].start=this.value">
    <input class="input" type="time" value="${m.end}" style="max-width:120px" onchange="_courseDraft.meetings[${i}].end=this.value">
    <button class="btn btn-ghost btn-icon btn-sm" onclick="removeMeetingRow(${i})">${icon('x',13,2.2)}</button>
  </div>`;
}
function gradingRow(g, i) {
  return `<div class="field-row" style="align-items:center;margin-bottom:6px" data-grow="${i}">
    <input class="input" value="${esc(g.name)}" placeholder="Category" onchange="_courseDraft.gradingBreakdown[${i}].name=this.value">
    <input class="input" type="number" value="${g.weight}" style="max-width:90px" placeholder="%" oninput="_courseDraft.gradingBreakdown[${i}].weight=Number(this.value);updateWeightTotal()">
    <button class="btn btn-ghost btn-icon btn-sm" onclick="removeGradingRow(${i})">${icon('x',13,2.2)}</button>
  </div>`;
}
function addMeetingRow() { _courseDraft.meetings.push({ day: 1, start: '10:00', end: '11:00' }); $('#cf-meetings').insertAdjacentHTML('beforeend', meetingRow(_courseDraft.meetings.at(-1), _courseDraft.meetings.length - 1)); }
function removeMeetingRow(i) { _courseDraft.meetings.splice(i, 1); $('#cf-meetings').innerHTML = _courseDraft.meetings.map(meetingRow).join(''); }
function addGradingRow() { _courseDraft.gradingBreakdown.push({ id: uid(), name: '', weight: 0 }); $('#cf-grading').innerHTML = _courseDraft.gradingBreakdown.map(gradingRow).join(''); updateWeightTotal(); }
function removeGradingRow(i) { _courseDraft.gradingBreakdown.splice(i, 1); $('#cf-grading').innerHTML = _courseDraft.gradingBreakdown.map(gradingRow).join(''); updateWeightTotal(); }
function updateWeightTotal() {
  const el = $('#cf-weight-total'); if (!el) return;
  const total = _courseDraft.gradingBreakdown.reduce((s, g) => s + Number(g.weight || 0), 0);
  el.textContent = `Total weight: ${total}%`;
  el.style.color = total === 100 || total === 0 ? 'var(--text-faint)' : 'var(--warn)';
}
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
  confirmDialog('Delete this course? Its assignments and todos will stay but become unassigned.', () => {
    state.courses = state.courses.filter(c => c.id !== id);
    state.assignments.forEach(a => { if (a.courseId === id) a.courseId = null; });
    state.todos.forEach(t => { if (t.courseId === id) t.courseId = null; });
    touch();
    toast('Course deleted');
  });
}

/* ── Syllabus upload → AI parse → review & confirm ────────────── */
function openSyllabusUploadModal() {
  openModal(`
    <div class="modal-head"><h3>Upload syllabus <span class="ai-badge">AI</span></h3><button class="close-x" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      ${!aiEnabled() ? `<div class="small" style="background:var(--warn-light);color:var(--warn);padding:10px 12px;border-radius:10px;margin-bottom:14px">AI parsing isn’t set up on this deployment yet.</div>` : ''}
      <div class="segmented mb-8" id="syl-tabs">
        <button class="active" onclick="sylTab('paste')" data-tab="paste">Paste text</button>
        <button onclick="sylTab('pdf')" data-tab="pdf">Upload PDF</button>
        <button onclick="sylTab('image')" data-tab="image">Upload photo</button>
      </div>
      <div id="syl-paste">
        <textarea class="input" id="syl-text" placeholder="Paste your syllabus text here…" style="min-height:180px"></textarea>
      </div>
      <div id="syl-pdf" style="display:none">
        <div class="upload-drop" onclick="$('#syl-pdf-input').click()">
          <div class="small">Click to choose a PDF syllabus</div>
          <input type="file" id="syl-pdf-input" accept="application/pdf" style="display:none" onchange="handleSyllabusPdf(this.files[0])">
        </div>
        <div class="small muted mt-8" id="syl-pdf-status"></div>
      </div>
      <div id="syl-image" style="display:none">
        <div class="upload-drop" onclick="$('#syl-image-input').click()">
          <div class="small">Click to choose a photo of your syllabus</div>
          <input type="file" id="syl-image-input" accept="image/*" style="display:none" onchange="handleSyllabusImage(this.files[0])">
        </div>
        <div class="small muted mt-8" id="syl-image-status"></div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="syl-parse-btn" onclick="runSyllabusParse()" ${aiEnabled() ? '' : 'disabled'}>${icon('sparkles', 13, 1.5)} Parse with AI</button>
    </div>
  `, { wide: true });
  window._sylImage = null;
}
function sylTab(tab) {
  ['paste', 'pdf', 'image'].forEach(t => { $(`#syl-${t}`).style.display = t === tab ? '' : 'none'; });
  $$('#syl-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  window._sylActiveTab = tab;
}
window._sylActiveTab = 'paste';
async function handleSyllabusPdf(file) {
  if (!file) return;
  $('#syl-pdf-status').textContent = 'Reading PDF…';
  try {
    const text = await extractPdfText(file);
    $('#syl-text').value = text;
    $('#syl-pdf-status').textContent = `Extracted ${text.length.toLocaleString()} characters.`;
    sylTab('paste');
  } catch (e) { $('#syl-pdf-status').textContent = 'Could not read that PDF.'; }
}
async function handleSyllabusImage(file) {
  if (!file) return;
  $('#syl-image-status').textContent = 'Loaded — ready to parse.';
  window._sylImage = { base64: await fileToBase64(file), mediaType: file.type || 'image/jpeg' };
}
async function runSyllabusParse() {
  const btn = $('#syl-parse-btn');
  setBtnLoading(btn, true);
  try {
    let data;
    if (window._sylActiveTab === 'image' && window._sylImage) {
      data = await aiParseSyllabus({ imageBase64: window._sylImage.base64, mediaType: window._sylImage.mediaType });
    } else {
      const text = $('#syl-text').value.trim();
      if (!text) { toast('Paste or upload a syllabus first', 'error'); setBtnLoading(btn, false); return; }
      data = await aiParseSyllabus({ text });
    }
    closeModal();
    openSyllabusReviewModal(data);
  } catch (e) {
    toast(e.message || 'Could not parse that syllabus', 'error', 4000);
  } finally { setBtnLoading(btn, false); }
}

function openSyllabusReviewModal(data) {
  const draft = {
    id: uid(), semesterId: state.currentSemesterId,
    name: data.name || '', code: data.code || '', instructor: data.instructor || '', location: data.location || '',
    credits: data.credits || 3, color: '#000000',
    meetings: Array.isArray(data.meetings) ? data.meetings : [],
    gradingBreakdown: (data.gradingBreakdown || []).map(g => ({ id: uid(), name: g.name, weight: Number(g.weight) || 0 })),
    finalGradeOverride: null, syllabusRaw: '',
  };
  window._courseDraft = draft;
  window._sylAssignments = (data.assignments || []).map(a => ({ ...a, _include: true, id: uid() }));

  openModal(`
    <div class="modal-head"><h3>Review & confirm <span class="ai-badge">AI</span></h3><button class="close-x" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="small muted mb-8">Double-check what the AI pulled out before adding it — edit anything that's off.</div>
      <div class="field-row">
        <div class="field"><label>Course name</label><input class="input" id="cf-name" value="${esc(draft.name)}"></div>
        <div class="field"><label>Code</label><input class="input" id="cf-code" value="${esc(draft.code)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Instructor</label><input class="input" id="cf-instructor" value="${esc(draft.instructor)}"></div>
        <div class="field"><label>Location</label><input class="input" id="cf-location" value="${esc(draft.location)}"></div>
      </div>
      <div class="field"><label>Grading breakdown</label>
        <div id="cf-grading">${draft.gradingBreakdown.map((g, i) => gradingRow(g, i)).join('')}</div>
        <button class="btn btn-sm mt-8" onclick="addGradingRow()">+ Add category</button>
      </div>
      <div class="field"><label>Assignments found (${window._sylAssignments.length})</label>
        <div id="syl-assignment-list" style="max-height:220px;overflow-y:auto">
          ${window._sylAssignments.map((a, i) => `
            <div class="list-row">
              <div class="row-check ${a._include ? 'checked' : ''}" onclick="toggleSylAssignment(${i})">${a._include ? checkGlyph(true) : ''}</div>
              <div class="row-title">${esc(a.title)} ${typeTag(a.type || 'assignment')}</div>
              <div class="row-meta">${a.dueDate ? fmtDate(a.dueDate) : 'no date'}</div>
            </div>`).join('') || '<div class="small muted">None detected — you can add assignments manually later.</div>'}
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
      <div class="row-check ${a._include ? 'checked' : ''}" onclick="toggleSylAssignment(${idx})">${a._include ? checkGlyph(true) : ''}</div>
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
      dueDate: a.dueDate || addDays(todayIso(), 7), dueTime: a.dueTime || '23:59', category: null, weight: null,
      maxPoints: a.maxPoints || null, earnedPoints: null, status: 'not-started', rubric: [], notes: '', recurringTemplateId: null,
    });
  });
  touch();
  closeModal();
  toast(`Added ${d.name} with ${(window._sylAssignments || []).filter(a => a._include).length} assignments`);
}
