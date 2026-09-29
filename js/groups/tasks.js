/* ── Study group tasks: the shared board (Tier A item 9) ──────────
   The Tasks tab and everything that writes a task. Moved here from
   js/studygroups.js; the names are unchanged, so inline onclick strings
   and js/spaces/needs.js keep calling them.

   Top to bottom the tab is:
     1. Quick add: one field that reads "make quizlet fri @maya". The
        day and the person show as chips while you type (parseTaskAdd in
        js/quickparse.js), and each chip has an x to drop it.
     2. All | Mine | Unassigned, and a 20px ring with "3 of 7 done".
     3. Who finished something this week, faces with counts, in member
        order. Never ranked and never a zero: it is a thank-you, not a
        leaderboard (groupTaskCredits).
     4. The open tasks as one card of rows: check, title and chips, and
        the owner's face (a dashed + when nobody has it yet). The face
        opens a picker; the title opens the edit sheet.
     5. "Done (n)", a disclosure.

   Owners who left: a task whose assignee is no longer in memberUids
   belongs to nobody (taskOwner). taskList in js/groups/sync.js applies
   it, so the Unassigned filter, "I'll take it", the home card and the
   needs strip all agree. Leaving or removing someone also clears their
   tasks and upcoming RSVPs in the same write (groupDepartureOps).

   Writes only fields that already exist on taskItems.{id}: title, due,
   label, assignee, assigneeName, done, doneBy, doneAt. Every write to
   an existing task checks it is still there first, so a task someone
   else just deleted is never brought back as an empty stub.

   Per-device, in memory only: _taskQa (dismissed chips), _taskPending
   (a check-off waiting for its animation), _taskDoneOpen, _taskSheet,
   _taskJustAdded.
──────────────────────────────────────────────────────────────── */
const TASK_TITLE_MAX = 200;
const TASK_LABEL_MAX = 40;
// A checked task strikes through, then slides into Done.
const TASK_DONE_DELAY = 900;
const TASK_WEEK_MS = 7 * 86400000;
let _taskQa = { code: null, ignore: [] };
const _taskPending = new Set();
const _taskDoneOpen = {};
let _taskSheet = null;
let _taskJustAdded = null;

/* ── Owners ────────────────────────────────────────────────────── */
// The task's owner if they are still in the group, else null. While a
// group is still loading (no member list yet) the stored owner stands.
function taskOwner(g, t) {
  if (!t || !t.assignee) return null;
  const members = g?.memberUids;
  if (!Array.isArray(members) || !members.length) return t.assignee;
  return members.includes(t.assignee) ? t.assignee : null;
}
// Me first, then everyone else in member order, then nobody.
function taskAssignOptions(g) {
  const u = myUidFor(g);
  const people = groupPeople(g);
  const me = people.find(p => p.uid === u);
  return [
    ...(me ? [{ uid: u, label: 'Me', name: me.name }] : []),
    ...people.filter(p => p.uid !== u).map(p => ({ uid: p.uid, label: p.name, name: p.name })),
    { uid: '', label: 'Nobody', name: '' },
  ];
}
function taskFace(g, uid, size = 28) {
  if (!uid) return `<span class="sg-tface-none" style="width:${size}px;height:${size}px" aria-hidden="true">${icon('plus', Math.round(size * 0.5), 2)}</span>`;
  return personAvatar(uid, personName(g, uid), size, personColor(g, uid));
}
function taskFirstName(g, uid) {
  if (uid === myUidFor(g)) return 'You';
  return String(personName(g, uid)).trim().split(/\s+/)[0] || 'Member';
}

