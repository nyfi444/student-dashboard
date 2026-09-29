/* ── Spaces: forms, writing one ────────────────────────────────────
   Pick a starting point, then the builder: a title, the questions, who
   can answer, when it closes. Loaded after js/spaces/forms.js.

   The form being written is a working copy in window._formDraft
   ({ kind, code, form, isNew, dirty }); nothing is saved until Save draft
   or Open for answers. Typing writes straight into the copy (fbSet,
   fbQ, fbOpt); adding, removing, moving or retyping a question redraws
   the builder from it (fbDraw), which is why every field reads its value
   from the copy. Closing the sheet by accident keeps the copy, and a
   toast offers the way back.

   openFormPicker(kind, code)              the starting points
   startForm(kind, code, templateKey)      a new draft from one
   openFormBuilder(kind, code, id, opts)   edit a saved form
──────────────────────────────────────────────────────────────── */
function openFormPicker(kind, code) {
  const A = FORM_ADAPTERS[kind], sp = A.space(code);
  if (!sp || !A.canMake(sp)) return;
  if (!sp.local && !cloudGroupsEnabled()) { toast('Log in to make a form.', 'error'); return; }
  if (spaceForms(kind, sp).length >= FORM_PER_SPACE_MAX) { toast(`${sp.name} already has ${FORM_PER_SPACE_MAX} forms. Delete an old one first.`, 'error', 5000); return; }
  openModal(`
    <div class="modal-head"><h3>New form</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body space" style="${spaceVars(A.color(sp))}">
      <p class="small muted mb-16">Start from one of these and change anything. Every question can be edited, moved or removed.</p>
      <div class="fb-picker">${formTemplatesFor(kind).map(t => `
        <button type="button" class="fb-pick" onclick="startForm(${formArgs(kind, code)},'${t.key}')">
          <span class="fb-pick-ic" aria-hidden="true">${icon(t.icon, 18)}</span>
          <span class="fb-pick-text"><span class="fb-pick-name">${esc(t.name)}</span><span class="fb-pick-line">${esc(t.line)}${t.questions.length ? ` · ${t.questions.length} questions` : ''}</span></span>
        </button>`).join('')}
      </div>
    </div>
  `);
}
function startForm(kind, code, key) {
  const A = FORM_ADAPTERS[kind], sp = A.space(code);
  if (!sp || !A.canMake(sp)) return;
  const now = Date.now();
  const form = { ...formFromTemplate(key), spaceKind: kind, spaceName: sp.name, spaceColor: A.color(sp), createdBy: A.me(sp), createdByName: myGroupName(), createdAt: now, updatedAt: now };
  if (!form.questions.length) form.questions = [formNewQuestion('short')];
  window._formDraft = { kind, code, form, isNew: true, dirty: key !== 'blank' };
  fbOpen();
}
function openFormBuilder(kind, code, id, opts = {}) {
  const A = FORM_ADAPTERS[kind], sp = A.space(code), f = findForm(kind, code, id);
  if (!sp || !f || !A.runs(sp, f)) return;
  // An unsaved copy of this same form wins over the saved one.
  const kept = window._formDraft;
  if (!(kept && kept.dirty && kept.kind === kind && kept.code === code && kept.form.id === id)) {
    window._formDraft = { kind, code, form: { ...f, questions: f.questions.map(q => ({ ...q, options: [...q.options] })) }, isNew: false, dirty: false };
  }
  fbOpen(opts);
}

