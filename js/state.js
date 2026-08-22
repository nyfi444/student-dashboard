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
// Fixed, curated set — no free-form picker. Every value is a pale, pre-tinted
// solid so the background can never go saturated/overbearing.
const BACKGROUND_PRESETS = [
  { color: '#fafafa', label: 'Default' },
  { color: '#ffffff', label: 'White' },
  { color: '#fdf6f0', label: 'Cream' },
  { color: '#faf6ec', label: 'Sand' },
  { color: '#f1f5ee', label: 'Sage' },
  { color: '#f0f7f4', label: 'Mint' },
  { color: '#f0f5fb', label: 'Sky' },
  { color: '#f3f0fb', label: 'Lavender' },
  { color: '#fdf1f4', label: 'Blush' },
  // 30-hue wheel — light but visibly colorful, not just near-white pastel
  { color: '#f0dbdb', label: 'Rose' },
  { color: '#f0dfdb', label: 'Watermelon' },
  { color: '#f0e3db', label: 'Coral' },
  { color: '#f0e8db', label: 'Tangerine' },
  { color: '#f0ecdb', label: 'Apricot' },
  { color: '#f0f0db', label: 'Marigold' },
  { color: '#ecf0db', label: 'Gold' },
  { color: '#e8f0db', label: 'Honey' },
  { color: '#e3f0db', label: 'Wheat' },
  { color: '#dff0db', label: 'Chartreuse' },
  { color: '#dbf0db', label: 'Lime' },
  { color: '#dbf0df', label: 'Pistachio' },
  { color: '#dbf0e3', label: 'Fern' },
  { color: '#dbf0e8', label: 'Spring' },
  { color: '#dbf0ec', label: 'Emerald' },
  { color: '#dbf0f0', label: 'Jade' },
  { color: '#dbecf0', label: 'Teal' },
  { color: '#dbe8f0', label: 'Turquoise' },
  { color: '#dbe3f0', label: 'Aqua' },
  { color: '#dbdff0', label: 'Cerulean' },
  { color: '#dbdbf0', label: 'Cornflower' },
  { color: '#dfdbf0', label: 'Azure' },
  { color: '#e3dbf0', label: 'Cobalt' },
  { color: '#e8dbf0', label: 'Indigo' },
  { color: '#ecdbf0', label: 'Periwinkle' },
  { color: '#f0dbf0', label: 'Violet' },
  { color: '#f0dbec', label: 'Orchid' },
  { color: '#f0dbe8', label: 'Fuchsia' },
  { color: '#f0dbe3', label: 'Magenta' },
  { color: '#f0dbdf', label: 'Raspberry' },
  // Jewel-light accents — a touch more saturated, still light enough to stay soft
  { color: '#eec4cb', label: 'Ruby' },
  { color: '#eee0c4', label: 'Amber' },
  { color: '#eeeac4', label: 'Citrine' },
  { color: '#c4eed9', label: 'Emerald Deep' },
  { color: '#c4d5ee', label: 'Sapphire' },
  { color: '#dcc4ee', label: 'Amethyst' },
  // More pinks
  { color: '#eec4d5', label: 'Bubblegum' },
  { color: '#edcfd6', label: 'Carnation' },
  { color: '#e9bec5', label: 'Flamingo' },
  // A few more color options
  { color: '#cfdae8', label: 'Denim' },
  { color: '#e4e8cf', label: 'Olive' },
  { color: '#e7ccc0', label: 'Terracotta' },
  // Neutrals
  { color: '#faf7f2', label: 'Warm White' },
  { color: '#eef0f2', label: 'Cool Gray' },
  { color: '#f0ebe4', label: 'Taupe' },
  { color: '#eeece5', label: 'Stone' },
  { color: '#e9eaec', label: 'Charcoal Mist' },
];
function bgCssValue(bg) { return bg?.color || '#fafafa'; }
function bgMatchesPreset(bg, p) { return bg?.color === p.color; }

/* ── Recently Deleted: soft-delete so destructive actions are recoverable ─
   Deleted items are snapshotted here instead of vanishing outright, and
   auto-purged after TRASH_RETENTION_DAYS. Settings → Recently Deleted
   lets people restore or permanently remove them. ──────────────────── */
const TRASH_RETENTION_DAYS = 30;
const TRASH_KIND_LABELS = { 'note-bundle': 'Note', course: 'Course', assignment: 'Assignment', todo: 'To-do', event: 'Time block', project: 'Project', deck: 'Flashcard deck' };
function trashItem(kind, label, data) {
  state.trash = state.trash || [];
  state.trash.unshift({ id: uid(), kind, label, data, deletedAt: Date.now() });
  purgeOldTrash();
}
function purgeOldTrash() {
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 86400000;
  state.trash = (state.trash || []).filter(t => t.deletedAt >= cutoff);
}
function restoreTrashItem(id) {
  const t = (state.trash || []).find(x => x.id === id);
  if (!t) return;
  const restoreMap = {
    'note-bundle': () => state.notes.push(...t.data),
    course: () => state.courses.push(t.data),
    assignment: () => state.assignments.push(t.data),
    todo: () => state.todos.push(t.data),
    event: () => state.events.push(t.data),
    project: () => state.projects.push(t.data),
    deck: () => state.decks.push(t.data),
  };
  (restoreMap[t.kind] || (() => {}))();
  state.trash = state.trash.filter(x => x.id !== id);
  touch();
  toast(`Restored "${t.label}"`);
}
function permanentlyDeleteTrashItem(id) {
  confirmDialog('Permanently delete this? It can’t be recovered.', () => {
    state.trash = (state.trash || []).filter(x => x.id !== id);
    touch();
  }, 'Delete forever');
}
function emptyTrash() {
  if (!(state.trash || []).length) return;
  confirmDialog('Permanently delete everything in Recently Deleted? This can’t be undone.', () => {
    state.trash = [];
    touch();
  }, 'Empty trash');
}

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
      background: { color: '#fafafa' },
      recentEventColors: [],
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
    trash: [],
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
  // Older saves used a two-color gradient {color1,color2,angle} — collapse to the new solid {color}.
  if (merged.settings.background?.color1 && !merged.settings.background.color) {
    merged.settings.background = { color: merged.settings.background.color1 };
  }
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 86400000;
  merged.trash = (merged.trash || []).filter(t => t.deletedAt >= cutoff);
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
