/* ── Paywall: $7.99/month subscription for sign-in and sync ───────
   Without an account the app is a demo that saves nothing. Signing in
   unlocks saving, cross-device sync and AI upload, behind this subscription. The only
   thing that can ever mark a user as "paid" is the backend Worker (via
   Stripe webhook, using a service account); see worker/README.md and
   firestore.rules. This file just talks to that Worker and reflects
   whatever it decides; it never sets license state itself.
──────────────────────────────────────────────────────────────── */
// Same Worker as everything else (WORKER_URL in js/config.js).
const CHECKOUT_PROXY_URL = WORKER_URL;
function checkoutEnabled() { return !!CHECKOUT_PROXY_URL; }

// The app without an account is a demo that keeps nothing. Said on every
// page, not only in Settings, so nobody types a whole semester in and loses
// it on the next reload. Gone the moment someone signs in.
function demoBannerHtml() {
  if (typeof isDemoMode !== 'function' || !isDemoMode()) return '';
  if (typeof _fbUser !== 'undefined' && _fbUser) return '';
  const plan = typeof isEmbedded === 'function' && isEmbedded() ? '' : ', or <a href="https://semester-hq.com/#pricing" target="_blank" rel="noopener">see the plan</a>';
  return `<div class="demo-bar" role="status"><strong>Demo.</strong>&nbsp;Nothing here is saved. <a href="#" onclick="event.preventDefault();signIn()">Sign in</a> to keep your semester${plan}.</div>`;
}

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
      // The Worker takes the buyer's identity from the token, never from a
      // uid in the body, so nobody can start a checkout in someone else's name.
      // A link code kept from the way in goes too (see linkCode in js/config.js).
      body: JSON.stringify({ ...(_fbUser ? { idToken: await _fbUser.getIdToken() } : {}), ...(linkCode() ? { via: linkCode() } : {}) }),
    });
    const data = await res.json();
    if (!res.ok || !data.url) throw new Error(data.error || 'Could not start checkout');
    window.location.href = data.url;
  } catch (e) {
    toast('Could not start checkout: ' + e.message, 'error', 5000);
    diag.error('checkout', 'Could not start checkout', e);
  }
}

// Sends the user to Stripe's own hosted billing portal, where they can
// update payment info or cancel. Stripe handles the UI and the resulting
// webhook event (customer.subscription.deleted) updates licenses/{uid}.
async function redirectToPortal() {
  if (!checkoutEnabled() || !_fbUser) return;
  try {
    const idToken = await _fbUser.getIdToken();
    const data = await workerPost('/create-portal-session', { idToken });
    if (!data.url) throw new Error('Could not open billing portal');
    window.location.href = data.url;
  } catch (e) {
    // Nothing to bill isn't an error worth a red toast: it's an answer.
    // Someone on a group plan, or on access that was set up for them, has
    // no subscription of their own to change.
    if (e.reason === 'group' || e.reason === 'no-billing') {
      openModal(`
        <div class="modal-head"><h3>${e.reason === 'group' ? 'Your group covers this' : 'Nothing to manage'}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
        <div class="modal-body">
          <p class="small">${esc(e.message)}</p>
          <p class="small muted mt-8">Questions about your plan? Email <a href="mailto:hello@semester-hq.com">hello@semester-hq.com</a>.</p>
        </div>
        <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">Got it</button></div>
      `);
      return;
    }
    // Anything else is a real failure, and a red toast that vanishes in five
    // seconds is the wrong way to tell someone their billing page won't open.
    // Say what happened, promise their subscription is untouched, and hand
    // them a way to reach a human with the support code attached.
    diag.error('checkout', 'Billing portal would not open', e);
    openModal(`
      <div class="modal-head"><h3>Couldn’t open the billing page</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
      <div class="modal-body">
        <p class="small">Stripe, which handles billing, didn’t answer just now. Nothing about your subscription changed, and you haven’t been charged anything extra.</p>
        <p class="small muted mt-8">Try again in a minute. If it keeps happening, email <a href="mailto:hello@semester-hq.com?subject=Billing%20portal">hello@semester-hq.com</a> with your support code <strong>${esc(diag.session)}</strong> and I’ll sort it out by hand, including cancelling for you if that’s what you want.</p>
        <p class="small muted mt-8">What it said: ${esc(e.message || 'no details')}</p>
      </div>
      <div class="modal-foot">
        <button class="btn" onclick="closeModal();redirectToPortal()">Try again</button>
        <button class="btn btn-primary" onclick="closeModal()">Close</button>
      </div>
    `);
  }
}

