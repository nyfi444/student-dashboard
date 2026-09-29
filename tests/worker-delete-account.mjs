/* ── Deleting an account really does leave every shared space ──────
   These run the Worker's own removeMemberFromSharedSpace against fake
   Firestore documents. It's worth testing rather than eyeballing because
   the failure mode isn't an exception: it's a club whose owner no longer
   exists, which firestore.rules then makes uneditable by anyone, and
   which nobody discovers until an officer tries to post an event.

   Run:  node tests/worker-delete-account.mjs
──────────────────────────────────────────────────────────────── */
import vm from 'node:vm';
import { loadWorkerSource } from './worker-source.mjs';

// Every worker/src module flattened into one script, so each top-level
// function lands on the sandbox global where tests can reach and replace
// it. See tests/worker-source.mjs for why this isn't a plain import.
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

/* A fake Firestore holding one document, recording what was written. */
function world(doc, { failFirstCommit = false } = {}) {
  const log = { commits: [], deletedDocs: [], deletedSubs: [], deletedFolders: [], messageWrites: [] };
  let failures = failFirstCommit ? 1 : 0;
  sandbox.readFirestoreDocWithTime = async () => (doc ? { data: doc, updateTime: 't1' } : null);
  sandbox.deleteFirestoreDoc = async (env, c, id) => { log.deletedDocs.push(`${c}/${id}`); };
  sandbox.deleteFirestoreSubcollection = async (env, path, sub) => { log.deletedSubs.push(`${path}/${sub}`); };
  sandbox.deleteStorageFolder = async (env, prefix) => { log.deletedFolders.push(prefix); return 1; };
  sandbox.runFirestoreQuery = async () => [];
  sandbox.logServerIssue = async () => {};
  sandbox.commitFirestore = async (env, writes) => {
    if (failures > 0) { failures--; return false; }
    log.commits.push(writes);
    return true;
  };
  return log;
}
const lastWrite = (log) => log.commits.at(-1)[0];

/* ── A study group ─────────────────────────────────────────────── */
const groupDoc = () => ({
  createdBy: 'owner1',
  memberUids: ['owner1', 'mem2', 'mem3'],
  people: { owner1: { name: 'Ana', role: 'owner', joinedAt: 100 }, mem2: { name: 'Bo', joinedAt: 300 }, mem3: { name: 'Cy', joinedAt: 200 } },
  avail: { owner1: {}, mem2: {}, mem3: {} },
  lastMessage: { uid: 'owner1', name: 'Ana', text: 'see you there' },
});

let log = world(groupDoc());
await sandbox.removeMemberFromSharedSpace({}, 'studyGroups/ABC123', 'mem2', 'group');
let w = lastWrite(log);
check('member leaves: dropped from memberUids', w.fields.memberUids, ['owner1', 'mem3']);
check('member leaves: their person entry and availability are cleared', w.clear, ['people.mem2', 'avail.mem2']);
ok('member leaves: ownership untouched', !('createdBy' in w.fields));
ok('member leaves: nothing deleted', !log.deletedDocs.length);

log = world(groupDoc());
await sandbox.removeMemberFromSharedSpace({}, 'studyGroups/ABC123', 'owner1', 'group');
w = lastWrite(log);
check('owner leaves: the longest-standing member inherits', w.fields.createdBy, 'mem3');
check('owner leaves: the owner badge moves with it', w.fields['people.mem3.role'], 'owner');
check('owner leaves: their name comes off the chat preview', w.fields['lastMessage.name'], 'Deleted account');

log = world({ createdBy: 'solo', memberUids: ['solo'], people: { solo: { name: 'Ana', joinedAt: 1 } } });
await sandbox.removeMemberFromSharedSpace({}, 'studyGroups/ABC123', 'solo', 'group');
check('last member out: the group is deleted', log.deletedDocs, ['studyGroups/ABC123']);
check('last member out: its subcollections go too, forms included', log.deletedSubs, ['studyGroups/ABC123/items', 'studyGroups/ABC123/messages', 'studyGroups/ABC123/forms']);
ok('last member out: nothing is written to a deleted doc', !log.commits.length);

