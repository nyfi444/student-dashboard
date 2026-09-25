/* ── The only tests in the repo, on purpose ───────────────────────
   There is no build step and no test framework, and neither should be
   added for this. These cover the two places where a silent regression
   damages trust and nobody would notice for weeks:

     1. js/quickparse.js — quick add reads plain English into a date, a
        time, a class and a type. When it drifts, it doesn't throw; it
        just quietly files something on the wrong day.
     2. The syllabus contract — SYLLABUS_SCHEMA in js/ai.js constrains
        what the model may return, and sanitizeCourseDetails in
        js/syllabus.js decides what is allowed to be stored. If those two
        disagree, a real field is dropped on the floor at the single most
        important moment in the product.
     3. js/lmsfeed.js — a Canvas or Blackboard calendar feed becomes
        assignments. A date read a day off, a class matched to the wrong
        course, or a lecture imported as homework is exactly the kind of
        thing nobody notices until the week it matters.

   Run:  node tests/run.mjs
──────────────────────────────────────────────────────────────── */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');

// The app's files are plain scripts that share globals, exactly as the browser
// loads them (see the script-order comment in index.html). Loading them into
// one context is the same thing, minus the DOM.
const sandbox = {
  console, window: {}, document: { documentElement: { classList: { toggle() {}, add() {} }, style: {} }, querySelector: () => null, querySelectorAll: () => [] },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { onLine: true, userAgent: 'node' }, location: { pathname: '/', search: '' },
  fetch: () => Promise.reject(new Error('no network in tests')),
  addEventListener() {}, setTimeout, clearTimeout, crypto,
  WORKER_URL: '', APP_VERSION: 'test',
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
// Concatenated, not run one file at a time: a classic <script> puts top-level
// `const` in the shared global lexical scope, and separate vm scripts do not,
// so loading them separately would hide every `const` from the next file —
// which is most of what this is testing.
const FILES = ['js/utils.js', 'js/state.js', 'js/quickparse.js', 'js/syllabus.js', 'js/lmsfeed.js', 'js/ai.js'];
const EXPORTS = ['parseQuickAdd', 'sanitizeCourseDetails', 'SYLLABUS_SCHEMA', 'ASSIGNMENT_SCHEMA', 'qpTime', 'parseIcs', 'feedItemsFromEvents', 'feedCourseLabel', 'feedItemType', 'guessFeedCourse', 'unfoldIcs', 'icsCalendarName'];
vm.runInContext(
  FILES.map(read).join('\n;\n') + `\n;globalThis.__exports = { ${EXPORTS.join(', ')} };`,
  sandbox,
  { filename: 'app-bundle.js' },
);
const { parseQuickAdd, sanitizeCourseDetails, SYLLABUS_SCHEMA, ASSIGNMENT_SCHEMA, qpTime, parseIcs, feedItemsFromEvents, feedCourseLabel, feedItemType, guessFeedCourse, unfoldIcs, icsCalendarName } = sandbox.__exports;

let failed = 0, passed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FAIL  ${name}\n      expected ${e}\n      got      ${a}`);
}
function ok(name, value) { check(name, !!value, true); }

/* ── 1. Quick add ──────────────────────────────────────────────── */
// A fixed Wednesday, so "friday" and "tomorrow" mean the same thing every run.
const now = new Date(2026, 8, 16, 9, 0, 0); // Wed 16 Sep 2026
const courses = [
  { id: 'c1', code: 'BIO 210', name: 'Cell Biology' },
  { id: 'c2', code: 'CHEM 101', name: 'General Chemistry' },
  { id: 'c3', code: 'PSY 100', name: 'Introduction to Psychology' },
];
const qa = (text) => parseQuickAdd(text, { courses, now });

check('a bare hour reads as the afternoon', qpTime('5', '0', ''), '17:00');
check('an explicit am stays morning', qpTime('9', '30', 'am'), '09:30');
check('11:59 is the night deadline', qpTime('11', '59', ''), '23:59');
check('midnight is not hour 24', qpTime('24', '00', ''), null);

check('class code', qa('bio 210 lab report friday 5pm').courseId, 'c1');
check('class subject alone', qa('chem problem set due tomorrow').courseId, 'c2');
check('class by name fragment', qa('psych reading ch 4').courseId, 'c3');
check('no class named', qa('call the registrar tomorrow').courseId, null);

check('weekday ahead', qa('bio lab report friday 5pm').dueDate, '2026-09-18');
check('tomorrow', qa('chem pset tomorrow').dueDate, '2026-09-17');
check('explicit month and day', qa('essay due oct 3').dueDate, '2026-10-03');
check('time with the weekday', qa('bio lab report friday 5pm').dueTime, '17:00');

check('exam type', qa('chem midterm oct 3').type, 'exam');
check('quiz type', qa('bio quiz friday').type, 'quiz');
check('reading type', qa('psych reading ch 4').type, 'reading');
check('plain work is an assignment', qa('chem pset tomorrow').type, 'assignment');
check('priority marker', qa('bio lab report !! friday').priority, 'high');

// The class, date and time come out of the title — what's left is the thing.
check('title is what remains', qa('bio 210 lab report friday 5pm').title.toLowerCase().includes('lab report'), true);
check('title drops the date', /friday/i.test(qa('bio 210 lab report friday 5pm').title), false);

/* ── 2. The syllabus contract ──────────────────────────────────── */
// Structured outputs reject a schema that doesn't close its objects, and a
// missing `required` entry means the model may silently omit that field.
function walkSchema(node, path = 'root') {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'object') {
    ok(`${path} closes additionalProperties`, node.additionalProperties === false);
    const props = Object.keys(node.properties || {});
    check(`${path} requires every property`, (node.required || []).slice().sort(), props.slice().sort());
    props.forEach(k => walkSchema(node.properties[k], `${path}.${k}`));
  }
  if (node.type === 'array') walkSchema(node.items, `${path}[]`);
  (node.anyOf || []).forEach((n, i) => walkSchema(n, `${path}|${i}`));
  // Constraints structured outputs does not support, and would 400 on.
  ['minimum', 'maximum', 'minLength', 'maxLength', 'multipleOf'].forEach(k => {
    ok(`${path} has no unsupported "${k}"`, !(k in node));
  });
}
walkSchema(SYLLABUS_SCHEMA);
walkSchema(ASSIGNMENT_SCHEMA);

// Every field the schema lets the model return must be one the sanitizer keeps.
// A field that survives the model and dies here is a field the student typed
// out of their syllabus by hand for no reason.
const fromSchema = Object.keys(SYLLABUS_SCHEMA.properties.details.properties);
const kept = sanitizeCourseDetails({
  email: 'prof@university.edu', phone: '555-0100', office: 'Science Hall 310',
  officeHours: [{ day: 2, start: '14:00', end: '15:30', where: 'Science Hall 310' }],
  officeHoursNote: 'or by appointment',
  tas: [{ name: 'Ana Reyes', email: 'ana@university.edu', officeHours: 'Thu 10-11' }],
  absenceLimit: 3, absencePolicy: 'Three absences are allowed.', latePolicy: 'Lab reports lose 10% per day.',
  policies: [{ title: 'Missed exams', text: 'Email within 24 hours.' }],
  website: 'bio210.university.edu', textbook: 'Molecular Biology of the Cell',
});
fromSchema.forEach(field => {
  const v = kept[field];
  ok(`sanitizeCourseDetails keeps "${field}"`, Array.isArray(v) ? v.length > 0 : v !== '' && v != null);
});
check('a bare domain becomes a real link', kept.website, 'https://bio210.university.edu');
check('a bad email is dropped, not stored', sanitizeCourseDetails({ email: 'see the syllabus' }).email, '');
check('an absence limit is a whole number', sanitizeCourseDetails({ absenceLimit: '3.4' }).absenceLimit, 3);
check('an invented absence limit of -1 is refused', sanitizeCourseDetails({ absenceLimit: -1 }).absenceLimit, null);
check('office hours without a start time are dropped', sanitizeCourseDetails({ officeHours: [{ day: 2, where: 'somewhere' }] }).officeHours, []);
check('a day outside the week is dropped', sanitizeCourseDetails({ officeHours: [{ day: 9, start: '10:00' }] }).officeHours, []);

/* ── 3. LMS calendar feeds ─────────────────────────────────────── */
// A slice of a real Canvas feed: folded lines, escaped commas, a UTC due
// time, an all-day event, a plain calendar entry, and a repeating meeting.
const canvasIcs = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Instructure Inc//Canvas Calendar//EN', "X-WR-CALNAME:Nyla's Canvas",
  'BEGIN:VEVENT', 'DTSTART:20261002T035959Z', 'DTEND:20261002T035959Z', 'SUMMARY:Problem Set 3 [BIO-210-001]',
  'DESCRIPTION:Chapters 7\\, 8\\, and 9\\nBring questions', 'UID:event-assignment-4471', 'URL:https://school.instructure.com/courses/1/assignments/4471', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261010', 'DTEND;VALUE=DATE:20261011', 'SUMMARY:Midterm exam [CHEM-101]', 'UID:event-assignment-9', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART:20261003T150000Z', 'SUMMARY:Guest lecture: careers panel [BIO-210-001]', 'UID:event-calendar-event-77', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART:20260901T140000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO', 'SUMMARY:Lecture [BIO-210-001]', 'UID:event-calendar-event-78', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART:20261005T035959Z', 'SUMMARY:A very long assignment title that the calendar wraps onto', '  a second folded line [PSY-100]', 'UID:event-assignment-12', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART:20240115T035959Z', 'SUMMARY:Old homework [BIO-210-001]', 'UID:event-assignment-1', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');
const feedToday = '2026-09-20';
const evs = parseIcs(canvasIcs);
check('ics: every entry is read', evs.length, 6);
check('ics: folded lines are joined', evs[4].title, 'A very long assignment title that the calendar wraps onto a second folded line [PSY-100]');
check('ics: escaped commas and newlines are unescaped', evs[0].description, 'Chapters 7, 8, and 9\nBring questions');
check('ics: the calendar name is read', icsCalendarName(canvasIcs), "Nyla's Canvas");
check('ics: an all-day entry has no time', evs[1].when, { date: '2026-10-10', time: null, allDay: true });
{
  // 03:59:59Z is 11:59pm the evening before in US time zones and 04:59 the
  // same day in London: whatever this machine's zone is, the conversion has
  // to agree with the platform's own Date, or every due date is off by hours.
  const local = new Date(Date.UTC(2026, 9, 2, 3, 59, 59));
  const expectDate = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
  const expectTime = `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
  check('ics: a UTC due time lands on the local date', evs[0].when.date, expectDate);
  check('ics: and keeps the local clock time', evs[0].when.time, expectTime);
}
check('ics: a repeating entry is marked', evs[3].recurring, true);
check('label: Canvas puts the course in brackets', feedCourseLabel({ title: 'Problem Set 3 [BIO-210-001]', description: '' }), { label: 'BIO-210-001', title: 'Problem Set 3' });
check('label: Blackboard names it in the description', feedCourseLabel({ title: 'Essay 1', description: 'Course: ENGL 101\nDue by midnight' }), { label: 'ENGL 101', title: 'Essay 1' });
check('label: Brightspace leads with the code', feedCourseLabel({ title: 'MATH 152 - Quiz 2', description: '' }), { label: 'MATH 152', title: 'Quiz 2' });
check('label: nothing to go on', feedCourseLabel({ title: 'Reflection', description: '' }), { label: '', title: 'Reflection' });
check('type: exams are exams', feedItemType('Midterm exam'), 'exam');
check('type: quizzes are quizzes', feedItemType('Quiz 2: chapters 3-4'), 'quiz');
check('type: the default is an assignment', feedItemType('Problem Set 3'), 'assignment');
const feedCourses = [{ id: 'bio', code: 'BIO 210', name: 'Cell Biology' }, { id: 'chem', code: 'CHEM 101', name: 'General Chemistry' }, { id: 'psy', code: 'PSY 100', name: 'Intro to Psychology' }];
check('course: a Canvas section label matches its course', guessFeedCourse('BIO-210-001', { title: '', description: '' }, feedCourses), 'bio');
check('course: a course name in the description matches', guessFeedCourse('', { title: 'Reading', description: 'For General Chemistry, chapter 2' }, feedCourses), 'chem');
check('course: no match is null, never a guess', guessFeedCourse('HIST-200', { title: 'Essay', description: '' }, feedCourses), null);
{
  const { items, skipped } = feedItemsFromEvents(evs, 'canvas', feedToday);
  check('items: assignments, the exam, and the folded one come through', items.map(i => i.uid), ['event-assignment-4471', 'event-assignment-9', 'event-assignment-12']);
  check('items: a plain calendar entry is left out', skipped.notDeadline, 1);
  check('items: the weekly lecture is left out', skipped.repeating, 1);
  check('items: last year’s homework is left out', skipped.outside, 1);
  check('items: an all-day due date is due at night', items[1].dueTime, '23:59');
  check('items: the bracket is stripped from the title', items[0].title, 'Problem Set 3');
  check('items: the link is kept', items[0].url, 'https://school.instructure.com/courses/1/assignments/4471');
  check('items: a lecture in another system is a deadline (nothing else to go on)', feedItemsFromEvents([{ uid: 'x', title: 'Lecture 4', description: '', when: { date: '2026-10-01', time: '10:00', allDay: false }, recurring: false, url: '' }], 'brightspace', feedToday).items.length, 1);
}
check('ics: CRLF, LF and a BOM all unfold the same', unfoldIcs('\uFEFFA:b\r\n c\nD:e'), 'A:bc\nD:e');

