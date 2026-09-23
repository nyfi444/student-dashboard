/* ── worker/src/subscribers.js ──────────────────────────────────
   One row per Stripe subscription for the Business OS's subscriber list
   (/admin/business-summary → stripe.subscribers), and the two lookups
   that finish those rows after the list is built: which promotion code a
   discount came from, and whether a recent buyer ever signed in. Part of
   job 8 in index.js; dashboard.js calls it.

   The Worker sends no Stripe-Version header, so what comes back is
   whatever API version the Stripe account is pinned to. A discount has
   had two shapes over the years and both are read here:
     - older: subscription.discount (one object), coupon at discount.coupon
     - newer: subscription.discounts[] (ids, or objects when expanded),
       coupon at discount.coupon or, newest, discount.source.coupon (an id
       unless expanded)
   A promotion code is an id unless it was expanded. Anything still an id
   after the list call is looked up once in bulk (resolveDiscountIds), and
   left blank rather than guessed if Stripe won't say.
──────────────────────────────────────────────────────────────── */

import { runFirestoreQuery } from './firebase.js';
import { stripeGetJson } from './stripe.js';

const SIGNED_IN_WINDOW_DAYS = 60;
// Same rule the checkout routes apply before storing it (see checkouts.js).
const SUBSCRIBER_VIA_RE = /^[a-z0-9-]{2,24}$/;

// One row of the Business OS's subscriber list. Only what Nyla needs to
// recognize someone and see where they stand: who, which plan, since when,
// what they pay, what discount they came in on, and why they left if they
// said. This route is ADMIN_TOKEN-only.
export function subscriberRow(sub, { created, listCents, chargedCents }) {
  const customer = sub.customer && typeof sub.customer === 'object' && !sub.customer.deleted ? sub.customer : null;
  const item = sub.items?.data?.[0] || {};
  const periodEnd = sub.current_period_end || item.current_period_end || null;
  const coupon = sub.discount?.coupon || (Array.isArray(sub.discounts) && typeof sub.discounts[0] === 'object' ? sub.discounts[0]?.coupon : null);
  const isGroup = sub.metadata?.kind === 'group';
  const discount = discountOf(sub);
  const cancellation = sub.cancellation_details || {};
  const via = String(sub.metadata?.via || '');
  return {
    id: sub.id,
    customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id || null,
    email: customer?.email || sub.metadata?.email || '',
    name: customer?.name || '',
    status: sub.status,
    plan: isGroup ? 'group' : 'plus',
    seats: isGroup ? (item.quantity || 0) : 1,
    groupName: isGroup ? String(sub.metadata?.groupName || sub.metadata?.name || '').slice(0, 80) : '',
    // The older field, kept as it was. It is blank on the newest API shape
    // (coupon under source), so it falls back to the coupon found below.
    coupon: coupon ? String(coupon.name || coupon.id || '').slice(0, 60) : String(discount.couponName || discount.couponId || '').slice(0, 60),
    comped: (sub.status === 'active' || sub.status === 'trialing') && chargedCents <= 0,
    created,
    canceledAt: sub.canceled_at ? sub.canceled_at * 1000 : null,
    endedAt: sub.ended_at ? sub.ended_at * 1000 : null,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    periodEnd: periodEnd ? periodEnd * 1000 : null,
    listCents: listCents || 0,
    chargedCents: Math.max(0, chargedCents || 0),
    // What they came in on. promoCode is the code the person typed (not the
    // coupon behind it); blank when there was no code, or Stripe only gave
    // an id that couldn't be looked up.
    promoCode: discount.promoCode,
    couponId: discount.couponId,
    couponDuration: discount.couponDuration,
    couponPercentOff: discount.couponPercentOff,
    couponAmountOffCents: discount.couponAmountOffCents,
    discountEnd: discount.end,
    // Why they left, when Stripe's cancel flow asked. The comment is the
    // person's own words, raw: the Business OS escapes it before showing it.
    cancelReason: String(cancellation.reason || '').slice(0, 40),
    cancelFeedback: String(cancellation.feedback || '').slice(0, 40),
    cancelComment: String(cancellation.comment || '').trim().slice(0, 200),
    planId: isGroup ? String(sub.metadata?.planId || '').slice(0, 40) : '',
    via: SUBSCRIBER_VIA_RE.test(via) ? via : '',
    // Filled by annotateSignedIn once every row exists.
    signedIn: null,
    // Ids still to be looked up; removed by finishSubscriberRows.
    _promoId: discount.promoId,
    _couponLookup: discount.couponUnexpanded ? discount.couponId : '',
  };
}

