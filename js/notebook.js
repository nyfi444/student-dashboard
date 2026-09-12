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
  const pinned = allNotes.filter(n => n.pinned);

  const html = `
    ${pageHead('Notebook', 'Organize notes by class', `
      <button class="btn btn-sm" onclick="createFolder('root')">${icon('folder', 13)} Folder</button>
      <button class="btn btn-primary" onclick="createNote('root')">${icon('plus', 13, 2.2)} Note</button>
    `)}
    <div class="notebook-layout">
      <div class="notebook-tree-panel" id="notebook-tree-panel" style="--nb-tree-w:${state.settings.notebookTreeWidth || 264}px">
        <div class="notebook-search-wrap">
          <span class="notebook-search-ic">${icon('file-text', 13)}</span>
          <input class="notebook-search" id="nb-search-input" placeholder="Search notes & content…" value="${esc(state._notebookSearch || '')}" oninput="onNotebookSearchInput(this)">
        </div>
        ${pinned.length ? `
        <div class="nb-pinned-section">
          <div class="small muted" style="padding:8px 10px 2px;font-weight:600">${icon('pin', 12, 2)} Pinned</div>
          ${pinned.map(n => `<div class="nb-note-row ${n.id === (state.notebookSelected || allNotes[0]?.id) ? 'selected' : ''}" onclick="selectNote('${n.id}')">
            <span class="nb-note-ic">${icon('pin', 13, 1.8)}</span>
            <div class="nb-note-meta"><div class="nb-note-title">${esc(n.name)}</div></div>
          </div>`).join('')}
        </div>` : ''}
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
      <div class="notebook-resize-handle" onmousedown="startNotebookTreeResize(event)" title="Drag to resize"></div>
      <div class="notebook-page">
        ${note ? renderNoteEditor(note) : `<div class="nb-blank">${allNotes.length
          ? emptyState(icon('book-open', 26, 1.4), 'Select a note from the list.')
          : emptyState(icon('book-open', 26, 1.4), 'Create your first note to get started.', `<button class="btn btn-primary mt-8" onclick="createNote('root')">${icon('plus', 13, 2.2)} New note</button>`)}</div>`}
      </div>
    </div>
    <div class="nb-bubble" id="nb-bubble">
      <button data-nb-cmd="bold" onmousedown="event.preventDefault()" onclick="runNbCommand('bold')" title="Bold" aria-label="Bold"><b>B</b></button>
      <button data-nb-cmd="italic" onmousedown="event.preventDefault()" onclick="runNbCommand('italic')" title="Italic" aria-label="Italic"><i>I</i></button>
      <button data-nb-cmd="underline" onmousedown="event.preventDefault()" onclick="runNbCommand('underline')" title="Underline" aria-label="Underline"><u>U</u></button>
      <button data-nb-cmd="strikeThrough" onmousedown="event.preventDefault()" onclick="runNbCommand('strikeThrough')" title="Strikethrough" aria-label="Strikethrough"><s>S</s></button>
      <button class="nb-toolbar-color" onmousedown="event.preventDefault()" onclick="openNbColorPopover(this,'text')" title="Text color" aria-label="Text color">A<span class="nb-color-swatch nb-textcolor-swatch"></span></button>
      <button class="nb-toolbar-color" onmousedown="event.preventDefault()" onclick="openNbColorPopover(this,'highlight')" title="Highlight color" aria-label="Highlight color">${icon('palette', 14)}<span class="nb-color-swatch nb-highlightcolor-swatch"></span></button>
      <button onmousedown="event.preventDefault()" onclick="runNbCommand('formatBlock','PRE')" title="Code" aria-label="Code">${'</>'}</button>
      <span class="nb-bubble-sep"></span>
      <button onmousedown="event.preventDefault()" onclick="runNbCommand('formatBlock','H3')" title="Heading" aria-label="Heading 3">H3</button>
      <button onmousedown="event.preventDefault()" onclick="runNbCommand('insertUnorderedList')" title="Bulleted list" aria-label="Bulleted list">${icon('clipboard-list', 14)}</button>
      <button onmousedown="event.preventDefault()" onclick="runNbCommand('formatBlock','blockquote')" title="Quote" aria-label="Quote">”</button>
      <span class="nb-bubble-sep"></span>
      <button onmousedown="event.preventDefault()" onclick="promptInsertLink()" title="Link" aria-label="Insert link">${icon('link', 13)}</button>
    </div>
    <div class="nb-slash-menu" id="nb-slash-menu">
      ${SLASH_COMMANDS.map(c => `<div class="nb-slash-item" data-key="${c.key}" onmousedown="event.preventDefault()" onclick="runSlashCommand('${c.key}')"><span class="nb-slash-glyph">${c.glyph}</span><span><div class="nb-slash-label">${c.label}</div><div class="nb-slash-desc">${c.desc}</div></span></div>`).join('')}
    </div>
    <div class="nb-color-popover" id="nb-color-popover"></div>
    <input type="file" id="nb-pdf-input" accept="application/pdf" multiple style="display:none" onchange="handleNotePdfUpload(this.files)">
  `;
  setTimeout(() => { wireBubbleToolbar(); wireSlashMenu(); updateNbColorSwatches(); }, 0);
  return html;
}

