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
   - _availAdd[code]      the Add a time row's day, from and to picks

   Without a pointer: "Add a time" (a day and two half-hour selects) and
   the list of your saved times under Your week write the same d0..d6
   strings the painter does, and a per-day text summary follows the
   Everyone grid for screen readers (the grids themselves are role=img).
   Painted runs are drawn as one element each (.sg-run, .sg-prun) placed
   on the grid's rows, so every shape has the same radius on all corners.
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
const _availAdd = {};

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
// "Wednesdays, 5:00 to 7:30 PM". The answer card and the group home both
// use it, so the two places say the best time the same way.
function availWhenText(w) { return `${AVAIL_DAYS_LONG[w.day]}s, ${availRange(w.start, w.end)}`; }
// [start, end) half-hour runs of '1' in one day string.
function availRuns(dayStr) {
  const out = [];
  let s = -1;
  for (let i = 0; i <= AVAIL_SLOTS; i++) {
    const on = i < AVAIL_SLOTS && dayStr[i] === '1';
    if (on && s < 0) s = i;
    if (!on && s >= 0) { out.push([s, i]); s = -1; }
  }
  return out;
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
        <button type="button" class="sg-details-toggle" aria-expanded="${open}" aria-controls="sg-details-body" onclick="availToggleDetails('${g.code}')"><span class="sg-details-label">See the details</span><span class="sg-details-sub">Your week, everyone’s, and your times as a list</span></button>
        <div class="sg-avail-wrap" id="sg-details-body">
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
          <h3 class="sg-answer-line">${esc(availWhenText(w))} <span class="sg-answer-who">${who.html}</span></h3>
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
                <div class="sg-alt-when">${esc(availWhenText(a))}</div>
                <div class="sg-alt-meta">${avatarStack(g, 4, 22, a.uids)}<span>${esc(aw.short)} · ${availSpan(a.end - a.start)}</span></div>
                ${availExamNote(a)}
              </div>
              <button type="button" class="btn btn-sm" aria-label="Schedule ${esc(availWhenText(a))}" onclick="scheduleFromBestTime('${g.code}',${a.day},${a.start},${a.end})">Schedule</button>
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
// 3. Your week: the grid first (so its hours line up with Everyone's),
// then fill from your schedule, and the keyboard route: Add a time and
// your saved times as a list.
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
      ${availGrid(g, availDayOrder(), 'mine', null, { editing })}
      <div class="sg-week-tools">
        <div class="sg-avail-actions">
          ${editing ? '' : `<button type="button" class="btn btn-sm sg-edit-times" onclick="availStartEditing('${g.code}')">${icon('pencil', 14)} Edit my times</button>`}
          ${fill}
          ${mineAdded ? `<button type="button" class="btn btn-ghost btn-sm" onclick="clearMyAvailability('${g.code}')">Clear</button>` : ''}
        </div>
        <p class="sg-avail-hint"><span class="sg-hint-mouse">Drag to paint the times you’re free.</span><span class="sg-hint-touch">${editing ? 'Tap or drag to paint the times you’re free.' : 'Scrolling is safe. Tap Edit my times to paint.'}</span> The group sees free or busy, never your classes.</p>
      </div>
      ${availAddTimeRow(g)}
      ${availMyTimesList(g, u)}
    </section>`;
}
// Add a time: a day and a half-hour range, merged into the same d0..d6
// string the painter writes. The route for a keyboard or screen reader,
// and the bigger target for the 14px cells on a phone.
function availAddTimeRow(g) {
  const code = g.code;
  const pick = availAddPick(code);
  const opt = (v, label, on) => `<option value="${v}"${on ? ' selected' : ''}>${esc(label)}</option>`;
  const days = availDayOrder().map(d => opt(d, AVAIL_DAYS_LONG[d], d === pick.day)).join('');
  const froms = Array.from({ length: AVAIL_SLOTS }, (_, i) => opt(i, fmtTime(slotTime(i)), i === pick.from)).join('');
  const tos = Array.from({ length: AVAIL_SLOTS }, (_, i) => opt(i + 1, fmtTime(slotTime(i + 1)), i + 1 === pick.to)).join('');
  const change = `onchange="availAddChange('${code}')"`;
  return `
    <div class="sg-addtime" role="group" aria-labelledby="sg-addtime-h">
      <div class="sg-addtime-h" id="sg-addtime-h">Add a time</div>
      <div class="sg-addtime-row">
        <label class="sr-only" for="sg-at-day">Day</label>
        <select class="select sg-at-day" id="sg-at-day" ${change}>${days}</select>
        <span class="sg-addtime-range">
          <label class="sr-only" for="sg-at-from">From</label>
          <select class="select sg-at-time" id="sg-at-from" ${change}>${froms}</select>
          <span class="sg-addtime-to" aria-hidden="true">to</span>
          <label class="sr-only" for="sg-at-to">To</label>
          <select class="select sg-at-time" id="sg-at-to" ${change}>${tos}</select>
        </span>
        <button type="button" class="btn btn-sm sg-addtime-add" onclick="availAddRange('${code}')">${icon('plus', 14)} Add</button>
      </div>
    </div>`;
}
// Your saved times as text, one line per day, each stretch with its own
// Remove. "Remove Wednesday 5:00 to 7:30 PM" is the button's name.
function availMyTimesList(g, u) {
  const mine = g.avail?.[u];
  const rows = availDayOrder().map(d => {
    const runs = availRuns(availDay(mine, d));
    if (!runs.length) return '';
    const chips = runs.map(([s, e]) => `
      <li class="sg-mytime"><span>${esc(availRange(s, e))}</span><button type="button" class="sg-mytime-x" data-fk="avrm:${d}:${s}" aria-label="Remove ${esc(`${AVAIL_DAYS_LONG[d]} ${availRange(s, e)}`)}" onclick="availRemoveRange('${g.code}',${d},${s},${e},this)">${icon('x', 12, 2.2)}</button></li>`).join('');
    return `<div class="sg-mytimes-day"><span class="sg-mytimes-d">${AVAIL_DAYS[d]}</span><ul class="sg-mytimes-runs" aria-label="${AVAIL_DAYS_LONG[d]}">${chips}</ul></div>`;
  }).join('');
  return `
    <div class="sg-mytimes">
      <h4 class="sg-mytimes-h">Your times</h4>
      ${rows || '<p class="sg-mytimes-none">None yet. Paint the grid or add a time above.</p>'}
    </div>`;
}
// 4. Everyone: the heatmap (or one stripe per person), with who's free on
// hover or tap, and the same answer as text for screen readers.
function availEveryoneCard(g, ctx, contributors) {
  const { u } = ctx;
  const K = contributors.length;
  const picked = window._availView === 'heat' || window._availView === 'people' ? window._availView : null;
  const view = K > 8 ? 'heat' : picked || (K > 3 ? 'heat' : 'people');
  const focus = contributors.some(([id]) => id === window._availFocus) ? window._availFocus : null;
  const touch = availIsTouch();
  const steps = availHeatSteps(K);
  return `
    <section class="card sg-week-card sg-week-all" aria-label="Everyone’s week">
      <div class="sg-avail-head">
        <h3 class="sg-h3">Everyone</h3>
        ${K <= 8 ? `<div class="segmented sg-view-toggle" role="group" aria-label="Show as"><button type="button" class="${view === 'people' ? 'active' : ''}" aria-pressed="${view === 'people'}" onclick="window._availView='people';render()">People</button><button type="button" class="${view === 'heat' ? 'active' : ''}" aria-pressed="${view === 'heat'}" onclick="window._availView='heat';render()">Heatmap</button></div>` : `<span class="sg-avail-count">${K} added</span>`}
      </div>
      ${availGrid(g, availDayOrder(), view, focus)}
      ${availEveryoneSummary(g, contributors)}
      ${view === 'people' ? `
        <div class="sg-legend-people" role="group" aria-label="Highlight one person">
          ${K ? contributors.map(([id, a]) => {
            const stale = availStaleLabel(a);
            return `<button type="button" class="sg-legend-person ${focus === id ? 'active' : ''} ${focus && focus !== id ? 'dim' : ''}" style="--p:${personColor(g, id)}" aria-pressed="${focus === id}" onclick="window._availFocus=${focus === id ? 'null' : `'${id}'`};render()"><span class="sg-legend-dot"></span>${esc(id === u ? 'You' : personName(g, id))}${stale ? `<span class="sg-legend-stale">updated ${esc(stale)}</span>` : ''}</button>`;
          }).join('') : '<span class="sg-avail-none">No one has added their times yet.</span>'}
        </div>` : ''}
      <div class="sg-grid-foot">
        <div class="sg-grid-readout" aria-live="polite" data-rest="${touch ? 'Tap a time to see who’s free.' : 'Point at a time to see who’s free.'}">${focus ? `Showing only ${esc(focus === u ? 'you' : personName(g, focus))}. ${touch ? 'Tap' : 'Click'} the name again for everyone.` : touch ? 'Tap a time to see who’s free.' : 'Point at a time to see who’s free.'}</div>
        ${view === 'heat' && steps.length ? `<div class="sg-legend" role="list" aria-label="People free"><span class="sg-legend-lead" aria-hidden="true">Free</span>${steps.map(st => `<span class="sg-legend-step" role="listitem"><i style="--heat:${st.pct}%"${st.all ? ' class="is-all"' : ''}></i>${esc(st.label)}</span>`).join('')}</div>` : ''}
      </div>
    </section>`;
}
// The heat scale in steps, so the legend can say each step's count in
// words: '1', '2-3', '4+' and 'All', dropping steps a small group can't
// reach (three people: '1', '2', 'All').
function availHeatSteps(K) {
  if (K < 1) return [];
  const steps = [];
  const add = (min, max, label) => { if (min <= max) steps.push({ min, max, label }); };
  add(1, Math.min(1, K - 1), '1');
  add(2, Math.min(3, K - 1), Math.min(3, K - 1) > 2 ? '2-3' : '2');
  add(4, K - 1, K - 1 > 4 ? '4+' : '4');
  steps.push({ min: K, max: K, label: 'All', all: true });
  return steps.map((st, j) => ({ ...st, pct: Math.round(18 + 82 * (j + 1) / steps.length) }));
}
function availHeatPct(steps, n) {
  if (!n) return 0;
  const st = steps.find(x => n >= x.min && n <= x.max);
  return st ? st.pct : 0;
}
// Everyone's grid as text, one line per day, for screen readers (the grid
// is an image to them): "Wednesday: 5:00 to 7:30 PM, 5 free; 7:30 to
// 9:00 PM, 3 free". Visually hidden; the answer card says it for everyone.
function availEveryoneSummary(g, contributors) {
  if (!contributors.length) return '';
  const lines = availDayOrder().map(d => {
    const counts = Array.from({ length: AVAIL_SLOTS }, (_, i) => contributors.filter(([, a]) => availDay(a, d)[i] === '1').length);
    const segs = [];
    let s = 0;
    for (let i = 1; i <= AVAIL_SLOTS; i++) {
      if (i < AVAIL_SLOTS && counts[i] === counts[s]) continue;
      if (counts[s] > 0) segs.push(`${availRange(s, i)}, ${counts[s]} free`);
      s = i;
    }
    return `<li>${AVAIL_DAYS_LONG[d]}: ${esc(segs.length ? segs.join('; ') : 'nobody free yet')}</li>`;
  }).join('');
  return `<div class="sr-only" id="sg-avail-summary"><h4>Everyone’s free times, by day. ${contributors.length} of ${Math.max(groupPeople(g).length, contributors.length)} have added theirs.</h4><ul>${lines}</ul></div>`;
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
// A painted stretch, placed on the grid's own rows and columns (row 1 is
// the day names, column 1 the hours). It is absolutely positioned, so it
// sits over the cells without taking part in their auto-placement. Both
// ends are spelled out: an absolutely placed item with an auto end line
// stretches to the edge of the grid.
function availRunStyle(col, s, e) { return `grid-column:${col + 2} / span 1;grid-row:${s + 2} / span ${e - s}`; }
function availGrid(g, days, mode, focus = null, { editing = false } = {}) {
  const u = myUidFor(g);
  const contributors = availContributors(g);
  const K = contributors.length;
  const mine = g.avail?.[u];
  const steps = mode === 'heat' ? availHeatSteps(K) : [];
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
        const on = availDay(mine, d)[i] === '1';
        return `<div class="sg-cell ${hourRow ? 'hr' : ''} ${on ? 'on' : ''}" data-day="${d}" data-col="${col}" data-slot="${i}"></div>`;
      }
      const free = contributors.filter(([, a]) => availDay(a, d)[i] === '1').map(([id]) => id);
      const allAt = (slot) => K >= 2 && contributors.every(([, a]) => availDay(a, d)[slot] === '1');
      const everyone = allAt(i);
      const allRun = everyone ? `${allAt(i - 1) ? '' : 'all-start'} ${allAt(i + 1) ? '' : 'all-end'}` : '';
      const mineFirst = [...free.filter(id => id === u), ...free.filter(id => id !== u)];
      const label = `${AVAIL_DAYS[d]} ${fmtTime(slotTime(i))} · ${free.length ? `${mineFirst.map(id => availFirstName(g, id)).join(', ')} free` : 'Nobody free'}`;
      if (mode === 'people') return `<div class="sg-cell sg-cell-people ${hourRow ? 'hr' : ''} ${everyone && !focus ? `all ${allRun}` : ''}" data-free="${esc(label)}"></div>`;
      return `<div class="sg-cell ${hourRow ? 'hr' : ''} ${everyone ? `all ${allRun}` : ''}" style="--heat:${availHeatPct(steps, free.length)}%" data-free="${esc(label)}"></div>`;
    }).join(''));
  }
  // Painted time as one element per stretch: yours in Your week; in People,
  // one thin stripe per person, in the same order in every column, so each
  // person's free time reads as one bar you can follow down the day.
  let runs = '';
  if (mode === 'mine') {
    runs = days.map((d, col) => availRuns(availDay(mine, d)).map(([s, e]) => `<i class="sg-run" style="${availRunStyle(col, s, e)}${filling ? `;--d:${col * 70 + s * 8}ms` : ''}"></i>`).join('')).join('');
  } else if (mode === 'people') {
    runs = contributors.map(([id, a], k) => focus && focus !== id ? '' : days.map((d, col) => availRuns(availDay(a, d)).map(([s, e]) => `<i class="sg-prun" style="${availRunStyle(col, s, e)};--k:${k};--n:${K};background:${personColor(g, id)}"></i>`).join('')).join('')).join('');
  }
  // To assistive tech each grid is one image with a name: yours points to
  // Add a time, Everyone's to the text summary right after it.
  const attrs = mode === 'mine'
    ? `id="sg-avail-mine" data-code="${g.code}" role="img" aria-label="Your week as a grid, painted with a mouse or finger. To add or remove times with the keyboard, use Add a time and Your times below."`
    : `role="img" aria-label="Everyone’s availability as a ${mode === 'people' ? 'grid with one color per person' : 'heatmap'}. The same times are listed by day right after it."`;
  const cls = mode === 'mine' ? `sg-grid-mine${editing ? ' is-editing' : ''}${filling ? ' is-filling' : ''}` : `sg-grid-view ${mode === 'people' ? 'sg-grid-people' : 'sg-grid-heat'}`;
  return `<div class="sg-grid-scroll"><div class="sg-grid ${cls}" ${attrs} style="--sg-cols:${days.length}">${rows.join('')}${runs}</div></div>`;
}
let _availPaint = null;
// Redraws Your week's runs from the cells while you drag.
function markAvailRuns(grid) {
  grid.querySelectorAll('.sg-run').forEach(r => r.remove());
  const cols = {};
  grid.querySelectorAll('.sg-cell.on').forEach(c => { (cols[c.dataset.col] = cols[c.dataset.col] || new Set()).add(Number(c.dataset.slot)); });
  const html = Object.entries(cols).map(([col, set]) => {
    const str = Array.from({ length: AVAIL_SLOTS }, (_, i) => set.has(i) ? '1' : '0').join('');
    return availRuns(str).map(([s, e]) => `<i class="sg-run" style="${availRunStyle(Number(col), s, e)}"></i>`).join('');
  }).join('');
  grid.insertAdjacentHTML('beforeend', html);
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
    markAvailRuns(grid);
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
    // Full strength while you drag; the saved week settles to a tint.
    grid.classList.add('is-painting');
    paintTo(cell);
    try { grid.setPointerCapture(ev.pointerId); } catch {}
  });
  grid.addEventListener('pointermove', (ev) => { if (_availPaint) paintTo(cellAt(ev.clientX, ev.clientY)); });
  const finish = () => {
    if (!_availPaint) return;
    const p = _availPaint;
    _availPaint = null;
    grid.classList.remove('is-painting');
    commitMyAvailability(p.code, grid);
  };
  grid.addEventListener('pointerup', finish);
  grid.addEventListener('pointercancel', finish);
  grid.addEventListener('lostpointercapture', finish);
}
function commitMyAvailability(code, grid) {
  const days = {};
  for (let d = 0; d < 7; d++) days['d' + d] = emptyDayStr().split('');
  grid.querySelectorAll('.sg-cell.on').forEach(c => { days['d' + c.dataset.day][Number(c.dataset.slot)] = '1'; });
  Object.keys(days).forEach(k => { days[k] = days[k].join(''); });
  availSaveMine(code, days);
}
// The one write for your week: the painter, Add a time and Remove all
// save the same avail.{uid} shape, { d0..d6, name, updatedAt }. Returns
// false when nothing changed.
function availSaveMine(code, days) {
  const g = findGroup(code);
  if (!g) return false;
  const u = myUidFor(g);
  const before = g.avail?.[u];
  if (before && [0, 1, 2, 3, 4, 5, 6].every(d => availDay(before, d) === days['d' + d])) return false;
  if (!before && ![0, 1, 2, 3, 4, 5, 6].some(d => days['d' + d].includes('1'))) return false;
  groupWrite(code, { [`avail.${u}`]: { ...days, name: myGroupName(), updatedAt: Date.now() } });
  return true;
}
function availMineDays(g) {
  const mine = g.avail?.[myUidFor(g)];
  const days = {};
  for (let d = 0; d < 7; d++) days['d' + d] = availDay(mine, d);
  return days;
}
// Add a time's picks, kept per group for this visit: today's weekday,
// 5:00 to 7:00 PM until you change them.
function availAddPick(code) {
  const p = _availAdd[code];
  if (p) return p;
  return (_availAdd[code] = { day: new Date().getDay(), from: slotOf('17:00'), to: slotOf('19:00') });
}
function availAddChange(code) {
  const p = availAddPick(code);
  const num = (id, v) => { const n = Number($(id)?.value); return Number.isInteger(n) ? n : v; };
  p.day = clamp(num('#sg-at-day', p.day), 0, 6);
  p.from = clamp(num('#sg-at-from', p.from), 0, AVAIL_SLOTS - 1);
  p.to = clamp(num('#sg-at-to', p.to), 1, AVAIL_SLOTS);
  // Moving From past To carries To along, so the range always reads forward.
  if (document.activeElement?.id === 'sg-at-from' && p.to <= p.from) { p.to = Math.min(AVAIL_SLOTS, p.from + 2); const to = $('#sg-at-to'); if (to) to.value = String(p.to); }
}
function availAddRange(code) {
  const g = findGroup(code);
  if (!g) return;
  availAddChange(code);
  const { day, from, to } = availAddPick(code);
  const when = `${AVAIL_DAYS_LONG[day]} ${availRange(from, Math.max(to, from + 1))}`;
  if (to <= from) { toast('The end time needs to be after the start time.', 'error'); $('#sg-at-to')?.focus(); return; }
  const days = availMineDays(g);
  const arr = days['d' + day].split('');
  for (let i = from; i < to; i++) arr[i] = '1';
  days['d' + day] = arr.join('');
  if (availSaveMine(code, days)) toast(`Added ${when}.`, 'success');
  else toast(`You’re already free ${when}.`);
}
function availRemoveRange(code, day, start, end, btn) {
  const g = findGroup(code);
  if (!g || !(day >= 0 && day <= 6)) return;
  // Focus goes to the next Remove (or the one before), else Add a time's day.
  const all = [...document.querySelectorAll('.sg-mytime-x')];
  const i = all.indexOf(btn);
  const next = all[i + 1] || all[i - 1];
  if (typeof sgFocusAfter === 'function') sgFocusAfter([next ? `[data-fk="${next.dataset.fk}"]` : '', '#sg-at-day'], `[data-fk="avrm:${day}:${start}"]`);
  const days = availMineDays(g);
  const arr = days['d' + day].split('');
  for (let s = start; s < end; s++) arr[s] = '0';
  days['d' + day] = arr.join('');
  if (availSaveMine(code, days)) toast(`Removed ${AVAIL_DAYS_LONG[day]} ${availRange(start, end)}.`);
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
