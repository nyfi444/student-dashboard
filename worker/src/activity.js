/* ── worker/src/activity.js ─────────────────────────────────────
   What students do after they sign up, from the app's anonymous weekly
   counts (js/usagecounts.js through /track-event): weekly active
   accounts, which features get used in the first week and after it, and
   how many come back on day 2, 7 and 30 of their plan, by the week the
   plan began. Part of job 8 (the business summary). Counts only: the
   events carry a week label, a feature name and a cohort week, never who.

   Each event name is read with an equality query, which Firestore indexes
   on its own, so this needs no composite index. The events collection
   keeps 90 days (diagnostics.js prunes it), so twelve weeks is the reach.
──────────────────────────────────────────────────────────────── */

import { runFirestoreQuery } from './firebase.js';

const ACTIVITY_EVENTS = ['app_active_week', 'feature_used_week', 'return_day', 'account_created'];
const ACTIVITY_WEEKS = 12;
const ACTIVITY_READ_CAP = 5000;

// ISO week of a timestamp, in UTC, e.g. 2026-W40.
export function activityWeekOf(ms) {
  const d = new Date(ms);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const week = Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// rows: events as stored ({ event, createdAt, detail }). Pure, for the tests.
export function summarizeActivity(rows, now = Date.now()) {
  const weeks = [];
  for (let i = ACTIVITY_WEEKS - 1; i >= 0; i--) weeks.push(activityWeekOf(now - i * 7 * 86400000));
  const inRange = new Set(weeks);
  const active = {}, created = {}, features = {}, retention = {};
  const weekLabel = (r) => {
    const w = String(r.detail?.week || '');
    return /^\d{4}-W\d{2}$/.test(w) ? w : activityWeekOf(Date.parse(r.createdAt || '') || now);
  };
  for (const r of rows) {
    if (r.event === 'app_active_week') {
      const w = weekLabel(r);
      if (inRange.has(w)) active[w] = (active[w] || 0) + 1;
    } else if (r.event === 'account_created') {
      const w = activityWeekOf(Date.parse(r.createdAt || '') || now);
      if (inRange.has(w)) created[w] = (created[w] || 0) + 1;
    } else if (r.event === 'feature_used_week') {
      const w = weekLabel(r);
      const f = String(r.detail?.feature || '').slice(0, 40);
      if (!inRange.has(w) || !f) continue;
      const phase = r.detail?.source === 'week1' ? 'week1' : 'later';
      const row = (features[f] ||= { week1: 0, later: 0, byWeek: {} });
      row[phase]++;
      if (phase === 'later') row.byWeek[w] = (row.byWeek[w] || 0) + 1;
    } else if (r.event === 'return_day') {
      const c = String(r.detail?.cohort || '');
      const s = String(r.detail?.source || '');
      if (!/^\d{4}-W\d{2}$/.test(c) || !['d0', 'd2', 'd7', 'd30'].includes(s)) continue;
      const row = (retention[c] ||= { d0: 0, d2: 0, d7: 0, d30: 0 });
      row[s]++;
    }
  }
  // Rates only where the cohort is big enough to mean something (the same
  // 30 the Measure page uses); below that the raw counts are shown instead.
  const cohorts = Object.keys(retention).sort().slice(-ACTIVITY_WEEKS).map(c => {
    const r = retention[c];
    const rate = (n) => (r.d0 >= 30 ? Math.round((n / r.d0) * 100) : null);
    return { cohort: c, ...r, d2Rate: rate(r.d2), d7Rate: rate(r.d7), d30Rate: rate(r.d30) };
  });
  return {
    weeks,
    activeByWeek: Object.fromEntries(weeks.map(w => [w, active[w] || 0])),
    accountsCreatedByWeek: Object.fromEntries(weeks.map(w => [w, created[w] || 0])),
    features,
    retention: cohorts,
  };
}

export async function fetchActivitySummary(env, now = Date.now()) {
  const results = await Promise.all(ACTIVITY_EVENTS.map(event => runFirestoreQuery(env, {
    from: [{ collectionId: 'events' }],
    where: { fieldFilter: { field: { fieldPath: 'event' }, op: 'EQUAL', value: { stringValue: event } } },
    limit: ACTIVITY_READ_CAP,
  })));
  const rows = results.flat();
  return { ...summarizeActivity(rows, now), capped: results.some(r => r.length >= ACTIVITY_READ_CAP) };
}
