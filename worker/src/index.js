/* ── Student Planner backend Worker ───────────────────────────────
   Four jobs, all server-side so secrets never reach the browser:
   1. AI proxy (/v1/messages) — holds ANTHROPIC_API_KEY, forwards to Claude.
   2. Checkout (/create-checkout-session) — starts a $7.99/month Stripe
      subscription for sign-in and sync.
   3. Licensing (/stripe-webhook, /claim-license) — the ONLY writer of
      Firestore's `licenses` collection. Clients can only read their own
      license (see firestore.rules); this Worker is the sole trusted
      authority that marks someone as paid, using a Firebase service
      account to write via the Firestore REST API. Subscription renewals,
      payment failures, and cancellations all flow through the webhook too
      (customer.subscription.updated/deleted), so `paid` always reflects
      whether the subscription is currently active.
   4. Contact form (/contact-message) — the ONLY writer of Firestore's
      `feedback` collection. Rate-limited and validated server-side since
      it's reachable by anyone, signed in or not.
   5. Error logging (/log-error) — the ONLY writer of Firestore's `errors`
      collection. Client-side crash reporter for both the app and the
      marketing site; rate-limited since it's reachable by anyone.
   6. Error viewer (/admin/errors) — read-only, token-gated (ADMIN_TOKEN
      secret) endpoint for admin/errors.html to list recent crash reports.
      Not origin-restricted like the rest, since the viewer page isn't
      served from ALLOWED_ORIGIN; the bearer token is the security boundary.
──────────────────────────────────────────────────────────────── */

const ALLOWED_MODELS = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
const MAX_TOKENS_CAP = 4000;
const ANTHROPIC_VERSION = '2023-06-01';
const PLUS_PRICE_CENTS = 799; // $7.99/month — bump the marketing copy too if this changes

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    // /admin/errors needs GET + an Authorization header, unlike every other
    // route here (POST + content-type only) — handle its preflight separately
    // so the browser doesn't reject the real request for a disallowed method/header.
    if (request.method === 'OPTIONS' && url.pathname === '/admin/errors') {
      return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'authorization' } });
    }
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(env, origin) });

    // Stripe calls this server-to-server — no Origin header, verified by signature instead of CORS.
    if (url.pathname === '/stripe-webhook' && request.method === 'POST') return handleStripeWebhook(request, env);

    // Token-gated, not origin-restricted (see job 6 above).
    if (url.pathname === '/admin/errors' && request.method === 'GET') return handleAdminErrors(request, env);

    if (request.method !== 'POST') return jsonError('Method not allowed', 405, env, origin);

    // Defense in depth beyond CORS (CORS only stops browser JS from reading the response —
    // it doesn't stop a direct request — so also reject disallowed origins server-side).
    if (!isAllowedOrigin(env, origin)) return jsonError('Origin not allowed', 403, env, origin);

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    if (url.pathname === '/v1/messages') {
      if (!(await checkRateLimit(env, ip, 'ai', 20))) return jsonError('Too many requests — try again in a minute.', 429, env, origin);
      return handleAiProxy(request, env, origin);
    }
    if (url.pathname === '/create-checkout-session') {
      if (!(await checkRateLimit(env, ip, 'checkout', 10))) return jsonError('Too many requests — try again in a minute.', 429, env, origin);
      return handleCreateCheckoutSession(request, env, origin);
    }
    if (url.pathname === '/create-portal-session') {
      if (!(await checkRateLimit(env, ip, 'portal', 10))) return jsonError('Too many requests — try again in a minute.', 429, env, origin);
      return handleCreatePortalSession(request, env, origin);
    }
    if (url.pathname === '/claim-license') {
      if (!(await checkRateLimit(env, ip, 'claim', 15))) return jsonError('Too many requests — try again in a minute.', 429, env, origin);
      return handleClaimLicense(request, env, origin);
    }
    if (url.pathname === '/contact-message') {
      if (!(await checkRateLimit(env, ip, 'contact', 5))) return jsonError('Too many requests — try again in a minute.', 429, env, origin);
      return handleContactMessage(request, env, origin);
    }
    if (url.pathname === '/log-error') {
      if (!(await checkRateLimit(env, ip, 'log-error', 30))) return jsonError('Too many requests — try again in a minute.', 429, env, origin);
      return handleLogError(request, env, origin);
    }
    return jsonError('Not found', 404, env, origin);
  },
};

