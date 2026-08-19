/* ── Central data store ──────────────────────────────────────────
   One global `state` object, persisted to localStorage, optionally
   synced to Firestore when signed in (see firebase.js).
   NEVER change storeKey — it would erase all user data. If a schema
   migration is ever needed, bump storeKey and add the old one to
   legacyKeys so data auto-migrates on next load.
──────────────────────────────────────────────────────────────── */
const storeKey = 'studentPlanner.v1';
const legacyKeys = [];

const ACCENTS = [
  { name: 'Black', hex: '#000000' },
  { name: 'Charcoal', hex: '#2b2b2b' },
  { name: 'Graphite', hex: '#444444' },
  { name: 'Slate', hex: '#5c5c5c' },
  { name: 'Steel', hex: '#767676' },
  { name: 'Ash', hex: '#909090' },
  { name: 'Silver', hex: '#a8a8a8' },
  { name: 'Mist', hex: '#c2c2c2' },
  { name: 'Fog', hex: '#dcdcdc' },
  { name: 'Cloud', hex: '#f0f0f0' },
];
const COURSE_COLORS = ['#1f1f1f', '#3a3a3a', '#555555', '#707070', '#8a8a8a', '#a5a5a5', '#c0c0c0', '#4d4d4d'];
const ASSIGNMENT_TYPES = ['assignment', 'reading', 'discussion', 'quiz', 'exam', 'project', 'paper', 'lab'];

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
    settings: {
      dark: false,
      sidebarCollapsed: false,
      stickyNoteSize: 'md',
      gradeScale: '4.0',
      weekStartsMonday: true,
      aiApiKey: '',
      aiModel: 'claude-sonnet-4-6',
      displayName: '',
    },
    currentSemesterId: semId,
    semesters: [
      { id: semId, name: 'New Semester', startDate: t, endDate: addDays(t, 110), archived: false },
    ],
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
