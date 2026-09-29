/* ── Study Groups: shared notes, decks, files, links ─────────────
   The group's Files tab (tab key 'resources') and sharing into a group
   from notes, flashcards and projects. Loaded after js/groups/sync.js.
──────────────────────────────────────────────────────────────── */
const SHARE_KIND_ICON = { note: 'file-text', deck: 'layers', project: 'folder', 'note-bundle': 'folder-open', file: 'paperclip', link: 'link' };
const SHARE_KIND_LABEL = { note: 'Note', deck: 'Flashcards', project: 'Project', 'note-bundle': 'Notebook', file: 'File', link: 'Link' };
/* ── Resources: the Files tab, drawn by spaceLibrary (js/spaces/files.js) ── */
function groupResourcesTab(g) { return spaceLibrary('group', g); }
function resourceUrl(g, s) {
  const url = s.url || s.dataUrl || '';
  if (isHttpUrl(url)) return url;
  return g.local && String(url).startsWith('data:') ? url : '';
}
// The library's item model (see js/spaces/files.js) from the group's items.
function groupLibItems(g) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  return groupItems(g).filter(s => LIB_CHIP_OF[s.kind]).map(s => ({
    id: s.id, kind: s.kind, title: String(s.title || LIB_KIND_LABEL[s.kind] || 'Untitled').slice(0, 200),
    by: String(s.sharedBy || 'Someone').slice(0, 60), at: Number(s.sharedAt) || 0,
    url: s.kind === 'file' || s.kind === 'link' ? resourceUrl(g, s) : '',
    fileName: typeof s.fileName === 'string' ? s.fileName : '', size: Number(s.size) || 0,
    html: typeof s.content === 'string' ? s.content : '',
    notes: arr(s.notes).filter(n => n && typeof n === 'object'), cards: arr(s.cards).filter(c => c && typeof c === 'object'),
    milestones: arr(s.milestones).filter(m => m && typeof m === 'object'), dueDate: typeof s.dueDate === 'string' ? s.dueDate : '',
    pinned: false,
  }));
}
function groupCanRemoveItem(g, s) {
  const u = myUidFor(g);
  return !s.sharedByUid || s.sharedByUid === u || g.createdBy === u;
}
// Where "Add to mine" puts each kind, and whether a copy is already there:
// a deck, note, notebook folder or project with the same title (trimmed,
// lowercased, 200 characters, as importGroupResource stores it).
const MINE_WHERE = { deck: 'Flashcards', note: 'Notebook', 'note-bundle': 'Notebook', project: 'Projects' };
function myPlannerCopy(s) {
  const t = libTitleKey(s.title);
  if (!t) return null;
  if (s.kind === 'deck') return (state.decks || []).find(d => libTitleKey(d.name) === t) || null;
  if (s.kind === 'note') return (state.notes || []).find(n => n.type === 'note' && libTitleKey(n.name) === t) || null;
  if (s.kind === 'note-bundle') return (state.notes || []).find(n => n.type === 'folder' && libTitleKey(n.name) === t) || null;
  if (s.kind === 'project') return (state.projects || []).find(p => libTitleKey(p.title) === t) || null;
  return null;
}
function inMyPlanner(s) { return myPlannerCopy(s) ? MINE_WHERE[s.kind] : ''; }
// Opens the planner copy (or the place it went): the Open on the toast and
// in the detail sheet.
function openMyCopy(kind, id) {
  if (kind === 'deck') { navTo('studytools'); return; }
  if (kind === 'project') { if (id && typeof openProject === 'function') openProject(id); else navTo('projects'); return; }
  if (kind === 'note-bundle') { const first = (state.notes || []).find(n => n.type === 'note' && n.parentId === id); setState({ route: 'notebook', subRoute: null, ...(first ? { notebookSelected: first.id } : {}) }); return; }
  setState({ route: 'notebook', subRoute: null, ...(id ? { notebookSelected: id } : {}) });
}
function openGroupItemCopy(code, itemId) {
  const s = groupItems(findGroup(code) || {}).find(x => x.id === itemId);
  if (!s) return;
  openMyCopy(s.kind, myPlannerCopy(s)?.id);
}
function groupLibPrimary(g, it, sheet) {
  const size = sheet ? '' : ' btn-sm';
  const is = sheet ? 16 : 14;
  if (it.kind === 'file') return it.url ? `<a class="btn${sheet ? ' btn-primary' : ''}${size}" href="${esc(it.url)}" target="_blank" rel="noopener" download="${esc(it.fileName || it.title)}">${icon('download', is)}Open</a>` : '';
  if (it.kind === 'link') return it.url ? `<a class="btn${sheet ? ' btn-primary' : ''}${size}" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">${icon('arrow-up-right', is)}Open</a>` : '';
  const where = inMyPlanner(it);
  if (where) {
    return sheet
      ? `<button type="button" class="btn btn-primary" onclick="closeModal();openGroupItemCopy('${g.code}','${it.id}')">Open in ${where}</button>`
      : `<span class="lib-in-mine">${icon('check', 14)}In your ${where}</span>`;
  }
  return `<button type="button" class="btn${sheet ? ' btn-primary' : ''}${size}" onclick="${sheet ? 'closeModal();' : ''}importGroupResource('${g.code}','${it.id}')">${icon('plus', is)}Add to mine</button>`;
}
function groupLibMore(g, it) {
  const out = [];
  if (MINE_WHERE[it.kind] && inMyPlanner(it)) out.push({ label: 'Add another copy', icon: 'plus', js: `importGroupResource('${g.code}','${it.id}')` });
  const s = groupItems(g).find(x => x.id === it.id);
  if (s && groupCanRemoveItem(g, s)) out.push({ label: 'Remove from group', icon: 'trash', js: `removeGroupResource('${g.code}','${it.id}')`, danger: true });
  return out;
}
// Nothing shared yet: point at the next session when there is one.
function groupLibEmpty(g) {
  const next = typeof upcomingSessions === 'function' ? upcomingSessions(g)[0] : null;
  let lead = 'Drop your lecture notes, a practice exam, or the link everyone keeps asking for.';
  if (next) {
    const n = daysBetween(next.date);
    const day = n === 0 ? 'today' : n === 1 ? 'tomorrow' : n < 7 ? fmtDate(next.date, { weekday: 'long' }) : '';
    const what = /review/i.test(next.title || '') ? 'review' : 'session';
    if (day) lead = `Drop your lecture notes before ${day}’s ${what}.`;
  }
  return {
    icon: 'layers', title: 'Nothing shared yet',
    body: `${lead} Notes, flashcards, files and links all live here.`,
    actions: [
      { label: 'Upload a file', icon: 'upload', onclick: `openShareResourceModal('${g.code}','file')`, primary: true },
      { label: 'Add a link', icon: 'link', onclick: `openShareResourceModal('${g.code}','link')`, primary: false },
    ],
    extra: `<button type="button" class="sg-link" onclick="openShareResourceModal('${g.code}')">Or share a note, deck or project ${icon('chevron-right', 12)}</button>`,
  };
}
// kind (optional): open with 'file' or 'link' already picked.
function openShareResourceModal(code, kind) {
  const g = findGroup(code);
  if (!g) return;
  window._shareResource = { code, file: null };
  openModal(`
    <div class="modal-head"><h3>Share with ${esc(g.name)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body">
      <div class="field"><label for="sr-kind">What are you sharing?</label>
        <select class="select" id="sr-kind" onchange="renderShareResourceFields()">
          <option value="note-bundle">A notebook (folder of notes)</option>
          <option value="note">A single note</option>
          <option value="deck">A flashcard deck</option>
          <option value="project">A project</option>
          <option value="file">A file (PDF, doc, image…)</option>
          <option value="link">A link</option>
        </select>
      </div>
      <div id="sr-fields"></div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="sr-share-btn" onclick="confirmShareResource()">Share</button></div>
  `);
  if (kind && $('#sr-kind')) $('#sr-kind').value = kind;
  renderShareResourceFields();
  if (kind === 'link') setTimeout(() => $('#sr-link-url')?.focus(), 30);
}
function renderShareResourceFields() {
  const kind = $('#sr-kind').value;
  const field = $('#sr-fields');
  const g = findGroup(window._shareResource.code);
  window._shareResource.file = null;
  if (kind === 'file') {
    const max = g.local ? GROUP_FILE_MAX_BYTES_LOCAL : GROUP_FILE_MAX_BYTES_CLOUD;
    field.innerHTML = `<div class="field"><label>File</label>
      <div class="upload-drop" onclick="$('#sr-file-input').click()">
        <div class="small" id="sr-file-status">Click to choose a file (up to ${fmtFileSize(max)})</div>
        <input type="file" id="sr-file-input" style="display:none" onchange="handleShareResourceFile(this.files[0])">
      </div></div>`;
    return;
  }
  if (kind === 'link') {
    field.innerHTML = `
      <div class="field"><label for="sr-link-url">Link</label><input class="input" id="sr-link-url" type="url" placeholder="https://…"></div>
      <div class="field"><label for="sr-link-title">Title</label><input class="input" id="sr-link-title" maxlength="120" placeholder="Practice exam, shared Drive folder…"></div>`;
    return;
  }
  const items = kind === 'note-bundle' ? foldersWithNotes() : kind === 'note' ? state.notes.filter(n => n.type === 'note') : kind === 'deck' ? state.decks : state.projects;
  const label = { 'note-bundle': 'notebooks with notes in them', note: 'notes', deck: 'flashcard decks', project: 'projects' }[kind];
  field.innerHTML = items.length
    ? `<div class="field"><label for="sr-item">Choose one</label><select class="select" id="sr-item">${items.map(it => `<option value="${it.id}">${esc(it.name || it.title || 'Untitled')}</option>`).join('')}</select></div>
       <p class="small muted">Members get a copy they can add to their own planner. Later edits to yours won’t change theirs.</p>`
    : `<p class="small muted">You don’t have any ${label} yet.</p>`;
}
async function handleShareResourceFile(file) {
  if (!file) return;
  const g = findGroup(window._shareResource.code);
  const max = g.local ? GROUP_FILE_MAX_BYTES_LOCAL : GROUP_FILE_MAX_BYTES_CLOUD;
  const status = $('#sr-file-status');
  if (file.size > max) { status.textContent = `That file is ${fmtFileSize(file.size)}. The limit is ${fmtFileSize(max)}.`; window._shareResource.file = null; return; }
  status.textContent = 'Reading…';
  const dataUrl = 'data:' + mimeForFile(file.name, file.type) + ';base64,' + (await fileToBase64(file));
  window._shareResource.file = { name: file.name, size: file.size, dataUrl };
  status.textContent = `${file.name} (${fmtFileSize(file.size)}) is ready to share`;
}
function buildSharePayload(kind, itemId) {
  if (kind === 'note-bundle') {
    const folder = state.notes.find(x => x.id === itemId);
    const notes = state.notes.filter(n => n.type === 'note' && n.parentId === itemId);
    return { title: folder?.name || 'Notebook', notes: notes.map(n => ({ name: n.name, content: n.content || '' })) };
  }
  if (kind === 'note') { const n = state.notes.find(x => x.id === itemId); return { title: n?.name || 'Note', content: n?.content || '' }; }
  if (kind === 'deck') { const d = state.decks.find(x => x.id === itemId); return { title: d?.name || 'Flashcards', cards: (d?.cards || []).map(c => ({ front: c.front, back: c.back })) }; }
  const p = state.projects.find(x => x.id === itemId);
  return { title: p?.title || 'Project', dueDate: p?.dueDate || '', milestones: JSON.parse(JSON.stringify(p?.milestones || [])) };
}
async function confirmShareResource() {
  const st = window._shareResource;
  const { code, file } = st;
  // The duplicate question below replaces this modal, so the picked kind is
  // stashed and read back from there once the form is gone.
  if ($('#sr-kind')) st.kind = $('#sr-kind').value;
  const kind = st.kind;
  let item;
  if (kind === 'file') {
    if (!file) { toast('Choose a file first', 'error'); return; }
    // The group already has a file with this name: ask before adding a second
    // copy everyone has to tell apart (see askAboutDuplicateFile).
    const existing = st.dupOk ? null : findFileByName(groupItems(findGroup(code)), file.name);
    if (existing) {
      askAboutDuplicateFile(file.name, 'shared with this group', { onKeepBoth: () => { st.dupOk = true; confirmShareResource(); } });
      return;
    }
    item = { kind, title: file.name, fileName: file.name, size: file.size, dataUrl: file.dataUrl };
  } else if (kind === 'link') {
    const url = $('#sr-link-url').value.trim();
    if (!isHttpUrl(url)) { toast('Enter a full link starting with https://', 'error'); return; }
    item = { kind, title: $('#sr-link-title').value.trim() || hostOf(url) || 'Link', url };
  } else {
    const itemId = $('#sr-item')?.value;
    if (!itemId) { toast('Nothing to share yet', 'error'); return; }
    item = { kind, ...buildSharePayload(kind, itemId) };
  }
  const btn = $('#sr-share-btn');
  setBtnLoading(btn, true);
  const ok = await addGroupItem(code, item);
  setBtnLoading(btn, false, 'Share');
  if (ok) { closeModal(); toast(`Shared “${item.title}”`); }
}
async function addGroupItem(code, raw) {
  const entry = groupEntry(code);
  if (!entry) return false;
  const g = groupView(entry);
  const item = { id: uid(), ...raw, sharedBy: myGroupName(), sharedByUid: myUidFor(g), sharedAt: Date.now() };
  if (entry.local) {
    entry.items = [item, ...(entry.items || [])];
    touch();
    return true;
  }
  if (!cloudGroupsEnabled()) { toast('Log in to share with this group.', 'error'); return false; }
  try { await addCloudGroupItem(code, item); return true; }
  catch (e) { if (!e.message?.startsWith('That’s too large')) diag.error('studygroups', 'Share to group failed', e); toast(e.message?.startsWith('That’s too large') ? e.message : 'Couldn’t share that. Check your connection and try again.', 'error', 5000); return false; }
}
// Copies a shared note, notebook, deck or project into your planner, then
// says where it went, with an Open on the toast. Returns the new id.
function importGroupResource(code, itemId) {
  const g = findGroup(code);
  const s = groupItems(g).find(x => x.id === itemId);
  if (!s) return null;
  let newId = null;
  if (s.kind === 'note') {
    // Written by another member: sanitized here and again when rendered.
    newId = uid();
    state.notes.push({ id: newId, type: 'note', name: String(s.title || 'Shared note').slice(0, 200), parentId: 'root', courseId: null, content: sanitizeHtml(s.content || ''), updatedAt: Date.now() });
  } else if (s.kind === 'note-bundle') {
    newId = uid();
    state.notes.push({ id: newId, type: 'folder', name: String(s.title || 'Shared notebook').slice(0, 200), parentId: 'root', courseId: null, open: true });
    (s.notes || []).forEach(n => state.notes.push({ id: uid(), type: 'note', name: String(n.name || 'Shared note').slice(0, 200), parentId: newId, courseId: null, content: sanitizeHtml(n.content || ''), updatedAt: Date.now() }));
  } else if (s.kind === 'deck') {
    newId = uid();
    state.decks.push({ id: newId, name: String(s.title || 'Shared deck').slice(0, 200), courseId: null, cards: (s.cards || []).slice(0, 2000).map(c => ({ id: uid(), front: String(c.front || '').slice(0, 2000), back: String(c.back || '').slice(0, 2000) })) });
  } else if (s.kind === 'project') {
    newId = uid();
    state.projects.push({
      id: newId, title: String(s.title || 'Shared project').slice(0, 200), courseId: null, dueDate: s.dueDate || '',
      milestones: (s.milestones || []).map(m => ({ ...m, id: uid(), tasks: (m.tasks || []).map(t => ({ ...t, id: uid() })) })),
    });
  }
  if (!newId) return null;
  const kind = s.kind;
  toast(`Added to your ${MINE_WHERE[kind]}`, 'success', 5000, { label: 'Open', run: () => openMyCopy(kind, newId) });
  touch();
  return newId;
}
function removeGroupResource(code, itemId) {
  confirmDialog('Remove this from the group? Copies people already added stay in their planners.', async () => {
    const entry = groupEntry(code);
    if (entry.local) { entry.items = (entry.items || []).filter(x => x.id !== itemId); touch(); return; }
    const item = (_groupItems[code] || []).find(x => x.id === itemId);
    try {
      await _fbDb.collection('studyGroups').doc(code).collection('items').doc(itemId).delete();
      if (item?.kind === 'file' && String(item.url || '').includes('firebasestorage')) fbStorage().then(st => st.refFromURL(item.url).delete()).catch(() => {});
    } catch (e) { toast('Couldn’t remove that: ' + e.message, 'error'); }
  }, 'Remove');
}
// Entry point for the Share buttons on notes, notebooks, decks, and projects.
function openShareToGroupModal(kind, title, payload) {
  const groups = allGroups().filter(g => !g.loading);
  if (!groups.length) {
    confirmDialog('You’re not in any study groups yet. Start one to share this with classmates?', () => { setState({ route: 'studygroups', subRoute: null }); openCreateGroupModal(); }, 'Start a group');
    return;
  }
  window._shareDraft = { kind, title, payload };
  openModal(`
    <div class="modal-head"><h3>Share “${esc(title)}”</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body">
      <div class="field"><label for="share-group">Share to group</label>
        <select class="select" id="share-group">${groups.map(g => `<option value="${g.code}">${esc(g.name)}</option>`).join('')}</select>
      </div>
      <p class="small muted">Everyone in the group can add a copy to their own ${kind === 'note' || kind === 'note-bundle' ? 'notebook' : kind === 'project' ? 'projects' : 'flashcards'}.</p>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="share-group-btn" onclick="confirmShareToGroup()">Share</button></div>
  `);
}
async function confirmShareToGroup() {
  const code = $('#share-group').value;
  const { kind, title, payload } = window._shareDraft;
  const btn = $('#share-group-btn');
  setBtnLoading(btn, true);
  const ok = await addGroupItem(code, { kind, title, ...payload });
  setBtnLoading(btn, false, 'Share');
  if (ok) { closeModal(); toast(`Shared with ${findGroup(code)?.name || 'your group'}`); }
}

