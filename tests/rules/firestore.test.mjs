/* ── firestore.rules, tested as the people it protects ──────────────
   The rules are the entire security boundary between one student's
   planner and everyone else's, and deploy-rules.yml publishes them on
   every push that touches them. These run first. Each test is one
   sentence about who may do what; a failure names the person and the
   thing they were or weren't allowed to do.

   The people: alice and bob are students, mallory is any other signed-in
   account (the one the rules have to hold against), and signed-out is
   anyone at all with the public API key.
──────────────────────────────────────────────────────────────── */
import { after, before, beforeEach, describe, test } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, setDoc, updateDoc, where, addDoc, writeBatch } from 'firebase/firestore';
import { as, makeEnv, signedOut } from './setup.mjs';

let env;
before(async () => { env = await makeEnv(); });
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const seed = (path, data) => env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), path), data));
const db = (uid, token) => (uid ? as(env, uid, token) : signedOut(env)).firestore();

/* ── Each student's own planner ─────────────────────────────────── */
describe('planners', () => {
  test('alice can write and read her own planner', async () => {
    await assertSucceeds(setDoc(doc(db('alice'), 'planners/alice'), { state: '{}' }));
    await assertSucceeds(getDoc(doc(db('alice'), 'planners/alice')));
  });
  test('mallory cannot read alice’s planner', async () => {
    await seed('planners/alice', { state: '{}' });
    await assertFails(getDoc(doc(db('mallory'), 'planners/alice')));
  });
  test('mallory cannot overwrite alice’s planner', async () => {
    await assertFails(setDoc(doc(db('mallory'), 'planners/alice'), { state: 'gone' }));
  });
  test('signed out, nobody can read a planner', async () => {
    await seed('planners/alice', { state: '{}' });
    await assertFails(getDoc(doc(db(null), 'planners/alice')));
  });
  test('nobody can list every planner', async () => {
    await assertFails(getDocs(collection(db('alice'), 'planners')));
  });
  test('notes follow the same owner-only rule', async () => {
    await assertSucceeds(setDoc(doc(db('alice'), 'planners/alice/notes/n1'), { body: 'hi' }));
    await assertFails(getDoc(doc(db('mallory'), 'planners/alice/notes/n1')));
    await assertFails(setDoc(doc(db('mallory'), 'planners/alice/notes/n2'), { body: 'x' }));
  });
});

/* ── Who has paid ───────────────────────────────────────────────── */
describe('licenses', () => {
  test('alice can read her own license', async () => {
    await seed('licenses/alice', { paid: true });
    await assertSucceeds(getDoc(doc(db('alice'), 'licenses/alice')));
  });
  test('alice cannot mark herself as paid', async () => {
    await assertFails(setDoc(doc(db('alice'), 'licenses/alice'), { paid: true }));
  });
  test('alice cannot turn an expired license back on', async () => {
    await seed('licenses/alice', { paid: false });
    await assertFails(updateDoc(doc(db('alice'), 'licenses/alice'), { paid: true }));
  });
  test('mallory cannot read alice’s license', async () => {
    await seed('licenses/alice', { paid: true });
    await assertFails(getDoc(doc(db('mallory'), 'licenses/alice')));
  });
});

/* ── Server-only collections: the Worker writes these with its own
      service account; no client may read or write them at all. ───── */
describe('server-only collections', () => {
  for (const path of ['licensesByEmail/alice@school.edu', 'feedback/f1', 'errors/e1', 'events/v1', 'groupPlans/p1', 'groupPlans/p1/members/alice', 'groupInvites/ABCDEFGH', 'emailOnboarding/alice@school.edu', 'emailPrefs/alice@school.edu', 'emailLog/abc-welcome', 'bizLedger/2026-09-27', 'bizEvents/x', 'bizState/events', 'aiUsage/2026-09-27']) {
    test(`${path.split('/')[0]}${path.includes('/members/') ? '/members' : ''}: no client may read or write`, async () => {
      await seed(path, { anything: true });
      await assertFails(getDoc(doc(db('alice'), path)));
      await assertFails(setDoc(doc(db('alice'), path), { anything: false }));
      await assertFails(getDoc(doc(db(null), path)));
    });
  }
  test('the retired push collection: owners may read and delete, nobody may create', async () => {
    await seed('push/alice', { old: true });
    await assertSucceeds(getDoc(doc(db('alice'), 'push/alice')));
    await assertFails(setDoc(doc(db('bob'), 'push/bob'), { sub: 'x' }));
    await assertSucceeds(deleteDoc(doc(db('alice'), 'push/alice')));
  });
});