/* ── 1. AI proxy ──────────────────────────────────────────────── */
// Gated behind a paid subscription — every caller must prove (via a fresh Firebase
// ID token) that they're signed in AND that licenses/{uid}.paid is true. This
// check has to live here, not just in the client (js/ai.js): anyone can call
// this endpoint directly with curl, bypassing whatever the UI does.
async function handleAiProxy(request, env, origin) {
  if (!env.ANTHROPIC_API_KEY) return jsonError('Server misconfigured: ANTHROPIC_API_KEY secret not set.', 500, env, origin);
  if (!env.FIREBASE_PROJECT_ID) return jsonError('Server misconfigured: FIREBASE_PROJECT_ID not set.', 500, env, origin);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env, origin); }

  if (!body.idToken) return jsonError('Sign in and subscribe to use AI upload.', 402, env, origin);
  let payload;
  try { payload = await verifyFirebaseIdToken(body.idToken, env.FIREBASE_PROJECT_ID); }
  catch { return jsonError('Your session expired — sign in again.', 401, env, origin); }

  try {
    const license = await readFirestoreDoc(env, 'licenses', payload.sub);
    if (!license?.paid) return jsonError('AI upload requires a subscription ($7.99/month).', 402, env, origin);
  } catch (e) {
    return jsonError('Could not verify access: ' + e.message, 500, env, origin);
  }

  if (!ALLOWED_MODELS.includes(body.model)) return jsonError(`Model not allowed. Use one of: ${ALLOWED_MODELS.join(', ')}`, 400, env, origin);
  if (!body.system || !Array.isArray(body.messages)) return jsonError('Request must include system and messages', 400, env, origin);

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: body.model,
      max_tokens: Math.min(Number(body.max_tokens) || 1024, MAX_TOKENS_CAP),
      system: body.system,
      messages: body.messages,
    }),
  });

  const text = await upstream.text();
  return new Response(text, { status: upstream.status, headers: corsHeaders(env, origin, { 'content-type': 'application/json' }) });
}

/* ── 2. Checkout ──────────────────────────────────────────────── */
async function handleCreateCheckoutSession(request, env, origin) {
  if (!env.STRIPE_SECRET_KEY) return jsonError('Server misconfigured: STRIPE_SECRET_KEY not set.', 500, env, origin);
  const appUrl = env.APP_URL;
  if (!appUrl) return jsonError('Server misconfigured: APP_URL not set.', 500, env, origin);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env, origin); }

  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('submit_type', 'subscribe');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][unit_amount]', String(PLUS_PRICE_CENTS));
  params.set('line_items[0][price_data][recurring][interval]', 'month');
  params.set('line_items[0][price_data][product_data][name]', 'Semester HQ');
  params.set('line_items[0][price_data][product_data][description]', 'Sign-in & sync across every device — cross-device access, AI syllabus upload, and study groups. Cancel anytime.');
  // Same square mark set as the account's Stripe branding (settings/branding) —
  // shows up as the line-item thumbnail in the checkout Details dropdown.
  params.set('line_items[0][price_data][product_data][images][0]', 'https://semester-hq.com/assets/icon-512.png');
  params.set('line_items[0][quantity]', '1');
  params.set('success_url', `${appUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${appUrl}?checkout=cancel`);
  // Shows a "promotion code" box on the Stripe checkout page, so comped
  // accounts (content partnerships, gifted access, etc.) can be handled
  // entirely via Stripe Coupons — see SEMESTER_HQ_COUPON_PROCESS.md.
  params.set('allow_promotion_codes', 'true');
  if (body.uid) params.set('client_reference_id', String(body.uid));
  if (body.email) params.set('customer_email', String(body.email));
  // Stamped onto the Subscription object Stripe creates, so later lifecycle
  // events (renewal, cancellation) can be resolved back to a uid/email
  // without a separate customer-id lookup table.
  if (body.uid) params.set('subscription_data[metadata][uid]', String(body.uid));
  if (body.email) params.set('subscription_data[metadata][email]', String(body.email).toLowerCase().trim());

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) return jsonError('Could not start checkout: ' + (data.error?.message || 'unknown error'), 500, env, origin);

  return new Response(JSON.stringify({ url: data.url }), { headers: corsHeaders(env, origin, { 'content-type': 'application/json' }) });
}

