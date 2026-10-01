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

// Group tasks (Tier A item 9): "@maya" picks a current member, never an
// ambiguous one, and classes, times and "asap" stay in a group task's title.
{
  const people = [{ uid: 'm', name: 'Maya' }, { uid: 'mc', name: 'Maya Chen' }, { uid: 'j', name: 'Jordan Lee' }, { uid: 'me', name: 'Nyla' }, { uid: 'p1', name: 'Priya' }, { uid: 'p2', name: 'Priya' }];
  const ta = (text) => { const r = sandbox.parseTaskAdd(text, { people, meUid: 'me', now }); return [r.title, r.dueDate, r.uid, r.ambiguous]; };
  check('task add: day and @name come out of the title', ta('make quizlet fri @maya'), ['Make quizlet', '2026-09-18', 'm', false]);
  check('task add: the longest whole name wins', ta('@maya chen outline intro'), ['Outline intro', null, 'mc', false]);
  check('task add: two people with one name picks nobody', ta('@priya book room'), ['@priya book room', null, null, true]);
  check('task add: @me, a last name, a unique start', [ta('@me book room')[2], ta('@lee post answers')[2], ta('@jor slides')[2]], ['me', 'j', 'j']);
  check('task add: an email address is not a mention', ta('email prof@school.edu')[2], null);
  check('task add: classes and times stay in the title', ta('outline bio 210 intro at 5pm')[0], 'Outline bio 210 intro at 5pm');
  check('task add: only a day and a name leaves no title', ta('fri @maya')[0], '');
}

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
  // Switched on Sept 27 2026 for the launch-foundations measurement.
  check('setup counts ship switched on', /const FEATURES = \{[^}]*setupCounts: true/.test(configSrc), true);
  check('usage counts ship switched on', /const FEATURES = \{[^}]*usageCounts: true/.test(configSrc), true);
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

  // Anonymous weekly counts (js/usagecounts.js).
  const usageSrc = read('js/usagecounts.js');
  const usageBox = ({ on = true, licensed = true, embedded = false, purchasedDaysAgo = 2, settings = {} } = {}) => {
    const sent = [];
    const store = new Map();
    const box = {
      FEATURES: { usageCounts: on }, _fbUser: { uid: 'u1' },
      window: { _licensed: licensed, _licenseDoc: purchasedDaysAgo === null ? null : { purchasedAt: new Date(Date.now() - purchasedDaysAgo * 86400000).toISOString() } },
      state: { settings }, save() {}, isEmbedded: () => embedded,
      localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
      diag: { event: (name, detail) => sent.push([name, detail]), warn() {} }, Date, Number, Array, Object, Math, String,
    };
    vm.createContext(box);
    vm.runInContext(usageSrc + '\n;globalThis.__u = { usageOnLoad, usageOnRoute, usageAccountCreated, usageWeek };', box);
    return { ...box.__u, sent, box };
  };
  let u = usageBox();
  u.usageOnLoad(); u.usageOnLoad();
  const wk = u.usageWeek();
  check('usage: active this week, sent once', u.sent.filter(x => x[0] === 'app_active_week'), [['app_active_week', { week: wk }]]);
  check('usage: two days into a plan is the "day 2" return', u.sent.filter(x => x[0] === 'return_day').map(x => x[1].source), ['d2']);
  ok('usage: the cohort is a week label, nothing else', /^\d{4}-W\d{2}$/.test(u.sent.find(x => x[0] === 'return_day')[1].cohort));
  u.usageOnRoute('calendar'); u.usageOnRoute('calendar'); u.usageOnRoute('studytools'); u.usageOnRoute('settings');
  check('usage: each feature once a week, by its public name, labelled first week', u.sent.filter(x => x[0] === 'feature_used_week').map(x => [x[1].feature, x[1].source]), [['calendar', 'week1'], ['flashcards', 'week1']]);
  ok('usage: nothing but week, feature, source and cohort ever goes', u.sent.every(([, d]) => !d || Object.keys(d).every(k => ['week', 'feature', 'source', 'cohort'].includes(k))));
  u = usageBox({ purchasedDaysAgo: 30 });
  u.usageOnLoad(); u.usageOnRoute('exams');
  check('usage: day 30 returns count, and later weeks are labelled later', [u.sent.find(x => x[0] === 'return_day')[1].source, u.sent.find(x => x[0] === 'feature_used_week')[1].source], ['d30', 'later']);
  u = usageBox({ settings: { usage: { week: '2020-W01', active: true, features: ['calendar'], returns: [] } } });
  u.usageOnLoad(); u.usageOnRoute('calendar');
  check('usage: a new week counts again', u.sent.map(x => x[0]).filter(n => n !== 'return_day'), ['app_active_week', 'feature_used_week']);
  for (const [label, opts] of [['off', { on: false }], ['unpaid', { licensed: false }], ['embedded demo', { embedded: true }]]) {
    u = usageBox(opts);
    u.usageOnLoad(); u.usageOnRoute('calendar');
    check(`usage: ${label} sends nothing`, u.sent.length, 0);
  }
  u = usageBox();
  const fresh = { uid: 'n1', metadata: { creationTime: new Date().toUTCString() } };
  u.usageAccountCreated(fresh); u.usageAccountCreated(fresh);
  u.usageAccountCreated({ uid: 'old', metadata: { creationTime: new Date(Date.now() - 5 * 86400000).toUTCString() } });
  check('usage: a brand-new account is counted once, an old one never', u.sent, [['account_created', undefined]]);
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

