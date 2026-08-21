/* ── Central data store ──────────────────────────────────────────
   One global `state` object, persisted to localStorage, optionally
   synced to Firestore when signed in (see firebase.js).
   NEVER change storeKey — it would erase all user data. If a schema
   migration is ever needed, bump storeKey and add the old one to
   legacyKeys so data auto-migrates on next load.
──────────────────────────────────────────────────────────────── */
const storeKey = 'studentPlanner.v1';
const legacyKeys = [];

const ASSIGNMENT_TYPES = ['assignment', 'reading', 'discussion', 'quiz', 'exam', 'project', 'paper', 'lab'];
const ASSIGNMENT_STATUSES = ['not-started', 'in-progress', 'waiting', 'submitted', 'done'];
const ASSIGNMENT_STATUS_LABELS = { 'not-started': 'Not started', 'in-progress': 'In progress', waiting: 'Waiting', submitted: 'Submitted', done: 'Done' };
const ATTACHMENT_KINDS = ['rubric', 'prompt', 'reference', 'reading', 'instructions', 'other'];
const COURSE_STATUSES = ['planned', 'in-progress', 'completed'];
const COURSE_STATUS_LABELS = { planned: 'Planned', 'in-progress': 'Currently taking', completed: 'Completed' };
const RESOURCE_KINDS = [
  { key: 'textbook', label: 'Textbook' }, { key: 'email', label: 'Professor email' }, { key: 'zoom', label: 'Zoom link' },
  { key: 'canvas', label: 'Canvas page' }, { key: 'office-hours', label: 'Office hours' }, { key: 'tutoring', label: 'Tutoring center' },
  { key: 'syllabus', label: 'Syllabus' }, { key: 'drive', label: 'Google Drive' }, { key: 'groupme', label: 'Class GroupMe' }, { key: 'other', label: 'Other' },
];
const BACKGROUND_PRESETS = [
  { type: 'solid', color1: '#fafafa', color2: '#eef0fb', angle: 135, label: 'Default' },
  { type: 'solid', color1: '#ffffff', color2: '#eef0fb', angle: 135, label: 'White' },
  { type: 'solid', color1: '#fdf6f0', color2: '#eef0fb', angle: 135, label: 'Cream' },
  { type: 'solid', color1: '#f0f7f4', color2: '#eef0fb', angle: 135, label: 'Mint' },
  { type: 'solid', color1: '#f0f5fb', color2: '#eef0fb', angle: 135, label: 'Sky' },
  { type: 'gradient', color1: '#ffffff', color2: '#ece9fb', angle: 135, label: 'White → Lavender' },
  { type: 'gradient', color1: '#fef6f8', color2: '#eef4ff', angle: 135, label: 'Blush → Sky' },
  { type: 'gradient', color1: '#f4fbf6', color2: '#eef2fb', angle: 135, label: 'Mint → Periwinkle' },
];
function bgCssValue(bg) { return bg.type === 'gradient' ? `linear-gradient(${bg.angle}deg, ${bg.color1}, ${bg.color2})` : bg.color1; }
function bgMatchesPreset(bg, p) { return bg.type === p.type && bg.color1 === p.color1 && (bg.type !== 'gradient' || (bg.color2 === p.color2 && bg.angle === p.angle)); }

const NOTE_TEMPLATES = {
  blank: { label: 'Blank note', body: '' },
  cornell: { label: 'Cornell Notes', body: '<h3>Cues / Questions</h3><p></p><h3>Notes</h3><p></p><h3>Summary</h3><p></p>' },
  lecture: { label: 'Lecture Notes', body: '<h3>Topic</h3><p></p><h3>Key Points</h3><p></p><h3>Questions</h3><p></p>' },
  reading: { label: 'Reading Notes', body: '<h3>Source</h3><p></p><h3>Main Ideas</h3><p></p><h3>Quotes / Evidence</h3><p></p><h3>My Takeaway</h3><p></p>' },
  meeting: { label: 'Meeting Notes', body: '<h3>Attendees</h3><p></p><h3>Discussion</h3><p></p><h3>Action Items</h3><p></p>' },
  examreview: { label: 'Exam Review', body: '<h3>Topics Covered</h3><p></p><h3>Practice Questions</h3><p></p><h3>Weak Spots</h3><p></p>' },
  studyguide: { label: 'Study Guide', body: '<h3>Key Terms</h3><p></p><h3>Concepts</h3><p></p><h3>Sample Problems</h3><p></p>' },
  research: { label: 'Research Notes', body: '<h3>Question</h3><p></p><h3>Sources</h3><p></p><h3>Findings</h3><p></p><h3>Next Steps</h3><p></p>' },
};