/* ── 2b. Billing portal ───────────────────────────────────────── */
// Lets a signed-in, paying user manage payment info or cancel their
// subscription through Stripe's own hosted portal — no custom cancel UI
// to build, and Stripe (not us) handles confirming/processing it. The
// webhook (below) picks up the resulting cancellation automatically.
async function handleCreatePortalSession(request, env, origin) {
  if (!env.STRIPE_SECRET_KEY) return jsonError('Server misconfigured: STRIPE_SECRET_KEY not set.', 500, env, origin);
  if (!env.FIREBASE_PROJECT_ID) return jsonError('Server misconfigured: FIREBASE_PROJECT_ID not set.', 500, env, origin);
  const appUrl = env.APP_URL;
  if (!appUrl) return jsonError('Server misconfigured: APP_URL not set.', 500, env, origin);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env, origin); }
  if (!body.idToken) return jsonError('Sign in first.', 401, env, origin);

  let payload;
  try { payload = await verifyFirebaseIdToken(body.idToken, env.FIREBASE_PROJECT_ID); }
  catch { return jsonError('Your session expired — sign in again.', 401, env, origin); }

  let license;
  try { license = await readFirestoreDoc(env, 'licenses', payload.sub); }
  catch (e) { return jsonError('Could not look up your subscription: ' + e.message, 500, env, origin); }

  if (!license?.stripeCustomerId) return jsonError('No active subscription found for this account.', 404, env, origin);

  const params = new URLSearchParams();
  params.set('customer', license.stripeCustomerId);
  params.set('return_url', appUrl);

  const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) return jsonError('Could not open billing portal: ' + (data.error?.message || 'unknown error'), 500, env, origin);

  return new Response(JSON.stringify({ url: data.url }), { headers: corsHeaders(env, origin, { 'content-type': 'application/json' }) });
}

/* ── 3. Licensing ─────────────────────────────────────────────── */
// Stripe webhook: the one place that marks someone as paid. `licenses/{uid}` is written
// when we already know the uid (in-app purchase); `licensesByEmail/{email}` is written
// too so a person who paid from the marketing site (before ever signing in) can later
// claim it via /claim-license once they sign up with the same email.
async function handleStripeWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response('Server misconfigured', { status: 500 });
  const rawBody = await request.text();
  const sig = request.headers.get('Stripe-Signature') || '';
  const valid = await verifyStripeSignature(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return new Response('Invalid signature', { status: 400 });

  let event;
  try { event = JSON.parse(rawBody); } catch { return new Response('Invalid JSON', { status: 400 }); }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.payment_status === 'paid') {
      const uid = session.client_reference_id || null;
      const email = (session.customer_details?.email || session.customer_email || '').toLowerCase().trim();
      const licenseFields = {
        paid: true,
        stripeSessionId: session.id,
        stripeSubscriptionId: session.subscription || '',
        stripeCustomerId: session.customer || '',
        purchasedAt: new Date(),
      };
      try {
        if (uid) await writeFirestoreDoc(env, 'licenses', uid, licenseFields);
        if (email) await writeFirestoreDoc(env, 'licensesByEmail', encodeEmailDocId(email), { ...licenseFields, email });
      } catch (e) {
        console.error('License write failed', e);
        return new Response('License write failed', { status: 500 }); // non-2xx makes Stripe retry
      }
    }
  }

  // Subscription lifecycle — renewals, payment failures, and cancellations
  // all land here as the subscription's `status` changes. uid/email come
  // from the metadata stamped on the subscription at checkout time (see
  // handleCreateCheckoutSession), not from a separate lookup table.
  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const uid = sub.metadata?.uid || null;
    const email = (sub.metadata?.email || '').toLowerCase().trim();
    const active = event.type === 'customer.subscription.updated' && ['active', 'trialing'].includes(sub.status);
    const licenseFields = {
      paid: active,
      stripeSubscriptionId: sub.id,
      stripeCustomerId: sub.customer || '',
      updatedAt: new Date(),
    };
    try {
      if (uid) await writeFirestoreDoc(env, 'licenses', uid, licenseFields);
      if (email) await writeFirestoreDoc(env, 'licensesByEmail', encodeEmailDocId(email), { ...licenseFields, email });
    } catch (e) {
      console.error('License update failed', e);
      return new Response('License update failed', { status: 500 }); // non-2xx makes Stripe retry
    }
  }

  return new Response('ok', { status: 200 });
}

