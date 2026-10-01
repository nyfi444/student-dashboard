/* ── Notebook: Notion-style folders + notes, per-course tagging ──── */
// Keys and run functions are the contract; icon/glyph and group are only
// how the menu draws them. Basics first, then the page layouts.
const SLASH_COMMANDS = [
  { key: 'text', label: 'Text', desc: 'Plain paragraph', icon: 'type', group: 'Basics', run: () => document.execCommand('formatBlock', false, 'P') },
  { key: 'h1', label: 'Heading 1', desc: 'Big section heading', glyph: 'H1', group: 'Basics', run: () => document.execCommand('formatBlock', false, 'H1') },
  { key: 'h2', label: 'Heading 2', desc: 'Medium heading', glyph: 'H2', group: 'Basics', run: () => document.execCommand('formatBlock', false, 'H2') },
  { key: 'h3', label: 'Heading 3', desc: 'Small heading', glyph: 'H3', group: 'Basics', run: () => document.execCommand('formatBlock', false, 'H3') },
  { key: 'bullet', label: 'Bulleted list', desc: 'Simple bullet list', icon: 'list', group: 'Basics', run: () => document.execCommand('insertUnorderedList') },
  { key: 'number', label: 'Numbered list', desc: 'List with numbers', icon: 'list-ordered', group: 'Basics', run: () => document.execCommand('insertOrderedList') },
  { key: 'todo', label: 'To-do checklist', desc: 'Track tasks with checkboxes', icon: 'check-square', group: 'Basics', run: () => document.execCommand('insertHTML', false, '<div class="nb-todo-line"><input type="checkbox">&nbsp;</div>') },
  { key: 'quote', label: 'Quote', desc: 'Callout quote block', icon: 'text-quote', group: 'Basics', run: () => document.execCommand('formatBlock', false, 'BLOCKQUOTE') },
  { key: 'divider', label: 'Divider', desc: 'Visual line break', icon: 'minus', group: 'Basics', run: () => document.execCommand('insertHTML', false, '<hr><p><br></p>') },
  { key: 'code', label: 'Code block', desc: 'Monospace snippet', icon: 'code', group: 'Basics', run: () => document.execCommand('formatBlock', false, 'PRE') },
  { key: 'image', label: 'Picture', desc: 'A photo or image; wrap text around it', icon: 'image', group: 'Basics', run: () => nbPickPicture() },
  { key: 'table', label: 'Table', desc: 'Rows and columns', icon: 'table', group: 'Basics', run: () => nbInsertTable(3, 3) },
  { key: 'cornell', label: 'Cornell layout', desc: 'Cues, notes, and a summary', icon: 'grid', group: 'Layouts', run: () => insertTemplateBlock('cornell') },
  { key: 'lab', label: 'Lab report', desc: 'Purpose through conclusion, with a data table', icon: 'clipboard-list', group: 'Layouts', run: () => insertTemplateBlock('lab') },
  { key: 'lecture', label: 'Lecture notes', desc: 'Big idea, notes, examples, questions, summary', icon: 'book-open', group: 'Layouts', run: () => insertTemplateBlock('lecture') },
  { key: 'reading', label: 'Reading notes', desc: 'Source, argument, key points, quotes, your take', icon: 'bookmark', group: 'Layouts', run: () => insertTemplateBlock('reading') },
  { key: 'exam', label: 'Exam review', desc: 'Topics to check off, formulas, practice, a plan', icon: 'target', group: 'Layouts', run: () => insertTemplateBlock('exam') },
  { key: 'weekly', label: 'Weekly planner', desc: 'Top three, a day-by-day table, a look back', icon: 'calendar', group: 'Layouts', run: () => insertTemplateBlock('weekly') },
  { key: 'meeting', label: 'Meeting notes', desc: 'Agenda, decisions, and who does what by when', icon: 'users', group: 'Layouts', run: () => insertTemplateBlock('meeting') },
];

function pageNotebook() {
  nbFlushEditor();
  const allNotes = state.notes.filter(n => n.type === 'note');
  const selectedId = state.notebookSelected || allNotes[0]?.id;
  const sharedSel = nbIsSharedId(selectedId);
  const note = sharedSel ? nbSharedNote(selectedId) : state.notes.find(n => n.id === selectedId && n.type === 'note');
  // Whoever is typing keeps their place through the rebuild. Two redraws in
  // a row keep the first one's place: by the second, the first has already
  // put the caret back at the start of the new editor.
  const caret = window._nbCaretPending || nbCaretSnapshot();
  window._nbCaretPending = caret;
  const search = (state._notebookSearch || '').trim().toLowerCase();
  const sort = state._notebookSort || 'edited';
  // Pinned notes show once, in Pinned; the tree below leaves them out. Both
  // lists answer to the same search.
  const pinned = sortNotebookNotes(allNotes.filter(n => n.pinned && notebookNoteMatches(n, search)), sort);
  const tree = notebookTree('root', 0, search, sort);
  const sharedSection = nbSharedSectionHtml(search, sort, selectedId);
  const hasFolders = state.notes.some(n => n.type === 'folder' && n.id !== 'root');

  const listHidden = notebookListHidden();
  const html = `
    ${pageHead('Notebook', 'Organize notes by class', `
      <button class="btn btn-sm head-menu" onclick="createFolder('root')">${icon('folder', 16)} Folder</button>
      <button class="btn btn-sm head-menu" onclick="openNoteTemplateModal('root')">${icon('grid', 16)} Templates</button>
      <button class="btn btn-primary" onclick="createNote('root')">${icon('plus', 16)} Note</button>
    `)}
    <div class="notebook-layout ${listHidden ? 'list-hidden' : ''}">
      <div class="notebook-tree-panel" id="notebook-tree-panel" style="--nb-tree-w:${state.settings.notebookTreeWidth || 280}px">
        <div class="nb-panel-head">
          <h2 class="nb-panel-title">Notebook</h2>
          <div class="split-btn">
            <button class="btn btn-primary btn-sm" onclick="createNote('root')">${icon('plus', 14)} Note</button>
            <button class="btn btn-primary btn-sm split-btn-menu" aria-label="More ways to add" aria-haspopup="menu" aria-expanded="false" data-tip="Folder or layout" onclick="openNbNewMenu(this)">${icon('chevron-down', 14)}</button>
          </div>
        </div>
        ${allNotes.length ? `<div class="notebook-search-wrap">
          <span class="notebook-search-ic" aria-hidden="true">${icon('search', 14)}</span>
          <input class="notebook-search" id="nb-search-input" type="search" placeholder="Search notes" aria-label="Search notes" autocomplete="off" value="${esc(state._notebookSearch || '')}" oninput="onNotebookSearchInput(this)">
        </div>` : ''}
        <div class="notebook-tree">
          ${pinned.length ? `<div class="nb-section nb-section-pinned">
            <div class="nb-section-label"><span>Pinned</span></div>
            <div class="nb-rows">${pinned.map(n => nbNoteRowHtml(n, selectedId, true)).join('')}</div>
          </div>` : ''}
          ${sharedSection}
          ${allNotes.length || hasFolders ? `<div class="nb-section nb-section-notes">
            <div class="nb-section-label"><span>Notes</span>
              <label class="nb-sort">${sort === 'alpha' ? 'A–Z' : 'Recent'}${icon('chevron-down', 12)}<select aria-label="Sort notes" onchange="state._notebookSort=this.value;touch()"><option value="edited" ${sort !== 'alpha' ? 'selected' : ''}>Recent</option><option value="alpha" ${sort === 'alpha' ? 'selected' : ''}>A–Z</option></select></label>
            </div>
            ${tree ? `<div class="nb-rows">${tree}</div>` : ''}
          </div>` : `<div class="nb-list-empty"><span class="nb-list-empty-line">No notes yet.</span><div class="nb-list-empty-phone">${emptyStateHtml({ icon: 'book-open', title: 'Your notebook is empty', body: 'Start a page for your next lecture, or pick a layout like Cornell notes.', compact: true, actions: [{ label: 'New note', onclick: "createNote('root')", icon: 'plus' }, { label: 'Browse layouts', onclick: "openNoteTemplateModal('root')", primary: false }] })}</div></div>`}
          ${search && !tree && !pinned.length && !sharedSection ? `<div class="nb-no-match">No notes match “${esc(state._notebookSearch.trim())}”. <button type="button" class="sg-link" onclick="state._notebookSearch='';touch()">Clear search</button></div>` : ''}
        </div>
      </div>
      <div class="notebook-resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize notes list" tabindex="0" onmousedown="startNotebookTreeResize(event)" onkeydown="onNotebookResizeKey(event)"></div>
      <div class="notebook-page" id="nb-page" data-keep-scroll>
        ${note ? renderNoteEditor(note) : `
          <div class="nb-topbar"><div class="nb-topbar-left">${nbListToggleHtml(listHidden)}${nbBackHtml()}</div></div>
          <div class="nb-blank">${sharedSel
            ? (nbSharedEnabled() && !_nbShared.loaded ? emptyStateHtml({ title: 'Opening the shared note…', body: 'One moment.' })
              : emptyStateHtml({ title: 'This shared note isn’t available', body: nbSharedEnabled() ? 'It may have been deleted, or it’s no longer shared with you.' : 'Log in to open notes shared with you.', actions: [{ label: 'New note', onclick: "createNote('root')", icon: 'plus' }] }))
            : allNotes.length
            ? emptyStateHtml({ title: 'No note open', body: 'Pick a note from the list, or start a new page.', actions: [{ label: 'New note', onclick: "createNote('root')", icon: 'plus' }] })
            : emptyStateHtml({ icon: 'book-open', title: 'Your notebook is empty', body: 'Start a page for your next lecture, or pick a layout like Cornell notes.', actions: [{ label: 'New note', onclick: "createNote('root')", icon: 'plus' }, { label: 'Browse layouts', onclick: "openNoteTemplateModal('root')", primary: false }] })}</div>`}
      </div>
    </div>
    <div class="nb-bubble" id="nb-bubble" role="toolbar" aria-label="Format selection">
      <button data-nb-cmd="bold" onmousedown="event.preventDefault()" onclick="runNbCommand('bold')" aria-label="Bold" data-tip="Bold" data-tip-kbd="B"><b>B</b></button>
      <button data-nb-cmd="italic" onmousedown="event.preventDefault()" onclick="runNbCommand('italic')" aria-label="Italic" data-tip="Italic" data-tip-kbd="I"><i>I</i></button>
      <button data-nb-cmd="underline" onmousedown="event.preventDefault()" onclick="runNbCommand('underline')" aria-label="Underline" data-tip="Underline" data-tip-kbd="U"><u>U</u></button>
      <button data-nb-cmd="strikeThrough" onmousedown="event.preventDefault()" onclick="runNbCommand('strikeThrough')" aria-label="Strikethrough" data-tip="Strikethrough"><s>S</s></button>
      <button class="nb-toolbar-color" onmousedown="event.preventDefault()" onclick="openNbColorPopover(this,'text')" aria-label="Text color" data-tip="Text color">A<span class="nb-color-swatch nb-textcolor-swatch"></span></button>
      <button class="nb-toolbar-color" onmousedown="event.preventDefault()" onclick="openNbColorPopover(this,'highlight')" aria-label="Highlight color" data-tip="Highlight">${icon('highlighter', 16)}<span class="nb-color-swatch nb-highlightcolor-swatch"></span></button>
      <button onmousedown="event.preventDefault()" onclick="runNbCommand('formatBlock','PRE')" aria-label="Code" data-tip="Code">${icon('code', 16)}</button>
      <span class="nb-bubble-sep" aria-hidden="true"></span>
      <button class="nb-bubble-h" onmousedown="event.preventDefault()" onclick="runNbCommand('formatBlock','H3')" aria-label="Heading 3" data-tip="Heading">H</button>
      <button onmousedown="event.preventDefault()" onclick="runNbCommand('insertUnorderedList')" aria-label="Bulleted list" data-tip="Bulleted list">${icon('list', 16)}</button>
      <button onmousedown="event.preventDefault()" onclick="runNbCommand('formatBlock','blockquote')" aria-label="Quote" data-tip="Quote">${icon('text-quote', 16)}</button>
      <span class="nb-bubble-sep" aria-hidden="true"></span>
      <button onmousedown="event.preventDefault()" onclick="promptInsertLink()" aria-label="Insert link" data-tip="Link">${icon('link', 16)}</button>
    </div>
    <div class="nb-slash-menu" id="nb-slash-menu" role="listbox" aria-label="Blocks"></div>
    <div class="nb-color-popover" id="nb-color-popover"></div>
    <div class="nb-type-pop menu-surface" id="nb-type-pop" role="menu" aria-label="More formatting">${nbTypePopHtml()}</div>
    <input type="file" id="nb-file-input" multiple style="display:none" onchange="handleNoteFileUpload(this.files)">
    ${nbMediaBarsHtml()}
  `;
  setTimeout(() => {
    wireBubbleToolbar(); wireSlashMenu(); updateNbColorSwatches(); wireNbMedia(); wireNbShared();
    wireNbKeyboardBar(); nbUpdateKeyboardInset();
    const editor = $('#note-editor');
    if (editor) nbTagInks(editor);
    const title = $('#nb-title-input');
    nbAutosizeTitle(title);
    nbWatchTitleWidth(title);
    // A note just made with + Note or Blank note opens with the caret in its title.
    if (title && note && window._nbFocusTitle === note.id) { window._nbFocusTitle = null; title.focus({ preventScroll: true }); }
    wireNbStuckBar();
    // A re-render while typing (a sync, a pin) keeps the phone keyboard bar up.
    const layout = $('.notebook-layout');
    if (layout && editor && editor.contains(document.activeElement)) layout.classList.add('is-editing');
    afterNotebookRender();
    nbSharedAttach(note);
  }, 0);
  return html;
}