/* ── Study groups ───────────────────────────────────────────────── */
describe('studyGroups', () => {
  const group = (extra = {}) => ({
    code: 'GRP123', name: 'Bio study', createdBy: 'alice', memberUids: ['alice', 'bob'],
    people: { alice: { name: 'Alice' }, bob: { name: 'Bob' } }, sessions: [], ...extra,
  });

  test('alice can start a group with only herself in it', async () => {
    await assertSucceeds(setDoc(doc(db('alice'), 'studyGroups/GRP123'), { createdBy: 'alice', memberUids: ['alice'], people: {} }));
  });
  test('alice cannot start a group in bob’s name', async () => {
    await assertFails(setDoc(doc(db('alice'), 'studyGroups/GRP123'), { createdBy: 'bob', memberUids: ['bob'], people: {} }));
  });
  test('alice cannot start a group with other people already in it', async () => {
    await assertFails(setDoc(doc(db('alice'), 'studyGroups/GRP123'), { createdBy: 'alice', memberUids: ['alice', 'bob'], people: {} }));
  });
  test('only members can read a group; nobody can browse them', async () => {
    await seed('studyGroups/GRP123', group());
    await assertSucceeds(getDoc(doc(db('bob'), 'studyGroups/GRP123')));
    await assertFails(getDoc(doc(db('mallory'), 'studyGroups/GRP123')));
    await assertFails(getDoc(doc(db(null), 'studyGroups/GRP123')));
    await assertFails(getDocs(collection(db('alice'), 'studyGroups')));
  });
  test('anyone signed in with the code can read the public preview, never browse previews', async () => {
    await seed('studyGroups/GRP123', group());
    await seed('studyGroups/GRP123/public/preview', { v: 1, name: 'Bio study', memberCount: 2, updatedAt: 1 });
    await assertSucceeds(getDoc(doc(db('mallory'), 'studyGroups/GRP123/public/preview')));
    await assertFails(getDoc(doc(db(null), 'studyGroups/GRP123/public/preview')));
    await assertFails(getDocs(collection(db('mallory'), 'studyGroups/GRP123/public')));
  });
  test('a member keeps the preview current, with the real member count and nothing extra', async () => {
    await seed('studyGroups/GRP123', group());
    const p = (uid) => doc(db(uid), 'studyGroups/GRP123/public/preview');
    const ok = { v: 1, name: 'Bio study', courseLabel: 'BIO 210', color: '#8FB3A9', memberCount: 2, next: { title: 'Midterm review', date: '2026-10-08', start: '18:00' }, updatedAt: 1 };
    await assertSucceeds(setDoc(p('bob'), ok));
    await assertFails(setDoc(p('bob'), { ...ok, memberCount: 40 }));
    await assertFails(setDoc(p('bob'), { ...ok, people: { bob: 'Bob' } }));
    await assertFails(setDoc(p('bob'), { ...ok, next: { title: 'x', date: '2026-10-08', where: 'Room 4' } }));
    await assertFails(setDoc(p('mallory'), ok));
    await assertFails(setDoc(doc(db('bob'), 'studyGroups/GRP123/public/other'), ok));
  });
  test('the owner can block someone from rejoining, and a blocked account cannot join', async () => {
    await seed('studyGroups/GRP123', group());
    await assertSucceeds(updateDoc(doc(db('alice'), 'studyGroups/GRP123'), { memberUids: ['alice'], 'blocked.bob': { name: 'Bob', at: 1 } }));
    await assertFails(updateDoc(doc(db('bob'), 'studyGroups/GRP123'), { memberUids: ['alice', 'bob'], 'people.bob': { name: 'Bob' } }));
    await assertSucceeds(updateDoc(doc(db('mallory'), 'studyGroups/GRP123'), { memberUids: ['alice', 'mallory'], 'people.mallory': { name: 'M' } }));
  });
  test('only the owner changes the blocked list', async () => {
    await seed('studyGroups/GRP123', group({ blocked: { eve: { name: 'Eve', at: 1 } } }));
    await assertFails(updateDoc(doc(db('bob'), 'studyGroups/GRP123'), { 'blocked.eve': deleteField() }));
    await assertFails(updateDoc(doc(db('bob'), 'studyGroups/GRP123'), { 'blocked.carol': { name: 'C', at: 1 } }));
    await assertSucceeds(updateDoc(doc(db('alice'), 'studyGroups/GRP123'), { 'blocked.eve': deleteField() }));
  });
  test('mallory can join with the code by adding only herself', async () => {
    await seed('studyGroups/GRP123', group());
    await assertSucceeds(updateDoc(doc(db('mallory'), 'studyGroups/GRP123'), {
      memberUids: ['alice', 'bob', 'mallory'], 'people.mallory': { name: 'Mallory' },
    }));
  });
  test('joining cannot bring someone else along', async () => {
    await seed('studyGroups/GRP123', group());
    await assertFails(updateDoc(doc(db('mallory'), 'studyGroups/GRP123'), {
      memberUids: ['alice', 'bob', 'mallory', 'eve'], 'people.mallory': { name: 'M' }, 'people.eve': { name: 'E' },
    }));
  });
  test('joining cannot remove anyone', async () => {
    await seed('studyGroups/GRP123', group());
    await assertFails(updateDoc(doc(db('mallory'), 'studyGroups/GRP123'), {
      memberUids: ['alice', 'mallory'], 'people.mallory': { name: 'M' },
    }));
  });
  test('joining cannot change anything else about the group', async () => {
    await seed('studyGroups/GRP123', group());
    await assertFails(updateDoc(doc(db('mallory'), 'studyGroups/GRP123'), {
      memberUids: ['alice', 'bob', 'mallory'], 'people.mallory': { name: 'M' }, name: 'Taken over',
    }));
  });
  test('joining cannot rewrite another member’s name', async () => {
    await seed('studyGroups/GRP123', group());
    await assertFails(updateDoc(doc(db('mallory'), 'studyGroups/GRP123'), {
      memberUids: ['alice', 'bob', 'mallory'], 'people.mallory': { name: 'M' }, 'people.alice': { name: 'not alice' },
    }));
  });
  test('a member can plan sessions', async () => {
    await seed('studyGroups/GRP123', group());
    await assertSucceeds(updateDoc(doc(db('bob'), 'studyGroups/GRP123'), { sessions: [{ at: '2026-10-01T18:00' }] }));
  });
  test('a member can leave', async () => {
    await seed('studyGroups/GRP123', group());
    await assertSucceeds(updateDoc(doc(db('bob'), 'studyGroups/GRP123'), { memberUids: ['alice'] }));
  });
  test('a member cannot remove someone else', async () => {
    await seed('studyGroups/GRP123', group({ memberUids: ['alice', 'bob', 'carol'] }));
    await assertFails(updateDoc(doc(db('bob'), 'studyGroups/GRP123'), { memberUids: ['alice', 'bob'] }));
  });
  test('a member cannot take ownership', async () => {
    await seed('studyGroups/GRP123', group());
    await assertFails(updateDoc(doc(db('bob'), 'studyGroups/GRP123'), { createdBy: 'bob' }));
  });
  test('the owner can remove a member', async () => {
    await seed('studyGroups/GRP123', group());
    await assertSucceeds(updateDoc(doc(db('alice'), 'studyGroups/GRP123'), { memberUids: ['alice'] }));
  });
  test('someone outside the group cannot edit it', async () => {
    await seed('studyGroups/GRP123', group());
    await assertFails(updateDoc(doc(db('mallory'), 'studyGroups/GRP123'), { sessions: [] }));
  });
  test('only the owner can delete the group', async () => {
    await seed('studyGroups/GRP123', group());
    await assertFails(deleteDoc(doc(db('bob'), 'studyGroups/GRP123')));
    await assertSucceeds(deleteDoc(doc(db('alice'), 'studyGroups/GRP123')));
  });
  test('an original-format group with no member list: only its creator may touch it', async () => {
    await seed('studyGroups/OLD111', { createdBy: 'alice', name: 'Old' });
    await assertSucceeds(getDoc(doc(db('alice'), 'studyGroups/OLD111')));
    await assertFails(getDoc(doc(db('mallory'), 'studyGroups/OLD111')));
    await assertFails(updateDoc(doc(db('mallory'), 'studyGroups/OLD111'), { name: 'mine' }));
    await assertSucceeds(updateDoc(doc(db('alice'), 'studyGroups/OLD111'), { memberUids: ['alice'], people: {} }));
  });

  describe('shared items', () => {
    beforeEach(async () => {
      await seed('studyGroups/GRP123', group());
      await seed('studyGroups/GRP123/items/i1', { sharedByUid: 'bob', title: 'notes' });
    });
    test('members can see what the group shared; outsiders cannot', async () => {
      await assertSucceeds(getDoc(doc(db('alice'), 'studyGroups/GRP123/items/i1')));
      await assertFails(getDoc(doc(db('mallory'), 'studyGroups/GRP123/items/i1')));
    });
    test('a member can share something as themselves, not as someone else', async () => {
      await assertSucceeds(setDoc(doc(db('bob'), 'studyGroups/GRP123/items/i2'), { sharedByUid: 'bob' }));
      await assertFails(setDoc(doc(db('bob'), 'studyGroups/GRP123/items/i3'), { sharedByUid: 'alice' }));
    });
    test('an outsider cannot share into the group', async () => {
      await assertFails(setDoc(doc(db('mallory'), 'studyGroups/GRP123/items/i4'), { sharedByUid: 'mallory' }));
    });
    test('shared items are never edited in place', async () => {
      await assertFails(updateDoc(doc(db('bob'), 'studyGroups/GRP123/items/i1'), { title: 'changed' }));
    });
    test('whoever shared it can take it back, and so can the owner, but no other member', async () => {
      await seed('studyGroups/GRP123', group({ memberUids: ['alice', 'bob', 'carol'] }));
      await assertFails(deleteDoc(doc(db('carol'), 'studyGroups/GRP123/items/i1')));
      await assertSucceeds(deleteDoc(doc(db('bob'), 'studyGroups/GRP123/items/i1')));
      await seed('studyGroups/GRP123/items/i1', { sharedByUid: 'bob' });
      await assertSucceeds(deleteDoc(doc(db('alice'), 'studyGroups/GRP123/items/i1')));
    });
  });

  describe('chat', () => {
    beforeEach(async () => { await seed('studyGroups/GRP123', group()); });
    const msgs = (uid) => collection(db(uid), 'studyGroups/GRP123/messages');
    test('a member can post as themselves', async () => {
      await assertSucceeds(addDoc(msgs('bob'), { uid: 'bob', text: 'see you at 6', name: 'Bob' }));
    });
    test('a member cannot post as someone else', async () => {
      await assertFails(addDoc(msgs('bob'), { uid: 'alice', text: 'I quit' }));
    });
    test('an outsider can neither post nor read', async () => {
      await assertFails(addDoc(msgs('mallory'), { uid: 'mallory', text: 'hi' }));
      await assertFails(getDocs(msgs('mallory')));
    });
    test('an empty message and one over 2,000 characters are refused', async () => {
      await assertFails(addDoc(msgs('bob'), { uid: 'bob', text: '' }));
      await assertFails(addDoc(msgs('bob'), { uid: 'bob', text: 'x'.repeat(2001) }));
      await assertSucceeds(addDoc(msgs('bob'), { uid: 'bob', text: 'x'.repeat(2000) }));
    });
    test('a display name over 80 characters is refused', async () => {
      await assertFails(addDoc(msgs('bob'), { uid: 'bob', text: 'hi', name: 'n'.repeat(81) }));
    });
    test('messages are never edited, and only the author or the owner removes one', async () => {
      await seed('studyGroups/GRP123', group({ memberUids: ['alice', 'bob', 'carol'] }));
      await seed('studyGroups/GRP123/messages/m1', { uid: 'bob', text: 'hi' });
      await assertFails(updateDoc(doc(db('bob'), 'studyGroups/GRP123/messages/m1'), { text: 'edited' }));
      await assertFails(deleteDoc(doc(db('carol'), 'studyGroups/GRP123/messages/m1')));
      await assertSucceeds(deleteDoc(doc(db('alice'), 'studyGroups/GRP123/messages/m1')));
    });
  });
});