// Called by the signed-in client with its Firebase ID token to link a marketing-site
// purchase (keyed by email, made before the person had an account) to their real uid.
async function handleClaimLicense(request, env, origin) {
  if (!env.FIREBASE_PROJECT_ID) return jsonError('Server misconfigured: FIREBASE_PROJECT_ID not set.', 500, env, origin);
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env, origin); }
  if (!body.idToken) return jsonError('Missing idToken', 400, env, origin);

  let payload;
  try { payload = await verifyFirebaseIdToken(body.idToken, env.FIREBASE_PROJECT_ID); }
  catch { return jsonError('Invalid session, please sign in again.', 401, env, origin); }

  const uid = payload.sub;
  const email = (payload.email || '').toLowerCase().trim();

  try {
    const existing = await readFirestoreDoc(env, 'licenses', uid);
    if (existing?.paid) return jsonOk({ paid: true }, env, origin);

    if (email) {
      const byEmail = await readFirestoreDoc(env, 'licensesByEmail', encodeEmailDocId(email));
      if (byEmail?.paid) {
        await writeFirestoreDoc(env, 'licenses', uid, { paid: true, stripeSessionId: byEmail.stripeSessionId || '', purchasedAt: new Date() });
        return jsonOk({ paid: true }, env, origin);
      }
    }
    return jsonOk({ paid: false }, env, origin);
  } catch (e) {
    return jsonError('Could not check license: ' + e.message, 500, env, origin);
  }
}

/* ── 4. Contact form ──────────────────────────────────────────── */
// Writes to Firestore's `feedback` collection — clients can never read or
// write it directly (see firestore.rules), only this route, using the same
// service account as licensing. Reachable by anyone (signed in or not), so
// this is the one route that needs its own input validation and a honeypot
// on top of the shared rate limiting.
const CONTACT_CATEGORIES = ['bug', 'feature', 'billing', 'group', 'feedback', 'other'];
async function handleContactMessage(request, env, origin) {
  if (!env.FIREBASE_PROJECT_ID) return jsonError('Server misconfigured: FIREBASE_PROJECT_ID not set.', 500, env, origin);
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env, origin); }

  // Honeypot: a field real users never see or fill in. Bots that blindly
  // fill every field trip it — report success anyway so they don't learn
  // to leave it blank.
  if (body.website) return jsonOk({ ok: true }, env, origin);

  const name = String(body.name || '').trim().slice(0, 200);
  const email = String(body.email || '').trim().slice(0, 320);
  const category = CONTACT_CATEGORIES.includes(body.category) ? body.category : 'other';
  const message = String(body.message || '').trim().slice(0, 5000);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError('Enter a valid email so we can reply.', 400, env, origin);
  if (!message) return jsonError('Message can’t be empty.', 400, env, origin);

  try {
    const id = crypto.randomUUID();
    await writeFirestoreDoc(env, 'feedback', id, { name, email, category, message, createdAt: new Date() });
    return jsonOk({ ok: true }, env, origin);
  } catch (e) {
    return jsonError('Could not send your message: ' + e.message, 500, env, origin);
  }
}

