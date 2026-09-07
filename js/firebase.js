/* ── Sign-in + cross-device sync ─────────────────────────────────
   Fill in FB_CONFIG to enable real sign-in/sync:
   console.firebase.google.com → New project → Add web app → copy
   config below → enable Firestore + Google sign-in in the console.
   Until it's filled in, the app runs fully offline on localStorage
   and "Sign in" shows a friendly message instead of erroring.
──────────────────────────────────────────────────────────────── */
const FB_CONFIG = {
  apiKey: 'AIzaSyBruZ173x9OGtprhnJVO-8S7TY2taoSYQE',
  authDomain: 'semester-hq.firebaseapp.com',
  projectId: 'semester-hq',
  storageBucket: 'semester-hq.firebasestorage.app',
  messagingSenderId: '191691583510',
  appId: '1:191691583510:web:1a51e0b266c1257c4c8537',
};

let _fbAuth = null, _fbDb = null, _fbUser = null, _syncQueued = false, _applyingRemote = false;

function fbConfigured() { return !!FB_CONFIG.apiKey; }

function bootFirebase() {
  if (!fbConfigured() || typeof firebase === 'undefined') return;
  try {
    firebase.initializeApp(FB_CONFIG);
    _fbAuth = firebase.auth();
    _fbDb = firebase.firestore();
    // Safety net: normally an emailed sign-in link points at login.html (the
    // canonical sign-in page), but if one is ever opened while pointed at
    // the app itself, complete it here instead of leaving it inert.
    completeEmailLinkSignInIfPresent();
    _fbAuth.onAuthStateChanged(async (user) => {
      _fbUser = user;
      window._licenseChecked = false;
      window._licensed = false;
      if (typeof render === 'function') render(); // show a "checking" state rather than flash stale content
      if (user) {
        // Captured before resolveLicenseStatus()/pollForLicense() below, since
        // a successful license check clears this param — need to know whether
        // this moment is "just paid" to show "Your HQ is ready" instead of the
        // routine returning-user toast.
        const justPurchased = typeof checkoutReturnPending === 'function' && checkoutReturnPending();
        window._licensed = await resolveLicenseStatus();
        // Just came back from Stripe and the webhook may still be catching up — retry a bit before giving up.
        if (!window._licensed && justPurchased) {
          window._checkoutPending = true;
          if (typeof render === 'function') render();
          window._licensed = await pollForLicense();
          window._checkoutPending = false;
        }
        window._licenseChecked = true;
        if (window._licensed) {
          if (typeof clearCheckoutReturnParam === 'function') clearCheckoutReturnParam();
          await cloudPull();
          // cloudPull can replace `state` wholesale, so only backfill after it —
          // otherwise this gets clobbered. Without it, every signed-in account
          // defaults to the literal string "Me", so study group rosters can't
          // actually tell members apart.
          if (!state.settings.displayName && (user.displayName || user.email)) {
            state.settings.displayName = (user.displayName || user.email.split('@')[0]).trim();
            touch();
          }
          toast(justPurchased ? 'Your HQ is ready — welcome in.' : `Synced as ${user.displayName || user.email}`, 'success');
        }
      } else {
        window._licenseChecked = true;
      }
      if (typeof render === 'function') render();
    });
  } catch (e) { console.warn('Firebase init failed', e); }
}

// COPPA-relevant: our Terms/Privacy require sign-in users to be 13+. This
// isn't just policy text — it's a real gate a person has to check before
// the Google popup (or an email link) goes out, and only once per browser
// (localStorage), not re-shown every sign-in.
const AGE_TOS_KEY = 'shq_age_tos_confirmed';
// Holds an email address waiting on the age gate, so confirmAgeGateAndSignIn
// knows to resume the email flow instead of defaulting to Google.
let _pendingEmailSignIn = null;
async function signIn() {
  if (!fbConfigured()) { toast('Sync isn’t set up yet — add a Firebase config in js/firebase.js to enable it.', 'info', 4200); return; }
  // Returning 'age-gate' lets callers (e.g. signInFromOnboarding) know the
  // gate modal is now showing and awaiting the user, so they don't
  // immediately close it out from under them.
  if (localStorage.getItem(AGE_TOS_KEY) !== '1') { openAgeGateModal(); return 'age-gate'; }
  await runGoogleSignIn();
}
async function runGoogleSignIn() {
  try {
    // Always show Google's account chooser, even if this browser already has
    // a Google session — otherwise a user who picked the wrong account once
    // (or has multiple Google accounts) gets silently signed back into that
    // same wrong account on every later attempt, with no way to pick another
    // one short of clearing cookies.
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await _fbAuth.signInWithPopup(provider);
  } catch (e) {
    if (e.code !== 'auth/popup-closed-by-user') toast('Sign-in failed: ' + e.message, 'error');
  }
}
// One-click fix for "I'm signed in with the wrong Google account": sign out
// of this account, then immediately reopen the picker so they can choose the
// right one, instead of leaving them to figure out sign-out + sign-in as two
// separate, unlabeled steps.
async function switchGoogleAccount() {
  await signOutUser();
  await runGoogleSignIn();
}

