/* Notebook layouts: the templates, the picker, and the page features only a
   layout has (the Cornell cover switch, the lab report tracker, the note
   date). Split out of notebook.js and loaded right before it; every name
   stays global, so notebook.js and the slash menu call them as before. */
/* ── Templates: pages with a shape, not pages with filler ─────────
   A template is real structure inside the note (divs the sanitizer
   keeps, see SANITIZE_ALLOWED_TAGS), styled by CSS so the labels, the
   ruled lines, and the section numbers are drawn rather than typed and
   never end up in the saved text. The page around the editor changes
   too: a Cornell note gets a "cover the notes" switch for self-testing,
   a lab report gets a section tracker with a row-adding button, and
   both get a date. Sharing a note keeps the layout, since it is just
   HTML with nb- classes. ───────────────────────────────────────── */
const NOTE_TEMPLATES = {
  cornell: {
    label: 'Cornell notes', icon: 'grid',
    desc: 'Cues on the left, notes on the right, a summary at the bottom. Cover the notes afterward to quiz yourself from the cues.',
    html: () => '<div class="nb-cornell"><div class="nb-cornell-cues"><p><br></p></div><div class="nb-cornell-notes"><p><br></p></div></div><div class="nb-cornell-summary"><p><br></p></div>',
    name: (n) => `${getCourse(n.courseId)?.code || 'Lecture'} notes · ${fmtDate(todayIso(), { month: 'short', day: 'numeric' })}`,
  },
  lab: {
    label: 'Lab report', icon: 'clipboard-list',
    desc: 'Purpose through conclusion in numbered sections, with a data table you can grow and a tracker that shows what’s still empty.',
    html: () => ['Purpose', 'Hypothesis', 'Materials', 'Procedure', 'Data &amp; observations', 'Analysis', 'Conclusion', 'Sources of error'].map((title, i) => {
      const body = i === 2 ? '<ul><li><br></li></ul>' : i === 3 ? '<ol><li><br></li></ol>'
        : i === 4 ? `<table class="nb-lab-table"><thead><tr><th>Trial</th><th>Measurement</th><th>Units</th><th>Notes</th></tr></thead><tbody>${[1, 2, 3].map(r => `<tr><td>${r}</td><td><br></td><td><br></td><td><br></td></tr>`).join('')}</tbody></table><p><br></p>`
        : '<p><br></p>';
      return `<div class="nb-lab-section"><h2>${title}</h2>${body}</div>`;
    }).join('').replace(/^/, '<div class="nb-lab">') + '</div>',
    name: (n) => `${getCourse(n.courseId)?.code ? getCourse(n.courseId).code + ' ' : ''}Lab report · ${fmtDate(todayIso(), { month: 'short', day: 'numeric' })}`,
  },
};
// The sheet layouts: numbered sections with a heading each, like the lab
// report without its tracker. One definition feeds the note HTML, the
// picker, and the grey hint inside each empty section (injected as CSS
// once, below, so the hints are drawn and never saved into the note).
// A section is [heading, 'p' | 'ul' | 'ol' | 'todo', hint] (a checklist
// shows no hint: its line is never empty, the checkbox is in it) or
// [heading, 'table', columns, first-column rows].
const SHEET_TEMPLATES = {
  lecture: {
    label: 'Lecture notes', icon: 'book-open', titlePh: 'Lecture topic',
    desc: 'The big idea first, then notes, examples, and questions, with a summary you write from memory after class.',
    hint: 'Start with the big idea. Write the summary after class without looking.',
    sections: [
      ['Big idea', 'p', 'The one thing this lecture was about, in a sentence'],
      ['Notes', 'ul', 'Main points, in the order they came up'],
      ['Examples', 'ul', 'Worked examples, cases, or diagrams worth redrawing'],
      ['Questions', 'ul', 'Anything to ask in office hours or look up'],
      ['Summary', 'p', 'Three sentences, from memory, after class'],
    ],
  },
  reading: {
    label: 'Reading notes', icon: 'bookmark', titlePh: 'Reading title',
    desc: 'Source, main argument, key points, and quotes with page numbers, then your own take and questions for class.',
    hint: 'Note page numbers next to quotes so citing them later takes seconds.',
    sections: [
      ['Source', 'p', 'Author, title, chapter, and pages'],
      ['Main argument', 'p', 'What the author wants to convince you of'],
      ['Key points', 'ul', 'The evidence and steps that hold the argument up'],
      ['Quotes', 'ul', 'Worth citing later. Add the page number.'],
      ['Your take', 'p', 'Where you agree, where you push back, and why'],
      ['For discussion', 'ul', 'Questions to bring to class'],
    ],
  },
  exam: {
    label: 'Exam review', icon: 'target', titlePh: 'Which exam',
    desc: 'What’s covered, a topic checklist, formulas and definitions, practice problems, and a day-by-day plan.',
    hint: 'Check a topic off once you can explain it without your notes.',
    sections: [
      ['What’s covered', 'p', 'Date, time, room, and the chapters or units on it'],
      ['Topics', 'todo', 'One topic per line. Check it off once you can explain it.'],
      ['Formulas and definitions', 'ul', 'Everything you need to know cold'],
      ['Practice problems', 'ol', 'Problems to redo, with where to find them'],
      ['Mistakes to avoid', 'ul', 'What cost you points last time'],
      ['Study plan', 'table', ['Day', 'What to review'], ['', '', '']],
    ],
  },
  weekly: {
    label: 'Weekly planner', icon: 'calendar', titlePh: 'Week of',
    desc: 'Your top three for the week, a day-by-day table for classes and plans, and a short look back on Sunday.',
    hint: 'Fill in the top three on Sunday night. Look back the next Sunday.',
    sections: [
      ['Top three', 'ol', 'What would make this week a win'],
      ['Day by day', 'table', ['Day', 'Classes and deadlines', 'Plan'], ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']],
      ['Everything else', 'ul', 'Work shifts, appointments, errands'],
      ['Looking back', 'p', 'What went well, and what moves to next week'],
    ],
  },
  meeting: {
    label: 'Meeting notes', icon: 'users', titlePh: 'Meeting name',
    desc: 'For a club, a team, or a group project: agenda, notes, decisions, and a table of who does what by when.',
    hint: 'Fill in Action items before everyone leaves.',
    sections: [
      ['Details', 'p', 'Who was there, when, and where'],
      ['Agenda', 'ol', 'What you meant to cover'],
      ['Notes', 'ul', 'What was said'],
      ['Decisions', 'ul', 'What was agreed'],
      ['Action items', 'table', ['Task', 'Who', 'Due'], ['', '', '']],
      ['Next meeting', 'p', 'Date, time, and what to bring'],
    ],
  },
};
function sheetHtml(key) {
  const t = SHEET_TEMPLATES[key];
  const body = ([, kind, a, rows]) => kind === 'ul' ? '<ul><li><br></li></ul>' : kind === 'ol' ? '<ol><li><br></li></ol>'
    : kind === 'todo' ? '<div class="nb-todo-line"><input type="checkbox">&nbsp;<br></div>'
    : kind === 'table' ? `<table><thead><tr>${a.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr><td>${r || '<br>'}</td>${a.slice(1).map(() => '<td><br></td>').join('')}</tr>`).join('')}</tbody></table><p><br></p>`
    : '<p><br></p>';
  return `<div class="nb-sheet nb-sheet-${key}">${t.sections.map(sec => `<div class="nb-sheet-section"><h2>${sec[0].replace(/&/g, '&amp;')}</h2>${body(sec)}</div>`).join('')}</div>`;
}
Object.entries(SHEET_TEMPLATES).forEach(([key, t]) => {
  NOTE_TEMPLATES[key] = {
    label: t.label, icon: t.icon, desc: t.desc, sheet: true, titlePh: t.titlePh, hint: t.hint,
    html: () => sheetHtml(key),
    name: (n) => `${getCourse(n.courseId)?.code ? getCourse(n.courseId).code + ' ' : ''}${t.label} · ${fmtDate(todayIso(), { month: 'short', day: 'numeric' })}`,
  };
});
(function sheetHints() {
  const rules = Object.entries(SHEET_TEMPLATES).flatMap(([key, t]) => t.sections.map((sec, i) => {
    if (sec[1] === 'table' || sec[1] === 'todo') return '';
    const at = `.rich-editor .nb-sheet-${key} > .nb-sheet-section:nth-of-type(${i + 1})`;
    const sel = sec[1] === 'p' ? `${at} > p:last-child:has(> br:only-child)::before`
      : `${at} > ${sec[1]} > li:only-child:has(> br:only-child)::before`;
    return `${sel}{content:${JSON.stringify(sec[2])}}`;
  })).join('');
  const el = document.createElement('style');
  el.id = 'nb-sheet-hints';
  el.textContent = rules;
  document.head.appendChild(el);
})();
// A note knows its template; one shared in from a classmate only carries the layout.
function noteTemplateOf(note) {
  if (note?.template && NOTE_TEMPLATES[note.template]) return note.template;
  const c = String(note?.content || '');
  const sheet = c.match(/class="nb-sheet nb-sheet-(\w+)"/);
  if (sheet && SHEET_TEMPLATES[sheet[1]]) return sheet[1];
  return /class="nb-cornell"/.test(c) ? 'cornell' : /class="nb-lab"/.test(c) ? 'lab' : '';
}
function noteIsBlank(note) { return !noteTemplateOf(note) && !plainTextOfNote(note).trim() && !/<(img|table|input)\b/i.test(note.content || ''); }
function openNoteTemplateModal(parentId = 'root', noteId = null) {
  window._nbTplPick = 'cornell';
  const preview = {
    blank: '<i style="top:14px;left:12px;width:40%"></i><i style="top:26px;left:12px;width:70%"></i><i style="top:38px;left:12px;width:55%"></i><i style="top:50px;left:12px;width:64%"></i>',
    cornell: '<i style="top:12px;left:8px;width:16%"></i><i style="top:30px;left:8px;width:14%"></i><i style="top:12px;left:36%;width:50%"></i><i style="top:22px;left:36%;width:44%"></i><i style="top:32px;left:36%;width:56%"></i><i style="top:42px;left:36%;width:38%"></i><i style="top:70px;left:8px;width:80%"></i>',
    lab: '<i style="top:10px;left:12px;width:22%;height:5px"></i><i style="top:22px;left:12px;width:60%"></i><i style="top:36px;left:12px;width:22%;height:5px"></i><i style="top:48px;left:12px;width:70%"></i><i style="top:62px;left:12px;width:22%;height:5px"></i><i style="top:72px;left:12px;width:76%;height:8px;opacity:.18"></i>',
    // Each sheet gets its own sketch, so the cards can be told apart at a glance.
    lecture: '<i style="top:10px;left:12px;width:30%;height:5px"></i><i style="top:21px;left:12px;width:72%;height:7px;opacity:.2"></i><i style="top:36px;left:12px;width:4px"></i><i style="top:36px;left:20px;width:56%"></i><i style="top:45px;left:12px;width:4px"></i><i style="top:45px;left:20px;width:48%"></i><i style="top:54px;left:12px;width:4px"></i><i style="top:54px;left:20px;width:60%"></i><i style="top:70px;left:12px;width:76%"></i>',
    reading: '<i style="top:10px;left:12px;width:44%"></i><i style="top:22px;left:12px;width:2px;height:26px;opacity:.6"></i><i style="top:24px;left:20px;width:62%"></i><i style="top:33px;left:20px;width:54%"></i><i style="top:42px;left:20px;width:40%"></i><i style="top:58px;left:12px;width:70%"></i><i style="top:67px;left:12px;width:58%"></i>',
    exam: '<i style="top:10px;left:12px;width:28%;height:5px"></i><i style="top:22px;left:12px;width:7px;height:7px"></i><i style="top:24px;left:24px;width:48%"></i><i style="top:34px;left:12px;width:7px;height:7px"></i><i style="top:36px;left:24px;width:40%"></i><i style="top:46px;left:12px;width:7px;height:7px"></i><i style="top:48px;left:24px;width:54%"></i><i style="top:64px;left:12px;width:76%;height:12px;opacity:.16"></i>',
    weekly: '<i style="top:10px;left:12px;width:30%;height:5px"></i>' + [0, 1, 2, 3, 4, 5, 6].map(r => `<i style="top:${22 + r * 9}px;left:12px;width:12%;height:5px;opacity:.28"></i><i style="top:${22 + r * 9}px;left:30%;width:58%;height:5px;opacity:.16"></i>`).join(''),
    meeting: '<i style="top:10px;left:12px;width:36%"></i><i style="top:21px;left:12px;width:6px"></i><i style="top:21px;left:22px;width:44%"></i><i style="top:30px;left:12px;width:6px"></i><i style="top:30px;left:22px;width:38%"></i><i style="top:48px;left:12px;width:24%;height:10px;opacity:.2"></i><i style="top:48px;left:38%;width:22%;height:10px;opacity:.2"></i><i style="top:48px;left:62%;width:26%;height:10px;opacity:.2"></i><i style="top:62px;left:12px;width:24%;height:10px;opacity:.12"></i><i style="top:62px;left:38%;width:22%;height:10px;opacity:.12"></i><i style="top:62px;left:62%;width:26%;height:10px;opacity:.12"></i>',
  };
  const sheetPreview = '<i style="top:10px;left:12px;width:26%;height:5px"></i><i style="top:21px;left:12px;width:64%"></i><i style="top:30px;left:12px;width:50%"></i><i style="top:44px;left:12px;width:26%;height:5px"></i><i style="top:55px;left:12px;width:70%"></i><i style="top:69px;left:12px;width:26%;height:5px"></i>';
  const cards = [['blank', 'Blank page', 'Start typing. Type / for headings, lists, and blocks.'], ...Object.entries(NOTE_TEMPLATES).map(([k, t]) => [k, t.label, t.desc])];
  const note = noteId ? state.notes.find(n => n.id === noteId) : null;
  openModal(`
    <div class="modal-head"><h3>${note ? 'Give this note a shape' : 'New note'}</h3>${closeXButton()}</div>
    <div class="modal-body">
      <div class="nb-tpl-grid" role="radiogroup" aria-label="Template">
        ${cards.filter(([k]) => !note || k !== 'blank').map(([k, label, desc]) => `
          <button type="button" class="nb-tpl-card ${k === window._nbTplPick ? 'active' : ''}" role="radio" aria-checked="${k === window._nbTplPick}" onclick="window._nbTplPick='${k}';$$('.nb-tpl-card').forEach(b=>{const on=b===this;b.classList.toggle('active',on);b.setAttribute('aria-checked',on)})">
            <div class="nb-tpl-preview ${k}" aria-hidden="true">${preview[k] || sheetPreview}</div>
            <div class="nb-tpl-title">${label}</div>
            <div class="nb-tpl-desc">${desc}</div>
          </button>`).join('')}
      </div>
      ${note ? '' : `<div class="field mt-16" style="margin-bottom:0"><label for="nt-course">Class <span class="muted">(optional)</span></label><select class="select" id="nt-course"><option value="">No class</option>${activeCourses().map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>`}
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="${note ? `applyNoteTemplate('${note.id}', window._nbTplPick);closeModal()` : `createNoteFromTemplate('${parentId}')`}">${note ? 'Apply' : 'Create note'}</button></div>
  `, { wide: true });
}
function createNoteFromTemplate(parentId) {
  const key = window._nbTplPick;
  const id = uid();
  const courseId = $('#nt-course')?.value || null;
  state.notes.push({ id, type: 'note', name: 'Untitled note', parentId, courseId, pinned: false, content: '', updatedAt: Date.now() });
  closeModal();
  if (NOTE_TEMPLATES[key]) applyNoteTemplate(id, key);
  else { nbShowNoteOnPhone(); setState({ route: 'notebook', notebookSelected: id }); }
}
function nbMarkFirstCornell(n, key) { if (key === 'cornell' && !state.settings.nbCornellHintNote) state.settings.nbCornellHintNote = n.id; }
// Puts the layout on a note. A blank note becomes the template; a note
// with writing in it keeps that writing and gets the layout added below.
function applyNoteTemplate(id, key) {
  const n = nbNoteById(id);
  const t = NOTE_TEMPLATES[key];
  if (!n || !t) return;
  const editor = $('#note-editor');
  if (editor && window._nbCurrentNoteId === id) n.content = editor.innerHTML; // anything typed but not yet saved
  const html = t.html();
  n.content = noteIsBlank(n) ? html : `${n.content}${html}`;
  n.template = key;
  nbMarkFirstCornell(n, key);
  if (!n.date) n.date = todayIso();
  if (!n.name || n.name === 'Untitled note') n.name = t.name(n);
  n.updatedAt = Date.now();
  nbShowNoteOnPhone();
  setState({ route: 'notebook', notebookSelected: id, subRoute: null });
  setTimeout(() => focusTemplateStart(key), 80);
}
// From the slash menu: the template lands where the caret is, replacing the "/cornell" line.
function insertTemplateBlock(key) {
  const t = NOTE_TEMPLATES[key];
  const editor = $('#note-editor');
  const n = nbNoteById(window._nbCurrentNoteId);
  if (!t || !editor || !n) return;
  const block = window._slashBlock;
  if (block && block.parentElement && editor.contains(block)) { block.insertAdjacentHTML('beforebegin', t.html()); block.remove(); }
  else runNbInsertHtml(t.html());
  // The caret-line marker is a live-editing aid; it is not saved with the note.
  editor.querySelectorAll('.nb-caret-line').forEach(el => el.classList.remove('nb-caret-line'));
  n.content = editor.innerHTML;
  n.template = key;
  nbMarkFirstCornell(n, key);
  if (!n.date) n.date = todayIso();
  n.updatedAt = Date.now();
  touch();
  setTimeout(() => focusTemplateStart(key), 80);
}
function focusTemplateStart(key) {
  const target = $(key === 'cornell' ? '#note-editor .nb-cornell-cues p' : key === 'lab' ? '#note-editor .nb-lab-section p'
    : '#note-editor .nb-sheet-section p, #note-editor .nb-sheet-section li, #note-editor .nb-sheet-section .nb-todo-line, #note-editor .nb-sheet-section td');
  if (!target) return;
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  const editor = $('#note-editor');
  if (editor) { editor.focus(); updateCaretLineHighlight(editor); }
}
function setNoteDate(id, value) {
  const n = state.notes.find(x => x.id === id);
  if (!n) return;
  n.date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  save();
  const prop = $('.nb-prop-date');
  if (prop) { prop.classList.toggle('is-empty', !n.date); const t = $('.nb-prop-text', prop); if (t) t.textContent = n.date ? fmtDate(n.date, { month: 'short', day: 'numeric' }) : 'Add date'; }
}
// Cornell's whole point: hide the notes column and answer from the cues.
function toggleCornellCover() {
  window._nbCovered = !window._nbCovered;
  const editor = $('#note-editor');
  if (editor) editor.classList.toggle('is-covered', window._nbCovered);
  const label = window._nbCovered ? 'Reveal notes' : 'Cover notes';
  const btn = $('#nb-cover-btn');
  if (btn) {
    btn.classList.toggle('is-on', window._nbCovered);
    btn.setAttribute('aria-pressed', String(window._nbCovered));
    btn.setAttribute('aria-label', label);
    btn.innerHTML = nbCoverBtnInner(window._nbCovered);
  }
  const item = $('#nb-cover-item');
  if (item) item.innerHTML = `${nbCoverIcon(window._nbCovered)}<span>${label}</span>`;
}
// Cover shows eye-off (hide the notes), Reveal shows eye. Never the lock:
// that glyph means "needs an account" everywhere else in the app.
function nbCoverIcon(covered) { return icon(covered || !ICON_PATHS['eye-off'] ? 'eye' : 'eye-off', 16); }
function nbCoverBtnInner(covered) { return `${nbCoverIcon(covered)}<span class="nb-act-label">${covered ? 'Reveal' : 'Cover'}</span>`; }
// Lab report tracker: one chip per section, filled once there is more in it than its heading.
function labSectionsOf(root) {
  return [...root.querySelectorAll('.nb-lab-section')].map(sec => {
    const title = (sec.querySelector('h2, h3')?.textContent || 'Section').trim();
    const rest = [...sec.children].filter(el => !/^H[1-3]$/.test(el.tagName));
    const filled = rest.some(el => el.tagName === 'TABLE'
      ? [...el.querySelectorAll('tbody td:not(:first-child)')].some(td => td.textContent.trim().length > 0)
      : el.textContent.trim().length > 2);
    return { title, filled };
  });
}
function labRailHtml(sections) {
  const filled = sections.filter(x => x.filled).length;
  return `
    <div class="nb-lab-rail-head"><span class="eyebrow">Report</span><span class="nb-lab-count">${filled} of ${sections.length} sections written</span><div class="progress nb-lab-progress"><div style="width:${sections.length ? Math.round((filled / sections.length) * 100) : 0}%"></div></div></div>
    <div class="nb-lab-chips">
      ${sections.map((x, i) => `<button type="button" class="nb-lab-chip ${x.filled ? 'is-filled' : ''}" onmousedown="event.preventDefault()" onclick="scrollToLabSection(${i})"><span class="nb-lab-dot"></span>${esc(x.title)}</button>`).join('')}
      <button type="button" class="btn btn-ghost btn-sm nb-lab-add" onmousedown="event.preventDefault()" onclick="addLabTableRow()">${icon('plus', 14)}Table row</button>
    </div>`;
}
const refreshLabRailDebounced = debounce(() => {
  const rail = $('#nb-lab-rail'), editor = $('#note-editor');
  if (rail && editor) rail.innerHTML = labRailHtml(labSectionsOf(editor));
}, 400);
function scrollToLabSection(i) {
  const sec = $$('#note-editor .nb-lab-section')[i];
  if (!sec) return;
  sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const target = sec.querySelector('p, li, td') || sec;
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  $('#note-editor')?.focus({ preventScroll: true });
}
function addLabTableRow() {
  const editor = $('#note-editor');
  if (!editor) return;
  const sel = window.getSelection();
  const anchor = sel?.anchorNode ? (sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode) : null;
  let table = anchor?.closest?.('table');
  if (!table || !editor.contains(table)) table = editor.querySelector('table');
  if (!table) { toast('No table in this note yet', 'info'); return; }
  const body = table.tBodies[0] || table;
  const cols = (table.querySelector('tr')?.children.length) || 4;
  const n = body.rows.length + 1;
  const tr = document.createElement('tr');
  for (let i = 0; i < cols; i++) { const td = document.createElement('td'); td.innerHTML = i === 0 ? String(n) : '<br>'; tr.appendChild(td); }
  body.appendChild(tr);
  onNoteEdit(window._nbCurrentNoteId, editor);
  const cell = tr.children[1] || tr.children[0];
  const range = document.createRange();
  range.selectNodeContents(cell); range.collapse(true);
  sel.removeAllRanges(); sel.addRange(range);
  editor.focus({ preventScroll: true });
}