/* ── 4. The files that have to agree with each other ───────────────
   index.html's script list is the app's dependency graph, and sw.js keeps
   a second copy of that list in APP_SHELL so the app works offline. Two
   hand-maintained copies of the same list is exactly the kind of thing
   that drifts: add a file to index.html, forget sw.js, and the app is
   fine until somebody loses signal — at which point one script 404s from
   the cache and the whole thing is a white screen, on the day it mattered.

   The same check runs in the browser (tests/e2e/offline.spec.mjs) against
   what the page really requested. This one is here because it costs
   nothing and fails before the push rather than after it. */
const indexHtml = read('index.html');
const swSrc = read('sw.js');
const indexScripts = [...indexHtml.matchAll(/<script[^>]+src="((?!https?:)[^"]+)"/g)].map(m => m[1]);
const appShell = [...((swSrc.match(/const APP_SHELL = \[([\s\S]*?)\];/) || [])[1] || '').matchAll(/'([^']+)'/g)].map(m => m[1]);
ok('index.html lists its scripts', indexScripts.length > 10);
ok('sw.js has an app shell', appShell.length > 10);
check('every script index.html loads is cached for offline', indexScripts.filter(f => !appShell.includes(f)), []);
// The other direction is only a warning's worth of wrong — a stale entry
// wastes a little cache — except for a file that no longer exists at all,
// which makes the install step fetch a 404 on every deploy.
check('sw.js caches nothing that was deleted', appShell.filter(f => f.endsWith('.js') && !existsSync(join(root, f))), []);

