/* ── To-do list ────────────────────────────────────────────────────
   Two ways to look at the same list: by when it's due (overdue, today,
   tomorrow, this week, later, someday) or by your own lists ("Errands",
   "Club stuff"). Quick add reads plain English, repeating to-dos add
   themselves on schedule, and finished items tuck away at the bottom.
──────────────────────────────────────────────────────────────── */
const TODO_REPEAT_LABELS = { daily: 'Every day', weekdays: 'Every weekday', weekly: 'Weekly' };

function todoInFilter(t, filter) { return filter === 'all' || (filter === 'none' ? !t.courseId : t.courseId === filter); }
function todoDueKey(t) { return (t.dueDate || '9999-99-99') + (t.dueTime || '99:99'); }
function sortTodos(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const pr = { high: 0, medium: 1, low: 2 };
  return todoDueKey(a).localeCompare(todoDueKey(b)) || (pr[a.priority] ?? 1) - (pr[b.priority] ?? 1);
}

function pageTodos() {
  const filter = state.todoFilter || 'all';
  const view = state._todoView === 'lists' ? 'lists' : 'date';
  const selectMode = !!state._todoSelectMode;
  const selected = new Set(state._todoSelectedIds || []);
  const t = todayIso(), tomorrow = addDays(t, 1), weekEnd = addDays(t, 7);
  const scoped = state.todos.filter(x => todoInFilter(x, filter));
  const open = scoped.filter(x => !x.done).sort(sortTodos);
  const done = scoped.filter(x => x.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  window._todoVisibleIds = open.map(x => x.id);
  const allSelected = open.length > 0 && open.every(x => selected.has(x.id));
  const overdue = open.filter(x => x.dueDate && x.dueDate < t).length;
  const dueToday = open.filter(x => x.dueDate === t).length;

  const groups = view === 'date'
    ? [
      ['overdue', 'Overdue', open.filter(x => x.dueDate && x.dueDate < t)],
      ['today', 'Today', open.filter(x => x.dueDate === t)],
      ['tomorrow', 'Tomorrow', open.filter(x => x.dueDate === tomorrow)],
      ['week', 'Next 7 days', open.filter(x => x.dueDate > tomorrow && x.dueDate <= weekEnd)],
      ['later', 'Later', open.filter(x => x.dueDate > weekEnd)],
      ['someday', 'Someday', open.filter(x => !x.dueDate)],
    ].filter(([, , items]) => items.length)
    : [
      ...state.todoSections.map(s => [s.id, s.name, open.filter(x => x.sectionId === s.id)]),
      ['_none', state.todoSections.length ? 'Not in a list' : 'Tasks', open.filter(x => !x.sectionId || !state.todoSections.some(s => s.id === x.sectionId))],
    ].filter(([k, , items]) => items.length || k !== '_none');

  return `
    ${pageHead('To-Do List', `${open.length} open${dueToday ? ` · ${dueToday} today` : ''}${overdue ? ` · ${overdue} overdue` : ''}`, `
      <button class="btn btn-sm ${selectMode ? 'btn-primary' : ''}" onclick="toggleTodoSelectMode()">${icon('check-square', 13, 2)} ${selectMode ? 'Cancel' : 'Select'}</button>
      <button class="btn btn-sm" onclick="openSectionModal()">${icon('plus', 13, 2.2)} New list</button>
      <button class="btn btn-primary" onclick="openTodoModal()">+ Add to-do</button>
    `)}
    ${quickAddBar('todos', { mode: 'todo' })}
    <div class="assign-toolbar">
      <div class="chip-row" role="group" aria-label="Filter by class">
        <button class="chip ${filter === 'all' ? 'active' : ''}" onclick="setState({todoFilter:'all'})">Everything</button>
        ${activeCourses().filter(c => state.todos.some(x => x.courseId === c.id)).map(c => `<button class="chip ${filter === c.id ? 'active' : ''}" style="--course:${esc(c.color || '#5a6b7b')}" onclick="setState({todoFilter:'${c.id}'})"><span class="course-dot"></span>${esc(c.code || c.name)}</button>`).join('')}
        <button class="chip ${filter === 'none' ? 'active' : ''}" onclick="setState({todoFilter:'none'})">Personal</button>
      </div>
      <div class="segmented" role="group" aria-label="Group to-dos">
        <button class="${view === 'date' ? 'active' : ''}" aria-pressed="${view === 'date'}" onclick="state._todoView='date';touch()">${icon('calendar', 12, 2)} By date</button>
        <button class="${view === 'lists' ? 'active' : ''}" aria-pressed="${view === 'lists'}" onclick="state._todoView='lists';touch()">${icon('layers', 12, 2)} By list</button>
      </div>
    </div>

    ${selectMode ? `
    <div class="card card-pad mb-16 select-bar">
      <label class="checkbox-row"><input type="checkbox" ${allSelected ? 'checked' : ''} onchange="toggleTodoSelectAll()"><span>Select all${open.length ? ` (${open.length})` : ''}</span></label>
      <div class="flex-gap" style="align-items:center">
        <span class="small muted">${selected.size} selected</span>
        <button class="btn btn-sm" ${selected.size ? '' : 'disabled'} onclick="bulkCompleteTodos()">${icon('check', 13, 2.2)} Mark done</button>
        <button class="btn btn-danger btn-sm" ${selected.size ? '' : 'disabled'} onclick="bulkDeleteTodos()">${icon('trash', 13)} Delete</button>
      </div>
    </div>` : ''}

    ${open.length || view === 'lists' && state.todoSections.length ? groups.map(([k, label, items]) => `
      <section class="assign-group ${k === 'overdue' ? 'is-overdue' : ''}">
        <div class="assign-group-head">
          <span>${esc(label)}</span><span class="assign-count">${items.length}</span>
          ${view === 'lists' && k !== '_none' ? `<span class="todo-list-actions"><button class="btn btn-ghost btn-icon btn-sm" aria-label="Add a to-do to ${esc(label)}" onclick="openTodoModal(null,{sectionId:'${k}'})">${icon('plus', 13, 2)}</button><button class="btn btn-ghost btn-icon btn-sm" aria-label="Rename or delete ${esc(label)}" onclick="openSectionModal('${k}')">${icon('pencil', 12)}</button></span>` : ''}
        </div>
        ${expandable(`todo-${k}`, label, `<div class="card assign-list">${items.length ? items.map(x => todoRow(x, { selectMode, selected, showList: view === 'date' })).join('') : `<div class="todo-list-empty small muted">Nothing in this list. <button class="sg-link" onclick="openTodoModal(null,{sectionId:'${k}'})">Add one</button></div>`}</div>`, { max: 420, count: items.length })}
      </section>`).join('') : emptyState(icon('check-square', 26, 1.4), scoped.length ? 'All done. Nice.' : 'A clear list', '', scoped.length ? 'Everything here is checked off.' : 'Type above like you’d text yourself: “laundry sunday”, “email advisor tomorrow 3pm !”')}

    ${done.length ? `
      <details class="todo-done" ${state._todoDoneOpen ? 'open' : ''} ontoggle="state._todoDoneOpen=this.open">
        <summary><span>${icon('check', 12, 2.4)} Completed</span><span class="assign-count">${done.length}</span></summary>
        ${expandable('todo-done', 'Completed', `<div class="card assign-list">${done.slice(0, 50).map(x => todoRow(x, { showList: view === 'date' })).join('')}</div>`, { max: 420, count: Math.min(done.length, 50) })}
        <button class="btn btn-ghost btn-sm mt-8" onclick="clearCompletedTodos()">${icon('trash', 12)} Clear completed</button>
      </details>` : ''}

    <details class="card card-pad todo-repeat" ${state.recurringTemplates.length ? '' : ''}>
      <summary class="flex-between"><span class="sg-h3">${icon('refresh-cw', 14, 1.8)} Repeating to-dos</span><span class="small muted">${state.recurringTemplates.length ? `${state.recurringTemplates.length} set up` : 'Readings, laundry, weekly check-ins'}</span></summary>
      <div class="mt-8">
        ${state.recurringTemplates.map(rt => `
          <div class="sg-person">
            <span class="sg-activity-ic">${icon('refresh-cw', 13, 1.8)}</span>
            <div class="row-title small">${esc(rt.title)} <span class="muted">· ${esc(repeatLabel(rt))}</span></div>
            ${rt.courseId && getCourse(rt.courseId) ? courseChip(rt.courseId) : ''}
            <button class="btn btn-ghost btn-icon btn-sm" aria-label="Stop repeating ${esc(rt.title)}" onclick="deleteRecurringTemplate('${rt.id}')">${icon('trash', 14)}</button>
          </div>`).join('') || '<p class="small muted mb-8">Set something up once and it adds itself to your list on schedule.</p>'}
        <button class="btn btn-sm mt-8" onclick="openRecurringModal()">+ New repeating to-do</button>
      </div>
    </details>
  `;
}

function todoRow(x, { selectMode = false, selected = null, showList = true } = {}) {
  const isSelected = !!(selected && selected.has(x.id));
  const c = getCourse(x.courseId);
  const overdue = !x.done && x.dueDate && x.dueDate < todayIso();
  const list = showList && x.sectionId ? state.todoSections.find(s => s.id === x.sectionId) : null;
  const rowClick = selectMode ? `toggleTodoSelected('${x.id}')` : `openTodoModal('${x.id}')`;
  const due = x.dueDate ? `${esc(x.done ? fmtDate(x.dueDate) : relativeDay(x.dueDate).replace(' (overdue)', ''))}${x.dueTime && !x.done ? `<span>${fmtTime(x.dueTime)}</span>` : ''}` : (x.dueTime ? `<span>${fmtTime(x.dueTime)}</span>` : '');
  return `<div class="assign-row todo-row ${isSelected ? 'selected' : ''} ${x.done ? 'is-done' : ''}" data-item-id="${x.id}" style="--course:${esc(c?.color || 'var(--border)')}" onclick="${rowClick}" draggable="${selectMode ? 'false' : 'true'}" ondragstart="event.stopPropagation();dragStartItem(event,'todo','${x.id}')">
    ${selectMode
      ? `<button type="button" class="row-check ${isSelected ? 'checked' : ''}" role="checkbox" aria-checked="${isSelected}" aria-label="${isSelected ? 'Deselect' : 'Select'} ${esc(x.title)}" onclick="event.stopPropagation();toggleTodoSelected('${x.id}')">${isSelected ? checkGlyph(true) : ''}</button>`
      : `<button type="button" class="row-check ${x.done ? 'checked' : ''}" role="checkbox" aria-checked="${!!x.done}" aria-label="Mark ${esc(x.title)} as ${x.done ? 'not done' : 'done'}" onclick="event.stopPropagation();toggleTodo('${x.id}')">${x.done ? checkGlyph(true) : ''}</button>`}
    <div class="assign-main">
      <div class="assign-title">${x.priority === 'high' && !x.done ? `<span class="todo-flag" title="High priority">${icon('flag', 12, 2)}</span>` : ''}${esc(x.title)}</div>
      ${c || list || x.recurringTemplateId || x.notes ? `<div class="assign-meta">
        ${c ? `<span class="assign-course"><span class="course-dot"></span>${esc(c.code || c.name)}</span>` : ''}
        ${list ? `<span>${esc(list.name)}</span>` : ''}
        ${x.recurringTemplateId ? `<span title="Repeating">${icon('refresh-cw', 11, 2)}</span>` : ''}
        ${x.notes ? `<span title="Has notes">${icon('file-text', 11, 2)}</span>` : ''}
        ${x.priority === 'low' && !x.done ? '<span>Low priority</span>' : ''}
      </div>` : ''}
    </div>
    <div class="assign-due ${overdue ? 'sg-overdue' : ''}">${due}</div>
  </div>`;
}

function toggleTodo(id) {
  const x = state.todos.find(y => y.id === id);
  if (!x) return;
  x.done = !x.done;
  x.doneAt = x.done ? Date.now() : null;
  touch();
  if (x.done) { celebrateItem(x.id); toast(`Checked off “${x.title}”`, 'success', 4000, { label: 'Undo', run: () => { x.done = false; x.doneAt = null; touch(); } }); }
}
function deleteTodo(id) {
  const x = state.todos.find(y => y.id === id);
  if (x) trashItem('todo', x.title || 'Untitled to-do', x);
  state.todos = state.todos.filter(y => y.id !== id);
  const blocks = dropLinkedBlocks('todo', [id]);
  touch();
  if (x) toast(`Deleted “${x.title}”`, 'success', 5000, { label: 'Undo', run: () => { const tr = (state.trash || []).find(z => z.kind === 'todo' && z.data.id === x.id); if (tr) restoreTrashItem(tr.id); restoreLinkedBlocks(blocks); touch(); } });
}
function clearCompletedTodos() {
  const doneItems = state.todos.filter(x => x.done && todoInFilter(x, state.todoFilter || 'all'));
  if (!doneItems.length) return;
  doneItems.forEach(x => trashItem('todo', x.title || 'Untitled to-do', x));
  const ids = new Set(doneItems.map(x => x.id));
  state.todos = state.todos.filter(x => !ids.has(x.id));
  dropLinkedBlocks('todo', [...ids]);
  touch();
  toast(`Cleared ${doneItems.length} completed`, 'success', 5000, { label: 'Undo', run: () => { (state.trash || []).filter(z => z.kind === 'todo' && ids.has(z.data.id)).forEach(z => restoreTrashItem(z.id)); } });
}

/* ── Lists (sections) ──────────────────────────────────────────── */
function openSectionModal(id) {
  const s = id ? state.todoSections.find(x => x.id === id) : null;
  openModal(`
    <div class="modal-head"><h3>${id ? 'Edit list' : 'New list'}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label for="sec-name">List name</label><input class="input" id="sec-name" value="${esc(s?.name || '')}" maxlength="60" placeholder="Errands, Club stuff, Dorm…" onkeydown="if(event.key==='Enter')saveSectionModal(${id ? `'${id}'` : 'null'})"></div>
      ${!id ? `<div class="chip-row">${['Errands', 'Personal', 'Club stuff', 'Job', 'Dorm'].filter(n => !state.todoSections.some(x => x.name === n)).map(n => `<button class="chip" onclick="$('#sec-name').value='${n}'">${n}</button>`).join('')}</div>` : ''}
    </div>
    <div class="modal-foot">
      ${id ? `<button class="btn btn-danger" style="margin-right:auto" onclick="deleteSection('${id}')">Delete list</button>` : ''}
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveSectionModal(${id ? `'${id}'` : 'null'})">${id ? 'Save' : 'Create list'}</button>
    </div>
  `);
}
function saveSectionModal(id) {
  const name = $('#sec-name').value.trim();
  if (!name) { toast('Give it a name', 'error'); return; }
  if (id) state.todoSections.find(x => x.id === id).name = name;
  else { state.todoSections.push({ id: uid(), name }); state._todoView = 'lists'; }
  touch(); closeModal(); toast(id ? 'List updated' : `Created “${name}”`);
}
function deleteSection(id) {
  confirmDialog('Delete this list? The to-dos in it stay on your list, just not in this list.', () => {
    state.todoSections = state.todoSections.filter(s => s.id !== id);
    state.todos.forEach(x => { if (x.sectionId === id) x.sectionId = null; });
    touch(); closeModal();
  }, 'Delete list');
}

/* ── Select mode ───────────────────────────────────────────────── */
function toggleTodoSelectMode() {
  state._todoSelectMode = !state._todoSelectMode;
  state._todoSelectedIds = [];
  touch();
}
function toggleTodoSelected(id) {
  const set = new Set(state._todoSelectedIds || []);
  if (set.has(id)) set.delete(id); else set.add(id);
  state._todoSelectedIds = [...set];
  touch();
}
function toggleTodoSelectAll() {
  const ids = window._todoVisibleIds || [];
  const set = new Set(state._todoSelectedIds || []);
  const allSelected = ids.length > 0 && ids.every(id => set.has(id));
  state._todoSelectedIds = allSelected ? [] : ids.slice();
  touch();
}
function bulkCompleteTodos() {
  const ids = new Set(state._todoSelectedIds || []);
  state.todos.forEach(x => { if (ids.has(x.id)) { x.done = true; x.doneAt = Date.now(); } });
  state._todoSelectedIds = []; state._todoSelectMode = false;
  touch();
  toast(`Marked ${ids.size} done`);
}
function bulkDeleteTodos() {
  const ids = state._todoSelectedIds || [];
  if (!ids.length) return;
  confirmDialog(`Delete ${ids.length} to-do${ids.length === 1 ? '' : 's'}? You can restore them from Recently Deleted for 30 days.`, () => {
    ids.forEach(id => {
      const x = state.todos.find(y => y.id === id);
      if (x) trashItem('todo', x.title || 'Untitled to-do', x);
    });
    state.todos = state.todos.filter(x => !ids.includes(x.id));
    state._todoSelectedIds = [];
    state._todoSelectMode = false;
    touch();
    toast(`Deleted ${ids.length} to-do${ids.length === 1 ? '' : 's'}`);
  }, `Delete ${ids.length}`);
}

/* ── Edit a to-do ──────────────────────────────────────────────── */
function openTodoModal(id, preset = {}) {
  const filter = state.todoFilter;
  const x = id ? state.todos.find(y => y.id === id) : { id: uid(), courseId: filter && filter !== 'all' && filter !== 'none' ? filter : null, sectionId: preset.sectionId || null, title: '', done: false, dueDate: preset.sectionId ? null : todayIso(), dueTime: null, priority: 'medium', notes: '', recurring: null };
  if (!x) return;
  window._todoDraft = { ...x, priority: x.priority || 'medium' };
  renderTodoModal(id);
}
function renderTodoModal(id) {
  const x = window._todoDraft;
  openModal(`
    <div class="modal-head"><h3>${id ? 'Edit to-do' : 'New to-do'}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label for="tf-title">What needs doing?</label><input class="input" id="tf-title" value="${esc(x.title)}" maxlength="200" onkeydown="if(event.key==='Enter')saveTodoModal(${id ? `'${id}'` : 'null'})"></div>
      <div class="field-row">
        <div class="field"><label for="tf-course">Class</label><select class="select" id="tf-course"><option value="">Personal</option>${activeCourses().map(c => `<option value="${c.id}" ${c.id === x.courseId ? 'selected' : ''}>${esc(c.code ? `${c.code} · ${c.name}` : c.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="tf-section">List</label><select class="select" id="tf-section"><option value="">None</option>${state.todoSections.map(s => `<option value="${s.id}" ${s.id === x.sectionId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="tf-date">Due</label>
          <input class="input" type="date" id="tf-date" value="${x.dueDate || ''}" ${x.dueDate ? '' : 'disabled'}>
          <label class="checkbox-row small mt-4" style="font-weight:400"><input type="checkbox" ${x.dueDate ? '' : 'checked'} onchange="toggleNoDueDate('tf-date',this.checked)"><span>Someday (no date)</span></label>
        </div>
        <div class="field"><label for="tf-time">Time <span class="muted">(optional)</span></label><input class="input" type="time" id="tf-time" value="${x.dueTime || ''}"></div>
      </div>
      <div class="field"><label>Priority</label>
        <div class="segmented" role="group" aria-label="Priority">${['low', 'medium', 'high'].map(p => `<button type="button" class="${x.priority === p ? 'active' : ''}" aria-pressed="${x.priority === p}" onclick="_todoDraft.priority='${p}';this.parentElement.querySelectorAll('button').forEach(b=>{b.classList.toggle('active',b===this);b.setAttribute('aria-pressed',b===this)})">${p === 'high' ? icon('flag', 11, 2) + ' ' : ''}${p[0].toUpperCase() + p.slice(1)}</button>`).join('')}</div>
      </div>
      <div class="field" style="margin-bottom:0"><label for="tf-notes">Notes</label><textarea class="input" id="tf-notes" maxlength="2000" placeholder="Links, details, anything to remember">${esc(x.notes || '')}</textarea></div>
    </div>
    <div class="modal-foot">
      ${id ? `<button class="btn btn-danger" style="margin-right:auto" onclick="closeModal();deleteTodo('${id}')">Delete</button>` : ''}
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveTodoModal(${id ? `'${id}'` : 'null'})">Save</button>
    </div>
  `);
}
function saveTodoModal(id) {
  const d = window._todoDraft;
  d.title = $('#tf-title').value.trim();
  if (!d.title) { toast('Give it a title', 'error'); return; }
  d.courseId = $('#tf-course').value || null;
  d.sectionId = $('#tf-section').value || null;
  d.dueDate = $('#tf-date').value || null;
  d.dueTime = $('#tf-time').value || null;
  d.notes = $('#tf-notes').value.trim();
  if (id) { const i = state.todos.findIndex(y => y.id === id); if (i >= 0) state.todos[i] = d; } else state.todos.unshift(d);
  touch(); closeModal(); toast(id ? 'Updated' : 'Added to your list');
}

/* ── Repeating to-dos ──────────────────────────────────────────── */
function repeatDays(rt) { return Array.isArray(rt.days) && rt.days.length ? rt.days : rt.dayOfWeek != null ? [rt.dayOfWeek] : []; }
function repeatLabel(rt) {
  if (rt.freq === 'daily') return 'Every day';
  if (rt.freq === 'weekdays') return 'Every weekday';
  const days = repeatDays(rt).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  return `Every ${days.map(d => DOW_NAMES[d]).join(', ') || 'week'}`;
}
function openRecurringModal() {
  window._rtDraft = { freq: 'weekly', days: [new Date().getDay()] };
  openModal(`
    <div class="modal-head"><h3>New repeating to-do</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label for="rf-title">What repeats?</label><input class="input" id="rf-title" maxlength="200" placeholder="Weekly reading response"></div>
      <div class="field"><label for="rf-course">Class</label><select class="select" id="rf-course"><option value="">Personal</option>${activeCourses().map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Repeats</label>
        <div class="segmented" id="rf-freq" role="group" aria-label="How often">${Object.entries(TODO_REPEAT_LABELS).map(([k, l]) => `<button type="button" class="${k === 'weekly' ? 'active' : ''}" aria-pressed="${k === 'weekly'}" onclick="setRepeatFreq('${k}')">${l}</button>`).join('')}</div>
      </div>
      <div class="field" id="rf-days-field"><label>On</label>
        <div class="chip-row" id="rf-days">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button type="button" class="chip ${window._rtDraft.days.includes(d) ? 'active' : ''}" aria-pressed="${window._rtDraft.days.includes(d)}" onclick="toggleRepeatDay(${d},this)">${DOW_NAMES[d]}</button>`).join('')}</div>
      </div>
      <p class="small muted">Each one shows up on your list the day it’s due.</p>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveRecurringTemplate()">Start repeating</button>
    </div>
  `);
}
function setRepeatFreq(freq) {
  window._rtDraft.freq = freq;
  $$('#rf-freq button').forEach(b => { const on = b.textContent === TODO_REPEAT_LABELS[freq]; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
  $('#rf-days-field').hidden = freq !== 'weekly';
}
function toggleRepeatDay(d, btn) {
  const days = window._rtDraft.days;
  const i = days.indexOf(d);
  if (i >= 0) days.splice(i, 1); else days.push(d);
  btn.classList.toggle('active', i < 0); btn.setAttribute('aria-pressed', i < 0);
}
function saveRecurringTemplate() {
  const title = $('#rf-title').value.trim();
  if (!title) { toast('Give it a title', 'error'); return; }
  const { freq, days } = window._rtDraft;
  if (freq === 'weekly' && !days.length) { toast('Pick at least one day', 'error'); return; }
  state.recurringTemplates.push({ id: uid(), title, courseId: $('#rf-course').value || null, freq, days: freq === 'weekly' ? days.slice() : [], dayOfWeek: freq === 'weekly' ? days[0] : null, priority: 'medium' });
  materializeRecurringTodos();
  touch(); closeModal(); toast('Repeating to-do created');
}
function deleteRecurringTemplate(id) {
  const rt = state.recurringTemplates.find(r => r.id === id);
  confirmDialog(`Stop repeating “${rt?.title || 'this to-do'}”? To-dos it already added stay on your list.`, () => {
    state.recurringTemplates = state.recurringTemplates.filter(r => r.id !== id);
    touch();
  }, 'Stop repeating');
}
// Adds the next occurrence of each repeating to-do: today's for daily and
// weekday ones, and anything in the coming week for weekly ones.
function materializeRecurringTodos() {
  const t = todayIso();
  const dow = new Date().getDay();
  const add = (rt, d) => {
    if (state.todos.some(x => x.recurringTemplateId === rt.id && x.dueDate === d)) return;
    state.todos.push({ id: uid(), courseId: rt.courseId, sectionId: null, title: rt.title, done: false, dueDate: d, dueTime: null, priority: rt.priority || 'medium', recurring: { freq: rt.freq || 'weekly' }, recurringTemplateId: rt.id });
  };
  state.recurringTemplates.forEach(rt => {
    if (rt.freq === 'daily') add(rt, t);
    else if (rt.freq === 'weekdays') { if (dow >= 1 && dow <= 5) add(rt, t); }
    else repeatDays(rt).forEach(day => add(rt, addDays(t, (day - dow + 7) % 7)));
  });
}
