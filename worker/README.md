# Backend Worker (AI proxy, billing, licensing, group plans, contact form, diagnostics)

One Cloudflare Worker, eleven jobs, all server-side so secrets never reach the browser. `src/index.js` carries the same list at the top of the file, next to the code:

1. **AI proxy** (`/v1/messages`): holds your Anthropic key, forwards syllabus/assignment parsing requests.
2. **Checkout** (`/create-checkout-session`): starts a personal $7.99/month Stripe subscription. Group seats are bought through job 7 instead, not here.
3. **Billing portal** (`/create-portal-session`): sends a signed-in, paying user to Stripe's own hosted portal to update payment info or cancel. Requires the Stripe Customer Portal to be turned on once in the Stripe Dashboard (Settings → Billing → Customer portal) before it will work.
4. **Licensing** (`/stripe-webhook`, `/claim-license`, `/check-email`): the only thing allowed to mark someone as paid. It writes to Firestore's `licenses` collection using a Firebase service account; the browser can only ever *read* its own license (see `../firestore.rules`), never write it, so a user can't just open devtools and grant themselves access. The webhook also tracks renewals/cancellations, so access turns off automatically if a subscription lapses or is cancelled through the billing portal.
5. **Contact form** (`/contact-message`): the only writer of Firestore's `feedback` collection. Reachable by anyone (signed in or not), so it has its own validation and a honeypot field on top of rate limiting. View submissions in the Firebase console → Firestore Database → `feedback`. Also emails a copy to `NOTIFY_EMAIL` via [Resend](https://resend.com) if `RESEND_API_KEY` is set, see "Email notifications" below. Without that key, submissions still save to Firestore, just without an email.
6. **Account deletion** (`/delete-account`): self-serve "delete my account" (Settings → Account & Sync → Delete account in the app). Cancels any active Stripe subscription, deletes the `licenses`/`licensesByEmail`/`planners` Firestore docs, and deletes the Firebase Auth user itself. The Auth-user deletion step needs the service account to hold the **Firebase Authentication Admin** IAM role (Google Cloud Console → IAM & Admin → find the service account → Edit → Add role); without it, the data is still fully erased but the sign-in itself lingers and the response reports `authDeleted: false` so it's visible rather than silently swallowed.
7. **Group plans** (`/group/*`): a club, team, department or class section buys seats for its members and runs them from `group-admin.html`. $5.99 per member per month, 5 to 50 seats self-serve, larger orders go through the quote form on the site. One route with an action name after the slash (`create-checkout`, `seats`, `mine`, `details`, `join`, `leave`, `remove-member`, `set-admin`, `rename`, `reset-invite`, `portal`, `delete-pending`). A seat writes `groupPaid` on the member's license, so a seat and a personal subscription unlock exactly the same things, and the two are kept apart so a renewal or cancellation on one never wipes the other.
8. **Terms attestation** (`/account/attest`): records on the license that the age and terms box was ticked, and which terms version was current, so the fact survives a cleared browser. It grants no access of its own.
9. **LMS calendar feed** (`/calendar-feed`): fetches a Canvas, Blackboard, Brightspace or Moodle calendar feed server-side (the browser can't, CORS) and hands back the .ics text. Follows redirects, caps the response size, and refuses anything that isn't a calendar. Read-only: nothing is ever written back to the LMS.
10. **Diagnostics** (`/log-error`, plus `/admin/errors`): the only writer of Firestore's `errors` collection, taking crash reports from the app and the marketing site, and recording the Worker's own failures too. `/admin/errors` is the read side for `admin/errors.html`: GET, gated by the `ADMIN_TOKEN` bearer token rather than by origin, since that page isn't served from `ALLOWED_ORIGIN`.
11. **Business feed** (`/track-event`, `/admin/business-summary`, `/admin/biz-events`): `/track-event` is the only writer of Firestore's `events` collection and records CTA clicks on the marketing site. The two `/admin` routes are the same token-gated, GET-only shape as `/admin/errors` and feed the private business dashboard: Stripe subscriber breakdown and MRR computed server-side (Stripe blocks browser CORS on purpose), funnel counts, recent contact messages, crash counts, and, only if `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` are set, 7 days of Cloudflare traffic. Sections are left out rather than faked when something isn't configured.

A daily cron (`13:00` UTC, set in `wrangler.toml`) writes the overnight business events into the Business OS inbox and prunes error reports older than 30 days. Nothing else is scheduled, because Semester HQ sends no notifications of any kind.

Using the app without signing in is a live demo: nothing is saved and it resets on reload. There is no free tier. A paid license is what gates saving data at all, cross-device sync, syllabus upload, study groups, and clubs, whether it comes from a personal $7.99/month subscription or a seat on a group plan.

## Deploy

1. Install Wrangler if you don't have it: `npm install -g wrangler`
2. From this `worker/` directory: `wrangler login`
3. Set the required secrets (each prompts you to paste a value; nothing is written to disk or git):
   ```
   wrangler secret put ANTHROPIC_API_KEY       # from https://console.anthropic.com
   wrangler secret put STRIPE_SECRET_KEY       # from https://dashboard.stripe.com/apikeys (starts with sk_)
   wrangler secret put FIREBASE_CLIENT_EMAIL   # see "Firebase service account" below
   wrangler secret put FIREBASE_PRIVATE_KEY    # see "Firebase service account" below
   wrangler secret put ADMIN_TOKEN             # any long random string; gates the /admin routes
   ```
   `STRIPE_WEBHOOK_SECRET` comes later, once the endpoint exists (step 6). The optional ones (`RESEND_API_KEY`, `TURNSTILE_SECRET`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`) are documented where they're listed at the bottom of `wrangler.toml`; each route works without them.
4. In `wrangler.toml`, fill in:
   - `ALLOWED_ORIGIN`: a comma-separated list of the origins allowed to call this Worker, currently `"https://semester-hq.com,https://app.semester-hq.com"` (the marketing site and the app are different hostnames, so both are listed). **Don't leave this as `"*"` in production**; it's the only thing stopping another website from embedding your key/checkout.
   - `APP_URL`: the exact page Stripe should redirect back to after checkout, currently `"https://app.semester-hq.com/"`.
   - `FIREBASE_PROJECT_ID` and `FIREBASE_STORAGE_BUCKET`: from Firebase console → Project settings and → Storage (not secret, safe as plain vars). The bucket is used only by "delete my account", to remove a person's uploaded files.
5. Deploy: `wrangler deploy`, then copy the printed URL (e.g. `https://student-planner-ai-proxy.<you>.workers.dev`).
   - In `js/ai.js`, set `AI_PROXY_URL` to `<that URL>/v1/messages`. That's the only URL to configure: `js/checkout.js` derives the checkout/licensing endpoints from it automatically, since it's the same Worker.
6. **Set up the Stripe webhook** (this is what actually marks someone as paid, and keeps that in sync as the subscription renews or gets canceled):
   - Stripe dashboard → Developers → Webhooks → Add endpoint
   - Endpoint URL: `<your worker URL>/stripe-webhook`
   - Events to send: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy the "Signing secret" it gives you and run: `wrangler secret put STRIPE_WEBHOOK_SECRET`

## Firebase service account

This lets the Worker write `licenses/{uid}` on your behalf after a real Stripe payment, without using the (Node-only, Workers-incompatible) firebase-admin SDK.

1. Firebase console → Project settings (gear icon) → Service accounts
2. Generate new private key → downloads a JSON file. **Keep this private, never commit it**
3. From that JSON: `client_email` → `wrangler secret put FIREBASE_CLIENT_EMAIL`, and `private_key` (paste the whole thing including the `BEGIN/END PRIVATE KEY` lines) → `wrangler secret put FIREBASE_PRIVATE_KEY`

## Email notifications (contact form)

Optional. Without it, contact-form and group-pricing submissions still save to Firestore's `feedback` collection; this just also emails you a copy so you actually notice one came in.

1. Sign up at [resend.com](https://resend.com) (free tier: 3,000 emails/month, plenty for a contact form) and create an API key: dashboard → API Keys → Create API Key.
2. `wrangler secret put RESEND_API_KEY`, paste the key.
3. In `wrangler.toml`, set `NOTIFY_EMAIL` to the address you want submissions sent to (defaults to `hello@semester-hq.com`).
4. `NOTIFY_FROM` is `Semester HQ <notifications@send.semester-hq.com>`. The sending domain `send.semester-hq.com` was verified in Resend on 2026-09-20; its DKIM record and two CNAMEs live in Cloudflare, all unproxied.

   It is a subdomain deliberately. The apex already publishes an SPF record for Google Workspace, which handles mail for `hello@semester-hq.com`, and a domain may only have one SPF record. Adding a second would have broken delivery to that inbox rather than adding to it. The apex DMARC policy uses relaxed alignment, so a subdomain sender still aligns with it.

   Note what this code actually does: it emails **you** (`NOTIFY_EMAIL`) and nobody else. Whoever filled in the form is set as reply-to, so replying from your inbox reaches them directly. No student ever receives mail from Resend.
5. Redeploy (`wrangler deploy`) after changing `wrangler.toml`.

Each email's `reply_to` is set to the submitter's address, so replying to the notification goes straight back to them.

## Rate limiting

Protects against someone hammering the AI proxy or checkout routes and running up your bill. Already set up in `wrangler.toml`, nothing to do.

Every route goes through Cloudflare's own Workers Rate Limiting bindings (`RL_TIGHT` 5/min, `RL_NORMAL` 20/min, `RL_LOOSE` 60/min). `checkRateLimit` picks the smallest binding at least as large as the route's limit. These are atomic and free of KV's one-write-per-second-per-key rule, which used to turn a busy campus network into 500s.

The `RATE_LIMIT` KV namespace is still bound as the fallback for when a binding is missing, which in practice means local dev. If you ever need to recreate it: `wrangler kv:namespace create RATE_LIMIT`, then put the printed id in the `[[kv_namespaces]]` block.

## Cost control

- `ALLOWED_ORIGIN` restricts who can call the Worker at all.
- `src/index.js` caps AI `max_tokens` at 4000 and only allows a small model allowlist.
- Rate limiting (above) caps requests per IP per minute: 20 AI, 10 checkout, 10 billing portal, 15 license claim, 40 group, 10 calendar feed, 30 error reports, 60 tracked events, and 5 each for email lookup, account deletion and the contact form.
- Anthropic and Stripe usage are billed separately on your own accounts, per actual usage.

## Local testing

```
wrangler dev
```
Runs the Worker locally (e.g. `http://localhost:8787`). Point `AI_PROXY_URL`/`CHECKOUT_PROXY_URL` at that during development. Stripe webhooks need a public URL to reach `wrangler dev`, so use `stripe listen --forward-to localhost:8787/stripe-webhook` (Stripe CLI) to test the webhook locally, or just test against the deployed Worker with Stripe test-mode keys.
