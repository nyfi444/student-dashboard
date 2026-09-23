/* ── What's actually live, checked after the deploy ────────────────
   The other tests in this folder prove the code is right before it
   ships. This one proves the ship happened. It talks to production
   over the network and asserts nothing about logic — only the things
   that go wrong between "git push" and a student opening the app:

     1. The build that's serving is the build in this checkout. The one
        line in js/version.js is what the service worker names its cache
        after, so a deploy that didn't land, or one that landed without
        the version bumped, leaves installed apps on the old code
        forever and nothing on screen says so.
     2. Every file index.html asks for exists live. A script that was
        written but never committed is a white screen on every device
        at once, and the script order comment in index.html explains
        why one missing file takes the whole app down.
     3. The headers Cloudflare is supposed to add are still there.
        A zone setting reverting is silent.
     4. The Worker still refuses what it's supposed to refuse: a
        disallowed origin, an unauthenticated admin call, a calendar
        feed without a login. These are read-only probes — every one
        of them is rejected before the Worker does any work, so this
        writes nothing, sends no email, and costs nothing to run.

   Run after every deploy:  node tests/smoke.mjs
   Straight after a push:    node tests/smoke.mjs --wait 180
   Against somewhere else:  node tests/smoke.mjs --app https://... --site https://... --worker https://...
──────────────────────────────────────────────────────────────── */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');

/* Where to look. The defaults are production; --app/--site/--worker point
   this at a preview deploy instead. */
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1].replace(/\/$/, '') : fallback;
};
const APP = arg('app', 'https://app.semester-hq.com');
const SITE = arg('site', 'https://semester-hq.com');
// The app's own config is the source of truth for where its backend is, so
// this can't drift from what the browser actually calls.
const WORKER = arg('worker', (read('js/config.js').match(/WORKER_URL\s*=\s*'([^']+)'/) || [])[1]);

let failed = 0, passed = 0;
const pass = (name) => { passed++; console.log(`  ok    ${name}`); };
const fail = (name, detail) => { failed++; console.error(`  FAIL  ${name}\n        ${detail}`); };
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  a === e ? pass(name) : fail(name, `expected ${e}, got ${a}`);
};
const ok = (name, value, detail = '') => (value ? pass(name) : fail(name, detail || 'expected true'));
const group = (title) => console.log(`\n${title}`);

/* Production is behind a CDN. Every request here is cache-busted and sent
   with no-store, because a cached 200 from before the deploy would make
   this whole file lie — which is the one thing it must never do. */
async function get(url) {
  const bust = `${url}${url.includes('?') ? '&' : '?'}_smoke=${Date.now()}`;
  try {
    const res = await fetch(bust, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' }, redirect: 'follow' });
    return { status: res.status, headers: res.headers, body: await res.text() };
  } catch (e) {
    return { status: 0, headers: new Headers(), body: '', error: e.message };
  }
}
async function post(url, { origin = APP, body = {}, headers = {} } = {}) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}), ...headers },
      body: JSON.stringify(body),
    });
    return { status: res.status, headers: res.headers, body: await res.text() };
  } catch (e) {
    return { status: 0, headers: new Headers(), body: '', error: e.message };
  }
}

console.log(`Smoke test\n  app     ${APP}\n  site    ${SITE}\n  worker  ${WORKER}`);

/* ── 1. The build that's live is this one ──────────────────────── */
group('The deploy landed');
const localVersion = (read('js/version.js').match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
ok('this checkout has a version number', !!localVersion, 'js/version.js has no APP_VERSION');

const home = await get(`${APP}/`);
check('the app answers 200', home.status, 200);
ok('the app is the app, not a 404 page', home.body.includes('<div id="app">'), 'index.html did not contain the app shell');

/* --wait gives the host time to publish. A deploy to GitHub Pages takes
   a minute or so, and "the version is still the old one" is the right
   answer at second five and the wrong one at second ninety — so poll
   rather than guess a sleep. */
const waitSeconds = Number(arg('wait', '0')) || 0;
const servedVersionNow = async () =>
  ((await get(`${APP}/js/version.js`)).body.match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
let servedVersion = await servedVersionNow();
if (servedVersion !== localVersion && waitSeconds > 0) {
  const until = Date.now() + waitSeconds * 1000;
  process.stdout.write(`  ...waiting up to ${waitSeconds}s for ${localVersion} to go live`);
  while (servedVersion !== localVersion && Date.now() < until) {
    await new Promise(r => setTimeout(r, 5000));
    process.stdout.write('.');
    servedVersion = await servedVersionNow();
  }
  process.stdout.write('\n');
}
if (servedVersion === localVersion) {
  pass(`the live version is this build (${localVersion})`);
} else {
  fail('the live version is this build',
    `this checkout is ${localVersion}, production is serving ${servedVersion || '(none)'}.\n` +
    '        Either the deploy has not finished, or js/version.js was not bumped —\n' +
    '        without the bump, installed apps keep running the old code.');
}

/* Every file index.html asks for, taken from index.html itself so this list
   can never fall behind the app. */
group('Every file the app loads exists');
const localIndex = read('index.html');
const assets = [
  ...localIndex.matchAll(/<script[^>]+src="((?!https?:)[^"]+)"/g),
  ...localIndex.matchAll(/<link[^>]+href="((?!https?:)[^"]+\.css)"/g),
].map(m => m[1]);
ok('index.html lists its own assets', assets.length > 10, `only found ${assets.length}`);
const missing = [];
// Sequentially, not all at once: a few dozen parallel requests to the same
// host is the shape of an attack, and this is meant to be safe to run often.
for (const asset of assets) {
  const res = await get(`${APP}/${asset}`);
  if (res.status !== 200) missing.push(`${asset} → ${res.status || res.error}`);
}
missing.length === 0
  ? pass(`all ${assets.length} scripts and stylesheets are served`)
  : fail('all scripts and stylesheets are served', missing.join('\n        '));

