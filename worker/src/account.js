/* ── worker/src/account.js ──────────────────────────────────────
   Deleting an account (/delete-account), including leaving every shared
   space cleanly, and recording terms acceptance (/account/attest).
──────────────────────────────────────────────────────────────── */

import { logServerIssue } from './diagnostics.js';
import { commitFirestore, deleteFirebaseAuthUser, deleteFirestoreDoc, deleteFirestoreSubcollection, deleteStorageFolder, encodeEmailDocId, patchFirestoreDoc, readFirestoreDoc, readFirestoreDocWithTime, runFirestoreQuery, verifyFirebaseIdToken } from './firebase.js';
import { groupAdmins, groupHasAccess, groupPlansAdminedBy, removeGroupMember, setGroupAdmins } from './groups.js';
import { clearBlockedEverywhere, writeSpacePreview } from './spaces.js';
import { jsonError, jsonOk, verifiedEmailOf } from './http.js';

/* ── Leaving every shared space when an account is deleted ────────
   Deleting an account used to remove the person's own data and their
   group-plan seat, and leave them sitting in every study group and club
   they had joined: still in the member list, still in the availability
   grid, still counted, with a name nobody could remove because the
   account behind it no longer existed.

   Two things make this more than a filter on an array:

   1. Ownership. A study group's owner is the only one who can remove
      anyone or delete it, and firestore.rules requires a club's
      createdBy to be in both memberUids and officerUids for any officer
      edit to pass. Removing an owner without handing the role on would
      leave the group intact and unmanageable by anybody. So the role
      moves to the longest-standing member who is left (an officer first,
      in a club), and a space with nobody left is deleted outright.

   2. Concurrency. These documents are shared, and someone else may be
      editing one while this runs, so each change is a read-modify-write
      guarded by the document's updateTime and retried on a clash.

   Chat messages are left where they are. They carry the author's name on
   the message itself, so that gets replaced rather than the conversation
   being torn out from under everyone else who was in it.
──────────────────────────────────────────────────────────────── */
const DELETED_PERSON_NAME = 'Deleted account';
const SHARED_SPACE_SCAN_LIMIT = 100;
// Used inside Firestore field paths (`people.<uid>`), where a stray dot or
// backtick would change which field is addressed.
function safeFieldKey(k) { return typeof k === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(k); }

