/* ── Customer emails: receipts, welcomes and the tips ──────────────
   Runs worker/src/onboarding.js, emails.js and the webhook paths that
   call them against a fake Firestore, a fake KV and a fake Resend, and
   checks:

   - every email renders, in HTML and plain text, with no em dashes and
     never "AI-powered"; the receipts carry the plan, the price, monthly
     renewal until cancelled, the 14-day refund and exactly how to cancel,
     and no unsubscribe; every onboarding email has one, plus the LLC name
     and address; a group name can't inject HTML
   - a paid checkout sends the receipt at once and schedules the welcome;
     Stripe delivering the same event twice sends nothing new
   - someone who opted out still gets the receipt, never the welcome
   - group admins get the group receipt and the group welcome, not the
     student tips; a seat member gets the member welcome and the tips
   - the tips walk days 3, 7, 11, 16 and the first Sunday from day 21,
     never closer than three days, skipping a step already done
   - the sequence stops for someone who unsubscribes or stops paying,
     holds everyone when the day's budget is gone, and never sends twice
   - the unsubscribe link works with its signature and not without; the
     one-click POST works; the app can only turn progress flags on
   - deleting the account removes the record, the preference and the log

   Run:  node tests/worker-onboarding.mjs
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
const DAY = 86400000;

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
      sent.push({ ...JSON.parse(init.body), idem: init.headers['Idempotency-Key'] || '' });
      return new Response(resendOk ? `{"id":"re_${sent.length}"}` : 'down', { status: resendOk ? 200 : 500 });
    }
    throw new Error('no network in tests: ' + url);
  };

  // A small Firestore: docs by path, dotted field paths, exists conditions.
  const db = new Map();
  const setPath = (obj, dotted, v) => {
    const parts = dotted.split('.');
    let o = obj;
    for (const p of parts.slice(0, -1)) o = (o[p] && typeof o[p] === 'object' && !(o[p] instanceof Date)) ? o[p] : (o[p] = {});
    o[parts.at(-1)] = v;
  };
  box.commitFirestore = async (env, writes) => {
    for (const w of writes) {
      if (typeof w.exists === 'boolean' && db.has(w.path) !== w.exists) return false;
    }
    for (const w of writes) {
      if (w.remove) { db.delete(w.path); continue; }
      const doc = structuredClone(db.get(w.path) || {});
      for (const [k, v] of Object.entries(w.fields || {})) setPath(doc, k, v);
      db.set(w.path, doc);
    }
    return true;
  };
  box.readFirestoreDoc = async (env, col, id) => db.get(`${col}/${id}`) ?? null;
  box.runFirestoreQuery = async (env, q) => {
    const col = q.from[0].collectionId;
    const f = q.where?.fieldFilter;
    const out = [];
    for (const [path, doc] of db) {
      const [c, id] = path.split('/');
      if (c !== col || path.split('/').length !== 2) continue;
      if (f) {
        const want = f.value.booleanValue ?? f.value.stringValue;
        if (doc[f.field.fieldPath] !== want) continue;
      }
      out.push({ id, ...structuredClone(doc) });
    }
    return out;
  };
  box.writeFirestoreDoc = async (env, col, id, doc) => { db.set(`${col}/${id}`, doc); };
  box.logServerIssue = async () => {};
  box.verifyFirebaseIdToken = async (token) => {
    if (token === 'good') return { sub: 'uid1', email: 'Student@School.edu', email_verified: true };
    throw new Error('bad token');
  };

  const kv = new Map();
  const env = {
    RESEND_API_KEY: 're_test', NOTIFY_EMAIL: 'owner@example.com', NOTIFY_FROM: 'Semester HQ <notifications@send.semester-hq.com>',
    FIREBASE_PROJECT_ID: 'semester-hq', FIREBASE_CLIENT_EMAIL: 'sa@x', FIREBASE_PRIVATE_KEY: 'k',
    APP_URL: 'https://app.semester-hq.com/', SELF_URL: 'https://api.example', EMAIL_LINK_SECRET: 'test-secret-xyz', ADMIN_TOKEN: 'admintoken',
    RATE_LIMIT: { get: async k => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } },
  };
  return { w: box, env, sent, db };
}

/* ── Every email renders, and says what it must ──────────────────── */
{
  const { w } = setup();
  const keys = ['receipt', 'group-receipt', 'welcome', 'group-welcome', 'member-welcome', 'syllabus', 'calendar', 'canvas', 'groups', 'habit'];
  const ctx = { appUrl: 'https://app.semester-hq.com/', prefsUrl: 'https://p.example/prefs', unsubscribeUrl: 'https://p.example/off', startedAt: new Date('2026-10-02T15:00:00Z'), groupName: 'Chem <b>Club</b>', seats: 12, seatCents: 599, priceCents: 799 };
  for (const key of keys) {
    const r = w.renderEmail(key, ctx);
    ok(`${key}: renders`, r && r.subject && r.html.startsWith('<!doctype html>') && r.text.length > 100);
    ok(`${key}: no em dashes`, !(r.subject + r.html + r.text).includes('—'));
    ok(`${key}: never "AI-powered"`, !/AI[- ]powered/i.test(r.subject + r.html + r.text));
    ok(`${key}: LLC name and address in both versions`, r.html.includes('Semester HQ, LLC') && r.text.includes('9660 Falls of Neuse Road') && r.html.includes('Raleigh, NC 27615'));
    ok(`${key}: works in dark mode`, r.html.includes('prefers-color-scheme: dark') && r.html.includes('color-scheme'));
    ok(`${key}: sized for a phone`, r.html.includes('max-width: 620px') && r.html.includes('width=device-width'));
    ok(`${key}: brand fonts with fallbacks`, r.html.includes("'Instrument Serif', Georgia") && r.html.includes("'General Sans'"));
    ok(`${key}: a group name can't inject HTML`, !r.html.includes('<b>Club</b>') && !r.subject.includes('<b>'));
    if (r.transactional) ok(`${key}: a receipt has no unsubscribe`, !/unsubscribe/i.test(r.html + r.text));
    else ok(`${key}: has the unsubscribe and settings links`, r.html.includes('https://p.example/off') && r.text.includes('https://p.example/off') && r.html.includes('https://p.example/prefs'));
  }
  const rc = w.renderEmail('receipt', ctx);
  ok('receipt: the plan', rc.text.includes('Plan: Semester HQ Plus'));
  ok('receipt: the price', rc.text.includes('$7.99 a month'));
  ok('receipt: renews monthly until cancelled', rc.text.includes('Renews automatically every month until you cancel'));
  ok('receipt: the start date', rc.text.includes('October 2, 2026'));
  ok('receipt: the 14-day refund', rc.text.includes('within 14 days of your first charge'));
  ok('receipt: exactly how to cancel', rc.text.includes('Settings, then Account & Sync, then Manage subscription'));
  ok('receipt: in the body, not fine print', rc.html.indexOf('How to cancel') < rc.html.indexOf('Your entire semester, finally in one place.'));
  const gr = w.renderEmail('group-receipt', ctx);
  ok('group receipt: seats and total', gr.text.includes('12 seats') && gr.text.includes('$5.99 per seat a month, $71.88 a month in total'));
  ok('group receipt: how to cancel', gr.text.includes('Manage billing in Stripe'));
  ok('tips link to the right page', w.renderEmail('calendar', ctx).html.includes('https://app.semester-hq.com/?open=calendar') && w.renderEmail('canvas', ctx).html.includes('?open=assignments'));
  check('an unknown email is null', w.renderEmail('nope', ctx), null);
}

