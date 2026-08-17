/* ── Study timer: pomodoro + stopwatch, session log, stats by course ─ */
window._timer = { running: false, mode: 'pomodoro', seconds: 0, courseId: null, isBreak: false, intervalId: null };
const POMODORO_WORK = 25 * 60, POMODORO_BREAK = 5 * 60;

function pageTimer() {
  const t = window._timer;
  if (!t.courseId && activeCourses().length) t.courseId = activeCourses()[0].id;
  const remaining = t.mode === 'pomodoro' ? (t.isBreak ? POMODORO_BREAK : POMODORO_WORK) - t.seconds : t.seconds;
  const display = fmtClock(Math.max(0, remaining));
  const pct = t.mode === 'pomodoro' ? clamp((t.seconds / (t.isBreak ? POMODORO_BREAK : POMODORO_WORK)) * 100, 0, 100) : 0;

  const stats = weeklyStatsByCourse();
  const recent = [...state.timerSessions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  const weekSessions = state.timerSessions.filter(s => s.date >= startOfWeek(todayIso()));
  const weekTotal = weekSessions.reduce((s, x) => s + x.minutes, 0);
  const avgSession = weekSessions.length ? Math.round(weekTotal / weekSessions.length) : null;

  return `
    ${pageHead('Study Timer', 'Track focus time and see where it goes')}
    <div class="grid grid-3 mb-16">
      <div class="stat-card"><div class="num">${fmtDuration(weekTotal)}</div><div class="lbl">This week</div></div>
      <div class="stat-card"><div class="num">${weekSessions.length}</div><div class="lbl">Sessions this week</div></div>
      <div class="stat-card"><div class="num ${avgSession == null ? 'stat-dash' : ''}">${avgSession != null ? fmtDuration(avgSession) : '—'}</div><div class="lbl">Average session</div></div>
    </div>
    <div class="grid grid-2" style="align-items:start">
      <div class="card card-pad" style="text-align:center">
        <div class="segmented mb-16"><button class="${t.mode === 'pomodoro' ? 'active' : ''}" onclick="setTimerMode('pomodoro')">Pomodoro</button><button class="${t.mode === 'stopwatch' ? 'active' : ''}" onclick="setTimerMode('stopwatch')">Stopwatch</button></div>
        <div class="timer-ring" style="background:conic-gradient(${getCourseColor(t.courseId)} ${pct}%, var(--border) 0);margin:0 auto">
          <div style="width:188px;height:188px;border-radius:50%;background:var(--surface);display:flex;align-items:center;justify-content:center;flex-direction:column">
            <div class="timer-display" id="timer-display">${display}</div>
            ${t.mode === 'pomodoro' ? `<div class="small muted">${t.isBreak ? 'Break' : 'Focus'}</div>` : ''}
          </div>
        </div>
        <div class="flex-gap" style="justify-content:center;margin-top:18px">
          <select class="select" style="max-width:180px" onchange="_timer.courseId=this.value">
            <option value="">No course</option>${activeCourses().map(c => `<option value="${c.id}" ${c.id === t.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="flex-gap" style="justify-content:center;margin-top:14px">
          ${!t.running ? `<button class="btn btn-primary" onclick="startTimer()">${icon('play', 13, 1.5)} Start</button>` : `<button class="btn" onclick="pauseTimer()">${icon('pause', 13, 1.5)} Pause</button>`}
          <button class="btn" onclick="logAndResetTimer()">${icon('check', 13, 2.4)} Log session</button>
          <button class="btn btn-ghost" onclick="resetTimer()">Reset</button>
        </div>
      </div>

      <div class="card card-pad">
        <h3 style="font-size:15px" class="mb-8">This week by course</h3>
        ${stats.length ? stats.map(s => `
          <div class="mb-8">
            <div class="flex-between small" style="margin-bottom:3px"><span>${esc(s.name)}</span><span class="muted">${fmtDuration(s.minutes)}</span></div>
            <div class="progress"><div style="width:${s.pct}%;background:${s.color}"></div></div>
          </div>`).join('') : emptyState(icon('timer',26,1.4), 'No sessions logged yet this week.')}
        <div class="divider"></div>
        <h3 style="font-size:15px" class="mb-8">Recent sessions</h3>
        ${recent.length ? recent.map(s => `
          <div class="list-row">
            ${s.courseId ? courseChip(s.courseId) : '<span class="small muted">General</span>'}
            <div class="row-title">${fmtDuration(s.minutes)}</div>
            <div class="row-meta">${fmtDate(s.date)}</div>
            <button class="btn btn-ghost btn-icon btn-sm" onclick="deleteSession('${s.id}')">${icon('trash',14)}</button>
          </div>`).join('') : emptyState(icon('file-text',26,1.4), 'Log a session to see it here.')}
      </div>
    </div>
  `;
}
function fmtClock(sec) { const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }
function setTimerMode(mode) { window._timer.mode = mode; window._timer.seconds = 0; window._timer.isBreak = false; touch(); }
function startTimer() {
  const t = window._timer;
  t.running = true;
  clearInterval(t.intervalId);
  t.intervalId = setInterval(() => {
    t.seconds++;
    if (t.mode === 'pomodoro') {
      const limit = t.isBreak ? POMODORO_BREAK : POMODORO_WORK;
      if (t.seconds >= limit) {
        if (!t.isBreak) { logSession(Math.round(limit / 60)); toast('Focus block done — take a break'); t.isBreak = true; t.seconds = 0; }
        else { toast('Break over — ready for another round'); t.isBreak = false; t.seconds = 0; t.running = false; clearInterval(t.intervalId); }
      }
    }
    const el = $('#timer-display');
    if (el) {
      const remaining = t.mode === 'pomodoro' ? (t.isBreak ? POMODORO_BREAK : POMODORO_WORK) - t.seconds : t.seconds;
      el.textContent = fmtClock(Math.max(0, remaining));
    } else { clearInterval(t.intervalId); }
    if (state.route === 'timer' && (t.seconds % 5 === 0)) render();
  }, 1000);
  render();
}
function pauseTimer() { window._timer.running = false; clearInterval(window._timer.intervalId); render(); }
function resetTimer() { const t = window._timer; t.running = false; clearInterval(t.intervalId); t.seconds = 0; t.isBreak = false; render(); }
function logSession(minutes) {
  if (minutes <= 0) return;
  state.timerSessions.push({ id: uid(), courseId: window._timer.courseId || null, date: todayIso(), minutes, mode: window._timer.mode });
  save();
}
function logAndResetTimer() {
  const t = window._timer;
  const minutes = Math.round(t.seconds / 60);
  if (minutes < 1) { toast('Keep going a bit longer before logging', 'error'); return; }
  logSession(minutes);
  toast(`Logged ${fmtDuration(minutes)}`);
  resetTimer();
}
function deleteSession(id) { state.timerSessions = state.timerSessions.filter(s => s.id !== id); touch(); }
function weeklyStatsByCourse() {
  const weekStart = startOfWeek(todayIso());
  const sessions = state.timerSessions.filter(s => s.date >= weekStart);
  const byCourse = {};
  sessions.forEach(s => { const k = s.courseId || '_none'; byCourse[k] = (byCourse[k] || 0) + s.minutes; });
  const max = Math.max(1, ...Object.values(byCourse));
  return Object.entries(byCourse).map(([k, minutes]) => ({ name: k === '_none' ? 'General' : getCourse(k)?.name || 'Unknown', color: k === '_none' ? 'var(--text-faint)' : getCourseColor(k), minutes, pct: (minutes / max) * 100 })).sort((a, b) => b.minutes - a.minutes);
}
