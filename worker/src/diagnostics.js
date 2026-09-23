/* ── worker/src/diagnostics.js ──────────────────────────────────
   Error reports: /log-error from the app and the site, logServerIssue for
   the Worker's own failures, pruning, and the /admin/errors viewer.
   Jobs 5 and 6 in index.js.
──────────────────────────────────────────────────────────────── */

import { commitFirestore, queryRecentErrors, runFirestoreQuery, writeFirestoreDoc } from './firebase.js';
import { adminTokenOk, jsonError, jsonOk, underDailyCap, underHourlyCap } from './http.js';

/* ── 5. Diagnostics ───────────────────────────────────────────── */
// Writes to Firestore's `errors` collection, same server-only pattern as
// `feedback` (see firestore.rules). Reachable by anyone, so every field is
// capped and coerced rather than trusted as-is, and emails or URL parameter
// values are stripped again here in case an older client sent them.
const ERROR_SOURCES = ['app', 'marketing'];
const ERROR_LEVELS = ['error', 'warn'];
export async function handleLogError(request, env, origin) {
  if (!env.FIREBASE_PROJECT_ID) return jsonError('Server misconfigured: FIREBASE_PROJECT_ID not set.', 500, env, origin);
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env, origin); }

  const clip = (v, max) => scrubPII(String(v ?? '').trim()).slice(0, max);
  const message = clip(body.message, 2000);
  if (!message) return jsonError('Missing error message', 400, env, origin);
  const source = ERROR_SOURCES.includes(body.source) ? body.source : 'app';
  const feature = String(body.feature || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'unknown';
  let context = '';
  try { context = body.context && typeof body.context === 'object' ? clip(JSON.stringify(body.context), 1500) : ''; } catch {}

  // The same problem reported over and over is one problem: after twenty
  // copies in an hour the rest are counted and not stored, and the whole
  // collection takes at most a few thousand new reports a day, so a stuck
  // client or a script can't fill Firestore.
  const fingerprint = await issueFingerprint(source, feature, message);
  if (!(await underDailyCap(env, 'errors', 3000)) || !(await underHourlyCap(env, `errfp:${fingerprint}`, 20))) return jsonOk({ ok: true, dropped: true }, env, origin);

  try {
    await writeFirestoreDoc(env, 'errors', crypto.randomUUID(), {
      source, feature, message,
      level: ERROR_LEVELS.includes(body.level) ? body.level : 'error',
      stack: clip(body.stack, 4000),
      url: clip(body.page || body.url, 500), // older clients send `url`
      release: clip(body.release, 60),
      session: clip(body.session, 20),
      userAgent: clip(body.userAgent, 300),
      breadcrumbs: (Array.isArray(body.breadcrumbs) ? body.breadcrumbs : []).slice(-25).map(c => clip(c, 160)),
      context,
      fingerprint,
      createdAt: new Date(),
    });
  } catch (e) {
    // Never fail loudly over a logging endpoint, or a broken reporter spams retries.
    console.error('Error log write failed', e);
  }
  return jsonOk({ ok: true }, env, origin);
}

// The Worker's own failures, in the same collection as source "worker", so
// admin/errors.html shows them next to what students hit. Always goes to
// Workers Logs as well. The same issue repeating within 10 minutes on one
// instance is only logged to the console, so an outage can't flood Firestore.
const _recentIssues = new Map();
export async function logServerIssue(env, feature, message, err, extra = {}) {
  const text = scrubPII(err?.message ? `${message}: ${err.message}` : message).slice(0, 2000);
  console.error(JSON.stringify({ level: 'error', feature, message: text, ...extra, stack: scrubPII(String(err?.stack || '')) }));
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) return;
  try {
    const fingerprint = await issueFingerprint('worker', feature, text);
    if (Date.now() - (_recentIssues.get(fingerprint) || 0) < 10 * 60 * 1000) return;
    _recentIssues.set(fingerprint, Date.now());
    await writeFirestoreDoc(env, 'errors', crypto.randomUUID(), {
      source: 'worker', level: 'error', feature, message: text,
      stack: scrubPII(String(err?.stack || '')).slice(0, 4000),
      context: scrubPII(JSON.stringify(extra)).slice(0, 1500),
      fingerprint, createdAt: new Date(),
    });
  } catch (e) { console.error('Could not record server issue', e?.message); }
}
export function featureForPath(path) {
  const map = [[/^\/v1\/messages/, 'ai'], [/^\/create-(checkout|portal)-session|^\/stripe-webhook/, 'checkout'], [/^\/(claim-license|check-email)/, 'license'],
    [/^\/group\//, 'group-plans'], [/^\/delete-account/, 'account'], [/^\/contact-message/, 'feedback'], [/^\/admin\//, 'admin']];
  return (map.find(([re]) => re.test(path)) || [])[1] || 'worker';
}
function scrubPII(text) {
  return String(text).replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]').replace(/([?&#][\w-]+=)[^&#\s'")]+/g, '$1…');
}
// Groups repeats of one problem: same source, feature, and message once
// numbers and ids are ignored.
async function issueFingerprint(source, feature, message) {
  const normalized = String(message).toLowerCase().replace(/[0-9a-f]{8,}|\d+/g, '#').replace(/\s+/g, ' ').slice(0, 300);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${source}|${feature}|${normalized}`));
  return [...new Uint8Array(hash)].slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
}
// Daily: reports older than 30 days are deleted, so the collection stays small.
export async function pruneOldIssues(env) {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) return;
  await pruneCollection(env, 'errors', 30, 400);
  // Click and syllabus-read events: 90 days shows every trend that matters,
  // and nothing pruned them before.
  await pruneCollection(env, 'events', 90, 800);
}
async function pruneCollection(env, collectionId, days, limit) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const old = await runFirestoreQuery(env, {
    from: [{ collectionId }],
    where: { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'LESS_THAN', value: { timestampValue: cutoff } } },
    limit,
  });
  for (let i = 0; i < old.length; i += 400) {
    await commitFirestore(env, old.slice(i, i + 400).map(r => ({ path: `${collectionId}/${r.id}`, remove: true })));
  }
}

/* ── 6. Error viewer ──────────────────────────────────────────── */
// Backs admin/errors.html. Bearer token compared with timing-safe equality
// against the ADMIN_TOKEN secret (set via `wrangler secret put ADMIN_TOKEN`).
export async function handleAdminErrors(request, env) {
  const adminCors = { 'Access-Control-Allow-Origin': '*', 'content-type': 'application/json', 'X-Content-Type-Options': 'nosniff' };
  if (!env.ADMIN_TOKEN) return new Response(JSON.stringify({ error: 'Server misconfigured: ADMIN_TOKEN not set.' }), { status: 500, headers: adminCors });
  if (!env.FIREBASE_PROJECT_ID) return new Response(JSON.stringify({ error: 'Server misconfigured: FIREBASE_PROJECT_ID not set.' }), { status: 500, headers: adminCors });

  if (!(await adminTokenOk(request, env))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: adminCors });
  }

  try {
    const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get('limit')) || 200, 1), 300);
    const errors = await queryRecentErrors(env, limit);
    return new Response(JSON.stringify({ errors }), { headers: adminCors });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Could not load errors: ' + e.message }), { status: 500, headers: adminCors });
  }
}
