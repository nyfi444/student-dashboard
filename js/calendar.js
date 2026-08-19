/* ── Calendar: month / week / day + time blocking ────────────────── */
const CAL_HOURS = Array.from({ length: 16 }, (_, i) => i + 7); // 7am–10pm

function pageCalendar() {
  const v = state.calView;
  const label = v === 'month' ? fmtDate(state.calDate, { month: 'long', year: 'numeric' })
    : v === 'week' ? `Week of ${fmtDate(startOfWeek(state.calDate))}`
    : fmtDateLong(state.calDate);
  return `
    ${pageHead('Calendar', label, `
      <div class="segmented">
        <button class="${v === 'month' ? 'active' : ''}" onclick="setCalView('month')">Month</button>
        <button class="${v === 'week' ? 'active' : ''}" onclick="setCalView('week')">Week</button>
        <button class="${v === 'day' ? 'active' : ''}" onclick="setCalView('day')">Day</button>
      </div>
      <button class="btn btn-sm btn-icon" onclick="calNav(-1)">${icon('chevron-left', 15, 2)}</button>
      <button class="btn btn-sm" onclick="calToday()">Today</button>
      <button class="btn btn-sm btn-icon" onclick="calNav(1)">${icon('chevron-right', 15, 2)}</button>
      <button class="btn btn-primary" onclick="openEventModal(null,'${state.calDate}')">+ Time block</button>
    `)}
    <div id="cal-body">${v === 'month' ? monthView() : v === 'week' ? weekView() : dayView()}</div>
  `;
}
function setCalView(v) { setState({ calView: v }); }
function calToday() { setState({ calDate: todayIso() }); }
function calNav(dir) {
  const v = state.calView;
  const d = v === 'month' ? monthShift(state.calDate, dir) : addDays(state.calDate, dir * (v === 'week' ? 7 : 1));
  setState({ calDate: d });
}
function monthShift(isoStr, dir) { const d = new Date(isoStr + 'T00:00:00'); d.setMonth(d.getMonth() + dir); return iso(d); }

function meetingsOnDate(dateIso) {
  const dow = new Date(dateIso + 'T00:00:00').getDay();
  return activeCourses().flatMap(c => c.meetings.filter(m => m.day === dow).map(m => ({ ...m, course: c, id: `m-${c.id}-${m.day}-${m.start}`, title: c.name, color: c.color, kind: 'class' })));
}
function customEventsOnDate(dateIso) { return state.events.filter(e => e.date === dateIso).map(e => ({ ...e, kind: 'custom' })); }
function examsOnDate(dateIso) { return state.assignments.filter(a => a.type === 'exam' && a.dueDate === dateIso && activeCourses().some(c => c.id === a.courseId)).map(a => ({ id: a.id, title: a.title, start: a.dueTime || '09:00', end: null, color: getCourseColor(a.courseId), kind: 'exam' })); }
function deadlinesOnDate(dateIso) { return state.assignments.filter(a => a.type !== 'exam' && a.dueDate === dateIso && activeCourses().some(c => c.id === a.courseId)).map(a => ({ id: a.id, title: a.title, start: a.dueTime || null, end: null, color: getCourseColor(a.courseId), kind: 'deadline' })); }
function itemsOnDate(dateIso) { return [...meetingsOnDate(dateIso), ...customEventsOnDate(dateIso), ...examsOnDate(dateIso), ...deadlinesOnDate(dateIso)].sort((a, b) => (a.start || '').localeCompare(b.start || '')); }
const KIND_ICON = { exam: 'flag', deadline: 'clipboard-list' };

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
        return `<div class="cal-cell ${muted ? 'muted' : ''} ${isToday ? 'today' : ''}" onclick="openDayFromMonth('${dIso}')">
          <div class="d-num">${d.getDate()}</div>
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
  return `<div class="cal-day-col" onclick="openEventModal(null,'${dIso}')">
    ${CAL_HOURS.map(() => `<div class="cal-hour-row"></div>`).join('')}
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
  return `
    <div class="card card-pad">
      <div class="cal-week-grid" style="grid-template-columns:52px 1fr;position:relative">
        <div>${CAL_HOURS.map(h => `<div class="cal-hour-label">${h > 12 ? h - 12 : h}${h >= 12 ? 'pm' : 'am'}</div>`).join('')}</div>
        <div class="cal-day-col" onclick="openEventModal(null,'${dIso}')">
          ${CAL_HOURS.map(() => `<div class="cal-hour-row"></div>`).join('')}
          ${items.map(it => positionedBlock(it, dIso)).join('')}
        </div>
      </div>
    </div>
  `;
}

function openEventModal(id, presetDate) {
  const e = id ? state.events.find(x => x.id === id) : { id: uid(), title: '', date: presetDate || todayIso(), startTime: '09:00', endTime: '10:00', courseId: null, type: 'block', color: ACCENTS[0].hex };
  window._eventDraft = { ...e };
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
      <div class="field"><label>Color</label><div class="swatch-grid">${ACCENTS.map(a => `<div class="swatch ${a.hex === e.color ? 'active' : ''}" style="background:${a.hex}" onclick="_eventDraft.color='${a.hex}';this.parentElement.querySelectorAll('.swatch').forEach(s=>s.classList.remove('active'));this.classList.add('active')"></div>`).join('')}</div></div>
    </div>
    <div class="modal-foot">
      ${id ? `<button class="btn btn-danger" onclick="deleteEvent('${id}')">Delete</button>` : ''}
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveEvent(${id ? `'${id}'` : 'null'})">Save</button>
    </div>
  `);
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
  touch(); closeModal(); toast('Saved to calendar');
}
function deleteEvent(id) { state.events = state.events.filter(e => e.id !== id); touch(); closeModal(); toast('Removed'); }