async function removeMemberFromSharedSpace(env, path, uid, kind) {
  if (!safeFieldKey(uid)) throw new Error('Unsafe uid for a field path');
  const [collection, docId] = path.split('/');
  const subcollections = kind === 'org' ? ['messages'] : ['items', 'messages'];
  for (let attempt = 0; attempt < 5; attempt++) {
    const snap = await readFirestoreDocWithTime(env, path);
    if (!snap) return;
    const d = snap.data;
    const members = (d.memberUids || []).filter(u => u !== uid);

    // Last one out. Nothing to hand over, and an empty group is only clutter.
    if (!members.length) {
      for (const sub of subcollections) await deleteFirestoreSubcollection(env, path, sub);
      await deleteSpaceForms(env, path);
      await deleteFirestoreSubcollection(env, path, 'public');
      await deleteFirestoreDoc(env, collection, docId);
      return;
    }

    const fields = { memberUids: members, updatedAt: Date.now() };
    const clear = [`people.${uid}`];
    if (kind === 'group') {
      clear.push(`avail.${uid}`);
      // The same cleanup the app does when someone leaves (groupDepartureOps
      // in js/groups/tasks.js): their RSVPs and the tasks they had taken.
      for (const [sid, sess] of Object.entries(d.sessions || {})) {
        if (safeFieldKey(sid) && sess?.rsvp && Object.prototype.hasOwnProperty.call(sess.rsvp, uid)) clear.push(`sessions.${sid}.rsvp.${uid}`);
      }
      for (const [tid, t] of Object.entries(d.taskItems || {})) {
        if (!safeFieldKey(tid) || !t) continue;
        if (t.assignee === uid) clear.push(`taskItems.${tid}.assignee`, `taskItems.${tid}.assigneeName`);
        if (t.doneBy === uid) fields[`taskItems.${tid}.doneByName`] = DELETED_PERSON_NAME;
      }
    }
    if (kind === 'org') {
      fields.officerUids = (d.officerUids || []).filter(u => u !== uid);
      clear.push(`rsvp.${uid}`, `titles.${uid}`);
    }

    if (d.createdBy === uid) {
      const joined = (u) => Number(d.people?.[u]?.joinedAt) || 0;
      const officers = kind === 'org' ? members.filter(u => (d.officerUids || []).includes(u)) : [];
      const heir = [...(officers.length ? officers : members)].sort((a, b) => joined(a) - joined(b))[0];
      fields.createdBy = heir;
      if (kind === 'org' && !fields.officerUids.includes(heir)) fields.officerUids = [...fields.officerUids, heir];
      // A study group shows its owner from people[uid].role, so the badge has
      // to move with the role or the group looks like it still has no owner.
      if (kind === 'group' && safeFieldKey(heir) && d.people?.[heir]) fields[`people.${heir}.role`] = 'owner';
    }

    // The group's own preview of the last message carries a name too.
    if (d.lastMessage?.uid === uid) fields['lastMessage.name'] = DELETED_PERSON_NAME;

    if (await commitFirestore(env, [{ path, fields, clear, updateTime: snap.updateTime }])) {
      await anonymizeMessagesBy(env, path, uid);
      await anonymizeFormsBy(env, path, uid);
      // The public preview's member count has to stay the real one.
      try { await writeSpacePreview(env, kind === 'org' ? 'club' : 'group', docId, { ...d, ...fields, memberUids: members }); }
      catch (e) { await logServerIssue(env, 'account', 'Account delete could not refresh a join preview', e); }
      return;
    }
  }
  throw new Error(`Could not update ${path} after 5 attempts`);
}

// Their messages stay so the conversation still reads, but their name comes
// off them. Capped: a long-running group's history is not worth an unbounded
// number of writes inside a request the person is waiting on.
async function anonymizeMessagesBy(env, path, uid) {
  const msgs = await runFirestoreQuery(env, {
    from: [{ collectionId: 'messages' }],
    where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: uid } } },
    limit: 300,
  }, `${path}`);
  const named = msgs.filter(m => m.name && m.name !== DELETED_PERSON_NAME);
  for (let i = 0; i < named.length; i += 20) {
    await commitFirestore(env, named.slice(i, i + 20).map(m => ({ path: `${path}/messages/${m.id}`, fields: { name: DELETED_PERSON_NAME } })));
  }
}

/* ── Forms (js/spaces/formcore.js) ─────────────────────────────────
   A form belongs to the club or group, so the ones this person wrote
   stay, with their name taken off. Their ANSWERS are theirs and go.

   Answers can sit in spaces they never joined (an interest form, an
   application), so membership can't find them. Every answer is written
   together with an entry in the sender's own planners/{uid}/formAnswers
   (firestore.rules refuses the answer otherwise), and that list is what
   this reads. */
const FORM_ANSWER_SCAN_LIMIT = 500;
const FORM_SPACES = { club: 'orgs', group: 'studyGroups' };

