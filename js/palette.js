/* ── Command palette (⌘K / Ctrl+K) ─────────────────────────────────
   One box to jump anywhere or do anything: pages, classes,
   assignments, notes, decks, study groups, and quick actions. Lives
   outside #content and the modal, so it works on top of any page.
──────────────────────────────────────────────────────────────── */
let _palette = { open: false, query: '', index: 0, results: [] };

function paletteItems() {
  const items = [];
  const add = (group, label, sub, iconName, run, keywords = '') => items.push({ group, label, sub, icon: iconName, run, keywords });
  add('Actions', 'Quick capture', 'Photo, PDF, or text into tasks', 'camera', () => openQuickCapture(), 'photo scan whiteboard snap upload');
  add('Actions', 'New assignment', '', 'plus', () => openAssignmentModal(), 'add create homework');
  add('Actions', 'New to-do', '', 'check-square', () => openTodoModal(), 'add create task');
  add('Actions', 'New note', '', 'file-text', () => createNote('root'), 'add create write');
  add('Actions', 'Upload a syllabus', 'Fills in class times and deadlines', 'upload', () => { setState({ route: 'courses', subRoute: null }); openSyllabusUploadModal(); }, 'import pdf ai');
  add('Actions', 'Start a focus session', '', 'play', () => { setState({ route: 'timer', subRoute: null }); if (!window._timer.running) startTimer(); }, 'timer pomodoro study');
  add('Actions', 'Add a time block', '', 'calendar', () => { setState({ route: 'calendar', subRoute: null }); openEventModal(null, todayIso()); }, 'event schedule');
  add('Actions', 'Join a shared class', 'Get every deadline for a class in one tap', 'graduation-cap', () => { setState({ route: 'courses', subRoute: null }); openJoinClassModal(); }, 'class code section syllabus classmates');
  add('Actions', 'Start a study group', '', 'users', () => { setState({ route: 'studygroups', subRoute: null }); openCreateGroupModal(); }, 'create group');
  add('Actions', 'Semester Wrapped', 'Your semester in shareable cards', 'sparkles', () => openWrapped(), 'recap story share instagram stats');
  add('Actions', 'Add an application', 'Internship, job, or scholarship', 'briefcase', () => { setState({ route: 'career', subRoute: null }); openApplicationModal(); }, 'career job internship scholarship');
  add('Actions', 'Join a study group', 'With a code', 'user-plus', () => { setState({ route: 'studygroups', subRoute: null }); openJoinGroupModal(); }, 'code invite');
  add('Actions', 'Start a club or team', 'One calendar for every member', 'shield', () => { setState({ route: 'orgs', subRoute: null }); openCreateOrgModal(); }, 'org organization sorority fraternity chapter team club greek');
  add('Actions', 'Join a club or team', 'With a code from an officer', 'shield', () => { setState({ route: 'orgs', subRoute: null }); openJoinOrgModal(); }, 'org code sorority fraternity chapter team club');
  add('Actions', 'Customize dashboard', 'Widgets, theme, and colors', 'palette', () => { setState({ route: 'dashboard', subRoute: null }); openDashboardCustomizeModal(); }, 'theme color colors appearance dark light widgets');
  add('Actions', state.settings.dark ? 'Switch to light mode' : 'Switch to dark mode', '', state.settings.dark ? 'sun' : 'moon', () => toggleDark(!state.settings.dark), 'theme appearance');
  if (!activeCourses().length) add('Actions', 'Set up my semester', '', 'sparkles', () => openSemesterSetup(), 'onboarding get started');

  NAV.forEach(([, pages]) => pages.forEach(([id, ic, name]) => add('Go to', name, '', ic, () => setState({ route: id, subRoute: null }), id)));
  add('Go to', 'Settings', '', 'settings', () => setState({ route: 'settings', subRoute: null }), 'account preferences');

  activeCourses().forEach(c => add('Classes', c.name, [c.code, c.instructor].filter(Boolean).join(' · '), 'graduation-cap', () => openCourse(c.id), `${c.code} ${c.instructor}`));
  state.assignments.filter(a => !a.courseId || activeCourses().some(c => c.id === a.courseId))
    .sort((a, b) => Number(isAssignmentDone(a)) - Number(isAssignmentDone(b)) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
    .forEach(a => { const c = getCourse(a.courseId); add('Assignments', a.title, [c?.code || c?.name, a.dueDate ? (isAssignmentDone(a) ? 'Done' : relativeDay(a.dueDate)) : 'No date'].filter(Boolean).join(' · '), 'clipboard-list', () => openAssignmentModal(a.id), `${a.type} ${c?.name || ''}`); });
  state.notes.filter(n => n.type === 'note').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .forEach(n => add('Notes', n.name || 'Untitled note', getCourse(n.courseId)?.code || '', 'file-text', () => setState({ route: 'notebook', notebookSelected: n.id, subRoute: null }), plainTextSnippet(n.content)));
  state.decks.forEach(d => add('Flashcards', d.name, `${d.cards.length} cards`, 'layers', () => { setState({ route: 'studytools', subRoute: null }); if (d.cards.length) openStudyMode(d.id); }));
  applications().forEach(a => add('Applications', a.org, [a.role, a.type].filter(Boolean).join(' · '), 'briefcase', () => { setState({ route: 'career', subRoute: null }); openApplicationModal(a.id); }, `${a.type} ${a.location || ''}`));
  if (typeof allGroups === 'function') allGroups().forEach(g => add('Study groups', g.name, g.courseLabel || '', 'users', () => openGroup(g.code), g.courseLabel || ''));
  if (typeof allOrgs === 'function') allOrgs().forEach(o => add('Clubs & teams', o.name, o.school || '', 'shield', () => openOrg(o.code), `${o.kind} ${o.school || ''}`));
  visibleProjects().forEach(p => add('Projects', p.title, [getCourse(p.courseId)?.code, projectIsDone(p) ? 'Finished' : daysLeftLabel(p.dueDate)].filter(Boolean).join(' · '), 'folder', () => openProject(p.id), p.description || ''));
  return items;
}
function plainTextSnippet(html) { return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').slice(0, 400); }

// Best match wins: exact prefix, then word prefix, then substring, then a
// loose in-order character match ("orgch" → "Organic Chemistry").
function paletteScore(item, q) {
  if (!q) return 1;
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) return 100 - label.length / 100;
  if (label.split(/[\s:·,-]+/).some(w => w.startsWith(q))) return 80;
  if (label.includes(q)) return 60;
  const hay = `${label} ${(item.sub || '').toLowerCase()} ${(item.keywords || '').toLowerCase()}`;
  if (hay.includes(q)) return 40;
  let i = 0;
  for (const ch of label) if (ch === q[i]) i++;
  return i === q.length ? 20 : 0;
}
function paletteSearch(q) {
  q = q.trim().toLowerCase();
  const items = paletteItems();
  if (!q) {
    // Empty box: a handful of useful actions plus what's coming up.
    const upcoming = items.filter(i => i.group === 'Assignments').slice(0, 5);
    return [...items.filter(i => i.group === 'Actions').slice(0, 5), ...items.filter(i => i.group === 'Classes'), ...upcoming];
  }
  const scored = items.map(i => ({ i, s: paletteScore(i, q) })).filter(x => x.s > 0);
  const groupRank = { Actions: 0, 'Go to': 1, Classes: 2, Assignments: 3, 'Study groups': 4, Applications: 5, Notes: 6, Flashcards: 7 };
  scored.sort((a, b) => b.s - a.s || groupRank[a.i.group] - groupRank[b.i.group]);
  const out = scored.slice(0, 40).map(x => x.i);
  // Keep results visually grouped while respecting the ranking of each group's best hit.
  const order = [...new Set(out.map(i => i.group))];
  return order.flatMap(gname => out.filter(i => i.group === gname).slice(0, gname === 'Assignments' || gname === 'Notes' ? 6 : 5));
}

function openCommandPalette() {
  if (_palette.open) return;
  _palette = { open: true, query: '', index: 0, results: paletteSearch(''), returnFocus: document.activeElement };
  const el = document.createElement('div');
  el.id = 'cmdk';
  el.className = 'cmdk-wrap';
  el.innerHTML = `
    <div class="cmdk-backdrop" onclick="closeCommandPalette()"></div>
    <div class="cmdk" role="dialog" aria-modal="true" aria-label="Search and commands">
      <div class="cmdk-input-row">
        <span class="cmdk-search-ic">${searchIcon()}</span>
        <input id="cmdk-input" class="cmdk-input" placeholder="Search classes, assignments, notes, or type a command" autocomplete="off" spellcheck="false"
          role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-autocomplete="list">
        <kbd class="cmdk-kbd">esc</kbd>
      </div>
      <div class="cmdk-list" id="cmdk-list" role="listbox"></div>
      <div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span><span><kbd>↵</kbd> to open</span><span><kbd>${isMac() ? '⌘' : 'Ctrl'}</kbd><kbd>K</kbd> anywhere</span></div>
    </div>`;
  document.body.appendChild(el);
  const input = $('#cmdk-input');
  input.addEventListener('input', () => { _palette.query = input.value; _palette.index = 0; _palette.results = paletteSearch(input.value); renderPaletteList(); });
  input.addEventListener('keydown', paletteKeydown);
  renderPaletteList();
  input.focus(); // right away, so keys typed immediately after ⌘K aren't lost
  requestAnimationFrame(() => el.classList.add('show'));
}
function searchIcon() { return `<svg class="i" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>`; }
function isMac() { return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent); }
function renderPaletteList() {
  const list = $('#cmdk-list');
  if (!list) return;
  const res = _palette.results;
  if (!res.length) {
    list.innerHTML = `<div class="cmdk-empty">No matches for “${esc(_palette.query)}”.${_palette.query.trim() ? `<button class="cmdk-item" data-i="-1" onclick="paletteQuickTodo()"><span class="cmdk-ic">${icon('plus', 14, 2)}</span><span class="cmdk-text"><span class="cmdk-label">${(() => { const p = parseQuickAdd(_palette.query); return `Add “${esc(p.title)}”${p.looksLikeAssignment ? ` to ${esc(p.courseLabel)}` : ' as a to-do'}${p.dueDate ? `, ${esc(relativeDay(p.dueDate).replace(' (overdue)', ''))}` : ''}${p.dueTime ? ` ${fmtTime(p.dueTime)}` : ''}`; })()}</span></span></button>` : ''}</div>`;
    return;
  }
  let lastGroup = '';
  list.innerHTML = res.map((item, i) => {
    const head = item.group !== lastGroup ? `<div class="cmdk-group">${esc(item.group)}</div>` : '';
    lastGroup = item.group;
    return `${head}<button class="cmdk-item ${i === _palette.index ? 'active' : ''}" role="option" aria-selected="${i === _palette.index}" id="cmdk-opt-${i}" data-i="${i}" onmousemove="paletteHover(${i})" onclick="runPaletteItem(${i})">
      <span class="cmdk-ic">${icon(item.icon, 14, 1.8)}</span>
      <span class="cmdk-text"><span class="cmdk-label">${esc(item.label)}</span>${item.sub ? `<span class="cmdk-sub">${esc(item.sub)}</span>` : ''}</span>
      ${i === _palette.index ? `<span class="cmdk-enter">↵</span>` : ''}
    </button>`;
  }).join('');
  $('#cmdk-input')?.setAttribute('aria-activedescendant', `cmdk-opt-${_palette.index}`);
  $(`#cmdk-opt-${_palette.index}`)?.scrollIntoView({ block: 'nearest' });
}
function paletteHover(i) { if (_palette.index !== i) { _palette.index = i; renderPaletteList(); } }
function paletteKeydown(e) {
  const n = _palette.results.length;
  if (e.key === 'ArrowDown') { e.preventDefault(); if (n) { _palette.index = (_palette.index + 1) % n; renderPaletteList(); } }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) { _palette.index = (_palette.index - 1 + n) % n; renderPaletteList(); } }
  else if (e.key === 'Enter') { e.preventDefault(); if (n) runPaletteItem(_palette.index); else if (_palette.query.trim()) paletteQuickTodo(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeCommandPalette(); }
}
function runPaletteItem(i) {
  const item = _palette.results[i];
  closeCommandPalette(false);
  if (item) setTimeout(() => { item.run(); window.scrollTo(0, 0); }, 0);
}
// Nothing matched: whatever was typed becomes a to-do or assignment, read the
// same way as the quick add bar ("psych quiz thu 11am").
function paletteQuickTodo() {
  const text = _palette.query.trim();
  if (!text) return;
  closeCommandPalette(false);
  const p = parseQuickAdd(text);
  if (p.looksLikeAssignment) {
    const a = { id: uid(), courseId: p.courseId, title: p.title, type: p.type, dueDate: p.dueDate || addDays(todayIso(), 7), dueTime: p.dueTime || '23:59', startByDate: null, maxPoints: null, status: 'not-started', rubric: [], notes: '', attachments: [], recurringTemplateId: null };
    state.assignments.push(a);
    touch();
    toast(`Added “${a.title}” to ${p.courseLabel}, due ${relativeDay(a.dueDate).replace(' (overdue)', '')}`, 'success', 4500, { label: 'Undo', run: () => { state.assignments = state.assignments.filter(x => x.id !== a.id); touch(); } });
    return;
  }
  const td = { id: uid(), courseId: p.courseId, title: p.title, done: false, dueDate: p.dueDate || todayIso(), dueTime: p.dueTime || null, priority: p.priority || 'medium', recurring: null };
  state.todos.unshift(td);
  touch();
  toast(`Added “${td.title}” to your to-dos`, 'success', 4500, { label: 'Undo', run: () => { state.todos = state.todos.filter(x => x.id !== td.id); touch(); } });
}
function closeCommandPalette(restoreFocus = true) {
  const el = $('#cmdk');
  if (!el) return;
  const back = _palette.returnFocus;
  _palette.open = false;
  el.remove();
  if (restoreFocus && back && document.contains(back)) back.focus?.();
}
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (_palette.open) closeCommandPalette(); else openCommandPalette();
  }
}, true);
