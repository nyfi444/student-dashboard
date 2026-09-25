/* ── Exams: countdowns plus a prep page for each one ───────────────
   Exams are assignments with type "exam". Each gets a prep page: the
   topics it covers with how confident you feel on each (not yet, shaky,
   got it), where and how it happens, study sessions on your calendar,
   and the class's flashcards. "Prep" is how many topics you've got, so
   it's a to-do list for studying, not a grade.
──────────────────────────────────────────────────────────────── */
const CONFIDENCE = [['Not yet', 0], ['Shaky', 1], ['Got it', 2]];
const EXAM_FORMATS = ['In class', 'Online', 'Take-home', 'Testing center', 'Oral', 'Practical'];

function examList() {
  return state.assignments.filter(a => a.type === 'exam' && activeCourses().some(c => c.id === a.courseId)).sort((a, b) => ((a.dueDate || '9999') + (a.dueTime || '')).localeCompare((b.dueDate || '9999') + (b.dueTime || '')));
}
function examTopics(a) { return (a.topics || []).filter(t => t && t.title); }
function examPrep(a) {
  const topics = examTopics(a);
  if (!topics.length) return null;
  return Math.round((topics.reduce((s, t) => s + (Number(t.conf) || 0), 0) / (topics.length * 2)) * 100);
}
function examStudyBlocks(a) { return state.events.filter(e => e.linkedExamId === a.id).sort((x, y) => (x.date + (x.startTime || '')).localeCompare(y.date + (y.startTime || ''))); }
function examCountdown(a) {
  if (!a.dueDate) return { n: '—', unit: 'no date' };
  const d = daysBetween(a.dueDate);
  if (d === 0) {
    if (!a.dueTime) return { n: 'Today', unit: '' };
    const mins = toMin(a.dueTime) - nowMinutes();
    return mins > 0 ? { n: mins >= 60 ? Math.floor(mins / 60) : mins, unit: mins >= 60 ? `hour${Math.floor(mins / 60) === 1 ? '' : 's'}` : 'min' } : { n: 'Today', unit: '' };
  }
  return { n: Math.abs(d), unit: `day${Math.abs(d) === 1 ? '' : 's'}${d < 0 ? ' ago' : ''}` };
}
function openExamPrep(id) { setState({ route: 'exams', subRoute: id }); window.scrollTo(0, 0); }

