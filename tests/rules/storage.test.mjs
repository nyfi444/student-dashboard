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
/* ── Files sent as an answer to a form ──────────────────────────── */
describe('forms: a file as an answer', () => {
  const form = (extra = {}) => ({ id: 'f1', title: 'Application', status: 'open', audience: 'link', closesAt: null, createdBy: 'alice', ...extra });
  describe('in a club', () => {
    const base = 'orgs/CLUB01/forms/f1';
    beforeEach(async () => {
      await seedDoc('orgs/CLUB01', { code: 'CLUB01', createdBy: 'alice', memberUids: ['alice', 'bob', 'carol'], officerUids: ['alice', 'bob'] });
      await seedDoc(base, form());
    });
    test('someone answering a link form can send a file, under their own uid only', async () => {
      await assertSucceeds(put('mallory', `${base}/mallory/q1`));
      await assertFails(put('mallory', `${base}/carol/q1`));
      await assertFails(put(null, `${base}/mallory/q1`));
    });
    test('the sender can replace their own file', async () => {
      await assertSucceeds(put('mallory', `${base}/mallory/q1`));
      await assertSucceeds(put('mallory', `${base}/mallory/q1`, 32));
    });
    test('the sender and the officers can open it; a member and an outsider cannot', async () => {
      await seedFile(`${base}/mallory/q1`, 'mallory');
      await assertSucceeds(getBytes(ref(store('mallory'), `${base}/mallory/q1`)));
      await assertSucceeds(getBytes(ref(store('bob'), `${base}/mallory/q1`)));
      await assertFails(getBytes(ref(store('carol'), `${base}/mallory/q1`)));
      await assertFails(getBytes(ref(store('dave'), `${base}/mallory/q1`)));
      await assertFails(getBytes(ref(store(null), `${base}/mallory/q1`)));
    });
    test('a file over 10MB is refused', async () => {
      await assertFails(put('mallory', `${base}/mallory/q1`, 10 * MB + 1));
    });
    test('a members-only form takes files from members only', async () => {
      await seedDoc(base, form({ audience: 'members' }));
      await assertSucceeds(put('carol', `${base}/carol/q1`));
      await assertFails(put('mallory', `${base}/mallory/q1`));
    });
    test('a draft, a closed form, a form past its closing time, and a form that does not exist take no files', async () => {
      await seedDoc(base, form({ status: 'draft' }));
      await assertFails(put('carol', `${base}/carol/q1`));
      await seedDoc(base, form({ status: 'closed' }));
      await assertFails(put('carol', `${base}/carol/q1`));
      await seedDoc(base, form({ closesAt: Date.now() - 60000 }));
      await assertFails(put('carol', `${base}/carol/q1`));
      await assertFails(put('carol', 'orgs/CLUB01/forms/nope/carol/q1'));
    });
    test('an anonymous form takes no files, since the path would name the sender', async () => {
      await seedDoc(base, form({ anonymous: true, audience: 'members' }));
      await assertFails(put('carol', `${base}/carol/q1`));
    });
    test('the sender can take their file back, an officer can remove it, a member cannot', async () => {
      await seedFile(`${base}/mallory/q1`, 'mallory');
      await seedFile(`${base}/dave/q1`, 'dave');
      await assertFails(deleteObject(ref(store('carol'), `${base}/mallory/q1`)));
      await assertSucceeds(deleteObject(ref(store('mallory'), `${base}/mallory/q1`)));
      await assertSucceeds(deleteObject(ref(store('bob'), `${base}/dave/q1`)));
    });
  });
  describe('in a study group', () => {
    const base = 'studyGroups/GRP123/forms/f1';
    beforeEach(async () => {
      await seedDoc('studyGroups/GRP123', { createdBy: 'alice', memberUids: ['alice', 'bob', 'carol'] });
      await seedDoc(base, form({ audience: 'members', createdBy: 'bob' }));
    });
    test('a member sends a file; whoever made the form and the group’s owner can open it; other members cannot', async () => {
      await assertSucceeds(put('carol', `${base}/carol/q1`));
      await assertSucceeds(getBytes(ref(store('bob'), `${base}/carol/q1`)));
      await assertSucceeds(getBytes(ref(store('alice'), `${base}/carol/q1`)));
      await assertSucceeds(getBytes(ref(store('carol'), `${base}/carol/q1`)));
      await seedFile(`${base}/bob/q1`, 'bob');
      await assertFails(getBytes(ref(store('carol'), `${base}/bob/q1`)));
      await assertFails(put('mallory', `${base}/mallory/q1`));
    });
  });
});

describe('studyGroups/{groupId}/{fileId} (original format)', () => {
  test('existing links still open for anyone signed in, and nothing new can be written', async () => {
    await seedFile('studyGroups/oldgroup/f1.pdf', 'alice');
    await assertSucceeds(getBytes(ref(store('bob'), 'studyGroups/oldgroup/f1.pdf')));
    await assertFails(getBytes(ref(store(null), 'studyGroups/oldgroup/f1.pdf')));
    await assertFails(put('alice', 'studyGroups/oldgroup/f2.pdf'));
  });
});
