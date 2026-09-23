/* ── storage.rules, tested as the people it protects ────────────────
   Files are where the most personal things live — a syllabus carries a
   professor's phone number, an attachment can be anything — and where a
   leak is hardest to notice. Group and club files are gated on
   membership read out of Firestore, so these seed the Firestore documents
   first and check that Storage really consults them.
──────────────────────────────────────────────────────────────── */
import { after, before, beforeEach, describe, test } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';
import { BUCKET, as, makeEnv, signedOut } from './setup.mjs';

let env;
before(async () => { env = await makeEnv({ storage: true }); });
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); await env.clearStorage(); });

const MB = 1024 * 1024;
const bytes = (n = 16) => new Uint8Array(n).fill(7);
const store = (uid) => (uid ? as(env, uid) : signedOut(env)).storage(BUCKET);
const put = (uid, path, size, uploadedBy = uid) => uploadBytes(ref(store(uid), path), bytes(size), { customMetadata: uploadedBy ? { uploadedBy } : {} });
const seedFile = (path, uploadedBy) => env.withSecurityRulesDisabled(ctx => uploadBytes(ref(ctx.storage(BUCKET), path), bytes(), { customMetadata: { uploadedBy } }));
const seedDoc = (path, data) => env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), path), data));

/* ── A student's own files ──────────────────────────────────────── */
for (const kind of ['attachments', 'syllabi']) {
  describe(`users/{uid}/${kind}`, () => {
    test(`alice can store and open her own ${kind}`, async () => {
      await assertSucceeds(put('alice', `users/alice/${kind}/f1`));
      await assertSucceeds(getBytes(ref(store('alice'), `users/alice/${kind}/f1`)));
    });
    test(`mallory can neither open nor overwrite alice’s ${kind}`, async () => {
      await seedFile(`users/alice/${kind}/f1`, 'alice');
      await assertFails(getBytes(ref(store('mallory'), `users/alice/${kind}/f1`)));
      await assertFails(put('mallory', `users/alice/${kind}/f1`));
    });
    test(`signed out, nobody can open ${kind}`, async () => {
      await seedFile(`users/alice/${kind}/f1`, 'alice');
      await assertFails(getBytes(ref(store(null), `users/alice/${kind}/f1`)));
    });
  });
}
test('a personal file over 25MB is refused', async () => {
  await assertFails(put('alice', 'users/alice/attachments/big', 25 * MB + 1));
});

/* ── Study group files ──────────────────────────────────────────── */
describe('studyGroups/{code}/files', () => {
  beforeEach(async () => {
    await seedDoc('studyGroups/GRP123', { createdBy: 'alice', memberUids: ['alice', 'bob', 'carol'] });
  });
  const path = 'studyGroups/GRP123/files/f1';
  test('a member can share a file and every member can open it', async () => {
    await assertSucceeds(put('bob', path));
    await assertSucceeds(getBytes(ref(store('carol'), path)));
  });
  test('someone outside the group can neither share into it nor open its files', async () => {
    await seedFile(path, 'bob');
    await assertFails(put('mallory', 'studyGroups/GRP123/files/f2'));
    await assertFails(getBytes(ref(store('mallory'), path)));
  });
  test('a group file over 10MB is refused', async () => {
    await assertFails(put('bob', 'studyGroups/GRP123/files/big', 10 * MB + 1));
  });
  test('whoever shared a file can remove it, and so can the owner, but no other member', async () => {
    await seedFile(path, 'bob');
    await assertFails(deleteObject(ref(store('carol'), path)));
    await assertSucceeds(deleteObject(ref(store('bob'), path)));
    await seedFile(path, 'bob');
    await assertSucceeds(deleteObject(ref(store('alice'), path)));
  });
  test('another member cannot replace someone else’s file', async () => {
    // Uploading over an existing file is judged by the create rule, not
    // update, so this is the test that holds storage.rules to its word.
    await seedFile(path, 'bob');
    await assertFails(put('carol', path));
  });
  test('whoever shared a file can replace it, and so can the owner', async () => {
    await seedFile(path, 'bob');
    await assertSucceeds(put('bob', path));
    await assertSucceeds(put('alice', path, 16, 'bob'));
  });
  test('a file for a group that does not exist is refused', async () => {
    await assertFails(put('bob', 'studyGroups/NOPE00/files/f1'));
  });
});

/* ── Club & team files ──────────────────────────────────────────── */
describe('orgs/{code}/files', () => {
  beforeEach(async () => {
    await seedDoc('orgs/CLUB01', { code: 'CLUB01', createdBy: 'alice', memberUids: ['alice', 'bob', 'carol'], officerUids: ['alice', 'bob'] });
  });
  const path = 'orgs/CLUB01/files/f1';
  test('an officer can post a file and every member can open it', async () => {
    await assertSucceeds(put('bob', path));
    await assertSucceeds(getBytes(ref(store('carol'), path)));
  });
  test('a member who is not an officer cannot post or remove files', async () => {
    await seedFile(path, 'bob');
    await assertFails(put('carol', 'orgs/CLUB01/files/f2'));
    await assertFails(deleteObject(ref(store('carol'), path)));
  });
  test('someone outside the club cannot open its files', async () => {
    await seedFile(path, 'bob');
    await assertFails(getBytes(ref(store('mallory'), path)));
  });
  test('an officer can remove a file', async () => {
    await seedFile(path, 'alice');
    await assertSucceeds(deleteObject(ref(store('bob'), path)));
  });
});

/* ── First-version group files ──────────────────────────────────── */
describe('studyGroups/{groupId}/{fileId} (original format)', () => {
  test('existing links still open for anyone signed in, and nothing new can be written', async () => {
    await seedFile('studyGroups/oldgroup/f1.pdf', 'alice');
    await assertSucceeds(getBytes(ref(store('bob'), 'studyGroups/oldgroup/f1.pdf')));
    await assertFails(getBytes(ref(store(null), 'studyGroups/oldgroup/f1.pdf')));
    await assertFails(put('alice', 'studyGroups/oldgroup/f2.pdf'));
  });
});
