/* ── worker/src/forms.js ────────────────────────────────────────
   Job 13: anonymous answers to a form (/form/answer).

   A club or study group can mark a form anonymous (a suggestion box, a
   vote). The people running it must never be able to tell who sent
   which answer, and one person must still only get one answer. Both at
   once is why this goes through the Worker instead of the app writing
   to Firestore itself:

   - The answer is filed under a random id, with no uid, name or email,
     and the day it was sent rather than the moment.
   - The link between the person and that id is kept in the person's own
     planners/{uid}/formAnswers entry, which firestore.rules lets only
     that person read and only this Worker write. It is what stops a
     second answer, what lets them replace or remove theirs, and what
     "delete my account" follows to erase it (account.js).
   - firestore.rules refuses any answer to an anonymous form written by
     a browser, so there is no other way in.

   The checks on the answers themselves repeat js/spaces/formcore.js
   (formCleanAnswer). tests/worker-forms.mjs runs both on the same
   answers and fails if they ever disagree.
──────────────────────────────────────────────────────────────── */

import { batchGetFirestoreDocs, commitFirestore, verifyFirebaseIdToken } from './firebase.js';
import { jsonError, jsonOk } from './http.js';

const WF_ID = /^[A-Za-z0-9_-]{1,64}$/;
const WF_CODE = /^[A-Z0-9]{6}$/;
const WF_DATE = /^\d{4}-\d{2}-\d{2}$/;
const WF_COLLECTIONS = { club: 'orgs', group: 'studyGroups' };
const WF_SHORT_MAX = 300;
const WF_LONG_MAX = 2000;
const WF_QUESTIONS_MAX = 40;

function wfLine(v, max) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''; }
function wfText(v, max) { return typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : ''; }
function wfEmpty(v) { return v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) ? !v.length : typeof v === 'object'); }
function wfOptions(q) {
  const seen = new Set();
  return (Array.isArray(q.options) ? q.options : []).map(o => wfLine(o, 80)).filter(o => o && !seen.has(o.toLowerCase()) && seen.add(o.toLowerCase())).slice(0, 20);
}
// One answer against its question; undefined when there is nothing usable.
// A file is never usable here: an anonymous form takes none.
export function wfCleanAnswer(q, v) {
  if (wfEmpty(v)) return undefined;
  const options = wfOptions(q);
  switch (q.type) {
    case 'short': return wfLine(String(v), WF_SHORT_MAX) || undefined;
    case 'long': return wfText(String(v), WF_LONG_MAX) || undefined;
    case 'choice':
    case 'dropdown': return typeof v === 'string' && options.includes(v) ? v : undefined;
    case 'checks': { const list = [...new Set((Array.isArray(v) ? v : [v]).filter(x => typeof x === 'string' && options.includes(x)))]; return list.length ? list : undefined; }
    case 'scale': { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 5 ? n : undefined; }
    case 'date': return typeof v === 'string' && WF_DATE.test(v) && !isNaN(new Date(v + 'T00:00:00')) ? v : undefined;
    default: return undefined;
  }
}
export function wfQuestions(form) {
  const ids = new Set();
  return (Array.isArray(form?.questions) ? form.questions : [])
    .filter(q => q && typeof q === 'object' && WF_ID.test(q.id || '') && !ids.has(q.id) && ids.add(q.id)).slice(0, WF_QUESTIONS_MAX);
}
export function wfCheckAnswers(form, raw) {
  const answers = {}, errors = {};
  for (const q of wfQuestions(form)) {
    const given = raw && typeof raw === 'object' ? raw[q.id] : undefined;
    const v = wfCleanAnswer(q, given);
    if (v !== undefined) answers[q.id] = v;
    else if (!wfEmpty(given) || (given && typeof given === 'object' && !Array.isArray(given))) errors[q.id] = 'That answer didn’t fit. Try again.';
    else if (q.required === true) errors[q.id] = 'This one needs an answer.';
  }
  return { ok: !Object.keys(errors).length, answers, errors };
}
export function wfIsOpen(form, now = Date.now()) {
  return !!form && form.status === 'open' && (!(Number(form.closesAt) > 0) || now < Number(form.closesAt));
}
// The start of the day, UTC. An anonymous answer keeps the day it was
// sent, not the moment, so it can't be matched to who was online when.
export function wfDay(now = Date.now()) { return Math.floor(now / 86400000) * 86400000; }