/* ── Shared classes ─────────────────────────────────────────────── */
describe('classes', () => {
  const cls = (extra = {}) => ({ code: 'BIO210', createdBy: 'alice', name: 'Cell Biology', listed: false, ...extra });
  test('anyone signed in with the code can open a shared class', async () => {
    await seed('classes/BIO210', cls());
    await assertSucceeds(getDoc(doc(db('bob'), 'classes/BIO210')));
    await assertFails(getDoc(doc(db(null), 'classes/BIO210')));
  });
  test('only classes marked listed can be searched', async () => {
    await seed('classes/BIO210', cls({ listed: true }));
    await seed('classes/CHM101', cls({ code: 'CHM101' }));
    await assertSucceeds(getDocs(query(collection(db('bob'), 'classes'), where('listed', '==', true))));
    await assertFails(getDocs(collection(db('bob'), 'classes')));
  });
  test('alice can share a class under its own code, in her own name', async () => {
    await assertSucceeds(setDoc(doc(db('alice'), 'classes/BIO210'), cls()));
    await assertFails(setDoc(doc(db('alice'), 'classes/CHM101'), cls({ code: 'CHM101', createdBy: 'bob' })));
    await assertFails(setDoc(doc(db('alice'), 'classes/PSY100'), cls({ code: 'NOTPSY' })));
  });
  test('only the sharer can change it, and never its owner or code', async () => {
    await seed('classes/BIO210', cls());
    await assertSucceeds(updateDoc(doc(db('alice'), 'classes/BIO210'), { name: 'Cell Bio' }));
    await assertFails(updateDoc(doc(db('bob'), 'classes/BIO210'), { name: 'mine now' }));
    await assertFails(updateDoc(doc(db('alice'), 'classes/BIO210'), { createdBy: 'bob' }));
    await assertFails(updateDoc(doc(db('alice'), 'classes/BIO210'), { code: 'OTHER1' }));
  });
  test('classmates can add and remove only themselves', async () => {
    await seed('classes/BIO210', cls());
    await assertSucceeds(setDoc(doc(db('bob'), 'classes/BIO210/members/bob'), { at: 1 }));
    await assertFails(setDoc(doc(db('bob'), 'classes/BIO210/members/carol'), { at: 1 }));
    await assertFails(deleteDoc(doc(db('mallory'), 'classes/BIO210/members/bob')));
  });
});

