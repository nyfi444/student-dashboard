/* ── Calendar: month / week / day + time blocking ────────────────── */
const CAL_HOURS = Array.from({ length: 16 }, (_, i) => i + 7); // 7am–10pm

// The page head keeps only what adds things (Breaks, + Time block). The
// period being shown is the headline of the calendar itself, with the view
// switch and the arrows on the same line, so on a phone the head doesn't
// wrap into three rows of buttons before the grid even starts.
function pageCalendar() {
  const v = state.calView;
  const has = calendarHasAnything();
  const views = ['year', 'month', 'week', 'day'];
  return `
    ${pageHead('Calendar', has ? calUpcomingSummary() : '', `
      <button class="btn btn-sm" onclick="openBreaksModal()">${icon('flag', 13, 2)} Breaks</button>
      <button class="btn btn-primary" onclick="openEventModal(null,'${state.calDate}')">+ Time block</button>
    `)}
    ${!has ? `<div class="mb-16">${emptyStateHtml({
      icon: 'calendar',
      title: 'Nothing on the calendar yet',
      body: 'Add your classes and every meeting time, deadline, and exam lands here, next to any time you block out for yourself.',
      actions: [{ label: 'Set up my semester', onclick: 'openSemesterSetup()', icon: 'sparkles' }, { label: '+ Time block', onclick: `openEventModal(null,'${state.calDate}')` }],
    })}</div>` : ''}
    <div class="cal-toolbar">
      <h3 class="cal-title">${calTitleHtml(v)}</h3>
      <div class="cal-controls">
        <span class="cal-stepper">
          <button class="btn btn-sm btn-icon" aria-label="Previous ${v}" onclick="calNav(-1)">${icon('chevron-left', 15, 2)}</button>
          <button class="btn btn-sm" onclick="calToday()">Today</button>
          <button class="btn btn-sm btn-icon" aria-label="Next ${v}" onclick="calNav(1)">${icon('chevron-right', 15, 2)}</button>
        </span>
        <div class="segmented cal-views" role="group" aria-label="Calendar view">
          ${views.map(x => `<button class="${v === x ? 'active' : ''}" aria-pressed="${v === x}" onclick="setCalView('${x}')">${x[0].toUpperCase() + x.slice(1)}</button>`).join('')}
        </div>
      </div>
    </div>
    <div id="cal-body">${v === 'year' ? yearView() : v === 'month' ? monthView() : v === 'week' ? weekView() : dayView()}</div>
    ${has ? `<div class="cal-foot">
      ${v !== 'year' ? calLegend() : '<span></span>'}
      <div class="small muted cal-hint">${v === 'year' ? 'Click a month name to open it, or a day to jump straight to it.' : `<span class="hint-mouse">Drag a to-do or assignment onto a day to reschedule it, or onto an hour to plan when you’ll work on it.</span><span class="hint-touch">Tap a day to see it hour by hour. Tap anything to change its date or time.</span>`}</div>
    </div>` : ''}
  `;
}
// The headline: "September 2026", "Sep 27 – Oct 3 2026", "Monday, September 28".
// The italic part is the one rose word the brand allows, at display size.
function calTitleHtml(v) {
  const d = new Date(state.calDate + 'T00:00:00');
  if (v === 'year') return String(d.getFullYear());
  if (v === 'month') return `${d.toLocaleDateString('en-US', { month: 'long' })} <em>${d.getFullYear()}</em>`;
  if (v === 'day') return `${d.toLocaleDateString('en-US', { weekday: 'long' })}, <em>${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</em>`;
  const s = startOfWeek(state.calDate), e = new Date(s + 'T00:00:00'); e.setDate(e.getDate() + 6);
  return `${fmtDate(s)} – ${fmtDate(iso(e))} <em>${e.getFullYear()}</em>`;
}
// Under the page title: what's actually coming, not a restated date.
function calUpcomingSummary() {
  let deadlines = 0, exams = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(todayIso() + 'T00:00:00'); d.setDate(d.getDate() + i);
    deadlines += deadlinesOnDate(iso(d)).length; exams += examsOnDate(iso(d)).length;
  }
  if (!deadlines && !exams) return 'Nothing due in the next 7 days';
  const parts = [deadlines && `${deadlines} deadline${deadlines === 1 ? '' : 's'}`, exams && `${exams} exam${exams === 1 ? '' : 's'}`].filter(Boolean);
  return `${parts.join(' and ')} in the next 7 days`;
}
// Every class color is named, and every kind of event has a shape as well as
// a color, so the calendar never relies on color alone (WCAG 1.4.1).
function calLegend() {
  const classes = activeCourses();
  return `<div class="cal-legend" aria-label="Calendar key">
    ${classes.map(c => `<span class="cal-key"><i style="--c:${c.color}"></i>${esc(c.code || c.name)}</span>`).join('')}
    ${classes.length ? '<span class="cal-legend-sep" aria-hidden="true"></span>' : ''}
    <span class="cal-key"><span class="bar"></span>Class</span>
    <span class="cal-key"><span class="bar dashed"></span>Deadline</span>
    <span class="cal-key">${icon('flag', 12, 2.2)}Exam</span>
    <span class="cal-key">${icon('check-square', 12, 2.2)}To-do</span>
  </div>`;
}
// Before the first class or deadline is in, the grid is a wall of empty
// boxes with nothing to say, so the page leads with the empty state instead
// of the drag-to-reschedule hint. Anything that can put something on a day
// counts, including a club or group joined before any classes were added.
function calendarHasAnything() {
  if (activeCourses().length || state.events.length || state.assignments.length || state.breaks.length) return true;
  if (state.todos.some(t => t.dueDate)) return true;
  if ((state.applications || []).length) return true;
  if (typeof allGroups === 'function' && allGroups().length) return true;
  if (typeof allOrgs === 'function' && allOrgs().length) return true;
  return false;
}
function isBreakDate(dIso) { return state.breaks.some(b => dIso >= b.startDate && dIso <= b.endDate); }
function breakOnDate(dIso) { return state.breaks.find(b => dIso >= b.startDate && dIso <= b.endDate); }
function openBreaksModal() {
  openModal(`
    <div class="modal-head"><h3>School breaks / no-class days</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="small muted mb-8">Class meetings are hidden on these dates: Labor Day, Fall Break, Thanksgiving, Reading Day, etc.</div>
      <div id="brk-list">${state.breaks.map((b, i) => breakRow(b, i)).join('') || '<div class="small muted mb-8">No breaks added yet.</div>'}</div>
      <div class="field-row mt-8" style="align-items:flex-end">
        <div class="field"><label for="brk-name">Name</label><input class="input" id="brk-name" placeholder="Thanksgiving Break"></div>
        <div class="field"><label for="brk-start">First day</label><input class="input" type="date" id="brk-start"></div>
        <div class="field"><label for="brk-end">Last day</label><input class="input" type="date" id="brk-end"></div>
        <button class="btn btn-sm" style="margin-bottom:12px" onclick="addBreak()">+ Add</button>
      </div>
    </div>
    <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">Done</button></div>
  `, { wide: true });
}
function breakRow(b, i) {
  return `<div class="list-row"><div class="row-title">${esc(b.name)}</div><div class="row-meta">${fmtDate(b.startDate)} – ${fmtDate(b.endDate)}</div><button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove break" onclick="removeBreak(${i})">${icon('x',13,2.2)}</button></div>`;
}
function addBreak() {
  const name = $('#brk-name').value.trim();
  const startDate = $('#brk-start').value, endDate = $('#brk-end').value || startDate;
  if (!name || !startDate) { toast('Name and start date are required', 'error'); return; }
  state.breaks.push({ id: uid(), name, startDate, endDate });
  touch(); openBreaksModal();
}
function removeBreak(i) { state.breaks.splice(i, 1); touch(); openBreaksModal(); }

