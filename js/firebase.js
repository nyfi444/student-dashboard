/* ── Sign-in + cross-device sync ─────────────────────────────────
   FB_CONFIG lives in js/config.js. Without it, the app runs fully
   offline on localStorage and "Sign in" shows a friendly message
   instead of erroring.
──────────────────────────────────────────────────────────────── */
let _fbAuth = null, _fbDb = null, _fbStorage = null, _fbUser = null, _syncQueued = false, _applyingRemote = false;
// Guards the realtime listeners below against replaying our own writes back
// onto ourselves (see startRealtimeSync). Set from whichever of cloudPull()
// or queueCloudSync() most recently established what Firestore holds.
let _lastKnownUpdatedAt = 0;
let _plannerUnsub = null, _notesUnsub = null;
const DEVICE_LOCAL_VIEW_KEYS = ['route', 'subRoute', 'groupTab', 'orgTab', 'groupTaskFilter', 'calView', 'calDate', 'todoFilter', 'notebookSelected', 'todayMode'];

function fbConfigured() { return !!FB_CONFIG.apiKey; }

// Marks "this device has edits the cloud hasn't confirmed yet," so a reload
// (or reopening after being offline) can tell local edits apart from a stale
// copy. See cloudPull.
const UNSYNCED_KEY = 'shq_unsynced';
function markLocalUnsynced() {
  if (!_fbUser || !window._licensed || _applyingRemote) return;
  try { localStorage.setItem(UNSYNCED_KEY, JSON.stringify({ uid: _fbUser.uid, at: Date.now() })); } catch {}
}
function readUnsyncedMarker() { try { return JSON.parse(localStorage.getItem(UNSYNCED_KEY) || 'null'); } catch { return null; } }
function clearUnsyncedMarker(upTo) {
  const m = readUnsyncedMarker();
  if (m && m.at <= upTo) try { localStorage.removeItem(UNSYNCED_KEY); } catch {}
}

// Local test runs only: the signed-in browser tests (tests/e2e) run against
// the Firebase emulators that tests/with-emulators.mjs starts, loaded with
// this repo's own rules. Both conditions have to hold — a page served from
// this machine AND a flag only the tests set — so no deployed copy of the
// app can ever take this path, whatever is in anyone's localStorage.
const FIREBASE_EMULATOR_FLAG = 'shq_firebase_emulators';
function firebaseEmulatorHost() {
  try {
    if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return '';
    return localStorage.getItem(FIREBASE_EMULATOR_FLAG) === '1' ? '127.0.0.1' : '';
  } catch { return ''; }
}