/* ── Credit ────────────────────────────────────────────────────── */
// Done tasks since `since`, credited to the owner if they are still in
// the group, else to whoever checked it off if they are. Current members
// only, in member order, nobody with zero. Legacy tasks that only carry
// a doneByName are skipped. -> [{ uid, name, n }]
function groupTaskCredits(g, { since = 0 } = {}) {
  const members = new Set(g?.memberUids || []);
  const counts = {};
  Object.values(g?.taskItems || {}).forEach(t => {
    if (!t || !t.done || !t.title || !((t.doneAt || 0) >= since)) return;
    const who = taskOwner(g, t) || (members.has(t.doneBy) ? t.doneBy : null);
    if (who && members.has(who)) counts[who] = (counts[who] || 0) + 1;
  });
  return groupPeople(g).filter(p => counts[p.uid]).map(p => ({ uid: p.uid, name: p.name, n: counts[p.uid] }));
}
function groupTaskContribRow(g, total) {
  const credits = groupTaskCredits(g, { since: Date.now() - TASK_WEEK_MS });
  if (!credits.length) return total ? `<p class="sg-tcontrib is-quiet">Nothing checked off yet this week.</p>` : '';
  const label = `Done this week: ${credits.map(c => `${taskFirstName(g, c.uid)} ${c.n}`).join(', ')}`;
  return `
    <p class="sg-tcontrib" aria-label="${esc(label)}">
      ${credits.map(c => `<span class="sg-tcontrib-p" aria-hidden="true">${personAvatar(c.uid, c.name, 22, personColor(g, c.uid))}<span>${esc(taskFirstName(g, c.uid))}</span><span class="sg-tcontrib-n">${c.n}</span></span>`).join('')}
      <span class="sg-tcontrib-label" aria-hidden="true">done this week</span>
    </p>`;
}

/* ── Due dates ─────────────────────────────────────────────────── */
function taskDueChip(t) {
  if (!t.due || !/^\d{4}-\d{2}-\d{2}$/.test(t.due)) return '';
  const n = daysBetween(t.due);
  const short = fmtDate(t.due, { month: 'short', day: 'numeric' });
  if (!t.done && n < 0) return `<span class="sg-tchip is-over">${icon('flag', 12, 2)}Overdue · ${esc(short)}</span>`;
  const label = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n > 1 && n < 7 ? fmtDate(t.due, { weekday: 'short' }) : short;
  return `<span class="sg-tchip${n === 0 && !t.done ? ' is-today' : ''}">${esc(label)}</span>`;
}
// The edit sheet's day chips. Fri is the next Friday after today.
function taskDuePresets(now = new Date()) {
  const t = iso(now), dow = now.getDay();
  return [
    { key: 'none', label: 'No date', due: null },
    { key: 'today', label: 'Today', due: t },
    { key: 'tomorrow', label: 'Tomorrow', due: addDays(t, 1) },
    { key: 'fri', label: 'Fri', due: addDays(t, ((5 - dow + 7) % 7) || 7) },
    { key: 'nextweek', label: 'Next week', due: addDays(t, ((1 - dow + 7) % 7) || 7) },
  ];
}
function taskDueDesc(due) {
  if (!due) return 'No due date';
  const n = daysBetween(due);
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : fmtDate(due, { weekday: 'short', month: 'short', day: 'numeric' });
}

