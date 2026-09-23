/* ── worker/src/http.js ─────────────────────────────────────────
   The edges of every request: CORS and the origin allow-list, JSON
   replies, rate limits and daily caps, Turnstile, the admin token, and
   webhook de-duplication. No route lives here; it depends on nothing else.
──────────────────────────────────────────────────────────────── */

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ── Rate limiting (KV, fixed 1-minute window per IP+route) ─────
   No RATE_LIMIT KV bound → limiting is skipped (e.g. local `wrangler dev`)
   rather than failing closed, so local development isn't blocked. ──── */
export async function checkRateLimit(env, ip, routeKey, limit) {
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
export function isAllowedOrigin(env, origin) {
  const list = allowedOrigins(env);
  if (list.length === 0 || list.includes('*')) return true;
  return list.includes(origin);
}
export function corsHeaders(env, origin, extra = {}) {
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
export function jsonOk(obj, env, origin) {
  return new Response(JSON.stringify(obj), { headers: corsHeaders(env, origin, { 'content-type': 'application/json' }) });
}
export function jsonError(message, status, env, origin, extra = {}) {
  return new Response(JSON.stringify({ ...extra, error: message }), { status, headers: corsHeaders(env, origin, { 'content-type': 'application/json' }) });
}

/* ── Small shared guards ─────────────────────────────────────── */
// The email on a Firebase token is only trustworthy when Firebase verified
// it. Google and email-link sign-in both do, so this changes nothing today;
// it matters the day another sign-in method is switched on.
export function verifiedEmailOf(payload) {
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
export function underDailyCap(env, name, cap) { return underCap(env, `cap:${name}:${new Date().toISOString().slice(0, 10)}`, cap, 60 * 60 * 48); }
export function underHourlyCap(env, name, cap) { return underCap(env, `cap:${name}:h${Math.floor(Date.now() / 3600000)}`, cap, 60 * 60 * 2); }
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
export async function turnstileOk(env, token, ip) {
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
export async function claimWebhookEvent(env, id) {
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
export async function adminTokenOk(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = `cap:admin401:${ip}:h${Math.floor(Date.now() / 3600000)}`;
  try { if (env.RATE_LIMIT && (Number(await env.RATE_LIMIT.get(key)) || 0) >= 20) return false; } catch {}
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (token && timingSafeEqual(token, env.ADMIN_TOKEN)) return true;
  await underCap(env, key, 1000, 7200);
  return false;
}
