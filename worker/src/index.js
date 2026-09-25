/* ── Student Planner backend Worker ───────────────────────────────
   Every job here runs server-side so secrets never reach the browser:
   1. AI proxy (/v1/messages): holds ANTHROPIC_API_KEY, forwards to Claude.
   2. Checkout (/create-checkout-session): starts a $7.99/month Stripe
      subscription for sign-in and sync.
   3. Licensing (/stripe-webhook, /claim-license, /check-email): the ONLY
      writer of Firestore's `licenses` collection. Clients can only read
      their own license (see firestore.rules); this Worker is the sole
      trusted authority that marks someone as paid, using a Firebase service
      account to write via the Firestore REST API. Subscription renewals,
      payment failures, and cancellations all flow through the webhook too
      (customer.subscription.updated/deleted), so `paid` always reflects
      whether the subscription is currently active. /check-email is the one
      unauthenticated read here, a bare "has this email paid?" boolean,
      used by login.html to skip the magic-link step entirely for emails
      with no plan yet and send them straight to Checkout.
   4. Contact form (/contact-message): the ONLY writer of Firestore's
      `feedback` collection. Rate-limited and validated server-side since
      it's reachable by anyone, signed in or not. Also emails the site
      owner a copy via Resend if RESEND_API_KEY is set (optional, see
      worker/README.md), since the Firestore write alone never showed up
      anywhere a person would actually notice it.
   5. Diagnostics (/log-error): the ONLY writer of Firestore's `errors`
      collection. Takes crash reports and feature issues from the app
      (js/diagnostics.js) and the marketing site; rate-limited since it's
      reachable by anyone. The Worker records its own failures there too
      (source "worker", see logServerIssue), and Workers Logs keeps the
      full console output (observability in wrangler.toml).
   6. Error viewer (/admin/errors): read-only, token-gated (ADMIN_TOKEN
      secret) endpoint for admin/errors.html to list recent reports.
      Not origin-restricted like the rest, since the viewer page isn't
      served from ALLOWED_ORIGIN; the bearer token is the security boundary.
   7. Event tracking (/track-event): the ONLY writer of Firestore's
      `events` collection. Records marketing-site CTA clicks (Log in, Try
      it free, Upgrade, Subscribe, checkout errors) so which buttons
      actually convert isn't a guess. Same rate-limited, server-only
      pattern as error logging.
   8. Business summary (/admin/business-summary): read-only, token-gated
      (same ADMIN_TOKEN as job 6) feed for Nyla's private business
      dashboard (semester-hq-dashboard/semester-hq-biz.html). Computes Stripe
      subscriber breakdown (paying vs. comped, past due, canceling), the
      customers who have no subscription at all, list and
      net MRR, 30-day movement and collected revenue server-side (the
      dashboard can't call Stripe directly, Stripe blocks browser CORS on
      purpose); CTA-event funnel counts, recent contact-form messages, and
      crash-report counts from Firestore; and, only if CLOUDFLARE_API_TOKEN +
      CLOUDFLARE_ZONE_ID secrets are set, 7 days of Cloudflare traffic for
      semester-hq.com. Sections are omitted (not faked) when not configured.
   9. Group plans (/group/*): a club, team, or department buys seats for
      its members and runs them from group-admin.html. See section 9.
  10. Daily ledger (/admin/ledger): read-only, token-gated (same
      ADMIN_TOKEN). One row per UTC day, written add-only by the daily cron
      into bizLedger/{date}, so trends outlive the 30- and 90-day windows
      everything else keeps. See ledger.js.
  11. Sign-in and password emails (/auth-email): Firebase makes the link,
      Resend sends it from send.semester-hq.com, because Firebase's own
      sender lands in Gmail's Spam with its link switched off. Turnstile
      and daily caps; login.html falls back to Firebase's email on failure.
──────────────────────────────────────────────────────────────── */