/* ── The tab ───────────────────────────────────────────────────── */
function groupTasksTab(g) {
  const u = myUidFor(g);
  const filter = ['all', 'mine', 'unassigned'].includes(state.groupTaskFilter) ? state.groupTaskFilter : 'all';
  const all = taskList(g);
  const match = t => filter === 'mine' ? t.assignee === u : filter === 'unassigned' ? !t.assignee : true;
  const open = all.filter(t => !t.done && match(t)).sort(byDueThenCreated);
  const done = all.filter(t => t.done && match(t)).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const doneCount = all.filter(t => t.done).length;
  const filteredEmpty = filter === 'mine'
    ? `Nothing on your plate. ${all.some(t => !t.done && !t.assignee) ? `<button class="sg-link" onclick="setState({groupTaskFilter:'unassigned'})">See what’s up for grabs</button>` : ''}`
    : filter === 'unassigned' ? 'Every open task has someone on it.' : 'All caught up. Nice work, everyone.';
  const list = all.length ? `
    <div class="sg-toolbar sg-ttools">
      <div class="segmented" role="group" aria-label="Show tasks">${[['all', 'All'], ['mine', 'Mine'], ['unassigned', 'Unassigned']].map(([k, l]) => `<button class="${filter === k ? 'active' : ''}" aria-pressed="${filter === k}" onclick="setState({groupTaskFilter:'${k}'})">${l}</button>`).join('')}</div>
      <div class="sg-tprogress">${taskRing(doneCount, all.length)}<span>${doneCount} of ${all.length} done</span></div>
    </div>
    ${groupTaskContribRow(g, all.length)}
    ${open.length ? `<div class="card sg-tlist">${open.map(t => groupTaskRow(g, t)).join('')}</div>` : `<div class="card sg-tlist sg-tlist-empty"><p>${filteredEmpty}</p></div>`}
    ${done.length ? `
      <details class="sg-tdone" ${_taskDoneOpen[g.code] ? 'open' : ''} ontoggle="_taskDoneOpen['${g.code}']=this.open">
        <summary>Done (${done.length})</summary>
        <div class="card sg-tlist">${done.map(t => groupTaskRow(g, t)).join('')}</div>
      </details>` : ''}`
    : emptyStateHtml({ icon: 'check-square', title: 'Split up the work', body: 'Add the first task above. Type a day like fri and @name to hand it to someone.' });
  _taskJustAdded = null;
  return `<div class="sg-tasks">${taskQuickAdd(g)}${list}</div>`;
}
function taskRing(done, total) {
  const r = 8, c = 2 * Math.PI * r, p = total ? done / total : 0;
  return `<svg class="sg-tring" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle class="sg-tring-track" cx="10" cy="10" r="${r}"/><circle class="sg-tring-fill" cx="10" cy="10" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - p)).toFixed(2)}" transform="rotate(-90 10 10)"/></svg>`;
}

// One row. compact is the old quiet row the group home's "Your tasks"
// card uses (js/groups/home.js); the board row is the default.
function groupTaskRow(g, t, { compact = false } = {}) {
  if (compact) {
    const overdue = !t.done && t.due && t.due < todayIso();
    const meta = t.due ? `<span class="${overdue ? 'sg-overdue' : ''}">${overdue ? 'Overdue, was due' : 'Due'} ${fmtSessionDay(t.due)}</span>` : '';
    return `
      <div class="list-row sg-task compact">
        <button type="button" class="row-check ${t.done ? 'checked' : ''}" role="checkbox" aria-checked="${!!t.done}" aria-label="Mark ${esc(t.title)} as ${t.done ? 'not done' : 'done'}" onclick="toggleGroupTask('${g.code}','${t.id}')">${t.done ? checkGlyph(true) : ''}</button>
        <div class="row-title">
          <div class="${t.done ? 'sg-done' : ''}">${esc(t.title)}${t.label ? ` <span class="tag sg-tag">${esc(t.label)}</span>` : ''}</div>
          ${meta ? `<div class="row-meta">${meta}</div>` : ''}
        </div>
      </div>`;
  }
  const u = myUidFor(g);
  const owner = taskOwner(g, t);
  const code = g.code;
  const chips = [
    taskDueChip(t),
    t.label ? `<span class="sg-tchip is-label">${esc(t.label)}</span>` : '',
    t.done ? `<span class="sg-tchip">Done by ${esc(t.doneBy ? taskFirstName(g, t.doneBy) : (t.doneByName || 'someone'))}</span>` : '',
    !t.done && !owner ? `<span class="sg-tchip is-grabs">Up for grabs</span>` : '',
  ].filter(Boolean).join('');
  const ownerName = owner ? (owner === u ? 'you' : personName(g, owner)) : '';
  return `
    <div class="sg-trow${t.done ? ' is-done' : ''}${_taskJustAdded === t.id ? ' is-new' : ''}" data-task="${esc(t.id)}">
      <button type="button" class="row-check sg-tcheck ${t.done ? 'checked' : ''}" role="checkbox" aria-checked="${!!t.done}" aria-label="Mark ${esc(t.title)} as ${t.done ? 'not done' : 'done'}" onclick="checkGroupTask('${code}','${t.id}',this)">${t.done ? checkGlyph(true, 14) : ''}</button>
      <button type="button" class="sg-tmain" onclick="openGroupTaskSheet('${code}','${t.id}')" aria-label="Edit ${esc(t.title)}">
        <span class="sg-ttitle">${esc(t.title)}</span>
        ${chips ? `<span class="sg-tmeta">${chips}</span>` : ''}
      </button>
      <div class="sg-tactions">
        ${!t.done && !owner ? `<button type="button" class="btn btn-sm sg-claim" onclick="setGroupTaskAssignee('${code}','${t.id}','${esc(u)}')">I’ll take it</button>` : ''}
        <button type="button" class="sg-tface" data-assignee="${esc(owner || '')}" aria-haspopup="menu" aria-expanded="false" aria-label="Assign ${esc(t.title)}${owner ? `, now ${esc(ownerName)}` : ', nobody yet'}" data-tip="${owner ? esc(owner === u ? 'Yours' : personName(g, owner)) : 'Assign'}" onclick="openTaskAssignMenu(this,'${code}','${t.id}')">${taskFace(g, owner, 28)}</button>
      </div>
    </div>`;
}

