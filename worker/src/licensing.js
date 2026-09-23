/* ── worker/src/licensing.js ────────────────────────────────────
   Who has paid: the Stripe webhook, /claim-license and /check-email.
   The only writer of the `licenses` collections. Job 3 in index.js.
──────────────────────────────────────────────────────────────── */

import { logServerIssue } from './diagnostics.js';
import { encodeEmailDocId, patchFirestoreDoc, readFirestoreDoc, runFirestoreQuery, verifyFirebaseIdToken, writeFirestoreDoc } from './firebase.js';
import { activateGroupPlan, syncGroupPlan } from './groups.js';
import { claimWebhookEvent, jsonError, jsonOk, turnstileOk, underDailyCap, verifiedEmailOf } from './http.js';
import { verifyStripeSignature } from './stripe.js';

/* ── 3. Licensing ─────────────────────────────────────────────── */
// Stripe webhook: the one place that marks someone as paid. `licenses/{uid}` is written
// when we already know the uid (in-app purchase); `licensesByEmail/{email}` is written
// too so a person who paid from the marketing site (before ever signing in) can later
// claim it via /claim-license once they sign up with the same email.
export async function handleStripeWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response('Server misconfigured', { status: 500 });
  const rawBody = await request.text();
  const sig = request.headers.get('Stripe-Signature') || '';
  const valid = await verifyStripeSignature(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return new Response('Invalid signature', { status: 400 });

  let event;
  try { event = JSON.parse(rawBody); } catch { return new Response('Invalid JSON', { status: 400 }); }
  if (event.id && !(await claimWebhookEvent(env, event.id))) return new Response('ok (already handled)', { status: 200 });

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    // A group plan purchase activates the plan, not a license for whoever paid.
    if (session.metadata?.kind === 'group') {
      if (session.payment_status === 'unpaid') return new Response('ok', { status: 200 });
      try { await activateGroupPlan(env, session); }
      catch (e) {
        console.error('Group plan activation failed', e);
        return new Response(`Group plan activation failed: ${e.message}`, { status: 500 });
      }
      return new Response('ok', { status: 200 });
    }
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
        if (uid) await setIndividualLicense(env, uid, licenseFields, true, session.subscription || '');
        if (email) await setEmailLicense(env, email, licenseFields, session.subscription || '');
      } catch (e) {
        console.error('License write failed', e);
        return new Response(`License write failed: ${e.message}`, { status: 500 }); // non-2xx makes Stripe retry
      }
    }
  }

  // Subscription lifecycle: renewals, payment failures, and cancellations
  // all land here as the subscription's `status` changes. uid/email come
  // from the metadata stamped on the subscription at checkout time (see
  // handleCreateCheckoutSession), not from a separate lookup table.
  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    if (sub.metadata?.kind === 'group') {
      try { await syncGroupPlan(env, sub, event.type === 'customer.subscription.deleted'); }
      catch (e) {
        console.error('Group plan update failed', e);
        return new Response(`Group plan update failed: ${e.message}`, { status: 500 });
      }
      return new Response('ok', { status: 200 });
    }
    let uid = sub.metadata?.uid || null;
    let email = (sub.metadata?.email || '').toLowerCase().trim();
    // A purchase from the marketing site carries no uid: the person signed in
    // later and claimed it by email. Find the license by the subscription
    // itself, so a cancellation still reaches the account it belongs to.
    if (!uid) uid = await licenseIdForSubscription(env, 'licenses', sub.id);
    if (!email) email = await licenseIdForSubscription(env, 'licensesByEmail', sub.id, true);
    const active = event.type === 'customer.subscription.updated' && ['active', 'trialing'].includes(sub.status);
    const licenseFields = {
      paid: active,
      stripeSubscriptionId: sub.id,
      stripeCustomerId: sub.customer || '',
      updatedAt: new Date(),
    };
    try {
      if (uid) await setIndividualLicense(env, uid, licenseFields, active, sub.id);
      if (email) await setEmailLicense(env, email, licenseFields, sub.id);
    } catch (e) {
      console.error('License update failed', e);
      return new Response(`License update failed: ${e.message}`, { status: 500 }); // non-2xx makes Stripe retry
    }
  }

  return new Response('ok', { status: 200 });
}

