/* ── worker/src/onboarding.js ───────────────────────────────────
   Who gets which customer email, and when. Job 13 in index.js. The words
   and the layout are in emails.js; every send goes through mail.js.

   The moment a checkout completes (the Stripe webhook, never the sign-up
   screen), the buyer gets their receipt right away and a welcome an hour
   later. Group admins get a group receipt and a "getting your group
   started" note. A member who takes a seat gets a member welcome. Students
   (subscribers and seat members) then get five tips, one job each, from
   the daily cron:

     day 3   add your classes from a syllabus      skipped if they have one
     day 7   see your week on the calendar
     day 11  bring over the Canvas calendar        skipped if connected
     day 16  start or join a study group           skipped if in one
     day 21+ the weekly habit, on the first Sunday from day 21

   Never two within EMAIL_MIN_GAP_DAYS of each other, and a tip that has to
   wait (the day's email budget, a Sunday) never pulls the next one closer.
   The sequence stops for good when the student unsubscribes, stops paying,
   or deletes their account.

   What's stored, all server-only (firestore.rules denies clients):
     emailOnboarding/{email id}  where each student is in the sequence and
                                 three yes/no flags the app reports (has a
                                 class, has a calendar feed, is in a group)
     emailPrefs/{email id}       { tips: false } once they opt out
     emailLog/{hash}-{email}     one doc per email ever sent, created with a
                                 "must not exist" condition before the send,
                                 so nobody gets the same email twice even if
                                 the cron runs twice. Holds no address.
   Demo visitors never get anything: only a paid checkout or a seat on a
   paid group plan starts a record.
──────────────────────────────────────────────────────────────── */

import { EMAIL_TIPS, renderEmail } from './emails.js';
import { logServerIssue } from './diagnostics.js';
import { commitFirestore, encodeEmailDocId, readFirestoreDoc, runFirestoreQuery, verifyFirebaseIdToken } from './firebase.js';
import { adminTokenOk, jsonError, jsonOk, timingSafeEqual, verifiedEmailOf } from './http.js';
import { sendMail } from './mail.js';

const EMAIL_MIN_GAP_DAYS = 3;
const EMAIL_WELCOME_DELAY_MINUTES = 60;
const EMAIL_RUN_LIMIT = 300;
const EMAIL_DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL_PROGRESS_FLAGS = ['hasClass', 'hasFeed', 'inGroup'];

function emailIdFor(email) { return encodeEmailDocId(String(email || '').trim().toLowerCase()); }

async function emailHash(email) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`semester-hq-email|${String(email).trim().toLowerCase()}`));
  return [...new Uint8Array(digest)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ── Signed links: unsubscribe and email settings ─────────────── */
// The link carries the email id and an HMAC of it under EMAIL_LINK_SECRET,
// so it works without signing in and can't be made for someone else.
export async function emailLinkToken(env, emailId) {
  if (!env.EMAIL_LINK_SECRET) return '';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.EMAIL_LINK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`unsubscribe|${emailId}`));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 32);
}
async function emailLinks(env, email) {
  const e = emailIdFor(email);
  const t = await emailLinkToken(env, e);
  if (!t) return null;
  const q = `e=${encodeURIComponent(e)}&t=${encodeURIComponent(t)}`;
  const page = new URL('email-preferences.html', env.APP_URL || 'https://app.semester-hq.com/').href;
  return {
    prefsUrl: `${page}?${q}`,
    unsubscribeUrl: `${page}?${q}&off=1`,
    oneClickUrl: `${(env.SELF_URL || 'https://student-planner-ai-proxy.semesterhq.workers.dev').replace(/\/$/, '')}/email/unsubscribe?${q}`,
  };
}

