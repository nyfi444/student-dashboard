# Student Planner

A student planner covering dashboard, calendar, assignment tracking, grades/GPA, notebook, study timer, exam tracker, project hub, flashcards, and study groups — with AI-assisted syllabus and assignment upload (auto-fills course info, schedule, assignments, and exams from a PDF/photo/text document).

No build step — plain HTML/CSS/JS, runs by opening `index.html` or serving the folder with any static file server.

Both setup steps below are one-time, done-by-the-app-owner configuration — regular students never see an API key or a Firebase config screen. Until you do them, the app still works fully: AI upload just shows as unavailable, and everything runs local-only on each device.

## Setup: AI features (syllabus/assignment upload)

The Claude API key lives server-side in a small Cloudflare Worker proxy (`/worker`), never in the browser.

1. `cd worker`
2. Install Wrangler if needed: `npm install -g wrangler`
3. `wrangler login` (needs a free Cloudflare account: https://dash.cloudflare.com/sign-up)
4. `wrangler secret put ANTHROPIC_API_KEY` — paste a key from https://console.anthropic.com
5. `wrangler deploy` — copy the printed `https://….workers.dev` URL
6. In `js/ai.js`, set `AI_PROXY_URL` to that URL + `/v1/messages`

Full details, cost controls, and local dev instructions: [`worker/README.md`](worker/README.md).

## Setup: sign-in + cross-device sync

Sync is designed to be the default experience — once configured, new users are prompted to sign up with Google on first launch, and everything syncs automatically from then on.

1. Go to https://console.firebase.google.com → **Add project** (name it anything, e.g. "student-planner")
2. In the new project: **Build → Authentication → Get started → Sign-in method → Google → Enable**
3. **Build → Firestore Database → Create database** (start in production mode; the default rules just need `allow read, write: if request.auth != null;` on the `planners` and `studyGroups` collections)
4. **Project settings (gear icon) → General → Your apps → Add app → Web** (`</>` icon), register it, and copy the `firebaseConfig` object it gives you
5. Paste those values into `FB_CONFIG` in `js/firebase.js`:
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
6. Reload the app — first launch (for anyone with no existing local data) now prompts to sign up with Google before the semester setup wizard, with "Continue on this device only" as a fallback.
