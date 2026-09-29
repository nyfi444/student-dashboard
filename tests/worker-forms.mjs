/* ── Anonymous answers really are anonymous, and really are one each ──
   These run the Worker's own /form/answer handler (worker/src/forms.js)
   against a fake Firestore. It is worth testing rather than eyeballing
   because both ways it can fail are silent: an answer that carries the
   sender's uid still looks like an answer, and a second answer from the
   same person is just one more row.

   Also here: the Worker checks answers with its own copy of the rules in
   js/spaces/formcore.js, and the two have to agree.

   Run:  node tests/worker-forms.mjs
──────────────────────────────────────────────────────────────── */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { loadWorkerSource } from './worker-source.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { source: src } = loadWorkerSource();
const sandbox = { console, crypto, fetch: () => { throw new Error('no network in tests'); }, setTimeout, clearTimeout, TextEncoder, TextDecoder, atob, btoa, URL, Response, Request, Headers };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'worker/src (flattened)' });

// The app's own rules for a form, to compare against.
const app = { console, uid: () => 'id' + Math.random().toString(36).slice(2, 10) };
app.globalThis = app;
vm.createContext(app);
vm.runInContext(readFileSync(join(root, 'js/spaces/formcore.js'), 'utf8') + '\n;globalThis.__f = { formClean, formCheckAnswers, formIsOpen, FORM_TYPES };', app, { filename: 'formcore.js' });

