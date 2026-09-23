/* ── worker/src/ledger.js ───────────────────────────────────────
   The daily ledger: one row per complete UTC day in bizLedger/{YYYY-MM-DD},
   so the Business OS can draw trends past the 30 days every other number
   here covers (events are pruned at 90, errors at 30, and Stripe only
   ever says how things stand now).

   Written by the daily cron (index.js). Each run fills in every complete
   day from the last seven that has no row yet, so a missed run backfills
   itself. Add-only: a row is written with exists:false and never touched
   again, so a day that runs twice keeps its first row. Only this Worker's
   service account writes here, so no Firestore rule is involved.

   A row:
     date          'YYYY-MM-DD' (UTC)
     uniques       Cloudflare unique visitors that day, or null when
     pageViews     Cloudflare isn't connected or no longer has the day
     events        { event: count } from /track-event that day
     eventsCapped  true if the day had more events than one read returns
     syllabus      { reads, parsed, reviewed, offered, kept } that day
     stripe        { paying, comped, pastDue, canceling, groupPlans,
                     groupSeats, netMrrCents } as of the run, on the most
                   recent day only; null on a backfilled day, since how
                   things stood then can't be rebuilt from Stripe
     stripeAt      when that Stripe snapshot was taken (ms), or null
     lastFired     { event: ms } the last time each event fired, as of the
                   end of that day (carried forward from the day before)
     writtenAt     ms

   GET /admin/ledger?days=N (ADMIN_TOKEN, default 120, max 400) returns
   the rows, oldest first.
──────────────────────────────────────────────────────────────── */

import { fetchCloudflareSummary, syllabusHealth } from './dashboard.js';
import { batchGetFirestoreDocs, commitFirestore, runFirestoreQuery } from './firebase.js';
import { adminTokenOk } from './http.js';

const LEDGER = 'bizLedger';
const LEDGER_BACKFILL_DAYS = 7;
const LEDGER_DAY_EVENT_CAP = 20000; // the /track-event daily cap, see events.js
const LEDGER_DAY_MS = 24 * 60 * 60 * 1000;

function ledgerDate(ts) { return new Date(ts).toISOString().slice(0, 10); }

// The complete UTC days the ledger may still write, oldest first: the seven
// days before today. Today is never complete while the cron runs.
export function ledgerWindow(now = Date.now(), back = LEDGER_BACKFILL_DAYS) {
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const days = [];
  for (let i = back; i >= 1; i--) days.push(ledgerDate(today - i * LEDGER_DAY_MS));
  return days;
}

// One day's row from what was read. Pure, so the tests can hold it to the
// shape above without Firestore.
export function buildLedgerRow({ date, dayEvents = [], capped = false, traffic = null, stripe = null, stripeAt = null, previousLastFired = {}, now = Date.now() }) {
  const events = {};
  const lastFired = { ...(previousLastFired || {}) };
  for (const r of dayEvents) {
    if (!r?.event) continue;
    events[r.event] = (events[r.event] || 0) + 1;
    const t = Date.parse(r.createdAt || '');
    if (t && (!lastFired[r.event] || t > lastFired[r.event])) lastFired[r.event] = t;
  }
  const health = syllabusHealth(dayEvents);
  const day = traffic && Array.isArray(traffic.days) ? traffic.days.find(d => d.date === date) : null;
  return {
    date,
    uniques: day ? Number(day.uniques) || 0 : null,
    pageViews: day ? Number(day.pageViews) || 0 : null,
    events,
    eventsCapped: !!capped,
    syllabus: { reads: health.reads, parsed: health.parsed, reviewed: health.reviewed, offered: health.offered, kept: health.kept },
    stripe: stripe && typeof stripe.payingCount === 'number' ? {
      paying: stripe.payingCount, comped: stripe.compedCount, pastDue: stripe.pastDueCount, canceling: stripe.cancelingCount,
      groupPlans: stripe.groupPlanCount, groupSeats: stripe.groupSeatCount, netMrrCents: stripe.netMrrCents,
    } : null,
    stripeAt: stripe && typeof stripe.payingCount === 'number' ? (stripeAt || stripe.fetchedAt || now) : null,
    lastFired,
    writtenAt: now,
  };
}

