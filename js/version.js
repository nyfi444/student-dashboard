/* ── The one place the app's version number lives ─────────────────
   Loaded by every page AND imported by the service worker, so a
   deploy only ever needs this one line changed. The service worker
   names its cache after it, the app shows it in Settings, and
   diagnostics reports it, so "what version am I actually running?"
   always has the same answer.

   Bump this on every deploy. Changing it is what makes open tabs and
   installed home-screen apps notice there's something new.
──────────────────────────────────────────────────────────────── */
var APP_VERSION = '2026.09.20-r20';
if (typeof self !== 'undefined') self.APP_VERSION = APP_VERSION;
