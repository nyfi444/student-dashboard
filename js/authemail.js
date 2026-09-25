/* ── Emailed sign-in links and password links, shared ─────────────
   Used by login.html and group-admin.html. Both emails go out through
   the Worker (/auth-email), from send.semester-hq.com. Firebase's own
   sender is a shared firebaseapp.com address that Gmail files under
   Spam with the link switched off, which left people with an email and
   nothing to tap (Sept 25 2026). The Worker wants a Turnstile solve, so
   each page shows a confirm step with the widget on it first.

   Also the Turnstile helpers login.html's /check-email lookup uses. The
   widget switches on only when the page has the turnstile-sitekey meta
   tag, and the Worker only checks the token once TURNSTILE_SECRET is set.
──────────────────────────────────────────────────────────────── */

const TURNSTILE_SITEKEY = document.querySelector('meta[name="turnstile-sitekey"]')?.content || '';
let _tsWidget = null, _tsScriptStarted = false;
function turnstileToken() {
  try { return TURNSTILE_SITEKEY && window.turnstile && _tsWidget !== null ? window.turnstile.getResponse(_tsWidget) : ''; }
  catch { return ''; }
}
// A token is good for one use. Reset after every request so a second try
// on the same screen is not rejected for reusing the first one.
function resetTurnstile() { try { if (window.turnstile && _tsWidget !== null) window.turnstile.reset(_tsWidget); } catch {} }
function renderTurnstile() {
  const slot = document.querySelector('[data-turnstile]');
  if (!TURNSTILE_SITEKEY || !slot || !window.turnstile) return;
  try { _tsWidget = window.turnstile.render(slot, { sitekey: TURNSTILE_SITEKEY, theme: 'light' }); }
  catch { _tsWidget = null; }
}
// Call after every render that puts a [data-turnstile] slot on the page.
function mountTurnstile() {
  if (!TURNSTILE_SITEKEY) return;
  if (window.turnstile) { renderTurnstile(); return; }
  if (_tsScriptStarted) return; // already loading; its onload renders into whatever slot exists then
  _tsScriptStarted = true;
  const el = document.createElement('script');
  el.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  el.async = true; el.defer = true;
  el.onload = renderTurnstile;
  document.head.appendChild(el);
}

const AUTH_EMAIL_WHAT = { signin: 'a sign-in link', reset: 'a link to set your password' };

// kind is 'signin' or 'reset'. Resolves to { ok: true } once an email is on
// its way, or { error, stay } with words for the person; stay means keep
// the confirm screen up (the verification isn't finished yet).
async function requestAuthEmail(auth, kind, email, continueUrl) {
  const token = turnstileToken();
  if (TURNSTILE_SITEKEY && !token) return { error: 'Finish the verification box first, then tap Send.', stay: true };
  let res = null, data = {};
  try {
    res = await fetch(`${WORKER_URL}/auth-email`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, email, continueUrl, turnstileToken: token }),
    });
    data = await res.json().catch(() => ({}));
  } catch {}
  resetTurnstile();
  if (res?.ok) return rememberSignInEmail(kind, email);
  // A bad address or a failed verification: the person can fix either.
  if (res?.status === 400) return { error: data.error || 'Could not send that email. Try again.' };
  // Anything else (a daily cap, Resend down, no connection to the Worker)
  // still gets an email, from Firebase's own sender.
  diag.crumb('login', `auth email via Firebase (${res ? res.status : 'no response'})`);
  try {
    if (kind === 'signin') await auth.sendSignInLinkToEmail(email, { url: continueUrl, handleCodeInApp: true });
    else await auth.sendPasswordResetEmail(email);
    return rememberSignInEmail(kind, email);
  } catch (e) {
    if (kind === 'reset' && e.code === 'auth/user-not-found') return { ok: true }; // never say which emails have accounts
    if (e.code === 'auth/invalid-email') return { error: 'That email doesn’t look right.' };
    diag.error('login', kind === 'signin' ? 'Could not send sign-in link' : 'Could not send password reset', e);
    return { error: (kind === 'signin' ? 'Could not send the sign-in link: ' : 'Could not send the reset email: ') + e.message };
  }
}
// The link may open in a new tab from the mail app; on this device the
// email is waiting there, so finishing sign-in doesn't have to ask for it.
function rememberSignInEmail(kind, email) {
  if (kind === 'signin') localStorage.setItem(EMAIL_LINK_STORAGE_KEY, email);
  return { ok: true };
}