// touch() does a full innerHTML re-render, which swaps in a brand-new <input>
// element — on a plain oninput="...;touch()" (which is what this used to be)
// that steals focus after every single character, so typing a second letter
// requires clicking back into the box first. That's what "search doesn't
// work" actually was: not that filtering was broken, but that you couldn't
// type more than one character into it. Saving + restoring the caret position
// around the re-render keeps focus in the (new) input across every keystroke.
function onNotebookSearchInput(el) {
  const pos = el.selectionStart;
  state._notebookSearch = el.value;
  touch();
  const fresh = $('#nb-search-input');
  if (fresh) { fresh.focus(); fresh.setSelectionRange(pos, pos); }
}

// Obsidian-style resizable notebook sidebar — dragging updates the live DOM
// directly (no touch()/render() per pixel, which would thrash the whole page
// and the rich-text editor on every mousemove) and only persists once, on
// release.
function startNotebookTreeResize(e) {
  e.preventDefault();
  const panel = $('#notebook-tree-panel');
  if (!panel) return;
  const startX = e.clientX;
  const startWidth = panel.getBoundingClientRect().width;
  const prevUserSelect = document.body.style.userSelect;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  function onMove(ev) {
    panel.style.setProperty('--nb-tree-w', clamp(startWidth + (ev.clientX - startX), 200, 520) + 'px');
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = prevUserSelect;
    state.settings.notebookTreeWidth = panel.getBoundingClientRect().width;
    save();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function notePath(note) {
  const parts = [];
  let p = state.notes.find(x => x.id === note.parentId);
  while (p && p.id !== 'root') { parts.unshift(p.name); p = state.notes.find(x => x.id === p.parentId); }
  return parts;
}
function foldersWithNotes() {
  return state.notes.filter(n => n.type === 'folder' && n.id !== 'root' && state.notes.some(x => x.type === 'note' && x.parentId === n.id));
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
  const positionBubble = () => {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode || !editor.contains(sel.anchorNode) || sel.isCollapsed) { bar.style.display = 'none'; return; }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    const barW = bar.offsetWidth || 220, barH = bar.offsetHeight || 34;
    bar.style.left = Math.max(8, rect.left + rect.width / 2 - barW / 2) + 'px';
    bar.style.top = Math.max(8, rect.top - barH - 8) + 'px';
  };
  const positionAndUpdate = () => { positionBubble(); updateNbFormatState(); updateCaretLineHighlight(editor); };
  // Only capture the range from genuine interaction inside the editor (mouseup/keyup
  // there) — never from the document-wide selectionchange event, which also fires
  // (with an already-collapsed selection) the instant a toolbar button steals focus,
  // and would otherwise clobber the good range right before the click handler runs.
  const captureAndPosition = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && sel.anchorNode && editor.contains(sel.anchorNode)) {
      window._nbSavedRange = sel.getRangeAt(0).cloneRange();
    }
    positionAndUpdate();
  };
  if (window._nbEditorMouseup) editor.removeEventListener('mouseup', window._nbEditorMouseup);
  if (window._nbEditorKeyup) editor.removeEventListener('keyup', window._nbEditorKeyup);
  window._nbEditorMouseup = captureAndPosition;
  window._nbEditorKeyup = captureAndPosition;
  editor.addEventListener('mouseup', window._nbEditorMouseup);
  editor.addEventListener('keyup', window._nbEditorKeyup);
  // Document-level listener only hides the bubble when the selection collapses or
  // moves elsewhere (e.g. clicking away) — it must never touch the saved range.
  if (window._nbBubbleUpdate) document.removeEventListener('selectionchange', window._nbBubbleUpdate);
  window._nbBubbleUpdate = positionBubble;
  document.addEventListener('selectionchange', window._nbBubbleUpdate);
  updateNbFormatState();
}
// Toggles bold/italic/underline/strikethrough active state on every toolbar button
// (bubble + persistent) that declares data-nb-cmd, so the toolbar reflects the
// formatting under the cursor instead of always looking unpressed.
const NB_STATE_CMDS = ['bold', 'italic', 'underline', 'strikeThrough'];
function updateNbFormatState() {
  NB_STATE_CMDS.forEach(cmd => {
    let active = false;
    try { active = document.queryCommandState(cmd); } catch { }
    $$(`[data-nb-cmd="${cmd}"]`).forEach(btn => btn.classList.toggle('active', active));
  });
}
// The "Type '/' for commands" hint should only ever show on the one line the
// caret is actually on — same as Notion, which this is modeled after — not on
// every empty-looking line in the note at once. Marks that single block with
// .nb-caret-line so the CSS :empty rule (see styles.css) has something
// specific to key off instead of matching every empty block in the editor.
function updateCaretLineHighlight(editor) {
  const prev = editor.querySelector('.nb-caret-line');
  if (prev) prev.classList.remove('nb-caret-line');
  const sel = window.getSelection();
  if (!sel || !sel.anchorNode || !editor.contains(sel.anchorNode)) return;
  let node = sel.anchorNode;
  if (node.nodeType === 3) node = node.parentElement; // text node -> its element
  while (node && node.parentElement !== editor && node !== editor) node = node.parentElement;
  if (node && node !== editor) node.classList.add('nb-caret-line');
}
// Restores the last-known editor selection (captured on selectionchange) before
// running a format command — clicking a toolbar button can otherwise collapse
// the selection to the document body before the click handler runs.
function restoreNbSelection() {
  const editor = $('#note-editor');
  if (!editor) return;
  editor.focus();
  if (window._nbSavedRange) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(window._nbSavedRange);
  }
}
function runNbCommand(cmd, val) {
  const editor = $('#note-editor');
  if (!editor) return;
  restoreNbSelection();
  document.execCommand(cmd, false, val);
  if (window._nbCurrentNoteId) saveNoteContentDebounced(window._nbCurrentNoteId, editor.innerHTML);
  updateNbFormatState();
}
function runNbInsertHtml(html) {
  const editor = $('#note-editor');
  if (!editor) return;
  restoreNbSelection();
  document.execCommand('insertHTML', false, html);
  if (window._nbCurrentNoteId) saveNoteContentDebounced(window._nbCurrentNoteId, editor.innerHTML);
}
function insertNbChecklist() { runNbInsertHtml('<div class="nb-todo-line"><input type="checkbox">&nbsp;</div>'); }
function insertNbDivider() { runNbInsertHtml('<hr><p><br></p>'); }
function runNbHighlightColor(hex) {
  const editor = $('#note-editor');
  if (!editor) return;
  restoreNbSelection();
  document.execCommand('hiliteColor', false, hex);
  window._nbLastHighlightColor = hex;
  updateNbColorSwatches();
  if (window._nbCurrentNoteId) saveNoteContentDebounced(window._nbCurrentNoteId, editor.innerHTML);
}
function clearNbHighlight() {
  const editor = $('#note-editor');
  if (!editor) return;
  restoreNbSelection();
  document.execCommand('hiliteColor', false, 'transparent');
  if (window._nbCurrentNoteId) saveNoteContentDebounced(window._nbCurrentNoteId, editor.innerHTML);
  closeNbColorPopover();
}
function updateNbColorSwatches() {
  $$('.nb-textcolor-swatch').forEach(el => el.style.background = window._nbLastTextColor || '#000000');
  $$('.nb-highlightcolor-swatch').forEach(el => el.style.background = window._nbLastHighlightColor || '#fde68a');
}
/* ── Text/highlight color popover — a gradient color wheel (see colorwheel.js,
   also used for course/event colors) instead of the browser's native picker
   or a single fixed highlight shade. ── */
