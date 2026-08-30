/* ── Study Groups: shareable code + shared mini-calendar ──────────
   Local-first: groups always work on this device. If Firebase is
   configured (see js/firebase.js) and you're signed in, groups also
   sync through a shared Firestore doc keyed by the group's code, so
   anyone with the code sees the same schedule.
──────────────────────────────────────────────────────────────── */
function genGroupCode() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }

function pageStudyGroups() {
  const groups = state.studyGroups;
  const upcomingSessions = groups.reduce((s, g) => s + g.events.filter(e => e.date >= todayIso()).length, 0);
  const coursesLinked = new Set(groups.map(g => g.courseId).filter(Boolean)).size;
  return `
    ${pageHead('Study Groups', 'Coordinate sessions with classmates via a shared code', `
      <button class="btn btn-sm" onclick="openJoinGroupModal()">Join with code</button>
      <button class="btn btn-primary" onclick="openGroupModal()">+ New group</button>
    `)}
    <div class="grid grid-3 mb-16">
      <div class="stat-card"><div class="num">${groups.length}</div><div class="lbl">Groups</div></div>
      <div class="stat-card"><div class="num">${upcomingSessions}</div><div class="lbl">Upcoming sessions</div></div>
      <div class="stat-card"><div class="num">${coursesLinked}</div><div class="lbl">Courses covered</div></div>
    </div>
    ${!fbConfigured() ? `<div class="small mb-16" style="background:var(--warn-light);color:var(--warn);padding:10px 12px;border-radius:10px">Cross-device sharing needs sync set up (Settings → Account). Groups still work on this device.</div>` : ''}
    ${groups.length ? `<div class="grid grid-3">${groups.map(groupCard).join('')}</div>` : emptyState(icon('users',26,1.4), 'No study groups yet', '', 'Start one and share the code with classmates, or join a group someone else made.')}
  `;
}
function groupCard(g) {
  const next = [...g.events].sort((a, b) => a.date.localeCompare(b.date)).find(e => e.date >= todayIso());
  return `
    <div class="card card-pad" style="cursor:pointer" onclick="openGroupDetail('${g.id}')">
      <div class="flex-between"><div style="font-weight:700">${esc(g.name)}</div>${g.courseId ? courseChip(g.courseId) : ''}</div>
      <div class="small muted mt-8">Code: <strong style="letter-spacing:.06em">${g.code}</strong></div>
      <div class="small mt-8">${next ? `Next: ${esc(next.title)} · ${relativeDay(next.date)}` : 'No sessions scheduled'}</div>
    </div>
  `;
}
function openGroupModal() {
  openModal(`
    <div class="modal-head"><h3>New study group</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label>Group name</label><input class="input" id="gf-name" placeholder="Calc II study crew"></div>
      <div class="field"><label>Course</label><select class="select" id="gf-course"><option value="">—</option>${activeCourses().map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="createGroup()">Create</button></div>
  `);
}
async function createGroup() {
  const name = $('#gf-name').value.trim();
  if (!name) { toast('Name the group', 'error'); return; }
  const g = { id: uid(), name, code: genGroupCode(), courseId: $('#gf-course').value || null, events: [], members: [state.settings.displayName || 'Me'], sharedItems: [] };
  state.studyGroups.push(g);
  touch(); closeModal();
  toast(`Group created — share code ${g.code}`);
  if (fbConfigured() && _fbUser) pushGroupToCloud(g);
}
function openJoinGroupModal() {
  openModal(`
    <div class="modal-head"><h3>Join a group</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label>Group code</label><input class="input" id="jf-code" placeholder="ABC123" style="text-transform:uppercase"></div>
      ${!fbConfigured() ? `<div class="small muted">Sync isn't set up on this device, so joining only works once it is — ask whoever created the group to enable it in Settings.</div>` : ''}
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="joinGroup()" ${fbConfigured() ? '' : 'disabled'}>Join</button></div>
  `);
}
async function joinGroup() {
  const code = $('#jf-code').value.trim().toUpperCase();
  if (!code) return;
  try {
    const doc = await _fbDb.collection('studyGroups').doc(code).get();
    if (!doc.exists) { toast('No group found with that code', 'error'); return; }
    const g = doc.data();
    // The creator's push only ever wrote their own name into `members` — joining
    // never added the joiner, so rosters (and cross-account visibility) never grew.
    const me = state.settings.displayName || 'Me';
    g.members = g.members || [];
    if (!g.members.includes(me)) g.members.push(me);
    const i = state.studyGroups.findIndex(x => x.code === code);
    if (i >= 0) state.studyGroups[i] = g; else state.studyGroups.push(g);
    touch(); closeModal(); toast(`Joined ${g.name}`);
    pushGroupToCloud(g);
  } catch (e) { toast('Could not join — ' + e.message, 'error'); }
}
function pushGroupToCloud(g) {
  if (!fbConfigured() || !_fbUser) return;
  _fbDb.collection('studyGroups').doc(g.code).set(g).catch(e => console.warn('group sync failed', e));
}

let _groupUnsub = null;
function openGroupDetail(id) {
  const g = state.studyGroups.find(x => x.id === id);
  window._groupTab = 'sessions';
  renderGroupDetail(g);
  if (fbConfigured() && _fbUser) {
    _groupUnsub = _fbDb.collection('studyGroups').doc(g.code).onSnapshot(doc => {
      if (!doc.exists) return;
      const i = state.studyGroups.findIndex(x => x.code === g.code);
      if (i >= 0) { state.studyGroups[i] = doc.data(); save(); if (window._modalOpenGroupId === id) renderGroupDetail(state.studyGroups[i]); }
    });
  }
  window._modalOpenGroupId = id;
}
const SHARE_KIND_ICON = { note: 'file-text', deck: 'layers', project: 'folder', 'note-bundle': 'folder-open' };
window._groupTab = 'sessions';
function setGroupTab(tab) { window._groupTab = tab; renderGroupDetail(state.studyGroups.find(x => x.id === window._modalOpenGroupId)); }
function renderGroupDetail(g) {
  const tab = window._groupTab;
  openModal(`
    <div class="modal-head"><h3>${esc(g.name)}</h3><button class="close-x" aria-label="Close" onclick="closeGroupDetail()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="small muted mb-8">Share code: <strong style="letter-spacing:.06em">${g.code}</strong> · ${g.members.length} member${g.members.length === 1 ? '' : 's'}</div>
      <div class="segmented mb-16">
        <button class="${tab === 'people' ? 'active' : ''}" onclick="setGroupTab('people')">People</button>
        <button class="${tab === 'sessions' ? 'active' : ''}" onclick="setGroupTab('sessions')">Sessions</button>
        <button class="${tab === 'tasks' ? 'active' : ''}" onclick="setGroupTab('tasks')">Group tasks</button>
        <button class="${tab === 'availability' ? 'active' : ''}" onclick="setGroupTab('availability')">Availability</button>
        <button class="${tab === 'projects' ? 'active' : ''}" onclick="setGroupTab('projects')">Projects</button>
        <button class="${tab === 'shared' ? 'active' : ''}" onclick="setGroupTab('shared')">Shared</button>
      </div>
      ${tab === 'people' ? renderGroupPeopleTab(g) : ''}
      ${tab === 'sessions' ? renderGroupSessionsTab(g) : ''}
      ${tab === 'tasks' ? renderGroupTasksTab(g) : ''}
      ${tab === 'availability' ? renderGroupAvailabilityTab(g) : ''}
      ${tab === 'projects' ? renderGroupProjectsTab(g) : ''}
      ${tab === 'shared' ? renderGroupSharedTab(g) : ''}
    </div>
    <div class="modal-foot"><button class="btn btn-danger" onclick="deleteGroup('${g.id}')">Leave/delete group</button><button class="btn" onclick="closeGroupDetail()">Close</button></div>
  `, { wide: true });
}
/* ── People: who's in the group, plus a feed of who shared/assigned what ─ */
function renderGroupPeopleTab(g) {
  const me = state.settings.displayName || 'Me';
  const members = g.members || [];
  const activity = groupActivityFeed(g).slice(0, 15);
  return `
    <div class="small muted mb-8">${members.length} member${members.length === 1 ? '' : 's'} — anyone with the code ${g.code} who's joined shows up here.</div>
    ${members.map(m => `
      <div class="list-row">
        <div class="avatar">${esc((m || '?').trim()[0]?.toUpperCase() || '?')}</div>
        <div class="row-title">${esc(m)}${m === me ? ' <span class="small muted">(you)</span>' : ''}</div>
      </div>`).join('')}
    <div class="divider"></div>
    <div class="small dim mb-8" style="font-weight:600">Recent activity</div>
    ${activity.length ? activity.map(a => `
      <div class="list-row">
        <span class="nb-note-ic">${icon(a.icon, 14)}</span>
        <div class="row-title">${esc(a.text)}</div>
        <div class="row-meta">${fmtRelativeTime(a.at)}</div>
      </div>`).join('') : emptyState(icon('users', 22, 1.4), 'No activity yet — share something or assign a task.')}
  `;
}
function groupActivityFeed(g) {
  const items = [];
  (g.sharedItems || []).forEach(s => items.push({ at: s.sharedAt || 0, icon: SHARE_KIND_ICON[s.kind] || 'file-text', text: `${s.sharedBy || 'Someone'} shared "${s.title}"` }));
  (g.tasks || []).forEach(t => { if (t.assignedTo && t.assignedAt) items.push({ at: t.assignedAt, icon: 'check-square', text: `"${t.title}" assigned to ${t.assignedTo}` }); });
  (g.projects || []).forEach(p => (p.tasks || []).forEach(t => { if (t.assignedTo && t.assignedAt) items.push({ at: t.assignedAt, icon: 'folder', text: `"${t.title}" (${p.title}) assigned to ${t.assignedTo}` }); }));
  return items.sort((a, b) => b.at - a.at);
}
function renderGroupSessionsTab(g) {
  const sorted = [...g.events].sort((a, b) => a.date.localeCompare(b.date));
  return `
    <div class="field-row">
      <input class="input" id="ge-title" placeholder="Session title">
      <input class="input" type="date" id="ge-date" value="${todayIso()}" style="max-width:150px">
      <input class="input" type="time" id="ge-time" value="17:00" style="max-width:110px">
      <button class="btn btn-primary btn-sm" onclick="addGroupEvent('${g.id}')">Add</button>
    </div>
    <div class="divider"></div>
    ${sorted.length ? sorted.map(e => `
      <div class="list-row">
        <div class="row-title">${esc(e.title)}</div>
        <div class="row-meta">${relativeDay(e.date)}${e.time ? ' · ' + fmtTime(e.time) : ''}</div>
        <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove ${esc(e.title)}" onclick="removeGroupEvent('${g.id}','${e.id}')">${icon('trash',14)}</button>
      </div>`).join('') : emptyState(icon('calendar',26,1.4), 'No sessions scheduled yet.')}
  `;
}
function renderGroupSharedTab(g) {
  const shared = [...(g.sharedItems || [])].sort((a, b) => (b.sharedAt || 0) - (a.sharedAt || 0));
  return `
    <div class="flex-between mb-8"><h3 style="font-size:14px">Shared with the group</h3><button class="btn btn-sm" onclick="openShareFromGroupModal('${g.id}')">${icon('link', 13)} Link a notebook, note, PDF, deck, or project</button></div>
    ${shared.length ? shared.map(s => `
      <div class="list-row">
        <span class="nb-note-ic">${icon(SHARE_KIND_ICON[s.kind] || 'file-text', 14)}</span>
        <div class="row-title">${esc(s.title)}${s.kind === 'deck' ? ` <span class="small muted">(${s.cards.length} cards)</span>` : s.kind === 'project' ? ` <span class="small muted">(${(s.milestones || []).length} milestones)</span>` : s.kind === 'note-bundle' ? ` <span class="small muted">(${(s.notes || []).length} notes)</span>` : ''}</div>
        <div class="row-meta">${esc(s.sharedBy || '')}</div>
        <button class="btn btn-sm" onclick="importSharedItem('${g.id}','${s.id}')">Add to mine</button>
        <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove ${esc(s.title)}" onclick="removeSharedItem('${g.id}','${s.id}')">${icon('trash',14)}</button>
      </div>`).join('') : emptyState(icon('layers',22,1.4), 'Nothing shared yet', '', 'Share a notebook, note, or flashcard deck from the Notebook or Flashcards page.')}
  `;
}
// Lets you link something into a group without leaving it — otherwise sharing
// only worked by navigating to Notebook/Flashcards/Projects and hunting for the
// Share button there. A note that came from Notebook → Upload PDF works here too,
// since the extracted text just lives in the note's content like anything else.
function openShareFromGroupModal(groupId) {
  openModal(`
    <div class="modal-head"><h3>Link something into this group</h3><button class="close-x" aria-label="Close" onclick="renderGroupDetail(state.studyGroups.find(x=>x.id==='${groupId}'))">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label>What do you want to share?</label>
        <select class="select" id="sfg-kind" onchange="renderShareFromGroupItems()">
          <option value="note-bundle">Notebook (a whole folder of notes)</option>
          <option value="note">Single note (includes anything imported via Upload PDF)</option>
          <option value="deck">Flashcard deck</option>
          <option value="project">Project</option>
        </select>
      </div>
      <div class="field" id="sfg-item-field"></div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="renderGroupDetail(state.studyGroups.find(x=>x.id==='${groupId}'))">Cancel</button><button class="btn btn-primary" onclick="confirmShareFromGroup('${groupId}')">Share</button></div>
  `);
  renderShareFromGroupItems();
}
function renderShareFromGroupItems() {
  const kind = $('#sfg-kind').value;
  const field = $('#sfg-item-field');
  const items = kind === 'note-bundle' ? foldersWithNotes() : kind === 'note' ? state.notes.filter(n => n.type === 'note') : kind === 'deck' ? state.decks : state.projects;
  const label = kind === 'note-bundle' ? 'Notebook' : kind === 'note' ? 'Note' : kind === 'deck' ? 'Flashcard deck' : 'Project';
  field.innerHTML = items.length
    ? `<label>${label}</label><select class="select" id="sfg-item">${items.map(it => `<option value="${it.id}">${esc(it.name || it.title)}</option>`).join('')}</select>`
    : `<p class="small muted">${kind === 'note-bundle' ? "You don't have any notebooks with notes in them yet." : `You don't have any ${label.toLowerCase()}s yet.`}</p>`;
}
function confirmShareFromGroup(groupId) {
  const kind = $('#sfg-kind').value;
  const itemEl = $('#sfg-item');
  const itemId = itemEl?.value;
  if (!itemId) { toast('Nothing to share', 'error'); return; }
  const g = state.studyGroups.find(x => x.id === groupId);
  let title, payload;
  if (kind === 'note-bundle') {
    const folder = state.notes.find(x => x.id === itemId);
    const notes = state.notes.filter(n => n.type === 'note' && n.parentId === itemId);
    title = folder.name; payload = { notes: notes.map(n => ({ name: n.name, content: n.content || '' })) };
  } else if (kind === 'note') {
    const n = state.notes.find(x => x.id === itemId);
    title = n.name; payload = { content: n.content || '' };
  } else if (kind === 'deck') {
    const d = state.decks.find(x => x.id === itemId);
    title = d.name; payload = { cards: JSON.parse(JSON.stringify(d.cards || [])) };
  } else {
    const p = state.projects.find(x => x.id === itemId);
    title = p.title; payload = { dueDate: p.dueDate || '', milestones: JSON.parse(JSON.stringify(p.milestones || [])) };
  }
  g.sharedItems = g.sharedItems || [];
  g.sharedItems.push({ id: uid(), kind, title, sharedBy: state.settings.displayName || 'Me', sharedAt: Date.now(), ...payload });
  touch(); pushGroupToCloud(g);
  toast(`Shared "${title}" with ${g.name}`);
  renderGroupDetail(g);
}

/* ── Group task list — separate from personal to-dos ─────────── */
function renderGroupTasksTab(g) {
  const me = state.settings.displayName || 'Me';
  const mineOnly = !!window._groupTasksMineOnly;
  const tasks = g.tasks || [];
  const shown = mineOnly ? tasks.filter(t => t.assignedTo === me) : tasks;
  return `
    <div class="field-row">
      <input class="input" id="gt-title" placeholder="Bring flashcards, review chapter 5…" onkeydown="if(event.key==='Enter')addGroupTask('${g.id}')">
      <button class="btn btn-primary btn-sm" onclick="addGroupTask('${g.id}')">Add</button>
    </div>
    <div class="checkbox-row mt-8"><input type="checkbox" id="gt-mine" ${mineOnly ? 'checked' : ''} onchange="window._groupTasksMineOnly=this.checked;renderGroupDetail(state.studyGroups.find(x=>x.id==='${g.id}'))"><label for="gt-mine">Only show tasks assigned to me</label></div>
    <div class="divider"></div>
    ${shown.length ? shown.map(t => `
      <div class="list-row">
        <button type="button" class="row-check ${t.done ? 'checked' : ''}" role="checkbox" aria-checked="${t.done}" aria-label="Mark ${esc(t.title)} as ${t.done ? 'not done' : 'done'}" onclick="toggleGroupTask('${g.id}','${t.id}')">${t.done ? checkGlyph(true) : ''}</button>
        <div class="row-title ${t.done ? 'done' : ''}">${esc(t.title)}</div>
        <select class="select" style="max-width:150px" onchange="setGroupTaskOwner('${g.id}','${t.id}',this.value)">
          <option value="">Unassigned</option>${(g.members || []).map(m => `<option value="${esc(m)}" ${m === t.assignedTo ? 'selected' : ''}>${esc(m)}${m === me ? ' (you)' : ''}</option>`).join('')}
        </select>
        <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove ${esc(t.title)}" onclick="removeGroupTask('${g.id}','${t.id}')">${icon('trash',14)}</button>
      </div>`).join('') : emptyState(icon('check-square',22,1.4), mineOnly ? 'Nothing assigned to you.' : 'No shared tasks yet.')}
  `;
}
function addGroupTask(groupId) {
  const title = $('#gt-title').value.trim();
  if (!title) return;
  const g = state.studyGroups.find(x => x.id === groupId);
  g.tasks = g.tasks || [];
  g.tasks.push({ id: uid(), title, done: false, assignedTo: null, assignedAt: null });
  touch(); renderGroupDetail(g); pushGroupToCloud(g);
}
function setGroupTaskOwner(groupId, taskId, owner) {
  const g = state.studyGroups.find(x => x.id === groupId);
  const t = (g.tasks || []).find(x => x.id === taskId);
  if (t) { t.assignedTo = owner || null; t.assignedAt = owner ? Date.now() : null; }
  touch(); pushGroupToCloud(g);
}
function toggleGroupTask(groupId, taskId) {
  const g = state.studyGroups.find(x => x.id === groupId);
  const t = (g.tasks || []).find(x => x.id === taskId);
  if (t) t.done = !t.done;
  touch(); renderGroupDetail(g); pushGroupToCloud(g);
}
function removeGroupTask(groupId, taskId) {
  const g = state.studyGroups.find(x => x.id === groupId);
  g.tasks = (g.tasks || []).filter(x => x.id !== taskId);
  touch(); renderGroupDetail(g); pushGroupToCloud(g);
}

/* ── Shared availability — mark blocks, highlight overlaps ─────── */
const AVAIL_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function renderGroupAvailabilityTab(g) {
  const me = state.settings.displayName || 'Me';
  const availability = g.availability || {};
  const mine = availability[me] || [];
  const overlaps = computeAvailabilityOverlap(availability);
  return `
    <div class="small muted mb-8">Add blocks when you're free — Semester HQ highlights times everyone overlaps.</div>
    <div class="field-row">
      <select class="select" id="av-day" style="max-width:110px">${AVAIL_DAYS.map((d, i) => `<option value="${i}">${d}</option>`).join('')}</select>
      <input class="input" type="time" id="av-start" value="17:00">
      <input class="input" type="time" id="av-end" value="19:00">
      <button class="btn btn-primary btn-sm" onclick="addAvailability('${g.id}')">Add</button>
    </div>
    <div class="divider"></div>
    <div class="small dim mb-8" style="font-weight:600">Your blocks</div>
    ${mine.length ? mine.map((b, i) => `<div class="list-row"><div class="row-title">${AVAIL_DAYS[b.day]} ${fmtTime(b.start)}–${fmtTime(b.end)}</div><button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove availability block" onclick="removeAvailability('${g.id}',${i})">${icon('x',13,2.2)}</button></div>`).join('') : `<div class="small muted">None yet.</div>`}
    <div class="divider"></div>
    <div class="small dim mb-8" style="font-weight:600">Everyone's overlap</div>
    ${overlaps.length ? overlaps.map(o => `<div class="list-row"><div class="row-title">${AVAIL_DAYS[o.day]} ${fmtTime(o.start)}–${fmtTime(o.end)}</div><span class="small muted">${o.members.join(', ')}</span></div>`).join('') : emptyState(icon('users',22,1.4), 'No overlapping availability yet — add your blocks above.')}
  `;
}
function addAvailability(groupId) {
  const g = state.studyGroups.find(x => x.id === groupId);
  const me = state.settings.displayName || 'Me';
  g.availability = g.availability || {};
  g.availability[me] = g.availability[me] || [];
  g.availability[me].push({ day: Number($('#av-day').value), start: $('#av-start').value, end: $('#av-end').value });
  touch(); renderGroupDetail(g); pushGroupToCloud(g);
}
function removeAvailability(groupId, i) {
  const g = state.studyGroups.find(x => x.id === groupId);
  const me = state.settings.displayName || 'Me';
  (g.availability?.[me] || []).splice(i, 1);
  touch(); renderGroupDetail(g); pushGroupToCloud(g);
}
function computeAvailabilityOverlap(availability) {
  const members = Object.keys(availability).filter(m => (availability[m] || []).length);
  if (members.length < 2) return [];
  const results = [];
  for (let day = 0; day < 7; day++) {
    const points = [];
    members.forEach(m => (availability[m] || []).filter(b => b.day === day).forEach(b => {
      points.push([toMin(b.start), 1, m]); points.push([toMin(b.end), -1, m]);
    }));
    points.sort((a, b) => a[0] - b[0]);
    let active = new Set(), windowStart = null;
    points.forEach(([t, delta, m]) => {
      const before = active.size;
      if (delta === 1) active.add(m); else active.delete(m);
      if (before < 2 && active.size >= 2) windowStart = t;
      if (before >= 2 && active.size < 2 && windowStart != null) { results.push({ day, start: fromMin(windowStart), end: fromMin(t), members: [...active, m].filter((v, i, a) => a.indexOf(v) === i) }); windowStart = null; }
    });
  }
  return results;
}
function toMin(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
function fromMin(min) { return `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }

/* ── Shared project workspace — beyond study sessions ────────── */
function renderGroupProjectsTab(g) {
  const projects = g.projects || [];
  return `
    <div class="field-row">
      <input class="input" id="gp-title" placeholder="Group project title">
      <button class="btn btn-primary btn-sm" onclick="addGroupProject('${g.id}')">+ Add project</button>
    </div>
    <div class="divider"></div>
    ${projects.length ? projects.map(p => renderGroupProjectCard(g, p)).join('') : emptyState(icon('folder',22,1.4), 'No shared projects yet.')}
  `;
}
function addGroupProject(groupId) {
  const title = $('#gp-title').value.trim();
  if (!title) return;
  const g = state.studyGroups.find(x => x.id === groupId);
  g.projects = g.projects || [];
  g.projects.push({ id: uid(), title, tasks: [], deadlines: [], files: [], meetings: [] });
  touch(); renderGroupDetail(g); pushGroupToCloud(g);
}
function renderGroupProjectCard(g, p) {
  return `
    <div class="card card-pad mb-16">
      <div class="flex-between"><div style="font-weight:700">${esc(p.title)}</div><button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove ${esc(p.title)}" onclick="removeGroupProject('${g.id}','${p.id}')">${icon('trash',14)}</button></div>
      <div class="small dim mt-8" style="font-weight:600">Tasks</div>
      ${p.tasks.map((t, i) => `
        <div class="list-row">
          <button type="button" class="row-check ${t.done ? 'checked' : ''}" role="checkbox" aria-checked="${t.done}" aria-label="Mark ${esc(t.title)} as ${t.done ? 'not done' : 'done'}" onclick="toggleGroupProjectTask('${g.id}','${p.id}',${i})">${t.done ? checkGlyph(true) : ''}</button>
          <div class="row-title ${t.done ? 'done' : ''}">${esc(t.title)}</div>
          <select class="select" style="max-width:140px" onchange="setGroupProjectTaskOwner('${g.id}','${p.id}',${i},this.value)">
            <option value="">Unassigned</option>${g.members.map(m => `<option value="${esc(m)}" ${m === t.assignedTo ? 'selected' : ''}>${esc(m)}</option>`).join('')}
          </select>
          <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove ${esc(t.title)}" onclick="removeGroupProjectTask('${g.id}','${p.id}',${i})">${icon('x',13,2.2)}</button>
        </div>`).join('')}
      <div class="field-row mt-8"><input class="input" id="gpt-title-${p.id}" placeholder="New task"><button class="btn btn-sm" onclick="addGroupProjectTask('${g.id}','${p.id}')">+ Task</button></div>

      <div class="small dim mt-16" style="font-weight:600">Deadlines</div>
      ${p.deadlines.map((d, i) => `<div class="list-row"><div class="row-title">${esc(d.title)}</div><div class="row-meta">${fmtDate(d.date)}</div><button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove ${esc(d.title)}" onclick="removeGroupProjectDeadline('${g.id}','${p.id}',${i})">${icon('x',13,2.2)}</button></div>`).join('')}
      <div class="field-row mt-8"><input class="input" id="gpd-title-${p.id}" placeholder="Deadline"><input class="input" type="date" id="gpd-date-${p.id}"><button class="btn btn-sm" onclick="addGroupProjectDeadline('${g.id}','${p.id}')">+ Deadline</button></div>

      <div class="small dim mt-16" style="font-weight:600">Meeting dates</div>
      ${p.meetings.map((m, i) => `<div class="list-row"><div class="row-title">${esc(m.title)}</div><div class="row-meta">${fmtDate(m.date)}</div><button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove ${esc(m.title)}" onclick="removeGroupProjectMeeting('${g.id}','${p.id}',${i})">${icon('x',13,2.2)}</button></div>`).join('')}
      <div class="field-row mt-8"><input class="input" id="gpm-title-${p.id}" placeholder="Meeting"><input class="input" type="date" id="gpm-date-${p.id}"><button class="btn btn-sm" onclick="addGroupProjectMeeting('${g.id}','${p.id}')">+ Meeting</button></div>

      <div class="small dim mt-16" style="font-weight:600">Files</div>
      ${p.files.map((f, i) => `<div class="list-row"><a class="row-title" href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a><button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove ${esc(f.name)}" onclick="removeGroupProjectFile('${g.id}','${p.id}',${i})">${icon('x',13,2.2)}</button></div>`).join('')}
      <div class="field-row mt-8"><input class="input" id="gpf-name-${p.id}" placeholder="File name"><input class="input" id="gpf-url-${p.id}" placeholder="Link (Drive, etc.)"><button class="btn btn-sm" onclick="addGroupProjectFile('${g.id}','${p.id}')">+ File</button></div>
    </div>
  `;
}
function findGroupProject(groupId, projectId) { const g = state.studyGroups.find(x => x.id === groupId); return { g, p: (g.projects || []).find(x => x.id === projectId) }; }
function removeGroupProject(groupId, projectId) { const g = state.studyGroups.find(x => x.id === groupId); g.projects = (g.projects || []).filter(x => x.id !== projectId); touch(); renderGroupDetail(g); pushGroupToCloud(g); }
function addGroupProjectTask(groupId, projectId) {
  const { g, p } = findGroupProject(groupId, projectId);
  const title = $(`#gpt-title-${projectId}`).value.trim();
  if (!title) return;
  p.tasks.push({ id: uid(), title, done: false, assignedTo: null });
  touch(); renderGroupDetail(g); pushGroupToCloud(g);
}
function toggleGroupProjectTask(groupId, projectId, i) { const { g, p } = findGroupProject(groupId, projectId); p.tasks[i].done = !p.tasks[i].done; touch(); renderGroupDetail(g); pushGroupToCloud(g); }
function removeGroupProjectTask(groupId, projectId, i) { const { g, p } = findGroupProject(groupId, projectId); p.tasks.splice(i, 1); touch(); renderGroupDetail(g); pushGroupToCloud(g); }
function setGroupProjectTaskOwner(groupId, projectId, i, owner) { const { g, p } = findGroupProject(groupId, projectId); p.tasks[i].assignedTo = owner || null; p.tasks[i].assignedAt = owner ? Date.now() : null; touch(); pushGroupToCloud(g); }
function addGroupProjectDeadline(groupId, projectId) {
  const { g, p } = findGroupProject(groupId, projectId);
  const title = $(`#gpd-title-${projectId}`).value.trim(), date = $(`#gpd-date-${projectId}`).value;
  if (!title || !date) return;
  p.deadlines.push({ id: uid(), title, date });
  touch(); renderGroupDetail(g); pushGroupToCloud(g);
}
function removeGroupProjectDeadline(groupId, projectId, i) { const { g, p } = findGroupProject(groupId, projectId); p.deadlines.splice(i, 1); touch(); renderGroupDetail(g); pushGroupToCloud(g); }
function addGroupProjectMeeting(groupId, projectId) {
  const { g, p } = findGroupProject(groupId, projectId);
  const title = $(`#gpm-title-${projectId}`).value.trim(), date = $(`#gpm-date-${projectId}`).value;
  if (!title || !date) return;
  p.meetings.push({ id: uid(), title, date });
  touch(); renderGroupDetail(g); pushGroupToCloud(g);
}
function removeGroupProjectMeeting(groupId, projectId, i) { const { g, p } = findGroupProject(groupId, projectId); p.meetings.splice(i, 1); touch(); renderGroupDetail(g); pushGroupToCloud(g); }
function addGroupProjectFile(groupId, projectId) {
  const { g, p } = findGroupProject(groupId, projectId);
  const name = $(`#gpf-name-${projectId}`).value.trim(), url = $(`#gpf-url-${projectId}`).value.trim();
  if (!name || !url) return;
  p.files.push({ id: uid(), name, url });
  touch(); renderGroupDetail(g); pushGroupToCloud(g);
}
function removeGroupProjectFile(groupId, projectId, i) { const { g, p } = findGroupProject(groupId, projectId); p.files.splice(i, 1); touch(); renderGroupDetail(g); pushGroupToCloud(g); }
function importSharedItem(groupId, itemId) {
  const g = state.studyGroups.find(x => x.id === groupId);
  const s = (g.sharedItems || []).find(x => x.id === itemId);
  if (!s) return;
  if (s.kind === 'note') {
    state.notes.push({ id: uid(), type: 'note', name: s.title, parentId: 'root', courseId: null, content: s.content, updatedAt: Date.now() });
    toast(`Added "${s.title}" to your notebook`);
  } else if (s.kind === 'note-bundle') {
    const folderId = uid();
    state.notes.push({ id: folderId, type: 'folder', name: s.title, parentId: 'root', courseId: null, open: true });
    (s.notes || []).forEach(n => state.notes.push({ id: uid(), type: 'note', name: n.name, parentId: folderId, courseId: null, content: n.content, updatedAt: Date.now() }));
    toast(`Added "${s.title}" to your notebook`);
  } else if (s.kind === 'deck') {
    state.decks.push({ id: uid(), name: s.title, courseId: null, cards: s.cards.map(c => ({ id: uid(), front: c.front, back: c.back })) });
    toast(`Added "${s.title}" to your flashcards`);
  } else if (s.kind === 'project') {
    state.projects.push({
      id: uid(), title: s.title, courseId: null, dueDate: s.dueDate || '',
      milestones: (s.milestones || []).map(m => ({ ...m, id: uid(), tasks: (m.tasks || []).map(t => ({ ...t, id: uid() })) })),
    });
    toast(`Added "${s.title}" to your projects`);
  }
  touch();
}
function removeSharedItem(groupId, itemId) {
  const g = state.studyGroups.find(x => x.id === groupId);
  g.sharedItems = (g.sharedItems || []).filter(x => x.id !== itemId);
  touch(); renderGroupDetail(g);
  pushGroupToCloud(g);
}

/* ── Share a note or flashcard deck into a group (called from Notebook / Flashcards) ─ */
function openShareToGroupModal(kind, title, payload) {
  if (!state.studyGroups.length) { toast('Join or create a study group first', 'error'); return; }
  window._shareDraft = { kind, title, payload };
  openModal(`
    <div class="modal-head"><h3>Share "${esc(title)}"</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label>Share to group</label>
        <select class="select" id="share-group">${state.studyGroups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select>
      </div>
      <p class="small muted">Everyone with this group's code will be able to add a copy to their own ${kind === 'note' || kind === 'note-bundle' ? 'notebook' : kind === 'project' ? 'projects' : 'study tools'}.</p>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="confirmShareToGroup()">Share</button></div>
  `);
}
function confirmShareToGroup() {
  const groupId = $('#share-group').value;
  const g = state.studyGroups.find(x => x.id === groupId);
  const { kind, title, payload } = window._shareDraft;
  g.sharedItems = g.sharedItems || [];
  g.sharedItems.push({ id: uid(), kind, title, sharedBy: state.settings.displayName || 'Me', sharedAt: Date.now(), ...payload });
  touch(); closeModal(); toast(`Shared with ${g.name}`);
  pushGroupToCloud(g);
}
function closeGroupDetail() { if (_groupUnsub) { _groupUnsub(); _groupUnsub = null; } window._modalOpenGroupId = null; closeModal(); }
function addGroupEvent(groupId) {
  const title = $('#ge-title').value.trim();
  if (!title) { toast('Give the session a title', 'error'); return; }
  const g = state.studyGroups.find(x => x.id === groupId);
  g.events.push({ id: uid(), title, date: $('#ge-date').value, time: $('#ge-time').value });
  touch(); renderGroupDetail(g);
  pushGroupToCloud(g);
}
function removeGroupEvent(groupId, eventId) {
  const g = state.studyGroups.find(x => x.id === groupId);
  g.events = g.events.filter(e => e.id !== eventId);
  touch(); renderGroupDetail(g);
  pushGroupToCloud(g);
}
function deleteGroup(id) {
  confirmDialog('Remove this group from your list?', () => {
    state.studyGroups = state.studyGroups.filter(g => g.id !== id);
    touch(); closeGroupDetail();
  });
}