function bootFirebase() {
  if (!fbConfigured() || typeof firebase === 'undefined') return;
  try {
    const emulator = firebaseEmulatorHost();
    // The emulators run as demo-semester-hq, a project id the Firebase tools
    // treat as offline-only: nothing addressed to it can reach the real one.
    firebase.initializeApp(emulator ? { ...FB_CONFIG, projectId: 'demo-semester-hq', storageBucket: 'demo-semester-hq.appspot.com' } : FB_CONFIG);
    _fbAuth = firebase.auth();
    _fbDb = firebase.firestore();
    if (emulator) {
      _fbAuth.useEmulator(`http://${emulator}:9099`, { disableWarnings: true });
      _fbDb.useEmulator(emulator, 8080);
    }
    // Safety net: normally an emailed sign-in link points at login.html (the
    // canonical sign-in page), but if one is ever opened while pointed at
    // the app itself, complete it here instead of leaving it inert.
    completeEmailLinkSignInIfPresent();
    _fbAuth.onAuthStateChanged(async (user) => {
      stopRealtimeSync(); // never let a listener from a previous account/session keep running into this one
      _fbUser = user;
      window._licenseChecked = false;
      window._licensed = false;
      if (typeof render === 'function') render(); // show a "checking" state rather than flash stale content
      if (user) {
        recordTermsAcceptance(user); // nothing waits on this
        // Captured before resolveLicenseStatus()/pollForLicense() below, since
        // a successful license check clears this param. Need to know whether
        // this moment is "just paid" to show "Your HQ is ready" instead of the
        // routine returning-user toast.
        const justPurchased = typeof checkoutReturnPending === 'function' && checkoutReturnPending();
        const status = await resolveLicenseStatus();
        // Offline (or the network's down): keep trusting this device's last
        // confirmed answer, and re-check once the connection comes back.
        window._licenseOffline = status === null;
        window._licensed = status === null ? localStorage.getItem(LICENSE_DEVICE_FLAG) === '1' : status;
        // Just came back from Stripe and the webhook may still be catching up, so retry a bit before giving up.
        if (!window._licensed && justPurchased) {
          window._checkoutPending = true;
          if (typeof render === 'function') render();
          window._licensed = await pollForLicense();
          window._checkoutPending = false;
        }
        window._licenseChecked = true;
        if (window._licensed) {
          // Must happen before cloudPull(): cloudPull writes straight to
          // dataStore, so switching it to real localStorage has to land
          // first or that write silently goes to the in-memory store instead.
          if (typeof enablePersistentStorage === 'function') enablePersistentStorage();
          if (typeof clearCheckoutReturnParam === 'function') clearCheckoutReturnParam();
          await cloudPull();
          // cloudPull can replace `state` wholesale, so only backfill after it,
          // otherwise this gets clobbered. Without it, every signed-in account
          // defaults to the literal string "Me", so study group rosters can't
          // actually tell members apart.
          if (!state.settings.displayName && (user.displayName || user.email)) {
            state.settings.displayName = (user.displayName || user.email.split('@')[0]).trim();
            touch();
          }
          toast(justPurchased ? 'Your HQ is ready, welcome in.' : `Synced as ${user.displayName || user.email}`, 'success');
        } else {
          // Signed in but not on a paid plan. The paywall screen already
          // blocks real use of the app in this state, so nothing should
          // persist here either.
          if (typeof disablePersistentStorage === 'function') disablePersistentStorage();
        }
      } else {
        window._licenseChecked = true;
        if (typeof disablePersistentStorage === 'function') disablePersistentStorage();
      }
      if (typeof render === 'function') render();
      if (typeof onGroupsAuthResolved === 'function') onGroupsAuthResolved();
    });
  } catch (e) { diag.error('sync', 'Firebase init failed', e); }
}

// COPPA-relevant: our Terms/Privacy require sign-in users to be 13+. This
// isn't just policy text: it's a real gate a person has to check before
// the Google popup (or an email link) goes out, and only once per browser
// (localStorage), not re-shown every sign-in.
// Holds an email address waiting on the age gate, so confirmAgeGateAndSignIn
// knows to resume the email flow instead of defaulting to Google.
let _pendingEmailSignIn = null;
async function signIn() {
  if (!fbConfigured()) { toast('Sync isn’t set up yet. Add a Firebase config in js/config.js to enable it.', 'info', 4200); return; }
  // Returning 'age-gate' lets callers (e.g. signInFromOnboarding) know the
  // gate modal is now showing and awaiting the user, so they don't
  // immediately close it out from under them.
  if (localStorage.getItem(AGE_TOS_KEY) !== '1') { openAgeGateModal(); return 'age-gate'; }
  await runGoogleSignIn();
}
async function runGoogleSignIn() {
  try {
    // Always show Google's account chooser, even if this browser already has
    // a Google session, otherwise a user who picked the wrong account once
    // (or has multiple Google accounts) gets silently signed back into that
    // same wrong account on every later attempt, with no way to pick another
    // one short of clearing cookies.
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await _fbAuth.signInWithPopup(provider);
  } catch (e) {
    if (e.code !== 'auth/popup-closed-by-user') { toast('Sign-in failed: ' + e.message, 'error'); diag.error('auth', 'Google sign-in failed', e); }
  }
}
// One-click fix for "I'm signed in with the wrong Google account": sign out
// of this account, then immediately reopen the picker so they can choose the
// right one, instead of leaving them to figure out sign-out + sign-in as two
// separate, unlabeled steps.
async function switchGoogleAccount() {
  await signOutUser();
  if (localStorage.getItem(AGE_TOS_KEY) !== '1') { openAgeGateModal(); return; }
  await runGoogleSignIn();
}

