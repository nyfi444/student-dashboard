/* ── Client-side crash reporting ───────────────────────────────
   Catches uncaught errors and unhandled promise rejections and reports
   them to the Worker's /log-error route, which is the only writer of
   Firestore's `errors` collection (see firestore.rules). Same Worker as
   AI_PROXY_URL (js/ai.js) — no separate URL to configure.
   Throttled client-side so a loop of repeated errors doesn't spam the
   endpoint; the Worker also rate-limits per IP as a backstop.
──────────────────────────────────────────────────────────────── */
(function () {
  const LOG_ERROR_URL = (typeof AI_PROXY_URL !== 'undefined' ? AI_PROXY_URL : '').replace(/\/v1\/messages$/, '') + '/log-error';
  const MAX_REPORTS_PER_SESSION = 20;
  let reportCount = 0;

  function report(message, stack) {
    if (!LOG_ERROR_URL || reportCount >= MAX_REPORTS_PER_SESSION) return;
    reportCount++;
    try {
      fetch(LOG_ERROR_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'app',
          message: String(message || 'Unknown error').slice(0, 2000),
          stack: String(stack || '').slice(0, 4000),
          url: window.location.href,
          userAgent: navigator.userAgent,
        }),
        keepalive: true,
      }).catch(() => {}); // never let the reporter itself throw
    } catch { /* ignore */ }
  }

  window.addEventListener('error', (event) => {
    report(event.message, event.error && event.error.stack);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    report(reason && reason.message ? reason.message : String(reason), reason && reason.stack);
  });
})();
