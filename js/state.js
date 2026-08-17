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
  { name: 'Lavender', hex: '#7c6fd6' },
  { name: 'Rose', hex: '#d6577f' },
  { name: 'Coral', hex: '#e0785a' },
  { name: 'Amber', hex: '#d69a3a' },
  { name: 'Sage', hex: '#5f9a72' },
  { name: 'Teal', hex: '#3f9c9c' },
  { name: 'Sky', hex: '#4d8fd6' },
  { name: 'Indigo', hex: '#5854c9' },
  { name: 'Plum', hex: '#9c4fa8' },
  { name: 'Slate', hex: '#5a6273' },
];
const COURSE_COLORS = ['#7c6fd6', '#d6577f', '#e0785a', '#d69a3a', '#5f9a72', '#3f9c9c', '#4d8fd6', '#9c4fa8'];
const ASSIGNMENT_TYPES = ['assignment', 'reading', 'discussion', 'quiz', 'exam', 'project', 'paper', 'lab'];

function seedData() {
  const semId = uid();
  const c1 = uid(), c2 = uid(), c3 = uid();
  const t = todayIso();
  return {
    route: 'dashboard',
    subRoute: null,
    calView: 'month',
    calDate: t,
    todoFilter: 'all',
    notebookSelected: null,
    settings: {
      accent: '#7c6fd6',
      dark: false,
      background: { type: 'solid', color1: '#ffffff', color2: '#eef0fb', angle: 135 },
      gradeScale: '4.0',
      weekStartsMonday: true,
      aiApiKey: '',
      aiModel: 'claude-sonnet-4-6',
      displayName: '',
    },
    currentSemesterId: semId,
    semesters: [
      { id: semId, name: 'Fall Semester', startDate: t, endDate: addDays(t, 110), archived: false },
    ],
    courses: [
      { id: c1, semesterId: semId, name: 'Intro to Psychology', code: 'PSY 101', instructor: 'Dr. Alvarez', color: COURSE_COLORS[0], credits: 3, location: 'Hall 220', meetings: [{ day: 1, start: '10:00', end: '11:15' }, { day: 3, start: '10:00', end: '11:15' }], gradingBreakdown: [{ id: uid(), name: 'Exams', weight: 40 }, { id: uid(), name: 'Homework', weight: 25 }, { id: uid(), name: 'Participation', weight: 10 }, { id: uid(), name: 'Final Project', weight: 25 }], finalGradeOverride: null, syllabusRaw: '' },
      { id: c2, semesterId: semId, name: 'Calculus II', code: 'MATH 202', instructor: 'Prof. Chen', color: COURSE_COLORS[1], credits: 4, location: 'Science 118', meetings: [{ day: 2, start: '09:00', end: '10:30' }, { day: 4, start: '09:00', end: '10:30' }], gradingBreakdown: [{ id: uid(), name: 'Exams', weight: 50 }, { id: uid(), name: 'Problem Sets', weight: 30 }, { id: uid(), name: 'Quizzes', weight: 20 }], finalGradeOverride: null, syllabusRaw: '' },
      { id: c3, semesterId: semId, name: 'World Literature', code: 'ENGL 214', instructor: 'Dr. Osei', color: COURSE_COLORS[5], credits: 3, location: 'Humanities 3', meetings: [{ day: 5, start: '13:00', end: '14:15' }], gradingBreakdown: [{ id: uid(), name: 'Essays', weight: 45 }, { id: uid(), name: 'Discussion', weight: 20 }, { id: uid(), name: 'Final Exam', weight: 35 }], finalGradeOverride: null, syllabusRaw: '' },
    ],
    assignments: [
      { id: uid(), courseId: c1, title: 'Ch. 1-3 Reading Quiz', type: 'quiz', dueDate: addDays(t, 2), dueTime: '10:00', category: null, weight: null, maxPoints: 20, earnedPoints: null, status: 'not-started', rubric: [], notes: '', recurringTemplateId: null },
      { id: uid(), courseId: c1, title: 'Midterm Exam', type: 'exam', dueDate: addDays(t, 14), dueTime: '10:00', category: null, weight: null, maxPoints: 100, earnedPoints: null, status: 'not-started', rubric: [], notes: 'Covers ch. 1-6', recurringTemplateId: null },
      { id: uid(), courseId: c2, title: 'Problem Set 4', type: 'assignment', dueDate: addDays(t, 4), dueTime: '23:59', category: null, weight: null, maxPoints: 50, earnedPoints: null, status: 'in-progress', rubric: [], notes: '', recurringTemplateId: null },
      { id: uid(), courseId: c3, title: 'Essay 1: Comparative Themes', type: 'paper', dueDate: addDays(t, 9), dueTime: '23:59', category: null, weight: null, maxPoints: 100, earnedPoints: null, status: 'not-started', rubric: [
        { id: uid(), item: 'Thesis & argument', points: 25, earned: null, done: false },
        { id: uid(), item: 'Textual evidence', points: 25, earned: null, done: false },
        { id: uid(), item: 'Organization', points: 20, earned: null, done: false },
        { id: uid(), item: 'Grammar & style', points: 15, earned: null, done: false },
        { id: uid(), item: 'Citations (MLA)', points: 15, earned: null, done: false },
      ], notes: '', recurringTemplateId: null },
    ],
    todos: [
      { id: uid(), courseId: c2, title: 'Review lecture notes before class', done: false, dueDate: t, priority: 'medium', recurring: null },
      { id: uid(), courseId: null, title: 'Order textbook for Lit class', done: false, dueDate: addDays(t, 1), priority: 'low', recurring: null },
      { id: uid(), courseId: c1, title: 'Email TA about office hours', done: true, dueDate: addDays(t, -1), priority: 'low', recurring: null },
    ],
    events: [],
    notes: [
      { id: 'root', type: 'folder', name: 'Notebooks', parentId: null, courseId: null, open: true },
      { id: uid(), type: 'note', name: 'Welcome', parentId: 'root', courseId: null, content: '<p>This is your notebook. Create folders per class, take notes here, then turn any note into an AI study guide or flashcard deck from the Study Tools page.</p>', updatedAt: Date.now() },
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
function getCourseColor(id) { return getCourse(id)?.color || '#9993ac'; }
function activeCourses() { return state.courses.filter(c => c.semesterId === state.currentSemesterId); }
function courseOptions() { return activeCourses().map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join(''); }
