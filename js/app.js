/* ── App shell: nav, router, boot ────────────────────────────────── */
const NAV = [
  ['Overview', [['dashboard', 'home', 'Dashboard'], ['calendar', 'calendar', 'Calendar'], ['todos', 'check-square', 'To-Do List']]],
  ['Coursework', [['courses', 'graduation-cap', 'Courses'], ['assignments', 'clipboard-list', 'Assignments'], ['exams', 'flag', 'Exams'], ['projects', 'folder', 'Projects']]],
  ['Study', [['notebook', 'book-open', 'Notebook'], ['timer', 'timer', 'Study Timer'], ['studytools', 'layers', 'Flashcards'], ['studygroups', 'users', 'Study Groups']]],
];
const PAGES = {
  dashboard: pageDashboard, calendar: pageCalendar, todos: pageTodos, courses: pageCourses,
  assignments: pageAssignments, exams: pageExams, projects: pageProjects,
  notebook: pageNotebook, timer: pageTimer, studytools: pageStudyTools, studygroups: pageStudyGroups,
  settings: pageSettings,
};

function render() {
  renderSidebar();
  document.getElementById('app').classList.toggle('sidebar-collapsed', !!state.settings.sidebarCollapsed);
  if (typeof shouldShowPaywall === 'function' && shouldShowPaywall()) {
    $('#content').classList.remove('content-notebook');
    $('#content').innerHTML = `<div class="fade-in">${pagePaywall()}</div>`;
    return;
  }
  const fn = PAGES[state.route] || pageDashboard;
  $('#content').classList.toggle('content-notebook', state.route === 'notebook');
  $('#content').innerHTML = `<div class="fade-in">${fn()}</div>`;
  if (typeof afterGroupPageRender === 'function') afterGroupPageRender();
}
function bindPage() { /* reserved for pages needing post-render DOM wiring beyond inline handlers */ }

// Re-render for a change that came from somewhere else (another device, or a
// study group member) rather than from something done on this screen. A plain
// render() rebuilds the page's HTML, which wiped whatever someone was halfway
// through typing (a chat message, a task title) and dropped focus every time a
// groupmate did anything. This carries unsent input text, focus, caret, and
// scroll position across the rebuild. Only restores an input whose original
// value is unchanged by the update, so real remote edits still show.
let _renderRemoteQueued = false;
function renderRemote() {
  if (typeof render !== 'function' || _renderRemoteQueued) return;
  _renderRemoteQueued = true;
  requestAnimationFrame(() => { _renderRemoteQueued = false; renderPreservingInput(); });
}
function renderPreservingInput() {
  // Mid-drag on the availability grid: a rebuild would cancel the drag.
  if (typeof _availPaint !== 'undefined' && _availPaint) { setTimeout(renderRemote, 200); return; }
  const content = $('#content');
  const drafts = [...content.querySelectorAll('input[id], textarea[id]')]
    .filter(el => !['checkbox', 'radio', 'file'].includes(el.type) && el.value !== el.defaultValue)
    .map(el => ({ id: el.id, value: el.value, def: el.defaultValue }));
  const activeEl = document.activeElement;
  const active = activeEl && activeEl.id && content.contains(activeEl) ? { id: activeEl.id, start: activeEl.selectionStart, end: activeEl.selectionEnd } : null;
  const scrollers = [...content.querySelectorAll('[data-keep-scroll][id]')]
    .map(el => ({ id: el.id, top: el.scrollTop, atBottom: el.scrollHeight - el.scrollTop - el.clientHeight < 48 }));
  const winY = window.scrollY;
  render();
  drafts.forEach(d => { const el = document.getElementById(d.id); if (el && el.defaultValue === d.def) el.value = d.value; });
  scrollers.forEach(s => { const el = document.getElementById(s.id); if (el) el.scrollTop = s.atBottom ? el.scrollHeight : s.top; });
  if (active) {
    const el = document.getElementById(active.id);
    if (el) { el.focus({ preventScroll: true }); try { if (active.start != null) el.setSelectionRange(active.start, active.end); } catch {} }
  }
  window.scrollTo(0, winY);
}

function toggleSidebar() {
  state.settings.sidebarCollapsed = !state.settings.sidebarCollapsed;
  touch();
}

function renderSidebar() {
  const groupsUnread = typeof anyGroupUnread === 'function' && anyGroupUnread();
  $('#sidebar').innerHTML = `
    <div class="sidebar-brand">
      <div><h1>Semester HQ</h1><p>${esc(activeSemesterName())}</p></div>
      <button class="btn btn-ghost btn-icon btn-sm" onclick="toggleSidebar()" title="Hide sidebar" aria-label="Hide sidebar">${icon('panel-left', 16, 1.6)}</button>
    </div>
    <div style="flex:1;overflow-y:auto">
      ${NAV.map(([label, items]) => `
        <div class="nav-group">
          <div class="nav-group-label">${label}</div>
          ${items.map(([id, iconName, name]) => `<div class="nav-item ${state.route === id ? 'active' : ''}" onclick="setState({route:'${id}',subRoute:null})"><span class="ic">${icon(iconName)}</span>${name}${id === 'studygroups' && groupsUnread ? '<span class="nav-dot" aria-label="New group messages"></span>' : ''}</div>`).join('')}
        </div>
      `).join('')}
    </div>
    <div class="sidebar-foot">
      <div class="nav-item ${state.route === 'settings' ? 'active' : ''}" onclick="setState({route:'settings',subRoute:null})"><span class="ic">${icon('settings')}</span>Settings</div>
      <div class="user-chip" onclick="setState({route:'settings',subRoute:null})">
        <div class="avatar">${(state.settings.displayName || _fbUser?.displayName || 'S')[0].toUpperCase()}</div>
        <div>${_fbUser ? esc(_fbUser.displayName || _fbUser.email) : (fbConfigured() ? 'Not signed in' : 'Local only')}</div>
      </div>
    </div>
  `;
}
function activeSemesterName() { return state.semesters.find(s => s.id === state.currentSemesterId)?.name || 'My Planner'; }

function initApp() {
  applyTheme();
  materializeRecurringTodos();
  captureJoinParam();
  save();
  bootFirebase();
  $('.sidebar-expand-fab').innerHTML = icon('panel-left', 16, 1.6);
  render();
}
initApp();
