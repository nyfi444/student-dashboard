/* ── Spaces: forms (study groups and clubs) ────────────────────────
   The Forms tab: the list, filling one in, sharing it, and the answers.
   What a form is lives in js/spaces/formcore.js, the fields in
   js/spaces/formfill.js, and writing one in js/spaces/formbuilder.js.

   Who does what:
     Clubs          officers make and run forms and read the answers.
     Study groups   any member makes one; whoever made it and the
                    group's owner run it and read the answers.
     Everyone else in the space sees the form and their own answer, never
     anyone else's. firestore.rules holds all of this; the checks here
     only decide which buttons to draw.
   A form set to "anyone with the link" can also be answered by someone
   who isn't in the space, on form.html, with a free account.

   Data: a cloud space keeps forms in its forms subcollection, listened
   to only while that space's page is open (formsAfterRender). A local or
   sample space keeps them on its planner entry: entry.forms[id] and
   entry.formResponses[formId][uid].

   FORM_ADAPTERS[kind]  kind is 'club' or 'group': the space, who I am in
     it, whether I may make a form, whether I run a given one.
   formsTab(kind, space) -> html   the tab body (list, or one form's answers)
   formsWaiting(kind, space) -> n  open forms I haven't answered (tab count)
──────────────────────────────────────────────────────────────── */
const FORM_ADAPTERS = {
  club: {
    space: (code) => findOrg(code),
    entry: (code) => orgEntry(code),
    me: (o) => myOrgUid(o),
    color: (o) => orgColor(o),
    canMake: (o) => isOrgOfficer(o),
    runs: (o) => isOrgOfficer(o),
    runners: (o) => `the officers of ${o.name}`,
    makers: 'Officers',
    onPage: (code) => state.route === 'orgs' && state.subRoute === code,
    tab: () => state.orgTab,
    chat: (code, text) => sendOrgMessage(code, text),
  },
  group: {
    space: (code) => findGroup(code),
    entry: (code) => groupEntry(code),
    me: (g) => myUidFor(g),
    color: (g) => groupColor(g),
    canMake: () => true,
    runs: (g, f) => f.createdBy === myUidFor(g) || g.createdBy === myUidFor(g),
    runners: (g, f) => f.createdBy === g.createdBy ? (f.createdByName || 'the group’s owner') : `${f.createdByName || 'whoever made this form'} and the group’s owner`,
    makers: 'Anyone in the group',
    onPage: (code) => state.route === 'studygroups' && state.subRoute === code,
    tab: () => state.groupTab,
    chat: (code, text) => sendGroupMessage(code, text),
  },
};
const formKey = (kind, code) => `${kind}:${code}`;
const formArgs = (kind, code, id) => `'${kind}','${code}'${id ? `,'${id}'` : ''}`;

/* ── Data ──────────────────────────────────────────────────────── */
const _formStore = {};                  // space key -> { forms: [raw], loaded, failed }
let _formSub = { key: '', unsub: null };
let _formMine = { uid: '', map: {}, unsub: null };   // my own record of what I answered
let _formResp = { key: '', list: null, failed: false, unsub: null };   // answers to the form on screen
const _formCounts = {};                 // `${space key}:${id}` -> number of answers
const _formView = {};                   // space key -> { id, pane: 'summary' | 'people', person }

function formRef(kind, code, id) {
  const forms = _fbDb.collection(formCollection(kind)).doc(code).collection('forms');
  return id ? forms.doc(id) : forms;
}
function formIsLocal(kind, code) { return !!FORM_ADAPTERS[kind].entry(code)?.local; }
function spaceForms(kind, sp) {
  const A = FORM_ADAPTERS[kind];
  const raw = sp.local ? Object.values(A.entry(sp.code)?.forms || {}) : (_formStore[formKey(kind, sp.code)]?.forms || []);
  const order = { open: 0, draft: 1, closed: 2 };
  return raw.map(formClean).filter(Boolean)
    .filter(f => f.status !== 'draft' || A.runs(sp, f))
    .sort((a, b) => order[formPhase(a)] - order[formPhase(b)] || (b.createdAt || 0) - (a.createdAt || 0));
}
function findForm(kind, code, id) {
  const sp = FORM_ADAPTERS[kind]?.space(code);
  return sp ? spaceForms(kind, sp).find(f => f.id === id) || null : null;
}
function formsLoading(kind, sp) { const s = _formStore[formKey(kind, sp.code)]; return !sp.local && !sp.loading && cloudGroupsEnabled() && !s?.loaded && !s?.failed; }
// My own answer to a form: { at } when I have one. The full answer is read
// when the sheet opens (formMyAnswer).
function formAnswered(kind, sp, id) {
  if (sp.local) { const r = FORM_ADAPTERS[kind].entry(sp.code)?.formResponses?.[id]?.[LOCAL_UID]; return r ? { at: r.updatedAt || r.at || 0 } : null; }
  const rec = _formMine.map[formAnswerKey(kind, sp.code, id)];
  return rec ? { at: Number(rec.at) || 0 } : null;
}
// Forms I run myself don't count: an officer who posts an interest form
// isn't being asked to fill it in.
function formsWaiting(kind, sp) {
  if (!sp || sp.loading) return 0;
  const A = FORM_ADAPTERS[kind];
  return spaceForms(kind, sp).filter(f => formIsOpen(f) && !A.runs(sp, f) && !formAnswered(kind, sp, f.id)).length;
}
function formLocalResponses(kind, code, form) {
  const all = FORM_ADAPTERS[kind].entry(code)?.formResponses?.[form.id] || {};
  return Object.entries(all).map(([u, r]) => formCleanResponse(form, r, u)).filter(Boolean);
}
function formResponses(kind, sp, form) {
  if (sp.local) return formLocalResponses(kind, sp.code, form);
  if (_formResp.key !== `${formKey(kind, sp.code)}:${form.id}` || !_formResp.list) return null;
  return _formResp.list.map(r => formCleanResponse(form, r, r.id)).filter(Boolean);
}
function formCount(kind, sp, form) {
  if (sp.local) return formLocalResponses(kind, sp.code, form).length;
  const n = _formCounts[`${formKey(kind, sp.code)}:${form.id}`];
  return typeof n === 'number' ? n : null;
}

