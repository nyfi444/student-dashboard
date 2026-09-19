/* ── Projects: big assignments broken into dated milestones ────────
   Start from a template (research paper, group presentation, lab
   report…) and the milestones are spaced out between today and the due
   date. Each project has its own page: what to do next, milestones with
   tasks you check off right there, teammates, links, and notes. Milestone
   dates show up on the calendar and in "Due this week".
──────────────────────────────────────────────────────────────── */
const PROJECT_TEMPLATES = [
  { id: 'paper', name: 'Research paper', icon: 'file-text', steps: [
    ['Pick a topic', 0.1, ['Brainstorm 3 ideas', 'Run it by the professor']], ['Find sources', 0.3, ['Find 5 scholarly sources', 'Save citations as you go']],
    ['Outline', 0.45, ['Write a thesis statement', 'Outline each section']], ['First draft', 0.7, ['Intro and body', 'Conclusion']],
    ['Revise and cite', 0.9, ['Get feedback (writing center or a friend)', 'Check citations and formatting']], ['Submit', 1, []] ] },
  { id: 'presentation', name: 'Group presentation', icon: 'users', steps: [
    ['Split up roles', 0.1, ['Set a group chat', 'Decide who covers what']], ['Research', 0.4, ['Each person gathers their section']],
    ['Build slides', 0.7, ['Pick a template', 'Everyone adds their slides']], ['Rehearse', 0.9, ['Full run-through', 'Time it']], ['Present', 1, []] ] },
  { id: 'lab', name: 'Lab report', icon: 'layers', steps: [
    ['Organize the data', 0.25, ['Make tables and graphs']], ['Methods and results', 0.5, []], ['Discussion', 0.75, ['Explain sources of error']], ['Final check', 1, ['Formatting and units', 'Submit']] ] },
  { id: 'case', name: 'Case study', icon: 'briefcase', steps: [
    ['Read the case', 0.15, ['Highlight key facts']], ['Analysis', 0.5, ['SWOT or framework from class']], ['Recommendations', 0.75, []], ['Write it up', 1, ['Proofread', 'Submit']] ] },
  { id: 'portfolio', name: 'Portfolio', icon: 'grid', steps: [
    ['Gather your work', 0.25, []], ['Pick the best pieces', 0.5, []], ['Write reflections', 0.75, []], ['Final layout', 1, ['Check every link', 'Submit']] ] },
  { id: 'capstone', name: 'Capstone or thesis', icon: 'graduation-cap', steps: [
    ['Proposal', 0.1, ['Meet with your advisor']], ['Literature review', 0.3, []], ['Research or build', 0.6, []],
    ['Full draft', 0.8, []], ['Revise', 0.95, ['Advisor feedback']], ['Final submission', 1, []] ] },
];

function projectTasks(p) { return (p.milestones || []).flatMap(m => (m.tasks || []).length ? m.tasks : [{ done: m.done }]); }
function projectProgress(p) {
  const all = projectTasks(p);
  if (!all.length) return p.status === 'done' ? 100 : 0;
  return Math.round((all.filter(t => t.done).length / all.length) * 100);
}
function projectIsDone(p) { return p.status === 'done'; }
function visibleProjects() { return state.projects.filter(p => !p.courseId || activeCourses().some(c => c.id === p.courseId)); }
function getProject(id) { return state.projects.find(p => p.id === id); }
function projectColor(p) { return p.courseId ? getCourseColor(p.courseId) : '#5a6b7b'; }
function nextMilestone(p) { return (p.milestones || []).find(m => !m.done); }
function milestoneOverdue(m) { return !m.done && m.dueDate && m.dueDate < todayIso(); }
function daysLeftLabel(dIso) {
  if (!dIso) return 'No due date';
  const n = daysBetween(dIso);
  return n < 0 ? `${-n} day${n === -1 ? '' : 's'} late` : n === 0 ? 'Due today' : n === 1 ? 'Due tomorrow' : `${n} days left`;
}

/* ── Calendar + dashboard hooks ────────────────────────────────── */
function projectMilestonesOnDate(dateIso) {
  return visibleProjects().filter(p => !projectIsDone(p)).flatMap(p => (p.milestones || []).filter(m => !m.done && m.dueDate === dateIso).map(m => ({
    id: m.id, title: `${p.title}: ${m.title}`, start: null, end: null, color: projectColor(p), kind: 'milestone', action: `openProject('${p.id}')`,
  })));
}
function milestoneDueItems(fromIso, toIso) {
  return visibleProjects().filter(p => !projectIsDone(p)).flatMap(p => (p.milestones || []).filter(m => !m.done && m.dueDate && m.dueDate >= fromIso && m.dueDate <= toIso).map(m => ({ p, m })));
}

