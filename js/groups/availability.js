/* ── Study Groups: Find a time ───────────────────────────────────
   Each member paints the half hours they're free; the tab leads with the
   answer (the best time, who can come, one tap to schedule it), then your
   week and everyone's grid under "See the details". Loaded after
   js/groups/sync.js.

   Only free or busy is ever shared: avail.{uid} = { d0..d6, name, updatedAt },
   where each dN is a 32-character '0'/'1' string. Filling from your class
   schedule writes the same shape; the classes themselves never leave you.

   Per-visit UI state, in memory only (no settings keys, nothing stored):
   - window._availView    'people' | 'heat' once someone picks one
   - window._availFocus   the uid highlighted in the People view
   - window._availEditing the group code whose grid a finger can paint.
                          Touch only: a finger scrolls the page until you tap
                          "Edit my times". Mouse and pen always paint.
   - window._availFillAnim the group code whose next render plays the fill
   - _availOpen[code]     "See the details" opened on a phone
──────────────────────────────────────────────────────────────── */
const AVAIL_START_HOUR = 7;
const AVAIL_SLOT_MIN = 30;
const AVAIL_SLOTS = 32; // 7:00am to 11:00pm in half hours
const AVAIL_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const AVAIL_DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// The window a schedule-drafted availability starts from (see fillAvailabilityFromSchedule).
const AVAIL_AUTO_START = '09:00';
const AVAIL_AUTO_END = '21:00';
const AVAIL_STALE_DAYS = 21;       // older than this, a person's grid says "updated Aug 30"
const AVAIL_SCHEDULE_SLOTS = 4;    // "Schedule it" pre-fills up to 2 hours
const _availOpen = {};

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
    // The next render fills the grid column by column (once), and a phone
    // opens the details so you can see what was drafted.
    window._availFillAnim = code;
    _availOpen[code] = true;
    groupWrite(code, { [`avail.${u}`]: { ...availabilityFromSchedule(), name: myGroupName(), updatedAt: Date.now() } });
    toast(availIsTouch() ? 'Drafted from your class schedule. Tap Edit my times to change anything.' : 'Drafted from your class schedule. Drag to fix anything that’s off.', 'success', 4000);
  };
  if (availHasAny(g.avail?.[u])) confirmDialog('Replace what you’ve painted with a draft from your class schedule? You can still adjust it after.', apply, 'Replace', 'Start over from your schedule?');
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

