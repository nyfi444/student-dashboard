# Tests

Four kinds, from fastest to most thorough. CI runs all of them
(`.github/workflows/tests.yml`); the rules suite also gates every rules
publish (`.github/workflows/deploy-rules.yml`).

| what | where | needs | catches |
| --- | --- | --- | --- |
| node tests | `run.mjs`, `worker-*.mjs` | nothing | the quick-add parser, the syllabus contract, LMS feeds, `sw.js` agreeing with `index.html`, the switches that ship off, the Worker's auth, billing and deletion logic, and what it measures for the Business OS (`worker-measure.mjs`: subscriber rows, checkout paths, the daily ledger, AI usage) |
| rules | `rules/` | the emulators | who may read and write what in Firestore and Storage, tested against the rules files that ship |
| browser | `e2e/` | the emulators for the signed-in half | the app opening at all, every page rendering, real flows through the real screens, signed out and signed in |
| smoke | `smoke.mjs` | the internet | that what's live after a deploy is this build, and the Worker still refuses what it should |

## Running them

```bash
cd tests
npm install                                # once
npx playwright install chromium webkit     # once
npm test                                   # rules, then every browser test
```

- `npm run test:rules` — just the rules.
- `npm run test:e2e` — just the browser tests.
- `npm run test:e2e:signed-out` — the browser tests that need no emulators (no Java either).
- `npm run test:headed` — watch the browser tests in a real window.
- `node smoke.mjs --wait 180` — after a deploy.

The node tests need no install at all: `node tests/run.mjs` from the repo root.

### Java

The Firestore emulator is a Java program. `with-emulators.mjs` finds one on
its own — `$JAVA_HOME`, then `java` on the PATH, then a JDK unpacked under
`~/.local/share` — and says plainly if there isn't one. GitHub's runners
already have Java.

## Nothing here touches production

The rules and signed-in browser tests run against a local copy of Firebase
(Auth, Firestore, Storage) started by `with-emulators.mjs` as
`demo-semester-hq`, a project id the Firebase tools treat as offline-only.
The app talks to it only when it is served from localhost *and* a flag the
tests set is present (`firebaseEmulatorHost` in `js/firebase.js`), so no
deployed copy can ever take that path.

On top of that, the signed-in tests (`e2e/signedin.mjs`) block every request
to the real Firebase hosts and fail the test that made it, answer every call
to the Worker themselves, and fail any test during which the app reports an
error to `/log-error`.

Signed out, the app keeps everything in memory, so the signed-out browser
tests need no accounts at all.

## What the browser tests cover

| file | what breaks if it fails |
| --- | --- |
| `boot.spec.mjs` | the app opens at all; every page renders; the service worker registers under this version; signed out nothing is kept (desktop and iPhone) |
| `coursework.spec.mjs` | a class can be added, opened, given work, and the work ticked off |
| `quickadd.spec.mjs` | plain-English quick add is still wired to the parser and writes what it promised |
| `login.spec.mjs` | the way in renders, offers both routes, and puts the age gate and the agreement first |
| `offline.spec.mjs` | the app opens on no connection, and `sw.js` still caches every file the app loads |
| `account.spec.mjs` | a paying student's data reaches their account, survives a reload, and loads on a second device; an unpaid account gets the plan screen and keeps nothing; one student cannot read another's planner |
| `clubs.spec.mjs` | an officer starts a club and posts; a classmate joins with the code, sees it, and gets no officer controls; chat reaches both |

Every browser test also fails on a red console line. In a no-build-step app,
an uncaught error *is* the type checker.

## What is still not covered

- Anything that goes through the Worker with a real signed-in account:
  checkout, the billing portal, group seats, the AI features, the calendar
  feed fetch, and deleting an account. The Worker's side of each is covered
  by `worker-security.mjs` and `worker-delete-account.mjs`; the browser side
  would need the Worker running locally against the emulators too.
- Sign-in itself. The app offers Google's popup and an emailed link; the
  tests sign in through the same Firebase connection those end in, but not
  through either screen.
- Study groups with two accounts (clubs are covered; groups share most of
  the same code and rules, and their rules are tested in `rules/`).