// A hung Firestore read or fetch here would otherwise stall pollForLicense
// forever, leaving the "Finishing up your purchase…" screen stuck with no
// way out, so every network call in this function is capped.
// Asks the Worker: does `licenses/{uid}` already say paid, or is there an
// unclaimed purchase under this account's email (bought before signing up)?
// The Worker is the only thing that can WRITE a license (see firestore.rules).
// This never writes anything itself, only reads/claims via the Worker.
// Returns true/false, or null when it couldn't reach anything (offline, or
// the network is down). A null must never be treated as "not paid": that used
// to wipe a paying student's device copy and show the paywall the moment they
// opened the app without a connection.
async function resolveLicenseStatus() {
  if (!checkoutEnabled()) return true; // payments not configured on this deployment, don't gate
  if (!_fbUser) return false;
  if (!navigator.onLine) return null;
  // Arrived on a group plan's invite link: take the seat, which is what
  // makes this account paid.
  if (typeof claimGroupSeat === 'function' && (pendingPlanCode() || (typeof pendingOrgCode === 'function' && pendingOrgCode()))) {
    if (await claimGroupSeat()) return true;
  }
  let reachedFirestore = false;
  try {
    const doc = await withTimeout(_fbDb.collection('licenses').doc(_fbUser.uid).get(), 8000);
    reachedFirestore = !doc.metadata?.fromCache;
    // Kept for Settings: whether this plan is the person's own subscription
    // or a seat in a group plan changes what it can offer them.
    if (doc.exists) window._licenseDoc = doc.data();
    if (doc.exists && doc.data().paid) return true;
  } catch (e) { diag.warn('license', 'License check failed', e); }
  try {
    const idToken = await withTimeout(_fbUser.getIdToken(), 8000);
    const res = await withTimeout(fetch(`${CHECKOUT_PROXY_URL}/claim-license`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }), 8000);
    const data = await res.json();
    return !!data.paid;
  } catch (e) { diag.warn('license', 'License claim failed', e); return reachedFirestore && navigator.onLine ? false : null; }
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
  if (!window._licenseChecked) {
    // Every sign-in (even a returning one Firebase already kept logged in)
    // re-verifies the license over the network before window._licenseChecked
    // flips true. Without this fast-path, that round trip showed the "No plan
    // on this account yet" paywall screen on literally every app open for a
    // paying user, reading as "I have to log in / subscribe again each
    // time." LICENSE_DEVICE_FLAG (see state.js) is exactly this browser's own
    // record of "the last check here came back paid," so trust it optimistically
    // and show real content while the check confirms in the background; if it
    // comes back negative, window._licenseChecked/_licensed flip and a normal
    // render() afterward shows the paywall same as always.
    try { return localStorage.getItem(LICENSE_DEVICE_FLAG) !== '1'; } catch { return true; }
  }
  return !window._licensed;
}

