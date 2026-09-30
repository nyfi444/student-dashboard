/* ── Members-only groups and clubs, the Worker's side (spaces.js) ──
   Join previews that stay true, blocked lists that let go of a deleted
   account, new links for a club's files after someone is removed, the
   deletion cleanup a study group needs, and the commit fix that makes a
   dotted field (people.abc.role) land where the update mask says.

   Run:  node tests/worker-spaces.mjs
──────────────────────────────────────────────────────────────── */
import vm from 'node:vm';
import { loadWorkerSource } from './worker-source.mjs';

const { source: src } = loadWorkerSource();
const sandbox = { console, crypto, fetch: () => { throw new Error('no network in tests'); }, setTimeout, clearTimeout, TextEncoder, TextDecoder, atob, btoa, URL, Response, Request, Headers };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'worker/src (flattened)' });

let failed = 0, passed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FAIL  ${name}\n      expected ${e}\n      got      ${a}`);
};
const ok = (name, v) => check(name, !!v, true);
const NOW = Date.UTC(2026, 8, 30, 15);   // Wed Sep 30 2026

/* ── Dotted fields in a commit ─────────────────────────────────── */
check('a dotted key becomes the nested field the mask names', sandbox.nestFieldPaths({ 'people.abc.role': 'owner', memberUids: ['a'] }), { people: { abc: { role: 'owner' } }, memberUids: ['a'] });
check('two dotted keys under one map share it', sandbox.nestFieldPaths({ 'files.f1.path': 'p', 'files.f2.path': 'q' }), { files: { f1: { path: 'p' }, f2: { path: 'q' } } });
check('a backticked segment keeps its dot', sandbox.splitFieldPath('blocked.`a.b`.at'), ['blocked', 'a.b', 'at']);

/* ── The preview ───────────────────────────────────────────────── */
const club = { name: 'Chess  Club', kind: 'club', school: 'State', color: '#B49F90', description: 'Blitz on Thursdays', memberUids: ['a', 'b', 'c'], officerUids: ['a'], people: { a: { name: 'Ana' } },
  events: { e1: { title: 'Old meeting', date: '2026-09-01' }, e2: { title: 'Blitz night', date: '2026-10-08', start: '19:00' }, e3: { title: 'Later', date: '2026-11-01' } } };
const p = sandbox.spacePreviewFrom('club', club, NOW);
check('club preview: only what a stranger may see, the real count, the next event', p, { v: 1, name: 'Chess Club', memberCount: 3, description: 'Blitz on Thursdays', color: '#B49F90', kind: 'club', school: 'State', next: { title: 'Blitz night', date: '2026-10-08', start: '19:00' }, updatedAt: NOW });
ok('club preview: no names, no member list', !JSON.stringify(p).includes('Ana') && !('memberUids' in p));
const gp = sandbox.spacePreviewFrom('group', { name: 'Bio', courseLabel: 'BIO 210', memberUids: ['a'], sessions: { s1: { title: 'Review', date: '2026-09-29' } } }, NOW);
check('group preview: course label, and no next when every session is past', [gp.courseLabel, gp.next], ['BIO 210', null]);
check('a bad color is left out', sandbox.spacePreviewFrom('club', { name: 'X', color: 'red;', memberUids: [] }, NOW).color, undefined);

let commits = [];
sandbox.commitFirestore = async (env, writes) => { commits.push(...writes); return true; };
await sandbox.writeSpacePreview({}, 'group', 'GRP123', { name: 'Bio', memberUids: ['a', 'b'], sessions: {} });
check('writing a preview: to public/preview, clearing what the space no longer has', [commits[0].path, commits[0].clear], ['studyGroups/GRP123/public/preview', ['next', 'description', 'color', 'courseLabel', 'kind', 'school']]);
commits = [];
ok('a bad code writes nothing', !(await sandbox.writeSpacePreview({}, 'club', '../x', { memberUids: [] })) && !commits.length);

sandbox.listFirestoreCollection = async (env, c) => (c === 'studyGroups'
  ? [{ id: 'GRP123', v: 2, name: 'Bio', memberUids: ['a'] }, { id: 'OLD111', name: 'Old', memberUids: ['a'] }, { id: 'EMPTY1', v: 2, memberUids: [] }]
  : [{ id: 'CLUB01', name: 'Chess', memberUids: ['a', 'b'] }, { id: 'bad/id', memberUids: ['a'] }]);
commits = [];
const n = await sandbox.refreshSpacePreviews({});
check('the daily refresh: every real group and club, not first-version, empty or odd ones', [n, commits.map(c => c.path)], [2, ['studyGroups/GRP123/public/preview', 'orgs/CLUB01/public/preview']]);

/* ── Blocked lists ─────────────────────────────────────────────── */
const queries = [];
sandbox.runFirestoreQuery = async (env, q) => { queries.push(q); return q.from[0].collectionId === 'orgs' ? [{ id: 'CLUB01' }, { id: 'nope/x' }] : []; };
commits = [];
await sandbox.clearBlockedEverywhere({}, 'mem2');
check('a deleted account comes off each blocked list it was on', commits, [{ path: 'orgs/CLUB01', fields: {}, clear: ['blocked.`mem2`'] }]);
check('found by querying for the entry', queries[0].where.fieldFilter.field.fieldPath, 'blocked.`mem2`.at');
let threw = false;
try { await sandbox.clearBlockedEverywhere({}, 'a.b'); } catch { threw = true; }
ok('an unsafe uid never reaches a field path', threw);

/* ── New links for a club's files ──────────────────────────────── */
const BUCKET = 'semester-hq.firebasestorage.app';
check('a download URL gives back its path', sandbox.storagePathFromUrl(`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/orgs%2FCLUB01%2Ffiles%2Fx-a.pdf?alt=media&token=t`, BUCKET), 'orgs/CLUB01/files/x-a.pdf');
check('another bucket or host gives nothing', [sandbox.storagePathFromUrl('https://firebasestorage.googleapis.com/v0/b/other/o/a?alt=media', BUCKET), sandbox.storagePathFromUrl('https://evil.example/v0/b/x/o/a', BUCKET)], ['', '']);

const rotated = [];
sandbox.verifyFirebaseIdToken = async (t) => { if (t === 'bad') throw new Error('expired'); return { sub: t }; };
sandbox.readFirestoreDoc = async () => ({ officerUids: ['off1'], files: {
  f1: { kind: 'file', url: `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/orgs%2FCLUB01%2Ffiles%2Ff1-a.pdf?alt=media&token=old` },
  f2: { kind: 'file', path: 'orgs/CLUB01/files/f2-b.pdf' },
  f3: { kind: 'file', url: `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/orgs%2FOTHER1%2Ffiles%2Fz.pdf?alt=media` },
  f4: { kind: 'link', url: 'https://drive.example/x' },
} });
sandbox.storageObjectsUnder = async (env, prefix) => [`${prefix}f1-a.pdf`, `${prefix}f2-b.pdf`];
sandbox.setStorageDownloadToken = async (env, name, tok) => { rotated.push([name, typeof tok]); };
const env = { FIREBASE_PROJECT_ID: 'p', FIREBASE_STORAGE_BUCKET: BUCKET, ALLOWED_ORIGIN: '' };
const call = (body) => sandbox.handleRotateFiles(new Request('https://w/space/rotate-files', { method: 'POST', body: JSON.stringify(body) }), env, '');
commits = [];
let res = await call({ idToken: 'off1', kind: 'club', code: 'CLUB01' });
check('an officer rotates: every file gets a new token', [res.status, rotated], [200, [['orgs/CLUB01/files/f1-a.pdf', 'string'], ['orgs/CLUB01/files/f2-b.pdf', 'string']]]);
check('an old stored link moves to a path; another club’s path and links are left alone', commits, [{ path: 'orgs/CLUB01', fields: { 'files.f1.path': 'orgs/CLUB01/files/f1-a.pdf' }, clear: ['files.f1.url'] }]);
check('a member who is not an officer is refused', (await call({ idToken: 'mem9', kind: 'club', code: 'CLUB01' })).status, 403);
check('an expired sign-in is refused', (await call({ idToken: 'bad', kind: 'club', code: 'CLUB01' })).status, 401);
check('a bad code is refused before anything is read', (await call({ idToken: 'off1', kind: 'club', code: '../../x' })).status, 400);
check('study groups are not part of this', (await call({ idToken: 'off1', kind: 'group', code: 'GRP123' })).status, 400);

/* ── Account deletion in a study group ─────────────────────────── */
commits = [];
let previewed = null;
sandbox.readFirestoreDocWithTime = async () => ({ updateTime: 't1', data: {
  createdBy: 'own1', memberUids: ['own1', 'mem2'], people: { own1: { name: 'A', joinedAt: 1 }, mem2: { name: 'B', joinedAt: 2 } },
  sessions: { s1: { title: 'Review', date: '2026-10-08', rsvp: { mem2: 'yes', own1: 'no' } }, s2: { title: 'Lab', date: '2026-10-09', rsvp: { own1: 'yes' } } },
  taskItems: { t1: { id: 't1', assignee: 'mem2', assigneeName: 'B' }, t2: { id: 't2', done: true, doneBy: 'mem2', doneByName: 'B' }, t3: { id: 't3', assignee: 'own1' } },
} });
sandbox.runFirestoreQuery = async () => [];
sandbox.logServerIssue = async () => {};
sandbox.writeSpacePreview = async (e, kind, code, data) => { previewed = [kind, code, data.memberUids]; return true; };
await sandbox.removeMemberFromSharedSpace({}, 'studyGroups/GRP123', 'mem2', 'group');
const w = commits[0];
check('their RSVPs and the tasks they had taken are cleared', w.clear, ['people.mem2', 'avail.mem2', 'sessions.s1.rsvp.mem2', 'taskItems.t1.assignee', 'taskItems.t1.assigneeName']);
check('a task they finished keeps the tick, without their name', w.fields['taskItems.t2.doneByName'], 'Deleted account');
check('the preview is written with the real member count', previewed, ['group', 'GRP123', ['own1']]);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