/* ── Sending one email, at most once ──────────────────────────── */
// Claims the log entry first (Firestore refuses if it exists), then sends.
// If the send doesn't happen, the claim is released so a later run can try.
async function sendEmailOnce(env, { email, key, logKey = key, ctx = {}, scheduledAt }) {
  const rendered = renderEmail(key, { appUrl: env.APP_URL, ...ctx });
  if (!rendered) throw new Error(`No email called ${key}`);
  let links = null;
  if (!rendered.transactional) {
    links = await emailLinks(env, email);
    if (!links) return { sent: false, reason: 'no-link-secret' };
  }
  const final = links ? renderEmail(key, { appUrl: env.APP_URL, ...ctx, ...links }) : rendered;
  const hash = await emailHash(email);
  const logPath = `emailLog/${hash}-${logKey}`;
  const claimed = await commitFirestore(env, [{ path: logPath, fields: { hash, key, logKey, kind: final.transactional ? 'receipt' : 'onboarding', claimedAt: new Date() }, exists: false }]);
  if (!claimed) return { sent: false, reason: 'already-sent' };
  let result;
  try {
    result = await sendMail(env, {
      kind: final.transactional ? 'receipt' : 'onboarding',
      to: email,
      replyTo: 'hello@semester-hq.com',
      subject: final.subject,
      html: final.html,
      text: final.text,
      scheduledAt,
      idempotencyKey: logPath,
      headers: links ? { 'List-Unsubscribe': `<${links.oneClickUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined,
      tags: [{ name: 'email', value: key.replace(/[^a-zA-Z0-9_-]/g, '_') }],
    });
  } catch (e) {
    await commitFirestore(env, [{ path: logPath, remove: true }]).catch(() => {});
    throw e;
  }
  if (!result.sent) {
    await commitFirestore(env, [{ path: logPath, remove: true }]).catch(() => {});
    // A held receipt is never routine, and on staging an address missing from
    // the allow-list should say so rather than look like nothing happened.
    if (result.reason === 'allowlist' || (final.transactional && result.reason === 'budget')) {
      await logServerIssue(env, 'email', `The ${key} email was held: ${result.reason === 'allowlist' ? 'the address is not on MAIL_ALLOWLIST' : 'the day\'s email budget is used up'}`, null, { key }).catch(() => {});
    }
    return result;
  }
  await commitFirestore(env, [{ path: logPath, fields: { sentAt: new Date(), resendId: String(result.id || '').slice(0, 80) } }]).catch(() => {});
  return result;
}

async function tipsWanted(env, emailId) {
  const prefs = await readFirestoreDoc(env, 'emailPrefs', emailId).catch(() => null);
  return prefs?.tips !== false;
}

/* ── Starting: called by the webhook and by a group seat ──────── */
// plan: 'plus' | 'group-admin' | 'member'. Never throws: a purchase or a
// seat must not fail because an email didn't go.
export async function startCustomerEmails(env, { email, uid = '', plan, sessionId = '', planId = '', groupName = '', seats = 0, startedAt = new Date() }) {
  try {
    email = String(email || '').trim().toLowerCase();
    if (!email || !env.FIREBASE_PROJECT_ID) return;
    const emailId = emailIdFor(email);
    const when = new Date(startedAt);
    const later = new Date(Date.now() + EMAIL_WELCOME_DELAY_MINUTES * 60000).toISOString();

    if (plan === 'plus') {
      await sendEmailOnce(env, { email, key: 'receipt', logKey: `receipt-${String(sessionId).slice(-24) || when.getTime()}`, ctx: { startedAt: when, priceCents: 799 } });
    } else if (plan === 'group-admin') {
      await sendEmailOnce(env, { email, key: 'group-receipt', logKey: `group-receipt-${String(planId).slice(0, 40)}`, ctx: { startedAt: when, groupName, seats, seatCents: 599 } });
    }

    // One onboarding record per person. Buying again later (after a
    // cancellation) doesn't restart the tips they already had.
    const student = plan !== 'group-admin';
    await commitFirestore(env, [{ path: `emailOnboarding/${emailId}`, fields: {
      email, uid: String(uid || ''), plan, startedAt: when, active: student, sent: {}, skipped: {}, did: {}, groupName: String(groupName || '').slice(0, 80),
    }, exists: false }]);
    if (uid) await commitFirestore(env, [{ path: `emailOnboarding/${emailId}`, fields: { uid: String(uid) }, exists: true }]).catch(() => {});

    if (!(await tipsWanted(env, emailId))) return;
    const welcome = plan === 'group-admin' ? 'group-welcome' : plan === 'member' ? 'member-welcome' : 'welcome';
    // The member welcome goes at once (they just clicked Join). The others
    // wait an hour, so they don't land in the same minute as the receipt.
    await sendEmailOnce(env, { email, key: welcome, ctx: { groupName }, scheduledAt: plan === 'member' ? undefined : later });
    await commitFirestore(env, [{ path: `emailOnboarding/${emailId}`, fields: { lastSentAt: new Date(), [`sent.${welcome.replace(/-/g, '_')}`]: new Date() }, exists: true }]).catch(() => {});
  } catch (e) {
    await logServerIssue(env, 'email', 'Customer emails could not start', e).catch(() => {});
  }
}

// The subscription ended (cancelled, or a payment that never came). The
// tips stop; a later purchase can't restart the ones already sent.
export async function stopCustomerEmails(env, email, reason) {
  if (!email || !env.FIREBASE_PROJECT_ID) return;
  await commitFirestore(env, [{ path: `emailOnboarding/${emailIdFor(email)}`, fields: { active: false, stoppedAt: new Date(), stopReason: String(reason).slice(0, 40) }, exists: true }]).catch(() => {});
}

// Deleting an account removes every trace of the emails: the record, the
// preference, and each log entry (found by the keys the record kept).
export async function forgetCustomerEmails(env, email) {
  if (!email || !env.FIREBASE_PROJECT_ID) return;
  const emailId = emailIdFor(email);
  const hash = await emailHash(email);
  const logs = await runFirestoreQuery(env, {
    from: [{ collectionId: 'emailLog' }],
    where: { fieldFilter: { field: { fieldPath: 'hash' }, op: 'EQUAL', value: { stringValue: hash } } },
    limit: 100,
  }).catch(() => []);
  const ids = new Set(logs.map(r => r.id));
  // Log docs are named {hash}-{key}; the known keys cover anything the query
  // missed.
  for (const k of ['welcome', 'member-welcome', 'group-welcome', ...EMAIL_TIPS.map(t => t.key)]) ids.add(`${hash}-${k}`);
  const writes = [...ids].map(id => ({ path: `emailLog/${id}`, remove: true }));
  writes.push({ path: `emailOnboarding/${emailId}`, remove: true }, { path: `emailPrefs/${emailId}`, remove: true });
  for (let i = 0; i < writes.length; i += 400) await commitFirestore(env, writes.slice(i, i + 400));
}

/* ── The daily run ────────────────────────────────────────────── */
function emailWeekdayNY(ms) {
  return new Date(ms).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' });
}
function emailMillis(v) {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : 0;
}

// Which tip is due for one record right now: { send: key } | { skip: key }
// | { wait: true } | { done: true }. Pure, so the tests can walk a whole
// sequence day by day.
export function nextTipFor(rec, now) {
  const started = emailMillis(rec.startedAt);
  const sent = rec.sent || {}, skipped = rec.skipped || {}, did = rec.did || {};
  const tip = EMAIL_TIPS.find(t => !sent[t.key] && !skipped[t.key]);
  if (!tip) return { done: true };
  if (tip.skipIf && did[tip.skipIf]) return { skip: tip.key };
  if (now - started < tip.day * EMAIL_DAY_MS) return { wait: true };
  if (now - emailMillis(rec.lastSentAt) < EMAIL_MIN_GAP_DAYS * EMAIL_DAY_MS) return { wait: true };
  if (tip.sunday && emailWeekdayNY(now) !== 'Sun') return { wait: true };
  return { send: tip.key };
}

async function stillPaying(env, rec, emailId) {
  if (rec.uid) {
    const lic = await readFirestoreDoc(env, 'licenses', rec.uid).catch(() => undefined);
    if (lic !== undefined && lic !== null) return !!lic.paid;
  }
  const byEmail = await readFirestoreDoc(env, 'licensesByEmail', emailId).catch(() => undefined);
  if (byEmail === undefined) return true; // Firestore hiccup: try again tomorrow rather than stop someone
  return !!byEmail?.paid;
}

export async function runOnboardingEmails(env, now = Date.now()) {
  const out = { looked: 0, sent: 0, skipped: 0, stopped: 0, finished: 0, held: '' };
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY || !env.EMAIL_LINK_SECRET) return out;
  const rows = await runFirestoreQuery(env, {
    from: [{ collectionId: 'emailOnboarding' }],
    where: { fieldFilter: { field: { fieldPath: 'active' }, op: 'EQUAL', value: { booleanValue: true } } },
    limit: EMAIL_RUN_LIMIT,
  });
  for (const row of rows) {
    const rec = row.data || row;
    const emailId = row.id;
    out.looked++;
    if (!(await tipsWanted(env, emailId))) {
      await commitFirestore(env, [{ path: `emailOnboarding/${emailId}`, fields: { active: false, stoppedAt: new Date(now), stopReason: 'unsubscribed' } }]);
      out.stopped++; continue;
    }
    if (!(await stillPaying(env, rec, emailId))) {
      await commitFirestore(env, [{ path: `emailOnboarding/${emailId}`, fields: { active: false, stoppedAt: new Date(now), stopReason: 'not-paying' } }]);
      out.stopped++; continue;
    }
    // Skips cost nothing, so a record can skip several and still send one.
    let guard = 0;
    while (guard++ < EMAIL_TIPS.length + 1) {
      const next = nextTipFor(rec, now);
      if (next.done) {
        await commitFirestore(env, [{ path: `emailOnboarding/${emailId}`, fields: { active: false, finishedAt: new Date(now) } }]);
        out.finished++; break;
      }
      if (next.wait) break;
      if (next.skip) {
        rec.skipped = { ...(rec.skipped || {}), [next.skip]: new Date(now) };
        await commitFirestore(env, [{ path: `emailOnboarding/${emailId}`, fields: { [`skipped.${next.skip}`]: new Date(now) } }]);
        out.skipped++; continue;
      }
      const result = await sendEmailOnce(env, { email: rec.email, key: next.send });
      if (result.sent || result.reason === 'already-sent') {
        rec.sent = { ...(rec.sent || {}), [next.send]: new Date(now) };
        rec.lastSentAt = new Date(now);
        await commitFirestore(env, [{ path: `emailOnboarding/${emailId}`, fields: { [`sent.${next.send}`]: new Date(now), lastSentAt: new Date(now) } }]);
        if (result.sent) out.sent++;
        break;
      }
      // Out of today's budget: everyone else waits for tomorrow.
      out.held = result.reason;
      return out;
    }
  }
  return out;
}

/* ── The app's side: settings and progress ────────────────────── */
// POST /account/email { idToken, action: 'status' | 'set' | 'progress', ... }
export async function handleAccountEmail(request, env, origin) {
  if (!env.FIREBASE_PROJECT_ID) return jsonError('Email settings aren’t set up on this server.', 503, env, origin);
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env, origin); }
  let user;
  try { user = await verifyFirebaseIdToken(String(body.idToken || ''), env.FIREBASE_PROJECT_ID); }
  catch { return jsonError('Sign in again to change email settings.', 401, env, origin); }
  const email = verifiedEmailOf(user);
  if (!email) return jsonError('Your email isn’t verified yet.', 400, env, origin);
  const emailId = emailIdFor(email);

  if (body.action === 'set') {
    const tips = body.tips !== false;
    await commitFirestore(env, [{ path: `emailPrefs/${emailId}`, fields: { tips, updatedAt: new Date(), via: 'settings' } }]);
    return jsonOk({ ok: true, tips }, env, origin);
  }
  if (body.action === 'progress') {
    // Only ever turns a flag on, and only on an existing record: the app
    // can't start a sequence or unlearn a step.
    const fields = {};
    for (const f of EMAIL_PROGRESS_FLAGS) if (body[f] === true) fields[`did.${f}`] = true;
    if (Object.keys(fields).length) await commitFirestore(env, [{ path: `emailOnboarding/${emailId}`, fields: { ...fields, uid: user.sub }, exists: true }]);
    return jsonOk({ ok: true }, env, origin);
  }
  return jsonOk({ ok: true, tips: await tipsWanted(env, emailId) }, env, origin);
}

// POST /email/unsubscribe?e=&t=     one click, from the mail app (RFC 8058)
// POST /email/prefs {e, t, tips?}    the email-preferences page
// Neither needs a sign-in or an allowed origin: the signed token is the key.
export async function handleEmailLink(request, env, pathname) {
  const headers = { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Cache-Control': 'no-store' };
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  if (!env.FIREBASE_PROJECT_ID || !env.EMAIL_LINK_SECRET) return new Response(JSON.stringify({ error: 'Not set up' }), { status: 503, headers });
  const url = new URL(request.url);
  let body = {};
  if (pathname === '/email/prefs') { try { body = await request.json(); } catch {} }
  const e = String(body.e || url.searchParams.get('e') || '').slice(0, 400);
  const t = String(body.t || url.searchParams.get('t') || '').slice(0, 64);
  const expected = await emailLinkToken(env, e);
  if (!e || !t || !expected || !timingSafeEqual(t, expected)) return new Response(JSON.stringify({ error: 'That link isn’t valid. Open Settings in the app to change your emails.' }), { status: 400, headers });

  if (pathname === '/email/unsubscribe' || body.tips === false || body.tips === true) {
    const tips = pathname === '/email/unsubscribe' ? false : body.tips;
    await commitFirestore(env, [{ path: `emailPrefs/${e}`, fields: { tips, updatedAt: new Date(), via: pathname === '/email/unsubscribe' ? 'one-click' : 'link' } }]);
    return new Response(JSON.stringify({ ok: true, tips }), { headers });
  }
  return new Response(JSON.stringify({ ok: true, tips: await tipsWanted(env, e) }), { headers });
}

/* ── Admin: test sends and (staging only) a run at a chosen date ── */
// The admin token, or EMAIL_TEST_TOKEN: a second token that can do only
// this, since the test can only ever reach hello@ or Nyla's own inboxes.
async function emailTestAllowed(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (env.EMAIL_TEST_TOKEN && token && timingSafeEqual(token, env.EMAIL_TEST_TOKEN)) return true;
  return !!env.ADMIN_TOKEN && adminTokenOk(request, env);
}

// POST /admin/email-test: every customer email, once, to hello@ (or one of
// Nyla's own inboxes, ?to=), with
// "[Test]" in the subject. Writes no records and no log.
export async function handleAdminEmailTest(request, env) {
  const headers = { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (!(await emailTestAllowed(request, env))) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  // ?to= may pick one of Nyla's own inboxes (OWNER_TEST_EMAILS in
  // wrangler.toml), for checking that real emails land in the inbox and not
  // Junk. Anything else goes to hello@, whatever is asked.
  const owners = ['hello@semester-hq.com', ...String(env.OWNER_TEST_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)];
  const asked = (new URL(request.url).searchParams.get('to') || '').trim().toLowerCase();
  const to = owners.includes(asked) ? asked : 'hello@semester-hq.com';
  const only = new URL(request.url).searchParams.get('only') || '';
  const links = (await emailLinks(env, to)) || { prefsUrl: 'https://app.semester-hq.com/email-preferences.html', unsubscribeUrl: 'https://app.semester-hq.com/email-preferences.html', oneClickUrl: '' };
  const all = ['receipt', 'welcome', ...EMAIL_TIPS.map(t => t.key), 'group-receipt', 'group-welcome', 'member-welcome'];
  // ?only=receipt,welcome sends just those, so an inbox check is one or two
  // emails rather than ten.
  const keys = only ? all.filter(k => only.split(',').includes(k)) : all;
  // ?images= may point the pictures at a site Preview (before they're live),
  // and nowhere else.
  const images = new URL(request.url).searchParams.get('images') || '';
  const imageBase = /^https:\/\/[a-z0-9-]+-semester-hq-site\.semesterhq\.workers\.dev\/assets\/email\/$/.test(images) ? images : undefined;
  const ctx = { appUrl: env.APP_URL, startedAt: new Date(), priceCents: 799, groupName: 'Chem Club', seats: 12, seatCents: 599, ...links, ...(imageBase ? { imageBase } : {}) };
  const results = [];
  for (const key of keys) {
    const r = renderEmail(key, ctx);
    try {
      const sent = await sendMail(env, { kind: 'onboarding', to, replyTo: 'hello@semester-hq.com', subject: `[Test] ${r.subject}`, html: r.html, text: r.text });
      results.push({ key, sent: sent.sent, reason: sent.reason || '' });
    } catch (e) { results.push({ key, sent: false, reason: e.message.slice(0, 120) }); }
  }
  return new Response(JSON.stringify({ to, results }), { headers });
}

// POST /admin/onboarding-run?now=ISO, staging only: runs the daily sequence
// as if it were that moment, so two weeks of emails can be tested in minutes.
export async function handleAdminOnboardingRun(request, env) {
  const headers = { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (env.STAGING !== '1') return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
  if (!env.ADMIN_TOKEN || !(await adminTokenOk(request, env))) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  const asked = Date.parse(new URL(request.url).searchParams.get('now') || '');
  const out = await runOnboardingEmails(env, Number.isFinite(asked) ? asked : Date.now());
  return new Response(JSON.stringify(out), { headers });
}

// POST /admin/onboarding-start {email, plan, groupName?}, staging only: starts
// (or restarts the missing parts of) a customer's emails by hand, for
// testing without a second checkout. Anything already sent stays sent.
export async function handleAdminOnboardingStart(request, env) {
  const headers = { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (env.STAGING !== '1') return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
  if (!env.ADMIN_TOKEN || !(await adminTokenOk(request, env))) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  let body = {};
  try { body = await request.json(); } catch {}
  const plan = ['plus', 'group-admin', 'member'].includes(body.plan) ? body.plan : 'plus';
  await startCustomerEmails(env, { email: body.email, uid: body.uid || '', plan, sessionId: body.sessionId || 'by-hand', groupName: body.groupName || '', seats: body.seats || 0 });
  return new Response(JSON.stringify({ ok: true, plan }), { headers });
}

// Recent email activity for the business summary: counts only, no addresses.
export async function fetchEmailSummary(env) {
  const rows = await runFirestoreQuery(env, { from: [{ collectionId: 'emailOnboarding' }], limit: 1000 });
  const out = { people: 0, active: 0, finished: 0, stopped: {}, sent: {}, skipped: {}, optedOut: 0 };
  for (const row of rows) {
    const r = row.data || row;
    out.people++;
    if (r.active) out.active++;
    if (r.finishedAt) out.finished++;
    if (r.stopReason) out.stopped[r.stopReason] = (out.stopped[r.stopReason] || 0) + 1;
    if (r.stopReason === 'unsubscribed') out.optedOut++;
    for (const k of Object.keys(r.sent || {})) out.sent[k] = (out.sent[k] || 0) + 1;
    for (const k of Object.keys(r.skipped || {})) out.skipped[k] = (out.skipped[k] || 0) + 1;
  }
  return out;
}