/* ── A club ────────────────────────────────────────────────────── */
const orgDoc = () => ({
  createdBy: 'founder',
  memberUids: ['founder', 'officer2', 'mem3'],
  officerUids: ['founder', 'officer2'],
  people: { founder: { name: 'Ana', joinedAt: 100 }, officer2: { name: 'Bo', joinedAt: 400 }, mem3: { name: 'Cy', joinedAt: 200 } },
  rsvp: { founder: { e1: 'yes' }, mem3: { e1: 'no' } },
  titles: { founder: 'President' },
});

log = world(orgDoc());
await sandbox.removeMemberFromSharedSpace({}, 'orgs/CLUB01', 'mem3', 'org');
w = lastWrite(log);
check('club member leaves: dropped from members', w.fields.memberUids, ['founder', 'officer2']);
check('club member leaves: RSVPs and title cleared', w.clear, ['people.mem3', 'rsvp.mem3', 'titles.mem3']);
check('club member leaves: officers untouched', w.fields.officerUids, ['founder', 'officer2']);

log = world(orgDoc());
await sandbox.removeMemberFromSharedSpace({}, 'orgs/CLUB01', 'founder', 'org');
w = lastWrite(log);
check('founder leaves: an officer inherits, not the older plain member', w.fields.createdBy, 'officer2');
check('founder leaves: the heir stays an officer', w.fields.officerUids, ['officer2']);
// firestore.rules requires createdBy to be in BOTH lists or no officer edit passes.
ok('founder leaves: the new owner is still a member', w.fields.memberUids.includes(w.fields.createdBy));
ok('founder leaves: the new owner is an officer', w.fields.officerUids.includes(w.fields.createdBy));

log = world({ createdBy: 'founder', memberUids: ['founder', 'mem3'], officerUids: ['founder'], people: { founder: { joinedAt: 1 }, mem3: { joinedAt: 2 } } });
await sandbox.removeMemberFromSharedSpace({}, 'orgs/CLUB01', 'founder', 'org');
w = lastWrite(log);
check('sole officer leaves: a plain member is promoted', w.fields.createdBy, 'mem3');
check('sole officer leaves: and made an officer', w.fields.officerUids, ['mem3']);

/* ── Forms ─────────────────────────────────────────────────────── */
// A fake Firestore that answers queries by the collection they ask for.
function formsWorld(rows) {
  const l = world(groupDoc());
  l.queries = [];
  sandbox.runFirestoreQuery = async (env, q, parent = '') => { l.queries.push(`${parent}:${q.from[0].collectionId}`); return rows[q.from[0].collectionId] || []; };
  return l;
}
log = formsWorld({ formAnswers: [
  { id: 'orgs_CLUB01_f1', kind: 'club', code: 'CLUB01', formId: 'f1' },
  { id: 'studyGroups_ABC123_f2', kind: 'group', code: 'ABC123', formId: 'f2' },
  { id: 'x', kind: 'club', code: 'CLUB01/../../licenses', formId: 'f1' },
  { id: 'y', kind: 'planners', code: 'CLUB01', formId: 'f1' },
  { id: 'z', kind: 'club', code: 'CLUB01', formId: 'a/b' },
  { id: 'orgs_CLUB01_f3', kind: 'club', code: 'CLUB01', formId: 'f3', anon: true, answerId: 'a1b2c3d4' },
  { id: 'orgs_CLUB01_f4', kind: 'club', code: 'CLUB01', formId: 'f4', anon: true, answerId: '../../licenses/mem2' },
] });
let threw = false;
let left = await sandbox.eraseFormAnswers({}, 'mem2');
check('form answers: each one is erased where it was sent, clubs never joined included, with what was decided about it', log.deletedDocs.filter(d => !d.includes('/f3/')), ['orgs/CLUB01/forms/f1/responses/mem2', 'orgs/CLUB01/forms/f1/marks/mem2', 'studyGroups/ABC123/forms/f2/responses/mem2', 'studyGroups/ABC123/forms/f2/marks/mem2']);
check('form answers: the files sent as answers go too', log.deletedFolders, ['orgs/CLUB01/forms/f1/mem2/', 'studyGroups/ABC123/forms/f2/mem2/']);
check('form answers: an anonymous one is found by the id only the person’s own record knows', log.deletedDocs.filter(d => d.includes('/f3/')), ['orgs/CLUB01/forms/f3/responses/a1b2c3d4']);
ok('form answers: a record that names anything but a plain id deletes nothing', !log.deletedDocs.some(d => d.includes('licenses') || d.includes('/f4/')));
check('form answers: the list is read from the person’s own planner', log.queries, ['planners/mem2:formAnswers']);
check('form answers: the list itself is cleared', log.deletedSubs, ['planners/mem2/formAnswers']);
check('form answers: nothing left behind', left, []);
threw = false;
try { await sandbox.eraseFormAnswers({}, 'bad/uid'); } catch { threw = true; }
ok('form answers: an unsafe uid never reaches a path', threw);

