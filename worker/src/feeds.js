/* ── worker/src/feeds.js ────────────────────────────────────────
   LMS calendar feeds (/calendar-feed): a narrow, paid-only URL fetcher
   for Canvas, Blackboard and Brightspace calendars. Job 10 in index.js.
──────────────────────────────────────────────────────────────── */

import { logServerIssue } from './diagnostics.js';
import { readFirestoreDoc, verifyFirebaseIdToken } from './firebase.js';
import { jsonError, jsonOk, underDailyCap } from './http.js';

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
export async function handleCalendarFeed(request, env, origin) {
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
