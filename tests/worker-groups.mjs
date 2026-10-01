/* ── Group plans run from a club, and handed to the next person ────
   The Worker's side of seats a club can see, seats that free themselves
   when someone leaves the club, the handoff of a plan to a new admin,
   and the card switch that moves billing to them (worker/src/groups.js).
   Runs the real route handler against an in-memory Firestore and a fake
   Stripe.

   Run:  node tests/worker-groups.mjs
──────────────────────────────────────────────────────────────── */
import vm from 'node:vm';
import { loadWorkerSource } from './worker-source.mjs';

const { source: src } = loadWorkerSource();
const sandbox = { console, crypto, fetch: () => { throw new Error('no network in tests'); }, setTimeout, clearTimeout, TextEncoder, TextDecoder, atob, btoa, URL, URLSearchParams, Response, Request, Headers };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'worker/src (flattened)' });

let failed = 0, passed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FAIL  ${name}\n      expected ${e}\n      got      ${a}`);
};
const ok = (name, v) => check(name, !!v, true);

/* ── An in-memory Firestore ───────────────────────────────────── */
let docs;
const clone = (v) => v == null ? v : JSON.parse(JSON.stringify(v));
const merge = (path, fields) => docs.set(path, { ...(docs.get(path) || {}), ...clone(fields) });
sandbox.readFirestoreDoc = async (env, coll, id) => clone(docs.get(`${coll}/${id}`)) || null;
sandbox.readFirestoreDocWithTime = async (env, path) => docs.has(path) ? { data: clone(docs.get(path)), updateTime: 't' } : null;
sandbox.patchFirestoreDoc = async (env, path, fields) => merge(path, fields);
sandbox.deleteFirestoreDoc = async (env, coll, id) => docs.delete(`${coll}/${id}`);
sandbox.commitFirestore = async (env, writes) => {
  for (const w of writes) if (w.exists === false && docs.has(w.path)) return false;
  for (const w of writes) w.remove ? docs.delete(w.path) : merge(w.path, w.fields);
  return true;
};
sandbox.listFirestoreCollection = async (env, path) => [...docs.entries()]
  .filter(([k]) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'))
  .map(([k, v]) => ({ ...clone(v), id: k.slice(path.length + 1) }));
sandbox.runFirestoreQuery = async (env, q) => {
  const coll = q.from[0].collectionId;
  const f = q.where.fieldFilter;
  const value = f.value.stringValue;
  return [...docs.entries()]
    .filter(([k]) => k.startsWith(`${coll}/`) && k.split('/').length === 2)
    .map(([k, v]) => ({ ...clone(v), id: k.split('/')[1] }))
    .filter(d => f.op === 'EQUAL' ? d[f.field.fieldPath] === value : (d[f.field.fieldPath] || []).includes(value));
};
sandbox.verifyFirebaseIdToken = async (t) => ({ sub: t, email: `${t}@school.edu`, email_verified: true, name: t[0].toUpperCase() + t.slice(1) });
sandbox.logServerIssue = async () => {};
sandbox.startCustomerEmails = async () => {};

/* ── A fake Stripe ────────────────────────────────────────────── */
let stripe;
sandbox.stripeRequest = async (env, method, path, params) => {
  stripe.push({ method, path, params: params ? Object.fromEntries(params) : null });
  if (method === 'POST' && path === '/v1/checkout/sessions') return { ok: true, data: { url: 'https://checkout.stripe.test/c' } };
  if (method === 'GET' && path.startsWith('/v1/checkout/sessions/')) return { ok: true, data: stripeSessions[path.split('/').pop()] || {} };
  if (method === 'GET' && path.startsWith('/v1/setup_intents/')) return { ok: true, data: { payment_method: 'pm_new' } };
  if (method === 'GET' && path.includes('/payment_methods')) return { ok: true, data: { data: [{ id: 'pm_old' }, { id: 'pm_new' }] } };
  return { ok: true, data: {} };
};
let stripeSessions = {};

const env = { FIREBASE_PROJECT_ID: 'p', STRIPE_SECRET_KEY: 'sk_test', APP_URL: 'https://app.semester-hq.com/' };
async function call(action, as, body = {}) {
  const res = await sandbox.handleGroupRoute(action, new Request('https://api.test/group/' + action, { method: 'POST', body: JSON.stringify({ ...body, idToken: as }) }), env, 'https://app.semester-hq.com');
  return { status: res.status, body: await res.json() };
}

function seed() {
  docs = new Map();
  stripe = [];
  stripeSessions = {};
  // Chess Club: ana founded it and runs the plan, ben is an officer,
  // cal and dee are members. eve took a seat from the link but never
  // joined the club.
  docs.set('orgs/CHESS1', { code: 'CHESS1', createdBy: 'ana', memberUids: ['ana', 'ben', 'cal', 'dee'], officerUids: ['ana', 'ben'], people: { ana: { name: 'Ana' }, ben: { name: 'Ben' }, cal: { name: 'Cal' }, dee: { name: 'Dee' } } });
  docs.set('groupPlans/PLAN0000000001', {
    name: 'Chess Club', kind: 'club', orgCode: 'CHESS1', status: 'active', seats: 5, memberCount: 4, inviteCode: 'ABCD2345',
    ownerUid: 'ana', adminUids: ['ana'], adminsJson: JSON.stringify([{ uid: 'ana', email: 'ana@school.edu', name: 'Ana' }]),
    stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', stripeItemId: 'si_1',
  });
  for (const [uid, name] of [['ana', 'Ana'], ['cal', 'Cal'], ['dee', 'Dee'], ['eve', 'Eve']]) {
    docs.set(`groupPlans/PLAN0000000001/members/${uid}`, { name, email: `${uid}@school.edu`, joinedAt: '2026-09-01' });
    docs.set(`licenses/${uid}`, { groupPlanId: 'PLAN0000000001', groupName: 'Chess Club', groupPaid: true, paid: true });
  }
}
const plan = () => docs.get('groupPlans/PLAN0000000001');

/* ── Seats, as a club's officers see them ─────────────────────── */
seed();
let r = await call('org-seats', 'ben', { orgCode: 'CHESS1' });
check('an officer who isn’t a plan admin sees the club’s plan', [r.status, r.body.plan?.name, r.body.canManage], [200, 'Chess Club', false]);
check('who in the club holds a seat, and who holds one from outside it', [r.body.seatUids.sort(), r.body.outside.map(o => o.name)], [['ana', 'cal', 'dee'], ['Eve']]);
ok('no emails reach an officer who isn’t an admin', !JSON.stringify(r.body).includes('@'));
check('who it’s billed to, by name', r.body.plan.billedTo, { uid: 'ana', name: 'Ana' });
check('a plan admin can manage from the club', (await call('org-seats', 'ana', { orgCode: 'CHESS1' })).body.canManage, true);
check('a plain member can’t see seats', (await call('org-seats', 'cal', { orgCode: 'CHESS1' })).status, 403);
check('a club with no plan says so', (docs.set('orgs/OTHER1', { memberUids: ['ben'], officerUids: ['ben'] }), (await call('org-seats', 'ben', { orgCode: 'OTHER1' })).body.plan), null);

/* ── Seats that free themselves ───────────────────────────────── */
r = await call('release-org-seat', 'ben', { orgCode: 'CHESS1', uid: 'cal' });
check('an officer can’t take a seat from someone still in the club', [r.body.released, r.body.reason, docs.has('groupPlans/PLAN0000000001/members/cal')], [false, 'member', true]);
check('a member can’t free someone else’s seat', (await call('release-org-seat', 'dee', { orgCode: 'CHESS1', uid: 'cal' })).status, 403);
// cal leaves the club, then asks for their seat back to be freed
docs.set('orgs/CHESS1', { ...docs.get('orgs/CHESS1'), memberUids: ['ana', 'ben', 'dee'] });
r = await call('release-org-seat', 'cal', { orgCode: 'CHESS1' });
check('leaving the club frees your seat', [r.body.released, docs.has('groupPlans/PLAN0000000001/members/cal'), plan().memberCount], [true, false, 3]);
check('and your license no longer comes from the plan', [docs.get('licenses/cal').groupPaid, docs.get('licenses/cal').paid, docs.get('licenses/cal').groupPlanId], [false, false, '']);
check('asking twice is harmless', (await call('release-org-seat', 'cal', { orgCode: 'CHESS1' })).body.released, false);
// an officer removes dee, then frees her seat
docs.set('orgs/CHESS1', { ...docs.get('orgs/CHESS1'), memberUids: ['ana', 'ben'] });
r = await call('release-org-seat', 'ben', { orgCode: 'CHESS1', uid: 'dee' });
check('an officer who removed someone frees their seat', [r.body.released, plan().memberCount], [true, 2]);
check('the seats bought don’t change: a new member takes the open one at no cost', [plan().seats, stripe.length], [5, 0]);
check('a bad uid is refused', (await call('release-org-seat', 'ben', { orgCode: 'CHESS1', uid: 'a/b' })).status, 400);

/* ── Handing the plan on ──────────────────────────────────────── */
seed();
check('only an admin can hand off', (await call('handoff', 'ben', { planId: 'PLAN0000000001', uid: 'ben' })).status, 403);
check('someone outside the club and without a seat can’t be handed it', (await call('handoff', 'ana', { planId: 'PLAN0000000001', uid: 'zed' })).status, 400);
r = await call('handoff', 'ana', { planId: 'PLAN0000000001', uid: 'ben', stay: false });
check('a club officer without a seat can take over', [r.status, plan().adminUids], [200, ['ana', 'ben']]);
check('the handoff waits on their card', JSON.parse(plan().handoffJson), { ...JSON.parse(plan().handoffJson), from: 'ana', to: 'ben', toName: 'Ben', stay: false });
check('the person paying stays an admin until then, and still pays', [plan().ownerUid, r.body.you.billed], ['ana', true]);
check('the new admin sees the handoff on their plan', (await call('mine', 'ben')).body.plans[0].handoff.to, 'ben');
check('nobody can take the paying admin off meanwhile', [(await call('set-admin', 'ben', { planId: 'PLAN0000000001', uid: 'ana', admin: false })).body.error.startsWith('Ana still pays'), plan().adminUids.includes('ana')], [true, true]);

r = await call('card-checkout', 'ben', { planId: 'PLAN0000000001' });
const setup = stripe.find(c => c.path === '/v1/checkout/sessions').params;
check('the card page: Stripe’s setup mode on the plan’s own customer, charging nothing', [r.body.url, setup.mode, setup.customer, setup['metadata[kind]'], setup['metadata[uid]']], ['https://checkout.stripe.test/c', 'setup', 'cus_1', 'group-card', 'ben']);
ok('it comes back to the plan page with the session', setup.success_url.includes('card=done&session={CHECKOUT_SESSION_ID}'));

stripeSessions.cs_test_someoneelse0 = { id: 'cs_test_someoneelse0', status: 'complete', customer: 'cus_1', metadata: { kind: 'group-card', planId: 'PLAN0000000001', uid: 'ana' }, setup_intent: 'seti_1' };
check('someone else’s card session can’t be finished by you', (await call('card-finish', 'ben', { planId: 'PLAN0000000001', sessionId: 'cs_test_someoneelse0' })).status, 400);
stripeSessions.cs_test_notdoneyet00 = { id: 'cs_test_notdoneyet00', status: 'open', customer: 'cus_1', metadata: { kind: 'group-card', planId: 'PLAN0000000001', uid: 'ben' } };
check('an unfinished card session changes nothing', [(await call('card-finish', 'ben', { planId: 'PLAN0000000001', sessionId: 'cs_test_notdoneyet00' })).status, plan().ownerUid], [400, 'ana']);

stripe = [];
stripeSessions.cs_test_bencard00001 = { id: 'cs_test_bencard00001', status: 'complete', customer: 'cus_1', metadata: { kind: 'group-card', planId: 'PLAN0000000001', uid: 'ben' }, setup_intent: 'seti_1' };
r = await call('card-finish', 'ben', { planId: 'PLAN0000000001', sessionId: 'cs_test_bencard00001' });
const cust = stripe.find(c => c.path === '/v1/customers/cus_1').params;
check('the new card is the default, and receipts go to the new person', [cust['invoice_settings[default_payment_method]'], cust.email], ['pm_new', 'ben@school.edu']);
check('the subscription charges it from now on', stripe.find(c => c.path === '/v1/subscriptions/sub_1').params.default_payment_method, 'pm_new');
check('the old card comes off the plan', stripe.filter(c => c.path.endsWith('/detach')).map(c => c.path), ['/v1/payment_methods/pm_old/detach']);
check('ben pays now, ana stepped back, the handoff is done', [plan().ownerUid, plan().adminUids, plan().handoffJson, r.body.you.billed], ['ben', ['ben'], '', true]);
check('seats and members didn’t move', [plan().seats, plan().memberCount, plan().status], [5, 4, 'active']);
stripe = [];
ok('the webhook for the same session changes nothing again', await sandbox.finishGroupCardFromWebhook(env, stripeSessions.cs_test_bencard00001) && !stripe.length);

/* ── Staying on ───────────────────────────────────────────────── */
seed();
docs.set('groupPlans/PLAN0000000001', { ...plan(), adminUids: ['ana', 'cal'], adminsJson: JSON.stringify([{ uid: 'ana', name: 'Ana', email: 'ana@school.edu' }, { uid: 'cal', name: 'Cal', email: 'cal@school.edu' }]) });
r = await call('handoff', 'cal', { planId: 'PLAN0000000001', uid: 'dee', stay: false });
check('an admin who isn’t paying can step back right away', [r.body.removedSelf, plan().adminUids], [true, ['ana', 'dee']]);
r = await call('handoff', 'ana', { planId: 'PLAN0000000001', uid: 'dee' });
stripeSessions.cs_test_deecard00001 = { id: 'cs_test_deecard00001', status: 'complete', customer: 'cus_1', metadata: { kind: 'group-card', planId: 'PLAN0000000001', uid: 'dee' }, setup_intent: { id: 'seti_2', payment_method: 'pm_new' } };
ok('a webhook can finish it before the return page does', await sandbox.finishGroupCardFromWebhook(env, stripeSessions.cs_test_deecard00001));
check('staying on: still an admin, no longer paying', [plan().ownerUid, plan().adminUids], ['dee', ['ana', 'dee']]);
check('the webhook ignores a session for someone who isn’t an admin', await sandbox.finishGroupCardFromWebhook(env, { id: 'cs_x', customer: 'cus_1', metadata: { kind: 'group-card', planId: 'PLAN0000000001', uid: 'zed' } }), false);

seed();
docs.set('groupPlans/PLAN0000000001', { ...plan(), orgCode: '', adminUids: ['ana', 'adv'], adminsJson: JSON.stringify([{ uid: 'ana', name: 'Ana', email: 'ana@school.edu' }, { uid: 'adv', name: 'Advisor', email: 'adv@school.edu' }]) });
r = await call('handoff', 'ana', { planId: 'PLAN0000000001', uid: 'adv' });
check('a co-admin without a seat can be handed it', [r.status, JSON.parse(plan().handoffJson).toName], [200, 'Advisor']);

/* ── A plan that never got billing ────────────────────────────── */
seed();
docs.set('groupPlans/PLAN0000000001', { ...plan(), status: 'pending', stripeCustomerId: '', stripeSubscriptionId: '' });
r = await call('handoff', 'ana', { planId: 'PLAN0000000001', uid: 'cal', stay: false });
check('nothing to pay for: the handoff is immediate', [r.body.removedSelf, plan().ownerUid, plan().adminUids, plan().handoffJson], [true, 'cal', ['cal'], '']);
check('no card page for a plan without billing', (await call('card-checkout', 'cal', { planId: 'PLAN0000000001' })).status, 400);

/* ── Checkout stats ignore card changes ───────────────────────── */
const sum = sandbox.summarizeCheckouts([{ mode: 'setup', created: 1, status: 'complete', metadata: { kind: 'group-card' } }, { mode: 'subscription', created: 1, status: 'complete', metadata: { kind: 'group' } }]);
check('a card change isn’t counted as a checkout', [sum.byPath.group.opened, Object.values(sum.byPath).reduce((n, p) => n + p.opened, 0)], [1, 1]);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
