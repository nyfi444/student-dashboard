/* ── Every URL, before and after a hosting move ─────────────────────
   Written for the move from GitHub Pages to Cloudflare Workers
   (Sept 2026), kept because it is the check to run any time the way
   the two sites are served changes.

   It collects every address a person or a search engine can reach:

     - every <loc> in the site's sitemap.xml
     - every canonical tag
     - every internal link, script, stylesheet, image, icon and manifest
       entry, found by crawling every page on both sites
     - every file in both repos (when the folders are given), which
       covers files only JavaScript asks for (sw.js's app shell, pdf.js)
     - robots.txt, sitemap.xml, llms.txt, 404.html, manifest.json
     - /name for every /name.html, because GitHub Pages answered both

   and for each one asks the TARGET (the new hosting) and the REFERENCE
   (what is live today) the same question. It passes only if the target
   answers 200, with no redirect, the same content type, and the same
   bytes as the reference. Same bytes is the point: it proves "the same
   page", not "some page".

   It also checks that a made-up address answers 404 with the right 404
   page, that the security headers are on every HTML page, and it lists
   every file the reference serves that the target does not (the files
   .assetsignore keeps off the site on purpose), so that list is read
   by a person rather than discovered by one.

   Before cutover (preview vs GitHub Pages):
     node tests/check-urls.mjs --site https://<preview>.workers.dev \
       --app https://<preview>.workers.dev --site-dir ../semester-hq-site --app-dir .
   After cutover, against the same domains, compare with a saved run:
     node tests/check-urls.mjs --snapshot-out before.json   (before)
     node tests/check-urls.mjs --snapshot-in before.json    (after)

   Node 20+, no dependencies. Exits 1 on any failure.
──────────────────────────────────────────────────────────────── */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1].replace(/\/$/, '') : fallback;
};

const LIVE = { site: 'https://semester-hq.com', app: 'https://app.semester-hq.com' };
const TARGET = { site: arg('site', LIVE.site), app: arg('app', LIVE.app) };
const REF = { site: arg('ref-site', LIVE.site), app: arg('ref-app', LIVE.app) };
const DIRS = { site: arg('site-dir', null), app: arg('app-dir', null) };
const SNAP_IN = arg('snapshot-in', null);
const SNAP_OUT = arg('snapshot-out', null);

// Security headers every HTML page must carry on the target.
const REQUIRED_HEADERS = {
  site: ['strict-transport-security', 'x-content-type-options', 'referrer-policy',
    'x-frame-options', 'content-security-policy-report-only'],
  app: ['strict-transport-security', 'x-content-type-options', 'referrer-policy',
    'permissions-policy', 'content-security-policy', 'content-security-policy-report-only'],
};
// The app is framed by the marketing site's demo; this must never narrow.
const APP_FRAME_ANCESTORS = "frame-ancestors 'self' https://semester-hq.com https://www.semester-hq.com";

const failures = [];
const fail = (msg) => failures.push(msg);
const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

/* Two differences that are not differences:
   - JavaScript: GitHub says application/javascript, Workers says
     text/javascript. The HTML spec prefers the second; browsers treat
     them the same. JSON: GitHub adds charset=utf-8, Workers doesn't;
     JSON is UTF-8 by definition (RFC 8259), so the label changes nothing.
   - Email obfuscation: the semester-hq.com zone's Scrape Shield rewrites
     every email address in HTML on the way out (a /cdn-cgi/ link plus a
     decode script). That happens at Cloudflare's edge, so a workers.dev
     preview doesn't get it and the live domain does. Decode it before
     comparing, so "same bytes" means the same page underneath. */
/* Charset: Workers labels text types without charset=utf-8, GitHub Pages
   labelled them with it. For HTML that is only safe because every page
   declares <meta charset> in its first 1024 bytes, which this script
   checks separately. CSS and classic scripts take the page's encoding;
   module scripts, service workers and JSON are always UTF-8. text/plain
   and text/markdown have no such fallback, so they must match exactly
   (_headers sets them). */
const LABEL_FREE = /^(text\/html|text\/css|text\/javascript|application\/json);charset=utf-8$/;
const normType = (t) => t.replace('application/javascript', 'text/javascript').replace(LABEL_FREE, '$1');
const sameType = (a, b) => normType(a) === normType(b);
function cfDecode(hex) {
  const key = parseInt(hex.slice(0, 2), 16); let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}
