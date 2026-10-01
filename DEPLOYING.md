# Deploying app.semester-hq.com

Since September 2026 the app is served by a Cloudflare Worker called
**semester-hq-app**, with static assets only (no Worker script). It moved off
GitHub Pages because GitHub's terms don't allow Pages to host a commercial
SaaS. The API Worker (`student-planner-ai-proxy`) is separate. It still
deploys from `worker/` with its own `worker/wrangler.toml`, and nothing here
changes it.

## How a change gets to students

1. **Work on a branch.** Every push to a branch other than `main` builds a
   **Preview**, with its own `…workers.dev` address posted on the pull
   request. Previews are marked `noindex`.
2. **Merge to `main`.** Cloudflare's build uploads a new **version**, which
   does *not* go live yet.
3. **Promote the version.** Production changes only here:
   ```bash
   npx wrangler versions list
   npx wrangler versions deploy <version-id>@100% -y
   ```
   Or use Workers & Pages → semester-hq-app → Deployments → the version →
   Deploy. Routine changes get promoted once the ship checks pass. Anything
   unusual waits for Nyla's yes.
4. **Smoke check.** Run `node tests/smoke.mjs --wait 180`, or Actions → Tests
   → Run workflow on `main`.

Bump `APP_VERSION` in `js/version.js` on every deploy, exactly as before. The
service worker still depends on it.

**Checking a change to how things are served** (headers, `_redirects`, the
config): test a **version URL** (the `Version Preview URL` that
`npx wrangler versions upload` prints), not a branch Preview. Branch
Previews are in open beta (Sept 2026) and ignore `not_found_handling`: a
missing page answers a bare "Not found" instead of `404.html`. Version URLs
serve exactly the way production does.

**Workers Builds settings** (connected Sept 26, 2026; Settings → Builds):
production branch `main`, build command `node tools/build-redirects.mjs`,
deploy command `npx wrangler versions upload` (so `main` never goes live on
its own), root `/`; preview builds on for every other branch with
`npx wrangler preview`. If a build ever says `npx wrangler deploy`, change it
back: that would publish every push to `main` straight to production.

## Staging: where previews and localhost go

Only `app.semester-hq.com`, `semester-hq.com` and `www` count as production
(`PRODUCTION_HOSTS` in `js/config.js`, and the same list in the site's
`js/diagnostics.js`). Everything else, meaning every branch Preview, every
version URL and localhost, talks to staging instead:

- **API Worker:** `student-planner-ai-proxy-staging`, the same code deployed
  with `npx wrangler deploy --env staging` from `worker/`. Its own KV, rate
  limiters and secrets; Stripe in test mode; email only to the addresses in
  `MAIL_ALLOWLIST`; at most 12 emails a day. If it is ever given a live
  Stripe key, the production Firebase project, or no allow-list, it refuses
  every request (`stagingProblem` in `worker/src/http.js`).
- **Firebase:** the `semester-hq-staging` project, with the same rules
  (`deploy-rules.yml` publishes to staging on every branch, then to
  production from `main`). Until that project exists, `FB_CONFIG_STAGING`
  is an offline-only stand-in: previews start signed out and sign-in fails.
- **Turnstile:** Cloudflare's always-pass test key.
- Preview pages show a small "Staging" label in the corner.

## The API Worker

It still deploys from `worker/` with the Wrangler CLI (it isn't connected to
Workers Builds), but the same way as the sites: staging first, then a
version, then promote.

```bash
cd worker
npx wrangler deploy --env staging          # try it on a preview
npx wrangler versions upload               # production version, not live
# test the Version Preview URL it prints
npx wrangler versions deploy <version-id>@100% -y
npx wrangler triggers deploy               # only if the cron changed
node ../tests/smoke.mjs --wait 60
```

`npx wrangler rollback` goes back one version. A secret added with
`npx wrangler versions secret put NAME` lands on a new version without
deploying it; `wrangler secret put` (without `versions`) deploys at once.

The one-page checklist for any change is `docs/how-to-ship.md` in the
Business OS repo, also in the OS under About.

## Files that control serving

| File | What it does |
|---|---|
| `wrangler.toml` | Worker name, `html_handling = "none"`, `not_found_handling = "404-page"`. No route: see Rolling back |
| `_headers` | Security headers: HSTS, nosniff, referrer and permissions policy, the enforced `frame-ancestors`, and the Report-Only CSP |
| `_redirects` | **Generated.** Rewrites (not redirects) for `/`, `/login` and the other short addresses. Run `node tools/build-redirects.mjs` after adding or renaming a page. The build also runs it |
| `.assetsignore` | Keeps `tests/`, `worker/`, `tools/`, the rules files and repo files off the public site |
| `404.html` | The page for any address that isn't a file |

Why `html_handling = "none"`: Cloudflare's default redirects `/login.html` to
`/login`. Every link in the app, the marketing site and Stripe's return URLs
uses the `.html` form, so each one has to answer 200 as written.

## Checking every URL

`tests/check-urls.mjs` collects every sitemap entry, canonical tag, internal
link, icon and repo file on both sites. It passes only if each one answers
200 with no redirect and the same bytes as the reference. Run it after
anything that changes how the sites are served.

```bash
node tests/check-urls.mjs --app https://<preview-url> --app-dir . --site-dir ../semester-hq-site
```

## Rolling back

- **A bad deploy:** run `npx wrangler rollback`, which goes back to the
  previous version.
- **The whole hosting move:** production is reached through Worker routes
  (`semester-hq.com/*` and `app.semester-hq.com/*`) on the zone. DNS was
  never changed. One command removes both routes, confirms they're gone, and
  checks that GitHub Pages is answering again (while Pages is still on):
  ```bash
  node tools/hosting-routes.mjs rollback
  ```
  `status` shows what's attached and who's answering. `cutover` attaches
  both routes again. Don't put the routes in `wrangler.toml`: removing a
  route from the file doesn't remove it from the zone, so a rollback built
  on it silently does nothing (tested Sept 26 2026).

## Headers during the changeover

Until GitHub Pages is switched off, the zone's Transform Rule
**"Security headers, app"** also sets these headers and overrides
`_headers`. Keep the two identical. After Pages is off, the rule gets
deleted and `_headers` is the only source.