for (const [name, path] of [['the service worker', '/sw.js'], ['the manifest', '/manifest.json'], ['the login page', '/login.html'], ['the group admin page', '/group-admin.html']]) {
  const res = await get(`${APP}${path}`);
  check(`${name} is served`, res.status, 200);
}
const sw = await get(`${APP}/sw.js`);
ok('the service worker reads the version file', /version\.js/.test(sw.body), 'sw.js no longer imports js/version.js, so its cache name cannot change on deploy');
const manifest = await get(`${APP}/manifest.json`);
try { JSON.parse(manifest.body); pass('the manifest is valid JSON'); }
catch (e) { fail('the manifest is valid JSON', e.message); }

/* ── 2. The headers Cloudflare adds ────────────────────────────── */
group('The headers are still on');
for (const [label, res] of [['app', home], ['site', await get(`${SITE}/`)]]) {
  check(`the ${label} answers 200`, res.status, 200);
  const hsts = res.headers.get('strict-transport-security') || '';
  const age = Number((hsts.match(/max-age=(\d+)/) || [])[1] || 0);
  ok(`the ${label} sends HSTS for at least 180 days`, age >= 15552000, `strict-transport-security: ${hsts || '(absent)'}`);
  ok(`the ${label} sends a referrer policy`, !!res.headers.get('referrer-policy'), 'referrer-policy is absent');
  ok(`the ${label} sends a permissions policy`, !!res.headers.get('permissions-policy'), 'permissions-policy is absent');
}
ok('only Semester HQ may frame the app',
  /frame-ancestors/.test(home.headers.get('content-security-policy') || ''),
  `content-security-policy: ${home.headers.get('content-security-policy') || '(absent)'}`);

/* ── 3. The marketing site's pages ─────────────────────────────
   Taken from the live sitemap rather than a list kept here, for two
   reasons: the list can never fall behind the site, and a sitemap that
   advertises a page which no longer exists is itself the bug — it is
   what search engines and the footer links follow. */
group('The site is up');
check('the site answers 200', (await get(`${SITE}/`)).status, 200);
const sitemap = await get(`${SITE}/sitemap.xml`);
check('the sitemap is served', sitemap.status, 200);
const urls = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
ok('the sitemap lists pages', urls.length > 0, 'no <loc> entries found');
const dead = [];
for (const u of urls) {
  const res = await get(u);
  if (res.status !== 200) dead.push(`${u} → ${res.status || res.error}`);
}
dead.length === 0
  ? pass(`all ${urls.length} pages in the sitemap are served`)
  : fail('all pages in the sitemap are served', dead.join('\n        '));

/* ── 4. The Worker still refuses what it should ─────────────────
   Every probe below is rejected at the door: no token is spent, no row is
   written, no email is sent. A 500 here would be as much of a failure as a
   200 — it would mean the refusal path itself broke. */
group('The Worker holds its boundaries');
ok('the app knows where its backend is', !!WORKER, 'WORKER_URL not found in js/config.js');
if (WORKER) {
  const fromElsewhere = await post(`${WORKER}/v1/messages`, { origin: 'https://not-semester-hq.example' });
  check('a request from another site is refused', fromElsewhere.status, 403);

  const unknown = await post(`${WORKER}/definitely-not-a-route`);
  check('an unknown route is a clean 404', unknown.status, 404);

  const wrongMethod = await get(`${WORKER}/v1/messages`);
  check('a GET where only POST is allowed is a clean 405', wrongMethod.status, 405);

  // One strike per run against this machine's IP: adminTokenOk counts every
  // tokenless call, and at 20 in an hour it refuses even the right token for
  // the rest of that hour. That brake is working as intended; it just means
  // this file shouldn't be run in a tight loop from the same network the
  // business dashboard is opened from. CI runs it from GitHub's IPs.
  const admin = await get(`${WORKER}/admin/errors`);
  check('the admin feed needs its token', admin.status, 401);

  const feed = await post(`${WORKER}/calendar-feed`);
  check('a calendar feed needs a signed-in account', feed.status, 401);

  /* CORS is what lets the app's own JavaScript read a reply. The Worker
     answers a preflight from anywhere, so the check that matters is that it
     never names the asking origin unless that origin is allowed. */
  const preflight = async (origin) => {
    const res = await fetch(`${WORKER}/v1/messages`, { method: 'OPTIONS', headers: { Origin: origin } });
    return res.headers.get('access-control-allow-origin') || '';
  };
  check('the app is allowed to read replies', await preflight(APP), APP);
  const stranger = await preflight('https://not-semester-hq.example');
  ok('another site is not', stranger !== 'https://not-semester-hq.example' && stranger !== '*', `access-control-allow-origin: ${stranger}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