/* ── Quick add ─────────────────────────────────────────────────── */
function taskQuickAdd(g) {
  const prev = typeof document !== 'undefined' && document.getElementById ? document.getElementById('sg-task-title') : null;
  const draft = prev && typeof prev.value === 'string' ? prev.value : '';
  return `
    <div class="quick-add qa-smart sg-tqa">
      <div class="qa-row">
        <span class="quick-add-ic" aria-hidden="true">${icon('plus', 16)}</span>
        <input class="quick-add-input" id="sg-task-title" maxlength="${TASK_TITLE_MAX}" autocomplete="off" enterkeyhint="done" placeholder="Add a task" aria-label="Add a task" aria-describedby="sg-tqa-chips" oninput="taskQaPreview('${g.code}')" onkeydown="if(event.key==='Enter'&&!event.isComposing){event.preventDefault();addGroupTask('${g.code}')}">
        <button type="button" class="btn btn-primary btn-sm qa-add-btn" onclick="addGroupTask('${g.code}')">Add</button>
      </div>
      <div class="qa-preview sg-tqa-chips" id="sg-tqa-chips" aria-live="polite">${taskQaChipsHtml(g, draft)}</div>
    </div>`;
}
function taskQaParse(g, text) {
  if (_taskQa.code !== g.code) _taskQa = { code: g.code, ignore: [] };
  return parseTaskAdd(text, { people: groupPeople(g).map(p => ({ uid: p.uid, name: p.name })), meUid: myUidFor(g), ignore: _taskQa.ignore });
}
function taskQaChipsHtml(g, text) {
  if (!String(text || '').trim()) return `<span class="qa-hint">Try “make quizlet fri @maya”. The day and person fill in.</span>`;
  const p = taskQaParse(g, text);
  const x = (key, what) => `<button type="button" class="qa-chip-x" aria-label="Don’t use ${esc(what)}" onclick="taskQaDrop('${g.code}','${key}')">${icon('x', 10, 2.4)}</button>`;
  const parts = [];
  if (p.dueDate) parts.push(`<span class="qa-chip">${icon('calendar', 12, 1.9)}<span>${esc(taskDueDesc(p.dueDate))}</span>${x('date', taskDueDesc(p.dueDate))}</span>`);
  else parts.push(`<span class="qa-chip is-default">${icon('calendar', 12, 1.9)}<span>No due date</span></span>`);
  if (p.uid) {
    const who = p.uid === myUidFor(g) ? 'You' : p.name.split(' ')[0];
    parts.push(`<span class="qa-chip sg-qa-who">${personAvatar(p.uid, p.name, 16, personColor(g, p.uid))}<span>${esc(who)}</span>${x('who', who)}</span>`);
  } else if (p.ambiguous) parts.push(`<span class="qa-chip is-default">${icon('user-plus', 12, 1.9)}<span>More than one ${esc(p.token.slice(1))}, pick after adding</span></span>`);
  else parts.push(`<span class="qa-chip is-default">${icon('user-plus', 12, 1.9)}<span>Up for grabs</span></span>`);
  return `${p.title ? `<span class="qa-title">${esc(p.title)}</span>` : ''}${parts.join('')}`;
}
function taskQaPreview(code) {
  const g = findGroup(code), input = $('#sg-task-title'), box = $('#sg-tqa-chips');
  if (!g || !input || !box) return;
  if (!input.value.trim()) _taskQa = { code, ignore: [] };
  box.innerHTML = taskQaChipsHtml(g, input.value);
}
function taskQaDrop(code, key) {
  if (_taskQa.code !== code) _taskQa = { code, ignore: [] };
  if (!_taskQa.ignore.includes(key)) _taskQa.ignore.push(key);
  taskQaPreview(code);
  $('#sg-task-title')?.focus();
}
function addGroupTask(code) {
  const input = $('#sg-task-title');
  const text = input?.value.trim();
  const g = findGroup(code);
  if (!text || !g) { input?.focus(); return; }
  const p = taskQaParse(g, text);
  if (!p.title) { toast('Add a few words about the task too.', 'error'); input.focus(); return; }
  const id = uid();
  input.value = '';
  _taskQa = { code, ignore: [] };
  _taskJustAdded = id;
  groupWrite(code, { [`taskItems.${id}`]: { id, title: p.title.slice(0, TASK_TITLE_MAX), label: '', due: p.dueDate || null, assignee: p.uid || null, done: false, doneBy: null, doneAt: null, createdBy: myUidFor(g), createdAt: Date.now() } });
  setTimeout(() => { $('#sg-task-title')?.focus(); taskQaPreview(code); }, 40);
}

