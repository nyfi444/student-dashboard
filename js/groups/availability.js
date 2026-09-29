/* ── Study Groups: Find a time ───────────────────────────────────
   Each member paints the half hours they're free; the group sees a
   heatmap and the best times. Loaded after js/groups/sync.js.
──────────────────────────────────────────────────────────────── */
const AVAIL_START_HOUR = 7;
const AVAIL_SLOT_MIN = 30;
const AVAIL_SLOTS = 32; // 7:00am to 11:00pm in half hours
const AVAIL_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const AVAIL_DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// The window a schedule-drafted availability starts from (see fillAvailabilityFromSchedule).
const AVAIL_AUTO_START = '09:00';
const AVAIL_AUTO_END = '21:00';

/* ── Availability grid encoding: one '0'/'1' string per weekday ─── */
function emptyDayStr() { return '0'.repeat(AVAIL_SLOTS); }
function slotOf(hhmm) { return clamp(Math.floor((toMin(hhmm) - AVAIL_START_HOUR * 60) / AVAIL_SLOT_MIN), 0, AVAIL_SLOTS); }
function slotTime(i) { return fromMin(AVAIL_START_HOUR * 60 + i * AVAIL_SLOT_MIN); }
function availDay(entry, day) { const s = entry?.['d' + day]; return typeof s === 'string' && s.length === AVAIL_SLOTS ? s : emptyDayStr(); }
function availHasAny(entry) { return !!entry && [0, 1, 2, 3, 4, 5, 6].some(d => availDay(entry, d).includes('1')); }
// Sunday first, the same as the calendar's week (startOfWeek in utils.js).
function availDayOrder() { return [0, 1, 2, 3, 4, 5, 6]; }
function scheduleBusyRanges() {
  if (typeof activeCourses !== 'function') return [];
  return activeCourses().flatMap(c => (c.meetings || []).filter(m => m && m.day >= 0 && m.day <= 6 && /^\d{2}:\d{2}$/.test(m.start || '') && /^\d{2}:\d{2}$/.test(m.end || '')).map(m => ({ day: m.day, start: m.start, end: m.end })));
}
// Semester HQ already knows when you're in class, so the first draft of your
// availability can come from your schedule instead of thirty drags: free from
// 9am to 9pm every day, minus every class meeting this semester. A class from
// 10:50 to 11:40 blocks the 10:30 and 11:30 half hours too; rounding outward
// is what keeps you from being marked free mid-lecture.
function availabilityFromSchedule() {
  const days = availFromRanges([0, 1, 2, 3, 4, 5, 6].map(day => ({ day, start: AVAIL_AUTO_START, end: AVAIL_AUTO_END })));
  scheduleBusyRanges().forEach(({ day, start, end }) => {
    const arr = days['d' + day].split('');
    const last = Math.min(AVAIL_SLOTS, Math.ceil((toMin(end) - AVAIL_START_HOUR * 60) / AVAIL_SLOT_MIN));
    for (let i = slotOf(start); i < last; i++) arr[i] = '0';
    days['d' + day] = arr.join('');
  });
  return days;
}
function fillAvailabilityFromSchedule(code) {
  const g = findGroup(code);
  if (!g) return;
  const u = myUidFor(g);
  const apply = () => {
    groupWrite(code, { [`avail.${u}`]: { ...availabilityFromSchedule(), name: myGroupName(), updatedAt: Date.now() } });
    toast('Drafted from your class schedule. Drag to fix anything that’s off.', 'success', 4000);
  };
  if (availHasAny(g.avail?.[u])) confirmDialog('Replace what you’ve painted with a draft from your class schedule? You can still adjust it by dragging.', apply, 'Replace', 'Start over from your schedule?');
  else apply();
}
function availFromRanges(ranges) {
  const days = {};
  for (let d = 0; d < 7; d++) days['d' + d] = emptyDayStr().split('');
  ranges.forEach(({ day, start, end }) => {
    if (!days['d' + day] || !start || !end) return;
    for (let i = slotOf(start); i < slotOf(end); i++) days['d' + day][i] = '1';
  });
  Object.keys(days).forEach(k => { days[k] = days[k].join(''); });
  return days;
}