function pageExams() {
  if (state.subRoute) {
    const a = state.assignments.find(x => x.id === state.subRoute && x.type === 'exam');
    if (a) return pageExamPrep(a);
  }
  const exams = examList();
  const t = todayIso();
  const upcoming = exams.filter(e => !e.dueDate || e.dueDate >= t);
  const past = exams.filter(e => e.dueDate && e.dueDate < t).reverse();
  const next = upcoming.find(e => e.dueDate);
  const soon = upcoming.filter(e => e.dueDate && daysBetween(e.dueDate) <= 14).length;
  return `
    ${pageHead('Exams', upcoming.length ? `${upcoming.length} coming up${soon ? ` · ${soon} in the next 2 weeks` : ''}` : 'Countdowns and a prep plan for each one', `<button class="btn btn-primary" onclick="openAssignmentModal(null, null, 'exam')">+ Add exam</button>`)}
    ${next ? examHero(next) : ''}
    ${upcoming.filter(e => e !== next).length ? `<div class="sg-section-label">Also coming up</div>${expandable('exams-upcoming', 'Also coming up', `<div class="grid grid-3 mb-16 exam-grid">${upcoming.filter(e => e !== next).map(examCard).join('')}</div>`, { max: 460, count: upcoming.filter(e => e !== next).length })}` : ''}
    ${!upcoming.length ? `<div class="card">${emptyState(icon('flag', 26, 1.4), 'No exams on the horizon', `<button class="btn btn-primary" onclick="openAssignmentModal(null, null, 'exam')">+ Add exam</button>`, 'Upload a syllabus and every exam date lands here with a countdown.')}</div>` : ''}
    ${past.length ? `<details class="todo-done mt-16"><summary><span>Past exams</span><span class="assign-count">${past.length}</span></summary>${expandable('exams-past', 'Past exams', `<div class="card assign-list">${past.map(e => {
      const c = getCourse(e.courseId);
      return `<div class="assign-row" style="--course:${esc(c?.color || '#8a8a8a')}" onclick="openExamPrep('${e.id}')"><span class="row-check checked" aria-hidden="true">${checkGlyph(true)}</span><div class="assign-main"><div class="assign-title">${esc(e.title)}</div><div class="assign-meta"><span class="assign-course"><span class="course-dot"></span>${esc(c ? (c.code || c.name) : '')}</span></div></div><div class="assign-due">${esc(fmtDate(e.dueDate))}</div></div>`;
    }).join('')}</div>`, { max: 420, count: past.length })}</details>` : ''}
  `;
}
function examHero(a) {
  const c = getCourse(a.courseId);
  const cd = examCountdown(a);
  const prep = examPrep(a);
  const topics = examTopics(a);
  const due = typeof srsDueCount === 'function' ? state.decks.filter(d => d.courseId === a.courseId).reduce((s, d) => s + srsDueCount(d), 0) : 0;
  const blocks = examStudyBlocks(a).filter(e => e.date >= todayIso());
  return `
    <div class="card exam-hero" style="--course:${esc(c?.color || '#5a6b7b')}">
      <div class="exam-hero-count"><strong>${esc(String(cd.n))}</strong><span>${esc(cd.unit)}</span></div>
      <div class="exam-hero-body">
        <div class="sg-eyebrow"><span class="course-dot"></span>${esc(c ? (c.code || c.name) : '')} · Next exam</div>
        <button class="exam-hero-title" onclick="openExamPrep('${a.id}')">${esc(a.title)}</button>
        <div class="small muted sg-meta-line">
          <span>${icon('calendar', 12, 1.8)} ${esc(fmtDateLong(a.dueDate))}${a.dueTime ? ` · ${fmtTime(a.dueTime)}` : ''}</span>
          ${a.exam?.location ? `<span>${icon('map-pin', 12, 1.8)} ${esc(a.exam.location)}</span>` : ''}
          ${a.exam?.format ? `<span>${esc(a.exam.format)}</span>` : ''}
        </div>
        <div class="exam-prep-line">
          <div class="progress"><div style="width:${prep || 0}%"></div></div>
          <span class="small">${prep == null ? 'No topics added yet' : `${prep}% prepped · ${topics.filter(t => t.conf === 2).length} of ${topics.length} topics down`}</span>
        </div>
        <div class="flex-gap wrap mt-8">
          <button class="btn btn-primary btn-sm" onclick="openExamPrep('${a.id}')">${icon('target', 13, 1.8)} ${topics.length ? 'Open prep' : 'Start prepping'}</button>
          ${due ? `<button class="btn btn-sm" onclick="openReview(${JSON.stringify(state.decks.filter(d => d.courseId === a.courseId).map(d => d.id)).replace(/"/g, '&quot;')})">${icon('layers', 13, 1.8)} Review ${due} card${due === 1 ? '' : 's'}</button>` : ''}
          ${blocks.length ? `<span class="small muted">${blocks.length} study session${blocks.length === 1 ? '' : 's'} planned</span>` : `<button class="btn btn-sm" onclick="openStudyPlanModal('${a.id}')">${icon('calendar', 12, 1.8)} Plan study sessions</button>`}
        </div>
      </div>
    </div>`;
}
function examCard(a) {
  const c = getCourse(a.courseId);
  const cd = examCountdown(a);
  const prep = examPrep(a);
  const d = a.dueDate ? daysBetween(a.dueDate) : null;
  return `
    <div class="card exam-card" style="--course:${esc(c?.color || '#5a6b7b')}" onclick="openExamPrep('${a.id}')">
      <div class="flex-between"><div class="sg-eyebrow"><span class="course-dot"></span>${esc(c ? (c.code || c.name) : '')}</div>${d != null && d <= 3 ? '<span class="proj-days soon">Soon</span>' : ''}</div>
      <div class="exam-card-title">${esc(a.title)}</div>
      <div class="small muted">${a.dueDate ? `${esc(fmtDate(a.dueDate, { weekday: 'short', month: 'short', day: 'numeric' }))}${a.dueTime ? ` · ${fmtTime(a.dueTime)}` : ''}` : 'No date yet'}</div>
      <div class="exam-card-foot">
        <div class="exam-card-count"><strong>${esc(String(cd.n))}</strong><span>${esc(cd.unit)}</span></div>
        <div class="exam-card-prep">${prep == null ? '<span class="small muted">No topics yet</span>' : `<div class="progress"><div style="width:${prep}%"></div></div><span class="small muted">${prep}% prepped</span>`}</div>
      </div>
    </div>`;
}

/* ── Prep page ─────────────────────────────────────────────────── */
function pageExamPrep(a) {
  const c = getCourse(a.courseId);
  const cd = examCountdown(a);
  const topics = examTopics(a);
  const prep = examPrep(a);
  const past = a.dueDate && a.dueDate < todayIso();
  const decks = state.decks.filter(d => d.courseId === a.courseId);
  const blocks = examStudyBlocks(a);
  const upcomingBlocks = blocks.filter(e => e.date >= todayIso());
  const since = addDays(todayIso(), -14);
  const focusMin = state.timerSessions.filter(s => s.courseId === a.courseId && s.date >= since).reduce((s, x) => s + x.minutes, 0);
  const ex = a.exam || {};
  const counts = CONFIDENCE.map(([, v]) => topics.filter(t => (Number(t.conf) || 0) === v).length);
  return `
    <div style="--course:${esc(c?.color || '#5a6b7b')}">
    <button class="btn btn-ghost btn-sm sg-back" onclick="setState({subRoute:null})">${icon('arrow-left', 14, 1.9)} All exams</button>
    <div class="sg-head">
      <div style="min-width:0">
        <div class="sg-eyebrow"><span class="course-dot"></span>${[c ? esc(c.code || c.name) : '', a.dueDate ? esc(fmtDateLong(a.dueDate)) : 'No date', a.dueTime ? fmtTime(a.dueTime) : ''].filter(Boolean).join(' · ')}</div>
        <h2 class="sg-title">${esc(a.title)}</h2>
      </div>
      <div class="sg-head-actions">
        ${signInHeaderButton()}
        ${a.courseId ? `<button class="btn btn-sm" onclick="startCourseFocus('${a.courseId}')">${icon('play', 11, 1.5)} Focus session</button>` : ''}
        <button class="btn btn-icon" aria-label="Edit exam" title="Edit exam" onclick="openAssignmentModal('${a.id}')">${icon('pencil', 15, 1.7)}</button>
      </div>
    </div>

    <div class="sg-overview">
      <div class="sg-col">
        <div class="card exam-hero compact">
          <div class="exam-hero-count"><strong>${esc(String(cd.n))}</strong><span>${esc(cd.unit)}</span></div>
          <div class="exam-hero-body">
            <div class="exam-logistics">
              <div class="field"><label for="ex-loc">Where</label><input class="input" id="ex-loc" maxlength="80" value="${esc(ex.location || '')}" placeholder="Science Hall 204" onchange="setExamField('${a.id}','location',this.value)"></div>
              <div class="field"><label for="ex-format">Format</label><select class="select" id="ex-format" onchange="setExamField('${a.id}','format',this.value)"><option value="">Not sure</option>${EXAM_FORMATS.map(f => `<option ${ex.format === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
              <div class="field exam-logistics-wide"><label for="ex-materials">What’s allowed or what to bring</label><input class="input" id="ex-materials" maxlength="160" value="${esc(ex.materials || '')}" placeholder="One page of notes, calculator, #2 pencil" onchange="setExamField('${a.id}','materials',this.value)"></div>
            </div>
          </div>
        </div>

        <div class="card card-pad">
          <div class="flex-between mb-8">
            <h3 class="sg-h3">Topics</h3>
            ${aiEnabled() ? `<button class="sg-link" onclick="openTopicsFromGuideModal('${a.id}')">${icon(aiLooksUnlocked() ? 'sparkles' : 'lock', 12, 1.8)} From a study guide</button>` : ''}
          </div>
          ${topics.length ? `
            <div class="exam-conf-summary small" aria-label="Confidence summary">${CONFIDENCE.map(([label, v], i) => `<span class="conf-${v}"><strong>${counts[i]}</strong> ${label.toLowerCase()}</span>`).join('')}</div>
            <div class="exam-topics">${topics.map(t => `
              <div class="exam-topic conf-row-${Number(t.conf) || 0}" data-item-id="${t.id}">
                <span class="exam-topic-title">${esc(t.title)}</span>
                <div class="segmented exam-conf" role="group" aria-label="How confident are you on ${esc(t.title)}?">${CONFIDENCE.map(([label, v]) => `<button class="conf-${v} ${(Number(t.conf) || 0) === v ? 'active' : ''}" aria-pressed="${(Number(t.conf) || 0) === v}" onclick="setTopicConfidence('${a.id}','${t.id}',${v})">${label}</button>`).join('')}</div>
                <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove ${esc(t.title)}" onclick="removeTopic('${a.id}','${t.id}')">${icon('x', 12, 2.2)}</button>
              </div>`).join('')}</div>` : `<p class="small muted mb-8">List what the exam covers: chapters, lectures, problem types. Rate each one as you study and focus on what’s shaky.</p>`}
          <div class="proj-inline-add mt-8">
            <textarea class="input ex-topic-input" id="ex-topic" rows="1" maxlength="4000" placeholder="${topics.length ? 'Add a topic' : 'Chapter 7: Stereochemistry'}" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();addTopic('${a.id}')}"></textarea>
            <button class="btn btn-sm" onclick="addTopic('${a.id}')">Add</button>
          </div>
          <p class="small muted mt-4">Tip: paste a whole list at once, one topic per line.</p>
        </div>
      </div>

      <div class="sg-col">
        <div class="card card-pad hub-progress">
          <div class="hub-ring">${progressRing(prep, c?.color, 104)}<div class="hub-ring-label">${prep == null ? '<span class="muted small">Add topics<br>to track</span>' : `<strong>${prep}%</strong><span>prepped</span>`}</div></div>
          <div class="hub-stats proj-stats">
            <div class="hub-stat"><strong>${counts[2]}/${topics.length}</strong><span>Topics down</span></div>
            <div class="hub-stat"><strong>${fmtDuration(focusMin)}</strong><span>Focus, 2 weeks</span></div>
          </div>
        </div>

        ${!past ? `
        <div class="card card-pad">
          <div class="flex-between mb-8"><h3 class="sg-h3">Study plan</h3><button class="sg-link" onclick="openStudyPlanModal('${a.id}')">${upcomingBlocks.length ? '+ More sessions' : 'Plan sessions'}</button></div>
          ${upcomingBlocks.length ? upcomingBlocks.map(e => `<div class="sg-person hub-link" onclick="setState({route:'calendar',calView:'day',calDate:'${e.date}',subRoute:null})"><span class="hub-day">${esc(fmtDate(e.date, { weekday: 'short' }))}</span><div class="row-title small">${esc(fmtDate(e.date))} · ${fmtTime(e.startTime)}–${fmtTime(e.endTime)}</div><button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove session on ${esc(fmtDate(e.date))}" onclick="event.stopPropagation();removeStudyBlock('${e.id}')">${icon('x', 12, 2.2)}</button></div>`).join('') : `<p class="small muted">Put a few study sessions on your calendar before the exam, so it’s not all the night before.</p>`}
        </div>` : ''}

        <div class="card card-pad">
          <div class="flex-between mb-8"><h3 class="sg-h3">Flashcards</h3><button class="sg-link" onclick="setState({route:'studytools',subRoute:null});openDeckModal(null,'${a.courseId}')">+ New deck</button></div>
          ${decks.length ? decks.map(d => { const due = srsDueCount(d); return `<div class="sg-person"><span class="sg-activity-ic">${icon('layers', 13, 1.8)}</span><div class="row-title small">${esc(d.name)} <span class="muted">· ${due ? `${due} to review` : `${d.cards.length} cards`}</span></div><button class="btn btn-sm ${due ? 'btn-primary' : ''}" onclick="openReview(['${d.id}'])" ${d.cards.length ? '' : 'disabled'}>${due ? 'Review' : 'Study'}</button></div>`; }).join('') : `<p class="small muted">No decks for ${esc(c ? (c.code || c.name) : 'this class')} yet. Cards you review a little each day stick far better than cramming.</p>`}
        </div>
      </div>
    </div>
    </div>`;
}
function examById(id) { return state.assignments.find(x => x.id === id); }
function setExamField(id, key, value) {
  const a = examById(id);
  if (!a) return;
  a.exam = { ...(a.exam || {}), [key]: String(value || '').trim().slice(0, 160) };
  save();
}
function addTopic(id) {
  const a = examById(id);
  const input = $('#ex-topic');
  const raw = input?.value || '';
  const lines = raw.split(/\n|;/).map(s => s.replace(/^[\s•\-*\d.)]+/, '').trim()).filter(Boolean);
  if (!a || !lines.length) { input?.focus(); return; }
  a.topics = a.topics || [];
  lines.slice(0, 40).forEach(title => a.topics.push({ id: uid(), title: title.slice(0, 120), conf: 0 }));
  touch();
  setTimeout(() => $('#ex-topic')?.focus(), 20);
}
function setTopicConfidence(id, tid, conf) {
  const a = examById(id);
  const t = a?.topics?.find(x => x.id === tid);
  if (!t) return;
  t.conf = conf;
  touch();
  if (conf === 2) celebrateItem(tid);
  if (conf === 2 && examTopics(a).every(x => x.conf === 2)) toast('Every topic down. You’re ready.', 'success', 4000);
}
function removeTopic(id, tid) {
  const a = examById(id);
  if (!a?.topics) return;
  const idx = a.topics.findIndex(x => x.id === tid);
  const [removed] = a.topics.splice(idx, 1);
  touch();
  toast(`Removed “${removed.title}”`, 'success', 4500, { label: 'Undo', run: () => { a.topics.splice(idx, 0, removed); touch(); } });
}

