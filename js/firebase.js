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
      if (user) {
        await cloudPull();
        toast(`Synced as ${user.displayName || user.email}`, 'success');
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

function queueCloudSync() {
  if (!_fbUser || _applyingRemote) return;
  if (_syncQueued) return;
  _syncQueued = true;
  setTimeout(async () => {
    _syncQueued = false;
    try {
      await _fbDb.collection('planners').doc(_fbUser.uid).set({ data: JSON.stringify(state), updatedAt: Date.now() });
    } catch (e) { console.warn('Cloud sync failed', e); }
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
  } catch (e) { console.warn('Cloud pull failed', e); }
}