// A person's own subscription, kept apart from any group seat they hold:
// `paid` is true when either one is. Merged into the doc rather than
// replacing it, so a renewal or cancellation never wipes a group seat.
async function setIndividualLicense(env, uid, fields, individualPaid, subscriptionId = '') {
  const existing = await readFirestoreDoc(env, 'licenses', uid);
  if (!subscriptionBelongsHere(existing, subscriptionId, individualPaid)) {
    await logServerIssue(env, 'checkout', 'Ignored an event from a subscription this license does not follow', null, { subscriptionId });
    return;
  }
  await patchFirestoreDoc(env, `licenses/${uid}`, { ...fields, individualPaid, paid: individualPaid || !!existing?.groupPaid });
}
// The email-keyed twin, same rule.
async function setEmailLicense(env, email, fields, subscriptionId = '') {
  const id = encodeEmailDocId(email);
  const existing = await readFirestoreDoc(env, 'licensesByEmail', id);
  if (!subscriptionBelongsHere(existing, subscriptionId, fields.paid === true)) return;
  await writeFirestoreDoc(env, 'licensesByEmail', id, { ...fields, email });
}
// A license follows one subscription at a time. An event about some other
// subscription may not switch the person off, and may only take over when
// the one on record has already lapsed. This is what stops a second checkout
// that names an account from being able to cancel that account's access.
function subscriptionBelongsHere(existing, subscriptionId, activating) {
  const current = existing?.stripeSubscriptionId || '';
  if (!current || !subscriptionId || current === subscriptionId) return true;
  return activating && individualPaidOf(existing) === false;
}
// Which license document (by id) records this subscription, if exactly one does.
async function licenseIdForSubscription(env, collectionId, subscriptionId, asEmail = false) {
  if (!subscriptionId) return asEmail ? '' : null;
  try {
    const rows = await runFirestoreQuery(env, {
      from: [{ collectionId }],
      where: { fieldFilter: { field: { fieldPath: 'stripeSubscriptionId' }, op: 'EQUAL', value: { stringValue: subscriptionId } } },
      limit: 2,
    });
    if (rows.length !== 1) return asEmail ? '' : null;
    return asEmail ? String(rows[0].email || '').toLowerCase().trim() : rows[0].id;
  } catch (e) {
    await logServerIssue(env, 'checkout', 'Could not look up the license for a subscription', e);
    return asEmail ? '' : null;
  }
}
// Docs from before group plans have no individualPaid; their `paid` was
// the person's own subscription.
export function individualPaidOf(license) {
  if (!license) return false;
  return typeof license.individualPaid === 'boolean' ? license.individualPaid : !license.groupPaid && !!license.paid;
}

// Called by the signed-in client with its Firebase ID token to link a marketing-site
// purchase (keyed by email, made before the person had an account) to their real uid.
export async function handleClaimLicense(request, env, origin) {
  if (!env.FIREBASE_PROJECT_ID) return jsonError('Server misconfigured: FIREBASE_PROJECT_ID not set.', 500, env, origin);
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env, origin); }
  if (!body.idToken) return jsonError('Missing idToken', 400, env, origin);

  let payload;
  try { payload = await verifyFirebaseIdToken(body.idToken, env.FIREBASE_PROJECT_ID); }
  catch { return jsonError('Invalid session, please sign in again.', 401, env, origin); }

  const uid = payload.sub;
  const email = verifiedEmailOf(payload);

  try {
    const existing = await readFirestoreDoc(env, 'licenses', uid);
    if (existing?.paid) return jsonOk({ paid: true }, env, origin);

    if (email) {
      const byEmail = await readFirestoreDoc(env, 'licensesByEmail', encodeEmailDocId(email));
      if (byEmail?.paid) {
        // Carry the Stripe IDs over too, not just `paid`. Without these,
        // "Manage subscription" (needs stripeCustomerId) and account deletion's
        // auto-cancel (needs stripeSubscriptionId) both silently fail later for
        // anyone who bought from the marketing site before signing in.
        await setIndividualLicense(env, uid, {
          stripeSessionId: byEmail.stripeSessionId || '',
          stripeSubscriptionId: byEmail.stripeSubscriptionId || '',
          stripeCustomerId: byEmail.stripeCustomerId || '',
          purchasedAt: new Date(),
        }, true);
        return jsonOk({ paid: true }, env, origin);
      }
    }
    return jsonOk({ paid: false }, env, origin);
  } catch (e) {
    await logServerIssue(env, 'license', 'Could not check a license', e);
    return jsonError('Could not check your plan right now. Try again in a moment.', 500, env, origin);
  }
}

// Unauthenticated, pre-signin lookup: lets login.html skip the magic-link
// round trip for an email with no paid plan and send it straight to Stripe
// Checkout instead. Only ever returns a bare boolean, never stripeCustomerId,
// uid, or anything else from the license doc, so this can't be used to pull
// anything more than "has this email paid," which is the same fact anyone
// could already confirm by going through the real sign-in flow. Rate-limited
// (see router) since, unlike /claim-license, it doesn't require proving you
// own the email first.
export async function handleCheckEmail(request, env, origin) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env, origin); }
  const email = String(body.email || '').toLowerCase().trim();
  if (!email || !email.includes('@')) return jsonError('Missing or invalid email', 400, env, origin);
  // This answers "has this address paid" to anyone who asks, so it gets the
  // bot check when one is configured, and a daily ceiling on top of the
  // per-minute limit. Past the ceiling the login page falls back to the
  // sign-in link, which works for everyone.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await turnstileOk(env, body.turnstileToken, ip))) return jsonError('Please complete the verification and try again.', 400, env, origin);
  if (!(await underDailyCap(env, 'check-email', 2000))) return jsonError('Too many lookups today. Use the sign-in link instead.', 429, env, origin);

  try {
    const byEmail = await readFirestoreDoc(env, 'licensesByEmail', encodeEmailDocId(email));
    return jsonOk({ paid: !!byEmail?.paid }, env, origin);
  } catch (e) {
    await logServerIssue(env, 'license', 'Could not check an email', e);
    return jsonError('Could not check that right now. Try again in a moment.', 500, env, origin);
  }
}