/* ── The schedule, day by day ─────────────────────────────────────── */
{
  const { w } = setup();
  // Thursday 1 October 2026, 13:00 UTC, the cron's hour.
  const start = Date.parse('2026-10-01T13:00:00Z');
  const rec = { startedAt: new Date(start), lastSentAt: new Date(start), sent: {}, skipped: {}, did: {} };
  const log = [];
  for (let d = 0; d <= 40; d++) {
    const now = start + d * DAY;
    for (;;) {
      const n = w.nextTipFor(rec, now);
      if (n.send) { rec.sent[n.send] = new Date(now); rec.lastSentAt = new Date(now); log.push(`${d}:${n.send}`); break; }
      if (n.skip) { rec.skipped[n.skip] = new Date(now); continue; }
      break;
    }
  }
  // Day 25 is Sunday 25 October, the first Sunday from day 21.
  check('the whole sequence, in days', log, ['3:syllabus', '7:calendar', '11:canvas', '16:groups', '24:habit']);
  const gaps = log.map(x => +x.split(':')[0]).map((d, i, a) => i ? d - a[i - 1] : d);
  ok('never closer than three days', gaps.every(g => g >= 3));
  check('then it is done', w.nextTipFor(rec, start + 41 * DAY), { done: true });

  const busy = { startedAt: new Date(start), lastSentAt: new Date(start), sent: {}, skipped: {}, did: { hasClass: true, hasFeed: true } };
  check('someone with a class skips the syllabus tip', w.nextTipFor(busy, start + 3 * DAY), { skip: 'syllabus' });
  const late = { startedAt: new Date(start), lastSentAt: new Date(start + 9 * DAY), sent: { syllabus: 1, calendar: 1 }, skipped: {}, did: {} };
  check('a delayed tip does not pull the next one closer', w.nextTipFor(late, start + 11 * DAY), { wait: true });
  check('it goes once the gap has passed', w.nextTipFor(late, start + 12 * DAY), { send: 'canvas' });
}

