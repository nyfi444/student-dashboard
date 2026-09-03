/* ── Central data store ──────────────────────────────────────────
   One global `state` object, persisted to localStorage, optionally
   synced to Firestore when signed in (see firebase.js).
   NEVER change storeKey — it would erase all user data. If a schema
   migration is ever needed, bump storeKey and add the old one to
   legacyKeys so data auto-migrates on next load.
──────────────────────────────────────────────────────────────── */
const storeKey = 'studentPlanner.v1';
const legacyKeys = [];

// True only when this page is loaded inside another page's iframe — in
// practice that's just the marketing site's live "try it" demo.
function isEmbedded() { try { return window.self !== window.top; } catch { return true; } }

// Embedded demo visitors get a plain in-memory store instead of real
// localStorage/sessionStorage — deliberately not persisted anywhere. Two
// reasons: (1) GitHub Pages serves every project under one
// nyfi444.github.io origin, so the demo and the real product would
// otherwise share one localStorage bucket (paths differ, origin doesn't) —
// a visitor playing with the demo could read/write the same data as a
// real signed-in user on that device; (2) the demo is meant to showcase
// the product, not stand in for actually signing up — every reload starts
// from a clean seed so it can't be used as a free, ongoing substitute for
// a real (paid) account.
function makeMemoryStore() {
  const mem = {};
  return {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
  };
}
const dataStore = isEmbedded() ? makeMemoryStore() : localStorage;

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

/* ── Dark mode color: derive a dark background + light text tint from the
   same preset hue, instead of dark mode always being flat black/white. ── */
function hexToHsl(hex) {
  const { r, g, b } = hexToRgb(hex);
  const rf = r / 255, gf = g / 255, bf = b / 255;
  const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf), d = max - min;
  let h = 0, s = 0; const l = (max + min) / 2;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rf) h = 60 * (((gf - bf) / d) % 6);
    else if (max === gf) h = 60 * ((bf - rf) / d + 2);
    else h = 60 * ((rf - gf) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s, l };
}
function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)[r, g, b] = [c, x, 0]; else if (h < 120)[r, g, b] = [x, c, 0]; else if (h < 180)[r, g, b] = [0, c, x];
  else if (h < 240)[r, g, b] = [0, x, c]; else if (h < 300)[r, g, b] = [x, 0, c]; else[r, g, b] = [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}
// Neutral presets (near-zero saturation) fall through to plain dark gray/white,
// same as classic dark mode — only picking an actual color shifts these.
function darkBgFromPreset(hex) { const { h, s } = hexToHsl(hex || '#fafafa'); return hslToHex(h, Math.min(s, 0.4), 0.13); }
function darkTextFromPreset(hex) { const { h, s } = hexToHsl(hex || '#fafafa'); return hslToHex(h, Math.min(s, 0.5), 0.88); }

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
      darkBackground: { color: '#fafafa' },
      recentEventColors: [],
      stickyNoteSize: 'md',
      weekStartsMonday: true,
      aiModel: 'claude-sonnet-4-6',
      displayName: '',
      weeklyStudyGoalMinutes: 300,
      dashboardWidgets: ['stats', 'semesterProgress', 'workload', 'quickNote', 'dueThisWeek', 'todaySchedule', 'projects', 'notes', 'quickAdd'],
      hiddenWidgets: [],
    },
    currentSemesterId: semId,
    semesters: [
      { id: semId, name: 'New Semester', startDate: t, endDate: addDays(t, 110), archived: false },
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
  const raw = dataStore.getItem(storeKey);
  if (raw) {
    try { return migrate(JSON.parse(raw)); }
    catch {
      const backup = dataStore.getItem(storeKey + '.bak');
      if (backup) { try { return migrate(JSON.parse(backup)); } catch {} }
    }
  }
  // Legacy-key migration only ever applies to a real device's localStorage —
  // an embedded demo tab has no history to migrate, it always starts fresh.
  if (!isEmbedded()) {
    for (const old of legacyKeys) {
      const legacy = dataStore.getItem(old);
      if (legacy) {
        try {
          const migrated = migrate(JSON.parse(legacy));
          dataStore.setItem(storeKey, JSON.stringify(migrated));
          dataStore.removeItem(old);
          return migrated;
        } catch {}
      }
    }
  }
  const s = seedData();
  dataStore.setItem(storeKey, JSON.stringify(s));
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
  dataStore.setItem(storeKey + '.bak', dataStore.getItem(storeKey) || json);
  dataStore.setItem(storeKey, json);
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