// ── Email link (passwordless) sign-in: works with any address, not just
// Google accounts. Requires "Email Link" to be turned on in the Firebase
// console under Authentication → Sign-in method (a one-time setup step,
// not something this code can do on its own).
function emailSignInUrl() {
  // Always round-trips through login.html (the one canonical sign-in page),
  // regardless of which in-app screen (paywall, settings) kicked this off.
  return new URL('login.html', window.location.href).toString();
}
async function sendEmailSignInLink(email) {
  if (!fbConfigured()) { toast('Sync isn’t set up yet. Add a Firebase config in js/config.js to enable it.', 'info', 4200); return false; }
  try {
    await _fbAuth.sendSignInLinkToEmail(email, { url: emailSignInUrl(), handleCodeInApp: true });
    localStorage.setItem(EMAIL_LINK_STORAGE_KEY, email);
    return true;
  } catch (e) {
    toast('Could not send sign-in link: ' + e.message, 'error');
    diag.error('auth', 'Could not send sign-in link', e);
    return false;
  }
}
// Safety net for opening the link somewhere other than login.html, see the
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
    diag.error('auth', 'Sign-in link failed', e);
  }
}
function openEmailSignInModal() {
  openModal(`
    <div class="modal-head"><h3>Continue with email</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <p class="small muted mb-16">We'll email you a link to sign in, no password, and no Google account needed. Any email address works.</p>
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
// Records on the account that the age and terms box was ticked (see
// openAgeGateModal): a browser can be cleared, the account record can't.
// Once per session per account; failures are only logged.
async function recordTermsAcceptance(user) {
  try {
    if (!WORKER_URL || localStorage.getItem(AGE_TOS_KEY) !== '1' || sessionStorage.getItem('shq_terms_recorded') === user.uid) return;
    const idToken = await user.getIdToken();
    const res = await fetch(`${WORKER_URL}/account/attest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken, ageConfirmed: true }) });
    if (res.ok) sessionStorage.setItem('shq_terms_recorded', user.uid);
  } catch (e) { diag.warn('auth', 'Could not record the terms acceptance', e); }
}
async function signOutUser() { if (_fbAuth) await _fbAuth.signOut(); }

