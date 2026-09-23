/* ── worker/src/checkouts.js ────────────────────────────────────
   Which way people come in to pay, and how many of them finish: every
   Stripe Checkout Session from the last 30 days, sorted by the path that
   opened it. Read by the business summary (checkouts). Also owns the two
   labels stamped on every session this Worker creates — `source` (the
   path) and `via` (a link code) — so billing.js and groups.js set them
   the same way.

   The four paths:
     group    a club, team or department buying seats (group-admin.html)
     signup   login.html's email-first flow: a new email goes straight to
              checkout (the site's "Get started" lands there, ?signup=1)
     paywall  the in-app plan screen, signed in
     pricing  the marketing site's pricing-page Subscribe button
──────────────────────────────────────────────────────────────── */

import { stripeGetJson } from './stripe.js';

export const CHECKOUT_PATHS = ['group', 'signup', 'paywall', 'pricing'];
const CHECKOUT_DAYS = 30;
const CHECKOUT_PAGE_CAP = 10; // 1,000 sessions in 30 days, far past current scale

// A link code (?via=campus-ambassador) is a short label for where a visitor
// came from. Anything that doesn't look like one is dropped without a word:
// it is a label for Nyla's own links, never free text from the public, and
// nothing else about the visitor goes with it.
const VIA_RE = /^[a-z0-9-]{2,24}$/;
export function cleanVia(value) {
  return typeof value === 'string' && VIA_RE.test(value) ? value : '';
}

// The path a session the Worker is about to create belongs to. Decided from
// who is buying, which the route already knows: a verified token is the
// in-app paywall, an email with no token is the email-first sign-up, and an
// empty body is the pricing page (the site sends {} on purpose).
export function checkoutSourceFor({ group = false, uid = '', email = '' } = {}) {
  if (group) return 'group';
  if (uid) return 'paywall';
  if (email) return 'signup';
  return 'pricing';
}

// Which path an existing session came from. Sessions made from Sept 2026 on
// carry metadata.source and are read exactly. Older ones are classified from
// what Stripe already kept, the same rule checkoutSourceFor applies going
// forward:
//   metadata.kind === 'group'      → group   (groups.js always set it)
//   client_reference_id is set     → paywall (only a verified in-app buyer
//                                             ever got one; group sessions
//                                             have one too, hence group first)
//   customer_email was prefilled   → signup  (only login.html sends an email)
//   none of the above              → pricing (the site sends an empty body)
// customer_details.email is not used: Stripe fills it in for everyone who
// completes, whichever path they took.
export function checkoutPath(session) {
  const meta = session?.metadata || {};
  if (CHECKOUT_PATHS.includes(meta.source)) return meta.source;
  if (meta.kind === 'group') return 'group';
  if (session?.client_reference_id) return 'paywall';
  if (session?.customer_email) return 'signup';
  return 'pricing';
}

// Opened and completed per path, per UTC day, and per link code.
export function summarizeCheckouts(sessions, { since, truncated = false } = {}) {
  const byPath = {};
  for (const p of CHECKOUT_PATHS) byPath[p] = { opened: 0, completed: 0 };
  const byDay = {};
  const byVia = {};
  for (const s of sessions) {
    const created = (Number(s.created) || 0) * 1000;
    if (since && created < since) continue;
    const done = s.status === 'complete';
    const path = byPath[checkoutPath(s)];
    path.opened++; if (done) path.completed++;
    const day = new Date(created).toISOString().slice(0, 10);
    const d = byDay[day] || (byDay[day] = { opened: 0, completed: 0 });
    d.opened++; if (done) d.completed++;
    const via = cleanVia(s.metadata?.via);
    if (via) {
      const v = byVia[via] || (byVia[via] = { opened: 0, completed: 0 });
      v.opened++; if (done) v.completed++;
    }
  }
  return { since: since || null, truncated: !!truncated, byPath, byDay, byVia };
}

export async function fetchCheckoutSummary(env, now = Date.now()) {
  const since = now - CHECKOUT_DAYS * 24 * 60 * 60 * 1000;
  const sinceSec = Math.floor(since / 1000);
  const sessions = [];
  let startingAfter = '', truncated = false, useCreatedFilter = true;
  for (let page = 0; page < CHECKOUT_PAGE_CAP; page++) {
    const qs = `limit=100${useCreatedFilter ? `&created[gte]=${sinceSec}` : ''}${startingAfter ? `&starting_after=${startingAfter}` : ''}`;
    let data;
    try { data = await stripeGetJson(env, `/v1/checkout/sessions?${qs}`); }
    catch (e) {
      // An account on an API version without the created filter: list
      // newest first and stop at the first session older than the window.
      if (page === 0 && useCreatedFilter && /created/i.test(e.message || '')) { useCreatedFilter = false; page--; continue; }
      throw e;
    }
    const list = data.data || [];
    sessions.push(...list);
    const reachedOlder = list.some(s => (Number(s.created) || 0) < sinceSec);
    if (!data.has_more || !list.length || reachedOlder) break;
    startingAfter = list[list.length - 1].id;
    if (page === CHECKOUT_PAGE_CAP - 1) truncated = true;
  }
  return { ...summarizeCheckouts(sessions, { since, truncated }), fetchedAt: now };
}