let failed = 0, passed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FAIL  ${name}\n      expected ${e}\n      got      ${a}`);
};
const ok = (name, v) => check(name, !!v, true);

const env = { FIREBASE_PROJECT_ID: 'demo', ALLOWED_ORIGIN: 'https://app.semester-hq.com' };
const FORM = 'orgs/CLUB01/forms/f1';
const form = (extra = {}) => ({
  id: 'f1', title: 'Suggestion box', spaceName: 'Chess Club', status: 'open', audience: 'members', anonymous: true, allowEdit: true, collectEmail: false,
  questions: [
    { id: 'q1', type: 'long', label: 'What should change?', required: true, options: [] },
    { id: 'q2', type: 'choice', label: 'About', required: false, options: ['Meetings', 'Events'] },
    { id: 'q3', type: 'checks', label: 'Pick', required: false, options: ['A', 'B'] },
    { id: 'q4', type: 'scale', label: 'Rate', required: false, options: [] },
    { id: 'q5', type: 'date', label: 'Day', required: false, options: [] },
    { id: 'q6', type: 'short', label: 'One line', required: false, options: [] },
    { id: 'q7', type: 'dropdown', label: 'Year', required: false, options: ['First year', 'Senior'] },
  ],
  ...extra,
});
const space = () => ({ code: 'CLUB01', name: 'Chess Club', createdBy: 'alice', memberUids: ['alice', 'bob', 'carol'], officerUids: ['alice'] });

/* A fake Firestore: a map of path -> document, and a log of every write. */
function world(docs, { uid = 'carol' } = {}) {
  const log = { writes: [], reads: [] };
  sandbox.verifyFirebaseIdToken = async (token) => { if (token === 'bad') throw new Error('bad token'); return { sub: token === 'me' ? uid : token, email: `${uid}@school.edu`, email_verified: true, name: 'Carol Real-Name' }; };
  sandbox.batchGetFirestoreDocs = async (e, paths) => { log.reads.push(...paths); return Object.fromEntries(paths.map(p => [p, docs[p] ?? null])); };
  sandbox.commitFirestore = async (e, writes) => {
    log.writes.push(writes);
    for (const w of writes) { if (w.remove) delete docs[w.path]; else docs[w.path] = { ...w.fields }; }
    return true;
  };
  log.docs = docs;
  return log;
}
const call = async (body) => {
  const res = await sandbox.handleFormAnswer(new Request('https://worker.test/form/answer', { method: 'POST', body: JSON.stringify(body) }), env, 'https://app.semester-hq.com');
  return { status: res.status, body: await res.json() };
};
const ask = (extra = {}) => ({ idToken: 'me', kind: 'club', code: 'CLUB01', formId: 'f1', answers: { q1: 'More snacks', q2: 'Events' }, ...extra });
const INDEX = 'planners/carol/formAnswers/orgs_CLUB01_f1';
const answersIn = (log) => Object.keys(log.docs).filter(p => p.startsWith(`${FORM}/responses/`));

/* ── What is stored ────────────────────────────────────────────── */
let log = world({ 'orgs/CLUB01': space(), [FORM]: form() });
let r = await call(ask());
check('a member’s anonymous answer is taken', [r.status, r.body.ok, r.body.replaced], [200, true, false]);
let paths = answersIn(log);
check('it is filed once', paths.length, 1);
const stored = log.docs[paths[0]];
check('under a random id, not the sender’s uid', [/^[0-9a-f]{32}$/.test(paths[0].split('/').pop()), paths[0].includes('carol')], [true, false]);
check('it holds the answers and nothing about the sender', Object.keys(stored).sort(), ['anon', 'answers', 'at']);
ok('nothing in it names the sender, their email or their display name', !/carol|school\.edu|Real-Name/i.test(JSON.stringify(stored)));
check('it keeps the day it was sent, not the moment', [stored.at % 86400000, stored.at <= Date.now(), Date.now() - stored.at < 86400000], [0, true, true]);
check('the answers are the cleaned ones', stored.answers, { q1: 'More snacks', q2: 'Events' });
check('the link to the sender is kept in the sender’s own planner, marked as the server’s', [log.docs[INDEX].anon, log.docs[INDEX].answerId, log.docs[INDEX].formId], [true, paths[0].split('/').pop(), 'f1']);
check('both are written together, or neither', log.writes.length, 1);

/* ── One answer each ───────────────────────────────────────────── */
r = await call(ask({ answers: { q1: 'Actually, fewer meetings' } }));
check('answering again replaces the first answer', [r.status, r.body.replaced, answersIn(log).length, log.docs[answersIn(log)[0]].answers], [200, true, 1, { q1: 'Actually, fewer meetings' }]);

log = world({ 'orgs/CLUB01': space(), [FORM]: form({ allowEdit: false }) });
await call(ask());
r = await call(ask({ answers: { q1: 'A second vote' } }));
check('a form whose answers can’t be changed refuses a second one', [r.status, answersIn(log).length, log.docs[answersIn(log)[0]].answers.q1], [409, 1, 'More snacks']);
delete log.docs[answersIn(log)[0]];
r = await call(ask({ answers: { q1: 'After mine was removed' } }));
check('but once the people running it removed the first, the person may answer again', [r.status, answersIn(log).length], [200, 1]);

log = world({ 'orgs/CLUB01': space(), [FORM]: form() });
await call(ask());
r = await call(ask({ remove: true, answers: undefined }));
check('the sender can take their answer back', [r.status, r.body.removed, answersIn(log).length, INDEX in log.docs], [200, true, 0, false]);
r = await call(ask({ remove: true }));
check('taking back an answer that isn’t there is not an error', [r.status, r.body.removed], [200, false]);

/* ── Who may answer ────────────────────────────────────────────── */
log = world({ 'orgs/CLUB01': space(), [FORM]: form() }, { uid: 'mallory' });
r = await call(ask());
check('someone outside the club cannot answer a members-only form', [r.status, log.writes.length], [403, 0]);
log = world({ 'orgs/CLUB01': space(), [FORM]: form({ audience: 'link' }) }, { uid: 'mallory' });
r = await call(ask());
check('they can answer one open to anyone with the link', [r.status, answersIn(log).length], [200, 1]);
ok('and whether they are a member is not stored either', !('member' in log.docs[answersIn(log)[0]]));

for (const [name, f, status] of [['a closed form', form({ status: 'closed' }), 409], ['a draft', form({ status: 'draft' }), 409], ['a form past its closing time', form({ closesAt: Date.now() - 1000 }), 409], ['a form that is not anonymous', form({ anonymous: false }), 404], ['a form that does not exist', null, 404]]) {
  log = world({ 'orgs/CLUB01': space(), ...(f ? { [FORM]: f } : {}) });
  r = await call(ask());
  check(`${name} takes no anonymous answer`, [r.status, log.writes.length], [status, 0]);
}
log = world({ 'orgs/CLUB01': space(), [FORM]: form({ status: 'closed' }) });
log.docs[INDEX] = { anon: true, answerId: 'abc123', kind: 'club', code: 'CLUB01', formId: 'f1' };
log.docs[`${FORM}/responses/abc123`] = { anon: true, answers: { q1: 'x' }, at: 0 };
r = await call(ask({ remove: true }));
check('an answer can still be taken back after the form closes', [r.status, answersIn(log).length], [200, 0]);

log = world({ 'orgs/CLUB01': space(), [FORM]: form() });
check('a bad session is refused', (await call(ask({ idToken: 'bad' }))).status, 401);
check('no session is refused', (await call(ask({ idToken: '' }))).status, 400);
for (const bad of [{ kind: 'planners' }, { code: 'club01' }, { code: 'CLUB01/../x' }, { formId: 'a/b' }, { formId: '' }]) {
  r = await call(ask(bad));
  check(`a link that is not a form (${JSON.stringify(bad)}) is refused before anything is read`, [r.status, log.reads.length], [400, 0]);
}
// A record the person made themselves (not marked as the server's) names no answer.
log = world({ 'orgs/CLUB01': space(), [FORM]: form({ allowEdit: false }), [INDEX]: { answerId: '../../../licenses/carol', kind: 'club', code: 'CLUB01', formId: 'f1' } });
r = await call(ask({ remove: true }));
check('a record that is not the server’s own cannot point a delete anywhere', [r.body.removed, log.writes.length], [false, 0]);

/* ── The answers themselves ────────────────────────────────────── */
log = world({ 'orgs/CLUB01': space(), [FORM]: form() });
r = await call(ask({ answers: { q1: '   ', q2: 'Parties', q4: 9 } }));
check('a required question left blank and answers that fit no choice are refused, and say which', [r.status, Object.keys(r.body.errors).sort(), log.writes.length], [422, ['q1', 'q2', 'q4'], 0]);
r = await call(ask({ answers: { q1: 'ok', q6: { name: 'resume.pdf', size: 10 } } }));
check('a file is never taken as an anonymous answer', [r.status, Object.keys(r.body.errors)], [422, ['q6']]);
r = await call(ask({ answers: { q1: 'x'.repeat(9000), zz: 'not a question', q3: ['A', 'A', 'C'] } }));
const kept = log.docs[answersIn(log)[0]].answers;
check('long answers are capped and unknown questions dropped', [r.status, kept.q1.length, Object.keys(kept).sort()], [200, 2000, ['q1', 'q3']]);

/* ── The Worker and the app agree on what an answer is ─────────── */
const samples = [
  { q1: '  Two   spaces ', q2: 'Events', q3: ['B', 'A', 'B'], q4: 3, q5: '2026-10-03', q6: 'a'.repeat(400), q7: 'Senior' },
  { q1: 'Line one\r\n\r\n\r\n\r\nLine two', q2: 'events', q3: 'A', q4: '5', q5: '10/3/2026', q7: '' },
  { q1: '', q2: null, q3: [], q4: 0, q5: '2026-02-31' },
  { q1: 12345, q4: 2.5, q6: ['not', 'a', 'string'] },
  {},
];
const appForm = app.__f.formClean(form());
samples.forEach((s, i) => {
  const w = sandbox.wfCheckAnswers(form(), s), a = app.__f.formCheckAnswers(appForm, s);
  check(`the Worker and the app read answer set ${i + 1} the same way`, [w.ok, w.answers, Object.keys(w.errors).sort()], [a.ok, a.answers, Object.keys(a.errors).sort()]);
});
check('they agree on when a form is open', [form(), form({ status: 'closed' }), form({ closesAt: 1 }), form({ closesAt: Date.now() + 9e6 }), form({ closesAt: null })].map(f => sandbox.wfIsOpen(f)), [form(), form({ status: 'closed' }), form({ closesAt: 1 }), form({ closesAt: Date.now() + 9e6 }), form({ closesAt: null })].map(f => app.__f.formIsOpen(app.__f.formClean(f))));
check('every kind of question the app offers is one the Worker knows, files aside', app.__f.FORM_TYPES.map(t => t[0]).filter(t => t !== 'file' && sandbox.wfCleanAnswer({ type: t, options: ['x'] }, t === 'scale' ? 3 : t === 'date' ? '2026-01-01' : t === 'checks' ? ['x'] : 'x') === undefined), []);

/* ── The route ─────────────────────────────────────────────────── */
ok('the front door knows the route', /url\.pathname === '\/form\/answer'/.test(src) && /handleFormAnswer\(request, env, origin\)/.test(src));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