// A redraw (a sync landing, a groupmate's change, a pin) rebuilds the
// editor from the note, and what was typed in the last half second hasn't
// been saved into the note yet: the redraw wiped it. So it goes in first,
// unless the note itself was replaced by a newer copy from another device
// since it was drawn, in which case that copy is what should show.
function nbFlushEditor() {
  const editor = document.getElementById('note-editor');
  const r = window._nbRendered;
  if (!editor || !r || r.id !== window._nbCurrentNoteId || nbIsSharedId(r.id)) return;
  const n = state.notes.find(x => x.id === r.id);
  if (!n || n !== r.note || n.content !== r.content) return;
  const html = editor.innerHTML;
  if (html !== n.content) { n.content = html; r.content = html; }
}

// Straight after the page is rebuilt, in the same task (render() calls
// this), so no keystroke can land in the new editor before the caret is
// back where it was. The setTimeout in pageNotebook is the fallback.
function afterNotebookRender() {
  const caret = window._nbCaretPending;
  if (!caret || state.route !== 'notebook' || !document.getElementById('note-editor')) return;
  window._nbCaretPending = null;
  nbCaretRestore(caret);
}

/* ── Notes list pieces ── */
function notebookNoteMatches(n, search) {
  return !search || n.name.toLowerCase().includes(search) || plainTextOfNote(n).toLowerCase().includes(search);
}
function sortNotebookNotes(notes, sort) {
  return sort === 'alpha' ? [...notes].sort((a, b) => a.name.localeCompare(b.name)) : [...notes].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
// The first line or so of a note, for the list. Cached per edit, since the
// list re-renders on every keystroke in the search box.
const _nbSnippets = new Map();
function nbNoteSnippet(n) {
  const key = n.id + ':' + (n.updatedAt || 0);
  if (!_nbSnippets.has(key)) {
    const text = nbSnippetText(String(n.content || ''));
    _nbSnippets.set(key, text.length > 90 ? text.slice(0, 89).trimEnd() + '…' : text);
    if (_nbSnippets.size > 600) _nbSnippets.delete(_nbSnippets.keys().next().value);
  }
  return _nbSnippets.get(key);
}
// The row snippet: the note's blocks joined with ' · ', so list items and
// paragraphs don't run together. A layout's own labels (section headings,
// table header rows, the pre-filled first column like 1 2 3 or Mon Tue)
// are left out, so an untouched layout has no snippet, like a new Cornell
// note. Leading headings are skipped (they read as a second title); if
// nothing else is left, the headings are used after all.
const NB_SNIPPET_BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,div,blockquote,pre,td,th,tr,br';
function nbSnippetText(html) {
  if (!html) return '';
  const body = new DOMParser().parseFromString('<!doctype html><html><body>' + html + '</body></html>', 'text/html').body;
  body.querySelectorAll('.nb-lab-section > h2, .nb-sheet-section > h2, :is(.nb-lab, .nb-sheet) thead').forEach(el => el.remove());
  const prefilled = new Set(['1', '2', '3', ...Object.values(SHEET_TEMPLATES).flatMap(t => t.sections.filter(s => s[1] === 'table').flatMap(s => s[3]))]);
  body.querySelectorAll(':is(.nb-lab, .nb-sheet) tbody tr').forEach(tr => {
    const cells = [...tr.cells].map(c => c.textContent.trim());
    if (cells.slice(1).every(t => !t) && (!cells[0] || prefilled.has(cells[0]))) tr.remove();
  });
  const flat = root => {
    root.querySelectorAll(NB_SNIPPET_BLOCKS).forEach(el => { el.before('\u0001'); el.after('\u0001'); });
    return root.textContent.split('\u0001').map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' · ');
  };
  const lead = body.cloneNode(true);
  while (lead.firstChild && (lead.firstChild.nodeType === 3 ? !lead.firstChild.textContent.trim() : /^H[1-6]$/.test(lead.firstChild.nodeName))) lead.firstChild.remove();
  return flat(lead) || flat(body);
}
function nbNoteRowHtml(n, selectedId, inPinned) {
  const selected = n.id === selectedId;
  const title = n.name === 'Untitled note' ? 'Untitled' : n.name;
  const snippet = nbNoteSnippet(n);
  const course = n.courseId ? getCourse(n.courseId) : null;
  return `<div class="nb-note-row ${selected ? 'selected' : ''}" ${selected ? 'aria-current="true"' : ''} onclick="selectNote('${n.id}')">
      <div class="nb-note-meta">
        <div class="nb-note-title"><span class="nb-note-name" title="${esc(title)}">${esc(title)}</span>${n.pinned && !inPinned ? `<span class="nb-note-pin" aria-label="Pinned">${icon('pin', 12)}</span>` : ''}</div>
        ${snippet ? `<div class="nb-note-snippet">${esc(snippet)}</div>` : ''}
        <div class="nb-note-sub">${course ? `<span class="pill-dot" style="background:${getCourseColor(n.courseId)}"></span><span>${esc(course.code || '')}</span><span aria-hidden="true">·</span>` : ''}<span>${fmtRelativeTime(n.updatedAt)}</span></div>
      </div>
      <button class="btn btn-ghost btn-icon btn-sm nb-note-del" aria-label="Delete ${esc(n.name)}" data-tip="Delete" onclick="event.stopPropagation();deleteNoteItem('${n.id}')">${icon('trash', 14)}</button>
    </div>`;
}
function openNbNewMenu(btn) {
  openMenu(btn, `
    <button class="menu-item" onclick="createNote('root')">${icon('file-text', 16)}<span>Blank note</span></button>
    <button class="menu-item" onclick="openNoteTemplateModal('root')">${icon('grid', 16)}<span>From a layout…</span></button>
    <div class="menu-sep" role="separator"></div>
    <button class="menu-item" onclick="createFolder('root')">${icon('folder', 16)}<span>New folder</span></button>
  `, { align: 'end' });
}
function nbListToggleHtml(hidden) {
  const label = hidden ? 'Show notes list' : 'Hide notes list';
  return `<button class="btn btn-ghost btn-icon btn-sm nb-list-toggle" id="nb-list-toggle" aria-controls="notebook-tree-panel" aria-expanded="${!hidden}" aria-label="${label}" data-tip="${label}" onclick="toggleNotebookList()">${notebookListToggleLabel(hidden)}</button>`;
}
function nbBackHtml() {
  return `<button type="button" class="btn btn-ghost nb-back" onclick="toggleNotebookList()">${icon('chevron-left', 20)}Notes</button>`;
}

