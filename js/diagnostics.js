/* ── Diagnostics: crash reports, feature issues, breadcrumbs ──────
   Loaded right after js/config.js on every page, so it sees failures
   from anything that loads later. Reports go to the Worker's /log-error
   route, the only writer of Firestore's `errors` collection, and show
   up grouped by feature in admin/errors.html.

   What's automatic:
   - Uncaught errors and unhandled rejections (feature taken from the
     file in the stack, e.g. js/studygroups.js → studygroups).
   - Every Worker call is a breadcrumb; a network failure or a 5xx from
     the Worker is reported, tagged with the feature it belongs to.
   - Views (from render in js/app.js) and going offline/online.

   What features call:
   - diag.warn(feature, message, err, extra): something failed but the
     app recovered (sync retried, a fallback ran).
   - diag.error(feature, message, err, extra): something failed that the
     person noticed (checkout didn't open, a sign-in link didn't work).
   - diag.crumb(category, message): a note for the trail before a failure.

   Privacy: never pass planner content, file names, or emails. Messages
   are scrubbed of emails, tokens, and URL parameter values anyway; the
   page is sent as its path plus parameter names only. The session code
   is random per tab and isn't linked to the account.
──────────────────────────────────────────────────────────────── */
const diag = (() => {
  const ENDPOINT = typeof WORKER_URL !== 'undefined' && WORKER_URL ? `${WORKER_URL}/log-error` : '';
  const nativeFetch = window.fetch.bind(window); // reports bypass the Worker-call wrapper below
  const MAX_REPORTS = 25;
  const MAX_CRUMBS = 25;
  const started = Date.now();
  const crumbs = [];
  const recent = [];
  const seen = new Set();
  let sent = 0;
  // js/version.js is loaded before this file on every page, so the running
  // version is simply known rather than inferred from cache names.
  let release = typeof APP_VERSION === 'string' ? APP_VERSION : '';

  let session = '';
  try { session = sessionStorage.getItem('shq_diag_session') || ''; } catch {}
  if (!session) {
    session = Math.random().toString(36).slice(2, 10).toUpperCase();
    try { sessionStorage.setItem('shq_diag_session', session); } catch {}
  }
  // Kept as a fallback for a page that somehow loads without js/version.js:
  // the service worker names its cache after the same version (see sw.js).
  const lookupRelease = () => {
    if (release) return Promise.resolve();
    try { return caches.keys().then(keys => { release = (keys.filter(k => /^shq-/.test(k)).pop() || '').replace(/^shq-/, '') || release; }).catch(() => {}); }
    catch { return Promise.resolve(); }
  };
  lookupRelease();

  const scrub = (text, max) => String(text ?? '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, '[token]')
    .replace(/([?&#][\w-]+=)[^&#\s'")]+/g, '$1…')
    .slice(0, max);
  // Stack frames keep file:line:col but lose any query string.
  const scrubStack = (stack) => scrub(String(stack ?? '').replace(/\?[^\s:)]*(?=:\d+:\d+)/g, ''), 4000);
  const pagePath = () => {
    const keys = [...new URLSearchParams(location.search).keys()];
    return location.pathname + (keys.length ? `?${keys.join('&')}` : '');
  };
  const featureFromStack = (stack) => (String(stack || '').match(/\/js\/([\w-]+)\.js/) || [])[1]
    || (location.pathname.endsWith('login.html') ? 'login' : 'app');

  function context() {
    const c = {
      online: navigator.onLine,
      installed: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
      embedded: window.self !== window.top,
      offlineReady: !!navigator.serviceWorker?.controller,
      viewport: `${innerWidth}x${innerHeight}`,
    };
    try { if (typeof state !== 'undefined') { c.route = state.route; if (state.subRoute) c.subRoute = 'yes'; } } catch {}
    try { if (typeof _fbUser !== 'undefined') { c.signedIn = !!_fbUser; c.plus = !!window._licensed; } } catch {}
    return c;
  }

  function crumb(category, message) {
    crumbs.push(`+${((Date.now() - started) / 1000).toFixed(1)}s ${category} ${scrub(message, 120)}`);
    if (crumbs.length > MAX_CRUMBS) crumbs.shift();
  }

  function report(level, feature, message, err, extra) {
    const errMessage = err && (err.message || (typeof err === 'string' ? err : ''));
    const text = scrub(errMessage && errMessage !== message ? `${message}: ${errMessage}` : message || errMessage || 'Unknown error', 2000);
    const details = { ...(extra || {}) };
    if (err?.code) details.code = String(err.code);
    if (err?.name && err.name !== 'Error') details.name = err.name;
    recent.push(`${level} ${feature}: ${text.slice(0, 160)}`);
    if (recent.length > 10) recent.shift();
    // Expected while offline (Firestore says "unavailable"), so it's a trail note, not a report.
    if (!navigator.onLine || err?.code === 'unavailable') { crumb('offline-issue', `${feature}: ${text}`); return; }
    if (/ResizeObserver loop|^Script error\.?$/.test(text) || /-extension:\/\//.test(err?.stack || '')) return;
    const key = `${level}|${feature}|${text}`;
    if (!ENDPOINT || seen.has(key) || sent >= MAX_REPORTS) return;
    seen.add(key);
    sent++;
    const body = { source: 'app', level, feature, message: text, stack: scrubStack(err?.stack), page: pagePath(), session, userAgent: navigator.userAgent, breadcrumbs: crumbs.slice(), context: { ...context(), ...details } };
    (release ? Promise.resolve() : lookupRelease()).then(() => nativeFetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ ...body, release }),
    })).catch(() => {}); // the reporter must never throw
    crumb(level, `${feature}: ${text}`);
  }

  // Worker calls: always a breadcrumb; network failures and 5xx get reported.
  const WORKER_FEATURES = [
    [/^\/v1\/messages/, 'ai'], [/^\/create-(checkout|portal)-session/, 'checkout'], [/^\/(claim-license|check-email)/, 'license'],
    [/^\/group\//, 'group-plans'], [/^\/push-test/, 'push'], [/^\/delete-account/, 'account'], [/^\/contact-message/, 'feedback'],
  ];
  if (ENDPOINT) {
    window.fetch = function (input, init) {
      const pending = nativeFetch(input, init);
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.startsWith(WORKER_URL)) {
        const path = url.slice(WORKER_URL.length).split('?')[0];
        const feature = (WORKER_FEATURES.find(([re]) => re.test(path)) || [])[1] || 'worker';
        const t0 = Date.now();
        pending.then(res => {
          crumb('worker', `${path} ${res.status} ${Date.now() - t0}ms`);
          if (res.status >= 500) report('error', feature, `Worker ${path} returned ${res.status}`, null, { status: res.status });
        }, err => {
          crumb('worker', `${path} failed ${Date.now() - t0}ms`);
          report('error', feature, `Worker ${path} unreachable`, err);
        });
      }
      return pending;
    };
  }

  window.addEventListener('error', (event) => {
    report('error', featureFromStack(event.error?.stack || event.filename), event.error?.message || event.message, event.error, { uncaught: true });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    report('error', featureFromStack(reason?.stack), reason?.message || String(reason), reason, { uncaught: true });
  });
  window.addEventListener('offline', () => crumb('network', 'offline'));
  window.addEventListener('online', () => crumb('network', 'online'));

  const log = (level, method) => (feature, message, err, extra) => {
    console[method](`[${feature}] ${message}`, err ?? '');
    report(level, feature, message, err, extra);
  };

  return {
    session,
    crumb,
    warn: log('warn', 'warn'),
    error: log('error', 'error'),
    // Plain text for someone to paste into a support email. No content, no account details.
    async summary() {
      if (!release) await lookupRelease();
      return [
        `Support code: ${session}`,
        `Version: ${release || 'unknown'}`,
        `Page: ${pagePath()}`,
        `Details: ${JSON.stringify(context())}`,
        `Browser: ${navigator.userAgent}`,
        '', 'Recent problems:', ...(recent.length ? recent : ['none']),
        '', 'Recent activity:', ...(crumbs.length ? crumbs : ['none']),
      ].join('\n');
    },
  };
})();
