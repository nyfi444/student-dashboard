/* ── The fill-out page (form.html?f=c.CODE.formid) ────────────────
   Where a form's link and QR code lead. Someone at a club fair who has
   never heard of Semester HQ lands here, signs in with a free account,
   answers, and is done: they never join the club, never see the planner's
   paywall, and never see anything else the club has. Members can answer
   here too; inside the app they'd use the Forms tab.

   Deliberately standalone, like group-admin.html: clubs sit behind a plan
   inside the app, and answering a form must not. It talks to Firestore
   directly, and firestore.rules decides everything: who can open the
   form, that an answer is filed under the sender's own uid with the email
   they signed in with, and that it arrives together with the sender's own
   record of it (planners/{uid}/formAnswers), which is how "delete my
   account" finds it later.

   An anonymous form's answers don't go to Firestore from here at all:
   they go to the Worker, which files them with no name (formsend.js).
   A file sent as an answer goes to Storage under the sender's own uid.

   What a form is: js/spaces/formcore.js. The fields: js/spaces/formfill.js.
   Sending: js/spaces/formsend.js.
   Every string on a form was typed by a student, so all of it is escaped.
──────────────────────────────────────────────────────────────── */
let _auth = null, _db = null, _storage = null;
const FP_STORAGE_SRC = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage-compat.js';
const fpLink = formParseToken(new URLSearchParams(location.search).get('f'));
// answered: when they sent an answer, from their own record of it. For an
// anonymous form that record is all there is to show: the answer itself
// can't be read back.
const fp = { ready: false, user: null, form: null, mine: null, answered: 0, member: false, state: 'loading', editing: false, busy: false };

function fpEmulatorHost() {
  try {
    if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return '';
    return localStorage.getItem('shq_firebase_emulators') === '1' ? '127.0.0.1' : '';
  } catch { return ''; }
}
// The Storage library loads the first time a file is sent or opened.
async function fpStorage() {
  if (!_storage) {
    if (!firebase.storage) await loadScriptOnce(FP_STORAGE_SRC);
    _storage = firebase.storage();
    const emulator = fpEmulatorHost();
    if (emulator) _storage.useEmulator(emulator, 9199);
  }
  return _storage;
}
function fpCtx() { return { db: _db, storage: fpStorage, user: fp.user, kind: fpLink.kind, code: fpLink.code, name: fpName(), member: fp.member }; }
function fpFormRef() { return _db.collection(fpLink.collection).doc(fpLink.code).collection('forms').doc(fpLink.id); }
function fpName() { return ((fp.user?.displayName || (fp.user?.email || '').split('@')[0] || '').replace(/\s+/g, ' ').trim() || 'Someone').slice(0, 80); }
function fpWho() { return { name: fpName(), email: fp.user?.email || '' }; }
function fpRunners() { const f = fp.form; return f.spaceKind === 'group' ? 'whoever runs this form in the study group' : `the officers of ${f.spaceName || 'the club'}`; }

/* ── Loading ───────────────────────────────────────────────────── */
async function fpLoad() {
  fp.state = 'loading'; fp.form = null; fp.mine = null; fp.answered = 0; fp.member = false; fp.editing = false;
  fpRender();
  const me = fp.user.uid;
  // Their own answer first: it can be read even after the form has closed.
  try { const snap = await fpFormRef().collection('responses').doc(me).get(); if (snap.exists) fp.mine = snap.data(); } catch {}
  try { const rec = await formMyRecordRef(fpCtx(), fpLink.id).get(); if (rec.exists) fp.answered = Number(rec.data().at) || 1; } catch {}
  try {
    const snap = await fpFormRef().get();
    fp.form = snap.exists ? formClean({ ...snap.data(), id: snap.id }) : null;
  } catch (e) {
    if (e.code !== 'permission-denied') { diag.warn('forms', 'Form page could not load the form', e); fp.state = 'offline'; fpRender(); return; }
  }
  if (!fp.form) { fp.state = fp.mine || fp.answered ? 'answered-closed' : 'gone'; fpRender(); return; }
  if (fp.form.status === 'draft') { fp.state = 'gone'; fpRender(); return; }
  // Whether they're in the space, so the answer can say so truthfully. A
  // space they can't read is one they aren't in.
  try { const sp = await _db.collection(fpLink.collection).doc(fpLink.code).get(); fp.member = sp.exists && (sp.data().memberUids || []).includes(me); } catch { fp.member = false; }
  if (fp.mine) fp.mine = formCleanResponse(fp.form, fp.mine, me);
  if (fp.form.anonymous) fp.mine = null;
  if (fp.form.audience === 'members' && !fp.member) fp.state = 'members';
  else if (fp.mine || (fp.form.anonymous && fp.answered)) fp.state = 'answered';
  else fp.state = formIsOpen(fp.form) ? 'fill' : 'closed';
  fpRender();
}

