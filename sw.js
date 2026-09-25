/* ── Semester HQ service worker: offline support ───────────────────
   App files are network-first: online, you always get the latest deploy
   (and the cached copy is refreshed); offline, the cached copy loads
   instead. Third-party libraries and fonts are served from cache and
   refreshed in the background. Firebase, Stripe, and the AI Worker are
   never cached; your data stays in the app's own offline copy.

   The version comes from js/version.js, which the app loads too, so
   there's one line to bump per deploy and the page and the worker can
   never disagree about what's running.
──────────────────────────────────────────────────────────────── */
importScripts('./js/version.js');
const VERSION = 'shq-' + self.APP_VERSION;
const APP_SHELL = [
  './', 'index.html', 'login.html', 'group-admin.html', 'manifest.json', 'css/styles.css',
  'assets/favicon.png', 'assets/apple-touch-icon.png', 'assets/icon-192.png', 'assets/icon-512.png',
  'js/version.js', 'js/config.js', 'js/diagnostics.js', 'js/utils.js', 'js/sanitize.js', 'js/icons.js', 'js/colorwheel.js', 'js/state.js', 'js/firebase.js', 'js/ai.js', 'js/uploads.js',
  'js/authemail.js', 'js/checkout.js', 'js/setupcounts.js', 'js/groupplans.js', 'js/group-admin.js', 'js/ui.js', 'js/dashboard.js', 'js/courses.js', 'js/semestersetup.js', 'js/calendar.js', 'js/todos.js',
  'js/assignments.js', 'js/notebook.js', 'js/timer.js', 'js/exams.js', 'js/projects.js', 'js/studytools.js',
  'js/studygroups.js', 'js/career.js', 'js/capture.js', 'js/wrapped.js', 'js/classes.js', 'js/quickparse.js', 'js/syllabus.js', 'js/lmsfeed.js', 'js/orgs.js', 'js/appearance.js', 'js/reminders.js', 'js/settings.js', 'js/palette.js', 'js/install.js', 'js/offline.js', 'js/app.js',
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
  // The page asks what's actually running rather than guessing from cache
  // names, so Settings can show a version it's certain about.
  if (event.data === 'version' && event.ports?.[0]) event.ports[0].postMessage({ version: self.APP_VERSION });
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
    // Big libraries live in vendor/: served from cache, refreshed behind.
    if (url.pathname.includes('/vendor/')) { event.respondWith(staleWhileRevalidate(req)); return; }
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
// `cache: 'no-cache'` is the whole reason a deploy reaches an installed app.
// A plain fetch here goes through the browser's own HTTP cache, and GitHub
// Pages serves app files with `max-age=600`: for ten minutes after a deploy
// the worker would fetch the OLD file and write it over the fresh copy it
// just installed, which is how a home-screen app could sit on last week's
// code indefinitely. 'no-cache' revalidates with the server every time, so
// an unchanged file still costs only a 304 and nothing stale gets stored.
async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetchWithTimeout(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }), 6000);
    // A navigation with a query string can carry a one-time sign-in code or a
    // Stripe session id. The page is the same shell either way, so cache the
    // plain address and never the one with the secret in it.
    if (res && res.ok) cache.put(req.mode === 'navigate' && new URL(req.url).search ? new Request(new URL(req.url).pathname) : req, res.clone());
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
