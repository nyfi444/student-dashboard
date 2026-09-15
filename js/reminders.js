/* ── Reminders ─────────────────────────────────────────────────────
   Two parts:
   1. "Heads up" (the bell): what needs attention right now, in the app.
   2. Notifications: a morning summary, an evening preview of tomorrow,
      an alert an hour before timed deadlines, exam heads-ups, and study
      group sessions about to start. These fire while Semester HQ is open
      in a tab or running as an installed app. For reminders when it's
      fully closed, deadlines can be exported to the phone's own calendar
      with alarms attached (downloadDeadlinesIcs).
   Each notification is sent once; sent keys live in localStorage.
──────────────────────────────────────────────────────────────── */
const REMINDER_SENT_KEY = 'shq_reminders_sent';
const REMINDER_DEFAULTS = { enabled: false, digest: true, digestTime: '08:00', evening: true, eveningTime: '20:00', hourBefore: true, exams: true, sessions: true };

function reminderSettings() { return { ...REMINDER_DEFAULTS, ...(state.settings.reminders || {}) }; }
function notificationsSupported() { return 'Notification' in window; }
function notificationPermission() { return notificationsSupported() ? Notification.permission : 'unsupported'; }

function showSystemNotification(title, body, tag, onClickRoute) {
  if (notificationPermission() !== 'granted') return false;
  // Push is delivering reminders for this device already; the app only adds a toast.
  if (typeof pushActive === 'function' && pushActive() && tag !== 'timer') return false;
  // In front of the user already: a toast is enough, don't double up.
  if (document.visibilityState === 'visible' && document.hasFocus()) return false;
  const opts = { body, tag: tag || 'semester-hq', icon: 'assets/icon-192.png', badge: 'assets/icon-192.png', data: { route: onClickRoute || null } };
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.ready.then(reg => reg.showNotification(title, opts)).catch(() => { try { new Notification(title, opts); } catch {} });
  } else {
    try { const n = new Notification(title, opts); n.onclick = () => { window.focus(); if (onClickRoute) setState({ route: onClickRoute, subRoute: null }); n.close(); }; } catch {}
  }
  return true;
}
function maybeAskNotificationPermission() {
  // Only asks if the person turned reminders on but the browser never got an answer.
  if (reminderSettings().enabled && notificationPermission() === 'default') Notification.requestPermission().catch(() => {});
}
async function enableReminders(on) {
  state.settings.reminders = { ...reminderSettings(), enabled: on };
  if (on && notificationPermission() === 'default') {
    try { await Notification.requestPermission(); } catch {}
  }
  if (on && notificationPermission() === 'denied') toast('Notifications are blocked for this site. Allow them in your browser’s site settings, then try again.', 'error', 6000);
  touch();
  checkReminders();
  if (typeof ensurePushSubscription === 'function') {
    if (on && notificationPermission() === 'granted') { if (await ensurePushSubscription()) toast('Reminders are on, even when Semester HQ is closed.', 'success', 4000); }
    else if (!on) removePushSubscription();
  }
}
function updateReminderSetting(key, value) { state.settings.reminders = { ...reminderSettings(), [key]: value }; save(); if (typeof uploadPushSchedule === 'function') uploadPushSchedule(); }
function sendTestNotification() {
  if (notificationPermission() !== 'granted') { toast('Turn on notifications first.', 'error'); return; }
  const opts = { body: 'This is what a Semester HQ reminder looks like.', tag: 'shq-test', icon: 'assets/icon-192.png' };
  if (navigator.serviceWorker?.controller) navigator.serviceWorker.ready.then(reg => reg.showNotification('Reminders are on', opts));
  else new Notification('Reminders are on', opts);
}

