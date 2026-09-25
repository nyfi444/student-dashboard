/* ── What the Worker measures for the Business OS ─────────────────
   Runs the real functions from worker/src against fixtures, with fake
   Stripe, fake Firestore and no network, and checks the numbers the
   Business OS will be built on — and that measuring never gets in the
   way of the thing being measured:

   - subscriber rows read discounts in both Stripe shapes, keep every old
     field, and say who signed in with one query
   - every checkout is labeled with its path and a link code only when
     the code is well formed; old sessions are classified by one rule
   - the daily ledger writes only complete, missing days, add-only, with
     null (not 0) where a number isn't known
   - AI usage is counted per feature and model, and a failure to count
     never touches the student's reply
   - /track-event takes the new setup and group events and nothing else
   - the business summary only ever gains keys; the admin routes need the
     token

   Run:  node tests/worker-measure.mjs
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

// A fresh copy of the Worker per section, so one section's fakes can never
// leak into the next. See tests/worker-source.mjs for why it's a script.
function freshWorker() {
  const box = {
    console: { ...console, error() {} }, // the code under test logs its caught failures; keep the output to results
    crypto, setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, TextDecoder, atob, btoa, URL, URLSearchParams, Response, Request, Headers,
    ReadableStream, TransformStream,
    Uint8Array, ArrayBuffer, DataView,
    fetch: () => { throw new Error('no network in tests'); },
  };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(src, box, { filename: 'worker/src (flattened)' });
  return box;
}
const jsonOf = async (res) => JSON.parse(await res.text());
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const FIREBASE = { FIREBASE_PROJECT_ID: 'semester-hq', FIREBASE_CLIENT_EMAIL: 'sa@x', FIREBASE_PRIVATE_KEY: 'k' };

/* ── Subscriber rows: both discount shapes, old fields kept ──────── */
{
  const w = freshWorker();
  const base = { id: 'sub_1', status: 'active', created: 1790000000, customer: { id: 'cus_1', email: 'a@x.com', name: 'Ana' }, items: { data: [{ quantity: 1, price: { unit_amount: 799 } }] }, metadata: {} };
  const legacy = {
    ...base,
    discount: { coupon: { id: 'FALL50', name: 'Fall half off', duration: 'repeating', percent_off: 50, amount_off: null }, promotion_code: { id: 'promo_1', code: 'CAMPUS50' }, end: 1800000000 },
    cancellation_details: { reason: 'cancellation_requested', feedback: 'too_expensive', comment: '  ' + 'x'.repeat(300) + '  ' },
    metadata: { via: 'campus-tour' },
  };
  const row = w.subscriberRow(legacy, { created: 1790000000000, listCents: 799, chargedCents: 400 });
  check('legacy discount: the promotion code a person typed', row.promoCode, 'CAMPUS50');
  check('legacy discount: coupon id, duration, percent', [row.couponId, row.couponDuration, row.couponPercentOff, row.couponAmountOffCents], ['FALL50', 'repeating', 50, null]);
  check('legacy discount: when it ends, in ms', row.discountEnd, 1800000000000);
  check('legacy discount: the old coupon field is unchanged', row.coupon, 'Fall half off');
  check('cancellation: reason and feedback', [row.cancelReason, row.cancelFeedback], ['cancellation_requested', 'too_expensive']);
  check('cancellation: comment trimmed to 200 characters', row.cancelComment.length, 200);
  check('via: kept when well formed', row.via, 'campus-tour');
  check('signedIn: null until the lookup runs', row.signedIn, null);
  check('every field the Business OS already reads is still there', ['id', 'customerId', 'email', 'name', 'status', 'plan', 'seats', 'groupName', 'coupon', 'comped', 'created', 'canceledAt', 'endedAt', 'cancelAtPeriodEnd', 'periodEnd', 'listCents', 'chargedCents'].filter(k => !(k in row)), []);
  check('old fields keep their values', [row.id, row.customerId, row.email, row.name, row.plan, row.seats, row.comped, row.listCents, row.chargedCents], ['sub_1', 'cus_1', 'a@x.com', 'Ana', 'plus', 1, false, 799, 400]);

  // Newest shape: discounts[] expanded, coupon as an id under source,
  // promotion code expanded.
  const newest = { ...base, id: 'sub_2', discounts: [{ id: 'di_1', source: { type: 'coupon', coupon: 'FREEMO' }, promotion_code: { id: 'promo_2', code: 'FRIENDS' }, end: null }] };
  const r2 = w.subscriberRow(newest, { created: 1, listCents: 799, chargedCents: 0 });
  check('newest shape: promotion code read from discounts[]', r2.promoCode, 'FRIENDS');
  check('newest shape: coupon id read from source.coupon', r2.couponId, 'FREEMO');
  check('newest shape: no end means null', r2.discountEnd, null);
  // In-between shape: discounts[] with the coupon object inline.
  const mid = { ...base, id: 'sub_3', discounts: [{ id: 'di_2', coupon: { id: 'HALF', duration: 'once', amount_off: 300 }, promotion_code: 'promo_3' }] };
  const r3 = w.subscriberRow(mid, { created: 1, listCents: 799, chargedCents: 499 });
  check('middle shape: coupon object under discounts[].coupon', [r3.couponId, r3.couponDuration, r3.couponAmountOffCents], ['HALF', 'once', 300]);
  check('middle shape: an unexpanded promotion code is blank until looked up', r3.promoCode, '');
  const none = w.subscriberRow({ ...base, id: 'sub_4' }, { created: 1, listCents: 799, chargedCents: 799 });
  check('no discount: blanks and nulls, never made up', [none.promoCode, none.couponId, none.couponDuration, none.couponPercentOff, none.couponAmountOffCents, none.discountEnd, none.cancelReason, none.via, none.planId], ['', '', '', null, null, null, '', '', '']);
  const group = w.subscriberRow({ ...base, id: 'sub_5', metadata: { kind: 'group', planId: 'PLANabc123456', via: 'Bad Via!' }, items: { data: [{ quantity: 8, price: { unit_amount: 599 } }] } }, { created: 1, listCents: 4792, chargedCents: 4792 });
  check('group: plan id from the metadata groups.js sets', [group.plan, group.planId, group.seats], ['group', 'PLANabc123456', 8]);
  check('via: a malformed code in metadata is not shown', group.via, '');

  // The bulk lookups: one list call each for ids Stripe left unexpanded.
  const calls = [];
  w.fetch = async (url) => {
    const u = String(url); calls.push(u);
    if (u.includes('/v1/promotion_codes')) return json({ data: [{ id: 'promo_3', code: 'HALFOFF' }], has_more: false });
    if (u.includes('/v1/coupons')) return json({ data: [{ id: 'FREEMO', name: 'Free month', duration: 'once', percent_off: 100 }], has_more: false });
    throw new Error('unexpected ' + u);
  };
  const rows = [r2, r3, none];
  await w.finishSubscriberRows({ STRIPE_SECRET_KEY: 'sk_test' }, rows, Date.now());
  check('lookup: an unexpanded promotion code is filled in from one list call', r3.promoCode, 'HALFOFF');
  check('lookup: an unexpanded coupon gets its duration and percent', [r2.couponDuration, r2.couponPercentOff, r2.coupon], ['once', 100, 'FREEMO']);
  check('lookup: one call for codes, one for coupons', [calls.filter(c => c.includes('promotion_codes')).length, calls.filter(c => c.includes('coupons')).length], [1, 1]);
  check('lookup: the internal ids are gone from the rows', rows.some(r => '_promoId' in r || '_couponLookup' in r), false);
  w.fetch = async () => json({ error: { message: 'down' } }, 500);
  const r6 = w.subscriberRow(mid, { created: 1, listCents: 799, chargedCents: 499 });
  await w.finishSubscriberRows({ STRIPE_SECRET_KEY: 'sk_test' }, [r6], Date.now());
  check('lookup: Stripe failing leaves the code blank, not an error', r6.promoCode, '');
}

