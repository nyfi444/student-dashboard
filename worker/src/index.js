
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
      subscriber breakdown (paying vs. comped, past due, canceling), list and
      net MRR, 30-day movement and collected revenue server-side (the
      dashboard can't call Stripe directly, Stripe blocks browser CORS on
      purpose); CTA-event funnel counts, recent contact-form messages, and
      crash-report counts from Firestore; and, only if CLOUDFLARE_API_TOKEN +
      CLOUDFLARE_ZONE_ID secrets are set, 7 days of Cloudflare traffic for
      semester-hq.com. Sections are omitted (not faked) when not configured.
   9. Group plans (/group/*): a club, team, or department buys seats for
      its members and runs them from group-admin.html. See section 9.
──────────────────────────────────────────────────────────────── */

// claude-sonnet-5 is the default (see js/ai.js): newer than sonnet-4.6 and a
// third cheaper on both sides ($2/$10 per MTok vs $3/$15). claude-opus-5 is
// here for the one genuinely hard case, a scanned image-only syllabus where
// the structure has to be inferred from the page layout; it costs 2.5x Sonnet
// 5, so nothing else should route to it. claude-sonnet-4-6 stays allowed for
// one release so a stored per-user aiModel setting doesn't start 400ing.
const ALLOWED_MODELS = ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
const MAX_TOKENS_CAP = 4000;
// What one account may ask for in a day. A student in their heaviest setup
// week runs maybe 10 calls; 40 leaves room for a bad day in the first week of
// term without leaving the bill open-ended if an ID token is ever stolen.
const AI_CALLS_PER_DAY = 40;
// MAX_TOKENS_CAP bounds one reply; this bounds one request. A 40-page
// syllabus packet, or a 600-page textbook uploaded to make flashcards, costs
// real money and produces nothing useful, so it's refused before it's sent.
const AI_MAX_INPUT_TOKENS = 60000;
const AI_MAX_BODY_BYTES = 24 * 1024 * 1024;
// Only these fields of the client's body ever reach Anthropic. Adding a field
// here is deliberate: the alternative (forwarding the whole body) would let a
// caller set anything the API accepts, on Nyla's key.
const AI_FORWARDED_FIELDS = ['model', 'system', 'messages', 'output_config'];
const ANTHROPIC_VERSION = '2023-06-01';
const PLUS_PRICE_CENTS = 799; // $7.99/month, bump the marketing copy too if this changes
const GROUP_SEAT_PRICE_CENTS = 599; // $5.99 per member per month, same note as above
const GROUP_MIN_SEATS = 5;
// Self-serve ceiling, enforced here because the client can't be trusted with
// it. Bigger groups, invoices, POs, and departments go through the quote form
// on the marketing site (see js/group-admin.js for the reasoning).
const GROUP_MAX_SEATS = 50;
const GROUP_KINDS = ['club', 'team', 'chapter', 'class', 'department', 'other'];

export default {
  // Every request passes through here. A route that throws still answers with
  // JSON and CORS headers (so the app can show its own message), and any 5xx
  // lands in the error log with the route and what went wrong.
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    try {
      const res = await routeRequest(request, env);
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
  // OS's events and clear out old reports. There is no reminder sweep — the
  // app doesn't send notifications, so nothing needs waking up every 5 minutes.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(buildBusinessEvents(env).catch(e => logServerIssue(env, 'business-events', 'Daily business events failed', e)));
    ctx.waitUntil(pruneOldIssues(env).catch(e => logServerIssue(env, 'diagnostics', 'Pruning old reports failed', e)));
  },
};

async function routeRequest(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin') || '';

  // /admin/errors needs GET + an Authorization header, unlike every other
  // route here (POST + content-type only), handle its preflight separately
  // so the browser doesn't reject the real request for a disallowed method/header.
  if (request.method === 'OPTIONS' && (url.pathname === '/admin/errors' || url.pathname === '/admin/business-summary' || url.pathname === '/admin/biz-events')) {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'authorization' } });
  }
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(env, origin) });

  // Stripe calls this server-to-server, no Origin header, verified by signature instead of CORS.
  if (url.pathname === '/stripe-webhook' && request.method === 'POST') return handleStripeWebhook(request, env);

  // Token-gated, not origin-restricted (see job 6 above).
  if (url.pathname === '/admin/errors' && request.method === 'GET') return handleAdminErrors(request, env);
  if (url.pathname === '/admin/business-summary' && request.method === 'GET') return handleAdminBusinessSummary(request, env);
  if (url.pathname === '/admin/biz-events' && (request.method === 'GET' || request.method === 'POST')) return handleAdminBizEvents(request, env);

  if (request.method !== 'POST') return jsonError('Method not allowed', 405, env, origin);

  // Defense in depth beyond CORS (CORS only stops browser JS from reading the response;
  // it doesn't stop a direct request), so also reject disallowed origins server-side.
  if (!isAllowedOrigin(env, origin)) return jsonError('Origin not allowed', 403, env, origin);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  if (url.pathname === '/v1/messages') {
    if (!(await checkRateLimit(env, ip, 'ai', 20))) return jsonError('Too many requests, try again in a minute.', 429, env, origin);
    return handleAiProxy(request, env, origin);
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

/* ── 10. LMS calendar feeds ────────────────────────────────────────
   The app reads a student's Canvas/Blackboard/Brightspace calendar link
   (see js/lmsfeed.js). A browser can't fetch it itself, the LMS sends no
   CORS headers, so this fetches it and hands the text back. That makes
   this a URL fetcher, so it is kept narrow: paid accounts only, https
   only, no private or literal-IP hosts (checked again on every redirect),
   two megabytes at most, and only a body that really is a calendar. */
const FEED_MAX_BYTES = 2 * 1024 * 1024;
const FEED_MAX_REDIRECTS = 3;
function feedUrlProblem(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return 'That doesn’t look like a link.'; }
  if (u.protocol !== 'https:') return 'The feed link needs to start with https:// (or webcal://).';
  if (u.username || u.password) return 'A link with a username and password in it can’t be used.';
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || /\.(local|internal|localdomain|home|lan|intranet|corp)$/.test(host)) return 'That link isn’t a calendar feed.';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[') || host.includes(':')) return 'That link isn’t a calendar feed.';
  return '';
}
async function readTextCapped(res, max) {
  const reader = res.body?.getReader?.();
  if (!reader) { const t = await res.text(); return t.length > max ? null : t; }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { try { await reader.cancel(); } catch {} return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  chunks.forEach(c => { all.set(c, off); off += c.byteLength; });
  return new TextDecoder().decode(all);
}
async function fetchCalendarFeed(startUrl) {
  let url = startUrl;
  for (let hop = 0; hop <= FEED_MAX_REDIRECTS; hop++) {
    const problem = feedUrlProblem(url);
    if (problem) return { error: problem, status: 400 };
    let res;
    try {
      res = await fetch(url, {
        method: 'GET', redirect: 'manual',
        headers: { accept: 'text/calendar, text/plain;q=0.8, */*;q=0.1', 'user-agent': 'SemesterHQ-CalendarFeed/1 (+https://semester-hq.com)' },
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined,
      });
    } catch { return { error: 'Couldn’t reach that link. Check it and try again.', status: 502 }; }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return { error: 'That link didn’t answer with a calendar.', status: 502 };
      try { url = new URL(loc, url).toString(); } catch { return { error: 'That link didn’t answer with a calendar.', status: 502 }; }
      continue;
    }
    if (!res.ok) return { error: `The calendar link answered ${res.status}. Make sure you copied the whole link.`, status: 502 };
    const text = await readTextCapped(res, FEED_MAX_BYTES);
    if (text === null) return { error: 'That feed is too large to read.', status: 413 };
    if (!/^\s*BEGIN:VCALENDAR/i.test(text.replace(/^\uFEFF/, ''))) return { error: 'That link isn’t a calendar feed. It should end in .ics, or come from your LMS calendar’s feed or subscribe option.', status: 400 };
    return { text };
  }
  return { error: 'That link redirects too many times.', status: 502 };
}
async function handleCalendarFeed(request, env, origin) {
  if (!env.FIREBASE_PROJECT_ID) return jsonError('Server misconfigured: FIREBASE_PROJECT_ID not set.', 500, env, origin);
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env, origin); }
  if (!body.idToken) return jsonError('Log in to connect a calendar feed.', 401, env, origin);
  let payload;
  try { payload = await verifyFirebaseIdToken(body.idToken, env.FIREBASE_PROJECT_ID); }
  catch { return jsonError('Your session expired, sign in again.', 401, env, origin); }
  try {
    const license = await readFirestoreDoc(env, 'licenses', payload.sub);
    if (!license?.paid) return jsonError('Calendar feeds are part of Semester HQ Plus.', 402, env, origin);
  } catch (e) {
    await logServerIssue(env, 'feeds', 'Could not read a license before a feed fetch', e);
    return jsonError('Could not verify access right now. Try again in a moment.', 500, env, origin);
  }
  if (!(await underDailyCap(env, `feed:${payload.sub}`, 200))) return jsonError('That is a lot of refreshes for one day. Try again tomorrow.', 429, env, origin);
  const url = String(body.url || '').trim().slice(0, 2000).replace(/^webcal:/i, 'https:');
  const out = await fetchCalendarFeed(url);
  if (out.error) return jsonError(out.error, out.status, env, origin);
  return jsonOk({ text: out.text }, env, origin);
}

// Small shared helper: several Firestore docs keep a list or map as a JSON
// string in a single field (group admins, for one), so this reads them back
// without a malformed value taking a request down with it.
function parseJsonField(v, fallback) { try { const x = JSON.parse(v || ''); return x ?? fallback; } catch { return fallback; } }

// PATCH only the named fields (updateMask), leaving the app's own fields alone.
async function patchFirestoreDoc(env, path, fields) {
  const token = await getFirebaseAccessToken(env);
  const mask = Object.keys(fields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}?${mask}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
  });
  if (!res.ok) throw new Error('Firestore patch failed: ' + await res.text());
}