/* ── 6. Every script index.html loads, together, in order ───────────
   The classic scripts share one global scope. A name declared at the top
   of two files (a `const` left behind after a move, say) is a
   SyntaxError that stops the second file from running at all, and a
   file whose top-level code reads a `const` from a file that loads later
   (orgs.js reads GROUP_COLORS from js/spaces/core.js) throws on load.
   Either one is a dead Study Groups or Clubs page. So: the whole list,
   concatenated, has to parse, and then every file, run one after another
   in a single context exactly the way the browser runs them, has to load
   without throwing, boot included. The DOM and the CDN scripts are a
   stand-in that accepts anything; only the app's own names are real. */
{
  const scripts = [...indexHtml.matchAll(/<script[^>]+src="((?!https?:)[^"]+)"/g)].map(m => m[1]);
  let parsed = true;
  try { new vm.Script(scripts.map(f => read(f)).join('\n;\n'), { filename: 'index-bundle.js' }); }
  catch (e) { parsed = false; console.error('  index.html scripts do not parse together:', e.message); }
  ok('index.html: every local script, concatenated in order, parses (no name declared twice)', parsed);
  // A second top-level `function foo` or `var foo` parses fine and silently
  // replaces the first, and inline onclick strings call these names.
  {
    const seen = new Map(), dupes = [];
    for (const f of scripts) {
      for (const m of read(f).matchAll(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^var\s+([A-Za-z_$][\w$]*)/gm)) {
        const name = m[1] || m[2];
        if (seen.has(name) && seen.get(name) !== f) dupes.push(`${name} (${seen.get(name)} and ${f})`);
        else if (!seen.has(name)) seen.set(name, f);
      }
    }
    if (dupes.length) console.error('  declared at the top of two scripts:', dupes.join(', '));
    check('index.html: no top-level function or var is declared in two scripts', dupes, []);
  }

  // Anything: every property is another anything, calling or constructing
  // one returns one, and it is never a thenable, so awaits settle.
  const any = new Proxy(function () {}, {
    get: (t, k) => k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : k === Symbol.iterator ? function* () {} : k === 'length' ? 0 : any,
    set: () => true, has: () => true, deleteProperty: () => true,
    apply: () => any, construct: () => any,
  });
  const mem = {};
  const store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; }, key: () => null, get length() { return 0; }, clear() {} };
  const box = {
    console: { ...console, log() {}, info() {}, debug() {} },
    document: any, localStorage: store, sessionStorage: store, indexedDB: any,
    navigator: { onLine: true, userAgent: 'node', language: 'en-US', languages: ['en-US'], clipboard: any, storage: any },
    location: { pathname: '/index.html', search: '', hash: '', href: 'http://localhost/index.html', origin: 'http://localhost', hostname: 'localhost', host: 'localhost', protocol: 'http:', reload() {}, replace() {}, assign() {} },
    history: { replaceState() {}, pushState() {}, back() {}, state: null },
    fetch: () => Promise.reject(new Error('no network in tests')),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {}, requestIdleCallback: () => 0, queueMicrotask,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    getComputedStyle: () => any, getSelection: () => any, scrollTo() {}, scrollBy() {}, open: () => null, alert() {}, confirm: () => false, prompt: () => null,
    innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1, screen: { width: 1440, height: 900 }, visualViewport: any,
    crypto, performance, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Blob, structuredClone, atob, btoa,
    firebase: any, Event: any, CustomEvent: any, Image: any, FileReader: any, FormData: any, Notification: any, BroadcastChannel: any,
    MutationObserver: any, ResizeObserver: any, IntersectionObserver: any, DOMParser: any, HTMLElement: any, Element: any, Node: any, CSS: any,
  };
  box.window = box; box.self = box; box.globalThis = box; box.top = box; box.parent = box;
  vm.createContext(box);
  let failedAt = null;
  for (const f of scripts) {
    try { vm.runInContext(read(f), box, { filename: f }); }
    catch (e) { failedAt = `${f}: ${e.message}`; break; }
  }
  if (failedAt) console.error('  load failed at', failedAt);
  check('index.html: every local script loads in order in one context, app boot included', failedAt, null);
  const loaded = (names) => names.filter(n => { try { return vm.runInContext(`typeof ${n}`, box) === 'undefined'; } catch { return true; } });
  check('study groups and clubs: their entry points exist after load', loaded(['pageStudyGroups', 'pageGroupDetail', 'groupWrite', 'groupAvailabilityTab', 'groupResourcesTab', 'pageOrgs', 'pageOrgDetail', 'orgWrite', 'orgAdminTab', 'orgFilesTab', 'copyText', 'SAFE_ID', 'GROUP_COLORS', 'ORG_COLORS', 'downloadCsv']), []);
  check('spaces: the shared RSVP and event pieces exist after load', loaded(['spaceRsvp', 'setSpaceRsvp', 'spaceRsvpNextValue', 'spaceStillComingDue', 'spaceEventSheet', 'spaceRsvpLists', 'eventTimeState', 'countdownLabel', 'spaceEventHero', 'spaceAgendaRow', 'spaceWeekStrip', 'spaceStatTile', 'spaceFacePile', 'spaceDateBlock', 'rsvpControl', 'orgRsvpControl', 'orgDuesLink', 'orgIsDuesEvent']), []);

  /* ── 7. RSVP and event time, on the loaded scripts ───────────────
     The shared control passes toggle=false on every button, so tapping
     the answer you already gave ("Still coming? Yes", or Change and then
     the same answer) must never clear it. Only the old toggle clears. */
  const run = (code) => vm.runInContext(code, box);
  check('rsvp: toggle=false keeps the same answer', run(`spaceRsvpNextValue('yes', 'yes', false)`), 'yes');
  check('rsvp: toggle=true on the same answer clears it', run(`spaceRsvpNextValue('yes', 'yes', true)`), null);
  check('rsvp: a new answer is written either way', run(`[spaceRsvpNextValue('no', 'yes', true), spaceRsvpNextValue('', 'maybe', false)]`), ['yes', 'maybe']);
  run(`
    globalThis.__writes = [];
    findGroup = () => ({ code: 'GRP', sessions: { s1: { id: 's1', rsvp: { me: 'yes' } } } });
    myUidFor = () => 'me';
    groupWrite = async (code, ops) => { __writes.push(Object.values(ops)[0]); return true; };
    findOrg = () => ({ code: 'CLB' });
    myOrgUid = () => 'me';
    myOrgRsvp = () => 'yes';
    orgWrite = async (code, ops) => { __writes.push(Object.values(ops)[0]); return true; };
  `);
  await run(`(async () => {
    await setSpaceRsvp('group', 'GRP', 's1', 'yes', { toggle: false });
    await setSpaceRsvp('club', 'CLB', 'e1', 'yes', { toggle: false });
    await spaceStillComing('group', 'GRP', 's1', true);
    await setSessionRsvp('GRP', 's1', 'yes');
  })()`);
  const writes = run(`__writes.map(v => v === GW_DELETE ? 'DELETE' : v)`);
  check('rsvp: "Going" again and "Still coming? Yes" never write a delete; the old toggle still can', writes, ['yes', 'yes', 'yes', 'DELETE']);

  // A fixed Tuesday, 29 Sep 2026, 10:00.
  const at = (h, m = 0) => `new Date(2026, 8, 29, ${h}, ${m})`;
  const st = (ev, h, m) => run(`(() => { const s = eventTimeState(${JSON.stringify(ev)}, ${at(h, m)}); return [s.phase, s.label]; })()`);
  check('event time: 20 minutes before', st({ date: '2026-09-29', start: '10:20', end: '11:00' }, 10), ['before', 'in 20 min']);
  check('event time: during', st({ date: '2026-09-29', start: '09:30', end: '11:00' }, 10), ['now', 'Happening now']);
  check('event time: no end counts as an hour', st({ date: '2026-09-29', start: '09:30' }, 10, 29), ['now', 'Happening now']);
  check('event time: an hour after a start with no end, it ended', st({ date: '2026-09-29', start: '09:00' }, 10, 1), ['after', 'Ended']);
  check('event time: a late start with no end stops at 23:59', run(`eventTimeState({ date: '2026-09-29', start: '23:30' }, ${at(23, 45)}).endsAt`), '23:59');
  check('event time: a deadline with no time is now all day', st({ date: '2026-09-29' }, 23, 50), ['now', 'Happening now']);
  check('event time: yesterday is over', st({ date: '2026-09-28', start: '18:00' }, 10), ['after', 'Ended']);
  check('event time: this evening reads tonight', st({ date: '2026-09-29', start: '19:00' }, 10), ['before', 'tonight']);
  check('event time: this afternoon counts hours', st({ date: '2026-09-29', start: '13:00' }, 10), ['before', 'in 3 hours']);
  check('event time: tomorrow', st({ date: '2026-09-30', start: '09:00' }, 10), ['before', 'tomorrow']);
  check('event time: two days out', st({ date: '2026-10-01', start: '09:00' }, 10), ['before', 'in 2 days']);
  check('event time: a deadline later today reads today', run(`countdownLabel({ date: '2026-09-29' }, ${at(10)})`), 'today');
  // Tier A item 7: row chips, the recap window, the past-tense face caption.
  check('event time: a row chip says Happening now during, nothing after, nothing two days out', run(`[
    /Happening now/.test(spaceWhenChip({ date: '2026-09-29', start: '09:30' }, { now: ${at(10)} })),
    spaceWhenChip({ date: '2026-09-29', start: '08:00', end: '09:00' }, { now: ${at(10)} }),
    spaceWhenChip({ date: '2026-10-01', start: '09:00' }, { now: ${at(10)} }),
    /Tonight/.test(spaceWhenChip({ date: '2026-09-29', start: '19:00' }, { now: ${at(10)} })),
  ]`), [true, '', '', true]);
  check('event time: "just ended" lasts 18 hours after the end', run(`[
    spaceRecentlyEnded({ date: '2026-09-28', start: '17:00', end: '18:00' }, 18, ${at(10)}),
    spaceRecentlyEnded({ date: '2026-09-28', start: '13:00', end: '14:00' }, 18, ${at(10)}),
    spaceRecentlyEnded({ date: '2026-09-29', start: '11:00' }, 18, ${at(10)}),
  ]`), [true, false, false]);
  check('face pile: after the event it says who said they’d go', run(`[
    spaceFaceCaption([{ uid: 'me', name: 'Nyla' }], 'me', 'said'),
    spaceFaceCaption([{ uid: 'a', name: 'Maya Lee' }], 'me', 'said'),
    spaceFaceCaption([{ uid: 'me' }, { uid: 'a', name: 'Maya' }, { uid: 'b', name: 'Jo' }, { uid: 'c', name: 'Al' }], 'me', 'said'),
  ]`), ['You said you’d go', 'Maya said they’d go', 'You, Maya and 2 others said they’d go']);
  // Tier A item 9: group tasks (js/groups/tasks.js). An owner who left
  // gives the task back; credit goes to the owner, then the checker, current
  // members only, in member order, never a zero; leaving clears only upcoming RSVPs.
  check('tasks: an owner who left is nobody, and taskList agrees', run(`(() => {
    const g = { memberUids: ['a', 'b'], people: { a: { name: 'Ana' }, b: { name: 'Ben' } }, taskItems: { t1: { id: 't1', title: 'X', assignee: 'gone' }, t2: { id: 't2', title: 'Y', assignee: 'a' } } };
    return [taskOwner(g, g.taskItems.t1), taskOwner(g, g.taskItems.t2), taskList(g).map(t => t.assignee), taskOwner({ memberUids: [] }, { assignee: 'z' })];
  })()`), [null, 'a', [null, 'a'], 'z']);
  check('tasks: this week’s credit goes to the owner first, in member order, with no zeros', run(`(() => {
    const now = Date.now(), old = now - 9 * 86400000;
    const g = { memberUids: ['a', 'b', 'c'], people: { a: { name: 'Ana', joinedAt: 1 }, b: { name: 'Ben', joinedAt: 2 }, c: { name: 'Cy', joinedAt: 3 } }, taskItems: {
      t1: { id: 't1', title: '1', done: true, assignee: 'b', doneBy: 'a', doneAt: now },
      t2: { id: 't2', title: '2', done: true, assignee: null, doneBy: 'a', doneAt: now },
      t3: { id: 't3', title: '3', done: true, assignee: 'gone', doneBy: 'gone', doneAt: now },
      t4: { id: 't4', title: '4', done: true, assignee: 'b', doneBy: 'b', doneAt: old },
      t5: { id: 't5', title: '5', done: false, assignee: 'c' },
      t6: { id: 't6', title: '6', done: true, doneByName: 'Old', doneAt: now } } };
    return groupTaskCredits(g, { since: now - 7 * 86400000 }).map(c => c.uid + c.n);
  })()`), ['a1', 'b1']);
  check('tasks: leaving clears their tasks and upcoming RSVPs with deletes, past ones stay', run(`(() => {
    const g = { memberUids: ['a', 'b'], taskItems: { t1: { id: 't1', title: 'X', assignee: 'b' }, t2: { id: 't2', title: 'Y', assignee: 'a' } },
      sessions: { s1: { id: 's1', date: '2099-01-01', start: '10:00', rsvp: { b: 'yes', a: 'no' } }, s2: { id: 's2', date: '2001-01-01', start: '10:00', rsvp: { b: 'yes' } }, s3: { id: 's3', date: '2099-01-02', rsvp: { a: 'yes' } } } };
    const ops = groupDepartureOps(g, 'b');
    return Object.keys(ops).sort().map(k => k + (ops[k] === GW_DELETE ? ':del' : ':?'));
  })()`), ['sessions.s1.rsvp.b:del', 'taskItems.t1.assignee:del', 'taskItems.t1.assigneeName:del']);
  // Tier A item 15: chat (js/spaces/chat.js).
  check('chat: URLs and @mentions are tokenized once from the raw text; an email is not a mention', run(`(() => {
    const names = chatNameIndex([{ uid: 'm', name: 'Maya Chen' }, { uid: 'j', name: 'Jo' }]);
    return chatTokens('@maya chen and @Jo, see https://a.com/x?y=1&z=@q). mail jo@x.com @Joe', names).map(t => t.t + ':' + t.v + (t.uids ? '>' + t.uids.join(',') : ''));
  })()`), ['mention:@maya chen>m', 'text: and ', 'mention:@Jo>j', 'text:, see ', 'url:https://a.com/x?y=1&z=@q', 'text:). mail jo@x.com @Joe']);
  check('chat: a live snapshot merges into loaded history; deletions inside the window drop, older pages stay', run(`(() => {
    const m = (id, at) => ({ id, uid: 'u', name: 'U', text: id, at });
    chatMergeWindow('group', 'TST', [m('b', 2), m('c', 3), m('d', 4)]);
    _chatStore('group', 'TST').byId.set('a', m('a', 1));       // a page from "Load earlier"
    const afterDelete = chatMergeWindow('group', 'TST', [m('b', 2), m('d', 4)]).map(x => x.id);   // c deleted
    const afterSlide = chatMergeWindow('group', 'TST', [m('d', 4), m('e', 5)]).map(x => x.id);    // b slid out of the window
    chatDropStore('group', 'TST');
    return [afterDelete, afterSlide];
  })()`), [['a', 'b', 'd'], ['a', 'b', 'd', 'e']]);
  check('chat: links to this app’s sessions and events parse; other hosts and bad ids do not', run(`[
    chatParseSpaceLink('https://app.semester-hq.com/?join=ab2cd3&session=s_1'),
    chatParseSpaceLink('https://app.semester-hq.com/?org=QWERTY&event=e1'),
    chatParseSpaceLink('https://evil.example/?org=QWERTY&event=e1'),
    chatParseSpaceLink('https://app.semester-hq.com/?org=QWERTY&event=bad%20id'),
  ]`), [{ kind: 'group', code: 'AB2CD3', id: 's_1' }, { kind: 'club', code: 'QWERTY', id: 'e1' }, null, null]);
  check('chat: deleting the newest message previews the one before it, or nothing', run(`[
    chatPreviewAfterDelete([{ id: 'a', uid: 'u1', name: 'A', text: 'hi', at: 1 }, { id: 'b', uid: 'u2', name: 'B', text: 'yo', at: 2 }], 'b'),
    chatPreviewAfterDelete([{ id: 'a', uid: 'u1', name: 'A', text: 'hi', at: 1 }], 'a'),
  ]`), [{ uid: 'u1', name: 'A', text: 'hi', at: 1 }, null]);

  // Tier A item 16: the Files library (js/spaces/files.js).
  check('files: chips, search words and sort (pinned first) pick and order cards', run(`(() => {
    const it = (id, kind, title, at, pinned) => ({ id, kind, title, at, by: 'Priya', url: kind === 'link' ? 'https://openstax.org/x' : '', pinned });
    const items = [it('a', 'note', 'Lecture 14', 3), it('b', 'deck', 'Cell terms', 5), it('c', 'link', 'Chapter 9', 1), it('d', 'file', 'Zeta.pdf', 2, true)];
    const pick = (st) => items.filter(x => libMatch(LIB_CHIP_OF[x.kind], libHaystack(x), st)).map(x => x.id);
    const order = (sort) => items.map(x => ({ id: x.id, k: libSortKey(x) })).sort((p, q) => libCompare(sort)(p.k, q.k)).map(x => x.id);
    return [pick({ chip: 'all', q: '' }), pick({ chip: 'notes', q: '' }), pick({ chip: 'all', q: 'openstax' }), pick({ chip: 'all', q: 'priya cell' }), order('new'), order('az'), order('kind')];
  })()`), [['a', 'b', 'c', 'd'], ['a'], ['c'], ['b'], ['d', 'b', 'a', 'c'], ['d', 'b', 'c', 'a'], ['d', 'a', 'b', 'c']]);
  check('files: type and size labels, counts, and the title key "In your Flashcards" compares', run(`[
    libFileMeta({ kind: 'file', fileName: 'notes.txt', size: 1024 }), libFileMeta({ kind: 'file', fileName: 'scan', size: 0 }), libFileMeta({ kind: 'link', url: 'https://www.example.com/a' }),
    libCountLabel({ kind: 'deck', cards: [{}] }), libCountLabel({ kind: 'note-bundle', notes: [{}, {}] }),
    libTitleKey('  Cell Signaling  ') === libTitleKey('cell signaling'), libIsImage({ kind: 'file', fileName: 'a.JPG', url: 'data:x' }), libIsImage({ kind: 'file', fileName: 'a.pdf', url: 'data:x' }),
  ]`), ['TXT · 1 KB', 'File', 'example.com', '1 card', '2 notes', true, true, false]);
  check('files: a note preview is escaped plain text, never the member’s HTML', run(`(() => {
    const html = libPreview({ id: 'n1', kind: 'note', title: 't', html: '<p>Hi <b>there</b></p><img src=x onerror=alert(1)><p>&lt;script&gt;</p>' });
    return [/<img|<b>|onerror/.test(html), html.includes('&lt;script&gt;'), html.includes('Hi there')];
  })()`), [false, true, true]);

  /* ── 8. What needs you (js/spaces/needs.js), on the loaded scripts ──
     One list feeds the strip, the index and dashboard counts, Heads up
     and the calendar, so its windows are pinned here: sessions, events
     and tasks within 7 days, overdue tasks for 14 days at most, three
     open tasks to claim, availability once two others have added theirs,
     required events only (never dues), pinned announcements not yet read. */
  run(`
    myOrgRsvp = (o, id) => { const v = o.rsvp?.[myOrgUid(o)]?.[id]; return v === 'yes' || v === 'no' ? v : ''; };
    globalThis.__d = (n) => addDays(todayIso(), n);
    globalThis.__g = (mineAvail, others) => {
      const on = { d1: '1'.repeat(AVAIL_SLOTS) };
      const avail = {};
      ['a', 'b', 'c'].slice(0, others).forEach(u => { avail[u] = on; });
      if (mineAvail) avail.me = on;
      const task = (id, extra) => [id, { id, title: 'Task ' + id, done: false, assignee: null, due: null, createdAt: 1, ...extra }];
      return {
        code: 'GRP', name: 'Bio review', memberUids: ['me', 'a', 'b', 'c'], people: {}, avail,
        sessions: {
          s1: { id: 's1', title: 'Tomorrow', date: __d(1), start: '17:00', rsvp: {} },
          s2: { id: 's2', title: 'Answered', date: __d(3), start: '17:00', rsvp: { me: 'yes' } },
          s3: { id: 's3', title: 'Too far', date: __d(10), start: '17:00', rsvp: {} },
        },
        taskItems: Object.fromEntries([
          task('t1', { assignee: 'me', due: __d(2) }), task('t2', { assignee: 'me', due: __d(-20) }), task('t3', { assignee: 'me', due: __d(-3) }),
          task('t5', { assignee: 'me', due: __d(1), done: true }), task('t6', { assignee: 'me' }), task('t7', { assignee: 'a', due: __d(1) }),
          task('u1', { due: __d(4) }), task('u2', { due: __d(5) }), task('u3'), task('u4'),
        ]),
      };
    };
    globalThis.__o = () => ({
      code: 'CLB', name: 'Kestrel House', memberUids: ['me', 'x'], officerUids: ['x'], people: {}, color: '#1F5F6B',
      events: {
        e1: { id: 'e1', title: 'Chapter meeting', date: __d(2), start: '19:00', required: true, category: 'meeting' },
        e2: { id: 'e2', title: 'Spring dues', date: __d(2), required: true, category: 'deadline' },
        e3: { id: 'e3', title: 'Far away', date: __d(9), start: '19:00', required: true, category: 'meeting' },
        e4: { id: 'e4', title: 'Optional social', date: __d(1), start: '19:00', required: false, category: 'social' },
        e5: { id: 'e5', title: 'Said no', date: __d(1), start: '19:00', required: true, category: 'meeting' },
      },
      rsvp: { me: { e5: 'no' } },
      announcements: {
        p1: { id: 'p1', text: 'Formal is Friday', pinned: true, at: 100, uid: 'x', name: 'Noah' },
        p2: { id: 'p2', text: 'Mine', pinned: true, at: 120, uid: 'me', name: 'You' },
        p3: { id: 'p3', text: 'Not pinned', pinned: false, at: 130, uid: 'x', name: 'Noah' },
      },
    });
    state.settings.orgSeen = { CLB: 50 };
  `);
  check('needs: a group lists the unanswered session, your tasks (overdue first), 3 to claim and availability', run(`spaceNeeds('group', __g(false, 2)).items.map(i => i.key)`),
    ['session:s1', 'task:t3', 'task:t1', 'claim:u1', 'claim:u2', 'claim:u3', 'avail']);
  check('needs: availability waits for two others, and stops once yours is in', run(`[spaceNeeds('group', __g(false, 1)).items.some(i => i.type === 'avail'), spaceNeeds('group', __g(true, 3)).items.some(i => i.type === 'avail')]`), [false, false]);
  check('needs: a weekly series asks once, for its next session', run(`(() => { const g = __g(false, 2); g.sessions.s1.seriesId = 'w'; g.sessions.s4 = { id: 's4', title: 'Next week', date: __d(6), start: '17:00', rsvp: {}, seriesId: 'w' }; return spaceNeeds('group', g).items.filter(i => i.type === 'session').map(i => i.id); })()`), ['s1']);
  check('needs: an overdue task is marked overdue', run(`spaceNeeds('group', __g(false, 2)).items.find(i => i.key === 'task:t3').overdue`), true);
  check('needs: a club lists required events this week (never dues) and an unread pinned announcement', run(`spaceNeeds('club', __o()).items.map(i => i.key)`), ['event:e1', 'pinned:p1']);
  check('needs: reading up to the pinned announcement clears it', run(`(() => { state.settings.orgSeen = { CLB: 100 }; const n = spaceNeeds('club', __o()).count; state.settings.orgSeen = { CLB: 50 }; return n; })()`), 1);
  check('needs: the strip lists each item with a one-tap action and a labelled title', run(`(() => { const h = spaceNeedsStrip('club', __o()); return [/What needs you · 2/.test(h), (h.match(/class="(?:card card-sm )?space-need is-/g) || []).length, /aria-label="Going to Chapter meeting"/.test(h), /Read it/.test(h)]; })()`), [true, 2, true, true]);
  check('needs: one or two items are rows in one card; three or more are cards', run(`[/space-needs is-rows/.test(spaceNeedsStrip('club', __o())), /space-needs is-rows/.test(spaceNeedsStrip('group', __g(false, 2)))]`), [true, false]);
  check('needs: the header shows the caller’s total, with the rest said to be below', run(`(() => { const n = spaceNeeds('club', __o()); const h = spaceNeedsStrip('club', __o(), { needs: { ...n, items: n.items.slice(1) } }); return [/What needs you · 2/.test(h), /1 more below/.test(h)]; })()`), [true, true]);
  check('needs: a strip whose items all sit below renders nothing, not “all caught up”', run(`(() => { const n = spaceNeeds('club', __o()); return spaceNeedsStrip('club', __o(), { needs: { ...n, items: [] } }); })()`), '');
  check('needs: dashboard pills carry unread on the same chip', run(`(() => { const h = spaceNeedsPills('club', [__o(), { ...__o(), code: 'QUIET', name: 'Quiet club', events: {}, announcements: {} }], { unread: { CLB: 2, QUIET: 3 } }); return [(h.match(/class="space-dash-need /g) || []).length, /2 new/.test(h), /3 new/.test(h)]; })()`), [2, true, true]);
  check('needs: an empty space is all caught up', run(`spaceNeedsStrip('club', { ...__o(), events: {}, announcements: {} }).includes('You’re all caught up in Kestrel House.')`), true);
  run(`allGroups = () => [__g(false, 2)]; allOrgs = () => [__o()]; _groupTaskIdx = null;`);
  check('needs: the calendar shows your open group tasks on their due dates', run(`[groupTasksOnDate(__d(2)).map(x => x.kind + ':' + x.id), groupTasksOnDate(__d(1)).length, groupTasksOnDate(__d(-20)).length]`), [['grouptask:t1'], 0, 1]);
  const heads = run(`attentionItems().filter(i => /Bio review|Kestrel House/.test(i.sub) || /Kestrel House|Bio review/.test(i.title)).map(i => i.group + '|' + i.title + '|' + /needs your RSVP/.test(i.sub))`);
  check('needs: Heads up gets your tasks by due date and unanswered sessions and events, not the rest', heads.sort(),
    ['Coming up|Chapter meeting|true', 'Coming up|Task t1|false', 'Overdue|Task t3|false', 'Today|Pinned announcement and 1 more|false', 'Tomorrow|Tomorrow|true'].sort());

  /* ── 9. Officer home numbers (js/orgs/admin.js) ──────────────────
     A member counts toward an event only from the day they joined, dues
     are never asked, and no required events reads as none, not 100%. */
  run(`
    globalThis.__r = (required = true) => ({
      code: 'RSV', name: 'Rates', memberUids: ['a', 'b', 'c'], officerUids: ['a'], createdBy: 'a', titles: {}, files: {}, announcements: {},
      people: { a: { name: 'A' }, b: { name: 'B', joinedAt: new Date(__d(-5) + 'T12:00:00').getTime() }, c: { name: 'C' } },
      events: {
        p1: { id: 'p1', title: 'Old', date: __d(-10), start: '10:00', required, category: 'meeting' },
        p2: { id: 'p2', title: 'Recent', date: __d(-2), start: '10:00', required, category: 'meeting' },
        d1: { id: 'd1', title: 'Dues', date: __d(-3), required: true, category: 'deadline' },
      },
      rsvp: { a: { p1: 'yes', p2: 'no' }, b: { p2: 'yes' }, c: { p1: 'yes' } },
    });
  `);
  check('officer home: the answer rate skips events from before someone joined, and dues', run(`(() => { const o = __r(); const r = orgRsvpRate(o, orgEventList(o).filter(e => !orgIsDuesEvent(e))); return [r.asked, r.answered]; })()`), [5, 4]);
  check('officer home: answered every required event counts only events after each person joined', run(`(() => { const h = orgHealth(__r()); return [h.last.length, Math.round(h.rate.rate * 100), h.every, h.counted, h.joined === (__d(-5).slice(0, 7) === todayIso().slice(0, 7) ? 1 : 0)]; })()`), [2, 80, 2, 3, true]);
  check('officer home: no required events reads as none, not 100%', run(`orgHealth(__r(false)).counted`), 0);
  check('officer home: the RSVPs grid marks a not-yet-member differently from no answer', run(`(() => { const h = orgAttendanceHtml_officer(__r()); return [/org-rsvp-mark is-na/.test(h), /org-rsvp-mark is-none/.test(h), /1 of 1 answered/.test(h)]; })()`), [true, true, true]);
  check('officer home: the heir picker lists officers first, oldest first', run(`(() => { const o = { ...__r(), memberUids: ['a', 'b', 'c', myOrgUid()], officerUids: ['c', myOrgUid()], createdBy: myOrgUid(), people: { a: { name: 'A', joinedAt: 5 }, b: { name: 'B', joinedAt: 1 }, c: { name: 'C', joinedAt: 9 } } }; return orgHeirCandidates(o).map(p => p.uid); })()`), ['c', 'b', 'a']);
  const denied = run(`(() => {
    const saved = findOrg, me = myOrgUid();
    const orgs = { DNY: { code: 'DNY', memberUids: [me, 'z'], officerUids: ['z'], createdBy: 'z' }, OUT: { code: 'OUT', memberUids: ['z'], officerUids: ['z'], createdBy: 'z' } };
    findOrg = (c) => orgs[c] || null;
    const out = [
      orgWriteDeniedMessage('DNY', { officerUids: gwRemove('z') }),
      orgWriteDeniedMessage('DNY', { name: 'New name' }),
      orgWriteDeniedMessage('DNY', { ['rsvp.' + me + '.e1']: 'yes' }, 'Fallback'),
      orgWriteDeniedMessage('OUT', { name: 'x' }),
      orgWriteDeniedMessage('GONE', { name: 'x' }),
    ];
    findOrg = saved;
    return out;
  })()`);
  /* ── Space colors: contrast settled in spaceVars (js/spaces/tokens.js) ──
     Every palette a group or club can wear, the sample colors and the
     pickers' worst cases: light-mode text reads at 4.5:1 on white, the
     ink reads on the fill at 4.5:1, and dark mode's fill clears 3:1 on
     the lightest dark surface of the 17 themes. */
  const spaceColorFails = run(`(() => {
    const colors = [...new Set([...GROUP_COLORS, ...ORG_COLORS, ...COURSE_PALETTE, '#1F5F6B', '#f5c542', '#ffff00', '#00e5ff', '#ffb3c6', '#7CFC00', '#c0892f', '#8a6bb5', '#4f8a5b', '#ffffff', '#000000'].map(c => c.toLowerCase()))];
    const lightest = THEMES.map(t => t.dark.surface).sort((a, b) => colorLum(b) - colorLum(a))[0];
    const out = [];
    for (const hex of colors) {
      const c = spaceColorSet(hex);
      if (spaceContrast(c.textsafe, '#ffffff') < 4.5) out.push(hex + ' textsafe');
      if (spaceContrast(c.fill, c.ink === '#fff' ? '#ffffff' : c.ink) < 4.5) out.push(hex + ' ink on fill');
      if (spaceContrast(c.fillDark, lightest) < 3) out.push(hex + ' dark fill');
      if (spaceContrast(c.fillDark, c.inkLift === '#fff' ? '#ffffff' : c.inkLift) < 4.5) out.push(hex + ' ink on dark fill');
      if (!new RegExp('--space-textsafe:' + c.textsafe).test(spaceVars(hex))) out.push(hex + ' not emitted');
    }
    if (lightest.toLowerCase() !== SPACE_DARK_SURFACE.toLowerCase()) out.push('SPACE_DARK_SURFACE is not the lightest dark surface (' + lightest + ')');
    return out;
  })()`);
  check('space colors: text, ink and dark fill clear contrast for every palette and the picker extremes', spaceColorFails, []);
  check('space colors: no color falls back to the accent with a quieter dark pattern', run(`spaceVars('')`).includes('--pattern-alpha-dark:.12'), true);

  /* ── 10. Club Calendar (js/orgs/calendar.js) ────────────────────
     A series has no cadence field, so it is read from the dates: one
     deleted or moved week must not turn a weekly series biweekly. The
     month grid covers whole weeks only, Sunday first. */
  check('club calendar: series cadence from dates', run(`(() => {
    const ev = (ds, sid = 's') => ({ events: Object.fromEntries(ds.map((d, i) => ['e' + i, { id: 'e' + i, date: d, seriesId: sid }])) });
    return [
      orgSeriesStep(ev(['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-29']), 's'),
      orgSeriesStep(ev(['2026-10-01', '2026-10-15', '2026-10-29', '2026-11-26']), 's'),
      orgSeriesStep(ev(['2026-10-01']), 's'),
      orgSeriesStep(ev(['2026-10-01', '2026-10-15']), 's'),
      orgSeriesLabel(ev(['2026-10-01', '2026-10-15']), { seriesId: 's' }),
    ];
  })()`), [7, 14, 7, 14, 'Every other week']);
  check('club calendar: month cells are whole weeks', run(`(() => { const m = calMonthCells('2026-10-17'); return [m.month, m.weeks, m.cells.length, m.cells[0], m.cells[m.cells.length - 1]]; })()`), ['2026-10-01', 5, 35, '2026-09-27', '2026-10-31']);
  check('club writes: a refused write says why', denied, ['Only the founder can change who’s an officer.', 'Only officers can change that.', 'Fallback', 'You’re no longer in this club.', 'This club was deleted.']);

  /* ── 11. Forms (js/spaces/formcore.js) ──────────────────────────
     A form and its answers are typed by students and read back by
     officers, so what is stored is cleaned on the way in and on the way
     out. The quiet failures: an answer that isn't one of the choices is
     counted, a closed form still reads open, a required question is
     skipped, or a cell in the spreadsheet runs as a formula. */
  run(`
    globalThis.__form = (extra = {}) => formClean({
      id: 'f1', title: '  Interest   form ', status: 'open', audience: 'link', collectEmail: true, allowEdit: true, closesAt: null, createdBy: 'alice',
      questions: [
        { id: 'q1', type: 'short', label: 'Major?', required: true },
        { id: 'q2', type: 'choice', label: 'Year', options: ['First year', 'Senior', 'senior', '', 'Grad'] },
        { id: 'q3', type: 'checks', label: 'Interests', options: ['Events', 'Service'] },
        { id: 'q4', type: 'scale', label: 'How excited?' },
        { id: 'q5', type: 'date', label: 'Free day' },
        { id: 'q6', type: 'long', label: 'Anything else?' },
        { id: 'q1', type: 'short', label: 'Same id twice' },
        { id: 'bad id', type: 'short', label: 'Unsafe id' },
        { id: 'q7', type: 'made-up', label: 'Unknown type' },
      ],
      ...extra,
    });
  `);
  check('forms: a stored form is cleaned (title, duplicate and unsafe ids, blank and repeated choices, unknown type)', run(`(() => { const f = __form(); return [f.title, f.questions.map(q => q.id), f.questions[1].options, f.questions[6].type, f.questions[0].options]; })()`),
    ['Interest form', ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'], ['First year', 'Senior', 'Grad'], 'short', []]);
  check('forms: more than 40 questions and 20 choices are cut off', run(`(() => { const f = formClean({ id: 'f', title: 't', questions: Array.from({ length: 60 }, (_, i) => ({ id: 'q' + i, type: 'choice', label: 'x', options: Array.from({ length: 30 }, (_, j) => 'o' + j) })) }); return [f.questions.length, f.questions[0].options.length]; })()`), [40, 20]);
  check('forms: a made-up status or audience falls back to the private one', run(`(() => { const f = formClean({ id: 'f', title: 't', status: 'secret', audience: 'everyone', collectEmail: 'yes', allowEdit: 1 }); return [f.status, f.audience, f.collectEmail, f.allowEdit]; })()`), ['draft', 'members', false, false]);
  check('forms: open, closed, and past its closing time', run(`[formPhase(__form()), formPhase(__form({ status: 'closed' })), formPhase(__form({ status: 'draft' })), formPhase(__form({ closesAt: 1000 }), 2000), formPhase(__form({ closesAt: 3000 }), 2000), formIsOpen(null)]`), ['open', 'closed', 'draft', 'closed', 'open', false]);
  check('forms: a closing day lasts through the end of that day', run(`(() => { const t = formClosesAtFromDate('2026-10-03'); const d = new Date(t); return [d.getDate(), d.getHours(), d.getMinutes(), formClosesDate({ closesAt: t }), formClosesAtFromDate('soon')]; })()`), [3, 23, 59, '2026-10-03', null]);
  check('forms: what stops a form from opening', run(`[
    formPublishProblem({ id: 'f', title: '', questions: [] }),
    formPublishProblem({ id: 'f', title: 'T', questions: [] }),
    formPublishProblem({ id: 'f', title: 'T', questions: [{ id: 'a', type: 'short', label: 'ok' }, { id: 'b', type: 'short', label: ' ' }] }),
    formPublishProblem({ id: 'f', title: 'T', questions: [{ id: 'a', type: 'choice', label: 'pick', options: ['only one'] }] }),
    formPublishProblem(__form()),
  ]`), ['Give the form a title.', 'Add at least one question.', 'Question 2 needs its question written.', 'Question 1 needs at least two choices.', '']);
  check('forms: good answers are kept as typed and cleaned', run(`formCheckAnswers(__form(), { q1: '  Cell   biology ', q2: 'Senior', q3: ['Service', 'Events', 'Service'], q4: 4, q5: '2026-10-03', q6: 'Line one\\r\\n\\r\\n\\r\\n\\r\\nLine two  ' })`),
    { ok: true, answers: { q1: 'Cell biology', q2: 'Senior', q3: ['Service', 'Events'], q4: 4, q5: '2026-10-03', q6: 'Line one\n\nLine two' }, errors: {}, first: '' });
  check('forms: a required question left blank stops the send, and says which', run(`(() => { const r = formCheckAnswers(__form(), { q1: '   ', q2: '' }); return [r.ok, r.first, r.errors]; })()`), [false, 'q1', { q1: 'This one needs an answer.' }]);
  check('forms: an answer that is not one of the choices is refused, never stored', run(`(() => { const r = formCheckAnswers(__form(), { q1: 'x', q2: 'Alumni', q3: ['Events', 'Parties'], q4: 9, q5: '10/3/2026' }); return [r.ok, r.answers, Object.keys(r.errors)]; })()`), [false, { q1: 'x', q3: ['Events'] }, ['q2', 'q4', 'q5']]);
  check('forms: long answers are capped', run(`(() => { const r = formCheckAnswers(__form(), { q1: 'a'.repeat(900), q6: 'b'.repeat(9000) }); return [r.answers.q1.length, r.answers.q6.length]; })()`), [300, 2000]);
  check('forms: a stored answer is read as untrusted data', run(`(() => {
    const f = __form();
    return [
      formCleanResponse(f, { uid: 'u1', name: '  Jada  ', email: 'not an email', member: 'yes', answers: { q1: 'Bio', q2: 'Alumni', zz: 'extra' }, at: '12' }, 'u1'),
      formCleanResponse(f, { answers: {} }, 'bad id'),
      formCleanResponse(f, null, 'u1'),
    ];
  })()`), [{ uid: 'u1', anon: false, name: 'Jada', email: '', member: false, answers: { q1: 'Bio' }, at: 12, updatedAt: 0 }, null, null]);
  check('forms: results count each choice, of the people who answered that question', run(`(() => {
    const f = __form();
    const r = (uid, answers) => formCleanResponse(f, { uid, name: uid, answers, at: 1 }, uid);
    const s = formSummary(f, [r('a', { q1: 'Bio', q2: 'Senior', q3: ['Events', 'Service'], q4: 5 }), r('b', { q1: 'Chem', q2: 'Senior', q3: ['Events'], q4: 2 }), r('c', { q1: 'Art', q2: 'Grad' }), r('d', { q1: 'None' })]);
    return [s[1].answered, s[1].rows.map(x => [x.label, x.count, x.pct]), s[2].rows.map(x => x.count), s[3].kind, s[3].avg, s[3].rows.map(x => x.count), s[0].kind, s[0].answers.length];
  })()`), [3, [['First year', 0, 0], ['Senior', 2, 67], ['Grad', 1, 33]], [2, 1], 'scale', 3.5, [0, 1, 0, 0, 1], 'text', 4]);
  check('forms: results for a form nobody answered are all zeroes, not NaN', run(`formSummary(__form(), []).map(s => [s.answered, s.kind === 'scale' ? s.avg : 0, (s.rows || []).map(r => r.pct)])`), [[0, 0, []], [0, 0, [0, 0, 0]], [0, 0, [0, 0]], [0, 0, [0, 0, 0, 0, 0]], [0, 0, []], [0, 0, []], [0, 0, []]]);
  check('forms: the spreadsheet never starts a cell with a formula', run(`(() => {
    const f = formClean({ id: 'f', title: 't', collectEmail: true, questions: [{ id: 'q1', type: 'short', label: '=Question' }, { id: 'q2', type: 'checks', label: 'Pick', options: ['+one', 'two'] }] });
    const rows = formCsvRows(f, [formCleanResponse(f, { uid: 'u', name: '=HYPERLINK("http://x","y")', email: 'a@b.co', member: true, answers: { q1: '@SUM(1)', q2: ['+one', 'two'] }, at: 0 }, 'u')]);
    return [rows[0], rows[1]];
  })()`), [['Name', 'Email', 'Member', 'Sent', "'=Question", 'Pick'], ["'=HYPERLINK(\"http://x\",\"y\")", 'a@b.co', 'Yes', '', "'@SUM(1)", "'+one; two"]]);
  check('forms: a link names the space and the form, and nothing else parses', run(`[
    formToken('club', 'ABC123', 'f1'), formToken('group', 'ABC123', 'f1'),
    formParseToken('c.ABC123.f1'), formParseToken('g.ABC123.f-1_x'),
    formParseToken('c.abc123.f1'), formParseToken('x.ABC123.f1'), formParseToken('c.ABC123.f1/../x'), formParseToken('c.ABC123.'), formParseToken(null),
    formAnswerKey('club', 'ABC123', 'f1'), formAnswerKey('group', 'ABC123', 'f1'),
  ]`), ['c.ABC123.f1', 'g.ABC123.f1', { kind: 'club', collection: 'orgs', code: 'ABC123', id: 'f1' }, { kind: 'group', collection: 'studyGroups', code: 'ABC123', id: 'f-1_x' }, null, null, null, null, null, 'orgs_ABC123_f1', 'studyGroups_ABC123_f1']);
  check('forms: every starting point opens as it is, except the blank one', run(`FORM_TEMPLATES.map(t => [t.key, formPublishProblem(formFromTemplate(t.key))]).filter(([, p]) => p)`), [['blank', 'Give the form a title.']]);
  check('forms: clubs and study groups each get their own starting points', run(`[formTemplatesFor('club').map(t => t.key), formTemplatesFor('group').map(t => t.key)]`), [['blank', 'interest', 'application', 'signup', 'order', 'feedback', 'suggestions'], ['blank', 'signup', 'feedback', 'suggestions', 'study']]);
  check('forms: the sample club and group get forms whose answers all fit their questions', run(`(() => {
    const out = [];
    for (const kind of ['club', 'group']) {
      const s = sampleForms(kind, { name: 'Sample', color: '#1F5F6B', people: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(u => ({ uid: 'sample-' + u, name: u.toUpperCase() })), by: 'sample-a', byName: 'A', now: 1790000000000 });
      for (const f of Object.values(s.forms)) {
        const list = Object.entries(s.formResponses[f.id]).map(([u, r]) => formCleanResponse(f, r, u));
        out.push([kind, formPublishProblem(f), list.length > 0, list.every(r => r && f.questions.filter(q => q.required).every(q => !formAnswerEmpty(r.answers[q.id]))), list.some(r => r.uid === LOCAL_UID)]);
      }
    }
    return out;
  })()`), [['club', '', true, true, false], ['club', '', true, true, false], ['club', '', true, true, false], ['club', '', true, true, false], ['group', '', true, true, false]]);
  check('forms: the tabs exist for clubs and study groups, and their entry points loaded', [run(`[ORG_TABS.some(t => t[0] === 'forms'), GROUP_TABS.some(t => t[0] === 'forms')]`), loaded(['formsTab', 'formsWaiting', 'formsAfterRender', 'openFormFill', 'submitFormFill', 'openFormShare', 'openFormResults', 'downloadFormCsv', 'openFormPicker', 'openFormBuilder', 'fbSave', 'fbAnonymous', 'formFillHtml', 'formFillRead', 'formFillPicked', 'formSendAnswer', 'formTakeBack', 'formFileUrl', 'setFormMark', 'openFormFile'])], [[true, true], []]);

  check('forms: a file answer keeps its name, size and type, and nothing that could point somewhere else', run(`(() => {
    const q = { id: 'q', type: 'file', options: [] };
    return [
      formCleanAnswer(q, { name: '  My   résumé.pdf ', size: 2048, type: 'application/pdf', path: 'orgs/OTHER1/forms/x/y/z', url: 'https://evil.example/x' }),
      formCleanAnswer(q, { name: '../../secret\\\\plan.pdf', size: 10, type: 'not a type' }),
      formCleanAnswer(q, { name: 'demo.txt', size: 5, url: 'data:text/plain;base64,aGk=' }),
      formCleanAnswer(q, { name: 'page.html', size: 5, url: 'data:text/html,<script>1</script>' }),
      formCleanAnswer(q, { name: 'big.mov', size: FORM_FILE_MAX_BYTES + 1 }),
      formCleanAnswer(q, { name: '', size: 10 }),
      formCleanAnswer(q, { name: 'empty.pdf', size: 0 }),
      formCleanAnswer(q, 'resume.pdf'),
      formCleanAnswer(q, ['resume.pdf']),
    ];
  })()`), [{ name: 'My résumé.pdf', size: 2048, type: 'application/pdf' }, { name: '....secretplan.pdf', size: 10, type: '' }, { name: 'demo.txt', size: 5, type: '', url: 'data:text/plain;base64,aGk=' }, { name: 'page.html', size: 5, type: '' }, null, null, null, null, null].map(v => v === null ? undefined : v));
  check('forms: a file that is too big says so, and a required file question needs a file', run(`(() => {
    const f = formClean({ id: 'f', title: 't', questions: [{ id: 'q1', type: 'file', label: 'Résumé', required: true }, { id: 'q2', type: 'file', label: 'Photo' }] });
    return [formCheckAnswers(f, { q2: { name: 'big.mov', size: FORM_FILE_MAX_BYTES + 1 } }).errors, formCheckAnswers(f, { q1: { name: 'cv.pdf', size: 9 } }).ok, formAnswerEmpty({}), formAnswerEmpty({ name: 'cv.pdf', size: 9 }), formAnswerText(f.questions[0], { name: 'cv.pdf', size: 9 })];
  })()`), [{ q1: 'This one needs an answer.', q2: 'That file is over 10 MB. Pick a smaller one.' }, true, true, false, 'cv.pdf']);
  check('forms: where a file lives is worked out from the form, the sender and the question', run(`[formFilePath('club', 'ABC123', 'f1', 'u1', 'q1'), formFilePath('group', 'ABC123', 'f1', 'u1', 'q1')]`), ['orgs/ABC123/forms/f1/u1/q1', 'studyGroups/ABC123/forms/f1/u1/q1']);
  check('forms: an anonymous form collects no email, is not sorted, and takes no files', run(`(() => {
    const f = formClean({ id: 'f', title: 'Box', status: 'open', anonymous: true, collectEmail: true, review: true, questions: [{ id: 'q1', type: 'long', label: 'Say it' }, { id: 'q2', type: 'file', label: 'Proof' }] });
    return [f.anonymous, f.collectEmail, f.review, formPublishProblem(f), formClean({ id: 'f', title: 't', anonymous: 'yes' }).anonymous];
  })()`), [true, false, false, 'Question 2 asks for a file, and an anonymous form can’t take one. Change the question or turn anonymous off.', false]);
  check('forms: an anonymous answer is read with no name, email or membership, whatever the document claims', run(`(() => {
    const f = __form({ anonymous: true });
    return formCleanResponse(f, { anon: true, uid: 'carol', name: 'Carol', email: 'carol@school.edu', member: true, answers: { q1: 'Bio' }, at: 86400000 }, 'a1b2c3');
  })()`), { uid: 'a1b2c3', anon: true, name: 'Anonymous', email: '', member: false, answers: { q1: 'Bio' }, at: 86400000, updatedAt: 0 });
  check('forms: the spreadsheet of an anonymous form has no names, no times of day, and no order of arrival', run(`(() => {
    const f = __form({ anonymous: true });
    const r = (id, at, q1) => formCleanResponse(f, { anon: true, answers: { q1 }, at }, id);
    const rows = formCsvRows(f, [r('zz9', new Date(2026, 9, 1).getTime(), 'first in'), r('aa1', new Date(2026, 9, 3).getTime(), 'last in')]);
    return [rows[0].slice(0, 3), rows[1].slice(0, 3), rows[2].slice(0, 3)];
  })()`), [['Answer', 'Sent', 'Major?'], ['Answer 1', '2026-10-03', 'last in'], ['Answer 2', '2026-10-01', 'first in']]);
  check('forms: a form that sorts its answers puts the decision in the spreadsheet', run(`(() => {
    const f = __form({ review: true, collectEmail: false });
    const r = (uid) => formCleanResponse(f, { uid, name: uid, answers: { q1: 'x' }, at: 1 }, uid);
    const rows = formCsvRows(f, [r('a'), r('b'), r('c')], { a: 'accepted', b: 'declined', c: 'made-up' });
    return [rows[0].slice(0, 3), rows.slice(1).map(x => x[2]), FORM_MARKS.map(m => m[0])];
  })()`), [['Name', 'Member', 'Status'], ['Accepted', 'Declined', ''], ['accepted', 'waitlisted', 'declined']]);
  check('forms: the sample club has applications half sorted and an anonymous box with no names in it', run(`(() => {
    const s = sampleForms('club', { name: 'Sample', color: '#1F5F6B', people: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(u => ({ uid: 'sample-' + u, name: u.toUpperCase() })), by: 'sample-a', byName: 'A', now: 1790000000000 });
    const forms = Object.values(s.forms);
    const app = forms.find(f => f.review), box = forms.find(f => f.anonymous);
    const anon = Object.values(s.formResponses[box.id]);
    return [Object.values(s.formMarks[app.id]).sort(), Object.keys(s.formMarks[app.id]).every(u => u in s.formResponses[app.id]), anon.length, anon.every(r => r.anon === true && !('uid' in r) && !('name' in r) && !('email' in r) && r.at % 86400000 === 0)];
  })()`), [['accepted', 'accepted', 'declined', 'waitlisted'], true, 5, true]);

  /* The fill-out page loads its own short list of scripts. The same two
     quiet failures apply to it: a name declared twice, or a file that
     throws on load. */
  {
    const formHtml = read('form.html');
    const pageScripts = [...formHtml.matchAll(/<script[^>]+src="((?!https?:)[^"]+)"/g)].map(m => m[1]);
    let parses = true;
    try { new vm.Script(pageScripts.map(f => read(f)).join('\n;\n'), { filename: 'form-bundle.js' }); }
    catch (e) { parses = false; console.error('  form.html scripts do not parse together:', e.message); }
    ok('form.html: every local script, concatenated in order, parses (no name declared twice)', parses);
    const seen = new Map(), dupes = [];
    for (const f of pageScripts) {
      for (const m of read(f).matchAll(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^var\s+([A-Za-z_$][\w$]*)/gm)) {
        const name = m[1] || m[2];
        if (seen.has(name) && seen.get(name) !== f) dupes.push(`${name} (${seen.get(name)} and ${f})`);
        else if (!seen.has(name)) seen.set(name, f);
      }
    }
    check('form.html: no top-level function or var is declared in two scripts', dupes, []);
    check('form.html: it loads the shared form files the app loads, and never the planner itself', [['js/spaces/formcore.js', 'js/spaces/formfill.js', 'js/spaces/formsend.js', 'js/form-page.js'].filter(f => !pageScripts.includes(f)), pageScripts.filter(f => /state\.js|firebase\.js|app\.js/.test(f))], [[], []]);
    check('forms: the file picker never filters by type, and no remote QR service is used', [/type="file"[^>]*accept|accept=[^>]*type="file"/.test(read('js/spaces/formfill.js') + formHtml), /type="file"/.test(read('js/spaces/formfill.js')), /api\.qrserver|chart\.googleapis/.test(formHtml + read('js/spaces/forms.js'))], [false, true, false]);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
