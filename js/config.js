/* ── Shared settings for every page (index, login, group-admin) ────
   Everything in this file ships to the browser, so it must stay public
   by design. The Firebase web config only names the project; access is
   enforced by firestore.rules and storage.rules. Every real secret (AI,
   Stripe, Firebase service account, email) lives in the Worker as a
   `wrangler secret`, never here.
──────────────────────────────────────────────────────────────── */
// Production is only these hosts. Everything else (a branch Preview, a
// version URL, localhost) is staging: its own Worker, its own Firebase
// project, Stripe in test mode, and email only to the people testing. A
// preview can never reach a real student's data, card or inbox.
const PRODUCTION_HOSTS = ['app.semester-hq.com', 'semester-hq.com', 'www.semester-hq.com'];
const IS_PRODUCTION = typeof location !== 'undefined' && PRODUCTION_HOSTS.includes(location.hostname);
const FB_CONFIG_PRODUCTION = {
  apiKey: 'AIzaSyBruZ173x9OGtprhnJVO-8S7TY2taoSYQE',
  authDomain: 'semester-hq.firebaseapp.com',
  projectId: 'semester-hq',
  storageBucket: 'semester-hq.firebasestorage.app',
  messagingSenderId: '191691583510',
  appId: '1:191691583510:web:1a51e0b266c1257c4c8537',
};
// The semester-hq-staging project's web config (public, like the one
// above). Everything that isn't production signs in here, so no preview or
// local test can ever reach a real student's account or data.
const FB_CONFIG_STAGING = {
  apiKey: 'AIzaSyBSaYf1B3YePm8GcB9H3iXfIevgW_QiWkA',
  authDomain: 'semester-hq-staging.firebaseapp.com',
  projectId: 'semester-hq-staging',
  storageBucket: 'semester-hq-staging.firebasestorage.app',
  messagingSenderId: '1049568623784',
  appId: '1:1049568623784:web:baaceb04b8d8a4c609569d',
};
const FB_CONFIG = IS_PRODUCTION ? FB_CONFIG_PRODUCTION : FB_CONFIG_STAGING;
// The one backend for AI, checkout, licensing, groups, and diagnostics.
// Staging is the same code deployed with `wrangler deploy --env staging`.
const WORKER_URL = IS_PRODUCTION
  ? 'https://student-planner-ai-proxy.semesterhq.workers.dev'
  : 'https://student-planner-ai-proxy-staging.semesterhq.workers.dev';
// Cloudflare's published always-pass Turnstile key, for staging only: the
// real widget refuses every host but ours, and the staging Worker has no
// Turnstile secret, so nothing is checked there.
const TURNSTILE_TEST_SITEKEY = '1x00000000000000000000AA';
// A small corner label on preview addresses, so a staging page is never
// mistaken for the real app. Not on localhost, where the product images
// are taken.
if (!IS_PRODUCTION && typeof document !== 'undefined' && /\.workers\.dev$/.test(location.hostname)) {
  document.addEventListener('DOMContentLoaded', () => {
    const tag = document.createElement('div');
    tag.textContent = 'Staging · test data only';
    tag.setAttribute('aria-hidden', 'true');
    tag.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:2147483647;pointer-events:none;font:600 11px/1 -apple-system,system-ui,sans-serif;letter-spacing:.02em;color:#F8F6F2;background:#121212;padding:6px 9px;border-radius:999px;opacity:.85';
    document.body.appendChild(tag);
  });
}
// Sign-in state shared by login.html, the app, and group-admin.html.
const AGE_TOS_KEY = 'shq_age_tos_confirmed';
const EMAIL_LINK_STORAGE_KEY = 'shq_email_for_signin';

/* ── Switches for work that ships turned off ───────────────────────
   Flip one to true and deploy (bumping js/version.js as always).
     linkCodes    a ?via= link code on the way in is kept for the tab and
                  sent with checkout, so sign-ups from one of Nyla's links
                  can be counted (worker/src/checkouts.js). Nothing else
                  about the visitor goes with it.
     setupCounts  anonymous counts of a new account's first class, first
                  deadlines and first group (js/setupcounts.js).
     usageCounts  anonymous weekly counts: active accounts, which features
                  get used, and who comes back on day 2, 7 and 30
                  (js/usagecounts.js). */
const FEATURES = { linkCodes: false, setupCounts: true, usageCounts: true };
// A link code is a short label on Nyla's own links (?via=campus-tour). The
// Worker checks the same pattern and drops anything that doesn't match.
const LINK_CODE_KEY = 'shq_via';
const LINK_CODE_RE = /^[a-z0-9-]{2,24}$/;
// The link code kept for this tab, or '' (always '' while linkCodes is off).
// A code in this page's own URL is kept first, which is how login.html
// holds on to it through the age and Terms step and either way of signing
// in, and hands it on to the app and group-admin.html in the same tab.
function linkCode() {
  if (!FEATURES.linkCodes) return '';
  try {
    const fromUrl = (new URLSearchParams(location.search).get('via') || '').trim().toLowerCase();
    if (LINK_CODE_RE.test(fromUrl)) sessionStorage.setItem(LINK_CODE_KEY, fromUrl);
    const kept = sessionStorage.getItem(LINK_CODE_KEY) || '';
    return LINK_CODE_RE.test(kept) ? kept : '';
  } catch { return ''; }
}