/* ── 1. AI proxy ──────────────────────────────────────────────── */
// Gated behind a paid subscription: every caller must prove (via a fresh Firebase
// ID token) that they're signed in AND that licenses/{uid}.paid is true. This
// check has to live here, not just in the client (js/ai.js): anyone can call
// this endpoint directly with curl, bypassing whatever the UI does.
async function handleAiProxy(request, env, origin) {
  if (!env.ANTHROPIC_API_KEY) return jsonError('Server misconfigured: ANTHROPIC_API_KEY secret not set.', 500, env, origin);
  if (!env.FIREBASE_PROJECT_ID) return jsonError('Server misconfigured: FIREBASE_PROJECT_ID not set.', 500, env, origin);

  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > AI_MAX_BODY_BYTES) return jsonError('That upload is too large to read. Upload just the pages you need and try again.', 413, env, origin);

  // Read as text first: the content-length check above only sees what the
  // client declared, and a chunked upload declares nothing.
  const raw = await request.text();
  if (raw.length > AI_MAX_BODY_BYTES) return jsonError('That upload is too large to read. Upload just the pages you need and try again.', 413, env, origin);
  let body;
  try { body = JSON.parse(raw); } catch { return jsonError('Invalid JSON body', 400, env, origin); }

  if (!body.idToken) return jsonError('Sign in and subscribe to use AI upload.', 402, env, origin);
  let payload;
  try { payload = await verifyFirebaseIdToken(body.idToken, env.FIREBASE_PROJECT_ID); }
  catch { return jsonError('Your session expired, sign in again.', 401, env, origin); }

  try {
    const license = await readFirestoreDoc(env, 'licenses', payload.sub);
    if (!license?.paid) return jsonError('AI upload requires a subscription ($7.99/month).', 402, env, origin);
  } catch (e) {
    await logServerIssue(env, 'ai', 'Could not read a license before an AI call', e);
    return jsonError('Could not verify access right now. Try again in a moment.', 500, env, origin);
  }

  if (!ALLOWED_MODELS.includes(body.model)) return jsonError(`Model not allowed. Use one of: ${ALLOWED_MODELS.join(', ')}`, 400, env, origin);
  if (!body.system || !Array.isArray(body.messages)) return jsonError('Request must include system and messages', 400, env, origin);
  // Only the block shapes the app sends. Anything else (URL sources, tool
  // results, unknown kinds) is refused rather than priced blind.
  const badBlock = findDisallowedBlock(body.messages);
  if (badBlock) return jsonError(`Unsupported content block: ${badBlock}`, 400, env, origin);

  // Too big to be worth reading: refuse before it's sent, with a sentence
  // that says what to do instead, rather than after it's been paid for.
  const estimated = estimateInputTokens(body);
  if (estimated > AI_MAX_INPUT_TOKENS) {
    return jsonError('That’s too much to read at once. Upload just the pages you need — a syllabus is usually a few pages — and try again.', 413, env, origin);
  }

  // Nothing else bounds how many replies one account can ask for. Without
  // this, one stolen ID token turns a variable cost into an unbounded one.
  const quota = await checkAiDailyQuota(env, payload.sub);
  if (!quota.ok) {
    return jsonError(`You’ve used all ${AI_CALLS_PER_DAY} AI reads for today. They reset tomorrow — everything else in Semester HQ keeps working.`, 429, env, origin, { retryAfterHours: quota.hoursLeft });
  }

  const forwarded = {};
  for (const field of AI_FORWARDED_FIELDS) if (body[field] !== undefined) forwarded[field] = body[field];
  forwarded.max_tokens = Math.min(Number(body.max_tokens) || 1024, MAX_TOKENS_CAP);

  const send = () => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(forwarded),
  });

  let upstream = await send();
  // A burst — the first week of term, everyone setting up on the same
  // afternoon — can hit this account's own Anthropic rate limit. One quiet
  // retry turns most of those into a slightly slower upload rather than a
  // failure the student sees. Exactly one: the daily quota was already spent
  // above, and a retry loop would be a way to spend money in a circle.
  if (upstream.status === 429) {
    const wait = Math.min(Number(upstream.headers.get('retry-after')) * 1000 || 1500, 4000);
    await new Promise(r => setTimeout(r, wait));
    upstream = await send();
  }

  const text = await upstream.text();
  // Still rate limited after the retry. That isn't the student's fault and
  // shouldn't read like an error they caused.
  if (upstream.status === 429) {
    await logServerIssue(env, 'ai', 'Anthropic rate limited this account', null, { model: body.model });
    return jsonError('Semester HQ is busy right now — a lot of people are setting up at once. Give it a minute and try again.', 429, env, origin, { upstream: true });
  }
  if (!upstream.ok && upstream.status < 500) {
    let upstreamError = {};
    try { upstreamError = JSON.parse(text).error || {}; } catch {}
    await logServerIssue(env, 'ai', `Anthropic returned ${upstream.status}`, null, { model: body.model, type: upstreamError.type || '', detail: String(upstreamError.message || '').slice(0, 200) });
  }
  return new Response(text, { status: upstream.status, headers: corsHeaders(env, origin, { 'content-type': 'application/json' }) });
}

/* ── How much one request is about to cost, roughly ───────────────
   Text is counted at the usual ~4 characters per token. An image is
   counted at 1,800 tokens, about what a full syllabus page costs. This
   only has to be right enough to catch a textbook, not to bill anyone. */
function estimateInputTokens(body) {
  let chars = typeof body.system === 'string' ? body.system.length : JSON.stringify(body.system || '').length;
  let images = 0, documentBytes = 0;
  for (const message of body.messages || []) {
    const content = message?.content;
    if (typeof content === 'string') { chars += content.length; continue; }
    for (const block of Array.isArray(content) ? content : []) {
      if (block?.type === 'image') images++;
      else if (block?.type === 'document') documentBytes += Math.round(String(block.source?.data || '').length * 0.75);
      else if (typeof block?.text === 'string') chars += block.text.length;
    }
  }
  // A PDF costs roughly its text plus one image per page. Sizing it by bytes
  // (about 30 bytes per token for an ordinary document) is close enough to
  // stop a textbook without counting pages here.
  return Math.round(chars / 4) + images * 1800 + (documentBytes ? Math.max(1500, Math.round(documentBytes / 30)) : 0);
}
const AI_BLOCK_TYPES = new Set(['text', 'image', 'document']);
function findDisallowedBlock(messages) {
  for (const message of messages || []) {
    const content = message?.content;
    if (typeof content === 'string') continue;
    if (!Array.isArray(content)) return 'content';
    for (const block of content) {
      if (!block || !AI_BLOCK_TYPES.has(block.type)) return String(block?.type || 'unknown').slice(0, 40);
      if ((block.type === 'image' || block.type === 'document') && block.source?.type !== 'base64') return `${block.type}:${String(block.source?.type || 'missing').slice(0, 20)}`;
    }
  }
  return '';
}

/* ── Per-account daily AI quota (KV) ──────────────────────────────
   Counted per uid, not per IP: the point is to bound what one account
   can spend, and a student's IP changes between dorm and campus wifi.
   No RATE_LIMIT KV bound (local `wrangler dev`) → no limiting, rather
   than failing closed on a development machine. */
async function checkAiDailyQuota(env, uid) {
  if (!env.RATE_LIMIT) return { ok: true };
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const key = `ai:${uid}:${day}`;
  let used = 0;
  try { used = Number(await env.RATE_LIMIT.get(key)) || 0; }
  catch { return { ok: true }; } // KV unavailable: don't lock a paying student out
  if (used >= AI_CALLS_PER_DAY) {
    return { ok: false, hoursLeft: Math.max(1, 24 - now.getUTCHours()) };
  }
  // Two days of TTL so a key written just before midnight UTC still expires
  // on its own rather than lingering.
  try { await env.RATE_LIMIT.put(key, String(used + 1), { expirationTtl: 60 * 60 * 48 }); } catch {}
  return { ok: true, used: used + 1 };
}

