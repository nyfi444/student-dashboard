/* ── Study Groups: shared notes, decks, files, links ─────────────
   The group's Files tab (tab key 'resources') and sharing into a group
   from notes, flashcards and projects. Loaded after js/groups/sync.js.
──────────────────────────────────────────────────────────────── */
const SHARE_KIND_ICON = { note: 'file-text', deck: 'layers', project: 'folder', 'note-bundle': 'folder-open', file: 'paperclip', link: 'link' };
const SHARE_KIND_LABEL = { note: 'Note', deck: 'Flashcards', project: 'Project', 'note-bundle': 'Notebook', file: 'File', link: 'Link' };
/* ── Resources ─────────────────────────────────────────────────── */
function groupResourcesTab(g) {
  const items = groupItems(g);
  return `
    <div class="sg-toolbar">
      <div class="small muted">Share notes, flashcards, files, and links. Anyone in the group can add their own copy.</div>
      <button class="btn btn-primary btn-sm" onclick="openShareResourceModal('${g.code}')">${icon('plus', 14)} Share something</button>
    </div>
    ${items.length ? items.map(s => groupResourceRow(g, s)).join('') : emptyState(icon('layers', 24), 'Nothing shared yet', `<button class="btn btn-sm mt-8" onclick="openShareResourceModal('${g.code}')">Share the first resource</button>`, 'You can also share straight from any note, notebook, flashcard deck, or project.')}
  `;
}
function resourceUrl(g, s) {
  const url = s.url || s.dataUrl || '';
  if (isHttpUrl(url)) return url;
  return g.local && String(url).startsWith('data:') ? url : '';
}
function groupResourceRow(g, s) {
  const u = myUidFor(g);
  const canRemove = !s.sharedByUid || s.sharedByUid === u || g.createdBy === u;
  const meta = { deck: `${(s.cards || []).length} cards`, 'note-bundle': `${(s.notes || []).length} notes`, project: `${(s.milestones || []).length} milestones`, file: fmtFileSize(s.size), link: hostOf(s.url) }[s.kind] || '';
  const url = resourceUrl(g, s);
  const action = s.kind === 'file' ? (url ? `<a class="btn btn-sm" href="${esc(url)}" target="_blank" rel="noopener" download="${esc(s.fileName || s.title)}">${icon('download', 14)} Open</a>` : '')
    : s.kind === 'link' ? (url ? `<a class="btn btn-sm" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('link', 14)} Open</a>` : '')
    : `<button class="btn btn-sm" onclick="importGroupResource('${g.code}','${s.id}')">${icon('plus', 14)} Add to mine</button>`;
  const kindLabel = s.kind === 'file' ? fileTypeLabel(s.fileName || s.title) : SHARE_KIND_LABEL[s.kind] || 'Item';
  return `
    <div class="list-row sg-resource">
      <span class="sg-res-ic">${icon(SHARE_KIND_ICON[s.kind] || 'file-text', 16)}</span>
      <div class="row-title"><div class="sg-strong">${esc(s.title)}</div><div class="row-meta">${[esc(kindLabel), esc(meta), esc(s.sharedBy || 'Someone'), fmtRelativeTime(s.sharedAt)].filter(Boolean).join(' · ')}</div></div>
      ${action}
      ${canRemove ? `<button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove ${esc(s.title)}" data-tip="Remove" onclick="removeGroupResource('${g.code}','${s.id}')">${icon('trash', 14)}</button>` : ''}
    </div>`;
}
function openShareResourceModal(code) {
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
  renderShareResourceFields();
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
function importGroupResource(code, itemId) {
  const g = findGroup(code);
  const s = groupItems(g).find(x => x.id === itemId);
  if (!s) return;
  if (s.kind === 'note') {
    // Written by another member: sanitized here and again when rendered.
    state.notes.push({ id: uid(), type: 'note', name: String(s.title || 'Shared note').slice(0, 200), parentId: 'root', courseId: null, content: sanitizeHtml(s.content || ''), updatedAt: Date.now() });
    toast(`Added “${s.title}” to your notebook`);
  } else if (s.kind === 'note-bundle') {
    const folderId = uid();
    state.notes.push({ id: folderId, type: 'folder', name: s.title, parentId: 'root', courseId: null, open: true });
    (s.notes || []).forEach(n => state.notes.push({ id: uid(), type: 'note', name: String(n.name || 'Shared note').slice(0, 200), parentId: folderId, courseId: null, content: sanitizeHtml(n.content || ''), updatedAt: Date.now() }));
    toast(`Added “${s.title}” to your notebook`);
  } else if (s.kind === 'deck') {
    state.decks.push({ id: uid(), name: String(s.title || 'Shared deck').slice(0, 200), courseId: null, cards: (s.cards || []).slice(0, 2000).map(c => ({ id: uid(), front: String(c.front || '').slice(0, 2000), back: String(c.back || '').slice(0, 2000) })) });
    toast(`Added “${s.title}” to your flashcards`);
  } else if (s.kind === 'project') {
    state.projects.push({
      id: uid(), title: s.title, courseId: null, dueDate: s.dueDate || '',
      milestones: (s.milestones || []).map(m => ({ ...m, id: uid(), tasks: (m.tasks || []).map(t => ({ ...t, id: uid() })) })),
    });
    toast(`Added “${s.title}” to your projects`);
  }
  touch();
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