/* ── Drag-and-drop rescheduling + time blocking ──────────────────
   Draggable rows (todos/assignments elsewhere) set window._dragItem
   on dragstart; calendar drop targets read it on drop. ───────────── */
function dragStartItem(ev, kind, id) {
  window._dragItem = { kind, id };
  ev.dataTransfer.effectAllowed = 'move';
}
function allowDrop(ev) { ev.preventDefault(); }
function dropRescheduleOnDate(ev, dIso) {
  ev.preventDefault();
  const item = window._dragItem;
  if (!item) return;
  if (item.kind === 'todo') { const t = state.todos.find(x => x.id === item.id); if (t) t.dueDate = dIso; }
  else if (item.kind === 'assignment') { const a = state.assignments.find(x => x.id === item.id); if (a) a.dueDate = dIso; }
  window._dragItem = null;
  touch();
  toast('Rescheduled to ' + fmtDate(dIso));
}
function dropTimeBlockOnSlot(ev, dIso, hour) {
  ev.preventDefault();
  const item = window._dragItem;
  if (!item) return;
  const start = `${String(hour).padStart(2, '0')}:00`;
  const end = `${String(hour + 1).padStart(2, '0')}:00`;
  let title = 'Planned work', courseId = null, color = '#000000';
  if (item.kind === 'todo') { const t = state.todos.find(x => x.id === item.id); if (!t) return; title = t.title; courseId = t.courseId; }
  else if (item.kind === 'assignment') { const a = state.assignments.find(x => x.id === item.id); if (!a) return; title = a.title; courseId = a.courseId; }
  if (courseId) color = getCourseColor(courseId);
  state.events.push({ id: uid(), title, date: dIso, startTime: start, endTime: end, courseId, type: 'block', color, linkedTodoId: item.kind === 'todo' ? item.id : null, linkedAssignmentId: item.kind === 'assignment' ? item.id : null });
  window._dragItem = null;
  touch();
  toast(`Blocked ${fmtTime(start)}–${fmtTime(end)} for "${title}"`);
}
// Dragging something onto an hour slot leaves a planned-work block behind that
// points back at it (linkedAssignmentId / linkedTodoId). Deleting the item used
// to leave those blocks sitting on the calendar forever, pointing at nothing:
// "Lab report 3" still blocked out Thursday afternoon for an assignment that no
// longer exists. This clears them out, and hands them back so Undo restores the
// plan along with the item. Changing a due date deliberately leaves them alone
// — when you work on something is your call, not the deadline's.
function dropLinkedBlocks(kind, ids) {
  const set = new Set(ids);
  const key = kind === 'todo' ? 'linkedTodoId' : 'linkedAssignmentId';
  const removed = state.events.filter(e => set.has(e[key]) || (kind === 'assignment' && set.has(e.linkedExamId)));
  if (removed.length) state.events = state.events.filter(e => !removed.includes(e));
  return removed;
}
function restoreLinkedBlocks(blocks) { if (blocks && blocks.length) state.events.push(...blocks); }

