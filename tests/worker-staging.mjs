/* ── Staging can never touch anything real ──────────────────────────
   Runs the Worker's front door and http.js against fake settings and
   checks:

   - production accepts only its two real origins; a preview is refused
   - staging accepts any branch Preview or version URL of the app and site
     (the * in ALLOWED_ORIGIN), and nothing that merely looks like one
   - the staging Worker refuses every request, and skips its cron, when it
     has a live Stripe key, the production Firebase project, or no email
     allow-list; production is never affected by that check
   - the app and the site treat only the real hostnames as production

   Run:  node tests/worker-staging.mjs
──────────────────────────────────────────────────────────────── */
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { loadWorkerSource } from './worker-source.mjs';

const { source: src } = loadWorkerSource();
let failed = 0, passed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FAIL  ${name}\n      expected ${e}\n      got      ${a}`);
};

const box = {
  console: { ...console, error() {} },
  crypto, setTimeout, clearTimeout, TextEncoder, TextDecoder, atob, btoa, URL, URLSearchParams, Response, Request, Headers,
  ReadableStream, TransformStream, Uint8Array, ArrayBuffer, DataView,
};
box.globalThis = box;
vm.createContext(box);
vm.runInContext(src, box, { filename: 'worker/src (flattened)' });
box.fetch = async (url) => { throw new Error('no network in tests: ' + url); };

const toml = readFileSync(new URL('../worker/wrangler.toml', import.meta.url), 'utf8');
const stagingOrigins = (toml.split('[env.staging.vars]')[1].match(/ALLOWED_ORIGIN = "([^"]+)"/) || [])[1];
const productionOrigins = (toml.match(/^ALLOWED_ORIGIN = "([^"]+)"/m) || [])[1];

/* ── Origins ─────────────────────────────────────────────────────── */
{
  const prod = { ALLOWED_ORIGIN: productionOrigins };
  check('production: the app', box.isAllowedOrigin(prod, 'https://app.semester-hq.com'), true);
  check('production: the site', box.isAllowedOrigin(prod, 'https://semester-hq.com'), true);
  check('production: a preview is refused', box.isAllowedOrigin(prod, 'https://app-launch-semester-hq-app.semesterhq.workers.dev'), false);

  const stg = { ALLOWED_ORIGIN: stagingOrigins };
  check('staging: a branch preview of the app', box.isAllowedOrigin(stg, 'https://app-launch-foundations-semester-hq-app.semesterhq.workers.dev'), true);
  check('staging: a version URL of the site', box.isAllowedOrigin(stg, 'https://e2c8e250-semester-hq-site.semesterhq.workers.dev'), true);
  check('staging: localhost where the app runs', box.isAllowedOrigin(stg, 'http://localhost:7437'), true);
  check('staging: production is refused', box.isAllowedOrigin(stg, 'https://app.semester-hq.com'), false);
  check('staging: another account\'s workers.dev', box.isAllowedOrigin(stg, 'https://x-semester-hq-app.evil.workers.dev'), false);
  check('staging: a dot can\'t sneak in for the dash run', box.isAllowedOrigin(stg, 'https://evil.com.x-semester-hq-app.semesterhq.workers.dev'), false);
  check('staging: nothing tacked on the end', box.isAllowedOrigin(stg, 'https://x-semester-hq-app.semesterhq.workers.dev.evil.com'), false);
  check('staging: the empty run is not a match', box.isAllowedOrigin(stg, 'https://-semester-hq-app.semesterhq.workers.dev'), false);
  check('CORS echoes a matched preview', box.corsHeaders(stg, 'https://b-semester-hq-app.semesterhq.workers.dev')['Access-Control-Allow-Origin'], 'https://b-semester-hq-app.semesterhq.workers.dev');
}

/* ── The staging safety check ────────────────────────────────────── */
{
  const good = { STAGING: '1', FIREBASE_PROJECT_ID: 'semester-hq-staging', MAIL_ALLOWLIST: 'me@x.co', STRIPE_SECRET_KEY: 'sk_test_abc' };
  check('a correctly set up staging is fine', box.stagingProblem(good), '');
  check('a live Stripe key stops it', box.stagingProblem({ ...good, STRIPE_SECRET_KEY: 'sk_live_abc' }), 'staging has a live Stripe key');
  check('a live restricted key stops it', box.stagingProblem({ ...good, STRIPE_SECRET_KEY: 'rk_live_abc' }), 'staging has a live Stripe key');
  check('the production Firebase project stops it', box.stagingProblem({ ...good, FIREBASE_PROJECT_ID: 'semester-hq' }), 'staging points at the production Firebase project');
  check('no allow-list stops it', box.stagingProblem({ ...good, MAIL_ALLOWLIST: ' ' }), 'staging has no email allow-list');
  check('production is never judged by it', box.stagingProblem({ FIREBASE_PROJECT_ID: 'semester-hq', STRIPE_SECRET_KEY: 'sk_live_abc' }), '');

  const res = await box.__worker.fetch(new Request('https://w/track-event', { method: 'POST', headers: { Origin: 'http://localhost:7437' }, body: '{}' }), { ...good, STRIPE_SECRET_KEY: 'sk_live_abc', ALLOWED_ORIGIN: stagingOrigins }, { waitUntil() {} });
  check('a request to a misconfigured staging is refused', res.status, 503);
  check('and says why', (await res.json()).error, 'Staging is switched off: staging has a live Stripe key.');
  let ran = false;
  await box.__worker.scheduled({}, { ...good, FIREBASE_PROJECT_ID: 'semester-hq' }, { waitUntil() { ran = true; } });
  check('its cron does nothing', ran, false);
}

/* ── The staging config in wrangler.toml ─────────────────────────── */
{
  const block = toml.split('[env.staging]')[1] || '';
  check('staging has its own name', /name = "student-planner-ai-proxy-staging"/.test(block), true);
  check('staging is marked', /STAGING = "1"/.test(block), true);
  check('staging uses its own Firebase project', /FIREBASE_PROJECT_ID = "semester-hq-staging"/.test(block), true);
  check('staging has an allow-list', /MAIL_ALLOWLIST = "[^"]+"/.test(block), true);
  const prodKv = (toml.split('[env.staging]')[0].match(/id = "([0-9a-f]{32})"/) || [])[1];
  const stgKv = (block.match(/id = "([0-9a-f]{32})"/) || [])[1];
  check('staging has its own KV', !!stgKv && stgKv !== prodKv, true);
}

/* ── The browser side picks staging for anything but the real hosts ── */
for (const [repo, file] of [['app', '../js/config.js'], ['site', '../../semester-hq-site/js/diagnostics.js']]) {
  let text;
  try { text = readFileSync(new URL(file, import.meta.url), 'utf8'); } catch { continue; } // the site repo isn't checked out in CI
  const found = text.match(/PRODUCTION_HOSTS = (\[[^\]]+\])/);
  if (!found && repo === 'site') continue; // the site checkout is on a branch without this yet
  const hosts = JSON.parse((found || [])[1].replace(/'/g, '"'));
  check(`${repo}: production is exactly the real hosts`, hosts.sort(), ['app.semester-hq.com', 'semester-hq.com', 'www.semester-hq.com']);
  check(`${repo}: anything else uses the staging Worker`, /IS_PRODUCTION\s*\?\s*'https:\/\/student-planner-ai-proxy\.semesterhq\.workers\.dev'\s*:\s*'https:\/\/student-planner-ai-proxy-staging\.semesterhq\.workers\.dev'/.test(text), true);
}
{
  const text = readFileSync(new URL('../js/config.js', import.meta.url), 'utf8');
  const staging = (text.match(/FB_CONFIG_STAGING = \{([^}]*)\}/) || [])[1] || '';
  const prod = (text.match(/FB_CONFIG_PRODUCTION = \{([^}]*)\}/) || [])[1] || '';
  const prodKey = (prod.match(/apiKey: '([^']+)'/) || [])[1];
  check('app: staging has a config of its own', /projectId: '[a-z0-9-]*staging'/.test(staging), true);
  check('app: staging never borrows the production project or key', staging.includes("'semester-hq'") || (prodKey && staging.includes(prodKey)), false);
  check('app: FB_CONFIG is production only on production', /const FB_CONFIG = IS_PRODUCTION \? FB_CONFIG_PRODUCTION : FB_CONFIG_STAGING;/.test(text), true);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
