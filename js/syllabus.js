/* ── Syllabus details on each class page ──────────────────────────
   The things students dig through the syllabus PDF for all semester:
   how to reach the professor, when office hours are, how many classes
   you can miss, and what happens if something's late. Filled in when a
   syllabus is uploaded (see SYLLABUS_SYSTEM in ai.js) and editable by
   hand. course.details holds what the syllabus says; course.absences is
   the student's own attendance log and is never shared.
──────────────────────────────────────────────────────────────── */
const DETAIL_TEXT_MAX = 600;

function cleanStr(v, max = 200) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''; }
function cleanEmail(v) { const s = cleanStr(v, 120); return /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(s) ? s : ''; }
function cleanUrl(v) { const s = cleanStr(v, 300); if (!s) return ''; const withProto = /^https?:\/\//i.test(s) ? s : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s) ? `https://${s}` : ''; return isHttpUrl(withProto) ? withProto : ''; }
function sanitizeCourseDetails(d) {
  if (!d || typeof d !== 'object') return {};
  const hours = (Array.isArray(d.officeHours) ? d.officeHours : []).filter(h => h && Number.isInteger(Number(h.day)) && Number(h.day) >= 0 && Number(h.day) <= 6 && /^\d{2}:\d{2}$/.test(h.start || ''))
    .map(h => ({ day: Number(h.day), start: h.start, end: /^\d{2}:\d{2}$/.test(h.end || '') ? h.end : addMinutesHHMM(h.start, 60), where: cleanStr(h.where, 80) })).slice(0, 10);
  const limit = d.absenceLimit === '' || d.absenceLimit == null ? null : Number(d.absenceLimit);
  const out = {
    email: cleanEmail(d.email), phone: cleanStr(d.phone, 40), office: cleanStr(d.office, 80),
    officeHours: hours, officeHoursNote: cleanStr(d.officeHoursNote, 160),
    tas: (Array.isArray(d.tas) ? d.tas : []).filter(x => x && cleanStr(x.name, 60)).map(x => ({ name: cleanStr(x.name, 60), email: cleanEmail(x.email), officeHours: cleanStr(x.officeHours, 120) })).slice(0, 6),
    absenceLimit: Number.isFinite(limit) && limit >= 0 && limit <= 60 ? Math.round(limit) : null,
    absencePolicy: cleanStr(d.absencePolicy, DETAIL_TEXT_MAX), latePolicy: cleanStr(d.latePolicy, DETAIL_TEXT_MAX),
    policies: (Array.isArray(d.policies) ? d.policies : []).filter(x => x && cleanStr(x.title, 60) && cleanStr(x.text)).map(x => ({ title: cleanStr(x.title, 60), text: cleanStr(x.text, DETAIL_TEXT_MAX) })).slice(0, 8),
    website: cleanUrl(d.website), textbook: cleanStr(d.textbook, 200),
  };
  if (d.showOfficeHours) out.showOfficeHours = true;
  return out;
}
function courseDetailsCount(d) {
  if (!d) return 0;
  return [d.email, d.phone, d.office, d.officeHours?.length, d.officeHoursNote, d.tas?.length, d.absenceLimit != null, d.absencePolicy, d.latePolicy, d.policies?.length, d.website, d.textbook].filter(Boolean).length;
}
function courseAbsences(c) { return (c.absences || []).filter(a => a && /^\d{4}-\d{2}-\d{2}$/.test(a.date)).sort((a, b) => b.date.localeCompare(a.date)); }
function countedAbsences(c) { return courseAbsences(c).filter(a => !a.excused).length; }

// The next office hours from now, within the next week.
function nextOfficeHours(c, from = new Date()) {
  const hours = c.details?.officeHours || [];
  if (!hours.length) return null;
  const nowMin = from.getHours() * 60 + from.getMinutes();
  for (let i = 0; i < 8; i++) {
    const dIso = addDays(todayIso(), i);
    if (isBreakDate(dIso)) continue;
    const dow = new Date(dIso + 'T00:00:00').getDay();
    const h = hours.filter(x => x.day === dow && (i > 0 || toMin(x.end) > nowMin)).sort((a, b) => a.start.localeCompare(b.start))[0];
    if (h) return { ...h, date: dIso, now: i === 0 && toMin(h.start) <= nowMin };
  }
  return null;
}
function officeHoursOnDate(dateIso) {
  if (isBreakDate(dateIso)) return [];
  const sem = currentSemester();
  if (sem && (dateIso < sem.startDate || dateIso > sem.endDate)) return [];
  const dow = new Date(dateIso + 'T00:00:00').getDay();
  return activeCourses().filter(c => c.details?.showOfficeHours).flatMap(c => (c.details.officeHours || []).filter(h => h.day === dow).map(h => ({
    id: `oh-${c.id}-${h.day}-${h.start}`, title: `${c.code || c.name} office hours`, start: h.start, end: h.end, color: c.color, kind: 'office', courseId: c.id,
  })));
}

/* ── Class page card ───────────────────────────────────────────── */
function syllabusCard(c) {
  const d = c.details || {};
  const has = courseDetailsCount(d) > 0;
  const absences = courseAbsences(c);
  const used = countedAbsences(c);
  const limit = d.absenceLimit;
  const next = nextOfficeHours(c);
  if (!has && !absences.length) {
    return `
      <div class="card card-pad syl-card syl-empty">
        <div class="flex-between mb-8"><h3 class="sg-h3">Syllabus</h3></div>
        <p class="small muted">Office hours, how to reach ${c.instructor ? esc(c.instructor) : 'your professor'}, the attendance rule, and the late policy, right here instead of buried in a PDF.</p>
        <div class="flex-gap wrap mt-8">
          ${aiButton('Upload syllabus', `openSyllabusUploadModal('${c.id}')`)}
          <button class="btn btn-sm" onclick="openCourseDetailsModal('${c.id}')">Add by hand</button>
          <button class="btn btn-sm" onclick="openAbsenceModal('${c.id}')">${icon('calendar', 12, 1.8)} Log an absence</button>
        </div>
      </div>`;
  }
  const contact = [
    d.email ? `<a class="btn btn-sm" href="mailto:${esc(d.email)}?subject=${encodeURIComponent(c.code || c.name)}">${icon('send', 12, 1.8)} Email</a>` : '',
    d.email ? `<button class="btn btn-sm btn-ghost btn-icon" aria-label="Copy email address" title="Copy ${esc(d.email)}" onclick="copyText('${esc(d.email)}','Email copied')">${icon('copy', 13, 1.8)}</button>` : '',
    d.website ? `<a class="btn btn-sm" href="${esc(d.website)}" target="_blank" rel="noopener noreferrer">${icon('link', 12, 1.8)} Course site</a>` : '',
  ].filter(Boolean).join('');
  const policyBlock = (label, iconName, text) => text ? `<div class="syl-policy"><div class="syl-label">${icon(iconName, 12, 1.9)} ${label}</div><p class="small">${esc(text)}</p></div>` : '';
  return `
    <div class="card card-pad syl-card">
      <div class="flex-between mb-8">
        <h3 class="sg-h3">Syllabus</h3>
        <div class="flex-gap">
          ${aiEnabled() ? `<button class="sg-link" onclick="openSyllabusUploadModal('${c.id}')">${has ? 'Update from syllabus' : 'Upload syllabus'}</button>` : ''}
          <button class="btn btn-ghost btn-icon btn-sm" aria-label="Edit syllabus details" title="Edit" onclick="openCourseDetailsModal('${c.id}')">${icon('pencil', 13, 1.7)}</button>
        </div>
      </div>

      ${c.instructor || d.email || d.phone || d.office ? `
      <div class="syl-prof">
        <div class="syl-prof-avatar" aria-hidden="true">${esc((c.instructor || '?').replace(/^(dr|prof|professor|mr|mrs|ms)\.?\s+/i, '').charAt(0).toUpperCase() || '?')}</div>
        <div style="min-width:0;flex:1">
          <div class="sg-strong">${esc(c.instructor || 'Instructor')}</div>
          <div class="small muted syl-lines">${[d.email ? esc(d.email) : '', d.phone ? esc(d.phone) : '', d.office ? `${icon('map-pin', 11, 1.8)} ${esc(d.office)}` : ''].filter(Boolean).join('<span aria-hidden="true"> · </span>')}</div>
        </div>
      </div>
      ${contact ? `<div class="flex-gap wrap mt-8">${contact}</div>` : ''}` : contact ? `<div class="flex-gap wrap">${contact}</div>` : ''}

      ${d.officeHours?.length || d.officeHoursNote ? `
      <div class="syl-section">
        <div class="syl-label">${icon('clock', 12, 1.9)} Office hours</div>
        ${next ? `<div class="syl-next ${next.now ? 'is-now' : ''}">${next.now ? `Happening now, until ${fmtTime(next.end)}` : `Next: ${esc(fmtSessionDay(next.date))} ${fmtTime(next.start)}`}${next.where ? ` · ${esc(next.where)}` : ''}</div>` : ''}
        ${(d.officeHours || []).slice().sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7) || a.start.localeCompare(b.start)).map(h => `<div class="sg-person"><span class="hub-day">${DOW_NAMES[h.day]}</span><div class="row-title small">${fmtTime(h.start)} – ${fmtTime(h.end)}${h.where ? ` <span class="muted">· ${esc(h.where)}</span>` : ''}</div></div>`).join('')}
        ${d.officeHoursNote ? `<div class="small muted">${esc(d.officeHoursNote)}</div>` : ''}
        ${d.officeHours?.length ? `<label class="checkbox-row small mt-8"><input type="checkbox" ${d.showOfficeHours ? 'checked' : ''} onchange="toggleOfficeHoursOnCalendar('${c.id}',this.checked)"><span>Show on my calendar</span></label>` : ''}
      </div>` : ''}

      ${d.tas?.length ? `
      <div class="syl-section">
        <div class="syl-label">${icon('users', 12, 1.9)} TA${d.tas.length === 1 ? '' : 's'}</div>
        ${d.tas.map(ta => `<div class="syl-ta"><span class="sg-strong small">${esc(ta.name)}</span>${ta.email ? ` <a class="small" href="mailto:${esc(ta.email)}">${esc(ta.email)}</a>` : ''}${ta.officeHours ? `<div class="small muted">${esc(ta.officeHours)}</div>` : ''}</div>`).join('')}
      </div>` : ''}

      <div class="syl-section">
        <div class="flex-between">
          <div class="syl-label">${icon('calendar', 12, 1.9)} Attendance</div>
          <button class="sg-link" onclick="openAbsenceModal('${c.id}')">+ Log absence</button>
        </div>
        ${limit != null ? `
          <div class="syl-absence ${used > limit ? 'is-over' : used === limit ? 'is-at' : ''}">
            <div class="syl-absence-dots" aria-hidden="true">${Array.from({ length: Math.max(limit, used) }, (_, i) => `<span class="${i < used ? (i >= limit ? 'over' : 'used') : ''}"></span>`).join('') || '<span class="none">No absences allowed</span>'}</div>
            <div class="small"><strong>${used} of ${limit}</strong> allowed absence${limit === 1 ? '' : 's'} used${used >= limit ? (used > limit ? `. You’re ${used - limit} over.` : '. That’s the limit.') : ''}</div>
          </div>` : `<div class="small muted">${used ? `${used} absence${used === 1 ? '' : 's'} logged.` : 'No absences logged.'} ${d.absencePolicy ? '' : 'Add the limit from the syllabus to track it.'}</div>`}
        ${d.absencePolicy ? `<p class="small mt-4">${esc(d.absencePolicy)}</p>` : ''}
        ${absences.length ? `<details class="syl-absence-log"><summary class="small muted">${absences.length} logged</summary>${absences.map(a => `
          <div class="sg-person"><div class="row-title small">${esc(fmtDate(a.date, { weekday: 'short', month: 'short', day: 'numeric' }))}${a.excused ? ' <span class="muted">· excused</span>' : ''}${a.note ? ` <span class="muted">· ${esc(a.note)}</span>` : ''}</div><button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove absence on ${esc(fmtDate(a.date))}" onclick="removeAbsence('${c.id}','${a.id}')">${icon('x', 12, 2.2)}</button></div>`).join('')}</details>` : ''}
      </div>

      ${policyBlock('Late work', 'clock', d.latePolicy)}
      ${d.policies?.length ? `<details class="syl-more"><summary class="small">More policies (${d.policies.length})</summary>${d.policies.map(p => policyBlock(p.title, 'file-text', p.text)).join('')}</details>` : ''}
      ${d.textbook ? `<div class="syl-section"><div class="syl-label">${icon('book-open', 12, 1.9)} Textbook</div><p class="small">${esc(d.textbook)}</p></div>` : ''}
    </div>`;
}
function toggleOfficeHoursOnCalendar(courseId, on) {
  const c = getCourse(courseId);
  if (!c) return;
  c.details = { ...(c.details || {}), showOfficeHours: !!on };
  touch();
  toast(on ? 'Office hours are on your calendar' : 'Office hours removed from your calendar');
}

