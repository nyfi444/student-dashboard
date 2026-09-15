/* ── Shared classes ────────────────────────────────────────────────
   One student shares a class (usually right after uploading the
   syllabus). Everyone else in that section joins with a code, a link,
   or by searching their school, and gets the class times and every
   deadline in one tap. When the person who shared it adds or changes a
   deadline and shares the update, everyone's copy follows.

   Firestore: classes/{CODE} holds the shared, public-by-code part (course
   code, name, instructor, meeting times, assignment titles/dates, and the
   syllabus details: office hours, contact info, and policies).
   Nothing personal is ever shared: status, notes, files, absences, and to-dos stay
   in each student's own planner. classes/{CODE}/members/{uid} records who
   joined, for the classmate count. "Listed" classes can be found by school
   and course code.
──────────────────────────────────────────────────────────────── */
const PENDING_CLASS_KEY = 'shq_pending_class';

function normKey(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function hashString(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }
function validMeetings(list) {
  return (Array.isArray(list) ? list : []).filter(m => m && Number.isInteger(Number(m.day)) && Number(m.day) >= 0 && Number(m.day) <= 6 && /^\d{2}:\d{2}$/.test(m.start || '') && /^\d{2}:\d{2}$/.test(m.end || ''))
    .map(m => ({ day: Number(m.day), start: m.start, end: m.end })).slice(0, 14);
}
function sharedItemsFromDoc(doc) {
  return Object.values(doc?.items || {}).filter(i => i && SAFE_ID.test(i.id || '') && i.title).map(i => ({
    id: i.id, title: String(i.title).slice(0, 200), type: ASSIGNMENT_TYPES.includes(i.type) ? i.type : 'assignment',
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(i.dueDate || '') ? i.dueDate : null, dueTime: /^\d{2}:\d{2}$/.test(i.dueTime || '') ? i.dueTime : '23:59',
  }));
}
// What an owner's course shares: never status, notes, files, or points.
function classPayload(course) {
  const items = {};
  state.assignments.filter(a => a.courseId === course.id && SAFE_ID.test(a.shared?.id || a.id)).forEach(a => {
    const id = a.shared?.id || a.id;
    items[id] = { id, title: a.title, type: a.type, dueDate: a.dueDate || '', dueTime: a.dueTime || '' };
  });
  return {
    courseCode: course.code || '', courseKey: normKey(course.code || course.name), name: course.name, instructor: course.instructor || '',
    location: course.location || '', meetings: validMeetings(course.meetings), items, term: (currentSemester()?.name || '').replace(/\s*\(sample\)$/, ''),
    details: sharedDetails(course.details),
  };
}
// Syllabus details as everyone in the class sees them (not whether you put office hours on your own calendar).
function sharedDetails(d) { const { showOfficeHours, ...rest } = sanitizeCourseDetails(d || {}); return rest; }
function payloadHash(p) { return hashString(JSON.stringify([p.courseCode, p.name, p.instructor, p.location, p.meetings, Object.values(p.items).sort((a, b) => a.id.localeCompare(b.id)), p.details || {}])); }
function unsharedChangeCount(course) {
  if (course.sharedClass?.role !== 'owner') return 0;
  const p = classPayload(course);
  if (payloadHash(p) === course.sharedClass.publishedHash) return 0;
  const published = course.sharedClass.publishedItems || {};
  const ids = new Set([...Object.keys(p.items), ...Object.keys(published)]);
  let n = 0;
  ids.forEach(id => { if (JSON.stringify(p.items[id] || null) !== JSON.stringify(published[id] || null)) n++; });
  return Math.max(1, n);
}
function classInviteLink(code) { return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}?class=${code}`; }
function classesRef() { return _fbDb.collection('classes'); }

/* ── Class page badge + actions ────────────────────────────────── */
function classShareBar(course) {
  const sc = course.sharedClass;
  if (!sc) {
    return `<div class="class-share-bar">
      <span class="class-share-ic">${icon('users', 15, 1.8)}</span>
      <div style="flex:1;min-width:0"><div class="sg-strong">Share this class with your section</div><div class="small muted">Classmates get the class times and every deadline in one tap. Your notes and progress stay private.</div></div>
      <button class="btn btn-sm btn-primary" onclick="openShareClassModal('${course.id}')">Share class</button>
    </div>`;
  }
  const changes = unsharedChangeCount(course);
  return `<div class="class-share-bar is-shared">
    <span class="class-share-ic">${icon('users', 15, 1.8)}</span>
    <div style="flex:1;min-width:0">
      <div class="sg-strong">Shared class · code ${esc(sc.code)}</div>
      <div class="small muted">${sc.role === 'owner' ? `You shared this${sc.memberCount ? ` · ${sc.memberCount} classmate${sc.memberCount === 1 ? '' : 's'} joined` : ''}` : `Synced from ${esc(sc.sharedBy || 'a classmate')}${sc.syncedAt ? ` · updated ${fmtRelativeTime(sc.syncedAt)}` : ''}`}</div>
    </div>
    ${changes ? `<button class="btn btn-sm btn-primary" onclick="publishClassUpdates('${course.id}')">Share ${changes} update${changes === 1 ? '' : 's'}</button>` : ''}
    <button class="btn btn-sm" onclick="openClassInviteModal('${course.id}')">${icon('user-plus', 13, 1.8)} Invite</button>
    <button class="btn btn-ghost btn-icon btn-sm" aria-label="Shared class options" onclick="openClassOptions('${course.id}')">${icon('more-horizontal', 16, 1.8)}</button>
  </div>`;
}
function requireCloudForClasses() {
  if (cloudGroupsEnabled()) return true;
  openModal(`
    <div class="modal-head"><h3>Shared classes</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body"><p class="small muted">Sharing and joining classes needs a Semester HQ account, so everyone’s deadlines stay in sync.</p></div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Not now</button>${fbConfigured() ? `<a class="btn btn-primary" href="login.html">Log in or sign up</a>` : ''}</div>
  `);
  return false;
}

/* ── Share ─────────────────────────────────────────────────────── */
function openShareClassModal(courseId) {
  if (!requireCloudForClasses()) return;
  const c = getCourse(courseId);
  const p = classPayload(c);
  const n = Object.keys(p.items).length;
  openModal(`
    <div class="modal-head"><h3>Share ${esc(c.code || c.name)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <p class="small muted mb-16">Anyone in your section can join with a code or link and instantly get this class set up.</p>
      <div class="class-share-summary">
        <div><span class="sg-strong">Shared:</span> ${[c.code || c.name, c.instructor ? 'instructor' : '', p.meetings.length ? 'class times' : '', `${n} assignment${n === 1 ? '' : 's'} and exam dates`].filter(Boolean).map(esc).join(', ')}</div>
        <div class="muted"><span class="sg-strong">Never shared:</span> your progress, notes, files, and to-dos.</div>
      </div>
      <div class="field-row mt-16">
        <div class="field"><label for="cs-school">School</label><input class="input" id="cs-school" value="${esc(state.settings.school || '')}" maxlength="80" placeholder="University of Michigan"></div>
        <div class="field"><label for="cs-section">Section <span class="muted">(optional)</span></label><input class="input" id="cs-section" maxlength="40" placeholder="002, or MWF 9am"></div>
      </div>
      <label class="checkbox-row"><input type="checkbox" id="cs-listed" checked> <span>Let classmates at my school find this class by searching</span></label>
      ${!c.code ? `<p class="small mt-8" style="color:var(--danger)">Add a course code (like BIO 201) in Edit course so classmates can find it.</p>` : ''}
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="cs-go" onclick="createSharedClass('${courseId}')">Create class link</button></div>
  `);
}
async function createSharedClass(courseId) {
  const c = getCourse(courseId);
  const school = $('#cs-school').value.trim();
  const section = $('#cs-section').value.trim();
  const listed = $('#cs-listed').checked && !!school && !!c.code;
  if (school) state.settings.school = school;
  const btn = $('#cs-go');
  setBtnLoading(btn, true);
  try {
    let code;
    for (let i = 0; i < 6; i++) { code = genGroupCode(); const snap = await classesRef().doc(code).get(); if (!snap.exists) break; }
    const p = classPayload(c);
    const doc = { v: 1, code, ...p, section, school, schoolKey: normKey(school), listed, createdBy: _fbUser.uid, createdByName: myGroupName(), createdAt: Date.now(), updatedAt: Date.now() };
    await classesRef().doc(code).set(doc);
    await classesRef().doc(code).collection('members').doc(_fbUser.uid).set({ joinedAt: Date.now() });
    state.assignments.filter(a => a.courseId === c.id && !a.shared).forEach(a => { a.shared = { code, id: a.id }; });
    c.sharedClass = { code, role: 'owner', publishedHash: payloadHash(p), publishedItems: p.items, sharedBy: myGroupName(), memberCount: 1 };
    closeModal();
    touch();
    openClassInviteModal(c.id, { justCreated: true });
  } catch (e) {
    console.warn('Share class failed', e);
    setBtnLoading(btn, false, 'Create class link');
    toast('Couldn’t share the class. Check your connection and try again.', 'error');
  }
}
async function publishClassUpdates(courseId) {
  const c = getCourse(courseId);
  if (!c?.sharedClass || c.sharedClass.role !== 'owner' || !cloudGroupsEnabled()) return;
  const p = classPayload(c);
  try {
    await classesRef().doc(c.sharedClass.code).update({ ...p, updatedAt: Date.now() });
    state.assignments.filter(a => a.courseId === c.id && !a.shared).forEach(a => { a.shared = { code: c.sharedClass.code, id: a.id }; });
    c.sharedClass.publishedHash = payloadHash(p);
    c.sharedClass.publishedItems = p.items;
    touch();
    playUiSound('send');
    toast('Classmates will get the update next time they open Semester HQ');
  } catch (e) { toast(e.code === 'permission-denied' ? 'Only the person who shared this class can update it.' : 'Couldn’t share the update. Try again.', 'error'); }
}
function openClassInviteModal(courseId, { justCreated = false } = {}) {
  const c = getCourse(courseId);
  const code = c.sharedClass.code;
  const link = classInviteLink(code);
  openModal(`
    <div class="modal-head"><h3>${justCreated ? `${esc(c.code || c.name)} is shared` : `Invite classmates to ${esc(c.code || c.name)}`}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <p class="small muted" style="text-align:center">Post the link in your class GroupMe or Discord, or share the code:</p>
      <div class="sg-invite-code">${code.split('').map(ch => `<span>${ch}</span>`).join('')}</div>
      <div class="field mt-16"><label for="class-invite-link">Link</label>
        <div class="sg-invite-row"><input class="input" id="class-invite-link" value="${esc(link)}" readonly onclick="this.select()"><button class="btn btn-primary" onclick="copyClassInvite('${c.id}')">${icon('copy', 13, 1.8)} Copy</button></div>
      </div>
      ${navigator.share ? `<button class="btn" style="width:100%;justify-content:center" onclick="shareClassInvite('${c.id}')">${icon('send', 13, 1.8)} Share via…</button>` : ''}
      <div class="sg-pricing-inline small mt-16"><span class="sg-feature-ic">${icon('graduation-cap', 15, 1.7)}</span><div><span class="sg-strong">Want the whole section covered?</span><div class="muted">Clubs, TAs, and departments can get everyone on Semester HQ with <a href="${GROUP_PRICING_URL}" target="_blank" rel="noopener">group pricing</a>.</div></div></div>
    </div>
  `);
}
// Built from the course at click time rather than baked into the button, since
// a joined class's name and code come from someone else's shared data.
function classInviteText(c) { return `${c.code || c.name} is on Semester HQ. Join to get every deadline and exam date in one tap: ${classInviteLink(c.sharedClass.code)}`; }
function copyClassInvite(courseId) { const c = getCourse(courseId); if (c?.sharedClass) copyText(classInviteText(c), 'Copied. Paste it in your class chat.'); }
function shareClassInvite(courseId) {
  const c = getCourse(courseId);
  if (!c?.sharedClass) return;
  navigator.share({ title: `Join ${c.code || c.name} on Semester HQ`, text: classInviteText(c), url: classInviteLink(c.sharedClass.code) }).catch(() => {});
}
function openClassOptions(courseId) {
  const c = getCourse(courseId);
  const owner = c.sharedClass.role === 'owner';
  openModal(`
    <div class="modal-head"><h3>Shared class</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <p class="small muted mb-16">${owner ? 'You shared this class. Classmates who joined keep their copy even if you stop sharing, but they won’t get any more updates.' : 'Stop syncing and this class stays in your planner exactly as it is now, without future updates.'}</p>
      <div class="sg-danger">
        ${owner ? `<button class="btn btn-danger btn-sm" onclick="stopSharingClass('${courseId}')">Stop sharing</button>` : `<button class="btn btn-sm" onclick="checkClassUpdates('${courseId}',true)">${icon('refresh-cw', 13, 1.8)} Check for updates</button><button class="btn btn-danger btn-sm" onclick="leaveSharedClass('${courseId}')">Stop syncing</button>`}
      </div>
    </div>
  `);
}
async function stopSharingClass(courseId) {
  const c = getCourse(courseId);
  try { await classesRef().doc(c.sharedClass.code).delete(); } catch (e) { toast('Couldn’t stop sharing. Try again.', 'error'); return; }
  delete c.sharedClass;
  state.assignments.forEach(a => { if (a.courseId === courseId) delete a.shared; });
  closeModal(); touch(); toast('Stopped sharing this class');
}
async function leaveSharedClass(courseId) {
  const c = getCourse(courseId);
  const code = c.sharedClass.code;
  delete c.sharedClass;
  state.assignments.forEach(a => { if (a.courseId === courseId) delete a.shared; });
  closeModal(); touch();
  try { await classesRef().doc(code).collection('members').doc(_fbUser.uid).delete(); } catch {}
  toast('This class won’t sync anymore');
}

/* ── Join ──────────────────────────────────────────────────────── */
function openJoinClassModal(prefill = '', tab = 'code') {
  if (!requireCloudForClasses()) return;
  openModal(`
    <div class="modal-head"><h3>Join a shared class</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="segmented mb-16">
        <button class="${tab === 'code' ? 'active' : ''}" onclick="openJoinClassModal('', 'code')">I have a code</button>
        <button class="${tab === 'find' ? 'active' : ''}" onclick="openJoinClassModal('', 'find')">Find my class</button>
      </div>
      ${tab === 'code' ? `
        <div class="field"><label for="jc-code">Class code</label>
          <input class="input sg-code-input" id="jc-code" value="${esc(normalizeCode(prefill))}" placeholder="ABC123" maxlength="8" autocomplete="off" spellcheck="false" oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'')" onkeydown="if(event.key==='Enter')lookupClassCode()">
        </div>
        <div id="jc-result"></div>` : `
        <div class="field-row">
          <div class="field"><label for="fc-school">School</label><input class="input" id="fc-school" value="${esc(state.settings.school || '')}" maxlength="80" placeholder="University of Michigan" onkeydown="if(event.key==='Enter')findClasses()"></div>
          <div class="field"><label for="fc-course">Course code</label><input class="input" id="fc-course" maxlength="20" placeholder="BIO 201" onkeydown="if(event.key==='Enter')findClasses()"></div>
        </div>
        <div id="fc-results"></div>`}
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button>${tab === 'code' ? `<button class="btn btn-primary" id="jc-btn" onclick="lookupClassCode()">Find class</button>` : `<button class="btn btn-primary" id="fc-btn" onclick="findClasses()">Search</button>`}</div>
  `);
}
async function lookupClassCode() {
  const code = normalizeCode($('#jc-code').value);
  if (code.length !== 6) { toast('Class codes are 6 characters', 'error'); return; }
  const btn = $('#jc-btn');
  setBtnLoading(btn, true);
  try {
    const snap = await classesRef().doc(code).get();
    setBtnLoading(btn, false, 'Find class');
    if (!snap.exists) { $('#jc-result').innerHTML = `<div class="sg-callout small"><div>No class uses the code <strong>${esc(code)}</strong>. Double-check it with whoever shared it.</div></div>`; return; }
    showClassPreview(code, snap.data());
  } catch (e) { setBtnLoading(btn, false, 'Find class'); toast('Couldn’t look that up. Check your connection.', 'error'); }
}
async function findClasses() {
  const school = $('#fc-school').value.trim(), course = $('#fc-course').value.trim();
  if (!school || !course) { toast('Enter your school and the course code', 'error'); return; }
  state.settings.school = school; save();
  const btn = $('#fc-btn');
  setBtnLoading(btn, true);
  try {
    const snap = await classesRef().where('listed', '==', true).where('schoolKey', '==', normKey(school)).where('courseKey', '==', normKey(course)).limit(20).get();
    setBtnLoading(btn, false, 'Search');
    const results = snap.docs.map(d => d.data()).filter(d => /^[A-Z0-9]{6}$/.test(d.code || '')).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    $('#fc-results').innerHTML = results.length ? results.map(d => `
      <button class="class-result" onclick="openJoinClassFromResult('${d.code}')">
        <div style="min-width:0;flex:1"><div class="sg-strong">${esc(d.courseCode)} · ${esc(d.name)}</div>
        <div class="small muted">${[d.term, d.section ? `Section ${d.section}` : '', d.instructor, `${sharedItemsFromDoc(d).length} deadlines`].filter(Boolean).map(esc).join(' · ')}</div></div>
        ${icon('chevron-right', 14, 2)}
      </button>`).join('')
      : `<div class="sg-callout small"><div>No one has shared <strong>${esc(course)}</strong> at ${esc(school)} yet. Add the class and share it, and your classmates can join you.</div></div>`;
  } catch (e) { setBtnLoading(btn, false, 'Search'); console.warn(e); toast('Search didn’t work. Try again in a moment.', 'error'); }
}
async function openJoinClassFromResult(code) {
  try { const snap = await classesRef().doc(code).get(); if (snap.exists) showClassPreview(code, snap.data()); } catch { toast('Couldn’t open that class', 'error'); }
}
function showClassPreview(code, d) {
  const items = sharedItemsFromDoc(d);
  const exams = items.filter(i => i.type === 'exam').length;
  const meetings = validMeetings(d.meetings);
  const existing = activeCourses().find(c => c.sharedClass?.code === code);
  openModal(`
    <div class="modal-head"><h3>Join shared class</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="class-preview">
        <div class="sg-eyebrow">${[d.school, d.term, d.section ? `Section ${d.section}` : ''].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="class-preview-code">${esc(d.courseCode || 'Class')}</div>
        <div class="class-preview-name">${esc(d.name || '')}</div>
        ${d.instructor ? `<div class="small muted">${esc(d.instructor)}</div>` : ''}
        <div class="class-preview-stats">
          <div><strong>${items.length - exams}</strong><span>assignments</span></div>
          <div><strong>${exams}</strong><span>exams</span></div>
          <div><strong>${meetings.length}</strong><span>class times</span></div>
        </div>
        ${meetings.length ? `<div class="small muted">${meetings.map(m => `${DOW_NAMES[m.day]} ${fmtTime(m.start)}`).join(' · ')}</div>` : ''}
        <div class="small muted mt-8">Shared by ${esc(d.createdByName || 'a classmate')}</div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="clearPendingClass();closeModal()">Not now</button>${existing ? `<button class="btn btn-primary" onclick="closeModal();openCourse('${existing.id}')">Open your class</button>` : `<button class="btn btn-primary" id="jc-join" onclick="joinSharedClass('${code}')">Add to my semester</button>`}</div>
  `);
}
async function joinSharedClass(code) {
  const btn = $('#jc-join');
  setBtnLoading(btn, true);
  try {
    const snap = await classesRef().doc(code).get();
    if (!snap.exists) throw new Error('That class isn’t shared anymore.');
    const d = snap.data();
    const courseId = uid();
    const course = {
      id: courseId, semesterId: state.currentSemesterId, name: String(d.name || d.courseCode || 'Class').slice(0, 120), code: String(d.courseCode || '').slice(0, 30),
      instructor: String(d.instructor || '').slice(0, 80), location: String(d.location || '').slice(0, 80), color: nextCourseColor(), credits: 3,
      status: 'in-progress', requirementType: 'required', meetings: validMeetings(d.meetings), resources: [], syllabusRaw: '',
      sharedClass: { code, role: 'member', sharedBy: String(d.createdByName || '').slice(0, 60), syncedAt: d.updatedAt || Date.now(), meetingsHash: hashString(JSON.stringify(validMeetings(d.meetings))), detailsHash: hashString(JSON.stringify(sharedDetails(d.details))) },
      details: sharedDetails(d.details),
    };
    state.courses.push(course);
    sharedItemsFromDoc(d).forEach(i => state.assignments.push({
      id: uid(), courseId, title: i.title, type: i.type, dueDate: i.dueDate, dueTime: i.dueTime, startByDate: null, maxPoints: null, earnedPoints: null,
      status: 'not-started', rubric: [], notes: '', attachments: [], recurringTemplateId: null, shared: { code, id: i.id },
    }));
    classesRef().doc(code).collection('members').doc(_fbUser.uid).set({ joinedAt: Date.now() }).catch(() => {});
    clearPendingClass();
    closeModal();
    touch();
    openCourse(courseId);
    playUiSound('success');
    toast(`${course.code || course.name} added with ${sharedItemsFromDoc(d).length} deadlines`);
  } catch (e) {
    setBtnLoading(btn, false, 'Add to my semester');
    toast(e.message?.startsWith('That class') ? e.message : 'Couldn’t join. Check your connection and try again.', 'error');
  }
}

/* ── Keeping joined classes up to date ─────────────────────────── */
async function checkClassUpdates(courseId, manual = false) {
  const c = getCourse(courseId);
  const sc = c?.sharedClass;
  if (!sc || !cloudGroupsEnabled()) return;
  try {
    if (sc.role === 'owner') {
      const members = await classesRef().doc(sc.code).collection('members').get();
      if (sc.memberCount !== members.size) { sc.memberCount = members.size; save(); renderRemote(); }
      return;
    }
    const snap = await classesRef().doc(sc.code).get();
    if (!snap.exists) { if (manual) toast('This class isn’t being shared anymore.', 'info'); return; }
    const d = snap.data();
    if (!manual && (d.updatedAt || 0) <= (sc.syncedAt || 0)) return;
    const result = mergeSharedClass(c, d);
    closeModal();
    touch();
    if (result.added || result.changed || result.removed) toast(`${c.code || c.name} updated: ${[result.added ? `${result.added} new` : '', result.changed ? `${result.changed} changed` : '', result.removed ? `${result.removed} removed` : ''].filter(Boolean).join(', ')}`, 'info', 5000);
    else if (manual) toast('Already up to date');
  } catch (e) { if (manual) toast('Couldn’t check for updates', 'error'); }
}
function mergeSharedClass(course, d) {
  const sc = course.sharedClass;
  const items = sharedItemsFromDoc(d);
  const byId = new Map(items.map(i => [i.id, i]));
  let added = 0, changed = 0, removed = 0;
  const local = state.assignments.filter(a => a.courseId === course.id && a.shared?.code === sc.code);
  local.forEach(a => {
    const i = byId.get(a.shared.id);
    if (!i) {
      if (!isAssignmentDone(a)) { state.assignments = state.assignments.filter(x => x.id !== a.id); removed++; }
      else delete a.shared;
      return;
    }
    if (a.title !== i.title || a.type !== i.type || a.dueDate !== i.dueDate || a.dueTime !== i.dueTime) { Object.assign(a, { title: i.title, type: i.type, dueDate: i.dueDate, dueTime: i.dueTime }); changed++; }
    byId.delete(i.id);
  });
  byId.forEach(i => {
    state.assignments.push({ id: uid(), courseId: course.id, title: i.title, type: i.type, dueDate: i.dueDate, dueTime: i.dueTime, startByDate: null, maxPoints: null, earnedPoints: null, status: 'not-started', rubric: [], notes: '', attachments: [], recurringTemplateId: null, shared: { code: sc.code, id: i.id } });
    added++;
  });
  // Class times follow the shared class unless you've changed them yourself.
  const meetings = validMeetings(d.meetings);
  if (hashString(JSON.stringify(validMeetings(course.meetings))) === sc.meetingsHash) course.meetings = meetings;
  sc.meetingsHash = hashString(JSON.stringify(meetings));
  // Same for syllabus details: office hours and policies follow the shared class unless edited here.
  const incoming = sharedDetails(d.details);
  if (!sc.detailsHash || hashString(JSON.stringify(sharedDetails(course.details))) === sc.detailsHash) course.details = { ...incoming, ...(course.details?.showOfficeHours ? { showOfficeHours: true } : {}) };
  sc.detailsHash = hashString(JSON.stringify(incoming));
  if (d.instructor && !course.instructor) course.instructor = String(d.instructor).slice(0, 80);
  sc.syncedAt = d.updatedAt || Date.now();
  sc.sharedBy = String(d.createdByName || sc.sharedBy || '').slice(0, 60);
  return { added, changed, removed };
}
let _classSyncDone = false;
function syncSharedClasses() {
  if (_classSyncDone || !cloudGroupsEnabled()) return;
  _classSyncDone = true;
  activeCourses().filter(c => c.sharedClass).forEach(c => checkClassUpdates(c.id));
  handlePendingClass();
}

/* ── ?class=CODE invite links ──────────────────────────────────── */
function captureClassParam() {
  const params = new URLSearchParams(location.search);
  if (!params.has('class')) return;
  const code = normalizeCode(params.get('class'));
  params.delete('class');
  history.replaceState({}, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
  if (code.length === 6 && !isEmbedded()) try { localStorage.setItem(PENDING_CLASS_KEY, JSON.stringify({ code, at: Date.now() })); } catch {}
}
function pendingClassCode() { try { const p = JSON.parse(localStorage.getItem(PENDING_CLASS_KEY) || 'null'); return p?.code && Date.now() - p.at < 14 * 86400000 ? p.code : null; } catch { return null; } }
function clearPendingClass() { try { localStorage.removeItem(PENDING_CLASS_KEY); } catch {} }
let _classInviteShown = false;
async function handlePendingClass() {
  const code = pendingClassCode();
  if (!code || !fbConfigured()) return;
  if (!_fbUser) {
    if (_classInviteShown) return;
    _classInviteShown = true;
    openModal(`
      <div class="modal-head"><h3>A classmate shared a class with you</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
      <div class="modal-body"><p class="small muted">Log in or create your Semester HQ account to add it. You’ll get the class times and every deadline in one tap.</p></div>
      <div class="modal-foot"><button class="btn" onclick="closeModal()">Look around first</button><a class="btn btn-primary" href="login.html">Log in to add it</a></div>
    `);
    return;
  }
  if (!window._licensed) return;
  try { const snap = await classesRef().doc(code).get(); if (snap.exists) showClassPreview(code, snap.data()); else clearPendingClass(); } catch {}
}
