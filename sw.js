/* ── Semester HQ service worker: offline support ───────────────────
   App files are network-first: online, you always get the latest deploy
   (and the cached copy is refreshed); offline, the cached copy loads
   instead. Third-party libraries and fonts are served from cache and
   refreshed in the background. Firebase, Stripe, and the AI Worker are
   never cached; your data stays in the app's own offline copy.

   Bump VERSION whenever you deploy, so open tabs can offer "Refresh to
   update" and old cached files get cleaned up.
──────────────────────────────────────────────────────────────── */
const VERSION = 'shq-2026-09-14-release1';
const APP_SHELL = [
  './', 'index.html', 'login.html', 'manifest.json', 'css/styles.css',
  'assets/favicon.png', 'assets/apple-touch-icon.png', 'assets/icon-192.png', 'assets/icon-512.png',
  'js/utils.js', 'js/icons.js', 'js/colorwheel.js', 'js/state.js', 'js/firebase.js', 'js/ai.js', 'js/errortracking.js',
  'js/checkout.js', 'js/ui.js', 'js/dashboard.js', 'js/courses.js', 'js/semestersetup.js', 'js/calendar.js', 'js/todos.js',
  'js/assignments.js', 'js/notebook.js', 'js/timer.js', 'js/exams.js', 'js/projects.js', 'js/studytools.js',
  'js/studygroups.js', 'js/reminders.js', 'js/settings.js', 'js/palette.js', 'js/offline.js', 'js/app.js',
];
const CDN_HOSTS = ['www.gstatic.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'api.fontshare.com', 'cdn.fontshare.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then(cache => Promise.all(APP_SHELL.map(url =>
    cache.add(new Request(url, { cache: 'reload' })).catch(() => {}) // one missing file shouldn't block install
  ))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/admin/') || url.pathname.endsWith('/sw.js')) return;
    event.respondWith(networkFirst(req));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) event.respondWith(staleWhileRevalidate(req));
  // Everything else (Firestore, Auth, Storage, Stripe, the Worker): straight to the network.
});

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetchWithTimeout(req, 6000);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    if (req.mode === 'navigate') {
      const shell = await cache.match('index.html') || await cache.match('./');
      if (shell) return shell;
    }
    return new Response('You’re offline and this page hasn’t been saved yet.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
}
async function staleWhileRevalidate(req) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(req);
  const refresh = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => null);
  return cached || (await refresh) || new Response('', { status: 504 });
}
function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then(r => { clearTimeout(timer); resolve(r); }, e => { clearTimeout(timer); reject(e); });
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = event.notification.data?.route;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = all.find(c => new URL(c.url).origin === self.location.origin);
    if (client) {
      await client.focus();
      if (route) client.postMessage({ type: 'open-route', route });
      return;
    }
    await self.clients.openWindow(route ? `./?open=${encodeURIComponent(route)}` : './');
  })());
});
