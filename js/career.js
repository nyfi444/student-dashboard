/* ── Applications: internships, jobs, scholarships ──────────────────
   A pipeline board (Saved → Applied → Interviewing → Offer → Closed)
   for everything a student applies to beyond class. Deadlines and next
   steps (an interview, an essay due) flow into the dashboard, calendar,
   and reminders like any assignment.
──────────────────────────────────────────────────────────────── */
const APP_STAGES = [['saved', 'Saved'], ['applied', 'Applied'], ['interviewing', 'Interviewing'], ['offer', 'Offer'], ['closed', 'Closed']];
const APP_TYPES = ['Internship', 'Job', 'Scholarship', 'Research', 'Fellowship', 'Grad school', 'Other'];
const APP_OUTCOMES = [['', 'Still waiting'], ['accepted', 'Accepted'], ['declined', 'I declined'], ['rejected', 'Not selected'], ['withdrew', 'Withdrew']];
const APP_CHECKLISTS = {
  Scholarship: ['Write the essay', 'Ask for a recommendation letter', 'Request transcript', 'Submit application'],
  'Grad school': ['Draft statement of purpose', 'Request recommendation letters', 'Order transcripts', 'Submit test scores', 'Submit application'],
  default: ['Tailor your resume', 'Write a cover letter', 'Submit application', 'Follow up'],
};

function applications() { return state.applications || (state.applications = []); }
function appNextDate(a) {
  const dates = [a.stage === 'saved' ? a.deadline : null, a.nextStep?.date].filter(d => d && d >= todayIso()).sort();
  return dates[0] || null;
}
function appDueItems(fromIso, toIso) {
  const out = [];
  applications().forEach(a => {
    if (a.stage === 'closed') return;
    if (a.deadline && a.stage === 'saved' && a.deadline >= fromIso && a.deadline <= toIso) out.push({ app: a, date: a.deadline, label: `Apply: ${a.org}${a.role ? ` · ${a.role}` : ''}`, kind: 'deadline' });
    if (a.nextStep?.date && a.nextStep.date >= fromIso && a.nextStep.date <= toIso) out.push({ app: a, date: a.nextStep.date, time: a.nextStep.time || '', label: `${a.nextStep.label || 'Next step'}: ${a.org}`, kind: 'step' });
  });
  return out.sort((x, y) => (x.date + (x.time || '')).localeCompare(y.date + (y.time || '')));
}
function careerItemsOnDate(dateIso) {
  return appDueItems(dateIso, dateIso).map(i => ({ id: i.app.id, title: i.label, start: i.time || null, end: null, color: '#6b6b6b', kind: 'career' }));
}