/* ── Projects page ─────────────────────────────────────────────── */
function pageProjects() {
  if (state.subRoute) {
    const p = getProject(state.subRoute);
    if (p) return pageProjectDetail(p);
  }
  const view = state._projectView === 'done' ? 'done' : 'active';
  const all = visibleProjects();
  const active = all.filter(p => !projectIsDone(p)).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const done = all.filter(projectIsDone);
  const list = view === 'done' ? done : active;
  const upcoming = milestoneDueItems(todayIso(), addDays(todayIso(), 7)).length;
  return `
    ${pageHead('Projects', active.length ? `${active.length} in progress${upcoming ? ` · ${upcoming} milestone${upcoming === 1 ? '' : 's'} this week` : ''}` : 'Big assignments, broken into steps', `<button class="btn btn-primary" onclick="openProjectModal()">+ New project</button>`)}
    ${all.length ? `
      <div class="assign-toolbar">
        <div class="segmented" role="group" aria-label="Show">
          <button class="${view === 'active' ? 'active' : ''}" aria-pressed="${view === 'active'}" onclick="state._projectView='active';touch()">In progress <span class="seg-count">${active.length}</span></button>
          <button class="${view === 'done' ? 'active' : ''}" aria-pressed="${view === 'done'}" onclick="state._projectView='done';touch()">Finished <span class="seg-count">${done.length}</span></button>
        </div>
      </div>
      ${view === 'active' && active.some(p => p.dueDate) ? projectTimeline(active) : ''}
      ${list.length ? expandable(`proj-${view}`, view === 'done' ? 'Finished projects' : 'Projects in progress', `<div class="grid grid-2 proj-grid">${list.map(projectCard).join('')}</div>`, { max: 560, count: list.length }) : emptyState(icon('folder', 26, 1.4), view === 'done' ? 'Nothing finished yet' : 'Nothing in progress', view === 'done' ? '' : `<button class="btn btn-primary" onclick="openProjectModal()">+ New project</button>`, view === 'done' ? 'Projects you mark finished land here.' : '')}
      ${view === 'active' ? `<div class="sg-section-label mt-16">Start from a template</div>${projectTemplateRow()}` : ''}
    ` : projectsEmptyHero()}
  `;
}
function projectsEmptyHero() {
  return `
    <div class="card sg-hero proj-hero">
      <div class="sg-hero-copy">
        <div class="sg-eyebrow">${icon('folder', 13, 1.8)} Projects</div>
        <h3 class="sg-hero-title">Big assignments, one step at a time.</h3>
        <p class="muted">Pick a template and Semester HQ spaces the milestones out between today and the due date, so the week before isn’t a panic.</p>
        <div class="sg-hero-actions"><button class="btn btn-primary" onclick="openProjectModal()">+ New project</button></div>
      </div>
      <div class="proj-hero-templates">${projectTemplateRow()}</div>
    </div>`;
}
function projectTemplateRow() {
  return `<div class="proj-templates">${PROJECT_TEMPLATES.map(t => `
    <button class="proj-template" onclick="openProjectModal(null,{template:'${t.id}'})">
      <span class="sg-feature-ic">${icon(t.icon, 15, 1.7)}</span>
      <span><span class="sg-strong">${esc(t.name)}</span><span class="small muted">${t.steps.length} milestones</span></span>
    </button>`).join('')}</div>`;
}
function projectCard(p) {
  const pct = projectProgress(p);
  const next = nextMilestone(p);
  const c = getCourse(p.courseId);
  const ms = p.milestones || [];
  const late = ms.filter(milestoneOverdue).length;
  const n = p.dueDate ? daysBetween(p.dueDate) : null;
  return `
    <div class="card proj-card ${projectIsDone(p) ? 'is-done' : ''}" style="--course:${esc(projectColor(p))}" onclick="openProject('${p.id}')">
      <div class="proj-card-top">
        <div class="sg-eyebrow">${c ? `<span class="course-dot"></span>${esc(c.code || c.name)}` : 'Personal'}</div>
        <span class="proj-days ${n != null && n <= 3 && !projectIsDone(p) ? 'soon' : ''}">${projectIsDone(p) ? `${icon('check', 11, 2.4)} Finished` : esc(daysLeftLabel(p.dueDate))}</span>
      </div>
      <div class="proj-card-title">${esc(p.title)}</div>
      ${!projectIsDone(p) ? `<div class="small proj-next">${next ? `<span class="muted">Next:</span> ${esc(next.title)}${next.dueDate ? ` <span class="${milestoneOverdue(next) ? 'sg-overdue' : 'muted'}">· ${esc(relativeDay(next.dueDate).replace(' (overdue)', ''))}</span>` : ''}` : ms.length ? '<span class="muted">Every milestone is done</span>' : '<span class="muted">No milestones yet</span>'}</div>` : ''}
      ${ms.length ? `<div class="proj-segments" aria-hidden="true">${ms.map(m => `<span class="${m.done ? 'done' : milestoneOverdue(m) ? 'late' : ''}" title="${esc(m.title)}"></span>`).join('')}</div>` : ''}
      <div class="proj-card-foot small muted">
        <span>${pct}% · ${ms.filter(m => m.done).length}/${ms.length} milestones${late ? ` · <span class="sg-overdue">${late} behind</span>` : ''}</span>
        ${(p.team || []).length ? `<span class="proj-team">${p.team.slice(0, 4).map(name => `<span class="avatar sg-avatar" style="--shade:#6b6b6b;width:22px;height:22px;font-size:10px" title="${esc(name)}">${esc(name.charAt(0).toUpperCase())}</span>`).join('')}</span>` : ''}
      </div>
    </div>`;
}
// Six weeks from the start of this week: one bar per project from when it
// started to when it's due, with a mark for each milestone.
function projectTimeline(projects) {
  const start = startOfWeek(todayIso());
  const span = 42;
  const pos = (dIso) => clamp((daysBetweenIso(start, dIso) / span) * 100, 0, 100);
  const rows = projects.filter(p => p.dueDate && p.dueDate >= start).slice(0, 8);
  if (!rows.length) return '';
  const weeks = Array.from({ length: 6 }, (_, i) => addDays(start, i * 7));
  return `
    <div class="card card-pad proj-timeline mb-16">
      <div class="flex-between mb-8"><h3 class="sg-h3">Timeline</h3><span class="small muted">Next 6 weeks</span></div>
      <div class="proj-tl" role="list">
        <div class="proj-tl-weeks" aria-hidden="true"><span></span><div>${weeks.map(w => `<span>${esc(fmtDate(w))}</span>`).join('')}</div></div>
        ${rows.map(p => {
          const from = p.startDate || (p.createdAt ? iso(new Date(p.createdAt)) : todayIso());
          const left = pos(from < start ? start : from), right = pos(p.dueDate);
          return `<div class="proj-tl-row" role="listitem" style="--course:${esc(projectColor(p))}">
            <button class="proj-tl-name" onclick="openProject('${p.id}')">${esc(p.title)}</button>
            <div class="proj-tl-track">
              <span class="proj-tl-today" style="left:${pos(todayIso())}%"></span>
              <span class="proj-tl-bar" style="left:${left}%;width:${Math.max(1.5, right - left)}%"><span style="width:${projectProgress(p)}%"></span></span>
              ${(p.milestones || []).filter(m => m.dueDate && m.dueDate >= start && daysBetweenIso(start, m.dueDate) <= span).map(m => `<span class="proj-tl-ms ${m.done ? 'done' : milestoneOverdue(m) ? 'late' : ''}" style="left:${pos(m.dueDate)}%" title="${esc(m.title)} · ${esc(fmtDate(m.dueDate))}"></span>`).join('')}
            </div>
            <span class="sr-only">${esc(p.title)}: ${projectProgress(p)}% done, due ${esc(fmtDateLong(p.dueDate))}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}
