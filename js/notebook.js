/* ── Notebook: Notion-style folders + notes, per-course tagging ──── */
const SLASH_COMMANDS = [
  { key: 'text', label: 'Text', desc: 'Plain paragraph', glyph: '¶', run: () => document.execCommand('formatBlock', false, 'P') },
  { key: 'h1', label: 'Heading 1', desc: 'Big section heading', glyph: 'H1', run: () => document.execCommand('formatBlock', false, 'H1') },
  { key: 'h2', label: 'Heading 2', desc: 'Medium heading', glyph: 'H2', run: () => document.execCommand('formatBlock', false, 'H2') },
  { key: 'h3', label: 'Heading 3', desc: 'Small heading', glyph: 'H3', run: () => document.execCommand('formatBlock', false, 'H3') },
  { key: 'bullet', label: 'Bulleted list', desc: 'Simple bullet list', glyph: '•', run: () => document.execCommand('insertUnorderedList') },
  { key: 'number', label: 'Numbered list', desc: 'List with numbers', glyph: '1.', run: () => document.execCommand('insertOrderedList') },
  { key: 'todo', label: 'To-do checklist', desc: 'Track tasks with checkboxes', glyph: '☑', run: () => document.execCommand('insertHTML', false, '<div class="nb-todo-line"><input type="checkbox">&nbsp;</div>') },
  { key: 'quote', label: 'Quote', desc: 'Callout quote block', glyph: '”', run: () => document.execCommand('formatBlock', false, 'BLOCKQUOTE') },
  { key: 'divider', label: 'Divider', desc: 'Visual line break', glyph: '—', run: () => document.execCommand('insertHTML', false, '<hr><p><br></p>') },
  { key: 'code', label: 'Code block', desc: 'Monospace snippet', glyph: '</>', run: () => document.execCommand('formatBlock', false, 'PRE') },
];

function pageNotebook() {
  const allNotes = state.notes.filter(n => n.type === 'note');
  const selectedId = state.notebookSelected || allNotes[0]?.id;
  const note = state.notes.find(n => n.id === selectedId && n.type === 'note');
  const search = (state._notebookSearch || '').trim().toLowerCase();
  const sort = state._notebookSort || 'edited';

  const html = `
    ${pageHead('Notebook', 'Organize notes by class, then turn any note into an AI study guide or flashcards', `
      <button class="btn btn-sm" onclick="createFolder('root')">${icon('folder', 13)} Folder</button>
      <button class="btn btn-primary" onclick="createNote('root')">${icon('plus', 13, 2.2)} Note</button>
    `)}
    <div class="notebook-layout">
      <div class="notebook-tree-panel">
        <div class="notebook-search-wrap">
          <span class="notebook-search-ic">${icon('file-text', 13)}</span>
          <input class="notebook-search" placeholder="Search notes & content…" value="${esc(state._notebookSearch || '')}" oninput="state._notebookSearch=this.value;touch()">
        </div>
        <div class="nb-sort-row">
          <span class="small muted">Sort</span>
          <div class="segmented">
            <button class="${sort === 'edited' ? 'active' : ''}" onclick="state._notebookSort='edited';touch()">Edited</button>
            <button class="${sort === 'alpha' ? 'active' : ''}" onclick="state._notebookSort='alpha';touch()">A–Z</button>
          </div>
        </div>
        <div class="notebook-tree">
          ${allNotes.length ? notebookTree('root', 0, search, sort) || `<div class="small muted" style="padding:14px 10px">No notes match “${esc(state._notebookSearch)}”.</div>` : `<div class="small muted" style="padding:14px 10px">No notes yet — create your first one.</div>`}
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
      <button onmousedown="event.preventDefault()" onclick="document.execCommand('strikeThrough')" title="Strikethrough"><s>S</s></button>
      <button onmousedown="event.preventDefault()" onclick="document.execCommand('formatBlock',false,'PRE')" title="Code">${'</>'}</button>
      <span class="nb-bubble-sep"></span>
      <button onmousedown="event.preventDefault()" onclick="document.execCommand('formatBlock',false,'H3')" title="Heading">H3</button>
      <button onmousedown="event.preventDefault()" onclick="document.execCommand('insertUnorderedList')" title="Bulleted list">${icon('clipboard-list', 14)}</button>
      <button onmousedown="event.preventDefault()" onclick="document.execCommand('formatBlock',false,'blockquote')" title="Quote">”</button>
      <span class="nb-bubble-sep"></span>
      <button onmousedown="event.preventDefault()" onclick="promptInsertLink()" title="Link">${icon('map-pin', 13)}</button>
    </div>
    <div class="nb-slash-menu" id="nb-slash-menu">
      ${SLASH_COMMANDS.map(c => `<div class="nb-slash-item" data-key="${c.key}" onmousedown="event.preventDefault()" onclick="runSlashCommand('${c.key}')"><span class="nb-slash-glyph">${c.glyph}</span><span><div class="nb-slash-label">${c.label}</div><div class="nb-slash-desc">${c.desc}</div></span></div>`).join('')}
    </div>
  `;
  setTimeout(() => { wireBubbleToolbar(); wireSlashMenu(); }, 0);
  return html;
}