/* ── 5. Error logging ─────────────────────────────────────────── */
// Writes to Firestore's `errors` collection — same server-only pattern as
// `feedback` (see firestore.rules). Reachable by anyone, so payload sizes
// are capped and fields coerced to strings rather than trusted as-is.
const ERROR_SOURCES = ['app', 'marketing'];
async function handleLogError(request, env, origin) {
  if (!env.FIREBASE_PROJECT_ID) return jsonError('Server misconfigured: FIREBASE_PROJECT_ID not set.', 500, env, origin);
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env, origin); }

  const source = ERROR_SOURCES.includes(body.source) ? body.source : 'app';
  const message = String(body.message || '').trim().slice(0, 2000);
  const stack = String(body.stack || '').trim().slice(0, 4000);
  const url = String(body.url || '').trim().slice(0, 500);
  const userAgent = String(body.userAgent || '').trim().slice(0, 300);

  if (!message) return jsonError('Missing error message', 400, env, origin);

  try {
    const id = crypto.randomUUID();
    await writeFirestoreDoc(env, 'errors', id, { source, message, stack, url, userAgent, createdAt: new Date() });
    return jsonOk({ ok: true }, env, origin);
  } catch (e) {
    // Don't fail loudly back to the client over a logging endpoint — just
    // report success so a broken error-reporter doesn't itself spam retries.
    console.error('Error log write failed', e);
    return jsonOk({ ok: true }, env, origin);
  }
}

/* ── 6. Error viewer ──────────────────────────────────────────── */
// Backs admin/errors.html. Bearer token compared with timing-safe equality
// against the ADMIN_TOKEN secret (set via `wrangler secret put ADMIN_TOKEN`).
async function handleAdminErrors(request, env) {
  const adminCors = { 'Access-Control-Allow-Origin': '*', 'content-type': 'application/json', 'X-Content-Type-Options': 'nosniff' };
  if (!env.ADMIN_TOKEN) return new Response(JSON.stringify({ error: 'Server misconfigured: ADMIN_TOKEN not set.' }), { status: 500, headers: adminCors });
  if (!env.FIREBASE_PROJECT_ID) return new Response(JSON.stringify({ error: 'Server misconfigured: FIREBASE_PROJECT_ID not set.' }), { status: 500, headers: adminCors });

  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token || !timingSafeEqual(token, env.ADMIN_TOKEN)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: adminCors });
  }

  try {
    const errors = await queryRecentErrors(env, 50);
    return new Response(JSON.stringify({ errors }), { headers: adminCors });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Could not load errors: ' + e.message }), { status: 500, headers: adminCors });
  }
}