/* ── Checking off ──────────────────────────────────────────────── */
// The board's check: a small burst and a strike-through, then the row
// slides out and the write lands (the write re-renders the tab, so the
// motion has to come first). Unchecking writes at once. A second tap
// while it waits does nothing.
function checkGroupTask(code, id, btn) {
  const g = findGroup(code);
  const t = g?.taskItems?.[id];
  if (!t || _taskPending.has(id)) return;
  if (t.done) { setGroupTaskDone(code, id, false); return; }
  const row = btn?.closest?.('.sg-trow');
  const still = typeof availReducedMotion === 'function' ? availReducedMotion() : false;
  if (!row || still) { setGroupTaskDone(code, id, true); return; }
  _taskPending.add(id);
  btn.classList.add('checked', 'is-burst');
  btn.setAttribute('aria-checked', 'true');
  btn.innerHTML = checkGlyph(true, 14);
  row.classList.add('is-done', 'is-checking');
  if (typeof playUiSound === 'function') playUiSound('tap');
  setTimeout(() => row.classList.add('is-leaving'), TASK_DONE_DELAY - 260);
  setTimeout(() => { _taskPending.delete(id); setGroupTaskDone(code, id, true); }, TASK_DONE_DELAY);
}
// The home card, the dashboard widget and the needs strip call this.
function toggleGroupTask(code, id) {
  const t = findGroup(code)?.taskItems?.[id];
  if (t) setGroupTaskDone(code, id, !t.done);
}
function setGroupTaskDone(code, id, done) {
  const g = findGroup(code);
  const t = g?.taskItems?.[id];
  if (!t || !t.title) { render(); return; }
  if (!!t.done === done) return;
  groupWrite(code, { [`taskItems.${id}.done`]: done, [`taskItems.${id}.doneBy`]: done ? myUidFor(g) : null, [`taskItems.${id}.doneAt`]: done ? Date.now() : null });
}

