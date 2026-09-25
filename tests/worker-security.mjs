/* ── The Worker's security boundaries, exercised without Cloudflare ──
   Runs the real functions from worker/src/index.js in a sandbox with fake
   Firestore, fake KV and a fake Stripe, and checks the things that would
   cost money or somebody's access if they regressed:

   - a checkout can only be started in the name of the token holder
   - webhook events from a subscription a license doesn't follow are ignored
   - every v1 signature on a Stripe header is checked, and events run once
   - Firebase ID tokens are verified end to end against a real RSA key
   - input-size estimates count documents, and unknown blocks are refused
   - rate limits, daily caps and the admin brake fail the right way

   Run:  node tests/worker-security.mjs
──────────────────────────────────────────────────────────────── */
import vm from 'node:vm';
import { loadWorkerSource } from './worker-source.mjs';

// Every worker/src module flattened into one script, so each top-level
// function lands on the sandbox global where tests can reach and replace
// it. See tests/worker-source.mjs for why this isn't a plain import.
const { source: src } = loadWorkerSource();

let fetchImpl = () => { throw new Error('no network in tests'); };
const sandbox = {
  console, crypto, setTimeout, clearTimeout, TextEncoder, TextDecoder, atob, btoa, URL, URLSearchParams, Response, Request, Headers,
  // The typed-array constructors from this realm: Node 20's WebCrypto refuses
  // a Uint8Array made inside the vm context ("not instance of ArrayBuffer"),
  // which Node 24 and Cloudflare accept. Workers run in one realm anyway.
  Uint8Array, ArrayBuffer, DataView,
  fetch: (...args) => fetchImpl(...args),
};
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

