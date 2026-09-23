/* ── worker/src/events.js ───────────────────────────────────────
   Event tracking (/track-event), and the daily write of what the business
   did overnight into the Business OS inbox (/admin/biz-events).
   Jobs 7 and 10 in index.js.
──────────────────────────────────────────────────────────────── */

import { fetchErrorSummary, fetchStripeSummary } from './dashboard.js';
import { commitFirestore, listFirestoreCollection, patchFirestoreDoc, queryRecentDocs, readFirestoreDoc, writeFirestoreDoc } from './firebase.js';
import { adminTokenOk, jsonError, jsonOk, underDailyCap } from './http.js';

/* ── 7. Event tracking ────────────────────────────────────────── */
// Writes to Firestore's `events` collection, same server-only, rate-limited
// pattern as error logging. Intentionally minimal (no cookies, no per-user
// identity): just which CTA fired, from which page, so conversion is
// measurable without turning this into a full analytics/tracking pipeline.
const TRACKED_EVENTS = [
  'nav_login_click', 'nav_upgrade_click', 'try_it_free_click', 'get_started_click', 'checkout_started', 'checkout_error',
  // The syllabus is the wedge, so its failure rate is the reliability number
  // that matters most. `syllabus_read` fires on every upload attempt (with
  // whether it parsed and what came back); `syllabus_kept` fires after the
  // student has reviewed it, and says how much of it they actually kept.
  // That second number is the real accuracy metric — see detail fields below.
  'syllabus_read', 'syllabus_kept',
];
// The only extra fields an event may carry. Counts and short labels about the
// document, never anything from inside it: no course names, no file names, no
// text the student uploaded.
const EVENT_DETAIL_NUMBERS = ['pages', 'images', 'chars', 'assignments', 'details', 'meetings', 'ms', 'cacheRead', 'cacheWrite', 'inputTokens', 'outputTokens', 'offered', 'kept', 'edited', 'removed'];
const EVENT_DETAIL_LABELS = ['source', 'fileType', 'model', 'outcome', 'reason'];

function cleanEventDetail(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const detail = {};
  for (const key of EVENT_DETAIL_NUMBERS) {
    const n = Number(raw[key]);
    if (Number.isFinite(n)) detail[key] = Math.max(0, Math.min(Math.round(n), 10_000_000));
  }
  for (const key of EVENT_DETAIL_LABELS) {
    const v = String(raw[key] ?? '').replace(/[^a-zA-Z0-9 ._-]/g, '').trim().slice(0, 40);
    if (v) detail[key] = v;
  }
  return Object.keys(detail).length ? detail : null;
}

export async function handleTrackEvent(request, env, origin) {
  if (!env.FIREBASE_PROJECT_ID) return jsonOk({ ok: true }, env, origin); // never block the page over a missing config

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env, origin); }

  const event = TRACKED_EVENTS.includes(body.event) ? body.event : null;
  if (!event) return jsonError('Unknown event', 400, env, origin);
  const path = String(body.path || '').trim().slice(0, 200);
  const detail = cleanEventDetail(body.detail);
  if (!(await underDailyCap(env, 'events', 20000))) return jsonOk({ ok: true, dropped: true }, env, origin);

  try {
    const id = crypto.randomUUID();
    await writeFirestoreDoc(env, 'events', id, { event, path, createdAt: new Date(), ...(detail ? { detail } : {}) });
  } catch (e) {
    console.error('Event track write failed', e); // never fail the click over a logging endpoint
  }
  return jsonOk({ ok: true }, env, origin);
}

/* ── 10. What the business did while you weren't looking ────────────
   Once a day this looks at Stripe, the contact form and the crash
   reports, and writes down anything worth a founder's attention:
   someone subscribed, a payment failed, a message went unanswered,
   the week's numbers. The Business OS picks these up when it opens and
   turns them into to-dos, so the list fills itself in whether or not
   the laptop was ever switched on.

   Each event has a key that already contains its date, so a day that
   runs twice writes the same key twice and Firestore keeps the first —
   an event you've already ticked off never comes back. Events are
   written by this Worker's service account, which is why nothing here
   needs a change to the Firestore rules.
──────────────────────────────────────────────────────────────── */
const BIZ_EVENT_STATE = 'bizState/events';
const BIZ_EVENTS = 'bizEvents';

function ymd(ts) { return new Date(ts).toISOString().slice(0, 10); }
function plural(n, one, many) { return `${n} ${n === 1 ? one : many || one + 's'}`; }

