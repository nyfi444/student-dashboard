# Student Planner ("Semester HQ")

A student planner covering dashboard, calendar, assignment tracking, notebook, study timer, exam tracker, project hub, flashcards, and study groups — with AI-assisted syllabus and assignment upload (auto-fills course info, schedule, assignments, and exams from a PDF/photo/text document).

No build step — plain HTML/CSS/JS, runs by opening `index.html` or serving the folder with any static file server.

**What's free vs. paid:** local-only usage (no sign-in) is free forever — full features, on one device, no account needed, so people can try it before buying. Signing in unlocks cross-device sync and AI upload, and requires a $7.99/month subscription. See `worker/README.md` for how that's enforced (short version: a Cloudflare Worker is the only thing allowed to mark someone as paid, so it can't be bypassed from the browser).

All setup below is one-time, done-by-the-app-owner configuration — regular students never see an API key, a Firebase config screen, or a Stripe key. Until you do it, the app still works fully in free/local-only mode; sign-in and AI upload just show as unavailable.

## Setup: sign-in + cross-device sync

1. Go to https://console.firebase.google.com → **Add project**
2. **Build → Authentication → Get started → Sign-in method → Google → Enable**
3. **Build → Firestore Database → Create database** (production mode)
4. Deploy the security rules in [`firestore.rules`](firestore.rules) — either paste its contents into **Firestore → Rules** in the console and click Publish, or if you have the Firebase CLI: `firebase deploy --only firestore:rules`. These rules scope each user's data to themselves, and make sure only the backend Worker (not the browser) can ever mark someone as paid.
5. **Project settings (gear icon) → General → Your apps → Add app → Web** (`</>` icon), register it, copy the `firebaseConfig` object
6. Paste those values into `FB_CONFIG` in `js/firebase.js`:
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

## Setup: AI upload + payments (one Worker, both features)

Both the AI proxy and the Stripe checkout/licensing live in the same small Cloudflare Worker (`/worker`) — secrets never touch the browser. Full steps, including the Stripe webhook and Firebase service account: [`worker/README.md`](worker/README.md).

Quick version:
1. `cd worker && wrangler login`
2. Set secrets: `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
3. Fill in `ALLOWED_ORIGIN`, `APP_URL`, `FIREBASE_PROJECT_ID` in `wrangler.toml`
4. `wrangler deploy` — set `AI_PROXY_URL` in `js/ai.js` and `CHECKOUT_PROXY_URL` in `js/checkout.js` to the deployed URL
5. Create the Stripe webhook pointing at `<worker URL>/stripe-webhook`, set `STRIPE_WEBHOOK_SECRET`

Reload the app once all of this is done — Settings → AI should show "Ready to use," and signing in will prompt for the $7.99/month subscription before unlocking sync.