/* ── Listeners: only while the space's page is open ────────────── */
function formsCloseSpace() { if (_formSub.unsub) _formSub.unsub(); _formSub = { key: '', unsub: null }; }
function formsCloseAnswers() { if (_formResp.unsub) _formResp.unsub(); _formResp = { key: '', list: null, failed: false, unsub: null }; }
function formsCloseMine() { if (_formMine.unsub) _formMine.unsub(); _formMine = { uid: '', map: {}, unsub: null }; }
function formsListen(kind, code) {
  const key = formKey(kind, code);
  if (_formSub.key === key) return;
  formsCloseSpace();
  const store = _formStore[key] = _formStore[key] || { forms: [], loaded: false, failed: false };
  store.failed = false;
  _formSub.key = key;
  _formSub.unsub = formRef(kind, code).limit(FORM_PER_SPACE_MAX + 10).onSnapshot(snap => {
    store.forms = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    store.loaded = true;
    renderRemote();
  }, err => {
    diag.warn('forms', 'Forms listener failed', err);
    store.failed = true;   // not retried until the page is opened again, so a failure can't loop
    _formSub.unsub = null;
    renderRemote();
  });
}
function formsListenMine() {
  const me = _fbUser?.uid;
  if (!me || _formMine.uid === me) return;
  formsCloseMine();
  _formMine.uid = me;
  _formMine.unsub = _fbDb.collection('planners').doc(me).collection('formAnswers').onSnapshot(snap => {
    _formMine.map = Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));
    renderRemote();
  }, err => { diag.warn('forms', 'My form answers didn’t load', err); _formMine.unsub = null; });
}
function formsListenAnswers(kind, code, id) {
  const key = `${formKey(kind, code)}:${id}`;
  if (_formResp.key === key) return;
  formsCloseAnswers();
  _formResp.key = key;
  _formResp.unsub = formRef(kind, code, id).collection('responses').limit(FORM_RESPONSES_SHOWN).onSnapshot(snap => {
    _formResp.list = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    _formCounts[key] = snap.size;
    renderRemote();
  }, err => {
    diag.warn('forms', 'Form answers didn’t load', err);
    _formResp.failed = true;
    _formResp.unsub = null;
    renderRemote();
  });
}
// How many answers each form I run has, for the list. The count query
// reads no answers. Answers arrive without the form itself changing, so
// while the list is on screen the counts are asked for again every
// FORM_COUNT_EVERY_MS (formsAfterRender), and on every visit to the tab.
const FORM_COUNT_EVERY_MS = 20000;
let _formCountAt = { key: '', at: 0, busy: false };
let _formCountTimer = null;
async function formsLoadCounts(kind, code) {
  const A = FORM_ADAPTERS[kind], sp = A.space(code);
  if (!sp || sp.local || _formCountAt.busy) return;
  const todo = spaceForms(kind, sp).filter(f => f.status !== 'draft' && A.runs(sp, f));
  _formCountAt = { key: formKey(kind, code), at: Date.now(), busy: true };
  let changed = false;
  await Promise.all(todo.map(async f => {
    const k = `${formKey(kind, code)}:${f.id}`;
    try {
      const q = formRef(kind, code, f.id).collection('responses');
      const n = typeof q.count === 'function' ? (await q.count().get()).data().count : (await q.limit(FORM_RESPONSES_SHOWN).get()).size;
      if (_formCounts[k] !== n) { _formCounts[k] = n; changed = true; }
    } catch (e) { diag.warn('forms', 'Answer count failed', e); }
  }));
  _formCountAt.busy = false;
  if (changed) renderRemote();
}
function formsStopCounting() { if (_formCountTimer) { clearTimeout(_formCountTimer); _formCountTimer = null; } }
// Keeps the list's counts fresh while it is the thing on screen.
function formsKeepCounting(kind, code) {
  const key = formKey(kind, code);
  if (_formCountAt.key !== key || Date.now() - _formCountAt.at >= FORM_COUNT_EVERY_MS) formsLoadCounts(kind, code);
  if (_formCountTimer) return;
  _formCountTimer = setTimeout(() => {
    _formCountTimer = null;
    const A = FORM_ADAPTERS[kind];
    if (!A.onPage(code) || A.tab() !== 'forms' || _formView[key]?.id) return;
    if (document.visibilityState === 'visible') formsLoadCounts(kind, code);
    formsKeepCounting(kind, code);
  }, FORM_COUNT_EVERY_MS);
}
// Runs after every render (afterSpaceRender, js/spaces/header.js).
function formsAfterRender() {
  const kind = state.route === 'orgs' ? 'club' : state.route === 'studygroups' ? 'group' : '';
  const code = kind ? state.subRoute : '';
  const A = FORM_ADAPTERS[kind];
  const entry = code && A ? A.entry(code) : null;
  if (!entry || !entry.cloud || !cloudGroupsEnabled()) {
    formsCloseSpace(); formsCloseAnswers(); formsStopCounting();
    Object.keys(_formStore).forEach(k => { _formStore[k].failed = false; });
    if (!_fbUser) formsCloseMine();
    return;
  }
  formsListen(kind, code);
  formsListenMine();
  const view = _formView[formKey(kind, code)];
  if (A.tab() === 'forms' && view?.id) formsListenAnswers(kind, code, view.id);
  else formsCloseAnswers();
  if (A.tab() === 'forms' && !view?.id && _formStore[formKey(kind, code)]?.loaded) formsKeepCounting(kind, code);
  else formsStopCounting();
}