/* ── What needs attention ──────────────────────────────────────── */
function attentionItems() {
  const t = todayIso(), tomorrow = addDays(t, 1);
  const inScope = (a) => !a.courseId || activeCourses().some(c => c.id === a.courseId);
  const open = state.assignments.filter(a => !isAssignmentDone(a) && inScope(a));
  const item = (group, title, sub, action, color) => ({ group, title, sub, action, color });
  const out = [];
  open.filter(a => a.dueDate && a.dueDate < t).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .forEach(a => out.push(item('Overdue', a.title, `${getCourse(a.courseId)?.code || ''} · was due ${fmtSessionDay(a.dueDate)}`, `openAssignmentModal('${a.id}')`, getCourseColor(a.courseId))));
  state.todos.filter(td => !td.done && td.dueDate && td.dueDate < t)
    .forEach(td => out.push(item('Overdue', td.title, `To-do · was due ${fmtSessionDay(td.dueDate)}`, `openTodoModal('${td.id}')`, getCourseColor(td.courseId))));
  open.filter(a => a.dueDate === t).sort((a, b) => (a.dueTime || '').localeCompare(b.dueTime || ''))
    .forEach(a => out.push(item('Today', a.title, `${getCourse(a.courseId)?.code || ''} · ${a.dueTime && a.dueTime !== '23:59' ? `due ${fmtTime(a.dueTime)}` : 'due tonight'}`, `openAssignmentModal('${a.id}')`, getCourseColor(a.courseId))));
  state.todos.filter(td => !td.done && td.dueDate === t)
    .forEach(td => out.push(item('Today', td.title, 'To-do', `openTodoModal('${td.id}')`, getCourseColor(td.courseId))));
  if (typeof groupSessionsOnDate === 'function') groupSessionsOnDate(t).forEach(s => out.push(item('Today', s.title, `${s.groupName}${s.start ? ` · ${fmtTime(s.start)}` : ''}`, `openGroup('${s.code}','schedule')`, '#6b6b6b')));
  if (typeof orgEventsOnDate === 'function') {
    orgEventsOnDate(t).forEach(e => out.push(item('Today', e.title, `${e.orgName}${e.start ? ` · ${fmtTime(e.start)}` : ''}${e.required ? ' · required' : ''}`, e.action, e.color)));
    allOrgs().forEach(o => { const n = orgUnreadCount(o); if (n) out.push(item('Today', `${n} new announcement${n === 1 ? '' : 's'}`, o.name, `openOrg('${o.code}','announcements')`, orgColor(o))); });
  }
  milestoneDueItems(t, t).forEach(({ p, m }) => out.push(item('Today', m.title, `Milestone · ${p.title}`, `openProject('${p.id}')`, projectColor(p))));
  milestoneDueItems(addDays(t, -60), addDays(t, -1)).forEach(({ p, m }) => out.push(item('Overdue', m.title, `Milestone · ${p.title} · was due ${fmtSessionDay(m.dueDate)}`, `openProject('${p.id}')`, projectColor(p))));
  open.filter(a => a.dueDate === tomorrow)
    .forEach(a => out.push(item('Tomorrow', a.title, `${getCourse(a.courseId)?.code || ''} · ${a.type}`, `openAssignmentModal('${a.id}')`, getCourseColor(a.courseId))));
  open.filter(a => a.type === 'exam' && a.dueDate > tomorrow && daysBetween(a.dueDate) <= 7)
    .forEach(a => out.push(item('Coming up', a.title, `${getCourse(a.courseId)?.code || ''} · exam in ${daysBetween(a.dueDate)} days${examPrep(a) != null ? ` · ${examPrep(a)}% prepped` : ''}`, `openExamPrep('${a.id}')`, getCourseColor(a.courseId))));
  open.filter(a => a.startByDate && a.startByDate <= t && a.dueDate > tomorrow)
    .forEach(a => out.push(item('Coming up', a.title, `Time to start · due ${fmtSessionDay(a.dueDate)}`, `openAssignmentModal('${a.id}')`, getCourseColor(a.courseId))));
  applications().filter(a => a.stage === 'saved' && a.deadline && a.deadline < t)
    .forEach(a => out.push(item('Overdue', `Apply: ${a.org}`, `${a.type} · deadline was ${fmtSessionDay(a.deadline)}`, `openApplicationModal('${a.id}')`, '#6b6b6b')));
  appDueItems(t, addDays(t, 7)).forEach(i => out.push(item(i.date === t ? 'Today' : i.date === tomorrow ? 'Tomorrow' : 'Coming up', i.label, `${i.app.type} · ${fmtSessionDay(i.date)}${i.time ? ` ${fmtTime(i.time)}` : ''}`, `openApplicationModal('${i.app.id}')`, '#6b6b6b')));
  const cards = typeof srsDueTotal === 'function' ? srsDueTotal() : 0;
  if (cards) out.push(item('Today', `${cards} flashcard${cards === 1 ? '' : 's'} to review`, 'Spaced repetition', 'openReview()', 'var(--accent)'));
  return out;
}
function attentionCount() {
  try { return attentionItems().filter(i => i.group === 'Overdue' || i.group === 'Today').length; } catch { return 0; }
}
function openHeadsUp() {
  const items = attentionItems();
  const groups = ['Overdue', 'Today', 'Tomorrow', 'Coming up'].map(g => [g, items.filter(i => i.group === g)]).filter(([, list]) => list.length);
  const rs = reminderSettings();
  openModal(`
    <div class="modal-head"><h3>Heads up</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      ${groups.length ? groups.map(([g, list]) => `
        <div class="dash-day ${g === 'Overdue' ? 'is-overdue' : ''}">
          <div class="dash-day-label">${g}</div>
          ${list.map(i => `<button class="headsup-row" style="--course:${esc(i.color || '#8a8a8a')}" onclick="closeModal();setTimeout(()=>{${i.action}},200)"><span class="dash-tl-bar"></span><span class="dash-tl-body"><span class="dash-tl-title">${esc(i.title)}</span><span class="dash-tl-sub">${esc(i.sub)}</span></span>${icon('chevron-right', 13, 2)}</button>`).join('')}
        </div>`).join('') : `<div class="dash-clear">${icon('cloud-sun', 20, 1.5)}<span>Nothing needs your attention right now.</span></div>`}
      <div class="divider"></div>
      <div class="flex-between small">
        <span class="muted">${rs.enabled && notificationPermission() === 'granted' ? 'Reminders are on.' : 'Get a reminder before things are due.'}</span>
        <button class="sg-link" onclick="closeModal();setState({route:'settings',subRoute:null});setTimeout(()=>document.getElementById('settings-reminders')?.scrollIntoView({block:'center'}),120)">${rs.enabled ? 'Reminder settings' : 'Turn on reminders'} →</button>
      </div>
    </div>
  `);
}