/* ── The Aa popover: everything the bar leaves out ── */
function nbTypePopHtml() {
  const pd = 'onmousedown="event.preventDefault()"';
  return `
    <div class="nb-type-row">
      <button role="menuitem" data-nb-cmd="underline" ${pd} onclick="runNbCommand('underline')" aria-label="Underline" data-tip="Underline" data-tip-kbd="U"><u>U</u></button>
      <button role="menuitem" data-nb-cmd="strikeThrough" ${pd} onclick="runNbCommand('strikeThrough')" aria-label="Strikethrough" data-tip="Strikethrough"><s>S</s></button>
      <button role="menuitem" class="nb-toolbar-color" ${pd} onclick="closeNbTypePop();openNbColorPopover($('#nb-type-btn')||this,'text')" aria-label="Text color" data-tip="Text color">A<span class="nb-color-swatch nb-textcolor-swatch"></span></button>
      <button role="menuitem" ${pd} onclick="runNbCommand('insertOrderedList')" aria-label="Numbered list" data-tip="Numbered list">${icon('list-ordered', 16)}</button>
      <button role="menuitem" ${pd} onclick="insertNbDivider()" aria-label="Divider" data-tip="Divider">${icon('minus', 16)}</button>
      <button role="menuitem" ${pd} onclick="runNbCommand('formatBlock','P');runNbCommand('removeFormat')" aria-label="Clear formatting" data-tip="Clear formatting">${icon('remove-formatting', 16)}</button>
    </div>
    <button role="menuitem" class="menu-item nb-type-folded" data-nb-folded="link" ${pd} onclick="closeNbTypePop();promptInsertLink()">${icon('link', 16)}<span>Insert link</span></button>
    <button role="menuitem" class="menu-item nb-type-folded" data-nb-folded="checklist" ${pd} onclick="closeNbTypePop();insertNbChecklist()">${icon('check-square', 16)}<span>Checklist</span></button>
    <button role="menuitem" class="menu-item nb-type-folded" data-nb-folded="list" ${pd} onclick="closeNbTypePop();runNbCommand('insertUnorderedList')">${icon('list', 16)}<span>Bulleted list</span></button>
    <button role="menuitem" class="menu-item nb-type-folded" data-nb-folded="image" ${pd} onclick="closeNbTypePop();nbPickPicture()">${icon('image', 16)}<span>Picture</span></button>
    <button role="menuitem" class="menu-item nb-type-folded" data-nb-folded="table" ${pd} onclick="closeNbTypePop();nbInsertTable(3,3)">${icon('table', 16)}<span>Table</span></button>
    <div class="menu-label">Font</div>
    ${NB_FONT_FAMILIES.map(f => `<button role="menuitem" class="menu-item nb-font-item" ${pd} onclick="${f.value ? `runNbFontFamily(${esc(JSON.stringify(f.value))})` : `runNbFontFamily(getComputedStyle($('#note-editor')).fontFamily)`};closeNbTypePop()" style="font-family:${esc(f.value || 'var(--font)')}">${esc(f.label)}</button>`).join('')}
    <div class="menu-label">Size</div>
    <div class="nb-size-grid">${NB_FONT_SIZES.map(sz => `<button role="menuitem" ${pd} onclick="runNbFontSize(${sz});closeNbTypePop()" aria-label="${sz} pixels">${sz}</button>`).join('')}</div>`;
}
function openNbTypePop(anchorEl, ev) {
  const pop = $('#nb-type-pop');
  if (!pop) return;
  if (pop.style.display === 'block') { closeNbTypePop(); return; }
  closeNbColorPopover();
  // A narrow canvas folds Link, Checklist (and last, Bulleted list) out of
  // the bar; each one folded there shows up here instead.
  $$('[data-nb-folded]', pop).forEach(item => {
    const btn = $(`#nb-toolbar [data-nb-fold="${item.dataset.nbFolded}"]`);
    item.classList.toggle('is-shown', !!btn && getComputedStyle(btn).display === 'none');
  });
  pop.style.display = 'block';
  anchorEl.setAttribute('aria-expanded', 'true');
  const rect = anchorEl.getBoundingClientRect();
  const w = pop.offsetWidth || 272, h = pop.offsetHeight || 320;
  let left = Math.min(rect.left + rect.width / 2 - w / 2, window.innerWidth - w - 8);
  let top = rect.bottom + 8;
  if (top + h > window.innerHeight - 8) top = rect.top - h - 8;
  pop.style.left = Math.max(8, left) + 'px';
  pop.style.top = Math.max(8, top) + 'px';
  nbHideBubble(); // one formatting surface at a time
  updateNbFormatState();
  // Opened from the keyboard, focus goes into the menu.
  if (ev && ev.detail === 0) nbMenuItems(pop)[0]?.focus({ preventScroll: true });
  document.removeEventListener('mousedown', nbTypePopOutside);
  document.removeEventListener('keydown', nbTypePopKeydown);
  setTimeout(() => {
    document.addEventListener('mousedown', nbTypePopOutside);
    document.addEventListener('keydown', nbTypePopKeydown);
  }, 0);
}
function nbTypePopOutside(e) {
  const pop = $('#nb-type-pop');
  if (!pop || pop.style.display !== 'block' || pop.contains(e.target) || e.target.closest?.('#nb-type-btn')) return;
  closeNbTypePop();
}
function nbTypePopKeydown(e) { if (e.key === 'Escape') { closeNbTypePop(); $('#nb-type-btn')?.focus({ preventScroll: true }); } }
function closeNbTypePop() {
  const pop = $('#nb-type-pop');
  if (pop) pop.style.display = 'none';
  $('#nb-type-btn')?.setAttribute('aria-expanded', 'false');
  document.removeEventListener('mousedown', nbTypePopOutside);
  document.removeEventListener('keydown', nbTypePopKeydown);
}

/* ── Phone keyboard bar: #nb-toolbar docks above the keyboard while the
   note is being written. --nb-kb is set on <body> so it survives the
   innerHTML re-render; the bar shows only while .is-editing is on. ── */
