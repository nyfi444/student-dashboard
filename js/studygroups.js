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
    <div class="modal-head"><h3>New study group</h3><button class="close-x" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
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
    <div class="modal-head"><h3>Join a group</h3><button class="close-x" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
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
    if (!state.studyGroups.some(x => x.code === code)) state.studyGroups.push(g);
    touch(); closeModal(); toast(`Joined ${g.name}`);
  } catch (e) { toast('Could not join — ' + e.message, 'error'); }
}
function pushGroupToCloud(g) {
  if (!fbConfigured() || !_fbUser) return;
  _fbDb.collection('studyGroups').doc(g.code).set(g).catch(e => console.warn('group sync failed', e));
}

let _groupUnsub = null;
function openGroupDetail(id) {
  const g = state.studyGroups.find(x => x.id === id);
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
const SHARE_KIND_ICON = { note: 'file-text', deck: 'layers' };
function renderGroupDetail(g) {
  const sorted = [...g.events].sort((a, b) => a.date.localeCompare(b.date));
  const shared = [...(g.sharedItems || [])].sort((a, b) => (b.sharedAt || 0) - (a.sharedAt || 0));
  openModal(`
    <div class="modal-head"><h3>${esc(g.name)}</h3><button class="close-x" onclick="closeGroupDetail()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="small muted mb-8">Share code: <strong style="letter-spacing:.06em">${g.code}</strong> · ${g.members.length} member${g.members.length === 1 ? '' : 's'}</div>
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
          <button class="btn btn-ghost btn-icon btn-sm" onclick="removeGroupEvent('${g.id}','${e.id}')">${icon('trash',14)}</button>
        </div>`).join('') : emptyState(icon('calendar',26,1.4), 'No sessions scheduled yet.')}

      <div class="divider"></div>
      <div class="flex-between mb-8"><h3 style="font-size:14px">Shared with the group</h3></div>
      ${shared.length ? shared.map(s => `
        <div class="list-row">
          <span class="nb-note-ic">${icon(SHARE_KIND_ICON[s.kind] || 'file-text', 14)}</span>
          <div class="row-title">${esc(s.title)}${s.kind === 'deck' ? ` <span class="small muted">(${s.cards.length} cards)</span>` : ''}</div>
          <div class="row-meta">${esc(s.sharedBy || '')}</div>
          <button class="btn btn-sm" onclick="importSharedItem('${g.id}','${s.id}')">Add to mine</button>
          <button class="btn btn-ghost btn-icon btn-sm" onclick="removeSharedItem('${g.id}','${s.id}')">${icon('trash',14)}</button>
        </div>`).join('') : emptyState(icon('layers',22,1.4), 'Nothing shared yet', '', 'Share a note or flashcard deck from the Notebook or Study Tools page.')}
    </div>
    <div class="modal-foot"><button class="btn btn-danger" onclick="deleteGroup('${g.id}')">Leave/delete group</button><button class="btn" onclick="closeGroupDetail()">Close</button></div>
  `);
}
function importSharedItem(groupId, itemId) {
  const g = state.studyGroups.find(x => x.id === groupId);
  const s = (g.sharedItems || []).find(x => x.id === itemId);
  if (!s) return;
  if (s.kind === 'note') {
    state.notes.push({ id: uid(), type: 'note', name: s.title, parentId: 'root', courseId: null, content: s.content, updatedAt: Date.now() });
    toast(`Added "${s.title}" to your notebook`);
  } else if (s.kind === 'deck') {
    state.decks.push({ id: uid(), name: s.title, courseId: null, cards: s.cards.map(c => ({ id: uid(), front: c.front, back: c.back })) });
    toast(`Added "${s.title}" to your study tools`);
  }
  touch();
}
function removeSharedItem(groupId, itemId) {
  const g = state.studyGroups.find(x => x.id === groupId);
  g.sharedItems = (g.sharedItems || []).filter(x => x.id !== itemId);
  touch(); renderGroupDetail(g);
  pushGroupToCloud(g);
}

/* ── Share a note or flashcard deck into a group (called from Notebook / Study Tools) ─ */
function openShareToGroupModal(kind, title, payload) {
  if (!state.studyGroups.length) { toast('Join or create a study group first', 'error'); return; }
  window._shareDraft = { kind, title, payload };
  openModal(`
    <div class="modal-head"><h3>Share "${esc(title)}"</h3><button class="close-x" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label>Share to group</label>
        <select class="select" id="share-group">${state.studyGroups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select>
      </div>
      <p class="small muted">Everyone with this group's code will be able to add a copy to their own ${kind === 'note' ? 'notebook' : 'study tools'}.</p>
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
