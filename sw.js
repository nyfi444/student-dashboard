/* ── Semester HQ service worker: offline support ───────────────────
   App files are network-first: online, you always get the latest deploy
   (and the cached copy is refreshed); offline, the cached copy loads
   instead. Third-party libraries and fonts are served from cache and
   refreshed in the background. Firebase, Stripe, and the AI Worker are
   never cached; your data stays in the app's own offline copy.

   Bump VERSION whenever you deploy, so open tabs can offer "Refresh to
   update" and old cached files get cleaned up.
──────────────────────────────────────────────────────────────── */
const VERSION = 'shq-2026-09-16-release11';
const APP_SHELL = [
  './', 'index.html', 'login.html', 'group-admin.html', 'manifest.json', 'css/styles.css',
  'assets/favicon.png', 'assets/apple-touch-icon.png', 'assets/icon-192.png', 'assets/icon-512.png',
  'js/config.js', 'js/diagnostics.js', 'js/utils.js', 'js/icons.js', 'js/colorwheel.js', 'js/state.js', 'js/firebase.js', 'js/ai.js', 'js/uploads.js',
  'js/checkout.js', 'js/groupplans.js', 'js/group-admin.js', 'js/ui.js', 'js/dashboard.js', 'js/courses.js', 'js/semestersetup.js', 'js/calendar.js', 'js/todos.js',
  'js/assignments.js', 'js/notebook.js', 'js/timer.js', 'js/exams.js', 'js/projects.js', 'js/studytools.js',
  'js/studygroups.js', 'js/career.js', 'js/capture.js', 'js/wrapped.js', 'js/classes.js', 'js/quickparse.js', 'js/syllabus.js', 'js/orgs.js', 'js/appearance.js', 'js/reminders.js', 'js/push.js', 'js/settings.js', 'js/palette.js', 'js/install.js', 'js/offline.js', 'js/app.js',
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
  // Android share sheet → Semester HQ: stash what was shared, then open the app.
  if (req.method === 'POST' && new URL(req.url).pathname === '/share-target') {
    event.respondWith(receiveShare(req));
    return;
  }
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

async function receiveShare(req) {
  try {
    const form = await req.formData();
    const cache = await caches.open('shq-share');
    await Promise.all((await cache.keys()).map(k => cache.delete(k)));
    const files = form.getAll('files').filter(f => f && typeof f === 'object' && f.size);
    await Promise.all(files.slice(0, 8).map((f, i) => cache.put(`/share-target/file-${i}`, new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream' } }))));
    const meta = { title: form.get('title') || '', text: form.get('text') || '', url: form.get('url') || '', files: files.slice(0, 8).map(f => ({ name: f.name, type: f.type })) };
    await cache.put('/share-target/meta', new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } }));
  } catch (e) {}
  return Response.redirect('/?shared=1', 303);
}
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

// Reminders sent by the Worker while the app is closed (see js/push.js).
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Semester HQ', body: event.data?.text() || '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Semester HQ', {
    body: data.body || '', tag: data.tag || 'semester-hq', icon: 'assets/icon-192.png', badge: 'assets/icon-192.png', data: { route: data.route || null },
  }));
});

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