/* ── 2. Checkout ──────────────────────────────────────────────── */
async function handleCreateCheckoutSession(request, env, origin) {
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

// A customer can only open the portal once it has a configuration. One is
// made here the first time Stripe says there isn't one (the account never
// saved its customer portal settings), then reused.
async function createStripePortalSession(env, customer, returnUrl) {
  const open = (configuration) => {
    const params = new URLSearchParams({ customer, return_url: returnUrl });
    if (configuration) params.set('configuration', configuration);
    return stripeRequest(env, 'POST', '/v1/billing_portal/sessions', params);
  };
  let res = await open();
  if (!res.ok && /configuration/i.test(res.data.error?.message || '')) {
    const configuration = await ensurePortalConfiguration(env);
    if (configuration) res = await open(configuration);
  }
  if (!res.ok) throw new Error(res.data.error?.message || 'unknown error');
  return res.data.url;
}
async function ensurePortalConfiguration(env) {
  const list = await stripeRequest(env, 'GET', '/v1/billing_portal/configurations?active=true&limit=10');
  const configs = list.data?.data || [];
  const existing = configs.find(c => c.is_default) || configs[0];
  if (existing) return existing.id;
  const params = new URLSearchParams();
  params.set('business_profile[headline]', 'Manage your Semester HQ plan');
  params.set('business_profile[privacy_policy_url]', 'https://semester-hq.com/privacy.html');
  params.set('business_profile[terms_of_service_url]', 'https://semester-hq.com/terms.html');
  params.set('features[payment_method_update][enabled]', 'true');
  params.set('features[invoice_history][enabled]', 'true');
  params.set('features[customer_update][enabled]', 'true');
  params.append('features[customer_update][allowed_updates][]', 'email');
  params.append('features[customer_update][allowed_updates][]', 'address');
  params.set('features[subscription_cancel][enabled]', 'true');
  params.set('features[subscription_cancel][mode]', 'at_period_end');
  params.set('metadata[created_by]', 'semester-hq-worker');
  const created = await stripeRequest(env, 'POST', '/v1/billing_portal/configurations', params);
  if (!created.ok) await logServerIssue(env, 'checkout', 'Could not create a portal configuration', null, { stripe: created.data.error?.message || '' });
  return created.ok ? created.data.id : '';
}
async function findStripeCustomerByEmail(env, email) {
  const variants = [...new Set([email.trim(), email.trim().toLowerCase()])];
  for (const variant of variants) {
    const res = await stripeRequest(env, 'GET', `/v1/customers?limit=10&email=${encodeURIComponent(variant)}&expand[]=data.subscriptions`);
    const customers = res.ok ? res.data.data || [] : [];
    const withSubscription = customers.find(c => (c.subscriptions?.data || []).length);
    if (withSubscription || customers[0]) return (withSubscription || customers[0]).id;
  }
  return '';
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
function individualPaidOf(license) {
  if (!license) return false;
  return typeof license.individualPaid === 'boolean' ? license.individualPaid : !license.groupPaid && !!license.paid;
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
async function handleCheckEmail(request, env, origin) {
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

// Self-serve "delete my account": cancels any active Stripe subscription,
// erases every server-side record we hold for this uid/email (licenses,
// the email-keyed linking doc, and the synced planner doc), and deletes the
// Firebase Auth user itself. Requires the service account's OAuth token to
// carry the Identity Toolkit scope (see getFirebaseAccessToken) and the
// underlying GCP service account to have the "Firebase Authentication Admin"
// role. Without that role the Auth-user deletion step fails and is reported
// back to the client rather than silently ignored, since the rest of the
// erasure still succeeded and shouldn't be treated as a full failure the
// user needs to retry.
/* ── Leaving every shared space when an account is deleted ────────
   Deleting an account used to remove the person's own data and their
   group-plan seat, and leave them sitting in every study group and club
   they had joined: still in the member list, still in the availability
   grid, still counted, with a name nobody could remove because the
   account behind it no longer existed.

   Two things make this more than a filter on an array:

   1. Ownership. A study group's owner is the only one who can remove
      anyone or delete it, and firestore.rules requires a club's
      createdBy to be in both memberUids and officerUids for any officer
      edit to pass. Removing an owner without handing the role on would
      leave the group intact and unmanageable by anybody. So the role
      moves to the longest-standing member who is left (an officer first,
      in a club), and a space with nobody left is deleted outright.

   2. Concurrency. These documents are shared, and someone else may be
      editing one while this runs, so each change is a read-modify-write
      guarded by the document's updateTime and retried on a clash.

   Chat messages are left where they are. They carry the author's name on
   the message itself, so that gets replaced rather than the conversation
   being torn out from under everyone else who was in it.
──────────────────────────────────────────────────────────────── */
const DELETED_PERSON_NAME = 'Deleted account';
const SHARED_SPACE_SCAN_LIMIT = 100;
// Used inside Firestore field paths (`people.<uid>`), where a stray dot or
// backtick would change which field is addressed.
function safeFieldKey(k) { return typeof k === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(k); }

async function removeMemberFromSharedSpace(env, path, uid, kind) {
  if (!safeFieldKey(uid)) throw new Error('Unsafe uid for a field path');
  const [collection, docId] = path.split('/');
  const subcollections = kind === 'org' ? ['messages'] : ['items', 'messages'];
  for (let attempt = 0; attempt < 5; attempt++) {
    const snap = await readFirestoreDocWithTime(env, path);
    if (!snap) return;
    const d = snap.data;
    const members = (d.memberUids || []).filter(u => u !== uid);

    // Last one out. Nothing to hand over, and an empty group is only clutter.
    if (!members.length) {
      for (const sub of subcollections) await deleteFirestoreSubcollection(env, path, sub);
      await deleteFirestoreDoc(env, collection, docId);
      return;
    }

    const fields = { memberUids: members, updatedAt: Date.now() };
    const clear = [`people.${uid}`];
    if (kind === 'group') clear.push(`avail.${uid}`);
    if (kind === 'org') {
      fields.officerUids = (d.officerUids || []).filter(u => u !== uid);
      clear.push(`rsvp.${uid}`, `titles.${uid}`);
    }

    if (d.createdBy === uid) {
      const joined = (u) => Number(d.people?.[u]?.joinedAt) || 0;
      const officers = kind === 'org' ? members.filter(u => (d.officerUids || []).includes(u)) : [];
      const heir = [...(officers.length ? officers : members)].sort((a, b) => joined(a) - joined(b))[0];
      fields.createdBy = heir;
      if (kind === 'org' && !fields.officerUids.includes(heir)) fields.officerUids = [...fields.officerUids, heir];
      // A study group shows its owner from people[uid].role, so the badge has
      // to move with the role or the group looks like it still has no owner.
      if (kind === 'group' && safeFieldKey(heir) && d.people?.[heir]) fields[`people.${heir}.role`] = 'owner';
    }

    // The group's own preview of the last message carries a name too.
    if (d.lastMessage?.uid === uid) fields['lastMessage.name'] = DELETED_PERSON_NAME;

    if (await commitFirestore(env, [{ path, fields, clear, updateTime: snap.updateTime }])) {
      await anonymizeMessagesBy(env, path, uid);
      return;
    }
  }
  throw new Error(`Could not update ${path} after 5 attempts`);
}

// Their messages stay so the conversation still reads, but their name comes
// off them. Capped: a long-running group's history is not worth an unbounded
// number of writes inside a request the person is waiting on.
async function anonymizeMessagesBy(env, path, uid) {
  const msgs = await runFirestoreQuery(env, {
    from: [{ collectionId: 'messages' }],
    where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: uid } } },
    limit: 300,
  }, `${path}`);
  const named = msgs.filter(m => m.name && m.name !== DELETED_PERSON_NAME);
  for (let i = 0; i < named.length; i += 20) {
    await commitFirestore(env, named.slice(i, i + 20).map(m => ({ path: `${path}/messages/${m.id}`, fields: { name: DELETED_PERSON_NAME } })));
  }
}

async function leaveSharedSpaces(env, uid, planner) {
  const failed = [];
  const step = async (what, fn) => {
    try { await fn(); }
    catch (e) { failed.push(what); await logServerIssue(env, 'account', `Account delete could not ${what}`, e); }
  };
  const membersOf = (collectionId) => runFirestoreQuery(env, {
    from: [{ collectionId }],
    where: { fieldFilter: { field: { fieldPath: 'memberUids' }, op: 'ARRAY_CONTAINS', value: { stringValue: uid } } },
    limit: SHARED_SPACE_SCAN_LIMIT,
  });

  let groups = [], orgs = [];
  await step('list study groups', async () => { groups = await membersOf('studyGroups'); });
  for (const g of groups) await step(`leave study group ${g.id}`, () => removeMemberFromSharedSpace(env, `studyGroups/${g.id}`, uid, 'group'));

  await step('list clubs', async () => { orgs = await membersOf('orgs'); });
  for (const o of orgs) await step(`leave club ${o.id}`, () => removeMemberFromSharedSpace(env, `orgs/${o.id}`, uid, 'org'));

  // Shared classes have no member array to query, just a document per member,
  // so the codes come from the planner being deleted. Read it before it goes.
  const codes = [...new Set((planner?.courses || []).map(c => c?.sharedClass?.code).filter(safeFieldKey))];
  for (const code of codes) await step(`leave class ${code}`, () => deleteFirestoreDoc(env, `classes/${code}/members`, uid));

  return failed;
}

async function handleDeleteAccount(request, env, origin) {
  if (!env.FIREBASE_PROJECT_ID) return jsonError('Server misconfigured: FIREBASE_PROJECT_ID not set.', 500, env, origin);
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env, origin); }
  if (!body.idToken) return jsonError('Missing idToken', 400, env, origin);

  let payload;
  try { payload = await verifyFirebaseIdToken(body.idToken, env.FIREBASE_PROJECT_ID); }
  catch { return jsonError('Your session expired, sign in again.', 401, env, origin); }

  const uid = payload.sub;
  const email = verifiedEmailOf(payload);

  try {
    const license = await readFirestoreDoc(env, 'licenses', uid);
    // A group plan still being billed needs someone to run it, so its only
    // admin can't disappear. Otherwise the person just steps off every plan.
    const adminPlans = await groupPlansAdminedBy(env, uid);
    const orphaned = adminPlans.find(p => groupHasAccess(p.status) && (p.adminUids || []).length <= 1);
    if (orphaned) return jsonError(`You’re the only admin of ${orphaned.name}’s group plan. Make someone else an admin or cancel the plan first (app.semester-hq.com/group-admin.html), then delete your account.`, 409, env, origin);
    for (const plan of adminPlans) await setGroupAdmins(env, plan, groupAdmins(plan).filter(a => a.uid !== uid));
    if (license?.groupPlanId) await removeGroupMember(env, license.groupPlanId, uid);

    // Study groups, clubs and shared classes, before the planner doc is
    // deleted below: it's the only record of which shared classes they
    // joined. A failure here is logged and doesn't stop the deletion — being
    // left in a group is bad, but refusing to delete an account someone asked
    // to delete is worse, and the alternative is stopping halfway.
    const planner = await readFirestoreDoc(env, 'planners', uid).catch(() => null);
    const leftBehind = await leaveSharedSpaces(env, uid, planner);
    // Same fallback as handleCreatePortalSession: an account whose license was
    // claimed via email (bought before signing up) may be missing this field on
    // the uid-keyed doc even from before that path was fixed to copy it over.
    // Without this, deleting the account leaves the Stripe subscription running
    // and the person gets billed forever after being told their account is gone.
    let stripeSubscriptionId = license?.stripeSubscriptionId;
    if (!stripeSubscriptionId && email) {
      try {
        const byEmail = await readFirestoreDoc(env, 'licensesByEmail', encodeEmailDocId(email));
        if (byEmail?.paid) stripeSubscriptionId = byEmail.stripeSubscriptionId;
      } catch (e) { await logServerIssue(env, 'license', 'licensesByEmail fallback lookup failed', e); }
    }

    if (stripeSubscriptionId && env.STRIPE_SECRET_KEY) {
      const res = await fetch(`https://api.stripe.com/v1/subscriptions/${stripeSubscriptionId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
      });
      // Already-canceled subscriptions 404/410 here, not an error for our purposes.
      if (!res.ok && res.status !== 404) {
        const data = await res.json().catch(() => ({}));
        return jsonError('Could not cancel your subscription: ' + (data.error?.message || 'unknown error') + '. Your account was not deleted, try again or email hello@semester-hq.com.', 500, env, origin);
      }
    }

    await deleteFirestoreDoc(env, 'licenses', uid);
    if (email) await deleteFirestoreDoc(env, 'licensesByEmail', encodeEmailDocId(email));
    // Notes live in their own subcollection (planners/{uid}/notes/{id}), not
    // inline in the planner doc. Deleting the parent doc below does NOT
    // cascade-delete those, Firestore never does that automatically. Delete
    // them explicitly first or "delete my account" leaves every note behind.
    await deleteFirestoreSubcollection(env, `planners/${uid}`, 'notes');
    await deleteFirestoreDoc(env, 'planners', uid);
    await deleteFirestoreDoc(env, 'push', uid).catch(() => {});
    // Firebase Storage: the syllabus originals and attachments under
    // users/{uid}/. Deleting the Firestore documents never touched these, and
    // a syllabus carries a professor's contact details, so they go too.
    // Logged rather than blocking: the account is still deleted if Storage
    // is having a bad day, and the leftover prefix is easy to find by uid.
    let filesDeleted = 0;
    try { filesDeleted = await deleteStorageFolder(env, `users/${uid}/`); }
    catch (e) { await logServerIssue(env, 'account', 'Account delete could not remove stored files', e, { uid }); }

    let authDeleted = true;
    try { await deleteFirebaseAuthUser(env, uid); }
    catch (e) { authDeleted = false; await logServerIssue(env, 'account', 'Auth user delete failed', e); }

    return jsonOk({ ok: true, authDeleted, leftBehind: leftBehind.length, filesDeleted }, env, origin);
  } catch (e) {
    await logServerIssue(env, 'account', 'Account deletion failed', e);
    return jsonError('Could not delete your account right now. Try again in a moment, or email hello@semester-hq.com.', 500, env, origin);
  }
}

/* ── 4. Contact form ──────────────────────────────────────────── */
// Writes to Firestore's `feedback` collection. Clients can never read or
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
  // fill every field trip it, report success anyway so they don't learn
  // to leave it blank.
  if (body.website) return jsonOk({ ok: true }, env, origin);

  const name = String(body.name || '').trim().slice(0, 200);
  const email = String(body.email || '').trim().slice(0, 320);
  const category = CONTACT_CATEGORIES.includes(body.category) ? body.category : 'other';
  const message = String(body.message || '').trim().slice(0, 5000);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError('Enter a valid email so we can reply.', 400, env, origin);
  // Brakes on top of the per-minute limit, so one person or one script can't
  // turn the form into an outbound email cannon or fill the inbox.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await turnstileOk(env, body.turnstileToken, ip))) return jsonError('Please complete the verification and try again.', 400, env, origin);
  if (!(await underDailyCap(env, 'contact', 100)) || !(await underDailyCap(env, `contact:${email.toLowerCase()}`, 5))) {
    return jsonError('That is a lot of messages for one day. Email hello@semester-hq.com directly and we will get back to you.', 429, env, origin);
  }
  if (!message) return jsonError('Message can’t be empty.', 400, env, origin);

  try {
    const id = crypto.randomUUID();
    await writeFirestoreDoc(env, 'feedback', id, { name, email, category, message, createdAt: new Date() });
    // Best-effort: the Firestore write above is what actually preserves the
    // message, so a flaky email provider must never fail the submission itself.
    // Without this, the ONLY way to see a new message was to go check the
    // Firestore console by hand.
    await notifyNewContactMessage(env, { name, email, category, message }).catch(e => logServerIssue(env, 'feedback', 'Contact notification email failed', e));
    return jsonOk({ ok: true }, env, origin);
  } catch (e) {
    await logServerIssue(env, 'feedback', 'Could not save a contact message', e);
    return jsonError('Could not send your message right now. Email hello@semester-hq.com instead.', 500, env, origin);
  }
}
// Sends the site owner an email via Resend (https://resend.com) so a new
// contact-form/group-pricing submission shows up in an inbox instead of only
// the Firestore `feedback` collection. Silently no-ops if RESEND_API_KEY
// isn't set, so this stays optional. See worker/README.md to enable it.
async function notifyNewContactMessage(env, { name, email, category, message }) {
  if (!env.RESEND_API_KEY) return;
  const to = env.NOTIFY_EMAIL || 'hello@semester-hq.com';
  const from = env.NOTIFY_FROM || 'Semester HQ <onboarding@resend.dev>';
  const subject = `[Semester HQ] New ${category} message${name ? ' from ' + name : ''}`;
  const text = `Category: ${category}\nFrom: ${name || '(no name given)'} <${email}>\n\n${message}`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to, reply_to: email, subject, text }),
  });
  if (!res.ok) throw new Error(`Resend API ${res.status}: ${await res.text()}`);
}

/* ── 5. Diagnostics ───────────────────────────────────────────── */
// Writes to Firestore's `errors` collection, same server-only pattern as
// `feedback` (see firestore.rules). Reachable by anyone, so every field is
// capped and coerced rather than trusted as-is, and emails or URL parameter
// values are stripped again here in case an older client sent them.
const ERROR_SOURCES = ['app', 'marketing'];
const ERROR_LEVELS = ['error', 'warn'];
async function handleLogError(request, env, origin) {
  if (!env.FIREBASE_PROJECT_ID) return jsonError('Server misconfigured: FIREBASE_PROJECT_ID not set.', 500, env, origin);
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env, origin); }

  const clip = (v, max) => scrubPII(String(v ?? '').trim()).slice(0, max);
  const message = clip(body.message, 2000);
  if (!message) return jsonError('Missing error message', 400, env, origin);
  const source = ERROR_SOURCES.includes(body.source) ? body.source : 'app';
  const feature = String(body.feature || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'unknown';
  let context = '';
  try { context = body.context && typeof body.context === 'object' ? clip(JSON.stringify(body.context), 1500) : ''; } catch {}

  // The same problem reported over and over is one problem: after twenty
  // copies in an hour the rest are counted and not stored, and the whole
  // collection takes at most a few thousand new reports a day, so a stuck
  // client or a script can't fill Firestore.
  const fingerprint = await issueFingerprint(source, feature, message);
  if (!(await underDailyCap(env, 'errors', 3000)) || !(await underHourlyCap(env, `errfp:${fingerprint}`, 20))) return jsonOk({ ok: true, dropped: true }, env, origin);

  try {
    await writeFirestoreDoc(env, 'errors', crypto.randomUUID(), {
      source, feature, message,
      level: ERROR_LEVELS.includes(body.level) ? body.level : 'error',
      stack: clip(body.stack, 4000),
      url: clip(body.page || body.url, 500), // older clients send `url`
      release: clip(body.release, 60),
      session: clip(body.session, 20),
      userAgent: clip(body.userAgent, 300),
      breadcrumbs: (Array.isArray(body.breadcrumbs) ? body.breadcrumbs : []).slice(-25).map(c => clip(c, 160)),
      context,
      fingerprint,
      createdAt: new Date(),
    });
  } catch (e) {
    // Never fail loudly over a logging endpoint, or a broken reporter spams retries.
    console.error('Error log write failed', e);
  }
  return jsonOk({ ok: true }, env, origin);
}

// The Worker's own failures, in the same collection as source "worker", so
// admin/errors.html shows them next to what students hit. Always goes to
// Workers Logs as well. The same issue repeating within 10 minutes on one
// instance is only logged to the console, so an outage can't flood Firestore.
const _recentIssues = new Map();
async function logServerIssue(env, feature, message, err, extra = {}) {
  const text = scrubPII(err?.message ? `${message}: ${err.message}` : message).slice(0, 2000);
  console.error(JSON.stringify({ level: 'error', feature, message: text, ...extra, stack: scrubPII(String(err?.stack || '')) }));
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) return;
  try {
    const fingerprint = await issueFingerprint('worker', feature, text);
    if (Date.now() - (_recentIssues.get(fingerprint) || 0) < 10 * 60 * 1000) return;
    _recentIssues.set(fingerprint, Date.now());
    await writeFirestoreDoc(env, 'errors', crypto.randomUUID(), {
      source: 'worker', level: 'error', feature, message: text,
      stack: scrubPII(String(err?.stack || '')).slice(0, 4000),
      context: scrubPII(JSON.stringify(extra)).slice(0, 1500),
      fingerprint, createdAt: new Date(),
    });
  } catch (e) { console.error('Could not record server issue', e?.message); }
}
function featureForPath(path) {
  const map = [[/^\/v1\/messages/, 'ai'], [/^\/create-(checkout|portal)-session|^\/stripe-webhook/, 'checkout'], [/^\/(claim-license|check-email)/, 'license'],
    [/^\/group\//, 'group-plans'], [/^\/delete-account/, 'account'], [/^\/contact-message/, 'feedback'], [/^\/admin\//, 'admin']];
  return (map.find(([re]) => re.test(path)) || [])[1] || 'worker';
}
function scrubPII(text) {
  return String(text).replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]').replace(/([?&#][\w-]+=)[^&#\s'")]+/g, '$1…');
}
// Groups repeats of one problem: same source, feature, and message once
// numbers and ids are ignored.
async function issueFingerprint(source, feature, message) {
  const normalized = String(message).toLowerCase().replace(/[0-9a-f]{8,}|\d+/g, '#').replace(/\s+/g, ' ').slice(0, 300);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${source}|${feature}|${normalized}`));
  return [...new Uint8Array(hash)].slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
}
// Daily: reports older than 30 days are deleted, so the collection stays small.
async function pruneOldIssues(env) {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) return;
  await pruneCollection(env, 'errors', 30, 400);
  // Click and syllabus-read events: 90 days shows every trend that matters,
  // and nothing pruned them before.
  await pruneCollection(env, 'events', 90, 800);
}
async function pruneCollection(env, collectionId, days, limit) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const old = await runFirestoreQuery(env, {
    from: [{ collectionId }],
    where: { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'LESS_THAN', value: { timestampValue: cutoff } } },
    limit,
  });
  for (let i = 0; i < old.length; i += 400) {
    await commitFirestore(env, old.slice(i, i + 400).map(r => ({ path: `${collectionId}/${r.id}`, remove: true })));
  }
}