const FIRESTORE_DOC_SAFE_BYTES = 900000; // Firestore caps documents at 1MB, warn before we hit it
let _syncFailureShown = false;
let _syncTooLargeShown = false;
// Notebook notes sync to their own document per note, planners/{uid}/notes/{id},
// instead of inline in the core planner doc. Inline was the actual bug:
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
// itself be several MB, well past the 1MB-per-document cap no matter how
// it's split. These upload to actual Firebase Storage instead, with only
// the resulting download URL (a short string) ever touching Firestore.
// Local-only (not signed in, or signed in but unpaid) usage is completely
// unaffected. Attachments stay inline as base64, exactly as before, since
// there's no cloud sync happening for that account anyway.
async function fbStorage() {
  if (!_fbStorage) {
    if (!firebase.storage) await loadScriptOnce(FIREBASE_STORAGE_SRC);
    _fbStorage = firebase.storage();
    const emulator = firebaseEmulatorHost();
    if (emulator) _fbStorage.useEmulator(emulator, 9199);
  }
  return _fbStorage;
}
// fileName, when given, is stored with the upload so the download opens or
// saves under that name with the right type (see storageFileMetadata).
async function uploadDataUrlToStorage(path, dataUrl, fileName) {
  const ref = (await fbStorage()).ref(path);
  const type = (String(dataUrl).match(/^data:([^;,]+)/) || [])[1];
  await ref.putString(dataUrl, 'data_url', fileName ? storageFileMetadata(fileName, type) : undefined);
  return await ref.getDownloadURL();
}
// Files uploaded before names were kept (Sep 15, 2026) open as a random id
// with no extension. Gives each one its real name and type once; any
// signed-in member may update a file's metadata (see storage.rules).
const NAMED_FILES_KEY = 'shq_named_files';
let _namingFiles = false, _namingQueued = [];
const _namingFailed = new Set(); // tried this session and couldn't; not retried until the next app open
async function nameStoredFiles(files) {
  if (!_fbUser || !window._licensed) return;
  if (_namingFiles) { _namingQueued.push(...files); return; }
  let done;
  try { done = new Set(JSON.parse(localStorage.getItem(NAMED_FILES_KEY) || '[]')); } catch { done = new Set(); }
  const todo = files.filter(f => f && f.name && String(f.url || '').includes('firebasestorage') && !done.has(f.url) && !_namingFailed.has(f.url));
  if (!todo.length) return;
  _namingFiles = true;
  try {
    const st = await fbStorage();
    for (const f of todo) {
      try {
        const ref = st.refFromURL(f.url);
        const meta = await ref.getMetadata();
        const want = storageFileMetadata(f.name, meta.contentType);
        if (meta.contentDisposition !== want.contentDisposition || meta.contentType !== want.contentType) await ref.updateMetadata(want);
        done.add(f.url);
      } catch (e) {
        if (e?.code === 'storage/object-not-found') done.add(f.url);
        else { _namingFailed.add(f.url); diag.warn('uploads', 'Could not name a stored file', e); }
      }
    }
    try { localStorage.setItem(NAMED_FILES_KEY, JSON.stringify([...done].slice(-400))); } catch {}
  } finally {
    _namingFiles = false;
    if (_namingQueued.length) nameStoredFiles(_namingQueued.splice(0));
  }
}
// Scans for any attachment still holding inline base64 (data:...) instead
// of a real Storage URL and uploads it. Covers both a brand new upload
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
            const url = await uploadDataUrlToStorage(`users/${_fbUser.uid}/attachments/${att.id}-${storageSafeName(att.name)}`, att.dataUrl, att.name);
            att.url = url; att.dataUrl = null;
          } catch (e) { diag.warn('sync', 'Attachment upload failed, staying local-only for now', e); }
        })());
      }
    }
  }
  // Study group files upload straight to Storage when shared (see
  // addCloudGroupItem in studygroups.js), so they never sit inline here.
  if (jobs.length) await Promise.all(jobs);
  nameStoredFiles((state.assignments || []).flatMap(a => (a.attachments || []).filter(att => att.url && !att.dataUrl).map(att => ({ url: att.url, name: att.name }))));
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
      const capturedAt = Date.now();
      if (coreData.length > FIRESTORE_DOC_SAFE_BYTES) {
        // Every edit while still oversized re-enters this branch. Only the
        // first one should actually interrupt the user, not one toast per
        // keystroke while they're still over the limit.
        if (!_syncTooLargeShown) {
          _syncTooLargeShown = true;
          toast('Your planner is getting large. Recent changes aren’t syncing to the cloud (still saved on this device). Try removing old flashcard decks or attachments.', 'error', 6000);
        }
        diag.error('sync', 'Cloud sync skipped: planner too large', null, { bytes: coreData.length });
        return;
      }
      _syncTooLargeShown = false;

      const planner = _fbDb.collection('planners').doc(_fbUser.uid);
      const notesCol = planner.collection('notes');
      const currentIds = new Set((notes || []).map(n => n.id));
      const deletedIds = [..._lastSyncedNoteIds].filter(id => !currentIds.has(id));

      // Stamped on the core doc and remembered locally so the realtime listener
      // (see startRealtimeSync) can recognize the echo of this exact write and
      // skip re-applying it, otherwise it would periodically stomp on whatever
      // got typed in the moment between sending this write and hearing it back.
      const myUpdatedAt = Date.now();

      // Firestore batches cap at 500 writes, chunk defensively, though no
      // real user is likely to ever come close to that many notes.
      const ops = [
        { type: 'core' },
        ...deletedIds.map(id => ({ type: 'delete', id })),
        ...(notes || []).map(n => ({ type: 'note', note: n })),
      ];
      for (let i = 0; i < ops.length; i += 500) {
        const batch = _fbDb.batch();
        for (const op of ops.slice(i, i + 500)) {
          if (op.type === 'core') batch.set(planner, { data: coreData, updatedAt: myUpdatedAt });
          else if (op.type === 'delete') batch.delete(notesCol.doc(op.id));
          else {
            // A single note this large is very unlikely, but skip just that
            // one rather than let it block every other note and the core
            // doc from syncing.
            const noteJson = JSON.stringify(op.note);
            if (noteJson.length > FIRESTORE_DOC_SAFE_BYTES) {
              diag.warn('sync', 'Cloud sync skipped an oversized note', null, { bytes: noteJson.length });
              continue;
            }
            batch.set(notesCol.doc(op.note.id), op.note);
          }
        }
        await batch.commit();
      }
      _lastKnownUpdatedAt = myUpdatedAt;
      clearUnsyncedMarker(capturedAt);
      _lastSyncedNoteIds = currentIds;
      _syncFailureShown = false;
    } catch (e) {
      diag.error('sync', 'Cloud sync failed', e);
      if (!_syncFailureShown && navigator.onLine) {
        _syncFailureShown = true;
        toast('Sync failed. Your changes are saved on this device and will retry.', 'error', 5000);
      }
    }
  }, 1200);
}

