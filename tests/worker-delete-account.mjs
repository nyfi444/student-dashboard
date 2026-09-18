/* ── Deleting an account really does leave every shared space ──────
   These run the Worker's own removeMemberFromSharedSpace against fake
   Firestore documents. It's worth testing rather than eyeballing because
   the failure mode isn't an exception: it's a club whose owner no longer
   exists, which firestore.rules then makes uneditable by anyone, and
   which nobody discovers until an officer tries to post an event.

   Run:  node tests/worker-delete-account.mjs
──────────────────────────────────────────────────────────────── */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// The Worker is an ES module; strip the one export so it evaluates as a script
// and its top-level functions land on the sandbox global where tests reach them.
const src = readFileSync(join(root, 'worker/src/index.js'), 'utf8').replace(/^export default \{/m, 'globalThis.__worker = {');

const sandbox = { console, crypto, fetch: () => { throw new Error('no network in tests'); }, setTimeout, clearTimeout, TextEncoder, TextDecoder, atob, btoa, URL, Response, Request, Headers };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'worker/src/index.js' });

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
  const log = { commits: [], deletedDocs: [], deletedSubs: [], messageWrites: [] };
  let failures = failFirstCommit ? 1 : 0;
  sandbox.readFirestoreDocWithTime = async () => (doc ? { data: doc, updateTime: 't1' } : null);
  sandbox.deleteFirestoreDoc = async (env, c, id) => { log.deletedDocs.push(`${c}/${id}`); };
  sandbox.deleteFirestoreSubcollection = async (env, path, sub) => { log.deletedSubs.push(`${path}/${sub}`); };
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
check('last member out: its subcollections go too', log.deletedSubs, ['studyGroups/ABC123/items', 'studyGroups/ABC123/messages']);
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

/* ── Concurrency ───────────────────────────────────────────────── */
log = world(groupDoc(), { failFirstCommit: true });
await sandbox.removeMemberFromSharedSpace({}, 'studyGroups/ABC123', 'mem2', 'group');
check('a clash with another member editing is retried', log.commits.length, 1);
ok('every write is guarded by the version it read', lastWrite(log).updateTime === 't1');

/* ── Field paths ───────────────────────────────────────────────── */
ok('a plain uid is a safe field path', sandbox.safeFieldKey('abc123XYZ_-'));
ok('a uid with a dot is refused', !sandbox.safeFieldKey('a.b'));
ok('a uid with a backtick is refused', !sandbox.safeFieldKey('a`b'));
let threw = false;
try { await sandbox.removeMemberFromSharedSpace({}, 'studyGroups/ABC123', 'bad.uid', 'group'); } catch { threw = true; }
ok('an unsafe uid never reaches a field path', threw);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