/* ── 5. Switches that ship off ─────────────────────────────────────
   Link codes and the first-week setup counts are built but switched off
   in js/config.js until Nyla turns them on. These check that they ship
   off, that off really means nothing happens, and what on would do. Each
   runs in its own small context with just the globals the file uses. */
{
  const configSrc = read('js/config.js');
  check('link codes ship switched off', /const FEATURES = \{[^}]*linkCodes: false/.test(configSrc), true);
  check('setup counts ship switched off', /const FEATURES = \{[^}]*setupCounts: false/.test(configSrc), true);
  const session = new Map();
  const linkBox = (search, on) => {
    const box = { location: { search }, sessionStorage: { getItem: k => (session.has(k) ? session.get(k) : null), setItem: (k, v) => session.set(k, String(v)) }, URLSearchParams };
    vm.createContext(box);
    vm.runInContext((on ? configSrc.replace('linkCodes: false', 'linkCodes: true') : configSrc) + '\n;globalThis.__linkCode = linkCode;', box);
    return box.__linkCode;
  };
  check('link code off: nothing read, nothing kept', [linkBox('?via=campus-tour', false)(), session.size], ['', 0]);
  check('link code on: a good code is kept, lowercased', linkBox('?via=Campus-Tour', true)(), 'campus-tour');
  check('link code on: it outlives the page it came in on', linkBox('', true)(), 'campus-tour');
  check('link code on: a malformed one is ignored, the kept one stays', linkBox('?via=%3Cscript%3E', true)(), 'campus-tour');
  session.clear();
  check('link code on: too long is ignored', linkBox(`?via=${'x'.repeat(25)}`, true)(), '');

  const setupSrc = read('js/setupcounts.js');
  const setupBox = ({ on, courses = [], createdDaysAgo = 1, licensed = true }) => {
    const sent = [];
    const box = {
      FEATURES: { setupCounts: on }, window: { _licensed: licensed, _licenseDoc: null }, _fbUser: { uid: 'u1' },
      state: { settings: {}, courses }, save() {}, todayIso: () => '2026-09-23', isEmbedded: () => false,
      diag: { event: (name, detail) => sent.push([name, detail]), warn() {} }, Date, Number, Array,
    };
    vm.createContext(box);
    vm.runInContext(setupSrc + '\n;globalThis.__s = { setupCountsBaseline, countSetupStep };', box);
    const user = { metadata: { creationTime: new Date(Date.now() - createdDaysAgo * 86400000).toUTCString() } };
    return { ...box.__s, sent, box, user };
  };
  let t = setupBox({ on: false });
  t.setupCountsBaseline(t.user); t.countSetupStep('setup_class_added', 'manual');
  check('setup counts off: no baseline, nothing sent', [t.box.state.settings.setupCounts, t.sent.length], [undefined, 0]);
  t = setupBox({ on: true });
  t.setupCountsBaseline(t.user);
  t.countSetupStep('setup_class_added', 'manual'); t.countSetupStep('setup_class_added', 'syllabus'); t.countSetupStep('setup_deadlines_in', 'lms');
  check('setup counts on, new account: each sent once, with only its source', t.sent, [['setup_class_added', { source: 'manual' }], ['setup_deadlines_in', { source: 'lms' }]]);
  t.countSetupStep('not_a_setup_event');
  check('setup counts on: only the three names', t.sent.length, 2);
  t = setupBox({ on: true, courses: [{ id: 'c1' }] });
  t.setupCountsBaseline(t.user); t.countSetupStep('setup_class_added', 'manual');
  check('setup counts on, an account that already has classes: never counted', [t.box.state.settings.setupCounts.counted, t.sent.length], [false, 0]);
  t = setupBox({ on: true, createdDaysAgo: 90 });
  t.setupCountsBaseline(t.user); t.countSetupStep('setup_group_joined', 'club');
  check('setup counts on, an old account with nothing in it: not counted', t.sent.length, 0);
  t = setupBox({ on: true });
  t.box.state.settings.setupCounts = { counted: true, since: '2026-09-20', sent: ['setup_class_added'] };
  t.setupCountsBaseline(t.user); t.countSetupStep('setup_class_added', 'manual');
  check('setup counts on: a baseline already synced from another device is kept, and not sent twice', [t.box.state.settings.setupCounts.since, t.sent.length], ['2026-09-20', 0]);
}

