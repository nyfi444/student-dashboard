/* ── Spaces: forms, filling one in ─────────────────────────────────
   The questions as fields, reading the answers back out of the page,
   and showing which ones still need an answer. Drawn the same way in
   the app's own sheet (js/spaces/forms.js) and on the standalone page
   people without a plan use (form.html, js/form-page.js), so it needs
   only esc, icon and $ / $$ (js/utils.js, js/icons.js) and
   js/spaces/formcore.js.

   formFillHtml(form, { answers, who, runners, readOnly }) -> html
     answers   what to start the fields with (their earlier answer)
     who       { name, email } as it will be sent, for the line that says
               what the people running the form will see
     runners   'the officers of Chess Club', for that same line
     readOnly  show the answers, take no input
   formFillRead(root, form) -> { [question id]: raw value }
   formFillShowErrors(root, form, errors) -> focuses the first one
   Every label, option and answer is somebody's typing: escaped here.
──────────────────────────────────────────────────────────────── */
function formFieldId(q) { return `ff-${q.id}`; }
function formFieldHtml(q, value, { readOnly = false } = {}) {
  const id = formFieldId(q);
  const dis = readOnly ? ' disabled' : '';
  const described = `${q.help ? `${id}-help ` : ''}${id}-err`;
  const has = (o) => Array.isArray(value) ? value.includes(o) : value === o;
  switch (q.type) {
    case 'long':
      return `<textarea class="input ff-input" id="${id}" rows="4" maxlength="${FORM_LONG_MAX}" aria-describedby="${described}"${q.required ? ' aria-required="true"' : ''}${dis}>${esc(value || '')}</textarea>`;
    case 'choice':
    case 'checks': {
      const type = q.type === 'choice' ? 'radio' : 'checkbox';
      return `<div class="ff-options" role="${q.type === 'choice' ? 'radiogroup' : 'group'}" aria-labelledby="${id}-label" aria-describedby="${described}">${q.options.map((o, i) => `
        <label class="ff-opt"><input type="${type}" name="${id}" id="${id}-${i}" value="${esc(o)}"${has(o) ? ' checked' : ''}${dis}><span>${esc(o)}</span></label>`).join('')}
      </div>`;
    }
    case 'dropdown':
      return `<select class="select ff-input" id="${id}" aria-describedby="${described}"${q.required ? ' aria-required="true"' : ''}${dis}><option value="">Choose one</option>${q.options.map(o => `<option value="${esc(o)}"${has(o) ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    case 'scale':
      return `<div class="ff-scale" role="radiogroup" aria-labelledby="${id}-label" aria-describedby="${described}">${[1, 2, 3, 4, 5].map(n => `
        <label class="ff-scale-opt"><input type="radio" name="${id}" id="${id}-${n}" value="${n}"${Number(value) === n ? ' checked' : ''}${dis}><span>${n}</span></label>`).join('')}
      </div>`;
    case 'date':
      return `<input class="input ff-input ff-date" type="date" id="${id}" value="${esc(value || '')}" aria-describedby="${described}"${q.required ? ' aria-required="true"' : ''}${dis}>`;
    default:
      return `<input class="input ff-input" type="text" id="${id}" maxlength="${FORM_SHORT_MAX}" value="${esc(value || '')}" autocomplete="off" aria-describedby="${described}"${q.required ? ' aria-required="true"' : ''}${dis}>`;
  }
}
function formQuestionHtml(q, i, value, opts = {}) {
  const id = formFieldId(q);
  const grouped = q.type === 'choice' || q.type === 'checks' || q.type === 'scale';
  const label = `${esc(q.label || `Question ${i + 1}`)}${q.required ? ' <span class="ff-req" aria-hidden="true">*</span><span class="sr-only"> (needs an answer)</span>' : ''}`;
  return `
    <div class="ff-q" data-ff-q="${esc(q.id)}">
      ${grouped ? `<div class="ff-label" id="${id}-label">${label}</div>` : `<label class="ff-label" id="${id}-label" for="${id}">${label}</label>`}
      ${q.help ? `<div class="ff-help" id="${id}-help">${esc(q.help)}</div>` : ''}
      ${formFieldHtml(q, value, opts)}
      <div class="ff-err" id="${id}-err" role="alert" hidden></div>
    </div>`;
}
// What the people running the form will see next to the answers.
function formWhoLine(form, who, runners) {
  if (!who?.name) return '';
  const email = form.collectEmail && who.email ? ` and email (${esc(who.email)})` : '';
  return `<p class="ff-who">${icon('eye', 14)}<span>Your answers go to ${esc(runners || 'the people running this form')}, with your name (${esc(who.name)})${email}. Nobody else sees them.</span></p>`;
}
function formFillHtml(form, { answers = {}, who = null, runners = '', readOnly = false } = {}) {
  const required = form.questions.some(q => q.required);
  return `
    <div class="ff" data-ff="${esc(form.id)}">
      ${form.description ? `<p class="ff-desc">${esc(form.description).replace(/\n/g, '<br>')}</p>` : ''}
      ${form.questions.map((q, i) => formQuestionHtml(q, i, answers[q.id], { readOnly })).join('')}
      ${required && !readOnly ? '<p class="ff-note"><span class="ff-req" aria-hidden="true">*</span> needs an answer</p>' : ''}
      ${readOnly ? '' : formWhoLine(form, who, runners)}
    </div>`;
}
function formFillRead(root, form) {
  const out = {};
  form.questions.forEach(q => {
    const id = formFieldId(q);
    if (q.type === 'choice' || q.type === 'scale') {
      const el = root.querySelector(`input[name="${id}"]:checked`);
      if (el) out[q.id] = q.type === 'scale' ? Number(el.value) : el.value;
    } else if (q.type === 'checks') {
      out[q.id] = [...root.querySelectorAll(`input[name="${id}"]:checked`)].map(el => el.value);
    } else {
      const el = root.querySelector(`#${CSS.escape(id)}`);
      if (el) out[q.id] = el.value;
    }
  });
  return out;
}
function formFillShowErrors(root, form, errors) {
  let first = null;
  form.questions.forEach(q => {
    const box = root.querySelector(`[data-ff-q="${CSS.escape(q.id)}"]`);
    if (!box) return;
    const msg = errors[q.id] || '';
    const err = box.querySelector('.ff-err');
    box.classList.toggle('has-error', !!msg);
    if (err) { err.textContent = msg; err.hidden = !msg; }
    box.querySelectorAll('input, select, textarea').forEach(el => { if (msg) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid'); });
    if (msg && !first) first = box;
  });
  if (first) {
    first.scrollIntoView({ block: 'center', behavior: 'auto' });
    first.querySelector('input, select, textarea')?.focus({ preventScroll: true });
  }
  return !first;
}