/* ── Study sessions before the exam ────────────────────────────── */
function openStudyPlanModal(id) {
  const a = examById(id);
  if (!a?.dueDate) { toast('Give the exam a date first', 'error'); return; }
  const daysOut = Math.max(0, daysBetween(a.dueDate));
  const suggested = clamp(Math.floor(daysOut / 2), 1, 4);
  openModal(`
    <div class="modal-head"><h3>Plan study sessions</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <p class="small muted mb-8">${daysOut ? `${daysOut} day${daysOut === 1 ? '' : 's'} until ${esc(a.title)}.` : `${esc(a.title)} is today.`} Sessions are spread out before it and go on your calendar as time blocks.</p>
      <div class="field-row">
        <div class="field"><label for="sp-count">Sessions</label><select class="select" id="sp-count">${[1, 2, 3, 4, 5, 6].filter(n => n <= Math.max(1, daysOut)).map(n => `<option ${n === suggested ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="field"><label for="sp-length">Length</label><select class="select" id="sp-length"><option value="30">30 min</option><option value="60" selected>1 hour</option><option value="90">1.5 hours</option><option value="120">2 hours</option></select></div>
        <div class="field"><label for="sp-time">Start at</label><input class="input" type="time" id="sp-time" value="19:00"></div>
      </div>
      <label class="checkbox-row small"><input type="checkbox" id="sp-skip-class" checked><span>Avoid times I have class</span></label>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="createStudyPlan('${a.id}')">Add to calendar</button></div>
  `);
}
function createStudyPlan(id) {
  const a = examById(id);
  if (!a?.dueDate) return;
  const count = Number($('#sp-count').value) || 1;
  const len = Number($('#sp-length').value) || 60;
  let start = $('#sp-time').value || '19:00';
  const avoid = $('#sp-skip-class').checked;
  const daysOut = Math.max(1, daysBetween(a.dueDate));
  const c = getCourse(a.courseId);
  const created = [];
  for (let i = 0; i < count; i++) {
    // Evenly spaced between today and the day before the exam.
    const d = addDays(todayIso(), clamp(Math.round(((i + 1) * daysOut) / (count + 1)), 0, daysOut - 1));
    let s = start;
    if (avoid) {
      const busy = meetingsOnDate(d).some(m => toMin(m.start) < toMin(s) + len && toMin(m.end) > toMin(s));
      if (busy) { const lastEnd = Math.max(...meetingsOnDate(d).map(m => toMin(m.end))); s = fromMin(Math.min(lastEnd + 30, 22 * 60)); }
    }
    if (state.events.some(e => e.linkedExamId === a.id && e.date === d)) continue;
    const ev = { id: uid(), title: `Study: ${a.title}`, date: d, startTime: s, endTime: addMinutesHHMM(s, len), courseId: a.courseId, type: 'block', color: c?.color || '#5a6b7b', linkedExamId: a.id, linkedAssignmentId: a.id };
    state.events.push(ev);
    created.push(ev);
  }
  closeModal();
  touch();
  toast(created.length ? `Added ${created.length} study session${created.length === 1 ? '' : 's'} to your calendar` : 'Those days already have a session planned', 'success', 4500);
}
function removeStudyBlock(eventId) {
  state.events = state.events.filter(e => e.id !== eventId);
  touch();
}

/* ── Topics from a study guide ─────────────────────────────────── */
const TOPICS_SYSTEM = `You pull the list of topics an exam covers out of a study guide, review sheet, or syllabus section. Reply with ONLY a JSON array of short topic strings (no prose, no markdown fences), in the order they appear, at most 30. Merge duplicates. Keep each under 80 characters.`;
function openTopicsFromGuideModal(id) {
  if (!requireAi('Pulling topics from a study guide')) return;
  delete _uploadZones.guide;
  openModal(`
    <div class="modal-head"><h3>Topics from a study guide <span class="ai-badge">AI</span></h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label for="tg-text">Paste the study guide</label><textarea class="input" id="tg-text" style="min-height:150px" placeholder="Exam 1 covers chapters 5–8…"></textarea></div>
      <label class="btn btn-sm">${icon('upload', 13, 1.8)} Or upload it
        <input type="file" id="uz-guide-input" multiple style="display:none" onchange="loadUploadZone('guide', this.files)">
      </label>
      <span class="small muted" id="uz-guide-status"></span>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="tg-run" onclick="runTopicsFromGuide('${id}')">${icon('sparkles', 13, 1.6)} Pull out topics</button></div>
  `);
}
async function runTopicsFromGuide(id) {
  const a = examById(id);
  const upload = _uploadZones.guide;
  if (upload && !upload.ready) { toast('Still reading that file, one moment', 'info'); return; }
  const text = [$('#tg-text').value.trim(), upload?.text].filter(Boolean).join('\n\n');
  const images = upload?.images || [];
  if (!a || (!text && !images.length)) { toast('Paste the study guide or upload it', 'error'); return; }
  const btn = $('#tg-run');
  setBtnLoading(btn, true);
  try {
    const userContent = images.length ? [...imageBlocks(images), { type: 'text', text: `List the topics this exam covers: ${a.title}${text ? `\n\n${text.slice(0, 12000)}` : ''}` }] : `Exam: ${a.title}\n\n${text.slice(0, 12000)}`;
    const list = extractJson(await callClaude({ system: TOPICS_SYSTEM, userContent, maxTokens: 4000, feature: 'exam-topics' }));
    const have = new Set(examTopics(a).map(t => t.title.toLowerCase()));
    const fresh = (Array.isArray(list) ? list : []).filter(x => typeof x === 'string' && x.trim() && !have.has(x.trim().toLowerCase())).slice(0, 30);
    a.topics = [...(a.topics || []), ...fresh.map(title => ({ id: uid(), title: title.trim().slice(0, 120), conf: 0 }))];
    closeModal(); touch();
    toast(fresh.length ? `Added ${fresh.length} topic${fresh.length === 1 ? '' : 's'}` : 'No new topics found', fresh.length ? 'success' : 'info');
  } catch (e) {
    setBtnLoading(btn, false);
    toast(e.message || 'Couldn’t read that study guide', 'error', 4500);
  }
}