/* A fake KV namespace with the real get/put shape. */
function fakeKV({ failPuts = false } = {}) {
  const store = new Map();
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { if (failPuts) throw new Error('KV write limit'); store.set(k, v); },
  };
}
const jsonOf = async (res) => JSON.parse(await res.text());
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
async function stripeSign(secret, body, timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return { timestamp, v1: hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${body}`))) };
}

/* ── Small pure guards ─────────────────────────────────────────── */
check('verifiedEmailOf: verified email is lowercased', sandbox.verifiedEmailOf({ email: ' A@X.com ', email_verified: true }), 'a@x.com');
check('verifiedEmailOf: unverified email is empty', sandbox.verifiedEmailOf({ email: 'a@x.com', email_verified: false }), '');
check('verifiedEmailOf: missing payload is empty', sandbox.verifiedEmailOf(null), '');

check('subscriptionBelongsHere: no record yet', sandbox.subscriptionBelongsHere(null, 'sub_A', true), true);
check('subscriptionBelongsHere: same subscription', sandbox.subscriptionBelongsHere({ stripeSubscriptionId: 'sub_A', individualPaid: true }, 'sub_A', false), true);
check('subscriptionBelongsHere: another subscription may not cancel an active license', sandbox.subscriptionBelongsHere({ stripeSubscriptionId: 'sub_A', individualPaid: true }, 'sub_B', false), false);
check('subscriptionBelongsHere: another subscription may not replace an active one', sandbox.subscriptionBelongsHere({ stripeSubscriptionId: 'sub_A', individualPaid: true }, 'sub_B', true), false);
check('subscriptionBelongsHere: a new subscription replaces a lapsed one', sandbox.subscriptionBelongsHere({ stripeSubscriptionId: 'sub_A', individualPaid: false, paid: false }, 'sub_B', true), true);
check('subscriptionBelongsHere: legacy doc without individualPaid, lapsed', sandbox.subscriptionBelongsHere({ stripeSubscriptionId: 'sub_A', paid: false }, 'sub_B', true), true);

/* ── Input sizing ───────────────────────────────────────────────── */
const textBody = { system: 'x'.repeat(400), messages: [{ role: 'user', content: 'y'.repeat(4000) }] };
check('estimate: text only', sandbox.estimateInputTokens(textBody), 1100);
const docBody = { system: 's', messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', data: 'A'.repeat(4_000_000) } }] }] };
ok('estimate: a 3MB PDF is counted and exceeds the 60k cap', sandbox.estimateInputTokens(docBody) > 60000); // AI_MAX_INPUT_TOKENS is a const, not a global property
const smallDoc = { system: 's', messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', data: 'A'.repeat(20000) } }] }] };
check('estimate: a small PDF gets the floor', sandbox.estimateInputTokens(smallDoc), 1500);
check('blocks: text, image and document by base64 are fine', sandbox.findDisallowedBlock([{ content: [{ type: 'text', text: 'hi' }, { type: 'image', source: { type: 'base64' } }, { type: 'document', source: { type: 'base64' } }] }]), '');
check('blocks: tool results are refused', sandbox.findDisallowedBlock([{ content: [{ type: 'tool_result' }] }]), 'tool_result');
check('blocks: URL image sources are refused', sandbox.findDisallowedBlock([{ content: [{ type: 'image', source: { type: 'url' } }] }]), 'image:url');
check('blocks: plain string content is fine', sandbox.findDisallowedBlock([{ content: 'hello' }]), '');

/* ── Rate limits and caps ───────────────────────────────────────── */
{
  const kv = fakeKV();
  const env = { RATE_LIMIT: kv };
  const r = [];
  for (let i = 0; i < 3; i++) r.push(await sandbox.checkRateLimit(env, '1.2.3.4', 'x', 2));
  check('KV limiter: third call in a minute is refused', r, [true, true, false]);
  check('KV limiter: a different IP is separate', await sandbox.checkRateLimit(env, '5.6.7.8', 'x', 2), true);
  check('KV limiter: a failing KV write lets the request through', await sandbox.checkRateLimit({ RATE_LIMIT: fakeKV({ failPuts: true }) }, '1.2.3.4', 'x', 2), true);
  check('KV limiter: no binding means no limiting', await sandbox.checkRateLimit({}, '1.2.3.4', 'x', 2), true);
  let nativeKey = '';
  const native = { limit: async ({ key }) => { nativeKey = key; return { success: false }; } };
  check('native limiter: used when bound and its answer is final', await sandbox.checkRateLimit({ RL_NORMAL: native, RATE_LIMIT: kv }, '9.9.9.9', 'ai', 20), false);
  check('native limiter: keyed by route and IP', nativeKey, 'ai:9.9.9.9');
  check('native limiter: the tight tier serves small limits', sandbox.pickRateLimiter({ RL_TIGHT: native, RL_NORMAL: native }, 5) === native && sandbox.pickRateLimiter({ RL_NORMAL: native }, 5) === native, true);
  check('native limiter: nothing bound falls back to KV', sandbox.pickRateLimiter({}, 20), null);

  const caps = [];
  for (let i = 0; i < 3; i++) caps.push(await sandbox.underDailyCap(env, 'contact', 2));
  check('daily cap: third write in a day is refused', caps, [true, true, false]);
  check('daily cap: no KV means no cap', await sandbox.underDailyCap({}, 'contact', 2), true);
}
{
  const kv = fakeKV();
  const env = { RATE_LIMIT: kv, ADMIN_TOKEN: 'correct-horse-battery-staple' };
  const req = (token) => new Request('https://w/admin/errors', { headers: { Authorization: `Bearer ${token}`, 'CF-Connecting-IP': '4.4.4.4' } });
  check('admin: the right token passes', await sandbox.adminTokenOk(req('correct-horse-battery-staple'), env), true);
  check('admin: a wrong token fails', await sandbox.adminTokenOk(req('wrong-token-of-same-length!'), env), false);
  for (let i = 0; i < 20; i++) await sandbox.adminTokenOk(req('nope'), env);
  check('admin: after twenty wrong guesses even the right token waits', await sandbox.adminTokenOk(req('correct-horse-battery-staple'), env), false);
  const other = new Request('https://w/admin/errors', { headers: { Authorization: 'Bearer correct-horse-battery-staple', 'CF-Connecting-IP': '8.8.8.8' } });
  check('admin: the brake is per IP', await sandbox.adminTokenOk(other, env), true);
}

/* ── Stripe signatures and event dedupe ────────────────────────── */
{
  const secret = 'whsec_test';
  const body = '{"id":"evt_1"}';
  const { timestamp, v1 } = await stripeSign(secret, body);
  check('signature: a valid header passes', await sandbox.verifyStripeSignature(body, `t=${timestamp},v1=${v1}`, secret), true);
  check('signature: any one of several v1 values may match (secret rotation)', await sandbox.verifyStripeSignature(body, `t=${timestamp},v1=${'0'.repeat(64)},v1=${v1}`, secret), true);
  check('signature: a wrong v1 fails', await sandbox.verifyStripeSignature(body, `t=${timestamp},v1=${'0'.repeat(64)}`, secret), false);
  const old = await stripeSign(secret, body, Math.floor(Date.now() / 1000) - 3600);
  check('signature: an hour-old timestamp is a replay', await sandbox.verifyStripeSignature(body, `t=${old.timestamp},v1=${old.v1}`, secret), false);
  check('signature: garbage header fails', await sandbox.verifyStripeSignature(body, 'nonsense', secret), false);

  const kv = fakeKV();
  check('dedupe: first delivery is handled', await sandbox.claimWebhookEvent({ RATE_LIMIT: kv }, 'evt_1'), true);
  check('dedupe: second delivery of the same id is not', await sandbox.claimWebhookEvent({ RATE_LIMIT: kv }, 'evt_1'), false);
  check('dedupe: without KV every delivery is handled', await sandbox.claimWebhookEvent({}, 'evt_1'), true);
}

/* ── Firebase ID tokens, end to end against a real key ─────────── */
{
  const projectId = 'semester-hq';
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'kid-1', alg: 'RS256', use: 'sig' };
  const b64u = (obj) => Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  async function token(claims, header = { alg: 'RS256', kid: 'kid-1', typ: 'JWT' }) {
    const signing = `${b64u(header)}.${b64u({ aud: projectId, iss: `https://securetoken.google.com/${projectId}`, exp: now + 3600, iat: now - 5, sub: 'user-1', email: 'a@x.com', email_verified: true, ...claims })}`;
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, enc.encode(signing));
    return `${signing}.${Buffer.from(sig).toString('base64url')}`;
  }
  let jwksFetches = 0;
  fetchImpl = async (url) => {
    if (String(url).includes('service_accounts/v1/jwk')) {
      jwksFetches++;
      return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'public, max-age=3600', 'content-type': 'application/json' } });
    }
    throw new Error('unexpected fetch ' + url);
  };
  const good = await sandbox.verifyFirebaseIdToken(await token({}), projectId);
  check('token: a properly signed token verifies', good.sub, 'user-1');
  await sandbox.verifyFirebaseIdToken(await token({ sub: 'user-2' }), projectId);
  check('token: keys are cached between checks', jwksFetches, 1);
  const rejects = async (name, t) => { try { await sandbox.verifyFirebaseIdToken(t, projectId); check(name, 'verified', 'rejected'); } catch (e) { check(name, 'rejected', 'rejected'); } };
  await rejects('token: wrong audience', await token({ aud: 'other-project' }));
  await rejects('token: expired', await token({ exp: now - 10 }));
  await rejects('token: missing exp', await token({ exp: undefined }));
  await rejects('token: alg none', await token({}, { alg: 'none', kid: 'kid-1' }));
  await rejects('token: no subject', await token({ sub: '' }));
  await rejects('token: tampered payload', (await token({})).replace(/\.[^.]+\./, '.' + b64u({ aud: projectId, iss: `https://securetoken.google.com/${projectId}`, exp: now + 3600, iat: now, sub: 'attacker' }) + '.'));
  await rejects('token: unknown key id (refetched once, still unknown)', await token({}, { alg: 'RS256', kid: 'kid-9' }));
  check('token: an unknown kid triggers exactly one refetch', jwksFetches, 2);
}

/* ── Calendar feeds: a URL fetcher kept on a short leash ─────────── */
{
  check('feed url: plain https is fine', sandbox.feedUrlProblem('https://school.instructure.com/feeds/calendars/user_abc.ics'), '');
  ok('feed url: http is refused', sandbox.feedUrlProblem('http://school.instructure.com/x.ics'));
  ok('feed url: a literal IP is refused', sandbox.feedUrlProblem('https://10.0.0.5/x.ics'));
  ok('feed url: an IPv6 literal is refused', sandbox.feedUrlProblem('https://[::1]/x.ics'));
  ok('feed url: localhost is refused', sandbox.feedUrlProblem('https://localhost/x.ics'));
  ok('feed url: an internal name is refused', sandbox.feedUrlProblem('https://calendar.corp/x.ics'));
  ok('feed url: credentials in the link are refused', sandbox.feedUrlProblem('https://u:p@school.edu/x.ics'));
  ok('feed url: garbage is refused', sandbox.feedUrlProblem('not a link'));

  const env = { FIREBASE_PROJECT_ID: 'semester-hq', ALLOWED_ORIGIN: '', RATE_LIMIT: fakeKV() };
  const origVerify = sandbox.verifyFirebaseIdToken, origRead = sandbox.readFirestoreDoc;
  sandbox.verifyFirebaseIdToken = async (t) => { if (t !== 'good') throw new Error('bad'); return { sub: 'u-feed' }; };
  sandbox.readFirestoreDoc = async (env, col, id) => (col === 'licenses' && id === 'u-feed' ? { paid: true } : null);
  const post = (body) => new Request('https://w/calendar-feed', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  const fetched = [];
  fetchImpl = async (url, init) => {
    fetched.push(String(url));
    if (String(url).includes('redirect-me')) return new Response(null, { status: 302, headers: { location: 'https://192.168.1.1/x.ics' } });
    if (String(url).includes('hop')) return new Response(null, { status: 302, headers: { location: 'https://school.edu/final.ics' } });
    if (String(url).includes('html')) return new Response('<html>login</html>', { status: 200 });
    if (String(url).includes('huge')) return new Response('BEGIN:VCALENDAR\n' + 'X'.repeat(3 * 1024 * 1024), { status: 200 });
    return new Response('\uFEFFBEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:x\nEND:VEVENT\nEND:VCALENDAR', { status: 200 });
  };
  let res = await sandbox.handleCalendarFeed(post({ url: 'https://school.edu/a.ics' }), env, '');
  check('feed: no token is a 401', res.status, 401);
  res = await sandbox.handleCalendarFeed(post({ idToken: 'good', url: 'https://school.edu/a.ics' }), env, '');
  check('feed: a paid account gets the calendar text', res.status, 200);
  ok('feed: the text is the calendar, BOM stripped or not', (await jsonOf(res)).text.includes('BEGIN:VEVENT'));
  res = await sandbox.handleCalendarFeed(post({ idToken: 'good', url: 'webcal://school.edu/a.ics' }), env, '');
  check('feed: webcal links are read as https', res.status, 200);
  check('feed: and fetched over https', fetched.at(-1), 'https://school.edu/a.ics');
  sandbox.readFirestoreDoc = async () => ({ paid: false });
  res = await sandbox.handleCalendarFeed(post({ idToken: 'good', url: 'https://school.edu/a.ics' }), env, '');
  check('feed: an unpaid account is a 402', res.status, 402);
  sandbox.readFirestoreDoc = async () => ({ paid: true });
  fetched.length = 0;
  res = await sandbox.handleCalendarFeed(post({ idToken: 'good', url: 'https://10.1.1.1/a.ics' }), env, '');
  check('feed: a private address is refused before any fetch', [res.status, fetched.length], [400, 0]);
  res = await sandbox.handleCalendarFeed(post({ idToken: 'good', url: 'https://school.edu/redirect-me.ics' }), env, '');
  check('feed: a redirect into a private network is refused', res.status, 400);
  check('feed: and the private address is never fetched', fetched.some(u => u.includes('192.168')), false);
  res = await sandbox.handleCalendarFeed(post({ idToken: 'good', url: 'https://school.edu/hop.ics' }), env, '');
  check('feed: an ordinary redirect is followed', res.status, 200);
  res = await sandbox.handleCalendarFeed(post({ idToken: 'good', url: 'https://school.edu/html.ics' }), env, '');
  check('feed: a login page instead of a calendar is a 400', res.status, 400);
  res = await sandbox.handleCalendarFeed(post({ idToken: 'good', url: 'https://school.edu/huge.ics' }), env, '');
  check('feed: an oversized body is a 413', res.status, 413);
  sandbox.verifyFirebaseIdToken = origVerify; sandbox.readFirestoreDoc = origRead;
}

/* ── Checkout identity ─────────────────────────────────────────── */
{
  const env = { STRIPE_SECRET_KEY: 'sk_test_x', APP_URL: 'https://app.semester-hq.com/', FIREBASE_PROJECT_ID: 'semester-hq', ALLOWED_ORIGIN: '' };
  let lastParams = null;
  fetchImpl = async (url, init) => {
    if (String(url).startsWith('https://api.stripe.com/v1/checkout/sessions')) {
      lastParams = new URLSearchParams(init.body);
      return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/x' }), { headers: { 'content-type': 'application/json' } });
    }
    throw new Error('unexpected fetch ' + url);
  };
  sandbox.verifyFirebaseIdToken = async (t) => { if (t !== 'good') throw new Error('bad'); return { sub: 'holder-1', email: 'Holder@X.com', email_verified: true }; };
  const post = (body) => new Request('https://w/create-checkout-session', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

  lastParams = null;
  let res = await sandbox.handleCreateCheckoutSession(post({ uid: 'victim-uid', email: 'victim@x.com' }), env, '');
  check('checkout: a bare uid in the body is refused', res.status, 401);
  check('checkout: and Stripe is never called for it', lastParams, null);

  res = await sandbox.handleCreateCheckoutSession(post({ idToken: 'good', uid: 'victim-uid', email: 'victim@x.com' }), env, '');
  check('checkout: with a token the session is created', res.status, 200);
  check('checkout: the uid comes from the token, not the body', lastParams.get('client_reference_id'), 'holder-1');
  check('checkout: metadata uid comes from the token', lastParams.get('subscription_data[metadata][uid]'), 'holder-1');
  check('checkout: the email comes from the token, lowercased', lastParams.get('customer_email'), 'holder@x.com');

  res = await sandbox.handleCreateCheckoutSession(post({ email: 'Someone@Example.com' }), env, '');
  check('checkout: anonymous buyers get an email-only session', res.status, 200);
  check('checkout: anonymous sessions carry no uid', lastParams.get('client_reference_id'), null);
  check('checkout: anonymous sessions carry no metadata uid', lastParams.get('subscription_data[metadata][uid]'), null);
  check('checkout: anonymous email is normalised', lastParams.get('customer_email'), 'someone@example.com');

  res = await sandbox.handleCreateCheckoutSession(post({}), env, '');
  check('checkout: the marketing site (empty body) still works', res.status, 200);
  check('checkout: with no email prefilled', lastParams.get('customer_email'), null);
  res = await sandbox.handleCreateCheckoutSession(post({ idToken: 'expired' }), env, '');
  check('checkout: a bad token is a 401', res.status, 401);
}

/* ── Webhook: which license an event may move ───────────────────── */
{
  const secret = 'whsec_test_2';
  const docs = { 'licenses/u1': { paid: true, individualPaid: true, stripeSubscriptionId: 'sub_A', stripeCustomerId: 'cus_A' } };
  const patches = [], writes = [];
  sandbox.readFirestoreDoc = async (env, c, id) => docs[`${c}/${id}`] || null;
  sandbox.patchFirestoreDoc = async (env, path, fields) => { patches.push({ path, fields }); };
  sandbox.writeFirestoreDoc = async (env, c, id, fields) => { writes.push({ path: `${c}/${id}`, fields }); };
  sandbox.runFirestoreQuery = async () => [];
  sandbox.logServerIssue = async () => {};
  const kv = fakeKV();
  const env = { STRIPE_WEBHOOK_SECRET: secret, RATE_LIMIT: kv, FIREBASE_PROJECT_ID: 'semester-hq' };
  async function deliver(event) {
    const body = JSON.stringify(event);
    const { timestamp, v1 } = await stripeSign(secret, body);
    return sandbox.handleStripeWebhook(new Request('https://w/stripe-webhook', { method: 'POST', body, headers: { 'Stripe-Signature': `t=${timestamp},v1=${v1}` } }), env);
  }
  const cancel = (id, sub) => ({ id, type: 'customer.subscription.deleted', data: { object: { id: sub, status: 'canceled', customer: 'cus_X', metadata: { uid: 'u1', email: 'u1@x.com' } } } });

  let res = await deliver(cancel('evt_a', 'sub_B'));
  check('webhook: a cancellation from a subscription the license does not follow is a 200', res.status, 200);
  check('webhook: and it changes nothing', patches.length, 0);

  res = await deliver(cancel('evt_b', 'sub_A'));
  check('webhook: a cancellation of the real subscription switches the license off', patches.at(-1)?.fields?.paid, false);
  check('webhook: on the right document', patches.at(-1)?.path, 'licenses/u1');

  const before = patches.length;
  res = await deliver(cancel('evt_b', 'sub_A'));
  check('webhook: the same event id delivered again does nothing', patches.length, before);

  res = await deliver({ id: 'evt_c', type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid', client_reference_id: 'u2', subscription: 'sub_C', customer: 'cus_C', customer_details: { email: 'U2@x.com' } } } });
  check('webhook: a new purchase writes the license', patches.at(-1)?.path, 'licenses/u2');
  check('webhook: as paid, following the new subscription', [patches.at(-1)?.fields?.paid, patches.at(-1)?.fields?.stripeSubscriptionId], [true, 'sub_C']);
  check('webhook: and the email-keyed twin', writes.at(-1)?.path, 'licensesByEmail/u2@x.com');

  res = await deliver({ id: 'evt_d', type: 'checkout.session.completed', data: { object: { id: 'cs_2', payment_status: 'paid', client_reference_id: 'u1', subscription: 'sub_Z', customer: 'cus_Z', customer_details: { email: 'u1@x.com' } } } });
  check('webhook: a second purchase cannot take over an account with a live subscription', patches.at(-1)?.path, 'licenses/u2');

  const bad = JSON.stringify(cancel('evt_e', 'sub_A'));
  res = await sandbox.handleStripeWebhook(new Request('https://w/stripe-webhook', { method: 'POST', body: bad, headers: { 'Stripe-Signature': 't=1,v1=00' } }), env);
  check('webhook: an unsigned delivery is refused', res.status, 400);
}

/* ── Sign-in and password emails (/auth-email) ─────────────────── */
{
  const env = { FIREBASE_PROJECT_ID: 'semester-hq', RESEND_API_KEY: 're_test', APP_URL: 'https://app.semester-hq.com/', ALLOWED_ORIGIN: '', RATE_LIMIT: fakeKV() };
  const origGen = sandbox.generateAuthEmailLink, origLog = sandbox.logServerIssue;
  const asked = [], sent = [];
  sandbox.logServerIssue = async () => {};
  sandbox.generateAuthEmailLink = async (e, requestType, email, continueUrl) => {
    asked.push({ requestType, email, continueUrl });
    return email === 'nobody@x.com' ? '' : 'https://semester-hq.firebaseapp.com/__/auth/action?mode=signIn&oobCode=abc&x=1';
  };
  let resendStatus = 200;
  fetchImpl = async (url, init) => {
    if (String(url).startsWith('https://api.resend.com/')) { sent.push(JSON.parse(init.body)); return new Response('{}', { status: resendStatus }); }
    throw new Error('unexpected fetch ' + url);
  };
  const post = (body) => sandbox.handleAuthEmail(new Request('https://w/auth-email', { method: 'POST', body: JSON.stringify(body) }), env, '');

  let res = await post({ kind: 'signin', email: ' Student@X.com ', continueUrl: 'https://app.semester-hq.com/login.html?via=tour' });
  check('auth-email: a sign-in link is sent', res.status, 200);
  check('auth-email: Firebase is asked for an EMAIL_SIGNIN link for the tidied address', [asked.at(-1)?.requestType, asked.at(-1)?.email], ['EMAIL_SIGNIN', 'student@x.com']);
  check('auth-email: an app page is kept as where the link lands', asked.at(-1)?.continueUrl, 'https://app.semester-hq.com/login.html?via=tour');
  check('auth-email: it goes to that person', sent.at(-1)?.to, 'student@x.com');
  ok('auth-email: the link is in the text version', sent.at(-1)?.text.includes('oobCode=abc&x=1'));
  ok('auth-email: and in the button, escaped for HTML', sent.at(-1)?.html.includes('href="https://semester-hq.firebaseapp.com/__/auth/action?mode=signIn&amp;oobCode=abc&amp;x=1"'));

  await post({ kind: 'signin', email: 'a@x.com', continueUrl: 'https://evil.example/login.html' });
  check('auth-email: a landing page on another site is replaced by the app\'s login page', asked.at(-1)?.continueUrl, 'https://app.semester-hq.com/login.html');

  await post({ kind: 'reset', email: 'a@x.com' });
  check('auth-email: reset asks for a PASSWORD_RESET link', asked.at(-1)?.requestType, 'PASSWORD_RESET');
  const before = sent.length;
  res = await post({ kind: 'reset', email: 'nobody@x.com' });
  check('auth-email: a reset for an unknown address answers the same', res.status, 200);
  check('auth-email: and sends nothing', sent.length, before);

  check('auth-email: an unknown kind is refused', (await post({ kind: 'verify', email: 'a@x.com' })).status, 400);
  check('auth-email: a bad address is refused', (await post({ kind: 'signin', email: 'nope' })).status, 400);

  resendStatus = 500;
  check('auth-email: a failed send is a 502, so the page falls back to Firebase', (await post({ kind: 'signin', email: 'b@x.com' })).status, 502);
  resendStatus = 200;

  for (let i = 0; i < 5; i++) await post({ kind: 'signin', email: 'many@x.com' });
  check('auth-email: past five a day for one address, it stops', (await post({ kind: 'signin', email: 'many@x.com' })).status, 429);

  const turnstileEnv = { ...env, TURNSTILE_SECRET: 'secret', RATE_LIMIT: fakeKV() };
  res = await sandbox.handleAuthEmail(new Request('https://w/auth-email', { method: 'POST', body: JSON.stringify({ kind: 'signin', email: 'a@x.com' }) }), turnstileEnv, '');
  check('auth-email: with Turnstile on, no token is refused', res.status, 400);

  check('auth-email: without Resend set up it says so instead of pretending', (await sandbox.handleAuthEmail(new Request('https://w/auth-email', { method: 'POST', body: '{}' }), { FIREBASE_PROJECT_ID: 'semester-hq' }, '')).status, 503);
  sandbox.generateAuthEmailLink = origGen; sandbox.logServerIssue = origLog;
  fetchImpl = () => { throw new Error('no network in tests'); };
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
