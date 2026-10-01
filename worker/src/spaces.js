/* ── worker/src/spaces.js ───────────────────────────────────────
   Job 14: the members-only side of study groups and clubs (Oct 2026).

   Since firestore.rules made groups and clubs readable by members only,
   someone holding a code sees a small public preview instead
   (studyGroups|orgs/{code}/public/preview; the app writes it in
   js/spaces/preview.js). This keeps those previews true:

   - refreshSpacePreviews(env)   the daily cron. Writes a preview for every
     group and club, which fills in any made before previews existed and
     puts the member count right after people leave or are removed.
   - writeSpacePreview(env, kind, code, data)   one preview, from the space.
   - clearBlockedEverywhere(env, uid)   account deletion: the person comes
     off every blocked list they were on.
   - handleRotateFiles   POST /space/rotate-files { idToken, kind: 'club',
     code }. An officer's app calls it after removing someone. Every club
     file gets a new download token, so a link the removed member saved
     stops working, and files shared before Oct 2026 move from a stored
     url to a stored path (the app asks for a fresh link on open).

   The preview's fields and limits match validPreview in firestore.rules.
──────────────────────────────────────────────────────────────── */

import { commitFirestore, listFirestoreCollection, readFirestoreDoc, runFirestoreQuery, storageObjectsUnder, setStorageDownloadToken, verifyFirebaseIdToken } from './firebase.js';
import { jsonError, jsonOk } from './http.js';

const SPACE_COLLECTIONS = { group: 'studyGroups', club: 'orgs' };
const SPACE_CODE = /^[A-Z0-9]{6}$/;
const SPACE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

function clip(v, n) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : ''; }

// The next session or event on or after today (UTC; a day either side of
// midnight is fine for a preview). Weekly series are stored one entry per
// week, so the earliest dated one is the next one.
function nextItem(items, today) {
  return Object.values(items || {})
    .filter(x => x && typeof x.title === 'string' && DATE.test(x.date || '') && x.date >= today)
    .sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')))[0] || null;
}

export function spacePreviewFrom(kind, data, now = Date.now()) {
  const out = { v: 1, name: clip(data.name, 120) || (kind === 'club' ? 'Club' : 'Study group'), memberCount: Array.isArray(data.memberUids) ? data.memberUids.length : 0 };
  const desc = clip(data.description, 200);
  if (desc) out.description = desc;
  if (HEX.test(data.color || '')) out.color = data.color;
  if (kind === 'group') {
    const course = clip(data.courseLabel, 80);
    if (course) out.courseLabel = course;
  } else {
    const k = clip(data.kind, 20);
    if (k) out.kind = k;
    const school = clip(data.school, 120);
    if (school) out.school = school;
  }
  const n = nextItem(kind === 'club' ? data.events : data.sessions, new Date(now).toISOString().slice(0, 10));
  out.next = n ? { title: clip(n.title, 120) || (kind === 'club' ? 'Event' : 'Session'), date: n.date, ...(TIME.test(n.start || '') ? { start: n.start } : {}) } : null;
  out.updatedAt = now;
  return out;
}

export async function writeSpacePreview(env, kind, code, data) {
  const collection = SPACE_COLLECTIONS[kind];
  if (!collection || !SPACE_CODE.test(code || '') || !data || !Array.isArray(data.memberUids)) return false;
  const p = spacePreviewFrom(kind, data);
  const fields = { ...p };
  const clear = [];
  if (!p.next) { delete fields.next; clear.push('next'); }
  for (const k of ['description', 'color', 'courseLabel', 'kind', 'school']) if (!(k in p)) clear.push(k);
  return commitFirestore(env, [{ path: `${collection}/${code}/public/preview`, fields, clear }]);
}

export async function refreshSpacePreviews(env) {
  let written = 0;
  for (const kind of ['group', 'club']) {
    const docs = await listFirestoreCollection(env, SPACE_COLLECTIONS[kind]);
    for (const d of docs) {
      if (!SPACE_CODE.test(d.id) || !Array.isArray(d.memberUids) || !d.memberUids.length) continue;
      if (kind === 'group' && d.v !== 2) continue;   // a first-version group converts itself when its creator opens it
      if (await writeSpacePreview(env, kind, d.id, d)) written++;
    }
  }
  return written;
}

export async function clearBlockedEverywhere(env, uid) {
  if (!SPACE_ID.test(uid || '')) throw new Error('Unsafe uid for a field path');
  for (const collection of Object.values(SPACE_COLLECTIONS)) {
    const rows = await runFirestoreQuery(env, {
      from: [{ collectionId: collection }],
      where: { fieldFilter: { field: { fieldPath: `blocked.\`${uid}\`.at` }, op: 'GREATER_THAN', value: { integerValue: '0' } } },
      limit: 200,
    });
    for (const r of rows) {
      if (SPACE_CODE.test(r.id)) await commitFirestore(env, [{ path: `${collection}/${r.id}`, fields: {}, clear: [`blocked.\`${uid}\``] }]);
    }
  }
}

// The Storage path a Firebase download URL points at, or '' if it isn't one
// for this bucket.
export function storagePathFromUrl(url, bucket) {
  try {
    const u = new URL(String(url || ''));
    if (u.hostname !== 'firebasestorage.googleapis.com') return '';
    const m = u.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (!m || decodeURIComponent(m[1]) !== bucket) return '';
    return decodeURIComponent(m[2]);
  } catch { return ''; }
}

export async function handleRotateFiles(request, env, origin) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env, origin); }
  if (!body || body.kind !== 'club' || !SPACE_CODE.test(body.code || '') || !body.idToken) return jsonError('Missing or bad fields', 400, env, origin);
  let payload;
  try { payload = await verifyFirebaseIdToken(body.idToken, env.FIREBASE_PROJECT_ID); }
  catch { return jsonError('Your session expired, sign in again.', 401, env, origin); }
  const uid = payload.sub;
  const club = await readFirestoreDoc(env, 'orgs', body.code);
  if (!club || !Array.isArray(club.officerUids) || !club.officerUids.includes(uid)) return jsonError('Only an officer can do that.', 403, env, origin);
  const bucket = env.FIREBASE_STORAGE_BUCKET;
  if (!bucket) return jsonError('Server misconfigured: no storage bucket.', 500, env, origin);

  const prefix = `orgs/${body.code}/files/`;
  // Older entries stored the download URL itself: move them to the path.
  const fields = {}, clear = [];
  for (const [id, f] of Object.entries(club.files || {})) {
    if (!SPACE_ID.test(id) || !f || f.kind !== 'file' || typeof f.path === 'string') continue;
    const path = storagePathFromUrl(f.url, bucket);
    if (path.startsWith(prefix) && !path.includes('..')) { fields[`files.${id}.path`] = path; clear.push(`files.${id}.url`); }
  }
  if (clear.length) await commitFirestore(env, [{ path: `orgs/${body.code}`, fields, clear }]);

  let rotated = 0;
  for (const name of await storageObjectsUnder(env, prefix)) {
    await setStorageDownloadToken(env, name, crypto.randomUUID());
    rotated++;
  }
  return jsonOk({ ok: true, rotated, moved: clear.length }, env, origin);
}