/* ── Who signed in: one query, true / false / null ─────────────── */
{
  const w = freshWorker();
  const now = Date.UTC(2026, 8, 23);
  const day = 24 * 60 * 60 * 1000;
  const rows = [
    { id: 'sub_claimed', customerId: 'cus_a', plan: 'plus', created: now - 5 * day, signedIn: null },
    { id: 'sub_customer', customerId: 'cus_b', plan: 'plus', created: now - 10 * day, signedIn: null },
    { id: 'sub_never', customerId: 'cus_c', plan: 'plus', created: now - 20 * day, signedIn: null },
    { id: 'sub_old', customerId: 'cus_d', plan: 'plus', created: now - 90 * day, signedIn: null },
    { id: 'sub_group', customerId: 'cus_e', plan: 'group', created: now - 1 * day, signedIn: null },
  ];
  const queries = [];
  w.runFirestoreQuery = async (env, q) => { queries.push(q); return [{ id: 'u1', stripeSubscriptionId: 'sub_claimed' }, { id: 'u2', stripeCustomerId: 'cus_b', stripeSubscriptionId: 'sub_other' }]; };
  await w.annotateSignedIn(FIREBASE, rows, now);
  check('signedIn: a license naming the subscription', rows[0].signedIn, true);
  check('signedIn: a license naming the customer', rows[1].signedIn, true);
  check('signedIn: no license yet', rows[2].signedIn, false);
  check('signedIn: older than 60 days is unknown', rows[3].signedIn, null);
  check('signedIn: group plans are not asked about', rows[4].signedIn, null);
  check('signedIn: one query for every row', queries.length, 1);
  check('signedIn: the query is by purchase date, licenses only', [queries[0].from[0].collectionId, queries[0].where.fieldFilter.field.fieldPath], ['licenses', 'purchasedAt']);
  const noFb = [{ id: 's', plan: 'plus', created: now, signedIn: null }];
  await w.annotateSignedIn({}, noFb, now);
  check('signedIn: without Firebase it stays unknown', noFb[0].signedIn, null);
}

/* ── The subscription list survives an API version that refuses the
      discount expansions ─────────────────────────────────────────── */
{
  const w = freshWorker();
  const urls = [];
  w.fetch = async (url) => {
    const u = String(url); urls.push(u);
    if (u.includes('/v1/subscriptions?')) {
      if (u.includes('data.discounts')) return json({ error: { message: 'This property cannot be expanded (discounts).' } }, 400);
      return json({ data: [{ id: 'sub_1', status: 'active', created: 1790000000, customer: 'cus_1', items: { data: [{ quantity: 1, price: { unit_amount: 799 } }] }, latest_invoice: { total: 799 }, metadata: {} }], has_more: false });
    }
    if (u.includes('/v1/charges') || u.includes('/v1/balance_transactions') || u.includes('/v1/payouts') || u.includes('/v1/customers')) return json({ data: [], has_more: false });
    throw new Error('unexpected ' + u);
  };
  const s = await w.fetchStripeSummary({ STRIPE_SECRET_KEY: 'sk_test' });
  check('expansion refused: the summary still loads', [s.payingCount, s.subscribers.length], [1, 1]);
  check('expansion refused: asked once with, once without', urls.filter(u => u.includes('/v1/subscriptions?')).map(u => u.includes('data.discounts')), [true, false]);
  check('expansion refused: the row still has every new field', ['promoCode', 'couponId', 'couponDuration', 'couponPercentOff', 'couponAmountOffCents', 'discountEnd', 'cancelReason', 'cancelFeedback', 'cancelComment', 'planId', 'via', 'signedIn'].filter(k => !(k in s.subscribers[0])), []);
}

