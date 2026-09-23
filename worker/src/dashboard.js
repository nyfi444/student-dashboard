/* ── worker/src/dashboard.js ────────────────────────────────────
   The private business dashboard's read-only feed
   (/admin/business-summary): Stripe, Cloudflare and Firestore numbers
   computed server-side. Job 8 in index.js.
──────────────────────────────────────────────────────────────── */

import { fetchCheckoutSummary } from './checkouts.js';
import { listFirestoreCollection, queryRecentDocs, runFirestoreQuery } from './firebase.js';
import { groupAdmins } from './groups.js';
import { adminTokenOk } from './http.js';
import { stripeGetJson } from './stripe.js';
import { finishSubscriberRows, subscriberRow } from './subscribers.js';
import { fetchAiUsageSummary } from './usage.js';

/* ── 8. Business summary (dashboard read-only feed) ─────────────
   Backs Nyla's private business command-center dashboard
   (dashboard/semester-hq-biz.html), which is a static file that can't
   safely hold a real Stripe key (Stripe blocks direct browser CORS to
   api.stripe.com anyway), so it calls this instead, same bearer-token
   pattern as /admin/errors, reusing the ADMIN_TOKEN secret. Returns
   Stripe subscription counts/MRR computed server-side, plus Cloudflare
   zone analytics IF CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID secrets are
   set (omitted, not faked, otherwise), so the dashboard can show an
   honest "not connected yet" state. */
export async function handleAdminBusinessSummary(request, env) {
  const adminCors = { 'Access-Control-Allow-Origin': '*', 'content-type': 'application/json', 'X-Content-Type-Options': 'nosniff' };
  if (!env.ADMIN_TOKEN) return new Response(JSON.stringify({ error: 'Server misconfigured: ADMIN_TOKEN not set.' }), { status: 500, headers: adminCors });

  if (!(await adminTokenOk(request, env))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: adminCors });
  }

  const out = { stripe: null, cloudflare: null };

  if (env.STRIPE_SECRET_KEY) {
    try {
      out.stripe = await fetchStripeSummary(env);
    } catch (e) {
      out.stripe = { error: 'Could not load Stripe data: ' + e.message };
    }
  }

  if (env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ZONE_ID) {
    try {
      out.cloudflare = await fetchCloudflareSummary(env);
    } catch (e) {
      out.cloudflare = { error: 'Could not load Cloudflare data: ' + e.message };
    }
  }

  // Firestore-backed signals the Worker already collects (CTA events, contact
  // form, crash reports). Each part fails independently so one bad query
  // doesn't blank the others; the whole section is omitted without creds.
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    out.firebase = {};
    const [funnel, feedback, errors] = await Promise.allSettled([
      fetchEventFunnel(env), queryRecentDocs(env, 'feedback', 25), fetchErrorSummary(env),
    ]);
    out.firebase.funnel = funnel.status === 'fulfilled' ? funnel.value : { error: funnel.reason?.message || 'failed' };
    out.firebase.feedback = feedback.status === 'fulfilled' ? feedback.value : { error: feedback.reason?.message || 'failed' };
    out.firebase.errors = errors.status === 'fulfilled' ? errors.value : { error: errors.reason?.message || 'failed' };
  }

  // Added Sept 2026, each under its own top-level key so an older Business
  // OS build simply doesn't read them. Same rule as above: each fails on
  // its own, and a section is left out when its service isn't configured.
  //   checkouts   Stripe Checkout Sessions, last 30 days, by path (checkouts.js)
  //   groupPlans  one line per group plan, no member names or emails
  //   aiUsage     AI calls, tokens and estimated cost by feature (usage.js)
  const hasFirebase = !!(env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY);
  const [checkouts, groupPlans, aiUsage] = await Promise.allSettled([
    env.STRIPE_SECRET_KEY ? fetchCheckoutSummary(env) : Promise.resolve(undefined),
    hasFirebase ? fetchGroupPlanList(env) : Promise.resolve(undefined),
    hasFirebase ? fetchAiUsageSummary(env) : Promise.resolve(undefined),
  ]);
  if (env.STRIPE_SECRET_KEY) out.checkouts = checkouts.status === 'fulfilled' ? checkouts.value : { error: 'Could not load checkouts: ' + (checkouts.reason?.message || 'failed') };
  if (hasFirebase) {
    out.groupPlans = groupPlans.status === 'fulfilled' ? groupPlans.value : [];
    out.groupPlansError = groupPlans.status === 'fulfilled' ? '' : (groupPlans.reason?.message || 'failed');
    out.aiUsage = aiUsage.status === 'fulfilled' ? aiUsage.value : { error: aiUsage.reason?.message || 'failed' };
  }

  return new Response(JSON.stringify(out), { headers: adminCors });
}

