/* ── Paywall: $7.99/month subscription for sign-in and sync ───────
   Local-only usage (no sign-in) is always free. Signing in unlocks
   cross-device sync + AI upload, gated behind this subscription. The only
   thing that can ever mark a user as "paid" is the backend Worker (via
   Stripe webhook, using a service account) — see worker/README.md and
   firestore.rules. This file just talks to that Worker and reflects
   whatever it decides; it never sets license state itself.
──────────────────────────────────────────────────────────────── */
// Same Worker as AI_PROXY_URL (js/ai.js) — no separate URL to configure.
const CHECKOUT_PROXY_URL = (typeof AI_PROXY_URL !== 'undefined' ? AI_PROXY_URL : '').replace(/\/v1\/messages$/, '');
function checkoutEnabled() { return !!CHECKOUT_PROXY_URL; }

function checkoutReturnPending() { return new URLSearchParams(window.location.search).get('checkout') === 'success'; }
function clearCheckoutReturnParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('checkout')) return;
  url.searchParams.delete('checkout');
  url.searchParams.delete('session_id');
  history.replaceState({}, '', url.pathname + (url.search ? url.search : '') + url.hash);
}

async function redirectToCheckout() {
  if (!checkoutEnabled()) { toast('Payments aren’t set up on this deployment yet.', 'info', 4000); return; }
  try {
    const res = await fetch(`${CHECKOUT_PROXY_URL}/create-checkout-session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uid: _fbUser?.uid || null, email: _fbUser?.email || null }),
    });
    const data = await res.json();
    if (!res.ok || !data.url) throw new Error(data.error || 'Could not start checkout');
    window.location.href = data.url;
  } catch (e) {
    toast('Could not start checkout: ' + e.message, 'error', 5000);
  }
}

// Sends the user to Stripe's own hosted billing portal, where they can
// update payment info or cancel — Stripe handles the UI and the resulting
// webhook event (customer.subscription.deleted) updates licenses/{uid}.
async function redirectToPortal() {
  if (!checkoutEnabled() || !_fbUser) return;
  try {
    const idToken = await _fbUser.getIdToken();
    const res = await fetch(`${CHECKOUT_PROXY_URL}/create-portal-session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    const data = await res.json();
    if (!res.ok || !data.url) throw new Error(data.error || 'Could not open billing portal');
    window.location.href = data.url;
  } catch (e) {
    toast('Could not open billing portal: ' + e.message, 'error', 5000);
  }
}

// A hung Firestore read or fetch here would otherwise stall pollForLicense
// forever, leaving the "Finishing up your purchase…" screen stuck with no
// way out — so every network call in this function is capped.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
  ]);
}

// Asks the Worker: does `licenses/{uid}` already say paid, or is there an
// unclaimed purchase under this account's email (bought before signing up)?
// The Worker is the only thing that can WRITE a license (see firestore.rules)
// — this never writes anything itself, only reads/claims via the Worker.
async function resolveLicenseStatus() {
  if (!checkoutEnabled()) return true; // payments not configured on this deployment — don't gate
  if (!_fbUser) return false;
  try {
    const doc = await withTimeout(_fbDb.collection('licenses').doc(_fbUser.uid).get(), 8000);
    if (doc.exists && doc.data().paid) return true;
  } catch (e) { console.warn('License check failed', e); }
  try {
    const idToken = await withTimeout(_fbUser.getIdToken(), 8000);
    const res = await withTimeout(fetch(`${CHECKOUT_PROXY_URL}/claim-license`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }), 8000);
    const data = await res.json();
    return !!data.paid;
  } catch (e) { console.warn('License claim failed', e); return false; }
}

// Stripe's webhook can lag a few seconds behind the redirect back to the app,
// so right after a successful checkout we retry a few times before giving up.
async function pollForLicense(maxTries = 8, delayMs = 2500) {
  for (let i = 0; i < maxTries; i++) {
    if (_fbUser) {
      const ok = await resolveLicenseStatus();
      if (ok) return true;
    }
    await new Promise(r => setTimeout(r, delayMs));
  }
  return false;
}

function shouldShowPaywall() {
  if (!checkoutEnabled()) return false;
  if (!_fbUser) return checkoutReturnPending(); // free/local mode, unless returning from a fresh purchase to sign in
  if (!window._licenseChecked) return true;
  return !window._licensed;
}

function pagePaywall() {
  if (window._checkoutPending) {
    return `
      <div class="paywall-wrap">
        <div class="paywall-card">
          <h2>Finishing up your purchase…</h2>
          <p class="small muted">This usually takes a few seconds. Hang tight.</p>
        </div>
      </div>`;
  }
  if (checkoutReturnPending() && !_fbUser) {
    return `
      <div class="paywall-wrap">
        <div class="paywall-card">
          <h2>Payment received 🎉</h2>
          <p class="small muted mb-16">Sign in with Google to activate your account — it'll be linked to this purchase automatically.</p>
          <button class="btn btn-primary" style="width:100%" onclick="signIn()">${icon('sparkles', 13, 1.6)} Sign in with Google</button>
        </div>
      </div>`;
  }
  return `
    <div class="paywall-wrap">
      <div class="paywall-card">
        <h2>Unlock Semester HQ</h2>
        <p class="small muted mb-16">Billed monthly, cancel anytime. Unlocks cross-device sync and AI syllabus upload for this account.</p>
        <div class="paywall-price">$7.99<span class="paywall-price-period">/mo</span></div>
        <button class="btn btn-primary" style="width:100%" onclick="redirectToCheckout()">Subscribe</button>
        ${checkoutReturnPending() ? `<p class="small mt-16" style="color:var(--warn)">We received a payment but couldn't confirm it's linked to this account yet. If you just paid, try <a href="#" onclick="event.preventDefault();retryLicenseCheck()">checking again</a>, or contact <a href="mailto:hello@semester-hq.com">hello@semester-hq.com</a>.</p>` : ''}
        <p class="small muted mt-16">Already bought on another device? <a href="#" onclick="event.preventDefault();retryLicenseCheck()">Check again</a>.</p>
        <button class="btn btn-ghost btn-sm mt-8" onclick="signOutUser()">Not now — use local only on this device</button>
      </div>
    </div>`;
}
// Self-serve "Delete my account": cancels any active subscription and erases
// every server-side record (license, planner doc, Auth user) via the Worker.
// Local-only data in this browser is untouched — export a backup first if
// the user wants to keep it, same as any other sign-out.
async function deleteAccountFully() {
  if (!_fbUser) return;
  const idToken = await _fbUser.getIdToken();
  const res = await fetch(`${CHECKOUT_PROXY_URL}/delete-account`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not delete your account');
  await signOutUser();
  return data;
}

async function retryLicenseCheck() {
  toast('Checking…', 'info', 1500);
  window._licensed = await resolveLicenseStatus();
  window._licenseChecked = true;
  if (window._licensed) { clearCheckoutReturnParam(); await cloudPull(); toast('You’re all set!', 'success'); }
  if (typeof render === 'function') render();
}