function daysBetweenIso(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }

/* ── Project page ──────────────────────────────────────────────── */
function openProject(id) { setState({ route: 'projects', subRoute: id }); window.scrollTo(0, 0); }
function pageProjectDetail(p) {
  const c = getCourse(p.courseId);
  const pct = projectProgress(p);
  const ms = p.milestones || [];
  const tasks = ms.flatMap(m => m.tasks || []);
  const next = nextMilestone(p);
  const nextTask = next ? (next.tasks || []).find(t => !t.done) : null;
  const courseMin = p.courseId ? state.timerSessions.filter(s => s.courseId === p.courseId && s.date >= (p.startDate || iso(new Date(p.createdAt || Date.now())))).reduce((s, x) => s + x.minutes, 0) : 0;
  return `
    <div style="--course:${esc(projectColor(p))}">
    <button class="btn btn-ghost btn-sm sg-back" onclick="setState({subRoute:null})">${icon('arrow-left', 14, 1.9)} All projects</button>
    <div class="sg-head">
      <div style="min-width:0">
        <div class="sg-eyebrow">${[c ? `<span class="course-dot"></span>${esc(c.code || c.name)}` : '', p.dueDate ? `Due ${esc(fmtDateLong(p.dueDate))}` : 'No due date', projectIsDone(p) ? 'Finished' : ''].filter(Boolean).join(' · ')}</div>
        <h2 class="sg-title">${esc(p.title)}</h2>
        ${p.description ? `<p class="small muted sg-desc">${esc(p.description)}</p>` : ''}
      </div>
      <div class="sg-head-actions">
        ${signInHeaderButton()}
        ${typeof openShareToGroupModal === 'function' ? `<button class="btn btn-sm" onclick="shareProjectToGroup('${p.id}')">${icon('users', 13, 1.8)} Share</button>` : ''}
        ${projectIsDone(p) ? `<button class="btn btn-sm" onclick="setProjectDone('${p.id}',false)">Reopen</button>` : pct === 100 && ms.length ? `<button class="btn btn-primary btn-sm" onclick="setProjectDone('${p.id}',true)">${icon('check', 13, 2.4)} Mark finished</button>` : ''}
        <button class="btn btn-icon" aria-label="Edit project" title="Edit project" onclick="openProjectModal('${p.id}')">${icon('pencil', 15, 1.7)}</button>
      </div>
    </div>

    <div class="sg-overview">
      <div class="sg-col">
        ${projectIsDone(p) ? '' : !next && !ms.length ? emptyStateHtml({
          icon: 'folder',
          title: 'Break it into milestones',
          body: 'Pick a template below, add your own, or let AI plan it from the assignment details, and the next step always shows up here.',
          actions: [{ label: '+ Add a milestone', onclick: "document.getElementById('proj-new-ms')?.focus()" }],
        }) : `
        <div class="card proj-up-next">
          <div class="sg-eyebrow">Up next</div>
          ${next ? `
            <div class="proj-up-title">${esc(next.title)}</div>
            <div class="small ${milestoneOverdue(next) ? 'sg-overdue' : 'muted'}">${next.dueDate ? `${milestoneOverdue(next) ? 'Was due' : 'Due'} ${esc(relativeDay(next.dueDate).replace(' (overdue)', ''))}` : 'No date set'}</div>
            ${nextTask ? `<div class="list-row sg-task compact mt-8" data-item-id="${nextTask.id}">
              <button type="button" class="row-check" role="checkbox" aria-checked="false" aria-label="Mark ${esc(nextTask.title)} as done" onclick="toggleProjectTask('${p.id}','${next.id}','${nextTask.id}')"></button>
              <div class="row-title">${esc(nextTask.title)}</div>
            </div>` : ''}
            <div class="flex-gap wrap mt-8">
              ${p.courseId ? `<button class="btn btn-sm" onclick="startCourseFocus('${p.courseId}')">${icon('play', 11, 1.5)} Focus session</button>` : ''}
              <button class="btn btn-sm" onclick="blockProjectTime('${p.id}')">${icon('calendar', 12, 1.8)} Block time for it</button>
            </div>
          ` : `<div class="proj-up-title">Every milestone is done.</div><button class="btn btn-primary btn-sm mt-8" onclick="setProjectDone('${p.id}',true)">${icon('check', 13, 2.4)} Mark the project finished</button>`}
        </div>`}

        <div class="card card-pad">
          <div class="flex-between mb-8"><h3 class="sg-h3">Milestones</h3>${ms.length && p.dueDate ? `<button class="sg-link" onclick="respaceMilestones('${p.id}')">Space out dates</button>` : ''}</div>
          ${ms.length ? ms.map((m, i) => milestoneBlockHtml(p, m, i, ms.length)).join('') : `
            <div class="proj-templates compact">${PROJECT_TEMPLATES.map(t => `<button class="proj-template" onclick="applyProjectTemplate('${p.id}','${t.id}')"><span class="sg-feature-ic">${icon(t.icon, 14, 1.7)}</span><span class="sg-strong small">${esc(t.name)}</span></button>`).join('')}</div>
            ${aiEnabled() ? `<button class="btn btn-sm mt-8" id="proj-ai-btn" onclick="planProjectWithAI('${p.id}')">${icon(aiLooksUnlocked() ? 'sparkles' : 'lock', 13, 1.6)} Plan it for me</button>` : ''}`}
          <div class="proj-add-ms">
            <input class="input" id="proj-new-ms" maxlength="120" placeholder="Add a milestone" onkeydown="if(event.key==='Enter')addMilestone('${p.id}')">
            <input class="input" type="date" id="proj-new-ms-date" aria-label="Milestone date" ${p.dueDate ? `max="${p.dueDate}"` : ''}>
            <button class="btn btn-sm" onclick="addMilestone('${p.id}')">Add</button>
          </div>
        </div>
      </div>

      <div class="sg-col">
        <div class="card card-pad hub-progress proj-progress">
          <div class="hub-ring">${progressRing(pct, projectColor(p), 104)}<div class="hub-ring-label"><strong>${pct}%</strong><span>done</span></div></div>
          <div class="hub-stats proj-stats">
            <div class="hub-stat"><strong>${ms.filter(m => m.done).length}/${ms.length}</strong><span>Milestones</span></div>
            <div class="hub-stat"><strong>${tasks.filter(t => t.done).length}/${tasks.length}</strong><span>Tasks</span></div>
            <div class="hub-stat ${p.dueDate && daysBetween(p.dueDate) < 0 && !projectIsDone(p) ? 'is-alert' : ''}"><strong>${p.dueDate ? Math.abs(daysBetween(p.dueDate)) : '—'}</strong><span>${p.dueDate && daysBetween(p.dueDate) < 0 ? 'Days late' : 'Days left'}</span></div>
            ${p.courseId ? `<div class="hub-stat"><strong>${fmtDuration(courseMin)}</strong><span>Class focus</span></div>` : ''}
          </div>
        </div>

        <div class="card card-pad">
          <h3 class="sg-h3 mb-8">Team</h3>
          ${(p.team || []).length ? `<div class="proj-people">${p.team.map((name, i) => `<span class="proj-person"><span class="avatar sg-avatar" style="--shade:${PERSON_COLORS[i % PERSON_COLORS.length]};color:${inkOnColor(PERSON_COLORS[i % PERSON_COLORS.length])};width:22px;height:22px;font-size:10px">${esc(name.charAt(0).toUpperCase())}</span>${esc(name)}<button class="qa-chip-x" aria-label="Remove ${esc(name)}" onclick="removeTeamMember('${p.id}',${i})">${icon('x', 10, 2.4)}</button></span>`).join('')}</div>` : '<p class="small muted mb-8">Solo, or add the people you’re working with.</p>'}
          <div class="proj-inline-add"><input class="input" id="proj-team" maxlength="40" placeholder="Add a name" onkeydown="if(event.key==='Enter')addTeamMember('${p.id}')"><button class="btn btn-sm" onclick="addTeamMember('${p.id}')">Add</button></div>
          ${(p.team || []).length ? `<p class="small muted mt-8">Working together in Semester HQ? <button class="sg-link" onclick="shareProjectToGroup('${p.id}')">Share it with your study group</button></p>` : ''}
        </div>

        <div class="card card-pad">
          <h3 class="sg-h3 mb-8">Links</h3>
          ${(p.links || []).map((l, i) => `<div class="sg-person"><span class="sg-activity-ic">${icon('link', 13, 1.8)}</span><a class="row-title small" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label || hostOf(l.url) || l.url)}</a><button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove link" onclick="removeProjectLink('${p.id}',${i})">${icon('x', 12, 2.2)}</button></div>`).join('') || '<p class="small muted mb-8">The Google Doc, the slide deck, the rubric.</p>'}
          <div class="proj-inline-add"><input class="input" id="proj-link" maxlength="300" placeholder="Paste a link" onkeydown="if(event.key==='Enter')addProjectLink('${p.id}')"><button class="btn btn-sm" onclick="addProjectLink('${p.id}')">Add</button></div>
        </div>

        <div class="card card-pad">
          <h3 class="sg-h3 mb-8"><label for="proj-notes">Notes</label></h3>
          <textarea class="input proj-notes" id="proj-notes" maxlength="5000" placeholder="Ideas, feedback from the professor, who’s doing what…" oninput="saveProjectNotesDebounced('${p.id}',this.value)">${esc(p.notes || '')}</textarea>
        </div>

        <button class="btn btn-ghost btn-sm proj-delete" onclick="deleteProject('${p.id}')">${icon('trash', 13, 1.8)} Delete project</button>
      </div>
    </div>
    </div>`;
}
function milestoneBlockHtml(p, m, i, total) {
  const tasks = m.tasks || [];
  const late = milestoneOverdue(m);
  return `
    <div class="proj-ms ${m.done ? 'is-done' : ''} ${late ? 'is-late' : ''}" data-item-id="${m.id}">
      <div class="proj-ms-head">
        <button type="button" class="row-check ${m.done ? 'checked' : ''}" role="checkbox" aria-checked="${!!m.done}" aria-label="Mark ${esc(m.title)} as ${m.done ? 'not done' : 'done'}" onclick="toggleMilestone('${p.id}','${m.id}')">${m.done ? checkGlyph(true) : ''}</button>
        <div class="proj-ms-title">${esc(m.title || 'Milestone')}</div>
        <input class="proj-ms-date ${late ? 'sg-overdue' : ''}" type="date" value="${m.dueDate || ''}" aria-label="Date for ${esc(m.title)}" onchange="setMilestoneDate('${p.id}','${m.id}',this.value)">
        <div class="proj-ms-menu">
          <button class="btn btn-ghost btn-icon btn-sm" aria-label="Move ${esc(m.title)} up" ${i === 0 ? 'disabled' : ''} onclick="moveMilestone('${p.id}',${i},-1)">↑</button>
          <button class="btn btn-ghost btn-icon btn-sm" aria-label="Move ${esc(m.title)} down" ${i === total - 1 ? 'disabled' : ''} onclick="moveMilestone('${p.id}',${i},1)">↓</button>
          <button class="btn btn-ghost btn-icon btn-sm" aria-label="Rename ${esc(m.title)}" onclick="renameMilestone('${p.id}','${m.id}')">${icon('pencil', 12)}</button>
          <button class="btn btn-ghost btn-icon btn-sm" aria-label="Delete ${esc(m.title)}" onclick="deleteMilestone('${p.id}','${m.id}')">${icon('trash', 13)}</button>
        </div>
      </div>
      <div class="proj-ms-tasks">
        ${tasks.map(t => `
          <div class="proj-task ${t.done ? 'is-done' : ''}" data-item-id="${t.id}">
            <button type="button" class="row-check ${t.done ? 'checked' : ''}" role="checkbox" aria-checked="${!!t.done}" aria-label="Mark ${esc(t.title)} as ${t.done ? 'not done' : 'done'}" onclick="toggleProjectTask('${p.id}','${m.id}','${t.id}')">${t.done ? checkGlyph(true) : ''}</button>
            <span class="proj-task-title">${esc(t.title)}</span>
            <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove ${esc(t.title)}" onclick="removeProjectTask('${p.id}','${m.id}','${t.id}')">${icon('x', 11, 2.2)}</button>
          </div>`).join('')}
        <input class="proj-task-add" id="proj-task-${m.id}" maxlength="160" placeholder="+ Add a task" aria-label="Add a task to ${esc(m.title)}" onkeydown="if(event.key==='Enter')addProjectTask('${p.id}','${m.id}')">
      </div>
    </div>`;
}

/* ── Edits on the project page ─────────────────────────────────── */
function projectMilestone(pid, mid) { const p = getProject(pid); return { p, m: p?.milestones?.find(x => x.id === mid) }; }
function toggleMilestone(pid, mid) {
  const { p, m } = projectMilestone(pid, mid);
  if (!m) return;
  m.done = !m.done;
  (m.tasks || []).forEach(t => { t.done = m.done; });
  touch();
  if (m.done) { celebrateItem(m.id); if (projectProgress(p) === 100) toast(`Every milestone in “${p.title}” is done`, 'success', 5000, { label: 'Mark finished', run: () => setProjectDone(pid, true) }); }
}
function toggleProjectTask(pid, mid, tid) {
  const { p, m } = projectMilestone(pid, mid);
  const t = m?.tasks?.find(x => x.id === tid);
  if (!t) return;
  t.done = !t.done;
  const wasDone = m.done;
  m.done = m.tasks.length > 0 && m.tasks.every(x => x.done);
  touch();
  if (t.done) celebrateItem(m.done && !wasDone ? m.id : t.id);
  if (m.done && !wasDone) toast(`Milestone done: ${m.title}`, 'success');
}
function addProjectTask(pid, mid) {
  const { m } = projectMilestone(pid, mid);
  const input = $(`#proj-task-${mid}`);
  const title = input?.value.trim();
  if (!m || !title) return;
  (m.tasks = m.tasks || []).push({ id: uid(), title, done: false });
  m.done = false;
  touch();
  setTimeout(() => $(`#proj-task-${mid}`)?.focus(), 20);
}
function removeProjectTask(pid, mid, tid) {
  const { m } = projectMilestone(pid, mid);
  if (!m) return;
  m.tasks = (m.tasks || []).filter(t => t.id !== tid);
  touch();
}
function addMilestone(pid) {
  const p = getProject(pid);
  const title = $('#proj-new-ms')?.value.trim();
  if (!p || !title) { $('#proj-new-ms')?.focus(); return; }
  (p.milestones = p.milestones || []).push({ id: uid(), title, done: false, dueDate: $('#proj-new-ms-date')?.value || null, tasks: [] });
  touch();
  setTimeout(() => $('#proj-new-ms')?.focus(), 20);
}
function setMilestoneDate(pid, mid, value) { const { m } = projectMilestone(pid, mid); if (m) { m.dueDate = value || null; touch(); } }
function moveMilestone(pid, i, dir) {
  const p = getProject(pid);
  const j = i + dir;
  if (!p || j < 0 || j >= p.milestones.length) return;
  [p.milestones[i], p.milestones[j]] = [p.milestones[j], p.milestones[i]];
  touch();
}
function renameMilestone(pid, mid) {
  const { m } = projectMilestone(pid, mid);
  if (!m) return;
  openModal(`
    <div class="modal-head"><h3>Rename milestone</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body"><div class="field"><label for="ms-name">Milestone</label><input class="input" id="ms-name" maxlength="120" value="${esc(m.title)}" onkeydown="if(event.key==='Enter')saveMilestoneName('${pid}','${mid}')"></div></div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveMilestoneName('${pid}','${mid}')">Save</button></div>
  `);
}
function saveMilestoneName(pid, mid) {
  const { m } = projectMilestone(pid, mid);
  const title = $('#ms-name').value.trim();
  if (!m || !title) return;
  m.title = title;
  closeModal(); touch();
}
function deleteMilestone(pid, mid) {
  const { p, m } = projectMilestone(pid, mid);
  if (!m) return;
  const idx = p.milestones.indexOf(m);
  p.milestones.splice(idx, 1);
  touch();
  toast(`Removed “${m.title}”`, 'success', 5000, { label: 'Undo', run: () => { p.milestones.splice(idx, 0, m); touch(); } });
}
function addTeamMember(pid) {
  const p = getProject(pid);
  const name = $('#proj-team')?.value.trim().slice(0, 40);
  if (!p || !name) return;
  (p.team = p.team || []).push(name);
  touch();
  setTimeout(() => $('#proj-team')?.focus(), 20);
}
function removeTeamMember(pid, i) { const p = getProject(pid); if (p?.team) { p.team.splice(i, 1); touch(); } }
function addProjectLink(pid) {
  const p = getProject(pid);
  const raw = $('#proj-link')?.value.trim();
  if (!p || !raw) return;
  const url = cleanUrl(raw);
  if (!url) { toast('That doesn’t look like a link', 'error'); return; }
  (p.links = p.links || []).push({ id: uid(), label: hostOf(url), url });
  touch();
}
function removeProjectLink(pid, i) { const p = getProject(pid); if (p?.links) { p.links.splice(i, 1); touch(); } }
const saveProjectNotesDebounced = debounce((pid, value) => { const p = getProject(pid); if (p) { p.notes = value; save(); } }, 500);
function setProjectDone(pid, done) {
  const p = getProject(pid);
  if (!p) return;
  p.status = done ? 'done' : 'active';
  p.finishedAt = done ? Date.now() : null;
  touch();
  if (done) { playUiSound('success'); toast(`“${p.title}” is finished. Nice work.`, 'success', 4500); }
}
// Evenly re-spreads milestone dates from today (or the start) to the due date.
function respaceMilestones(pid) {
  const p = getProject(pid);
  if (!p?.dueDate) return;
  const open = p.milestones.filter(m => !m.done);
  const from = todayIso() > (p.startDate || '') ? todayIso() : p.startDate;
  const span = Math.max(0, daysBetweenIso(from, p.dueDate));
  open.forEach((m, i) => { m.dueDate = addDays(from, Math.round(((i + 1) / open.length) * span)); });
  touch();
  toast('Milestone dates spaced out to the due date');
}
function blockProjectTime(pid) {
  const p = getProject(pid);
  const m = p && nextMilestone(p);
  setState({ route: 'calendar', subRoute: null, calView: 'week', calDate: todayIso() });
  openEventModal(null, todayIso());
  const el = $('#ef-title');
  if (el && !el.value) el.value = m ? `${p.title}: ${m.title}` : p.title;
  const sel = $('#ef-course');
  if (sel && p.courseId) { sel.value = p.courseId; if (window._eventDraft) window._eventDraft.courseId = p.courseId; }
}