function setCalView(v) { setState({ calView: v }); }
function calToday() { setState({ calDate: todayIso() }); }
function calNav(dir) {
  const v = state.calView;
  const d = v === 'year' ? yearShift(state.calDate, dir) : v === 'month' ? monthShift(state.calDate, dir) : addDays(state.calDate, dir * (v === 'week' ? 7 : 1));
  setState({ calDate: d });
}
function monthShift(isoStr, dir) { const d = new Date(isoStr + 'T00:00:00'); d.setMonth(d.getMonth() + dir); return iso(d); }
function yearShift(isoStr, dir) { const d = new Date(isoStr + 'T00:00:00'); d.setFullYear(d.getFullYear() + dir); return iso(d); }

function meetingsOnDate(dateIso) {
  if (isBreakDate(dateIso)) return [];
  const dow = new Date(dateIso + 'T00:00:00').getDay();
  const sem = currentSemester();
  if (sem && (dateIso < sem.startDate || dateIso > sem.endDate)) return [];
  return activeCourses().flatMap(c => c.meetings.filter(m => m.day === dow).map(m => ({ ...m, course: c, id: `m-${c.id}-${m.day}-${m.start}`, title: c.name, color: c.color, kind: 'class' })));
}
// Time blocks are stored with startTime/endTime, but the week and day views
// position everything by start/end. Without mapping them, a time block never
// appeared on either view (only in Month, which doesn't need a time).
function customEventsOnDate(dateIso) { return state.events.filter(e => e.date === dateIso).map(e => ({ ...e, start: e.startTime || null, end: e.endTime || null, color: e.color || getCourseColor(e.courseId), kind: 'custom' })); }
// An assignment with no class attached is still real work with a real deadline:
// the Assignments page lists it, the Heads up bell counts it, and the dashboard
// shows it. The calendar used to require a matching active course, so anything
// filed under "No course" silently never appeared on any day, and editing its
// due date looked like it did nothing. Same scope rule as reminders.js and
// dashboard.js: keep it unless it belongs to a course from another semester.
function calInScope(a) { return !a.courseId || activeCourses().some(c => c.id === a.courseId); }
function examsOnDate(dateIso) { return state.assignments.filter(a => a.type === 'exam' && a.dueDate === dateIso && calInScope(a)).map(a => ({ id: a.id, title: a.title, start: a.dueTime || '09:00', end: null, color: getCourseColor(a.courseId), kind: 'exam', action: `openExamPrep('${a.id}')` })); }
function deadlinesOnDate(dateIso) { return state.assignments.filter(a => a.type !== 'exam' && a.dueDate === dateIso && calInScope(a)).map(a => ({ id: a.id, title: a.title, start: a.dueTime || null, end: null, color: getCourseColor(a.courseId), kind: 'deadline', action: `openAssignmentModal('${a.id}')` })); }
// To-dos carry a due date and an optional time exactly like assignments do, but
// they were never collected here, so a to-do due Friday appeared nowhere on the
// calendar and rescheduling one looked like it hadn't saved. Finished ones stay
// off: the calendar is for what's still ahead.
function todosOnDate(dateIso) { return state.todos.filter(x => !x.done && x.dueDate === dateIso).map(x => ({ id: x.id, title: x.title, start: x.dueTime || null, end: null, color: getCourseColor(x.courseId), kind: 'todo', action: `openTodoModal('${x.id}')` })); }
function itemsOnDate(dateIso) {
  return [...meetingsOnDate(dateIso), ...customEventsOnDate(dateIso), ...examsOnDate(dateIso), ...deadlinesOnDate(dateIso), ...todosOnDate(dateIso), ...groupSessionsOnDate(dateIso), ...careerItemsOnDate(dateIso),
    ...officeHoursOnDate(dateIso), ...projectMilestonesOnDate(dateIso), ...orgEventsOnDate(dateIso)].sort((a, b) => (a.start || '').localeCompare(b.start || ''));
}
const KIND_ICON = { exam: 'flag', deadline: 'clipboard-list', todo: 'check-square', group: 'users', career: 'briefcase', office: 'clock', milestone: 'folder', org: 'shield' };

