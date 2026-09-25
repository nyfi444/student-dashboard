/* ── worker/src/authmail.js ─────────────────────────────────────
   The sign-in link and password-reset emails (/auth-email). Job 11 in
   index.js.

   Firebase can send both itself, but it sends from its shared
   noreply@<project>.firebaseapp.com address, and Gmail files that under
   Spam, where it switches the link off: students got an email saying
   "click this link" with nothing to click (Sept 25 2026). So Firebase
   only makes the link here, and it goes out through Resend from
   send.semester-hq.com, which has our own DKIM and aligns with DMARC.

   This is the one place the Worker emails someone other than Nyla, and
   anyone can ask for it, so it carries every brake the contact form has.
   When it can't send (a cap, Resend down), login.html falls back to
   Firebase's own email, so a sign-in link always goes somewhere.
──────────────────────────────────────────────────────────────── */

import { logServerIssue } from './diagnostics.js';
import { generateAuthEmailLink } from './firebase.js';
import { jsonError, jsonOk, turnstileOk, underDailyCap } from './http.js';

const AUTH_EMAIL_KINDS = {
  signin: { requestType: 'EMAIL_SIGNIN', subject: 'Your Semester HQ sign-in link', lead: 'Tap the button to sign in to Semester HQ.', button: 'Sign in to Semester HQ' },
  reset: { requestType: 'PASSWORD_RESET', subject: 'Set your Semester HQ password', lead: 'Tap the button to choose a new password for Semester HQ.', button: 'Set my password' },
};
// Resend's free plan sends 100 a day, and the contact form needs some of
// them. Past this, login.html uses Firebase's email for the rest of the day.
const AUTH_EMAIL_DAILY_CAP = 80;

export async function handleAuthEmail(request, env, origin) {
  if (!env.RESEND_API_KEY || !env.FIREBASE_PROJECT_ID) return jsonError('Email sending is not set up.', 503, env, origin);
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env, origin); }

  const kind = AUTH_EMAIL_KINDS[body.kind];
  if (!kind) return jsonError('Unknown email kind.', 400, env, origin);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 320);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError('That email doesn’t look right.', 400, env, origin);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await turnstileOk(env, body.turnstileToken, ip))) return jsonError('Please complete the verification and try again.', 400, env, origin);
  if (!(await underDailyCap(env, 'auth-email', AUTH_EMAIL_DAILY_CAP)) || !(await underDailyCap(env, `auth-email:${email}`, 5))) {
    return jsonError('Daily email limit reached.', 429, env, origin);
  }

  try {
    const link = await generateAuthEmailLink(env, kind.requestType, email, authContinueUrl(env, body.continueUrl));
    // A reset for an address with no account sends nothing, and says so to
    // nobody: the page shows the same "check your inbox" either way.
    if (link) await sendAuthEmail(env, email, kind, link);
    return jsonOk({ ok: true }, env, origin);
  } catch (e) {
    await logServerIssue(env, 'login', `Could not send a ${body.kind} email`, e);
    return jsonError('Could not send that email right now.', 502, env, origin);
  }
}

// Where the link lands once Firebase has checked it. Only a page of the app
// itself: the link is ours to hand out, not a redirect for anyone's site.
function authContinueUrl(env, asked) {
  const app = new URL(env.APP_URL || 'https://app.semester-hq.com/');
  try {
    const url = new URL(String(asked || ''));
    if (url.origin === app.origin) return url.href;
  } catch {}
  return new URL('login.html', app).href;
}

function escapeHtmlText(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function sendAuthEmail(env, to, kind, link) {
  const from = env.NOTIFY_FROM || 'Semester HQ <notifications@send.semester-hq.com>';
  const text = `${kind.lead}\n\n${link}\n\nThe link works once and lasts an hour. If you didn't ask for it, ignore this email and nothing changes.\n\nSemester HQ`;
  const href = escapeHtmlText(link);
  // Plain tables and inline styles, which is what email clients render. The
  // address is printed under the button too, so it can be copied by hand in
  // a client that won't open the button.
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#F8F6F2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8F6F2;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #EDE7DE;border-radius:14px">
<tr><td style="padding:32px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#121212">
<p style="margin:0 0 20px;font-size:17px;font-weight:700">Semester HQ</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.5">${escapeHtmlText(kind.lead)}</p>
<a href="${href}" style="display:inline-block;background:#121212;color:#F8F6F2;text-decoration:none;font-size:15px;font-weight:600;padding:13px 22px;border-radius:10px">${escapeHtmlText(kind.button)}</a>
<p style="margin:24px 0 6px;font-size:13px;line-height:1.5;color:#555">Button not working? Copy this into your browser:</p>
<p style="margin:0 0 24px;font-size:12px;line-height:1.5;word-break:break-all"><a href="${href}" style="color:#121212">${href}</a></p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#555">The link works once and lasts an hour. If you didn’t ask for it, ignore this email and nothing changes.</p>
</td></tr></table></td></tr></table></body></html>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to, reply_to: 'hello@semester-hq.com', subject: kind.subject, text, html }),
  });
  if (!res.ok) throw new Error(`Resend API ${res.status}: ${await res.text()}`);
}
