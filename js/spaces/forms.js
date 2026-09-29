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
   A form that sorts its answers (an application) lets whoever runs it
   mark each one accepted, waitlisted or declined. The marks live where
   the person they are about cannot read them, and nothing is sent.
   An anonymous form's answers carry no name: they are sent through the
   Worker (js/spaces/formsend.js), and listed here as Answer 1, 2, 3 in an
   order that has nothing to do with when they arrived.

   Data: a cloud space keeps forms in its forms subcollection, listened
   to only while that space's page is open (formsAfterRender). A local or
   sample space keeps them on its planner entry: entry.forms[id],
   entry.formResponses[formId][uid], entry.formMarks[formId][uid], and
   entry.formAnon[formId] (my own anonymous answer's id).

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
let _formMarks = { key: '', map: {}, unsub: null };                    // accepted / waitlisted / declined, same form
const _formCounts = {};                 // `${space key}:${id}` -> number of answers
const _formView = {};                   // space key -> { id, pane: 'summary' | 'people', person, filter }

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
  if (sp.local) {
    const entry = FORM_ADAPTERS[kind].entry(sp.code);
    const r = entry?.formResponses?.[id]?.[LOCAL_UID] || entry?.formAnon?.[id];
    return r ? { at: r.updatedAt || r.at || 0 } : null;
  }
  const rec = _formMine.map[formAnswerKey(kind, sp.code, id)];
  return rec ? { at: Number(rec.at) || 0 } : null;
}
// What the sending code needs to know about me and this space.
function formCtx(kind, sp) {
  return { db: _fbDb, storage: fbStorage, user: _fbUser, kind, code: sp.code, name: myGroupName(), member: true };
}
function formMarks(kind, sp, form) {
  if (sp.local) return FORM_ADAPTERS[kind].entry(sp.code)?.formMarks?.[form.id] || {};
  return _formMarks.key === `${formKey(kind, sp.code)}:${form.id}` ? _formMarks.map : {};
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
function formsCloseAnswers() {
  if (_formResp.unsub) _formResp.unsub();
  if (_formMarks.unsub) _formMarks.unsub();
  _formResp = { key: '', list: null, failed: false, unsub: null };
  _formMarks = { key: '', map: {}, unsub: null };
}
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
  // The marks are asked for whether or not the form sorts its answers
  // today: one that used to keeps its marks for the spreadsheet.
  _formMarks.key = key;
  _formMarks.unsub = formRef(kind, code, id).collection('marks').limit(FORM_RESPONSES_SHOWN).onSnapshot(snap => {
    _formMarks.map = Object.fromEntries(snap.docs.map(d => [d.id, d.data().status]).filter(([, st]) => FORM_MARKS.some(m => m[0] === st)));
    renderRemote();
  }, err => { diag.warn('forms', 'Form marks didn’t load', err); _formMarks.unsub = null; });
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
    f.anonymous ? 'Anonymous' : '',
    formClosesLabel(f),
  ].filter(Boolean);
  const answerBtn = phase === 'draft' ? ''
    : mine ? (phase === 'open' && f.allowEdit
      ? `<button type="button" class="btn btn-sm" onclick="openFormFill(${args})">${icon('pencil', 14)}${f.anonymous ? 'Answer again' : 'Change my answer'}</button>`
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
// My own answer, read back. An anonymous one can't be: it is filed where
// nothing connects it to me except a record only the server follows.
async function formMyAnswer(kind, sp, f) {
  if (f.anonymous) return null;
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
  const answered = mine || (f.anonymous ? formAnswered(kind, sp, f.id) : null);
  const open = formIsOpen(f);
  const readOnly = !open || (!!answered && !f.allowEdit);
  window._formFill = { kind, code, id, at: mine?.at || 0, sent: mine?.answers || {}, again: !!answered };
  const when = answered ? esc(fmtRelativeTime(answered.updatedAt || answered.at).toLowerCase()) : '';
  const sentNote = !answered ? (open ? '' : '<p class="ff-sent">This form is closed and isn’t taking answers.</p>')
    : f.anonymous ? `<p class="ff-sent">${icon('check', 14)}<span>You answered ${when}. Your answer is anonymous, so it can’t be shown here.${!open ? ' This form is closed.' : f.allowEdit ? ' Sending again replaces it.' : ' Answers to this form can’t be changed.'}</span></p>`
    : readOnly ? `<p class="ff-sent">${icon('check', 14)}<span>You answered ${when}.${open ? ' Answers to this form can’t be changed.' : ' This form is closed.'}</span></p>` : '';
  const showFields = open ? !(f.anonymous && readOnly) : !!mine;
  openModal(`
    <div class="modal-head"><h3>${esc(f.title)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body form-fill space" style="${spaceVars(A.color(sp))}">
      <div class="form-fill-from">${esc(sp.name)}${f.anonymous ? ' · Anonymous' : ''}${formClosesLabel(f) ? ` · ${esc(formClosesLabel(f))}` : ''}</div>
      ${sentNote}
      ${showFields ? formFillHtml(f, { answers: mine?.answers || {}, who: formWho(kind, sp), runners: A.runners(sp, f), readOnly }) : ''}
    </div>
    <div class="modal-foot">
      ${answered ? `<button class="btn btn-ghost form-fill-remove" onclick="confirmRemoveMyAnswer(${formArgs(kind, code, id)})">Remove my answer</button>` : ''}
      <button class="btn" onclick="closeModal()">${readOnly ? 'Close' : 'Cancel'}</button>
      ${readOnly ? '' : `<button class="btn btn-primary" id="form-send" onclick="submitFormFill(this)">${answered ? (f.anonymous ? 'Send again' : 'Save my answer') : 'Send'}</button>`}
    </div>
  `, { wide: true });
}
// A sample or signed-out space keeps a picked file in memory, as a data URL.
function formLocalFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ name: file.name, size: file.size, type: file.type || '', url: String(r.result) });
    r.onerror = () => reject(new Error('That file couldn’t be read.'));
    r.readAsDataURL(file);
  });
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
  const done = (msg) => { closeModal(); toast(msg, 'success'); };
  if (sp.local) {
    const entry = A.entry(st.code), me = A.me(sp);
    entry.formResponses = entry.formResponses || {};
    const all = entry.formResponses[f.id] = entry.formResponses[f.id] || {};
    try {
      for (const q of formFileQuestions(f)) {
        const picked = formFillPicked(q.id);
        if (!picked) continue;
        if (picked.size > GROUP_FILE_MAX_BYTES_LOCAL) { formFillShowErrors(root, f, { [q.id]: `Without an account, files stop at ${formFileSize(GROUP_FILE_MAX_BYTES_LOCAL)}. Log in to send bigger ones.` }); return; }
        res.answers[q.id] = await formLocalFile(picked);
      }
    } catch (e) { toast(e.message, 'error'); return; }
    if (f.anonymous) {
      entry.formAnon = entry.formAnon || {};
      const answerId = entry.formAnon[f.id]?.answerId || `anon${uid()}`;
      all[answerId] = { anon: true, answers: res.answers, at: new Date(todayIso() + 'T00:00:00').getTime() };
      entry.formAnon[f.id] = { answerId, at: now };
    } else {
      all[me] = { uid: me, name: formWho(st.kind, sp).name.slice(0, 80), member: true, answers: res.answers, at: st.at || now, updatedAt: now };
    }
    touch();
    done(st.again ? 'Answer saved' : 'Sent');
    return;
  }
  setBtnLoading(btn, true);
  try {
    await formSendAnswer(formCtx(st.kind, sp), f, res.answers, { at: st.at, sent: st.sent });
    _formCountAt.at = 0;   // my own answer changes the count: ask again on the next render
    done(st.again ? 'Answer saved' : `Sent to ${sp.name}`);
    playUiSound('send');
  } catch (e) {
    setBtnLoading(btn, false);
    if (e.errors && !formFillShowErrors(root, f, e.errors)) return;
    diag.error('forms', 'Form answer failed', e);
    toast(e.status ? e.message : e.code === 'permission-denied' || e.code === 'storage/unauthorized' ? 'That didn’t go through. The form may have just closed.' : 'Couldn’t send. Check your connection and try again.', 'error', 5000);
  }
}
function confirmRemoveMyAnswer(kind, code, id) {
  confirmDialog('Your answer is deleted, and the people running the form stop seeing it.', () => removeMyAnswer(kind, code, id), 'Remove', 'Remove your answer?');
}
async function removeMyAnswer(kind, code, id) {
  const A = FORM_ADAPTERS[kind], sp = A.space(code), f = findForm(kind, code, id);
  if (!sp || !f) return;
  const me = A.me(sp);
  if (sp.local) {
    const entry = A.entry(code), all = entry.formResponses?.[id] || {};
    if (f.anonymous) { delete all[entry.formAnon?.[id]?.answerId]; if (entry.formAnon) delete entry.formAnon[id]; }
    else { delete all[me]; if (entry.formMarks?.[id]) delete entry.formMarks[id][me]; }
    touch(); toast('Answer removed', 'info');
    return;
  }
  try {
    await formTakeBack(formCtx(kind, sp), f);
    _formCountAt.at = 0;
    toast('Answer removed', 'info');
  } catch (e) { diag.error('forms', 'Removing an answer failed', e); toast(e.status ? e.message : 'Couldn’t remove it. Check your connection and try again.', 'error'); }
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
    if (entry.formMarks) delete entry.formMarks[id];
    if (entry.formAnon) delete entry.formAnon[id];
    touch();
    toast('Form deleted', 'info');
    return;
  }
  try {
    // The answers go first, with their files and marks: once the form is
    // gone nobody could reach them.
    const ref = formRef(kind, code, id);
    const f = findForm(kind, code, id);
    for (const sub of ['responses', 'marks']) {
      for (let round = 0; round < 20; round++) {
        const snap = await ref.collection(sub).limit(200).get();
        if (snap.empty) break;
        if (sub === 'responses' && f && !f.anonymous) for (const d of snap.docs) await formDeleteFiles(formCtx(kind, sp), f, d.id);
        const batch = _fbDb.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    }
    await ref.delete();
    delete _formCounts[`${key}:${id}`];
    toast('Form deleted', 'info');
  } catch (e) { diag.error('forms', 'Form delete failed', e); toast('Couldn’t delete it. Check your connection and try again.', 'error'); }
}