/* ── Error Viewer fixes, Sept 25 ─────────────────────────────────── */

// A full device: the backup copy is dropped to make room, and if that is
// still not enough the save is skipped (not thrown), and she is told once.
{
  const toasts = [];
  sandbox.toast = (m) => toasts.push(m);
  const quota = () => Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
  const mem = {};
  let room = 1; // how many more writes fit before the device is full
  vm.runInContext('dataStore', sandbox);
  sandbox.__fullStore = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { if (room <= 0) throw quota(); room--; mem[k] = String(v); },
    removeItem: (k) => { if (k in mem) { delete mem[k]; room++; } },
  };
  vm.runInContext('dataStore = __fullStore; _lastBackupAt = 0;', sandbox);
  mem[vm.runInContext('storeKey', sandbox) + '.bak'] = 'old backup';
  room = 0;
  let threw = false;
  try { vm.runInContext('save({ localOnly: true })', sandbox); } catch { threw = true; }
  check('storage full: save never throws', threw, false);
  check('storage full: the backup made room for the plan', [typeof mem[vm.runInContext('storeKey', sandbox)], vm.runInContext('storeKey', sandbox) + '.bak' in mem], ['string', false]);
  room = 0;
  for (const k of Object.keys(mem)) delete mem[k];
  vm.runInContext('_lastBackupAt = Date.now(); save({ localOnly: true }); save({ localOnly: true });', sandbox);
  check('storage full with nothing to drop: told once, not on every keystroke', toasts.length, 1);
  vm.runInContext('dataStore = makeMemoryStore();', sandbox);
}