// ── Email link (passwordless) sign-in — works with any address, not just
// Google accounts. Requires "Email Link" to be turned on in the Firebase
// console under Authentication → Sign-in method (a one-time setup step,
// not something this code can do on its own).
const EMAIL_LINK_STORAGE_KEY = 'shq_email_for_signin';
function emailSignInUrl() {
  // Always round-trips through login.html — the one canonical sign-in page —
  // regardless of which in-app screen (paywall, settings) kicked this off.
  return new URL('login.html', window.location.href).toString();
}
async function sendEmailSignInLink(email) {
  if (!fbConfigured()) { toast('Sync isn’t set up yet — add a Firebase config in js/firebase.js to enable it.', 'info', 4200); return false; }
  try {
    await _fbAuth.sendSignInLinkToEmail(email, { url: emailSignInUrl(), handleCodeInApp: true });
    localStorage.setItem(EMAIL_LINK_STORAGE_KEY, email);
    return true;
  } catch (e) {
    toast('Could not send sign-in link: ' + e.message, 'error');
    return false;
  }
}
// Safety net for opening the link somewhere other than login.html — see the
// call in bootFirebase(). login.html has its own copy of this same logic
// since it runs before the main app bundle is loaded.
async function completeEmailLinkSignInIfPresent() {
  if (!_fbAuth.isSignInWithEmailLink(window.location.href)) return;
  let email = localStorage.getItem(EMAIL_LINK_STORAGE_KEY);
  if (!email) email = window.prompt('Confirm the email you used to request this link:');
  if (!email) return;
  try {
    await _fbAuth.signInWithEmailLink(email, window.location.href);
    localStorage.removeItem(EMAIL_LINK_STORAGE_KEY);
    history.replaceState({}, '', window.location.pathname);
  } catch (e) {
    toast('Sign-in link failed: ' + e.message, 'error');
  }
}
function openEmailSignInModal() {
  openModal(`
    <div class="modal-head"><h3>Continue with email</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <p class="small muted mb-16">We'll email you a link to sign in — no password, and no Google account needed. Any email address works.</p>
      <div class="field"><input class="input" type="email" id="email-signin-input" placeholder="you@example.com" autocomplete="email"></div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitEmailSignIn()">Send link</button></div>
  `);
}
async function submitEmailSignIn() {
  const input = document.getElementById('email-signin-input');
  const email = input?.value.trim();
  if (!email) { toast('Enter your email first.', 'error'); return; }
  if (localStorage.getItem(AGE_TOS_KEY) !== '1') { _pendingEmailSignIn = email; openAgeGateModal(); return; }
  await sendEmailSignInLinkAndConfirm(email);
}
async function sendEmailSignInLinkAndConfirm(email) {
  const ok = await sendEmailSignInLink(email);
  if (!ok) return;
  openModal(`
    <div class="modal-head"><h3>Check your inbox</h3></div>
    <div class="modal-body"><p class="small muted">We sent a sign-in link to <strong>${esc(email)}</strong>. Open it on this device to finish logging in.</p></div>
    <div class="modal-foot"><button class="btn" style="width:100%" onclick="closeModal()">Done</button></div>
  `);
}

function openAgeGateModal() {
  openModal(`
    <div class="modal-head"><h3>Before you sign in</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <label class="checkbox-row" style="align-items:flex-start;gap:10px">
        <input type="checkbox" id="age-tos-check" style="margin-top:2px;width:18px;height:18px;flex-shrink:0">
        <span class="small">I'm at least 13 years old, and I agree to Semester HQ's <a href="https://semester-hq.com/terms.html" target="_blank" rel="noopener">Terms of Service</a> and <a href="https://semester-hq.com/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</span>
      </label>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmAgeGateAndSignIn()">Continue</button>
    </div>
  `);
}
async function confirmAgeGateAndSignIn() {
  const checkbox = document.getElementById('age-tos-check');
  if (!checkbox || !checkbox.checked) { toast('Check the box to continue.', 'error'); return; }
  localStorage.setItem(AGE_TOS_KEY, '1');
  closeModal();
  if (_pendingEmailSignIn) {
    const email = _pendingEmailSignIn;
    _pendingEmailSignIn = null;
    await sendEmailSignInLinkAndConfirm(email);
  } else {
    await runGoogleSignIn();
  }
}
async function signOutUser() { if (_fbAuth) await _fbAuth.signOut(); }

const FIRESTORE_DOC_SAFE_BYTES = 900000; // Firestore caps documents at 1MB — warn before we hit it
let _syncFailureShown = false;

function queueCloudSync() {
  if (!_fbUser || _applyingRemote) return;
  if (_syncQueued) return;
  _syncQueued = true;
  setTimeout(async () => {
    _syncQueued = false;
    try {
      const data = JSON.stringify(state);
      if (data.length > FIRESTORE_DOC_SAFE_BYTES) {
        toast('Your planner is getting large — some recent changes may not sync. Try removing old flashcard decks or attachments.', 'error', 6000);
        console.warn('Cloud sync skipped: payload too large', data.length);
        return;
      }
      await _fbDb.collection('planners').doc(_fbUser.uid).set({ data, updatedAt: Date.now() });
      _syncFailureShown = false;
    } catch (e) {
      console.warn('Cloud sync failed', e);
      if (!_syncFailureShown) {
        _syncFailureShown = true;
        toast('Sync failed — your changes are saved on this device and will retry.', 'error', 5000);
      }
    }
  }, 1200);
}

async function cloudPull() {
  if (!_fbUser) return;
  try {
    const doc = await _fbDb.collection('planners').doc(_fbUser.uid).get();
    if (doc.exists && doc.data().data) {
      _applyingRemote = true;
      state = migrate(JSON.parse(doc.data().data));
      _suspendSave = true;
      dataStore.setItem(storeKey, JSON.stringify(state));
      _suspendSave = false;
      _applyingRemote = false;
    } else {
      queueCloudSync();
    }
  } catch (e) {
    console.warn('Cloud pull failed', e);
    toast('Couldn’t load your synced data — showing what’s saved on this device instead.', 'error', 5000);
  }
}