/* ── Find a time: paintable availability + group heatmap ───────── */
function groupAvailabilityTab(g) {
  const u = myUidFor(g);
  const days = availDayOrder();
  const contributors = Object.entries(g.avail || {}).filter(([id, a]) => safeId(id) && availHasAny(a));
  const people = groupPeople(g);
  const best = groupBestTimes(g);
  const mineAdded = availHasAny(g.avail?.[u]);
  const missing = people.filter(p => !availHasAny(g.avail?.[p.uid]));
  const view = window._availView === 'heat' || contributors.length > 8 ? 'heat' : 'people';
  const focus = contributors.some(([id]) => id === window._availFocus) ? window._availFocus : null;
  return `
    <div class="sg-avail-wrap">
      <div class="card card-pad" style="--me-color:${personColor(g, u)}">
        <div class="sg-avail-head mb-8">
          <h3 class="sg-h3">Your weekly availability</h3>
          <div class="sg-avail-actions">
            <span class="small muted">Drag to paint</span>
            ${scheduleBusyRanges().length ? `<button class="btn btn-ghost btn-sm" data-tip="Free ${fmtTime(AVAIL_AUTO_START)} to ${fmtTime(AVAIL_AUTO_END)}, minus your classes" onclick="fillAvailabilityFromSchedule('${g.code}')">${icon('calendar', 14)} ${mineAdded ? 'Redraft from my schedule' : 'Start from my schedule'}</button>` : ''}
            ${mineAdded ? `<button class="btn btn-ghost btn-sm" onclick="clearMyAvailability('${g.code}')">Clear</button>` : ''}
          </div>
        </div>
        <div class="sg-mycolor"><span class="small muted">Your color</span>${colorSwatches(g, 'setMyGroupColor')}</div>
        ${availGrid(g, days, 'mine')}
      </div>
      <div class="card card-pad">
        <div class="flex-between mb-8">
          <h3 class="sg-h3">Group availability</h3>
          ${contributors.length <= 8 ? `<div class="segmented sg-view-toggle"><button class="${view === 'people' ? 'active' : ''}" aria-pressed="${view === 'people'}" onclick="window._availView='people';render()">People</button><button class="${view === 'heat' ? 'active' : ''}" aria-pressed="${view === 'heat'}" onclick="window._availView='heat';render()">Heatmap</button></div>` : `<span class="small muted">${contributors.length} of ${people.length} added</span>`}
        </div>
        ${view === 'people' ? `
          <div class="sg-legend-people" role="group" aria-label="Highlight one person">
            ${contributors.length ? contributors.map(([id]) => `<button class="sg-legend-person ${focus === id ? 'active' : ''} ${focus && focus !== id ? 'dim' : ''}" style="--p:${personColor(g, id)}" aria-pressed="${focus === id}" onclick="window._availFocus=${focus === id ? 'null' : `'${id}'`};render()"><span class="sg-legend-dot"></span>${esc(id === u ? 'You' : personName(g, id))}</button>`).join('') : '<span class="small muted">No one has added availability yet.</span>'}
          </div>` : ''}
        ${availGrid(g, days, view, focus)}
        ${view === 'heat' ? `<div class="sg-legend small muted"><span>Fewer free</span><span class="sg-legend-bar"></span><span>Everyone</span></div>` : focus ? `<div class="small muted mt-8">Showing only ${esc(focus === u ? 'you' : personName(g, focus))}. Click again to show everyone.</div>` : ''}
      </div>
    </div>
    <div class="grid grid-2 mt-16" style="align-items:start">
      <div class="card card-pad">
        <h3 class="sg-h3 mb-8">Best times to meet</h3>
        ${best.length && contributors.length >= 2 ? best.map(w => bestTimeRow(g, w)).join('') : `<p class="small muted">${contributors.length >= 2 ? 'No overlap yet. Try adding a few more open blocks.' : 'Suggestions show up once at least two people have added availability.'}</p>`}
      </div>
      <div class="card card-pad">
        <h3 class="sg-h3 mb-8">Who’s added theirs</h3>
        ${people.map(p => `<div class="sg-person">${personAvatar(p.uid, p.name, 24, personColor(g, p.uid))}<div class="row-title small">${esc(p.name)}${p.uid === u && p.name !== 'You' ? ' <span class="muted">(you)</span>' : ''}</div>${availHasAny(g.avail?.[p.uid]) ? `<span class="small">${icon('check', 12)} Added</span>` : '<span class="small muted">Not yet</span>'}</div>`).join('')}
        ${missing.length && !g.local ? `<button class="btn btn-sm mt-8" onclick="copyAvailabilityNudge('${g.code}')">${icon('copy', 14)} Copy a reminder for the group</button>` : ''}
      </div>
    </div>
  `;
}
function availGrid(g, days, mode, focus = null) {
  const u = myUidFor(g);
  const contributors = Object.entries(g.avail || {}).filter(([id, a]) => safeId(id) && availHasAny(a));
  const mine = g.avail?.[u];
  const rows = [];
  rows.push(`<div class="sg-grid-corner"></div>${days.map(d => `<div class="sg-grid-day">${AVAIL_DAYS[d]}</div>`).join('')}`);
  for (let i = 0; i < AVAIL_SLOTS; i++) {
    const hourRow = i % 2 === 0;
    rows.push(`<div class="sg-grid-time">${hourRow ? shortHour(AVAIL_START_HOUR + i / 2) : ''}</div>`);
    rows.push(days.map(d => {
      if (mode === 'mine') {
        const day = availDay(mine, d), on = day[i] === '1';
        const run = on ? `${day[i - 1] === '1' ? '' : 'run-start'} ${day[i + 1] === '1' ? '' : 'run-end'}` : '';
        return `<div class="sg-cell ${hourRow ? 'hr' : ''} ${on ? 'on' : ''} ${run}" data-day="${d}" data-col="${days.indexOf(d)}" data-slot="${i}"></div>`;
      }
      const free = contributors.filter(([, a]) => availDay(a, d)[i] === '1').map(([id]) => id);
      const allAt = (slot) => contributors.length >= 2 && contributors.every(([, a]) => availDay(a, d)[slot] === '1');
      const everyone = allAt(i);
      const allRun = everyone ? `${allAt(i - 1) ? '' : 'all-start'} ${allAt(i + 1) ? '' : 'all-end'}` : '';
      const label = `${AVAIL_DAYS_LONG[d]} ${fmtTime(slotTime(i))}: ${free.length ? free.map(id => personName(g, id)).join(', ') : 'nobody'} free`;
      if (mode === 'people') {
        // One thin stripe per person, in the same order in every cell, so each
        // person's free time lines up into a colored column you can follow.
        // A person's contiguous free slots join into one rounded bar.
        const stripes = contributors.map(([id, a]) => {
          const on = free.includes(id) && (!focus || focus === id);
          if (!on) return '<i></i>';
          const day = availDay(a, d);
          return `<i class="${day[i - 1] === '1' ? '' : 'rs'} ${day[i + 1] === '1' ? '' : 're'}" style="background:${personColor(g, id)}"></i>`;
        }).join('');
        return `<div class="sg-cell sg-cell-people ${hourRow ? 'hr' : ''} ${everyone && !focus ? `all ${allRun}` : ''}" title="${esc(label)}">${stripes}</div>`;
      }
      const pct = contributors.length ? Math.round((free.length / contributors.length) * 100) : 0;
      return `<div class="sg-cell ${hourRow ? 'hr' : ''} ${everyone ? 'all' : ''}" style="--heat:${pct}%" title="${esc(label)}"></div>`;
    }).join(''));
  }
  const attrs = mode === 'mine' ? `id="sg-avail-mine" data-code="${g.code}" aria-label="Your weekly availability. Click and drag to mark free time."` : `aria-label="Group availability, ${mode === 'people' ? 'one color per person' : 'heatmap'}"`;
  return `<div class="sg-grid-scroll"><div class="sg-grid ${mode === 'mine' ? 'sg-grid-mine' : mode === 'people' ? 'sg-grid-people' : 'sg-grid-heat'}" ${attrs} style="--sg-cols:${days.length}">${rows.join('')}</div></div>`;
}
let _availPaint = null;
// Round only the first and last painted slot of each run in a day column.
function markAvailRuns(cells) {
  const on = new Set(cells.filter(c => c.classList.contains('on')).map(c => `${c.dataset.col}:${c.dataset.slot}`));
  cells.forEach(c => {
    const col = c.dataset.col, slot = Number(c.dataset.slot), isOn = on.has(`${col}:${slot}`);
    c.classList.toggle('run-start', isOn && !on.has(`${col}:${slot - 1}`));
    c.classList.toggle('run-end', isOn && !on.has(`${col}:${slot + 1}`));
  });
}
function bindAvailabilityPainting() {
  const grid = document.getElementById('sg-avail-mine');
  if (!grid || grid.dataset.bound) return;
  grid.dataset.bound = '1';
  const code = grid.dataset.code;
  const cells = [...grid.querySelectorAll('.sg-cell')];
  const pos = (c) => ({ col: Number(c.dataset.col), slot: Number(c.dataset.slot) });
  // Dragging fills the whole rectangle between where you pressed and where
  // the pointer is now (like When2meet), so "Mon–Thu, 5–7pm" is one drag.
  // Cells outside the rectangle go back to how they were when the drag began.
  const paintTo = (cell) => {
    if (!cell || !_availPaint) return;
    const a = _availPaint.anchor, b = pos(cell);
    const [c0, c1] = [Math.min(a.col, b.col), Math.max(a.col, b.col)];
    const [s0, s1] = [Math.min(a.slot, b.slot), Math.max(a.slot, b.slot)];
    cells.forEach((c, i) => {
      const p = pos(c);
      const inside = p.col >= c0 && p.col <= c1 && p.slot >= s0 && p.slot <= s1;
      c.classList.toggle('on', inside ? _availPaint.turnOn : _availPaint.before[i]);
    });
    markAvailRuns(cells);
  };
  const cellAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.classList.contains('sg-cell') && grid.contains(el) ? el : null; };
  grid.addEventListener('pointerdown', (ev) => {
    const cell = ev.target.closest('.sg-cell');
    if (!cell || ev.button > 0) return;
    ev.preventDefault();
    _availPaint = { code, turnOn: !cell.classList.contains('on'), anchor: pos(cell), before: cells.map(c => c.classList.contains('on')) };
    paintTo(cell);
    try { grid.setPointerCapture(ev.pointerId); } catch {}
  });
  grid.addEventListener('pointermove', (ev) => { if (_availPaint) paintTo(cellAt(ev.clientX, ev.clientY)); });
  const finish = () => {
    if (!_availPaint) return;
    const p = _availPaint;
    _availPaint = null;
    commitMyAvailability(p.code, grid);
  };
  grid.addEventListener('pointerup', finish);
  grid.addEventListener('pointercancel', finish);
  grid.addEventListener('lostpointercapture', finish);
}
function commitMyAvailability(code, grid) {
  const g = findGroup(code);
  if (!g) return;
  const days = {};
  for (let d = 0; d < 7; d++) days['d' + d] = emptyDayStr().split('');
  grid.querySelectorAll('.sg-cell.on').forEach(c => { days['d' + c.dataset.day][Number(c.dataset.slot)] = '1'; });
  Object.keys(days).forEach(k => { days[k] = days[k].join(''); });
  const u = myUidFor(g);
  const before = g.avail?.[u];
  if (before && [0, 1, 2, 3, 4, 5, 6].every(d => availDay(before, d) === days['d' + d])) return;
  groupWrite(code, { [`avail.${u}`]: { ...days, name: myGroupName(), updatedAt: Date.now() } });
}
function clearMyAvailability(code) {
  const g = findGroup(code);
  groupWrite(code, { [`avail.${myUidFor(g)}`]: GW_DELETE });
}
// Ranks windows where the most people are free together. For each day and
// start slot, extends forward while the same people stay free, recording a
// window each time someone drops off; then keeps only windows no other
// window beats on both length and who's included.
function groupBestTimes(g) {
  const entries = Object.entries(g.avail || {}).filter(([, a]) => availHasAny(a));
  if (!entries.length) return [];
  const minPeople = entries.length >= 2 ? 2 : 1;
  const windows = [];
  for (let day = 0; day < 7; day++) {
    const free = Array.from({ length: AVAIL_SLOTS }, (_, i) => entries.filter(([, a]) => availDay(a, day)[i] === '1').map(([id]) => id));
    for (let s = 0; s < AVAIL_SLOTS; s++) {
      let inter = free[s];
      if (inter.length < minPeople) continue;
      for (let e = s + 1; e <= AVAIL_SLOTS; e++) {
        const next = e < AVAIL_SLOTS ? inter.filter(id => free[e].includes(id)) : [];
        if (next.length < inter.length) {
          windows.push({ day, start: s, end: e, uids: inter });
          if (next.length < minPeople) break;
        }
        inter = next;
      }
    }
  }
  const beats = (o, w) => o !== w && o.day === w.day && o.start <= w.start && o.end >= w.end && w.uids.every(id => o.uids.includes(id)) && (o.end - o.start > w.end - w.start || o.uids.length > w.uids.length);
  let best = windows.filter(w => !windows.some(o => beats(o, w)));
  if (best.some(w => w.end - w.start >= 2)) best = best.filter(w => w.end - w.start >= 2);
  const todayDow = new Date().getDay();
  return best.sort((a, b) =>
    b.uids.length - a.uids.length
    || Math.min(b.end - b.start, 6) - Math.min(a.end - a.start, 6)
    || ((a.day - todayDow + 7) % 7) - ((b.day - todayDow + 7) % 7)
    || a.start - b.start,
  ).slice(0, 5);
}
function bestTimeRow(g, w) {
  const total = Object.values(g.avail || {}).filter(availHasAny).length;
  const everyone = w.uids.length === total;
  return `
    <div class="sg-best">
      <div class="sg-best-when"><div class="sg-strong">${AVAIL_DAYS_LONG[w.day]}s, ${fmtTime(slotTime(w.start))}–${fmtTime(slotTime(w.end))}</div>
        <div class="small muted">${everyone ? 'Everyone who’s added availability' : `${w.uids.length} of ${total}`}: ${w.uids.map(id => `<span class="sg-name-dot" style="--p:${personColor(g, id)}"></span>${esc(personName(g, id))}`).join(', ')}</div></div>
      <button class="btn btn-sm" onclick="scheduleFromBestTime('${g.code}',${w.day},${w.start},${w.end})">Schedule</button>
    </div>`;
}
function scheduleFromBestTime(code, day, startSlot, endSlot) {
  const offset = (day - new Date().getDay() + 7) % 7;
  let date = addDays(todayIso(), offset);
  const start = slotTime(startSlot);
  if (offset === 0 && toMin(start) <= new Date().getHours() * 60 + new Date().getMinutes()) date = addDays(date, 7);
  const end = slotTime(Math.min(endSlot, startSlot + 4)); // suggest up to 2 hours, not a 6-hour marathon
  openSessionModal(code, null, { date, start, end });
}
function copyAvailabilityNudge(code) {
  const g = findGroup(code);
  copyText(`Hey! Can everyone add when you're free this week in Semester HQ? Open "${g.name}" → Find a time. ${groupInviteLink(code)}`, 'Reminder copied. Paste it in your group chat.');
}