function yearView() {
  const year = new Date(state.calDate + 'T00:00:00').getFullYear();
  return `<div class="cal-year-grid">${Array.from({ length: 12 }, (_, m) => miniMonth(year, m)).join('')}</div>`;
}
function miniMonth(year, month) {
  const first = new Date(year, month, 1);
  const gridStart = new Date(first); gridStart.setDate(first.getDate() - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  const now = new Date(todayIso() + 'T00:00:00');
  const current = now.getFullYear() === year && now.getMonth() === month;
  return `
    <div class="cal-mini-month ${current ? 'current' : ''}">
      <div class="cal-mini-month-head" role="button" tabindex="0" onclick="jumpToMonth(${year},${month})" onkeydown="calKey(event,()=>jumpToMonth(${year},${month}))">${first.toLocaleDateString('en-US', { month: 'long' })}</div>
      <div class="cal-mini-dow">${DOW_NAMES.map(d => `<span>${d[0]}</span>`).join('')}</div>
      <div class="cal-mini-grid">
        ${cells.map(d => {
          const dIso = iso(d);
          const muted = d.getMonth() !== month;
          const isToday = dIso === todayIso();
          const items = muted ? [] : itemsOnDate(dIso);
          const hasExam = items.some(it => it.kind === 'exam');
          return `<div class="cal-mini-cell ${muted ? 'muted' : ''} ${isToday ? 'today' : ''}" onclick="event.stopPropagation();jumpToDay('${dIso}')" title="${esc(items.map(it => it.title).join(', '))}">
            <span>${d.getDate()}</span>
            ${items.length ? `<span class="cal-mini-dot ${hasExam ? 'exam' : ''}"></span>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}
function jumpToDay(dIso) { setState({ calDate: dIso, calView: 'day' }); }
function jumpToMonth(year, month) { setState({ calDate: iso(new Date(year, month, 1)), calView: 'month' }); }
// Enter or Space on something that behaves like a button but isn't one.
function calKey(ev, fn) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); fn(); } }

// A month cell has room for three labels, and a class that meets every
// Monday is the least news on any given day, so the three shown are the
// most important: exams, then deadlines, then to-dos and the rest, then
// class meetings, each in time order.
const CAL_RANK = { exam: 0, deadline: 1, todo: 2, class: 4 };
const calRank = it => CAL_RANK[it.kind] ?? 3;
function calShortTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h >= 12 ? 'p' : 'a'}`;
}
function calEvtHtml(it, attrs = '') {
  const ic = KIND_ICON[it.kind] ? `<span class="cal-evt-ic">${icon(KIND_ICON[it.kind], 10, 2.2)}</span>` : '';
  // 11:59 PM is "due that day", the default for most deadlines; printing it
  // on every one only takes room from the title.
  const time = it.start && it.start < '23:30' ? `<span class="cal-evt-time">${calShortTime(it.start)}</span>` : '';
  return `<div class="cal-evt kind-${it.kind}" style="--c:${it.color}" ${attrs} title="${esc(it.title)}">${ic}${time}<span class="cal-evt-title">${esc(it.title)}</span></div>`;
}

function monthView() {
  const d0 = new Date(state.calDate + 'T00:00:00');
  const first = new Date(d0.getFullYear(), d0.getMonth(), 1);
  const gridStart = new Date(first); gridStart.setDate(first.getDate() - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  return `
    <div class="cal-sheet">
      <div class="cal-grid" aria-hidden="true">${DOW_NAMES.map((d, i) => `<div class="cal-dow ${i === 0 || i === 6 ? 'weekend' : ''}">${d}</div>`).join('')}</div>
      <div class="cal-grid cal-month">
        ${cells.map(d => {
          const dIso = iso(d);
          const items = itemsOnDate(dIso).sort((a, b) => calRank(a) - calRank(b) || (a.start || '').localeCompare(b.start || ''));
          const muted = d.getMonth() !== d0.getMonth();
          const isToday = dIso === todayIso();
          const weekend = d.getDay() === 0 || d.getDay() === 6;
          const brk = breakOnDate(dIso);
          const label = `${fmtDateLong(dIso)}${isToday ? ', today' : ''}${brk ? `, ${brk.name}` : ''}${items.length ? `, ${items.length} item${items.length === 1 ? '' : 's'}: ${items.map(it => it.title).join(', ')}` : ''}`;
          return `<div class="cal-cell ${muted ? 'muted' : ''} ${isToday ? 'today' : ''} ${weekend ? 'weekend' : ''} ${brk ? 'break' : ''}" role="button" tabindex="0" aria-label="${esc(label)}" onclick="openDayFromMonth('${dIso}')" onkeydown="calKey(event,()=>openDayFromMonth('${dIso}'))" ondragover="allowDrop(event)" ondrop="dropRescheduleOnDate(event,'${dIso}')">
            <div class="d-num">${d.getDate()}</div>
            ${brk ? `<div class="cal-break-label">${esc(brk.name)}</div>` : ''}
            <div class="cal-dots">${items.slice(0, 3).map(it => calEvtHtml(it)).join('')}</div>
            ${items.length > 3 ? `<div class="cal-more">+${items.length - 3}<span class="cal-more-word"> more</span></div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}
function openDayFromMonth(dIso) { setState({ calDate: dIso, calView: 'day' }); }

function hourLabel(h) { return `${h % 12 || 12} ${h >= 12 ? 'PM' : 'AM'}`; }
function hourLabels() { return `<div>${CAL_HOURS.map(h => `<div class="cal-hour-label"><span>${hourLabel(h)}</span></div>`).join('')}</div>`; }

function weekView() {
  const start = new Date(startOfWeek(state.calDate) + 'T00:00:00');
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  return `
    <div class="cal-sheet cal-time">
      <div class="cal-week-grid cal-week-head">
        <div></div>
        ${days.map(d => { const dIso = iso(d), wk = d.getDay() === 0 || d.getDay() === 6;
          return `<div class="cal-wd ${dIso === todayIso() ? 'today' : ''} ${wk ? 'weekend' : ''}" role="button" tabindex="0" aria-label="Open ${esc(fmtDateLong(dIso))}" onclick="jumpToDay('${dIso}')" onkeydown="calKey(event,()=>jumpToDay('${dIso}'))"><span class="cal-wd-dow">${DOW_NAMES[d.getDay()]}</span><span class="cal-wd-num">${d.getDate()}</span></div>`; }).join('')}
      </div>
      ${allDayStrip(days.map(iso))}
      <div class="cal-week-grid" style="position:relative">
        ${hourLabels()}
        ${days.map(d => weekDayColumn(iso(d))).join('')}
      </div>
    </div>
  `;
}
function weekDayColumn(dIso) {
  const items = itemsOnDate(dIso).filter(it => it.start);
  const brk = breakOnDate(dIso);
  const dow = new Date(dIso + 'T00:00:00').getDay();
  return `<div class="cal-day-col ${dow === 0 || dow === 6 ? 'weekend' : ''} ${dIso === todayIso() ? 'today' : ''}" onclick="openEventModal(null,'${dIso}')" ondragover="allowDrop(event)" ondrop="dropRescheduleOnDate(event,'${dIso}')">
    ${brk ? `<div class="cal-break-label" style="position:absolute;top:4px;left:6px;z-index:1">${esc(brk.name)}</div>` : ''}
    ${CAL_HOURS.map(h => `<div class="cal-hour-row" ondragover="allowDrop(event)" ondrop="event.stopPropagation();dropTimeBlockOnSlot(event,'${dIso}',${h})"></div>`).join('')}
    ${items.map(it => positionedBlock(it, dIso)).join('')}
    ${nowLine(dIso)}
  </div>`;
}
// A rose hairline at the current time, on today's column only.
function nowLine(dIso) {
  if (dIso !== todayIso()) return '';
  const n = new Date(), min = n.getHours() * 60 + n.getMinutes() - CAL_HOURS[0] * 60;
  if (min < 0 || min > CAL_HOURS.length * 60) return '';
  return `<div class="cal-now" style="top:${(min / 60) * 48}px" aria-hidden="true"></div>`;
}
// Week and Day lay events out on an hour grid, so anything without a time had
// nowhere to go and simply wasn't drawn: a to-do due Thursday, or an assignment
// whose due time was cleared, showed in Month but vanished the moment you
// switched to Week. This is the row above the hours that holds those, the way
// every calendar app handles all-day items.
function allDayStrip(dates, cols = '') {
  const perDay = dates.map(d => itemsOnDate(d).filter(it => !it.start));
  if (!perDay.some(list => list.length)) return '';
  return `<div class="cal-week-grid cal-allday" ${cols ? `style="grid-template-columns:${cols}"` : ''}>
    <div class="cal-allday-label">All day</div>
    ${dates.map((d, i) => `<div class="cal-allday-col" ondragover="allowDrop(event)" ondrop="dropRescheduleOnDate(event,'${d}')">
      ${perDay[i].map(it => calEvtHtml(it, it.action ? `role="button" tabindex="0" onclick="event.stopPropagation();${it.action}" onkeydown="calKey(event,()=>{${it.action}})"` : '')).join('')}
    </div>`).join('')}
  </div>`;
}
function positionedBlock(it, dIso, nowMin = null) {
  const [sh, sm] = (it.start || '09:00').split(':').map(Number);
  const startMin = sh * 60 + sm;
  const top = ((startMin - CAL_HOURS[0] * 60) / 60) * 48;
  const endMin = it.end ? (() => { const [eh, em] = it.end.split(':').map(Number); return eh * 60 + em; })() : startMin + 45;
  const height = Math.max(22, ((endMin - startMin) / 60) * 48 - 2);
  const clickable = it.action ? `onclick="event.stopPropagation();${it.action}"` : it.kind === 'custom' ? `onclick="event.stopPropagation();openEventModal('${it.id}')"` : (it.kind === 'exam' || it.kind === 'deadline') ? `onclick="event.stopPropagation();openAssignmentModal('${it.id}')"` : it.kind === 'group' ? `onclick="event.stopPropagation();openGroupSession('${it.code}')"` : it.kind === 'career' ? `onclick="event.stopPropagation();openApplicationModal('${it.id}')"` : `onclick="event.stopPropagation()"`;
  // A tint of the class color behind ink text: readable whatever color the
  // student picked, and calm enough that a busy week doesn't shout.
  const hex = /^#[0-9a-f]{6}$/i.test(it.color || '') ? it.color : '#5a6b7b';
  const where = it.location || it.where || (it.kind === 'class' ? it.course?.location : '');
  const time = (it.end ? `${fmtTime(it.start)} – ${fmtTime(it.end)}` : fmtTime(it.start)) + (where ? ` · ${where}` : '');
  const past = nowMin != null && endMin <= nowMin;
  return `<div class="cal-block kind-${it.kind} ${past ? 'past' : ''}" style="top:${top}px;height:${height}px;--c:${hex}" ${clickable} title="${esc(it.kind === 'group' ? `${it.title} (${it.groupName})` : it.title)}">
    <div class="cal-block-title">${KIND_ICON[it.kind] ? `<span class="cal-evt-ic">${icon(KIND_ICON[it.kind], 11, 2.2)}</span>` : ''}<span>${esc(it.title)}</span></div>
    ${height >= 36 ? `<span class="cal-block-time">${time}</span>` : ''}
  </div>`;
}

// The daily page: the hour timeline, and beside it the day at a glance,
// what's due (checkable right here), the free time left, and a small month
// to move between days. On today, the hours already gone fade back.
function dayView() {
  const dIso = state.calDate;
  const all = itemsOnDate(dIso);
  const items = all.filter(it => it.start);
  const brk = breakOnDate(dIso);
  const isToday = dIso === todayIso();
  const nowMin = isToday ? new Date().getHours() * 60 + new Date().getMinutes() : null;
  const pastPx = isToday ? Math.max(0, Math.min(CAL_HOURS.length * 60, nowMin - CAL_HOURS[0] * 60)) / 60 * 48 : 0;
  return `
    <div class="cal-dayplan">
      <div class="cal-sheet cal-time">
        ${brk ? `<div class="cal-break-label" style="padding:10px 14px 0">${esc(brk.name)}, no classes</div>` : ''}
        ${allDayStrip([dIso], '58px 1fr')}
        <div class="cal-week-grid" style="grid-template-columns:58px 1fr;position:relative;padding-top:10px">
          ${hourLabels()}
          <div class="cal-day-col" onclick="openEventModal(null,'${dIso}')" ondragover="allowDrop(event)" ondrop="dropRescheduleOnDate(event,'${dIso}')">
            ${CAL_HOURS.map(h => `<div class="cal-hour-row" ondragover="allowDrop(event)" ondrop="event.stopPropagation();dropTimeBlockOnSlot(event,'${dIso}',${h})"></div>`).join('')}
            ${pastPx ? `<div class="cal-past" style="height:${pastPx}px" aria-hidden="true"></div>` : ''}
            ${items.map(it => positionedBlock(it, dIso, nowMin)).join('')}
            ${nowLine(dIso)}
          </div>
        </div>
      </div>
      <aside class="cal-daypanel" aria-label="${esc(fmtDateLong(dIso))} at a glance">
        ${dayGlance(dIso, all)}
        ${dayDueCard(dIso)}
        ${dayFreeCard(dIso, items, nowMin)}
        <div class="cal-panel-card cal-daymini">${dayMiniMonth(dIso)}</div>
      </aside>
    </div>
  `;
}
function dayGlance(dIso, all) {
  const classes = all.filter(it => it.kind === 'class').length;
  const due = dayDueItems(dIso).filter(x => !x.done).length;
  const free = dayFreeGaps(dIso, all.filter(it => it.start), dIso === todayIso() ? new Date().getHours() * 60 + new Date().getMinutes() : null).reduce((m, g) => m + (g.end - g.start), 0);
  const hrs = free >= 60 ? `${Math.round(free / 30) / 2}` : '0';
  return `<div class="cal-panel-card cal-glance">
    <div><b>${classes}</b><span>class${classes === 1 ? '' : 'es'}</span></div>
    <div><b>${due}</b><span>due</span></div>
    <div><b>${hrs}</b><span>free hour${hrs === '1' ? '' : 's'}</span></div>
  </div>`;
}
// Everything with this day as its due date: assignments, exams and to-dos,
// finished ones included (so a tick can be undone), unfinished first.
function dayDueItems(dIso) {
  const as = state.assignments.filter(a => a.dueDate === dIso && calInScope(a)).map(a => ({ id: a.id, title: a.title, kind: a.type === 'exam' ? 'exam' : 'deadline', color: getCourseColor(a.courseId), course: getCourse(a.courseId), time: a.dueTime, done: isAssignmentDone(a), toggle: `toggleAssignmentDone('${a.id}')`, open: a.type === 'exam' ? `openExamPrep('${a.id}')` : `openAssignmentModal('${a.id}')` }));
  const ts = state.todos.filter(x => x.dueDate === dIso).map(x => ({ id: x.id, title: x.title, kind: 'todo', color: getCourseColor(x.courseId), course: getCourse(x.courseId), time: x.dueTime, done: !!x.done, toggle: `toggleTodo('${x.id}')`, open: `openTodoModal('${x.id}')` }));
  return [...as, ...ts].sort((a, b) => a.done - b.done || (a.time || '99').localeCompare(b.time || '99'));
}
function dayDueCard(dIso) {
  const list = dayDueItems(dIso);
  return `<div class="cal-panel-card">
    <h4>Due ${dIso === todayIso() ? 'today' : fmtDate(dIso, { weekday: 'long' })}</h4>
    ${list.length ? `<div class="cal-due-list">${list.map(x => `
      <div class="cal-due-row ${x.done ? 'done' : ''}" data-item-id="${x.id}">
        <button type="button" class="row-check ${x.done ? 'checked' : ''}" role="checkbox" aria-checked="${x.done}" aria-label="Mark ${esc(x.title)} as ${x.done ? 'not done' : 'done'}" onclick="event.stopPropagation();${x.toggle}">${x.done ? checkGlyph(true) : ''}</button>
        <button type="button" class="cal-due-main" onclick="${x.open}">
          <span class="cal-due-title">${x.kind === 'exam' ? `<span class="cal-evt-ic">${icon('flag', 11, 2.2)}</span>` : ''}${esc(x.title)}</span>
          <span class="cal-due-meta">${x.course ? `<i style="--c:${x.color}"></i>${esc(x.course.code || x.course.name)}` : 'No class'}${x.time && x.time < '23:30' ? ` · ${fmtTime(x.time)}` : ''}${x.kind === 'exam' ? ' · Exam' : x.kind === 'todo' ? ' · To-do' : ''}</span>
        </button>
      </div>`).join('')}</div>` : `<p class="cal-panel-empty">Nothing due. A good day to get ahead.</p>`}
  </div>`;
}
// Open stretches of an hour or more between 8 AM and 10 PM (from now, on
// today), around everything that has a time.
function dayFreeGaps(dIso, timed, nowMin) {
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const busy = timed.map(it => [toMin(it.start), it.end ? toMin(it.end) : toMin(it.start) + 45]).sort((a, b) => a[0] - b[0]);
  let cursor = Math.max(8 * 60, nowMin != null ? Math.ceil(nowMin / 15) * 15 : 0);
  const endDay = 22 * 60, gaps = [];
  if (nowMin != null && nowMin >= endDay) return [];
  for (const [s, e] of busy) { if (s - cursor >= 60) gaps.push({ start: cursor, end: Math.min(s, endDay) }); cursor = Math.max(cursor, e); if (cursor >= endDay) break; }
  if (endDay - cursor >= 60) gaps.push({ start: cursor, end: endDay });
  return gaps.filter(g => g.end - g.start >= 60);
}
function dayFreeCard(dIso, timed, nowMin) {
  const gaps = dayFreeGaps(dIso, timed, nowMin);
  const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const len = m => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
  return `<div class="cal-panel-card">
    <h4>Free time</h4>
    ${gaps.length ? gaps.slice(0, 4).map(g => {
      const blockEnd = Math.min(g.end, g.start + 120);
      return `<div class="cal-free-row">
        <div><span class="cal-free-time">${fmtTime(hm(g.start))} – ${fmtTime(hm(g.end))}</span><span class="cal-free-len">${len(g.end - g.start)}</span></div>
        <button class="btn btn-sm" onclick="openEventModal(null,'${dIso}',{title:'Study session',startTime:'${hm(g.start)}',endTime:'${hm(blockEnd)}'})">Block it</button>
      </div>`; }).join('') : `<p class="cal-panel-empty">${nowMin != null && nowMin >= 22 * 60 ? 'The day’s done. Rest up.' : 'No hour-long gaps between 8 AM and 10 PM.'}</p>`}
  </div>`;
}
// A small month for moving between days without leaving the daily page.
function dayMiniMonth(dIso) {
  const d0 = new Date(dIso + 'T00:00:00'), y = d0.getFullYear(), m = d0.getMonth();
  const first = new Date(y, m, 1), gridStart = new Date(first); gridStart.setDate(1 - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  return `<div class="cal-mini-month-head" role="button" tabindex="0" onclick="jumpToMonth(${y},${m})" onkeydown="calKey(event,()=>jumpToMonth(${y},${m}))">${first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
    <div class="cal-mini-dow">${DOW_NAMES.map(d => `<span>${d[0]}</span>`).join('')}</div>
    <div class="cal-mini-grid">${cells.map(d => { const x = iso(d), items = d.getMonth() === m ? itemsOnDate(x) : [];
      return `<button type="button" class="cal-mini-cell ${d.getMonth() !== m ? 'muted' : ''} ${x === todayIso() ? 'today' : ''} ${x === dIso ? 'selected' : ''}" aria-label="${esc(fmtDateLong(x))}" ${x === dIso ? 'aria-current="date"' : ''} onclick="setState({calDate:'${x}'})"><span>${d.getDate()}</span>${items.some(it => it.kind !== 'class') ? `<span class="cal-mini-dot ${items.some(it => it.kind === 'exam') ? 'exam' : ''}"></span>` : ''}</button>`; }).join('')}</div>`;
}

function openEventModal(id, presetDate, preset = {}) {
  const e = id ? state.events.find(x => x.id === id) : { id: uid(), title: '', date: presetDate || todayIso(), startTime: '09:00', endTime: '10:00', courseId: null, type: 'block', color: '#000000', ...preset };
  window._eventDraft = { ...e };
  renderEventModal(id);
}
function renderEventModal(id) {
  const e = _eventDraft;
  const recent = state.settings.recentEventColors || [];
  openModal(`
    <div class="modal-head"><h3>${id ? 'Edit time block' : 'New time block'}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label>Title</label><input class="input" id="ef-title" value="${esc(e.title)}" placeholder="Study session, gym, work…"></div>
      <div class="field-row">
        <div class="field"><label>Date</label><input class="input" type="date" id="ef-date" value="${e.date}"></div>
        <div class="field"><label>Course (optional)</label><select class="select" id="ef-course"><option value="">—</option>${activeCourses().map(c => `<option value="${c.id}" ${c.id === e.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Start</label><input class="input" type="time" id="ef-start" value="${e.startTime}"></div>
        <div class="field"><label>End</label><input class="input" type="time" id="ef-end" value="${e.endTime}"></div>
      </div>
      <div class="field"><label>Color</label>${colorWheelHtml('ef-color', e.color)}
        ${recent.length ? `<div class="small muted mt-8 mb-4">Recently used</div><div class="color-swatch-row">${recent.map(c => `<div class="color-swatch ${c === e.color ? 'active' : ''}" style="background:${c}" title="${c}" onclick="_eventDraft.color='${c}';renderEventModal(${id ? `'${id}'` : 'null'})"></div>`).join('')}</div>` : ''}
      </div>
    </div>
    <div class="modal-foot">
      ${id ? `<button class="btn btn-danger" onclick="deleteEvent('${id}')">Delete</button>` : ''}
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveEvent(${id ? `'${id}'` : 'null'})">Save</button>
    </div>
  `);
  wireColorWheel('ef-color', () => _eventDraft.color, (hex) => { _eventDraft.color = hex; });
}
function saveEvent(id) {
  const d = _eventDraft;
  d.title = $('#ef-title').value.trim() || 'Untitled';
  d.date = $('#ef-date').value;
  d.courseId = $('#ef-course').value || null;
  d.startTime = $('#ef-start').value;
  d.endTime = $('#ef-end').value;
  if (id) { const i = state.events.findIndex(x => x.id === id); state.events[i] = d; }
  else state.events.push(d);
  saveRecentEventColor(d.color);
  touch(); closeModal(); toast('Saved to calendar');
}
function saveRecentEventColor(hex) {
  const list = state.settings.recentEventColors || (state.settings.recentEventColors = []);
  const i = list.indexOf(hex);
  if (i !== -1) list.splice(i, 1);
  list.unshift(hex);
  list.length = Math.min(list.length, 8);
}
function deleteEvent(id) {
  const e = state.events.find(x => x.id === id);
  if (e) trashItem('event', e.title || 'Untitled time block', e);
  state.events = state.events.filter(e => e.id !== id);
  touch(); closeModal(); toast('Removed');
}