async function anonymizeFormsBy(env, path, uid) {
  const forms = await runFirestoreQuery(env, {
    from: [{ collectionId: 'forms' }],
    where: { fieldFilter: { field: { fieldPath: 'createdBy' }, op: 'EQUAL', value: { stringValue: uid } } },
    limit: 100,
  }, path);
  const named = forms.filter(f => safeFieldKey(f.id) && f.createdByName !== DELETED_PERSON_NAME);
  for (let i = 0; i < named.length; i += 20) {
    await commitFirestore(env, named.slice(i, i + 20).map(f => ({ path: `${path}/forms/${f.id}`, fields: { createdByName: DELETED_PERSON_NAME } })));
  }
}
// A space being deleted takes its forms and every answer to them with it.
async function deleteSpaceForms(env, path) {
  const forms = await runFirestoreQuery(env, { from: [{ collectionId: 'forms' }], limit: 100 }, path);
  for (const f of forms) {
    if (!safeFieldKey(f.id)) continue;
    await deleteFirestoreSubcollection(env, `${path}/forms/${f.id}`, 'responses');
    await deleteFirestoreSubcollection(env, `${path}/forms/${f.id}`, 'marks');
  }
  await deleteFirestoreSubcollection(env, path, 'forms');
  // Files sent as answers. Logged, not thrown: the space is still deleted
  // if Storage is having a bad day.
  try { await deleteStorageFolder(env, `${path}/forms/`); }
  catch (e) { await logServerIssue(env, 'account', 'Account delete could not remove form files', e); }
}
// Returns what could not be erased, in the same words leaveSharedSpaces uses.
async function eraseFormAnswers(env, uid) {
  if (!safeFieldKey(uid)) throw new Error('Unsafe uid for a path');
  const failed = [];
  let answered = [];
  try { answered = await runFirestoreQuery(env, { from: [{ collectionId: 'formAnswers' }], limit: FORM_ANSWER_SCAN_LIMIT }, `planners/${uid}`); }
  catch (e) { failed.push('list form answers'); await logServerIssue(env, 'account', 'Account delete could not list form answers', e); }
  for (const a of answered) {
    const collection = FORM_SPACES[a.kind];
    // The list is the person's own document, so nothing in it is trusted
    // to name a path: each part has to be a plain id.
    if (!collection || !safeFieldKey(a.code) || !safeFieldKey(a.formId)) continue;
    const form = `${collection}/${a.code}/forms/${a.formId}`;
    try {
      if (a.anon === true) {
        // An anonymous answer is filed under a random id, which only this
        // entry knows (worker/src/forms.js).
        if (safeFieldKey(a.answerId)) await deleteFirestoreDoc(env, `${form}/responses`, a.answerId);
      } else {
        await deleteFirestoreDoc(env, `${form}/responses`, uid);
        // What was decided about their answer goes with it, and so do the
        // files they sent as answers.
        await deleteFirestoreDoc(env, `${form}/marks`, uid);
        await deleteStorageFolder(env, `${form}/${uid}/`);
      }
    } catch (e) { failed.push(`erase a form answer in ${collection}/${a.code}`); await logServerIssue(env, 'account', 'Account delete could not erase a form answer', e); }
  }
  try { await deleteFirestoreSubcollection(env, `planners/${uid}`, 'formAnswers'); }
  catch (e) { failed.push('clear the form answer list'); await logServerIssue(env, 'account', 'Account delete could not clear the form answer list', e); }
  return failed;
}

async function leaveSharedSpaces(env, uid, planner) {
  const failed = [];
  const step = async (what, fn) => {
    try { await fn(); }
    catch (e) { failed.push(what); await logServerIssue(env, 'account', `Account delete could not ${what}`, e); }
  };
  const membersOf = (collectionId) => runFirestoreQuery(env, {
    from: [{ collectionId }],
    where: { fieldFilter: { field: { fieldPath: 'memberUids' }, op: 'ARRAY_CONTAINS', value: { stringValue: uid } } },
    limit: SHARED_SPACE_SCAN_LIMIT,
  });

  let groups = [], orgs = [];
  await step('list study groups', async () => { groups = await membersOf('studyGroups'); });
  for (const g of groups) await step(`leave study group ${g.id}`, () => removeMemberFromSharedSpace(env, `studyGroups/${g.id}`, uid, 'group'));

  await step('list clubs', async () => { orgs = await membersOf('orgs'); });
  for (const o of orgs) await step(`leave club ${o.id}`, () => removeMemberFromSharedSpace(env, `orgs/${o.id}`, uid, 'org'));

  // Off every blocked list too: a blocked list keeps a name.
  await step('come off blocked lists', () => clearBlockedEverywhere(env, uid));

  // Shared classes have no member array to query, just a document per member,
  // so the codes come from the planner being deleted. Read it before it goes.
  const codes = [...new Set((planner?.courses || []).map(c => c?.sharedClass?.code).filter(safeFieldKey))];
  for (const code of codes) await step(`leave class ${code}`, () => deleteFirestoreDoc(env, `classes/${code}/members`, uid));

  return failed;
}

