/* ── App shell: nav, router, boot ────────────────────────────────── */
const NAV = [
  ['Overview', [['dashboard', 'home', 'Dashboard'], ['calendar', 'calendar', 'Calendar'], ['todos', 'check-square', 'To-Do List']]],
  ['Coursework', [['courses', 'graduation-cap', 'Courses'], ['assignments', 'clipboard-list', 'Assignments'], ['exams', 'flag', 'Exams'], ['projects', 'folder', 'Projects']]],
  ['Study', [['notebook', 'book-open', 'Notebook'], ['timer', 'timer', 'Study Timer'], ['studytools', 'layers', 'Flashcards'], ['studygroups', 'users', 'Study Groups']]],
  ['Campus', [['orgs', 'shield', 'Clubs & Teams'], ['career', 'briefcase', 'Applications']]],
];
const PAGES = {
  dashboard: pageDashboard, calendar: pageCalendar, todos: pageTodos, courses: pageCourses,
  assignments: pageAssignments, exams: pageExams, projects: pageProjects,
  notebook: pageNotebook, timer: pageTimer, studytools: pageStudyTools, studygroups: pageStudyGroups, orgs: pageOrgs, career: pageCareer,
  settings: pageSettings,
};

let _lastViewKey = '';
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
  // Animate in only when moving to a different page. Re-rendering the same
  // page after a click (checking something off, typing) used to replay the
  // fade every time, which read as a flicker.
  const viewKey = `${state.route}|${state.subRoute || ''}|${state.groupTab || ''}|${state.route === 'orgs' ? state.orgTab || '' : ''}`;
  const isNewView = viewKey !== _lastViewKey;
  _lastViewKey = viewKey;
  if (isNewView) diag.crumb('view', viewKey.replace(/\|+$/, ''));
  $('#content').innerHTML = `<div class="${isNewView ? 'fade-in' : ''}">${fn()}</div>`;
  enhanceAccessibility($('#content'));
  enhanceAccessibility($('#sidebar'));
  applyExpandables($('#content'));
  if (typeof afterGroupPageRender === 'function') afterGroupPageRender();
  if (typeof afterOrgPageRender === 'function') afterOrgPageRender();
  if (typeof updateTimerChrome === 'function') updateTimerChrome();
}
function bellButton(cls) {
  const n = typeof attentionCount === 'function' ? attentionCount() : 0;
  return `<button class="btn btn-icon bell-btn ${cls}" onclick="openHeadsUp()" aria-label="Heads up${n ? `, ${n} item${n === 1 ? '' : 's'} need attention` : ''}" title="Heads up">${icon('bell', 15, 1.8)}${n ? `<span class="bell-count">${n > 9 ? '9+' : n}</span>` : ''}</button>`;
}

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
function navTo(id) {
  // Already on the Notebook page: its sidebar entry shows or hides the notes list.
  if (id === 'notebook' && state.route === 'notebook' && typeof toggleNotebookList === 'function') {
    toggleNotebookList();
    $('#sidebar [data-nav="notebook"]')?.focus({ preventScroll: true });
    return;
  }
  setState({ route: id, subRoute: null });
}

function renderSidebar() {
  const groupsUnread = typeof anyGroupUnread === 'function' && anyGroupUnread();
  let orgsUnread = false;
  try { orgsUnread = allOrgs().some(o => orgUnreadCount(o) > 0 || orgChatUnread(o)); } catch {}
  $('#sidebar').innerHTML = `
    <div class="sidebar-brand">
      <div><h1>Semester HQ</h1><p>${esc(activeSemesterName())}</p></div>
      <button class="btn btn-ghost btn-icon btn-sm" onclick="toggleSidebar()" title="Hide sidebar" aria-label="Hide sidebar">${icon('panel-left', 16, 1.6)}</button>
    </div>
    <div class="sidebar-tools">
      <button class="sidebar-search" onclick="openCommandPalette()" aria-label="Search and commands">${searchIcon()}<span>Search</span><kbd>${isMac() ? '⌘' : 'Ctrl '}K</kbd></button>
      ${bellButton('sidebar-bell')}
    </div>
    <div class="sidebar-nav" style="flex:1;overflow-y:auto">
      ${NAV.map(([label, items]) => `
        <div class="nav-group">
          <div class="nav-group-label">${label}</div>
          ${items.map(([id, iconName, name]) => `<button class="nav-item ${state.route === id && !(id === 'courses' && state.subRoute) ? 'active' : ''}" data-nav="${id}" ${state.route === id ? 'aria-current="page"' : ''} ${id === 'notebook' && state.route === 'notebook' ? `aria-controls="notebook-tree-panel" aria-expanded="${typeof notebookListHidden === 'function' ? !notebookListHidden() : true}" title="Show or hide your notes list"` : ''} onclick="navTo('${id}')"><span class="ic">${icon(iconName)}</span>${name}${id === 'studygroups' && groupsUnread ? '<span class="nav-dot" aria-label="New group messages"></span>' : ''}${id === 'orgs' && orgsUnread ? '<span class="nav-dot" aria-label="New club activity"></span>' : ''}</button>${id === 'courses' ? sidebarClasses() : ''}`).join('')}
        </div>
      `).join('')}
    </div>
    <div class="sidebar-foot">
      <button class="nav-item ${state.route === 'settings' ? 'active' : ''}" ${state.route === 'settings' ? 'aria-current="page"' : ''} onclick="setState({route:'settings',subRoute:null})"><span class="ic">${icon('settings')}</span>Settings</button>
      <div class="user-chip" onclick="setState({route:'settings',subRoute:null})">
        <div class="avatar">${(state.settings.displayName || _fbUser?.displayName || 'S')[0].toUpperCase()}</div>
        <div>${_fbUser ? esc(_fbUser.displayName || _fbUser.email) : (fbConfigured() ? 'Not signed in' : 'Local only')}</div>
      </div>
    </div>
  `;
}
// Each class links straight to its own page, right under Courses.
function sidebarClasses() {
  const courses = activeCourses();
  if (!courses.length) return '';
  return `<div class="sidebar-classes">${courses.map(c => `<div class="nav-class ${state.route === 'courses' && state.subRoute === c.id ? 'active' : ''}" style="--course:${esc(c.color || '#5a6b7b')}" onclick="openCourse('${c.id}')" title="${esc(c.name)}"><span class="course-dot"></span><span>${esc(c.code || c.name)}</span></div>`).join('')}</div>`;
}
function activeSemesterName() { return state.semesters.find(s => s.id === state.currentSemesterId)?.name || 'My Planner'; }

function initApp() {
  applyTheme();
  materializeRecurringTodos();
  captureJoinParam();
  captureClassParam();
  captureOrgParam();
  capturePlanParam();
  save();
  bootFirebase();
  if (typeof registerServiceWorker === 'function') registerServiceWorker();
  if (typeof initInstallPrompt === 'function') initInstallPrompt();
  if (typeof handleSharedContent === 'function') handleSharedContent();
  if (new URLSearchParams(location.search).has('capture')) { history.replaceState({}, '', location.pathname); setTimeout(() => whenAccountChecked(() => openQuickCapture()), 300); }
  $('.sidebar-expand-fab').innerHTML = icon('panel-left', 16, 1.6);
  render();
}
initApp();