/* ── Sample group (local only): enough in Files to show the library ──
   p: { maya, priya, jordan, hana, diego } sample uids. Called from
   createSampleGroup; never written to a cloud group. */
function sampleGroupLibraryItems(p, now) {
  const H = 3600000, D = 24 * H, t = todayIso();
  const out = [];
  const pdf = libSamplePdf('BIO 201 Practice exam 2 (last spring)', [
    '1. Name the three stages of cell signaling and give one example of each.',
    '2. Why can one ligand trigger thousands of responses inside a cell?',
    '3. Sketch a G protein cycle. Where does GTP come in?',
    '4. Compare a kinase and a phosphatase in one sentence each.',
    '5. What does cAMP do, and what turns it off?',
  ]);
  out.push({ id: uid(), kind: 'file', title: 'Practice exam 2 (last spring).pdf', fileName: 'Practice exam 2 (last spring).pdf', size: pdf.size, dataUrl: pdf.dataUrl, sharedBy: 'Maya', sharedByUid: p.maya, sharedAt: now - 3 * D - 2 * H });
  const board = libSampleImage(400, 180, (c, w, h) => {
    c.fillStyle = '#f7f6f2'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#2b4c9a'; c.fillStyle = '#2b4c9a'; c.lineWidth = 3; c.lineCap = 'round';
    c.font = '26px "Instrument Serif", Georgia, serif';
    c.fillText('Signal transduction', 24, 44);
    const box = (x, y, label) => {
      c.beginPath();
      if (c.roundRect) c.roundRect(x, y, 108, 48, 10); else c.rect(x, y, 108, 48);
      c.stroke();
      c.font = '600 14px "General Sans", system-ui, sans-serif';
      c.fillText(label, x + 54 - c.measureText(label).width / 2, y + 29);
    };
    box(16, 70, 'Reception'); box(146, 70, 'Transduction'); box(276, 70, 'Response');
    [[126, 144], [256, 274]].forEach(([a, b]) => { c.beginPath(); c.moveTo(a, 94); c.lineTo(b, 94); c.moveTo(b - 6, 89); c.lineTo(b, 94); c.lineTo(b - 6, 99); c.stroke(); });
    c.strokeStyle = '#b8452f'; c.fillStyle = '#b8452f';
    c.font = '600 13px "General Sans", system-ui, sans-serif';
    c.beginPath(); c.moveTo(200, 122); c.lineTo(200, 138); c.stroke();
    c.fillText('cAMP and kinases amplify it', 124, 156);
  });
  if (board) out.push({ id: uid(), kind: 'file', title: 'Whiteboard, signaling cascade.jpg', fileName: 'Whiteboard, signaling cascade.jpg', size: board.size, dataUrl: board.dataUrl, sharedBy: 'Jordan', sharedByUid: p.jordan, sharedAt: now - 6 * D - 3 * H });
  out.push({ id: uid(), kind: 'link', title: 'OpenStax Biology, chapter 9', url: 'https://openstax.org/books/biology-2e/pages/9-introduction', sharedBy: 'Hana', sharedByUid: p.hana, sharedAt: now - 20 * H });
  out.push({ id: uid(), kind: 'note-bundle', title: 'Unit 3 notes', sharedBy: 'Diego', sharedByUid: p.diego, sharedAt: now - 9 * D, notes: [
    { name: 'Membrane transport', content: '<p>Passive: diffusion, facilitated diffusion, osmosis. Active: pumps use ATP.</p><p>Na+/K+ pump moves 3 Na+ out, 2 K+ in.</p>' },
    { name: 'Receptors', content: '<p>Intracellular receptors bind hydrophobic ligands like steroids.</p>' },
    { name: 'Second messengers', content: '<p>cAMP, Ca2+, IP3 and DAG relay the signal inside the cell.</p>' },
  ] });
  out.push({ id: uid(), kind: 'project', title: 'Enzyme lab report', sharedBy: 'Priya', sharedByUid: p.priya, sharedAt: now - 4 * D, dueDate: addDays(t, 12), milestones: [
    { id: uid(), title: 'Outline and hypothesis', dueDate: addDays(t, -2), done: true, tasks: [] },
    { id: uid(), title: 'Data tables and graphs', dueDate: addDays(t, 4), done: false, tasks: [{ id: uid(), title: 'Rate vs temperature', done: false }, { id: uid(), title: 'Rate vs pH', done: false }] },
    { id: uid(), title: 'Discussion draft', dueDate: addDays(t, 9), done: false, tasks: [] },
  ] });
  return out;
}
