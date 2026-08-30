/* ── To-Do list: grouped by section, filterable by course, recurring templates ─ */
function pageTodos() {
  const filter = state.todoFilter;
  const visible = state.todos.filter(t => filter === 'all' || (filter === 'none' ? t.courseId === null : t.courseId === filter));
  const groups = filter === 'all' ? groupTodosBySection(visible) : [{ sectionId: '_filtered', items: visible }];
  const openCount = state.todos.filter(t => !t.done).length;
  const dueToday = state.todos.filter(t => !t.done && t.dueDate === todayIso()).length;
  const overdueCount = state.todos.filter(t => !t.done && t.dueDate && t.dueDate < todayIso()).length;

  return `
    ${pageHead('To-Do List', `${openCount} open task${openCount === 1 ? '' : 's'}`, `
      <button class="btn btn-sm" onclick="openSectionModal()">${icon('plus',13,2.2)} Section</button>
      <button class="btn btn-primary" onclick="openTodoModal()">+ Add to-do</button>
    `)}
    <div class="grid grid-3 mb-16">
      <div class="stat-card"><div class="num">${dueToday}</div><div class="lbl">Due today</div></div>
      <div class="stat-card"><div class="num" style="color:${overdueCount ? 'var(--danger)' : 'inherit'}">${overdueCount}</div><div class="lbl">Overdue</div></div>
      <div class="stat-card"><div class="num">${openCount}</div><div class="lbl">Open tasks</div></div>
    </div>
    <div class="flex-gap wrap mb-16">
      <button class="pill" style="background:${filter === 'all' ? 'var(--accent)' : 'var(--surface-2)'};color:${filter === 'all' ? 'var(--accent-text)' : 'var(--text-dim)'};border:1px solid var(--border);cursor:pointer" onclick="setState({todoFilter:'all'})">All courses</button>
      ${activeCourses().map(c => `<button class="pill" style="background:${filter === c.id ? c.color : 'var(--surface-2)'};color:${filter === c.id ? readableTextOn(c.color) : 'var(--text-dim)'};border:1px solid var(--border);cursor:pointer" onclick="setState({todoFilter:'${c.id}'})">${esc(c.name)}</button>`).join('')}
      <button class="pill" style="background:${filter === 'none' ? 'var(--text-dim)' : 'var(--surface-2)'};color:${filter === 'none' ? '#fff' : 'var(--text-dim)'};border:1px solid var(--border);cursor:pointer" onclick="setState({todoFilter:'none'})">General</button>
    </div>

    ${groups.length ? groups.map(g => `
      <div class="card card-pad mb-16">
        <div class="flex-between mb-8">
          <div class="flex-gap">${sectionGroupLabel(g)}</div>
          ${g.sectionId && g.sectionId !== '_filtered' ? `<div class="flex-gap">
            <button class="btn btn-ghost btn-icon btn-sm" onclick="openSectionModal('${g.sectionId}')">${icon('pencil',13)}</button>
          </div>` : ''}
        </div>
        ${g.items.length ? g.items.sort(sortTodos).map(todoRow).join('') : emptyState(icon('check-square',22,1.4), 'All clear here.')}
      </div>
    `).join('') : emptyState(icon('check-square',26,1.4), 'Nothing on your list yet', `<button class="btn btn-primary mt-8" onclick="openTodoModal()">+ Add to-do</button>`)}

    <div class="card card-pad">
      <div class="flex-between mb-8"><h3 style="font-size:14.5px">Recurring templates</h3><button class="btn btn-sm" onclick="openRecurringModal()">+ New template</button></div>
      ${state.recurringTemplates.length ? state.recurringTemplates.map(rt => `
        <div class="list-row">
          <div class="row-title">${esc(rt.title)} <span class="small muted">— every ${DOW_NAMES[rt.dayOfWeek]}</span></div>
          ${rt.courseId ? courseChip(rt.courseId) : ''}
          <button class="btn btn-ghost btn-icon btn-sm" onclick="deleteRecurringTemplate('${rt.id}')">${icon('trash',14)}</button>
        </div>
      `).join('') : emptyState(icon('refresh-cw',20,1.4), 'No recurring templates yet', '', 'Set up weekly readings or discussion posts and they’ll auto-add each week.')}
    </div>
  `;
}
function sortTodos(a, b) { if (a.done !== b.done) return a.done ? 1 : -1; return (a.dueDate || '').localeCompare(b.dueDate || ''); }
function groupTodosBySection(items) {
  const bySection = {};
  items.forEach(t => { const k = t.sectionId || '_none'; (bySection[k] = bySection[k] || []).push(t); });
  const order = [...state.todoSections.map(s => s.id), '_none'];
  return order.filter(k => bySection[k] || k !== '_none').map(k => ({ sectionId: k === '_none' ? null : k, items: bySection[k] || [] }));
}
function sectionGroupLabel(g) {
  if (g.sectionId === '_filtered') return '<strong>Tasks</strong>';
  if (!g.sectionId) return '<strong>No section</strong>';
  const s = state.todoSections.find(x => x.id === g.sectionId);
  return `<strong>${esc(s?.name || 'Section')}</strong>`;
}
function openSectionModal(id) {
  const s = id ? state.todoSections.find(x => x.id === id) : null;
  openModal(`
    <div class="modal-head"><h3>${id ? 'Rename section' : 'New section'}</h3><button class="close-x" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label>Section name</label><input class="input" id="sec-name" value="${esc(s?.name || '')}" placeholder="This week, Personal, Long-term…"></div>
    </div>
    <div class="modal-foot">
      ${id ? `<button class="btn btn-danger" onclick="deleteSection('${id}')">Delete</button>` : ''}
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveSectionModal(${id ? `'${id}'` : 'null'})">${id ? 'Save' : 'Create'}</button>
    </div>
  `);
}
function saveSectionModal(id) {
  const name = $('#sec-name').value.trim();
  if (!name) { toast('Give it a name', 'error'); return; }
  if (id) { state.todoSections.find(x => x.id === id).name = name; }
  else state.todoSections.push({ id: uid(), name });
  touch(); closeModal(); toast(id ? 'Section updated' : 'Section created');
}
function deleteSection(id) {
  confirmDialog('Delete this section? To-dos inside move to "No section", nothing is deleted.', () => {
    state.todoSections = state.todoSections.filter(s => s.id !== id);
    state.todos.forEach(t => { if (t.sectionId === id) t.sectionId = null; });
    touch(); closeModal();
  });
}
function todoRow(t) {
  return `<div class="list-row" draggable="true" ondragstart="dragStartItem(event,'todo','${t.id}')" title="Drag onto Calendar to reschedule or time-block">
    <button type="button" class="row-check ${t.done ? 'checked' : ''}" role="checkbox" aria-checked="${t.done}" aria-label="Mark ${esc(t.title)} as ${t.done ? 'not done' : 'done'}" onclick="toggleTodo('${t.id}')">${t.done ? checkGlyph(true) : ''}</button>
    <div class="row-title ${t.done ? 'done' : ''}" onclick="openTodoModal('${t.id}')">${priorityDot(t.priority)} ${esc(t.title)}</div>
    <div class="row-meta">${t.dueDate ? relativeDay(t.dueDate) : ''}</div>
    <button class="btn btn-ghost btn-icon btn-sm" onclick="deleteTodo('${t.id}')">${icon('trash',14)}</button>
  </div>`;
}
function toggleTodo(id) { const t = state.todos.find(x => x.id === id); t.done = !t.done; touch(); }
function deleteTodo(id) {
  const t = state.todos.find(x => x.id === id);
  if (t) trashItem('todo', t.title || 'Untitled to-do', t);
  state.todos = state.todos.filter(t => t.id !== id);
  touch();
}

