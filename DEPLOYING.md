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