/* ── Templates + AI planning ───────────────────────────────────── */
function templateMilestones(templateId, dueDate, from = todayIso()) {
  const t = PROJECT_TEMPLATES.find(x => x.id === templateId);
  if (!t) return [];
  const span = dueDate ? Math.max(0, daysBetweenIso(from, dueDate)) : 0;
  return t.steps.map(([title, frac, tasks]) => ({
    id: uid(), title, done: false, dueDate: dueDate ? addDays(from, Math.round(frac * span)) : null,
    tasks: tasks.map(x => ({ id: uid(), title: x, done: false })),
  }));
}
function applyProjectTemplate(pid, templateId) {
  const p = getProject(pid);
  if (!p) return;
  p.milestones = templateMilestones(templateId, p.dueDate);
  p.template = templateId;
  touch();
  toast(p.dueDate ? 'Milestones added and spaced out to the due date' : 'Milestones added. Set a due date to space them out.');
}
const PROJECT_PLAN_SYSTEM = `You break a college student's project into a realistic plan. Reply with ONLY a JSON object (no prose, no markdown fences): {"milestones": [{"title": string (short), "dueDate": "YYYY-MM-DD or empty string", "tasks": [string]}]}. Use 3 to 7 milestones in order, each with 0 to 4 short, concrete tasks. Space dates between today and the due date with the heaviest work in the middle and a small buffer before the deadline. Don't include grading.`;
async function planProjectWithAI(pid) {
  const p = getProject(pid);
  if (!p || !requireAi('Planning a project for you')) return;
  const btn = $('#proj-ai-btn');
  setBtnLoading(btn, true);
  try {
    const c = getCourse(p.courseId);
    const raw = await callClaude({ system: PROJECT_PLAN_SYSTEM, maxTokens: 1500, userContent: `Today is ${todayIso()}.\nProject: ${p.title}\nClass: ${c ? `${c.code || ''} ${c.name}` : 'none'}\nDue: ${p.dueDate || 'not set'}\nDetails: ${p.description || 'none'}\nTeam size: ${(p.team || []).length + 1}` });
    const plan = extractJson(raw);
    const list = (Array.isArray(plan?.milestones) ? plan.milestones : []).filter(m => m && m.title).slice(0, 8).map(m => ({
      id: uid(), title: cleanStr(m.title, 120), done: false,
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(m.dueDate || '') ? (p.dueDate && m.dueDate > p.dueDate ? p.dueDate : m.dueDate) : null,
      tasks: (Array.isArray(m.tasks) ? m.tasks : []).filter(x => typeof x === 'string' && x.trim()).slice(0, 5).map(x => ({ id: uid(), title: cleanStr(x, 160), done: false })),
    }));
    if (!list.length) throw new Error('Couldn’t come up with a plan. Try adding a sentence about the project first.');
    p.milestones = list;
    touch();
    toast(`Planned ${list.length} milestones. Change anything that doesn’t fit.`, 'success', 4500);
  } catch (e) {
    setBtnLoading(btn, false);
    toast(e.message || 'Couldn’t plan that project', 'error', 4500);
  }
}