/* ── A personal checkout ──────────────────────────────────────────── */
{
  const { w, env, sent, db } = setup();
  await w.startCustomerEmails(env, { email: 'Student@School.edu', uid: 'uid1', plan: 'plus', sessionId: 'cs_test_123' });
  check('two emails: the receipt and the welcome', sent.map(m => m.subject), ['Your Semester HQ Plus subscription is active', 'Welcome to Semester HQ']);
  check('both to the student', sent.map(m => m.to), ['student@school.edu', 'student@school.edu']);
  ok('the receipt goes now', !sent[0].scheduled_at);
  ok('the welcome waits about an hour', sent[1].scheduled_at && Math.abs(Date.parse(sent[1].scheduled_at) - Date.now() - 3600000) < 60000);
  ok('the receipt has no unsubscribe header', !sent[0].headers);
  ok('the welcome has one-click unsubscribe', sent[1].headers['List-Unsubscribe'].startsWith('<https://api.example/email/unsubscribe?e=') && sent[1].headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click');
  ok('replies go to hello@', sent.every(m => m.reply_to === 'hello@semester-hq.com'));
  ok('both have a plain-text version', sent.every(m => m.text && m.html));
  const rec = db.get('emailOnboarding/student@school.edu');
  check('a student record, active, with the uid', [rec.active, rec.plan, rec.uid], [true, 'plus', 'uid1']);
  const logs = [...db.keys()].filter(k => k.startsWith('emailLog/'));
  check('two log entries', logs.length, 2);
  ok('the log holds no address', logs.every(k => !k.includes('@') && !JSON.stringify(db.get(k)).includes('@')));
  await w.startCustomerEmails(env, { email: 'student@school.edu', uid: 'uid1', plan: 'plus', sessionId: 'cs_test_123' });
  check('Stripe sending the event again sends nothing new', sent.length, 2);
}
{
  const { w, env, sent, db } = setup();
  db.set('emailPrefs/student@school.edu', { tips: false });
  await w.startCustomerEmails(env, { email: 'student@school.edu', plan: 'plus', sessionId: 'cs_2' });
  check('opted out: the receipt still comes, the welcome does not', sent.map(m => m.subject), ['Your Semester HQ Plus subscription is active']);
}
{
  const { w, env, sent, db } = setup();
  delete env.EMAIL_LINK_SECRET;
  await w.startCustomerEmails(env, { email: 'a@b.co', plan: 'plus', sessionId: 'cs_3' });
  check('no link secret: the receipt goes, nothing without an unsubscribe link does', sent.map(m => m.subject), ['Your Semester HQ Plus subscription is active']);
  ok('and nothing is logged as sent for the welcome', ![...db.keys()].some(k => k.endsWith('-welcome')));
}

/* ── Groups ───────────────────────────────────────────────────────── */
{
  const { w, env, sent, db } = setup();
  await w.startCustomerEmails(env, { email: 'dean@college.edu', plan: 'group-admin', planId: 'plan123456789', groupName: 'Chem Club', seats: 8 });
  check('the admin gets the group receipt and the group welcome', sent.map(m => m.subject), ['Your Semester HQ group plan is active', 'Getting your group started']);
  ok('the receipt has the total', sent[0].text.includes('$47.92 a month in total'));
  check('but no student tips', db.get('emailOnboarding/dean@college.edu').active, false);
}
{
  const { w, env, sent, db } = setup();
  await w.startCustomerEmails(env, { email: 'm@school.edu', uid: 'u9', plan: 'member', groupName: 'Chem Club' });
  check('a member gets the member welcome, at once', [sent.length, sent[0].subject, !!sent[0].scheduled_at], [1, 'Chem Club has you covered on Semester HQ', false]);
  check('and the tips', db.get('emailOnboarding/m@school.edu').active, true);
}

/* ── The daily run ────────────────────────────────────────────────── */
{
  const { w, env, sent, db } = setup();
  const start = Date.parse('2026-10-01T13:00:00Z');
  const base = (over = {}) => ({ email: '', uid: '', plan: 'plus', active: true, startedAt: new Date(start), lastSentAt: new Date(start), sent: {}, skipped: {}, did: {}, ...over });
  db.set('emailOnboarding/a@x.co', base({ email: 'a@x.co', uid: 'ua' }));
  db.set('licenses/ua', { paid: true });
  db.set('emailOnboarding/b@x.co', base({ email: 'b@x.co', uid: 'ub', did: { hasClass: true } }));
  db.set('licenses/ub', { paid: true });
  db.set('emailOnboarding/c@x.co', base({ email: 'c@x.co', uid: 'uc' }));
  db.set('licenses/uc', { paid: false });
  db.set('emailOnboarding/d@x.co', base({ email: 'd@x.co' }));
  db.set('licensesByEmail/d@x.co', { paid: true });
  db.set('emailPrefs/d@x.co', { tips: false });
  db.set('emailOnboarding/e@x.co', base({ email: 'e@x.co', active: false }));

  const day3 = await w.runOnboardingEmails(env, start + 3 * DAY);
  check('day 3: one syllabus tip, one skip, two stopped', [day3.sent, day3.skipped, day3.stopped], [1, 1, 2]);
  check('the tip went to the one who needed it', sent.map(m => [m.to, m.subject]), [['a@x.co', 'Your syllabus can do the setup for you']]);
  check('someone who stopped paying is stopped', db.get('emailOnboarding/c@x.co').stopReason, 'not-paying');
  check('someone who unsubscribed is stopped', db.get('emailOnboarding/d@x.co').stopReason, 'unsubscribed');
  ok('the skip is recorded', !!db.get('emailOnboarding/b@x.co').skipped.syllabus);

  const again = await w.runOnboardingEmails(env, start + 3 * DAY);
  check('the same day again sends nothing', [again.sent, sent.length], [0, 1]);

  // Someone's log already shows the calendar tip (a crash between sending and
  // recording it): the run records it and does not send it again.
  const rec = db.get('emailOnboarding/a@x.co');
  const hash = [...db.keys()].find(k => k.startsWith('emailLog/') && k.endsWith('-syllabus')).slice('emailLog/'.length).split('-')[0];
  db.set(`emailLog/${hash}-calendar`, { key: 'calendar' });
  await w.runOnboardingEmails(env, start + 7 * DAY);
  ok('an email already in the log is never sent twice', !sent.some(m => m.to === 'a@x.co' && m.subject.startsWith('See your whole week')) && !!db.get('emailOnboarding/a@x.co').sent.calendar);
  ok('b got the calendar tip on day 7', sent.some(m => m.to === 'b@x.co' && m.subject === 'See your whole week at a glance'));
  void rec;
}
{
  const { w, env, sent, db } = setup();
  env.RESEND_DAILY_LIMIT = '2'; // onboarding's share of 2 is 1
  const start = Date.parse('2026-10-01T13:00:00Z');
  for (const x of ['p', 'q', 'r']) {
    db.set(`emailOnboarding/${x}@x.co`, { email: `${x}@x.co`, uid: x, plan: 'plus', active: true, startedAt: new Date(start), lastSentAt: new Date(start), sent: {}, skipped: {}, did: {} });
    db.set(`licenses/${x}`, { paid: true });
  }
  const out = await w.runOnboardingEmails(env, start + 3 * DAY);
  check('out of budget: one sent, the rest wait for tomorrow', [out.sent, out.held, sent.length], [1, 'budget', 1]);
  const waiting = ['p', 'q', 'r'].filter(x => !db.get(`emailOnboarding/${x}@x.co`).sent.syllabus).length;
  check('and nothing is marked sent for them', waiting, 2);
  check('their log claims were released', [...db.keys()].filter(k => k.startsWith('emailLog/')).length, 1);
}

/* ── Unsubscribe links and the app's settings ─────────────────────── */
{
  const { w, env, db } = setup();
  const e = 'student@school.edu';
  const t = await w.emailLinkToken(env, e);
  const bad = await w.handleEmailLink(new Request(`https://w/email/unsubscribe?e=${e}&t=wrongwrongwrongwrongwrongwrong12`, { method: 'POST' }), env, '/email/unsubscribe');
  check('a forged link is refused', bad.status, 400);
  check('and changes nothing', db.has(`emailPrefs/${e}`), false);
  const other = await w.handleEmailLink(new Request(`https://w/email/unsubscribe?e=other@school.edu&t=${t}`, { method: 'POST' }), env, '/email/unsubscribe');
  check('one person\'s link can\'t unsubscribe another', other.status, 400);
  const one = await w.handleEmailLink(new Request(`https://w/email/unsubscribe?e=${encodeURIComponent(e)}&t=${t}`, { method: 'POST', body: 'List-Unsubscribe=One-Click' }), env, '/email/unsubscribe');
  check('one-click unsubscribe works', [one.status, db.get(`emailPrefs/${e}`).tips, db.get(`emailPrefs/${e}`).via], [200, false, 'one-click']);
  const back = await w.handleEmailLink(new Request('https://w/email/prefs', { method: 'POST', body: JSON.stringify({ e, t, tips: true }) }), env, '/email/prefs');
  check('the settings page can turn them back on', [back.status, db.get(`emailPrefs/${e}`).tips], [200, true]);
  const get = await (await w.handleEmailLink(new Request('https://w/email/prefs', { method: 'POST', body: JSON.stringify({ e, t }) }), env, '/email/prefs')).json();
  check('and read the setting', get.tips, true);
}
{
  const { w, env, db } = setup();
  const call = (body) => w.handleAccountEmail(new Request('https://w/account/email', { method: 'POST', body: JSON.stringify(body) }), env, 'https://app.semester-hq.com');
  check('no sign-in, no settings', (await call({ idToken: 'bad', action: 'status' })).status, 401);
  await call({ idToken: 'good', action: 'progress', hasClass: true });
  check('progress without a record starts nothing', db.has('emailOnboarding/student@school.edu'), false);
  db.set('emailOnboarding/student@school.edu', { email: 'student@school.edu', active: true, did: {} });
  await call({ idToken: 'good', action: 'progress', hasClass: true, hasFeed: false, inGroup: 'yes', sneaky: true });
  check('only real true flags are recorded', db.get('emailOnboarding/student@school.edu').did, { hasClass: true });
  await call({ idToken: 'good', action: 'set', tips: false });
  check('Settings can turn the tips off', db.get('emailPrefs/student@school.edu').tips, false);
  check('and reads them back', (await (await call({ idToken: 'good', action: 'status' })).json()).tips, false);
}

/* ── Webhook, seat and account deletion paths ─────────────────────── */
{
  const { w, env, sent, db } = setup();
  env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
  w.verifyStripeSignature = async () => true;
  w.patchFirestoreDoc = async (env2, path, fields) => { db.set(path, { ...(db.get(path) || {}), ...fields }); };
  const hook = (event) => w.handleStripeWebhook(new Request('https://x/stripe-webhook', { method: 'POST', body: JSON.stringify(event), headers: { 'Stripe-Signature': 't=1,v1=x' } }), env);
  const res = await hook({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_9', payment_status: 'paid', client_reference_id: 'uid7', customer_details: { email: 'New@Student.edu' }, subscription: 'sub_1', customer: 'cus_1' } } });
  check('the webhook still answers ok', res.status, 200);
  check('and the receipt and welcome went', sent.map(m => m.subject), ['Your Semester HQ Plus subscription is active', 'Welcome to Semester HQ']);
  await hook({ id: 'evt_2', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', status: 'canceled', customer: 'cus_1', metadata: { uid: 'uid7', email: 'new@student.edu' } } } });
  check('cancelling stops the tips', [db.get('emailOnboarding/new@student.edu').active, db.get('emailOnboarding/new@student.edu').stopReason], [false, 'cancelled']);

  await w.forgetCustomerEmails(env, 'new@student.edu');
  ok('deleting the account removes the record and every log entry', !db.has('emailOnboarding/new@student.edu') && ![...db.keys()].some(k => k.startsWith('emailLog/')));
}
{
  const { w, env, sent } = setup({ resendOk: false });
  await w.startCustomerEmails(env, { email: 'x@y.co', plan: 'plus', sessionId: 'cs_z' });
  ok('Resend being down never throws out of a purchase', true);
  check('it tried', sent.length >= 1, true);
}

/* ── The test send only ever goes to hello@ ───────────────────────── */
{
  const { w, env, sent } = setup();
  const res = await w.handleAdminEmailTest(new Request('https://w/admin/email-test?to=someone@else.com', { method: 'POST', headers: { Authorization: 'Bearer admintoken' } }), env);
  const body = await res.json();
  check('every email once', body.results.length, 10);
  ok('all to hello@, whatever is asked', sent.every(m => m.to === 'hello@semester-hq.com'));
  ok('marked as tests', sent.every(m => m.subject.startsWith('[Test] ')));
  const denied = await w.handleAdminEmailTest(new Request('https://w/admin/email-test', { method: 'POST' }), env);
  check('no token, no test', denied.status, 401);
  const run = await w.handleAdminOnboardingRun(new Request('https://w/admin/onboarding-run', { method: 'POST', headers: { Authorization: 'Bearer admintoken' } }), env);
  check('the time-travel run exists only on staging', run.status, 404);
}

/* ── A held email says so; the by-hand start is staging only ──────── */
{
  const { w, env, sent, db } = setup();
  const issues = [];
  w.logServerIssue = async (env2, feature, message) => { issues.push([feature, message]); };
  env.MAIL_ALLOWLIST = 'me@x.co';
  await w.startCustomerEmails(env, { email: 'stranger@school.edu', plan: 'plus', sessionId: 'cs_h' });
  check('nothing goes to an address off the allow-list', sent.length, 0);
  check('and it is logged, not silent', issues.map(i => i[1]), ['The receipt email was held: the address is not on MAIL_ALLOWLIST', 'The welcome email was held: the address is not on MAIL_ALLOWLIST']);
  const prod = await w.handleAdminOnboardingStart(new Request('https://w/admin/onboarding-start', { method: 'POST', headers: { Authorization: 'Bearer admintoken' }, body: '{}' }), env);
  check('the by-hand start does not exist in production', prod.status, 404);
  env.STAGING = '1';
  env.MAIL_ALLOWLIST = 'me@x.co,stranger@school.edu';
  const res = await w.handleAdminOnboardingStart(new Request('https://w/admin/onboarding-start', { method: 'POST', headers: { Authorization: 'Bearer admintoken' }, body: JSON.stringify({ email: 'stranger@school.edu' }) }), env);
  check('on staging it starts the emails', [res.status, sent.map(m => m.subject)], [200, ['Your Semester HQ Plus subscription is active', 'Welcome to Semester HQ']]);
  const again = await w.handleAdminOnboardingStart(new Request('https://w/admin/onboarding-start', { method: 'POST', headers: { Authorization: 'Bearer admintoken' }, body: JSON.stringify({ email: 'stranger@school.edu' }) }), env);
  check('and running it again sends nothing twice', [again.status, sent.length], [200, 2]);
  const noToken = await w.handleAdminOnboardingStart(new Request('https://w/admin/onboarding-start', { method: 'POST', body: '{}' }), env);
  check('it needs the admin token', noToken.status, 401);
  void db;
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