/* ── Clubs & teams ──────────────────────────────────────────────── */
describe('orgs', () => {
  const org = (extra = {}) => ({
    code: 'CLUB01', name: 'Chess', createdBy: 'alice',
    memberUids: ['alice', 'bob', 'carol'], officerUids: ['alice', 'bob'],
    people: { alice: { name: 'A' }, bob: { name: 'B' }, carol: { name: 'C' } }, rsvp: {}, ...extra,
  });
  const ref = (uid) => doc(db(uid), 'orgs/CLUB01');

  test('alice can found a club with only herself as member and officer', async () => {
    await assertSucceeds(setDoc(doc(db('alice'), 'orgs/CLUB01'), { code: 'CLUB01', createdBy: 'alice', memberUids: ['alice'], officerUids: ['alice'] }));
  });
  test('founding a club in someone else’s name, or with extra officers, is refused', async () => {
    await assertFails(setDoc(doc(db('alice'), 'orgs/CLUB02'), { code: 'CLUB02', createdBy: 'bob', memberUids: ['bob'], officerUids: ['bob'] }));
    await assertFails(setDoc(doc(db('alice'), 'orgs/CLUB03'), { code: 'CLUB03', createdBy: 'alice', memberUids: ['alice'], officerUids: ['alice', 'bob'] }));
  });
  test('only members can read a club; nobody can browse them', async () => {
    await seed('orgs/CLUB01', org());
    await assertSucceeds(getDoc(ref('carol')));
    await assertFails(getDoc(ref('mallory')));
    await assertFails(getDocs(collection(db('alice'), 'orgs')));
  });
  test('anyone signed in with the code reads the preview; only officers write it, honestly', async () => {
    await seed('orgs/CLUB01', org());
    const p = (uid) => doc(db(uid), 'orgs/CLUB01/public/preview');
    const ok = { v: 1, name: 'Chess', kind: 'club', school: 'State', color: '#B49F90', memberCount: 3, next: null, updatedAt: 1 };
    await assertSucceeds(setDoc(p('bob'), ok));
    await assertSucceeds(getDoc(p('mallory')));
    await assertFails(getDoc(p(null)));
    await assertFails(setDoc(p('carol'), ok));
    await assertFails(setDoc(p('bob'), { ...ok, memberCount: 300 }));
    await assertFails(setDoc(p('bob'), { ...ok, officerUids: ['alice'] }));
  });
  test('an officer can block someone from rejoining, and a blocked account cannot join', async () => {
    await seed('orgs/CLUB01', org());
    await assertSucceeds(updateDoc(ref('bob'), { memberUids: ['alice', 'bob'], 'people.carol': deleteField(), 'blocked.carol': { name: 'C', at: 1 } }));
    await assertFails(updateDoc(ref('carol'), { memberUids: arrayUnion('carol'), 'people.carol': { name: 'C', joinedAt: 2 } }));
    await assertFails(updateDoc(ref('carol'), { 'blocked.carol': deleteField() }));
  });
  test('an officer removes people but never adds anyone', async () => {
    await seed('orgs/CLUB01', org());
    await assertFails(updateDoc(ref('bob'), { memberUids: arrayUnion('mallory'), 'people.mallory': { name: 'M' } }));
    await assertSucceeds(updateDoc(ref('bob'), { memberUids: ['alice', 'bob'] }));
  });
  test('joining arrives unreviewed, with only a name, title and join date', async () => {
    await seed('orgs/CLUB01', org());
    await assertFails(updateDoc(ref('mallory'), { memberUids: arrayUnion('mallory'), 'people.mallory': { name: 'M', title: 'President', reviewed: true } }));
    await assertFails(updateDoc(ref('mallory'), { memberUids: arrayUnion('mallory'), 'people.mallory': { name: 'M', color: '#000' } }));
    await assertSucceeds(updateDoc(ref('mallory'), { memberUids: arrayUnion('mallory'), 'people.mallory': { name: 'M', title: 'Treasurer', joinedAt: 5 } }));
  });
  test('a member can never mark their own title as reviewed', async () => {
    await seed('orgs/CLUB01', org());
    await assertFails(updateDoc(ref('carol'), { 'people.carol.title': 'President', 'people.carol.reviewed': true }));
    await assertFails(updateDoc(ref('carol'), { 'people.carol': { name: 'C', title: 'President', reviewed: true } }));
    await assertSucceeds(updateDoc(ref('carol'), { 'people.carol.title': 'President', 'people.carol.reviewed': false }));
  });
  test('a reviewed title stays reviewed only while it stays the same', async () => {
    await seed('orgs/CLUB01', org({ people: { alice: { name: 'A' }, bob: { name: 'B' }, carol: { name: 'C', title: 'Treasurer', reviewed: true } } }));
    await assertSucceeds(updateDoc(ref('carol'), { 'people.carol.name': 'Carol' }));
    await assertFails(updateDoc(ref('carol'), { 'people.carol.title': 'President' }));
    await assertSucceeds(updateDoc(ref('carol'), { 'people.carol.title': 'President', 'people.carol.reviewed': deleteField() }));
  });
  test('mallory can join with the code by adding only herself', async () => {
    await seed('orgs/CLUB01', org());
    await assertSucceeds(updateDoc(ref('mallory'), { memberUids: arrayUnion('mallory'), 'people.mallory': { name: 'M' } }));
  });
  test('joining cannot make you an officer', async () => {
    await seed('orgs/CLUB01', org());
    await assertFails(updateDoc(ref('mallory'), { memberUids: arrayUnion('mallory'), officerUids: arrayUnion('mallory'), 'people.mallory': { name: 'M' } }));
  });
  test('a member can RSVP for themselves but not for anyone else', async () => {
    await seed('orgs/CLUB01', org());
    await assertSucceeds(updateDoc(ref('carol'), { 'rsvp.carol': { e1: 'yes' } }));
    await assertFails(updateDoc(ref('carol'), { 'rsvp.alice': { e1: 'no' } }));
  });
  test('a member can change their own name and title, not anyone else’s', async () => {
    await seed('orgs/CLUB01', org());
    await assertSucceeds(updateDoc(ref('carol'), { 'people.carol': { name: 'Carol', title: 'Treasurer' } }));
    await assertFails(updateDoc(ref('carol'), { 'people.alice': { name: 'x' } }));
  });
  test('a member cannot make themselves an officer or edit the club', async () => {
    await seed('orgs/CLUB01', org());
    await assertFails(updateDoc(ref('carol'), { officerUids: ['alice', 'bob', 'carol'] }));
    await assertFails(updateDoc(ref('carol'), { name: 'Checkers' }));
  });
  test('a member can leave', async () => {
    await seed('orgs/CLUB01', org());
    await assertSucceeds(updateDoc(ref('carol'), { memberUids: ['alice', 'bob'] }));
  });
  test('an officer can run the club', async () => {
    await seed('orgs/CLUB01', org());
    await assertSucceeds(updateDoc(ref('bob'), { name: 'Chess Club', events: [{ id: 'e1', title: 'Blitz night' }] }));
  });
  test('no officer can remove the founder', async () => {
    await seed('orgs/CLUB01', org());
    await assertFails(updateDoc(ref('bob'), { memberUids: ['bob', 'carol'] }));
    await assertFails(updateDoc(ref('bob'), { officerUids: ['bob'] }));
  });
  test('only the founder decides who is an officer', async () => {
    await seed('orgs/CLUB01', org());
    await assertFails(updateDoc(ref('bob'), { officerUids: ['alice', 'bob', 'carol'] }));
    await assertSucceeds(updateDoc(ref('alice'), { officerUids: ['alice', 'bob', 'carol'] }));
  });
  test('an officer can step down', async () => {
    await seed('orgs/CLUB01', org());
    await assertSucceeds(updateDoc(ref('bob'), { officerUids: ['alice'] }));
  });
  test('only the founder can hand the club on', async () => {
    await seed('orgs/CLUB01', org());
    await assertFails(updateDoc(ref('bob'), { createdBy: 'bob' }));
  });
  test('only the founder can delete the club', async () => {
    await seed('orgs/CLUB01', org());
    await assertFails(deleteDoc(ref('bob')));
    await assertSucceeds(deleteDoc(ref('alice')));
  });
  test('the club code can never change', async () => {
    await seed('orgs/CLUB01', org());
    await assertFails(updateDoc(ref('alice'), { code: 'CLUB99' }));
  });

  describe('chat', () => {
    beforeEach(async () => { await seed('orgs/CLUB01', org()); });
    const msgs = (uid) => collection(db(uid), 'orgs/CLUB01/messages');
    test('members read and post as themselves; outsiders do neither', async () => {
      await assertSucceeds(addDoc(msgs('carol'), { uid: 'carol', text: 'in' }));
      await assertSucceeds(getDocs(msgs('carol')));
      await assertFails(addDoc(msgs('mallory'), { uid: 'mallory', text: 'hi' }));
      await assertFails(getDocs(msgs('mallory')));
    });
    test('nobody posts as someone else', async () => {
      await assertFails(addDoc(msgs('carol'), { uid: 'alice', text: 'meeting cancelled' }));
    });
    test('officers can remove any message; members only their own', async () => {
      await seed('orgs/CLUB01/messages/m1', { uid: 'carol', text: 'hi' });
      await seed('orgs/CLUB01/messages/m2', { uid: 'alice', text: 'hi' });
      await assertFails(deleteDoc(doc(db('carol'), 'orgs/CLUB01/messages/m2')));
      await assertSucceeds(deleteDoc(doc(db('carol'), 'orgs/CLUB01/messages/m1')));
      await assertSucceeds(deleteDoc(doc(db('bob'), 'orgs/CLUB01/messages/m2')));
    });
  });
});

/* ── Forms (clubs and study groups) ─────────────────────────────────
   alice founded the club and bob is an officer; carol is a member;
   mallory has never joined. An answer is only ever written together
   with the sender's own record of it (planners/{uid}/formAnswers), which
   is what lets "delete my account" find it later. */
