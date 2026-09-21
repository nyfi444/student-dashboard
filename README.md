# Student Planner ("Semester HQ")

A student planner covering dashboard, calendar, assignment tracking, notebook, study timer, exam tracker, project hub, flashcards, and study groups, with AI-assisted syllabus and assignment upload (auto-fills course info, schedule, assignments, and exams from a PDF/photo/text document).

No build step: plain HTML/CSS/JS, runs by opening `index.html` or serving the folder with any static file server.

**Tests:** `node tests/run.mjs`, `node tests/worker-delete-account.mjs`, and `node tests/worker-security.mjs`. There are deliberately only a few things covered — quick add's plain-English parsing, the syllabus contract between `SYLLABUS_SCHEMA` (js/ai.js) and `sanitizeCourseDetails` (js/syllabus.js), and the LMS calendar feed parser (js/lmsfeed.js, a date read a day off or a lecture imported as homework). Those, plus what happens to a study group or club when a member deletes their account, and the Worker's security fences: all places where a regression is silent and costs trust (an owner who no longer exists leaves a club nobody can edit). Everything else fails loudly enough to find on its own.

**What's free vs. paid:** without an account the app is a live demo: the full interface, nothing saved. Semester HQ Plus ($7.99/month) is what saves a semester, syncs it across devices, and turns on AI upload and study groups. See `worker/README.md` for how that's enforced (short version: a Cloudflare Worker is the only thing allowed to mark someone as paid, so it can't be bypassed from the browser).

All setup below is one-time, done-by-the-app-owner configuration; regular students never see an API key, a Firebase config screen, or a Stripe key. Until you do it, the app runs as the no-account demo; sign-in and AI upload just show as unavailable.

## Setup: sign-in + cross-device sync

1. Go to https://console.firebase.google.com → **Add project**
2. **Build → Authentication → Get started → Sign-in method → Google → Enable**
3. **Build → Firestore Database → Create database** (production mode)
4. Deploy the security rules in [`firestore.rules`](firestore.rules) and [`storage.rules`](storage.rules). After the one-time setup in [`.github/workflows/deploy-rules.yml`](.github/workflows/deploy-rules.yml) this happens automatically on every push to `main` that touches them — publishing them by hand is how the repo and the console quietly end up disagreeing. To do it manually anyway: paste the contents into **Firestore → Rules** / **Storage → Rules** and click Publish, or run `firebase deploy --only firestore:rules,storage`. These rules scope each user's data to themselves, and make sure only the backend Worker (not the browser) can ever mark someone as paid.
5. **Project settings (gear icon) → General → Your apps → Add app → Web** (`</>` icon), register it, copy the `firebaseConfig` object
6. Paste those values into `FB_CONFIG` in `js/config.js` (the one file every page reads for shared settings):
   ```js
   const FB_CONFIG = {
     apiKey: '...',
     authDomain: '....firebaseapp.com',
     projectId: '...',
     storageBucket: '....appspot.com',
     messagingSenderId: '...',
     appId: '...',
   };
   ```

## LMS calendar feeds (Canvas, Blackboard, Brightspace, Moodle)

Assignments → **Import from Canvas** takes the private calendar feed link every LMS gives a student and turns each dated entry into an assignment (`js/lmsfeed.js`). The Worker's `/calendar-feed` route fetches the link, since the LMS sends no CORS headers; it is paid-accounts-only, https-only, refuses private and literal-IP hosts (on every redirect), caps the body at 2 MB, and only returns something that starts with `BEGIN:VCALENDAR`. The app refreshes each feed when a paid planner loads and every six hours while open, matching on the feed's own ids so moved dates move and nothing doubles. Without an account, the same parser runs on an uploaded `.ics` file.

## Setup: AI upload + payments (one Worker, both features)

Both the AI proxy and the Stripe checkout/licensing live in the same small Cloudflare Worker (`/worker`); secrets never touch the browser. Full steps, including the Stripe webhook and Firebase service account: [`worker/README.md`](worker/README.md).

Quick version:
1. `cd worker && wrangler login`
2. Set secrets: `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
3. Fill in `ALLOWED_ORIGIN`, `APP_URL`, `FIREBASE_PROJECT_ID` in `wrangler.toml`
4. `wrangler deploy`, then set `WORKER_URL` in `js/config.js` to the deployed URL
5. Create the Stripe webhook pointing at `<worker URL>/stripe-webhook`, set `STRIPE_WEBHOOK_SECRET`

Reload the app once all of this is done: Settings → AI should show "Ready to use," and signing in will prompt for the $7.99/month subscription before unlocking sync.

## Diagnostics

Every page loads `js/diagnostics.js` right after `js/config.js`. It reports uncaught errors, Worker calls that fail, and problems features log with `diag.warn(feature, message, err)` or `diag.error(...)`, along with the last few screens and Worker calls before it happened. Reports never include planner content, file names, or emails. The Worker records its own failures in the same place.

- Read them at `admin/errors.html` (needs the `ADMIN_TOKEN` Worker secret), grouped by issue and filterable by feature.
- A student can send you Settings → FAQ → **Copy diagnostic info**. Its support code matches the reports from their session.
- For a Worker issue's full stack, open Cloudflare → Workers → student-planner-ai-proxy → Logs.
- Reports older than 30 days are deleted by the daily cron.

## Deploying updates

The app works offline through a service worker (`sw.js`). When you deploy a change, bump `APP_VERSION` in **`js/version.js`** (any new string works, e.g. the date). That one line is the whole version: `sw.js` imports it and names its cache after it, Settings shows it under "App version", and diagnostics reports it, so there's never a disagreement about what's running.

Bumping it is what makes an already-open tab or an installed home-screen app pick the change up: the browser notices the imported file changed, installs the new worker, and the app applies it (silently if it was only just opened, otherwise with a "new version is ready" banner). App files are fetched with `cache: 'no-cache'` so the browser's own ten-minute cache on GitHub Pages can never serve stale code, but **without a bump an installed app can keep running the old version until it's next reopened**, so don't skip it. Settings → App version has "Check for updates" and, as a last resort, "Reload the app from scratch", which clears the cached copy of the app (never the planner's data).
