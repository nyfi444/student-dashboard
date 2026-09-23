/* ── worker/src/billing.js ──────────────────────────────────────
   Starting a subscription (/create-checkout-session) and opening the
   billing portal (/create-portal-session). Job 2 in index.js.
──────────────────────────────────────────────────────────────── */

import { logServerIssue } from './diagnostics.js';
import { encodeEmailDocId, patchFirestoreDoc, readFirestoreDoc, verifyFirebaseIdToken } from './firebase.js';
import { corsHeaders, jsonError, jsonOk, verifiedEmailOf } from './http.js';
import { createStripePortalSession, findStripeCustomerByEmail } from './stripe.js';

const PLUS_PRICE_CENTS = 799; // $7.99/month, bump the marketing copy too if this changes

/* ── 2. Checkout ──────────────────────────────────────────────── */
export async function handleCreateCheckoutSession(request, env, origin) {
  if (!env.STRIPE_SECRET_KEY) return jsonError('Server misconfigured: STRIPE_SECRET_KEY not set.', 500, env, origin);
  const appUrl = env.APP_URL;
  if (!appUrl) return jsonError('Server misconfigured: APP_URL not set.', 500, env, origin);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env, origin); }

  // Who this purchase is for. A signed-in buyer proves it with an ID token,
  // and the uid and email come from that token, never from the body: before
  // this, anyone could start a checkout naming somebody else's uid, and the
  // cancellation webhook would then switch that person off. A buyer who
  // isn't signed in (the marketing site) gets an email-only session and
  // claims it after signing in (see handleClaimLicense).
  let uid = null, email = '';
  if (body.idToken) {
    let payload;
    try { payload = await verifyFirebaseIdToken(body.idToken, env.FIREBASE_PROJECT_ID); }
    catch { return jsonError('Your session expired, sign in again.', 401, env, origin); }
    uid = payload.sub;
    email = verifiedEmailOf(payload);
  } else if (body.uid) {
    return jsonError('Sign in again before subscribing.', 401, env, origin);
  } else if (body.email) {
    email = String(body.email).toLowerCase().trim().slice(0, 320);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) email = '';
  }

  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('submit_type', 'subscribe');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][unit_amount]', String(PLUS_PRICE_CENTS));
  params.set('line_items[0][price_data][recurring][interval]', 'month');
  params.set('line_items[0][price_data][product_data][name]', 'Semester HQ');
  params.set('line_items[0][price_data][product_data][description]', 'Sign-in & sync across every device: cross-device access, AI syllabus upload, and study groups. Cancel anytime.');
  // Same square mark set as the account's Stripe branding (settings/branding),
  // shows up as the line-item thumbnail in the checkout Details dropdown.
  params.set('line_items[0][price_data][product_data][images][0]', 'https://semester-hq.com/assets/icon-512.png');
  params.set('line_items[0][quantity]', '1');
  params.set('success_url', `${appUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${appUrl}?checkout=cancel`);
  // Shows a "promotion code" box on the Stripe checkout page, so comped
  // accounts (content partnerships, gifted access, etc.) can be handled
  // entirely via Stripe Coupons, see SEMESTER_HQ_COUPON_PROCESS.md.
  params.set('allow_promotion_codes', 'true');
  if (uid) params.set('client_reference_id', uid);
  if (email) params.set('customer_email', email);
  // Stamped onto the Subscription object Stripe creates, so later lifecycle
  // events (renewal, cancellation) can be resolved back to a uid/email
  // without a separate customer-id lookup table.
  if (uid) params.set('subscription_data[metadata][uid]', uid);
  if (email) params.set('subscription_data[metadata][email]', email);

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    await logServerIssue(env, 'checkout', 'Stripe refused to start a checkout', null, { stripe: String(data.error?.message || '').slice(0, 200) });
    return jsonError('Could not start checkout right now. Try again in a moment.', 500, env, origin);
  }

  return new Response(JSON.stringify({ url: data.url }), { headers: corsHeaders(env, origin, { 'content-type': 'application/json' }) });
}