/* ── Absences ──────────────────────────────────────────────────── */
function lastMeetingDate(c) {
  const days = new Set((c.meetings || []).map(m => m.day));
  if (!days.size) return todayIso();
  for (let i = 0; i < 14; i++) { const d = addDays(todayIso(), -i); if (days.has(new Date(d + 'T00:00:00').getDay()) && !isBreakDate(d)) return d; }
  return todayIso();
}
function openAbsenceModal(courseId) {
  const c = getCourse(courseId);
  if (!c) return;
  openModal(`
    <div class="modal-head"><h3>Log an absence</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <p class="small muted mb-8">Just for you: this keeps count so you know where you stand with ${esc(c.code || c.name)}’s attendance rule.</p>
      <div class="field-row">
        <div class="field"><label for="ab-date">Date</label><input class="input" type="date" id="ab-date" value="${lastMeetingDate(c)}" max="${addDays(todayIso(), 60)}"></div>
        <div class="field"><label for="ab-note">Reason <span class="muted">(optional)</span></label><input class="input" id="ab-note" maxlength="80" placeholder="Sick, interview, travel…"></div>
      </div>
      <label class="checkbox-row small"><input type="checkbox" id="ab-excused"><span>Excused (doesn’t count toward the limit)</span></label>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveAbsence('${c.id}')">Log absence</button></div>
  `);
}
function saveAbsence(courseId) {
  const c = getCourse(courseId);
  const date = $('#ab-date').value;
  if (!c || !date) { toast('Pick a date', 'error'); return; }
  c.absences = c.absences || [];
  if (c.absences.some(a => a.date === date)) { toast('You already logged that day', 'error'); return; }
  c.absences.push({ id: uid(), date, note: cleanStr($('#ab-note').value, 80), excused: $('#ab-excused').checked, at: Date.now() });
  closeModal();
  touch();
  const used = countedAbsences(c), limit = c.details?.absenceLimit;
  if (limit != null && used >= limit) toast(used > limit ? `That’s ${used} absences in ${c.code || c.name}, ${used - limit} over the limit of ${limit}.` : `That’s ${used} of ${limit} allowed absences in ${c.code || c.name}. You’re at the limit.`, 'error', 6000);
  else toast(limit != null ? `Logged. ${used} of ${limit} allowed absences used.` : 'Absence logged');
}
function removeAbsence(courseId, id) {
  const c = getCourse(courseId);
  if (!c) return;
  c.absences = (c.absences || []).filter(a => a.id !== id);
  touch();
}

