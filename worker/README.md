# Backend Worker (AI proxy + checkout + billing portal + licensing + contact form)

One Cloudflare Worker, five jobs — all server-side so secrets never reach the browser:

1. **AI proxy** (`/v1/messages`) — holds your Anthropic key, forwards syllabus/assignment parsing requests.
2. **Checkout** (`/create-checkout-session`) — starts a $7.99/month Stripe subscription for sign-in and sync.
3. **Billing portal** (`/create-portal-session`) — sends a signed-in, paying user to Stripe's own hosted portal to update payment info or cancel. Requires the Stripe Customer Portal to be turned on once in the Stripe Dashboard (Settings → Billing → Customer portal) before it will work.
4. **Licensing** (`/stripe-webhook`, `/claim-license`) — the only thing allowed to mark someone as paid. It writes to Firestore's `licenses` collection using a Firebase service account; the browser can only ever *read* its own license (see `../firestore.rules`), never write it — so a user can't just open devtools and grant themselves access. The webhook also tracks renewals/cancellations, so access turns off automatically if a subscription lapses or is cancelled through the billing portal.
5. **Contact form** (`/contact-message`) — the only writer of Firestore's `feedback` collection. Reachable by anyone (signed in or not), so it has its own validation and a honeypot field on top of rate limiting. View submissions in the Firebase console → Firestore Database → `feedback`.

Local-only usage (no sign-in) stays free forever and doesn't touch any of this. Payment only gates cross-device sync + AI upload.

## Deploy

1. Install Wrangler if you don't have it: `npm install -g wrangler`
2. From this `worker/` directory: `wrangler login`
3. Set the required secrets (each prompts you to paste a value — nothing is written to disk or git):
   ```
   wrangler secret put ANTHROPIC_API_KEY       # from https://console.anthropic.com
   wrangler secret put STRIPE_SECRET_KEY       # from https://dashboard.stripe.com/apikeys (starts with sk_)
   wrangler secret put FIREBASE_CLIENT_EMAIL   # see "Firebase service account" below
   wrangler secret put FIREBASE_PRIVATE_KEY    # see "Firebase service account" below
   ```
   `STRIPE_WEBHOOK_SECRET` comes later, once the endpoint exists (step 6).
4. In `wrangler.toml`, fill in:
   - `ALLOWED_ORIGIN` — your real site's origin, e.g. `"https://nyfi444.github.io"`. **Don't leave this as `"*"` in production** — it's the only thing stopping another website from embedding your key/checkout.
   - `APP_URL` — the exact page Stripe should redirect back to after checkout, e.g. `"https://nyfi444.github.io/student-dashboard/"`.
   - `FIREBASE_PROJECT_ID` — from Firebase console → Project settings (not secret, safe as a plain var).
5. Deploy: `wrangler deploy` — copy the printed URL (e.g. `https://student-planner-ai-proxy.<you>.workers.dev`).
   - In `js/ai.js`, set `AI_PROXY_URL` to `<that URL>/v1/messages`. That's the only URL to configure — `js/checkout.js` derives the checkout/licensing endpoints from it automatically, since it's the same Worker.
6. **Set up the Stripe webhook** (this is what actually marks someone as paid, and keeps that in sync as the subscription renews or gets canceled):
   - Stripe dashboard → Developers → Webhooks → Add endpoint
   - Endpoint URL: `<your worker URL>/stripe-webhook`
   - Events to send: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy the "Signing secret" it gives you and run: `wrangler secret put STRIPE_WEBHOOK_SECRET`

## Firebase service account

This lets the Worker write `licenses/{uid}` on your behalf after a real Stripe payment, without using the (Node-only, Workers-incompatible) firebase-admin SDK.

1. Firebase console → Project settings (gear icon) → Service accounts
2. Generate new private key → downloads a JSON file — **keep this private, never commit it**
3. From that JSON: `client_email` → `wrangler secret put FIREBASE_CLIENT_EMAIL`, and `private_key` (paste the whole thing including the `BEGIN/END PRIVATE KEY` lines) → `wrangler secret put FIREBASE_PRIVATE_KEY`

## Rate limiting

Protects against someone hammering the AI proxy or checkout routes and running up your bill.

```
wrangler kv:namespace create RATE_LIMIT
```
Paste the printed id into the commented-out `[[kv_namespaces]]` block in `wrangler.toml`, uncomment it, and redeploy. Without this bound, rate limiting is silently skipped (so local dev still works) — for real traffic, set it up.

## Cost control

- `ALLOWED_ORIGIN` restricts who can call the Worker at all.
- `src/index.js` caps AI `max_tokens` at 4000 and only allows a small model allowlist.
- KV-based rate limiting (above) caps requests per IP per minute (20/min AI, 10/min checkout, 15/min license-claim, 5/min contact form).
- Anthropic and Stripe usage are billed separately on your own accounts, per actual usage.

## Local testing

```
wrangler dev
```
Runs the Worker locally (e.g. `http://localhost:8787`). Point `AI_PROXY_URL`/`CHECKOUT_PROXY_URL` at that during development. Stripe webhooks need a public URL to reach `wrangler dev` — use `stripe listen --forward-to localhost:8787/stripe-webhook` (Stripe CLI) to test the webhook locally, or just test against the deployed Worker with Stripe test-mode keys.