function openNbColorPopover(anchorEl, mode) {
  const editor = $('#note-editor');
  const pop = $('#nb-color-popover');
  if (!editor || !pop) return;
  restoreNbSelection();
  window._nbColorMode = mode;
  let hex;
  if (mode === 'text') {
    hex = rgbStringToHex(document.queryCommandValue('foreColor'), window._nbLastTextColor || '#000000');
  } else {
    const current = document.queryCommandValue('hiliteColor');
    const on = current && !/transparent|rgba\(0,\s*0,\s*0,\s*0\)/.test(current);
    hex = on ? rgbStringToHex(current, window._nbLastHighlightColor || '#fde68a') : (window._nbLastHighlightColor || '#fde68a');
  }
  pop.innerHTML = `
    <div class="nb-color-pop-head">
      <span>${mode === 'text' ? 'Text color' : 'Highlight color'}</span>
      ${mode === 'highlight' ? `<button class="nb-color-pop-clear" onmousedown="event.preventDefault()" onclick="clearNbHighlight()">Remove</button>` : ''}
    </div>
    ${colorWheelHtml('nb-cw', hex)}
  `;
  wireColorWheel('nb-cw', () => hex, (newHex) => {
    hex = newHex;
    if (mode === 'text') runNbTextColor(newHex); else runNbHighlightColor(newHex);
  });
  pop.style.display = 'block';
  positionNbColorPopover(anchorEl);
  document.removeEventListener('mousedown', nbColorPopoverOutsideClick);
  document.removeEventListener('keydown', nbColorPopoverKeydown);
  setTimeout(() => {
    document.addEventListener('mousedown', nbColorPopoverOutsideClick);
    document.addEventListener('keydown', nbColorPopoverKeydown);
  }, 0);
}
function positionNbColorPopover(anchorEl) {
  const pop = $('#nb-color-popover');
  if (!pop) return;
  const rect = anchorEl.getBoundingClientRect();
  const popW = pop.offsetWidth || 182, popH = pop.offsetHeight || 230;
  let left = Math.min(rect.left, window.innerWidth - popW - 8);
  let top = rect.bottom + 8;
  if (top + popH > window.innerHeight - 8) top = rect.top - popH - 8;
  pop.style.left = Math.max(8, left) + 'px';
  pop.style.top = Math.max(8, top) + 'px';
}
function nbColorPopoverOutsideClick(e) {
  const pop = $('#nb-color-popover');
  if (!pop || pop.style.display === 'none' || pop.contains(e.target)) return;
  closeNbColorPopover();
}
function nbColorPopoverKeydown(e) { if (e.key === 'Escape') closeNbColorPopover(); }
function closeNbColorPopover() {
  const pop = $('#nb-color-popover');
  if (pop) pop.style.display = 'none';
  document.removeEventListener('mousedown', nbColorPopoverOutsideClick);
  document.removeEventListener('keydown', nbColorPopoverKeydown);
}
function promptInsertLink() {
  const url = prompt('Link URL?');
  if (url) runNbCommand('createLink', url);
}