/* ── Edit by hand ──────────────────────────────────────────────── */
function openCourseDetailsModal(courseId) {
  const c = getCourse(courseId);
  if (!c) return;
  window._detailsDraft = { courseId, ...JSON.parse(JSON.stringify(sanitizeCourseDetails(c.details || {}))) };
  renderCourseDetailsModal();
}
function renderCourseDetailsModal() {
  const d = window._detailsDraft;
  const c = getCourse(d.courseId);
  openModal(`
    <div class="modal-head"><h3>${esc(c.code || c.name)} syllabus details</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="syl-form-label">Contact</div>
      <div class="field-row">
        <div class="field"><label for="dd-email">Professor’s email</label><input class="input" id="dd-email" type="email" maxlength="120" value="${esc(d.email || '')}" placeholder="patel@school.edu"></div>
        <div class="field"><label for="dd-phone">Phone</label><input class="input" id="dd-phone" maxlength="40" value="${esc(d.phone || '')}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="dd-office">Office</label><input class="input" id="dd-office" maxlength="80" value="${esc(d.office || '')}" placeholder="Science Hall 310"></div>
        <div class="field"><label for="dd-website">Course website</label><input class="input" id="dd-website" maxlength="300" value="${esc(d.website || '')}" placeholder="https://…"></div>
      </div>

      <div class="syl-form-label">Office hours</div>
      <div id="dd-hours">${(d.officeHours || []).map((h, i) => officeHourRow(h, i)).join('')}</div>
      <button class="btn btn-sm mb-8" onclick="syncDetailsDraft();_detailsDraft.officeHours.push({day:2,start:'14:00',end:'15:00',where:''});renderCourseDetailsModal()">+ Add office hours</button>
      <div class="field"><label for="dd-ohnote">Note</label><input class="input" id="dd-ohnote" maxlength="160" value="${esc(d.officeHoursNote || '')}" placeholder="Or by appointment"></div>

      <div class="syl-form-label">Attendance and late work</div>
      <div class="field-row">
        <div class="field" style="max-width:170px"><label for="dd-limit">Absences allowed</label><input class="input" id="dd-limit" type="number" min="0" max="60" value="${d.absenceLimit ?? ''}" placeholder="No limit"></div>
        <div class="field"><label for="dd-abs">Attendance policy</label><input class="input" id="dd-abs" maxlength="${DETAIL_TEXT_MAX}" value="${esc(d.absencePolicy || '')}" placeholder="3 unexcused absences, then each one counts"></div>
      </div>
      <div class="field"><label for="dd-late">Late work policy</label><textarea class="input" id="dd-late" maxlength="${DETAIL_TEXT_MAX}" placeholder="10% off per day, up to 3 days">${esc(d.latePolicy || '')}</textarea></div>
      <div class="field" style="margin-bottom:0"><label for="dd-textbook">Textbook</label><input class="input" id="dd-textbook" maxlength="200" value="${esc(d.textbook || '')}"></div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveCourseDetailsModal()">Save</button></div>
  `, { wide: true });
}
function officeHourRow(h, i) {
  return `<div class="field-row syl-hour-row" style="align-items:center;margin-bottom:6px">
    <select class="select" style="max-width:100px" aria-label="Day" data-oh="${i}" data-k="day">${DOW_NAMES.map((n, di) => `<option value="${di}" ${di === h.day ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <input class="input" type="time" aria-label="Start" value="${h.start}" style="max-width:120px" data-oh="${i}" data-k="start">
    <input class="input" type="time" aria-label="End" value="${h.end}" style="max-width:120px" data-oh="${i}" data-k="end">
    <input class="input" aria-label="Where" placeholder="Where (optional)" maxlength="80" value="${esc(h.where || '')}" data-oh="${i}" data-k="where">
    <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove office hours" onclick="syncDetailsDraft();_detailsDraft.officeHours.splice(${i},1);renderCourseDetailsModal()">${icon('x', 13, 2.2)}</button>
  </div>`;
}
function syncDetailsDraft() {
  const d = window._detailsDraft;
  const val = (id) => $(`#${id}`)?.value ?? '';
  Object.assign(d, { email: val('dd-email'), phone: val('dd-phone'), office: val('dd-office'), website: val('dd-website'), officeHoursNote: val('dd-ohnote'), absenceLimit: val('dd-limit') === '' ? null : Number(val('dd-limit')), absencePolicy: val('dd-abs'), latePolicy: val('dd-late'), textbook: val('dd-textbook') });
  d.officeHours = d.officeHours || [];
  $$('[data-oh]').forEach(el => { const h = d.officeHours[Number(el.dataset.oh)]; if (h) h[el.dataset.k] = el.dataset.k === 'day' ? Number(el.value) : el.value; });
}
function saveCourseDetailsModal() {
  syncDetailsDraft();
  const d = window._detailsDraft;
  const c = getCourse(d.courseId);
  if (!c) return;
  if (d.email && !cleanEmail(d.email)) { toast('That email address doesn’t look right', 'error'); return; }
  const prev = c.details || {};
  c.details = sanitizeCourseDetails({ ...prev, ...d, tas: prev.tas, policies: prev.policies, showOfficeHours: prev.showOfficeHours });
  touch(); closeModal(); toast('Saved');
}

/* ── Upload a syllabus into a class that already exists ────────── */
function openSyllabusMergeModal(courseId, data) {
  const c = getCourse(courseId);
  if (!c) return;
  const details = sanitizeCourseDetails(data.details);
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const existing = new Set(state.assignments.filter(a => a.courseId === c.id).map(a => norm(a.title)));
  const fresh = (data.assignments || []).filter(a => a && a.title && !existing.has(norm(a.title)));
  const meetings = validMeetings(data.meetings);
  window._sylMerge = { courseId, details, assignments: fresh.map(a => ({ ...a, _include: true })), meetings, useMeetings: !(c.meetings || []).length && meetings.length > 0, instructor: cleanStr(data.instructor, 80) };
  renderSyllabusMergeModal();
}
function renderSyllabusMergeModal() {
  const m = window._sylMerge;
  const c = getCourse(m.courseId);
  const d = m.details;
  const found = [
    d.email ? `Email: ${esc(d.email)}` : '', d.office ? `Office: ${esc(d.office)}` : '',
    d.officeHours.length ? `Office hours: ${d.officeHours.map(h => `${DOW_NAMES[h.day]} ${fmtTime(h.start)}`).join(', ')}` : '',
    d.officeHoursNote ? esc(d.officeHoursNote) : '', d.tas.length ? `${d.tas.length} TA${d.tas.length === 1 ? '' : 's'}` : '',
    d.absenceLimit != null ? `${d.absenceLimit} absence${d.absenceLimit === 1 ? '' : 's'} allowed` : '', d.absencePolicy ? 'Attendance policy' : '',
    d.latePolicy ? 'Late work policy' : '', d.policies.length ? `${d.policies.length} other polic${d.policies.length === 1 ? 'y' : 'ies'}` : '', d.textbook ? 'Textbook' : '',
  ].filter(Boolean);
  const included = m.assignments.filter(a => a._include).length;
  openModal(`
    <div class="modal-head"><h3>Add to ${esc(c.code || c.name)} <span class="ai-badge">AI</span></h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="syl-form-label">Class details</div>
      ${found.length ? `<ul class="syl-found">${found.map(f => `<li>${icon('check', 12, 2.4)} ${f}</li>`).join('')}</ul>` : '<p class="small muted">No office hours or policies found in this syllabus.</p>'}
      ${m.meetings.length && (c.meetings || []).length === 0 ? `<label class="checkbox-row small"><input type="checkbox" ${m.useMeetings ? 'checked' : ''} onchange="_sylMerge.useMeetings=this.checked"><span>Add class times: ${m.meetings.map(x => `${DOW_NAMES[x.day]} ${fmtTime(x.start)}`).join(', ')}</span></label>` : ''}
      <div class="syl-form-label">New deadlines (${m.assignments.length})</div>
      ${m.assignments.length ? `<div style="max-height:240px;overflow-y:auto">${m.assignments.map((a, i) => `
        <div class="list-row">
          <button type="button" class="row-check ${a._include ? 'checked' : ''}" role="checkbox" aria-checked="${a._include}" aria-label="${a._include ? 'Skip' : 'Add'} ${esc(a.title)}" onclick="_sylMerge.assignments[${i}]._include=!_sylMerge.assignments[${i}]._include;renderSyllabusMergeModal()">${a._include ? checkGlyph(true) : ''}</button>
          <div class="row-title">${esc(a.title)} ${typeTag(ASSIGNMENT_TYPES.includes(a.type) ? a.type : 'assignment')}</div>
          <div class="row-meta">${a.dueDate ? fmtDate(a.dueDate) : 'no date'}</div>
        </div>`).join('')}</div>` : '<p class="small muted">Everything in this syllabus is already in this class.</p>'}
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="commitSyllabusMerge()">Save${included ? ` and add ${included} deadline${included === 1 ? '' : 's'}` : ''}</button></div>
  `, { wide: true });
}
function commitSyllabusMerge() {
  const m = window._sylMerge;
  const c = getCourse(m.courseId);
  if (!c) return;
  const prev = c.details || {};
  // Fill in what the syllabus found without erasing anything typed by hand.
  const merged = { ...prev };
  Object.entries(m.details).forEach(([k, v]) => { if (Array.isArray(v) ? v.length : v != null && v !== '') merged[k] = v; });
  c.details = sanitizeCourseDetails({ ...merged, showOfficeHours: prev.showOfficeHours });
  if (m.useMeetings && m.meetings.length && !(c.meetings || []).length) c.meetings = m.meetings;
  if (!c.instructor && m.instructor) c.instructor = m.instructor;
  const adding = m.assignments.filter(a => a._include);
  adding.forEach(a => state.assignments.push({
    id: uid(), courseId: c.id, title: cleanStr(a.title, 200), type: ASSIGNMENT_TYPES.includes(a.type) ? a.type : 'assignment',
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(a.dueDate || '') ? a.dueDate : null, dueTime: /^\d{2}:\d{2}$/.test(a.dueTime || '') ? a.dueTime : '23:59', startByDate: null,
    maxPoints: null, status: 'not-started', rubric: [], notes: '', attachments: [], recurringTemplateId: null,
  }));
  touch(); closeModal();
  toast(`${c.code || c.name} updated${adding.length ? ` with ${adding.length} new deadline${adding.length === 1 ? '' : 's'}` : ''}`);
}
