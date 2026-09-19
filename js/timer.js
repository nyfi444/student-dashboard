/* ── Study timer: focus blocks + breaks, or a plain stopwatch ───────
   Time is measured from timestamps, not by counting ticks, so it stays
   accurate when the tab is in the background (browsers throttle timers
   there). The running timer is saved to localStorage, so reloading or
   reopening the app doesn't lose a session in progress. While it runs,
   the countdown shows in the browser tab title and in a small pill on
   every other page.
──────────────────────────────────────────────────────────────── */
const TIMER_STORE_KEY = 'shq_timer';
const TIMER_DEFAULTS = { focus: 25, short: 5, long: 15, rounds: 4, autoBreaks: true, sound: true };

function timerSettings() { return { ...TIMER_DEFAULTS, ...(state.settings.timer || {}) }; }
function loadTimer() {
  try { const t = JSON.parse(localStorage.getItem(TIMER_STORE_KEY) || 'null'); if (t && t.mode) return t; } catch {}
  return null;
}
window._timer = { mode: 'pomodoro', phase: 'focus', round: 1, running: false, startedAt: null, elapsedMs: 0, courseId: null, task: '', assignmentId: null, ...(loadTimer() || {}) };
function persistTimer() { try { localStorage.setItem(TIMER_STORE_KEY, JSON.stringify(window._timer)); } catch {} }