describe('forms', () => {
  const org = () => ({
    code: 'CLUB01', name: 'Chess', createdBy: 'alice',
    memberUids: ['alice', 'bob', 'carol'], officerUids: ['alice', 'bob'],
    people: { alice: { name: 'A' }, bob: { name: 'B' }, carol: { name: 'C' } }, rsvp: {},
  });
  const group = () => ({
    code: 'GRP123', name: 'Bio study', createdBy: 'alice', memberUids: ['alice', 'bob', 'carol'],
    people: { alice: { name: 'Alice' }, bob: { name: 'Bob' }, carol: { name: 'Carol' } },
  });
  const form = (extra = {}) => ({
    v: 1, id: 'f1', title: 'Interest form', description: '', questions: [{ id: 'q1', type: 'short', label: 'Major?', required: true, options: [] }],
    status: 'open', audience: 'link', collectEmail: true, allowEdit: true, closesAt: null,
    createdBy: 'alice', createdByName: 'A', createdAt: 1, updatedAt: 1, spaceKind: 'club', spaceName: 'Chess', spaceColor: '', ...extra,
  });
  const answer = (uid, extra = {}) => ({ uid, name: uid, email: `${uid}@school.edu`, member: false, answers: { q1: 'Biology' }, at: 5, updatedAt: 5, ...extra });
  // The way the app sends one: the answer and the sender's record of it, together.
  const send = (uid, base, data, { key = `${base.split('/')[0]}_${base.split('/')[1]}_f1`, record = true } = {}) => {
    const d = db(uid);
    const batch = writeBatch(d);
    batch.set(doc(d, `${base}/forms/f1/responses/${data.uid}`), data);
    if (record) batch.set(doc(d, `planners/${uid}/formAnswers/${key}`), { kind: 'club', code: base.split('/')[1], formId: 'f1', at: 5 });
    return batch.commit();
  };

  describe('in a club', () => {
    const base = 'orgs/CLUB01';
    beforeEach(async () => { await seed(base, org()); });

    test('an officer can write a form; a member and an outsider cannot', async () => {
      await assertSucceeds(setDoc(doc(db('bob'), `${base}/forms/f1`), form({ createdBy: 'bob' })));
      await assertFails(setDoc(doc(db('carol'), `${base}/forms/f2`), form({ id: 'f2', createdBy: 'carol' })));
      await assertFails(setDoc(doc(db('mallory'), `${base}/forms/f3`), form({ id: 'f3', createdBy: 'mallory' })));
    });
    test('a form cannot be written in another officer’s name, or handed to someone else later', async () => {
      await assertFails(setDoc(doc(db('bob'), `${base}/forms/f1`), form({ createdBy: 'alice' })));
      await seed(`${base}/forms/f1`, form());
      await assertFails(updateDoc(doc(db('bob'), `${base}/forms/f1`), { createdBy: 'bob' }));
      await assertSucceeds(updateDoc(doc(db('bob'), `${base}/forms/f1`), { status: 'closed' }));
    });
    test('a form with no title, too many questions, or a made-up status is refused', async () => {
      const put = (extra) => setDoc(doc(db('alice'), `${base}/forms/f1`), form(extra));
      await assertFails(put({ title: '' }));
      await assertFails(put({ title: 'x'.repeat(121) }));
      await assertFails(put({ questions: Array.from({ length: 41 }, (_, i) => ({ id: `q${i}` })) }));
      await assertFails(put({ status: 'secret' }));
      await assertFails(put({ audience: 'everyone' }));
      await assertFails(put({ id: 'other' }));
    });
    test('members see the club’s forms; an outsider can open only an open link form, and never browse', async () => {
      await seed(`${base}/forms/f1`, form());
      await seed(`${base}/forms/f2`, form({ id: 'f2', audience: 'members' }));
      await seed(`${base}/forms/f3`, form({ id: 'f3', status: 'closed' }));
      await seed(`${base}/forms/f4`, form({ id: 'f4', status: 'draft' }));
      await assertSucceeds(getDocs(collection(db('carol'), `${base}/forms`)));
      await assertSucceeds(getDoc(doc(db('mallory'), `${base}/forms/f1`)));
      await assertFails(getDoc(doc(db('mallory'), `${base}/forms/f2`)));
      await assertFails(getDoc(doc(db('mallory'), `${base}/forms/f3`)));
      await assertFails(getDoc(doc(db('mallory'), `${base}/forms/f4`)));
      await assertFails(getDocs(collection(db('mallory'), `${base}/forms`)));
      await assertFails(getDoc(doc(db(null), `${base}/forms/f1`)));
    });
    test('an outsider with the link can answer an open link form as themselves', async () => {
      await seed(`${base}/forms/f1`, form());
      await assertSucceeds(send('mallory', base, answer('mallory')));
    });
    test('a member can answer a members-only form; an outsider cannot', async () => {
      await seed(`${base}/forms/f1`, form({ audience: 'members', collectEmail: false }));
      const plain = (uid, member) => { const a = answer(uid, { member }); delete a.email; return a; };
      await assertSucceeds(send('carol', base, plain('carol', true)));
      await assertFails(send('mallory', base, plain('mallory', false)));
    });
    test('an answer is refused without the sender’s own record of it', async () => {
      await seed(`${base}/forms/f1`, form());
      await assertFails(send('mallory', base, answer('mallory'), { record: false }));
      await assertFails(send('mallory', base, answer('mallory'), { key: 'orgs_CLUB01_other' }));
    });
    test('nobody can answer as someone else', async () => {
      await seed(`${base}/forms/f1`, form());
      await assertFails(send('mallory', base, answer('carol')));
      await assertFails(send('mallory', base, { ...answer('mallory'), uid: 'carol' }));
    });
    test('the email on an answer is the one the sender signed in with, and only when the form asks', async () => {
      await seed(`${base}/forms/f1`, form());
      await assertFails(send('mallory', base, answer('mallory', { email: 'alice@school.edu' })));
      const none = answer('mallory'); delete none.email;
      await assertFails(send('mallory', base, none));
      await seed(`${base}/forms/f1`, form({ collectEmail: false }));
      await assertFails(send('mallory', base, answer('mallory')));
      await assertSucceeds(send('mallory', base, none));
    });
    test('an outsider cannot pass as a member, and a member is marked as one', async () => {
      await seed(`${base}/forms/f1`, form());
      await assertFails(send('mallory', base, answer('mallory', { member: true })));
      await assertFails(send('carol', base, answer('carol', { member: false })));
      await assertSucceeds(send('carol', base, answer('carol', { member: true })));
    });
    test('an answer with extra fields, no name, or too many answers is refused', async () => {
      await seed(`${base}/forms/f1`, form());
      await assertFails(send('mallory', base, answer('mallory', { accepted: true })));
      await assertFails(send('mallory', base, answer('mallory', { name: '' })));
      await assertFails(send('mallory', base, answer('mallory', { name: 'x'.repeat(81) })));
      await assertFails(send('mallory', base, answer('mallory', { answers: Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`q${i}`, 'x'])) })));
    });
    test('a draft, a closed form, and a form past its closing time take no answers', async () => {
      await seed(`${base}/forms/f1`, form({ status: 'draft' }));
      await assertFails(send('carol', base, answer('carol', { member: true })));
      await seed(`${base}/forms/f1`, form({ status: 'closed' }));
      await assertFails(send('carol', base, answer('carol', { member: true })));
      await seed(`${base}/forms/f1`, form({ closesAt: Date.now() - 60000 }));
      await assertFails(send('carol', base, answer('carol', { member: true })));
      await seed(`${base}/forms/f1`, form({ closesAt: Date.now() + 3600000 }));
      await assertSucceeds(send('carol', base, answer('carol', { member: true })));
    });
    test('an answer can be changed while the form allows it, and not after', async () => {
      await seed(`${base}/forms/f1`, form());
      await seed(`${base}/forms/f1/responses/mallory`, answer('mallory'));
      const mine = doc(db('mallory'), `${base}/forms/f1/responses/mallory`);
      await assertSucceeds(setDoc(mine, answer('mallory', { answers: { q1: 'Chemistry' }, updatedAt: 9 })));
      await assertFails(setDoc(mine, answer('mallory', { at: 99 })));
      await seed(`${base}/forms/f1`, form({ allowEdit: false }));
      await assertFails(setDoc(mine, answer('mallory', { answers: { q1: 'Physics' }, updatedAt: 10 })));
      await seed(`${base}/forms/f1`, form({ status: 'closed' }));
      await assertFails(setDoc(mine, answer('mallory', { answers: { q1: 'Physics' }, updatedAt: 10 })));
    });
    test('officers read every answer; the sender reads their own; nobody else reads any', async () => {
      await seed(`${base}/forms/f1`, form());
      await seed(`${base}/forms/f1/responses/mallory`, answer('mallory'));
      await seed(`${base}/forms/f1/responses/dave`, answer('dave'));
      await assertSucceeds(getDocs(collection(db('bob'), `${base}/forms/f1/responses`)));
      await assertSucceeds(getDoc(doc(db('mallory'), `${base}/forms/f1/responses/mallory`)));
      await assertFails(getDoc(doc(db('mallory'), `${base}/forms/f1/responses/dave`)));
      await assertFails(getDoc(doc(db('carol'), `${base}/forms/f1/responses/mallory`)));
      await assertFails(getDocs(collection(db('carol'), `${base}/forms/f1/responses`)));
      await assertFails(getDocs(collection(db('mallory'), `${base}/forms/f1/responses`)));
      await assertFails(getDoc(doc(db(null), `${base}/forms/f1/responses/mallory`)));
    });
    test('the sender can take their answer back, an officer can remove one, a member cannot', async () => {
      await seed(`${base}/forms/f1`, form());
      await seed(`${base}/forms/f1/responses/mallory`, answer('mallory'));
      await seed(`${base}/forms/f1/responses/dave`, answer('dave'));
      await assertFails(deleteDoc(doc(db('carol'), `${base}/forms/f1/responses/mallory`)));
      await assertSucceeds(deleteDoc(doc(db('mallory'), `${base}/forms/f1/responses/mallory`)));
      await assertSucceeds(deleteDoc(doc(db('bob'), `${base}/forms/f1/responses/dave`)));
    });
    test('only officers delete a form', async () => {
      await seed(`${base}/forms/f1`, form());
      await assertFails(deleteDoc(doc(db('carol'), `${base}/forms/f1`)));
      await assertFails(deleteDoc(doc(db('mallory'), `${base}/forms/f1`)));
      await assertSucceeds(deleteDoc(doc(db('bob'), `${base}/forms/f1`)));
    });
  });

  describe('in a club: accepted, waitlisted, declined', () => {
    const base = 'orgs/CLUB01';
    const mark = (by, extra = {}) => ({ status: 'accepted', by, at: 9, ...extra });
    beforeEach(async () => { await seed(base, org()); await seed(`${base}/forms/f1`, form({ review: true })); await seed(`${base}/forms/f1/responses/mallory`, answer('mallory')); });

    test('an officer can mark an answer, change the mark and clear it', async () => {
      const ref = doc(db('bob'), `${base}/forms/f1/marks/mallory`);
      await assertSucceeds(setDoc(ref, mark('bob')));
      await assertSucceeds(setDoc(ref, mark('bob', { status: 'waitlisted' })));
      await assertSucceeds(getDocs(collection(db('alice'), `${base}/forms/f1/marks`)));
      await assertSucceeds(deleteDoc(ref));
    });
    test('the person an answer belongs to cannot read what was decided, and neither can a member', async () => {
      await seed(`${base}/forms/f1/marks/mallory`, mark('bob', { status: 'declined' }));
      await seed(`${base}/forms/f1/marks/carol`, mark('bob'));
      await assertFails(getDoc(doc(db('mallory'), `${base}/forms/f1/marks/mallory`)));
      await assertFails(getDoc(doc(db('carol'), `${base}/forms/f1/marks/carol`)));
      await assertFails(getDocs(collection(db('carol'), `${base}/forms/f1/marks`)));
      await assertFails(getDoc(doc(db(null), `${base}/forms/f1/marks/mallory`)));
    });
    test('nobody accepts themselves, and a member cannot mark anyone', async () => {
      await assertFails(setDoc(doc(db('mallory'), `${base}/forms/f1/marks/mallory`), mark('mallory')));
      await assertFails(setDoc(doc(db('carol'), `${base}/forms/f1/marks/mallory`), mark('carol')));
    });
    test('a mark is one of the three, signed by the officer who made it, and nothing more', async () => {
      const put = (data) => setDoc(doc(db('bob'), `${base}/forms/f1/marks/mallory`), data);
      await assertFails(put(mark('bob', { status: 'maybe' })));
      await assertFails(put(mark('alice')));
      await assertFails(put(mark('bob', { note: 'seemed nice' })));
      await assertFails(put({ status: 'accepted', by: 'bob' }));
    });
  });

  describe('in a club: an anonymous form', () => {
    const base = 'orgs/CLUB01';
    const anon = (extra = {}) => form({ anonymous: true, collectEmail: false, audience: 'members', ...extra });
    beforeEach(async () => { await seed(base, org()); });

    test('no answer to it can be filed under anybody’s uid', async () => {
      await seed(`${base}/forms/f1`, anon());
      const plain = answer('carol', { member: true }); delete plain.email;
      await assertFails(send('carol', base, plain));
      await seed(`${base}/forms/f1/responses/carol`, plain);
      await assertFails(setDoc(doc(db('carol'), `${base}/forms/f1/responses/carol`), { ...plain, updatedAt: 10 }));
    });
    test('officers read the answers, which carry no name; a member reads none', async () => {
      await seed(`${base}/forms/f1`, anon());
      await seed(`${base}/forms/f1/responses/a1b2c3`, { anon: true, answers: { q1: 'More snacks' }, at: 5 });
      await assertSucceeds(getDocs(collection(db('bob'), `${base}/forms/f1/responses`)));
      await assertFails(getDoc(doc(db('carol'), `${base}/forms/f1/responses/a1b2c3`)));
    });
    test('the sender’s record of an anonymous answer is the server’s to write: they can read it, not make, change or remove it', async () => {
      await seed('planners/carol/formAnswers/orgs_CLUB01_f1', { kind: 'club', code: 'CLUB01', formId: 'f1', anon: true, answerId: 'a1b2c3', at: 5 });
      const mine = doc(db('carol'), 'planners/carol/formAnswers/orgs_CLUB01_f1');
      await assertSucceeds(getDoc(mine));
      await assertFails(deleteDoc(mine));
      await assertFails(setDoc(mine, { kind: 'club', code: 'CLUB01', formId: 'f1', at: 6 }));
      await assertFails(updateDoc(mine, { answerId: 'other' }));
      await assertFails(setDoc(doc(db('carol'), 'planners/carol/formAnswers/orgs_CLUB01_f2'), { kind: 'club', code: 'CLUB01', formId: 'f2', anon: true, answerId: 'x', at: 6 }));
      await assertFails(getDoc(doc(db('bob'), 'planners/carol/formAnswers/orgs_CLUB01_f1')));
    });
    test('a record of a named answer is still the sender’s to keep or remove', async () => {
      await seed('planners/carol/formAnswers/orgs_CLUB01_f9', { kind: 'club', code: 'CLUB01', formId: 'f9', at: 5 });
      await assertSucceeds(updateDoc(doc(db('carol'), 'planners/carol/formAnswers/orgs_CLUB01_f9'), { at: 6 }));
      await assertSucceeds(deleteDoc(doc(db('carol'), 'planners/carol/formAnswers/orgs_CLUB01_f9')));
    });
    test('a form cannot turn anonymous, or stop being anonymous, once it has left draft', async () => {
      await seed(`${base}/forms/f1`, anon());
      await assertFails(updateDoc(doc(db('alice'), `${base}/forms/f1`), { anonymous: false }));
      await assertSucceeds(updateDoc(doc(db('alice'), `${base}/forms/f1`), { title: 'Suggestions' }));
      await seed(`${base}/forms/f2`, form({ id: 'f2', status: 'closed' }));
      await assertFails(updateDoc(doc(db('alice'), `${base}/forms/f2`), { anonymous: true }));
      await seed(`${base}/forms/f3`, form({ id: 'f3', status: 'draft' }));
      await assertSucceeds(updateDoc(doc(db('alice'), `${base}/forms/f3`), { anonymous: true, status: 'open' }));
    });
    test('anonymous and review are yes or no, nothing else', async () => {
      await assertFails(setDoc(doc(db('alice'), `${base}/forms/f1`), form({ anonymous: 'yes' })));
      await assertFails(setDoc(doc(db('alice'), `${base}/forms/f1`), form({ review: 1 })));
      await assertSucceeds(setDoc(doc(db('alice'), `${base}/forms/f1`), form({ anonymous: false, review: true })));
    });
  });

  describe('in a study group', () => {
    const base = 'studyGroups/GRP123';
    const gform = (extra = {}) => form({ spaceKind: 'group', spaceName: 'Bio study', audience: 'members', collectEmail: false, createdBy: 'bob', ...extra });
    const ganswer = (uid, extra = {}) => { const a = answer(uid, { member: true, ...extra }); delete a.email; return a; };
    beforeEach(async () => { await seed(base, group()); });

    test('any member can make a form, in their own name; an outsider cannot', async () => {
      await assertSucceeds(setDoc(doc(db('carol'), `${base}/forms/f1`), gform({ createdBy: 'carol' })));
      await assertFails(setDoc(doc(db('carol'), `${base}/forms/f2`), gform({ id: 'f2', createdBy: 'bob' })));
      await assertFails(setDoc(doc(db('mallory'), `${base}/forms/f3`), gform({ id: 'f3', createdBy: 'mallory' })));
    });
    test('whoever made it and the group’s owner run it; other members do not', async () => {
      await seed(`${base}/forms/f1`, gform());
      await assertFails(updateDoc(doc(db('carol'), `${base}/forms/f1`), { status: 'closed' }));
      await assertSucceeds(updateDoc(doc(db('bob'), `${base}/forms/f1`), { status: 'closed' }));
      await assertSucceeds(updateDoc(doc(db('alice'), `${base}/forms/f1`), { status: 'open' }));
      await assertFails(deleteDoc(doc(db('carol'), `${base}/forms/f1`)));
      await assertSucceeds(deleteDoc(doc(db('alice'), `${base}/forms/f1`)));
    });
    test('a member answers; an outsider cannot answer a members-only form', async () => {
      await seed(`${base}/forms/f1`, gform());
      await assertSucceeds(send('carol', base, ganswer('carol')));
      await assertFails(send('mallory', base, ganswer('mallory', { member: false })));
    });
    test('whoever runs the form marks answers; other members neither mark nor read marks', async () => {
      await seed(`${base}/forms/f1`, gform({ review: true }));
      await assertSucceeds(setDoc(doc(db('bob'), `${base}/forms/f1/marks/carol`), { status: 'accepted', by: 'bob', at: 1 }));
      await assertSucceeds(getDoc(doc(db('alice'), `${base}/forms/f1/marks/carol`)));
      await assertFails(getDoc(doc(db('carol'), `${base}/forms/f1/marks/carol`)));
      await assertFails(setDoc(doc(db('carol'), `${base}/forms/f1/marks/carol`), { status: 'accepted', by: 'carol', at: 1 }));
    });
    test('answers are read by whoever runs the form and by their sender, not by other members', async () => {
      await seed(`${base}/forms/f1`, gform());
      await seed(`${base}/forms/f1/responses/carol`, ganswer('carol'));
      await assertSucceeds(getDocs(collection(db('bob'), `${base}/forms/f1/responses`)));
      await assertSucceeds(getDocs(collection(db('alice'), `${base}/forms/f1/responses`)));
      await assertSucceeds(getDoc(doc(db('carol'), `${base}/forms/f1/responses/carol`)));
      await seed(`${base}/forms/f1/responses/bob`, ganswer('bob'));
      await assertFails(getDoc(doc(db('carol'), `${base}/forms/f1/responses/bob`)));
      await assertFails(getDocs(collection(db('carol'), `${base}/forms/f1/responses`)));
      await assertFails(getDocs(collection(db('mallory'), `${base}/forms/f1/responses`)));
    });
  });

  test('a person’s record of what they answered is theirs alone', async () => {
    await seed('planners/alice/formAnswers/orgs_CLUB01_f1', { code: 'CLUB01' });
    await assertSucceeds(getDocs(collection(db('alice'), 'planners/alice/formAnswers')));
    await assertFails(getDocs(collection(db('mallory'), 'planners/alice/formAnswers')));
    await assertFails(setDoc(doc(db('mallory'), 'planners/alice/formAnswers/x'), { code: 'X' }));
  });
});