/* ── Checkout paths ──────────────────────────────────────────────── */
{
  const w = freshWorker();
  check('path: metadata.source is read exactly', w.checkoutPath({ metadata: { source: 'signup' }, client_reference_id: 'u1' }), 'signup');
  check('path: an unknown source falls back to the old rule', w.checkoutPath({ metadata: { source: 'bogus' }, customer_email: 'a@x.com' }), 'signup');
  check('path (old): a group session, even with a uid on it', w.checkoutPath({ metadata: { kind: 'group' }, client_reference_id: 'u1' }), 'group');
  check('path (old): a uid means the in-app paywall', w.checkoutPath({ metadata: {}, client_reference_id: 'u1', customer_email: 'a@x.com' }), 'paywall');
  check('path (old): a prefilled email means the email-first sign-up', w.checkoutPath({ customer_email: 'a@x.com', customer_details: { email: 'a@x.com' } }), 'signup');
  check('path (old): nothing prefilled means the pricing page', w.checkoutPath({ customer_details: { email: 'filled@in.by.stripe' } }), 'pricing');
  check('source for a new session', [w.checkoutSourceFor({ group: true, uid: 'u' }), w.checkoutSourceFor({ uid: 'u', email: 'e' }), w.checkoutSourceFor({ email: 'e' }), w.checkoutSourceFor({})], ['group', 'paywall', 'signup', 'pricing']);

  const since = Date.UTC(2026, 7, 24);
  const at = (d) => Math.floor(Date.UTC(2026, 8, d, 15) / 1000);
  const sessions = [
    { created: at(20), status: 'complete', metadata: { source: 'pricing', via: 'campus-tour' } },
    { created: at(20), status: 'open', metadata: { source: 'pricing', via: 'campus-tour' } },
    { created: at(21), status: 'expired', client_reference_id: 'u1', metadata: {} },
    { created: at(21), status: 'complete', metadata: { kind: 'group', via: 'NOT OK' } },
    { created: Math.floor(Date.UTC(2026, 6, 1) / 1000), status: 'complete', metadata: { source: 'signup' } },
  ];
  const sum = w.summarizeCheckouts(sessions, { since, truncated: false });
  check('summary: opened and completed per path', sum.byPath, { group: { opened: 1, completed: 1 }, signup: { opened: 0, completed: 0 }, paywall: { opened: 1, completed: 0 }, pricing: { opened: 2, completed: 1 } });
  check('summary: per UTC day', sum.byDay, { '2026-09-20': { opened: 2, completed: 1 }, '2026-09-21': { opened: 2, completed: 1 } });
  check('summary: per link code, malformed ones left out', sum.byVia, { 'campus-tour': { opened: 2, completed: 1 } });
  check('summary: since and truncated are reported', [sum.since, sum.truncated], [since, false]);

  // Paginates, stops at the window, reports truncation at the cap.
  let pages = 0;
  w.fetch = async (url) => {
    pages++;
    const u = String(url);
    ok('list: asks for the last 30 days', u.includes('created[gte]='));
    return json({ data: Array.from({ length: 100 }, (_, i) => ({ id: `cs_${pages}_${i}`, created: Math.floor(Date.now() / 1000) - 60, status: 'complete', metadata: {} })), has_more: true });
  };
  const capped = await w.fetchCheckoutSummary({ STRIPE_SECRET_KEY: 'sk_test' });
  check('list: stops at the page cap and says so', [pages, capped.truncated, capped.byPath.pricing.opened], [10, true, 1000]);
}