// The discount that matters on a subscription, in whichever shape this
// account's API version returns. A discount that came from a promotion code
// wins over one that didn't, since that is the one a person chose.
export function discountOf(sub) {
  const list = [];
  if (sub?.discount && typeof sub.discount === 'object') list.push(sub.discount);
  for (const d of Array.isArray(sub?.discounts) ? sub.discounts : []) if (d && typeof d === 'object') list.push(d);
  const d = list.find(x => x.promotion_code) || list[0] || null;
  const empty = { promoCode: '', promoId: '', couponId: '', couponName: '', couponDuration: '', couponPercentOff: null, couponAmountOffCents: null, end: null, couponUnexpanded: false };
  if (!d) return empty;
  const rawCoupon = d.coupon ?? d.source?.coupon ?? null;
  const coupon = rawCoupon && typeof rawCoupon === 'object' ? rawCoupon : null;
  const promo = d.promotion_code;
  const duration = String(coupon?.duration || '');
  return {
    promoCode: promo && typeof promo === 'object' ? String(promo.code || '').slice(0, 60) : '',
    promoId: typeof promo === 'string' ? promo : '',
    couponId: String((typeof rawCoupon === 'string' ? rawCoupon : coupon?.id) || '').slice(0, 60),
    couponName: String(coupon?.name || '').slice(0, 60),
    couponDuration: ['forever', 'once', 'repeating'].includes(duration) ? duration : '',
    couponPercentOff: typeof coupon?.percent_off === 'number' ? coupon.percent_off : null,
    couponAmountOffCents: typeof coupon?.amount_off === 'number' ? coupon.amount_off : null,
    end: typeof d.end === 'number' && d.end > 0 ? d.end * 1000 : null,
    couponUnexpanded: typeof rawCoupon === 'string',
  };
}

// Everything that needs a second look after the rows are built: promotion
// code and coupon ids Stripe didn't expand, and the signed-in flag. Each
// part fails on its own and leaves its fields blank or null.
export async function finishSubscriberRows(env, rows, now = Date.now()) {
  try { await resolveDiscountIds(env, rows); } catch (e) { console.error('Could not look up discount codes', e?.message); }
  try { await annotateSignedIn(env, rows, now); } catch (e) { console.error('Could not check who signed in', e?.message); }
  for (const r of rows) { delete r._promoId; delete r._couponLookup; }
}

// Promotion codes and coupons that came back as bare ids. Looked up with one
// list call each (there are only ever a handful), never one per subscriber.
const DISCOUNT_LOOKUP_PAGES = 3;
async function resolveDiscountIds(env, rows) {
  const needPromo = rows.some(r => r._promoId && !r.promoCode);
  const needCoupon = rows.some(r => r._couponLookup);
  if (needPromo) {
    const codes = await listStripeAll(env, '/v1/promotion_codes', DISCOUNT_LOOKUP_PAGES);
    const byId = new Map(codes.map(p => [p.id, String(p.code || '').slice(0, 60)]));
    for (const r of rows) if (r._promoId && !r.promoCode) r.promoCode = byId.get(r._promoId) || '';
  }
  if (needCoupon) {
    const coupons = await listStripeAll(env, '/v1/coupons', DISCOUNT_LOOKUP_PAGES);
    const byId = new Map(coupons.map(c => [c.id, c]));
    rows.forEach(row => {
      const c = row._couponLookup && byId.get(row._couponLookup);
      if (!c) return;
      const duration = String(c.duration || '');
      row.couponDuration = row.couponDuration || (['forever', 'once', 'repeating'].includes(duration) ? duration : '');
      if (row.couponPercentOff === null && typeof c.percent_off === 'number') row.couponPercentOff = c.percent_off;
      if (row.couponAmountOffCents === null && typeof c.amount_off === 'number') row.couponAmountOffCents = c.amount_off;
      if (!row.coupon) row.coupon = String(c.name || c.id || '').slice(0, 60);
    });
  }
}
async function listStripeAll(env, path, pages) {
  const out = [];
  let startingAfter = '';
  for (let page = 0; page < pages; page++) {
    const data = await stripeGetJson(env, `${path}?limit=100${startingAfter ? `&starting_after=${startingAfter}` : ''}`);
    out.push(...(data.data || []));
    if (!data.has_more || !data.data?.length) break;
    startingAfter = data.data[data.data.length - 1].id;
  }
  return out;
}

/* ── Did a recent buyer ever sign in? ─────────────────────────────
   Someone who paid on the marketing site or at the email-first sign-up
   has a subscription before they have an account; the license only lands
   on licenses/{uid} once they sign in and claim it (licensing.js). So for
   individual Plus subscriptions from the last 60 days: true when a
   license names this subscription or customer, false when none does, null
   when older, a group plan, or the lookup couldn't run. One query for
   every license bought or claimed in the window, then matched in memory.

   Known blind spot: someone whose license already said paid (a group seat,
   say) who then buys their own plan from the site is never re-claimed, so
   they read false while signed in. */
export async function annotateSignedIn(env, rows, now = Date.now()) {
  const windowMs = SIGNED_IN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recent = rows.filter(r => r.plan === 'plus' && r.created && now - r.created <= windowMs);
  if (!recent.length || !env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) return;
  // A claim can only come after the purchase, so a couple of days' slack
  // before the window covers a subscription created right at its edge.
  const since = new Date(now - windowMs - 2 * 24 * 60 * 60 * 1000).toISOString();
  const licenses = await runFirestoreQuery(env, {
    from: [{ collectionId: 'licenses' }],
    select: { fields: [{ fieldPath: 'stripeSubscriptionId' }, { fieldPath: 'stripeCustomerId' }] },
    where: { fieldFilter: { field: { fieldPath: 'purchasedAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: since } } },
    limit: 2000,
  });
  markSignedIn(recent, licenses);
}
export function markSignedIn(recentRows, licenses) {
  const subIds = new Set(), customerIds = new Set();
  for (const l of licenses || []) {
    if (l.stripeSubscriptionId) subIds.add(l.stripeSubscriptionId);
    if (l.stripeCustomerId) customerIds.add(l.stripeCustomerId);
  }
  for (const r of recentRows) r.signedIn = subIds.has(r.id) || (!!r.customerId && customerIds.has(r.customerId));
}
