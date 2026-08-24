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

let _fbAuth = null, _fbDb = null, _fbUser = null, _syncQueued = false, _applyingRemote = false, _fbAuthStateSettled = false;

function fbConfigured() { return !!FB_CONFIG.apiKey; }

function bootFirebase() {
  if (!fbConfigured() || typeof firebase === 'undefined') return;
  try {
    firebase.initializeApp(FB_CONFIG);
    _fbAuth = firebase.auth();
    _fbDb = firebase.firestore();
    _fbAuth.onAuthStateChanged(async (user) => {
      const isFirstCallback = !_fbAuthStateSettled;
      _fbAuthStateSettled = true;
      _fbUser = user;
      window._licenseChecked = false;
      window._licensed = false;
      if (typeof render === 'function') render(); // show a "checking" state rather than flash stale content
      if (user) {
        window._licensed = await resolveLicenseStatus();
        // Just came back from Stripe and the webhook may still be catching up — retry a bit before giving up.
        if (!window._licensed && typeof checkoutReturnPending === 'function' && checkoutReturnPending()) {
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
          toast(`Synced as ${user.displayName || user.email}`, 'success');
        }
      } else {
        window._licenseChecked = true;
      }
      if (typeof render === 'function') render();
      if (isFirstCallback && typeof maybeShowOnboarding === 'function') maybeShowOnboarding();
    });
  } catch (e) { console.warn('Firebase init failed', e); }
}

async function signIn() {
  if (!fbConfigured()) { toast('Sync isn’t set up yet — add a Firebase config in js/firebase.js to enable it.', 'info', 4200); return; }
  try {
    await _fbAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
  } catch (e) {
    if (e.code !== 'auth/popup-closed-by-user') toast('Sign-in failed: ' + e.message, 'error');
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
      localStorage.setItem(storeKey, JSON.stringify(state));
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
