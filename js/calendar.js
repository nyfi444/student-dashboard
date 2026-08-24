/* ── Calendar: month / week / day + time blocking ────────────────── */
const CAL_HOURS = Array.from({ length: 16 }, (_, i) => i + 7); // 7am–10pm

function pageCalendar() {
  const v = state.calView;
  const label = v === 'year' ? String(new Date(state.calDate + 'T00:00:00').getFullYear())
    : v === 'month' ? fmtDate(state.calDate, { month: 'long', year: 'numeric' })
    : v === 'week' ? `Week of ${fmtDate(startOfWeek(state.calDate))}`
    : fmtDateLong(state.calDate);
  return `
    ${pageHead('Calendar', label, `
      <div class="segmented">
        <button class="${v === 'year' ? 'active' : ''}" onclick="setCalView('year')">Year</button>
        <button class="${v === 'month' ? 'active' : ''}" onclick="setCalView('month')">Month</button>
        <button class="${v === 'week' ? 'active' : ''}" onclick="setCalView('week')">Week</button>
        <button class="${v === 'day' ? 'active' : ''}" onclick="setCalView('day')">Day</button>
      </div>
      <button class="btn btn-sm btn-icon" onclick="calNav(-1)">${icon('chevron-left', 15, 2)}</button>
      <button class="btn btn-sm" onclick="calToday()">Today</button>
      <button class="btn btn-sm btn-icon" onclick="calNav(1)">${icon('chevron-right', 15, 2)}</button>
      <button class="btn btn-sm" onclick="openBreaksModal()">${icon('flag', 13, 2)} Breaks</button>
      <button class="btn btn-primary" onclick="openEventModal(null,'${state.calDate}')">+ Time block</button>
    `)}
    ${v !== 'year' ? `<div class="small muted mb-8">Drag a to-do or assignment from Dashboard/To-Do/Assignments onto a day to reschedule it, or onto a time slot to plan when you'll work on it.</div>` : `<div class="small muted mb-8">Click a month name to jump into it, or a day to jump straight to that day.</div>`}
    <div id="cal-body">${v === 'year' ? yearView() : v === 'month' ? monthView() : v === 'week' ? weekView() : dayView()}</div>
  `;
}
function isBreakDate(dIso) { return state.breaks.some(b => dIso >= b.startDate && dIso <= b.endDate); }
function breakOnDate(dIso) { return state.breaks.find(b => dIso >= b.startDate && dIso <= b.endDate); }
function openBreaksModal() {
  openModal(`
    <div class="modal-head"><h3>School breaks / no-class days</h3><button class="close-x" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="small muted mb-8">Class meetings are hidden on these dates — Labor Day, Fall Break, Thanksgiving, Reading Day, etc.</div>
      <div id="brk-list">${state.breaks.map((b, i) => breakRow(b, i)).join('') || '<div class="small muted mb-8">No breaks added yet.</div>'}</div>
      <div class="field-row mt-8">
        <input class="input" id="brk-name" placeholder="Thanksgiving Break">
        <input class="input" type="date" id="brk-start">
        <input class="input" type="date" id="brk-end">
        <button class="btn btn-sm" onclick="addBreak()">+ Add</button>
      </div>
    </div>
    <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">Done</button></div>
  `, { wide: true });
}
function breakRow(b, i) {
  return `<div class="list-row"><div class="row-title">${esc(b.name)}</div><div class="row-meta">${fmtDate(b.startDate)} – ${fmtDate(b.endDate)}</div><button class="btn btn-ghost btn-icon btn-sm" onclick="removeBreak(${i})">${icon('x',13,2.2)}</button></div>`;
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
function customEventsOnDate(dateIso) { return state.events.filter(e => e.date === dateIso).map(e => ({ ...e, kind: 'custom' })); }
function examsOnDate(dateIso) { return state.assignments.filter(a => a.type === 'exam' && a.dueDate === dateIso && activeCourses().some(c => c.id === a.courseId)).map(a => ({ id: a.id, title: a.title, start: a.dueTime || '09:00', end: null, color: getCourseColor(a.courseId), kind: 'exam' })); }
function deadlinesOnDate(dateIso) { return state.assignments.filter(a => a.type !== 'exam' && a.dueDate === dateIso && activeCourses().some(c => c.id === a.courseId)).map(a => ({ id: a.id, title: a.title, start: a.dueTime || null, end: null, color: getCourseColor(a.courseId), kind: 'deadline' })); }
function itemsOnDate(dateIso) { return [...meetingsOnDate(dateIso), ...customEventsOnDate(dateIso), ...examsOnDate(dateIso), ...deadlinesOnDate(dateIso)].sort((a, b) => (a.start || '').localeCompare(b.start || '')); }
const KIND_ICON = { exam: 'flag', deadline: 'clipboard-list' };

function yearView() {
  const year = new Date(state.calDate + 'T00:00:00').getFullYear();
  return `<div class="cal-year-grid">${Array.from({ length: 12 }, (_, m) => miniMonth(year, m)).join('')}</div>`;
}
function miniMonth(year, month) {
  const first = new Date(year, month, 1);
  const gridStart = new Date(first); gridStart.setDate(first.getDate() - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  return `
    <div class="cal-mini-month">
      <div class="cal-mini-month-head" onclick="jumpToMonth(${year},${month})">${first.toLocaleDateString('en-US', { month: 'long' })}</div>
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

function monthView() {
  const d0 = new Date(state.calDate + 'T00:00:00');
  const first = new Date(d0.getFullYear(), d0.getMonth(), 1);
  const gridStart = new Date(first); gridStart.setDate(first.getDate() - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  return `
    <div class="cal-grid mb-8">${DOW_NAMES.map(d => `<div class="cal-dow">${d}</div>`).join('')}</div>
    <div class="cal-grid">
      ${cells.map(d => {
        const dIso = iso(d);
        const items = itemsOnDate(dIso);
        const muted = d.getMonth() !== d0.getMonth();
        const isToday = dIso === todayIso();
        const brk = breakOnDate(dIso);
        return `<div class="cal-cell ${muted ? 'muted' : ''} ${isToday ? 'today' : ''}" onclick="openDayFromMonth('${dIso}')" ondragover="allowDrop(event)" ondrop="dropRescheduleOnDate(event,'${dIso}')">
          <div class="d-num">${d.getDate()}</div>
          ${brk ? `<div class="small muted" style="font-style:italic">${esc(brk.name)}</div>` : ''}
          ${items.slice(0, 3).map(it => `<div class="cal-evt kind-${it.kind}" style="background:${it.color}22;color:${it.color}">${KIND_ICON[it.kind] ? `<span class="cal-evt-ic">${icon(KIND_ICON[it.kind], 9, 2.2)}</span>` : ''}${esc(it.title)}</div>`).join('')}
          ${items.length > 3 ? `<div class="small muted">+${items.length - 3} more</div>` : ''}
        </div>`;
      }).join('')}
    </div>
  `;
}
function openDayFromMonth(dIso) { setState({ calDate: dIso, calView: 'day' }); }

function weekView() {
  const start = new Date(startOfWeek(state.calDate) + 'T00:00:00');
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  return `
    <div class="card card-pad">
      <div class="cal-week-grid" style="margin-bottom:6px">
        <div></div>
        ${days.map(d => `<div style="text-align:center" class="small ${iso(d) === todayIso() ? 'dim' : 'muted'}"><strong>${DOW_NAMES[d.getDay()]}</strong> ${d.getDate()}</div>`).join('')}
      </div>
      <div class="cal-week-grid" style="position:relative">
        <div>${CAL_HOURS.map(h => `<div class="cal-hour-label">${h > 12 ? h - 12 : h}${h >= 12 ? 'pm' : 'am'}</div>`).join('')}</div>
        ${days.map(d => weekDayColumn(iso(d))).join('')}
      </div>
    </div>
  `;
}
function weekDayColumn(dIso) {
  const items = itemsOnDate(dIso).filter(it => it.start);
  const brk = breakOnDate(dIso);
  return `<div class="cal-day-col" onclick="openEventModal(null,'${dIso}')" ondragover="allowDrop(event)" ondrop="dropRescheduleOnDate(event,'${dIso}')">
    ${brk ? `<div class="small muted" style="position:absolute;top:2px;left:4px;z-index:1;font-style:italic">${esc(brk.name)}</div>` : ''}
    ${CAL_HOURS.map(h => `<div class="cal-hour-row" ondragover="allowDrop(event)" ondrop="event.stopPropagation();dropTimeBlockOnSlot(event,'${dIso}',${h})"></div>`).join('')}
    ${items.map(it => positionedBlock(it, dIso)).join('')}
  </div>`;
}
function positionedBlock(it, dIso) {
  const [sh, sm] = (it.start || '09:00').split(':').map(Number);
  const startMin = sh * 60 + sm;
  const top = ((startMin - CAL_HOURS[0] * 60) / 60) * 48;
  const endMin = it.end ? (() => { const [eh, em] = it.end.split(':').map(Number); return eh * 60 + em; })() : startMin + 45;
  const height = Math.max(22, ((endMin - startMin) / 60) * 48 - 2);
  const clickable = it.kind === 'custom' ? `onclick="event.stopPropagation();openEventModal('${it.id}')"` : (it.kind === 'exam' || it.kind === 'deadline') ? `onclick="event.stopPropagation();openAssignmentModal('${it.id}')"` : `onclick="event.stopPropagation()"`;
  return `<div class="cal-block kind-${it.kind}" style="top:${top}px;height:${height}px;background:${it.color}" ${clickable} title="${esc(it.title)}">${KIND_ICON[it.kind] ? `<span class="cal-evt-ic">${icon(KIND_ICON[it.kind], 10, 2.2)}</span>` : ''}${esc(it.title)}</div>`;
}

function dayView() {
  const dIso = state.calDate;
  const items = itemsOnDate(dIso).filter(it => it.start);
  const brk = breakOnDate(dIso);
  return `
    <div class="card card-pad">
      ${brk ? `<div class="small muted mb-8" style="font-style:italic">${icon('flag',12,2)} ${esc(brk.name)} — no classes</div>` : ''}
      <div class="cal-week-grid" style="grid-template-columns:52px 1fr;position:relative">
        <div>${CAL_HOURS.map(h => `<div class="cal-hour-label">${h > 12 ? h - 12 : h}${h >= 12 ? 'pm' : 'am'}</div>`).join('')}</div>
        <div class="cal-day-col" onclick="openEventModal(null,'${dIso}')" ondragover="allowDrop(event)" ondrop="dropRescheduleOnDate(event,'${dIso}')">
          ${CAL_HOURS.map(h => `<div class="cal-hour-row" ondragover="allowDrop(event)" ondrop="event.stopPropagation();dropTimeBlockOnSlot(event,'${dIso}',${h})"></div>`).join('')}
          ${items.map(it => positionedBlock(it, dIso)).join('')}
        </div>
      </div>
    </div>
  `;
}

function openEventModal(id, presetDate) {
  const e = id ? state.events.find(x => x.id === id) : { id: uid(), title: '', date: presetDate || todayIso(), startTime: '09:00', endTime: '10:00', courseId: null, type: 'block', color: '#000000' };
  window._eventDraft = { ...e };
  renderEventModal(id);
}
function renderEventModal(id) {
  const e = _eventDraft;
  const recent = state.settings.recentEventColors || [];
  openModal(`
    <div class="modal-head"><h3>${id ? 'Edit time block' : 'New time block'}</h3><button class="close-x" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
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