/* ── Link codes on the checkouts the Worker creates ────────────── */
{
  const w = freshWorker();
  check('via: a well-formed code', w.cleanVia('campus-tour'), 'campus-tour');
  check('via: too short, too long, uppercase, spaces, markup, not a string', ['a', 'x'.repeat(25), 'Campus', 'a b', '<b>x</b>', 12345, null, undefined, 'ok_no'].map(w.cleanVia), ['', '', '', '', '', '', '', '', '']);
  check('via: 24 characters is the most', w.cleanVia('x'.repeat(24)), 'x'.repeat(24));

  const env = { STRIPE_SECRET_KEY: 'sk_test_x', APP_URL: 'https://app.semester-hq.com/', FIREBASE_PROJECT_ID: 'semester-hq', ALLOWED_ORIGIN: '' };
  let params = null;
  w.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.stripe.com/v1/checkout/sessions')) { params = new URLSearchParams(init.body); return json({ url: 'https://checkout.stripe.com/x' }); }
    throw new Error('unexpected ' + url);
  };
  w.verifyFirebaseIdToken = async (t) => { if (t !== 'good') throw new Error('bad'); return { sub: 'holder-1', email: 'h@x.com', email_verified: true }; };
  const post = (body) => new Request('https://w/create-checkout-session', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

  await w.handleCreateCheckoutSession(post({ via: 'campus-tour' }), env, '');
  check('checkout: the pricing page is labeled pricing, on session and subscription', [params.get('metadata[source]'), params.get('subscription_data[metadata][source]')], ['pricing', 'pricing']);
  check('checkout: a good link code is kept on both', [params.get('metadata[via]'), params.get('subscription_data[metadata][via]')], ['campus-tour', 'campus-tour']);
  await w.handleCreateCheckoutSession(post({ email: 'New@X.com', via: 'Campus Tour!' }), env, '');
  check('checkout: the email-first flow is labeled signup', params.get('metadata[source]'), 'signup');
  check('checkout: a malformed link code is dropped without a word', [params.get('metadata[via]'), params.get('subscription_data[metadata][via]')], [null, null]);
  await w.handleCreateCheckoutSession(post({ idToken: 'good', via: 'x'.repeat(40) }), env, '');
  check('checkout: a signed-in buyer is the paywall', params.get('metadata[source]'), 'paywall');
  check('checkout: an overlong code is dropped', params.get('metadata[via]'), null);
  check('checkout: nothing else about the visitor is added to metadata', [...params.keys()].filter(k => k.startsWith('metadata[')).sort(), ['metadata[source]']);

  // The group checkout gets the same labels.
  w.readFirestoreDoc = async () => null;
  w.patchFirestoreDoc = async () => {};
  w.runFirestoreQuery = async () => [];
  const gpost = (body) => new Request('https://w/group/create-checkout', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  const res = await w.handleGroupRoute('create-checkout', gpost({ idToken: 'good', name: 'Chess Club', kind: 'club', seats: 6, via: 'club-fair' }), env, '');
  check('group checkout: still starts', res.status, 200);
  check('group checkout: labeled group, with the link code, on both', [params.get('metadata[source]'), params.get('subscription_data[metadata][source]'), params.get('metadata[via]'), params.get('subscription_data[metadata][via]')], ['group', 'group', 'club-fair', 'club-fair']);
  check('group checkout: the metadata the webhook needs is unchanged', [params.get('metadata[kind]'), !!params.get('metadata[planId]')], ['group', true]);
}

/* ── The daily ledger ────────────────────────────────────────────── */
{
  const w = freshWorker();
  const now = Date.UTC(2026, 8, 23, 13, 0, 0); // the cron, 13:00 UTC
  check('ledger window: the seven complete days before today, oldest first', w.ledgerWindow(now), ['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22']);
  check('ledger window: just after midnight, today is still not included', w.ledgerWindow(Date.UTC(2026, 8, 23, 0, 0, 1)).at(-1), '2026-09-22');

  const evs = [
    { event: 'get_started_click', createdAt: '2026-09-22T10:00:00Z' },
    { event: 'get_started_click', createdAt: '2026-09-22T11:00:00Z' },
    { event: 'syllabus_read', createdAt: '2026-09-22T12:00:00Z', detail: { outcome: 'parsed' } },
    { event: 'syllabus_kept', createdAt: '2026-09-22T12:05:00Z', detail: { offered: 10, kept: 8 } },
  ];
  const stripe = { payingCount: 3, compedCount: 1, pastDueCount: 0, cancelingCount: 1, groupPlanCount: 1, groupSeatCount: 6, netMrrCents: 5993, fetchedAt: now - 1000 };
  const row = w.buildLedgerRow({ date: '2026-09-22', dayEvents: evs, traffic: { days: [{ date: '2026-09-22', uniques: 40, pageViews: 90 }] }, stripe, previousLastFired: { nav_login_click: 111 }, now });
  check('row: events counted', row.events, { get_started_click: 2, syllabus_read: 1, syllabus_kept: 1 });
  check('row: syllabus reads and keeps', row.syllabus, { reads: 1, parsed: 1, reviewed: 1, offered: 10, kept: 8 });
  check('row: traffic for the day', [row.uniques, row.pageViews], [40, 90]);
  check('row: the Stripe snapshot and when it was taken', [row.stripe, row.stripeAt], [{ paying: 3, comped: 1, pastDue: 0, canceling: 1, groupPlans: 1, groupSeats: 6, netMrrCents: 5993 }, now - 1000]);
  check('row: lastFired carries earlier events forward and adds the day', row.lastFired, { nav_login_click: 111, get_started_click: Date.parse('2026-09-22T11:00:00Z'), syllabus_read: Date.parse('2026-09-22T12:00:00Z'), syllabus_kept: Date.parse('2026-09-22T12:05:00Z') });
  const bare = w.buildLedgerRow({ date: '2026-09-16', dayEvents: [], traffic: null, stripe: null, now });
  check('row: no Cloudflare means null traffic, not 0', [bare.uniques, bare.pageViews], [null, null]);
  check('row: a backfilled day has no Stripe snapshot', [bare.stripe, bare.stripeAt], [null, null]);
  const outOfRange = w.buildLedgerRow({ date: '2026-09-01', traffic: { days: [{ date: '2026-09-22', uniques: 5, pageViews: 5 }] }, now });
  check('row: a day Cloudflare no longer has is null too', [outOfRange.uniques, outOfRange.pageViews], [null, null]);
  check('row: every field in the documented shape', Object.keys(row).sort(), ['date', 'events', 'eventsCapped', 'lastFired', 'pageViews', 'stripe', 'stripeAt', 'syllabus', 'uniques', 'writtenAt'].sort());

  // Writing: only the missing days, add-only, Stripe on the newest only.
  const existing = { 'bizLedger/2026-09-16': { date: '2026-09-16', lastFired: { a: 1 } }, 'bizLedger/2026-09-18': { date: '2026-09-18', lastFired: { b: 2 } } };
  const commits = [];
  const queries = [];
  w.batchGetFirestoreDocs = async (env, paths) => Object.fromEntries(paths.map(p => [p, existing[p] || null]));
  w.runFirestoreQuery = async (env, q) => {
    queries.push(q);
    if (q.from[0].collectionId === 'bizLedger') return [{ id: '2026-09-10', lastFired: { old: 5 } }];
    const from = q.where.compositeFilter.filters[0].fieldFilter.value.timestampValue.slice(0, 10);
    return from === '2026-09-21' ? [{ event: 'try_it_free_click', createdAt: '2026-09-21T09:00:00Z' }] : [];
  };
  w.commitFirestore = async (env, writes) => { commits.push(...writes); return writes[0].path !== 'bizLedger/2026-09-20'; }; // 09-20 "already written by another run"
  let written = await w.writeDailyLedger(FIREBASE, { stripeReady: Promise.resolve(stripe), now });
  check('write: only days without a row are written', commits.map(c => c.path), ['2026-09-17', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22'].map(d => `bizLedger/${d}`));
  check('write: every write is add-only', commits.every(c => c.exists === false), true);
  check('write: a day another run already wrote is left alone, not retried', written, ['2026-09-17', '2026-09-19', '2026-09-21', '2026-09-22']);
  check('write: the Stripe snapshot only on the newest day', commits.map(c => c.fields.stripe ? 'stripe' : null), [null, null, null, null, 'stripe']);
  check('write: no Cloudflare configured, traffic is null', commits.every(c => c.fields.uniques === null && c.fields.pageViews === null), true);
  check('write: lastFired carries through rows that already existed', commits.at(-1).fields.lastFired, { old: 5, a: 1, b: 2, try_it_free_click: Date.parse('2026-09-21T09:00:00Z') });
  check('write: each day is read by its own UTC bounds', queries.filter(q => q.from[0].collectionId === 'events').map(q => q.where.compositeFilter.filters.map(f => f.fieldFilter.value.timestampValue.slice(0, 10))).at(-1), ['2026-09-22', '2026-09-23']);

  commits.length = 0;
  w.batchGetFirestoreDocs = async (env, paths) => Object.fromEntries(paths.map(p => [p, { date: p.slice(-10) }]));
  written = await w.writeDailyLedger(FIREBASE, { stripeReady: Promise.resolve(stripe), now });
  check('write: a week already written writes nothing', [written, commits.length], [[], 0]);
  check('write: without Firebase it does nothing', await w.writeDailyLedger({}, { now }), []);

  // A stored null reaches Firestore as a null, not the string "null".
  check('encoding: null is Firestore null', w.toFirestoreValue(null), { nullValue: null });
  check('encoding: a row with nulls encodes them as nulls', w.toFirestoreFields({ uniques: null }).uniques, { nullValue: null });

  // The route: token, days clamp, nulls restored.
  check('days: default 120', [w.ledgerDaysParam(null), w.ledgerDaysParam('abc'), w.ledgerDaysParam('0'), w.ledgerDaysParam('-5')], [120, 120, 120, 120]);
  check('days: at most 400', [w.ledgerDaysParam('30'), w.ledgerDaysParam('400'), w.ledgerDaysParam('9999')], [30, 400, 400]);
  check('out: nulls dropped by the Firestore decoder come back as null', w.ledgerRowOut({ id: '2026-09-16', date: '2026-09-16', events: {}, writtenAt: 5 }), { date: '2026-09-16', uniques: null, pageViews: null, events: {}, eventsCapped: false, syllabus: { reads: 0, parsed: 0, reviewed: 0, offered: 0, kept: 0 }, stripe: null, stripeAt: null, lastFired: {}, writtenAt: 5 });

  const env = { ...FIREBASE, ADMIN_TOKEN: 'correct-horse-battery-staple' };
  const get = (path, token) => new Request(`https://w${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let ledgerQuery = null;
  w.runFirestoreQuery = async (e, q) => { ledgerQuery = q; return [{ id: '2026-09-22', date: '2026-09-22', events: { a: 1 }, writtenAt: 9 }, { id: '2026-09-21', date: '2026-09-21', uniques: 4, pageViews: 7, events: {}, writtenAt: 8 }]; };
  let res = await w.handleAdminLedger(get('/admin/ledger'), env);
  check('route: no token is a 401', res.status, 401);
  res = await w.handleAdminLedger(get('/admin/ledger', 'nope-nope-nope-nope-nope-nope'), env);
  check('route: a wrong token is a 401', res.status, 401);
  check('route: and nothing was read', ledgerQuery, null);
  res = await w.handleAdminLedger(get('/admin/ledger?days=9999', 'correct-horse-battery-staple'), env);
  const body = await jsonOf(res);
  check('route: the right token gets rows, oldest first', body.rows.map(r => r.date), ['2026-09-21', '2026-09-22']);
  check('route: days is clamped', body.days, 400);
  check('route: a missing number is null', [body.rows[1].uniques, body.rows[0].uniques], [null, 4]);
  res = await w.handleAdminLedger(get('/admin/ledger', 'correct-horse-battery-staple'), { ...FIREBASE });
  check('route: no ADMIN_TOKEN set on the server is a 500, never open', res.status, 500);
  // Through the front door, as the Business OS will call it.
  res = await w.__worker.fetch(get('/admin/ledger'), env, { waitUntil() {} });
  check('router: /admin/ledger is wired and token-gated', res.status, 401);
  res = await w.__worker.fetch(new Request('https://w/admin/ledger', { method: 'OPTIONS' }), env, { waitUntil() {} });
  check('router: its preflight allows GET with a token', [res.headers.get('Access-Control-Allow-Methods'), res.headers.get('Access-Control-Allow-Headers')], ['GET, OPTIONS', 'authorization']);
}

/* ── AI usage: counted, and never in the way ─────────────────────── */
{
  const w = freshWorker();
  check('feature: known labels pass', ['syllabus', 'flashcards', 'project-plan'].map(w.aiUsageFeature), ['syllabus', 'flashcards', 'project-plan']);
  check('feature: anything else is untagged', ['', undefined, 'x'.repeat(30), 'byFeature.evil', '`'].map(w.aiUsageFeature), ['untagged', 'untagged', 'untagged', 'untagged', 'untagged']);
  const inc = w.aiUsageIncrements('project-plan', 'claude-sonnet-5', { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 });
  check('increments: per feature, per model, per feature and model, dashes quoted', Object.keys(inc).sort(), [
    'byFeature.`project-plan`.cacheReadTokens', 'byFeature.`project-plan`.calls', 'byFeature.`project-plan`.inputTokens', 'byFeature.`project-plan`.outputTokens',
    'byFeatureModel.`project-plan`.`claude-sonnet-5`.cacheReadTokens', 'byFeatureModel.`project-plan`.`claude-sonnet-5`.calls', 'byFeatureModel.`project-plan`.`claude-sonnet-5`.inputTokens', 'byFeatureModel.`project-plan`.`claude-sonnet-5`.outputTokens',
    'byModel.`claude-sonnet-5`.cacheReadTokens', 'byModel.`claude-sonnet-5`.calls', 'byModel.`claude-sonnet-5`.inputTokens', 'byModel.`claude-sonnet-5`.outputTokens',
  ].sort());
  check('increments: plain names stay plain', Object.keys(w.aiUsageIncrements('syllabus', 'claude-sonnet-5', {}))[0], 'byFeature.syllabus.calls');
  check('increments: absurd counts are clamped', w.aiUsageIncrements('syllabus', 'claude-sonnet-5', { input_tokens: 1e12 })['byFeature.syllabus.inputTokens'], 10000000);

  // The real commit, down to the request body Firestore gets.
  let committed = null;
  w.getFirebaseAccessToken = async () => 'token';
  w.fetch = async (url, init) => { committed = { url: String(url), body: JSON.parse(init.body) }; return json({}); };
  const day = Date.UTC(2026, 8, 23, 18);
  check('record: resolves true on a good write', await w.recordAiUsage(FIREBASE, { feature: 'syllabus', model: 'claude-sonnet-5', usage: { input_tokens: 10, output_tokens: 2 }, now: day }), true);
  const write = committed.body.writes[0];
  check('record: one doc per UTC day', write.update.name.endsWith('/aiUsage/2026-09-23'), true);
  check('record: counters are server-side increments, not overwrites', write.updateTransforms.find(t => t.fieldPath === 'byFeature.syllabus.calls'), { fieldPath: 'byFeature.syllabus.calls', increment: { integerValue: '1' } });
  check('record: only the date is set directly', write.updateMask.fieldPaths, ['date']);

  w.commitFirestore = async () => { throw new Error('Firestore is down'); };
  let threw = false;
  try { check('record: a failed write resolves false', await w.recordAiUsage(FIREBASE, { feature: 'syllabus', model: 'claude-sonnet-5', usage: {} }), false); } catch { threw = true; }
  check('record: a failed write never throws', threw, false);
  check('record: without Firebase it does nothing', await w.recordAiUsage({}, { feature: 'x', model: 'y', usage: {} }), false);
  threw = false;
  const handed = [];
  try {
    w.noteAiUsage(FIREBASE, { waitUntil: (p) => handed.push(p) }, { feature: 'syllabus', model: 'claude-sonnet-5', text: 'not json {' });
    w.noteAiUsage(FIREBASE, { waitUntil: () => { throw new Error('no ctx'); } }, { feature: 'syllabus', model: 'claude-sonnet-5', text: '{"usage":{"input_tokens":1}}' });
    w.noteAiUsage(FIREBASE, null, { feature: 'syllabus', model: 'claude-sonnet-5', text: '{"usage":{"input_tokens":1}}' });
  } catch { threw = true; }
  check('note: bad JSON, a broken ctx, or no ctx never throws', threw, false);
  check('note: a reply with no usage records nothing', handed.length, 0);

  // Costs: listed prices, and null rather than a guess.
  check('cost: a million Sonnet 5 input tokens is $2', w.aiCostCents('claude-sonnet-5', { inputTokens: 1_000_000 }), 200);
  check('cost: output, cache reads and writes priced too', w.aiCostCents('claude-opus-5', { inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 }), 2500 + 50 + 625);
  check('cost: an unknown model is null, not a guess', w.aiCostCents('claude-mystery', { inputTokens: 5 }), null);
  const sum = w.summarizeAiUsage([
    { byFeature: { syllabus: { calls: 2, inputTokens: 1_000_000, outputTokens: 0 } }, byModel: { 'claude-sonnet-5': { calls: 1, inputTokens: 500_000 }, 'claude-opus-5': { calls: 1, inputTokens: 500_000 } }, byFeatureModel: { syllabus: { 'claude-sonnet-5': { calls: 1, inputTokens: 500_000 }, 'claude-opus-5': { calls: 1, inputTokens: 500_000 } } } },
    { byFeature: { flashcards: { calls: 1, outputTokens: 100_000 } }, byModel: { 'claude-sonnet-5': { calls: 1, outputTokens: 100_000 } }, byFeatureModel: { flashcards: { 'claude-sonnet-5': { calls: 1, outputTokens: 100_000 } } } },
  ]);
  check('summary: a feature on two models is priced at each one', sum.byFeature.syllabus.estCents, 100 + 250);
  check('summary: calls and tokens add up across days', [sum.byFeature.syllabus.calls, sum.byFeature.flashcards.outputTokens], [2, 100000]);
  check('summary: total', [sum.days, sum.totalEstCents], [30, 350 + 100]);
  const unknown = w.summarizeAiUsage([{ byFeature: { untagged: { calls: 1, inputTokens: 5 } }, byModel: { 'claude-mystery': { calls: 1, inputTokens: 5 } }, byFeatureModel: { untagged: { 'claude-mystery': { calls: 1, inputTokens: 5 } } } }]);
  check('summary: an unpriced model makes the total null', [unknown.byFeature.untagged.estCents, unknown.totalEstCents], [null, null]);
  check('summary: no usage at all is zero, not null', w.summarizeAiUsage([]).totalEstCents, 0);

  // The proxy end to end: the reply is untouched and the count happens
  // after it, even when counting fails.
  const env = { ...FIREBASE, ANTHROPIC_API_KEY: 'sk-ant-test', ALLOWED_ORIGIN: '' };
  w.verifyFirebaseIdToken = async () => ({ sub: 'student-1' });
  w.readFirestoreDoc = async () => ({ paid: true });
  const reply = { id: 'msg_1', content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 900, output_tokens: 80, cache_read_input_tokens: 4000 } };
  let forwarded = null;
  w.fetch = async (url, init) => { forwarded = JSON.parse(init.body); return json(reply); };
  const recorded = [];
  w.commitFirestore = async (e, writes) => { recorded.push(writes[0]); return true; };
  const waits = [];
  const aiPost = (body) => new Request('https://w/v1/messages', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  const aiBody = { idToken: 't', model: 'claude-sonnet-5', system: 's', messages: [{ role: 'user', content: 'hi' }], feature: 'flashcards' };
  let res = await w.handleAiProxy(aiPost(aiBody), env, '', { waitUntil: (p) => waits.push(p) });
  check('proxy: the reply is exactly what Anthropic sent', [res.status, await jsonOf(res)], [200, reply]);
  check('proxy: the feature label is never forwarded to Anthropic', 'feature' in forwarded, false);
  await Promise.all(waits);
  check('proxy: the count is handed to waitUntil', waits.length, 1);
  check('proxy: counted under the feature and model', [recorded[0]?.path.startsWith('aiUsage/'), recorded[0]?.increments['byFeatureModel.flashcards.`claude-sonnet-5`.inputTokens']], [true, 900]);
  w.commitFirestore = async () => { throw new Error('Firestore is down'); };
  waits.length = 0;
  res = await w.handleAiProxy(aiPost(aiBody), env, '', { waitUntil: (p) => waits.push(p) });
  let rejected = false;
  await Promise.all(waits).catch(() => { rejected = true; });
  check('proxy: counting failing changes nothing for the student', [res.status, rejected], [200, false]);
  w.fetch = async () => json({ type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }, 400);
  w.logServerIssue = async () => {};
  waits.length = 0;
  res = await w.handleAiProxy(aiPost(aiBody), env, '', { waitUntil: (p) => waits.push(p) });
  check('proxy: a failed call is not counted', [res.status, waits.length], [400, 0]);

  // Streamed: the reply is folded back into one message, whatever the chunking,
  // and counted from that message. Sent with stream: true and the higher cap.
  const sse = (events, size = 7) => {
    const text = events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
    const enc = new TextEncoder();
    return new Response(new ReadableStream({ start(c) { for (let i = 0; i < text.length; i += size) c.enqueue(enc.encode(text.slice(i, i + size))); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const START = { type: 'message_start', message: { id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], usage: { input_tokens: 700, output_tokens: 1 } } };
  w.commitFirestore = async (e, writes) => { recorded.push(writes[0]); return true; };
  recorded.length = 0;
  w.fetch = async (url, init) => { forwarded = JSON.parse(init.body); return sse([START,
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '{"assignments":[{"title":"Essay ' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '1"}]}' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5200 } },
    { type: 'message_stop' }]); };
  waits.length = 0;
  res = await w.handleAiProxy(aiPost({ ...aiBody, max_tokens: 50000, feature: 'syllabus' }), env, '', { waitUntil: (p) => waits.push(p) });
  const streamed = JSON.parse(await res.text());
  await Promise.all(waits);
  check('stream: asked for as a stream, capped at 12000', [forwarded.stream, forwarded.max_tokens], [true, 12000]);
  check('stream: the app gets one message with the text whole', [res.status, streamed.stop_reason, JSON.parse(streamed.content.find(b => b.type === 'text').text)], [200, 'end_turn', { assignments: [{ title: 'Essay 1' }] }]);
  check('stream: usage counted from the rebuilt message', recorded.some(r => r?.increments?.['byFeatureModel.syllabus.`claude-sonnet-5`.outputTokens'] === 5200), true);
  w.fetch = async () => sse([START, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]);
  const issues = [];
  w.logServerIssue = async (e, f, m) => { issues.push(m); };
  waits.length = 0;
  res = await w.handleAiProxy(aiPost(aiBody), env, '', { waitUntil: (p) => waits.push(p) });
  const failed = JSON.parse(await res.text());
  await Promise.all(waits);
  check('stream: an error partway arrives as type error on a 200, and is logged', [res.status, failed.type, failed.error.message, issues], [200, 'error', 'Overloaded', ['Anthropic stream failed']]);
}

/* ── /track-event: the new events, and only allowlisted ones ───────── */
{
  const w = freshWorker();
  const writes = [];
  w.writeFirestoreDoc = async (env, c, id, fields) => { writes.push(fields); };
  const env = { FIREBASE_PROJECT_ID: 'semester-hq', ALLOWED_ORIGIN: '' };
  const post = (body) => new Request('https://w/track-event', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  const statuses = [];
  for (const event of ['group_start_click', 'setup_class_added', 'setup_deadlines_in', 'setup_group_joined', 'get_started_click', 'syllabus_read']) {
    statuses.push((await w.handleTrackEvent(post({ event, path: '/', detail: { source: 'lms' } }), env, '')).status);
  }
  check('events: the new ones and the old ones are accepted', statuses, [200, 200, 200, 200, 200, 200]);
  check('events: and written', writes.map(x => x.event), ['group_start_click', 'setup_class_added', 'setup_deadlines_in', 'setup_group_joined', 'get_started_click', 'syllabus_read']);
  check('events: a setup event carries only its source label', writes[2].detail, { source: 'lms' });
  const res = await w.handleTrackEvent(post({ event: 'setup_anything_else' }), env, '');
  check('events: anything not on the list is refused', res.status, 400);
  await w.handleTrackEvent(post({ event: 'setup_class_added', detail: { courseName: 'Organic Chemistry', source: 'manual', email: 'a@x.com' } }), env, '');
  check('events: fields off the list are dropped', writes.at(-1).detail, { source: 'manual' });
}

/* ── Funnel, errors and group plans: pure pieces ─────────────────── */
{
  const w = freshWorker();
  const rows = [
    { event: 'get_started_click', path: '/', createdAt: '2026-09-22T10:00:00Z' },
    { event: 'get_started_click', path: '/pricing.html', createdAt: '2026-09-21T10:00:00Z' },
    { event: 'get_started_click', path: '/', createdAt: '2026-09-20T10:00:00Z' },
    { event: 'checkout_started', path: '/pricing.html', createdAt: '2026-09-22T11:00:00Z' },
  ];
  const x = w.eventFunnelExtras(rows);
  check('funnel: byDay', x.byDay, { '2026-09-22': { get_started_click: 1, checkout_started: 1 }, '2026-09-21': { get_started_click: 1 }, '2026-09-20': { get_started_click: 1 } });
  check('funnel: get started by page', x.getStartedByPath, { '/': 2, '/pricing.html': 1 });
  check('funnel: lastFired is the newest time', x.lastFired, { get_started_click: Date.parse('2026-09-22T10:00:00Z'), checkout_started: Date.parse('2026-09-22T11:00:00Z') });
  const junk = Array.from({ length: 60 }, (_, i) => ({ event: 'get_started_click', path: `/junk-${i}`, createdAt: '2026-09-22T10:00:00Z' }));
  const capped = w.eventFunnelExtras(junk).getStartedByPath;
  check('funnel: paths from the public are capped, the rest summed', [Object.keys(capped).length, capped['(other)']], [41, 20]);

  check('errors: by feature, warnings counted', w.errorsByFeature([{ feature: 'syllabus', level: 'warn' }, { feature: 'syllabus', level: 'warn' }, { feature: 'sync', level: 'error' }, { level: 'error' }]), { syllabus: { errors: 0, warnings: 2 }, sync: { errors: 1, warnings: 0 }, unknown: { errors: 1, warnings: 0 } });

  const plan = { id: 'PLAN1', name: 'Chess Club', kind: 'club', status: 'active', seats: 8, requestedSeats: 6, memberCount: 5, createdAt: '2026-09-01T00:00:00Z', cancelAtPeriodEnd: false, ownerUid: 'u1', adminUids: ['u1', 'u2'], adminsJson: JSON.stringify([{ uid: 'u1', email: 'first@x.com', name: 'First Admin' }, { uid: 'u2', email: 'second@x.com', name: 'Second' }]), inviteCode: 'ABCDEFGH', stripeCustomerId: 'cus_1' };
  const line = w.groupPlanListRow(plan);
  check('group plans: the documented fields', line, { planId: 'PLAN1', name: 'Chess Club', kind: 'club', status: 'active', seatsBought: 8, seatsRequested: 6, membersJoined: 5, createdAt: Date.parse('2026-09-01T00:00:00Z'), cancelAtPeriodEnd: false, adminEmail: 'first@x.com' });
  check('group plans: no second admin, no names, no invite code, no ids', JSON.stringify(line).match(/second@|First Admin|ABCDEFGH|cus_1|u2/g), null);
}

/* ── The business summary only gains keys ─────────────────────────── */
{
  const w = freshWorker();
  w.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/v1/subscriptions?')) return json({ data: [], has_more: false });
    if (u.includes('/v1/checkout/sessions')) return json({ data: [{ id: 'cs_1', created: Math.floor(Date.now() / 1000) - 60, status: 'complete', metadata: { source: 'signup' } }], has_more: false });
    if (/\/v1\/(charges|balance_transactions|payouts|customers)/.test(u)) return json({ data: [], has_more: false });
    throw new Error('unexpected ' + u);
  };
  w.runFirestoreQuery = async () => [];
  w.queryRecentDocs = async () => [];
  w.listFirestoreCollection = async (env, path) => (path === 'groupPlans' ? [{ id: 'P1', name: 'Team', seats: 5, memberCount: 2, createdAt: '2026-09-01T00:00:00Z', adminsJson: '[]' }] : []);
  w.batchGetFirestoreDocs = async (env, paths) => Object.fromEntries(paths.map(p => [p, null]));
  const env = { ...FIREBASE, STRIPE_SECRET_KEY: 'sk_test', ADMIN_TOKEN: 'correct-horse-battery-staple' };
  const req = (token) => new Request('https://w/admin/business-summary', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let res = await w.handleAdminBusinessSummary(req(''), env);
  check('summary: still token-gated', res.status, 401);
  res = await w.handleAdminBusinessSummary(req('correct-horse-battery-staple'), env);
  const out = await jsonOf(res);
  check('summary: every key it had is still there', ['stripe', 'cloudflare', 'firebase'].every(k => k in out) && ['funnel', 'feedback', 'errors'].every(k => k in out.firebase), true);
  check('summary: the Stripe block keeps its fields', ['activeCount', 'mrrCents', 'netMrrCents', 'payingCount', 'compedCount', 'pastDueCount', 'cancelingCount', 'groupPlanCount', 'groupSeatCount', 'new7d', 'new30d', 'canceled30d', 'totalSubscriptions', 'truncated', 'revenue30d', 'recent', 'fetchedAt', 'subscribers', 'books', 'customersNoSub', 'customersNoSubError'].filter(k => !(k in out.stripe)), []);
  check('summary: the funnel keeps its fields and gains three', ['d7', 'd30', 'syllabus', 'capped', 'byDay', 'getStartedByPath', 'lastFired'].filter(k => !(k in out.firebase.funnel)), []);
  check('summary: errors gain byFeature24h', 'byFeature24h' in out.firebase.errors && 'count24h' in out.firebase.errors, true);
  check('summary: new top-level keys', [out.checkouts?.byPath?.signup, out.groupPlans?.length, out.groupPlansError, out.aiUsage?.days], [{ opened: 1, completed: 1 }, 1, '', 30]);
  const noServices = await jsonOf(await w.handleAdminBusinessSummary(req('correct-horse-battery-staple'), { ADMIN_TOKEN: 'correct-horse-battery-staple' }));
  check('summary: unconfigured sections are left out, not faked', ['checkouts', 'groupPlans', 'aiUsage', 'firebase'].filter(k => k in noServices), []);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