/* ── The sheet ─────────────────────────────────────────────────── */
function fbOpen({ focus = '' } = {}) {
  const d = window._formDraft;
  const A = FORM_ADAPTERS[d.kind], sp = A.space(d.code);
  if (!sp) return;
  const live = d.form.status !== 'draft';
  openModal(`
    <div class="modal-head"><h3>${d.isNew ? 'New form' : 'Edit form'}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body fb space" id="fb-body" style="${spaceVars(A.color(sp))}"></div>
    <div class="modal-foot fb-foot">
      <button class="btn btn-ghost fb-preview" onclick="fbPreview()">${icon('eye', 14)}Preview</button>
      <span class="fb-foot-gap"></span>
      ${live ? `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="fb-save" onclick="fbSave(this,'${d.form.status}')">Save</button>`
        : `<button class="btn" id="fb-draft" onclick="fbSave(this,'draft')">Save draft</button><button class="btn btn-primary" id="fb-save" onclick="fbSave(this,'open')">Open for answers</button>`}
    </div>
  `, { wide: true, onClose: fbClosed });
  fbDraw();
  if (focus === 'audience') setTimeout(() => { const el = $('#fb-audience button.active'); el?.scrollIntoView({ block: 'center' }); el?.focus({ preventScroll: true }); }, 60);
}
// Runs whenever the sheet closes. A copy with unsaved typing is kept.
function fbClosed() {
  const d = window._formDraft;
  if (!d || !d.dirty || d.previewing) return;
  toast('Your changes are kept until you leave this page.', 'info', 6000, { label: 'Keep editing', run: () => fbOpen() });
}
function fbQuestionHtml(q, i, n) {
  const opts = formHasOptions(q.type);
  return `
    <div class="fb-q" data-fb-q="${i}">
      <div class="fb-q-head">
        <span class="fb-q-num" aria-hidden="true">${i + 1}</span>
        <div class="fb-q-main">
          <input class="input fb-q-label" id="fb-q-${i}-label" maxlength="${FORM_LABEL_MAX}" value="${esc(q.label)}" placeholder="Your question" aria-label="Question ${i + 1}" oninput="fbQ(${i},'label',this.value)">
          <select class="select fb-q-type" aria-label="Kind of answer for question ${i + 1}" onchange="fbType(${i},this.value)">${FORM_TYPES.map(([k, label]) => `<option value="${k}"${q.type === k ? ' selected' : ''}>${label}</option>`).join('')}</select>
        </div>
      </div>
      ${opts ? `<div class="fb-opts">${q.options.map((o, j) => `
        <div class="fb-opt">
          <span class="fb-opt-mark is-${q.type}" aria-hidden="true"></span>
          <input class="input" id="fb-q-${i}-opt-${j}" maxlength="${FORM_OPTION_MAX}" value="${esc(o)}" placeholder="Choice ${j + 1}" aria-label="Choice ${j + 1} for question ${i + 1}" oninput="fbOpt(${i},${j},this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();fbAddOpt(${i})}">
          <button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label="Remove choice ${j + 1}" ${q.options.length <= 2 ? 'disabled ' : ''}onclick="fbRemoveOpt(${i},${j})">${icon('x', 14)}</button>
        </div>`).join('')}
        ${q.options.length < FORM_OPTIONS_MAX ? `<button type="button" class="sg-link fb-add-opt" onclick="fbAddOpt(${i})">${icon('plus', 12)} Add a choice</button>` : ''}
      </div>` : ''}
      ${q.type === 'scale' ? '<div class="fb-scale-note small muted">People pick a number from 1 to 5. Say what the ends mean in the note below.</div>' : ''}
      <input class="input fb-q-help" maxlength="${FORM_HELP_MAX}" value="${esc(q.help)}" placeholder="A note under the question (optional)" aria-label="Note under question ${i + 1}" oninput="fbQ(${i},'help',this.value)">
      <div class="fb-q-foot">
        <label class="checkbox-row"><input type="checkbox"${q.required ? ' checked' : ''} onchange="fbQ(${i},'required',this.checked)"> Needs an answer</label>
        <span class="fb-foot-gap"></span>
        <button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label="Move question ${i + 1} up" ${i === 0 ? 'disabled ' : ''}onclick="fbMove(${i},-1)">${icon('chevron-left', 14)}</button>
        <button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label="Move question ${i + 1} down" ${i === n - 1 ? 'disabled ' : ''}onclick="fbMove(${i},1)">${icon('chevron-right', 14)}</button>
        <button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label="Copy question ${i + 1}" onclick="fbCopy(${i})">${icon('copy', 14)}</button>
        <button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label="Remove question ${i + 1}" onclick="fbRemove(${i})">${icon('trash', 14)}</button>
      </div>
    </div>`;
}
function fbDraw() {
  const d = window._formDraft, body = $('#fb-body');
  if (!d || !body) return;
  const f = d.form, n = f.questions.length;
  const A = FORM_ADAPTERS[d.kind], sp = A.space(d.code);
  const noun = d.kind === 'group' ? 'group' : 'club';
  body.innerHTML = `
    <div class="fb-top">
      <input class="input fb-title" id="fb-title" maxlength="${FORM_TITLE_MAX}" value="${esc(f.title)}" placeholder="Form title" aria-label="Form title" oninput="fbSet('title',this.value)">
      <textarea class="input fb-desc" id="fb-desc" rows="2" maxlength="${FORM_DESC_MAX}" placeholder="A line or two about what this is for (optional)" aria-label="Description" oninput="fbSet('description',this.value)">${esc(f.description)}</textarea>
    </div>
    ${!d.isNew && f.status !== 'draft' ? `<div class="sg-callout mb-16">${icon('info', 16)}<div class="small">This form is already out. Rewording a question is fine; removing one hides the answers it already has.</div></div>` : ''}
    <div class="fb-questions">${f.questions.map((q, i) => fbQuestionHtml(q, i, n)).join('')}</div>
    ${n < FORM_QUESTIONS_MAX ? `<button type="button" class="btn fb-add" onclick="fbAdd()">${icon('plus', 14)}Add a question</button>` : `<p class="small muted">A form holds up to ${FORM_QUESTIONS_MAX} questions.</p>`}
    <div class="fb-settings">
      <h4 class="fb-h">Who can answer</h4>
      <div class="segmented" id="fb-audience" role="group" aria-label="Who can answer">
        <button type="button" class="${f.audience === 'members' ? 'active' : ''}" aria-pressed="${f.audience === 'members'}" onclick="fbAudience('members')">${icon('users', 12)} Members only</button>
        <button type="button" class="${f.audience === 'link' ? 'active' : ''}" aria-pressed="${f.audience === 'link'}" onclick="fbAudience('link')">${icon('link', 12)} Anyone with the link</button>
      </div>
      <p class="small muted fb-audience-note">${f.audience === 'link'
        ? `For interest forms and applications. People who aren’t in ${esc(sp?.name || `the ${noun}`)} open the link and sign in with a free Semester HQ account to answer. They don’t join the ${noun} or see anything else in it.`
        : `Only people in ${esc(sp?.name || `the ${noun}`)} can open and answer it.`}</p>
      <label class="checkbox-row"><input type="checkbox"${f.collectEmail ? ' checked' : ''} onchange="fbSet('collectEmail',this.checked)"> Include each person’s email with their answer</label>
      <label class="checkbox-row"><input type="checkbox"${f.allowEdit ? ' checked' : ''} onchange="fbSet('allowEdit',this.checked)"> Let people change their answer while the form is open</label>
      <div class="field fb-closes"><label for="fb-closes">Stop taking answers after <span class="muted">(optional)</span></label>
        <div class="fb-closes-row"><input class="input" type="date" id="fb-closes" value="${esc(formClosesDate(f))}" min="${todayIso()}" onchange="fbCloses(this.value)">${f.closesAt ? `<button type="button" class="sg-link" onclick="fbCloses('')">No closing day</button>` : ''}</div>
      </div>
    </div>`;
}
function fbTouch() { const d = window._formDraft; if (d) d.dirty = true; }
function fbSet(field, value) { const d = window._formDraft; if (!d) return; d.form[field] = value; fbTouch(); }
function fbQ(i, field, value) { const q = window._formDraft?.form.questions[i]; if (!q) return; q[field] = value; fbTouch(); }
function fbOpt(i, j, value) { const q = window._formDraft?.form.questions[i]; if (!q) return; q.options[j] = value; fbTouch(); }
function fbFocus(sel) { setTimeout(() => { const el = $(sel); if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }); } }, 0); }
function fbType(i, type) {
  const q = window._formDraft?.form.questions[i];
  if (!q) return;
  q.type = type;
  if (formHasOptions(type)) { if (q.options.length < 2) q.options = [...q.options, '', ''].slice(0, 2); } else q.options = [];
  fbTouch(); fbDraw();
  fbFocus(formHasOptions(type) && !q.options[0] ? `#fb-q-${i}-opt-0` : `#fb-q-${i}-label`);
}
function fbAudience(audience) {
  const d = window._formDraft;
  if (!d) return;
  d.form.audience = audience;
  // Someone outside the space can only be reached by email, so a link
  // form starts with it on; it can still be switched off.
  if (audience === 'link') d.form.collectEmail = true;
  fbTouch(); fbDraw();
  fbFocus('#fb-audience button.active');
}
function fbCloses(dateIso) { fbSet('closesAt', formClosesAtFromDate(dateIso)); fbDraw(); }
function fbAdd() {
  const d = window._formDraft;
  if (!d || d.form.questions.length >= FORM_QUESTIONS_MAX) return;
  d.form.questions.push(formNewQuestion('short'));
  fbTouch(); fbDraw();
  fbFocus(`#fb-q-${d.form.questions.length - 1}-label`);
}
function fbRemove(i) {
  const d = window._formDraft;
  if (!d || !d.form.questions[i]) return;
  d.form.questions.splice(i, 1);
  fbTouch(); fbDraw();
  fbFocus(d.form.questions.length ? `#fb-q-${Math.min(i, d.form.questions.length - 1)}-label` : '.fb-add');
}
function fbMove(i, by) {
  const qs = window._formDraft?.form.questions, j = i + by;
  if (!qs || j < 0 || j >= qs.length) return;
  [qs[i], qs[j]] = [qs[j], qs[i]];
  fbTouch(); fbDraw();
  fbFocus(`#fb-q-${j}-label`);
}
function fbCopy(i) {
  const d = window._formDraft, q = d?.form.questions[i];
  if (!q || d.form.questions.length >= FORM_QUESTIONS_MAX) return;
  d.form.questions.splice(i + 1, 0, { ...q, id: uid(), options: [...q.options] });
  fbTouch(); fbDraw();
  fbFocus(`#fb-q-${i + 1}-label`);
}
function fbAddOpt(i) {
  const q = window._formDraft?.form.questions[i];
  if (!q || q.options.length >= FORM_OPTIONS_MAX) return;
  q.options.push('');
  fbTouch(); fbDraw();
  fbFocus(`#fb-q-${i}-opt-${q.options.length - 1}`);
}
function fbRemoveOpt(i, j) {
  const q = window._formDraft?.form.questions[i];
  if (!q || q.options.length <= 2) return;
  q.options.splice(j, 1);
  fbTouch(); fbDraw();
  fbFocus(`#fb-q-${i}-opt-${Math.min(j, q.options.length - 1)}`);
}