function unobfuscate(buf, type) {
  if (!type.startsWith('text/html')) return buf;
  let s = buf.toString('utf8');
  if (!s.includes('__cf_email__') && !s.includes('/cdn-cgi/l/email-protection')) return buf;
  s = s.replace(/<script data-cfasync="false" src="\/cdn-cgi\/scripts\/[^"]+\/cloudflare-static\/email-decode\.min\.js"><\/script>/g, '')
    .replace(/<a href="\/cdn-cgi\/l\/email-protection" class="__cf_email__" data-cfemail="([0-9a-f]+)">\[email&#160;protected\]<\/a>/g, (_, h) => cfDecode(h))
    .replace(/<span class="__cf_email__" data-cfemail="([0-9a-f]+)">\[email&#160;protected\]<\/span>/g, (_, h) => cfDecode(h))
    .replace(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/g, (_, h) => 'mailto:' + cfDecode(h));
  return Buffer.from(s, 'utf8');
}
const pageHash = (r) => sha(unobfuscate(r.body, r.type));

async function get(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { redirect: 'manual', headers: { 'cache-control': 'no-cache', 'user-agent': 'semester-hq-url-check' } });
      const body = Buffer.from(await res.arrayBuffer());
      return { status: res.status, location: res.headers.get('location'), type: (res.headers.get('content-type') || '').toLowerCase().replace(/\s+/g, ''), headers: res.headers, body };
    } catch (e) {
      if (i >= tries) return { status: 0, error: e.message, body: Buffer.alloc(0), headers: new Headers(), type: '' };
      await new Promise(r => setTimeout(r, 500 * i));
    }
  }
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

/* Which site a URL belongs to, and its path. Only our two hosts count. */
function classify(href, baseUrl) {
  let u; try { u = new URL(href, baseUrl); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.host;
  const which = [['site', LIVE.site], ['app', LIVE.app], ['site', REF.site], ['app', REF.app], ['site', TARGET.site], ['app', TARGET.app]]
    .find(([, b]) => new URL(b).host === host);
  if (!which && host === 'www.semester-hq.com') return null; // www is a redirect by design, checked separately
  if (!which) return null;
  // /cdn-cgi/ is answered by Cloudflare's edge on the zone, never by the site.
  if (u.pathname.startsWith('/cdn-cgi/')) return null;
  return { which: which[0], path: decodeURI(u.pathname) };
}

function linksIn(html, pageUrl) {
  const found = [];
  const attr = /\b(?:href|src|content|data-src)\s*=\s*["']([^"']+)["']/gi;
  const srcset = /\b(?:srcset|imagesrcset)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = attr.exec(html))) found.push(m[1]);
  while ((m = srcset.exec(html))) m[1].split(',').forEach(part => found.push(part.trim().split(/\s+/)[0]));
  return found.map(h => classify(h, pageUrl)).filter(Boolean);
}

function repoFiles(dir) {
  if (!dir || !existsSync(dir)) return [];
  const ignore = existsSync(resolve(dir, '.assetsignore'))
    ? readFileSync(resolve(dir, '.assetsignore'), 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'))
    : [];
  const files = execFileSync('git', ['-C', dir, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const ignored = (f) => ignore.some(p => {
    const base = p.replace(/\/\*\*$/, '');
    if (p.startsWith('**/')) return f.split('/').pop() === p.slice(3);
    return f === base || f.startsWith(base + '/');
  });
  return files.map(f => ({ path: '/' + f, served: !ignored(f) && !/^_(headers|redirects)$/.test(f) }));
}

/* ── 1. Collect every address ───────────────────────────────────── */
const want = { site: new Map(), app: new Map() }; // path -> reason
const add = (which, path, why) => { if (!want[which].has(path)) want[which].set(path, why); };
const excluded = { site: [], app: [] };

for (const which of ['site', 'app']) {
  for (const f of repoFiles(DIRS[which])) {
    if (f.served) add(which, f.path, 'repo file'); else excluded[which].push(f.path);
  }
}
['/', '/robots.txt', '/sitemap.xml', '/llms.txt', '/404.html'].forEach(p => add('site', p, 'must work'));
['/', '/login.html', '/group-admin.html', '/manifest.json', '/sw.js', '/js/version.js'].forEach(p => add('app', p, 'must work'));

const sitemap = await get(`${REF.site}/sitemap.xml`);
const locs = [...sitemap.body.toString().matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1]);
if (!locs.length) fail('sitemap.xml has no <loc> entries on the reference');
for (const l of locs) { const c = classify(l, LIVE.site); if (c) add(c.which, c.path, 'sitemap'); }

// Crawl HTML pages on the reference to find every internal address.
const crawled = { site: new Set(), app: new Set() };
const canonicals = [];
for (let round = 0; round < 4; round++) {
  const pages = [];
  for (const which of ['site', 'app']) for (const [p] of want[which]) {
    if ((p.endsWith('.html') || p.endsWith('/')) && !crawled[which].has(p)) { crawled[which].add(p); pages.push([which, p]); }
  }
  if (!pages.length) break;
  await pool(pages, 8, async ([which, p]) => {
    const url = REF[which] + encodeURI(p);
    const r = await get(url);
    if (r.status !== 200) return;
    const html = r.body.toString();
    const canon = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
    if (canon) { canonicals.push([p, canon[1]]); const c = classify(canon[1], url); if (c) add(c.which, c.path, 'canonical'); }
    for (const l of linksIn(html, LIVE[which] + p)) add(l.which, l.path, `linked from ${which}${p}`);
  });
}
// Manifest icons.
for (const which of ['site', 'app']) for (const [p] of [...want[which]]) {
  if (!/manifest\.(json|webmanifest)$/.test(p)) continue;
  const r = await get(REF[which] + p);
  try { for (const ic of JSON.parse(r.body.toString()).icons || []) { const c = classify(ic.src, LIVE[which] + p); if (c) add(c.which, c.path, 'manifest icon'); } } catch {}
}
// Extensionless twins of every page.
for (const which of ['site', 'app']) for (const [p] of [...want[which]]) {
  if (p.endsWith('.html') && !p.endsWith('/404.html')) add(which, p.slice(0, -5), 'extensionless');
}

/* ── 2. Compare target with reference ───────────────────────────── */
const snapshot = SNAP_IN ? JSON.parse(readFileSync(SNAP_IN, 'utf8')) : null;
const record = {};
const jobs = [];
for (const which of ['site', 'app']) for (const [p, why] of want[which]) jobs.push([which, p, why]);

let checked = 0;
await pool(jobs, 8, async ([which, p, why]) => {
  const key = `${which}${p}`;
  const t = await get(TARGET[which] + encodeURI(p));
  let ref;
  if (snapshot) ref = snapshot[key];
  else { const r = await get(REF[which] + encodeURI(p)); ref = { status: r.status, type: r.type, hash: pageHash(r), location: r.location }; }
  record[key] = { status: t.status, type: t.type, hash: pageHash(t) };
  checked++;
  if (!ref) { fail(`${key}  not in the snapshot (${why})`); return; }
  if (ref.status !== 200) {
    // The reference itself doesn't serve it: only a problem if it was listed as a real page.
    if (why === 'sitemap' || why === 'canonical') fail(`${key}  reference answers ${ref.status} (${why})`);
    return;
  }
  if (t.status !== 200) { fail(`${key}  ${t.status}${t.location ? ' -> ' + t.location : ''}${t.error ? ' ' + t.error : ''}  (was 200; ${why})`); return; }
  if (t.location) fail(`${key}  has a Location header: ${t.location}`);
  if (!sameType(t.type, ref.type)) fail(`${key}  content-type ${t.type} (was ${ref.type})`);
  if (record[key].hash !== ref.hash) fail(`${key}  different bytes from the reference (${why})`);
  if (t.type.startsWith('text/html')) {
    if (!/<meta\s+charset=["']?utf-8/i.test(t.body.subarray(0, 1024).toString())) fail(`${key}  no <meta charset="UTF-8"> in the first 1024 bytes, and the header has no charset`);
    for (const h of REQUIRED_HEADERS[which]) if (!t.headers.get(h)) fail(`${key}  missing header ${h}`);
    if (which === 'app' && t.headers.get('content-security-policy') !== APP_FRAME_ANCESTORS) fail(`${key}  frame-ancestors is "${t.headers.get('content-security-policy')}"`);
    const hsts = t.headers.get('strict-transport-security') || '';
    if (hsts.includes(',')) fail(`${key}  Strict-Transport-Security is sent twice: ${hsts}`);
  }
});

/* ── 3. 404s, excluded files, www ───────────────────────────────── */
for (const which of ['site', 'app']) {
  const ref404 = which === 'site' ? await get(`${REF.site}/404.html`) : null;
  for (const p of ['/this-page-does-not-exist', '/nope/deeper/still.html', '/features.htm']) {
    const t = await get(TARGET[which] + p);
    if (t.status !== 404) fail(`${which}${p}  answers ${t.status}, expected 404`);
    else if (ref404 && sha(t.body) !== sha(ref404.body)) fail(`${which}${p}  404 body is not 404.html`);
  }
  for (const p of excluded[which]) {
    const t = await get(TARGET[which] + encodeURI(p));
    if (t.status === 200) fail(`${which}${p}  is served, but .assetsignore should keep it off the site`);
  }
}
if (!SNAP_IN && TARGET.site === LIVE.site) {
  const w = await get('https://www.semester-hq.com/pricing.html?x=1');
  if (w.status !== 301 || w.location !== 'https://semester-hq.com/pricing.html?x=1') fail(`www redirect: ${w.status} -> ${w.location}`);
}

/* ── Report ─────────────────────────────────────────────────────── */
const byWhy = {};
for (const [, , why] of jobs) { const k = why.startsWith('linked') ? 'internal link' : why; byWhy[k] = (byWhy[k] || 0) + 1; }
console.log(`URL check\n  target  ${TARGET.site}  ${TARGET.app}\n  against ${SNAP_IN ? 'snapshot ' + SNAP_IN : REF.site + '  ' + REF.app}`);
console.log(`  ${checked} addresses (${Object.entries(byWhy).map(([k, v]) => `${v} ${k}`).join(', ')}), ${locs.length} sitemap entries, ${canonicals.length} canonical tags`);
for (const which of ['site', 'app']) if (excluded[which].length) console.log(`  not served on purpose (${which}): ${excluded[which].length} files, all confirmed not 200`);
if (SNAP_OUT) { writeFileSync(SNAP_OUT, JSON.stringify(record, null, 1)); console.log(`  snapshot written to ${SNAP_OUT}`); }
if (failures.length) {
  console.log(`\n✗ ${failures.length} problem${failures.length > 1 ? 's' : ''}:`);
  for (const f of failures.sort()) console.log('  ' + f);
  process.exit(1);
}
console.log('\n✓ every address answers 200 with the same page, no redirects');