/* ── Assigning ─────────────────────────────────────────────────── */
function openTaskAssignMenu(btn, code, id) {
  const g = findGroup(code);
  const t = g?.taskItems?.[id];
  if (!t) return;
  const owner = taskOwner(g, t) || '';
  const html = `<div class="menu-label">Who’s on it</div>${taskAssignOptions(g).map(o => `
    <button type="button" class="menu-item sg-tpick-item" role="menuitemradio" aria-checked="${o.uid === owner}" data-uid="${esc(o.uid)}" onclick="setGroupTaskAssignee('${code}','${id}','${esc(o.uid)}')">
      ${taskFace(g, o.uid, 22)}<span class="sg-tpick-name">${esc(o.label)}</span>${o.uid === owner ? icon('check', 14, 2.2) : ''}
    </button>`).join('')}`;
  const el = openMenu(btn, html);
  if (!el) return;
  el.classList.add('sg-tpick');
  (el.querySelector('[aria-checked="true"]') || el.querySelector('.menu-item'))?.focus();
}
async function setGroupTaskAssignee(code, id, assignee) {
  const g = findGroup(code);
  const t = g?.taskItems?.[id];
  if (!t || !t.title) { toast('That task was just removed.', 'error'); return; }
  const next = assignee || null;
  if (taskOwner(g, t) === next && t.assignee === next) return;
  const claimed = next && next === myUidFor(g) && !taskOwner(g, t);
  if (await groupWrite(code, { [`taskItems.${id}.assignee`]: next, [`taskItems.${id}.assigneeName`]: '' }) && claimed) toast(`“${t.title}” is yours`);
}
function deleteGroupTask(code, id) {
  if (!findGroup(code)?.taskItems?.[id]) return;
  groupWrite(code, { [`taskItems.${id}`]: GW_DELETE });
}

