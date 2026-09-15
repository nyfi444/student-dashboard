/* ── Assignment tracker + rubric checklist ───────────────────────── */
const STATUS_LABELS = ASSIGNMENT_STATUS_LABELS;
function isAssignmentDone(a) { return a.status === 'done' || a.status === 'submitted'; }

function pageAssignments() {
  const courseFilter = state._assignCourseFilter || 'all';
  const view = ['todo', 'done', 'all'].includes(state._assignView) ? state._assignView : 'todo';
  const selectMode = !!state._assignSelectMode;
  const selected = new Set(state._assignSelectedIds || []);
  const all = state.assignments.filter(a => activeCourses().some(c => c.id === a.courseId) || !a.courseId);
  const scoped = courseFilter === 'all' ? all : all.filter(a => a.courseId === courseFilter);
  const t = todayIso(), tomorrow = addDays(t, 1), weekEnd = addDays(t, 7);
  const open = scoped.filter(a => !isAssignmentDone(a));
  const done = scoped.filter(isAssignmentDone).sort((a, b) => (b.dueDate || '').localeCompare(a.dueDate || ''));
  const byDue = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || (a.dueTime || '').localeCompare(b.dueTime || '');
  const groups = [
    ['overdue', 'Overdue', open.filter(a => a.dueDate && a.dueDate < t)],
    ['today', 'Today', open.filter(a => a.dueDate === t)],
    ['tomorrow', 'Tomorrow', open.filter(a => a.dueDate === tomorrow)],
    ['week', 'This week', open.filter(a => a.dueDate > tomorrow && a.dueDate <= weekEnd)],
    ['later', 'Later', open.filter(a => a.dueDate > weekEnd)],
    ['nodate', 'No due date', open.filter(a => !a.dueDate)],
  ].map(([k, label, items]) => [k, label, items.sort(byDue)]).filter(([, , items]) => items.length);
  const visible = view === 'done' ? done : view === 'all' ? [...open.sort(byDue), ...done] : open;
  window._assignVisibleIds = visible.map(a => a.id);
  const allSelected = visible.length > 0 && visible.every(a => selected.has(a.id));
  const total = scoped.length;
  const pctDone = total ? Math.round((done.length / total) * 100) : 0;
  const overdueCount = open.filter(a => a.dueDate && a.dueDate < t).length;
  const weekCount = open.filter(a => a.dueDate >= t && a.dueDate <= weekEnd).length;
  const startSoon = open.filter(a => a.startByDate && a.startByDate <= t && a.dueDate >= t);

  return `
    ${pageHead('Assignments', `${open.length} to do · ${weekCount} due this week${overdueCount ? ` · ${overdueCount} overdue` : ''}`, `
      ${aiButton('Quick capture', 'openQuickCapture()')}
      <button class="btn btn-sm ${selectMode ? 'btn-primary' : ''}" onclick="toggleAssignSelectMode()">${icon('check-square', 13, 2)} ${selectMode ? 'Cancel' : 'Select'}</button>
      <button class="btn btn-primary" onclick="openAssignmentModal(null, state._assignCourseFilter !== 'all' ? state._assignCourseFilter : null)">+ Add assignment</button>
    `)}
    <div class="assign-toolbar">
      <div class="chip-row" role="group" aria-label="Filter by course">
        <button class="chip ${courseFilter === 'all' ? 'active' : ''}" onclick="state._assignCourseFilter='all';touch()">All courses</button>
        ${activeCourses().map(c => `<button class="chip ${courseFilter === c.id ? 'active' : ''}" style="--course:${esc(c.color || '#5a6b7b')}" onclick="state._assignCourseFilter='${c.id}';touch()"><span class="course-dot"></span>${esc(c.code || c.name)}</button>`).join('')}
      </div>
      <div class="assign-toolbar-right">
        ${total ? `<div class="assign-progress" title="${done.length} of ${total} finished"><div class="progress"><div style="width:${pctDone}%"></div></div><span class="small muted">${pctDone}% done</span></div>` : ''}
        <div class="segmented">${[['todo', 'To do'], ['done', 'Done'], ['all', 'All']].map(([k, l]) => `<button class="${view === k ? 'active' : ''}" onclick="state._assignView='${k}';touch()">${l}</button>`).join('')}</div>
      </div>
    </div>

    ${activeCourses().length ? quickAddBar('assign', { mode: 'assignment', defaultCourseId: courseFilter !== 'all' ? courseFilter : null }) : ''}

    ${selectMode ? `
    <div class="card card-pad mb-16 select-bar">
      <label class="checkbox-row"><input type="checkbox" ${allSelected ? 'checked' : ''} onchange="toggleAssignSelectAll()"><span>Select all${visible.length ? ` (${visible.length})` : ''}</span></label>
      <div class="flex-gap" style="align-items:center">
        <span class="small muted">${selected.size} selected</span>
        <button class="btn btn-sm" ${selected.size ? '' : 'disabled'} onclick="bulkMarkAssignmentsDone()">${icon('check', 13, 2.2)} Mark done</button>
        <button class="btn btn-danger btn-sm" ${selected.size ? '' : 'disabled'} onclick="bulkDeleteAssignments()">${icon('trash', 13)} Delete</button>
      </div>
    </div>` : ''}

    ${view === 'todo' && startSoon.length ? `<div class="sg-callout mb-16"><span>${icon('flag', 14, 1.8)}</span><div class="small"><span class="sg-strong">Start soon:</span> ${startSoon.map(a => `<button class="sg-link" style="font-size:12.5px" onclick="openAssignmentModal('${a.id}')">${esc(a.title)}</button>`).join(', ')}</div></div>` : ''}

    ${view === 'todo' ? (groups.length ? groups.map(([k, label, items]) => `
      <section class="assign-group ${k === 'overdue' ? 'is-overdue' : ''}">
        <div class="assign-group-head"><span>${label}</span><span class="assign-count">${items.length}</span></div>
        <div class="card assign-list">${items.map(a => assignmentRow(a, selectMode, selected)).join('')}</div>
      </section>`).join('') : emptyState(icon('cloud-sun', 26, 1.4), total ? 'All caught up' : 'No assignments yet', total ? '' : `<button class="btn btn-primary mt-8" onclick="openAssignmentUploadModal()">${icon('sparkles', 13, 1.6)} Upload a syllabus or assignment sheet</button>`, total ? 'Nothing left to do here. Nice work.' : 'Add one above, or upload a document and Semester HQ pulls out every deadline.'))
      : `<div class="card assign-list">${visible.length ? visible.map(a => assignmentRow(a, selectMode, selected)).join('') : `<div class="card-pad">${emptyState(icon('clipboard-list', 26, 1.4), view === 'done' ? 'Nothing finished yet.' : 'No assignments match.')}</div>`}</div>`}
  `;
}
function assignmentRow(a, selectMode, selected) {
  const isDone = isAssignmentDone(a);
  const isSelected = !!(selected && selected.has(a.id));
  const overdue = !isDone && a.dueDate && a.dueDate < todayIso();
  const rowClick = selectMode ? `toggleAssignSelected('${a.id}')` : `openAssignmentModal('${a.id}')`;
  const rubricDone = (a.rubric || []).filter(r => r.done).length;
  const c = getCourse(a.courseId);
  return `<div class="assign-row ${isSelected ? 'selected' : ''} ${isDone ? 'is-done' : ''}" data-item-id="${a.id}" style="--course:${esc(c?.color || '#8a8a8a')}" onclick="${rowClick}" draggable="${selectMode ? 'false' : 'true'}" ondragstart="event.stopPropagation();dragStartItem(event,'assignment','${a.id}')" title="${selectMode ? '' : 'Drag onto the Calendar to reschedule or plan work time'}">
    ${selectMode
      ? `<button type="button" class="row-check ${isSelected ? 'checked' : ''}" role="checkbox" aria-checked="${isSelected}" aria-label="${isSelected ? 'Deselect' : 'Select'} ${esc(a.title)}" onclick="event.stopPropagation();toggleAssignSelected('${a.id}')">${isSelected ? checkGlyph(true) : ''}</button>`
      : `<button type="button" class="row-check ${isDone ? 'checked' : ''}" role="checkbox" aria-checked="${isDone}" aria-label="Mark ${esc(a.title)} as ${isDone ? 'not done' : 'done'}" onclick="event.stopPropagation();toggleAssignmentDone('${a.id}')">${isDone ? checkGlyph(true) : ''}</button>`}
    <div class="assign-main">
      <div class="assign-title">${esc(a.title)}${a.attachments && a.attachments.length ? ` <span class="muted">${icon('paperclip', 12, 1.8)}</span>` : ''}</div>
      <div class="assign-meta">
        <span class="assign-course"><span class="course-dot"></span>${esc(c ? (c.code || c.name) : 'No course')}</span>
        <span>${esc(a.type)}</span>
        ${a.status === 'in-progress' || a.status === 'waiting' ? `<span class="assign-status">${esc(STATUS_LABELS[a.status])}</span>` : ''}
        ${(a.rubric || []).length ? `<span>${rubricDone}/${a.rubric.length} steps</span>` : ''}
      </div>
    </div>
    <div class="assign-due ${overdue ? 'sg-overdue' : ''}">${a.dueDate ? `${esc(isDone ? fmtDate(a.dueDate) : relativeDay(a.dueDate).replace(' (overdue)', ''))}${a.dueTime && a.dueTime !== '23:59' && !isDone ? `<span>${fmtTime(a.dueTime)}</span>` : ''}` : '<span class="muted">No date</span>'}</div>
  </div>`;
}
function bulkMarkAssignmentsDone() {
  const ids = state._assignSelectedIds || [];
  state.assignments.forEach(a => { if (ids.includes(a.id)) a.status = 'done'; });
  state._assignSelectedIds = []; state._assignSelectMode = false;
  touch();
  toast(`Marked ${ids.length} done`);
}
function toggleAssignmentDone(id) {
  const a = state.assignments.find(x => x.id === id);
  if (!a) return;
  const before = a.status;
  a.status = isAssignmentDone(a) ? 'not-started' : 'done';
  touch();
  if (a.status === 'done') { celebrateItem(a.id); toast(`Finished “${a.title}”`, 'success', 4000, { label: 'Undo', run: () => { a.status = before; touch(); } }); }
}
function toggleAssignSelectMode() {
  state._assignSelectMode = !state._assignSelectMode;
  state._assignSelectedIds = [];
  touch();
}
function toggleAssignSelected(id) {
  const set = new Set(state._assignSelectedIds || []);
  if (set.has(id)) set.delete(id); else set.add(id);
  state._assignSelectedIds = [...set];
  touch();
}
function toggleAssignSelectAll() {
  const ids = window._assignVisibleIds || [];
  const set = new Set(state._assignSelectedIds || []);
  const allSelected = ids.length > 0 && ids.every(id => set.has(id));
  state._assignSelectedIds = allSelected ? [] : ids.slice();
  touch();
}
function bulkDeleteAssignments() {
  const ids = state._assignSelectedIds || [];
  if (!ids.length) return;
  confirmDialog(`Delete ${ids.length} assignment${ids.length === 1 ? '' : 's'}? You can restore them from Recently Deleted for 30 days.`, () => {
    ids.forEach(id => {
      const a = state.assignments.find(x => x.id === id);
      if (a) trashItem('assignment', a.title || 'Untitled assignment', a);
    });
    state.assignments = state.assignments.filter(a => !ids.includes(a.id));
    state._assignSelectedIds = [];
    state._assignSelectMode = false;
    touch();
    toast(`Deleted ${ids.length} assignment${ids.length === 1 ? '' : 's'}`);
  }, `Delete ${ids.length}`);
}