function openTodoModal(id) {
  const t = id ? state.todos.find(x => x.id === id) : { id: uid(), courseId: state.todoFilter !== 'all' && state.todoFilter !== 'none' ? state.todoFilter : null, sectionId: null, title: '', done: false, dueDate: todayIso(), priority: 'medium', recurring: null };
  window._todoDraft = { ...t };
  openModal(`
    <div class="modal-head"><h3>${id ? 'Edit to-do' : 'New to-do'}</h3><button class="close-x" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label>Title</label><input class="input" id="tf-title" value="${esc(t.title)}"></div>
      <div class="field-row">
        <div class="field"><label>Course</label><select class="select" id="tf-course"><option value="">General</option>${activeCourses().map(c => `<option value="${c.id}" ${c.id === t.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Section</label><select class="select" id="tf-section"><option value="">No section</option>${state.todoSections.map(s => `<option value="${s.id}" ${s.id === t.sectionId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Due date</label><input class="input" type="date" id="tf-date" value="${t.dueDate || ''}"></div>
        <div class="field"><label>Priority</label><select class="select" id="tf-priority">${['low', 'medium', 'high'].map(p => `<option value="${p}" ${p === t.priority ? 'selected' : ''}>${p[0].toUpperCase() + p.slice(1)}</option>`).join('')}</select></div>
      </div>
    </div>
    <div class="modal-foot">
      ${id ? `<button class="btn btn-danger" onclick="deleteTodo('${id}');closeModal()">Delete</button>` : ''}
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveTodoModal(${id ? `'${id}'` : 'null'})">Save</button>
    </div>
  `);
}
function saveTodoModal(id) {
  const d = _todoDraft;
  d.title = $('#tf-title').value.trim();
  if (!d.title) { toast('Give it a title', 'error'); return; }
  d.courseId = $('#tf-course').value || null;
  d.sectionId = $('#tf-section').value || null;
  d.dueDate = $('#tf-date').value || null;
  d.priority = $('#tf-priority').value;
  if (id) { const i = state.todos.findIndex(x => x.id === id); state.todos[i] = d; } else state.todos.unshift(d);
  touch(); closeModal(); toast(id ? 'Updated' : 'Added to your list');
}

function openRecurringModal() {
  openModal(`
    <div class="modal-head"><h3>New recurring template</h3><button class="close-x" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label>Title</label><input class="input" id="rf-title" placeholder="Weekly reading response"></div>
      <div class="field-row">
        <div class="field"><label>Course</label><select class="select" id="rf-course"><option value="">General</option>${activeCourses().map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Repeats every</label><select class="select" id="rf-day">${DOW_NAMES.map((d, i) => `<option value="${i}">${d}</option>`).join('')}</select></div>
      </div>
      <div class="small muted">A new to-do will appear each week on this day automatically.</div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveRecurringTemplate()">Create template</button>
    </div>
  `);
}
function saveRecurringTemplate() {
  const title = $('#rf-title').value.trim();
  if (!title) { toast('Give it a title', 'error'); return; }
  state.recurringTemplates.push({ id: uid(), title, courseId: $('#rf-course').value || null, freq: 'weekly', dayOfWeek: Number($('#rf-day').value), priority: 'medium' });
  materializeRecurringTodos();
  touch(); closeModal(); toast('Template created');
}
function deleteRecurringTemplate(id) { state.recurringTemplates = state.recurringTemplates.filter(r => r.id !== id); touch(); }

function materializeRecurringTodos() {
  const horizon = addDays(todayIso(), 7);
  state.recurringTemplates.forEach(rt => {
    let d = todayIso();
    for (let i = 0; i < 8; i++) {
      if (new Date(d + 'T00:00:00').getDay() === rt.dayOfWeek) break;
      d = addDays(d, 1);
    }
    if (d > horizon) return;
    const exists = state.todos.some(t => t.recurringTemplateId === rt.id && t.dueDate === d);
    if (!exists) state.todos.push({ id: uid(), courseId: rt.courseId, sectionId: null, title: rt.title, done: false, dueDate: d, priority: rt.priority || 'medium', recurring: { freq: 'weekly' }, recurringTemplateId: rt.id });
  });
}