export async function buildBusinessEvents(env) {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) return;
  const now = Date.now();
  const day = ymd(now);
  const state = (await readFirestoreDoc(env, 'bizState', 'events').catch(() => null)) || {};
  const events = [];
  const add = (key, e) => events.push({ key, ...e });

  let stripe = null;
  if (env.STRIPE_SECRET_KEY) {
    try { stripe = await fetchStripeSummary(env); } catch (e) { stripe = null; }
  }

  if (stripe) {
    const lastPaying = Number(state.payingCount ?? stripe.payingCount);
    const gained = stripe.payingCount - lastPaying;
    if (gained > 0) {
      add(`subs-up-${day}`, {
        kind: 'subscriber', area: 'Sales & Partnerships', priority: 'Medium',
        title: `${plural(gained, 'new paying subscriber')} since yesterday`,
        detail: `Now ${plural(stripe.payingCount, 'paying subscriber')}, $${(stripe.netMrrCents / 100).toFixed(2)} net MRR. Worth a thank-you note or asking them how they found you.`,
      });
    }
    if (gained < 0) {
      add(`subs-down-${day}`, {
        kind: 'churn', area: 'Sales & Partnerships', priority: 'High',
        title: `${plural(-gained, 'subscriber')} left since yesterday`,
        detail: `Down to ${plural(stripe.payingCount, 'paying subscriber')}. Ask why while it's fresh — that answer is worth more than the seat.`,
      });
    }
    if (stripe.pastDueCount > 0) {
      add(`past-due-${day}`, {
        kind: 'billing', area: 'Finance & Legal', priority: 'High',
        title: `${plural(stripe.pastDueCount, 'payment')} failing right now`,
        detail: 'Stripe retries on its own, but a card that has expired never recovers without an email. They keep access while past due.',
      });
    }
    if (stripe.cancelingCount > 0 && stripe.cancelingCount !== Number(state.cancelingCount ?? -1)) {
      add(`canceling-${day}`, {
        kind: 'churn', area: 'Sales & Partnerships', priority: 'Medium',
        title: `${plural(stripe.cancelingCount, 'subscription')} set to end at the period`,
        detail: 'They still have access, so there is time to ask what went wrong.',
      });
    }
    const newGroups = stripe.groupPlanCount - Number(state.groupPlanCount ?? stripe.groupPlanCount);
    if (newGroups > 0) {
      add(`group-${day}`, {
        kind: 'group', area: 'Sales & Partnerships', priority: 'Medium',
        title: `${plural(newGroups, 'new group plan')} started`,
        detail: `${plural(stripe.groupSeatCount, 'seat')} across ${plural(stripe.groupPlanCount, 'group plan')}. Check they invited their members — an unused plan cancels.`,
      });
    }
  }

  // Contact-form messages that have sat for more than a day.
  try {
    const feedback = await queryRecentDocs(env, 'feedback', 25);
    const stale = (Array.isArray(feedback) ? feedback : []).filter(f => {
      const at = Date.parse(f.createdAt || '');
      return at && now - at > 24 * 60 * 60 * 1000 && now - at < 14 * 24 * 60 * 60 * 1000;
    });
    if (stale.length) {
      add(`support-${day}`, {
        kind: 'support', area: 'Support', priority: 'High',
        title: `${plural(stale.length, 'message')} waiting more than a day`,
        detail: `Oldest is from ${new Date(Math.min(...stale.map(f => Date.parse(f.createdAt)))).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. Answering fast is the whole advantage of being one person.`,
      });
    }
  } catch {}

  // Crashes students actually hit.
  try {
    const errs = await fetchErrorSummary(env);
    if (errs?.count24h > 0) {
      add(`errors-${day}`, {
        kind: 'errors', area: 'Product', priority: errs.count24h > 5 ? 'High' : 'Medium',
        title: `${plural(errs.count24h, 'crash report')} in the last day`,
        detail: 'Open the Error Viewer and see whether it is one bug hitting repeatedly or several people.',
      });
    }
  } catch {}

  // Monday: the week in one line.
  if (new Date(now).getUTCDay() === 1 && stripe) {
    add(`weekly-${day}`, {
      kind: 'weekly', area: 'Operations', priority: 'Low',
      title: 'Where the week starts',
      detail: `${plural(stripe.payingCount, 'paying subscriber')} · $${(stripe.netMrrCents / 100).toFixed(2)} net MRR · ${plural(stripe.new7d, 'signup')} in 7 days · ${plural(stripe.canceled30d, 'cancellation')} in 30 days${stripe.groupPlanCount ? ` · ${plural(stripe.groupPlanCount, 'group plan')}` : ''}.`,
    });
  }

  if (events.length) {
    // exists:false so an event already read (or already ticked off) is never
    // written over — the commit simply reports it didn't apply.
    for (const e of events) {
      await commitFirestore(env, [{
        path: `${BIZ_EVENTS}/${e.key}`,
        exists: false,
        fields: { key: e.key, kind: e.kind, area: e.area, priority: e.priority, title: e.title, detail: e.detail, at: new Date(now).toISOString(), ackedAt: '' },
      }]).catch(() => false);
    }
  }

  await patchFirestoreDoc(env, BIZ_EVENT_STATE, {
    payingCount: stripe ? stripe.payingCount : (state.payingCount ?? 0),
    cancelingCount: stripe ? stripe.cancelingCount : (state.cancelingCount ?? 0),
    groupPlanCount: stripe ? stripe.groupPlanCount : (state.groupPlanCount ?? 0),
    lastRunAt: new Date(now).toISOString(),
  }).catch(() => {});
}

// GET /admin/biz-events — what the Business OS hasn't collected yet.
export async function handleAdminBizEvents(request, env) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'content-type': 'application/json', 'X-Content-Type-Options': 'nosniff' };
  if (!env.ADMIN_TOKEN) return new Response(JSON.stringify({ error: 'Server misconfigured: ADMIN_TOKEN not set.' }), { status: 500, headers });
  if (!(await adminTokenOk(request, env))) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });

  if (request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch {}
    const keys = Array.isArray(body.keys) ? body.keys.filter(k => typeof k === 'string' && /^[\w.-]{1,120}$/.test(k)).slice(0, 50) : [];
    const at = new Date().toISOString();
    for (const key of keys) {
      await patchFirestoreDoc(env, `${BIZ_EVENTS}/${key}`, { ackedAt: at }).catch(() => {});
    }
    return new Response(JSON.stringify({ ok: true, acked: keys.length }), { headers });
  }

  try {
    const docs = await listFirestoreCollection(env, BIZ_EVENTS);
    const events = (docs || [])
      .filter(d => !d.ackedAt)
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
      .slice(0, 50);
    return new Response(JSON.stringify({ events }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
