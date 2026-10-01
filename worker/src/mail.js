/* ── worker/src/mail.js ─────────────────────────────────────────
   The one door to Resend. Every email the Worker sends goes through
   sendMail: sign-in links, subscription receipts, alerts to Nyla, the
   contact-form copy, and the onboarding emails.

   They all share one daily budget, because Resend's plan counts every
   email together (the free plan stops at 100 a day). A kind may send
   only while the day's total is under its share of that budget, so the
   less important kinds stop first and the important ones always have
   room at the end of a busy day:

     auth        sign-in and password links     up to 98% of the day
     receipt     subscription confirmations     up to 95%
     alert       emails to Nyla                 up to 90%
     contact     contact-form copies to Nyla    up to 80%
     onboarding  welcome and tips               up to 60%

   RESEND_DAILY_LIMIT (wrangler.toml) is the plan's daily number. Raise it
   when the plan grows and every share grows with it.

   MAIL_ALLOWLIST, when set (staging), refuses every recipient not on it,
   so a test system can only ever email the people testing it.
──────────────────────────────────────────────────────────────── */

import { underDailyCap } from './http.js';

export const MAIL_KINDS = { auth: 0.98, receipt: 0.95, alert: 0.9, contact: 0.8, onboarding: 0.6 };
const MAIL_DEFAULT_DAILY_LIMIT = 100;

function mailDay(now = Date.now()) { return new Date(now).toISOString().slice(0, 10); }

export function mailDailyLimit(env) {
  const n = Number(env.RESEND_DAILY_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : MAIL_DEFAULT_DAILY_LIMIT;
}

// How many emails a kind may have gone out today, in total across kinds,
// before it has to stop.
export function mailCeiling(env, kind) {
  return Math.max(1, Math.floor(mailDailyLimit(env) * (MAIL_KINDS[kind] || 0.5)));
}

export function mailAllowed(env, to) {
  const list = String(env.MAIL_ALLOWLIST || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  const all = (Array.isArray(to) ? to : [to]).map(s => String(s).trim().toLowerCase());
  return all.every(a => list.includes(a));
}

// Sends one email. Returns { sent: true, id } or { sent: false, reason }
// for a budget, allow-list or setup refusal, which the caller decides how
// to handle. Throws only when Resend itself says no.
export async function sendMail(env, { kind, to, subject, text, html, replyTo, headers, scheduledAt, idempotencyKey, tags }) {
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'not-configured' };
  if (!MAIL_KINDS[kind]) throw new Error(`Unknown mail kind: ${kind}`);
  if (!mailAllowed(env, to)) return { sent: false, reason: 'allowlist' };
  const day = mailDay();
  if (!(await underDailyCap(env, 'mail', mailCeiling(env, kind)))) return { sent: false, reason: 'budget' };

  const body = { from: env.NOTIFY_FROM || 'Semester HQ <notifications@send.semester-hq.com>', to, subject, text };
  if (html) body.html = html;
  if (replyTo) body.reply_to = replyTo;
  if (headers && Object.keys(headers).length) body.headers = headers;
  if (scheduledAt) body.scheduled_at = scheduledAt;
  if (tags) body.tags = tags;
  const requestHeaders = { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' };
  if (idempotencyKey) requestHeaders['Idempotency-Key'] = String(idempotencyKey).slice(0, 256);

  const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: requestHeaders, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Resend API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  let id = '';
  try { id = (await res.json())?.id || ''; } catch {}
  await countMailKind(env, kind, day);
  return { sent: true, id };
}

// Per-kind counts for the business summary, so the Business OS can show
// how close the day came to the plan's limit and which kind used it.
async function countMailKind(env, kind, day) {
  if (!env.RATE_LIMIT) return;
  const key = `mailkind:${kind}:${day}`;
  try {
    const n = Number(await env.RATE_LIMIT.get(key)) || 0;
    await env.RATE_LIMIT.put(key, String(n + 1), { expirationTtl: 60 * 60 * 24 * 10 });
  } catch {}
}

export async function mailUsageSummary(env, now = Date.now()) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const day = mailDay(now - i * 86400000);
    const row = { day, total: 0 };
    for (const kind of Object.keys(MAIL_KINDS)) {
      let n = 0;
      try { n = env.RATE_LIMIT ? Number(await env.RATE_LIMIT.get(`mailkind:${kind}:${day}`)) || 0 : 0; } catch {}
      row[kind] = n;
      row.total += n;
    }
    days.push(row);
  }
  let lastAlert = null;
  try { lastAlert = env.RATE_LIMIT ? JSON.parse((await env.RATE_LIMIT.get('alerts:last')) || 'null') : null; } catch {}
  return { dailyLimit: mailDailyLimit(env), shares: MAIL_KINDS, alertsTo: env.NOTIFY_EMAIL || 'hello@semester-hq.com', lastAlert, days };
}
