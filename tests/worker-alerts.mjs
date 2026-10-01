/* ── Alerts: the Worker emails Nyla when something breaks ──────────
   Runs worker/src/alerts.js and the places that call it against a fake
   KV, a fake Resend and a fake Firestore, and checks:

   - a server failure in checkout, licenses, accounts or group plans
     emails right away, once per problem per day; other features don't
   - app and site error reports email once when an hour passes the spike
     line, and warnings never count
   - the morning digest only comes on days with something to report
   - all alerts together stop at the daily cap, so sign-in emails keep
     their share of Resend
   - a Stripe webhook with a signature that fails the check alerts; a
     request with no signature header doesn't
   - a Resend failure never breaks the thing being reported
   - a spike needs five different sessions, so one stuck device is not
     an outage
   - AI spend past the line emails once a day
   - mail.js: one shared budget, the less important kinds stop first,
     and an allow-list (staging) refuses everyone else

   Run:  node tests/worker-alerts.mjs
──────────────────────────────────────────────────────────────── */
import vm from 'node:vm';
import { loadWorkerSource } from './worker-source.mjs';

const { source: src } = loadWorkerSource();
let failed = 0, passed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FAIL  ${name}\n      expected ${e}\n      got      ${a}`);
};
const ok = (name, v) => check(name, !!v, true);

function setup({ resendOk = true } = {}) {
  const box = {
    console: { ...console, error() {} },
    crypto, setTimeout, clearTimeout, TextEncoder, TextDecoder, atob, btoa, URL, URLSearchParams, Response, Request, Headers,
    ReadableStream, TransformStream, Uint8Array, ArrayBuffer, DataView,
  };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(src, box, { filename: 'worker/src (flattened)' });
  const sent = [];
  box.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.resend.com/')) {
      sent.push(JSON.parse(init.body));
      return new Response(resendOk ? '{"id":"x"}' : 'down', { status: resendOk ? 200 : 500 });
    }
    throw new Error('no network in tests: ' + url);
  };
  const writes = [];
  box.writeFirestoreDoc = async (env, col, id, doc) => { writes.push({ col, doc }); };
  const store = new Map();
  const env = {
    RESEND_API_KEY: 're_test', NOTIFY_EMAIL: 'owner@example.com', NOTIFY_FROM: 'Semester HQ <notifications@send.semester-hq.com>',
    FIREBASE_PROJECT_ID: 'semester-hq', FIREBASE_CLIENT_EMAIL: 'sa@x', FIREBASE_PRIVATE_KEY: 'k',
    RATE_LIMIT: { get: async k => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } },
  };
  return { w: box, env, sent, writes };
}

/* ── Right away: only the features that take money or hold accounts ── */
{
  const { w, env, sent } = setup();
  check('a notebook failure does not email', await w.alertIfUrgent(env, { feature: 'notebook', message: 'x', fingerprint: 'a1' }), false);
  check('a checkout failure emails', await w.alertIfUrgent(env, { feature: 'checkout', message: 'Stripe said no', fingerprint: 'b1' }), true);
  check('the same problem again the same day does not', await w.alertIfUrgent(env, { feature: 'checkout', message: 'Stripe said no', fingerprint: 'b1' }), false);
  check('a different problem does', await w.alertIfUrgent(env, { feature: 'license', message: 'y', fingerprint: 'c1' }), true);
  check('two emails went out', sent.length, 2);
  check('to the owner', sent[0].to, 'owner@example.com');
  check('from our own domain', sent[0].from, 'Semester HQ <notifications@send.semester-hq.com>');
  ok('the subject names the area', sent[0].subject.includes('Checkout or payments'));
  ok('the body carries the message', sent[0].text.includes('Stripe said no'));
  ok('no em dashes in the email', !sent.some(m => (m.subject + m.text).includes('—')));
}
{
  const { w, env, sent } = setup();
  delete env.RESEND_API_KEY;
  check('no Resend key, no email and no error', await w.alertIfUrgent(env, { feature: 'checkout', message: 'x', fingerprint: 'd1' }), false);
  check('nothing sent without a key', sent.length, 0);
}

/* ── The daily cap covers every kind together ────────────────────── */
{
  const { w, env, sent } = setup();
  for (let i = 0; i < 10; i++) await w.alertIfUrgent(env, { feature: 'account', message: 'm' + i, fingerprint: 'fp' + i });
  check('six alerts a day at most', sent.length, 6);
  check('the digest is held by the same cap', await w.sendDailyDigest(env, { count24h: 3, count7d: 3, warn7d: 0, latest: [], byFeature24h: { ai: { errors: 3, warnings: 0 } } }), false);
}

/* ── A spike of reports from the app and the site ─────────────────── */
{
  const { w, env, sent } = setup();
  let fired = 0;
  for (let i = 0; i < 25; i++) if (await w.alertOnSpike(env, 'error', 's' + (i % 5))) fired++;
  check('25 reports in an hour are normal', fired, 0);
  check('the 26th is a spike', await w.alertOnSpike(env, 'error', 's1'), true);
  check('and it emails only once that hour', await w.alertOnSpike(env, 'error', 's2'), false);
  check('one spike email', sent.length, 1);
  const { w: w1, env: env1, sent: sent1 } = setup();
  for (let i = 0; i < 60; i++) await w1.alertOnSpike(env1, 'error', 'stuck-device');
  check('one device looping is not a spike', sent1.length, 0);
  const { w: w3, env: env3, sent: sent3 } = setup();
  for (let i = 0; i < 60; i++) await w3.alertOnSpike(env3, 'error', 'd' + (i % 4));
  check('four devices are not enough either', sent3.length, 0);
  const { w: w2, env: env2, sent: sent2 } = setup();
  for (let i = 0; i < 40; i++) await w2.alertOnSpike(env2, 'warn');
  check('warnings never make a spike', sent2.length, 0);
}

/* ── The morning digest ──────────────────────────────────────────── */
{
  const { w, env, sent } = setup();
  check('a quiet day sends nothing', await w.sendDailyDigest(env, { count24h: 0, count7d: 0, warn7d: 1, latest: [], byFeature24h: { syllabus: { errors: 0, warnings: 1 } } }), false);
  check('five syllabus warnings are worth a digest', await w.sendDailyDigest(env, { count24h: 0, count7d: 0, warn7d: 5, latest: [], byFeature24h: { syllabus: { errors: 0, warnings: 5 } } }), true);
  check('a day with errors sends one', await w.sendDailyDigest(env, { count24h: 4, count7d: 9, warn7d: 2, latest: [{ source: 'app', feature: 'calendar', message: 'drag failed' }], byFeature24h: { calendar: { errors: 3, warnings: 0 }, ai: { errors: 1, warnings: 2 } } }), true);
  const d = sent[1];
  check('the subject says how many', d.subject, '[Semester HQ] Yesterday: 4 errors');
  ok('features listed, worst first', d.text.indexOf('calendar: 3 errors') > -1 && d.text.indexOf('calendar') < d.text.indexOf('ai: 1 error,'));
  ok('the latest message is in it', d.text.includes('[app/calendar] drag failed'));
  check('nothing to summarize, nothing sent', await w.sendDailyDigest(env, null), false);
}

/* ── logServerIssue alerts, and a Resend outage breaks nothing ────── */
{
  const { w, env, sent, writes } = setup({ resendOk: false });
  await w.logServerIssue(env, 'checkout', 'POST /create-checkout-session returned 500', null);
  check('the issue is still recorded', writes.length, 1);
  check('the alert was attempted', sent.length, 1);
  await w.logServerIssue(env, 'notebook', 'something else', null);
  check('a non-urgent issue does not email', sent.length, 1);
}

/* ── The Stripe webhook's signature check ────────────────────────── */
{
  const { w, env, sent } = setup();
  env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
  w.verifyStripeSignature = async () => false;
  const scanner = await w.handleStripeWebhook(new Request('https://x/stripe-webhook', { method: 'POST', body: '{}' }), env);
  check('a request with no signature is refused', scanner.status, 400);
  check('and does not email', sent.length, 0);
  const wrongSecret = await w.handleStripeWebhook(new Request('https://x/stripe-webhook', { method: 'POST', body: '{}', headers: { 'Stripe-Signature': 't=1,v1=abc' } }), env);
  check('a signed request that fails the check is refused', wrongSecret.status, 400);
  check('and emails, because payments may be going unlicensed', sent.length, 1);
}

/* ── AI spend running hot ─────────────────────────────────────────── */
{
  const { w, env, sent } = setup();
  env.AI_SPEND_ALERT_CENTS = '100';
  check('under the line, nothing', await w.noteAiSpend(env, 60), false);
  check('past it, one email', await w.noteAiSpend(env, 50), true);
  check('and not again that day', await w.noteAiSpend(env, 500), false);
  check('one spend email', sent.length, 1);
  ok('the subject says the amount', sent[0].subject.includes('$1.10'));
  ok('no em dashes', !(sent[0].subject + sent[0].text).includes('—'));
  const { w: w2, env: env2, sent: sent2 } = setup();
  await w2.recordAiUsage(env2, { feature: 'syllabus', model: 'claude-opus-5', usage: { input_tokens: 1_000_000, output_tokens: 0 } });
  check('a real AI call feeds the running total (500 cents default line)', sent2.length, 1);
}

/* ── mail.js: one budget, shared in order of importance ──────────── */
{
  const { w, env, sent } = setup();
  env.RESEND_DAILY_LIMIT = '10';
  const kinds = [];
  for (let i = 0; i < 12; i++) kinds.push((await w.sendMail(env, { kind: 'onboarding', to: 'a@b.co', subject: 's', text: 't' })).sent);
  check('onboarding stops at 60% of the day', kinds.filter(Boolean).length, 6);
  check('the refusal says why', (await w.sendMail(env, { kind: 'onboarding', to: 'a@b.co', subject: 's', text: 't' })).reason, 'budget');
  check('contact still has room', (await w.sendMail(env, { kind: 'contact', to: 'o@x.co', subject: 's', text: 't' })).sent, true);
  check('receipts still have room', (await w.sendMail(env, { kind: 'receipt', to: 'a@b.co', subject: 's', text: 't' })).sent, true);
  check('sign-in links still have room', (await w.sendMail(env, { kind: 'auth', to: 'a@b.co', subject: 's', text: 't' })).sent, true);
  check('nine went out in all', sent.length, 9);
  let unknown = null;
  try { await w.sendMail(env, { kind: 'mystery', to: 'a@b.co', subject: 's', text: 't' }); } catch (e) { unknown = e.message; }
  ok('an unknown kind throws', unknown && unknown.includes('Unknown mail kind'));
}
{
  const { w, env, sent } = setup();
  env.MAIL_ALLOWLIST = 'me@x.co, hello@semester-hq.com';
  check('staging refuses a stranger', (await w.sendMail(env, { kind: 'auth', to: 'student@school.edu', subject: 's', text: 't' })).reason, 'allowlist');
  check('and sends to the tester', (await w.sendMail(env, { kind: 'auth', to: 'Me@X.co', subject: 's', text: 't' })).sent, true);
  check('only one went out', sent.length, 1);
}
{
  const { w, env, sent } = setup();
  const r = await w.sendMail(env, { kind: 'onboarding', to: 'a@b.co', subject: 's', text: 't', html: '<p>h</p>', headers: { 'List-Unsubscribe': '<https://x>' }, idempotencyKey: 'k1' });
  check('sent with an id', [r.sent, r.id], [true, 'x']);
  check('headers pass through', sent[0].headers['List-Unsubscribe'], '<https://x>');
  const summary = await w.mailUsageSummary(env);
  check('the summary counts it by kind', [summary.days[0].onboarding, summary.days[0].total, summary.dailyLimit], [1, 1, 100]);
}
{
  const { w, env } = setup();
  await w.alertIfUrgent(env, { feature: 'checkout', message: 'x', fingerprint: 'z9' });
  const summary = await w.mailUsageSummary(env);
  ok('the last alert is remembered for the Business OS', summary.lastAlert && summary.lastAlert.subject.includes('Checkout'));
  check('and where alerts go', summary.alertsTo, 'owner@example.com');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
