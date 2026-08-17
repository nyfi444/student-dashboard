/* ── App shell: nav, router, boot ────────────────────────────────── */
const NAV = [
  ['Overview', [['dashboard', 'home', 'Dashboard'], ['calendar', 'calendar', 'Calendar'], ['todos', 'check-square', 'To-Do List']]],
  ['Coursework', [['courses', 'graduation-cap', 'Courses'], ['assignments', 'clipboard-list', 'Assignments'], ['exams', 'flag', 'Exams'], ['projects', 'folder', 'Projects'], ['grades', 'target', 'Grades & GPA']]],
  ['Study', [['notebook', 'book-open', 'Notebook'], ['timer', 'timer', 'Study Timer'], ['studytools', 'layers', 'Study Tools'], ['studygroups', 'users', 'Study Groups']]],
];
const PAGES = {
  dashboard: pageDashboard, calendar: pageCalendar, todos: pageTodos, courses: pageCourses,
  assignments: pageAssignments, exams: pageExams, projects: pageProjects, grades: pageGrades,
  notebook: pageNotebook, timer: pageTimer, studytools: pageStudyTools, studygroups: pageStudyGroups,
  settings: pageSettings,
};

function render() {
  renderSidebar();
  const fn = PAGES[state.route] || pageDashboard;
  $('#content').innerHTML = `<div class="fade-in">${fn()}</div>`;
}
function bindPage() { /* reserved for pages needing post-render DOM wiring beyond inline handlers */ }

function renderSidebar() {
  $('#sidebar').innerHTML = `
    <div class="sidebar-brand"><h1>Planner</h1><p>${esc(activeSemesterName())}</p></div>
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
  render();
}
initApp();
