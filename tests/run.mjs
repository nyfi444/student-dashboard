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

   Run:  node tests/run.mjs
──────────────────────────────────────────────────────────────── */
import { readFileSync } from 'node:fs';
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
const FILES = ['js/utils.js', 'js/state.js', 'js/quickparse.js', 'js/syllabus.js', 'js/ai.js'];
const EXPORTS = ['parseQuickAdd', 'sanitizeCourseDetails', 'SYLLABUS_SCHEMA', 'ASSIGNMENT_SCHEMA', 'qpTime'];
vm.runInContext(
  FILES.map(read).join('\n;\n') + `\n;globalThis.__exports = { ${EXPORTS.join(', ')} };`,
  sandbox,
  { filename: 'app-bundle.js' },
);
const { parseQuickAdd, sanitizeCourseDetails, SYLLABUS_SCHEMA, ASSIGNMENT_SCHEMA, qpTime } = sandbox.__exports;

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