/* ── 2b. Billing portal ───────────────────────────────────────── */
// Lets a signed-in, paying user manage payment info or cancel their
// subscription through Stripe's own hosted portal, no custom cancel UI
// to build, and Stripe (not us) handles confirming/processing it. The
// webhook (below) picks up the resulting cancellation automatically.
export async function handleCreatePortalSession(request, env, origin) {
  if (!env.STRIPE_SECRET_KEY) return jsonError('Server misconfigured: STRIPE_SECRET_KEY not set.', 500, env, origin);
  if (!env.FIREBASE_PROJECT_ID) return jsonError('Server misconfigured: FIREBASE_PROJECT_ID not set.', 500, env, origin);
  const appUrl = env.APP_URL;
  if (!appUrl) return jsonError('Server misconfigured: APP_URL not set.', 500, env, origin);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env, origin); }
  if (!body.idToken) return jsonError('Sign in first.', 401, env, origin);

  let payload;
  try { payload = await verifyFirebaseIdToken(body.idToken, env.FIREBASE_PROJECT_ID); }
  catch { return jsonError('Your session expired, sign in again.', 401, env, origin); }

  let license;
  try { license = await readFirestoreDoc(env, 'licenses', payload.sub); }
  catch (e) {
    await logServerIssue(env, 'checkout', 'Could not read a license for the billing portal', e);
    return jsonError('Could not look up your subscription right now. Try again in a moment.', 500, env, origin);
  }

  // licenses/{uid}.stripeCustomerId can be missing even for a genuinely paying
  // account: anyone who bought from the marketing site before creating an
  // account gets their license via /claim-license copying licensesByEmail over,
  // and older claims didn't carry stripeCustomerId across (see handleClaimLicense).
  // Fall back to the email-keyed doc (written by the same webhook) rather than
  // telling a paying customer they have no subscription.
  const verifiedEmail = verifiedEmailOf(payload);
  let stripeCustomerId = license?.stripeCustomerId;
  if (!stripeCustomerId && verifiedEmail) {
    try {
      const byEmail = await readFirestoreDoc(env, 'licensesByEmail', encodeEmailDocId(verifiedEmail));
      if (byEmail?.paid) stripeCustomerId = byEmail.stripeCustomerId;
    } catch (e) { await logServerIssue(env, 'license', 'licensesByEmail fallback lookup failed', e); }
  }
  // Last try: a Stripe customer under this email that was never linked to the
  // account (paid with the same email some other way). Linked now, so the
  // next visit doesn't need the search.
  if (!stripeCustomerId && verifiedEmail) {
    try {
      stripeCustomerId = await findStripeCustomerByEmail(env, verifiedEmail);
      if (stripeCustomerId) await patchFirestoreDoc(env, `licenses/${payload.sub}`, { stripeCustomerId });
    } catch (e) { await logServerIssue(env, 'checkout', 'Stripe customer lookup failed', e); }
  }
  // No billing to manage. Said plainly rather than as an error: access that
  // came from a group plan, or that was set up directly, has nothing to
  // update or cancel here.
  if (!stripeCustomerId) {
    if (license?.groupPaid) return jsonError(`Your plan is covered by ${license.groupName || 'your group'}, so there’s no billing for you to manage. The group’s admin handles it.`, 404, env, origin, { reason: 'group' });
    return jsonError('There’s no subscription on this account, so there’s nothing to manage or cancel, and you won’t be charged.', 404, env, origin, { reason: 'no-billing' });
  }

  try {
    return jsonOk({ url: await createStripePortalSession(env, stripeCustomerId, appUrl) }, env, origin);
  } catch (e) {
    await logServerIssue(env, 'checkout', 'Could not open the billing portal', e);
    return jsonError('Could not open the billing portal right now. Try again in a moment.', 500, env, origin);
  }
}