function nbUpdateKeyboardInset() {
  const vv = window.visualViewport;
  const kb = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
  const bar = document.getElementById('sidebar');
  const tabBar = bar && window.matchMedia('(max-width: 760px)').matches ? bar.offsetHeight : 0;
  document.body.style.setProperty('--nb-kb', (kb > 0 ? kb : tabBar) + 'px');
}
function nbHideBubble() { const b = $('#nb-bubble'); if (b) b.style.display = 'none'; }
function nbPopoverOpen() {
  return ['#nb-type-pop', '#nb-color-popover'].some(sel => { const el = $(sel); return el && el.style.display === 'block'; });
}
const NB_TODO_HIT_MQ = '(max-width: 760px), (pointer: coarse)';
let _nbKbWired = false;
function wireNbKeyboardBar() {
  if (_nbKbWired) return;
  _nbKbWired = true;
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', nbUpdateKeyboardInset);
    window.visualViewport.addEventListener('scroll', nbUpdateKeyboardInset);
  }
  window.addEventListener('resize', nbUpdateKeyboardInset);
  document.addEventListener('focusin', e => {
    if (e.target.closest?.('#note-editor')) $('.notebook-layout')?.classList.add('is-editing');
  });
  document.addEventListener('focusout', e => {
    if (!e.target.closest?.('#note-editor')) return;
    setTimeout(() => {
      const a = document.activeElement;
      if (a && a.closest?.('#note-editor, #nb-toolbar, #nb-type-pop, #nb-color-popover')) return;
      if (nbPopoverOpen()) return;
      $('.notebook-layout')?.classList.remove('is-editing');
    }, 150);
  });
  // A checked box is saved as checked, so it survives a reload.
  document.addEventListener('change', e => {
    const box = e.target;
    if (!box.matches?.('#note-editor .nb-todo-line input[type=checkbox]')) return;
    box.toggleAttribute('checked', box.checked);
    const editor = $('#note-editor');
    if (editor && window._nbCurrentNoteId) saveNoteContentDebounced(window._nbCurrentNoteId, editor.innerHTML);
  });
  // On a phone the 18px box has a 44px hit area (a ::before on the line,
  // see notebook.css); a tap there lands on the line, so toggle it here.
  document.addEventListener('click', e => {
    const line = e.target;
    if (!line.matches?.('#note-editor .nb-todo-line') || !window.matchMedia(NB_TODO_HIT_MQ).matches) return;
    const box = line.querySelector(':scope > input[type=checkbox]');
    if (!box) return;
    const r = box.getBoundingClientRect();
    if (Math.abs(e.clientX - (r.left + r.width / 2)) > 22 || Math.abs(e.clientY - (r.top + r.height / 2)) > 22) return;
    e.preventDefault();
    box.checked = !box.checked;
    box.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // The bar gets its hairline once the page scrolls under it.
  window.addEventListener('scroll', nbSyncStuck, { passive: true });
}
function nbSyncStuck() {
  const bar = $('.nb-topbar');
  if (!bar) return;
  const page = $('#nb-page');
  const y = Math.max(page ? page.scrollTop : 0, window.matchMedia('(max-width: 760px)').matches ? window.scrollY : 0);
  bar.classList.toggle('is-stuck', y > 4);
}
function wireNbStuckBar() {
  const page = $('#nb-page');
  if (page) page.addEventListener('scroll', nbSyncStuck, { passive: true });
  nbSyncStuck();
}

/* ── Show or hide the notes list, for more room to write (most of all on a
   phone, where the list sits above the note). Toggled from the page head, or
   by clicking Notebook in the sidebar while already on this page. Kept per
   device rather than in synced settings, so hiding it on a phone doesn't hide
   it on a laptop. Flips a class on the live layout instead of re-rendering,
   so the open note keeps its caret and scroll position. ── */
const NB_LIST_HIDDEN_KEY = 'shq_nb_list_hidden';
let _nbListHidden = null;
function notebookListHidden() {
  if (_nbListHidden === null) { try { _nbListHidden = localStorage.getItem(NB_LIST_HIDDEN_KEY) === '1'; } catch { _nbListHidden = false; } }
  return _nbListHidden;
}
function notebookListToggleLabel(hidden) { return icon('panel-left', 16); }
function toggleNotebookList() {
  _nbListHidden = !notebookListHidden();
  try { localStorage.setItem(NB_LIST_HIDDEN_KEY, _nbListHidden ? '1' : '0'); } catch {}
  const layout = $('.notebook-layout');
  if (!layout) { render(); return; }
  layout.classList.add('nb-animating');
  layout.classList.toggle('list-hidden', _nbListHidden);
  setTimeout(() => layout.classList.remove('nb-animating'), 260);
  const btn = $('#nb-list-toggle');
  if (btn) {
    const label = _nbListHidden ? 'Show notes list' : 'Hide notes list';
    btn.innerHTML = notebookListToggleLabel(_nbListHidden);
    btn.setAttribute('aria-expanded', String(!_nbListHidden));
    btn.setAttribute('aria-label', label);
    btn.setAttribute('data-tip', label);
  }
  renderSidebar();
}

// touch() does a full innerHTML re-render, which swaps in a brand-new <input>
// element. On a plain oninput="...;touch()" (which is what this used to be)
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

// Obsidian-style resizable notebook sidebar: dragging updates the live DOM
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
  const handle = e.currentTarget && e.currentTarget.classList ? e.currentTarget : $('.notebook-resize-handle');
  handle?.classList.add('is-dragging');
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
    handle?.classList.remove('is-dragging');
    state.settings.notebookTreeWidth = panel.getBoundingClientRect().width;
    save();
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
// The same handle from the keyboard: arrow keys step 16px, saved the same way.
function onNotebookResizeKey(e) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const panel = $('#notebook-tree-panel');
  if (!panel) return;
  const width = clamp(panel.getBoundingClientRect().width + (e.key === 'ArrowRight' ? 16 : -16), 200, 520);
  panel.style.setProperty('--nb-tree-w', width + 'px');
  state.settings.notebookTreeWidth = width;
  save();
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
    // While Aa or a color popover is open, the bubble stays down.
    if (nbPopoverOpen() || window._nbImg) { bar.style.display = 'none'; return; }
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
  // there), never from the document-wide selectionchange event, which also fires
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
  // moves elsewhere (e.g. clicking away); it must never touch the saved range.
  if (window._nbBubbleUpdate) document.removeEventListener('selectionchange', window._nbBubbleUpdate);
  window._nbBubbleUpdate = positionBubble;
  document.addEventListener('selectionchange', window._nbBubbleUpdate);
  updateNbFormatState();
}
// Toggles bold/italic/underline/strikethrough active state on every toolbar button
// (bubble + persistent) that declares data-nb-cmd, so the toolbar reflects the
// formatting under the cursor instead of always looking unpressed.
const NB_STATE_CMDS = ['bold', 'italic', 'underline', 'strikeThrough'];
const NB_BLOCK_STYLES = ['P', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'PRE'];
function updateNbFormatState() {
  // Only a selection inside the note says anything about its formatting.
  const sel = window.getSelection();
  const editor = $('#note-editor');
  const inEditor = !!(editor && sel && sel.anchorNode && editor.contains(sel.anchorNode));
  NB_STATE_CMDS.forEach(cmd => {
    let active = false;
    if (inEditor) { try { active = document.queryCommandState(cmd); } catch { } }
    $$(`#nb-toolbar [data-nb-cmd="${cmd}"], #nb-type-pop [data-nb-cmd="${cmd}"], #nb-bubble [data-nb-cmd="${cmd}"]`).forEach(btn => {
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  });
  const style = $('#nb-style-select');
  if (style && document.activeElement !== style) {
    let block = '';
    if (inEditor) { try { block = String(document.queryCommandValue('formatBlock') || '').toUpperCase(); } catch { } }
    style.value = NB_BLOCK_STYLES.includes(block) ? block : 'P';
  }
}
// The "Type '/' for commands" hint should only ever show on the one line the
// caret is actually on (same as Notion, which this is modeled after), not on
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
// running a format command: clicking a toolbar button can otherwise collapse
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
  nbTagInks(editor);
  if (window._nbCurrentNoteId) saveNoteContentDebounced(window._nbCurrentNoteId, editor.innerHTML);
}
function clearNbHighlight() {
  const editor = $('#note-editor');
  if (!editor) return;
  restoreNbSelection();
  document.execCommand('hiliteColor', false, 'transparent');
  nbTagInks(editor);
  if (window._nbCurrentNoteId) saveNoteContentDebounced(window._nbCurrentNoteId, editor.innerHTML);
  closeNbColorPopover();
}
function updateNbColorSwatches() {
  // No color picked yet: the swatch is the text color (currentColor in CSS).
  $$('.nb-textcolor-swatch').forEach(el => el.style.background = window._nbLastTextColor || '');
  $$('.nb-highlightcolor-swatch').forEach(el => el.style.background = window._nbLastHighlightColor || '#fde68a');
}
/* ── User-picked colors in dark mode ─────────────────────────────
   A yellow highlight or a black text color is chosen on one theme and
   read on another. Each inline highlight is tagged with the ink it needs
   (data-hl light/dark), and an inline text color that sinks into the
   page (under 3:1 against --surface) is tagged data-ink, so the CSS can
   swap in a readable ink. The saved color never changes; exports are
   sanitized, so the tags never reach a PDF. ── */
let _nbColorCtx = null;
function nbRgb(str) {
  if (!str) return null;
  if (!_nbColorCtx) { try { _nbColorCtx = document.createElement('canvas').getContext('2d'); } catch { return null; } }
  if (!_nbColorCtx) return null;
  _nbColorCtx.fillStyle = '#010203';
  _nbColorCtx.fillStyle = str;
  const v = _nbColorCtx.fillStyle;
  if (v === '#010203' && !/^#?010203$/i.test(str.trim())) return null;
  let m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(v);
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), 1];
  m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(v);
  return m ? [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]] : null;
}
function nbLum([r, g, b]) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function nbContrast(a, b) { const x = nbLum(a), y = nbLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function nbTagInks(root) {
  if (!root) return;
  const surface = nbRgb(getComputedStyle($('#nb-page') || root).backgroundColor) || [255, 255, 255, 1];
  const dark = document.documentElement.classList.contains('dark');
  const INK = [18, 18, 18], BONE = [248, 246, 242];
  root.querySelectorAll('[style*="background"]').forEach(el => {
    const bg = nbRgb(el.style.backgroundColor);
    if (!bg || bg[3] === 0) { el.removeAttribute('data-hl'); return; }
    el.setAttribute('data-hl', nbContrast(bg, INK) >= nbContrast(bg, BONE) ? 'light' : 'dark');
  });
  root.querySelectorAll('[style*="color"], font[color]').forEach(el => {
    const raw = el.style.color || (el.tagName === 'FONT' ? el.getAttribute('color') : '');
    const fg = nbRgb(raw);
    if (!fg || el.closest('[data-hl]')) { el.removeAttribute('data-ink'); return; }
    if (nbContrast(fg, surface) < 3) el.setAttribute('data-ink', dark ? 'dark' : 'light');
    else el.removeAttribute('data-ink');
  });
}
/* ── Text/highlight color popover: a gradient color wheel (see colorwheel.js,
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
  nbHideBubble(); // after placing, since the anchor may be a bubble button
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
// The editor's selection is captured on mouseup/keyup (see wireBubbleToolbar)
// and put back by runNbCommand, so a dialog can sit in between without the
// link landing somewhere else.
function promptInsertLink() {
  openModal(`
    <div class="modal-head"><h3>Insert a link</h3>${closeXButton()}</div>
    <div class="modal-body">
      <div class="field"><label for="nb-link-url">Link</label><input class="input" id="nb-link-url" type="url" placeholder="https://" onkeydown="if(event.key==='Enter'){event.preventDefault();insertNbLink()}"></div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="insertNbLink()">Insert</button></div>
  `);
}
function insertNbLink() {
  let url = ($('#nb-link-url')?.value || '').trim();
  if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
  if (!isHttpUrl(url)) { toast('Paste a link that starts with http:// or https://', 'error'); return; }
  closeModal();
  runNbCommand('createLink', url);
}

/* ── Font family / size / color: the editor otherwise had no way to change
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
// marker (size 7) and then swapped for a real pixel value via inline style. This is the
// standard workaround since there's no execCommand for an arbitrary font size.
// Chrome's fontSize command replaces (rather than extends) an existing <font
// face> wrapper around the same selection, so the chosen font family is
// re-applied onto the resulting span, otherwise picking a size after a family
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
  nbTagInks(editor);
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
  // Keyboard: arrows move the highlight, Enter or Tab runs it, Escape
  // closes. Before this the menu could only be used with a mouse, and Enter
  // on a highlighted command just inserted a blank line under "/todo".
  window._nbSlashKeydown = (e) => {
    if (menu.style.display !== 'block') return;
    if (e.key === 'Escape') { hideSlashMenu(); return; }
    const items = Array.from($$('.nb-slash-item', menu)).filter(el => el.style.display !== 'none');
    if (!items.length) return;
    const current = Math.max(0, items.findIndex(el => el.classList.contains('is-active')));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = (current + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      items.forEach((el, i) => el.classList.toggle('is-active', i === next));
      items[next].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      runSlashCommand(items[current].dataset.key);
    }
  };
  editor.addEventListener('keydown', window._nbSlashKeydown);
}
// Empty query: every block, in its group. With a query: the groups go and
// the matches are ranked (the key starts with it, then the label starts
// with it, then the label or description contains it; ties go to the
// layouts, so "/c" is still Cornell and "/l" still Lab report).
function slashGlyphHtml(c) {
  return c.glyph ? `<span class="nb-slash-glyph is-h nb-slash-${c.key}" aria-hidden="true">${c.glyph.replace(/(\d)/, '<span class="nb-slash-digit">$1</span>')}</span>` : `<span class="nb-slash-glyph" aria-hidden="true">${icon(c.icon || 'type', 16)}</span>`;
}
function slashItemHtml(c) {
  return `<div class="nb-slash-item" role="option" data-key="${c.key}" onmousedown="event.preventDefault()" onclick="runSlashCommand('${c.key}')">${slashGlyphHtml(c)}<span class="nb-slash-text"><span class="nb-slash-label">${esc(c.label)}</span><span class="nb-slash-desc">${esc(c.desc)}</span></span></div>`;
}
function rankSlashCommands(query) {
  const q = query.toLowerCase();
  const rank = c => {
    const label = c.label.toLowerCase();
    if (c.key.startsWith(q)) return 0;
    if (label.startsWith(q)) return 1;
    if (label.includes(q) || c.desc.toLowerCase().includes(q) || c.key.includes(q)) return 2;
    return -1;
  };
  return SLASH_COMMANDS.map((c, i) => ({ c, r: rank(c), i }))
    .filter(x => x.r >= 0)
    .sort((a, b) => a.r - b.r || (a.c.group === 'Layouts' ? 0 : 1) - (b.c.group === 'Layouts' ? 0 : 1) || a.i - b.i)
    .map(x => x.c);
}
function showSlashMenu(rect, query) {
  const menu = $('#nb-slash-menu');
  if (!menu) return;
  let body;
  if (!query) {
    const groups = [...new Set(SLASH_COMMANDS.map(c => c.group))];
    body = groups.map(g => `<div class="nb-slash-group" role="presentation">${esc(g)}</div>${SLASH_COMMANDS.filter(c => c.group === g).map(slashItemHtml).join('')}`).join('');
  } else {
    const list = rankSlashCommands(query);
    body = list.length ? list.map(slashItemHtml).join('') : '<div class="nb-slash-none">No matching blocks</div>';
  }
  menu.innerHTML = `<div class="nb-slash-list">${body}</div><div class="nb-slash-foot" aria-hidden="true">↑↓ to choose · Enter to add · Esc to close</div>`;
  // The first match is highlighted, so Enter always has something to run.
  const first = $('.nb-slash-item', menu);
  if (first) first.classList.add('is-active');
  menu.style.display = 'block';
  const h = menu.offsetHeight || 360;
  let top = rect.bottom + 6;
  if (rect.bottom + h + 12 > window.innerHeight) top = rect.top - h - 6;
  menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 312)) + 'px';
  menu.style.top = Math.max(8, top) + 'px';
}
function hideSlashMenu() { const m = $('#nb-slash-menu'); if (m) m.style.display = 'none'; }
function nbSlashLeaveContainer(block, editor) {
  let outer = null;
  for (let el = block; el && el !== editor; el = el.parentElement) if (/^(UL|OL|BLOCKQUOTE|PRE)$/.test(el.tagName)) outer = el;
  if (!outer) return block;
  const p = document.createElement('p');
  p.innerHTML = '<br>';
  outer.after(p);
  // Take the emptied line out, and any list or quote it leaves empty.
  let up = block === outer ? null : block.parentElement;
  block.remove();
  while (up && up !== editor && outer.contains(up) && !up.textContent.trim() && !up.querySelector('img, hr, input, table')) { const next = up.parentElement; up.remove(); if (up === outer) break; up = next; }
  if (outer.isConnected && !outer.textContent.trim() && !outer.querySelector('img, hr, input, table')) outer.remove();
  return p;
}
function runSlashCommand(key) {
  const block = window._slashBlock;
  const editor = $('#note-editor');
  if (block && editor) {
    // Typed straight into an empty note, the "/query" is a bare text node
    // and its "block" is the editor itself; give it a paragraph to replace
    // instead of replacing the editor.
    let target = block;
    if (block === editor) { editor.innerHTML = '<p><br></p>'; target = editor.firstChild; window._slashBlock = target; }
    else {
      block.textContent = '';
      // A block or layout picked on a list line, or inside a quote or code
      // block, lands on a new line after it, never inside it. The two list
      // commands are left to the browser, which switches the list type.
      if (key !== 'bullet' && key !== 'number') { target = nbSlashLeaveContainer(block, editor); window._slashBlock = target; }
    }
    const range = document.createRange();
    range.selectNodeContents(target);
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

// A folder has no updatedAt of its own. For the "Edited" sort this stands in
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
  // Pinned notes live in the Pinned list above, never twice.
  let notes = children.filter(n => n.type === 'note' && !n.pinned);
  if (sort === 'alpha') folders = [...folders].sort((a, b) => a.name.localeCompare(b.name));
  else folders = [...folders].sort((a, b) => folderLatestActivity(b.id) - folderLatestActivity(a.id));
  notes = sortNotebookNotes(notes, sort);
  const selectedId = state.notebookSelected || state.notes.find(x => x.type === 'note')?.id;

  const rows = [...folders, ...notes].map(n => {
    if (n.type === 'folder') {
      const inner = notebookTree(n.id, depth + 1, search, sort);
      if (search && !inner) return '';
      const open = n.open || !!search;
      const count = state.notes.filter(x => x.type === 'note' && x.parentId === n.id && !x.pinned).length;
      const onlyPinned = !inner && state.notes.some(x => x.type === 'note' && x.parentId === n.id && x.pinned);
      return `<div class="nb-branch">
        <div class="nb-folder-row" onclick="toggleFolder('${n.id}')">
          <span class="nb-chevron ${open ? 'open' : ''}">${icon('chevron-right', 12)}</span>
          <span class="nb-folder-ic">${icon(open ? 'folder-open' : 'folder', 16)}</span>
          <span class="nb-folder-name" title="${esc(n.name)}">${esc(n.name)}</span>
          ${count ? `<span class="nb-count">${count}</span>` : ''}
          <span class="nb-folder-actions">
            <button class="btn btn-ghost btn-icon btn-sm" onclick="event.stopPropagation();createFolder('${n.id}')" data-tip="New subfolder" aria-label="New subfolder in ${esc(n.name)}">${icon('folder-plus', 14)}</button>
            <button class="btn btn-ghost btn-icon btn-sm" onclick="event.stopPropagation();createNote('${n.id}')" data-tip="New note" aria-label="New note in ${esc(n.name)}">${icon('plus', 14)}</button>
            ${n.id !== 'root' ? `<button class="btn btn-ghost btn-icon btn-sm" onclick="event.stopPropagation();shareFolderToGroup('${n.id}')" data-tip="Share with a group" aria-label="Share ${esc(n.name)} with a group">${icon('users', 14)}</button>` : ''}
            ${n.id !== 'root' ? `<button class="btn btn-ghost btn-icon btn-sm" data-tip="Delete folder" aria-label="Delete ${esc(n.name)}" onclick="event.stopPropagation();deleteNoteItem('${n.id}')">${icon('trash', 14)}</button>` : ''}
          </span>
        </div>
        ${open ? `<div class="nb-children">${inner || (onlyPinned ? '<div class="nb-folder-note">Pinned notes show above</div>' : '')}</div>` : ''}
      </div>`;
    }
    if (!notebookNoteMatches(n, search)) return '';
    return nbNoteRowHtml(n, selectedId);
  });
  return rows.join('');
}
function toggleFolder(id) { const f = state.notes.find(n => n.id === id); f.open = !f.open; touch(); }
// On a phone the list and the note take turns filling the screen: opening a
// note hides the list, and the note's "Notes" button brings it back.
function nbShowNoteOnPhone() {
  if (window.matchMedia('(max-width: 760px)').matches && !notebookListHidden()) {
    _nbListHidden = true;
    try { localStorage.setItem(NB_LIST_HIDDEN_KEY, '1'); } catch {}
  }
}
function selectNote(id) {
  nbShowNoteOnPhone();
  setState({ notebookSelected: id });
}
// The note's "More" menu is a <details>; a click anywhere else closes it.
document.addEventListener('click', e => {
  document.querySelectorAll('details.nb-more[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; });
  // Opened from the keyboard (a click with no pointer), focus goes to the first item.
  const summary = e.target.closest?.('details.nb-more > summary');
  if (summary && e.detail === 0) setTimeout(() => { const d = summary.parentElement; if (d.open) nbMenuItems(d)[0]?.focus({ preventScroll: true }); }, 0);
});
// The ··· note menu and the Aa popover work like menus from the keyboard:
// arrows, Home and End move between items; Escape and Tab close back to
// the button that opened them.
function nbMenuItems(root) { return [...root.querySelectorAll('[role=menuitem]')].filter(b => !b.disabled && b.getClientRects().length); }
document.addEventListener('keydown', e => {
  const t = e.target;
  const more = t.closest?.('details.nb-more[open]');
  const pop = $('#nb-type-pop');
  const popOpen = !more && pop && pop.style.display === 'block' && (pop.contains(t) || t.id === 'nb-type-btn');
  if (!more && !popOpen) return;
  const root = more || pop;
  const trigger = more ? more.querySelector('summary') : $('#nb-type-btn');
  const list = nbMenuItems(root);
  const i = list.indexOf(document.activeElement);
  const go = n => { e.preventDefault(); list[n]?.focus({ preventScroll: true }); };
  if (e.key === 'ArrowDown') go(i < 0 ? 0 : (i + 1) % list.length);
  else if (e.key === 'ArrowUp') go(i < 0 ? list.length - 1 : (i - 1 + list.length) % list.length);
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(list.length - 1);
  else if (e.key === 'Escape' && more) { e.preventDefault(); more.open = false; trigger?.focus({ preventScroll: true }); }
  else if (e.key === 'Tab') {
    // Back on the trigger first, so the browser's own Tab moves on from it.
    if (more) more.open = false; else closeNbTypePop();
    trigger?.focus({ preventScroll: true });
  }
});
function createFolder(parentId) {
  const parent = state.notes.find(n => n.id === parentId);
  openModal(`
    <div class="modal-head"><h3>New folder</h3>${closeXButton()}</div>
    <div class="modal-body">
      <div class="field"><label for="nb-folder-name">Folder name</label><input class="input" id="nb-folder-name" maxlength="80" placeholder="Bio 101, Week 3, Exam prep" onkeydown="if(event.key==='Enter'){event.preventDefault();commitCreateFolder('${parentId}')}"></div>
      ${parent && parent.id !== 'root' ? `<p class="small muted">Inside ${esc(parent.name)}.</p>` : ''}
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="commitCreateFolder('${parentId}')">Create folder</button></div>
  `);
}
function commitCreateFolder(parentId) {
  const name = ($('#nb-folder-name')?.value || '').trim();
  if (!name) { toast('Give the folder a name', 'error'); return; }
  closeModal();
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
  // A new note opens straight away, on a phone too (not behind the list),
  // ready to type into.
  window._nbFocusTitle = id;
  nbShowNoteOnPhone();
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
    <div class="modal-head"><h3>Move note</h3>${closeXButton()}</div>
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
  // confirmDialog escapes the message itself.
  const msg = root?.type === 'folder'
    ? 'Delete this? Folders delete everything inside them. You can restore it from Recently Deleted for 30 days.'
    : `Delete “${root?.name && root.name !== 'Untitled note' ? root.name : 'Untitled'}”? You can restore it from Recently Deleted for 30 days.`;
  confirmDialog(msg, () => {
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
  window._nbRendered = { id: note.id, note, content: note.content };
  const words = plainTextOfNote(note).trim().split(/\s+/).filter(Boolean).length;
  const shared = !!note.shared;
  const rec = shared ? note.rec : null;
  const isOwner = shared && rec?.ownerUid === _fbUser?.uid;
  const crumbs = shared ? ['Shared'] : notePath(note);
  const tpl = noteTemplateOf(note);
  const tplDef = tpl ? NOTE_TEMPLATES[tpl] : null;
  const blank = !tpl && noteIsBlank(note);
  if (tpl !== 'cornell') window._nbCovered = false;
  const covered = !!window._nbCovered;
  const labSections = tpl === 'lab' ? labSectionsOf(new DOMParser().parseFromString('<!doctype html><html><body>' + sanitizeHtml(note.content || '') + '</body></html>', 'text/html').body) : [];
  const course = note.courseId ? getCourse(note.courseId) : null;
  const dateLabel = tpl === 'lab' ? 'Lab date' : tplDef?.sheet ? 'Date' : 'Lecture date';
  const pd = 'onmousedown="event.preventDefault()"';
  // The Cornell how-to shows on a student's first Cornell note only.
  const hint = tpl === 'cornell' ? state.settings.nbCornellHintNote !== note.id ? '' : 'Cues and questions in one column, notes in the other. Afterward, sum it up at the bottom and use Cover notes to test yourself.'
    : tpl === 'lab' ? 'Work down the sections. The tracker above fills in as you go, and Table row grows the data table.'
    : tplDef?.hint || '';
  return `
    <div class="nb-topbar">
      <div class="nb-topbar-left">
        ${nbListToggleHtml(notebookListHidden())}
        ${nbBackHtml()}
        <div class="nb-breadcrumb">Notebook${crumbs.map(c => `<span class="nb-crumb-sep" aria-hidden="true">/</span>${esc(c)}`).join('')}</div>
      </div>
      <div class="nb-toolbar" id="nb-toolbar" role="toolbar" aria-label="Formatting">
        <select class="nb-toolbar-select" id="nb-style-select" aria-label="Text style" onmousedown="event.stopPropagation()" onchange="restoreNbSelection();runNbCommand('formatBlock', this.value)">
          <option value="P">Text</option><option value="H1">Heading 1</option><option value="H2">Heading 2</option><option value="H3">Heading 3</option><option value="BLOCKQUOTE">Quote</option><option value="PRE">Code</option>
        </select>
        <span class="nb-toolbar-sep" aria-hidden="true"></span>
        <button data-nb-cmd="bold" ${pd} onclick="runNbCommand('bold')" aria-label="Bold" aria-pressed="false" data-tip="Bold" data-tip-kbd="B"><b>B</b></button>
        <button data-nb-cmd="italic" ${pd} onclick="runNbCommand('italic')" aria-label="Italic" aria-pressed="false" data-tip="Italic" data-tip-kbd="I"><i>I</i></button>
        <span class="nb-toolbar-sep" aria-hidden="true"></span>
        <button class="nb-toolbar-color" ${pd} onclick="openNbColorPopover(this,'highlight')" aria-label="Highlight color" data-tip="Highlight">${icon('highlighter', 16)}<span class="nb-color-swatch nb-highlightcolor-swatch"></span></button>
        <span class="nb-toolbar-sep" aria-hidden="true"></span>
        <button data-nb-fold="list" ${pd} onclick="runNbCommand('insertUnorderedList')" aria-label="Bulleted list" data-tip="Bulleted list">${icon('list', 16)}</button>
        <button data-nb-fold="checklist" ${pd} onclick="insertNbChecklist()" aria-label="Checklist" data-tip="Checklist">${icon('check-square', 16)}</button>
        <span class="nb-toolbar-sep" aria-hidden="true"></span>
        <button data-nb-fold="image" ${pd} onclick="nbPickPicture()" aria-label="Add a picture" data-tip="Picture">${icon('image', 16)}</button>
        <button data-nb-fold="table" ${pd} onclick="openNbTablePick(this)" aria-label="Add a table" aria-haspopup="dialog" data-tip="Table">${icon('table', 16)}</button>
        <span class="nb-toolbar-sep" aria-hidden="true"></span>
        <button data-nb-fold="link" ${pd} onclick="promptInsertLink()" aria-label="Insert link" data-tip="Link">${icon('link', 16)}</button>
        <button id="nb-type-btn" ${pd} onclick="openNbTypePop(this, event)" aria-label="More formatting" aria-haspopup="menu" aria-expanded="false" data-tip="More formatting">${icon('type', 16)}</button>
      </div>
      <div class="nb-page-actions">
        ${signInHeaderButton()}
        ${tpl === 'cornell' ? `<button class="btn btn-ghost btn-sm nb-act-cover ${covered ? 'is-on' : ''}" id="nb-cover-btn" aria-pressed="${covered}" aria-label="${covered ? 'Reveal notes' : 'Cover notes'}" data-tip="Hide the notes column and answer from your cues" onclick="toggleCornellCover()">${nbCoverBtnInner(covered)}</button>` : ''}
        ${shared ? `<div class="nb-people" id="nb-shared-people">${nbSharedPeopleHtml()}</div>` : `<button class="btn btn-ghost btn-sm btn-icon nb-act-pin ${note.pinned ? 'is-on' : ''}" aria-pressed="${!!note.pinned}" aria-label="${note.pinned ? 'Unpin note' : 'Pin note'}" data-tip="${note.pinned ? 'Unpin note' : 'Pin note'}" onclick="toggleNotePinned('${note.id}')">${icon('pin', 16)}</button>
        <button class="btn btn-ghost btn-sm nb-act-cards" aria-label="Flashcards" data-tip="Make flashcards from this note" onclick="openGenerateDeckModal('${note.id}')">${icon('layers', 16)}<span class="nb-act-label">Flashcards</span></button>`}
        <button class="btn btn-ghost btn-sm nb-act-share" aria-label="Share" data-tip="${shared ? 'Who can edit, and the invite link' : 'Edit together, or send a copy'}" onclick="${shared ? `nbOpenSharedPanel('${note.id}')` : `openNoteShareModal('${note.id}')`}">${icon('users', 16)}<span class="nb-act-label">Share</span></button>
        <details class="nb-more">
          <summary class="btn btn-ghost btn-sm btn-icon" aria-label="More for this note" data-tip="More">${icon('more-horizontal', 16)}</summary>
          <div class="nb-more-menu menu-surface" role="menu">
            ${shared ? '' : `<button role="menuitem" class="menu-item nb-menu-phone nb-menu-pin" onclick="this.closest('details').open=false;toggleNotePinned('${note.id}')">${icon('pin', 16)}<span>${note.pinned ? 'Unpin note' : 'Pin note'}</span></button>
            <button role="menuitem" class="menu-item nb-menu-phone" onclick="this.closest('details').open=false;openGenerateDeckModal('${note.id}')">${icon('layers', 16)}<span>Make flashcards</span></button>`}
            ${tpl === 'cornell' ? `<button role="menuitem" class="menu-item nb-menu-phone" id="nb-cover-item" onclick="this.closest('details').open=false;toggleCornellCover()">${nbCoverIcon(covered)}<span>${covered ? 'Reveal notes' : 'Cover notes'}</span></button>` : ''}
            ${shared ? `<button role="menuitem" class="menu-item" onclick="this.closest('details').open=false;nbCopySharedToMine('${note.sid}')">${icon('copy', 16)}<span>Save a copy to my notebook</span></button>`
              : `<button role="menuitem" class="menu-item" onclick="this.closest('details').open=false;duplicateNote('${note.id}')">${icon('copy', 16)}<span>Duplicate</span></button>
            <button role="menuitem" class="menu-item" onclick="this.closest('details').open=false;openMoveNoteModal('${note.id}')">${icon('folder', 16)}<span>Move to a folder</span></button>`}
            <button role="menuitem" class="menu-item" onclick="this.closest('details').open=false;triggerNoteFileUpload('${note.id}')">${icon('upload', 16)}<span>Upload a file</span></button>
            <button role="menuitem" class="menu-item" onclick="this.closest('details').open=false;exportNoteToPdf('${note.id}')">${icon('download', 16)}<span>Export as PDF</span></button>
            ${!shared ? `<div class="menu-sep" role="separator"></div>
            <button role="menuitem" class="menu-item is-danger" onclick="this.closest('details').open=false;deleteNoteItem('${note.id}')">${icon('trash', 16)}<span>Delete note</span></button>`
              : isOwner ? `<div class="menu-sep" role="separator"></div>
            <button role="menuitem" class="menu-item is-danger" onclick="this.closest('details').open=false;nbDeleteShared('${note.sid}')">${icon('trash', 16)}<span>Delete for everyone</span></button>`
              : rec?.editorUids.includes(_fbUser?.uid) ? `<div class="menu-sep" role="separator"></div>
            <button role="menuitem" class="menu-item" onclick="this.closest('details').open=false;nbLeaveShared('${note.sid}')">${icon('log-out', 16)}<span>Leave this note</span></button>` : ''}
          </div>
        </details>
      </div>
    </div>
    <div class="nb-page-inner ${tpl ? `tpl-${tpl}` : ''} ${shared ? 'is-shared' : ''}">
      ${shared ? '<div class="nb-carets" id="nb-carets" aria-hidden="true"></div>' : ''}
      <textarea id="nb-title-input" class="nb-title-input" rows="1" aria-label="Note title" placeholder="${tpl === 'cornell' ? 'Lecture topic' : tpl === 'lab' ? 'Experiment title' : esc(tplDef?.titlePh || 'Untitled')}" oninput="renameNote('${note.id}',this.value);nbAutosizeTitle(this)" onkeydown="nbTitleKeydown(event)" onpaste="nbTitlePaste(event)">${esc(note.name === 'Untitled note' ? '' : note.name)}</textarea>
      <div class="nb-props">
        ${shared ? `<button type="button" class="nb-prop nb-prop-shared" onclick="nbOpenSharedPanel('${note.id}')" data-tip="Who can edit">${icon('users', 14)}<span class="nb-prop-text">${esc(nbSharedWhere(rec))}</span></button>` : `<div class="nb-prop nb-prop-course ${course ? '' : 'is-empty'}">
          ${course ? `<span class="nb-prop-dot" style="background:${getCourseColor(note.courseId)}" aria-hidden="true"></span><span class="nb-prop-text">${esc(course.name)}</span>` : '<span class="nb-prop-text">Add class</span>'}${icon('chevron-down', 12)}
          <select class="nb-course-select" aria-label="Class" onchange="setNoteCourse('${note.id}',this.value)">
            <option value="">No class</option>${activeCourses().map(c => `<option value="${c.id}" ${c.id === note.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </div>`}
        ${tpl && !shared ? `<div class="nb-prop nb-prop-date ${note.date ? '' : 'is-empty'}">${icon('calendar', 14)}<span class="nb-prop-text">${note.date ? esc(fmtDate(note.date, { month: 'short', day: 'numeric' })) : 'Add date'}</span>
          <input type="date" class="nb-date-input" value="${esc(note.date || '')}" aria-label="${dateLabel}" onclick="try{this.showPicker()}catch(e){}" onchange="setNoteDate('${note.id}',this.value)">
        </div>
        <button type="button" class="nb-prop nb-prop-tpl" aria-label="Layout: ${esc(tplDef.label)}. Add another layout" data-tip="Add a layout" onclick="openNoteTemplateModal('${note.parentId}','${note.id}')">${icon(tplDef.icon, 14)}<span>${esc(tplDef.label)}</span></button>` : ''}
        <span class="nb-prop-status" id="nb-save-status">Edited ${nbEditedWhen(note.updatedAt)} · ${words} word${words === 1 ? '' : 's'}</span>
      </div>
      ${tpl === 'lab' ? `<div class="nb-lab-rail" id="nb-lab-rail" data-keep-scroll>${labRailHtml(labSections)}</div>` : ''}
      ${hint && words < 20 ? `<div class="nb-hint">${icon('info', 16)}<span>${esc(hint)}</span></div>` : ''}
      <div class="rich-editor nb-editor-body ${tpl ? `nb-tpl-${tpl}` : ''} ${covered ? 'is-covered' : ''}" id="note-editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Note" data-placeholder="Start writing…" oninput="onNoteEdit('${note.id}', this)">${sanitizeHtml(note.content || '')}</div>
      ${blank ? `<div class="nb-tpl-start" id="nb-tpl-start">
        <div class="nb-tpl-start-label">Start from a layout</div>
        ${['cornell', 'lecture', 'lab', 'exam'].map(k => `<button type="button" class="nb-tpl-start-row" onclick="applyNoteTemplate('${note.id}','${k}')">${icon(NOTE_TEMPLATES[k].icon, 16)}<span>${esc(NOTE_TEMPLATES[k].label)}</span></button>`).join('')}
        <button type="button" class="nb-tpl-start-row" onclick="openNoteTemplateModal('${note.parentId}','${note.id}')">${icon('grid', 16)}<span>More layouts…</span></button>
      </div>` : ''}
    </div>
  `;
}
// "Edited just now", "Edited yesterday", "Edited 5m ago", "Edited Oct 3":
// mid-sentence, only the words are lowercased, never a month.
function nbEditedWhen(ms) { const rel = fmtRelativeTime(ms) || 'now'; return /^(Just now|Yesterday)$/.test(rel) ? rel.toLowerCase() : rel; }
// The title grows with its text instead of scrolling inside one line.
// The height is set again whenever the canvas changes width (a window
// resize, rotation or split view), so wrapped lines are never cut off.
// (CSS field-sizing alone came up 4px short of the last line in Chrome.)
function nbAutosizeTitle(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
function nbWatchTitleWidth(el) {
  if (window._nbTitleRO) { window._nbTitleRO.disconnect(); window._nbTitleRO = null; }
  if (!el || !window.ResizeObserver) return;
  let lastW = el.clientWidth;
  window._nbTitleRO = new ResizeObserver(() => {
    if (el.clientWidth === lastW) return; // our own height change, not a new width
    lastW = el.clientWidth;
    nbAutosizeTitle(el);
  });
  window._nbTitleRO.observe(el);
}
// Enter in the title moves to the start of the note, like a document.
function nbTitleKeydown(e) {
  if (e.key !== 'Enter' || e.isComposing) return;
  e.preventDefault();
  const editor = $('#note-editor');
  if (!editor) return;
  editor.focus();
  const range = document.createRange();
  const first = editor.firstElementChild && !/^(TABLE|HR|DIV)$/.test(editor.firstElementChild.tagName) ? editor.firstElementChild : editor;
  range.selectNodeContents(first);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
}
// A title is one line: pasted line breaks become spaces.
function nbTitlePaste(e) {
  const text = e.clipboardData?.getData('text/plain');
  if (text == null || !/[\r\n]/.test(text)) return;
  e.preventDefault();
  const el = e.target;
  const clean = text.replace(/[\r\n]+/g, ' ');
  const start = el.selectionStart, end = el.selectionEnd;
  el.value = el.value.slice(0, start) + clean + el.value.slice(end);
  el.setSelectionRange(start + clean.length, start + clean.length);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function onNoteEdit(id, el) {
  const status = $('#nb-save-status');
  if (status) status.textContent = 'Saving…';
  saveNoteContentDebounced(id, el.innerHTML);
  if ($('#nb-lab-rail')) refreshLabRailDebounced();
  const start = $('#nb-tpl-start');
  if (start && !start.classList.contains('is-hidden') && (el.textContent || '').trim()) start.classList.add('is-hidden');
}
function renameNote(id, name) {
  if (nbIsSharedId(id)) { nbSharedRename(id, name); return; }
  const n = state.notes.find(x => x.id === id);
  n.name = String(name).replace(/[\r\n]+/g, ' ').trim() ? String(name).replace(/[\r\n]+/g, ' ') : 'Untitled note';
  save();
  // The list row follows along without a render, so the caret stays put.
  const label = n.name === 'Untitled note' ? 'Untitled' : n.name.trim();
  document.querySelectorAll('.nb-note-row.selected .nb-note-name').forEach(el => { el.textContent = label; el.title = label; });
}
function setNoteCourse(id, courseId) { const n = state.notes.find(x => x.id === id); n.courseId = courseId || null; touch(); }
const saveLocalNoteDebounced = debounce((id, html) => {
  const n = state.notes.find(x => x.id === id);
  if (!n) return;
  n.content = html; n.updatedAt = Date.now(); save();
  if (window._nbRendered?.note === n) window._nbRendered.content = html;
  const status = $('#nb-save-status');
  if (status) { const words = plainTextOfNote(n).trim().split(/\s+/).filter(Boolean).length; status.textContent = `Saved just now · ${words} word${words === 1 ? '' : 's'}`; }
}, 500);
// Every edit in the editor comes through here. A shared note saves its own
// way (js/notebook-shared.js), right away, to everyone on it.
function saveNoteContentDebounced(id, html) {
  if (nbIsSharedId(id)) nbSharedLocalEdit(id, html);
  else saveLocalNoteDebounced(id, html);
}
// The note behind an id, whether it's yours or shared.
function nbNoteById(id) { return nbIsSharedId(id) ? nbSharedNote(id) : state.notes.find(x => x.id === id && x.type === 'note'); }

function plainTextOfNote(note) { return textOfHtml(note.content || ''); }

function notePrintHtml(note, crumbs, courseName) {
  return `
    ${crumbs.length ? `<div class="print-meta">${crumbs.map(esc).join(' / ')}</div>` : ''}
    <div class="print-title">${esc(note.name || 'Untitled')}</div>
    <div class="print-meta">${courseName ? esc(courseName) + ' · ' : ''}${fmtDateLong(todayIso())}</div>
    <div class="rich-editor" style="color:#000">${sanitizeHtml(note.content || '') || '<p><em>This note is empty.</em></p>'}</div>
  `;
}
// Falls back to the browser's own print dialog: still produces a real PDF via
// "Save as PDF"/"Print to PDF", just without a direct file to hand to
// navigator.share(). Used when html2pdf isn't available (e.g. the CDN was
// blocked) or actually generating the PDF below threw.
function legacyPrintNote(note, crumbs, courseName) {
  $('#print-area').classList.add('nb-export');
  $('#print-area').innerHTML = notePrintHtml(note, crumbs, courseName);
  const restoreTitle = document.title;
  document.title = note.name || 'Untitled note';
  window.print();
  document.title = restoreTitle;
}
async function exportNoteToPdf(id) {
  const note = nbNoteById(id);
  if (!note) return;
  const courseName = note.courseId ? getCourse(note.courseId)?.name : '';
  const crumbs = notePath(note);
  if (typeof html2pdf === 'undefined') { try { await loadScriptOnce(HTML2PDF_SRC); } catch {} }
  if (typeof html2pdf === 'undefined') { legacyPrintNote(note, crumbs, courseName); return; }

  const filename = (note.name || 'Untitled note').replace(/[\\/:*?"<>|]/g, '-').trim() + '.pdf';
  // Rendered off-screen with an explicit white background, independent of
  // whatever background preset or dark mode is active in the app right now,
  // otherwise the exported PDF's page color follows the theme instead of
  // being a clean white page (see the @media print fix in styles.css, which
  // this shares the same white-background reasoning with).
  const container = document.createElement('div');
  container.className = 'nb-export';
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
    diag.warn('notebook', 'PDF export failed, fell back to print', e);
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
    if (e?.name === 'AbortError') return; // person dismissed the share sheet, not a failure
    diag.warn('notebook', 'Share failed, fell back to download', e);
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
// Shares a whole folder (every note directly inside it, including anything
// pulled in via Upload file) as one bundle, instead of only being able to
// share notes one at a time.
function shareFolderToGroup(id) {
  const folder = state.notes.find(n => n.id === id && n.type === 'folder');
  if (!folder) return;
  const notes = state.notes.filter(n => n.type === 'note' && n.parentId === id);
  if (!notes.length) { toast('This notebook has no notes to share yet', 'error'); return; }
  openShareToGroupModal('note-bundle', folder.name || 'Untitled notebook', { notes: notes.map(n => ({ name: n.name, content: n.content || '' })) });
}

function triggerNoteFileUpload(id) {
  // A shared note takes files the way pictures go in: stored, never inline.
  if (nbIsSharedId(id)) { nbPickPicture(); return; }
  window._nbUploadNoteId = id;
  const input = $('#nb-file-input');
  if (input) input.click();
}
async function handleNoteFileUpload(fileList) {
  const input = $('#nb-file-input');
  const files = Array.from(fileList || []);
  if (input) input.value = '';
  const note = state.notes.find(n => n.id === window._nbUploadNoteId);
  if (!files.length || !note) return;
  const status = $('#nb-save-status');
  const problems = [];
  let added = 0, markerId = '';
  for (const file of files) {
    if (status) status.textContent = `Adding ${file.name}…`;
    try {
      const body = await noteHtmlForFile(file, problems);
      markerId = 'nb-import-' + uid();
      note.content = (note.content || '') + `<h3 id="${markerId}">${esc(file.name)}</h3>${body}`;
      added++;
    } catch (e) { problems.push(e.message || `Couldn’t read ${file.name}.`); }
  }
  if (added) note.updatedAt = Date.now();
  touch();
  if (added) requestAnimationFrame(() => document.getElementById(markerId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  const done = added === files.length ? (added > 1 ? `${added} files added to the note.` : 'File added to the note.') : added ? `Added ${added} of ${files.length} files.` : '';
  toast([done, ...problems].filter(Boolean).join(' '), added ? (problems.length ? 'info' : 'success') : 'error', problems.length ? 7000 : 3000);
}
// PDF pages come in as page images (the real document: figures, layout,
// handwriting, not a stripped text reflow; see extractPdfPageImages in ai.js
// for the size and page caps), photos as pictures, and any other document
// as its text, ready to edit.
async function noteHtmlForFile(file, problems) {
  const kind = await uploadKind(file);
  const picture = (src, alt) => `<p><img src="${src}" alt="${esc(alt)}" style="max-width:100%;border-radius:6px;border:1px solid var(--border);margin:4px 0"></p>`;
  if (kind === 'pdf') {
    const { images, totalPages } = await pdfPageImagesForUpload(file, 20);
    if (totalPages > images.length) problems.push(`${file.name} has ${totalPages} pages, so only the first ${images.length} were added.`);
    return images.map(src => picture(src, `${file.name} page`)).join('');
  }
  if (kind === 'image') return picture(await imageUploadDataUrl(file, 1400, 0.8), file.name);
  const { text } = await readOneUpload(file, { textOnly: true });
  const lines = String(text || '').split('\n').map(line => line.split('\t').map(s => s.trim()).filter(Boolean).join(' · ')).filter(Boolean);
  if (!lines.length) throw new Error(`Couldn’t find any text in ${file.name}.`);
  return lines.map(line => `<p>${esc(line)}</p>`).join('');
}