async function cloudPull() {
  if (!_fbUser) return;
  try {
    const planner = _fbDb.collection('planners').doc(_fbUser.uid);
    const [doc, notesSnap] = await Promise.all([planner.get(), planner.collection('notes').get()]);
    const pending = readUnsyncedMarker();
    if (doc.exists && doc.data().data && pending && pending.uid === _fbUser.uid && pending.at > (doc.data().updatedAt || 0)) {
      // Changes were made on this device (probably offline) after the cloud
      // copy was last written, and never made it up. Keep them and push,
      // instead of replacing them with the older cloud version.
      _lastKnownUpdatedAt = doc.data().updatedAt || 0;
      _lastSyncedNoteIds = new Set(notesSnap.docs.map(d => d.id));
      queueCloudSync();
      toast('Synced the changes you made while offline.', 'success');
    } else if (doc.exists && doc.data().data) {
      _applyingRemote = true;
      state = migrate(JSON.parse(doc.data().data));
      _lastKnownUpdatedAt = doc.data().updatedAt || 0;
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
      // migration). Push once now so they land on their own documents
      // right away instead of waiting for the next edit.
      if (notesSnap.empty && state.notes.length) queueCloudSync();
    } else {
      queueCloudSync();
    }
  } catch (e) {
    diag.error('sync', 'Cloud pull failed', e);
    if (navigator.onLine) toast('Couldn’t load your synced data. Showing what’s saved on this device instead.', 'error', 5000);
  }
  // This one-time pull only ever reflects the moment the app opened. Without
  // a live listener, a device left open in another tab/window keeps whatever
  // it loaded at that moment, and its *own* next edit (a full-document write,
  // see queueCloudSync) then silently overwrites newer changes made anywhere
  // else in the meantime. That mismatch, "my other device doesn't have my
  // latest changes," is the sync problem people keep running into. Starting
  // a realtime listener here means every open tab hears about a change within
  // about a second of it happening, instead of only at the next full reload.
  startRealtimeSync();
  if (typeof startGroupSync === 'function') startGroupSync();
  if (typeof syncFeedsIfStale === 'function') syncFeedsIfStale().catch(() => {});
}

