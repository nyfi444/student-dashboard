/* ── Assignment tracker + rubric checklist ───────────────────────── */
const STATUS_LABELS = ASSIGNMENT_STATUS_LABELS;
function isAssignmentDone(a) { return a.status === 'done' || a.status === 'submitted'; }

function pageAssignments() {
  const courseFilter = state._assignCourseFilter || 'all';
  const statusFilter = state._assignStatusFilter || 'all';
  const all = state.assignments.filter(a => activeCourses().some(c => c.id === a.courseId) || !a.courseId);
  let items = all;
  if (courseFilter !== 'all') items = items.filter(a => a.courseId === courseFilter);
  if (statusFilter !== 'all') items = items.filter(a => a.status === statusFilter);
  items = items.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  const counts = { 'not-started': 0, 'in-progress': 0, waiting: 0, submitted: 0, done: 0 };
  all.forEach(a => { counts[a.status] = (counts[a.status] || 0) + 1; });
  const startSoon = all.filter(a => a.startByDate && a.status !== 'done' && a.status !== 'submitted' && a.startByDate <= todayIso() && a.dueDate >= todayIso());

  return `
    ${pageHead('Assignment Tracker', `${all.length} assignment${all.length === 1 ? '' : 's'}`, `
      ${aiButton('Upload PDF', 'openAssignmentUploadModal()')}
      <button class="btn btn-primary" onclick="openAssignmentModal()">+ Add assignment</button>
    `)}
    <div class="grid grid-3 mb-16">
      <div class="stat-card"><div class="num">${counts['not-started']}</div><div class="lbl">Not started</div></div>
      <div class="stat-card"><div class="num">${counts['in-progress'] + counts.waiting}</div><div class="lbl">In progress / waiting</div></div>
      <div class="stat-card"><div class="num">${counts.submitted + counts.done}</div><div class="lbl">Submitted</div></div>
    </div>
    ${startSoon.length ? `<div class="card card-pad mb-16" style="border:1.5px solid var(--warn)">
      <div class="small" style="font-weight:600;color:var(--warn);margin-bottom:6px">${icon('flag',13,2)} Start these soon</div>
      ${startSoon.map(a => `<div class="list-row" onclick="openAssignmentModal('${a.id}')"><div class="row-title">${esc(a.title)}</div>${courseChip(a.courseId)}<div class="row-meta">due ${relativeDay(a.dueDate)}</div></div>`).join('')}
    </div>` : ''}
    <div class="flex-gap wrap mb-16">
      <select class="select" style="max-width:200px" onchange="state._assignCourseFilter=this.value;touch()">
        <option value="all">All courses</option>${activeCourses().map(c => `<option value="${c.id}" ${courseFilter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
      <select class="select" style="max-width:170px" onchange="state._assignStatusFilter=this.value;touch()">
        <option value="all">All statuses</option>${Object.entries(STATUS_LABELS).filter(([k]) => k !== 'done').map(([k, v]) => `<option value="${k}" ${statusFilter === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </div>
    <div class="card">
      ${items.length ? items.map(assignmentRow).join('') : `<div class="card-pad">${emptyState(icon('clipboard-list',26,1.4), 'No assignments match.')}</div>`}
    </div>
  `;
}
function assignmentRow(a) {
  const rubricDone = a.rubric.length ? a.rubric.filter(r => r.done).length : 0;
  const isDone = a.status === 'done' || a.status === 'submitted';
  return `<div class="list-row" style="border-bottom:1px solid var(--border)" onclick="openAssignmentModal('${a.id}')" draggable="true" ondragstart="event.stopPropagation();dragStartItem(event,'assignment','${a.id}')" title="Drag onto Calendar to reschedule or time-block">
    <button type="button" class="row-check ${isDone ? 'checked' : ''}" role="checkbox" aria-checked="${isDone}" aria-label="Mark ${esc(a.title)} as ${isDone ? 'not done' : 'done'}" onclick="event.stopPropagation();toggleAssignmentDone('${a.id}')">${isDone ? checkGlyph(true) : ''}</button>
    <div class="row-title ${isDone ? 'done' : ''}">${esc(a.title)} ${typeTag(a.type)} ${a.attachments && a.attachments.length ? icon('paperclip', 12, 1.8) : ''}</div>
    ${courseChip(a.courseId)}
    ${a.rubric.length ? `<span class="small muted">${rubricDone}/${a.rubric.length} rubric</span>` : ''}
    <span class="small ${a.status === 'in-progress' ? 'dim' : 'muted'}">${STATUS_LABELS[a.status]}</span>
    <div class="row-meta" style="color:${daysBetween(a.dueDate) < 0 && !isDone ? 'var(--danger)' : 'inherit'}">${a.dueDate ? relativeDay(a.dueDate) : 'no date'}</div>
  </div>`;
}
function toggleAssignmentDone(id) {
  const a = state.assignments.find(x => x.id === id);
  a.status = (a.status === 'done' || a.status === 'submitted') ? 'not-started' : 'done';
  touch();
}

function openAssignmentModal(id) {
  const a = id ? state.assignments.find(x => x.id === id) : { id: uid(), courseId: activeCourses()[0]?.id || null, title: '', type: 'assignment', dueDate: todayIso(), dueTime: '23:59', startByDate: null, maxPoints: null, earnedPoints: null, status: 'not-started', rubric: [], notes: '', attachments: [], recurringTemplateId: null };
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
        <div class="field"><label>Course</label><select class="select" id="af-course">${activeCourses().map(c => `<option value="${c.id}" ${c.id === a.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Type</label><select class="select" id="af-type">${ASSIGNMENT_TYPES.map(t => `<option value="${t}" ${t === a.type ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Due date</label><input class="input" type="date" id="af-date" value="${a.dueDate || ''}"></div>
        <div class="field"><label>Due time</label><input class="input" type="time" id="af-time" value="${a.dueTime || ''}"></div>
        <div class="field"><label>Status</label><select class="select" id="af-status">${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${k === a.status ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Start by <span class="small muted">(optional reminder)</span></label><input class="input" type="date" id="af-startby" value="${a.startByDate || ''}"></div>
      <div class="field-row">
        <div class="field"><label>Points earned</label><input class="input" type="number" id="af-earned" value="${a.earnedPoints ?? ''}"></div>
        <div class="field"><label>Points possible</label><input class="input" type="number" id="af-max" value="${a.maxPoints ?? ''}"></div>
      </div>
      <div class="field"><label>Notes</label><textarea class="input" id="af-notes">${esc(a.notes || '')}</textarea></div>

      <div class="field">
        <div class="flex-between"><label>Rubric checklist</label>${aiEnabled() ? '' : ''}</div>
        <div id="af-rubric">${a.rubric.map((r, i) => rubricRow(r, i)).join('')}</div>
        <button class="btn btn-sm mt-8" onclick="addRubricRow()">+ Break into gradable pieces</button>
      </div>

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
    <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove attachment" onclick="_assignDraft.attachments.splice(${i},1);renderAssignmentModal(window._assignDraft.id && state.assignments.some(a=>a.id===window._assignDraft.id) ? window._assignDraft.id : null)">${icon('x',13,2.2)}</button>
  </div>`;
}
function addAttachmentLink() {
  const url = prompt('Paste a link (rubric, prompt, reading, etc.)');
  if (!url) return;
  _assignDraft.attachments.push({ id: uid(), kind: 'reference', name: url.replace(/^https?:\/\//, '').slice(0, 40), url, dataUrl: null });
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
  if (skipped) toast(`${skipped} file${skipped > 1 ? 's' : ''} too large to store in the browser (max ~3MB) — add ${skipped > 1 ? 'them' : 'it'} as a link instead`, 'error', 4000);
  renderAssignmentModal(state.assignments.some(a => a.id === _assignDraft.id) ? _assignDraft.id : null);
}
function rubricRow(r, i) {
  return `<div class="field-row" style="align-items:center;margin-bottom:6px">
    <button type="button" class="row-check ${r.done ? 'checked' : ''}" style="flex-shrink:0" role="checkbox" aria-checked="${r.done}" aria-label="Mark ${esc(r.item || 'rubric item')} as ${r.done ? 'not done' : 'done'}" onclick="_assignDraft.rubric[${i}].done=!_assignDraft.rubric[${i}].done;renderAssignmentModal()">${r.done ? checkGlyph(true) : ''}</button>
    <input class="input" value="${esc(r.item)}" placeholder="Piece of the assignment" oninput="_assignDraft.rubric[${i}].item=this.value">
    <input class="input" type="number" value="${r.points ?? ''}" style="max-width:80px" placeholder="pts" oninput="_assignDraft.rubric[${i}].points=Number(this.value)">
    <input class="input" type="number" value="${r.earned ?? ''}" style="max-width:80px" placeholder="earned" oninput="_assignDraft.rubric[${i}].earned=Number(this.value)">
    <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove rubric item" onclick="_assignDraft.rubric.splice(${i},1);renderAssignmentModal()">${icon('x',13,2.2)}</button>
  </div>`;
}
function addRubricRow() { _assignDraft.rubric.push({ id: uid(), item: '', points: null, earned: null, done: false }); renderAssignmentModal(); }
function saveAssignmentModal(id) {
  const d = _assignDraft;
  d.title = $('#af-title').value.trim();
  if (!d.title) { toast('Give it a title', 'error'); return; }
  d.courseId = $('#af-course').value;
  d.type = $('#af-type').value;
  d.dueDate = $('#af-date').value;
  d.dueTime = $('#af-time').value;
  d.status = $('#af-status').value;
  d.startByDate = $('#af-startby').value || null;
  d.earnedPoints = $('#af-earned').value === '' ? null : Number($('#af-earned').value);
  d.maxPoints = $('#af-max').value === '' ? null : Number($('#af-max').value);
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
}
async function handleAssignUploadImage(files) {
  if (!files || !files.length) return;
  $('#au-image-status').textContent = 'Loading…';
  window._auImages = await Promise.all(Array.from(files).map(async f => ({ base64: await fileToBase64(f), mediaType: f.type || 'image/jpeg' })));
  $('#au-image-status').textContent = `${window._auImages.length} photo${window._auImages.length > 1 ? 's' : ''} loaded — ready to parse.`;
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
      <div class="small muted mb-8">Double-check what the AI pulled out before adding it — edit anything that's off, then pick which course these belong to.</div>
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