/* ── The tab ───────────────────────────────────────────────────── */
function formsTab(kind, sp) {
  const A = FORM_ADAPTERS[kind];
  const key = formKey(kind, sp.code);
  const view = _formView[key];
  if (view?.id) {
    const f = spaceForms(kind, sp).find(x => x.id === view.id);
    if (f && A.runs(sp, f)) return formResultsHtml(kind, sp, f, view);
    if (!formsLoading(kind, sp)) delete _formView[key];
  }
  if (formsLoading(kind, sp)) return '<div class="forms"><p class="small muted">Loading forms…</p></div>';
  if (_formStore[key]?.failed && !sp.local) return `<div class="forms">${inlineErrorHtml('Forms didn’t load. Check your connection and try again.', `formsRetry(${formArgs(kind, sp.code)})`)}</div>`;
  const forms = spaceForms(kind, sp);
  const canMake = A.canMake(sp);
  if (!forms.length) return `<div class="forms">${emptyStateHtml(formsEmpty(kind, sp, canMake))}</div>`;
  return `
    <div class="forms">
      <div class="lib-toolbar">
        <p class="lib-intro">${canMake ? 'Ask your own questions: sign-ups, applications, feedback. Answers come back here, private to whoever runs the form.' : 'Forms from this ' + (kind === 'group' ? 'group' : 'club') + '. Your answers go only to the people running each one.'}</p>
        ${canMake ? `<div class="lib-tools"><button type="button" class="btn btn-primary btn-sm" onclick="openFormPicker(${formArgs(kind, sp.code)})">${icon('plus', 14)}New form</button></div>` : ''}
      </div>
      <div class="forms-grid">${forms.map(f => formCard(kind, sp, f)).join('')}</div>
    </div>`;
}
function formsRetry(kind, code) { const s = _formStore[formKey(kind, code)]; if (s) s.failed = false; formsCloseSpace(); render(); }
function formsEmpty(kind, sp, canMake) {
  if (!canMake) return { icon: 'clipboard-list', title: 'No forms yet', body: 'When an officer posts a sign-up or a survey, it shows up here.' };
  return {
    icon: 'clipboard-list', title: 'Ask your own questions',
    body: kind === 'group' ? 'A quick check-in before a session, or feedback after one. Answers come back to you in one place.' : 'Interest forms for the club fair, membership applications, event sign-ups, shirt sizes. Share a link or a QR code, and the answers come back here.',
    actions: [{ label: 'Make a form', icon: 'plus', onclick: `openFormPicker(${formArgs(kind, sp.code)})` }],
  };
}
function formStatusTag(f) {
  const phase = formPhase(f);
  return phase === 'open' ? spaceTag('need', 'Open') : phase === 'draft' ? spaceTag('weekly', 'Draft') : spaceTag('weekly', 'Closed');
}
function formCard(kind, sp, f) {
  const A = FORM_ADAPTERS[kind];
  const args = formArgs(kind, sp.code, f.id);
  const runs = A.runs(sp, f);
  const phase = formPhase(f);
  const mine = formAnswered(kind, sp, f.id);
  const count = runs && phase !== 'draft' ? formCount(kind, sp, f) : null;
  const n = f.questions.length;
  const meta = [
    `${n} question${n === 1 ? '' : 's'}`,
    f.audience === 'link' ? 'Anyone with the link' : 'Members only',
    formClosesLabel(f),
  ].filter(Boolean);
  const answerBtn = phase === 'draft' ? ''
    : mine ? (phase === 'open' && f.allowEdit
      ? `<button type="button" class="btn btn-sm" onclick="openFormFill(${args})">${icon('pencil', 14)}Change my answer</button>`
      : `<button type="button" class="btn btn-sm" onclick="openFormFill(${args})">${icon('eye', 14)}My answer</button>`)
    : phase === 'open' ? `<button type="button" class="btn ${runs ? '' : 'btn-primary '}btn-sm" onclick="openFormFill(${args})">${icon('pencil', 14)}Fill out</button>` : '';
  return `
    <div class="card form-card is-${phase}" data-form="${esc(f.id)}">
      <div class="form-card-top">
        ${formStatusTag(f)}
        ${runs ? `<button type="button" class="btn btn-ghost btn-icon form-card-more" aria-label="More for ${esc(f.title)}" onclick="openFormMenu(this,${args})">${icon('more-horizontal', 16)}</button>` : ''}
      </div>
      <h3 class="form-card-title">${runs ? `<button type="button" onclick="${phase === 'draft' ? `openFormBuilder(${args})` : `openFormResults(${args})`}">${esc(f.title)}</button>` : esc(f.title)}</h3>
      <div class="form-card-meta">${meta.map(m => `<span>${esc(m)}</span>`).join('')}</div>
      ${runs && phase !== 'draft' ? `<div class="form-card-count"><strong>${count == null ? '…' : count}</strong> answer${count === 1 ? '' : 's'}</div>` : ''}
      ${!runs || phase === 'draft' ? `<div class="form-card-state">${phase === 'draft' ? 'Only you and the others running it can see a draft.' : mine ? `${icon('check', 13)} You answered${mine.at ? ` ${esc(fmtRelativeTime(mine.at).toLowerCase())}` : ''}` : phase === 'open' ? 'Waiting for your answer' : 'This form is closed.'}</div>` : ''}
      <div class="form-card-actions">
        ${runs && phase === 'draft' ? `<button type="button" class="btn btn-primary btn-sm" onclick="openFormBuilder(${args})">${icon('pencil', 14)}Keep editing</button>` : ''}
        ${runs && phase !== 'draft' ? `<button type="button" class="btn btn-primary btn-sm" onclick="openFormResults(${args})">${icon('list', 14)}Answers</button>` : ''}
        ${runs && phase === 'open' ? `<button type="button" class="btn btn-sm" onclick="openFormShare(${args})">${icon('share', 14)}Share</button>` : ''}
        ${answerBtn}
      </div>
    </div>`;
}
function openFormMenu(btn, kind, code, id) {
  const sp = FORM_ADAPTERS[kind].space(code), f = findForm(kind, code, id);
  if (!sp || !f || !FORM_ADAPTERS[kind].runs(sp, f)) return;
  const args = formArgs(kind, code, id);
  const phase = formPhase(f);
  const item = (label, ic, js, danger) => `${danger ? '<div class="menu-sep" role="separator"></div>' : ''}<button class="menu-item${danger ? ' is-danger' : ''}" onclick="${js}">${icon(ic, 16)}<span>${label}</span></button>`;
  openMenu(btn, [
    item('Edit questions', 'pencil', `openFormBuilder(${args})`),
    phase === 'open' ? item('Stop taking answers', 'lock', `setFormStatus(${args},'closed')`) : '',
    phase === 'closed' ? item('Open it again', 'refresh-cw', `setFormStatus(${args},'open')`) : '',
    item('Make a copy', 'copy', `duplicateForm(${args})`),
    item('Delete', 'trash', `confirmDeleteForm(${args})`, true),
  ].join(''), { align: 'end' });
}

