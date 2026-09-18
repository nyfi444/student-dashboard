/* ── Offline support: service worker, connection banner, updates ───
   Deploys have to reach an installed home-screen app without anyone
   knowing to hard-refresh (there's no way to hard-refresh a home-screen
   app at all), so updating is deliberately pushy:
     · the worker revalidates every app file with the server (see sw.js),
       so a reload can never be served stale code;
     · a new version found in the first seconds after opening the app is
       applied silently, since nothing's been typed yet;
     · one found mid-session shows the banner instead, so an update never
       throws away what someone is in the middle of;
     · Settings can force the whole thing (see forceAppUpdate).
──────────────────────────────────────────────────────────────── */
const _bootedAt = Date.now();
window._swRegistration = null;
window._runningVersion = typeof APP_VERSION === 'string' ? APP_VERSION : '';

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || isEmbedded() || location.protocol === 'file:') return;
  // updateViaCache 'none' keeps sw.js itself (and js/version.js, which it
  // imports) out of the browser's HTTP cache, so the update check always
  // asks the server rather than trusting a ten-minute-old copy.
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    window._swRegistration = reg;
    const watch = (worker) => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        // A newer version finished installing while this tab runs the old one.
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(reg);
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg);
    reg.addEventListener('updatefound', () => watch(reg.installing));
    const check = () => reg.update().catch(() => {});
    check(); // don't wait for a tab switch to find out a deploy happened
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 30 * 60 * 1000);
    askWorkerVersion();
  }).catch((e) => diag.warn('offline', 'Service worker registration failed', e));

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !window._updateRequested) return;
    reloading = true;
    location.reload();
  });
}

// What the active worker says it is, which is the honest answer to "what
// version am I running?" even when an update is sitting there waiting.
function askWorkerVersion() {
  const sw = navigator.serviceWorker?.controller;
  if (!sw || !('MessageChannel' in window)) return;
  try {
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => { if (e.data?.version) window._runningVersion = e.data.version; };
    sw.postMessage('version', [channel.port2]);
  } catch {}
}

// An update found while the app is still warming up is applied on the spot:
// there's nothing half-typed to lose, and silently landing on the new version
// beats asking. Later in a session it's the banner's decision.
function offerUpdate(reg) {
  const midSomething = document.getElementById('modal-wrap')?.classList.contains('show');
  if (Date.now() - _bootedAt < 12000 && !midSomething) { applyUpdate(reg); return; }
  showUpdateBanner(reg);
}
function applyUpdate(reg) {
  window._updateRequested = true;
  if (reg?.waiting) reg.waiting.postMessage('skipWaiting');
  else location.reload();
}
function showUpdateBanner(reg) {
  if (document.getElementById('update-banner')) return;
  const el = document.createElement('div');
  el.id = 'update-banner';
  el.className = 'app-banner';
  el.innerHTML = `<span>A new version of Semester HQ is ready.</span><button class="btn btn-sm btn-primary" id="update-now">Refresh</button><button class="btn btn-ghost btn-icon btn-sm" aria-label="Later" id="update-later">${icon('x', 12, 2.2)}</button>`;
  document.body.appendChild(el);
  el.querySelector('#update-now').onclick = () => applyUpdate(reg);
  el.querySelector('#update-later').onclick = () => el.remove();
}

/* Settings' "Check for updates": says plainly whether there's anything new,
   and takes it if there is. Resolves to 'updating', 'current', or 'unknown'. */
async function checkForAppUpdate() {
  const reg = window._swRegistration || (navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null);
  if (!reg) return 'unknown';
  try { await reg.update(); } catch { return 'unknown'; }
  // reg.update() resolves before a freshly found worker finishes installing.
  const waiting = await new Promise((resolve) => {
    if (reg.waiting) return resolve(reg.waiting);
    const installing = reg.installing;
    if (!installing) return resolve(null);
    installing.addEventListener('statechange', () => { if (installing.state === 'installed') resolve(reg.waiting || installing); });
    setTimeout(() => resolve(reg.waiting), 8000);
  });
  if (!waiting) return 'current';
  applyUpdate(reg);
  return 'updating';
}

/* The last resort behind "Still on an old version?": throw away every cached
   file, drop the worker, and load the app fresh from the server. Planner data
   lives in localStorage and Firestore, never in these caches, so this only
   costs one slower load. */
async function forceAppUpdate() {
  try {
    if ('caches' in window) await Promise.all((await caches.keys()).map(k => caches.delete(k)));
    const regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : [];
    await Promise.all(regs.map(r => r.unregister()));
  } catch (e) { diag.warn('offline', 'Could not clear the app cache', e); }
  // A cache-busted URL so even the browser's own copy of the page is skipped.
  location.replace(location.pathname + '?fresh=' + Date.now());
}

function updateConnectionBanner() {
  const offline = !navigator.onLine;
  document.body.classList.toggle('is-offline', offline);
  let el = document.getElementById('offline-banner');
  if (!offline) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'offline-banner';
    el.className = 'app-banner offline';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.innerHTML = `<span class="offline-dot"></span><span>You’re offline. Everything you do is saved on this device and syncs when you’re back online.</span>`;
}
window.addEventListener('offline', updateConnectionBanner);
window.addEventListener('online', () => {
  updateConnectionBanner();
  toast('Back online', 'success', 2000);
  if (typeof readUnsyncedMarker === 'function' && readUnsyncedMarker() && typeof queueCloudSync === 'function') queueCloudSync();
  // A license check that couldn't reach the server earlier gets redone now.
  if (window._licenseOffline && _fbUser && typeof resolveLicenseStatus === 'function') {
    resolveLicenseStatus().then((status) => {
      if (status === null) return;
      window._licenseOffline = false;
      if (status !== window._licensed) { window._licensed = status; if (!status && typeof disablePersistentStorage === 'function') disablePersistentStorage(); render(); }
    });
  }
});
document.addEventListener('DOMContentLoaded', updateConnectionBanner);
setTimeout(updateConnectionBanner, 0);

// forceAppUpdate reloads with ?fresh=<timestamp> so the browser's own copy of
// the page is skipped too (there's no service worker left at that moment to
// guarantee it). Once loaded it has done its job, so it comes back out of the
// address bar rather than sticking around in anything anyone bookmarks.
(function dropFreshParam() {
  const params = new URLSearchParams(location.search);
  if (!params.has('fresh')) return;
  params.delete('fresh');
  history.replaceState({}, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
})();

// Deep link: app.semester-hq.com/?open=assignments lands on that page. Used by
// the installed app's shortcuts and by any link that wants to point at a
// specific page rather than the dashboard.
(function openRouteFromUrl() {
  const params = new URLSearchParams(location.search);
  const route = params.get('open');
  if (!route) return;
  params.delete('open');
  history.replaceState({}, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
  setTimeout(() => { if (typeof PAGES !== 'undefined' && PAGES[route]) setState({ route, subRoute: null }); }, 0);
})();