/* ── Where each job lives ─────────────────────────────────────────
   This file is only the front door: it routes a request to the module
   that owns it, and runs the daily cron. Everything else is split by job,
   so a change to billing never means scrolling past account deletion.

     ai.js           job 1   the AI proxy
     stream.js       job 1   Claude's streamed reply, folded back into one message
     billing.js      job 2   checkout and the billing portal
     licensing.js    job 3   the webhook, claiming a license, /check-email
     contact.js      job 4   the contact form
     diagnostics.js  jobs 5, 6  error reports and the admin viewer
     events.js       jobs 7, 10 event tracking, the daily business events
     dashboard.js    job 8   the business dashboard feed
     subscribers.js  job 8   one row per subscription for that feed
     checkouts.js    job 8   checkout sessions by path, and the labels on them
     usage.js        job 8   what each AI feature costs (written by ai.js)
     ledger.js       job 10  the daily ledger and /admin/ledger
     groups.js       job 9   group plans
     feeds.js        job 10  LMS calendar feeds
     account.js      deleting an account, terms acceptance
     authmail.js     job 11  sign-in link and password-reset emails

   and the three every job leans on, which lean on nothing:

     http.js         CORS, JSON replies, rate limits, caps, Turnstile
     firebase.js     ID tokens and the Firestore / Storage / Auth REST calls
     stripe.js       the Stripe client and signature checks

   Wrangler bundles these into one script on deploy (main in
   wrangler.toml is still this file). The node tests load them as one
   script too — see tests/worker-source.mjs for why.
──────────────────────────────────────────────────────────────── */

import { handleAccountAttest, handleDeleteAccount } from './account.js';
import { handleAiProxy } from './ai.js';
import { handleAuthEmail } from './authmail.js';
import { handleCreateCheckoutSession, handleCreatePortalSession } from './billing.js';
import { handleContactMessage } from './contact.js';
import { fetchStripeSummary, handleAdminBusinessSummary } from './dashboard.js';
import { featureForPath, handleAdminErrors, handleLogError, logServerIssue, pruneOldIssues } from './diagnostics.js';
import { buildBusinessEvents, handleAdminBizEvents, handleTrackEvent } from './events.js';
import { handleCalendarFeed } from './feeds.js';
import { handleGroupRoute } from './groups.js';
import { checkRateLimit, corsHeaders, isAllowedOrigin, jsonError } from './http.js';
import { handleAdminLedger, writeDailyLedger } from './ledger.js';
import { handleCheckEmail, handleClaimLicense, handleStripeWebhook } from './licensing.js';

export default {
  // Every request passes through here. A route that throws still answers with
  // JSON and CORS headers (so the app can show its own message), and any 5xx
  // lands in the error log with the route and what went wrong.
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    try {
      const res = await routeRequest(request, env, ctx);
      if (res.status >= 500 && pathname !== '/log-error') {
        ctx.waitUntil(res.clone().text().then(detail => logServerIssue(env, featureForPath(pathname), `${request.method} ${pathname} returned ${res.status}`, null, { detail: detail.slice(0, 300) })));
      }
      return res;
    } catch (e) {
      ctx.waitUntil(logServerIssue(env, featureForPath(pathname), `${request.method} ${pathname} threw`, e));
      return jsonError('Something went wrong. Try again in a moment.', 500, env, request.headers.get('Origin') || '');
    }
  },

  // Cron trigger (wrangler.toml [triggers]): once a day, write the Business
  // OS's events and the daily ledger, and clear out old reports. There is no
  // reminder sweep — the app doesn't send notifications, so nothing needs
  // waking up every 5 minutes. Stripe is asked once and both writers share
  // the answer (null when Stripe isn't set up or didn't answer).
  async scheduled(event, env, ctx) {
    const stripeReady = env.STRIPE_SECRET_KEY ? fetchStripeSummary(env).catch(() => null) : Promise.resolve(null);
    ctx.waitUntil(buildBusinessEvents(env, stripeReady).catch(e => logServerIssue(env, 'business-events', 'Daily business events failed', e)));
    ctx.waitUntil(writeDailyLedger(env, { stripeReady }).catch(e => logServerIssue(env, 'ledger', 'Daily ledger failed', e)));
    ctx.waitUntil(pruneOldIssues(env).catch(e => logServerIssue(env, 'diagnostics', 'Pruning old reports failed', e)));
  },
};

