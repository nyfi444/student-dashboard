/* ── worker/src/ai.js ───────────────────────────────────────────
   The AI proxy (/v1/messages): model allow-list, size and cost limits,
   the per-account daily quota. Job 1 in index.js.
──────────────────────────────────────────────────────────────── */

import { logServerIssue } from './diagnostics.js';
import { readFirestoreDoc, verifyFirebaseIdToken } from './firebase.js';
import { corsHeaders, jsonError } from './http.js';
import { noteAiUsage } from './usage.js';
import { finishClaudeMessage, foldClaudeEvent, sseReader } from './stream.js';

// claude-sonnet-5 is the default (see js/ai.js): newer than sonnet-4.6 and a
// third cheaper on both sides ($2/$10 per MTok vs $3/$15). claude-opus-5 is
// here for the one genuinely hard case, a scanned image-only syllabus where
// the structure has to be inferred from the page layout; it costs 2.5x Sonnet
// 5, so nothing else should route to it. claude-sonnet-4-6 stays allowed for
// one release so a stored per-user aiModel setting doesn't start 400ing.
const ALLOWED_MODELS = ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
// Room for the reply, thinking included: Sonnet 5 thinks before it answers,
// and at 4000 a long syllabus could spend all of it thinking and send back
// nothing (seen in the Error Viewer on Sept 23). Replies are streamed (see
// streamAiReply), so a long one no longer risks Cloudflare's 100 seconds.
const MAX_TOKENS_CAP = 12000;
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

/* ── 1. AI proxy ──────────────────────────────────────────────── */
// Gated behind a paid subscription: every caller must prove (via a fresh Firebase
// ID token) that they're signed in AND that licenses/{uid}.paid is true. This
// check has to live here, not just in the client (js/ai.js): anyone can call
// this endpoint directly with curl, bypassing whatever the UI does.
// `ctx` is the request's ExecutionContext, used only to record what the call
// cost after the reply has gone (see usage.js).
export async function handleAiProxy(request, env, origin, ctx) {
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
  forwarded.stream = true;

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

  // Accepted: the answer streams back through streamAiReply. Anything else
  // (a refusal of the request, a rate limit) is answered at once below.
  if (upstream.ok && upstream.body && (upstream.headers.get('content-type') || '').includes('text/event-stream')) {
    return streamAiReply(upstream, env, ctx, origin, body);
  }
  const text = await upstream.text();
  // Still rate limited after the retry. That isn't the student's fault and
  // shouldn't read like an error they caused.
  if (upstream.status === 429) {
    await logServerIssue(env, 'ai', 'Anthropic rate limited this account', null, { model: body.model });
    return jsonError('Semester HQ is busy right now — a lot of people are setting up at once. Give it a minute and try again.', 429, env, origin, { upstream: true });
  }
  // What it cost, per feature. `feature` is a label the app sends with each
  // call (callClaude in js/ai.js) and is never forwarded to Anthropic; an
  // unknown or missing one counts as 'untagged'. After the reply, never in
  // its way.
  if (upstream.ok) noteAiUsage(env, ctx, { feature: body.feature, model: body.model, text });
  if (!upstream.ok && upstream.status < 500) {
    let upstreamError = {};
    try { upstreamError = JSON.parse(text).error || {}; } catch {}
    await logServerIssue(env, 'ai', `Anthropic returned ${upstream.status}`, null, { model: body.model, type: upstreamError.type || '', detail: String(upstreamError.message || '').slice(0, 200) });
  }
  return new Response(text, { status: upstream.status, headers: corsHeaders(env, origin, { 'content-type': 'application/json' }) });
}

/* ── Streaming the reply back ──────────────────────────────────────
   Replies at once, writes a space every 8 seconds while Claude writes
   (JSON allows leading whitespace, so res.json() in the app is unchanged),
   then sends the whole message rebuilt from the stream. A failure partway
   through arrives as { type: 'error', error } on a 200, which callClaude
   in js/ai.js turns into a sentence for the student. Usage is counted as
   before, from the rebuilt message. */
function streamAiReply(upstream, env, ctx, origin, body) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const relay = (async () => {
    const read = sseReader();
    const dec = new TextDecoder();
    const reader = upstream.body.getReader();
    let state = null;
    let queue = Promise.resolve();
    const beat = setInterval(() => { queue = queue.then(() => writer.write(enc.encode(' '))).catch(() => {}); }, 8000);
    try {
      for (;;) {
        const { value, done } = await reader.read();
        for (const ev of read(done ? dec.decode() : dec.decode(value, { stream: true }), done)) state = foldClaudeEvent(state, ev);
        if (done) break;
      }
    } catch (e) {
      state = { ...(state || {}), error: { type: 'api_error', message: 'The answer was cut off partway. Try again.' } };
    }
    clearInterval(beat);
    await queue;
    const final = finishClaudeMessage(state);
    const text = JSON.stringify(final);
    if (final.type === 'error') {
      try { await logServerIssue(env, 'ai', 'Anthropic stream failed', null, { model: body.model, type: String(final.error?.type || '') }); } catch {}
    } else noteAiUsage(env, ctx, { feature: body.feature, model: body.model, text });
    try { await writer.write(enc.encode(text)); await writer.close(); } catch { /* the app went away */ }
  })();
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(relay);
  return new Response(readable, { status: 200, headers: corsHeaders(env, origin, { 'content-type': 'application/json' }) });
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
