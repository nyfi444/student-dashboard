/* ── Offline support: service worker, connection banner, updates ─── */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || isEmbedded() || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const watch = (worker) => {
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        // A newer version finished installing while this tab runs the old one.
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(reg);
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg);
    reg.addEventListener('updatefound', () => watch(reg.installing));
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 60 * 60 * 1000);
  }).catch((e) => diag.warn('offline', 'Service worker registration failed', e));

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !window._updateRequested) return;
    reloading = true;
    location.reload();
  });
}
function showUpdateBanner(reg) {
  if (document.getElementById('update-banner')) return;
  const el = document.createElement('div');
  el.id = 'update-banner';
  el.className = 'app-banner';
  el.innerHTML = `<span>A new version of Semester HQ is ready.</span><button class="btn btn-sm btn-primary" id="update-now">Refresh</button><button class="btn btn-ghost btn-icon btn-sm" aria-label="Later" id="update-later">${icon('x', 12, 2.2)}</button>`;
  document.body.appendChild(el);
  el.querySelector('#update-now').onclick = () => {
    window._updateRequested = true;
    if (reg.waiting) reg.waiting.postMessage('skipWaiting'); else location.reload();
  };
  el.querySelector('#update-later').onclick = () => el.remove();
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