/* ── Stripe signature verification ───────────────────────────── */
async function verifyStripeSignature(rawBody, sigHeader, secret) {
  const parts = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')));
  const timestamp = parts.t, expectedSig = parts.v1;
  if (!timestamp || !expectedSig) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false; // 5 min replay window

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const computed = [...new Uint8Array(sigBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(computed, expectedSig);
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ── Firebase ID token verification (manual — no Admin SDK in Workers) ─
   Mirrors what the Admin SDK does: check standard claims, then verify the
   RS256 signature against Google's public JWK set for Firebase Auth. ─── */
async function verifyFirebaseIdToken(idToken, projectId) {
  const [headerB64, payloadB64, sigB64] = idToken.split('.');
  if (!headerB64 || !payloadB64 || !sigB64) throw new Error('Malformed token');
  const header = JSON.parse(atob(base64urlToBase64(headerB64)));
  const payload = JSON.parse(atob(base64urlToBase64(payloadB64)));
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw new Error('Bad audience');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Bad issuer');
  if (payload.exp < now) throw new Error('Expired');
  if (!payload.sub) throw new Error('No subject');

  const jwkRes = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  const { keys } = await jwkRes.json();
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('Unknown key id');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64urlToBuffer(sigB64), new TextEncoder().encode(`${headerB64}.${payloadB64}`));
  if (!valid) throw new Error('Bad signature');
  return payload;
}

/* ── Firestore REST helpers, authenticated as our own service account ──
   Cloudflare Workers can't use the Node-only firebase-admin SDK, so we
   sign our own OAuth2 JWT with the service account's private key and
   exchange it for an access token, same as Admin SDK does internally. ── */
async function getFirebaseAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  // .trim() defends against stray whitespace/newlines from copy-pasting the
  // secret value in (a real failure mode: Google's OAuth server reports a
  // trimmed-looking "account not found" for this rather than a clearer error).
  const clientEmail = (env.FIREBASE_CLIENT_EMAIL || '').trim();
  const claims = base64url(JSON.stringify({
    iss: clientEmail,
    sub: clientEmail,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore',
  }));
  const signingInput = `${header}.${claims}`;
  const key = await importPrivateKey(env.FIREBASE_PRIVATE_KEY);
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64urlFromBuffer(sigBuf)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Firebase auth failed: ' + JSON.stringify(data));
  return data.access_token;
}
async function importPrivateKey(pem) {
  const normalized = pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
  const b64 = normalized.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}
async function writeFirestoreDoc(env, collection, docId, fields) {
  const token = await getFirebaseAccessToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
  });
  if (!res.ok) throw new Error('Firestore write failed: ' + await res.text());
}
async function readFirestoreDoc(env, collection, docId) {
  const token = await getFirebaseAccessToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Firestore read failed: ' + await res.text());
  const data = await res.json();
  return fromFirestoreFields(data.fields || {});
}
async function queryRecentErrors(env, limit) {
  const token = await getFirebaseAccessToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'errors' }],
      orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
      limit,
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Firestore query failed: ' + await res.text());
  const rows = await res.json();
  return rows
    .filter(r => r.document)
    .map(r => ({ id: r.document.name.split('/').pop(), ...fromFirestoreFields(r.document.fields || {}) }));
}
function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else if (typeof v === 'number') fields[k] = { integerValue: String(Math.trunc(v)) };
    else if (v instanceof Date) fields[k] = { timestampValue: v.toISOString() };
    else fields[k] = { stringValue: String(v) };
  }
  return fields;
}
function fromFirestoreFields(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields)) {
    if ('booleanValue' in v) obj[k] = v.booleanValue;
    else if ('integerValue' in v) obj[k] = Number(v.integerValue);
    else if ('stringValue' in v) obj[k] = v.stringValue;
    else if ('timestampValue' in v) obj[k] = v.timestampValue;
  }
  return obj;
}
function encodeEmailDocId(email) { return email.replace(/[^a-zA-Z0-9@._-]/g, '_'); }

/* ── Rate limiting (KV, fixed 1-minute window per IP+route) ─────
   No RATE_LIMIT KV bound → limiting is skipped (e.g. local `wrangler dev`)
   rather than failing closed, so local development isn't blocked. ──── */
async function checkRateLimit(env, ip, routeKey, limit) {
  if (!env.RATE_LIMIT) return true;
  const bucket = Math.floor(Date.now() / 60000);
  const key = `${routeKey}:${ip}:${bucket}`;
  const current = Number(await env.RATE_LIMIT.get(key)) || 0;
  if (current >= limit) return false;
  await env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: 120 });
  return true;
}

/* ── CORS / origin allow-list ────────────────────────────────── */
function allowedOrigins(env) {
  return (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
}
function isAllowedOrigin(env, origin) {
  const list = allowedOrigins(env);
  if (list.length === 0 || list.includes('*')) return true;
  return list.includes(origin);
}
function corsHeaders(env, origin, extra = {}) {
  const list = allowedOrigins(env);
  const allow = list.includes('*') || list.length === 0 ? '*' : (list.includes(origin) ? origin : list[0]);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...extra,
  };
}
function jsonOk(obj, env, origin) {
  return new Response(JSON.stringify(obj), { headers: corsHeaders(env, origin, { 'content-type': 'application/json' }) });
}
function jsonError(message, status, env, origin) {
  return new Response(JSON.stringify({ error: message }), { status, headers: corsHeaders(env, origin, { 'content-type': 'application/json' }) });
}

/* ── base64url helpers ───────────────────────────────────────── */
function base64url(str) { return base64urlFromBuffer(new TextEncoder().encode(str)); }
function base64urlFromBuffer(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlToBase64(b64url) {
  return b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(b64url.length + (4 - (b64url.length % 4)) % 4, '=');
}
function base64urlToBuffer(b64url) {
  const bin = atob(base64urlToBase64(b64url));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