/* ── Sending ───────────────────────────────────────────────────── */
async function fpSend(btn) {
  if (fp.busy) return;
  const f = fp.form, root = $('#fp-root .ff');
  if (!f || !root) return;
  const res = formCheckAnswers(f, formFillRead(root, f));
  if (!formFillShowErrors(root, f, res.errors)) return;
  fp.busy = true;
  setBtnLoading(btn, true);
  try {
    const data = await formSendAnswer(fpCtx(), f, res.answers, { at: fp.mine?.at || 0, sent: fp.mine?.answers || {} });
    fp.mine = f.anonymous ? null : formCleanResponse(f, data, fp.user.uid);
    fp.answered = Date.now();
    fp.state = 'sent'; fp.editing = false;
    fpRecordTerms();
  } catch (e) {
    setBtnLoading(btn, false);
    fp.busy = false;
    if (e.errors && !formFillShowErrors(root, f, e.errors)) return;
    diag.warn('forms', 'Form page could not send an answer', e);
    toast(e.status ? e.message : e.code === 'permission-denied' || e.code === 'storage/unauthorized' ? 'That didn’t go through. The form may have just closed.' : 'Couldn’t send. Check your connection and try again.', 'error', 6000);
    return;
  }
  fp.busy = false;
  fpRender();
  window.scrollTo(0, 0);
}
function fpConfirmRemove() {
  confirmDialog('Your answer is deleted, and the people running the form stop seeing it.', fpRemove, 'Remove', 'Remove your answer?');
}
async function fpRemove() {
  try {
    // A form that has since closed can no longer be read, so what is known
    // about it comes from the link and from the answer itself.
    const raw = fp.mine?.answers || {};
    const theirFiles = Object.keys(raw).filter(k => FORM_ID.test(k) && raw[k] && typeof raw[k] === 'object' && !Array.isArray(raw[k])).map(id => ({ id, type: 'file' }));
    await formTakeBack(fpCtx(), fp.form || { id: fpLink.id, anonymous: !fp.mine, questions: theirFiles });
    fp.mine = null; fp.answered = 0; fp.editing = false;
    fp.state = fp.form && formIsOpen(fp.form) ? 'fill' : 'gone';
    toast('Answer removed', 'info');
    fpRender();
  } catch (e) { diag.warn('forms', 'Form page could not remove an answer', e); toast(e.status ? e.message : 'Couldn’t remove it. Check your connection and try again.', 'error'); }
}
// Opens a file they sent earlier.
async function fpOpenFile(btn, questionId) {
  const v = fp.mine?.answers[questionId];
  if (!v) return;
  setBtnLoading(btn, true);
  try {
    const a = document.createElement('a');
    a.href = await formFileUrl(fpCtx(), fpLink.id, fp.user.uid, questionId);
    a.target = '_blank'; a.rel = 'noopener'; a.download = v.name;
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { diag.warn('forms', 'Form page could not open a file', e); toast('Couldn’t open that file. Check your connection and try again.', 'error'); }
  finally { setBtnLoading(btn, false); }
}
function fpEdit() { fp.editing = true; fp.state = 'answered'; fpRender(); }
// The same record the app keeps that the age and Terms box was ticked.
async function fpRecordTerms() {
  try {
    if (!WORKER_URL || fpEmulatorHost() || localStorage.getItem(AGE_TOS_KEY) !== '1' || sessionStorage.getItem('shq_terms_recorded') === fp.user.uid) return;
    const idToken = await fp.user.getIdToken();
    const res = await fetch(`${WORKER_URL}/account/attest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken, ageConfirmed: true }) });
    if (res.ok) sessionStorage.setItem('shq_terms_recorded', fp.user.uid);
  } catch (e) { diag.warn('auth', 'Could not record the terms acceptance', e); }
}

/* ── Drawing ───────────────────────────────────────────────────── */
function fpCard(inner, style = '') { return `<div class="card fp-card space" style="${style}">${inner}</div>`; }
function fpStateHtml(ic, title, body, actions = '') {
  return `<div class="fp-state"><span class="fp-state-ic" aria-hidden="true">${icon(ic, 22)}</span><h2>${esc(title)}</h2><p>${body}</p>${actions ? `<div class="fp-actions">${actions}</div>` : ''}</div>`;
}
function fpBand(f) {
  const closes = formClosesLabel(f);
  return `<div class="fp-band"><div class="fp-from">${esc(f.spaceName || (f.spaceKind === 'group' ? 'A study group' : 'A club'))}${f.anonymous ? ' · Anonymous' : ''}</div><h1 class="fp-title">${esc(f.title)}</h1>${closes ? `<div class="fp-closes">${esc(closes)}</div>` : ''}</div>`;
}
function fpPitch() {
  return `<div class="card fp-pitch"><div><strong>Your entire semester, finally in one place.</strong><span>Semester HQ is the planner this form was made in: classes, deadlines, study groups and clubs together.</span></div><a class="btn" href="index.html">See Semester HQ ${icon('arrow-up-right', 14)}</a></div>`;
}
function fpSignInHtml() {
  return fpCard(`
    <div class="fp-state">
      <span class="fp-state-ic" aria-hidden="true">${icon('clipboard-list', 22)}</span>
      <h2>Someone sent you a form</h2>
      <p>Sign in to open it. It’s free, there’s no card, and your answers go only to the people who run the form.</p>
      <div class="fp-signin" id="fp-signin">
        <form onsubmit="event.preventDefault();fpEmailSignIn()">
          <input class="input" type="email" id="fp-email" placeholder="you@school.edu" required autocomplete="email" aria-label="Your email" style="width:100%;margin-bottom:10px;box-sizing:border-box">
          <button class="btn btn-primary" type="submit" style="width:100%">Continue with email</button>
        </form>
        <div class="login-divider" style="margin:14px 0"><span>or</span></div>
        <button class="btn" style="width:100%" onclick="fpGoogleSignIn()">Continue with Google</button>
      </div>
    </div>`);
}
function fpRender() {
  const root = $('#fp-root');
  $('#fp-account').innerHTML = fp.user ? `<span title="${esc(fp.user.email || '')}">${esc(fp.user.email || 'Signed in')}</span><button class="btn btn-sm btn-ghost" onclick="fpSignOut()">Sign out</button>` : '';
  if (!fpLink) { root.innerHTML = fpCard(fpStateHtml('alert-circle', 'This link doesn’t look right', 'Part of it may have been cut off. Ask whoever sent it for the link again.')); return; }
  if (!fp.ready) { root.innerHTML = fpCard('<div class="fp-state"><p>Opening the form…</p></div>'); return; }
  if (!fp.user) { root.innerHTML = fpSignInHtml(); return; }
  const f = fp.form;
  const style = f ? spaceVars(f.spaceColor) : '';
  document.title = f ? `${f.title} – Semester HQ` : 'Form – Semester HQ';
  const again = `<button class="btn" onclick="fpLoad()">${icon('refresh-cw', 14)}Try again</button>`;
  switch (fp.state) {
    case 'loading': root.innerHTML = fpCard('<div class="fp-state"><p>Opening the form…</p></div>'); return;
    case 'offline': root.innerHTML = fpCard(fpStateHtml('alert-circle', 'The form didn’t load', 'Check your connection, then try again.', again)); return;
    case 'gone': root.innerHTML = fpCard(fpStateHtml('lock', 'This form isn’t taking answers', 'It may have closed, or it’s only for members of the group that made it. If you’re a member, sign in with the account you use for Semester HQ.', again)); return;
    case 'members': root.innerHTML = fpCard(`${fpBand(f)}${fpStateHtml('users', 'This one is for members', `Only members of ${esc(f.spaceName || 'the group')} can answer it. If that’s you, sign in with the account you use for Semester HQ.`)}`, style); return;
    case 'closed': root.innerHTML = fpCard(`${fpBand(f)}${fpStateHtml('lock', 'This form is closed', 'It stopped taking answers. Ask whoever sent it if there’s another way to reach them.')}`, style); return;
    case 'answered-closed': root.innerHTML = fpCard(fpStateHtml('check', 'You answered this form', 'It has since closed, so your answer can’t be changed here.', `<button class="btn btn-ghost" onclick="fpConfirmRemove()">Remove my answer</button>`)) + fpPitch(); return;
    case 'sent': root.innerHTML = fpCard(`${fpBand(f)}${fpStateHtml('check', 'Sent', `Your answers went to ${esc(fpRunners())}${f.anonymous ? ', without your name' : ''}.${f.allowEdit && formIsOpen(f) ? (f.anonymous ? ' You can send again to replace them while the form is open.' : ' You can change them while the form is open.') : ''}`, f.allowEdit && formIsOpen(f) ? `<button class="btn" onclick="fpEdit()">${icon('pencil', 14)}${f.anonymous ? 'Answer again' : 'Change my answer'}</button>` : '')}`, style) + (fp.member ? '' : fpPitch()); return;
  }
  const open = formIsOpen(f);
  const answered = !!fp.mine || (f.anonymous && !!fp.answered);
  const canEdit = open && (!answered || (f.allowEdit && fp.editing));
  const when = answered ? esc(fmtRelativeTime(fp.mine?.updatedAt || fp.mine?.at || fp.answered).toLowerCase()) : '';
  const sent = !answered ? ''
    : f.anonymous ? `<p class="ff-sent">${icon('check', 14)}<span>You answered ${when}. Your answer is anonymous, so it can’t be shown here.${!open ? ' This form is closed.' : f.allowEdit ? ' Sending again replaces it.' : ' Answers to this form can’t be changed.'}</span></p>`
    : `<p class="ff-sent">${icon('check', 14)}<span>You answered ${when}.${!open ? ' This form is closed.' : f.allowEdit ? '' : ' Answers to this form can’t be changed.'}</span></p>`;
  // An anonymous answer can't be read back, so there is nothing to show
  // until they choose to answer again.
  const fields = f.anonymous && answered && !canEdit ? '' : formFillHtml(f, { answers: fp.mine?.answers || {}, who: fpWho(), runners: fpRunners(), readOnly: !canEdit });
  const myFiles = !canEdit && fp.mine ? formFileQuestions(f).filter(q => fp.mine.answers[q.id]).map(q => `<button class="btn btn-sm forms-file" onclick="fpOpenFile(this,'${esc(q.id)}')">${icon('paperclip', 14)}<span>${esc(fp.mine.answers[q.id].name)}</span></button>`).join('') : '';
  root.innerHTML = fpCard(`
    ${fpBand(f)}
    <div class="fp-main form-fill">
      ${canEdit && fp.editing && !f.anonymous ? '' : sent}
      ${fields}
      ${myFiles ? `<div class="fp-files"><span class="row-meta">Open what you sent</span>${myFiles}</div>` : ''}
      <div class="fp-actions">
        ${answered ? '<button class="btn btn-ghost" onclick="fpConfirmRemove()">Remove my answer</button>' : ''}
        ${answered && open && f.allowEdit && !fp.editing ? `<button class="btn btn-primary" onclick="fpEdit()">${icon('pencil', 14)}${f.anonymous ? 'Answer again' : 'Change my answer'}</button>` : ''}
        ${canEdit ? `<button class="btn btn-primary" id="fp-send" onclick="fpSend(this)">${answered ? (f.anonymous ? 'Send again' : 'Save my answer') : 'Send'}</button>` : ''}
      </div>
    </div>`, style);
}

/* ── Sign-in (the same two ways as group-admin.html) ───────────── */
function fpGoogleSignIn() {
  if (localStorage.getItem(AGE_TOS_KEY) !== '1') { fpAgeGate(() => fpGoogleSignIn()); return; }
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  _auth.signInWithPopup(provider).catch(e => {
    if (['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'].includes(e.code)) return;
    toast(e.code === 'auth/popup-blocked' ? 'Your browser blocked the Google sign-in window. Try again, and allow pop-ups if it asks.' : e.code === 'auth/network-request-failed' ? 'No connection right now. Try again when you’re back online.' : 'Google sign-in didn’t finish. Try again.', 'error', 6000);
  });
}
// The link goes out through the Worker, after a Turnstile check on one
// confirm step (see js/authemail.js for why not Firebase's own email).
function fpEmailSignIn() {
  const email = $('#fp-email')?.value.trim();
  if (!email) { toast('Enter your email to continue', 'error'); return; }
  if (localStorage.getItem(AGE_TOS_KEY) !== '1') { fpAgeGate(() => fpEmailSignIn()); return; }
  if (!TURNSTILE_SITEKEY) { fpSendEmail(email); return; }
  $('#fp-signin').innerHTML = `
    <p class="small mb-8">We’ll email a sign-in link to <strong>${esc(email)}</strong>.</p>
    <div data-turnstile style="margin-bottom:10px"></div>
    <button class="btn btn-primary" style="width:100%" id="fp-email-send">Send</button>
    <button class="btn btn-sm mt-8" style="width:100%" id="fp-email-back">Back</button>`;
  $('#fp-email-send').onclick = () => fpSendEmail(email);
  $('#fp-email-back').onclick = () => { fpRender(); const i = $('#fp-email'); if (i) i.value = email; };
  mountTurnstile();
}
async function fpSendEmail(email) {
  if (TURNSTILE_SITEKEY && !turnstileToken()) { toast('Finish the verification box first, then tap Send.', 'error'); return; }
  const send = $('#fp-email-send');
  if (send) { send.disabled = true; send.textContent = 'Sending…'; }
  const result = await requestAuthEmail(_auth, 'signin', email, window.location.href);
  if (result.ok) {
    $('#fp-signin').innerHTML = `<div class="login-sent"><strong>Check your inbox.</strong>We sent a sign-in link to ${esc(email)}. Open it on this device and the form opens. Not there in a minute? Check Spam.</div>`;
    return;
  }
  if (send) { send.disabled = false; send.textContent = 'Send'; }
  toast(result.error, 'error', 6000);
}
function fpAgeGate(resume) {
  openModal(`
    <div class="modal-head"><h3>Before you continue</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <label class="checkbox-row" style="align-items:flex-start;gap:10px">
        <input type="checkbox" id="fp-age-check" style="margin-top:2px;width:18px;height:18px;flex-shrink:0">
        <span class="small">I'm at least 13 years old, and I agree to Semester HQ's <a href="https://semester-hq.com/terms.html" target="_blank" rel="noopener">Terms of Service</a> and <a href="https://semester-hq.com/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</span>
      </label>
    </div>
    <div class="modal-foot"><button class="btn btn-primary" onclick="fpConfirmAge()">Continue</button></div>
  `);
  window._fpAgeResume = resume;
}
function fpConfirmAge() {
  if (!$('#fp-age-check')?.checked) { toast('Check the box to continue', 'error'); return; }
  localStorage.setItem(AGE_TOS_KEY, '1');
  closeModal();
  const resume = window._fpAgeResume;
  window._fpAgeResume = null;
  if (resume) resume();
}
async function fpCompleteEmailLink() {
  if (!_auth.isSignInWithEmailLink(window.location.href)) return;
  const email = localStorage.getItem(EMAIL_LINK_STORAGE_KEY) || window.prompt('Confirm the email you used to request this link:');
  if (!email) return;
  try {
    await _auth.signInWithEmailLink(email, window.location.href);
    localStorage.removeItem(EMAIL_LINK_STORAGE_KEY);
  } catch (e) { diag.warn('forms', 'Sign-in link failed', e); toast('That sign-in link is invalid or expired.', 'error', 6000); }
  // Whatever happened, the one-time code comes out of the address bar.
  history.replaceState({}, '', `${location.pathname}?f=${encodeURIComponent(new URLSearchParams(location.search).get('f') || '')}`);
}
function fpSignOut() { _auth.signOut(); }

(async function init() {
  if (!fpLink) { fpRender(); return; }
  if (!FB_CONFIG.apiKey || typeof firebase === 'undefined') {
    $('#fp-root').innerHTML = fpCard(fpStateHtml('alert-circle', 'The form didn’t load', 'Check your connection, then reload the page.'));
    return;
  }
  const emulator = fpEmulatorHost();
  // The emulators run as demo-semester-hq, a project id the Firebase tools
  // treat as offline-only: nothing addressed to it can reach the real one.
  firebase.initializeApp(emulator ? { ...FB_CONFIG, projectId: 'demo-semester-hq', storageBucket: 'demo-semester-hq.appspot.com' } : FB_CONFIG);
  _auth = firebase.auth();
  _db = firebase.firestore();
  if (emulator) { _auth.useEmulator(`http://${emulator}:9099`, { disableWarnings: true }); _db.useEmulator(emulator, 8080); }
  await fpCompleteEmailLink();
  _auth.onAuthStateChanged((user) => {
    fp.user = user;
    fp.ready = true;
    if (!user) { fp.form = null; fp.mine = null; fp.state = 'loading'; fpRender(); return; }
    fpLoad();
  });
})();