/* ── Notification engine ───────────────────────────────────────── */
function remindersSent() {
  try {
    const sent = JSON.parse(localStorage.getItem(REMINDER_SENT_KEY) || '{}');
    const cutoff = Date.now() - 8 * 86400000;
    Object.keys(sent).forEach(k => { if (sent[k] < cutoff) delete sent[k]; });
    return sent;
  } catch { return {}; }
}
function markSent(sent, key) { sent[key] = Date.now(); try { localStorage.setItem(REMINDER_SENT_KEY, JSON.stringify(sent)); } catch {} }
function summarize(titles) { return titles.length <= 2 ? titles.join(' and ') : `${titles.slice(0, 2).join(', ')}, and ${titles.length - 2} more`; }

function checkReminders() {
  const rs = reminderSettings();
  if (!rs.enabled || notificationPermission() !== 'granted') return;
  if (!activeCourses().length && !state.todos.length) return;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const t = todayIso(), tomorrow = addDays(t, 1);
  const sent = remindersSent();
  const inScope = (a) => !a.courseId || activeCourses().some(c => c.id === a.courseId);
  const open = state.assignments.filter(a => !isAssignmentDone(a) && inScope(a));
  const send = (key, title, body, route) => {
    if (sent[key]) return;
    if (showSystemNotification(title, body, key, route)) markSent(sent, key);
    else if (document.visibilityState === 'visible') { toast(`${title}: ${body}`, 'info', 7000); markSent(sent, key); }
  };

  if (rs.digest && nowMin >= toMin(rs.digestTime)) {
    const today = [...open.filter(a => a.dueDate === t).map(a => a.title), ...state.todos.filter(x => !x.done && x.dueDate === t).map(x => x.title), ...appDueItems(t, t).map(i => i.label)];
    const overdue = open.filter(a => a.dueDate && a.dueDate < t).length;
    if (today.length || overdue) send(`digest:${t}`, today.length ? `${today.length} thing${today.length === 1 ? '' : 's'} due today` : 'You have overdue work', [today.length ? summarize(today) : '', overdue ? `${overdue} overdue` : ''].filter(Boolean).join(' · '), 'dashboard');
  }
  if (rs.evening && nowMin >= toMin(rs.eveningTime)) {
    const due = [...open.filter(a => a.dueDate === tomorrow).map(a => a.title), ...appDueItems(tomorrow, tomorrow).map(i => i.label)];
    if (due.length) send(`evening:${t}`, `Due tomorrow: ${due.length} thing${due.length === 1 ? '' : 's'}`, summarize(due), 'assignments');
  }
  if (rs.hourBefore) {
    open.filter(a => a.dueDate === t && a.dueTime && a.dueTime !== '23:59').forEach(a => {
      const mins = toMin(a.dueTime) - nowMin;
      if (mins > 0 && mins <= 60) send(`hour:${a.id}:${t}:${a.dueTime}`, `Due in ${mins} min: ${a.title}`, `${getCourse(a.courseId)?.name || ''} · due ${fmtTime(a.dueTime)}`, 'assignments');
    });
  }
  if (rs.exams && nowMin >= toMin(rs.digestTime)) {
    open.filter(a => a.type === 'exam' && a.dueDate).forEach(a => {
      const d = daysBetween(a.dueDate);
      if (d === 3 || d === 1) send(`exam:${a.id}:${d}`, `${a.title} is ${d === 1 ? 'tomorrow' : 'in 3 days'}`, `${getCourse(a.courseId)?.name || ''}${a.dueTime ? ` · ${fmtTime(a.dueTime)}` : ''}. Time to review.`, 'exams');
    });
  }
  if (rs.sessions && typeof groupSessionsOnDate === 'function') {
    groupSessionsOnDate(t).filter(s => s.start).forEach(s => {
      const mins = toMin(s.start) - nowMin;
      if (mins > 0 && mins <= 30) send(`session:${s.code}:${s.id}:${t}`, `${s.title} starts in ${mins} min`, `${s.groupName}`, 'studygroups');
    });
    if (typeof orgEventsOnDate === 'function') orgEventsOnDate(t).filter(e => e.start).forEach(e => {
      const mins = toMin(e.start) - nowMin;
      if (mins > 0 && mins <= 60) send(`org:${e.code}:${e.id}:${t}`, `${e.title} in ${mins} min`, `${e.orgName}${e.required ? ' · required' : ''}`, 'orgs');
    });
  }
}

