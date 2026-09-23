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
import { arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, addDoc } from 'firebase/firestore';
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
  for (const path of ['licensesByEmail/alice@school.edu', 'feedback/f1', 'errors/e1', 'events/v1', 'groupPlans/p1', 'groupPlans/p1/members/alice', 'groupInvites/ABCDEFGH']) {
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
  test('anyone signed in with the code can look a group up; nobody can browse them', async () => {
    await seed('studyGroups/GRP123', group());
    await assertSucceeds(getDoc(doc(db('mallory'), 'studyGroups/GRP123')));
    await assertFails(getDoc(doc(db(null), 'studyGroups/GRP123')));
    await assertFails(getDocs(collection(db('alice'), 'studyGroups')));
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
  test('clubs can be looked up by code, never browsed', async () => {
    await seed('orgs/CLUB01', org());
    await assertSucceeds(getDoc(ref('mallory')));
    await assertFails(getDocs(collection(db('alice'), 'orgs')));
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