export async function handleFormAnswer(request, env, origin) {
  if (!env.FIREBASE_PROJECT_ID) return jsonError('Server misconfigured: FIREBASE_PROJECT_ID not set.', 500, env, origin);
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env, origin); }
  if (!body || typeof body !== 'object' || !body.idToken) return jsonError('Missing idToken', 400, env, origin);
  const collection = WF_COLLECTIONS[body.kind];
  if (!collection || !WF_CODE.test(body.code || '') || !WF_ID.test(body.formId || '')) return jsonError('That form link doesn’t look right.', 400, env, origin);

  let payload;
  try { payload = await verifyFirebaseIdToken(body.idToken, env.FIREBASE_PROJECT_ID); }
  catch { return jsonError('Your session expired, sign in again.', 401, env, origin); }
  const uid = payload.sub;
  if (!WF_ID.test(uid || '')) return jsonError('Your session expired, sign in again.', 401, env, origin);

  const spacePath = `${collection}/${body.code}`;
  const formPath = `${spacePath}/forms/${body.formId}`;
  const indexPath = `planners/${uid}/formAnswers/${collection}_${body.code}_${body.formId}`;
  const docs = await batchGetFirestoreDocs(env, [spacePath, formPath, indexPath]);
  const space = docs[spacePath], form = docs[formPath], index = docs[indexPath];
  // One reply for "no such form" and "not an anonymous form", so this
  // route can't be used to find out which forms exist.
  if (!space || !form || form.anonymous !== true) return jsonError('This form isn’t taking answers.', 404, env, origin);

  const mine = index && index.anon === true && WF_ID.test(index.answerId || '') ? index.answerId : '';

  if (body.remove === true) {
    if (!mine) return jsonOk({ ok: true, removed: false }, env, origin);
    await commitFirestore(env, [{ path: `${formPath}/responses/${mine}`, remove: true }, { path: indexPath, remove: true }]);
    return jsonOk({ ok: true, removed: true }, env, origin);
  }

  if (!wfIsOpen(form)) return jsonError('This form is closed, so it isn’t taking answers.', 409, env, origin);
  const member = Array.isArray(space.memberUids) && space.memberUids.includes(uid);
  if (form.audience !== 'link' && !member) return jsonError('Only members can answer this form.', 403, env, origin);

  const checked = wfCheckAnswers(form, body.answers);
  if (!checked.ok) return jsonError('Some answers need another look.', 422, env, origin, { errors: checked.errors });

  let answerId = mine;
  if (answerId && form.allowEdit !== true) {
    // An answer the people running the form removed leaves the record
    // behind; the person may answer again. One that is still there stands.
    const kept = await batchGetFirestoreDocs(env, [`${formPath}/responses/${answerId}`]);
    if (kept[`${formPath}/responses/${answerId}`]) return jsonError('You already answered this form, and its answers can’t be changed.', 409, env, origin);
  }
  if (!answerId) answerId = crypto.randomUUID().replace(/-/g, '');

  const now = Date.now();
  const ok = await commitFirestore(env, [
    { path: indexPath, fields: { kind: body.kind, code: body.code, formId: body.formId, title: wfLine(form.title, 120), spaceName: wfLine(form.spaceName, 80), at: now, anon: true, answerId } },
    // No uid, no name, no email, and the day rather than the moment. The
    // whole document is replaced, so an old answer leaves nothing behind.
    { path: `${formPath}/responses/${answerId}`, fields: { anon: true, answers: checked.answers, at: wfDay(now) } },
  ]);
  if (!ok) return jsonError('That didn’t save. Try again in a moment.', 503, env, origin);
  return jsonOk({ ok: true, replaced: !!mine }, env, origin);
}
