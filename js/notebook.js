/* ── Notebook: Notion-style folders + notes, per-course tagging ──── */
function pageNotebook() {
  const allNotes = state.notes.filter(n => n.type === 'note');
  const selectedId = state.notebookSelected || allNotes[0]?.id;
  const note = state.notes.find(n => n.id === selectedId && n.type === 'note');
  const search = (state._notebookSearch || '').trim().toLowerCase();

  const html = `
    ${pageHead('Notebook', 'Organize notes by class, then turn any note into an AI study guide or flashcards', `
      <button class="btn btn-sm" onclick="createFolder('root')">${icon('folder', 13)} Folder</button>
      <button class="btn btn-primary" onclick="createNote('root')">${icon('plus', 13, 2.2)} Note</button>
    `)}
    <div class="notebook-layout">
      <div class="notebook-tree-panel">
        <div class="notebook-search-wrap">
          <span class="notebook-search-ic">${icon('file-text', 13)}</span>
          <input class="notebook-search" placeholder="Search notes…" value="${esc(state._notebookSearch || '')}" oninput="state._notebookSearch=this.value;touch()">
        </div>
        <div class="notebook-tree">
          ${allNotes.length ? notebookTree('root', 0, search) || `<div class="small muted" style="padding:14px 10px">No notes match “${esc(state._notebookSearch)}”.</div>` : `<div class="small muted" style="padding:14px 10px">No notes yet — create your first one.</div>`}
        </div>
      </div>
      <div class="notebook-page">
        ${note ? renderNoteEditor(note) : `<div class="nb-blank">${allNotes.length
          ? emptyState(icon('book-open', 26, 1.4), 'Select a note from the list.')
          : emptyState(icon('book-open', 26, 1.4), 'Create your first note to get started.', `<button class="btn btn-primary mt-8" onclick="createNote('root')">${icon('plus', 13, 2.2)} New note</button>`)}</div>`}
      </div>
    </div>
    <div class="nb-bubble" id="nb-bubble">
      <button onmousedown="event.preventDefault()" onclick="document.execCommand('bold')" title="Bold"><b>B</b></button>
      <button onmousedown="event.preventDefault()" onclick="document.execCommand('italic')" title="Italic"><i>I</i></button>
      <button onmousedown="event.preventDefault()" onclick="document.execCommand('underline')" title="Underline"><u>U</u></button>
      <span class="nb-bubble-sep"></span>
      <button onmousedown="event.preventDefault()" onclick="document.execCommand('formatBlock',false,'H3')" title="Heading">H3</button>
      <button onmousedown="event.preventDefault()" onclick="document.execCommand('insertUnorderedList')" title="Bulleted list">${icon('clipboard-list', 14)}</button>
      <button onmousedown="event.preventDefault()" onclick="document.execCommand('formatBlock',false,'blockquote')" title="Quote">”</button>
    </div>
  `;
  setTimeout(wireBubbleToolbar, 0);
  return html;
}

function notePath(note) {
  const parts = [];
  let p = state.notes.find(x => x.id === note.parentId);
  while (p && p.id !== 'root') { parts.unshift(p.name); p = state.notes.find(x => x.id === p.parentId); }
  return parts;
}

function wireBubbleToolbar() {
  const editor = $('#note-editor');
  const bar = $('#nb-bubble');
  if (!editor || !bar) return;
  const update = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.anchorNode || !editor.contains(sel.anchorNode)) { bar.style.display = 'none'; return; }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    const barW = bar.offsetWidth || 160, barH = bar.offsetHeight || 34;
    bar.style.left = Math.max(8, rect.left + rect.width / 2 - barW / 2) + 'px';
    bar.style.top = Math.max(8, rect.top - barH - 8) + 'px';
  };
  if (window._nbBubbleUpdate) document.removeEventListener('selectionchange', window._nbBubbleUpdate);
  window._nbBubbleUpdate = update;
  document.addEventListener('selectionchange', update);
}

