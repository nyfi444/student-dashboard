/* ── Push notifications when the app is closed ───────────────────────
   With reminders on, this device subscribes to Web Push and the app
   uploads the next 10 days of reminders (same rules as reminders.js:
   morning summary, evening preview, an hour before timed deadlines,
   exams 3 and 1 days out, study group sessions, application next
   steps) to push/{uid}, computed here in the student's own time zone.
   The Worker sends each one when it's due (see sendDueReminders in
   worker/src/index.js). The schedule is re-uploaded whenever planner
   data changes, so edits and completions are reflected.
──────────────────────────────────────────────────────────────── */
const VAPID_PUBLIC_KEY = 'BKX_rScAJRN3xqruCKzrr6dD9zL9fhp6vP6yb3QCFC9duVTsr8r4PsMQUwueCBQyjV-H28AA1Uh2VYLQ0euhA1s';
const PUSH_HORIZON_DAYS = 10;

function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
function isIosBrowserNotInstalled() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && !navigator.standalone && !window.matchMedia('(display-mode: standalone)').matches;
}
function pushActive() { return !!window._pushActive; }
function b64urlToUint8(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function ensurePushSubscription() {
  if (!pushSupported() || !cloudGroupsEnabled() || notificationPermission() !== 'granted' || !reminderSettings().enabled) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToUint8(VAPID_PUBLIC_KEY) });
    const json = sub.toJSON();
    const ref = _fbDb.collection('push').doc(_fbUser.uid);
    const snap = await ref.get();
    let existing = [];
    try { existing = JSON.parse(snap.data()?.subsJson || '[]'); } catch {}
    const subs = [{ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }, ...existing.filter(s => s.endpoint !== json.endpoint)].slice(0, 6);
    await ref.set({ subsJson: JSON.stringify(subs), tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '', updatedAt: Date.now() }, { merge: true });
    window._pushActive = true;
    uploadPushSchedule();
    return true;
  } catch (e) {
    if (e?.name === 'NotAllowedError') console.warn('Push permission not granted', e);
    else diag.warn('push', 'Push subscription failed', e);
    return false;
  }
}
async function removePushSubscription() {
  window._pushActive = false;
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    if (cloudGroupsEnabled()) {
      const ref = _fbDb.collection('push').doc(_fbUser.uid);
      const snap = await ref.get();
      let existing = [];
      try { existing = JSON.parse(snap.data()?.subsJson || '[]'); } catch {}
      await ref.set({ subsJson: JSON.stringify(existing.filter(s => s.endpoint !== endpoint)), updatedAt: Date.now() }, { merge: true });
    }
  } catch (e) { diag.warn('push', 'Push unsubscribe failed', e); }
}