/* ── Page ──────────────────────────────────────────────────────── */
function pageCareer() {
  const all = applications();
  const typeFilter = state._careerType || 'all';
  const view = state._careerView === 'list' ? 'list' : 'board';
  const shown = all.filter(a => typeFilter === 'all' ? true : typeFilter === 'Other' ? !['Internship', 'Job', 'Scholarship'].includes(a.type) : a.type === typeFilter);
  const applied = all.filter(a => a.stage !== 'saved').length;
  const heard = all.filter(a => ['interviewing', 'offer'].includes(a.stage) || (a.stage === 'closed' && ['accepted', 'declined', 'rejected'].includes(a.outcome))).length;
  const interviews = all.filter(a => a.stage === 'interviewing' || a.reachedInterview).length;
  const offers = all.filter(a => a.stage === 'offer' || a.outcome === 'accepted' || a.outcome === 'declined').length;
  const scholarshipWon = all.filter(a => a.type === 'Scholarship' && (a.outcome === 'accepted' || a.stage === 'offer')).reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const upcoming = appDueItems(todayIso(), addDays(todayIso(), 14)).slice(0, 6);
  const overdue = all.filter(a => a.stage === 'saved' && a.deadline && a.deadline < todayIso());

  return `
    ${pageHead('Applications', 'Internships, jobs, and scholarships, all in one place', `
      ${aiButton('Paste a posting', 'openPastePostingModal()')}
      <button class="btn btn-primary" onclick="openApplicationModal()">+ Add</button>
    `)}
    ${all.length ? `
      <div class="career-stats">
        <div class="career-stat"><strong>${applied}</strong><span>Applied</span></div>
        <div class="career-stat"><strong>${applied ? Math.round((heard / applied) * 100) : 0}%</strong><span>Heard back</span></div>
        <div class="career-stat"><strong>${interviews}</strong><span>Interviews</span></div>
        <div class="career-stat"><strong>${offers}</strong><span>Offers</span></div>
        ${scholarshipWon ? `<div class="career-stat"><strong>$${scholarshipWon.toLocaleString()}</strong><span>Scholarships won</span></div>` : ''}
      </div>
      ${upcoming.length || overdue.length ? `
      <div class="card card-pad mb-16">
        <h3 class="sg-h3 mb-8">Coming up</h3>
        ${overdue.map(a => `<div class="dash-due-row" onclick="openApplicationModal('${a.id}')"><span class="career-date is-overdue">${icon('flag', 12, 2)}</span><div class="row-title"><div>Deadline passed: ${esc(a.org)}</div><div class="assign-meta"><span>${esc(a.role || a.type)}</span><span>was due ${esc(fmtSessionDay(a.deadline))}</span></div></div></div>`).join('')}
        ${upcoming.map(i => `<div class="dash-due-row" onclick="openApplicationModal('${i.app.id}')"><span class="career-date">${dateTile(i.date)}</span><div class="row-title"><div>${esc(i.label)}</div><div class="assign-meta"><span>${esc(i.app.type)}</span><span>${esc(fmtSessionDay(i.date))}${i.time ? ` · ${fmtTime(i.time)}` : ''}</span></div></div></div>`).join('')}
      </div>` : ''}
      <div class="assign-toolbar">
        <div class="chip-row">${['all', 'Internship', 'Job', 'Scholarship', 'Other'].map(t => `<button class="chip ${typeFilter === t ? 'active' : ''}" onclick="state._careerType='${t}';touch()">${t === 'all' ? 'All' : t === 'Other' ? 'Other' : t + 's'}</button>`).join('')}</div>
        <div class="segmented"><button class="${view === 'board' ? 'active' : ''}" onclick="state._careerView='board';touch()">Board</button><button class="${view === 'list' ? 'active' : ''}" onclick="state._careerView='list';touch()">List</button></div>
      </div>
      ${view === 'board' ? careerBoard(shown) : careerList(shown)}
    ` : `
      <div class="card welcome career-welcome">
        <div class="welcome-copy">
          <div class="sg-eyebrow">${icon('briefcase', 13, 1.8)} Applications</div>
          <h3 class="welcome-title">Your next move, organized.</h3>
          <p class="muted">Track every internship, job, and scholarship from saved to offer. Deadlines, interviews, and follow-ups show up on your dashboard and calendar so nothing slips.</p>
          <div class="sg-hero-actions">
            <button class="btn btn-primary" onclick="openApplicationModal()">+ Add an application</button>
            ${aiButton('Paste a job posting', 'openPastePostingModal()')}
          </div>
        </div>
        <div class="welcome-steps">
          ${[['bookmark', 'Save what you want to apply to', 'Keep the deadline, link, and what each one needs.'], ['send', 'Track where each one stands', 'Drag it from Applied to Interviewing to Offer.'], ['calendar', 'Never miss a next step', 'Interviews and deadlines land on your calendar with reminders.']].map(([ic, t, d], i) => `
            <div class="welcome-step"><span class="welcome-num">${i + 1}</span><div><div class="sg-strong">${t}</div><div class="small muted">${d}</div></div></div>`).join('')}
        </div>
      </div>`}
  `;
}
function careerBoard(list) {
  return `<div class="career-board">${APP_STAGES.map(([stage, label]) => {
    const items = list.filter(a => a.stage === stage).sort((a, b) => (appNextDate(a) || '9999').localeCompare(appNextDate(b) || '9999') || (b.updatedAt || 0) - (a.updatedAt || 0));
    return `<section class="career-col" data-stage="${stage}" ondragover="event.preventDefault();this.classList.add('drop')" ondragleave="this.classList.remove('drop')" ondrop="this.classList.remove('drop');dropApplication(event,'${stage}')">
      <div class="career-col-head"><span>${label}</span><span class="assign-count">${items.length}</span></div>
      ${items.map(careerCard).join('') || `<div class="career-col-empty">${stage === 'saved' ? 'Things you plan to apply to' : 'Drag cards here'}</div>`}
      ${stage === 'saved' ? `<button class="career-add" onclick="openApplicationModal(null,'saved')">+ Add</button>` : ''}
    </section>`;
  }).join('')}</div>`;
}
function careerCard(a) {
  const done = (a.checklist || []).filter(c => c.done).length;
  const total = (a.checklist || []).length;
  const next = a.stage === 'saved' && a.deadline ? { label: 'Deadline', date: a.deadline } : a.nextStep?.date ? a.nextStep : null;
  const overdue = next && next.date < todayIso();
  return `<article class="career-card" draggable="true" ondragstart="event.dataTransfer.setData('text/plain','${a.id}')" onclick="openApplicationModal('${a.id}')">
    <div class="career-card-top"><span class="career-type">${esc(a.type)}</span>${a.stage === 'closed' && a.outcome ? `<span class="career-outcome">${esc((APP_OUTCOMES.find(o => o[0] === a.outcome) || [])[1] || '')}</span>` : ''}</div>
    <div class="career-org">${esc(a.org || 'Untitled')}</div>
    ${a.role ? `<div class="small muted">${esc(a.role)}${a.amount && a.type === 'Scholarship' ? ` · $${Number(a.amount).toLocaleString()}` : ''}</div>` : a.amount ? `<div class="small muted">$${Number(a.amount).toLocaleString()}</div>` : ''}
    ${next ? `<div class="career-next ${overdue ? 'sg-overdue' : ''}">${icon('calendar', 11, 1.8)} ${esc(next.label || 'Next step')} · ${esc(fmtSessionDay(next.date))}</div>` : ''}
    ${total ? `<div class="career-progress" title="${done} of ${total} done"><div class="progress"><div style="width:${(done / total) * 100}%"></div></div><span>${done}/${total}</span></div>` : ''}
    <select class="select career-stage-select" aria-label="Stage for ${esc(a.org)}" onclick="event.stopPropagation()" onchange="setApplicationStage('${a.id}',this.value)">${APP_STAGES.map(([s, l]) => `<option value="${s}" ${s === a.stage ? 'selected' : ''}>${l}</option>`).join('')}</select>
  </article>`;
}
function careerList(list) {
  const rows = [...list].sort((a, b) => (appNextDate(a) || '9999').localeCompare(appNextDate(b) || '9999'));
  if (!rows.length) return emptyState(icon('briefcase', 24, 1.4), 'Nothing here yet');
  return `<div class="card assign-list">${rows.map(a => {
    const next = appNextDate(a);
    return `<div class="assign-row" onclick="openApplicationModal('${a.id}')">
      <div class="assign-main"><div class="assign-title">${esc(a.org)}${a.role ? ` <span class="muted">· ${esc(a.role)}</span>` : ''}</div>
      <div class="assign-meta"><span>${esc(a.type)}</span><span class="assign-status">${esc((APP_STAGES.find(s => s[0] === a.stage) || [])[1])}</span>${a.location ? `<span>${esc(a.location)}</span>` : ''}</div></div>
      <div class="assign-due">${next ? esc(fmtSessionDay(next)) : '<span class="muted">No date</span>'}</div>
    </div>`;
  }).join('')}</div>`;
}
function dropApplication(ev, stage) {
  ev.preventDefault();
  const id = ev.dataTransfer.getData('text/plain');
  if (id) setApplicationStage(id, stage);
}
function setApplicationStage(id, stage) {
  const a = applications().find(x => x.id === id);
  if (!a || a.stage === stage) return;
  a.stage = stage;
  if (stage !== 'saved' && !a.appliedOn) a.appliedOn = todayIso();
  if (stage === 'interviewing') a.reachedInterview = true;
  a.updatedAt = Date.now();
  touch();
  if (stage === 'offer') { playUiSound('success'); toast(`An offer from ${a.org}. Congratulations!`, 'success', 4000); }
  else playUiSound('tap');
}