log = formsWorld({ formAnswers: [{ id: 'orgs_CLUB01_f1', kind: 'club', code: 'CLUB01', formId: 'f1' }] });
sandbox.deleteFirestoreDoc = async () => { throw new Error('Firestore is down'); };
left = await sandbox.eraseFormAnswers({}, 'mem2');
check('form answers: a failure is reported, and the rest still runs', [left, log.deletedSubs], [['erase a form answer in orgs/CLUB01'], ['planners/mem2/formAnswers']]);

log = formsWorld({ forms: [{ id: 'f1', createdBy: 'mem2', createdByName: 'Bo' }, { id: 'f2', createdBy: 'mem2', createdByName: 'Deleted account' }] });
await sandbox.removeMemberFromSharedSpace({}, 'studyGroups/ABC123', 'mem2', 'group');
check('forms they wrote stay, with their name taken off', log.commits.at(-1), [{ path: 'studyGroups/ABC123/forms/f1', fields: { createdByName: 'Deleted account' } }]);

log = formsWorld({ forms: [{ id: 'f1' }, { id: 'f2' }] });
sandbox.readFirestoreDocWithTime = async () => ({ data: { createdBy: 'solo', memberUids: ['solo'], people: {} }, updateTime: 't1' });
await sandbox.removeMemberFromSharedSpace({}, 'orgs/CLUB01', 'solo', 'org');
check('last member out of a club: every form’s answers and marks go, then the forms', log.deletedSubs, ['orgs/CLUB01/messages', 'orgs/CLUB01/forms/f1/responses', 'orgs/CLUB01/forms/f1/marks', 'orgs/CLUB01/forms/f2/responses', 'orgs/CLUB01/forms/f2/marks', 'orgs/CLUB01/forms']);
check('last member out of a club: and the files sent as answers', log.deletedFolders, ['orgs/CLUB01/forms/']);

/* ── Concurrency ───────────────────────────────────────────────── */
log = world(groupDoc(), { failFirstCommit: true });
await sandbox.removeMemberFromSharedSpace({}, 'studyGroups/ABC123', 'mem2', 'group');
check('a clash with another member editing is retried', log.commits.length, 1);
ok('every write is guarded by the version it read', lastWrite(log).updateTime === 't1');

/* ── Field paths ───────────────────────────────────────────────── */
ok('a plain uid is a safe field path', sandbox.safeFieldKey('abc123XYZ_-'));
ok('a uid with a dot is refused', !sandbox.safeFieldKey('a.b'));
ok('a uid with a backtick is refused', !sandbox.safeFieldKey('a`b'));
threw = false;
try { await sandbox.removeMemberFromSharedSpace({}, 'studyGroups/ABC123', 'bad.uid', 'group'); } catch { threw = true; }
ok('an unsafe uid never reaches a field path', threw);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
