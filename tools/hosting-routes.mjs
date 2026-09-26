/* ── The switch between GitHub Pages and Cloudflare Workers ──────────
   Production traffic reaches the two static-assets Workers through Worker
   ROUTES on the semester-hq.com zone, not custom domains, so DNS is never
   touched: the DNS records still point at GitHub Pages, and a route simply
   answers first. Remove the routes and GitHub Pages is serving again, as
   long as Pages is still switched on.

     node tools/hosting-routes.mjs status     what is attached right now
     node tools/hosting-routes.mjs cutover    attach both routes
     node tools/hosting-routes.mjs rollback   remove both routes (one step)

   Every command re-reads the zone afterwards and then asks the live
   hostnames who answered: a GitHub Pages response carries
   x-github-request-id, and a Worker response doesn't. It exits 1 if the
   result isn't what was asked for.

   Why a script and not wrangler.toml: `wrangler triggers deploy` with the
   route removed from the config reports "No targets deployed" and leaves
   the route in place (tested Sept 26 2026 on a dummy hostname). A rollback
   built on it would do nothing. So the routes are managed only here, and
   stay out of both wrangler.toml files, where a deploy could re-add them.

   Auth: wrangler's own login (`npx wrangler login`, which needs the
   workers_routes scope). The token is read through `wrangler auth token`
   and never printed.

   --only <pattern> limits a command to one route pattern (used to test
   this on rollback-test.semester-hq.com/*, which has no DNS record).
──────────────────────────────────────────────────────────────── */
import { execFileSync } from 'node:child_process';

const ROUTES = [
  { pattern: 'semester-hq.com/*', script: 'semester-hq-site', probe: 'https://semester-hq.com/robots.txt' },
  { pattern: 'app.semester-hq.com/*', script: 'semester-hq-app', probe: 'https://app.semester-hq.com/manifest.json' },
];
const ZONE_NAME = 'semester-hq.com';
const API = 'https://api.cloudflare.com/client/v4';

const cmd = process.argv[2];
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx !== -1 ? process.argv[onlyIdx + 1] : null;
const scriptIdx = process.argv.indexOf('--script');
const wanted = only
  ? [{ pattern: only, script: scriptIdx !== -1 ? process.argv[scriptIdx + 1] : 'semester-hq-site', probe: null }]
  : ROUTES;
if (!['status', 'cutover', 'rollback'].includes(cmd)) {
  console.log('usage: node tools/hosting-routes.mjs status|cutover|rollback [--only <pattern> --script <worker>]');
  process.exit(2);
}

const out = execFileSync('npx', ['-y', 'wrangler@4.141.0', 'auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const token = (out.match(/[A-Za-z0-9._-]{30,}/g) || []).pop();
if (!token) { console.error('No wrangler login. Run: npx wrangler login'); process.exit(1); }

async function api(path, init = {}) {
  const res = await fetch(API + path, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) } });
  const body = await res.json();
  if (!body.success) throw new Error(`${init.method || 'GET'} ${path}: ${JSON.stringify(body.errors)}`);
  return body.result;
}

const zoneId = (await api(`/zones?name=${ZONE_NAME}`))[0].id;
const list = () => api(`/zones/${zoneId}/workers/routes`);

async function whoAnswers(url) {
  // A fresh query string so no cache can answer for the origin.
  const res = await fetch(`${url}?who=${Date.now()}`, { redirect: 'manual', headers: { 'cache-control': 'no-cache' } });
  return { status: res.status, host: res.headers.get('x-github-request-id') ? 'GitHub Pages' : 'Cloudflare Worker' };
}

async function report(expectAttached) {
  const routes = await list();
  let ok = true;
  for (const w of wanted) {
    const r = routes.find(x => x.pattern === w.pattern);
    const attached = !!r && r.script === w.script;
    let line = `  ${w.pattern.padEnd(24)} ${r ? `-> ${r.script}` : 'no route'}`;
    if (w.probe) { const who = await whoAnswers(w.probe); line += `   live: ${who.status} from ${who.host}`; if (expectAttached !== null && (who.host === 'Cloudflare Worker') !== expectAttached) ok = false; }
    if (expectAttached !== null && attached !== expectAttached) ok = false;
    console.log(line);
  }
  return ok;
}

if (cmd === 'cutover') {
  const routes = await list();
  for (const w of wanted) {
    const r = routes.find(x => x.pattern === w.pattern);
    if (r && r.script === w.script) continue;
    if (r) await api(`/zones/${zoneId}/workers/routes/${r.id}`, { method: 'PUT', body: JSON.stringify({ pattern: w.pattern, script: w.script }) });
    else await api(`/zones/${zoneId}/workers/routes`, { method: 'POST', body: JSON.stringify({ pattern: w.pattern, script: w.script }) });
    console.log(`attached ${w.pattern} -> ${w.script}`);
  }
  await new Promise(r => setTimeout(r, 5000));
} else if (cmd === 'rollback') {
  const routes = await list();
  for (const w of wanted) {
    for (const r of routes.filter(x => x.pattern === w.pattern)) {
      await api(`/zones/${zoneId}/workers/routes/${r.id}`, { method: 'DELETE' });
      console.log(`removed ${r.pattern} (was -> ${r.script})`);
    }
  }
  await new Promise(r => setTimeout(r, 5000));
}

const ok = await report(cmd === 'status' ? null : cmd === 'cutover');
if (!ok) { console.error(`\n✗ ${cmd} did not end in the expected state. Check the lines above.`); process.exit(1); }
console.log(cmd === 'status' ? '' : `\n✓ ${cmd} done and confirmed`);
