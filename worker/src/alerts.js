/* ── worker/src/alerts.js ───────────────────────────────────────
   Tells Nyla when something breaks, by email, so she never has to go
   look. Job 12 in index.js. Three kinds, all to NOTIFY_EMAIL through
   Resend, all capped so an outage can't flood the inbox or spend the
   Resend allowance that sign-in emails need:

   1. Right away: a Worker failure in a part of the business that takes
      money or holds accounts (checkout, the Stripe webhook, licenses,
      account deletion, group plans). At most one email per distinct
      problem per day.
   2. A spike: more app and site error reports in one hour than a normal
      day has, from at least ALERT_SPIKE_SESSIONS different sessions (so
      one device stuck in a loop isn't an outage). At most one an hour.
   3. The morning digest, from the daily cron: yesterday's errors and
      warnings by feature, sent only when there was something to report.
   4. AI spend running hot: the day's estimated Anthropic cost passes
      AI_SPEND_ALERT_CENTS (wrangler.toml). Once a day at most.

   The whole day is capped at ALERT_DAILY_CAP emails, and every alert goes
   through mail.js's shared budget below sign-in emails and receipts, so
   an outage can never use up the room a student's sign-in link needs.
   Nothing here names a student: messages have already been through
   scrubPII, and the digest shows counts, features and messages only.
──────────────────────────────────────────────────────────────── */

import { underDailyCap, underHourlyCap } from './http.js';
import { sendMail } from './mail.js';

// The features where a failure can cost a sale or lock someone out.
const ALERT_URGENT_FEATURES = ['checkout', 'license', 'account', 'group-plans'];
// Student-side error reports in one hour that count as a spike.
const ALERT_SPIKE_PER_HOUR = 25;
// …and how many different sessions they must come from.
const ALERT_SPIKE_SESSIONS = 5;
// Estimated AI cost in a day, in cents, before it emails. wrangler.toml's
// AI_SPEND_ALERT_CENTS overrides it.
const ALERT_AI_SPEND_CENTS = 500;
// Every alert email in a day, of all three kinds together.
const ALERT_DAILY_CAP = 6;
const ALERT_ERROR_VIEWER = 'https://biz.semester-hq.com';

// 1. Called by logServerIssue after it records a Worker failure.
export async function alertIfUrgent(env, { feature, message, fingerprint }) {
  if (!ALERT_URGENT_FEATURES.includes(feature)) return false;
  if (!env.RESEND_API_KEY) return false;
  if (!(await underDailyCap(env, `alert:${fingerprint}`, 1))) return false;
  if (!(await underDailyCap(env, 'alerts', ALERT_DAILY_CAP))) return false;
  const label = feature === 'checkout' ? 'Checkout or payments' : feature === 'license' ? 'Licenses' : feature === 'account' ? 'Accounts' : 'Group plans';
  await sendOwnerAlert(env,
    `[Semester HQ] Something broke: ${label}`,
    `${label} just failed on the server.\n\n${message}\n\nThis can cost a sale or lock someone out, so it's worth a look today. The same problem won't email you again until tomorrow.\n\nError Viewer: ${ALERT_ERROR_VIEWER}`);
  return true;
}

// 2. Called by /log-error for every stored report from the app or site.
export async function alertOnSpike(env, level, session = '') {
  if (level === 'warn' || !env.RESEND_API_KEY) return false;
  const sessions = await noteSpikeSession(env, session);
  if (await underHourlyCap(env, 'alert-reports', ALERT_SPIKE_PER_HOUR)) return false;
  if (sessions < ALERT_SPIKE_SESSIONS) return false;
  if (!(await underHourlyCap(env, 'alert-spike-sent', 1))) return false;
  if (!(await underDailyCap(env, 'alerts', ALERT_DAILY_CAP))) return false;
  await sendOwnerAlert(env,
    '[Semester HQ] Error reports are spiking',
    `More than ${ALERT_SPIKE_PER_HOUR} error reports came in from the app and site in the last hour, from at least ${ALERT_SPIKE_SESSIONS} different people. A normal day has fewer than that in total.\n\nSomething students are using is probably broken right now. Open the Error Viewer to see which feature: ${ALERT_ERROR_VIEWER}\n\nYou'll get at most one of these an hour.`);
  return true;
}