/* ── The answers ───────────────────────────────────────────────── */
function openFormResults(kind, code, id) {
  _formView[formKey(kind, code)] = { id, pane: 'summary', person: '', filter: 'all' };
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
function setFormFilter(kind, code, filter) {
  const v = _formView[formKey(kind, code)];
  if (!v) return;
  v.filter = filter; v.person = '';
  render();
}
function formResultsHtml(kind, sp, f, view) {
  const args = formArgs(kind, sp.code, f.id);
  const spArgs = formArgs(kind, sp.code);
  const list = formResponses(kind, sp, f);
  const phase = formPhase(f);
  const n = list ? list.length : 0;
  const outside = list && !f.anonymous ? list.filter(r => !r.member).length : 0;
  const head = `
    <button type="button" class="sg-link forms-back" onclick="closeFormResults(${spArgs})">${icon('chevron-left', 12)} All forms</button>
    <div class="forms-results-head">
      <div>
        <div class="forms-results-tags">${formStatusTag(f)}<span class="row-meta">${esc([f.audience === 'link' ? 'Anyone with the link' : 'Members only', f.anonymous ? 'Anonymous' : '', formClosesLabel(f)].filter(Boolean).join(' · '))}</span></div>
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
        <button type="button" aria-pressed="${pane === 'people'}" class="${pane === 'people' ? 'active' : ''}" onclick="setFormPane(${spArgs},'people')">${f.anonymous ? 'One by one' : 'By person'}</button>
      </div>
      ${n >= FORM_RESPONSES_SHOWN ? `<p class="small muted">Showing the first ${FORM_RESPONSES_SHOWN} answers.</p>` : ''}
      ${f.anonymous ? `<p class="forms-anon-note">${icon('lock', 14)}<span>Answers to this form carry no names. They are listed in no particular order, with the day they were sent.</span></p>` : ''}
      ${pane === 'summary' ? formSummaryHtml(kind, sp, f, list) : formPeopleHtml(kind, sp, f, list, view)}
    </div>`;
}
function formsRetryAnswers(kind, code) { formsCloseAnswers(); render(); }
// The order answers are listed in, and what each is called. Anonymous
// answers go by the id they were filed under, never by when they came.
function formListed(f, list) {
  const sorted = [...list].sort(f.anonymous ? (a, b) => a.uid.localeCompare(b.uid) : (a, b) => (b.updatedAt || b.at) - (a.updatedAt || a.at));
  return sorted.map((r, i) => ({ ...r, label: f.anonymous ? `Answer ${i + 1}` : r.name }));
}
function formFileButton(kind, sp, f, r, q, cls = 'btn btn-sm') {
  const v = r.answers[q.id];
  return `<button type="button" class="${cls} forms-file" onclick="openFormFile(this,${formArgs(kind, sp.code, f.id)},'${esc(r.uid)}','${esc(q.id)}')">${icon('paperclip', 14)}<span>${esc(v.name)}</span><span class="ff-file-size">${formFileSize(v.size)}</span></button>`;
}
async function openFormFile(btn, kind, code, id, who, questionId) {
  const A = FORM_ADAPTERS[kind], sp = A.space(code), f = findForm(kind, code, id);
  if (!sp || !f || !safeId(who) || !safeId(questionId)) return;
  const r = (formResponses(kind, sp, f) || []).find(x => x.uid === who);
  const v = r?.answers[questionId];
  if (!v) return;
  const open = (url) => { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.download = v.name; document.body.appendChild(a); a.click(); a.remove(); };
  if (sp.local) { if (v.url) open(v.url); else toast('This sample file is just for show.', 'info'); return; }
  setBtnLoading(btn, true);
  try { open(await formFileUrl(formCtx(kind, sp), id, who, questionId)); }
  catch (e) { diag.warn('forms', 'A form file didn’t open', e); toast(e.code === 'storage/object-not-found' ? 'That file is gone. It may have been removed.' : 'Couldn’t open that file. Check your connection and try again.', 'error', 4500); }
  finally { setBtnLoading(btn, false); }
}
function formSummaryHtml(kind, sp, f, list) {
  const listed = formListed(f, list);
  const labelOf = Object.fromEntries(listed.map(r => [r.uid, r.label]));
  const byUid = Object.fromEntries(listed.map(r => [r.uid, r]));
  const marks = f.review ? formMarks(kind, sp, f) : null;
  const sorting = marks ? `<div class="card card-pad forms-sum forms-sum-marks"><div class="forms-sum-head"><h3>Sorted so far</h3><span class="row-meta">Only ${kind === 'club' ? 'officers' : 'you and the group’s owner'} see this</span></div>
    <div class="forms-mark-counts">${[...FORM_MARKS, ['', 'Not sorted yet', 'more-horizontal']].map(([k, label]) => `<button type="button" class="forms-mark-count" onclick="setFormPane(${formArgs(kind, sp.code)},'people');setFormFilter(${formArgs(kind, sp.code)},'${k || 'none'}')"><strong>${list.filter(r => (marks[r.uid] || '') === k).length}</strong><span>${label}</span></button>`).join('')}</div></div>` : '';
  return `<div class="forms-summary">${sorting}${formSummary(f, list).map((s, i) => {
    const title = `<div class="forms-sum-head"><h3>${esc(s.q.label || `Question ${i + 1}`)}</h3><span class="row-meta">${s.answered} of ${list.length} answered</span></div>`;
    if (s.kind === 'text' || s.kind === 'files') {
      const shown = (f.anonymous ? [...s.answers].sort((a, b) => a.uid.localeCompare(b.uid)) : s.answers).slice(0, 40);
      const item = (a) => s.kind === 'files'
        ? `<li>${formFileButton(kind, sp, f, byUid[a.uid], s.q)}<div class="row-meta">${esc(labelOf[a.uid] || a.name)}</div></li>`
        : `<li><div class="forms-sum-quote">${esc(a.text).replace(/\n/g, '<br>')}</div><div class="row-meta">${esc(labelOf[a.uid] || a.name)}</div></li>`;
      return `<div class="card card-pad forms-sum">${title}${shown.length ? `<ul class="forms-sum-text${s.kind === 'files' ? ' is-files' : ''}">${shown.map(item).join('')}</ul>${s.answers.length > shown.length ? `<p class="small muted">And ${s.answers.length - shown.length} more ${s.kind === 'files' ? 'under By person' : 'in the spreadsheet'}.</p>` : ''}` : `<p class="small muted">Nobody ${s.kind === 'files' ? 'sent a file' : 'answered this one'}.</p>`}</div>`;
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
function formMarkTag(status) {
  const m = FORM_MARKS.find(x => x[0] === status);
  return m ? `<span class="space-tag forms-mark is-${m[0]}">${icon(m[2], 12)}${m[1]}</span>` : '';
}
function formFace(f, r, size, color) {
  return f.anonymous ? `<span class="avatar sg-avatar forms-anon-face" aria-hidden="true" style="width:${size}px;height:${size}px">${icon('lock', Math.round(size * 0.45))}</span>` : personAvatar(r.uid, r.name, size, r.member ? color : spaceTint(color, 2));
}
function formPeopleHtml(kind, sp, f, list, view) {
  const listed = formListed(f, list);
  const open = listed.find(r => r.uid === view.person);
  const spArgs = formArgs(kind, sp.code);
  const args = formArgs(kind, sp.code, f.id);
  const color = FORM_ADAPTERS[kind].color(sp);
  const marks = f.review ? formMarks(kind, sp, f) : {};
  const sent = (r) => f.anonymous ? new Date(r.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : fmtRelativeTime(r.updatedAt || r.at);
  if (open) {
    const mark = marks[open.uid] || '';
    const at = listed.indexOf(open), prev = listed[at - 1], next = listed[at + 1];
    return `
      <div class="card card-pad forms-person">
        <div class="forms-person-nav">
          <button type="button" class="sg-link forms-back" onclick="setFormPane(${spArgs},'people')">${icon('chevron-left', 12)} Everyone</button>
          <span class="forms-person-step"><button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label="The answer before" ${prev ? '' : 'disabled '}onclick="setFormPane(${spArgs},'people','${esc(prev?.uid || '')}')">${icon('chevron-left', 14)}</button><span class="row-meta">${at + 1} of ${listed.length}</span><button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label="The next answer" ${next ? '' : 'disabled '}onclick="setFormPane(${spArgs},'people','${esc(next?.uid || '')}')">${icon('chevron-right', 14)}</button></span>
        </div>
        <div class="forms-person-head">
          ${formFace(f, open, 36, color)}
          <div><div class="sg-strong">${esc(open.label)}</div><div class="row-meta">${[open.email ? esc(open.email) : '', f.anonymous ? '' : open.member ? 'Member' : 'Not a member yet', esc(sent(open))].filter(Boolean).join(' · ')}</div></div>
          <button type="button" class="btn btn-ghost btn-sm forms-person-remove" onclick="confirmRemoveAnswer(${args},'${esc(open.uid)}')">${icon('trash', 14)}Remove</button>
        </div>
        ${f.review ? `<div class="forms-decide" role="group" aria-label="Decide on this answer">
          ${FORM_MARKS.map(([k, label, ic, verb]) => `<button type="button" class="btn btn-sm forms-decide-btn is-${k}${mark === k ? ' is-on' : ''}" aria-pressed="${mark === k}" onclick="setFormMark(${args},'${esc(open.uid)}','${k}')">${icon(ic, 14)}${mark === k ? label : verb}</button>`).join('')}
          <span class="forms-decide-note">Only ${kind === 'club' ? 'officers' : 'you and the group’s owner'} see this. Nothing is sent to ${esc(open.name)}.</span>
        </div>` : ''}
        <dl class="forms-person-answers">${f.questions.map((q, i) => `<dt>${esc(q.label || `Question ${i + 1}`)}</dt><dd>${formAnswerEmpty(open.answers[q.id]) ? '<span class="muted">No answer</span>' : q.type === 'file' ? formFileButton(kind, sp, f, open, q) : esc(formAnswerText(q, open.answers[q.id])).replace(/\n/g, '<br>')}</dd>`).join('')}</dl>
      </div>`;
  }
  const filter = f.review && ['none', ...FORM_MARKS.map(m => m[0])].includes(view.filter) ? view.filter : 'all';
  const shown = listed.filter(r => filter === 'all' || (marks[r.uid] || 'none') === filter);
  const chips = f.review ? `<div class="chip-row forms-filter" role="group" aria-label="Show">${[['all', 'All'], ['none', 'Not sorted yet'], ...FORM_MARKS].map(([k, label]) => {
    const count = k === 'all' ? listed.length : listed.filter(r => (marks[r.uid] || 'none') === k).length;
    return `<button type="button" class="chip" aria-pressed="${filter === k}" onclick="setFormFilter(${spArgs},'${k}')">${label}<span class="chip-count">${count}</span></button>`;
  }).join('')}</div>` : '';
  return `${chips}<div class="forms-people">${shown.map(r => `
    <button type="button" class="list-row forms-person-row" onclick="setFormPane(${spArgs},'people','${esc(r.uid)}')">
      ${formFace(f, r, 30, color)}
      <span class="row-title"><span class="sg-strong">${esc(r.label)}</span>${f.anonymous || r.member ? '' : ` ${spaceTag('weekly', 'Not a member yet')}`}<span class="row-meta forms-person-sub">${[r.email ? esc(r.email) : '', esc(sent(r))].filter(Boolean).join(' · ')}</span></span>
      ${formMarkTag(marks[r.uid])}
      ${icon('chevron-right', 14)}
    </button>`).join('') || '<p class="small muted forms-none">Nobody here yet.</p>'}</div>`;
}
// Tapping the mark an answer already has clears it.
async function setFormMark(kind, code, id, who, status) {
  const A = FORM_ADAPTERS[kind], sp = A.space(code), f = findForm(kind, code, id);
  if (!sp || !f || !f.review || !A.runs(sp, f) || !safeId(who) || !FORM_MARKS.some(m => m[0] === status)) return;
  const clear = formMarks(kind, sp, f)[who] === status;
  if (sp.local) {
    const entry = A.entry(code);
    entry.formMarks = entry.formMarks || {};
    const all = entry.formMarks[id] = entry.formMarks[id] || {};
    if (clear) delete all[who]; else all[who] = status;
    touch();
    return;
  }
  try {
    const ref = formRef(kind, code, id).collection('marks').doc(who);
    if (clear) await ref.delete(); else await ref.set({ status, by: A.me(sp), at: Date.now() });
  } catch (e) {
    diag.error('forms', 'Marking an answer failed', e);
    toast(e.code === 'permission-denied' ? (kind === 'club' ? 'Only officers can sort answers.' : 'Only whoever made this form, or the group’s owner, can sort answers.') : 'Couldn’t save that. Check your connection and try again.', 'error', 4500);
  }
}
function confirmRemoveAnswer(kind, code, id, who) {
  if (!safeId(who)) return;
  const f = findForm(kind, code, id);
  confirmDialog(`${f?.anonymous ? 'This answer' : 'Their answer'} is deleted for good${f && formFileQuestions(f).length ? ', with any file sent with it' : ''}. They can send a new one while the form is open.`, () => removeAnswer(kind, code, id, who), 'Remove', 'Remove this answer?');
}
async function removeAnswer(kind, code, id, who) {
  const A = FORM_ADAPTERS[kind], sp = A.space(code), f = findForm(kind, code, id);
  if (!sp || !f || !safeId(who)) return;
  const v = _formView[formKey(kind, code)];
  if (v) v.person = '';
  if (sp.local) {
    const entry = A.entry(code);
    if (entry.formResponses?.[id]) delete entry.formResponses[id][who];
    if (entry.formMarks?.[id]) delete entry.formMarks[id][who];
    touch(); toast('Answer removed', 'info');
    return;
  }
  try {
    await formRef(kind, code, id).collection('responses').doc(who).delete();
    await formRef(kind, code, id).collection('marks').doc(who).delete().catch(() => {});
    if (!f.anonymous) await formDeleteFiles(formCtx(kind, sp), f, who);
    toast('Answer removed', 'info');
  } catch (e) { diag.error('forms', 'Removing an answer failed', e); toast('Couldn’t remove it. Check your connection and try again.', 'error'); }
}
function downloadFormCsv(kind, code, id) {
  const sp = FORM_ADAPTERS[kind].space(code), f = findForm(kind, code, id);
  const list = sp && f ? formResponses(kind, sp, f) : null;
  if (!list?.length) return;
  const name = `${f.title} answers`.replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'form-answers';
  downloadCsv(`${name}.csv`, formCsvRows(f, list, f.review ? formMarks(kind, sp, f) : {}));
}

/* ── Sample spaces ─────────────────────────────────────────────── */
// Forms with answers, so a sample club or group shows the whole thing:
// an open interest form answered by people who aren't members, a sign-up
// still waiting for you, applications half sorted, and an anonymous
// suggestion box.
// people: [{ uid, name }] the sample's members; by: the officer who made them.
function sampleForms(kind, { name, color, people, by, byName, now = Date.now() }) {
  const D = 86400000;
  const base = { spaceKind: kind, spaceName: name, spaceColor: color, createdBy: by, createdByName: byName, updatedAt: now - D };
  const out = { forms: {}, formResponses: {}, formMarks: {} };
  const add = (tplKey, extra, answersOf, who) => {
    const f = formForSave({ ...formFromTemplate(tplKey), ...base, ...extra });
    out.forms[f.id] = f;
    out.formResponses[f.id] = Object.fromEntries(who.map((p, i) => {
      const answers = formCheckAnswers(f, answersOf(f.questions, i)).answers;
      const at = now - (i + 1) * 5 * 3600000;
      return f.anonymous
        ? [`anon${String(i).padStart(2, '0')}${f.id.slice(0, 4)}`, { anon: true, answers, at: Math.floor(at / D) * D }]
        : [p.uid, { uid: p.uid, name: p.name, member: !!p.member, ...(f.collectEmail ? { email: `${p.name.toLowerCase().replace(/[^a-z]/g, '')}@school.edu` } : {}), answers, at, updatedAt: at }];
    }));
    return f;
  };
  const pick = (q, i) => q.options[i % q.options.length];
  if (kind === 'club') {
    const visitors = ['Jada', 'Theo', 'Mina', 'Luis', 'Priya', 'Ben', 'Aiko'].map((n, i) => ({ uid: `sample-visitor-${i}`, name: n, member: false }));
    const majors = ['Biology', 'Marketing', 'Computer science', 'Nursing', 'Psychology', 'Undecided', 'Finance'];
    const notes = ['I’m a transfer, so I’m looking for people to do things with.', '', 'Can I come to a meeting before I decide?', '', 'My roommate is a member and talks about it all the time.', '', ''];
    add('interest', { status: 'open', createdAt: now - 9 * D, closesAt: null }, (qs, i) => ({ [qs[0].id]: pick(qs[0], i), [qs[1].id]: majors[i], [qs[2].id]: [pick(qs[2], i), pick(qs[2], i + 2)], [qs[3].id]: pick(qs[3], i * 2), [qs[4].id]: notes[i] }), visitors);
    add('signup', { status: 'open', title: 'Fall retreat sign-up', description: 'So we know how many seats and how much food.', createdAt: now - 2 * D, closesAt: formClosesAtFromDate(addDays(todayIso(), 6)) }, (qs, i) => ({ [qs[0].id]: pick(qs[0], i % 5 === 4 ? 2 : i % 3 === 2 ? 1 : 0), [qs[1].id]: pick(qs[1], i), [qs[2].id]: i === 1 ? 'Vegetarian' : i === 4 ? 'Peanut allergy' : '' }), people.slice(0, 8).map(p => ({ ...p, member: true })));
    const applicants = ['Camille', 'Dev', 'Noelle', 'Marcus', 'Yuki', 'Sasha'].map((n, i) => ({ uid: `sample-applicant-${i}`, name: n, member: false }));
    const whys = ['I ran the business club at my high school and I miss it.', 'I want to get better at talking to people I don’t know.', 'My advisor said this is where the internships come from.', 'I’m starting a small shop and I need people to learn from.', 'I went to your panel last spring and stayed an hour after.', 'Honestly, my friends are in it.'];
    const resume = typeof libSamplePdf === 'function' ? (n) => { const d = libSamplePdf(`${n}, résumé`, ['Education', 'Experience', 'Activities']); return { name: `${n}-resume.pdf`, size: d.size, type: 'application/pdf', url: d.dataUrl }; } : () => undefined;
    const app = add('application', { status: 'open', title: 'Spring membership application', createdAt: now - 6 * D, closesAt: formClosesAtFromDate(addDays(todayIso(), 10)) }, (qs, i) => ({ [qs[0].id]: pick(qs[0], i + 1), [qs[1].id]: majors[(i + 2) % majors.length], [qs[2].id]: whys[i], [qs[3].id]: i % 2 ? '' : 'I’m organized and I show up.', [qs[4].id]: pick(qs[4], i % 4 === 3 ? 1 : 0), [qs[5].id]: i % 3 ? '' : 'Intramural soccer', [qs[6].id]: i < 3 ? resume(applicants[i].name) : undefined }), applicants);
    out.formMarks[app.id] = { [applicants[0].uid]: 'accepted', [applicants[1].uid]: 'accepted', [applicants[3].uid]: 'waitlisted', [applicants[5].uid]: 'declined' };
    const said = ['Meetings run long. Could we end at the hour?', 'More events off campus.', 'The group chat is a lot. Maybe one for announcements only.', 'I’d come more often if meetings weren’t on Thursdays.', 'Thank you for the career panel. More of those.'];
    add('suggestions', { status: 'open', createdAt: now - 12 * D, closesAt: null }, (qs, i) => ({ [qs[0].id]: pick(qs[0], i === 1 ? 1 : i === 2 ? 3 : 0), [qs[1].id]: said[i] }), said.map((_, i) => ({ uid: `a${i}`, name: '' })));
  } else {
    add('study', { status: 'open', createdAt: now - D, closesAt: null }, (qs, i) => ({ [qs[0].id]: ['The second half of the unit, mostly.', 'Anything with graphs.', 'I’m fine on the reading, shaky on the problem sets.'][i % 3], [qs[1].id]: [pick(qs[1], i), pick(qs[1], i + 1)], [qs[2].id]: pick(qs[2], i) }), people.slice(0, 3).map(p => ({ ...p, member: true })));
  }
  return out;
}