function notePath(note) {
  const parts = [];
  let p = state.notes.find(x => x.id === note.parentId);
  while (p && p.id !== 'root') { parts.unshift(p.name); p = state.notes.find(x => x.id === p.parentId); }
  return parts;
}
function allFolders() {
  const list = [];
  const walk = (parentId, depth) => {
    state.notes.filter(n => n.type === 'folder' && n.parentId === parentId).forEach(f => { list.push({ id: f.id, name: f.name, depth }); walk(f.id, depth + 1); });
  };
  list.push({ id: 'root', name: 'Notebook (top level)', depth: 0 });
  walk('root', 1);
  return list;
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
    const barW = bar.offsetWidth || 220, barH = bar.offsetHeight || 34;
    bar.style.left = Math.max(8, rect.left + rect.width / 2 - barW / 2) + 'px';
    bar.style.top = Math.max(8, rect.top - barH - 8) + 'px';
  };
  if (window._nbBubbleUpdate) document.removeEventListener('selectionchange', window._nbBubbleUpdate);
  window._nbBubbleUpdate = update;
  document.addEventListener('selectionchange', update);
}
function promptInsertLink() {
  const url = prompt('Link URL?');
  if (url) document.execCommand('createLink', false, url);
}

/* ── Slash-command block menu ─────────────────────────────────── */
function wireSlashMenu() {
  const editor = $('#note-editor');
  const menu = $('#nb-slash-menu');
  if (!editor || !menu) return;
  const check = () => {
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || !sel.anchorNode || !editor.contains(sel.anchorNode)) { hideSlashMenu(); return; }
    let node = sel.anchorNode;
    let block = node.nodeType === 3 ? node.parentElement : node;
    while (block && block !== editor && !/^(P|DIV|H1|H2|H3|LI|BLOCKQUOTE)$/.test(block.tagName)) block = block.parentElement;
    if (!block) { hideSlashMenu(); return; }
    const text = block.textContent || '';
    if (text[0] === '/' && !text.includes(' ')) {
      window._slashBlock = block;
      const query = text.slice(1).toLowerCase();
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      showSlashMenu(rect, query);
    } else {
      hideSlashMenu();
    }
  };
  if (window._nbSlashCheck) editor.removeEventListener('input', window._nbSlashCheck);
  window._nbSlashCheck = check;
  editor.addEventListener('input', check);
  if (window._nbSlashKeydown) editor.removeEventListener('keydown', window._nbSlashKeydown);
  window._nbSlashKeydown = (e) => { if (e.key === 'Escape') hideSlashMenu(); };
  editor.addEventListener('keydown', window._nbSlashKeydown);
}
function showSlashMenu(rect, query) {
  const menu = $('#nb-slash-menu');
  $$('.nb-slash-item', menu).forEach(el => { el.style.display = !query || el.dataset.key.includes(query) || el.querySelector('.nb-slash-label').textContent.toLowerCase().includes(query) ? 'flex' : 'none'; });
  menu.style.display = 'block';
  menu.style.left = Math.max(8, rect.left) + 'px';
  menu.style.top = (rect.bottom + 6) + 'px';
}
function hideSlashMenu() { const m = $('#nb-slash-menu'); if (m) m.style.display = 'none'; }
function runSlashCommand(key) {
  const block = window._slashBlock;
  const editor = $('#note-editor');
  if (block && editor) {
    block.textContent = '';
    const range = document.createRange();
    range.selectNodeContents(block);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    editor.focus();
  }
  const cmd = SLASH_COMMANDS.find(c => c.key === key);
  if (cmd) cmd.run();
  hideSlashMenu();
  if (window._nbCurrentNoteId && editor) saveNoteContentDebounced(window._nbCurrentNoteId, editor.innerHTML);
}