function seedData() {
  const semId = uid();
  const t = todayIso();
  return {
    route: 'dashboard',
    subRoute: null,
    calView: 'month',
    calDate: t,
    todoFilter: 'all',
    notebookSelected: null,
    todayMode: false,
    settings: {
      dark: false,
      sidebarCollapsed: false,
      background: { type: 'solid', color1: '#fafafa', color2: '#eef0fb', angle: 135 },
      stickyNoteSize: 'md',
      gradeScale: '4.0',
      weekStartsMonday: true,
      aiModel: 'claude-sonnet-4-6',
      displayName: '',
      weeklyStudyGoalMinutes: 300,
      degreeTotalCredits: 120,
      dashboardWidgets: ['stats', 'semesterProgress', 'degreeProgress', 'workload', 'quickNote', 'dueThisWeek', 'todaySchedule', 'projects', 'notes', 'quickAdd'],
      hiddenWidgets: [],
    },
    currentSemesterId: semId,
    semesters: [
      { id: semId, name: 'New Semester', startDate: t, endDate: addDays(t, 110), archived: false, targetGPA: null },
    ],
    breaks: [],
    courses: [],
    assignments: [],
    todoSections: [],
    todos: [],
    events: [],
    quickNote: '',
    notes: [
      { id: 'root', type: 'folder', name: 'Notebooks', parentId: null, courseId: null, open: true },
    ],
    timerSessions: [],
    decks: [],
    projects: [],
    studyGroups: [],
    recurringTemplates: [],
  };
}

let state = load();

function load() {
  const raw = localStorage.getItem(storeKey);
  if (raw) {
    try { return migrate(JSON.parse(raw)); }
    catch {
      const backup = localStorage.getItem(storeKey + '.bak');
      if (backup) { try { return migrate(JSON.parse(backup)); } catch {} }
    }
  }
  for (const old of legacyKeys) {
    const legacy = localStorage.getItem(old);
    if (legacy) {
      try {
        const migrated = migrate(JSON.parse(legacy));
        localStorage.setItem(storeKey, JSON.stringify(migrated));
        localStorage.removeItem(old);
        return migrated;
      } catch {}
    }
  }
  const s = seedData();
  localStorage.setItem(storeKey, JSON.stringify(s));
  return s;
}

function migrate(parsed) {
  const base = seedData();
  const merged = { ...base, ...parsed };
  merged.settings = { ...base.settings, ...(parsed.settings || {}) };
  return merged;
}

let _suspendSave = false;
function save() {
  if (_suspendSave) return;
  const json = JSON.stringify(state);
  localStorage.setItem(storeKey + '.bak', localStorage.getItem(storeKey) || json);
  localStorage.setItem(storeKey, json);
  if (typeof queueCloudSync === 'function') queueCloudSync();
}

function setState(patch) {
  Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
  save();
  if (typeof render === 'function') render();
}
// Mutate nested arrays/objects in place then persist + re-render, without replacing state's identity.
function touch() { save(); if (typeof render === 'function') render(); }

function getCourse(id) { return state.courses.find(c => c.id === id); }
function getCourseColor(id) { return getCourse(id)?.color || '#8a8a8a'; }
function activeCourses() { return state.courses.filter(c => c.semesterId === state.currentSemesterId); }
function courseOptions() { return activeCourses().map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join(''); }
function currentSemester() { return state.semesters.find(s => s.id === state.currentSemesterId); }
function setCurrentSemesterTargetGPA(val) { const s = currentSemester(); if (s) s.targetGPA = val === '' ? null : Number(val); touch(); }
