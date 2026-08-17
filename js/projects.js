/* ── Project Hub: projects broken into milestones & tasks ────────── */
function projectProgress(p) {
  const allTasks = p.milestones.flatMap(m => m.tasks.length ? m.tasks : [{ done: m.done }]);
  if (!allTasks.length) return 0;
  return Math.round((allTasks.filter(t => t.done).length / allTasks.length) * 100);
}

function pageProjects() {
  const projects = state.projects.filter(p => !p.courseId || activeCourses().some(c => c.id === p.courseId));
  return `
    ${pageHead('Project Hub', `${projects.length} project${projects.length === 1 ? '' : 's'}`, `<button class="btn btn-primary" onclick="openProjectModal()">+ New project</button>`)}
    ${projects.length ? `<div class="grid grid-2">${projects.map(projectCard).join('')}</div>` : emptyState(icon('folder',26,1.4), 'Break a big assignment into milestones here.', `<button class="btn btn-primary mt-8" onclick="openProjectModal()">+ New project</button>`)}
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
    <div class="modal-head"><h3>${id ? 'Edit project' : 'New project'}</h3><button class="close-x" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
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
      ${id ? `<button class="btn btn-danger" onclick="deleteProject('${id}')">Delete</button>` : ''}
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveProjectModal(${id ? `'${id}'` : 'null'})">Save</button>
    </div>
  `, { wide: true });
}
function milestoneBlock(m, i) {
  return `<div class="card card-pad mb-8" style="background:var(--surface-2)">
    <div class="flex-gap">
      <div class="row-check ${m.done ? 'checked' : ''}" onclick="_projectDraft.milestones[${i}].done=!_projectDraft.milestones[${i}].done;renderProjectModal()">${m.done ? checkGlyph(true) : ''}</div>
      <input class="input" value="${esc(m.title)}" placeholder="Milestone" oninput="_projectDraft.milestones[${i}].title=this.value">
      <button class="btn btn-ghost btn-icon btn-sm" onclick="_projectDraft.milestones.splice(${i},1);renderProjectModal()">${icon('trash',14)}</button>
    </div>
    <div style="padding-left:28px;margin-top:6px">
      ${m.tasks.map((t, ti) => `
        <div class="flex-gap" style="margin-bottom:4px">
          <div class="row-check ${t.done ? 'checked' : ''}" style="width:16px;height:16px" onclick="_projectDraft.milestones[${i}].tasks[${ti}].done=!_projectDraft.milestones[${i}].tasks[${ti}].done;renderProjectModal()">${t.done ? checkGlyph(true) : ''}</div>
          <input class="input" style="font-size:12.5px;padding:5px 8px" value="${esc(t.title)}" oninput="_projectDraft.milestones[${i}].tasks[${ti}].title=this.value">
          <button class="btn btn-ghost btn-icon btn-sm" onclick="_projectDraft.milestones[${i}].tasks.splice(${ti},1);renderProjectModal()">${icon('x',13,2.2)}</button>
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
function deleteProject(id) { confirmDialog('Delete this project?', () => { state.projects = state.projects.filter(p => p.id !== id); touch(); closeModal(); }); }