/* ── Font family / size / color — the editor otherwise had no way to change
   how text looks beyond bold/italic/headings, unlike a normal word processor. ── */
const NB_FONT_FAMILIES = [
  { label: 'Default font', value: '' },
  { label: 'Sans-serif', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Monospace', value: '"Courier New", monospace' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Comic Sans MS', value: '"Comic Sans MS", cursive' },
];
const NB_FONT_SIZES = [12, 14, 15, 16, 18, 20, 24, 28, 32, 36, 48];
function runNbFontFamily(family) {
  const editor = $('#note-editor');
  if (!editor || !family) return;
  restoreNbSelection();
  document.execCommand('fontName', false, family);
  if (window._nbCurrentNoteId) saveNoteContentDebounced(window._nbCurrentNoteId, editor.innerHTML);
}
// execCommand('fontSize') only understands the legacy 1–7 scale, so it's used as a
// marker (size 7) and then swapped for a real pixel value via inline style — the
// standard workaround since there's no execCommand for an arbitrary font size.
// Chrome's fontSize command replaces (rather than extends) an existing <font
// face> wrapper around the same selection, so the chosen font family is
// re-applied onto the resulting span — otherwise picking a size after a family
// silently threw the family away.
function runNbFontSize(px) {
  const editor = $('#note-editor');
  if (!editor || !px) return;
  restoreNbSelection();
  let existingFont = '';
  try { existingFont = document.queryCommandValue('fontName') || ''; } catch { }
  document.execCommand('fontSize', false, '7');
  $$('font[size="7"]', editor).forEach(f => {
    const span = document.createElement('span');
    const face = f.getAttribute('face') || existingFont;
    if (face) span.style.fontFamily = face.replace(/^"|"$/g, '');
    span.style.fontSize = px + 'px';
    while (f.firstChild) span.appendChild(f.firstChild);
    f.replaceWith(span);
  });
  if (window._nbCurrentNoteId) saveNoteContentDebounced(window._nbCurrentNoteId, editor.innerHTML);
}
function runNbTextColor(hex) {
  const editor = $('#note-editor');
  if (!editor) return;
  restoreNbSelection();
  document.execCommand('foreColor', false, hex);
  window._nbLastTextColor = hex;
  updateNbColorSwatches();
  if (window._nbCurrentNoteId) saveNoteContentDebounced(window._nbCurrentNoteId, editor.innerHTML);
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

// A folder has no updatedAt of its own — for the "Edited" sort this stands in
// for one, so folder-heavy notebooks (the Obsidian-style setup this is meant
// to support) actually reorder when sort changes, instead of only ever
// reordering the notes inside a folder while the folders themselves stay
// fixed in creation order (which read as "the sort button doesn't do anything"
// to anyone whose top level is mostly folders).
function folderLatestActivity(folderId) {
  let latest = 0;
  state.notes.forEach(n => {
    if (n.parentId !== folderId) return;
    if (n.type === 'note') latest = Math.max(latest, n.updatedAt || 0);
    else if (n.type === 'folder') latest = Math.max(latest, folderLatestActivity(n.id));
  });
  return latest;
}
function notebookTree(parentId, depth, search, sort) {
  const children = state.notes.filter(n => n.parentId === parentId);
  let folders = children.filter(n => n.type === 'folder');
  let notes = children.filter(n => n.type === 'note');
  if (sort === 'alpha') {
    folders = [...folders].sort((a, b) => a.name.localeCompare(b.name));
    notes = [...notes].sort((a, b) => a.name.localeCompare(b.name));
  } else {
    folders = [...folders].sort((a, b) => folderLatestActivity(b.id) - folderLatestActivity(a.id));
    notes = [...notes].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

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
          <span class="nb-folder-name" title="${esc(n.name)}">${esc(n.name)}</span>
          ${count ? `<span class="nb-count">${count}</span>` : ''}
          <span class="nb-folder-actions">
            <button class="btn btn-ghost btn-icon btn-sm" onclick="event.stopPropagation();createFolder('${n.id}')" title="New subfolder" aria-label="New subfolder in ${esc(n.name)}">${icon('folder', 13)}</button>
            <button class="btn btn-ghost btn-icon btn-sm" onclick="event.stopPropagation();createNote('${n.id}')" title="New note" aria-label="New note in ${esc(n.name)}">${icon('plus', 13, 2.2)}</button>
            ${n.id !== 'root' ? `<button class="btn btn-ghost btn-icon btn-sm" onclick="event.stopPropagation();shareFolderToGroup('${n.id}')" title="Share this notebook with a group" aria-label="Share ${esc(n.name)} with a group">${icon('users', 13)}</button>` : ''}
            ${n.id !== 'root' ? `<button class="btn btn-ghost btn-icon btn-sm" aria-label="Delete ${esc(n.name)}" onclick="event.stopPropagation();deleteNoteItem('${n.id}')">${icon('trash', 14)}</button>` : ''}
          </span>
        </div>
        ${(n.open || forceOpen) ? `<div class="nb-children">${inner}</div>` : ''}
      </div>`;
    }
    if (search && !n.name.toLowerCase().includes(search) && !plainTextOfNote(n).toLowerCase().includes(search)) return '';
    const selected = n.id === (state.notebookSelected || state.notes.find(x => x.type === 'note')?.id);
    return `<div class="nb-note-row ${selected ? 'selected' : ''}" onclick="selectNote('${n.id}')">
      <span class="nb-note-ic">${icon('file-text', 14)}</span>
      <div class="nb-note-meta">
        <div class="nb-note-title" title="${esc(n.name)}">${esc(n.name)}</div>
        <div class="nb-note-sub">${n.courseId ? `<span class="pill-dot" style="background:${getCourseColor(n.courseId)}"></span>${esc(getCourse(n.courseId)?.code || '')} · ` : ''}${fmtRelativeTime(n.updatedAt)}</div>
      </div>
      <button class="btn btn-ghost btn-icon btn-sm nb-note-del" aria-label="Delete ${esc(n.name)}" onclick="event.stopPropagation();deleteNoteItem('${n.id}')">${icon('trash', 14)}</button>
    </div>`;
  });
  return rows.join('');
}
function toggleFolder(id) { const f = state.notes.find(n => n.id === id); f.open = !f.open; touch(); }
function selectNote(id) { setState({ notebookSelected: id }); }
function createFolder(parentId) {
  const name = prompt('Folder name?'); if (!name) return;
  state.notes.push({ id: uid(), type: 'folder', name, parentId, courseId: null, open: true });
  // Expand the parent too, so a subfolder created inside a currently-collapsed
  // folder is actually visible right away instead of looking like nothing happened.
  const parent = state.notes.find(n => n.id === parentId);
  if (parent) parent.open = true;
  touch();
}
function createNote(parentId) {
  const id = uid();
  state.notes.push({ id, type: 'note', name: 'Untitled note', parentId, courseId: null, pinned: false, content: '', updatedAt: Date.now() });
  setState({ notebookSelected: id });
}
function toggleNotePinned(id) {
  const n = state.notes.find(x => x.id === id);
  n.pinned = !n.pinned;
  touch();
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
    <div class="modal-head"><h3>Move note</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
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
  const root = state.notes.find(n => n.id === id);
  confirmDialog('Delete this? Folders delete everything inside them — you can restore it from Recently Deleted for 30 days.', () => {
    const toDelete = new Set([id]);
    let grew = true;
    while (grew) { grew = false; state.notes.forEach(n => { if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.id)) { toDelete.add(n.id); grew = true; } }); }
    const removed = state.notes.filter(n => toDelete.has(n.id));
    trashItem('note-bundle', root?.name || 'Untitled', removed);
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
          <button class="btn ${note.pinned ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="toggleNotePinned('${note.id}')">${icon('pin', 13)} ${note.pinned ? 'Pinned' : 'Pin'}</button>
          <button class="btn btn-ghost btn-sm" onclick="duplicateNote('${note.id}')">${icon('layers', 13)} Duplicate</button>
          <button class="btn btn-ghost btn-sm" onclick="openMoveNoteModal('${note.id}')">${icon('folder', 13)} Move</button>
          <button class="btn btn-ghost btn-sm" onclick="exportNoteToPdf('${note.id}')">${icon('download', 13)} Export PDF</button>
          <button class="btn btn-ghost btn-sm" onclick="triggerNotePdfUpload('${note.id}')">${icon('upload', 13)} Upload PDF</button>
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
      </div>
      <div class="nb-toolbar" id="nb-toolbar">
        <select class="nb-toolbar-select" title="Font family" aria-label="Font family" onmousedown="event.stopPropagation()" onchange="runNbFontFamily(this.value);this.selectedIndex=0">
          <option value="">Font</option>
          ${NB_FONT_FAMILIES.filter(f => f.value).map(f => `<option value='${f.value.replace(/'/g, "&#39;")}' style="font-family:${f.value}">${esc(f.label)}</option>`).join('')}
        </select>
        <select class="nb-toolbar-select" style="width:64px" title="Font size" aria-label="Font size" onmousedown="event.stopPropagation()" onchange="runNbFontSize(this.value);this.selectedIndex=0">
          <option value="">Size</option>
          ${NB_FONT_SIZES.map(sz => `<option value="${sz}">${sz}</option>`).join('')}
        </select>
        <button class="nb-toolbar-color" onmousedown="event.preventDefault()" onclick="openNbColorPopover(this,'text')" title="Text color" aria-label="Text color">A<span class="nb-color-swatch nb-textcolor-swatch"></span></button>
        <span class="nb-toolbar-sep"></span>
        <button data-nb-cmd="bold" onmousedown="event.preventDefault()" onclick="runNbCommand('bold')" title="Bold" aria-label="Bold"><b>B</b></button>
        <button data-nb-cmd="italic" onmousedown="event.preventDefault()" onclick="runNbCommand('italic')" title="Italic" aria-label="Italic"><i>I</i></button>
        <button data-nb-cmd="underline" onmousedown="event.preventDefault()" onclick="runNbCommand('underline')" title="Underline" aria-label="Underline"><u>U</u></button>
        <button data-nb-cmd="strikeThrough" onmousedown="event.preventDefault()" onclick="runNbCommand('strikeThrough')" title="Strikethrough" aria-label="Strikethrough"><s>S</s></button>
        <button class="nb-toolbar-color" onmousedown="event.preventDefault()" onclick="openNbColorPopover(this,'highlight')" title="Highlight color" aria-label="Highlight color">${icon('palette', 14)}<span class="nb-color-swatch nb-highlightcolor-swatch"></span></button>
        <span class="nb-toolbar-sep"></span>
        <button onmousedown="event.preventDefault()" onclick="runNbCommand('formatBlock','H1')" title="Heading 1" aria-label="Heading 1">H1</button>
        <button onmousedown="event.preventDefault()" onclick="runNbCommand('formatBlock','H2')" title="Heading 2" aria-label="Heading 2">H2</button>
        <button onmousedown="event.preventDefault()" onclick="runNbCommand('formatBlock','H3')" title="Heading 3" aria-label="Heading 3">H3</button>
        <span class="nb-toolbar-sep"></span>
        <button onmousedown="event.preventDefault()" onclick="runNbCommand('insertUnorderedList')" title="Bulleted list" aria-label="Bulleted list">${icon('clipboard-list', 14)}</button>
        <button onmousedown="event.preventDefault()" onclick="runNbCommand('insertOrderedList')" title="Numbered list" aria-label="Numbered list">1.</button>
        <button onmousedown="event.preventDefault()" onclick="insertNbChecklist()" title="Checklist" aria-label="Checklist">☑</button>
        <button onmousedown="event.preventDefault()" onclick="runNbCommand('formatBlock','blockquote')" title="Quote" aria-label="Quote">”</button>
        <button onmousedown="event.preventDefault()" onclick="runNbCommand('formatBlock','PRE')" title="Code" aria-label="Code">${'</>'}</button>
        <button onmousedown="event.preventDefault()" onclick="insertNbDivider()" title="Divider" aria-label="Divider">—</button>
        <span class="nb-toolbar-sep"></span>
        <button onmousedown="event.preventDefault()" onclick="promptInsertLink()" title="Link" aria-label="Insert link">${icon('link', 13)}</button>
        <button onmousedown="event.preventDefault()" onclick="runNbCommand('formatBlock','P')" title="Clear formatting" aria-label="Clear formatting">${icon('x', 13, 2.2)}</button>
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

function notePrintHtml(note, crumbs, courseName) {
  return `
    ${crumbs.length ? `<div class="print-meta">${crumbs.map(esc).join(' / ')}</div>` : ''}
    <div class="print-title">${esc(note.name || 'Untitled')}</div>
    <div class="print-meta">${courseName ? esc(courseName) + ' · ' : ''}${fmtDateLong(todayIso())}</div>
    <div class="rich-editor" style="color:#000">${note.content || '<p><em>This note is empty.</em></p>'}</div>
  `;
}
// Falls back to the browser's own print dialog — still produces a real PDF via
// "Save as PDF"/"Print to PDF", just without a direct file to hand to
// navigator.share(). Used when html2pdf isn't available (e.g. the CDN was
// blocked) or actually generating the PDF below threw.
function legacyPrintNote(note, crumbs, courseName) {
  $('#print-area').innerHTML = notePrintHtml(note, crumbs, courseName);
  const restoreTitle = document.title;
  document.title = note.name || 'Untitled note';
  window.print();
  document.title = restoreTitle;
}
async function exportNoteToPdf(id) {
  const note = state.notes.find(n => n.id === id);
  if (!note) return;
  const courseName = note.courseId ? getCourse(note.courseId)?.name : '';
  const crumbs = notePath(note);
  if (typeof html2pdf === 'undefined') { legacyPrintNote(note, crumbs, courseName); return; }

  const filename = (note.name || 'Untitled note').replace(/[\\/:*?"<>|]/g, '-').trim() + '.pdf';
  // Rendered off-screen with an explicit white background, independent of
  // whatever background preset or dark mode is active in the app right now —
  // otherwise the exported PDF's page color follows the theme instead of
  // being a clean white page (see the @media print fix in styles.css, which
  // this shares the same white-background reasoning with).
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:680px;background:#fff;color:#000;padding:30px 40px;';
  container.innerHTML = notePrintHtml(note, crumbs, courseName);
  document.body.appendChild(container);
  try {
    const blob = await html2pdf().set({
      margin: 0,
      filename,
      html2canvas: { backgroundColor: '#ffffff', scale: 2, useCORS: true },
      jsPDF: { unit: 'pt', format: 'letter' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    }).from(container).outputPdf('blob');
    await shareOrDownloadPdf(blob, filename, note.name || 'Untitled note');
  } catch (e) {
    console.warn('PDF generation failed, falling back to print dialog', e);
    legacyPrintNote(note, crumbs, courseName);
  } finally {
    container.remove();
  }
}
// Hands the generated PDF to the OS share sheet (Save to Files, Mail,
// Messages, AirDrop, etc.) where supported; otherwise downloads it directly,
// which is still strictly better than before (there was no PDF file at all,
// only the print dialog).
async function shareOrDownloadPdf(blob, filename, title) {
  try {
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return; // person dismissed the share sheet — not a failure
    console.warn('Share failed, falling back to download', e);
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('PDF downloaded');
}
function shareNoteToGroup(id) {
  const note = state.notes.find(n => n.id === id);
  if (!note) return;
  openShareToGroupModal('note', note.name || 'Untitled note', { content: note.content || '' });
}
// Shares a whole folder (every note directly inside it — including anything
// pulled in via Upload PDF) as one bundle, instead of only being able to
// share notes one at a time.
function shareFolderToGroup(id) {
  const folder = state.notes.find(n => n.id === id && n.type === 'folder');
  if (!folder) return;
  const notes = state.notes.filter(n => n.type === 'note' && n.parentId === id);
  if (!notes.length) { toast('This notebook has no notes to share yet', 'error'); return; }
  openShareToGroupModal('note-bundle', folder.name || 'Untitled notebook', { notes: notes.map(n => ({ name: n.name, content: n.content || '' })) });
}

function triggerNotePdfUpload(id) {
  window._nbPdfNoteId = id;
  const input = $('#nb-pdf-input');
  if (input) input.click();
}
async function handleNotePdfUpload(files) {
  const input = $('#nb-pdf-input');
  const noteId = window._nbPdfNoteId;
  const note = state.notes.find(n => n.id === noteId);
  if (!files || !files.length || !note) { if (input) input.value = ''; return; }
  const status = $('#nb-save-status');
  let failed = 0, truncatedAny = false, markerId = '';
  for (const file of files) {
    if (status) status.textContent = `Rendering ${file.name}…`;
    try {
      // Each page is rendered to an actual image and dropped in — the real
      // document (figures, layout, handwriting) rather than a stripped text
      // reflow. See extractPdfPageImages in ai.js for the size/page caps.
      // Wrapped in a timeout: a scanned/malformed PDF, or a slow/blocked CDN
      // fetch of the pdf.js worker, can otherwise hang forever with no error,
      // making the upload silently look like it never happened.
      const { images, truncated } = await withTimeout(extractPdfPageImages(file), 30000, 'Timed out reading this PDF');
      if (truncated) truncatedAny = true;
      const body = images.length
        ? images.map(src => `<p><img src="${src}" alt="${esc(file.name)} page" style="max-width:100%;border-radius:6px;border:1px solid var(--border);margin:4px 0"></p>`).join('')
        : '<p><em>No pages could be rendered from this PDF.</em></p>';
      markerId = 'nb-import-' + uid();
      note.content = (note.content || '') + `<h3 id="${markerId}">${esc(file.name)}</h3>${body}`;
    } catch (e) { failed++; }
  }
  note.updatedAt = Date.now();
  touch();
  if (markerId) requestAnimationFrame(() => document.getElementById(markerId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  if (failed) toast(`Imported ${files.length - failed} of ${files.length} PDFs — ${failed} couldn't be read`, failed === files.length ? 'error' : 'info', 4000);
  else toast(files.length > 1 ? `${files.length} PDFs imported into note` : 'PDF imported into note');
  if (truncatedAny) toast('One PDF had more pages than could be imported — only the first 20 pages of it were added', 'info', 5000);
  if (input) input.value = '';
}
