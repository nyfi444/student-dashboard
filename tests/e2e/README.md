# Browser tests

What the node tests in `../` cannot see: whether the app actually opens.

There is no build step and no framework, so nothing type-checks these files
and nothing links them together. The script list in `index.html` *is* the
dependency graph — its own comment says so — and one reordered or missing
line is a white screen on every device at once. A browser is the only thing
that catches that.

## Running them

```bash
cd tests/e2e
npm install            # once
npx playwright install chromium webkit   # once
npm test
```

`npm test` serves the repo root on port 7441 and runs everything. Nothing
needs to be running first, and nothing needs credentials.

- `npm run test:headed` — watch it happen in a real window.
- `npx playwright test boot.spec.mjs` — one file.
- `npx playwright test --project=phone` — iOS Safari at iPhone size.
- `E2E_BASE_URL=https://app.semester-hq.com npm test` — run against the live
  app instead of this checkout. Do this *after* a deploy, not before.

## Why they need no test account

Signed out, the app runs on an in-memory store (`isDemoMode` in
`js/state.js`): every feature works, nothing is written anywhere, and a
reload wipes it. That is a product decision, not a test trick — and it means
this suite drives the real UI, through the real state and render path,
without touching one student's data, spending an AI token, or needing a
password to sit in CI.

## What these cover

| file | what breaks if it fails |
| --- | --- |
| `boot.spec.mjs` | the app opens at all; every page renders; the service worker registers under this version; signed out nothing is kept |
| `coursework.spec.mjs` | a class can be added, opened, given work, and the work ticked off |
| `quickadd.spec.mjs` | plain-English quick add is still wired to the parser and writes what it promised |
| `login.spec.mjs` | the way in renders, offers both routes, and puts the age gate and the agreement first |
| `offline.spec.mjs` | the app opens on no connection, and `sw.js` still caches every file the app loads |

Every one of them also fails on a red console line. That is deliberate: in a
no-build-step app, an uncaught error *is* the type checker.

## What these deliberately do not cover

Anything behind a signed-in account, because the app offers only Google's
popup and an emailed sign-in link, and neither can be driven without a real
inbox or a real Google account:

- Firestore sync, and `firestore.rules` — the biggest untested surface
- study groups and clubs, which need two accounts to mean anything
- checkout, the billing portal, group seats
- the AI features, which need a paid license and cost money per run

Covering those needs a decision first: either enable the Email/Password
provider on the production Firebase project for one test account, or run the
Firebase emulators and point the app at them in tests. Both are real changes
to production configuration, so neither was made unilaterally.

The Worker's half of that surface — auth, rate limits, Stripe signatures,
account deletion — is covered without a browser in `../worker-security.mjs`
and `../worker-delete-account.mjs`, and the live boundaries are checked after
every deploy by `../smoke.mjs`.