// Walks every subscription (any status) and splits "active" into what's
// actually earning money vs. comped: a 100%-off Stripe Coupon still leaves
// the price's unit_amount at 799, so counting unit_amount alone overstates
// MRR for every comped account. The latest invoice's total is what the
// customer was really charged this period, so that's the net figure.
// `activeCount`/`mrrCents` keep their original meaning (active+trialing,
// list price) so older dashboard builds reading them don't change.
const STRIPE_SUB_PAGE_CAP = 10; // 1,000 subscriptions, well past current scale
// Discounts expanded so a subscriber row can say which promotion code they
// used (see subscribers.js). If this account's API version refuses one of
// these expansions, the list is fetched again the way it always was rather
// than losing the whole summary over a nice-to-have.
const STRIPE_SUB_DISCOUNT_EXPANDS = '&expand[]=data.discounts&expand[]=data.discounts.promotion_code';
export async function fetchStripeSummary(env) {
  const subs = [];
  let startingAfter = '';
  let truncated = false;
  let discountExpands = STRIPE_SUB_DISCOUNT_EXPANDS;
  for (let page = 0; page < STRIPE_SUB_PAGE_CAP; page++) {
    const qs = () => `limit=100&status=all&expand[]=data.items.data.price&expand[]=data.latest_invoice&expand[]=data.customer${discountExpands}${startingAfter ? `&starting_after=${startingAfter}` : ''}`;
    const get = () => fetch(`https://api.stripe.com/v1/subscriptions?${qs()}`, {
      headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    let res = await get();
    let data = await res.json();
    if (res.status === 400 && discountExpands && /expand/i.test(data?.error?.message || '')) {
      discountExpands = '';
      res = await get();
      data = await res.json();
    }
    if (!res.ok) throw new Error(data?.error?.message || `Stripe returned ${res.status}`);
    subs.push(...(data.data || []));
    if (!data.has_more || !data.data?.length) break;
    startingAfter = data.data[data.data.length - 1].id;
    if (page === STRIPE_SUB_PAGE_CAP - 1) truncated = true;
  }

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  let activeCount = 0, mrrCents = 0, netMrrCents = 0;
  let payingCount = 0, compedCount = 0, pastDueCount = 0, cancelingCount = 0;
  let new7d = 0, new30d = 0, canceled30d = 0;
  const recent = [];
  const subscribers = [];
  let groupPlanCount = 0, groupSeatCount = 0;
  for (const sub of subs) {
    // A group plan is one subscription for many seats, so its list price is
    // the seat price times the seat count.
    const listCents = (sub.items?.data || []).reduce((sum, item) => sum + (item.price?.unit_amount || 0) * (item.quantity || 1), 0);
    const invoice = typeof sub.latest_invoice === 'object' ? sub.latest_invoice : null;
    const chargedCents = invoice && typeof invoice.total === 'number' ? invoice.total : listCents;
    const isActive = sub.status === 'active' || sub.status === 'trialing';
    const created = sub.created ? sub.created * 1000 : null;
    const endedAt = (sub.ended_at || sub.canceled_at) ? (sub.ended_at || sub.canceled_at) * 1000 : null;

    if (isActive) {
      activeCount++;
      if (sub.metadata?.kind === 'group') { groupPlanCount++; groupSeatCount += sub.items?.data?.[0]?.quantity || 0; }
      mrrCents += listCents;
      netMrrCents += Math.max(0, chargedCents);
      if (chargedCents > 0) payingCount++; else compedCount++;
      if (sub.cancel_at_period_end) cancelingCount++;
    }
    if (sub.status === 'past_due' || sub.status === 'unpaid') pastDueCount++;
    if (created && now - created <= 7 * DAY) new7d++;
    if (created && now - created <= 30 * DAY) new30d++;
    if (sub.status === 'canceled' && endedAt && now - endedAt <= 30 * DAY) canceled30d++;

    recent.push({
      id: sub.id,
      status: sub.status,
      created,
      canceled_at: sub.canceled_at ? sub.canceled_at * 1000 : null,
      ended_at: sub.ended_at ? sub.ended_at * 1000 : null,
      cancel_at_period_end: !!sub.cancel_at_period_end,
      amount_cents: listCents || null,
      charged_cents: chargedCents,
    });
    subscribers.push(subscriberRow(sub, { created, listCents, chargedCents }));
  }
  await finishSubscriberRows(env, subscribers, now);
  recent.sort((a, b) => (b.created || 0) - (a.created || 0));
  subscribers.sort((a, b) => (b.created || 0) - (a.created || 0));

  let revenue30d = null;
  try { revenue30d = await fetchStripeRevenue30d(env); }
  catch (e) { revenue30d = { error: e.message }; }

  let books = null;
  try { books = await fetchStripeBooks(env); }
  catch (e) { books = { error: e.message }; }

  // Everyone Stripe knows who has no subscription of any kind. Without this
  // the Business OS can only ever show people who reached a subscription, so
  // an unfinished checkout, a one-off payment or a customer made by hand in
  // the Stripe dashboard is invisible there while sitting in Stripe's own
  // Customers list. Built from the subscriptions already fetched above
  // (status=all), so a customer whose only subscription is canceled counts as
  // subscribed, not as a stranger.
  const subscribedIds = new Set(subs
    .map(sub => typeof sub.customer === 'string' ? sub.customer : sub.customer?.id)
    .filter(Boolean));
  let customersNoSub = [];
  let customersNoSubError = '';
  try { customersNoSub = await fetchCustomersWithoutSubscription(env, subscribedIds); }
  catch (e) { customersNoSubError = e.message; }

  return {
    activeCount, mrrCents, netMrrCents, payingCount, compedCount, pastDueCount, cancelingCount,
    groupPlanCount, groupSeatCount,
    new7d, new30d, canceled30d, totalSubscriptions: subs.length, truncated,
    revenue30d, recent: recent.slice(0, 30), fetchedAt: now,
    subscribers: subscribers.slice(0, 500), books,
    customersNoSub, customersNoSubError,
  };
}

// Stripe customers with nothing subscribed against them. `subscribedIds` is
// every customer id seen on a subscription of any status, so this returns the
// people a subscription-shaped list can never show. Deleted customers are
// skipped; the rest are newest first.
const STRIPE_CUSTOMER_PAGE_CAP = 10; // 1,000 customers, same headroom as subscriptions
async function fetchCustomersWithoutSubscription(env, subscribedIds) {
  const rows = [];
  let startingAfter = '';
  for (let page = 0; page < STRIPE_CUSTOMER_PAGE_CAP; page++) {
    const qs = `limit=100${startingAfter ? `&starting_after=${startingAfter}` : ''}`;
    const res = await fetch(`https://api.stripe.com/v1/customers?${qs}`, {
      headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `Stripe returned ${res.status}`);
    for (const c of data.data || []) {
      if (c.deleted || subscribedIds.has(c.id)) continue;
      rows.push({
        id: c.id,
        email: c.email || '',
        name: c.name || '',
        created: c.created ? c.created * 1000 : null,
        delinquent: !!c.delinquent,
        uid: String(c.metadata?.uid || '').slice(0, 64),
      });
    }
    if (!data.has_more || !data.data?.length) break;
    startingAfter = data.data[data.data.length - 1].id;
  }
  rows.sort((a, b) => (b.created || 0) - (a.created || 0));
  return rows.slice(0, 200);
}

// Bookkeeping from Stripe's balance history: per calendar month (UTC),
// what was sold, refunded and paid in fees, plus the payouts that reached
// the bank. Payouts are transfers, not income: they're here so the OS can
// check the bank deposits against the books.
const BOOKS_MONTHS = 14;
const BOOKS_PAGE_CAP = 20;
async function fetchStripeBooks(env) {
  const start = new Date();
  start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  start.setUTCMonth(start.getUTCMonth() - (BOOKS_MONTHS - 1));
  const since = Math.floor(start.getTime() / 1000);
  const months = {};
  const month = t => new Date(t * 1000).toISOString().slice(0, 7);
  const row = key => (months[key] = months[key] || { grossCents: 0, refundCents: 0, feeCents: 0, disputeCents: 0, otherCents: 0, netCents: 0, charges: 0 });
  let startingAfter = '', truncated = false;
  for (let page = 0; page < BOOKS_PAGE_CAP; page++) {
    const qs = `limit=100&created[gte]=${since}${startingAfter ? `&starting_after=${startingAfter}` : ''}`;
    const data = await stripeGetJson(env, `/v1/balance_transactions?${qs}`);
    for (const t of data.data || []) {
      if (t.type === 'payout' || t.type === 'payout_cancel' || t.type === 'payout_failure') continue;
      const r = row(month(t.created));
      const amount = t.amount || 0, fee = t.fee || 0;
      if (t.type === 'charge' || t.type === 'payment') { r.grossCents += amount; r.charges++; }
      else if (t.type === 'refund' || t.type === 'payment_refund') r.refundCents += -amount;
      else if (t.type === 'stripe_fee' || t.type === 'tax_fee') r.feeCents += -amount;
      else if (t.type === 'adjustment' && /dispute/i.test(t.description || '')) r.disputeCents += -amount;
      else r.otherCents += amount;
      r.feeCents += fee;
      r.netCents += (t.net ?? (amount - fee));
    }
    if (!data.has_more || !data.data?.length) break;
    startingAfter = data.data[data.data.length - 1].id;
    if (page === BOOKS_PAGE_CAP - 1) truncated = true;
  }

  const payouts = [];
  startingAfter = '';
  for (let page = 0; page < 5; page++) {
    const qs = `limit=100&created[gte]=${since}${startingAfter ? `&starting_after=${startingAfter}` : ''}`;
    const data = await stripeGetJson(env, `/v1/payouts?${qs}`);
    for (const p of data.data || []) {
      payouts.push({ id: p.id, amountCents: p.amount || 0, arrivalDate: p.arrival_date ? p.arrival_date * 1000 : null, status: p.status, currency: p.currency || 'usd' });
    }
    if (!data.has_more || !data.data?.length) break;
    startingAfter = data.data[data.data.length - 1].id;
  }
  return { months, payouts, since: since * 1000, truncated, fetchedAt: Date.now() };
}

// Actual money collected in the last 30 days (succeeded charges), plus
// refunds and disputes, so the dashboard can show cash, not just run-rate.
async function fetchStripeRevenue30d(env) {
  const since = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
  let grossCents = 0, refundedCents = 0, count = 0, disputed = 0;
  let startingAfter = '';
  for (let page = 0; page < 5; page++) {
    const qs = `limit=100&created[gte]=${since}${startingAfter ? `&starting_after=${startingAfter}` : ''}`;
    const res = await fetch(`https://api.stripe.com/v1/charges?${qs}`, {
      headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `Stripe returned ${res.status}`);
    for (const c of data.data || []) {
      if (c.status !== 'succeeded') continue;
      count++;
      grossCents += c.amount || 0;
      refundedCents += c.amount_refunded || 0;
      if (c.disputed) disputed++;
    }
    if (!data.has_more || !data.data?.length) break;
    startingAfter = data.data[data.data.length - 1].id;
  }
  return { grossCents, refundedCents, count, disputed };
}

// Cloudflare's GraphQL Analytics API (zone-scoped, read-only token): the last
// 7 days of requests/uniques for semester-hq.com, one row per day, plus the
// most recent day as top-level fields (what older dashboard builds read).
async function fetchCloudflareSummary(env) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const until = new Date().toISOString();
  const query = `query {
    viewer {
      zones(filter: { zoneTag: "${env.CLOUDFLARE_ZONE_ID}" }) {
        httpRequests1dGroups(limit: 8, orderBy: [date_ASC], filter: { date_geq: "${since.slice(0, 10)}", date_leq: "${until.slice(0, 10)}" }) {
          dimensions { date }
          sum { requests, pageViews, threats }
          uniq { uniques }
        }
      }
    }
  }`;
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const data = await res.json();
  if (!res.ok || data.errors?.length) throw new Error(data.errors?.[0]?.message || `Cloudflare returned ${res.status}`);
  const groups = data?.data?.viewer?.zones?.[0]?.httpRequests1dGroups || [];
  const days = groups.map(g => ({
    date: g.dimensions?.date || '',
    requests: g.sum?.requests || 0,
    pageViews: g.sum?.pageViews || 0,
    threats: g.sum?.threats || 0,
    uniques: g.uniq?.uniques || 0,
  }));
  const last = days[days.length - 1] || { requests: 0, pageViews: 0, threats: 0, uniques: 0 };
  return {
    requests: last.requests, pageViews: last.pageViews, threats: last.threats, uniques: last.uniques,
    days,
    week: days.reduce((s, d) => ({ requests: s.requests + d.requests, pageViews: s.pageViews + d.pageViews, uniques: s.uniques + d.uniques }), { requests: 0, pageViews: 0, uniques: 0 }),
    fetchedAt: Date.now(),
  };
}

// Counts of the marketing-site CTA events (see TRACKED_EVENTS) over the last
// 7 and 30 days, i.e. the top of the conversion funnel.
async function fetchEventFunnel(env) {
  const now = Date.now();
  const since = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const rows = await runFirestoreQuery(env, {
    from: [{ collectionId: 'events' }],
    where: { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: since.toISOString() } } },
    orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
    limit: 5000,
  });
  const d7 = {}, d30 = {};
  for (const r of rows) {
    const t = Date.parse(r.createdAt || '');
    d30[r.event] = (d30[r.event] || 0) + 1;
    if (t && now - t <= 7 * 24 * 60 * 60 * 1000) d7[r.event] = (d7[r.event] || 0) + 1;
  }
  return { d7, d30, syllabus: syllabusHealth(rows), capped: rows.length >= 5000, ...eventFunnelExtras(rows) };
}

// The same 30 days, cut three more ways: per UTC day, where "Get started"
// was clicked from, and when each event last fired (within what was read,
// so an event quiet for 30 days has no entry). Paths come from the public
// /track-event route, so only the busiest are listed by name.
const GET_STARTED_PATH_CAP = 40;
export function eventFunnelExtras(rows) {
  const byDay = {}, lastFired = {}, paths = {};
  for (const r of rows) {
    const t = Date.parse(r.createdAt || '');
    if (!t || !r.event) continue;
    const day = new Date(t).toISOString().slice(0, 10);
    const d = byDay[day] || (byDay[day] = {});
    d[r.event] = (d[r.event] || 0) + 1;
    if (!lastFired[r.event] || t > lastFired[r.event]) lastFired[r.event] = t;
    if (r.event === 'get_started_click') {
      const path = String(r.path || '').slice(0, 120) || '(none)';
      paths[path] = (paths[path] || 0) + 1;
    }
  }
  const ranked = Object.entries(paths).sort((a, b) => b[1] - a[1]);
  const getStartedByPath = Object.fromEntries(ranked.slice(0, GET_STARTED_PATH_CAP));
  const rest = ranked.slice(GET_STARTED_PATH_CAP).reduce((n, [, c]) => n + c, 0);
  if (rest) getStartedByPath['(other)'] = (getStartedByPath['(other)'] || 0) + rest;
  return { byDay, getStartedByPath, lastFired };
}

/* ── Is the wedge actually working? ───────────────────────────────
   Everything in Semester HQ depends on a student dropping in a PDF and
   getting their semester back. These are the numbers that say whether
   that is happening: how often a read succeeds, how much it finds, and
   — the honest one — how much of what it found the student kept after
   looking at it. A high parse rate with a low keep rate means the
   parser is confidently wrong, which is worse than failing. */
export function syllabusHealth(rows) {
  const reads = rows.filter(r => r.event === 'syllabus_read');
  const kepts = rows.filter(r => r.event === 'syllabus_kept');
  const parsed = reads.filter(r => r.detail?.outcome === 'parsed');
  const sum = (list, key) => list.reduce((n, r) => n + (Number(r.detail?.[key]) || 0), 0);
  const offered = sum(kepts, 'offered');
  const cacheReads = sum(parsed, 'cacheRead');
  const failures = {};
  for (const r of reads) {
    if (r.detail?.outcome === 'parsed') continue;
    const reason = r.detail?.reason || 'unknown';
    failures[reason] = (failures[reason] || 0) + 1;
  }
  return {
    reads: reads.length,
    parsed: parsed.length,
    parseRate: reads.length ? Math.round((parsed.length / reads.length) * 100) : null,
    // What the parser found, per successful read.
    assignmentsPerRead: parsed.length ? Math.round((sum(parsed, 'assignments') / parsed.length) * 10) / 10 : null,
    // What survived review. This is the accuracy number.
    reviewed: kepts.length,
    offered,
    kept: sum(kepts, 'kept'),
    edited: sum(kepts, 'edited'),
    removed: sum(kepts, 'removed'),
    keepRate: offered ? Math.round((sum(kepts, 'kept') / offered) * 100) : null,
    // Zero cache reads across many parses means something volatile is sitting
    // in front of the cached system prompt (see SYLLABUS_SYSTEM in js/ai.js).
    cacheReads,
    cacheHitting: parsed.length >= 3 ? cacheReads > 0 : null,
    failures,
  };
}

export async function fetchErrorSummary(env) {
  const now = Date.now();
  const since = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const rows = await runFirestoreQuery(env, {
    from: [{ collectionId: 'errors' }],
    where: { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: since.toISOString() } } },
    orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
    limit: 1000,
  });
  const inLastDay = r => now - Date.parse(r.createdAt || '') <= 24 * 60 * 60 * 1000;
  const errors = rows.filter(r => r.level !== 'warn');
  const warnings = rows.filter(r => r.level === 'warn');
  return {
    count24h: errors.filter(inLastDay).length,
    count7d: errors.length,
    warn24h: warnings.filter(inLastDay).length,
    warn7d: warnings.length,
    latest: errors.slice(0, 8).map(r => ({ source: r.source, feature: r.feature || '', message: r.message, url: r.url, createdAt: r.createdAt })),
    // Warnings too: a syllabus that wouldn't read is logged as a warning,
    // so it never reaches `latest`, and this is the only place it shows.
    byFeature24h: errorsByFeature(rows.filter(inLastDay)),
  };
}
export function errorsByFeature(rows) {
  const out = {};
  for (const r of rows) {
    const f = String(r.feature || 'unknown').slice(0, 40);
    const row = out[f] || (out[f] = { errors: 0, warnings: 0 });
    if (r.level === 'warn') row.warnings++; else row.errors++;
  }
  return out;
}

/* ── Group plans, one line each ───────────────────────────────────
   Straight from the groupPlans docs groups.js writes: how many seats
   were bought, how many people took one, and who to write to (the first
   admin only). Never a member's name or email. Plans that never finished
   checkout are listed too, with their status, since a started-and-dropped
   group plan is worth a follow-up. */
export async function fetchGroupPlanList(env) {
  const plans = await listFirestoreCollection(env, 'groupPlans');
  return plans.map(groupPlanListRow)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 200);
}
export function groupPlanListRow(plan) {
  const created = Date.parse(plan.createdAt || '');
  return {
    planId: plan.id,
    name: String(plan.name || '').slice(0, 80),
    kind: plan.kind || 'club',
    status: plan.status || 'pending',
    seatsBought: Number(plan.seats) || 0,
    seatsRequested: Number(plan.requestedSeats) || 0,
    membersJoined: Number(plan.memberCount) || 0,
    createdAt: Number.isFinite(created) ? created : null,
    cancelAtPeriodEnd: !!plan.cancelAtPeriodEnd,
    adminEmail: String(groupAdmins(plan)[0]?.email || '').slice(0, 320),
  };
}