// The same reminders reminders.js shows in the app, laid out ahead of time.
function upcomingReminderSchedule(now = new Date()) {
  const rs = reminderSettings();
  const items = [];
  const at = (dateIso, hhmm) => new Date(`${dateIso}T${hhmm}:00`).getTime();
  const inScope = (a) => !a.courseId || activeCourses().some(c => c.id === a.courseId);
  const open = state.assignments.filter(a => !isAssignmentDone(a) && inScope(a));
  const nowMs = now.getTime();
  const push = (key, when, title, body, route) => { if (when > nowMs) items.push({ key, at: when, title, body, route }); };
  for (let i = 0; i < PUSH_HORIZON_DAYS; i++) {
    const d = addDays(todayIso(), i), next = addDays(d, 1);
    if (rs.digest) {
      const due = [...open.filter(a => a.dueDate === d).map(a => a.title), ...state.todos.filter(x => !x.done && x.dueDate === d).map(x => x.title), ...appDueItems(d, d).map(x => x.label)];
      const overdue = i === 0 ? open.filter(a => a.dueDate && a.dueDate < d).length : 0;
      if (due.length || overdue) push(`digest:${d}`, at(d, rs.digestTime), due.length ? `${due.length} thing${due.length === 1 ? '' : 's'} due today` : 'You have overdue work', [due.length ? summarize(due) : '', overdue ? `${overdue} overdue` : ''].filter(Boolean).join(' · '), 'dashboard');
    }
    if (rs.evening) {
      const due = [...open.filter(a => a.dueDate === next).map(a => a.title), ...appDueItems(next, next).map(x => x.label)];
      if (due.length) push(`evening:${d}`, at(d, rs.eveningTime), `Due tomorrow: ${due.length} thing${due.length === 1 ? '' : 's'}`, summarize(due), 'assignments');
    }
    if (rs.hourBefore) {
      open.filter(a => a.dueDate === d && a.dueTime && a.dueTime !== '23:59').forEach(a => push(`hour:${a.id}:${d}:${a.dueTime}`, at(d, a.dueTime) - 3600000, `Due in 1 hour: ${a.title}`, `${getCourse(a.courseId)?.name || ''} · due ${fmtTime(a.dueTime)}`, 'assignments'));
      appDueItems(d, d).filter(x => x.time).forEach(x => push(`app:${x.app.id}:${d}:${x.time}`, at(d, x.time) - 3600000, `In 1 hour: ${x.label}`, x.app.type, 'career'));
    }
    if (rs.exams) {
      open.filter(a => a.type === 'exam' && a.dueDate).forEach(a => {
        const until = Math.round((new Date(a.dueDate + 'T00:00:00') - new Date(d + 'T00:00:00')) / 86400000);
        if (until === 3 || until === 1) push(`exam:${a.id}:${until}`, at(d, rs.digestTime), `${a.title} is ${until === 1 ? 'tomorrow' : 'in 3 days'}`, `${getCourse(a.courseId)?.name || ''}${a.dueTime ? ` · ${fmtTime(a.dueTime)}` : ''}. Time to review.`, 'exams');
      });
    }
    if (rs.sessions && typeof groupSessionsOnDate === 'function') {
      groupSessionsOnDate(d).filter(s => s.start).forEach(s => push(`session:${s.code}:${s.id}:${d}`, at(d, s.start) - 1800000, `${s.title} starts in 30 min`, s.groupName, 'studygroups'));
    }
    if (rs.sessions && typeof orgEventsOnDate === 'function') {
      orgEventsOnDate(d).filter(e => e.start).forEach(e => push(`org:${e.code}:${e.id}:${d}`, at(d, e.start) - 3600000, `${e.title} in 1 hour`, `${e.orgName}${e.required ? ' · required' : ''}`, 'orgs'));
      orgEventsOnDate(d).filter(e => !e.start && e.category === 'deadline').forEach(e => push(`orgdue:${e.code}:${e.id}`, at(d, rs.digestTime), `${e.orgName}: ${e.title} today`, 'Deadline', 'orgs'));
    }
    if (rs.digest) milestoneDueItems(d, d).forEach(({ p, m }) => push(`ms:${m.id}:${d}`, at(d, rs.digestTime) + 60000, `Milestone today: ${m.title}`, p.title, 'projects'));
  }
  return items.sort((a, b) => a.at - b.at).slice(0, 100);
}
let _pushUploadTimer = null, _lastPushHash = '';
function uploadPushSchedule() {
  if (!pushActive() || !cloudGroupsEnabled()) return;
  clearTimeout(_pushUploadTimer);
  _pushUploadTimer = setTimeout(async () => {
    const items = upcomingReminderSchedule();
    const json = JSON.stringify(items);
    if (json === _lastPushHash) return;
    try {
      await _fbDb.collection('push').doc(_fbUser.uid).set({ itemsJson: json, nextAt: items.length ? items[0].at : Date.now() + 30 * 86400000, updatedAt: Date.now() }, { merge: true });
      _lastPushHash = json;
    } catch (e) { diag.warn('push', 'Push schedule upload failed', e); }
  }, 8000);
}
async function sendPushTest() {
  if (!pushActive()) { sendTestNotification(); return; }
  try {
    const idToken = await _fbUser.getIdToken();
    const res = await fetch(`${CHECKOUT_PROXY_URL}/push-test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Test failed');
    toast(`Sent to ${data.sent} of ${data.devices} device${data.devices === 1 ? '' : 's'}. Lock your phone or close the app to see it.`, 'success', 5000);
  } catch (e) { toast(e.message || 'Couldn’t send a test notification', 'error'); }
}