// The different sessions seen this hour, kept only until there are enough
// to count as a spike, so a busy hour costs at most a handful of KV writes.
async function noteSpikeSession(env, session) {
  if (!env.RATE_LIMIT) return ALERT_SPIKE_SESSIONS;
  const key = `alert-sessions:h${Math.floor(Date.now() / 3600000)}`;
  let seen = [];
  try { seen = JSON.parse((await env.RATE_LIMIT.get(key)) || '[]'); } catch {}
  if (!Array.isArray(seen)) seen = [];
  const id = String(session || '').slice(0, 20) || 'unknown';
  if (seen.length < ALERT_SPIKE_SESSIONS && !seen.includes(id)) {
    seen.push(id);
    try { await env.RATE_LIMIT.put(key, JSON.stringify(seen), { expirationTtl: 60 * 60 * 2 }); } catch {}
  }
  return seen.length;
}

// 3. Called by the daily cron with fetchErrorSummary's answer.
export async function sendDailyDigest(env, summary) {
  if (!env.RESEND_API_KEY || !summary) return false;
  const byFeature = Object.entries(summary.byFeature24h || {})
    .sort((a, b) => (b[1].errors - a[1].errors) || (b[1].warnings - a[1].warnings));
  if (!summary.count24h && !byFeature.some(([, r]) => r.warnings >= 5)) return false;
  if (!(await underDailyCap(env, 'alerts', ALERT_DAILY_CAP))) return false;
  const lines = byFeature.slice(0, 10).map(([f, r]) => `  ${f}: ${r.errors} error${r.errors === 1 ? '' : 's'}, ${r.warnings} warning${r.warnings === 1 ? '' : 's'}`);
  const latest = (summary.latest || []).slice(0, 5).map(r => `  [${r.source}/${r.feature || '?'}] ${String(r.message || '').slice(0, 160)}`);
  await sendOwnerAlert(env,
    `[Semester HQ] Yesterday: ${summary.count24h} error${summary.count24h === 1 ? '' : 's'}`,
    `The last 24 hours, by feature:\n${lines.join('\n') || '  (none)'}\n\nMost recent:\n${latest.join('\n') || '  (none)'}\n\nLast 7 days: ${summary.count7d} errors, ${summary.warn7d} warnings.\n\nError Viewer: ${ALERT_ERROR_VIEWER}\n\nThis email only comes on days with something to report.`);
  return true;
}

// 4. Called after every AI call with what it cost. Keeps the day's running
// total in KV and emails once when it passes the line.
export async function noteAiSpend(env, cents) {
  if (!env.RATE_LIMIT || !(cents > 0)) return false;
  const day = new Date().toISOString().slice(0, 10);
  const key = `aispend:${day}`;
  let total = 0;
  try {
    total = (Number(await env.RATE_LIMIT.get(key)) || 0) + cents;
    await env.RATE_LIMIT.put(key, String(Math.round(total * 100) / 100), { expirationTtl: 60 * 60 * 48 });
  } catch { return false; }
  const line = Number(env.AI_SPEND_ALERT_CENTS) > 0 ? Number(env.AI_SPEND_ALERT_CENTS) : ALERT_AI_SPEND_CENTS;
  if (total < line || !env.RESEND_API_KEY) return false;
  if (!(await underDailyCap(env, 'alert-aispend', 1))) return false;
  if (!(await underDailyCap(env, 'alerts', ALERT_DAILY_CAP))) return false;
  const dollars = (c) => `$${(c / 100).toFixed(2)}`;
  await sendOwnerAlert(env,
    `[Semester HQ] AI spend is running hot: ${dollars(total)} today`,
    `The AI features have cost an estimated ${dollars(total)} so far today (UTC), past the ${dollars(line)} line.\n\nEvery account already has a daily limit on AI reads, so this usually means a lot of new students at once, which is good, or one feature using far more than it should, which is worth a look. The Business OS Measure page shows cost by feature.\n\nYou'll get at most one of these a day. The line is AI_SPEND_ALERT_CENTS in the Worker's wrangler.toml.`);
  return true;
}

async function sendOwnerAlert(env, subject, text) {
  const result = await sendMail(env, { kind: 'alert', to: env.NOTIFY_EMAIL || 'hello@semester-hq.com', subject, text });
  if (result.sent && env.RATE_LIMIT) {
    try { await env.RATE_LIMIT.put('alerts:last', JSON.stringify({ at: new Date().toISOString(), subject: subject.slice(0, 120) })); } catch {}
  }
  return result.sent;
}