/* ── 7. Event tracking ────────────────────────────────────────── */
// Writes to Firestore's `events` collection, same server-only, rate-limited
// pattern as error logging. Intentionally minimal (no cookies, no per-user
// identity): just which CTA fired, from which page, so conversion is
// measurable without turning this into a full analytics/tracking pipeline.
const TRACKED_EVENTS = [
  'nav_login_click', 'nav_upgrade_click', 'try_it_free_click', 'get_started_click', 'checkout_started', 'checkout_error',
  // The syllabus is the wedge, so its failure rate is the reliability number
  // that matters most. `syllabus_read` fires on every upload attempt (with
  // whether it parsed and what came back); `syllabus_kept` fires after the
  // student has reviewed it, and says how much of it they actually kept.
  // That second number is the real accuracy metric — see detail fields below.
  'syllabus_read', 'syllabus_kept',
];
// The only extra fields an event may carry. Counts and short labels about the
// document, never anything from inside it: no course names, no file names, no
// text the student uploaded.
const EVENT_DETAIL_NUMBERS = ['pages', 'images', 'chars', 'assignments', 'details', 'meetings', 'ms', 'cacheRead', 'cacheWrite', 'inputTokens', 'outputTokens', 'offered', 'kept', 'edited', 'removed'];
const EVENT_DETAIL_LABELS = ['source', 'fileType', 'model', 'outcome', 'reason'];

function cleanEventDetail(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const detail = {};
  for (const key of EVENT_DETAIL_NUMBERS) {
    const n = Number(raw[key]);
    if (Number.isFinite(n)) detail[key] = Math.max(0, Math.min(Math.round(n), 10_000_000));
  }
  for (const key of EVENT_DETAIL_LABELS) {
    const v = String(raw[key] ?? '').replace(/[^a-zA-Z0-9 ._-]/g, '').trim().slice(0, 40);
    if (v) detail[key] = v;
  }
  return Object.keys(detail).length ? detail : null;
}

async function handleTrackEvent(request, env, origin) {
  if (!env.FIREBASE_PROJECT_ID) return jsonOk({ ok: true }, env, origin); // never block the page over a missing config

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env, origin); }

  const event = TRACKED_EVENTS.includes(body.event) ? body.event : null;
  if (!event) return jsonError('Unknown event', 400, env, origin);
  const path = String(body.path || '').trim().slice(0, 200);
  const detail = cleanEventDetail(body.detail);
  if (!(await underDailyCap(env, 'events', 20000))) return jsonOk({ ok: true, dropped: true }, env, origin);

  try {
    const id = crypto.randomUUID();
    await writeFirestoreDoc(env, 'events', id, { event, path, createdAt: new Date(), ...(detail ? { detail } : {}) });
  } catch (e) {
    console.error('Event track write failed', e); // never fail the click over a logging endpoint
  }
  return jsonOk({ ok: true }, env, origin);
}

