/* ── Project Hub: projects broken into milestones & tasks ────────── */
function projectProgress(p) {
  const allTasks = p.milestones.flatMap(m => m.tasks.length ? m.tasks : [{ done: m.done }]);
  if (!allTasks.length) return 0;
  return Math.round((allTasks.filter(t => t.done).length / allTasks.length) * 100);
}

function pageProjects() {
  const projects = state.projects.filter(p => !p.courseId || activeCourses().some(c => c.id === p.courseId));
  const avgProgress = projects.length ? Math.round(projects.reduce((s, p) => s + projectProgress(p), 0) / projects.length) : null;
  const dueSoon = projects.filter(p => p.dueDate && daysBetween(p.dueDate) >= 0 && daysBetween(p.dueDate) <= 30).length;
  return `
    ${pageHead('Project Hub', `${projects.length} project${projects.length === 1 ? '' : 's'}`, `<button class="btn btn-primary" onclick="openProjectModal()">+ New project</button>`)}
    <div class="grid grid-3 mb-16">
      <div class="stat-card"><div class="num">${projects.length}</div><div class="lbl">Active projects</div></div>
      <div class="stat-card"><div class="num ${avgProgress == null ? 'stat-dash' : ''}">${avgProgress != null ? avgProgress + '%' : '—'}</div><div class="lbl">Average progress</div></div>
      <div class="stat-card"><div class="num">${dueSoon}</div><div class="lbl">Due in 30 days</div></div>
    </div>
    ${projects.length ? `<div class="grid grid-2">${projects.map(projectCard).join('')}</div>` : emptyState(icon('folder',26,1.4), 'Break a big assignment into milestones here', `<button class="btn btn-primary mt-8" onclick="openProjectModal()">+ New project</button>`, 'Turn a paper, portfolio, or group project into trackable steps.')}
  `;
}
function projectCard(p) {
  const pct = projectProgress(p);
  return `
    <div class="card card-pad" style="cursor:pointer" onclick="openProjectModal('${p.id}')">
      <div class="flex-between">
        <div><div style="font-weight:700">${esc(p.title)}</div>${p.courseId ? courseChip(p.courseId) : ''}</div>
        <div class="small muted">${p.dueDate ? relativeDay(p.dueDate) : 'no deadline'}</div>
      </div>
      <div class="mt-16"><div class="flex-between small" style="margin-bottom:4px"><span class="muted">${p.milestones.length} milestone${p.milestones.length === 1 ? '' : 's'}</span><span class="muted">${pct}%</span></div>
      <div class="progress"><div style="width:${pct}%"></div></div></div>
    </div>
  `;
}
function openProjectModal(id) {
  const p = id ? state.projects.find(x => x.id === id) : { id: uid(), title: '', courseId: null, dueDate: '', milestones: [] };
  window._projectDraft = JSON.parse(JSON.stringify(p));
  renderProjectModal(id);
}
function renderProjectModal(id) {
  const p = _projectDraft;
  openModal(`
    <div class="modal-head"><h3>${id ? 'Edit project' : 'New project'}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="field-row">
        <div class="field"><label>Title</label><input class="input" id="pf-title" value="${esc(p.title)}"></div>
        <div class="field"><label>Due date</label><input class="input" type="date" id="pf-date" value="${p.dueDate || ''}"></div>
      </div>
      <div class="field"><label>Course</label><select class="select" id="pf-course"><option value="">—</option>${activeCourses().map(c => `<option value="${c.id}" ${c.id === p.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Milestones</label>
        <div id="pf-milestones">${p.milestones.map((m, i) => milestoneBlock(m, i)).join('')}</div>
        <button class="btn btn-sm mt-8" onclick="addMilestone()">+ Add milestone</button>
      </div>
    </div>
    <div class="modal-foot">
      ${id ? `<button class="btn btn-danger" onclick="deleteProject('${id}')">Delete</button><button class="btn btn-ghost" onclick="shareProjectToGroup('${id}')">${icon('users', 13)} Share</button>` : ''}
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveProjectModal(${id ? `'${id}'` : 'null'})">Save</button>
    </div>
  `, { wide: true });
}
function shareProjectToGroup(id) {
  const p = state.projects.find(x => x.id === id);
  if (!p) return;
  openShareToGroupModal('project', p.title || 'Untitled project', { dueDate: p.dueDate || '', milestones: JSON.parse(JSON.stringify(p.milestones || [])) });
}
function milestoneBlock(m, i) {
  return `<div class="card card-pad mb-8" style="background:var(--surface-2)">
    <div class="flex-gap">
      <button type="button" class="row-check ${m.done ? 'checked' : ''}" role="checkbox" aria-checked="${m.done}" aria-label="Mark ${esc(m.title || 'milestone')} as ${m.done ? 'not done' : 'done'}" onclick="_projectDraft.milestones[${i}].done=!_projectDraft.milestones[${i}].done;renderProjectModal()">${m.done ? checkGlyph(true) : ''}</button>
      <input class="input" value="${esc(m.title)}" placeholder="Milestone" oninput="_projectDraft.milestones[${i}].title=this.value">
      <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove milestone" onclick="_projectDraft.milestones.splice(${i},1);renderProjectModal()">${icon('trash',14)}</button>
    </div>
    <div style="padding-left:28px;margin-top:6px">
      ${m.tasks.map((t, ti) => `
        <div class="flex-gap" style="margin-bottom:4px">
          <button type="button" class="row-check ${t.done ? 'checked' : ''}" style="width:20px;height:20px" role="checkbox" aria-checked="${t.done}" aria-label="Mark ${esc(t.title || 'task')} as ${t.done ? 'not done' : 'done'}" onclick="_projectDraft.milestones[${i}].tasks[${ti}].done=!_projectDraft.milestones[${i}].tasks[${ti}].done;renderProjectModal()">${t.done ? checkGlyph(true) : ''}</button>
          <input class="input" style="font-size:12.5px;padding:5px 8px" value="${esc(t.title)}" oninput="_projectDraft.milestones[${i}].tasks[${ti}].title=this.value">
          <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove task" onclick="_projectDraft.milestones[${i}].tasks.splice(${ti},1);renderProjectModal()">${icon('x',13,2.2)}</button>
        </div>`).join('')}
      <button class="btn btn-sm" onclick="_projectDraft.milestones[${i}].tasks.push({id:uid(),title:'',done:false});renderProjectModal()">+ Task</button>
    </div>
  </div>`;
}
function addMilestone() { _projectDraft.milestones.push({ id: uid(), title: '', done: false, tasks: [] }); renderProjectModal(); }
function saveProjectModal(id) {
  const d = _projectDraft;
  d.title = $('#pf-title').value.trim();
  if (!d.title) { toast('Give the project a title', 'error'); return; }
  d.dueDate = $('#pf-date').value || '';
  d.courseId = $('#pf-course').value || null;
  if (id) { const i = state.projects.findIndex(x => x.id === id); state.projects[i] = d; } else state.projects.push(d);
  touch(); closeModal(); toast(id ? 'Updated' : 'Project created');
}
function deleteProject(id) {
  confirmDialog('Delete this project? You can restore it from Recently Deleted for 30 days.', () => {
    const p = state.projects.find(x => x.id === id);
    if (p) trashItem('project', p.title || 'Untitled project', p);
    state.projects = state.projects.filter(p => p.id !== id);
    touch(); closeModal();
  });
}
