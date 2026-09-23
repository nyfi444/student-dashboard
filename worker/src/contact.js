/* ── worker/src/contact.js ──────────────────────────────────────
   The contact form (/contact-message) and the email that tells Nyla about
   it. Job 4 in index.js.
──────────────────────────────────────────────────────────────── */

import { logServerIssue } from './diagnostics.js';
import { writeFirestoreDoc } from './firebase.js';
import { jsonError, jsonOk, turnstileOk, underDailyCap } from './http.js';

/* ── 4. Contact form ──────────────────────────────────────────── */
// Writes to Firestore's `feedback` collection. Clients can never read or
// write it directly (see firestore.rules), only this route, using the same
// service account as licensing. Reachable by anyone (signed in or not), so
// this is the one route that needs its own input validation and a honeypot
// on top of the shared rate limiting.
const CONTACT_CATEGORIES = ['bug', 'feature', 'billing', 'group', 'feedback', 'other'];
export async function handleContactMessage(request, env, origin) {
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
