# AI proxy (Cloudflare Worker)

Holds your Anthropic API key server-side so students never see, paste, or pay for their own key. The planner's frontend calls this Worker instead of `api.anthropic.com` directly.

## Deploy

1. Install Wrangler (Cloudflare's CLI), if you don't have it:
   ```
   npm install -g wrangler
   ```
2. From this `worker/` directory, log in (opens a browser to authorize your Cloudflare account — create a free account first at https://dash.cloudflare.com/sign-up if you don't have one):
   ```
   wrangler login
   ```
3. Set your real Anthropic API key as a secret (get one at https://console.anthropic.com — never put this in `wrangler.toml` or commit it):
   ```
   wrangler secret put ANTHROPIC_API_KEY
   ```
4. (Recommended) Lock the Worker down to your actual site's origin so randoms can't use your key from other sites. Edit `ALLOWED_ORIGIN` in `wrangler.toml`, e.g.:
   ```
   ALLOWED_ORIGIN = "https://nyfi444.github.io"
   ```
5. Deploy:
   ```
   wrangler deploy
   ```
   Wrangler prints the deployed URL, something like:
   ```
   https://student-planner-ai-proxy.<your-subdomain>.workers.dev
   ```
6. Back in the planner, open `js/ai.js` and set:
   ```js
   const AI_PROXY_URL = 'https://student-planner-ai-proxy.<your-subdomain>.workers.dev/v1/messages';
   ```
   (note the `/v1/messages` path at the end). Reload the app — Settings → AI should now show "Ready to use," and syllabus/assignment upload will work with no per-user setup.

## Cost control

- `wrangler.toml` restricts the origin allowed to call the Worker.
- `src/index.js` caps `max_tokens` at 4000 and only allows a small model allowlist, so a bug or bad actor can't rack up an unbounded bill.
- Cloudflare Workers' free tier covers generous request volume; Anthropic usage is billed separately on your Anthropic account per token.
- For real production traffic, consider adding per-IP rate limiting (e.g. a Cloudflare Rate Limiting rule, or a KV/Durable Object counter) — not included here since it depends on how much usage you expect.

## Local testing

```
wrangler dev
```
This runs the Worker locally (e.g. `http://localhost:8787`) — point `AI_PROXY_URL` at that during development, then switch to the deployed URL for production.