/* ── Editor ────────────────────────────────────────────────────── */
function openApplicationModal(id, presetStage, prefill = {}) {
  const existing = id ? applications().find(x => x.id === id) : null;
  const type = prefill.type && APP_TYPES.includes(prefill.type) ? prefill.type : 'Internship';
  const draft = existing ? JSON.parse(JSON.stringify(existing)) : {
    id: uid(), type, org: prefill.org || '', role: prefill.role || '', location: prefill.location || '', link: prefill.link || '',
    stage: presetStage || 'saved', deadline: prefill.deadline || '', appliedOn: '', nextStep: { label: '', date: '', time: '' }, amount: prefill.amount || '',
    notes: prefill.notes || '', contacts: [], outcome: '',
    checklist: (prefill.checklist && prefill.checklist.length ? prefill.checklist : (APP_CHECKLISTS[type] || APP_CHECKLISTS.default)).map(text => ({ id: uid(), text, done: false })),
    createdAt: Date.now(),
  };
  draft.nextStep = draft.nextStep || { label: '', date: '', time: '' };
  draft.contacts = draft.contacts || [];
  window._appDraft = draft;
  window._appDraftExisting = !!existing;
  renderApplicationModal();
}
function renderApplicationModal() {
  const d = window._appDraft;
  const existing = window._appDraftExisting;
  openModal(`
    <div class="modal-head"><h3>${existing ? esc(d.org || 'Application') : 'New application'}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="field-row">
        <div class="field"><label for="ap-org">${d.type === 'Scholarship' ? 'Scholarship' : 'Company or organization'}</label><input class="input" id="ap-org" value="${esc(d.org)}" maxlength="120" placeholder="${d.type === 'Scholarship' ? 'Gates Scholarship' : 'Google'}" oninput="_appDraft.org=this.value"></div>
        <div class="field"><label for="ap-type">Type</label><select class="select" id="ap-type" onchange="changeApplicationType(this.value)">${APP_TYPES.map(t => `<option ${t === d.type ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="ap-role">${d.type === 'Scholarship' ? 'Details' : 'Role'}</label><input class="input" id="ap-role" value="${esc(d.role)}" maxlength="120" placeholder="${d.type === 'Scholarship' ? 'Merit award, STEM majors' : 'Software engineering intern'}" oninput="_appDraft.role=this.value"></div>
        ${d.type === 'Scholarship'
          ? `<div class="field"><label for="ap-amount">Amount ($)</label><input class="input" id="ap-amount" type="number" min="0" value="${esc(d.amount)}" oninput="_appDraft.amount=this.value"></div>`
          : `<div class="field"><label for="ap-loc">Location</label><input class="input" id="ap-loc" value="${esc(d.location)}" maxlength="80" placeholder="Remote, New York…" oninput="_appDraft.location=this.value"></div>`}
      </div>
      <div class="field-row">
        <div class="field"><label for="ap-stage">Stage</label><select class="select" id="ap-stage" onchange="_appDraft.stage=this.value;renderApplicationModal()">${APP_STAGES.map(([s, l]) => `<option value="${s}" ${s === d.stage ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="ap-deadline">Application deadline</label><input class="input" id="ap-deadline" type="date" value="${esc(d.deadline)}" oninput="_appDraft.deadline=this.value"></div>
        ${d.stage !== 'saved' ? `<div class="field"><label for="ap-applied">Applied on</label><input class="input" id="ap-applied" type="date" value="${esc(d.appliedOn)}" oninput="_appDraft.appliedOn=this.value"></div>` : ''}
      </div>
      ${d.stage === 'closed' ? `<div class="field"><label for="ap-outcome">How it ended</label><select class="select" id="ap-outcome" onchange="_appDraft.outcome=this.value">${APP_OUTCOMES.map(([v, l]) => `<option value="${v}" ${v === d.outcome ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}
      <div class="field"><label>Next step</label>
        <div class="career-next-row">
          <input class="input" value="${esc(d.nextStep.label)}" maxlength="80" placeholder="Phone screen, final interview, essay due…" aria-label="Next step" oninput="_appDraft.nextStep.label=this.value">
          <input class="input" type="date" value="${esc(d.nextStep.date)}" aria-label="Next step date" oninput="_appDraft.nextStep.date=this.value">
          <input class="input" type="time" value="${esc(d.nextStep.time || '')}" aria-label="Next step time" oninput="_appDraft.nextStep.time=this.value">
        </div>
      </div>
      <div class="field"><label for="ap-link">Link</label><input class="input" id="ap-link" type="url" value="${esc(d.link)}" placeholder="https://…" oninput="_appDraft.link=this.value">${isHttpUrl(d.link) ? `<a class="small mt-8" href="${esc(d.link)}" target="_blank" rel="noopener noreferrer">Open posting ↗</a>` : ''}</div>
      <div class="field"><label>Checklist</label>
        ${d.checklist.map((c, i) => `
          <div class="career-check">
            <button type="button" class="row-check ${c.done ? 'checked' : ''}" role="checkbox" aria-checked="${c.done}" aria-label="Mark ${esc(c.text)} ${c.done ? 'not done' : 'done'}" onclick="_appDraft.checklist[${i}].done=!_appDraft.checklist[${i}].done;renderApplicationModal()">${c.done ? checkGlyph(true) : ''}</button>
            <input class="input" value="${esc(c.text)}" aria-label="Checklist item" oninput="_appDraft.checklist[${i}].text=this.value">
            <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove item" onclick="_appDraft.checklist.splice(${i},1);renderApplicationModal()">${icon('x', 12, 2.2)}</button>
          </div>`).join('')}
        <button class="sg-link mt-8" onclick="_appDraft.checklist.push({id:uid(),text:'',done:false});renderApplicationModal()">+ Add item</button>
      </div>
      <div class="field"><label>Contacts</label>
        ${d.contacts.map((c, i) => `
          <div class="career-contact">
            <input class="input" value="${esc(c.name)}" placeholder="Name" aria-label="Contact name" oninput="_appDraft.contacts[${i}].name=this.value">
            <input class="input" value="${esc(c.email)}" placeholder="Email or LinkedIn" aria-label="Contact email or LinkedIn" oninput="_appDraft.contacts[${i}].email=this.value">
            <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove contact" onclick="_appDraft.contacts.splice(${i},1);renderApplicationModal()">${icon('x', 12, 2.2)}</button>
          </div>`).join('')}
        <button class="sg-link mt-8" onclick="_appDraft.contacts.push({name:'',email:''});renderApplicationModal()">+ Add a recruiter or contact</button>
      </div>
      <div class="field" style="margin-bottom:0"><label for="ap-notes">Notes</label><textarea class="input" id="ap-notes" placeholder="Interview questions, salary, what to follow up on…" oninput="_appDraft.notes=this.value">${esc(d.notes)}</textarea></div>
    </div>
    <div class="modal-foot">
      ${existing ? `<button class="btn btn-danger" style="margin-right:auto" onclick="deleteApplication('${d.id}')">Delete</button>` : ''}
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveApplication()">Save</button>
    </div>
  `, { wide: true });
}
function changeApplicationType(type) {
  const d = window._appDraft;
  const untouched = d.checklist.every(c => !c.done) && JSON.stringify(d.checklist.map(c => c.text)) === JSON.stringify(APP_CHECKLISTS[d.type] || APP_CHECKLISTS.default);
  d.type = type;
  if (untouched) d.checklist = (APP_CHECKLISTS[type] || APP_CHECKLISTS.default).map(text => ({ id: uid(), text, done: false }));
  renderApplicationModal();
}
function saveApplication() {
  const d = window._appDraft;
  d.org = d.org.trim();
  if (!d.org) { toast(d.type === 'Scholarship' ? 'Name the scholarship' : 'Add the company or organization', 'error'); return; }
  d.checklist = d.checklist.filter(c => c.text.trim());
  d.contacts = d.contacts.filter(c => (c.name || '').trim() || (c.email || '').trim());
  if (d.stage !== 'saved' && !d.appliedOn) d.appliedOn = todayIso();
  if (d.stage === 'interviewing') d.reachedInterview = true;
  d.updatedAt = Date.now();
  const list = applications();
  const i = list.findIndex(x => x.id === d.id);
  if (i >= 0) list[i] = d; else list.push(d);
  closeModal();
  touch();
  toast(i >= 0 ? 'Saved' : `Added ${d.org}`);
}
function deleteApplication(id) {
  confirmDialog('Delete this application? You can restore it from Recently Deleted for 30 days.', () => {
    const a = applications().find(x => x.id === id);
    if (a) trashItem('application', a.org || 'Application', a);
    state.applications = applications().filter(x => x.id !== id);
    touch();
  });
}

/* ── Paste a posting: pull the details out automatically ───────── */
const POSTING_SYSTEM = `You extract the key details from a job, internship, or scholarship posting. Reply with ONLY a JSON object (no prose, no markdown fences):
{"org": string, "role": string, "type": "Internship"|"Job"|"Scholarship"|"Research"|"Fellowship"|"Grad school"|"Other", "location": string, "deadline": "YYYY-MM-DD or empty string", "amount": number|null, "link": string, "checklist": [string]}
checklist: 2 to 6 short action items the applicant needs to do based on the posting's requirements (for example "Write 500-word essay", "Submit transcript"). Use empty strings for anything not stated. Infer the nearest upcoming year when only a month and day are given. Do not invent details.`;
function openPastePostingModal() {
  if (!requireAi('Filling in an application from a posting')) return;
  openModal(`
    <div class="modal-head"><h3>Paste a posting <span class="ai-badge">AI</span></h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <p class="small muted mb-8">Copy the text of a job, internship, or scholarship posting and paste it here. Semester HQ fills in the company, role, deadline, and a checklist of what you need.</p>
      <textarea class="input" id="pp-text" style="min-height:200px" placeholder="Paste the posting text"></textarea>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="pp-go" onclick="runPastePosting()">${icon('sparkles', 13, 1.5)} Fill it in</button></div>
  `, { wide: true });
}
async function runPastePosting() {
  const text = $('#pp-text').value.trim();
  if (text.length < 40) { toast('Paste a bit more of the posting', 'error'); return; }
  const btn = $('#pp-go');
  setBtnLoading(btn, true);
  try {
    const raw = await callClaude({ system: POSTING_SYSTEM, userContent: `Today is ${todayIso()}.\n\nPosting:\n${text.slice(0, 12000)}`, maxTokens: 1200 });
    const p = extractJson(raw);
    openApplicationModal(null, 'saved', {
      org: String(p.org || '').slice(0, 120), role: String(p.role || '').slice(0, 120), type: p.type, location: String(p.location || '').slice(0, 80),
      deadline: /^\d{4}-\d{2}-\d{2}$/.test(p.deadline || '') ? p.deadline : '', amount: Number(p.amount) || '', link: isHttpUrl(p.link) ? p.link : '',
      checklist: Array.isArray(p.checklist) ? p.checklist.map(x => String(x).slice(0, 100)).filter(Boolean).slice(0, 8) : null,
    });
  } catch (e) {
    setBtnLoading(btn, false);
    toast(e.message || 'Couldn’t read that posting', 'error', 5000);
  }
}
