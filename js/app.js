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
}
function bindPage() { /* reserved for pages needing post-render DOM wiring beyond inline handlers */ }

function toggleSidebar() {
  state.settings.sidebarCollapsed = !state.settings.sidebarCollapsed;
  touch();
}

function renderSidebar() {
  $('#sidebar').innerHTML = `
    <div class="sidebar-brand">
      <div><h1>Semester HQ</h1><p>${esc(activeSemesterName())}</p></div>
      <button class="btn btn-ghost btn-icon btn-sm" onclick="toggleSidebar()" title="Hide sidebar" aria-label="Hide sidebar">${icon('panel-left', 16, 1.6)}</button>
    </div>
    <div style="flex:1;overflow-y:auto">
      ${NAV.map(([label, items]) => `
        <div class="nav-group">
          <div class="nav-group-label">${label}</div>
          ${items.map(([id, iconName, name]) => `<div class="nav-item ${state.route === id ? 'active' : ''}" onclick="setState({route:'${id}'})"><span class="ic">${icon(iconName)}</span>${name}</div>`).join('')}
        </div>
      `).join('')}
    </div>
    <div class="sidebar-foot">
      <div class="nav-item ${state.route === 'settings' ? 'active' : ''}" onclick="setState({route:'settings'})"><span class="ic">${icon('settings')}</span>Settings</div>
      <div class="user-chip" onclick="setState({route:'settings'})">
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
  save();
  bootFirebase();
  $('.sidebar-expand-fab').innerHTML = icon('panel-left', 16, 1.6);
  render();
}
initApp();