function notebookTree(parentId, depth, search, sort) {
  const children = state.notes.filter(n => n.parentId === parentId);
  const folders = children.filter(n => n.type === 'folder');
  let notes = children.filter(n => n.type === 'note');
  notes = sort === 'alpha' ? [...notes].sort((a, b) => a.name.localeCompare(b.name)) : [...notes].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const rows = [...folders, ...notes].map(n => {
    if (n.type === 'folder') {
      const inner = notebookTree(n.id, depth + 1, search, sort);
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
    if (search && !n.name.toLowerCase().includes(search) && !plainTextOfNote(n).toLowerCase().includes(search)) return '';
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
function duplicateNote(id) {
  const n = state.notes.find(x => x.id === id);
  const copy = { ...n, id: uid(), name: n.name + ' (copy)', updatedAt: Date.now() };
  state.notes.push(copy);
  setState({ notebookSelected: copy.id });
  toast('Note duplicated');
}
function openMoveNoteModal(id) {
  const n = state.notes.find(x => x.id === id);
  openModal(`
    <div class="modal-head"><h3>Move note</h3><button class="close-x" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label>Destination folder</label>
        <select class="select" id="mv-folder">${allFolders().map(f => `<option value="${f.id}" ${f.id === n.parentId ? 'selected' : ''}>${'—'.repeat(f.depth)}${f.depth ? ' ' : ''}${esc(f.name)}</option>`).join('')}</select>
      </div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="moveNoteTo('${id}')">Move</button></div>
  `);
}
function moveNoteTo(id) {
  const n = state.notes.find(x => x.id === id);
  n.parentId = $('#mv-folder').value;
  touch(); closeModal(); toast('Note moved');
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
  window._nbCurrentNoteId = note.id;
  const words = plainTextOfNote(note).trim().split(/\s+/).filter(Boolean).length;
  const crumbs = notePath(note);
  const iconColor = note.courseId ? getCourseColor(note.courseId) : 'var(--text-faint)';
  return `
    <div class="nb-page-inner">
      <div class="nb-breadcrumb-row">
        ${crumbs.length ? `<div class="nb-breadcrumb">Notebook<span class="nb-crumb-sep">/</span>${crumbs.map(c => `${esc(c)}<span class="nb-crumb-sep">/</span>`).join('')}</div>` : `<div class="nb-breadcrumb">Notebook</div>`}
        <div class="nb-page-actions">
          <button class="btn btn-ghost btn-sm" onclick="duplicateNote('${note.id}')">${icon('layers', 13)} Duplicate</button>
          <button class="btn btn-ghost btn-sm" onclick="openMoveNoteModal('${note.id}')">${icon('folder', 13)} Move</button>
          <button class="btn btn-ghost btn-sm" onclick="exportNoteToPdf('${note.id}')">${icon('download', 13)} Export PDF</button>
          <button class="btn btn-ghost btn-sm" onclick="shareNoteToGroup('${note.id}')">${icon('users', 13)} Share</button>
        </div>
      </div>
      <div class="nb-icon-avatar" style="background:${iconColor}18;color:${iconColor}">${icon('file-text', 20, 1.6)}</div>
      <input class="nb-title-input" value="${esc(note.name)}" placeholder="Untitled" oninput="renameNote('${note.id}',this.value)">
      <div class="nb-meta-row">
        <div class="flex-gap">
          <select class="select nb-course-select" onchange="setNoteCourse('${note.id}',this.value)">
            <option value="">No course</option>${activeCourses().map(c => `<option value="${c.id}" ${c.id === note.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
          <span class="small muted" id="nb-save-status">Edited ${fmtRelativeTime(note.updatedAt) || 'now'} · ${words} word${words === 1 ? '' : 's'}</span>
        </div>
        <div class="flex-gap">
          ${aiButton('Study guide', `generateStudyGuideFromNote('${note.id}')`, 'sg-btn')}
          ${aiButton('Flashcards', `generateFlashcardsFromNote('${note.id}')`, 'fc-btn')}
        </div>
      </div>
      <div class="nb-hint">Type <code>/</code> for blocks, or select text to format</div>
      <div class="rich-editor nb-editor-body" id="note-editor" contenteditable="true" data-placeholder="Start writing…" oninput="onNoteEdit('${note.id}', this)">${note.content || ''}</div>
    </div>
  `;
}
function onNoteEdit(id, el) {
  const status = $('#nb-save-status');
  if (status) status.textContent = 'Saving…';
  saveNoteContentDebounced(id, el.innerHTML);
}
function renameNote(id, name) { const n = state.notes.find(x => x.id === id); n.name = name; save(); }
function setNoteCourse(id, courseId) { const n = state.notes.find(x => x.id === id); n.courseId = courseId || null; touch(); }
const saveNoteContentDebounced = debounce((id, html) => {
  const n = state.notes.find(x => x.id === id);
  n.content = html; n.updatedAt = Date.now(); save();
  const status = $('#nb-save-status');
  if (status) { const words = plainTextOfNote(n).trim().split(/\s+/).filter(Boolean).length; status.textContent = `Saved just now · ${words} word${words === 1 ? '' : 's'}`; }
}, 500);

function plainTextOfNote(note) { const d = document.createElement('div'); d.innerHTML = note.content || ''; return d.textContent || ''; }

function exportNoteToPdf(id) {
  const note = state.notes.find(n => n.id === id);
  if (!note) return;
  const courseName = note.courseId ? getCourse(note.courseId)?.name : '';
  const crumbs = notePath(note);
  const area = $('#print-area');
  area.innerHTML = `
    ${crumbs.length ? `<div class="print-meta">${crumbs.map(esc).join(' / ')}</div>` : ''}
    <div class="print-title">${esc(note.name || 'Untitled')}</div>
    <div class="print-meta">${courseName ? esc(courseName) + ' · ' : ''}${fmtDateLong(todayIso())}</div>
    <div class="rich-editor">${note.content || '<p><em>This note is empty.</em></p>'}</div>
  `;
  const restoreTitle = document.title;
  document.title = note.name || 'Untitled note';
  window.print();
  document.title = restoreTitle;
}
function shareNoteToGroup(id) {
  const note = state.notes.find(n => n.id === id);
  if (!note) return;
  openShareToGroupModal('note', note.name || 'Untitled note', { content: note.content || '' });
}

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