/* ── Nyla's Business OS document ────────────────────────────────── */
describe('semesterhq_biz', () => {
  const owner = { email: 'semesterhq@gmail.com', email_verified: true };
  test('her own verified account can read and write its document', async () => {
    await assertSucceeds(setDoc(doc(db('nyla', owner), 'semesterhq_biz/nyla'), { data: 1 }));
    await assertSucceeds(getDoc(doc(db('nyla', owner), 'semesterhq_biz/nyla')));
  });
  test('the same email, unverified, is refused', async () => {
    await assertFails(getDoc(doc(db('nyla', { ...owner, email_verified: false }), 'semesterhq_biz/nyla')));
  });
  test('any other account is refused, even for a document under its own id', async () => {
    await assertFails(setDoc(doc(db('mallory'), 'semesterhq_biz/mallory'), { data: 1 }));
  });
  test('her account cannot reach another id’s document', async () => {
    await seed('semesterhq_biz/other', { data: 1 });
    await assertFails(getDoc(doc(db('nyla', owner), 'semesterhq_biz/other')));
  });
});

/* ── Shared notes: edited together, live ─────────────────────────
   alice owns the note; bob joined with its link; carol is in the study
   group it is shared with; dan is in the club it is shared with; mallory
   is nobody to it. */
describe('sharedNotes', () => {
  const KEY = 'k'.repeat(24);
  const note = (over = {}) => ({ title: 'Bio', content: '<p>hi</p>', ownerUid: 'alice', editorUids: ['alice', 'bob'], people: { alice: { name: 'Alice' }, bob: { name: 'Bob' } }, groupCode: 'GRP001', orgCode: 'ORG001', joinKey: KEY, createdAt: 1, updatedAt: 1, updatedBy: 'alice', rev: 1, ...over });
  const seedAll = async (over) => {
    await seed('studyGroups/GRP001', { createdBy: 'carol', memberUids: ['carol', 'alice'] });
    await seed('orgs/ORG001', { createdBy: 'dan', memberUids: ['dan', 'alice'], officerUids: ['dan'] });
    await seed('sharedNotes/n1', note(over));
  };
  const ref = (uid, path = 'sharedNotes/n1') => doc(db(uid), path);

  test('the owner, a link editor, a group member and a club member can all open it', async () => {
    await seedAll();
    for (const who of ['alice', 'bob', 'carol', 'dan']) await assertSucceeds(getDoc(ref(who)));
  });
  test('mallory and the signed-out cannot open it', async () => {
    await seedAll();
    await assertFails(getDoc(ref('mallory')));
    await assertFails(getDoc(ref(null)));
  });
  test('leaving the study group takes the note away', async () => {
    await seedAll();
    await seed('studyGroups/GRP001', { createdBy: 'alice', memberUids: ['alice'] });
    await assertFails(getDoc(ref('carol')));
  });
  test('listing: my notes, my group’s notes and my club’s notes; never everyone’s', async () => {
    await seedAll();
    const col = (uid) => collection(db(uid), 'sharedNotes');
    await assertSucceeds(getDocs(query(col('bob'), where('editorUids', 'array-contains', 'bob'))));
    await assertSucceeds(getDocs(query(col('carol'), where('groupCode', '==', 'GRP001'))));
    await assertSucceeds(getDocs(query(col('dan'), where('orgCode', '==', 'ORG001'))));
    await assertFails(getDocs(query(col('mallory'), where('groupCode', '==', 'GRP001'))));
    await assertFails(getDocs(col('mallory')));
  });
  test('anyone who can edit can change the writing and the title', async () => {
    await seedAll();
    for (const who of ['bob', 'carol', 'dan']) await assertSucceeds(updateDoc(ref(who), { content: `<p>${who}</p>`, title: who, updatedAt: 2, updatedBy: who, rev: 2 }));
  });
  test('mallory cannot change the writing', async () => {
    await seedAll();
    await assertFails(updateDoc(ref('mallory'), { content: '<p>x</p>' }));
  });
  test('an editor cannot change who it is shared with, the link or the owner', async () => {
    await seedAll();
    await assertFails(updateDoc(ref('bob'), { groupCode: '' }));
    await assertFails(updateDoc(ref('bob'), { joinKey: 'z'.repeat(24) }));
    await assertFails(updateDoc(ref('carol'), { ownerUid: 'carol' }));
    await assertFails(updateDoc(ref('carol'), { editorUids: ['alice', 'bob', 'carol'] }));
  });
  test('an editor changes only their own name', async () => {
    await seedAll();
    await assertSucceeds(updateDoc(ref('bob'), { 'people.bob': { name: 'Bobby' } }));
    await assertFails(updateDoc(ref('bob'), { 'people.alice': { name: 'Al' } }));
  });
  test('a link editor can take themselves off; the owner cannot leave that way', async () => {
    await seedAll();
    await assertSucceeds(updateDoc(ref('bob'), { editorUids: ['alice'] }));
    await assertFails(updateDoc(ref('alice'), { editorUids: ['bob'] }));
  });
  test('the owner can take people off, change sharing and the link, and delete it', async () => {
    await seedAll();
    await assertSucceeds(updateDoc(ref('alice'), { editorUids: ['alice'], 'people.bob': deleteField(), groupCode: '', orgCode: '', joinKey: '' }));
    await assertSucceeds(deleteDoc(ref('alice')));
  });
  test('the owner cannot put someone on, or share with a group they are not in', async () => {
    await seedAll();
    await assertFails(updateDoc(ref('alice'), { editorUids: ['alice', 'bob', 'mallory'] }));
    await seed('studyGroups/OTHER1', { createdBy: 'mallory', memberUids: ['mallory'] });
    await assertFails(updateDoc(ref('alice'), { groupCode: 'OTHER1' }));
  });
  test('only the owner deletes it', async () => {
    await seedAll();
    await assertFails(deleteDoc(ref('bob')));
    await assertFails(deleteDoc(ref('carol')));
  });
  test('creating: only as the owner, alone on it, shared only with your own group', async () => {
    await seedAll();
    const fresh = { title: '', content: '', ownerUid: 'alice', editorUids: ['alice'], people: { alice: { name: 'Alice' } }, groupCode: 'GRP001', orgCode: '', joinKey: KEY, createdAt: 1, updatedAt: 1, updatedBy: 'alice', rev: 0 };
    await assertSucceeds(setDoc(ref('alice', 'sharedNotes/note2abcdefgh'), fresh));
    await assertFails(setDoc(ref('mallory', 'sharedNotes/note3abcdefgh'), { ...fresh, ownerUid: 'mallory', editorUids: ['mallory'], people: {} }));
    await assertFails(setDoc(ref('alice', 'sharedNotes/note4abcdefgh'), { ...fresh, editorUids: ['alice', 'bob'] }));
    await assertFails(setDoc(ref('alice', 'sharedNotes/note5abcdefgh'), { ...fresh, ownerUid: 'bob' }));
    await assertFails(setDoc(ref('alice', 'sharedNotes/note6abcdefgh'), { ...fresh, extra: true }));
    // The id lands in the app's markup, so only letters and digits.
    await assertFails(setDoc(ref('alice', "sharedNotes/abcdefghij');alert(1);x"), fresh));
  });
  test('a note over the size cap is refused', async () => {
    await seedAll();
    await assertFails(updateDoc(ref('bob'), { content: 'x'.repeat(900001) }));
  });
  test('joining with the link: the right key adds only yourself', async () => {
    await seedAll();
    const fs = db('mallory');
    const b = writeBatch(fs);
    b.set(doc(fs, 'sharedNotes/n1/joins/mallory'), { key: KEY, at: 1 });
    b.update(doc(fs, 'sharedNotes/n1'), { editorUids: arrayUnion('mallory'), 'people.mallory': { name: 'M' } });
    await assertSucceeds(b.commit());
    await assertSucceeds(getDoc(ref('mallory')));
  });
  test('joining with a wrong key, or once the link is off, fails', async () => {
    await seedAll();
    const tryJoin = (key) => { const fs = db('mallory'); const b = writeBatch(fs); b.set(doc(fs, 'sharedNotes/n1/joins/mallory'), { key, at: 1 }); b.update(doc(fs, 'sharedNotes/n1'), { editorUids: arrayUnion('mallory') }); return b.commit(); };
    await assertFails(tryJoin('w'.repeat(24)));
    await seed('sharedNotes/n1', note({ joinKey: '' }));
    await assertFails(tryJoin(''));
    await assertFails(tryJoin(KEY));
  });
  test('joining cannot bring anyone else along or touch the writing', async () => {
    await seedAll();
    const fs = db('mallory');
    const b = writeBatch(fs);
    b.set(doc(fs, 'sharedNotes/n1/joins/mallory'), { key: KEY, at: 1 });
    b.update(doc(fs, 'sharedNotes/n1'), { editorUids: arrayUnion('mallory', 'eve'), content: '<p>x</p>' });
    await assertFails(b.commit());
  });
  test('presence: editors see who is here and write only their own', async () => {
    await seedAll();
    await assertSucceeds(setDoc(ref('carol', 'sharedNotes/n1/presence/carol'), { name: 'Carol', at: 5, caret: 10, color: '#e07a9b' }));
    await assertSucceeds(getDocs(collection(db('bob'), 'sharedNotes/n1/presence')));
    await assertFails(setDoc(ref('carol', 'sharedNotes/n1/presence/bob'), { name: 'Bob', at: 5, caret: 1 }));
    await assertFails(getDocs(collection(db('mallory'), 'sharedNotes/n1/presence')));
    await assertFails(setDoc(ref('mallory', 'sharedNotes/n1/presence/mallory'), { name: 'M', at: 5, caret: 1 }));
  });
});