function pagePaywall() {
  // A subscriber on a new device: the license check takes a moment, and
  // until it answers this must not read as "no plan yet, subscribe".
  if (typeof _fbUser !== 'undefined' && _fbUser && !window._licenseChecked) {
    return `
      <div class="paywall-wrap">
        <div class="paywall-card">
          <h2>Checking your plan…</h2>
          <p class="small muted">Signed in as ${esc(_fbUser.email || _fbUser.displayName || 'you')}. One moment.</p>
        </div>
      </div>`;
  }
  if (window._checkoutPending) {
    return `
      <div class="paywall-wrap">
        <div class="paywall-card">
          <h2>Setting up your HQ…</h2>
          <p class="small muted">This usually takes a few seconds. Hang tight.</p>
        </div>
      </div>`;
  }
  if (checkoutReturnPending() && !_fbUser) {
    return `
      <div class="paywall-wrap">
        <div class="paywall-card">
          <h2>Payment received</h2>
          <p class="small muted mb-16">Sign in to activate your account. It'll be linked to this purchase automatically. Use whichever you paid with; any email works, not just Google.</p>
          <button class="btn btn-primary" style="width:100%" onclick="signIn()">${icon('sparkles', 13, 1.6)} Continue with Google</button>
          <button class="btn btn-sm mt-8" style="width:100%" onclick="openEmailSignInModal()">Continue with email instead</button>
        </div>
      </div>`;
  }
  const signedInEmail = _fbUser?.email || '';
  if (typeof loadPlanInvite === 'function') loadPlanInvite();
  return `
    <div class="paywall-wrap">
      <div class="paywall-card">
        <h2>No plan on this account yet</h2>
        ${signedInEmail ? `<p class="small muted mb-8">Signed in as <strong>${esc(signedInEmail)}</strong></p>` : ''}
        ${typeof planInviteCard === 'function' ? planInviteCard() : ''}
        ${typeof pendingInviteBanner === 'function' ? pendingInviteBanner() : ''}
        ${typeof pendingOrgCode === 'function' && pendingOrgCode() && !(typeof pendingJoinCode === 'function' && pendingJoinCode()) ? `<div class="sg-callout small mb-16" style="text-align:left"><span>${icon('shield', 15, 1.8)}</span><div>You’ve been invited to join a club or team. Subscribe to get its events on your calendar. Signing up the whole group? <a href="${GROUP_PRICING_URL}" target="_blank" rel="noopener">Ask about group pricing</a>.</div></div>` : ''}
        ${typeof pendingClassCode === 'function' && pendingClassCode() && !(typeof pendingJoinCode === 'function' && pendingJoinCode()) ? `<div class="sg-callout small mb-16" style="text-align:left"><span>${icon('graduation-cap', 15, 1.8)}</span><div>A classmate shared a class with you. Subscribe to add it with every deadline already filled in.</div></div>` : ''}
        <p class="small muted mb-16">If you already subscribed, this is probably just the wrong account. Switch below and it'll unlock right away. Otherwise, $7.99/mo unlocks cross-device sync, AI syllabus upload, and study groups for this account. Billed monthly, cancel anytime.</p>
        <div class="paywall-price">$7.99<span class="paywall-price-period">/mo</span></div>
        <button class="btn btn-primary" style="width:100%" onclick="redirectToCheckout()">Subscribe</button>
        ${checkoutReturnPending() ? `<p class="small mt-16" style="color:var(--warn)">We received a payment but couldn't confirm it's linked to this account yet. If you just paid, try <a href="#" onclick="event.preventDefault();retryLicenseCheck()">checking again</a>, or contact <a href="mailto:hello@semester-hq.com">hello@semester-hq.com</a>.</p>` : ''}
        <p class="small muted mt-16">Already bought on another device? <a href="#" onclick="event.preventDefault();retryLicenseCheck()">Check again</a>.</p>
        <button class="btn btn-sm mt-8" style="width:100%" onclick="switchGoogleAccount()">Wrong account? Switch Google account</button>
        <button class="btn btn-sm mt-8" style="width:100%" onclick="openEmailSignInModal()">Or log in with a different email</button>
        <button class="btn btn-ghost btn-sm mt-8" onclick="signOutUser()">Not now, sign out</button>
      </div>
    </div>`;
}
// Self-serve "Delete my account": cancels any active subscription and erases
// every server-side record (license, planner doc, Auth user) via the Worker,
// and steps them out of every study group, club and shared class they had
// joined, handing on ownership where they owned one. Local-only data in this
// browser is untouched. Export a backup first if the user wants to keep it,
// same as any other sign-out.
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
  const status = await resolveLicenseStatus();
  if (status === null) { toast('Can’t reach Semester HQ right now. Check your connection and try again.', 'error'); return; }
  window._licensed = status;
  window._licenseChecked = true;
  if (window._licensed) { clearCheckoutReturnParam(); await cloudPull(); toast('You’re all set!', 'success'); }
  if (typeof render === 'function') render();
}