function notebookTree(parentId, depth, search) {
  const children = state.notes.filter(n => n.parentId === parentId);
  const rows = children.map(n => {
    if (n.type === 'folder') {
      const inner = notebookTree(n.id, depth + 1, search);
      if (search && !inner) return '';
      const forceOpen = !!search;
      const count = state.notes.filter(x => x.type === 'note' && x.parentId === n.id).length;
      return `<div class="nb-branch">
        <div class="nb-folder-row" onclick="toggleFolder('${n.id}')">
          <span class="nb-chevron ${n.open || forceOpen ? 'open' : ''}">${icon('chevron-right', 12, 2.4)}</span>
          <span class="flex-gap">${icon(n.open || forceOpen ? 'folder-open' : 'folder', 14)}</span>
          <span class="nb-folder-name">${esc(n.name)}</span>
          ${count ? `<span class="nb-count">${count}</span>` : ''}
          <button class="btn btn-ghost btn-icon btn-sm" onclick="event.stopPropagation();createNote('${n.id}')" title="New note">${icon('plus', 13, 2.2)}</button>
          ${n.id !== 'root' ? `<button class="btn btn-ghost btn-icon btn-sm" onclick="event.stopPropagation();deleteNoteItem('${n.id}')">${icon('trash', 14)}</button>` : ''}
        </div>
        ${(n.open || forceOpen) ? `<div class="nb-children">${inner}</div>` : ''}
      </div>`;
    }
    if (search && !n.name.toLowerCase().includes(search)) return '';
    const selected = n.id === (state.notebookSelected || state.notes.find(x => x.type === 'note')?.id);
    return `<div class="nb-note-row ${selected ? 'selected' : ''}" onclick="selectNote('${n.id}')">
      <span class="nb-note-ic">${icon('file-text', 14)}</span>
      <div class="nb-note-meta">
        <div class="nb-note-title">${esc(n.name)}</div>
        <div class="nb-note-sub">${n.courseId ? `<span class="pill-dot" style="background:${getCourseColor(n.courseId)}"></span>${esc(getCourse(n.courseId)?.code || '')} · ` : ''}${fmtRelativeTime(n.updatedAt)}</div>
      </div>
      <button class="btn btn-ghost btn-icon btn-sm nb-note-del" onclick="event.stopPropagation();deleteNoteItem('${n.id}')">${icon('trash', 14)}</button>
    </div>`;
  });
  return rows.join('');
}
function toggleFolder(id) { const f = state.notes.find(n => n.id === id); f.open = !f.open; touch(); }
function selectNote(id) { setState({ notebookSelected: id }); }
function createFolder(parentId) {
  const name = prompt('Folder name?'); if (!name) return;
  state.notes.push({ id: uid(), type: 'folder', name, parentId, courseId: null, open: true });
  touch();
}
function createNote(parentId) {
  const id = uid();
  state.notes.push({ id, type: 'note', name: 'Untitled note', parentId, courseId: null, content: '', updatedAt: Date.now() });
  setState({ notebookSelected: id });
}
function deleteNoteItem(id) {
  confirmDialog('Delete this? Folders delete everything inside them.', () => {
    const toDelete = new Set([id]);
    let grew = true;
    while (grew) { grew = false; state.notes.forEach(n => { if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.id)) { toDelete.add(n.id); grew = true; } }); }
    state.notes = state.notes.filter(n => !toDelete.has(n.id));
    if (toDelete.has(state.notebookSelected)) state.notebookSelected = null;
    touch();
  });
}
function renderNoteEditor(note) {
  const words = plainTextOfNote(note).trim().split(/\s+/).filter(Boolean).length;
  const crumbs = notePath(note);
  const iconColor = note.courseId ? getCourseColor(note.courseId) : 'var(--text-faint)';
  return `
    <div class="nb-page-inner">
      ${crumbs.length ? `<div class="nb-breadcrumb">Notebook<span class="nb-crumb-sep">/</span>${crumbs.map(c => `${esc(c)}<span class="nb-crumb-sep">/</span>`).join('')}</div>` : `<div class="nb-breadcrumb">Notebook</div>`}
      <div class="nb-icon-avatar" style="background:${iconColor}18;color:${iconColor}">${icon('file-text', 20, 1.6)}</div>
      <input class="nb-title-input" value="${esc(note.name)}" placeholder="Untitled" oninput="renameNote('${note.id}',this.value)">
      <div class="nb-meta-row">
        <div class="flex-gap">
          <select class="select nb-course-select" onchange="setNoteCourse('${note.id}',this.value)">
            <option value="">No course</option>${activeCourses().map(c => `<option value="${c.id}" ${c.id === note.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
          <span class="small muted">Edited ${fmtRelativeTime(note.updatedAt) || 'now'} · ${words} word${words === 1 ? '' : 's'}</span>
        </div>
        <div class="flex-gap">
          ${aiButton('Study guide', `generateStudyGuideFromNote('${note.id}')`, 'sg-btn')}
          ${aiButton('Flashcards', `generateFlashcardsFromNote('${note.id}')`, 'fc-btn')}
        </div>
      </div>
      <div class="nb-hint">Select text for formatting options</div>
      <div class="rich-editor nb-editor-body" id="note-editor" contenteditable="true" data-placeholder="Start writing…" oninput="saveNoteContentDebounced('${note.id}', this.innerHTML)">${note.content || ''}</div>
    </div>
  `;
}
function renameNote(id, name) { const n = state.notes.find(x => x.id === id); n.name = name; save(); }
function setNoteCourse(id, courseId) { const n = state.notes.find(x => x.id === id); n.courseId = courseId || null; touch(); }
const saveNoteContentDebounced = debounce((id, html) => { const n = state.notes.find(x => x.id === id); n.content = html; n.updatedAt = Date.now(); save(); }, 500);

function plainTextOfNote(note) { const d = document.createElement('div'); d.innerHTML = note.content || ''; return d.textContent || ''; }

async function generateStudyGuideFromNote(id) {
  const note = state.notes.find(x => x.id === id);
  const text = plainTextOfNote(note);
  if (!text.trim()) { toast('This note is empty', 'error'); return; }
  const btn = $('#sg-btn');
  setBtnLoading(btn, true);
  try {
    const html = await aiGenerateStudyGuide(text, getCourse(note.courseId)?.name);
    const newId = uid();
    state.notes.push({ id: newId, type: 'note', name: note.name + ' — Study Guide', parentId: note.parentId, courseId: note.courseId, content: html, updatedAt: Date.now() });
    setState({ notebookSelected: newId });
    toast('Study guide created');
  } catch (e) { toast(e.message || 'Could not generate a study guide', 'error', 4000); }
  finally { setBtnLoading(btn, false); }
}
async function generateFlashcardsFromNote(id) {
  const note = state.notes.find(x => x.id === id);
  const text = plainTextOfNote(note);
  if (!text.trim()) { toast('This note is empty', 'error'); return; }
  const btn = $('#fc-btn');
  setBtnLoading(btn, true);
  try {
    const cards = await aiGenerateFlashcards(text, 12);
    state.decks.push({ id: uid(), name: note.name, courseId: note.courseId, cards: cards.map(c => ({ id: uid(), front: c.front, back: c.back })) });
    touch();
    toast(`Created a deck with ${cards.length} cards — see Study Tools`);
  } catch (e) { toast(e.message || 'Could not generate flashcards', 'error', 4000); }
  finally { setBtnLoading(btn, false); }
}