/* ── Preview and save ──────────────────────────────────────────── */
function fbPreview() {
  const d = window._formDraft;
  const f = formClean({ ...d.form, title: d.form.title || 'Untitled form' });
  const A = FORM_ADAPTERS[d.kind], sp = A.space(d.code);
  if (!f || !sp) return;
  d.previewing = true;
  openModal(`
    <div class="modal-head"><h3>${esc(f.title)}</h3><button class="close-x" aria-label="Back to editing" onclick="fbBack()">${icon('x', 16)}</button></div>
    <div class="modal-body form-fill space" style="${spaceVars(A.color(sp))}">
      <div class="form-fill-from">${esc(sp.name)} · Preview, nothing is sent</div>
      ${f.questions.length ? formFillHtml(f, { who: formWho(d.kind, sp), runners: A.runners(sp, f) }) : '<p class="small muted">No questions yet.</p>'}
    </div>
    <div class="modal-foot"><button class="btn btn-primary" onclick="fbBack()">Back to editing</button></div>
  `, { wide: true, onClose: () => { if (window._formDraft?.previewing) setTimeout(fbBack, 0); } });
}
function fbBack() { const d = window._formDraft; if (!d) return; d.previewing = false; fbOpen(); }
async function fbSave(btn, status) {
  const d = window._formDraft;
  if (!d) return;
  const f = d.form;
  const title = formStr(f.title, FORM_TITLE_MAX);
  if (!title) { toast('Give the form a title.', 'error'); fbFocus('#fb-title'); return; }
  // Choices left blank are dropped; a question left blank stops an open form.
  const form = { ...f, title, status, questions: f.questions.map(q => ({ ...q, options: q.options.filter(o => formStr(o, FORM_OPTION_MAX)) })) };
  if (status === 'open') {
    const problem = formPublishProblem(form);
    if (problem) {
      toast(problem, 'error', 4500);
      const at = /^Question (\d+)/.exec(problem);
      if (at) fbFocus(`#fb-q-${Number(at[1]) - 1}-label`);
      return;
    }
    if (form.closesAt && form.closesAt < Date.now()) { toast('The closing day has passed. Pick a later one, or clear it.', 'error', 4500); fbFocus('#fb-closes'); return; }
  } else if (status === 'draft') {
    form.questions = form.questions.filter(q => formStr(q.label, FORM_LABEL_MAX) || q.options.length);
  }
  setBtnLoading(btn, true);
  const ok = await saveForm(d.kind, d.code, form);
  setBtnLoading(btn, false);
  if (!ok) return;
  const wasNew = d.isNew, wasDraft = f.status === 'draft';
  window._formDraft = null;
  closeModal();
  if (status === 'open' && (wasNew || wasDraft)) { toast('Your form is open', 'success'); openFormShare(d.kind, d.code, form.id); }
  else toast(status === 'draft' ? 'Draft saved' : 'Saved', 'success');
}
