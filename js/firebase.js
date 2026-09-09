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

let _fbAuth = null, _fbDb = null, _fbStorage = null, _fbUser = null, _syncQueued = false, _applyingRemote = false;

function fbConfigured() { return !!FB_CONFIG.apiKey; }

function bootFirebase() {
  if (!fbConfigured() || typeof firebase === 'undefined') return;
  try {
    firebase.initializeApp(FB_CONFIG);
    _fbAuth = firebase.auth();
    _fbDb = firebase.firestore();
    _fbStorage = firebase.storage();
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
          // Must happen before cloudPull() — cloudPull writes straight to
          // dataStore, so switching it to real localStorage has to land
          // first or that write silently goes to the in-memory store instead.
          if (typeof enablePersistentStorage === 'function') enablePersistentStorage();
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
        } else {
          // Signed in but not on a paid plan — the paywall screen already
          // blocks real use of the app in this state, so nothing should
          // persist here either.
          if (typeof disablePersistentStorage === 'function') disablePersistentStorage();
        }
      } else {
        window._licenseChecked = true;
        if (typeof disablePersistentStorage === 'function') disablePersistentStorage();
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
let _syncTooLargeShown = false;
// Notebook notes sync to their own document per note — planners/{uid}/notes/{id}
// — instead of inline in the core planner doc. Inline was the actual bug:
// someone's notes only ever grow over a semester, so eventually the whole
// planner (not just notes) crossed Firestore's 1MB-per-document cap and
// *everything* silently stopped syncing, notes or not. Splitting notes out
// means the core doc (courses, assignments, calendar, settings, decks, etc.)
// stays small regardless of how many notes someone writes.
// Seeded by cloudPull() with whatever Firestore already has, so a note
// deleted locally after that gets deleted there too instead of resurfacing
// on another device.
let _lastSyncedNoteIds = new Set();

// File attachments (assignment files, study-group shared files/project
// files) are a *different* problem than notes: splitting into more
// Firestore documents doesn't help here, because a single photo or PDF can
// itself be several MB — well past the 1MB-per-document cap no matter how
// it's split. These upload to actual Firebase Storage instead, with only
// the resulting download URL (a short string) ever touching Firestore.
// Local-only (not signed in, or signed in but unpaid) usage is completely
// unaffected — attachments stay inline as base64, exactly as before, since
// there's no cloud sync happening for that account anyway.
async function uploadDataUrlToStorage(path, dataUrl) {
  const ref = _fbStorage.ref(path);
  await ref.putString(dataUrl, 'data_url');
  return await ref.getDownloadURL();
}
// Scans for any attachment still holding inline base64 (data:...) instead
// of a real Storage URL and uploads it — covers both a brand new upload
// that hasn't reached Storage yet (e.g. it was added while offline) and an
// existing account's already-synced attachments from before this shipped.
// Runs at the top of every sync cycle so it naturally retries anything that
// failed last time, without needing a separate one-time migration path.
async function migrateInlineAttachmentsToStorage() {
  if (!_fbUser || !window._licensed) return;
  const jobs = [];
  for (const a of state.assignments || []) {
    for (const att of a.attachments || []) {
      if (att.dataUrl && att.dataUrl.startsWith('data:')) {
        jobs.push((async () => {
          try {
            const url = await uploadDataUrlToStorage(`users/${_fbUser.uid}/attachments/${att.id}`, att.dataUrl);
            att.url = url; att.dataUrl = null;
          } catch (e) { console.warn('Attachment upload failed, staying local-only for now', att.id, e); }
        })());
      }
    }
  }
  for (const g of state.studyGroups || []) {
    for (const item of g.sharedItems || []) {
      if (item.kind === 'file' && item.dataUrl && item.dataUrl.startsWith('data:')) {
        jobs.push((async () => {
          try {
            const url = await uploadDataUrlToStorage(`studyGroups/${g.id}/${item.id}`, item.dataUrl);
            item.url = url; item.dataUrl = null;
          } catch (e) { console.warn('Shared file upload failed, staying local-only for now', item.id, e); }
        })());
      }
    }
    for (const p of g.projects || []) {
      for (const f of p.files || []) {
        if (f.dataUrl && f.dataUrl.startsWith('data:')) {
          jobs.push((async () => {
            try {
              const url = await uploadDataUrlToStorage(`studyGroups/${g.id}/${f.id}`, f.dataUrl);
              f.url = url; f.dataUrl = null;
            } catch (e) { console.warn('Project file upload failed, staying local-only for now', f.id, e); }
          })());
        }
      }
    }
  }
  if (jobs.length) await Promise.all(jobs);
}

function queueCloudSync() {
  if (!_fbUser || _applyingRemote) return;
  if (_syncQueued) return;
  _syncQueued = true;
  setTimeout(async () => {
    _syncQueued = false;
    try {
      await migrateInlineAttachmentsToStorage();
      const { notes, ...coreState } = state;
      const coreData = JSON.stringify(coreState);
      if (coreData.length > FIRESTORE_DOC_SAFE_BYTES) {
        // Every edit while still oversized re-enters this branch — only the
        // first one should actually interrupt the user, not one toast per
        // keystroke while they're still over the limit.
        if (!_syncTooLargeShown) {
          _syncTooLargeShown = true;
          toast('Your planner is getting large — recent changes aren’t syncing to the cloud (still saved on this device). Try removing old flashcard decks or attachments.', 'error', 6000);
        }
        console.warn('Cloud sync skipped: core payload too large', coreData.length);
        return;
      }
      _syncTooLargeShown = false;

      const planner = _fbDb.collection('planners').doc(_fbUser.uid);
      const notesCol = planner.collection('notes');
      const currentIds = new Set((notes || []).map(n => n.id));
      const deletedIds = [..._lastSyncedNoteIds].filter(id => !currentIds.has(id));

      // Firestore batches cap at 500 writes — chunk defensively, though no
      // real user is likely to ever come close to that many notes.
      const ops = [
        { type: 'core' },
        ...deletedIds.map(id => ({ type: 'delete', id })),
        ...(notes || []).map(n => ({ type: 'note', note: n })),
      ];
      for (let i = 0; i < ops.length; i += 500) {
        const batch = _fbDb.batch();
        for (const op of ops.slice(i, i + 500)) {
          if (op.type === 'core') batch.set(planner, { data: coreData, updatedAt: Date.now() });
          else if (op.type === 'delete') batch.delete(notesCol.doc(op.id));
          else {
            // A single note this large is very unlikely, but skip just that
            // one rather than let it block every other note and the core
            // doc from syncing.
            const noteJson = JSON.stringify(op.note);
            if (noteJson.length > FIRESTORE_DOC_SAFE_BYTES) {
              console.warn('Cloud sync skipped one oversized note', op.note.id, noteJson.length);
              continue;
            }
            batch.set(notesCol.doc(op.note.id), op.note);
          }
        }
        await batch.commit();
      }
      _lastSyncedNoteIds = currentIds;
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
    const planner = _fbDb.collection('planners').doc(_fbUser.uid);
    const [doc, notesSnap] = await Promise.all([planner.get(), planner.collection('notes').get()]);
    if (doc.exists && doc.data().data) {
      _applyingRemote = true;
      state = migrate(JSON.parse(doc.data().data));
      // Notes live in their own subcollection now (see queueCloudSync above).
      // An account that hasn't synced since this shipped still has them
      // inline in the core doc, restored by migrate() above as always; once
      // the subcollection actually has documents, it's the source of truth.
      if (!notesSnap.empty) state.notes = notesSnap.docs.map(d => d.data());
      _lastSyncedNoteIds = new Set(state.notes.map(n => n.id));
      _suspendSave = true;
      dataStore.setItem(storeKey, JSON.stringify(state));
      _suspendSave = false;
      _applyingRemote = false;
      // First pull for an account whose notes are still inline (pre-
      // migration) — push once now so they land on their own documents
      // right away instead of waiting for the next edit.
      if (notesSnap.empty && state.notes.length) queueCloudSync();
    } else {
      queueCloudSync();
    }
  } catch (e) {
    console.warn('Cloud pull failed', e);
    toast('Couldn’t load your synced data — showing what’s saved on this device instead.', 'error', 5000);
  }
}