/* ── Filling one in ────────────────────────────────────────────── */
function formWho(kind, sp) {
  return { name: myGroupName(), email: sp.local ? '' : (_fbUser?.email || '') };
}
async function formMyAnswer(kind, sp, f) {
  if (sp.local) { const r = FORM_ADAPTERS[kind].entry(sp.code)?.formResponses?.[f.id]?.[LOCAL_UID]; return r ? formCleanResponse(f, r, LOCAL_UID) : null; }
  if (!formAnswered(kind, sp, f.id)) return null;
  try { const snap = await formRef(kind, sp.code, f.id).collection('responses').doc(_fbUser.uid).get(); return snap.exists ? formCleanResponse(f, snap.data(), snap.id) : null; }
  catch (e) { diag.warn('forms', 'My answer didn’t load', e); return null; }
}
async function openFormFill(kind, code, id) {
  const A = FORM_ADAPTERS[kind], sp = A.space(code), f = findForm(kind, code, id);
  if (!sp || !f) return;
  if (!sp.local && !cloudGroupsEnabled()) { toast('Log in to answer this form.', 'error'); return; }
  const mine = await formMyAnswer(kind, sp, f);
  const open = formIsOpen(f);
  const readOnly = !open || (!!mine && !f.allowEdit);
  window._formFill = { kind, code, id, at: mine?.at || 0 };
  openModal(`
    <div class="modal-head"><h3>${esc(f.title)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body form-fill space" style="${spaceVars(A.color(sp))}">
      <div class="form-fill-from">${esc(sp.name)}${formClosesLabel(f) ? ` · ${esc(formClosesLabel(f))}` : ''}</div>
      ${readOnly && mine ? `<p class="ff-sent">${icon('check', 14)} You answered ${esc(fmtRelativeTime(mine.updatedAt || mine.at).toLowerCase())}.${open ? ' Answers to this form can’t be changed.' : ' This form is closed.'}</p>` : ''}
      ${!open && !mine ? '<p class="ff-sent">This form is closed and isn’t taking answers.</p>' : ''}
      ${!open && !mine ? '' : formFillHtml(f, { answers: mine?.answers || {}, who: formWho(kind, sp), runners: A.runners(sp, f), readOnly })}
    </div>
    <div class="modal-foot">
      ${mine && open ? `<button class="btn btn-ghost form-fill-remove" onclick="confirmRemoveMyAnswer(${formArgs(kind, code, id)})">Remove my answer</button>` : ''}
      <button class="btn" onclick="closeModal()">${readOnly ? 'Close' : 'Cancel'}</button>
      ${readOnly ? '' : `<button class="btn btn-primary" id="form-send" onclick="submitFormFill(this)">${mine ? 'Save my answer' : 'Send'}</button>`}
    </div>
  `, { wide: true });
}
async function submitFormFill(btn) {
  const st = window._formFill;
  const A = FORM_ADAPTERS[st?.kind], sp = A?.space(st.code), f = sp ? findForm(st.kind, st.code, st.id) : null;
  const root = $('#modal .ff');
  if (!f || !root) return;
  if (!formIsOpen(f)) { toast('This form just closed, so it isn’t taking answers.', 'error', 4500); closeModal(); return; }
  const res = formCheckAnswers(f, formFillRead(root, f));
  if (!formFillShowErrors(root, f, res.errors)) return;
  const now = Date.now();
  const who = formWho(st.kind, sp);
  const me = A.me(sp);
  const data = { uid: me, name: who.name.slice(0, 80), member: true, answers: res.answers, at: st.at || now, updatedAt: now, ...(f.collectEmail && who.email ? { email: who.email } : {}) };
  if (sp.local) {
    const entry = A.entry(st.code);
    entry.formResponses = entry.formResponses || {};
    (entry.formResponses[f.id] = entry.formResponses[f.id] || {})[me] = data;
    closeModal();
    touch();
    toast(st.at ? 'Answer saved' : 'Sent', 'success');
    return;
  }
  setBtnLoading(btn, true);
  try {
    const batch = _fbDb.batch();
    batch.set(formRef(st.kind, st.code, f.id).collection('responses').doc(me), data);
    batch.set(_fbDb.collection('planners').doc(me).collection('formAnswers').doc(formAnswerKey(st.kind, st.code, f.id)), { kind: st.kind, code: st.code, formId: f.id, title: f.title, spaceName: sp.name, at: now });
    await batch.commit();
    _formCountAt.at = 0;   // my own answer changes the count: ask again on the next render
    closeModal();
    toast(st.at ? 'Answer saved' : `Sent to ${sp.name}`, 'success');
    playUiSound?.('send');
  } catch (e) {
    diag.error('forms', 'Form answer failed', e);
    setBtnLoading(btn, false);
    toast(e.code === 'permission-denied' ? 'That didn’t go through. The form may have just closed.' : 'Couldn’t send. Check your connection and try again.', 'error', 5000);
  }
}
function confirmRemoveMyAnswer(kind, code, id) {
  confirmDialog('Your answer is deleted, and the people running the form stop seeing it.', () => removeMyAnswer(kind, code, id), 'Remove', 'Remove your answer?');
}
async function removeMyAnswer(kind, code, id) {
  const A = FORM_ADAPTERS[kind], sp = A.space(code);
  if (!sp) return;
  const me = A.me(sp);
  if (sp.local) { const all = A.entry(code).formResponses?.[id]; if (all) delete all[me]; touch(); toast('Answer removed', 'info'); return; }
  try {
    const batch = _fbDb.batch();
    batch.delete(formRef(kind, code, id).collection('responses').doc(me));
    batch.delete(_fbDb.collection('planners').doc(me).collection('formAnswers').doc(formAnswerKey(kind, code, id)));
    await batch.commit();
    _formCountAt.at = 0;
    toast('Answer removed', 'info');
  } catch (e) { diag.error('forms', 'Removing an answer failed', e); toast('Couldn’t remove it. Check your connection and try again.', 'error'); }
}