// A dropped connection: every call that failed in the same moment is one
// report, and a real error still goes through on its own.
{
  const posted = [];
  const timers = [];
  const box = {
    console: { ...console, warn() {}, error() {} }, navigator: { onLine: true, userAgent: 'node' }, location: { pathname: '/index.html', search: '' },
    document: { hidden: false, referrer: '' }, WORKER_URL: 'https://worker.test', APP_VERSION: 'test', crypto,
    sessionStorage: { getItem: () => null, setItem() {} }, localStorage: { getItem: () => null, setItem() {} },
    fetch: async (url, init) => { if (String(url).endsWith('/log-error')) posted.push(JSON.parse(init.body)); return { status: 200, ok: true }; },
    addEventListener() {}, setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {},
    URL, URLSearchParams, matchMedia: () => ({ matches: false }), innerWidth: 390, innerHeight: 800,
  };
  box.window = box; box.self = box; box.top = box; box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(read('js/diagnostics.js') + '\n;globalThis.__diag = diag;', box, { filename: 'diagnostics.js' });
  const d = box.__diag;
  const net = (code, message) => Object.assign(new Error(message), code ? { code } : {});
  d.warn('license', 'License claim failed', net('auth/network-request-failed', 'Firebase: A network AuthError has occurred. (auth/network-request-failed).'));
  d.warn('auth', 'Could not record the terms acceptance', net('auth/network-request-failed', 'Firebase: A network AuthError has occurred.'));
  d.warn('feeds', 'Calendar feed refresh failed', net('', 'Load failed'));
  d.error('group-plans', 'Worker /group/mine unreachable', net('', 'Load failed'));
  d.error('syllabus', 'Could not save the class', net('', 'Cannot read properties of undefined'));
  await new Promise(r => setImmediate(r));
  const before = posted.length;
  timers.splice(0).forEach(fn => fn());
  await new Promise(r => setImmediate(r));
  check('network: a real error is still reported straight away', posted.slice(0, before).map(p => p.feature), ['syllabus']);
  const dropped = posted.slice(before);
  check('network: the dropped calls are one report, as a warning', [dropped.length, dropped[0]?.level, dropped[0]?.feature], [1, 'warn', 'network']);
  check('network: it names what was affected', dropped[0]?.message, 'Connection dropped (auth, feeds, group-plans, license)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
