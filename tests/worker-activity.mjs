/* ── Activity: weekly actives, feature use, retention by cohort ──────
   Runs worker/src/activity.js on made-up events and checks the weekly
   buckets, the first-week versus later split, the cohort table, that a
   rate is only given for a cohort of 30 or more, that malformed labels
   are ignored, and that /track-event accepts the new counts and drops any
   field that isn't allowed.

   Run:  node tests/worker-activity.mjs
──────────────────────────────────────────────────────────────── */
import vm from 'node:vm';
import { loadWorkerSource } from './worker-source.mjs';

let failed = 0, passed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FAIL  ${name}\n      expected ${e}\n      got      ${a}`);
};
const box = { console: { ...console, error() {} }, crypto, URL, URLSearchParams, TextEncoder, TextDecoder, Response, Request, Headers };
box.globalThis = box;
vm.createContext(box);
vm.runInContext(loadWorkerSource().source, box);

const now = Date.parse('2026-10-14T12:00:00Z');
const wk = box.activityWeekOf(now);
check('ISO week of 14 Oct 2026', wk, '2026-W42');
const at = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString();
const rows = [
  { event: 'app_active_week', createdAt: at(0), detail: { week: '2026-W42' } },
  { event: 'app_active_week', createdAt: at(1), detail: { week: '2026-W42' } },
  { event: 'app_active_week', createdAt: at(7), detail: { week: '2026-W41' } },
  { event: 'app_active_week', createdAt: at(400), detail: { week: '2025-W30' } },
  { event: 'account_created', createdAt: at(0) },
  { event: 'feature_used_week', createdAt: at(0), detail: { week: '2026-W42', feature: 'calendar', source: 'later' } },
  { event: 'feature_used_week', createdAt: at(0), detail: { week: '2026-W42', feature: 'calendar', source: 'week1' } },
  { event: 'feature_used_week', createdAt: at(0), detail: { week: '2026-W42', feature: 'timer', source: 'later' } },
  { event: 'return_day', createdAt: at(0), detail: { source: 'd0', cohort: '2026-W41' } },
  { event: 'return_day', createdAt: at(0), detail: { source: 'd2', cohort: '2026-W41' } },
  { event: 'return_day', createdAt: at(0), detail: { source: 'd9', cohort: '2026-W41' } },
  { event: 'return_day', createdAt: at(0), detail: { source: 'd2', cohort: 'nonsense' } },
];
for (let i = 0; i < 40; i++) rows.push({ event: 'return_day', createdAt: at(20), detail: { source: 'd0', cohort: '2026-W39' } });
for (let i = 0; i < 10; i++) rows.push({ event: 'return_day', createdAt: at(10), detail: { source: 'd7', cohort: '2026-W39' } });
const s = box.summarizeActivity(rows, now);
check('twelve weeks, oldest first', [s.weeks.length, s.weeks.at(-1)], [12, '2026-W42']);
check('weekly actives by week, old weeks left out', [s.activeByWeek['2026-W42'], s.activeByWeek['2026-W41'], Object.values(s.activeByWeek).reduce((a, b) => a + b, 0)], [2, 1, 3]);
check('new accounts this week', s.accountsCreatedByWeek['2026-W42'], 1);
check('features split first week and later', s.features.calendar, { week1: 1, later: 1, byWeek: { '2026-W42': 1 } });
check('a small cohort shows counts, no rate', s.retention.find(r => r.cohort === '2026-W41'), { cohort: '2026-W41', d0: 1, d2: 1, d7: 0, d30: 0, d2Rate: null, d7Rate: null, d30Rate: null });
check('a cohort of 30 or more gets rates', s.retention.find(r => r.cohort === '2026-W39').d7Rate, 25);
check('bad labels are ignored', s.retention.map(r => r.cohort), ['2026-W39', '2026-W41']);

// /track-event takes the new names and keeps only allowed fields.
const writes = [];
box.writeFirestoreDoc = async (env, col, id, doc) => { writes.push(doc); };
const kv = new Map();
const env = { FIREBASE_PROJECT_ID: 'p', ALLOWED_ORIGIN: 'https://app.semester-hq.com', RATE_LIMIT: { get: async k => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v) } };
const send = (body) => box.handleTrackEvent(new Request('https://w/track-event', { method: 'POST', body: JSON.stringify(body) }), env, 'https://app.semester-hq.com');
for (const event of ['account_created', 'app_active_week', 'feature_used_week', 'return_day']) check(`${event} is accepted`, (await send({ event })).status, 200);
await send({ event: 'feature_used_week', detail: { week: '2026-W42', feature: 'calendar', source: 'later', email: 'a@b.co', course: 'CHEM 210' } });
check('only week, feature and source are kept', writes.at(-1).detail, { source: 'later', week: '2026-W42', feature: 'calendar' });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