async function routeRequest(request, env, ctx) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin') || '';

  // /admin/errors needs GET + an Authorization header, unlike every other
  // route here (POST + content-type only), handle its preflight separately
  // so the browser doesn't reject the real request for a disallowed method/header.
  if (request.method === 'OPTIONS' && (url.pathname === '/admin/errors' || url.pathname === '/admin/business-summary' || url.pathname === '/admin/biz-events' || url.pathname === '/admin/ledger')) {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'authorization' } });
  }
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(env, origin) });

  // Stripe calls this server-to-server, no Origin header, verified by signature instead of CORS.
  if (url.pathname === '/stripe-webhook' && request.method === 'POST') return handleStripeWebhook(request, env);

  // Token-gated, not origin-restricted (see job 6 above).
  if (url.pathname === '/admin/errors' && request.method === 'GET') return handleAdminErrors(request, env);
  if (url.pathname === '/admin/business-summary' && request.method === 'GET') return handleAdminBusinessSummary(request, env);
  if (url.pathname === '/admin/biz-events' && (request.method === 'GET' || request.method === 'POST')) return handleAdminBizEvents(request, env);
  if (url.pathname === '/admin/ledger' && request.method === 'GET') return handleAdminLedger(request, env);

  if (request.method !== 'POST') return jsonError('Method not allowed', 405, env, origin);

  // Defense in depth beyond CORS (CORS only stops browser JS from reading the response;
  // it doesn't stop a direct request), so also reject disallowed origins server-side.
  if (!isAllowedOrigin(env, origin)) return jsonError('Origin not allowed', 403, env, origin);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  if (url.pathname === '/v1/messages') {
    if (!(await checkRateLimit(env, ip, 'ai', 20))) return jsonError('Too many requests, try again in a minute.', 429, env, origin);
    return handleAiProxy(request, env, origin, ctx);
  }
  if (url.pathname === '/create-checkout-session') {
    if (!(await checkRateLimit(env, ip, 'checkout', 10))) return jsonError('Too many requests, try again in a minute.', 429, env, origin);
    return handleCreateCheckoutSession(request, env, origin);
  }
  if (url.pathname === '/create-portal-session') {
    if (!(await checkRateLimit(env, ip, 'portal', 10))) return jsonError('Too many requests, try again in a minute.', 429, env, origin);
    return handleCreatePortalSession(request, env, origin);
  }
  if (url.pathname === '/claim-license') {
    if (!(await checkRateLimit(env, ip, 'claim', 15))) return jsonError('Too many requests, try again in a minute.', 429, env, origin);
    return handleClaimLicense(request, env, origin);
  }
  if (url.pathname === '/check-email') {
    if (!(await checkRateLimit(env, ip, 'check-email', 5))) return jsonError('Too many requests, try again in a minute.', 429, env, origin);
    return handleCheckEmail(request, env, origin);
  }
  if (url.pathname === '/auth-email') {
    if (!(await checkRateLimit(env, ip, 'auth-email', 5))) return jsonError('Too many requests, try again in a minute.', 429, env, origin);
    return handleAuthEmail(request, env, origin);
  }
  if (url.pathname === '/delete-account') {
    if (!(await checkRateLimit(env, ip, 'delete-account', 5))) return jsonError('Too many requests, try again in a minute.', 429, env, origin);
    return handleDeleteAccount(request, env, origin);
  }
  if (url.pathname === '/contact-message') {
    if (!(await checkRateLimit(env, ip, 'contact', 5))) return jsonError('Too many requests, try again in a minute.', 429, env, origin);
    return handleContactMessage(request, env, origin);
  }
  if (url.pathname === '/log-error') {
    if (!(await checkRateLimit(env, ip, 'log-error', 30))) return jsonError('Too many requests, try again in a minute.', 429, env, origin);
    return handleLogError(request, env, origin);
  }
  if (url.pathname === '/track-event') {
    if (!(await checkRateLimit(env, ip, 'track-event', 60))) return jsonError('Too many requests, try again in a minute.', 429, env, origin);
    return handleTrackEvent(request, env, origin);
  }
  if (url.pathname === '/account/attest') {
    if (!(await checkRateLimit(env, ip, 'attest', 10))) return jsonError('Too many requests, try again in a minute.', 429, env, origin);
    return handleAccountAttest(request, env, origin);
  }
  if (url.pathname.startsWith('/group/')) {
    if (!(await checkRateLimit(env, ip, 'group', 40))) return jsonError('Too many requests, try again in a minute.', 429, env, origin);
    return handleGroupRoute(url.pathname.slice('/group/'.length), request, env, origin);
  }
  if (url.pathname === '/calendar-feed') {
    if (!(await checkRateLimit(env, ip, 'feed', 10))) return jsonError('Too many requests, try again in a minute.', 429, env, origin);
    return handleCalendarFeed(request, env, origin);
  }
  return jsonError('Not found', 404, env, origin);
}