/* ── The edit sheet ────────────────────────────────────────────── */
// A dialog on desktop; below 760px every #modal is already a bottom
// sheet (css/styles.css). Save writes only what changed.
function openGroupTaskSheet(code, id) {
  const g = findGroup(code);
  const t = g?.taskItems?.[id];
  if (!t) return;
  const owner = taskOwner(g, t) || '';
  _taskSheet = { code, id, due: t.due || null, assignee: owner };
  const presets = taskDuePresets();
  const hit = presets.find(p => p.due === (t.due || null));
  const picked = !hit;
  openModal(`
    <div class="modal-head"><h3>Edit task</h3>${closeXButton()}</div>
    <div class="modal-body sg-tsheet">
      <div class="field"><label for="sg-ts-title">Task</label><input class="input" id="sg-ts-title" maxlength="${TASK_TITLE_MAX}" value="${esc(t.title)}" onkeydown="if(event.key==='Enter'&&!event.isComposing){event.preventDefault();saveGroupTaskSheet()}"></div>
      <div class="field">
        <span class="sg-ts-label" id="sg-ts-due-l">Due</span>
        <div class="chip-row sg-ts-chips" role="radiogroup" aria-labelledby="sg-ts-due-l" onkeydown="taskRadioKey(event)">
          ${presets.map(p => `<button type="button" class="chip" role="radio" aria-checked="${!picked && hit.key === p.key}" tabindex="${!picked && hit.key === p.key ? 0 : -1}" data-due="${p.due || ''}" onclick="taskSheetDue(this)">${esc(p.label)}</button>`).join('')}
          <button type="button" class="chip" role="radio" aria-checked="${picked}" tabindex="${picked ? 0 : -1}" data-due="pick" onclick="taskSheetDue(this)">${icon('calendar', 14)}${picked ? esc(fmtDate(t.due, { month: 'short', day: 'numeric' })) : 'Pick'}</button>
        </div>
        <input class="input sg-ts-date" type="date" id="sg-ts-date" aria-label="Pick a due date" value="${esc(picked ? t.due : '')}" ${picked ? '' : 'hidden'} onchange="_taskSheet && (_taskSheet.due = this.value || null)">
      </div>
      <div class="field"><label for="sg-ts-labelin">Label <span class="muted">(optional)</span></label><input class="input" id="sg-ts-labelin" maxlength="${TASK_LABEL_MAX}" value="${esc(t.label || '')}" placeholder="Like “chapter 8” or “slides”"></div>
      <div class="field">
        <span class="sg-ts-label" id="sg-ts-who-l">Who’s on it</span>
        <div class="sg-ts-faces" role="radiogroup" aria-labelledby="sg-ts-who-l" onkeydown="taskRadioKey(event)">
          ${taskAssignOptions(g).map(o => `<button type="button" class="sg-ts-face" role="radio" aria-checked="${o.uid === owner}" tabindex="${o.uid === owner ? 0 : -1}" data-uid="${esc(o.uid)}" onclick="taskSheetWho(this)">${taskFace(g, o.uid, 32)}<span>${esc(o.uid && o.label !== 'Me' ? o.label.split(' ')[0] : o.label)}</span></button>`).join('')}
        </div>
      </div>
      <button type="button" class="btn btn-ghost btn-sm sg-ts-delete" onclick="confirmDeleteGroupTask('${code}','${id}')">${icon('trash', 14)} Delete task</button>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveGroupTaskSheet()">Save</button>
    </div>`, { onClose: () => { _taskSheet = null; } });
}
// Arrow keys move through a radio row of chips or faces.
function taskRadioKey(e) {
  const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  if (!(e.key in keys)) return;
  const list = [...e.currentTarget.querySelectorAll('[role="radio"]')];
  const i = list.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  const next = list[(i + keys[e.key] + list.length) % list.length];
  next.focus();
  next.click();
}
function taskRadioPick(btn) {
  btn.parentElement.querySelectorAll('[role="radio"]').forEach(b => { const on = b === btn; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
}
function taskSheetDue(btn) {
  if (!_taskSheet) return;
  taskRadioPick(btn);
  const date = $('#sg-ts-date');
  if (btn.dataset.due === 'pick') {
    date.hidden = false;
    _taskSheet.due = date.value || _taskSheet.due;
    if (!date.value && _taskSheet.due) date.value = _taskSheet.due;
    setTimeout(() => { date.focus(); try { date.showPicker?.(); } catch {} }, 30);
  } else {
    date.hidden = true;
    _taskSheet.due = btn.dataset.due || null;
  }
}
function taskSheetWho(btn) {
  if (!_taskSheet) return;
  taskRadioPick(btn);
  _taskSheet.assignee = btn.dataset.uid || '';
}
async function saveGroupTaskSheet() {
  const sh = _taskSheet;
  if (!sh) { closeModal(); return; }
  const g = findGroup(sh.code);
  const t = g?.taskItems?.[sh.id];
  if (!t || !t.title) { closeModal(); toast('That task was just removed.', 'error'); return; }
  const title = ($('#sg-ts-title')?.value || '').trim().slice(0, TASK_TITLE_MAX);
  if (!title) { toast('The task needs a name', 'error'); $('#sg-ts-title')?.focus(); return; }
  const label = ($('#sg-ts-labelin')?.value || '').trim().slice(0, TASK_LABEL_MAX);
  const due = /^\d{4}-\d{2}-\d{2}$/.test(sh.due || '') ? sh.due : null;
  const ops = {};
  const p = `taskItems.${sh.id}`;
  if (title !== t.title) ops[`${p}.title`] = title;
  if (label !== (t.label || '')) ops[`${p}.label`] = label;
  if (due !== (t.due || null)) ops[`${p}.due`] = due;
  if ((sh.assignee || null) !== taskOwner(g, t)) { ops[`${p}.assignee`] = sh.assignee || null; ops[`${p}.assigneeName`] = ''; }
  closeModal();
  if (!Object.keys(ops).length) return;
  if (await groupWrite(sh.code, ops)) toast('Task updated');
}
function confirmDeleteGroupTask(code, id) {
  const t = findGroup(code)?.taskItems?.[id];
  if (!t) { closeModal(); return; }
  confirmDialog(`Delete “${t.title}” for everyone in the group?`, () => deleteGroupTask(code, id), 'Delete task', 'Delete this task?');
}

/* ── Someone leaves ────────────────────────────────────────────── */
// Extra ops for the leave or remove write: their tasks go back up for
// grabs, and their answers to upcoming sessions are dropped (past ones
// stay, so who came is not rewritten). Deletes, never null, so a task
// deleted at the same moment is not brought back.
function groupDepartureOps(g, who) {
  const ops = {};
  if (!g || !who) return ops;
  Object.values(g.taskItems || {}).forEach(t => {
    if (t && safeId(t.id) && t.assignee === who) { ops[`taskItems.${t.id}.assignee`] = GW_DELETE; ops[`taskItems.${t.id}.assigneeName`] = GW_DELETE; }
  });
  upcomingSessions(g).forEach(s => { if (s.rsvp && Object.prototype.hasOwnProperty.call(s.rsvp, who)) ops[`sessions.${s.id}.rsvp.${who}`] = GW_DELETE; });
  return ops;
}
