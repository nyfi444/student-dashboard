/* ── Shared settings for every page (index, login, group-admin) ────
   Everything in this file ships to the browser, so it must stay public
   by design. The Firebase web config only names the project; access is
   enforced by firestore.rules and storage.rules. Every real secret (AI,
   Stripe, Firebase service account, email) lives in the Worker as a
   `wrangler secret`, never here.
──────────────────────────────────────────────────────────────── */
const FB_CONFIG = {
  apiKey: 'AIzaSyBruZ173x9OGtprhnJVO-8S7TY2taoSYQE',
  authDomain: 'semester-hq.firebaseapp.com',
  projectId: 'semester-hq',
  storageBucket: 'semester-hq.firebasestorage.app',
  messagingSenderId: '191691583510',
  appId: '1:191691583510:web:1a51e0b266c1257c4c8537',
};
// The one backend for AI, checkout, licensing, groups, push, and diagnostics.
const WORKER_URL = 'https://student-planner-ai-proxy.semesterhq.workers.dev';
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
                  deadlines and first group (js/setupcounts.js). */
const FEATURES = { linkCodes: false, setupCounts: false };
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