// Keeps this session's planner doc + notes live-synced with Firestore instead
// of only ever reading it once at boot. Guards against reacting to the echo
// of our own writes (via _lastKnownUpdatedAt / per-note updatedAt) so an
// incoming snapshot can never stomp on something typed moments ago. See the
// comment on _lastKnownUpdatedAt above for why that matters.
function startRealtimeSync() {
  stopRealtimeSync();
  if (!_fbUser) return;
  const planner = _fbDb.collection('planners').doc(_fbUser.uid);

  _plannerUnsub = planner.onSnapshot((doc) => {
    // A local edit is either mid-debounce or already in flight, let it land
    // (and update _lastKnownUpdatedAt itself) rather than race it here.
    if (_syncQueued || _applyingRemote) return;
    if (!doc.exists || !doc.data()?.data) return;
    const remoteUpdatedAt = doc.data().updatedAt || 0;
    if (remoteUpdatedAt <= _lastKnownUpdatedAt) return; // our own echo, or nothing newer than what we have
    let incoming;
    try { incoming = migrate(JSON.parse(doc.data().data)); }
    catch (e) { diag.warn('sync', 'Bad realtime planner snapshot, ignoring', e); return; }
    _lastKnownUpdatedAt = remoteUpdatedAt;
    _applyingRemote = true;
    const keepNotes = state.notes; // notes sync independently below, never inline in this doc's payload
    // Which page/tab/date each device is looking at is that device's own
    // business. Without this, navigating on your phone yanked your laptop
    // to the same page a second later.
    const keepView = Object.fromEntries(DEVICE_LOCAL_VIEW_KEYS.map(k => [k, state[k]]));
    state = incoming;
    state.notes = keepNotes;
    Object.assign(state, keepView);
    _suspendSave = true;
    dataStore.setItem(storeKey, JSON.stringify(state));
    _suspendSave = false;
    _applyingRemote = false;
    if (typeof reconcileGroupSubscriptions === 'function') reconcileGroupSubscriptions(); // joined/left a group on another device
    if (typeof adoptStrayGroupEntries === 'function') adoptStrayGroupEntries({ throttle: true });
    if (typeof renderRemote === 'function') renderRemote(); else if (typeof render === 'function') render();
  }, (e) => { diag.error('sync', 'Planner realtime listener failed', e); noteRealtimeListenerFailure(e); });

  _notesUnsub = planner.collection('notes').onSnapshot((snap) => {
    if (_syncQueued || _applyingRemote) return;
    let changed = false;
    snap.docChanges().forEach((change) => {
      if (change.type === 'removed') {
        const before = state.notes.length;
        state.notes = state.notes.filter(n => n.id !== change.doc.id);
        if (state.notes.length !== before) changed = true;
        return;
      }
      const incomingNote = change.doc.data();
      const i = state.notes.findIndex(n => n.id === incomingNote.id);
      const localNote = i !== -1 ? state.notes[i] : null;
      // Same principle as the planner listener: a note we already have an
      // equal-or-newer local edit for is either our own echo or already
      // stale by the time it arrived. Keep ours rather than overwrite it.
      if (localNote && (localNote.updatedAt || 0) >= (incomingNote.updatedAt || 0)) return;
      if (i !== -1) state.notes[i] = incomingNote; else state.notes.push(incomingNote);
      changed = true;
    });
    if (!changed) return;
    _lastSyncedNoteIds = new Set(state.notes.map(n => n.id));
    _applyingRemote = true;
    _suspendSave = true;
    dataStore.setItem(storeKey, JSON.stringify(state));
    _suspendSave = false;
    _applyingRemote = false;
    if (typeof render === 'function') render();
  }, (e) => { diag.error('sync', 'Notes realtime listener failed', e); noteRealtimeListenerFailure(e); });
}
// A realtime listener that errors is dead: Firestore does not retry it, so
// from then on edits made on another device never arrive here. That used to
// go only to diagnostics. One toast a session says so, with a retry that
// re-attaches both listeners. Being offline is the offline banner's job.
let _syncFailureToasted = false;
function noteRealtimeListenerFailure(e) {
  if (_syncFailureToasted || !_fbUser || !navigator.onLine || e?.code === 'unavailable' || typeof toast !== 'function') return;
  _syncFailureToasted = true;
  toast('Live sync stopped. Changes from your other devices won’t show up here until you retry.', 'error', 9000, {
    label: 'Retry',
    run: () => { _syncFailureToasted = false; startRealtimeSync(); },
  });
}
function stopRealtimeSync() {
  if (_plannerUnsub) { _plannerUnsub(); _plannerUnsub = null; }
  if (_notesUnsub) { _notesUnsub(); _notesUnsub = null; }
  if (typeof stopGroupSync === 'function') stopGroupSync();
}