/* ── Small helpers: words, dates, devices ──────────────────────── */
function availIsTouch() { try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; } }
function availReducedMotion() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } }
// "5:00 to 7:30 PM", or "11:30 AM to 1:00 PM" when the window crosses noon.
function availRange(startSlot, endSlot) {
  const a = fmtTime(slotTime(startSlot)), b = fmtTime(slotTime(endSlot));
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} to ${b}` : `${a} to ${b}`;
}
// Half-hour slots as words: "30 min", "1 hour", "2½ hours".
function availSpan(slots) {
  if (slots < 2) return '30 min';
  const h = Math.floor(slots / 2), half = slots % 2 ? '½' : '';
  return `${h}${half} hour${h === 1 && !half ? '' : 's'}`;
}
// The next date a weekly window starts on. When today's slot has already
// started, that's next week. scheduleFromBestTime and the exam note share it,
// so the note always talks about the day the session would land on.
function nextSlotDate(day, startSlot, now = new Date()) {
  const offset = (day - now.getDay() + 7) % 7;
  const date = addDays(iso(now), offset);
  return offset === 0 && toMin(slotTime(startSlot)) <= now.getHours() * 60 + now.getMinutes() ? addDays(date, 7) : date;
}
function availContributors(g) { return Object.entries(g.avail || {}).filter(([id, a]) => safeId(id) && availHasAny(a)); }
// "Aug 30" when someone's grid is more than three weeks old, else ''.
function availStaleLabel(entry) {
  const t = entry?.updatedAt;
  return Number.isFinite(t) && Date.now() - t > AVAIL_STALE_DAYS * 86400000 ? fmtDate(iso(t)) : '';
}
function availFirstName(g, id) { return id === myUidFor(g) ? 'You' : String(personName(g, id)).split(' ')[0]; }
// Who a window works for. "everyone" only when every member has added theirs
// and every one of them is free; otherwise it counts the people who've added.
function availWho(w, added, members) {
  const n = w.uids.length;
  if (n === added && added === members) return { html: 'works for <span class="sg-answer-em">everyone</span>', text: 'works for everyone', short: 'Everyone' };
  if (n === added) { const all = n === 2 ? 'both' : `all ${n}`; return { html: `works for ${all} so far`, text: `works for ${all} so far`, short: `${n === 2 ? 'Both' : `All ${n}`} so far` }; }
  return { html: `works for ${n} of ${added} so far`, text: `works for ${n} of ${added} so far`, short: `${n} of ${added}` };
}
// Up to n runners-up, skipping ones that overlap a time already shown on the
// same day (Wednesday 5 to 8 says little under Wednesday 5 to 7:30) unless
// nothing else is left.
function availAlternates(best, n = 2) {
  const [first, ...rest] = best;
  if (!first) return [];
  const clash = (a, b) => a.day === b.day && a.start < b.end && b.start < a.end;
  const picked = [];
  rest.forEach(w => { if (picked.length < n && ![first, ...picked].some(o => clash(o, w))) picked.push(w); });
  rest.forEach(w => { if (picked.length < n && !picked.includes(w)) picked.push(w); });
  return picked.sort((a, b) => best.indexOf(a) - best.indexOf(b));
}
// Your own exam on the day this week's session would land on. Only you see
// it: examList() reads your planner, never the group.
function availExamNote(w) {
  if (typeof examList !== 'function') return '';
  const date = nextSlotDate(w.day, w.start);
  const exams = examList().filter(a => a.dueDate === date);
  if (!exams.length) return '';
  const s = AVAIL_START_HOUR * 60 + w.start * AVAIL_SLOT_MIN, e = AVAIL_START_HOUR * 60 + w.end * AVAIL_SLOT_MIN;
  const during = (a) => /^\d{2}:\d{2}$/.test(a.dueTime || '') && toMin(a.dueTime) >= s - 90 && toMin(a.dueTime) < e;
  const a = exams.find(during) || exams[0];
  const title = a.title || 'an exam';
  const day = fmtDate(date, { weekday: 'long', month: 'short', day: 'numeric' });
  const text = during(a)
    ? `You have ${title} at ${fmtTime(a.dueTime)} on ${day}, during this time.`
    : `You have ${title} that day (${day}${a.dueTime ? `, ${fmtTime(a.dueTime)}` : ''}).`;
  return `<p class="sg-exam-note">${icon('flag', 14)}<span>${esc(text)} <span class="sg-exam-note-private">Only you see this.</span></span></p>`;
}

/* ── Find a time: the answer first, then the grids ─────────────── */
function groupAvailabilityTab(g) {
  const u = myUidFor(g);
  const contributors = availContributors(g);
  const people = groupPeople(g);
  const best = groupBestTimes(g, 8);
  const ctx = {
    u, people, best,
    added: contributors.length,
    members: Math.max(people.length, contributors.length),
    mineAdded: availHasAny(g.avail?.[u]),
    busy: scheduleBusyRanges().length > 0,
    editing: window._availEditing === g.code && state.groupTab === 'availability',
  };
  if (!ctx.editing && window._availEditing === g.code) window._availEditing = null;
  const open = !!_availOpen[g.code] || ctx.editing;
  return `
    <div class="sg-find">
      ${availProgressRow(g, ctx)}
      ${availAnswerCard(g, ctx)}
      <div class="sg-details ${open ? 'is-open' : ''}">
        <button type="button" class="sg-details-toggle" aria-expanded="${open}" aria-controls="sg-details-body" onclick="availToggleDetails('${g.code}')"><span>${open ? 'Hide the details' : 'See the details'}</span><span class="sg-details-sub">Your week and everyone’s</span>${icon('chevron-down', 16)}</button>
        <div class="sg-avail-wrap" id="sg-details-body" ${open ? '' : 'hidden'}>
          ${availMyWeekCard(g, ctx)}
          ${availEveryoneCard(g, ctx, contributors)}
        </div>
      </div>
    </div>
    ${ctx.editing ? `<div class="sg-editbar" role="region" aria-label="Editing your times"><span class="sg-editbar-text">${icon('check', 14)}<span>Saves as you paint</span></span><button type="button" class="btn btn-primary sg-editbar-done" onclick="availStopEditing()">Done</button></div>` : ''}
  `;
}
// 1. Who's added theirs: every member's face, the missing ones hollow.
function availProgressRow(g, ctx) {
  const { u, people, added, members, mineAdded, busy } = ctx;
  const isIn = (p) => availHasAny(g.avail?.[p.uid]);
  const ordered = [...people.filter(isIn), ...people.filter(p => !isIn(p))];
  const shown = ordered.slice(0, 12);
  const faces = shown.map(p => {
    const name = p.uid === u ? 'You' : p.name;
    if (isIn(p)) {
      const stale = availStaleLabel(g.avail?.[p.uid]);
      return `<span class="sg-face" title="${esc(`${name}: added${stale ? `, updated ${stale}` : ''}`)}">${personAvatar(p.uid, name, 28, personColor(g, p.uid))}</span>`;
    }
    return `<span class="sg-face" title="${esc(`${name}: not yet`)}"><span class="avatar sg-avatar sg-face-missing" style="width:28px;height:28px;font-size:12px">${esc((String(name).trim()[0] || '?').toUpperCase())}</span></span>`;
  }).join('') + (ordered.length > shown.length ? `<span class="sg-face-more">+${ordered.length - shown.length}</span>` : '');
  const missing = people.filter(p => !isIn(p));
  const waitNames = [...missing.filter(p => p.uid !== u).map(p => String(p.name).split(' ')[0]), ...(missing.some(p => p.uid === u) ? ['you'] : [])];
  const wait = !waitNames.length ? 'Everyone’s in'
    : waitNames.length <= 3 ? `Waiting on ${waitNames.length === 1 ? waitNames[0] : `${waitNames.slice(0, -1).join(', ')} and ${waitNames[waitNames.length - 1]}`}`
      : `Waiting on ${waitNames.slice(0, 2).join(', ')} and ${waitNames.length - 2} others`;
  const stale = people.filter(isIn).map(p => [p, availStaleLabel(g.avail?.[p.uid])]).filter(([, s]) => s);
  const staleText = stale.length ? stale.slice(0, 2).map(([p, s]) => `${p.uid === u ? 'Yours' : `${String(p.name).split(' ')[0]}’s`} is from ${s}`).join(' · ') : '';
  // "Add mine" here only when the answer card isn't already asking for it.
  const addMine = !mineAdded && added >= 2
    ? `<button type="button" class="sg-link sg-progress-addmine" onclick="${busy ? `fillAvailabilityFromSchedule('${g.code}')` : `availStartEditing('${g.code}')`}">${icon('calendar', 14)} ${busy ? 'Fill mine from my schedule' : 'Add mine'}</button>` : '';
  const nudge = missing.some(p => p.uid !== u) && !g.local ? `<button type="button" class="sg-link" onclick="copyAvailabilityNudge('${g.code}')">${icon('copy', 14)} Copy a nudge</button>` : '';
  return `
    <div class="card sg-progress">
      <div class="sg-progress-faces" aria-hidden="true">${faces}</div>
      <div class="sg-progress-text">
        <div class="sg-progress-count">${added} of ${members} added</div>
        <div class="sg-progress-sub">${esc(wait)}${staleText ? ` · <span class="sg-progress-stale">${esc(staleText)}</span>` : ''}</div>
      </div>
      ${addMine || nudge ? `<div class="sg-progress-actions">${addMine}${nudge}</div>` : ''}
    </div>`;
}
// 2. The answer, in serif, with up to two runners-up. Fewer than two people
// in: the card asks for what gets you there instead.
function availAnswerCard(g, ctx) {
  const { u, best, added, members, mineAdded, busy } = ctx;
  if (added >= 2 && best.length) {
    const w = best[0];
    const who = availWho(w, added, members);
    const alts = availAlternates(best, 2);
    const free = w.uids.map(id => ({ uid: id, name: personName(g, id) }));
    const slots = w.end - w.start;
    return `
      <section class="card sg-answer${alts.length ? '' : ' is-solo'}" aria-label="Best time to meet">
        <div class="sg-answer-main">
          <div class="eyebrow">Best time</div>
          <h3 class="sg-answer-line">${AVAIL_DAYS_LONG[w.day]}s, ${esc(availRange(w.start, w.end))} <span class="sg-answer-who">${who.html}</span></h3>
          <div class="sg-answer-sub">${availSpan(slots)} open · every ${AVAIL_DAYS_LONG[w.day]}</div>
          <div class="sg-answer-faces">${spaceFacePile({ people: free, meUid: u, verb: 'free', size: 26, max: 6, colorOf: (id) => personColor(g, id) })}</div>
          ${availExamNote(w)}
          <div class="sg-answer-foot">
            <button type="button" class="btn btn-primary" onclick="scheduleFromBestTime('${g.code}',${w.day},${w.start},${w.end})">${icon('calendar', 14)} Schedule it</button>
            ${slots > AVAIL_SCHEDULE_SLOTS ? `<span class="sg-answer-hint">Starts as a 2 hour session. You can change it.</span>` : ''}
          </div>
        </div>
        ${alts.length ? `
        <div class="sg-answer-alts">
          <div class="sg-answer-alts-label">Also works</div>
          ${alts.map(a => {
            const aw = availWho(a, added, members);
            return `
            <div class="sg-alt">
              <div class="sg-alt-text">
                <div class="sg-alt-when">${AVAIL_DAYS_LONG[a.day]}s, ${esc(availRange(a.start, a.end))}</div>
                <div class="sg-alt-meta">${avatarStack(g, 4, 22, a.uids)}<span>${esc(aw.short)} · ${availSpan(a.end - a.start)}</span></div>
                ${availExamNote(a)}
              </div>
              <button type="button" class="btn btn-sm" aria-label="Schedule ${esc(`${AVAIL_DAYS_LONG[a.day]}s, ${availRange(a.start, a.end)}`)}" onclick="scheduleFromBestTime('${g.code}',${a.day},${a.start},${a.end})">Schedule</button>
            </div>`;
          }).join('')}
        </div>` : ''}
      </section>`;
  }
  let title, body, actions;
  if (added >= 2) {
    title = 'No time works for two people yet';
    body = 'Everyone’s free at different times so far. Opening up a few more evenings usually finds one.';
    actions = mineAdded ? `<button type="button" class="btn" onclick="availStartEditing('${g.code}')">${icon('pencil', 14)} Change my times</button>` : '';
  } else if (!mineAdded && busy) {
    title = 'Fill yours from your class schedule';
    body = `You start free ${fmtTime(AVAIL_AUTO_START)} to ${fmtTime(AVAIL_AUTO_END)}, minus your classes. The group sees free or busy, never which class.`;
    actions = `<button type="button" class="btn btn-primary" onclick="fillAvailabilityFromSchedule('${g.code}')">${icon('calendar', 14)} Fill from my class schedule</button><button type="button" class="btn btn-ghost" onclick="availStartEditing('${g.code}')">Paint it myself</button>`;
  } else if (!mineAdded) {
    title = 'Add your times to find one';
    body = 'Mark the hours you’re usually free each week. Once two people have, the best time shows up here.';
    actions = `<button type="button" class="btn btn-primary" onclick="availStartEditing('${g.code}')">${icon('pencil', 14)} Add my times</button>`;
  } else {
    title = 'Waiting on one more person';
    body = 'Yours is in. The best time shows up here as soon as someone else adds theirs.';
    actions = g.local ? '' : `<button type="button" class="btn" onclick="copyAvailabilityNudge('${g.code}')">${icon('copy', 14)} Copy a nudge</button>`;
  }
  return `
    <section class="card sg-answer is-prompt" aria-label="Best time to meet">
      <div class="sg-answer-main">
        <div class="eyebrow">Best time</div>
        <h3 class="sg-answer-line">${esc(title)}</h3>
        <p class="sg-answer-sub">${esc(body)}</p>
        ${actions ? `<div class="sg-answer-foot">${actions}</div>` : ''}
      </div>
    </section>`;
}
// 3. Your week: fill from your schedule, paint, pick your color.
function availMyWeekCard(g, ctx) {
  const { u, mineAdded, busy, editing, added } = ctx;
  const color = personColor(g, u);
  // Primary while your grid is empty, unless the answer card above is already asking for the same fill.
  const fillCls = mineAdded ? 'btn-ghost' : added >= 2 ? 'btn-primary' : '';
  const fill = busy ? `<button type="button" class="btn ${fillCls} btn-sm" data-tip="Free ${fmtTime(AVAIL_AUTO_START)} to ${fmtTime(AVAIL_AUTO_END)}, minus your classes" onclick="fillAvailabilityFromSchedule('${g.code}')">${icon('calendar', 14)} ${mineAdded ? 'Redraft from my schedule' : 'Fill from my class schedule'}</button>` : '';
  return `
    <section class="card sg-week-card sg-week-mine${editing ? ' is-editing' : ''}" style="--me-color:${color}" aria-label="Your week">
      <div class="sg-avail-head">
        <h3 class="sg-h3">Your week</h3>
        <button type="button" class="sg-me-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Your color in this group" onclick="availColorMenu(this,'${g.code}')">${personAvatar(u, 'You', 22, color)}<span>Your color</span>${icon('chevron-down', 14)}</button>
      </div>
      <div class="sg-avail-actions">
        ${editing ? '' : `<button type="button" class="btn btn-sm sg-edit-times" onclick="availStartEditing('${g.code}')">${icon('pencil', 14)} Edit my times</button>`}
        ${fill}
        ${mineAdded ? `<button type="button" class="btn btn-ghost btn-sm" onclick="clearMyAvailability('${g.code}')">Clear</button>` : ''}
      </div>
      <p class="sg-avail-hint"><span class="sg-hint-mouse">Drag to paint the times you’re free.</span><span class="sg-hint-touch">${editing ? 'Tap or drag to paint the times you’re free.' : 'Scrolling is safe. Tap Edit my times to paint.'}</span> The group sees free or busy, never your classes.</p>
      ${availGrid(g, availDayOrder(), 'mine', null, { editing })}
    </section>`;
}
// 4. Everyone: the heatmap (or one stripe per person), with who's free on hover or tap.
function availEveryoneCard(g, ctx, contributors) {
  const { u } = ctx;
  const K = contributors.length;
  const picked = window._availView === 'heat' || window._availView === 'people' ? window._availView : null;
  const view = K > 8 ? 'heat' : picked || (K > 3 ? 'heat' : 'people');
  const focus = contributors.some(([id]) => id === window._availFocus) ? window._availFocus : null;
  const touch = availIsTouch();
  return `
    <section class="card sg-week-card sg-week-all" aria-label="Everyone’s week">
      <div class="sg-avail-head">
        <h3 class="sg-h3">Everyone</h3>
        ${K <= 8 ? `<div class="segmented sg-view-toggle"><button type="button" class="${view === 'people' ? 'active' : ''}" aria-pressed="${view === 'people'}" onclick="window._availView='people';render()">People</button><button type="button" class="${view === 'heat' ? 'active' : ''}" aria-pressed="${view === 'heat'}" onclick="window._availView='heat';render()">Heatmap</button></div>` : `<span class="sg-avail-count">${K} added</span>`}
      </div>
      ${view === 'people' ? `
        <div class="sg-legend-people" role="group" aria-label="Highlight one person">
          ${K ? contributors.map(([id, a]) => {
            const stale = availStaleLabel(a);
            return `<button type="button" class="sg-legend-person ${focus === id ? 'active' : ''} ${focus && focus !== id ? 'dim' : ''}" style="--p:${personColor(g, id)}" aria-pressed="${focus === id}" onclick="window._availFocus=${focus === id ? 'null' : `'${id}'`};render()"><span class="sg-legend-dot"></span>${esc(id === u ? 'You' : personName(g, id))}${stale ? `<span class="sg-legend-stale">updated ${esc(stale)}</span>` : ''}</button>`;
          }).join('') : '<span class="sg-avail-none">No one has added their times yet.</span>'}
        </div>` : ''}
      ${availGrid(g, availDayOrder(), view, focus)}
      <div class="sg-grid-foot">
        <div class="sg-grid-readout" aria-live="polite" data-rest="${touch ? 'Tap a time to see who’s free.' : 'Point at a time to see who’s free.'}">${focus ? `Showing only ${esc(focus === u ? 'you' : personName(g, focus))}. ${touch ? 'Tap' : 'Click'} the name again for everyone.` : touch ? 'Tap a time to see who’s free.' : 'Point at a time to see who’s free.'}</div>
        ${view === 'heat' ? `<div class="sg-legend"><span>Fewer</span><span class="sg-legend-bar"></span><span>Everyone</span></div>` : ''}
      </div>
    </section>`;
}
function availToggleDetails(code) {
  _availOpen[code] = !_availOpen[code];
  if (!_availOpen[code] && window._availEditing === code) window._availEditing = null;
  render();
}
// Turns finger painting on for this group's grid until Done, a tab change or
// leaving the group. Mouse and pen never need it; the button and the Done bar
// only show on touch screens (CSS any-pointer: coarse).
function availStartEditing(code) {
  // Harmless for a mouse (it paints either way); a touch laptop needs it.
  window._availEditing = code;
  _availOpen[code] = true;
  render();
  requestAnimationFrame(() => {
    const card = document.querySelector('.sg-week-mine');
    if (card) card.scrollIntoView({ block: 'start', behavior: availReducedMotion() ? 'auto' : 'smooth' });
  });
}
function availStopEditing() {
  window._availEditing = null;
  render();
}
// Your color, in a popover on your avatar. Arrow keys move between swatches,
// Esc closes (openMenu), and each swatch says whether someone else uses it.
function availColorMenu(btn, code) {
  const g = findGroup(code);
  if (!g) return;
  const me = myUidFor(g);
  const mine = personColor(g, me);
  const takenBy = {};
  groupPeople(g).forEach(p => { if (p.uid !== me && HEX_COLOR.test(g.people?.[p.uid]?.color || '')) takenBy[g.people[p.uid].color] = p.name; });
  const swatches = PERSON_COLORS.map(c => `<button type="button" class="menu-item sg-swatch ${c === mine ? 'active' : ''}" role="menuitemradio" aria-checked="${c === mine}" style="background:${c}" aria-label="Color ${c}${takenBy[c] ? `, also used by ${esc(takenBy[c])}` : ''}" title="${takenBy[c] ? `Also used by ${esc(takenBy[c])}` : 'Use this color'}" onclick="setMyGroupColor('${g.code}','${c}')">${takenBy[c] ? '<span class="sg-swatch-taken"></span>' : ''}</button>`).join('');
  const el = openMenu(btn, `<div class="sg-color-pop"><div class="sg-color-pop-label">Your color in this group</div><div class="sg-swatches">${swatches}</div></div>`, { align: 'start' });
  if (!el) return;
  el.classList.add('sg-color-menu');
  el.setAttribute('aria-label', 'Your color');
  el.querySelector('.sg-swatch.active')?.focus({ preventScroll: true });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const list = [...el.querySelectorAll('.sg-swatch')];
    const i = list.indexOf(document.activeElement);
    e.preventDefault();
    list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length]?.focus();
  });
}

/* ── The grids ─────────────────────────────────────────────────── */
function availGrid(g, days, mode, focus = null, { editing = false } = {}) {
  const u = myUidFor(g);
  const contributors = availContributors(g);
  const mine = g.avail?.[u];
  // The one render after "Fill from my class schedule" plays the fill.
  const filling = mode === 'mine' && window._availFillAnim === g.code && !availReducedMotion();
  const rows = [];
  rows.push(`<div class="sg-grid-corner"></div>${days.map(d => `<div class="sg-grid-day">${AVAIL_DAYS[d]}</div>`).join('')}`);
  for (let i = 0; i < AVAIL_SLOTS; i++) {
    const hourRow = i % 2 === 0;
    rows.push(`<div class="sg-grid-time">${hourRow ? shortHour(AVAIL_START_HOUR + i / 2) : ''}</div>`);
    rows.push(days.map(d => {
      const col = days.indexOf(d);
      if (mode === 'mine') {
        const day = availDay(mine, d), on = day[i] === '1';
        const run = on ? `${day[i - 1] === '1' ? '' : 'run-start'} ${day[i + 1] === '1' ? '' : 'run-end'}` : '';
        const delay = filling && on ? ` style="--d:${col * 70 + i * 8}ms"` : '';
        return `<div class="sg-cell ${hourRow ? 'hr' : ''} ${on ? 'on' : ''} ${run}" data-day="${d}" data-col="${col}" data-slot="${i}"${delay}></div>`;
      }
      const free = contributors.filter(([, a]) => availDay(a, d)[i] === '1').map(([id]) => id);
      const allAt = (slot) => contributors.length >= 2 && contributors.every(([, a]) => availDay(a, d)[slot] === '1');
      const everyone = allAt(i);
      const allRun = everyone ? `${allAt(i - 1) ? '' : 'all-start'} ${allAt(i + 1) ? '' : 'all-end'}` : '';
      const mineFirst = [...free.filter(id => id === u), ...free.filter(id => id !== u)];
      const label = `${AVAIL_DAYS[d]} ${fmtTime(slotTime(i))} · ${free.length ? `${mineFirst.map(id => availFirstName(g, id)).join(', ')} free` : 'Nobody free'}`;
      if (mode === 'people') {
        // One thin stripe per person, in the same order in every cell, so each
        // person's free time lines up into a colored column you can follow.
        const stripes = contributors.map(([id, a]) => {
          const on = free.includes(id) && (!focus || focus === id);
          if (!on) return '<i></i>';
          const day = availDay(a, d);
          return `<i class="${day[i - 1] === '1' ? '' : 'rs'} ${day[i + 1] === '1' ? '' : 're'}" style="background:${personColor(g, id)}"></i>`;
        }).join('');
        return `<div class="sg-cell sg-cell-people ${hourRow ? 'hr' : ''} ${everyone && !focus ? `all ${allRun}` : ''}" data-free="${esc(label)}">${stripes}</div>`;
      }
      // One person free still reads as a tint, not as nearly blank.
      const pct = contributors.length && free.length ? Math.round(18 + (free.length / contributors.length) * 82) : 0;
      return `<div class="sg-cell ${hourRow ? 'hr' : ''} ${everyone ? `all ${allRun}` : ''}" style="--heat:${pct}%" data-free="${esc(label)}"></div>`;
    }).join(''));
  }
  const attrs = mode === 'mine'
    ? `id="sg-avail-mine" data-code="${g.code}" aria-label="Your weekly availability. ${editing ? 'Tap or drag' : 'Click and drag'} to mark free time."`
    : `aria-label="Everyone’s availability, ${mode === 'people' ? 'one color per person' : 'heatmap'}"`;
  const cls = mode === 'mine' ? `sg-grid-mine${editing ? ' is-editing' : ''}${filling ? ' is-filling' : ''}` : `sg-grid-view ${mode === 'people' ? 'sg-grid-people' : 'sg-grid-heat'}`;
  return `<div class="sg-grid-scroll"><div class="sg-grid ${cls}" ${attrs} style="--sg-cols:${days.length}">${rows.join('')}</div></div>`;
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
// Hover (mouse) or tap (touch) a cell in Everyone: the line under the grid
// says who's free then. Nothing paints there, so taps are free to use.
function bindAvailabilityReadout() {
  document.querySelectorAll('.sg-grid-view:not([data-bound])').forEach(grid => {
    grid.dataset.bound = '1';
    const out = grid.closest('.sg-week-all')?.querySelector('.sg-grid-readout');
    if (!out) return;
    const rest = out.textContent;
    let picked = null;
    const show = (cell) => {
      if (picked) picked.classList.remove('is-picked');
      picked = cell;
      if (cell) { cell.classList.add('is-picked'); out.textContent = cell.dataset.free; } else out.textContent = rest;
    };
    const cellOf = (ev) => ev.target.closest?.('.sg-cell[data-free]');
    grid.addEventListener('pointerover', (ev) => { if (ev.pointerType === 'mouse') { const c = cellOf(ev); if (c) show(c); } });
    grid.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') show(null); });
    grid.addEventListener('click', (ev) => { const c = cellOf(ev); if (c) show(c === picked && ev.pointerType !== 'mouse' ? null : c); });
  });
}
function bindAvailabilityPainting() {
  bindAvailabilityReadout();
  const grid = document.getElementById('sg-avail-mine');
  if (!grid) {
    // Off the tab (or the details are shut): a finger scrolls again.
    if (window._availEditing && (state.groupTab !== 'availability' || !document.querySelector('.sg-find'))) window._availEditing = null;
    return;
  }
  if (grid.classList.contains('is-filling')) window._availFillAnim = null;
  if (grid.dataset.bound) return;
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
    // A finger scrolls the page unless you've tapped "Edit my times". Return
    // before preventDefault, and before a paint starts: the pointercancel a
    // scroll fires would otherwise commit a stray cell.
    if (ev.pointerType === 'touch' && window._availEditing !== code) return;
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
function groupBestTimes(g, limit = 5) {
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
  ).slice(0, limit);
}
function scheduleFromBestTime(code, day, startSlot, endSlot) {
  const date = nextSlotDate(day, startSlot);
  const start = slotTime(startSlot);
  const end = slotTime(Math.min(endSlot, startSlot + AVAIL_SCHEDULE_SLOTS)); // suggest up to 2 hours, not a 6-hour marathon
  openSessionModal(code, null, { date, start, end });
}
function copyAvailabilityNudge(code) {
  const g = findGroup(code);
  copyText(`Hey! Can everyone add when you're free this week in Semester HQ? Open "${g.name}", then Find a time. It can fill from your class schedule in one tap. ${groupInviteLink(code)}`, 'Nudge copied. Paste it in your group chat.');
}