/* ── Calendar export with alarms, for reminders when the app is closed ─ */
function downloadDeadlinesIcs() {
  const icsText = (v) => String(v || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const events = state.assignments.filter(a => !isAssignmentDone(a) && a.dueDate && a.dueDate >= todayIso() && activeCourses().some(c => c.id === a.courseId)).map(a => {
    const c = getCourse(a.courseId);
    const d = a.dueDate.replace(/-/g, '');
    const timed = a.dueTime && a.dueTime !== '23:59';
    const alarm = a.type === 'exam' ? '-P1D' : timed ? '-PT1H' : '-PT15H'; // all-day items: 9am the day before
    return [
      'BEGIN:VEVENT', `UID:${a.id}@semester-hq.com`, `DTSTAMP:${stamp}`,
      timed ? `DTSTART:${d}T${a.dueTime.replace(':', '')}00` : `DTSTART;VALUE=DATE:${d}`,
      timed ? `DTEND:${d}T${addMinutesHHMM(a.dueTime, 15).replace(':', '')}00` : `DTEND;VALUE=DATE:${addDays(a.dueDate, 1).replace(/-/g, '')}`,
      `SUMMARY:${icsText(`${a.type === 'exam' ? 'Exam' : 'Due'}: ${a.title}${c ? ` (${c.code || c.name})` : ''}`)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(a.title)}`, `TRIGGER:${alarm}`, 'END:VALARM',
      'END:VEVENT',
    ].join('\r\n');
  });
  if (!events.length) { toast('No upcoming deadlines to export.', 'info'); return; }
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Semester HQ//Deadlines//EN', 'X-WR-CALNAME:Semester HQ deadlines', ...events, 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = 'semester-hq-deadlines.ics';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast(`Exported ${events.length} deadline${events.length === 1 ? '' : 's'}. Open the file to add them to your calendar.`, 'success', 5000);
}

function remindersSettingsCard() {
  const rs = reminderSettings();
  const perm = notificationPermission();
  const on = rs.enabled && perm === 'granted';
  const row = (key, label, extra = '') => `<label class="checkbox-row mb-8"><input type="checkbox" ${rs[key] ? 'checked' : ''} ${on ? '' : 'disabled'} onchange="updateReminderSetting('${key}',this.checked)"><span>${label}</span>${extra}</label>`;
  return `
    <div class="card card-pad" id="settings-reminders">
      <h3 style="font-size:15px" class="mb-8">Reminders</h3>
      <p class="small muted mb-16">Get a heads-up before things are due${typeof pushSupported === 'function' && pushSupported() && cloudGroupsEnabled() ? ', even when Semester HQ is closed' : ''}.</p>
      ${typeof isIosBrowserNotInstalled === 'function' && isIosBrowserNotInstalled() ? `<div class="sg-callout small mb-16"><span>${icon('share', 14, 1.8)}</span><div>On iPhone, reminders work once Semester HQ is on your Home Screen. Tap Share, then <strong>Add to Home Screen</strong>, and turn reminders on from there.</div></div>` : ''}
      ${perm === 'unsupported' ? `<p class="small muted mb-16">This browser doesn’t support notifications. Use the calendar export below instead.</p>`
        : perm === 'denied' ? `<p class="small mb-16">Notifications are blocked for this site. Allow them in your browser’s site settings to turn reminders on.</p>`
        : `<div class="checkbox-row mb-16"><input type="checkbox" id="st-reminders" ${on ? 'checked' : ''} onchange="enableReminders(this.checked)"><label for="st-reminders" style="font-weight:600">Send me reminders</label></div>`}
      <div class="${on ? '' : 'is-disabled'}">
        ${row('digest', 'Morning summary of what’s due', ` <input class="input reminder-time" type="time" value="${esc(rs.digestTime)}" ${on ? '' : 'disabled'} onchange="updateReminderSetting('digestTime',this.value)">`)}
        ${row('evening', 'Evening preview of tomorrow', ` <input class="input reminder-time" type="time" value="${esc(rs.eveningTime)}" ${on ? '' : 'disabled'} onchange="updateReminderSetting('eveningTime',this.value)">`)}
        ${row('hourBefore', 'An hour before deadlines with a set time')}
        ${row('exams', 'Exams 3 days and 1 day ahead')}
        ${row('sessions', 'Study group sessions 30 minutes before')}
        ${on ? `<div class="flex-gap wrap mt-8" style="align-items:center"><button class="btn btn-sm" onclick="sendPushTest()">Send a test notification</button>${typeof pushActive === 'function' && pushActive() ? `<span class="small muted">${icon('check', 12, 2.4)} Works even when the app is closed</span>` : ''}</div>` : ''}
      </div>
      <div class="divider"></div>
      <div class="small dim mb-8" style="font-weight:600">Reminders when the app is closed</div>
      <p class="small muted mb-8">Add your upcoming deadlines to your phone or computer calendar, with alerts attached (the day before, or an hour before timed deadlines).</p>
      <button class="btn btn-sm" onclick="downloadDeadlinesIcs()">${icon('download', 13, 1.8)} Export deadlines to calendar</button>
    </div>`;
}

let _reminderInterval = null;
function startReminderLoop() {
  if (_reminderInterval) return;
  _reminderInterval = setInterval(checkReminders, 60000);
  setTimeout(checkReminders, 4000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkReminders(); });
}