// Self-serve "delete my account": cancels any active Stripe subscription,
// erases every server-side record we hold for this uid/email (licenses,
// the email-keyed linking doc, and the synced planner doc), and deletes the
// Firebase Auth user itself. Requires the service account's OAuth token to
// carry the Identity Toolkit scope (see getFirebaseAccessToken) and the
// underlying GCP service account to have the "Firebase Authentication Admin"
// role. Without that role the Auth-user deletion step fails and is reported
// back to the client rather than silently ignored, since the rest of the
// erasure still succeeded and shouldn't be treated as a full failure the
// user needs to retry.
export async function handleDeleteAccount(request, env, origin) {
  if (!env.FIREBASE_PROJECT_ID) return jsonError('Server misconfigured: FIREBASE_PROJECT_ID not set.', 500, env, origin);
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env, origin); }
  if (!body.idToken) return jsonError('Missing idToken', 400, env, origin);

  let payload;
  try { payload = await verifyFirebaseIdToken(body.idToken, env.FIREBASE_PROJECT_ID); }
  catch { return jsonError('Your session expired, sign in again.', 401, env, origin); }

  const uid = payload.sub;
  const email = verifiedEmailOf(payload);

  try {
    const license = await readFirestoreDoc(env, 'licenses', uid);
    // A group plan still being billed needs someone to run it, so its only
    // admin can't disappear. Otherwise the person just steps off every plan.
    const adminPlans = await groupPlansAdminedBy(env, uid);
    const orphaned = adminPlans.find(p => groupHasAccess(p.status) && (p.adminUids || []).length <= 1);
    if (orphaned) return jsonError(`You’re the only admin of ${orphaned.name}’s group plan. Make someone else an admin or cancel the plan first (app.semester-hq.com/group-admin.html), then delete your account.`, 409, env, origin);
    for (const plan of adminPlans) await setGroupAdmins(env, plan, groupAdmins(plan).filter(a => a.uid !== uid));
    if (license?.groupPlanId) await removeGroupMember(env, license.groupPlanId, uid);

    // Study groups, clubs and shared classes, before the planner doc is
    // deleted below: it's the only record of which shared classes they
    // joined. A failure here is logged and doesn't stop the deletion — being
    // left in a group is bad, but refusing to delete an account someone asked
    // to delete is worse, and the alternative is stopping halfway.
    const planner = await readFirestoreDoc(env, 'planners', uid).catch(() => null);
    const leftBehind = await leaveSharedSpaces(env, uid, planner);
    // Answers to forms, wherever they were sent. After leaving the spaces,
    // so a space that was deleted on the way out has already taken its own.
    leftBehind.push(...await eraseFormAnswers(env, uid));
    // Same fallback as handleCreatePortalSession: an account whose license was
    // claimed via email (bought before signing up) may be missing this field on
    // the uid-keyed doc even from before that path was fixed to copy it over.
    // Without this, deleting the account leaves the Stripe subscription running
    // and the person gets billed forever after being told their account is gone.
    let stripeSubscriptionId = license?.stripeSubscriptionId;
    if (!stripeSubscriptionId && email) {
      try {
        const byEmail = await readFirestoreDoc(env, 'licensesByEmail', encodeEmailDocId(email));
        if (byEmail?.paid) stripeSubscriptionId = byEmail.stripeSubscriptionId;
      } catch (e) { await logServerIssue(env, 'license', 'licensesByEmail fallback lookup failed', e); }
    }

    if (stripeSubscriptionId && env.STRIPE_SECRET_KEY) {
      const res = await fetch(`https://api.stripe.com/v1/subscriptions/${stripeSubscriptionId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
      });
      // Already-canceled subscriptions 404/410 here, not an error for our purposes.
      if (!res.ok && res.status !== 404) {
        const data = await res.json().catch(() => ({}));
        return jsonError('Could not cancel your subscription: ' + (data.error?.message || 'unknown error') + '. Your account was not deleted, try again or email hello@semester-hq.com.', 500, env, origin);
      }
    }

    await deleteFirestoreDoc(env, 'licenses', uid);
    if (email) await deleteFirestoreDoc(env, 'licensesByEmail', encodeEmailDocId(email));
    // Notes live in their own subcollection (planners/{uid}/notes/{id}), not
    // inline in the planner doc. Deleting the parent doc below does NOT
    // cascade-delete those, Firestore never does that automatically. Delete
    // them explicitly first or "delete my account" leaves every note behind.
    await deleteFirestoreSubcollection(env, `planners/${uid}`, 'notes');
    await deleteFirestoreDoc(env, 'planners', uid);
    await deleteFirestoreDoc(env, 'push', uid).catch(() => {});
    // Firebase Storage: the syllabus originals and attachments under
    // users/{uid}/. Deleting the Firestore documents never touched these, and
    // a syllabus carries a professor's contact details, so they go too.
    // Logged rather than blocking: the account is still deleted if Storage
    // is having a bad day, and the leftover prefix is easy to find by uid.
    let filesDeleted = 0;
    try { filesDeleted = await deleteStorageFolder(env, `users/${uid}/`); }
    catch (e) { await logServerIssue(env, 'account', 'Account delete could not remove stored files', e, { uid }); }

    let authDeleted = true;
    try { await deleteFirebaseAuthUser(env, uid); }
    catch (e) { authDeleted = false; await logServerIssue(env, 'account', 'Auth user delete failed', e); }

    return jsonOk({ ok: true, authDeleted, leftBehind: leftBehind.length, filesDeleted }, env, origin);
  } catch (e) {
    await logServerIssue(env, 'account', 'Account deletion failed', e);
    return jsonError('Could not delete your account right now. Try again in a moment, or email hello@semester-hq.com.', 500, env, origin);
  }
}
// The age and terms checkbox lives in the browser. This records, on the
// account, that it was ticked and which terms were current, so the fact
// survives a cleared browser. It writes only to the license document the
// Worker already owns; nothing here grants access.
const TERMS_VERSION = '2026-09-19';
export async function handleAccountAttest(request, env, origin) {
  if (!env.FIREBASE_PROJECT_ID) return jsonError('Server misconfigured: FIREBASE_PROJECT_ID not set.', 500, env, origin);
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env, origin); }
  if (!body.idToken) return jsonError('Missing idToken', 400, env, origin);
  let payload;
  try { payload = await verifyFirebaseIdToken(body.idToken, env.FIREBASE_PROJECT_ID); }
  catch { return jsonError('Your session expired, sign in again.', 401, env, origin); }
  if (body.ageConfirmed !== true) return jsonError('Confirm your age and the terms first.', 400, env, origin);
  try {
    const existing = await readFirestoreDoc(env, 'licenses', payload.sub);
    if (!existing?.termsAcceptedAt || existing.termsVersion !== TERMS_VERSION) {
      await patchFirestoreDoc(env, `licenses/${payload.sub}`, { termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION, ageConfirmed: true });
    }
    return jsonOk({ ok: true, termsVersion: TERMS_VERSION }, env, origin);
  } catch (e) {
    await logServerIssue(env, 'account', 'Could not record the terms acceptance', e);
    return jsonError('Could not save that right now.', 500, env, origin);
  }
}