/* ── New / edit project ────────────────────────────────────────── */
function openProjectModal(id, preset = {}) {
  const p = id ? getProject(id) : null;
  if (id && !p) return;
  window._projectDraft = p ? { title: p.title, courseId: p.courseId, dueDate: p.dueDate || '', description: p.description || '' } : {
    title: preset.title || (preset.template ? PROJECT_TEMPLATES.find(t => t.id === preset.template)?.name || '' : ''), courseId: preset.courseId || null,
    dueDate: preset.dueDate || '', description: preset.description || '', template: preset.template || '', assignmentId: preset.assignmentId || null,
  };
  const d = window._projectDraft;
  openModal(`
    <div class="modal-head"><h3>${id ? 'Edit project' : 'New project'}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label for="pf-title">Project</label><input class="input" id="pf-title" maxlength="120" value="${esc(d.title)}" placeholder="Marketing plan for a local business"></div>
      <div class="field-row">
        <div class="field"><label for="pf-course">Class</label><select class="select" id="pf-course"><option value="">Personal</option>${activeCourses().map(c => `<option value="${c.id}" ${c.id === d.courseId ? 'selected' : ''}>${esc(c.code ? `${c.code} · ${c.name}` : c.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="pf-date">Due date</label><input class="input" type="date" id="pf-date" value="${d.dueDate || ''}"></div>
      </div>
      <div class="field"><label for="pf-desc">What’s the assignment? <span class="muted">(optional)</span></label><textarea class="input" id="pf-desc" maxlength="1000" placeholder="10-page paper, 5 sources, APA. Paste the prompt if you have it.">${esc(d.description)}</textarea></div>
      ${!id ? `<div class="field" style="margin-bottom:0"><label>Start from</label>
        <div class="chip-row" id="pf-templates" role="group" aria-label="Template">
          <button type="button" class="chip ${!d.template ? 'active' : ''}" aria-pressed="${!d.template}" onclick="pickProjectTemplate('')">Blank</button>
          ${PROJECT_TEMPLATES.map(t => `<button type="button" class="chip ${d.template === t.id ? 'active' : ''}" aria-pressed="${d.template === t.id}" onclick="pickProjectTemplate('${t.id}')">${icon(t.icon, 12, 1.8)} ${esc(t.name)}</button>`).join('')}
        </div>
        <p class="small muted mt-8">Templates space their milestones out between today and the due date.</p>
      </div>` : ''}
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveProjectModal(${id ? `'${id}'` : 'null'})">${id ? 'Save' : 'Create project'}</button>
    </div>
  `);
}
function pickProjectTemplate(templateId) {
  const d = window._projectDraft;
  const titleEl = $('#pf-title');
  const oldName = PROJECT_TEMPLATES.find(t => t.id === d.template)?.name || '';
  if (titleEl && (!titleEl.value.trim() || titleEl.value === oldName)) titleEl.value = PROJECT_TEMPLATES.find(t => t.id === templateId)?.name || '';
  d.template = templateId;
  $$('#pf-templates .chip').forEach(b => { const on = b.getAttribute('onclick') === `pickProjectTemplate('${templateId}')`; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
}
function saveProjectModal(id) {
  const d = window._projectDraft;
  const title = $('#pf-title').value.trim();
  if (!title) { toast('Give the project a name', 'error'); return; }
  const fields = { title, courseId: $('#pf-course').value || null, dueDate: $('#pf-date').value || '', description: $('#pf-desc').value.trim() };
  if (id) {
    Object.assign(getProject(id), fields);
    touch(); closeModal(); toast('Project updated');
    return;
  }
  const p = { id: uid(), ...fields, status: 'active', createdAt: Date.now(), startDate: todayIso(), team: [], links: [], notes: '', template: d.template || '', assignmentId: d.assignmentId || null, milestones: d.template ? templateMilestones(d.template, fields.dueDate) : [] };
  state.projects.push(p);
  closeModal();
  openProject(p.id);
  toast(d.template ? `${p.milestones.length} milestones ready` : 'Project created. Add your first milestone.');
}
function shareProjectToGroup(id) {
  const p = getProject(id);
  if (!p) return;
  openShareToGroupModal('project', p.title || 'Untitled project', { dueDate: p.dueDate || '', milestones: JSON.parse(JSON.stringify(p.milestones || [])) });
}
function deleteProject(id) {
  confirmDialog('Delete this project? You can restore it from Recently Deleted for 30 days.', () => {
    const p = getProject(id);
    if (p) trashItem('project', p.title || 'Untitled project', p);
    state.projects = state.projects.filter(x => x.id !== id);
    if (state.subRoute === id) state.subRoute = null;
    touch();
  });
}
// From an assignment of type project, paper, or lab: a project with the right template.
function planAssignmentAsProject(assignmentId) {
  const a = state.assignments.find(x => x.id === assignmentId);
  if (!a) return;
  const existing = state.projects.find(p => p.assignmentId === assignmentId);
  closeModal();
  if (existing) { openProject(existing.id); return; }
  const template = a.type === 'paper' ? 'paper' : a.type === 'lab' ? 'lab' : /present/i.test(a.title) ? 'presentation' : /case/i.test(a.title) ? 'case' : 'paper';
  setTimeout(() => openProjectModal(null, { title: a.title, courseId: a.courseId, dueDate: a.dueDate || '', description: a.notes || '', template, assignmentId }), 200);
}
