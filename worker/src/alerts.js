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
      day has. At most one email per hour.
   3. The morning digest, from the daily cron: yesterday's errors and
      warnings by feature, sent only when there was something to report.

   The whole day is capped at ALERT_DAILY_CAP emails, well inside the
   free plan's 100, so the sign-in emails (capped at 80) always have room.
   Nothing here names a student: messages have already been through
   scrubPII, and the digest shows counts, features and messages only.
──────────────────────────────────────────────────────────────── */

import { underDailyCap, underHourlyCap } from './http.js';

// The features where a failure can cost a sale or lock someone out.
const ALERT_URGENT_FEATURES = ['checkout', 'license', 'account', 'group-plans'];
// Student-side error reports in one hour that count as a spike.
const ALERT_SPIKE_PER_HOUR = 25;
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
export async function alertOnSpike(env, level) {
  if (level === 'warn' || !env.RESEND_API_KEY) return false;
  if (await underHourlyCap(env, 'alert-reports', ALERT_SPIKE_PER_HOUR)) return false;
  if (!(await underHourlyCap(env, 'alert-spike-sent', 1))) return false;
  if (!(await underDailyCap(env, 'alerts', ALERT_DAILY_CAP))) return false;
  await sendOwnerAlert(env,
    '[Semester HQ] Error reports are spiking',
    `More than ${ALERT_SPIKE_PER_HOUR} error reports came in from the app and site in the last hour. A normal day has fewer than that in total.\n\nSomething students are using is probably broken right now. Open the Error Viewer to see which feature: ${ALERT_ERROR_VIEWER}\n\nYou'll get at most one of these an hour.`);
  return true;
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

async function sendOwnerAlert(env, subject, text) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.NOTIFY_FROM || 'Semester HQ <notifications@send.semester-hq.com>',
      to: env.NOTIFY_EMAIL || 'hello@semester-hq.com',
      subject, text,
    }),
  });
  if (!res.ok) throw new Error(`Resend API ${res.status}`);
}