function openAssignmentModal(id, presetCourseId) {
  const a = id ? state.assignments.find(x => x.id === id) : { id: uid(), courseId: presetCourseId || activeCourses()[0]?.id || null, title: '', type: 'assignment', dueDate: todayIso(), dueTime: '23:59', startByDate: null, maxPoints: null, earnedPoints: null, status: 'not-started', rubric: [], notes: '', attachments: [], recurringTemplateId: null };
  window._assignDraft = JSON.parse(JSON.stringify(a));
  if (!_assignDraft.attachments) _assignDraft.attachments = [];
  renderAssignmentModal(id);
}
function renderAssignmentModal(id) {
  const a = _assignDraft;
  openModal(`
    <div class="modal-head"><h3>${id ? 'Edit assignment' : 'New assignment'}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label>Title</label><input class="input" id="af-title" value="${esc(a.title)}"></div>
      <div class="field-row">
        <div class="field"><label>Course</label><select class="select" id="af-course" onchange="_assignDraft.courseId=this.value">${activeCourses().map(c => `<option value="${c.id}" ${c.id === a.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Type</label><select class="select" id="af-type" onchange="_assignDraft.type=this.value">${ASSIGNMENT_TYPES.map(t => `<option value="${t}" ${t === a.type ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      </div>

      <div class="field-row">
        <div class="field"><label>Due date</label>
          <input class="input" type="date" id="af-date" value="${a.dueDate || ''}" ${a.dueDate ? '' : 'disabled'}>
          <label class="checkbox-row small mt-4" style="font-weight:400"><input type="checkbox" ${a.dueDate ? '' : 'checked'} onchange="toggleNoDueDate('af-date',this.checked)"><span>No due date</span></label>
        </div>
        <div class="field"><label>Due time</label><input class="input" type="time" id="af-time" value="${a.dueTime || ''}"></div>
        <div class="field"><label>Status</label><select class="select" id="af-status">${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${k === a.status ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Start by <span class="small muted">(optional reminder)</span></label><input class="input" type="date" id="af-startby" value="${a.startByDate || ''}"></div>
      <div class="field"><label>Notes</label><textarea class="input" id="af-notes">${esc(a.notes || '')}</textarea></div>

      <div class="field">
        <label>Steps</label>
        <div id="af-rubric">${a.rubric.map((r, i) => rubricRow(r, i)).join('')}</div>
        <button class="btn btn-sm mt-8" onclick="addRubricRow()">+ Add a step</button>
      </div>
      ${id && a.type === 'exam' ? `<button class="sg-callout af-link" onclick="closeModal();openExamPrep('${id}')"><span>${icon('target', 14, 1.8)}</span><div class="small"><span class="sg-strong">Exam prep</span> · topics, study sessions, and flashcards for this exam</div>${icon('chevron-right', 13, 2)}</button>` : ''}
      ${id && ['project', 'paper', 'lab'].includes(a.type) ? `<button class="sg-callout af-link" onclick="planAssignmentAsProject('${id}')"><span>${icon('folder', 14, 1.8)}</span><div class="small"><span class="sg-strong">${state.projects.some(p => p.assignmentId === id) ? 'Open its project' : 'Plan it as a project'}</span> · break it into milestones spaced out to the due date</div>${icon('chevron-right', 13, 2)}</button>` : ''}

      <div class="field" style="margin-bottom:0">
        <label>Attachments <span class="small muted">(rubric, prompt, reference, reading, instructions)</span></label>
        <div id="af-attachments">${a.attachments.map((att, i) => attachmentRow(att, i)).join('')}</div>
        <div class="flex-gap mt-8">
          <button class="btn btn-sm" onclick="addAttachmentLink()">${icon('link',13,1.8)} Add link</button>
          <button class="btn btn-sm" onclick="$('#af-attach-file').click()">${icon('upload',13,1.8)} Upload file</button>
          <input type="file" id="af-attach-file" multiple style="display:none" onchange="addAttachmentFile(this.files)">
        </div>
      </div>
    </div>
    <div class="modal-foot">
      ${id ? `<button class="btn btn-danger" onclick="deleteAssignment('${id}')">Delete</button>` : ''}
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveAssignmentModal(${id ? `'${id}'` : 'null'})">Save</button>
    </div>
  `, { wide: true });
}
function attachmentRow(att, i) {
  return `<div class="field-row" style="align-items:center;margin-bottom:6px">
    <select class="select" style="max-width:140px" onchange="_assignDraft.attachments[${i}].kind=this.value">${ATTACHMENT_KINDS.map(k => `<option value="${k}" ${k === att.kind ? 'selected' : ''}>${k[0].toUpperCase() + k.slice(1)}</option>`).join('')}</select>
    <input class="input" value="${esc(att.name)}" placeholder="Name" oninput="_assignDraft.attachments[${i}].name=this.value">
    ${att.url ? `<a href="${esc(att.url)}" target="_blank" rel="noopener" class="btn btn-sm" onclick="event.stopPropagation()">Open</a>` : ''}
    <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove attachment" onclick="_assignDraft.attachments.splice(${i},1);syncAssignmentAttachmentsIfExisting();renderAssignmentModal(window._assignDraft.id && state.assignments.some(a=>a.id===window._assignDraft.id) ? window._assignDraft.id : null)">${icon('x',13,2.2)}</button>
  </div>`;
}
// Attachments added to an assignment that already exists in state are persisted
// immediately, not just staged on the draft, otherwise closing the modal any way
// other than clicking "Save" (the X button, Escape, clicking outside) silently
// discarded whatever was just uploaded.
function syncAssignmentAttachmentsIfExisting() {
  const existing = state.assignments.find(a => a.id === _assignDraft.id);
  if (existing) { existing.attachments = _assignDraft.attachments; save(); }
}
function addAttachmentLink() {
  const url = prompt('Paste a link (rubric, prompt, reading, etc.)');
  if (!url) return;
  _assignDraft.attachments.push({ id: uid(), kind: 'reference', name: url.replace(/^https?:\/\//, '').slice(0, 40), url, dataUrl: null });
  syncAssignmentAttachmentsIfExisting();
  renderAssignmentModal(state.assignments.some(a => a.id === _assignDraft.id) ? _assignDraft.id : null);
}
async function addAttachmentFile(files) {
  if (!files || !files.length) return;
  let skipped = 0;
  for (const file of files) {
    if (file.size > 3 * 1024 * 1024) { skipped++; continue; }
    const dataUrl = 'data:' + (file.type || 'application/octet-stream') + ';base64,' + (await fileToBase64(file));
    _assignDraft.attachments.push({ id: uid(), kind: 'other', name: file.name, url: dataUrl, dataUrl });
  }
  if (skipped) toast(`${skipped} file${skipped > 1 ? 's' : ''} too large to store in the browser (max ~3MB). Add ${skipped > 1 ? 'them' : 'it'} as a link instead`, 'error', 4000);
  syncAssignmentAttachmentsIfExisting();
  renderAssignmentModal(state.assignments.some(a => a.id === _assignDraft.id) ? _assignDraft.id : null);
  const input = $('#af-attach-file');
  if (input) input.value = '';
}
function rubricRow(r, i) {
  return `<div class="field-row" style="align-items:center;margin-bottom:6px">
    <button type="button" class="row-check ${r.done ? 'checked' : ''}" style="flex-shrink:0" role="checkbox" aria-checked="${!!r.done}" aria-label="Mark ${esc(r.item || 'step')} as ${r.done ? 'not done' : 'done'}" onclick="syncAssignDraftFields();_assignDraft.rubric[${i}].done=!_assignDraft.rubric[${i}].done;renderAssignmentModal(assignDraftExistingId())">${r.done ? checkGlyph(true) : ''}</button>
    <input class="input" value="${esc(r.item)}" placeholder="Outline, first draft, cite sources…" aria-label="Step ${i + 1}" oninput="_assignDraft.rubric[${i}].item=this.value">
    <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove step" onclick="syncAssignDraftFields();_assignDraft.rubric.splice(${i},1);renderAssignmentModal(assignDraftExistingId())">${icon('x',13,2.2)}</button>
  </div>`;
}
function assignDraftExistingId() { return state.assignments.some(a => a.id === _assignDraft.id) ? _assignDraft.id : null; }
// Re-rendering the modal (checking a step) used to throw away unsaved edits to the other fields.
function syncAssignDraftFields() {
  const d = _assignDraft, v = (id) => $(`#${id}`)?.value;
  if (!$('#af-title')) return;
  Object.assign(d, { title: v('af-title'), courseId: v('af-course'), type: v('af-type'), dueDate: v('af-date') || null, dueTime: v('af-time'), status: v('af-status'), startByDate: v('af-startby') || null, notes: v('af-notes') });
}
function addRubricRow() { syncAssignDraftFields(); _assignDraft.rubric.push({ id: uid(), item: '', done: false }); renderAssignmentModal(assignDraftExistingId()); }
function saveAssignmentModal(id) {
  const d = _assignDraft;
  d.title = $('#af-title').value.trim();
  if (!d.title) { toast('Give it a title', 'error'); return; }
  d.courseId = $('#af-course').value;
  d.type = $('#af-type').value;
  d.dueDate = $('#af-date').value || null;
  d.dueTime = $('#af-time').value;
  d.status = $('#af-status').value;
  d.startByDate = $('#af-startby').value || null;
  d.notes = $('#af-notes').value;
  if (id) { const i = state.assignments.findIndex(x => x.id === id); state.assignments[i] = d; } else state.assignments.push(d);
  touch(); closeModal(); toast(id ? 'Updated' : 'Assignment added');
}
function deleteAssignment(id) {
  confirmDialog('Delete this assignment? You can restore it from Recently Deleted for 30 days.', () => {
    const a = state.assignments.find(x => x.id === id);
    if (a) trashItem('assignment', a.title || 'Untitled assignment', a);
    state.assignments = state.assignments.filter(a => a.id !== id);
    touch(); closeModal();
    if (a) toast(`Deleted “${a.title}”`, 'success', 5000, { label: 'Undo', run: () => { const t = (state.trash || []).find(x => x.kind === 'assignment' && x.data.id === a.id); if (t) restoreTrashItem(t.id); } });
  });
}

/* ── Bulk upload assignments from a PDF/photo/pasted syllabus ──── */
function openAssignmentUploadModal() {
  if (!activeCourses().length) { toast('Add a course first so uploaded assignments have somewhere to go', 'error'); return; }
  openModal(`
    <div class="modal-head"><h3>Upload assignments <span class="ai-badge">AI</span></h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      ${!aiEnabled() ? `<div class="small" style="background:var(--warn-light);color:var(--warn);padding:10px 12px;border-radius:10px;margin-bottom:14px">AI parsing isn’t set up on this deployment yet.</div>` : ''}
      <div class="small muted mb-8">Upload a syllabus or assignment sheet to bulk-add deadlines to an existing course, instead of typing each one in by hand.</div>
      <div class="segmented mb-8" id="au-tabs">
        <button class="active" onclick="auTab('paste')" data-tab="paste">Paste text</button>
        <button onclick="auTab('pdf')" data-tab="pdf">Upload PDF</button>
        <button onclick="auTab('image')" data-tab="image">Upload photo</button>
      </div>
      <div id="au-paste">
        <textarea class="input" id="au-text" placeholder="Paste an assignment list or syllabus text here…" style="min-height:160px"></textarea>
      </div>
      <div id="au-pdf" style="display:none">
        <div class="upload-drop" onclick="$('#au-pdf-input').click()">
          <div class="small">Click to choose a PDF</div>
          <input type="file" id="au-pdf-input" accept="application/pdf" style="display:none" onchange="handleAssignUploadPdf(this.files[0])">
        </div>
        <div class="small muted mt-8" id="au-pdf-status"></div>
      </div>
      <div id="au-image" style="display:none">
        <div class="upload-drop" onclick="$('#au-image-input').click()">
          <div class="small">Click to choose one or more photos</div>
          <input type="file" id="au-image-input" accept="image/*" multiple style="display:none" onchange="handleAssignUploadImage(this.files)">
        </div>
        <div class="small muted mt-8" id="au-image-status"></div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="au-parse-btn" onclick="runAssignmentParse()" ${aiEnabled() ? '' : 'disabled'}>${icon('sparkles', 13, 1.5)} Parse with AI</button>
    </div>
  `, { wide: true });
  window._auImages = null;
}
function auTab(tab) {
  ['paste', 'pdf', 'image'].forEach(t => { $(`#au-${t}`).style.display = t === tab ? '' : 'none'; });
  $$('#au-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  window._auActiveTab = tab;
}
window._auActiveTab = 'paste';
async function handleAssignUploadPdf(file) {
  if (!file) return;
  $('#au-pdf-status').textContent = 'Reading PDF…';
  try {
    const text = await extractPdfText(file);
    $('#au-text').value = text;
    $('#au-pdf-status').textContent = `Extracted ${text.length.toLocaleString()} characters.`;
    auTab('paste');
  } catch (e) { $('#au-pdf-status').textContent = 'Could not read that PDF.'; }
  const input = $('#au-pdf-input');
  if (input) input.value = '';
}
async function handleAssignUploadImage(files) {
  if (!files || !files.length) return;
  $('#au-image-status').textContent = 'Loading…';
  window._auImages = await Promise.all(Array.from(files).map(async f => ({ base64: await fileToBase64(f), mediaType: f.type || 'image/jpeg' })));
  $('#au-image-status').textContent = `${window._auImages.length} photo${window._auImages.length > 1 ? 's' : ''} loaded, ready to parse.`;
  const input = $('#au-image-input');
  if (input) input.value = '';
}
async function runAssignmentParse() {
  const btn = $('#au-parse-btn');
  setBtnLoading(btn, true);
  try {
    let list;
    if (window._auActiveTab === 'image' && window._auImages && window._auImages.length) {
      list = await aiParseAssignments({ images: window._auImages });
    } else {
      const text = $('#au-text').value.trim();
      if (!text) { toast('Paste or upload something first', 'error'); setBtnLoading(btn, false); return; }
      list = await aiParseAssignments({ text });
    }
    closeModal();
    openAssignmentReviewModal(list);
  } catch (e) {
    toast(e.message || 'Could not parse that document', 'error', 4000);
  } finally { setBtnLoading(btn, false); }
}
function openAssignmentReviewModal(list) {
  window._auParsed = (list || []).map(a => ({ ...a, _include: true, id: uid() }));
  window._auCourseId = activeCourses()[0]?.id || null;
  renderAssignmentReviewModal();
}
function renderAssignmentReviewModal() {
  openModal(`
    <div class="modal-head"><h3>Review & add <span class="ai-badge">AI</span></h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="small muted mb-8">Double-check what the AI pulled out before adding it. Edit anything that's off, then pick which course these belong to.</div>
      <div class="field"><label>Add to course</label><select class="select" id="au-review-course" onchange="window._auCourseId=this.value">${activeCourses().map(c => `<option value="${c.id}" ${c.id === window._auCourseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Assignments found (${window._auParsed.length})</label>
        <div id="au-review-list" style="max-height:320px;overflow-y:auto">
          ${window._auParsed.length ? window._auParsed.map((a, i) => `
            <div class="list-row">
              <button type="button" class="row-check ${a._include ? 'checked' : ''}" role="checkbox" aria-checked="${a._include}" aria-label="${a._include ? 'Exclude' : 'Include'} ${esc(a.title)}" onclick="toggleAuAssignment(${i})">${a._include ? checkGlyph(true) : ''}</button>
              <div class="row-title">${esc(a.title)} ${typeTag(a.type || 'assignment')}</div>
              <div class="row-meta">${a.dueDate ? fmtDate(a.dueDate) : 'no date'}</div>
            </div>`).join('') : ''}
        </div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="commitAssignmentUpload()">Add ${window._auParsed.filter(a => a._include).length} assignment${window._auParsed.filter(a => a._include).length === 1 ? '' : 's'}</button>
    </div>
  `, { wide: true });
}
function toggleAuAssignment(i) { window._auParsed[i]._include = !window._auParsed[i]._include; renderAssignmentReviewModal(); }
function commitAssignmentUpload() {
  const courseId = window._auCourseId;
  const toAdd = (window._auParsed || []).filter(a => a._include && a.title);
  toAdd.forEach(a => {
    state.assignments.push({
      id: uid(), courseId, title: a.title, type: ASSIGNMENT_TYPES.includes(a.type) ? a.type : 'assignment',
      dueDate: a.dueDate || addDays(todayIso(), 7), dueTime: a.dueTime || '23:59', startByDate: null,
      maxPoints: a.maxPoints || null, earnedPoints: null, status: 'not-started', rubric: [], notes: '', attachments: [], recurringTemplateId: null,
    });
  });
  touch(); closeModal(); toast(`Added ${toAdd.length} assignment${toAdd.length === 1 ? '' : 's'}`);
}
