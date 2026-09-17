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