/* ── 6. Error viewer ──────────────────────────────────────────── */
// Backs admin/errors.html. Bearer token compared with timing-safe equality
// against the ADMIN_TOKEN secret (set via `wrangler secret put ADMIN_TOKEN`).
async function handleAdminErrors(request, env) {
  const adminCors = { 'Access-Control-Allow-Origin': '*', 'content-type': 'application/json', 'X-Content-Type-Options': 'nosniff' };
  if (!env.ADMIN_TOKEN) return new Response(JSON.stringify({ error: 'Server misconfigured: ADMIN_TOKEN not set.' }), { status: 500, headers: adminCors });
  if (!env.FIREBASE_PROJECT_ID) return new Response(JSON.stringify({ error: 'Server misconfigured: FIREBASE_PROJECT_ID not set.' }), { status: 500, headers: adminCors });

  if (!(await adminTokenOk(request, env))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: adminCors });
  }

  try {
    const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get('limit')) || 200, 1), 300);
    const errors = await queryRecentErrors(env, limit);
    return new Response(JSON.stringify({ errors }), { headers: adminCors });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Could not load errors: ' + e.message }), { status: 500, headers: adminCors });
  }
}

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
async function handleAdminBusinessSummary(request, env) {
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
async function fetchStripeSummary(env) {
  const subs = [];
  let startingAfter = '';
  let truncated = false;
  for (let page = 0; page < STRIPE_SUB_PAGE_CAP; page++) {
    const qs = `limit=100&status=all&expand[]=data.items.data.price&expand[]=data.latest_invoice&expand[]=data.customer${startingAfter ? `&starting_after=${startingAfter}` : ''}`;
    const res = await fetch(`https://api.stripe.com/v1/subscriptions?${qs}`, {
      headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    const data = await res.json();
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
  recent.sort((a, b) => (b.created || 0) - (a.created || 0));
  subscribers.sort((a, b) => (b.created || 0) - (a.created || 0));

  let revenue30d = null;
  try { revenue30d = await fetchStripeRevenue30d(env); }
  catch (e) { revenue30d = { error: e.message }; }

  let books = null;
  try { books = await fetchStripeBooks(env); }
  catch (e) { books = { error: e.message }; }

  return {
    activeCount, mrrCents, netMrrCents, payingCount, compedCount, pastDueCount, cancelingCount,
    groupPlanCount, groupSeatCount,
    new7d, new30d, canceled30d, totalSubscriptions: subs.length, truncated,
    revenue30d, recent: recent.slice(0, 30), fetchedAt: now,
    subscribers: subscribers.slice(0, 500), books,
  };
}

// One row of the Business OS's subscriber list. Only what Nyla needs to
// recognize someone and see where they stand: who, which plan, since when,
// what they pay. This route is ADMIN_TOKEN-only.
function subscriberRow(sub, { created, listCents, chargedCents }) {
  const customer = sub.customer && typeof sub.customer === 'object' && !sub.customer.deleted ? sub.customer : null;
  const item = sub.items?.data?.[0] || {};
  const periodEnd = sub.current_period_end || item.current_period_end || null;
  const coupon = sub.discount?.coupon || (Array.isArray(sub.discounts) && typeof sub.discounts[0] === 'object' ? sub.discounts[0]?.coupon : null);
  const isGroup = sub.metadata?.kind === 'group';
  return {
    id: sub.id,
    customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id || null,
    email: customer?.email || sub.metadata?.email || '',
    name: customer?.name || '',
    status: sub.status,
    plan: isGroup ? 'group' : 'plus',
    seats: isGroup ? (item.quantity || 0) : 1,
    groupName: isGroup ? String(sub.metadata?.groupName || sub.metadata?.name || '').slice(0, 80) : '',
    coupon: coupon ? String(coupon.name || coupon.id || '').slice(0, 60) : '',
    comped: (sub.status === 'active' || sub.status === 'trialing') && chargedCents <= 0,
    created,
    canceledAt: sub.canceled_at ? sub.canceled_at * 1000 : null,
    endedAt: sub.ended_at ? sub.ended_at * 1000 : null,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    periodEnd: periodEnd ? periodEnd * 1000 : null,
    listCents: listCents || 0,
    chargedCents: Math.max(0, chargedCents || 0),
  };
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
async function stripeGetJson(env, path) {
  const res = await fetch(`https://api.stripe.com${path}`, { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Stripe returned ${res.status}`);
  return data;
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
  return { d7, d30, syllabus: syllabusHealth(rows), capped: rows.length >= 5000 };
}

/* ── Is the wedge actually working? ───────────────────────────────
   Everything in Semester HQ depends on a student dropping in a PDF and
   getting their semester back. These are the numbers that say whether
   that is happening: how often a read succeeds, how much it finds, and
   — the honest one — how much of what it found the student kept after
   looking at it. A high parse rate with a low keep rate means the
   parser is confidently wrong, which is worse than failing. */
function syllabusHealth(rows) {
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

async function fetchErrorSummary(env) {
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
  };
}

/* ── Stripe signature verification ───────────────────────────── */
async function verifyStripeSignature(rawBody, sigHeader, secret) {
  // The header can carry more than one v1 signature while a webhook secret
  // is being rotated; any one of them matching is a valid delivery.
  let timestamp = '';
  const signatures = [];
  for (const part of String(sigHeader).split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === 't' && !timestamp) timestamp = v;
    else if (k === 'v1' && v) signatures.push(v);
  }
  if (!timestamp || !signatures.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false; // 5 min replay window

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const computed = [...new Uint8Array(sigBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
  return signatures.some(sig => timingSafeEqual(computed, sig));
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ── 9. Group plans ───────────────────────────────────────────────
   A club, team, chapter, class, or department buys seats for its members
   ($5.99 each per month, 5 or more) and runs them from group-admin.html.
   Stripe bills the plan's buyer for the seat count; members join with the
   plan's invite link (app.semester-hq.com/?plan=CODE) and get Plus through
   the group without paying themselves. Only this Worker writes any of it:
   - groupPlans/{planId}: name, kind, status, seats, memberCount, adminUids,
     adminsJson, inviteCode, orgCode (a linked club), Stripe ids
   - groupPlans/{planId}/members/{uid}: who holds a seat
   - groupInvites/{code}: invite code → planId
   A member's licenses/{uid} gets groupPlanId, groupName, and groupPaid next
   to individualPaid (their own subscription), and paid is true when either
   is, so the app's license check reads the same field as always. A plan
   keeps access while Stripe retries a failed payment (past_due), so one
   declined card doesn't lock out a whole team; it loses access once the
   subscription is canceled or Stripe stops retrying. */
const GROUP_INVITE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
function groupStatusFromStripe(status) {
  if (status === 'active' || status === 'trialing') return 'active';
  if (status === 'past_due') return 'past_due';
  if (status === 'incomplete') return 'pending';
  return 'canceled';
}
function groupHasAccess(status) { return status === 'active' || status === 'past_due'; }
function groupAdmins(plan) { const list = parseJsonField(plan.adminsJson, []); return Array.isArray(list) ? list : []; }
function groupAdminUrl(env, planId) { return new URL(`group-admin.html?plan=${encodeURIComponent(planId)}`, env.APP_URL).toString(); }
function cleanGroupText(value, max) { return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function randomToken(length, chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') {
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), b => chars[b % chars.length]).join('');
}
function groupPlanSummary(env, plan) {
  const live = groupHasAccess(plan.status);
  return {
    id: plan.id, name: plan.name || '', kind: plan.kind || 'club', status: plan.status || 'pending',
    seats: plan.seats || 0, requestedSeats: plan.requestedSeats || 0, memberCount: plan.memberCount || 0,
    seatPriceCents: GROUP_SEAT_PRICE_CENTS, minSeats: GROUP_MIN_SEATS, maxSeats: GROUP_MAX_SEATS,
    inviteCode: live ? plan.inviteCode || '' : '',
    inviteUrl: live && plan.inviteCode ? new URL(`?plan=${plan.inviteCode}`, env.APP_URL).toString() : '',
    orgCode: plan.orgCode || '', admins: groupAdmins(plan),
    cancelAtPeriodEnd: !!plan.cancelAtPeriodEnd, currentPeriodEnd: plan.currentPeriodEnd || '', createdAt: plan.createdAt || '',
  };
}

const GROUP_ACTIONS = {
  mine: groupMine, details: groupDetails, 'create-checkout': groupCreateCheckout, seats: groupSetSeats,
  'remove-member': groupRemoveMember, 'set-admin': groupSetAdmin, rename: groupRename, 'reset-invite': groupResetInvite,
  portal: groupPortal, 'delete-pending': groupDeletePending, join: groupJoin, leave: groupLeave,
};
async function handleGroupRoute(action, request, env, origin) {
  try {
    if (!env.FIREBASE_PROJECT_ID || !env.STRIPE_SECRET_KEY || !env.APP_URL) throw new HttpError(500, 'Group plans aren’t set up on this server yet.');
    let body;
    try { body = await request.json(); } catch { throw new HttpError(400, 'Invalid JSON body'); }
    // The one public action: what an invite link is for, shown before sign-in.
    if (action === 'join-info') return jsonOk(await groupJoinInfo(env, body), env, origin);
    const run = GROUP_ACTIONS[action];
    if (!run) throw new HttpError(404, 'Not found');
    if (!body.idToken) throw new HttpError(401, 'Sign in first.');
    let user;
    try { user = await verifyFirebaseIdToken(body.idToken, env.FIREBASE_PROJECT_ID); }
    catch { throw new HttpError(401, 'Your session expired. Sign in again.'); }
    const email = verifiedEmailOf(user);
    const name = cleanGroupText(user.name, 80) || email.split('@')[0] || 'Member';
    return jsonOk(await run(env, { body, uid: user.sub, email, name }), env, origin);
  } catch (e) {
    if (e instanceof HttpError) return jsonError(e.message, e.status, env, origin, e.extra);
    console.error(`group/${action} failed`, e);
    return jsonError('Something went wrong. Try again in a moment.', 500, env, origin);
  }
}

async function loadGroupPlan(env, planId) {
  if (!/^[A-Za-z0-9]{12,40}$/.test(String(planId || ''))) throw new HttpError(404, 'That group plan wasn’t found.');
  const plan = await readFirestoreDoc(env, 'groupPlans', planId);
  if (!plan || plan.status === 'deleted') throw new HttpError(404, 'That group plan wasn’t found.');
  return { ...plan, id: planId };
}
async function loadAdminPlan(env, ctx) {
  const plan = await loadGroupPlan(env, ctx.body.planId);
  if (!(plan.adminUids || []).includes(ctx.uid)) throw new HttpError(403, 'Only this plan’s admins can do that.');
  return plan;
}
async function groupPlansAdminedBy(env, uid) {
  const plans = await runFirestoreQuery(env, {
    from: [{ collectionId: 'groupPlans' }],
    where: { fieldFilter: { field: { fieldPath: 'adminUids' }, op: 'ARRAY_CONTAINS', value: { stringValue: uid } } },
    limit: 50,
  });
  return plans.filter(p => p.status !== 'deleted');
}
// An invite code (from the link), or a club's code when the plan was started
// for that club, so its members can take a seat from the club invite.
async function findPlanForInvite(env, { code, orgCode }) {
  if (code) {
    const clean = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length !== 8) return null;
    const invite = await readFirestoreDoc(env, 'groupInvites', clean);
    const plan = invite?.planId ? await readFirestoreDoc(env, 'groupPlans', invite.planId) : null;
    return plan && plan.status !== 'deleted' && plan.inviteCode === clean ? { ...plan, id: invite.planId } : null;
  }
  if (/^[A-Za-z0-9]{6}$/.test(String(orgCode || ''))) {
    const plans = await runFirestoreQuery(env, {
      from: [{ collectionId: 'groupPlans' }],
      where: { fieldFilter: { field: { fieldPath: 'orgCode' }, op: 'EQUAL', value: { stringValue: String(orgCode) } } },
      limit: 10,
    });
    return plans.find(p => groupHasAccess(p.status)) || null;
  }
  return null;
}

async function groupMine(env, ctx) {
  const [plans, license] = await Promise.all([groupPlansAdminedBy(env, ctx.uid), readFirestoreDoc(env, 'licenses', ctx.uid)]);
  return {
    plans: plans.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(p => groupPlanSummary(env, p)),
    seat: license?.groupPlanId ? { planId: license.groupPlanId, name: license.groupName || '', active: !!license.groupPaid } : null,
    individualPaid: individualPaidOf(license),
  };
}
async function groupDetails(env, ctx) {
  const plan = await loadAdminPlan(env, ctx);
  const members = await listFirestoreCollection(env, `groupPlans/${plan.id}/members`);
  // Keeps the seat count honest if a step ever failed partway.
  if (members.length !== (plan.memberCount || 0)) {
    plan.memberCount = members.length;
    await patchFirestoreDoc(env, `groupPlans/${plan.id}`, { memberCount: members.length });
  }
  const adminUids = plan.adminUids || [];
  return {
    plan: groupPlanSummary(env, plan),
    members: members
      .map(m => ({ uid: m.id, name: m.name || '', email: m.email || '', joinedAt: m.joinedAt || '', admin: adminUids.includes(m.id) }))
      .sort((a, b) => String(a.joinedAt).localeCompare(String(b.joinedAt))),
    you: { uid: ctx.uid, hasSeat: members.some(m => m.id === ctx.uid) },
  };
}

async function groupCreateCheckout(env, ctx) {
  const { body } = ctx;
  const name = cleanGroupText(body.name, 80);
  if (!name) throw new HttpError(400, 'Give your group a name.');
  const kind = GROUP_KINDS.includes(body.kind) ? body.kind : 'club';
  const seats = Math.round(Number(body.seats));
  if (!(seats >= GROUP_MIN_SEATS && seats <= GROUP_MAX_SEATS)) throw new HttpError(400, `Choose between ${GROUP_MIN_SEATS} and ${GROUP_MAX_SEATS} seats.`);
  // Linking a plan to a club is for that club's officers only.
  let orgCode = '';
  if (body.orgCode) {
    const code = String(body.orgCode);
    const org = /^[A-Za-z0-9]{6}$/.test(code) ? await readFirestoreDoc(env, 'orgs', code) : null;
    if (!org || !(org.officerUids || []).includes(ctx.uid)) throw new HttpError(403, 'Only that club’s officers can start a plan for it.');
    orgCode = code;
  }
  let planId = body.planId ? String(body.planId) : '';
  if (planId) {
    const plan = await loadAdminPlan(env, ctx);
    if (plan.status !== 'pending') throw new HttpError(400, 'This plan is already set up. Change its seats from the plan page instead.');
    await patchFirestoreDoc(env, `groupPlans/${planId}`, { name, kind, requestedSeats: seats, updatedAt: new Date(), ...(orgCode ? { orgCode } : {}) });
  } else {
    const unfinished = (await groupPlansAdminedBy(env, ctx.uid)).filter(p => p.status === 'pending');
    if (unfinished.length >= 3) throw new HttpError(429, 'Finish or delete one of your unfinished plans first.');
    planId = randomToken(20);
    const now = new Date();
    await patchFirestoreDoc(env, `groupPlans/${planId}`, {
      name, kind, orgCode, status: 'pending', seats: 0, requestedSeats: seats, memberCount: 0, inviteCode: '',
      ownerUid: ctx.uid, adminUids: [ctx.uid], adminsJson: JSON.stringify([{ uid: ctx.uid, email: ctx.email, name: ctx.name }]),
      stripeCustomerId: '', stripeSubscriptionId: '', stripeItemId: '', createdAt: now, updatedAt: now,
    });
  }
  const back = groupAdminUrl(env, planId);
  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('submit_type', 'subscribe');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][unit_amount]', String(GROUP_SEAT_PRICE_CENTS));
  params.set('line_items[0][price_data][recurring][interval]', 'month');
  params.set('line_items[0][price_data][product_data][name]', 'Semester HQ group plan');
  params.set('line_items[0][price_data][product_data][description]', `Semester HQ Plus for each member of ${name}, billed per member each month. Add or remove seats anytime.`);
  params.set('line_items[0][price_data][product_data][images][0]', 'https://semester-hq.com/assets/icon-512.png');
  params.set('line_items[0][quantity]', String(seats));
  params.set('line_items[0][adjustable_quantity][enabled]', 'true');
  params.set('line_items[0][adjustable_quantity][minimum]', String(GROUP_MIN_SEATS));
  params.set('line_items[0][adjustable_quantity][maximum]', String(GROUP_MAX_SEATS));
  params.set('success_url', `${back}&checkout=success`);
  params.set('cancel_url', `${back}&checkout=cancel`);
  params.set('allow_promotion_codes', 'true');
  params.set('client_reference_id', ctx.uid);
  if (ctx.email) params.set('customer_email', ctx.email);
  params.set('metadata[kind]', 'group');
  params.set('metadata[planId]', planId);
  params.set('subscription_data[metadata][kind]', 'group');
  params.set('subscription_data[metadata][planId]', planId);
  params.set('subscription_data[metadata][adminUid]', ctx.uid);
  const res = await stripeRequest(env, 'POST', '/v1/checkout/sessions', params);
  if (!res.ok) throw new HttpError(502, 'Could not start checkout: ' + (res.data.error?.message || 'unknown error'));
  return { url: res.data.url, planId };
}
// Webhook: checkout finished, so the plan goes live with the seats bought.
// A plan deleted while its checkout tab was still open comes back, since
// it was paid for.
async function activateGroupPlan(env, session) {
  const planId = session.metadata?.planId;
  const plan = planId ? await readFirestoreDoc(env, 'groupPlans', planId) : null;
  if (!plan) { await logServerIssue(env, 'group-plans', 'Group checkout for an unknown plan', null, { planId }); return; }
  const sub = session.subscription ? (await stripeRequest(env, 'GET', `/v1/subscriptions/${session.subscription}`)).data : null;
  const item = sub?.items?.data?.[0];
  const status = sub?.status ? groupStatusFromStripe(sub.status) : 'active';
  await patchFirestoreDoc(env, `groupPlans/${planId}`, {
    status, seats: item?.quantity || plan.requestedSeats || GROUP_MIN_SEATS,
    inviteCode: plan.inviteCode || await createGroupInvite(env, planId),
    stripeCustomerId: session.customer || '', stripeSubscriptionId: session.subscription || '', stripeItemId: item?.id || '',
    activatedAt: new Date(), updatedAt: new Date(),
  });
}
// Webhook: renewals, seat changes made in Stripe, failed payments, cancellation.
async function syncGroupPlan(env, sub, deleted) {
  const planId = sub.metadata?.planId;
  const plan = planId ? await readFirestoreDoc(env, 'groupPlans', planId) : null;
  if (!plan) return;
  const status = deleted ? 'canceled' : groupStatusFromStripe(sub.status);
  if (plan.status === 'pending' && status === 'pending') return;
  const item = sub.items?.data?.[0];
  const periodEnd = sub.current_period_end || item?.current_period_end;
  await patchFirestoreDoc(env, `groupPlans/${planId}`, {
    status, seats: item?.quantity ?? plan.seats ?? 0,
    stripeSubscriptionId: sub.id, stripeCustomerId: sub.customer || plan.stripeCustomerId || '', stripeItemId: item?.id || plan.stripeItemId || '',
    cancelAtPeriodEnd: !!sub.cancel_at_period_end, currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : '', updatedAt: new Date(),
    ...(groupHasAccess(status) && !plan.inviteCode ? { inviteCode: await createGroupInvite(env, planId) } : {}),
  });
  if (groupHasAccess(plan.status) !== groupHasAccess(status)) await setGroupMembersAccess(env, { ...plan, id: planId }, groupHasAccess(status));
}
async function createGroupInvite(env, planId) {
  for (let i = 0; i < 6; i++) {
    const code = randomToken(8, GROUP_INVITE_CHARS);
    if (await commitFirestore(env, [{ path: `groupInvites/${code}`, fields: { planId, createdAt: new Date() }, exists: false }])) return code;
  }
  throw new Error('Could not create an invite code');
}

async function groupJoinInfo(env, body) {
  const plan = await findPlanForInvite(env, body);
  if (!plan) throw new HttpError(404, 'That invite link isn’t valid anymore. Ask your group’s admin for a new one.');
  return { name: plan.name || '', kind: plan.kind || 'club', active: groupHasAccess(plan.status), seatsLeft: Math.max(0, (plan.seats || 0) - (plan.memberCount || 0)) };
}
async function groupJoin(env, ctx) {
  // An admin taking a seat on their own plan doesn't need the invite.
  const plan = ctx.body.planId ? await loadAdminPlan(env, ctx) : await findPlanForInvite(env, ctx.body);
  if (!plan) throw new HttpError(404, 'That invite link isn’t valid anymore. Ask your group’s admin for a new one.');
  if (!groupHasAccess(plan.status)) throw new HttpError(403, `${plan.name}’s group plan isn’t active right now. Ask the person who runs it.`);
  const license = await readFirestoreDoc(env, 'licenses', ctx.uid);
  // One group seat at a time: joining a new plan gives up the old seat.
  if (license?.groupPlanId && license.groupPlanId !== plan.id) await removeGroupMember(env, license.groupPlanId, ctx.uid);
  const added = await claimGroupSeat(env, plan.id, ctx);
  await setLicenseSeat(env, ctx.uid, license, { planId: plan.id, name: plan.name, active: true });
  return { joined: true, already: !added, name: plan.name, individualPaid: individualPaidOf(license) };
}
// The seat count only moves if nobody else changed the plan since it was
// read (a Firestore precondition), so two people can't take the last seat.
async function claimGroupSeat(env, planId, ctx) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await readFirestoreDoc(env, `groupPlans/${planId}/members`, ctx.uid)) return false;
    const snap = await readFirestoreDocWithTime(env, `groupPlans/${planId}`);
    const plan = snap?.data;
    if (!plan || !groupHasAccess(plan.status)) throw new HttpError(403, 'This group plan isn’t active right now.');
    if ((plan.memberCount || 0) >= (plan.seats || 0)) throw new HttpError(409, `Every seat in ${plan.name}’s plan is taken. Ask the person who runs it to add one.`, { reason: 'full' });
    const ok = await commitFirestore(env, [
      { path: `groupPlans/${planId}`, fields: { memberCount: (plan.memberCount || 0) + 1, updatedAt: new Date() }, updateTime: snap.updateTime },
      { path: `groupPlans/${planId}/members/${ctx.uid}`, fields: { email: ctx.email, name: ctx.name, joinedAt: new Date() }, exists: false },
    ]);
    if (ok) return true;
  }
  throw new HttpError(503, 'A lot of people are joining right now. Try again in a moment.');
}
async function removeGroupMember(env, planId, uid) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (!(await readFirestoreDoc(env, `groupPlans/${planId}/members`, uid))) return false;
    const snap = await readFirestoreDocWithTime(env, `groupPlans/${planId}`);
    if (!snap) { await deleteFirestoreDoc(env, `groupPlans/${planId}/members`, uid); return true; }
    const ok = await commitFirestore(env, [
      { path: `groupPlans/${planId}`, fields: { memberCount: Math.max(0, (snap.data.memberCount || 0) - 1), updatedAt: new Date() }, updateTime: snap.updateTime },
      { path: `groupPlans/${planId}/members/${uid}`, remove: true },
    ]);
    if (ok) return true;
  }
  throw new HttpError(503, 'Couldn’t update the plan right now. Try again in a moment.');
}
async function setLicenseSeat(env, uid, license, { planId = '', name = '', active = false }) {
  const individualPaid = individualPaidOf(license);
  await patchFirestoreDoc(env, `licenses/${uid}`, { individualPaid, groupPlanId: planId, groupName: name, groupPaid: active, paid: individualPaid || active, updatedAt: new Date() });
}
// Turns a whole plan's seats on or off (payment recovered or failed for
// good, or a rename), a few hundred licenses per Firestore round trip.
async function setGroupMembersAccess(env, plan, active) {
  const members = await listFirestoreCollection(env, `groupPlans/${plan.id}/members`);
  for (let i = 0; i < members.length; i += 200) {
    const chunk = members.slice(i, i + 200);
    const licenses = await batchGetFirestoreDocs(env, chunk.map(m => `licenses/${m.id}`));
    const writes = chunk
      .filter(m => { const l = licenses[`licenses/${m.id}`]; return !l?.groupPlanId || l.groupPlanId === plan.id; })
      .map(m => {
        const individualPaid = individualPaidOf(licenses[`licenses/${m.id}`]);
        return { path: `licenses/${m.id}`, fields: { individualPaid, groupPlanId: plan.id, groupName: plan.name || '', groupPaid: active, paid: individualPaid || active, updatedAt: new Date() } };
      });
    if (writes.length) await commitFirestore(env, writes);
  }
}
async function groupLeave(env, ctx) {
  const license = await readFirestoreDoc(env, 'licenses', ctx.uid);
  if (!license?.groupPlanId) return { left: false, paid: individualPaidOf(license) };
  await removeGroupMember(env, license.groupPlanId, ctx.uid);
  await setLicenseSeat(env, ctx.uid, license, {});
  return { left: true, paid: individualPaidOf(license) };
}

async function groupRemoveMember(env, ctx) {
  const plan = await loadAdminPlan(env, ctx);
  const target = String(ctx.body.uid || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(target)) throw new HttpError(400, 'Pick someone to remove.');
  await removeGroupMember(env, plan.id, target);
  const license = await readFirestoreDoc(env, 'licenses', target);
  if (license?.groupPlanId === plan.id) await setLicenseSeat(env, target, license, {});
  return groupDetails(env, ctx);
}
async function groupSetAdmin(env, ctx) {
  const plan = await loadAdminPlan(env, ctx);
  const target = String(ctx.body.uid || '');
  let admins = groupAdmins(plan);
  if (ctx.body.admin) {
    if (admins.some(a => a.uid === target)) return groupDetails(env, ctx);
    const member = /^[A-Za-z0-9_-]{1,128}$/.test(target) ? await readFirestoreDoc(env, `groupPlans/${plan.id}/members`, target) : null;
    if (!member) throw new HttpError(400, 'Only someone with a seat can be made an admin.');
    if (admins.length >= 10) throw new HttpError(400, 'A plan can have up to 10 admins.');
    admins = [...admins, { uid: target, email: member.email || '', name: member.name || '' }];
  } else {
    if (admins.length <= 1) throw new HttpError(400, 'A plan needs at least one admin.');
    admins = admins.filter(a => a.uid !== target);
  }
  await setGroupAdmins(env, plan, admins);
  if (target === ctx.uid && !ctx.body.admin) return { removedSelf: true };
  return groupDetails(env, ctx);
}
async function setGroupAdmins(env, plan, admins) {
  await patchFirestoreDoc(env, `groupPlans/${plan.id}`, { adminUids: admins.map(a => a.uid), adminsJson: JSON.stringify(admins), updatedAt: new Date() });
}
async function groupRename(env, ctx) {
  const plan = await loadAdminPlan(env, ctx);
  const name = cleanGroupText(ctx.body.name, 80);
  if (!name) throw new HttpError(400, 'Give your group a name.');
  await patchFirestoreDoc(env, `groupPlans/${plan.id}`, { name, updatedAt: new Date() });
  if (groupHasAccess(plan.status)) await setGroupMembersAccess(env, { ...plan, name }, true);
  return groupDetails(env, ctx);
}
async function groupResetInvite(env, ctx) {
  const plan = await loadAdminPlan(env, ctx);
  if (!groupHasAccess(plan.status)) throw new HttpError(400, 'Invite links work once the plan is active.');
  const code = await createGroupInvite(env, plan.id);
  await patchFirestoreDoc(env, `groupPlans/${plan.id}`, { inviteCode: code, updatedAt: new Date() });
  if (plan.inviteCode) await deleteFirestoreDoc(env, 'groupInvites', plan.inviteCode);
  return groupDetails(env, ctx);
}
async function groupSetSeats(env, ctx) {
  const plan = await loadAdminPlan(env, ctx);
  if (!groupHasAccess(plan.status) || !plan.stripeSubscriptionId) throw new HttpError(400, 'Seats can be changed once the plan is active.');
  const seats = Math.round(Number(ctx.body.seats));
  if (!(seats >= GROUP_MIN_SEATS && seats <= GROUP_MAX_SEATS)) throw new HttpError(400, `Choose between ${GROUP_MIN_SEATS} and ${GROUP_MAX_SEATS} seats.`);
  // Counted from the members themselves, not the running total, so a count
  // that ever drifted can't let a plan drop below the people using it.
  const memberCount = (await listFirestoreCollection(env, `groupPlans/${plan.id}/members`)).length;
  if (seats < memberCount) throw new HttpError(400, `${memberCount} ${memberCount === 1 ? 'person has a seat' : 'people have seats'}. Remove someone before going below that.`);
  let itemId = plan.stripeItemId;
  if (!itemId) itemId = (await stripeRequest(env, 'GET', `/v1/subscriptions/${plan.stripeSubscriptionId}`)).data?.items?.data?.[0]?.id;
  if (!itemId) throw new HttpError(502, 'Couldn’t find this plan’s subscription in Stripe.');
  // Stripe prorates the change onto the next bill.
  const res = await stripeRequest(env, 'POST', `/v1/subscription_items/${itemId}`, new URLSearchParams({ quantity: String(seats), proration_behavior: 'create_prorations' }));
  if (!res.ok) throw new HttpError(502, 'Stripe couldn’t change the seats: ' + (res.data.error?.message || 'unknown error'));
  await patchFirestoreDoc(env, `groupPlans/${plan.id}`, { seats, stripeItemId: itemId, updatedAt: new Date() });
  return groupDetails(env, ctx);
}
async function groupPortal(env, ctx) {
  const plan = await loadAdminPlan(env, ctx);
  if (!plan.stripeCustomerId) throw new HttpError(400, 'This plan doesn’t have billing yet. Finish checkout first.');
  try { return { url: await createStripePortalSession(env, plan.stripeCustomerId, groupAdminUrl(env, plan.id)) }; }
  catch (e) { throw new HttpError(502, 'Could not open billing: ' + e.message); }
}
// Only a plan that never finished checkout. Kept as 'deleted' rather than
// erased, so a checkout that completes afterward still finds it.
async function groupDeletePending(env, ctx) {
  const plan = await loadAdminPlan(env, ctx);
  if (plan.status !== 'pending') throw new HttpError(400, 'Only a plan that never finished checkout can be deleted. Cancel an active plan from Billing.');
  await patchFirestoreDoc(env, `groupPlans/${plan.id}`, { status: 'deleted', updatedAt: new Date() });
  return { deleted: true };
}

async function stripeRequest(env, method, path, params) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(params ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: params ? params.toString() : undefined,
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

/* ── Firebase ID token verification (manual, no Admin SDK in Workers) ─
   Mirrors what the Admin SDK does: check standard claims, then verify the
   RS256 signature against Google's public JWK set for Firebase Auth. ─── */
async function verifyFirebaseIdToken(idToken, projectId) {
  const [headerB64, payloadB64, sigB64] = String(idToken || '').split('.');
  if (!headerB64 || !payloadB64 || !sigB64) throw new Error('Malformed token');
  const header = JSON.parse(atob(base64urlToBase64(headerB64)));
  const payload = JSON.parse(atob(base64urlToBase64(payloadB64)));
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) throw new Error('Unexpected token header');
  if (payload.aud !== projectId) throw new Error('Bad audience');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Bad issuer');
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('Expired');
  if (typeof payload.iat !== 'number' || payload.iat > now + 300) throw new Error('Issued in the future');
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) throw new Error('No subject');

  // Google rotates these keys; they are cached for as long as Google says
  // and fetched again once when a token names a key that isn't cached.
  let jwk = (await googleSigningKeys()).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await googleSigningKeys(true)).find(k => k.kid === header.kid);
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
// Reused for most of the hour it's good for: without this, every Firestore
// call signed a new JWT and fetched a new token, doubling the requests a
// group plan update makes (and Workers cap subrequests per invocation).
let _firebaseToken = { value: '', expiresAt: 0 };
async function getFirebaseAccessToken(env) {
  if (_firebaseToken.value && Date.now() < _firebaseToken.expiresAt) return _firebaseToken.value;
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
    // datastore covers Firestore reads/writes; identitytoolkit is needed
    // only for handleDeleteAccount's Auth-user deletion step.
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/devstorage.read_write',
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
  _firebaseToken = { value: data.access_token, expiresAt: Date.now() + 50 * 60 * 1000 };
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
// Same as readFirestoreDoc, plus when the doc last changed, for a write that
// should only land if nobody has changed it since (see commitFirestore).
async function readFirestoreDocWithTime(env, path) {
  const token = await getFirebaseAccessToken(env);
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Firestore read failed: ' + await res.text());
  const doc = await res.json();
  return { data: fromFirestoreFields(doc.fields || {}), updateTime: doc.updateTime };
}
async function batchGetFirestoreDocs(env, paths) {
  const out = {};
  if (!paths.length) return out;
  const token = await getFirebaseAccessToken(env);
  const root = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const res = await fetch(`https://firestore.googleapis.com/v1/${root}:batchGet`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ documents: paths.map(p => `${root}/${p}`) }),
  });
  if (!res.ok) throw new Error('Firestore batch read failed: ' + await res.text());
  for (const row of await res.json()) {
    if (row.found) out[row.found.name.slice(root.length + 1)] = fromFirestoreFields(row.found.fields || {});
    else if (row.missing) out[row.missing.slice(root.length + 1)] = null;
  }
  return out;
}
// Writes that all land or none do. Each is { path, fields } (only those
// fields change) or { path, remove: true }, optionally with exists (true or
// false) or updateTime as a condition. Resolves false when a condition
// didn't hold, so the caller can re-read and try again.
async function commitFirestore(env, writes) {
  const token = await getFirebaseAccessToken(env);
  const root = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const body = {
    writes: writes.map(w => {
      const name = `${root}/${w.path}`;
      const condition = typeof w.exists === 'boolean' ? { currentDocument: { exists: w.exists } } : w.updateTime ? { currentDocument: { updateTime: w.updateTime } } : {};
      if (w.remove) return { delete: name, ...condition };
      // `clear` names field paths to delete (e.g. one key of a map, like
      // `people.abc123`): in the mask but absent from fields, which is how
      // Firestore is told to remove just that key. Rewriting the whole map
      // instead would mean decoding and re-encoding every other member's
      // entry, and anything this Worker's decoder doesn't model — a null,
      // say — would silently vanish from their data.
      const fields = w.fields || {};
      const paths = [...Object.keys(fields), ...(w.clear || [])];
      return { update: { name, fields: toFirestoreFields(fields) }, updateMask: { fieldPaths: paths }, ...condition };
    }),
  };
  const res = await fetch(`https://firestore.googleapis.com/v1/${root}:commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (res.ok) return true;
  const text = await res.text();
  if (/FAILED_PRECONDITION|ALREADY_EXISTS|ABORTED|NOT_FOUND/.test(text)) return false;
  throw new Error('Firestore commit failed: ' + text);
}
async function listFirestoreCollection(env, path) {
  const token = await getFirebaseAccessToken(env);
  const base = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
  const docs = [];
  let pageToken = '';
  for (let page = 0; page < 20; page++) {
    const res = await fetch(`${base}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Firestore list failed: ' + await res.text());
    const data = await res.json();
    for (const d of data.documents || []) docs.push({ id: d.name.split('/').pop(), ...fromFirestoreFields(d.fields || {}) });
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return docs;
}
async function deleteFirestoreDoc(env, collection, docId) {
  const token = await getFirebaseAccessToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
  const res = await fetch(url, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
  if (!res.ok && res.status !== 404) throw new Error('Firestore delete failed: ' + await res.text());
}
// Firestore never cascade-deletes a subcollection when its parent document
// is deleted; has to be done by hand: list every doc, delete each one,
// page through if there are more than one page's worth.
async function deleteFirestoreSubcollection(env, parentPath, subcollectionId) {
  const token = await getFirebaseAccessToken(env);
  const base = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${parentPath}/${subcollectionId}`;
  let pageToken = '';
  for (;;) {
    const url = `${base}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Firestore list failed: ' + await res.text());
    const data = await res.json();
    const docs = data.documents || [];
    await Promise.all(docs.map(d => fetch(`https://firestore.googleapis.com/v1/${d.name}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
}
async function deleteFirebaseAuthUser(env, uid) {
  const token = await getFirebaseAccessToken(env);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts:delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ localId: uid }),
  });
  if (!res.ok) throw new Error('Identity Toolkit delete failed: ' + await res.text());
}
// `parent` scopes the query to a document's subcollections (e.g. the messages
// under one study group); omitted, it queries the top level.
async function runFirestoreQuery(env, structuredQuery, parent = '') {
  const token = await getFirebaseAccessToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents${parent ? `/${parent}` : ''}:runQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) throw new Error('Firestore query failed: ' + await res.text());
  const rows = await res.json();
  return rows
    .filter(r => r.document)
    .map(r => ({ id: r.document.name.split('/').pop(), ...fromFirestoreFields(r.document.fields || {}) }));
}
async function queryRecentDocs(env, collectionId, limit) {
  return runFirestoreQuery(env, {
    from: [{ collectionId }],
    orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
    limit,
  });
}
async function queryRecentErrors(env, limit) {
  return queryRecentDocs(env, 'errors', limit);
}
function toFirestoreValue(v) {
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { integerValue: String(Math.trunc(v)) };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (v && typeof v === 'object') return { mapValue: { fields: toFirestoreFields(v) } };
  return { stringValue: String(v) };
}
function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = toFirestoreValue(v);
  return fields;
}
function fromFirestoreValue(v) {
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFirestoreValue).filter(x => x !== undefined);
  if ('mapValue' in v) return fromFirestoreFields(v.mapValue.fields || {});
  return undefined;
}
function fromFirestoreFields(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields)) {
    const value = fromFirestoreValue(v);
    if (value !== undefined) obj[k] = value;
  }
  return obj;
}
function encodeEmailDocId(email) { return email.replace(/[^a-zA-Z0-9@._-]/g, '_'); }

/* ── Rate limiting (KV, fixed 1-minute window per IP+route) ─────
   No RATE_LIMIT KV bound → limiting is skipped (e.g. local `wrangler dev`)
   rather than failing closed, so local development isn't blocked. ──── */
async function checkRateLimit(env, ip, routeKey, limit) {
  // Cloudflare's own rate limiter when one is bound (atomic, and free of
  // KV's one-write-per-second-per-key rule, which used to turn a busy campus
  // network into 500s). See wrangler.toml. KV is the fallback, and a
  // limiter hiccup lets the request through: every route still validates.
  const native = pickRateLimiter(env, limit);
  if (native) {
    try { const { success } = await native.limit({ key: `${routeKey}:${ip}` }); return success; } catch {}
  }
  if (!env.RATE_LIMIT) return true;
  const bucket = Math.floor(Date.now() / 60000);
  const key = `${routeKey}:${ip}:${bucket}`;
  try {
    const current = Number(await env.RATE_LIMIT.get(key)) || 0;
    if (current >= limit) return false;
    await env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: 120 });
  } catch {}
  return true;
}
// Native limiters come in three sizes; a route takes the smallest one that
// is at least its limit. No bindings means KV.
function pickRateLimiter(env, limit) {
  const tiers = [[5, env.RL_TIGHT], [20, env.RL_NORMAL], [60, env.RL_LOOSE]];
  const tier = tiers.find(([size, binding]) => binding && typeof binding.limit === 'function' && size >= limit);
  return tier ? tier[1] : null;
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
function jsonError(message, status, env, origin, extra = {}) {
  return new Response(JSON.stringify({ ...extra, error: message }), { status, headers: corsHeaders(env, origin, { 'content-type': 'application/json' }) });
}

/* ── Small shared guards ─────────────────────────────────────── */
// The email on a Firebase token is only trustworthy when Firebase verified
// it. Google and email-link sign-in both do, so this changes nothing today;
// it matters the day another sign-in method is switched on.
function verifiedEmailOf(payload) {
  if (!payload || payload.email_verified !== true) return '';
  return String(payload.email || '').toLowerCase().trim();
}
// Global ceilings for the anonymous routes, in KV, best effort: a KV hiccup
// lets the write through rather than dropping a real report.
async function underCap(env, key, cap, ttlSeconds) {
  if (!env.RATE_LIMIT) return true;
  try {
    const used = Number(await env.RATE_LIMIT.get(key)) || 0;
    if (used >= cap) return false;
    await env.RATE_LIMIT.put(key, String(used + 1), { expirationTtl: ttlSeconds });
  } catch {}
  return true;
}
function underDailyCap(env, name, cap) { return underCap(env, `cap:${name}:${new Date().toISOString().slice(0, 10)}`, cap, 60 * 60 * 48); }
function underHourlyCap(env, name, cap) { return underCap(env, `cap:${name}:h${Math.floor(Date.now() / 3600000)}`, cap, 60 * 60 * 2); }
// Cloudflare Turnstile, on only once TURNSTILE_SECRET is set (wrangler secret
// put) and the site renders the widget. Until then this is a no-op, so the
// forms keep working while the widget is being created.
//
// The hostname check matters. siteverify's `success` only says the token is a
// real, unused solve for this site key; it does not say where it was solved.
// The site key is public, so without this anyone could host their own page,
// solve the challenge there, and replay the token here. Only the hostnames
// this product actually serves are accepted. Note the deliberate absence of
// localhost: adding it to the widget in the dashboard would hand out exactly
// that bypass to anyone running a page on their own machine.
const TURNSTILE_HOSTS = new Set(['semester-hq.com', 'www.semester-hq.com', 'app.semester-hq.com']);
async function turnstileOk(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token || typeof token !== 'string') return false;
  try {
    const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token.slice(0, 2048), remoteip: ip });
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const data = await res.json();
    if (data.success !== true) return false;
    return typeof data.hostname === 'string' && TURNSTILE_HOSTS.has(data.hostname);
  } catch { return false; }
}
// Stripe retries until it sees a 2xx and can deliver an event twice. The
// handlers are idempotent, but a late duplicate could rewrite state with
// older facts, so each event id is handled once (KV, best effort).
async function claimWebhookEvent(env, id) {
  if (!env.RATE_LIMIT) return true;
  const key = `stripe-evt:${String(id).slice(0, 80)}`;
  try {
    if (await env.RATE_LIMIT.get(key)) return false;
    await env.RATE_LIMIT.put(key, '1', { expirationTtl: 60 * 60 * 72 });
  } catch {}
  return true;
}
// Bearer token compared in constant time, with a per-IP brake on wrong
// guesses. The token is long and random, so the brake is belt and braces.
async function adminTokenOk(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = `cap:admin401:${ip}:h${Math.floor(Date.now() / 3600000)}`;
  try { if (env.RATE_LIMIT && (Number(await env.RATE_LIMIT.get(key)) || 0) >= 20) return false; } catch {}
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (token && timingSafeEqual(token, env.ADMIN_TOKEN)) return true;
  await underCap(env, key, 1000, 7200);
  return false;
}
// Google's public keys for Firebase ID tokens, cached for as long as Google
// allows (capped at six hours) instead of fetched on every single check.
let _googleJwks = { keys: [], expiresAt: 0 };
async function googleSigningKeys(forceRefresh = false) {
  if (!forceRefresh && _googleJwks.keys.length && Date.now() < _googleJwks.expiresAt) return _googleJwks.keys;
  const res = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if (!res.ok) throw new Error(`Could not fetch signing keys (${res.status})`);
  const { keys } = await res.json();
  const maxAge = Number((res.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1]) || 3600;
  _googleJwks = { keys: Array.isArray(keys) ? keys : [], expiresAt: Date.now() + Math.min(maxAge, 6 * 3600) * 1000 };
  return _googleJwks.keys;
}
// Deletes every object under a prefix in the project's Storage bucket, using
// the same service account as Firestore (the token carries the storage scope).
async function deleteStorageFolder(env, prefix) {
  const bucket = env.FIREBASE_STORAGE_BUCKET;
  if (!bucket) return 0;
  const token = await getFirebaseAccessToken(env);
  const base = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`;
  let deleted = 0, pageToken = '';
  do {
    const listUrl = `${base}?prefix=${encodeURIComponent(prefix)}&fields=items(name),nextPageToken&maxResults=500${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(listUrl, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Storage list ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    for (const item of data.items || []) {
      const del = await fetch(`${base}/${encodeURIComponent(item.name)}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
      if (!del.ok && del.status !== 404) throw new Error(`Storage delete ${del.status}`);
      deleted++;
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return deleted;
}
// The age and terms checkbox lives in the browser. This records, on the
// account, that it was ticked and which terms were current, so the fact
// survives a cleared browser. It writes only to the license document the
// Worker already owns; nothing here grants access.
const TERMS_VERSION = '2026-09-19';
async function handleAccountAttest(request, env, origin) {
  if (!env.FIREBASE_PROJECT_ID) return jsonError('Server misconfigured: FIREBASE_PROJECT_ID not set.', 500, env, origin);
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env, origin); }
  if (!body.idToken) return jsonError('Missing idToken', 400, env, origin);
  let payload;
  try { payload = await verifyFirebaseIdToken(body.idToken, env.FIREBASE_PROJECT_ID); }
  catch { return jsonError('Your session expired, sign in again.', 401, env, origin); }
  if (body.ageConfirmed !== true) return jsonError('Confirm your age and the terms first.', 400, env, origin);
  try {
    const existing = await readFirestoreDoc(env, 'licenses', payload.sub);
    if (!existing?.termsAcceptedAt || existing.termsVersion !== TERMS_VERSION) {
      await patchFirestoreDoc(env, `licenses/${payload.sub}`, { termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION, ageConfirmed: true });
    }
    return jsonOk({ ok: true, termsVersion: TERMS_VERSION }, env, origin);
  } catch (e) {
    await logServerIssue(env, 'account', 'Could not record the terms acceptance', e);
    return jsonError('Could not save that right now.', 500, env, origin);
  }
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

/* ── 10. What the business did while you weren't looking ────────────
   Once a day this looks at Stripe, the contact form and the crash
   reports, and writes down anything worth a founder's attention:
   someone subscribed, a payment failed, a message went unanswered,
   the week's numbers. The Business OS picks these up when it opens and
   turns them into to-dos, so the list fills itself in whether or not
   the laptop was ever switched on.

   Each event has a key that already contains its date, so a day that
   runs twice writes the same key twice and Firestore keeps the first —
   an event you've already ticked off never comes back. Events are
   written by this Worker's service account, which is why nothing here
   needs a change to the Firestore rules.
──────────────────────────────────────────────────────────────── */
const BIZ_EVENT_STATE = 'bizState/events';
const BIZ_EVENTS = 'bizEvents';

function ymd(ts) { return new Date(ts).toISOString().slice(0, 10); }
function plural(n, one, many) { return `${n} ${n === 1 ? one : many || one + 's'}`; }

async function buildBusinessEvents(env) {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) return;
  const now = Date.now();
  const day = ymd(now);
  const state = (await readFirestoreDoc(env, 'bizState', 'events').catch(() => null)) || {};
  const events = [];
  const add = (key, e) => events.push({ key, ...e });

  let stripe = null;
  if (env.STRIPE_SECRET_KEY) {
    try { stripe = await fetchStripeSummary(env); } catch (e) { stripe = null; }
  }

  if (stripe) {
    const lastPaying = Number(state.payingCount ?? stripe.payingCount);
    const gained = stripe.payingCount - lastPaying;
    if (gained > 0) {
      add(`subs-up-${day}`, {
        kind: 'subscriber', area: 'Sales & Partnerships', priority: 'Medium',
        title: `${plural(gained, 'new paying subscriber')} since yesterday`,
        detail: `Now ${plural(stripe.payingCount, 'paying subscriber')}, $${(stripe.netMrrCents / 100).toFixed(2)} net MRR. Worth a thank-you note or asking them how they found you.`,
      });
    }
    if (gained < 0) {
      add(`subs-down-${day}`, {
        kind: 'churn', area: 'Sales & Partnerships', priority: 'High',
        title: `${plural(-gained, 'subscriber')} left since yesterday`,
        detail: `Down to ${plural(stripe.payingCount, 'paying subscriber')}. Ask why while it's fresh — that answer is worth more than the seat.`,
      });
    }
    if (stripe.pastDueCount > 0) {
      add(`past-due-${day}`, {
        kind: 'billing', area: 'Finance & Legal', priority: 'High',
        title: `${plural(stripe.pastDueCount, 'payment')} failing right now`,
        detail: 'Stripe retries on its own, but a card that has expired never recovers without an email. They keep access while past due.',
      });
    }
    if (stripe.cancelingCount > 0 && stripe.cancelingCount !== Number(state.cancelingCount ?? -1)) {
      add(`canceling-${day}`, {
        kind: 'churn', area: 'Sales & Partnerships', priority: 'Medium',
        title: `${plural(stripe.cancelingCount, 'subscription')} set to end at the period`,
        detail: 'They still have access, so there is time to ask what went wrong.',
      });
    }
    const newGroups = stripe.groupPlanCount - Number(state.groupPlanCount ?? stripe.groupPlanCount);
    if (newGroups > 0) {
      add(`group-${day}`, {
        kind: 'group', area: 'Sales & Partnerships', priority: 'Medium',
        title: `${plural(newGroups, 'new group plan')} started`,
        detail: `${plural(stripe.groupSeatCount, 'seat')} across ${plural(stripe.groupPlanCount, 'group plan')}. Check they invited their members — an unused plan cancels.`,
      });
    }
  }

  // Contact-form messages that have sat for more than a day.
  try {
    const feedback = await queryRecentDocs(env, 'feedback', 25);
    const stale = (Array.isArray(feedback) ? feedback : []).filter(f => {
      const at = Date.parse(f.createdAt || '');
      return at && now - at > 24 * 60 * 60 * 1000 && now - at < 14 * 24 * 60 * 60 * 1000;
    });
    if (stale.length) {
      add(`support-${day}`, {
        kind: 'support', area: 'Support', priority: 'High',
        title: `${plural(stale.length, 'message')} waiting more than a day`,
        detail: `Oldest is from ${new Date(Math.min(...stale.map(f => Date.parse(f.createdAt)))).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. Answering fast is the whole advantage of being one person.`,
      });
    }
  } catch {}

  // Crashes students actually hit.
  try {
    const errs = await fetchErrorSummary(env);
    if (errs?.count24h > 0) {
      add(`errors-${day}`, {
        kind: 'errors', area: 'Product', priority: errs.count24h > 5 ? 'High' : 'Medium',
        title: `${plural(errs.count24h, 'crash report')} in the last day`,
        detail: 'Open the Error Viewer and see whether it is one bug hitting repeatedly or several people.',
      });
    }
  } catch {}

  // Monday: the week in one line.
  if (new Date(now).getUTCDay() === 1 && stripe) {
    add(`weekly-${day}`, {
      kind: 'weekly', area: 'Operations', priority: 'Low',
      title: 'Where the week starts',
      detail: `${plural(stripe.payingCount, 'paying subscriber')} · $${(stripe.netMrrCents / 100).toFixed(2)} net MRR · ${plural(stripe.new7d, 'signup')} in 7 days · ${plural(stripe.canceled30d, 'cancellation')} in 30 days${stripe.groupPlanCount ? ` · ${plural(stripe.groupPlanCount, 'group plan')}` : ''}.`,
    });
  }

  if (events.length) {
    // exists:false so an event already read (or already ticked off) is never
    // written over — the commit simply reports it didn't apply.
    for (const e of events) {
      await commitFirestore(env, [{
        path: `${BIZ_EVENTS}/${e.key}`,
        exists: false,
        fields: { key: e.key, kind: e.kind, area: e.area, priority: e.priority, title: e.title, detail: e.detail, at: new Date(now).toISOString(), ackedAt: '' },
      }]).catch(() => false);
    }
  }

  await patchFirestoreDoc(env, BIZ_EVENT_STATE, {
    payingCount: stripe ? stripe.payingCount : (state.payingCount ?? 0),
    cancelingCount: stripe ? stripe.cancelingCount : (state.cancelingCount ?? 0),
    groupPlanCount: stripe ? stripe.groupPlanCount : (state.groupPlanCount ?? 0),
    lastRunAt: new Date(now).toISOString(),
  }).catch(() => {});
}

// GET /admin/biz-events — what the Business OS hasn't collected yet.
async function handleAdminBizEvents(request, env) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'content-type': 'application/json', 'X-Content-Type-Options': 'nosniff' };
  if (!env.ADMIN_TOKEN) return new Response(JSON.stringify({ error: 'Server misconfigured: ADMIN_TOKEN not set.' }), { status: 500, headers });
  if (!(await adminTokenOk(request, env))) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });

  if (request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch {}
    const keys = Array.isArray(body.keys) ? body.keys.filter(k => typeof k === 'string' && /^[\w.-]{1,120}$/.test(k)).slice(0, 50) : [];
    const at = new Date().toISOString();
    for (const key of keys) {
      await patchFirestoreDoc(env, `${BIZ_EVENTS}/${key}`, { ackedAt: at }).catch(() => {});
    }
    return new Response(JSON.stringify({ ok: true, acked: keys.length }), { headers });
  }

  try {
    const docs = await listFirestoreCollection(env, BIZ_EVENTS);
    const events = (docs || [])
      .filter(d => !d.ackedAt)
      .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
      .slice(0, 50);
    return new Response(JSON.stringify({ events }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