// The cron's job. `stripeReady` is the Stripe summary the same cron run
// already fetched for the business events (a promise, resolving to null
// when Stripe isn't set up or failed), so Stripe is asked once a day.
export async function writeDailyLedger(env, { stripeReady = null, now = Date.now() } = {}) {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) return [];
  const windowDays = ledgerWindow(now);
  const existing = await batchGetFirestoreDocs(env, windowDays.map(d => `${LEDGER}/${d}`));
  const missing = windowDays.filter(d => !existing[`${LEDGER}/${d}`]);
  if (!missing.length) return [];

  // Where lastFired carries on from: the newest row before the window.
  let previousLastFired = {};
  try {
    const before = await runFirestoreQuery(env, {
      from: [{ collectionId: LEDGER }],
      where: { fieldFilter: { field: { fieldPath: 'date' }, op: 'LESS_THAN', value: { stringValue: windowDays[0] } } },
      orderBy: [{ field: { fieldPath: 'date' }, direction: 'DESCENDING' }],
      limit: 1,
    });
    previousLastFired = before[0]?.lastFired || {};
  } catch (e) { console.error('Ledger: no earlier row to carry from', e?.message); }

  let traffic = null;
  if (env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ZONE_ID) {
    try { traffic = await fetchCloudflareSummary(env); } catch (e) { traffic = null; }
  }
  let stripe = null;
  try { stripe = stripeReady ? await stripeReady : null; } catch { stripe = null; }
  const newest = windowDays[windowDays.length - 1];

  const written = [];
  for (const date of windowDays) {
    const have = existing[`${LEDGER}/${date}`];
    if (have) { previousLastFired = { ...previousLastFired, ...(have.lastFired || {}) }; continue; }
    const start = Date.parse(`${date}T00:00:00Z`);
    const dayEvents = await runFirestoreQuery(env, {
      from: [{ collectionId: 'events' }],
      select: { fields: [{ fieldPath: 'event' }, { fieldPath: 'detail' }, { fieldPath: 'createdAt' }] },
      where: { compositeFilter: { op: 'AND', filters: [
        { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: new Date(start).toISOString() } } },
        { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'LESS_THAN', value: { timestampValue: new Date(start + LEDGER_DAY_MS).toISOString() } } },
      ] } },
      limit: LEDGER_DAY_EVENT_CAP,
    });
    const row = buildLedgerRow({
      date, dayEvents, capped: dayEvents.length >= LEDGER_DAY_EVENT_CAP, traffic,
      stripe: date === newest ? stripe : null, previousLastFired, now,
    });
    previousLastFired = row.lastFired;
    // exists:false: a row already there (another run got here first) stays
    // exactly as it was, and the commit just reports it didn't apply.
    if (await commitFirestore(env, [{ path: `${LEDGER}/${date}`, exists: false, fields: row }])) written.push(date);
  }
  return written;
}

/* ── GET /admin/ledger ─────────────────────────────────────────── */
export function ledgerDaysParam(raw) {
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return 120;
  return Math.min(n, 400);
}
// Firestore drops a stored null on the way back (see fromFirestoreValue),
// so the fields that mean "not known" are put back as null here.
export function ledgerRowOut(doc) {
  return {
    date: doc.date || doc.id,
    uniques: typeof doc.uniques === 'number' ? doc.uniques : null,
    pageViews: typeof doc.pageViews === 'number' ? doc.pageViews : null,
    events: doc.events || {},
    eventsCapped: !!doc.eventsCapped,
    syllabus: doc.syllabus || { reads: 0, parsed: 0, reviewed: 0, offered: 0, kept: 0 },
    stripe: doc.stripe && typeof doc.stripe === 'object' ? doc.stripe : null,
    stripeAt: typeof doc.stripeAt === 'number' ? doc.stripeAt : null,
    lastFired: doc.lastFired || {},
    writtenAt: typeof doc.writtenAt === 'number' ? doc.writtenAt : null,
  };
}
export async function handleAdminLedger(request, env) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'content-type': 'application/json', 'X-Content-Type-Options': 'nosniff' };
  if (!env.ADMIN_TOKEN) return new Response(JSON.stringify({ error: 'Server misconfigured: ADMIN_TOKEN not set.' }), { status: 500, headers });
  if (!(await adminTokenOk(request, env))) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  if (!env.FIREBASE_PROJECT_ID) return new Response(JSON.stringify({ error: 'Server misconfigured: FIREBASE_PROJECT_ID not set.' }), { status: 500, headers });

  const days = ledgerDaysParam(new URL(request.url).searchParams.get('days'));
  const since = ledgerDate(Date.now() - days * LEDGER_DAY_MS);
  try {
    const docs = await runFirestoreQuery(env, {
      from: [{ collectionId: LEDGER }],
      where: { fieldFilter: { field: { fieldPath: 'date' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: since } } },
      orderBy: [{ field: { fieldPath: 'date' }, direction: 'ASCENDING' }],
      limit: 400,
    });
    const rows = docs.map(ledgerRowOut).sort((a, b) => a.date.localeCompare(b.date));
    return new Response(JSON.stringify({ days, since, rows }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Could not load the ledger: ' + e.message }), { status: 500, headers });
  }
}