/* ── Sharing ───────────────────────────────────────────────────── */
function formLink(kind, code, id) { return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}form.html?f=${formToken(kind, code, id)}`; }
function openFormShare(kind, code, id) {
  const A = FORM_ADAPTERS[kind], sp = A.space(code), f = findForm(kind, code, id);
  if (!sp || !f) return;
  const link = formLink(kind, code, id);
  const args = formArgs(kind, code, id);
  const outside = f.audience === 'link';
  openModal(`
    <div class="modal-head"><h3>Share “${esc(f.title)}”</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body form-share space" style="${spaceVars(A.color(sp))}">
      ${sp.sample ? '<div class="sg-callout mb-16">' + icon('info', 16) + '<div class="small">This is a sample, so the link and code are just for show.</div></div>' : ''}
      <div class="form-share-grid">
        <div class="invite-qr form-share-qr" role="img" aria-label="QR code that opens this form" data-invite-qr="${esc(link)}"></div>
        <div class="form-share-side">
          <div class="form-share-who">${icon(outside ? 'link' : 'users', 14)}<span>${outside ? 'Anyone with this link can answer. People who aren’t members sign in with a free account first.' : `Only members of ${esc(sp.name)} can answer.`}</span></div>
          <div class="sg-invite-row"><input class="input" id="form-share-link" readonly value="${esc(link)}" aria-label="Link to this form" onfocus="this.select()"><button class="btn btn-primary" onclick="copyText($('#form-share-link').value,'Link copied')">${icon('copy', 14)}Copy</button></div>
          <div class="form-share-more">
            <button class="btn btn-sm" onclick="shareFormToChat(${args})">${icon('message-circle', 14)}Post in chat</button>
            ${navigator.share ? `<button class="btn btn-sm" onclick="shareFormNative(${args})">${icon('share', 14)}Share…</button>` : ''}
          </div>
          <button class="sg-link form-share-switch" onclick="closeModal();openFormBuilder(${args},{focus:'audience'})">Change who can answer</button>
        </div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Done</button></div>
  `, { wide: true });
  if (typeof inviteFillQr === 'function') inviteFillQr($('#modal'));
}
function shareFormToChat(kind, code, id) {
  const f = findForm(kind, code, id);
  if (!f) return;
  FORM_ADAPTERS[kind].chat(code, `New form: ${f.title}\n${formLink(kind, code, id)}`);
  closeModal();
  toast('Posted in chat', 'success');
}
function shareFormNative(kind, code, id) {
  const f = findForm(kind, code, id), sp = FORM_ADAPTERS[kind].space(code);
  if (!f || !sp) return;
  navigator.share({ title: f.title, text: `${f.title} (${sp.name})`, url: formLink(kind, code, id) }).catch(() => {});
}

/* ── Running one: status, copy, delete ─────────────────────────── */
// The one write path for a form. `form` is the whole form.
async function saveForm(kind, code, form) {
  const A = FORM_ADAPTERS[kind], sp = A.space(code);
  const data = formForSave({ ...form, updatedAt: Date.now() });
  if (!sp || !data) return false;
  if (sp.local) {
    const entry = A.entry(code);
    (entry.forms = entry.forms || {})[data.id] = data;
    touch();
    return true;
  }
  if (!cloudGroupsEnabled()) { toast('Log in to make changes.', 'error'); return false; }
  try { await formRef(kind, code, data.id).set(data); return true; }
  catch (e) {
    diag.error('forms', 'Form save failed', e);
    toast(e.code === 'permission-denied' ? (kind === 'club' ? 'Only officers can change a form.' : 'Only whoever made this form, or the group’s owner, can change it.') : 'Couldn’t save that. Check your connection and try again.', 'error', 4500);
    return false;
  }
}
async function setFormStatus(kind, code, id, status) {
  const f = findForm(kind, code, id);
  if (!f) return;
  if (status === 'open') {
    const problem = formPublishProblem(f);
    if (problem) { toast(problem, 'error', 4500); openFormBuilder(kind, code, id); return; }
  }
  // Opening a form whose closing day has passed would reopen it shut.
  const closesAt = status === 'open' && f.closesAt && f.closesAt < Date.now() ? null : f.closesAt;
  if (await saveForm(kind, code, { ...f, status, closesAt })) toast(status === 'open' ? 'Taking answers' : 'Closed. No more answers come in.', 'success');
}
async function duplicateForm(kind, code, id) {
  const A = FORM_ADAPTERS[kind], sp = A.space(code), f = findForm(kind, code, id);
  if (!sp || !f) return;
  if (spaceForms(kind, sp).length >= FORM_PER_SPACE_MAX) { toast(`${sp.name} already has ${FORM_PER_SPACE_MAX} forms. Delete an old one first.`, 'error', 5000); return; }
  const now = Date.now();
  const copy = { ...f, id: uid(), title: `${f.title} (copy)`.slice(0, FORM_TITLE_MAX), status: 'draft', closesAt: null, createdBy: A.me(sp), createdByName: myGroupName(), createdAt: now, questions: f.questions.map(q => ({ ...q, id: uid(), options: [...q.options] })) };
  if (await saveForm(kind, code, copy)) { toast('Copy saved as a draft', 'success'); openFormBuilder(kind, code, copy.id); }
}
function confirmDeleteForm(kind, code, id) {
  const sp = FORM_ADAPTERS[kind].space(code), f = findForm(kind, code, id);
  if (!sp || !f) return;
  const n = formCount(kind, sp, f);
  confirmDialog(n ? `The form and its ${n} answer${n === 1 ? '' : 's'} are deleted for good. Download the spreadsheet first if you want to keep them.` : 'The form is deleted for good.', () => deleteForm(kind, code, id), 'Delete', `Delete “${f.title}”?`);
}
async function deleteForm(kind, code, id) {
  const A = FORM_ADAPTERS[kind], sp = A.space(code);
  if (!sp) return;
  const key = formKey(kind, code);
  if (_formView[key]?.id === id) delete _formView[key];
  if (sp.local) {
    const entry = A.entry(code);
    if (entry.forms) delete entry.forms[id];
    if (entry.formResponses) delete entry.formResponses[id];
    touch();
    toast('Form deleted', 'info');
    return;
  }
  try {
    // The answers go first: once the form is gone nobody could reach them.
    const ref = formRef(kind, code, id);
    for (let round = 0; round < 20; round++) {
      const snap = await ref.collection('responses').limit(200).get();
      if (snap.empty) break;
      const batch = _fbDb.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    await ref.delete();
    delete _formCounts[`${key}:${id}`];
    toast('Form deleted', 'info');
  } catch (e) { diag.error('forms', 'Form delete failed', e); toast('Couldn’t delete it. Check your connection and try again.', 'error'); }
}

/* ── The answers ───────────────────────────────────────────────── */
function openFormResults(kind, code, id) {
  _formView[formKey(kind, code)] = { id, pane: 'summary', person: '' };
  render();
  window.scrollTo(0, 0);
}
function closeFormResults(kind, code) { delete _formView[formKey(kind, code)]; render(); }
function setFormPane(kind, code, pane, person = '') {
  const v = _formView[formKey(kind, code)];
  if (!v) return;
  v.pane = pane; v.person = person;
  render();
}
function formResultsHtml(kind, sp, f, view) {
  const args = formArgs(kind, sp.code, f.id);
  const spArgs = formArgs(kind, sp.code);
  const list = formResponses(kind, sp, f);
  const phase = formPhase(f);
  const n = list ? list.length : 0;
  const outside = list ? list.filter(r => !r.member).length : 0;
  const head = `
    <button type="button" class="sg-link forms-back" onclick="closeFormResults(${spArgs})">${icon('chevron-left', 12)} All forms</button>
    <div class="forms-results-head">
      <div>
        <div class="forms-results-tags">${formStatusTag(f)}<span class="row-meta">${esc([f.audience === 'link' ? 'Anyone with the link' : 'Members only', formClosesLabel(f)].filter(Boolean).join(' · '))}</span></div>
        <h2 class="forms-results-title">${esc(f.title)}</h2>
        <div class="forms-results-count">${list ? `<strong>${n}</strong> answer${n === 1 ? '' : 's'}${outside ? ` · ${outside} from people who aren’t members yet` : ''}` : ''}</div>
      </div>
      <div class="forms-results-actions">
        ${phase === 'open' ? `<button type="button" class="btn btn-sm" onclick="openFormShare(${args})">${icon('share', 14)}Share</button>` : ''}
        <button type="button" class="btn btn-sm" ${n ? '' : 'disabled '}onclick="downloadFormCsv(${args})">${icon('download', 14)}Spreadsheet</button>
        <button type="button" class="btn btn-ghost btn-icon" aria-label="More for ${esc(f.title)}" onclick="openFormMenu(this,${args})">${icon('more-horizontal', 16)}</button>
      </div>
    </div>`;
  if (!list) {
    return `<div class="forms forms-results">${head}${_formResp.failed ? inlineErrorHtml('The answers didn’t load. Check your connection and try again.', `formsRetryAnswers(${spArgs})`) : '<p class="small muted">Loading answers…</p>'}</div>`;
  }
  if (!n) {
    return `<div class="forms forms-results">${head}${emptyStateHtml({
      icon: 'clipboard-list', title: 'No answers yet',
      body: phase === 'open' ? 'Share the link or the QR code, and answers show up here as they come in.' : 'This form is closed. Open it again to take answers.',
      actions: phase === 'open' ? [{ label: 'Share the form', icon: 'share', onclick: `openFormShare(${args})` }] : [{ label: 'Open it again', icon: 'refresh-cw', onclick: `setFormStatus(${args},'open')` }],
    })}</div>`;
  }
  const pane = view.pane === 'people' ? 'people' : 'summary';
  return `
    <div class="forms forms-results">
      ${head}
      <div class="segmented forms-pane-pick" role="group" aria-label="Show">
        <button type="button" aria-pressed="${pane === 'summary'}" class="${pane === 'summary' ? 'active' : ''}" onclick="setFormPane(${spArgs},'summary')">Summary</button>
        <button type="button" aria-pressed="${pane === 'people'}" class="${pane === 'people' ? 'active' : ''}" onclick="setFormPane(${spArgs},'people')">By person</button>
      </div>
      ${n >= FORM_RESPONSES_SHOWN ? `<p class="small muted">Showing the first ${FORM_RESPONSES_SHOWN} answers.</p>` : ''}
      ${pane === 'summary' ? formSummaryHtml(f, list) : formPeopleHtml(kind, sp, f, list, view.person)}
    </div>`;
}
function formsRetryAnswers(kind, code) { formsCloseAnswers(); render(); }
function formSummaryHtml(f, list) {
  return `<div class="forms-summary">${formSummary(f, list).map((s, i) => {
    const title = `<div class="forms-sum-head"><h3>${esc(s.q.label || `Question ${i + 1}`)}</h3><span class="row-meta">${s.answered} of ${list.length} answered</span></div>`;
    if (s.kind === 'text') {
      const shown = s.answers.slice(0, 40);
      return `<div class="card card-pad forms-sum">${title}${shown.length ? `<ul class="forms-sum-text">${shown.map(a => `<li><div class="forms-sum-quote">${esc(a.text).replace(/\n/g, '<br>')}</div><div class="row-meta">${esc(a.name)}</div></li>`).join('')}</ul>${s.answers.length > shown.length ? `<p class="small muted">And ${s.answers.length - shown.length} more in the spreadsheet.</p>` : ''}` : '<p class="small muted">Nobody answered this one.</p>'}</div>`;
    }
    const top = Math.max(0, ...s.rows.map(r => r.count));
    return `<div class="card card-pad forms-sum">${title}${s.kind === 'scale' && s.answered ? `<div class="forms-sum-avg"><strong>${s.avg}</strong> average, out of 5</div>` : ''}
      <div class="forms-bars" role="list">${s.rows.map(r => `
        <div class="forms-bar${top && r.count === top ? ' is-top' : ''}" role="listitem">
          <div class="forms-bar-label">${esc(r.label)}</div>
          <div class="forms-bar-track" aria-hidden="true"><span style="width:${r.pct}%"></span></div>
          <div class="forms-bar-num">${r.count}<span class="row-meta"> · ${r.pct}%</span></div>
        </div>`).join('')}</div></div>`;
  }).join('')}</div>`;
}
function formPeopleHtml(kind, sp, f, list, person) {
  const sorted = [...list].sort((a, b) => (b.updatedAt || b.at) - (a.updatedAt || a.at));
  const open = sorted.find(r => r.uid === person);
  const spArgs = formArgs(kind, sp.code);
  const color = FORM_ADAPTERS[kind].color(sp);
  if (open) {
    return `
      <div class="card card-pad forms-person">
        <button type="button" class="sg-link forms-back" onclick="setFormPane(${spArgs},'people')">${icon('chevron-left', 12)} Everyone</button>
        <div class="forms-person-head">
          ${personAvatar(open.uid, open.name, 36, open.member ? color : spaceTint(color, 2))}
          <div><div class="sg-strong">${esc(open.name)}</div><div class="row-meta">${[open.email ? esc(open.email) : '', open.member ? 'Member' : 'Not a member yet', esc(fmtRelativeTime(open.updatedAt || open.at))].filter(Boolean).join(' · ')}</div></div>
          <button type="button" class="btn btn-ghost btn-sm forms-person-remove" onclick="confirmRemoveAnswer(${formArgs(kind, sp.code, f.id)},'${esc(open.uid)}')">${icon('trash', 14)}Remove</button>
        </div>
        <dl class="forms-person-answers">${f.questions.map((q, i) => `<dt>${esc(q.label || `Question ${i + 1}`)}</dt><dd>${formAnswerEmpty(open.answers[q.id]) ? '<span class="muted">No answer</span>' : esc(formAnswerText(q, open.answers[q.id])).replace(/\n/g, '<br>')}</dd>`).join('')}</dl>
      </div>`;
  }
  return `<div class="forms-people">${sorted.map(r => `
    <button type="button" class="list-row forms-person-row" onclick="setFormPane(${spArgs},'people','${esc(r.uid)}')">
      ${personAvatar(r.uid, r.name, 30, r.member ? color : spaceTint(color, 2))}
      <span class="row-title"><span class="sg-strong">${esc(r.name)}</span>${r.member ? '' : ` ${spaceTag('weekly', 'Not a member yet')}`}<span class="row-meta forms-person-sub">${[r.email ? esc(r.email) : '', esc(fmtRelativeTime(r.updatedAt || r.at))].filter(Boolean).join(' · ')}</span></span>
      ${icon('chevron-right', 14)}
    </button>`).join('')}</div>`;
}
function confirmRemoveAnswer(kind, code, id, who) {
  if (!safeId(who)) return;
  confirmDialog('Their answer is deleted for good. They can send a new one while the form is open.', () => removeAnswer(kind, code, id, who), 'Remove', 'Remove this answer?');
}
async function removeAnswer(kind, code, id, who) {
  const A = FORM_ADAPTERS[kind], sp = A.space(code);
  if (!sp || !safeId(who)) return;
  const v = _formView[formKey(kind, code)];
  if (v) v.person = '';
  if (sp.local) { const all = A.entry(code).formResponses?.[id]; if (all) delete all[who]; touch(); toast('Answer removed', 'info'); return; }
  try { await formRef(kind, code, id).collection('responses').doc(who).delete(); toast('Answer removed', 'info'); }
  catch (e) { diag.error('forms', 'Removing an answer failed', e); toast('Couldn’t remove it. Check your connection and try again.', 'error'); }
}
function downloadFormCsv(kind, code, id) {
  const sp = FORM_ADAPTERS[kind].space(code), f = findForm(kind, code, id);
  const list = sp && f ? formResponses(kind, sp, f) : null;
  if (!list?.length) return;
  const name = `${f.title} answers`.replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'form-answers';
  downloadCsv(`${name}.csv`, formCsvRows(f, list));
}

/* ── Sample spaces ─────────────────────────────────────────────── */
// Two forms with answers, so a sample club or group shows the whole
// thing: one open interest form with answers from people who aren't
// members, and one members' form still waiting for you.
// people: [{ uid, name }] the sample's members; by: the officer who made them.
function sampleForms(kind, { name, color, people, by, byName, now = Date.now() }) {
  const D = 86400000;
  const base = { spaceKind: kind, spaceName: name, spaceColor: color, createdBy: by, createdByName: byName, updatedAt: now - D };
  const out = { forms: {}, formResponses: {} };
  const add = (tplKey, extra, answersOf, who) => {
    const f = formForSave({ ...formFromTemplate(tplKey), ...base, ...extra });
    out.forms[f.id] = f;
    out.formResponses[f.id] = Object.fromEntries(who.map((p, i) => [p.uid, { uid: p.uid, name: p.name, member: !!p.member, ...(f.collectEmail ? { email: `${p.name.toLowerCase().replace(/[^a-z]/g, '')}@school.edu` } : {}), answers: formCheckAnswers(f, answersOf(f.questions, i)).answers, at: now - (i + 1) * 5 * 3600000, updatedAt: now - (i + 1) * 5 * 3600000 }]));
    return f;
  };
  const pick = (q, i) => q.options[i % q.options.length];
  if (kind === 'club') {
    const visitors = ['Jada', 'Theo', 'Mina', 'Luis', 'Priya', 'Ben', 'Aiko'].map((n, i) => ({ uid: `sample-visitor-${i}`, name: n, member: false }));
    const majors = ['Biology', 'Marketing', 'Computer science', 'Nursing', 'Psychology', 'Undecided', 'Finance'];
    const notes = ['I’m a transfer, so I’m looking for people to do things with.', '', 'Can I come to a meeting before I decide?', '', 'My roommate is a member and talks about it all the time.', '', ''];
    add('interest', { status: 'open', createdAt: now - 9 * D, closesAt: null }, (qs, i) => ({ [qs[0].id]: pick(qs[0], i), [qs[1].id]: majors[i], [qs[2].id]: [pick(qs[2], i), pick(qs[2], i + 2)], [qs[3].id]: pick(qs[3], i * 2), [qs[4].id]: notes[i] }), visitors);
    add('signup', { status: 'open', title: 'Fall retreat sign-up', description: 'So we know how many seats and how much food.', createdAt: now - 2 * D, closesAt: formClosesAtFromDate(addDays(todayIso(), 6)) }, (qs, i) => ({ [qs[0].id]: pick(qs[0], i % 5 === 4 ? 2 : i % 3 === 2 ? 1 : 0), [qs[1].id]: pick(qs[1], i), [qs[2].id]: i === 1 ? 'Vegetarian' : i === 4 ? 'Peanut allergy' : '' }), people.slice(0, 8).map(p => ({ ...p, member: true })));
  } else {
    add('study', { status: 'open', createdAt: now - D, closesAt: null }, (qs, i) => ({ [qs[0].id]: ['The second half of the unit, mostly.', 'Anything with graphs.', 'I’m fine on the reading, shaky on the problem sets.'][i % 3], [qs[1].id]: [pick(qs[1], i), pick(qs[1], i + 1)], [qs[2].id]: pick(qs[2], i) }), people.slice(0, 3).map(p => ({ ...p, member: true })));
  }
  return out;
}