function phaseMs(t = window._timer) {
  const s = timerSettings();
  return (t.phase === 'focus' ? s.focus : t.phase === 'short' ? s.short : s.long) * 60000;
}
function timerElapsed(t = window._timer) { return t.elapsedMs + (t.running && t.startedAt ? Date.now() - t.startedAt : 0); }
function timerDisplayMs(t = window._timer) { return t.mode === 'pomodoro' ? Math.max(0, phaseMs(t) - timerElapsed(t)) : timerElapsed(t); }
function fmtClock(ms) {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
const PHASE_LABEL = { focus: 'Focus', short: 'Short break', long: 'Long break' };
function timerActive() { const t = window._timer; return t.running || t.elapsedMs > 0; }

/* ── Page ──────────────────────────────────────────────────────── */
function pageTimer() {
  const t = window._timer;
  const s = timerSettings();
  const today = todayIso();
  const sessions = state.timerSessions;
  const todayMin = sessions.filter(x => x.date === today).reduce((a, x) => a + x.minutes, 0);
  const weekStart = startOfWeek(today);
  const weekMin = sessions.filter(x => x.date >= weekStart).reduce((a, x) => a + x.minutes, 0);
  const goal = state.settings.weeklyStudyGoalMinutes || 0;
  const days = new Set(sessions.map(x => x.date));
  let streak = 0;
  for (let d = days.has(today) ? today : addDays(today, -1); days.has(d); d = addDays(d, -1)) streak++;
  const stats = weeklyStatsByCourse();
  const recent = [...sessions].sort((a, b) => (b.date + (b.at || 0)).localeCompare(a.date + (a.at || 0))).slice(0, 8);
  const openWork = state.assignments.filter(a => !isAssignmentDone(a) && (!t.courseId || a.courseId === t.courseId) && activeCourses().some(c => c.id === a.courseId))
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')).slice(0, 30);
  const pct = t.mode === 'pomodoro' ? clamp((timerElapsed(t) / phaseMs(t)) * 100, 0, 100) : 0;
  const color = t.phase === 'focus' ? (t.courseId ? getCourseColor(t.courseId) : 'var(--accent)') : 'var(--text-faint)';

  return `
    ${pageHead('Study Timer', 'Work in focused blocks, then take a real break', `
      <button class="btn btn-icon btn-sm" aria-label="Timer settings" title="Timer settings" onclick="openTimerSettings()">${icon('settings', 16, 1.6)}</button>
    `)}
    <div class="timer-layout">
      <div class="card timer-main">
        <div class="timer-top">
          <div class="segmented">
            <button class="${t.mode === 'pomodoro' ? 'active' : ''}" onclick="setTimerMode('pomodoro')">Focus blocks</button>
            <button class="${t.mode === 'stopwatch' ? 'active' : ''}" onclick="setTimerMode('stopwatch')">Stopwatch</button>
          </div>
          ${t.mode === 'pomodoro' ? `<div class="timer-phases">${['focus', 'short', 'long'].map(p => `<button class="timer-phase ${t.phase === p ? 'active' : ''}" onclick="setTimerPhase('${p}')">${PHASE_LABEL[p]}</button>`).join('')}</div>` : ''}
        </div>

        <div class="timer-dial" id="timer-dial" style="--timer-color:${color}">
          <svg viewBox="0 0 240 240" class="timer-svg" aria-hidden="true">
            <circle cx="120" cy="120" r="108" class="timer-track"/>
            <circle cx="120" cy="120" r="108" class="timer-arc" id="timer-arc" pathLength="100" stroke-dasharray="${pct.toFixed(2)} 100" transform="rotate(-90 120 120)"/>
          </svg>
          <div class="timer-dial-inner">
            <div class="timer-display" id="timer-display">${fmtClock(timerDisplayMs(t))}</div>
            <div class="timer-sub" id="timer-sub">${t.mode === 'pomodoro' ? `${PHASE_LABEL[t.phase]}${t.running ? '' : timerElapsed(t) ? ' · paused' : ''}` : t.running ? 'Running' : timerElapsed(t) ? 'Paused' : 'Stopwatch'}</div>
            ${t.mode === 'pomodoro' ? `<div class="timer-rounds" aria-label="Round ${t.round} of ${s.rounds}">${Array.from({ length: s.rounds }, (_, i) => `<span class="${i < t.round - 1 || (i === t.round - 1 && t.phase !== 'focus') ? 'done' : i === t.round - 1 ? 'current' : ''}"></span>`).join('')}</div>` : ''}
          </div>
        </div>

        <div class="timer-goal">
          <input class="input timer-task" id="timer-task" maxlength="120" placeholder="What are you working on?" value="${esc(t.task || '')}" oninput="window._timer.task=this.value;window._timer.assignmentId=null;persistTimer()">
          <div class="timer-goal-row">
            <select class="select" aria-label="Class" onchange="setTimerCourse(this.value)">
              <option value="">No class</option>${activeCourses().map(c => `<option value="${c.id}" ${c.id === t.courseId ? 'selected' : ''}>${esc(c.code || c.name)}</option>`).join('')}
            </select>
            <select class="select" aria-label="Assignment" onchange="setTimerAssignment(this.value)">
              <option value="">Pick an assignment (optional)</option>${openWork.map(a => `<option value="${a.id}" ${a.id === t.assignmentId ? 'selected' : ''}>${esc(a.title)}${a.dueDate ? ` · ${esc(relativeDay(a.dueDate))}` : ''}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="timer-controls">
          ${t.running
            ? `<button class="btn timer-btn-main" onclick="pauseTimer()">${icon('pause', 14, 1.5)} Pause</button>`
            : `<button class="btn btn-primary timer-btn-main" onclick="startTimer()">${icon('play', 14, 1.5)} ${timerElapsed(t) ? 'Resume' : t.phase === 'focus' || t.mode === 'stopwatch' ? 'Start' : 'Start break'}</button>`}
          ${t.mode === 'pomodoro'
            ? `<button class="btn" onclick="skipTimerPhase()" title="Skip to the next ${t.phase === 'focus' ? 'break' : 'focus block'}">Skip</button>`
            : `<button class="btn" onclick="logAndResetTimer()">${icon('check', 13, 2.4)} Log session</button>`}
          <button class="btn btn-ghost" onclick="resetTimer()" ${timerElapsed(t) ? '' : 'disabled'}>Reset</button>
        </div>
        ${t.mode === 'pomodoro' ? `<div class="small muted timer-hint">${s.focus} min focus · ${s.short} min break · ${s.long} min long break every ${s.rounds} rounds. Finished focus blocks log automatically.</div>` : ''}
      </div>

      <div class="timer-side">
        <div class="card card-pad">
          <div class="flex-between mb-8"><h3 class="sg-h3">This week</h3>${streak ? `<span class="small muted">${streak}-day streak</span>` : ''}</div>
          <div class="dash-focus">
            <div class="dash-focus-ring">${progressRing(goal ? clamp((weekMin / goal) * 100, 0, 100) : null, 'var(--accent)', 84)}<div><strong>${fmtDuration(weekMin)}</strong><span>${goal ? `of ${fmtDuration(goal)}` : 'focused'}</span></div></div>
            <div class="timer-today"><div class="timer-today-num">${fmtDuration(todayMin)}</div><div class="small muted">today · ${sessions.filter(x => x.date === today).length} session${sessions.filter(x => x.date === today).length === 1 ? '' : 's'}</div>
            ${goal ? `<div class="small muted mt-8">${weekMin >= goal ? 'Weekly goal reached.' : `${fmtDuration(goal - weekMin)} to go this week`}</div>` : `<button class="sg-link mt-8" onclick="openTimerSettings()">Set a weekly goal</button>`}</div>
          </div>
          ${stats.length ? `<div class="divider"></div>${stats.map(x => `
            <div class="mb-8">
              <div class="flex-between small" style="margin-bottom:3px"><span>${esc(x.name)}</span><span class="muted">${fmtDuration(x.minutes)}</span></div>
              <div class="progress"><div style="width:${x.pct}%;background:${x.color}"></div></div>
            </div>`).join('')}` : ''}
        </div>
        <div class="card card-pad">
          <h3 class="sg-h3 mb-8">Recent sessions</h3>
          ${recent.length ? recent.map(x => {
            const c = getCourse(x.courseId);
            return `<div class="timer-session" style="--course:${esc(c?.color || '#8a8a8a')}">
              <span class="dash-tl-bar"></span>
              <div class="row-title"><div class="small sg-strong">${esc(x.task || (c ? c.name : 'General study'))}</div><div class="row-meta">${[c && x.task ? (c.code || c.name) : '', fmtSessionDay(x.date)].filter(Boolean).map(esc).join(' · ')}</div></div>
              <span class="small">${fmtDuration(x.minutes)}</span>
              <button class="btn btn-ghost btn-icon btn-sm" aria-label="Delete session" onclick="deleteTimerSession('${x.id}')">${icon('trash', 13)}</button>
            </div>`;
          }).join('') : emptyStateHtml({
            compact: true,
            icon: 'timer',
            title: 'No sessions yet',
            body: 'Finished focus blocks are logged here automatically.',
            actions: t.running ? [] : [{ label: timerElapsed(t) ? 'Resume' : t.mode === 'pomodoro' ? 'Start a focus block' : 'Start the stopwatch', onclick: 'startTimer()', icon: 'play' }],
          })}
        </div>
      </div>
    </div>
  `;
}

/* ── Controls ──────────────────────────────────────────────────── */
function setTimerMode(mode) {
  const t = window._timer;
  if (timerElapsed(t) > 60000 && !confirm('Switching modes resets the current timer. Continue?')) return;
  Object.assign(t, { mode, phase: 'focus', running: false, startedAt: null, elapsedMs: 0 });
  persistTimer(); updateTimerChrome(); touch();
}
function setTimerPhase(phase) {
  const t = window._timer;
  Object.assign(t, { phase, running: false, startedAt: null, elapsedMs: 0 });
  persistTimer(); updateTimerChrome(); touch();
}
function setTimerCourse(id) { const t = window._timer; t.courseId = id || null; t.assignmentId = null; persistTimer(); touch(); }
function setTimerAssignment(id) {
  const t = window._timer;
  const a = state.assignments.find(x => x.id === id);
  t.assignmentId = a ? a.id : null;
  if (a) { t.task = a.title; t.courseId = a.courseId; }
  persistTimer(); touch();
}
function startTimer() {
  const t = window._timer;
  if (t.running) return;
  t.running = true;
  t.startedAt = Date.now();
  persistTimer();
  ensureTimerTicking();
  touch();
}
function pauseTimer() {
  const t = window._timer;
  if (!t.running) return;
  t.elapsedMs = timerElapsed(t);
  t.running = false;
  t.startedAt = null;
  persistTimer(); updateTimerChrome(); touch();
}
function resetTimer() {
  Object.assign(window._timer, { running: false, startedAt: null, elapsedMs: 0 });
  persistTimer(); updateTimerChrome(); touch();
}
function skipTimerPhase() {
  const t = window._timer;
  if (t.phase === 'focus' && timerElapsed(t) >= 60000) {
    const mins = Math.round(timerElapsed(t) / 60000);
    logSession(mins);
    toast(`Logged ${fmtDuration(mins)} and moved on to your break`);
  }
  advanceTimerPhase(false);
}
// Moves focus → break → focus. A long break comes after every Nth round.
function advanceTimerPhase(fromCompletion) {
  const t = window._timer;
  const s = timerSettings();
  if (t.phase === 'focus') {
    t.phase = t.round >= s.rounds ? 'long' : 'short';
  } else {
    t.round = t.phase === 'long' ? 1 : t.round + 1;
    t.phase = 'focus';
  }
  t.elapsedMs = 0;
  const autoStart = fromCompletion && s.autoBreaks && t.phase !== 'focus';
  t.running = autoStart;
  t.startedAt = autoStart ? Date.now() : null;
  persistTimer(); updateTimerChrome(); touch();
}
function logSession(minutes) {
  if (minutes <= 0) return;
  const t = window._timer;
  state.timerSessions.push({ id: uid(), courseId: t.courseId || null, date: todayIso(), at: String(Date.now()), minutes, mode: t.mode, task: (t.task || '').trim(), assignmentId: t.assignmentId || null });
  save();
}
function logAndResetTimer() {
  const minutes = Math.round(timerElapsed() / 60000);
  if (minutes < 1) { toast('Keep going a bit longer before logging', 'error'); return; }
  logSession(minutes);
  toast(`Logged ${fmtDuration(minutes)}`);
  resetTimer();
}
function deleteTimerSession(id) { state.timerSessions = state.timerSessions.filter(s => s.id !== id); touch(); }
function weeklyStatsByCourse() {
  const weekStart = startOfWeek(todayIso());
  const byCourse = {};
  state.timerSessions.filter(s => s.date >= weekStart).forEach(s => { const k = s.courseId || '_none'; byCourse[k] = (byCourse[k] || 0) + s.minutes; });
  const max = Math.max(1, ...Object.values(byCourse));
  return Object.entries(byCourse).map(([k, minutes]) => ({ name: k === '_none' ? 'General' : getCourse(k)?.name || 'Unknown', color: k === '_none' ? 'var(--text-faint)' : getCourseColor(k), minutes, pct: (minutes / max) * 100 })).sort((a, b) => b.minutes - a.minutes);
}

/* ── Ticking, tab title, the mini timer on other pages ─────────── */
let _timerInterval = null;
function ensureTimerTicking() {
  if (_timerInterval) return;
  _timerInterval = setInterval(timerTick, 500);
  timerTick();
}
function timerTick() {
  const t = window._timer;
  if (!t.running) {
    clearInterval(_timerInterval); _timerInterval = null;
    updateTimerChrome();
    return;
  }
  if (t.mode === 'pomodoro' && timerElapsed(t) >= phaseMs(t)) { completeTimerPhase(); return; }
  updateTimerChrome();
}
function completeTimerPhase() {
  const t = window._timer;
  const s = timerSettings();
  const wasFocus = t.phase === 'focus';
  if (wasFocus) logSession(s.focus);
  const nextIsLong = wasFocus && t.round >= s.rounds;
  const title = wasFocus ? 'Focus block done' : 'Break’s over';
  const body = wasFocus ? `Nice work${t.task ? ` on “${t.task}”` : ''}. Take a ${nextIsLong ? s.long : s.short}-minute break.` : 'Ready for another focus block?';
  if (s.sound) playChime();
  toast(`${title}. ${body}`, 'info', 5000);
  advanceTimerPhase(true);
  if (t.running) ensureTimerTicking();
}
function updateTimerChrome() {
  const t = window._timer;
  const active = timerActive();
  const label = t.mode === 'pomodoro' ? PHASE_LABEL[t.phase] : 'Stopwatch';
  const clock = fmtClock(timerDisplayMs(t));
  document.title = active ? `${t.running ? '' : '⏸ '}${clock} · ${label} · Semester HQ` : 'Semester HQ';
  const display = document.getElementById('timer-display');
  if (display) display.textContent = clock;
  const arc = document.getElementById('timer-arc');
  if (arc && t.mode === 'pomodoro') arc.setAttribute('stroke-dasharray', `${clamp((timerElapsed(t) / phaseMs(t)) * 100, 0, 100).toFixed(2)} 100`);
  let pill = document.getElementById('timer-pill');
  const showPill = active && state.route !== 'timer';
  if (!showPill) { if (pill) pill.remove(); return; }
  if (!pill) {
    pill = document.createElement('div');
    pill.id = 'timer-pill';
    pill.className = 'timer-pill';
    document.body.appendChild(pill);
  }
  const c = getCourse(t.courseId);
  pill.style.setProperty('--course', c?.color || 'var(--accent-text)');
  pill.innerHTML = `
    <button class="timer-pill-main" onclick="setState({route:'timer',subRoute:null})" aria-label="Open study timer">
      <span class="timer-pill-dot ${t.running ? 'live' : ''}"></span>
      <span class="timer-pill-clock">${clock}</span>
      <span class="timer-pill-label">${esc(t.task || label)}</span>
    </button>
    <button class="timer-pill-btn" aria-label="${t.running ? 'Pause' : 'Resume'} timer" onclick="${t.running ? 'pauseTimer()' : 'startTimer()'}">${icon(t.running ? 'pause' : 'play', 12, 1.5)}</button>`;
}
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[660, 0], [880, 0.18], [990, 0.36]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at); osc.stop(ctx.currentTime + at + 0.55);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {}
}
function openTimerSettings() {
  const s = timerSettings();
  const goalHours = Math.round((state.settings.weeklyStudyGoalMinutes || 0) / 60);
  openModal(`
    <div class="modal-head"><h3>Timer settings</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="field-row">
        <div class="field"><label for="ts-focus">Focus (min)</label><input class="input" type="number" min="5" max="180" id="ts-focus" value="${s.focus}"></div>
        <div class="field"><label for="ts-short">Short break</label><input class="input" type="number" min="1" max="60" id="ts-short" value="${s.short}"></div>
        <div class="field"><label for="ts-long">Long break</label><input class="input" type="number" min="1" max="90" id="ts-long" value="${s.long}"></div>
      </div>
      <div class="flex-gap wrap mb-16">${[[25, 5], [45, 10], [50, 10], [90, 20]].map(([f, b]) => `<button class="chip" onclick="$('#ts-focus').value=${f};$('#ts-short').value=${b}">${f} / ${b}</button>`).join('')}</div>
      <div class="field-row">
        <div class="field"><label for="ts-rounds">Long break every</label><select class="select" id="ts-rounds">${[2, 3, 4, 5, 6].map(n => `<option value="${n}" ${n === s.rounds ? 'selected' : ''}>${n} rounds</option>`).join('')}</select></div>
        <div class="field"><label for="ts-goal">Weekly study goal (hours)</label><input class="input" type="number" min="0" max="80" id="ts-goal" value="${goalHours}"></div>
      </div>
      <label class="checkbox-row mb-8"><input type="checkbox" id="ts-auto" ${s.autoBreaks ? 'checked' : ''}> Start breaks automatically</label>
      <label class="checkbox-row"><input type="checkbox" id="ts-sound" ${s.sound ? 'checked' : ''}> Play a sound when a block ends</label>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveTimerSettings()">Save</button></div>
  `);
}
function saveTimerSettings() {
  const num = (id, lo, hi, dflt) => clamp(Math.round(Number($(id).value) || dflt), lo, hi);
  state.settings.timer = {
    focus: num('#ts-focus', 5, 180, 25), short: num('#ts-short', 1, 60, 5), long: num('#ts-long', 1, 90, 15),
    rounds: Number($('#ts-rounds').value) || 4, autoBreaks: $('#ts-auto').checked, sound: $('#ts-sound').checked,
  };
  state.settings.weeklyStudyGoalMinutes = clamp(Math.round(Number($('#ts-goal').value) || 0), 0, 80) * 60;
  closeModal(); touch(); updateTimerChrome(); toast('Timer settings saved');
}
// Resume a timer that was running before a reload or relaunch.
if (window._timer.running) setTimeout(ensureTimerTicking, 0);
else if (timerActive()) setTimeout(updateTimerChrome, 0);
