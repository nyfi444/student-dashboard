/* ── Study Groups ─────────────────────────────────────────────────
   A group is one shared Firestore doc, studyGroups/{CODE}, plus two
   subcollections: items (shared notes, decks, files, links) and
   messages (chat). The 6-character code is the invite: anyone signed in
   who has it can look the group up and add themselves, and
   firestore.rules keeps everything else members-only.

   Every write is field-level (sessions.<id>.rsvp.<uid>, avail.<uid>, …)
   instead of re-uploading the whole group. The first version did
   set(wholeGroup) on every change, so whenever two members edited at the
   same time, whoever saved last silently erased the other's edit.

   Members are tracked by account uid, never by display name. Rosters
   used to be a list of names, so two people named Alex were the same
   member, and renaming yourself orphaned your tasks and availability.

   Your planner (state.studyGroups) only holds a small membership entry
   per cloud group, {code, cloud:true, name}; the live group data sits in
   _liveGroups, fed by one realtime listener per group. Groups made
   without an account (the demo, or the sample group) live entirely in
   state.studyGroups with local:true, in the same shape, and never touch
   the cloud. Older full-copy entries from the first version are migrated
   to the cloud format the first time a paid account loads them.
──────────────────────────────────────────────────────────────── */
const GROUP_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I, so a code read off a whiteboard can't be mistyped
const LOCAL_UID = 'local-me';
const AVAIL_START_HOUR = 7;
const AVAIL_SLOT_MIN = 30;
const AVAIL_SLOTS = 32; // 7:00am to 11:00pm in half hours
const AVAIL_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const AVAIL_DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const GROUP_FILE_MAX_BYTES_CLOUD = 10 * 1024 * 1024; // real Firebase Storage upload
const GROUP_FILE_MAX_BYTES_LOCAL = 2 * 1024 * 1024;  // inline data URL, only ever held in memory
const GROUP_MESSAGE_MAX = 2000;
const PENDING_JOIN_KEY = 'shq_pending_join';
const GROUP_CACHE_KEY = storeKey + '.groups';
const GROUP_PRICING_URL = 'https://semester-hq.com/group-pricing.html';
const SHARE_KIND_ICON = { note: 'file-text', deck: 'layers', project: 'folder', 'note-bundle': 'folder-open', file: 'paperclip', link: 'link' };
const SHARE_KIND_LABEL = { note: 'Note', deck: 'Flashcards', project: 'Project', 'note-bundle': 'Notebook', file: 'File', link: 'Link' };
const GROUP_TABS = [['overview', 'Overview'], ['schedule', 'Sessions'], ['availability', 'Find a time'], ['tasks', 'Tasks'], ['resources', 'Resources'], ['chat', 'Chat']];
const SESSION_REPEAT_WEEKS = [2, 4, 6, 8, 10, 12, 15];
// The window a schedule-drafted availability starts from (see fillAvailabilityFromSchedule).
const AVAIL_AUTO_START = '09:00';
const AVAIL_AUTO_END = '21:00';

/* ── Identity ──────────────────────────────────────────────────── */
function cloudGroupsEnabled() { return fbConfigured() && !!_fbUser && !!_fbDb && !!window._licensed; }
function myUidFor(g) { return g && g.local ? LOCAL_UID : (_fbUser?.uid || LOCAL_UID); }
function myGroupName() {
  return (state.settings.displayName || _fbUser?.displayName || (_fbUser?.email || '').split('@')[0] || 'You').trim() || 'You';
}
function genGroupCode() {
  const bytes = new Uint8Array(6);
  if (window.crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); });
  return [...bytes].map(b => GROUP_CODE_CHARS[b % GROUP_CODE_CHARS.length]).join('');
}
// Group data is written by other members, so any id that ends up inside an
// onclick="…('id')" handler has to be checked, not just escaped: esc() turns a
// quote into &#39;, which the browser decodes right back into a quote before
// running the handler. Items with ids outside this shape are simply skipped.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const safeId = (id) => typeof id === 'string' && SAFE_ID.test(id);
function normalizeCode(v) { return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }

/* ── Small helpers ─────────────────────────────────────────────── */
function toMin(hhmm) { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return h * 60 + (m || 0); }
function fromMin(min) { return `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }
function addMinutesHHMM(t, mins) { return fromMin(Math.min(toMin(t) + mins, 23 * 60 + 59)); }
function fmtFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtSessionDay(dIso) {
  const n = daysBetween(dIso);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return fmtDate(dIso, { weekday: 'long' });
  return fmtDate(dIso, { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtSessionWhen(s) { return `${fmtSessionDay(s.date)}${s.start ? ' · ' + fmtTime(s.start) + (s.end ? '–' + fmtTime(s.end) : '') : ''}`; }
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }
function linkifyText(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+/g, (m) => `<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`);
}
function linkifyWhere(where) {
  return isHttpUrl(where) ? `<a href="${esc(where.trim())}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${esc(hostOf(where) || 'Join link')}</a>` : esc(where);
}
function shortHour(h) { const hr = Math.floor(h); return `${hr % 12 === 0 ? 12 : hr % 12}${hr >= 12 ? 'p' : 'a'}`; }
// A session or event whose "where" is a link gets a real button, not just an
// underlined hostname: for a call it says so, for anything else it opens.
function joinLinkButton(where, size = 'btn-sm') {
  if (!isHttpUrl(where)) return '';
  const host = hostOf(where);
  const call = /zoom\.us|meet\.google|teams\.microsoft|webex|discord|whereby|gather/i.test(host);
  return `<a class="btn ${size} sg-join-btn" href="${esc(where.trim())}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${icon(call ? 'play' : 'link', 13, 1.9)} ${call ? 'Join call' : 'Open link'}</a>`;
}
// The class a group belongs to, matched on the code or name typed when it was
// made, and the group's color: one it picked, else that class's color. Sessions
// on the calendar and dashboard use it, so a BIO 201 session looks like BIO 201.
function groupCourse(g) {
  const key = typeof normKey === 'function' ? normKey(g?.courseLabel) : '';
  if (!key || typeof activeCourses !== 'function') return null;
  return activeCourses().find(c => normKey(c.code) === key || normKey(c.name) === key) || null;
}
function groupColor(g) {
  if (HEX_COLOR.test(g?.color || '')) return g.color;
  return groupCourse(g)?.color || '';
}
function dateTile(dIso) {
  const d = new Date(dIso + 'T00:00:00');
  return `<div class="sg-date-tile"><span>${d.toLocaleDateString('en-US', { month: 'short' })}</span><strong>${d.getDate()}</strong></div>`;
}
const byDueThenCreated = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.createdAt || 0) - (b.createdAt || 0);

/* ── Availability grid encoding: one '0'/'1' string per weekday ─── */
function emptyDayStr() { return '0'.repeat(AVAIL_SLOTS); }
function slotOf(hhmm) { return clamp(Math.floor((toMin(hhmm) - AVAIL_START_HOUR * 60) / AVAIL_SLOT_MIN), 0, AVAIL_SLOTS); }
function slotTime(i) { return fromMin(AVAIL_START_HOUR * 60 + i * AVAIL_SLOT_MIN); }
function availDay(entry, day) { const s = entry?.['d' + day]; return typeof s === 'string' && s.length === AVAIL_SLOTS ? s : emptyDayStr(); }
function availHasAny(entry) { return !!entry && [0, 1, 2, 3, 4, 5, 6].some(d => availDay(entry, d).includes('1')); }
function availDayOrder() { return state.settings.weekStartsMonday ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]; }
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

/* ── People ────────────────────────────────────────────────────── */
// Everyone in a group has a color (they can pick their own), used for their
// avatar and their stripe in the Find a time grid, so you can tell people
// apart at a glance. Stored per group at people.<uid>.color.
// Colors a group or club can wear (its crest, its events on the calendar).
const GROUP_COLORS = ['#1B2A4A', '#8C3B1F', '#2F4A3A', '#6E2E3A', '#3b6ea5', '#7A4A68', '#1F5F6B', '#5a4a1f'];
const PERSON_COLORS = ['#3b6ea5', '#c0503f', '#3f8a55', '#8a5cc2', '#d08a1e', '#2a9396', '#c24f8a', '#6b7a2e', '#5a6b7b', '#a0613a'];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const _groupColorCache = new WeakMap();
function groupColorMap(g) {
  if (!g) return {};
  if (_groupColorCache.has(g)) return _groupColorCache.get(g);
  const map = {};
  Object.entries(g.people || {}).forEach(([id, p]) => { if (HEX_COLOR.test(p?.color || '')) map[id] = p.color; });
  // Nobody picked yet: hand out unused palette colors in the order people joined.
  const taken = new Set(Object.values(map));
  const free = PERSON_COLORS.filter(c => !taken.has(c));
  const unpicked = [
    ...Object.entries(g.people || {}).filter(([id]) => !map[id]).sort((a, b) => (a[1]?.joinedAt || 0) - (b[1]?.joinedAt || 0)).map(([id]) => id),
    ...Object.keys(g.avail || {}).filter(id => !map[id] && !(g.people || {})[id]),
  ];
  unpicked.forEach((id, i) => { map[id] = (free.length ? free : PERSON_COLORS)[i % (free.length || PERSON_COLORS.length)]; });
  _groupColorCache.set(g, map);
  return map;
}
function personColor(g, id) { return groupColorMap(g)[id] || '#6b6b6b'; }
// White initials where they're readable on the member's color, dark ones on
// the lighter colors (amber, green, teal), so every avatar meets 4.5:1.
function inkOnColor(hex) {
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return 1.05 / (L + 0.05) >= 4.5 ? '#fff' : '#141414';
}
function personAvatar(id, name, size = 26, color = '#6b6b6b') {
  const initial = esc((String(name || '?').trim()[0] || '?').toUpperCase());
  const shade = HEX_COLOR.test(color) ? color : '#6b6b6b';
  return `<span class="avatar sg-avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px;--shade:${shade};color:${inkOnColor(shade)}" title="${esc(name)}">${initial}</span>`;
}
function setMyGroupColor(code, color) {
  if (!PERSON_COLORS.includes(color)) return;
  const g = findGroup(code);
  if (!g) return;
  groupWrite(code, { [`people.${myUidFor(g)}.color`]: color });
}
function colorSwatches(g, onPickJs) {
  const mine = personColor(g, myUidFor(g));
  const takenBy = {};
  groupPeople(g).forEach(p => { if (p.uid !== myUidFor(g) && HEX_COLOR.test(g.people?.[p.uid]?.color || '')) takenBy[g.people[p.uid].color] = p.name; });
  return `<div class="sg-swatches" role="radiogroup" aria-label="Your color">${PERSON_COLORS.map(c => `<button class="sg-swatch ${c === mine ? 'active' : ''}" role="radio" aria-checked="${c === mine}" style="background:${c}" title="${takenBy[c] ? `Also used by ${esc(takenBy[c])}` : 'Use this color'}" aria-label="Color ${c}${takenBy[c] ? `, used by ${esc(takenBy[c])}` : ''}" onclick="${onPickJs}('${g.code}','${c}')">${takenBy[c] ? '<span class="sg-swatch-taken"></span>' : ''}</button>`).join('')}</div>`;
}
function groupPeople(g) {
  const members = new Set(g.memberUids || []);
  return Object.entries(g.people || {})
    .filter(([u]) => members.has(u) && safeId(u))
    .map(([u, p]) => ({ uid: u, name: p?.name || 'Member', role: p?.role || 'member', joinedAt: p?.joinedAt || 0 }))
    .sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.joinedAt - b.joinedAt));
}
function personName(g, id) { return g.people?.[id]?.name || g.avail?.[id]?.name || 'Former member'; }
function avatarStack(g, max = 4, size = 26, uids) {
  const list = uids ? uids.map(u => ({ uid: u, name: personName(g, u) })) : groupPeople(g);
  if (!list.length) return '';
  return `<span class="sg-stack">${list.slice(0, max).map(p => personAvatar(p.uid, p.name, size, personColor(g, p.uid))).join('')}${list.length > max ? `<span class="avatar sg-avatar sg-avatar-more" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px">+${list.length - max}</span>` : ''}</span>`;
}

/* ── Group data: entries, live copies, normalized views ───────── */
let _liveGroups = {};
try { _liveGroups = JSON.parse(dataStore.getItem(GROUP_CACHE_KEY) || '{}') || {}; } catch { _liveGroups = {}; }
const persistGroupCache = debounce(() => { try { dataStore.setItem(GROUP_CACHE_KEY, JSON.stringify(_liveGroups)); } catch {} }, 800);
const _groupItems = {};
const _groupMessages = {};
// code -> the error its listener died with. Cleared by the next good snapshot.
const _groupLoadErrors = {};

function groupEntries() { return state.studyGroups || (state.studyGroups = []); }
function groupEntry(code) { return groupEntries().find(e => e.code === code); }
function isLegacyGroupEntry(e) { return !!e && !e.cloud && !e.local; }

function normalizeGroup(raw, { local = false } = {}) {
  if (!raw) return null;
  if (raw.v !== 2) return { ...legacyToV2(raw, local ? LOCAL_UID : (_fbUser?.uid || LOCAL_UID)).group, local, legacyPending: true };
  return {
    ...raw, local,
    sessions: raw.sessions || {}, taskItems: raw.taskItems || {}, avail: raw.avail || {},
    people: raw.people || {}, memberUids: raw.memberUids || [], lastMessage: raw.lastMessage || null,
  };
}
function groupView(entry) {
  if (!entry) return null;
  if (entry.local) return normalizeGroup(entry, { local: true });
  if (entry.cloud) {
    const live = _liveGroups[entry.code];
    if (live) return normalizeGroup({ ...live, code: entry.code });
    return normalizeGroup({ v: 2, code: entry.code, name: entry.name || 'Study group', loading: true });
  }
  return normalizeGroup(entry);
}
function allGroups() { return groupEntries().filter(e => e && SAFE_ID.test(e.code || '')).map(groupView).filter(Boolean); }
function findGroup(code) { return groupView(groupEntry(code)); }
function groupItems(g) { return (g.local ? [...(groupEntry(g.code)?.items || [])] : [...(_groupItems[g.code] || [])]).filter(s => s && safeId(s.id)).sort((a, b) => (b.sharedAt || 0) - (a.sharedAt || 0)); }
function groupMessages(g) { return (g.local ? (groupEntry(g.code)?.messages || []) : (_groupMessages[g.code] || [])).filter(m => m && safeId(m.id) && typeof m.text === 'string'); }
function sessionList(g) { return Object.values(g.sessions || {}).filter(s => s && safeId(s.id) && typeof s.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.date)).sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || ''))); }
function sessionIsPast(s) {
  const t = todayIso();
  if (s.date !== t) return s.date < t;
  const end = s.end || s.start;
  if (!end) return false;
  const now = new Date();
  return toMin(end) < now.getHours() * 60 + now.getMinutes();
}
function upcomingSessions(g) { return sessionList(g).filter(s => !sessionIsPast(s)); }
function rsvpCounts(s) { const v = Object.values(s.rsvp || {}); return { yes: v.filter(x => x === 'yes').length, maybe: v.filter(x => x === 'maybe').length, no: v.filter(x => x === 'no').length }; }
function taskList(g) { return Object.values(g.taskItems || {}).filter(t => t && safeId(t.id) && t.title); }
function groupChatSeen() { return state.settings.groupChatSeen || (state.settings.groupChatSeen = {}); }
function groupHasUnread(g) { const m = g.lastMessage; return !!m && m.uid !== myUidFor(g) && m.at > (groupChatSeen()[g.code] || 0); }
function anyGroupUnread() { try { return allGroups().some(groupHasUnread); } catch { return false; } }

/* ── First-version (v1) groups → current format ─────────────────
   v1 stored names instead of uids, an events array, a tasks array,
   name-keyed availability blocks, a projects array, and every shared
   item inline. Nothing is dropped: project tasks/deadlines become tasks
   labeled with the project, project meetings become sessions, project
   files and shared items move to the items subcollection. ───────── */
function legacySlug(name) { return 'legacy-' + (String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'member'); }
function legacyToV2(raw, meUid) {
  const me = myGroupName();
  const now = Date.now();
  const isMe = (n) => !!n && (n === me || n === 'Me');
  const sessions = {};
  const taskItems = {};
  const items = [];
  const addSession = (title, date, time) => {
    if (!date) return;
    const id = uid();
    sessions[id] = { id, title: title || 'Study session', date, start: time || '', end: time ? addMinutesHHMM(time, 60) : '', where: '', notes: '', createdBy: meUid, createdByName: me, createdAt: now, rsvp: {} };
  };
  const addTask = (t, label) => {
    const id = uid();
    taskItems[id] = {
      id, title: t.title || 'Task', label: label || '', due: t.due || null,
      assignee: isMe(t.assignedTo) ? meUid : null, assigneeName: t.assignedTo && !isMe(t.assignedTo) ? t.assignedTo : '',
      done: !!t.done, doneBy: t.done && isMe(t.completedBy) ? meUid : null, doneByName: t.completedBy || '', doneAt: t.completedAt || null,
      createdBy: meUid, createdAt: t.assignedAt || now,
    };
  };
  (raw.events || []).forEach(e => addSession(e.title, e.date, e.time));
  (raw.tasks || []).forEach(t => addTask(t));
  (raw.projects || []).forEach(p => {
    (p.tasks || []).forEach(t => addTask(t, p.title));
    (p.deadlines || []).forEach(d => addTask({ title: d.title, due: d.date }, p.title));
    (p.meetings || []).forEach(m => addSession(`${p.title}: ${m.title}`, m.date));
    (p.files || []).forEach(f => items.push({ id: uid(), kind: f.size ? 'file' : 'link', title: f.name || 'File', fileName: f.name, size: f.size || 0, url: f.url || '', dataUrl: f.dataUrl || null, sharedBy: me, sharedByUid: meUid, sharedAt: now }));
  });
  // Attributed to whoever migrates it (they're the one uploading it), with the
  // original sharer's name kept for display.
  (raw.sharedItems || []).forEach(s => items.push({ ...s, id: s.id || uid(), sharedByUid: meUid }));
  const avail = {};
  Object.entries(raw.availability || {}).forEach(([name, blocks]) => {
    if (!Array.isArray(blocks) || !blocks.length) return;
    avail[isMe(name) ? meUid : legacySlug(name)] = { ...availFromRanges(blocks), name: isMe(name) ? me : name, updatedAt: now };
  });
  const names = [...new Set((raw.members || []).filter(Boolean).map(n => (n === 'Me' ? me : n)))];
  if (!names.includes(me)) names.push(me);
  const course = raw.courseId && typeof getCourse === 'function' ? getCourse(raw.courseId) : null;
  return {
    group: {
      v: 2, code: raw.code, name: raw.name || 'Study group', courseLabel: raw.courseLabel || (course ? (course.code || course.name) : ''), description: '',
      createdBy: meUid, createdAt: now, updatedAt: now,
      memberUids: [meUid], people: { [meUid]: { name: me, role: 'owner', joinedAt: now } },
      members: names, events: [], sessions, taskItems, avail, lastMessage: null,
    },
    items,
  };
}
function newGroupDoc({ code, name, courseLabel = '', description = '', ownerUid }) {
  const now = Date.now();
  return {
    v: 2, code, name, courseLabel, description, createdBy: ownerUid, createdAt: now, updatedAt: now,
    memberUids: [ownerUid], people: { [ownerUid]: { name: myGroupName(), role: 'owner', joinedAt: now } },
    // `members` (names) and `events` only exist so a tab still running the
    // first version of this file doesn't crash reading a new-format group.
    members: [myGroupName()], events: [],
    sessions: {}, taskItems: {}, avail: {}, lastMessage: null,
  };
}

/* ── Writes ────────────────────────────────────────────────────── */
const GW_DELETE = { __op: 'delete' };
const gwUnion = (...v) => ({ __op: 'union', v });
const gwRemove = (...v) => ({ __op: 'remove', v });
function applyLocalOp(obj, segs, val) {
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    if (typeof cur[segs[i]] !== 'object' || cur[segs[i]] === null) cur[segs[i]] = {};
    cur = cur[segs[i]];
  }
  const k = segs[segs.length - 1];
  if (val === GW_DELETE) delete cur[k];
  else if (val?.__op === 'union') cur[k] = [...new Set([...(cur[k] || []), ...val.v])];
  else if (val?.__op === 'remove') cur[k] = (cur[k] || []).filter(x => !val.v.includes(x));
  else cur[k] = val;
}
// ops: { 'dotted.field.path': value | GW_DELETE | gwUnion(...) | gwRemove(...) }
async function groupWrite(code, ops) {
  const entry = groupEntry(code);
  if (!entry) return false;
  if (entry.local) {
    Object.entries(ops).forEach(([path, val]) => applyLocalOp(entry, path.split('.'), val));
    entry.updatedAt = Date.now();
    touch();
    return true;
  }
  if (!cloudGroupsEnabled()) { toast('Log in to make changes to this group.', 'error'); return false; }
  const FV = firebase.firestore.FieldValue;
  const payload = { updatedAt: Date.now() };
  Object.entries(ops).forEach(([path, val]) => {
    payload[path] = val === GW_DELETE ? FV.delete() : val?.__op === 'union' ? FV.arrayUnion(...val.v) : val?.__op === 'remove' ? FV.arrayRemove(...val.v) : val;
  });
  try {
    await _fbDb.collection('studyGroups').doc(code).update(payload);
    return true;
  } catch (e) {
    diag.error('studygroups', 'Group write failed', e);
    toast(e.code === 'permission-denied' ? 'That change was blocked. You may no longer be in this group.' : 'Couldn’t save that to the group. Check your connection and try again.', 'error', 4500);
    return false;
  }
}

/* ── Cloud lifecycle ───────────────────────────────────────────── */
const _groupDocUnsubs = {};
let _detailSubs = { code: null, unsubs: [] };
let _groupSyncRunning = false;

// Called at the end of cloudPull(), i.e. once a paid, signed-in account's
// planner has loaded.
async function startGroupSync() {
  if (!cloudGroupsEnabled()) return;
  await adoptStrayGroupEntries();
  const codes = new Set(groupEntries().map(e => e.code));
  Object.keys(_liveGroups).forEach(c => { if (!codes.has(c)) delete _liveGroups[c]; });
  reconcileGroupSubscriptions();
  handlePendingJoin();
  if (typeof syncSharedClasses === 'function') syncSharedClasses();
  if (typeof startOrgSync === 'function') startOrgSync();
  if (typeof render === 'function') render();
}
// Anything in the planner that isn't a cloud membership entry: first-version
// full copies, groups made before signing in, or the demo sample. Also runs
// when a planner snapshot arrives, since a tab still on the old code can sync
// full copies back in.
let _lastStrayAdopt = 0;
async function adoptStrayGroupEntries({ throttle = false } = {}) {
  if (!cloudGroupsEnabled() || _groupSyncRunning) return;
  if (!groupEntries().some(e => !e.cloud)) return;
  if (throttle && Date.now() - _lastStrayAdopt < 30000) return;
  _groupSyncRunning = true;
  _lastStrayAdopt = Date.now();
  try {
    if (groupEntries().some(e => e.sample)) { state.studyGroups = groupEntries().filter(e => !e.sample); save(); }
    for (const e of [...groupEntries()]) {
      if (isLegacyGroupEntry(e)) await adoptGroupEntry(e);
      else if (e.local) await uploadLocalGroup(e);
    }
  } finally { _groupSyncRunning = false; }
  reconcileGroupSubscriptions();
}
function stopGroupSync() {
  if (typeof stopOrgSync === 'function') stopOrgSync();
  Object.keys(_groupDocUnsubs).forEach(code => { _groupDocUnsubs[code](); delete _groupDocUnsubs[code]; });
  closeGroupDetailListeners();
}
function reconcileGroupSubscriptions() {
  if (!cloudGroupsEnabled()) return;
  const want = new Set(groupEntries().filter(e => e.cloud).map(e => e.code));
  Object.keys(_groupDocUnsubs).forEach(code => { if (!want.has(code)) { _groupDocUnsubs[code](); delete _groupDocUnsubs[code]; } });
  want.forEach(code => {
    if (_groupDocUnsubs[code]) return;
    _groupDocUnsubs[code] = _fbDb.collection('studyGroups').doc(code).onSnapshot(
      doc => onGroupSnapshot(code, doc),
      err => { _groupLoadErrors[code] = err; diag.error('studygroups', 'Group listener failed', err); renderRemote(); },
    );
  });
}
const _legacyDocsRepaired = new Set();
function onGroupSnapshot(code, doc) {
  delete _groupLoadErrors[code];
  const entry = groupEntry(code);
  if (!entry?.cloud || !_fbUser) return;
  const myUid = _fbUser.uid;
  const data = doc.exists ? doc.data() : null;
  if (data && data.v !== 2) {
    // Rewritten in the old format by a tab still running the first version.
    if (!_legacyDocsRepaired.has(code)) { _legacyDocsRepaired.add(code); ensureGroupMembership(code).catch(e => diag.warn('studygroups', 'Could not repair group format', e)); }
    return;
  }
  if (!data || !(data.memberUids || []).includes(myUid)) {
    if (doc.metadata.fromCache || doc.metadata.hasPendingWrites) return; // never drop a group based on a stale offline cache
    dropGroupEntry(code, !data ? `“${entry.name || 'A group'}” was deleted by its owner.` : `You’re no longer a member of “${entry.name || 'a group'}”.`);
    return;
  }
  _liveGroups[code] = data;
  persistGroupCache();
  if (entry.name !== data.name) { entry.name = data.name; save(); }
  if (!doc.metadata.hasPendingWrites) {
    const ops = {};
    // Keep the roster current after someone renames themselves in Settings.
    if (data.people?.[myUid] && data.people[myUid].name !== myGroupName()) ops[`people.${myUid}.name`] = myGroupName();
    // Availability someone added under their name in the first version
    // moves onto their account the first time they open the group.
    const legacyKey = legacySlug(myGroupName());
    if (data.avail?.[legacyKey] && !availHasAny(data.avail[myUid])) { ops[`avail.${myUid}`] = { ...data.avail[legacyKey], name: myGroupName() }; ops[`avail.${legacyKey}`] = GW_DELETE; }
    if (Object.keys(ops).length) groupWrite(code, ops);
  }
  renderRemote();
}
function dropGroupEntry(code, message) {
  const entry = groupEntry(code);
  if (_groupDocUnsubs[code]) { _groupDocUnsubs[code](); delete _groupDocUnsubs[code]; }
  if (_detailSubs.code === code) closeGroupDetailListeners();
  delete _liveGroups[code]; persistGroupCache();
  if (!entry) return;
  state.studyGroups = groupEntries().filter(e => e.code !== code);
  if (state.subRoute === code) state.subRoute = null;
  touch();
  if (message) toast(message, 'info', 4200);
}
// A listener that fails stays failed (Firestore does not retry it), so the
// group page used to sit on "Loading…" for good. Dropping the dead
// subscription and reconciling attaches a fresh one.
function retryGroupLoad(code) {
  delete _groupLoadErrors[code];
  if (_groupDocUnsubs[code]) { try { _groupDocUnsubs[code](); } catch {} delete _groupDocUnsubs[code]; }
  reconcileGroupSubscriptions();
  render();
}
// What sits under the group's title while its live copy is missing: the
// error with a way forward if the listener failed, otherwise a quiet
// loading line. A denied read means the group is gone or you were removed,
// so that case also offers to take it off the list.
function groupLoadNotice(g) {
  const err = _groupLoadErrors[g.code];
  if (!err) return g.loading ? `<div class="small muted mb-16">Loading the latest from your group…</div>` : '';
  const denied = err.code === 'permission-denied';
  return `<div class="mb-16">${inlineErrorHtml(
    denied ? 'You don’t have access to this group anymore. It may have been deleted, or you were removed.' : 'This group didn’t load. Check your connection and try again.',
    `retryGroupLoad('${g.code}')`,
    { extra: denied ? `<button class="btn btn-sm btn-ghost" onclick="dropGroupEntry('${g.code}')">Remove it from my list</button>` : '' },
  )}</div>`;
}
function replaceWithCloudEntry(code, name) {
  const list = groupEntries().filter(e => e.code !== code);
  list.push({ code, cloud: true, name: name || 'Study group', joinedAt: Date.now() });
  state.studyGroups = list;
  save();
}
function joinOps(myUid) {
  const FV = firebase.firestore.FieldValue;
  return {
    memberUids: FV.arrayUnion(myUid),
    [`people.${myUid}`]: { name: myGroupName(), role: 'member', joinedAt: Date.now() },
    members: FV.arrayUnion(myGroupName()),
    updatedAt: Date.now(),
  };
}
// Makes sure the signed-in account is a member of studyGroups/{code},
// converting a first-version doc to the current format along the way.
// localLegacy is an old full-copy group from this planner, used to
// recreate a group whose creator never synced it.
async function ensureGroupMembership(code, localLegacy = null) {
  const myUid = _fbUser.uid;
  const ref = _fbDb.collection('studyGroups').doc(code);
  let items = [], name = '';
  await _fbDb.runTransaction(async (tx) => {
    items = [];
    const snap = await tx.get(ref);
    if (!snap.exists) {
      if (!localLegacy) throw new Error('No group found with that code. Double-check it with whoever invited you.');
      const conv = legacyToV2({ ...localLegacy, code }, myUid);
      tx.set(ref, conv.group); items = conv.items; name = conv.group.name;
      return;
    }
    const data = snap.data();
    name = data.name;
    if (data.v !== 2) {
      const conv = legacyToV2({ ...data, code }, myUid);
      tx.set(ref, conv.group); items = conv.items;
      return;
    }
    if (!(data.memberUids || []).includes(myUid)) tx.update(ref, joinOps(myUid));
  });
  for (const it of items) {
    try { await addCloudGroupItem(code, it); } catch (e) { diag.warn('studygroups', 'Could not move a shared item to the new format', e); }
  }
  return name;
}
async function adoptGroupEntry(entry) {
  try {
    const name = await ensureGroupMembership(entry.code, entry);
    replaceWithCloudEntry(entry.code, name);
  } catch (e) { diag.warn('studygroups', 'Could not move study group to the new format', e); }
}
// A group made while trying the app without an account, still in memory
// when the person paid and signed in without leaving the page.
async function uploadLocalGroup(entry) {
  if (entry.sample) return;
  try {
    const myUid = _fbUser.uid;
    const { items = [], messages, local, sample, updatedAt, code: oldCode, ...rest } = entry;
    const remap = (obj) => JSON.parse(JSON.stringify(obj).split(JSON.stringify(LOCAL_UID)).join(JSON.stringify(myUid)));
    const code = await unusedGroupCode();
    const doc = { ...remap(rest), v: 2, code, createdBy: myUid, memberUids: [myUid], updatedAt: Date.now() };
    doc.people = { [myUid]: { name: myGroupName(), role: 'owner', joinedAt: Date.now() } };
    await _fbDb.collection('studyGroups').doc(code).set(doc);
    for (const it of remap(items)) { try { await addCloudGroupItem(code, it); } catch (e) { diag.warn('studygroups', 'Could not upload shared item', e); } }
    state.studyGroups = groupEntries().filter(e => e !== entry);
    replaceWithCloudEntry(code, doc.name);
  } catch (e) { diag.warn('studygroups', 'Could not upload local study group', e); }
}
async function unusedGroupCode() {
  for (let i = 0; i < 6; i++) {
    const code = genGroupCode();
    try { const snap = await _fbDb.collection('studyGroups').doc(code).get(); if (!snap.exists) return code; }
    catch { return code; } // offline: a collision is astronomically unlikely, and set() would be rejected by the rules anyway
  }
  return genGroupCode();
}
async function addCloudGroupItem(code, item) {
  const clean = { ...item };
  const inline = [clean.dataUrl, clean.url].find(v => typeof v === 'string' && v.startsWith('data:'));
  const fileName = clean.fileName || clean.title || 'file';
  if (inline) clean.url = await uploadDataUrlToStorage(`studyGroups/${code}/files/${clean.id}-${storageSafeName(fileName)}`, inline, fileName);
  delete clean.dataUrl;
  if (JSON.stringify(clean).length > FIRESTORE_DOC_SAFE_BYTES) throw new Error('That’s too large to share in one piece. Try sharing a smaller notebook or deck.');
  await _fbDb.collection('studyGroups').doc(code).collection('items').doc(clean.id).set(clean);
}

// Items + chat only need to be live for the group you're looking at.
function ensureGroupDetailListeners(code) {
  const entry = groupEntry(code);
  if (!entry?.cloud || !cloudGroupsEnabled()) { closeGroupDetailListeners(); return; }
  if (_detailSubs.code === code) return;
  closeGroupDetailListeners();
  _detailSubs.code = code;
  const ref = _fbDb.collection('studyGroups').doc(code);
  _detailSubs.unsubs.push(ref.collection('items').onSnapshot(snap => {
    _groupItems[code] = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    nameStoredFiles(_groupItems[code].filter(it => it.kind === 'file').map(it => ({ url: it.url, name: it.fileName || it.title })));
    renderRemote();
  }, e => diag.error('studygroups', 'Group items listener failed', e)));
  _detailSubs.unsubs.push(ref.collection('messages').orderBy('at').limitToLast(200).onSnapshot(snap => {
    _groupMessages[code] = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    renderRemote();
  }, e => diag.error('studygroups', 'Group chat listener failed', e)));
}
function closeGroupDetailListeners() {
  _detailSubs.unsubs.forEach(u => u());
  _detailSubs = { code: null, unsubs: [] };
}
function afterGroupPageRender() {
  const code = state.route === 'studygroups' ? state.subRoute : null;
  if (!code || !groupEntry(code)) { if (_detailSubs.code) closeGroupDetailListeners(); return; }
  ensureGroupDetailListeners(code);
  bindAvailabilityPainting();
  const log = document.getElementById('sg-chat-log');
  if (log) { log.scrollTop = log.scrollHeight; markChatSeen(code); }
}

/* ── Navigation ────────────────────────────────────────────────── */
function openGroup(code, tab) {
  setState({ route: 'studygroups', subRoute: code, groupTab: tab || 'overview' });
  window.scrollTo(0, 0);
}
function closeGroup() { setState({ subRoute: null }); window.scrollTo(0, 0); }
function setGroupTab(tab) { setState({ groupTab: tab }); }
function openGroupSession(code, sid) { openGroup(code, 'schedule'); if (sid) setTimeout(() => showGroupSessionModal(code, sid), 60); }

/* ── Index page ────────────────────────────────────────────────── */
function pageStudyGroups() {
  if (state.subRoute) {
    const g = findGroup(state.subRoute);
    if (g) return pageGroupDetail(g);
  }
  const groups = allGroups();
  return `
    ${pageHead('Study Groups', 'Find a time that works, plan sessions, and split the work with classmates.', `
      <button class="btn btn-sm" onclick="openJoinGroupModal()">${icon('user-plus', 13, 1.8)} Join with code</button>
      <button class="btn btn-primary" onclick="openCreateGroupModal()">+ New group</button>
    `)}
    ${groupsAccountBanner()}
    ${groups.length ? `
      ${groupsThisWeek(groups)}
      <div class="sg-section-label">Your groups</div>
      <div class="grid grid-3">${groups.map(groupIndexCard).join('')}</div>
    ` : groupsEmptyHero()}
    <div class="sg-pricing-note small muted">${icon('users', 13, 1.8)} Bringing a whole class, club, or team onto Semester HQ? <a href="${GROUP_PRICING_URL}" target="_blank" rel="noopener">See group pricing</a></div>
  `;
}
function groupsAccountBanner() {
  if (!fbConfigured() || cloudGroupsEnabled()) return '';
  return `<div class="sg-callout mb-16"><span>${icon('sparkles', 14, 1.8)}</span><div class="small">You’re trying Study Groups without an account, so groups you make here only last until you close this tab. <a href="login.html">Log in</a> to invite classmates and keep everything synced.</div></div>`;
}
function groupsThisWeek(groups) {
  const end = addDays(todayIso(), 7);
  const rows = groups.flatMap(g => upcomingSessions(g).filter(s => s.date <= end).map(s => ({ g, s })))
    .sort((a, b) => (a.s.date + (a.s.start || '')).localeCompare(b.s.date + (b.s.start || ''))).slice(0, 5);
  if (!rows.length) return '';
  return `
    <div class="card card-pad mb-16">
      <h3 class="sg-h3 mb-8">Coming up this week</h3>
      ${rows.map(({ g, s }) => `
        <div class="list-row sg-session-row" style="--course:${esc(groupColor(g) || '#6b6b6b')}" onclick="showGroupSessionModal('${g.code}','${s.id}')">
          ${dateTile(s.date)}
          <div class="row-title"><div class="sg-strong">${esc(s.title)}${s.seriesId ? ' <span class="sg-series-tag">Weekly</span>' : ''}</div><div class="row-meta">${esc(g.name)} · ${fmtSessionWhen(s)}${s.where ? ' · ' + linkifyWhere(s.where) : ''}</div></div>
          ${rsvpControl(g, s)}
        </div>`).join('')}
    </div>`;
}
function groupIndexCard(g) {
  const next = upcomingSessions(g)[0];
  const u = myUidFor(g);
  const myTasks = taskList(g).filter(t => !t.done && t.assignee === u).length;
  const unread = groupHasUnread(g);
  const count = groupPeople(g).length;
  return `
    <div class="card sg-card" role="button" tabindex="0" onclick="openGroup('${g.code}')" onkeydown="if(event.key==='Enter')openGroup('${g.code}')">
      <div class="sg-card-top">
        <div style="min-width:0">
          <div class="sg-card-name">${esc(g.name)}</div>
          <div class="small muted">${groupColor(g) ? `<span class="sg-name-dot" style="--p:${groupColor(g)}"></span>` : ''}${[g.courseLabel ? esc(g.courseLabel) : '', g.sample ? 'Sample' : ''].filter(Boolean).join(' · ') || '&nbsp;'}</div>
        </div>
        ${unread ? `<span class="sg-unread-dot" title="New messages"></span>` : ''}
      </div>
      <div class="sg-card-line"><span class="sg-card-ic">${icon('calendar', 13)}</span>${next ? `<span><span class="sg-strong">${esc(next.title)}</span><br><span class="muted">${fmtSessionWhen(next)}</span></span>` : `<span class="muted">No session scheduled</span>`}</div>
      ${g.lastMessage ? `<div class="sg-card-line"><span class="sg-card-ic">${icon('message-circle', 13)}</span><span class="sg-card-msg ${unread ? '' : 'muted'}"><span class="sg-strong">${esc(g.lastMessage.name)}:</span> ${esc(g.lastMessage.text)}</span></div>` : ''}
      <div class="sg-card-foot">
        ${avatarStack(g, 4, 24)}
        <span class="small muted">${g.loading ? 'Loading…' : `${count} member${count === 1 ? '' : 's'}`}${myTasks ? ` · ${myTasks} task${myTasks === 1 ? '' : 's'} for you` : ''}</span>
      </div>
    </div>`;
}
function groupsEmptyHero() {
  return emptyStateHtml({
    icon: 'users',
    title: 'Study better, together.',
    body: 'Start a group for a class and invite classmates with a link, then find a time everyone is free, plan sessions, split up the work, and chat in one place.',
    actions: [{ label: '+ Start a group', onclick: 'openCreateGroupModal()' }, { label: 'Join with code', onclick: 'openJoinGroupModal()' }],
    extra: cloudGroupsEnabled() ? '' : `<button class="btn btn-ghost btn-sm" onclick="createSampleGroup()">${icon('eye', 13, 1.8)} Explore a sample group first</button>`,
  });
}

/* ── Group page ────────────────────────────────────────────────── */
function pageGroupDetail(g) {
  const tab = GROUP_TABS.some(([k]) => k === state.groupTab) ? state.groupTab : 'overview';
  const count = groupPeople(g).length;
  const unread = tab !== 'chat' && groupHasUnread(g);
  const body = { overview: groupOverviewTab, schedule: groupScheduleTab, availability: groupAvailabilityTab, tasks: groupTasksTab, resources: groupResourcesTab, chat: groupChatTab }[tab];
  const color = groupColor(g);
  return `
    <div ${color ? `style="--sg:${esc(color)}" class="sg-tinted"` : ''}>
    <button class="btn btn-ghost btn-sm sg-back" onclick="closeGroup()">${icon('arrow-left', 14, 1.9)} All groups</button>
    <div class="sg-head">
      <div style="min-width:0">
        <div class="sg-eyebrow">${[g.courseLabel ? esc(g.courseLabel) : '', `${count} member${count === 1 ? '' : 's'}`, g.sample ? 'Sample group' : ''].filter(Boolean).join(' · ')}</div>
        <h2 class="sg-title">${esc(g.name)}</h2>
        ${g.description ? `<p class="small muted sg-desc">${esc(g.description)}</p>` : ''}
      </div>
      <div class="sg-head-actions">
        ${avatarStack(g, 5, 30)}
        ${signInHeaderButton()}
        <button class="btn btn-primary" onclick="openInviteModal('${g.code}')">${icon('user-plus', 14, 1.8)} Invite</button>
        <button class="btn btn-icon" aria-label="Group settings" title="Group settings" onclick="openGroupSettingsModal('${g.code}')">${icon('settings', 16, 1.6)}</button>
      </div>
    </div>
    ${groupLoadNotice(g)}
    <div class="sg-tabs" role="tablist">
      ${GROUP_TABS.map(([k, label]) => `<button role="tab" aria-selected="${tab === k}" class="${tab === k ? 'active' : ''}" onclick="setGroupTab('${k}')">${label}${k === 'chat' && unread ? '<span class="sg-tab-dot" aria-label="unread"></span>' : ''}</button>`).join('')}
    </div>
    <div class="sg-tab-body">${tab === 'overview' && groupIsBrandNew(g) ? groupFirstStepsHtml(g) : body(g)}</div>
    </div>
  `;
}
// A group with one person in it and nothing scheduled, assigned, shared, or
// said yet: the overview would be five cards each saying "nothing yet". The
// one thing that matters at that point is getting classmates in.
function groupIsBrandNew(g) {
  if (g.loading || g.legacyPending || g.sample) return false;
  return groupPeople(g).length <= 1 && !sessionList(g).length && !taskList(g).length && !groupMessages(g).length && !groupItems(g).length && !Object.values(g.avail || {}).some(availHasAny);
}
function groupFirstStepsHtml(g) {
  return emptyStateHtml({
    icon: 'user-plus',
    title: 'It’s just you so far',
    body: 'Invite classmates with the group code or a link, and once they join you can find a time that works for everyone.',
    actions: [{ label: 'Invite classmates', onclick: `openInviteModal('${g.code}')`, icon: 'user-plus' }, { label: 'Schedule a session', onclick: `openSessionModal('${g.code}')`, icon: 'calendar' }],
  });
}

function groupOverviewTab(g) {
  const u = myUidFor(g);
  const next = upcomingSessions(g)[0];
  const best = groupBestTimes(g)[0];
  const contributors = Object.values(g.avail || {}).filter(availHasAny).length;
  const mineAdded = availHasAny(g.avail?.[u]);
  const openTasks = taskList(g).filter(t => !t.done);
  const myTasks = openTasks.filter(t => t.assignee === u).sort(byDueThenCreated).slice(0, 4);
  const people = groupPeople(g);
  const knownNames = new Set(people.map(p => p.name));
  const legacyNames = (g.members || []).filter(n => n && !knownNames.has(n) && n !== myGroupName());
  const msgs = groupMessages(g).slice(-3);
  const activity = groupActivity(g).slice(0, 6);
  return `
    <div class="sg-overview">
      <div class="sg-col">
        ${next ? nextSessionHero(g, next) : `
          <div class="card card-pad sg-next-empty">
            <div class="sg-eyebrow">Next session</div>
            <div class="sg-next-title">Nothing scheduled yet</div>
            <p class="small muted mb-16">Pick a time from everyone’s availability, or just put one on the calendar.</p>
            <div class="flex-gap wrap"><button class="btn btn-primary btn-sm" onclick="openSessionModal('${g.code}')">+ Schedule a session</button><button class="btn btn-sm" onclick="setGroupTab('availability')">${icon('grid', 13, 1.8)} Find a time</button></div>
          </div>`}
        <div class="card card-pad">
          <div class="flex-between mb-8"><h3 class="sg-h3">Best time to meet</h3><button class="sg-link" onclick="setGroupTab('availability')">Open planner →</button></div>
          ${best && contributors >= 2 ? bestTimeRow(g, best) : `
            <p class="small muted mb-8">${contributors === 0 ? 'No one has added their weekly availability yet.' : contributors === 1 ? `${mineAdded ? 'You’re' : '1 person is'} the only one who’s added availability so far. Once someone else does, the best overlap shows up here.` : 'No overlapping free time yet. Try adding a few more open blocks.'}</p>
            ${!mineAdded ? `<button class="btn btn-sm" onclick="setGroupTab('availability')">Add my availability</button>` : ''}`}
        </div>
        <div class="card card-pad">
          <div class="flex-between mb-8"><h3 class="sg-h3">Your tasks</h3><button class="sg-link" onclick="setGroupTab('tasks')">${openTasks.length} open in group →</button></div>
          ${myTasks.length ? myTasks.map(t => groupTaskRow(g, t, { compact: true })).join('') : `<p class="small muted">Nothing assigned to you${openTasks.some(t => !t.assignee) ? ' yet. Up for grabs:' : '.'}</p>`}
          ${!myTasks.length && openTasks.some(t => !t.assignee) ? openTasks.filter(t => !t.assignee).sort(byDueThenCreated).slice(0, 3).map(t => `<div class="list-row sg-task compact"><div class="row-title"><div>${esc(t.title)}</div>${t.due ? `<div class="row-meta">Due ${fmtSessionDay(t.due)}</div>` : ''}</div><button class="btn btn-sm sg-claim" onclick="setGroupTaskAssignee('${g.code}','${t.id}','${esc(u)}')">${icon('user-plus', 12, 1.9)} I’ll take it</button></div>`).join('') : ''}
        </div>
      </div>
      <div class="sg-col">
        <div class="card card-pad">
          <div class="flex-between mb-8"><h3 class="sg-h3">Members</h3><button class="sg-link" onclick="openInviteModal('${g.code}')">${icon('user-plus', 13, 1.8)} Invite</button></div>
          ${people.map(p => `<div class="sg-person">${personAvatar(p.uid, p.name, 28, personColor(g, p.uid))}<div class="row-title">${esc(p.name)}${p.uid === u ? ' <span class="small muted">(you)</span>' : ''}</div>${p.role === 'owner' ? '<span class="small muted">Owner</span>' : ''}</div>`).join('')}
          ${legacyNames.length ? `<div class="small muted mt-8">From before the update: ${legacyNames.map(esc).join(', ')}. They’ll appear here once they open the group.</div>` : ''}
        </div>
        <div class="card card-pad">
          <div class="flex-between mb-8"><h3 class="sg-h3">Chat</h3><button class="sg-link" onclick="setGroupTab('chat')">Open chat →</button></div>
          ${msgs.length ? msgs.map(m => `<div class="sg-mini-msg">${personAvatar(m.uid, m.name, 22, personColor(g, m.uid))}<div class="small"><span class="sg-strong">${esc(m.uid === u ? 'You' : m.name)}</span> <span class="muted">${fmtRelativeTime(m.at)}</span><div class="sg-mini-text">${esc(m.text)}</div></div></div>`).join('') : `<p class="small muted">No messages yet. <button class="sg-link" onclick="setGroupTab('chat')">Say hi</button></p>`}
        </div>
        <div class="card card-pad">
          <h3 class="sg-h3 mb-8">Recent activity</h3>
          ${activity.length ? activity.map(a => `<div class="sg-activity"><span class="sg-activity-ic">${icon(a.icon, 13, 1.8)}</span><div class="small">${esc(a.text)} <span class="muted">· ${fmtRelativeTime(a.at)}</span></div></div>`).join('') : `<p class="small muted">Nothing yet.</p>`}
        </div>
      </div>
    </div>`;
}
function groupActivity(g) {
  const out = [];
  groupPeople(g).forEach(p => p.joinedAt && out.push({ at: p.joinedAt, icon: 'user-plus', text: `${p.name} ${p.role === 'owner' ? 'started the group' : 'joined'}` }));
  sessionList(g).forEach(s => s.createdAt && out.push({ at: s.createdAt, icon: 'calendar', text: `${s.createdByName || personName(g, s.createdBy)} scheduled “${s.title}”` }));
  taskList(g).forEach(t => t.done && t.doneAt && out.push({ at: t.doneAt, icon: 'check', text: `${t.doneBy ? personName(g, t.doneBy) : (t.doneByName || 'Someone')} finished “${t.title}”` }));
  groupItems(g).forEach(s => s.sharedAt && out.push({ at: s.sharedAt, icon: SHARE_KIND_ICON[s.kind] || 'file-text', text: `${s.sharedBy || 'Someone'} shared “${s.title}”` }));
  return out.sort((a, b) => b.at - a.at);
}

/* ── Sessions ──────────────────────────────────────────────────── */
function rsvpControl(g, s) {
  const mine = s.rsvp?.[myUidFor(g)] || '';
  const opt = (val, label) => `<button class="${mine === val ? 'active' : ''}" aria-pressed="${mine === val}" onclick="event.stopPropagation();setSessionRsvp('${g.code}','${s.id}','${val}')">${label}</button>`;
  return `<div class="segmented sg-rsvp" role="group" aria-label="RSVP">${opt('yes', 'Going')}${opt('maybe', 'Maybe')}${opt('no', 'Can’t')}</div>`;
}
async function setSessionRsvp(code, sid, val) {
  const g = findGroup(code);
  if (!g?.sessions?.[sid]) return;
  const u = myUidFor(g);
  const current = g.sessions[sid].rsvp?.[u];
  if (val === 'yes' && current !== 'yes' && typeof playUiSound === 'function') playUiSound('tap');
  const ok = await groupWrite(code, { [`sessions.${sid}.rsvp.${u}`]: current === val ? GW_DELETE : val });
  // Answering from inside the session's popup: refresh it so you land in the right list.
  const open = window._groupSessionModal;
  if (ok && open?.code === code && open.sid === sid && $('#modal .org-rsvp-group')) showGroupSessionModal(code, sid);
}
/* ── Session popup: the details, who's coming, and who hasn't said ──
   Session cards used to hide the RSVP names in a tooltip. This is the
   same shape as a club event's popup, so calendar blocks, dashboard rows
   and "coming up" lists all open the same thing. */
function showGroupSessionModal(code, sid) {
  const g = findGroup(code);
  const s = g?.sessions?.[sid];
  if (!g || !s || !safeId(sid)) return;
  const u = myUidFor(g);
  const past = sessionIsPast(s);
  const people = groupPeople(g);
  const answer = (p) => s.rsvp?.[p.uid] || '';
  const same = window._groupSessionModal?.code === code && window._groupSessionModal.sid === sid;
  const openGroups = same ? $$('#modal .org-rsvp-group').map(d => d.open) : null;
  window._groupSessionModal = { code, sid };
  const person = (p) => `<div class="sg-person">${personAvatar(p.uid, p.name, 24, personColor(g, p.uid))}<div class="row-title small">${esc(p.name)}${p.uid === u ? ' <span class="muted">(you)</span>' : ''}</div></div>`;
  const group = (label, list, open) => `
    <details class="org-rsvp-group" ${open ? 'open' : ''}>
      <summary><span class="sg-strong">${label}</span><span class="assign-count">${list.length}</span></summary>
      ${list.length ? `<div class="org-rsvp-list">${list.map(person).join('')}</div>` : '<div class="small muted org-rsvp-empty">No one yet.</div>'}
    </details>`;
  const going = people.filter(p => answer(p) === 'yes'), maybe = people.filter(p => answer(p) === 'maybe'), cant = people.filter(p => answer(p) === 'no'), none = people.filter(p => !answer(p));
  const later = s.seriesId ? sessionList(g).filter(x => x.seriesId === s.seriesId && x.date > s.date).length : 0;
  openModal(`
    <div class="modal-head"><h3>${esc(s.title)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="sg-eyebrow">${esc(g.name)}${s.seriesId ? ` · Weekly${later ? `, ${later} more after this` : ''}` : ''}${past ? ' · Past' : ''}</div>
      <div class="small sg-meta-line mt-8">
        <span>${icon('calendar', 12, 1.8)} ${esc(fmtDateLong(s.date))}</span>
        ${s.start ? `<span>${icon('clock', 12, 1.8)} ${fmtTime(s.start)}${s.end ? `–${fmtTime(s.end)}` : ''}</span>` : ''}
        ${s.where ? `<span>${icon('map-pin', 12, 1.8)} ${linkifyWhere(s.where)}</span>` : ''}
      </div>
      ${s.notes ? `<div class="small sg-notes mt-8">${linkifyText(s.notes)}</div>` : ''}
      ${!past ? `<div class="flex-gap wrap mt-16" style="align-items:center">${rsvpControl(g, s)}${joinLinkButton(s.where)}<button class="btn btn-ghost btn-sm" onclick="downloadSessionIcs('${g.code}','${s.id}')">${icon('download', 13, 1.8)} Add to calendar app</button></div>` : ''}
      <div class="divider"></div>
      ${group(past ? 'Said they’d go' : 'Going', going, true)}
      ${group('Maybe', maybe, maybe.length > 0)}
      ${group('Can’t make it', cant, cant.length > 0 && cant.length <= 8)}
      ${group('Haven’t answered', none, false)}
      ${none.length && !past && !g.local ? `<button class="btn btn-sm mt-8" onclick="copyRsvpNudge('${g.code}','${s.id}')">${icon('copy', 13, 1.8)} Copy a reminder for them</button>` : ''}
    </div>
    <div class="modal-foot">
      <button class="btn btn-danger" style="margin-right:auto" onclick="deleteSession('${g.code}','${s.id}')">Delete</button>
      <button class="btn" onclick="openSessionModal('${g.code}','${s.id}')">Edit</button>
      <button class="btn btn-primary" onclick="closeModal()">Done</button>
    </div>
  `, { onClose: () => { window._groupSessionModal = null; } });
  if (openGroups) $$('#modal .org-rsvp-group').forEach((d, i) => { if (openGroups[i] != null) d.open = openGroups[i]; });
}
function copyRsvpNudge(code, sid) {
  const g = findGroup(code);
  const s = g?.sessions?.[sid];
  if (!s) return;
  copyText(`Can everyone RSVP for “${s.title}” (${fmtSessionWhen(s)}) in Semester HQ? Open “${g.name}” → Sessions and tap Going, Maybe, or Can’t. ${groupInviteLink(code)}`, 'Reminder copied. Paste it in your group chat.');
}
function nextSessionHero(g, s) {
  const c = rsvpCounts(s);
  const going = Object.entries(s.rsvp || {}).filter(([, v]) => v === 'yes').map(([id]) => id);
  const d = new Date(s.date + 'T00:00:00');
  return `
    <div class="card sg-next">
      <div class="sg-next-date"><span>${d.toLocaleDateString('en-US', { weekday: 'short' })}</span><strong>${d.getDate()}</strong><span>${d.toLocaleDateString('en-US', { month: 'short' })}</span></div>
      <div class="sg-next-body">
        <div class="sg-eyebrow">Next session · ${fmtSessionDay(s.date)}${s.seriesId ? ' · Weekly' : ''}</div>
        <button class="sg-next-title sg-title-btn" onclick="showGroupSessionModal('${g.code}','${s.id}')">${esc(s.title)}</button>
        <div class="small muted sg-meta-line">
          ${s.start ? `<span>${icon('clock', 12, 1.8)} ${fmtTime(s.start)}${s.end ? '–' + fmtTime(s.end) : ''}</span>` : ''}
          ${s.where ? `<span>${icon('map-pin', 12, 1.8)} ${linkifyWhere(s.where)}</span>` : ''}
        </div>
        ${s.notes ? `<div class="small sg-notes">${linkifyText(s.notes)}</div>` : ''}
        <div class="sg-next-foot">
          ${rsvpControl(g, s)}
          ${joinLinkButton(s.where)}
          <button class="sg-link sg-going" onclick="showGroupSessionModal('${g.code}','${s.id}')" aria-label="See who’s going to ${esc(s.title)}">${going.length ? `${avatarStack(g, 4, 22, going)} ${c.yes} going` : 'No RSVPs yet'}${c.maybe ? ` · ${c.maybe} maybe` : ''} · See who</button>
          <button class="btn btn-ghost btn-sm sg-ics" onclick="downloadSessionIcs('${g.code}','${s.id}')">${icon('download', 13, 1.8)} Add to calendar app</button>
        </div>
      </div>
    </div>`;
}
function groupScheduleTab(g) {
  const upcoming = upcomingSessions(g);
  const past = sessionList(g).filter(sessionIsPast).reverse();
  return `
    <div class="sg-toolbar">
      <div class="small muted">Sessions show up on every member’s Semester HQ calendar.</div>
      <div class="flex-gap wrap">${upcoming.length > 1 ? `<button class="btn btn-sm" onclick="downloadSessionIcs('${g.code}')">${icon('download', 13, 1.8)} Add all to calendar app</button>` : ''}<button class="btn btn-sm" onclick="setGroupTab('availability')">${icon('grid', 13, 1.8)} Find a time</button><button class="btn btn-primary btn-sm" onclick="openSessionModal('${g.code}')">+ New session</button></div>
    </div>
    ${upcoming.length ? upcoming.map(s => sessionCard(g, s)).join('') : emptyState(icon('calendar', 24, 1.4), 'No upcoming sessions', `<button class="btn btn-primary btn-sm mt-8" onclick="openSessionModal('${g.code}')">Schedule one</button>`, 'Not sure when? Find a time shows when everyone is free.')}
    ${past.length ? `<details class="sg-past"><summary class="small muted">Past sessions (${past.length})</summary>${past.slice(0, 30).map(s => sessionCard(g, s, { past: true })).join('')}</details>` : ''}
  `;
}
function sessionCard(g, s, { past = false } = {}) {
  const c = rsvpCounts(s);
  const names = (v) => Object.entries(s.rsvp || {}).filter(([, x]) => x === v).map(([id]) => personName(g, id));
  const who = [...names('yes').map(n => `${n} (going)`), ...names('maybe').map(n => `${n} (maybe)`), ...names('no').map(n => `${n} (can’t)`)].join(', ');
  return `
    <div class="card sg-session ${past ? 'past' : ''}" onclick="showGroupSessionModal('${g.code}','${s.id}')">
      ${dateTile(s.date)}
      <div class="sg-session-body">
        <div class="sg-session-top">
          <div style="min-width:0">
            <div class="sg-strong">${esc(s.title)}${s.seriesId ? ' <span class="sg-series-tag">Weekly</span>' : ''}</div>
            <div class="small muted sg-meta-line"><span>${fmtSessionWhen(s)}</span>${s.where ? `<span>${icon('map-pin', 12, 1.8)} ${linkifyWhere(s.where)}</span>` : ''}</div>
          </div>
          <div class="sg-session-actions">
            ${!past ? `<button class="btn btn-ghost btn-icon btn-sm" title="Add to your calendar app (.ics)" aria-label="Download ${esc(s.title)} as a calendar file" onclick="event.stopPropagation();downloadSessionIcs('${g.code}','${s.id}')">${icon('download', 14)}</button>` : ''}
            <button class="btn btn-ghost btn-icon btn-sm" aria-label="Edit ${esc(s.title)}" onclick="event.stopPropagation();openSessionModal('${g.code}','${s.id}')">${icon('pencil', 14)}</button>
          </div>
        </div>
        ${s.notes ? `<div class="small sg-notes">${linkifyText(s.notes)}</div>` : ''}
        <div class="sg-session-foot">
          ${!past ? rsvpControl(g, s) : ''}
          ${!past ? joinLinkButton(s.where) : ''}
          <span class="small muted" title="${esc(who)}">${c.yes} going${c.maybe ? ` · ${c.maybe} maybe` : ''}${c.no ? ` · ${c.no} can’t` : ''}</span>
        </div>
      </div>
    </div>`;
}
function openSessionModal(code, sid, prefill = {}) {
  const g = findGroup(code);
  if (!g) return;
  const s = sid ? g.sessions[sid] : null;
  const later = s?.seriesId ? sessionList(g).filter(x => x.seriesId === s.seriesId && x.date > s.date).length : 0;
  const v = {
    title: s?.title ?? prefill.title ?? '', date: s?.date ?? prefill.date ?? todayIso(),
    start: s?.start ?? prefill.start ?? '17:00', end: s?.end ?? prefill.end ?? '18:30',
    where: s?.where ?? '', notes: s?.notes ?? '',
  };
  openModal(`
    <div class="modal-head"><h3>${s ? 'Edit session' : 'New study session'}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label for="ss-title">What are you working on?</label><input class="input" id="ss-title" value="${esc(v.title)}" maxlength="120" placeholder="Midterm review, problem set 4…"></div>
      <div class="field-row">
        <div class="field"><label for="ss-date">Date</label><input class="input" type="date" id="ss-date" value="${esc(v.date)}"></div>
        <div class="field"><label for="ss-start">Start</label><input class="input" type="time" id="ss-start" value="${esc(v.start)}"></div>
        <div class="field"><label for="ss-end">End</label><input class="input" type="time" id="ss-end" value="${esc(v.end)}"></div>
      </div>
      <div class="field"><label for="ss-where">Where</label><input class="input" id="ss-where" value="${esc(v.where)}" maxlength="300" placeholder="Library room 204, or paste a Zoom / Meet link"></div>
      <div class="field"><label for="ss-notes">Agenda or notes <span class="muted">(optional)</span></label><textarea class="input" id="ss-notes" maxlength="1000" placeholder="Bring your chapter 5 problems…">${esc(v.notes)}</textarea></div>
      ${!s ? `<div class="field-row" style="align-items:center"><label class="checkbox-row small" style="margin:0"><input type="checkbox" id="ss-repeat" onchange="$('#ss-weeks').disabled=!this.checked"><span>Repeat weekly for</span></label><select class="select" id="ss-weeks" style="max-width:110px" disabled aria-label="How many weeks">${SESSION_REPEAT_WEEKS.map(n => `<option value="${n}" ${n === 6 ? 'selected' : ''}>${n} weeks</option>`).join('')}</select></div>` : ''}
      ${s && later > 0 ? `<label class="checkbox-row small"><input type="checkbox" id="ss-series"><span>Also update the ${later} later session${later === 1 ? '' : 's'} in this weekly series (they keep their dates)</span></label>` : ''}
      ${!s ? `<p class="small muted mt-8">Everyone in ${esc(g.name)} will see this on their calendar and can RSVP.</p>` : ''}
    </div>
    <div class="modal-foot">
      ${s ? `<button class="btn btn-danger" style="margin-right:auto" onclick="deleteSession('${code}','${sid}')">Delete</button>` : ''}
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveSession('${code}','${sid || ''}')">${s ? 'Save' : 'Schedule'}</button>
    </div>
  `);
  setTimeout(() => { const el = $('#ss-title'); if (el && !el.value) el.focus(); }, 60);
}
async function saveSession(code, sid) {
  const title = $('#ss-title').value.trim();
  const date = $('#ss-date').value;
  const start = $('#ss-start').value, end = $('#ss-end').value;
  if (!title) { toast('Give the session a title', 'error'); return; }
  if (!date) { toast('Pick a date', 'error'); return; }
  if (start && end && end <= start) { toast('The end time needs to be after the start time', 'error'); return; }
  const g = findGroup(code);
  const u = myUidFor(g);
  const fields = { title, date, start, end: start ? end : '', where: $('#ss-where').value.trim(), notes: $('#ss-notes').value.trim() };
  const applySeries = !!$('#ss-series')?.checked;
  closeModal();
  if (sid) {
    const ops = Object.fromEntries(Object.entries(fields).map(([k, val]) => [`sessions.${sid}.${k}`, val]));
    const cur = g.sessions[sid];
    // The rest of a weekly series moves with this one (new time, new room,
    // new agenda), but each later session keeps its own date.
    const later = applySeries && cur?.seriesId ? sessionList(g).filter(x => x.seriesId === cur.seriesId && x.date > cur.date) : [];
    later.forEach(x => Object.entries(fields).forEach(([k, val]) => { if (k !== 'date') ops[`sessions.${x.id}.${k}`] = val; }));
    if (await groupWrite(code, ops)) toast(later.length ? `Updated this and ${later.length} later session${later.length === 1 ? '' : 's'}` : 'Session updated');
  } else {
    const weeks = $('#ss-repeat')?.checked ? Number($('#ss-weeks')?.value) || 1 : 1;
    const seriesId = weeks > 1 ? uid() : null;
    const ops = {};
    for (let i = 0; i < weeks; i++) {
      const id = uid();
      ops[`sessions.${id}`] = { id, ...fields, date: addDays(date, i * 7), seriesId, createdBy: u, createdByName: myGroupName(), createdAt: Date.now(), rsvp: { [u]: 'yes' } };
    }
    if (await groupWrite(code, ops)) toast(weeks > 1 ? `Scheduled ${weeks} weekly sessions. They’re on everyone’s calendar now.` : 'Scheduled. It’s on everyone’s calendar now.');
  }
}
function deleteSession(code, sid) {
  const g = findGroup(code);
  const s = g?.sessions?.[sid];
  if (!s) return;
  const series = s.seriesId ? sessionList(g).filter(x => x.seriesId === s.seriesId && x.date >= s.date) : [];
  if (series.length <= 1) { confirmDialog('Delete this session for everyone in the group?', () => removeGroupSessions(code, [sid])); return; }
  openModal(`
    <div class="modal-body" style="padding-top:22px"><p style="font-size:14px">Delete “${esc(s.title)}” on ${esc(fmtDate(s.date))}? It comes off everyone’s calendar.</p></div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="removeGroupSessions('${code}',${JSON.stringify(series.map(x => x.id)).replace(/"/g, '&quot;')})">This and ${series.length - 1} after</button>
      <button class="btn btn-danger" onclick="removeGroupSessions('${code}',['${sid}'])">Just this one</button>
    </div>
  `);
}
async function removeGroupSessions(code, ids) {
  const ops = {};
  ids.filter(safeId).forEach(id => { ops[`sessions.${id}`] = GW_DELETE; });
  closeModal();
  if (await groupWrite(code, ops)) toast(ids.length > 1 ? `Deleted ${ids.length} sessions` : 'Session deleted');
}
function downloadSessionIcs(code, sid) {
  const g = findGroup(code);
  if (!g) return;
  const list = sid ? [g.sessions?.[sid]].filter(Boolean) : upcomingSessions(g);
  if (!list.length) return;
  const dt = (date, t) => date.replace(/-/g, '') + (t ? 'T' + t.replace(':', '') + '00' : '');
  const icsText = (v) => String(v || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Semester HQ//Study Groups//EN'];
  list.forEach(s => lines.push(
    'BEGIN:VEVENT',
    `UID:${s.id}-${code}@semester-hq.com`,
    `DTSTAMP:${stamp}`,
    s.start ? `DTSTART:${dt(s.date, s.start)}` : `DTSTART;VALUE=DATE:${dt(s.date)}`,
    s.start ? `DTEND:${dt(s.date, s.end || addMinutesHHMM(s.start, 60))}` : `DTEND;VALUE=DATE:${dt(addDays(s.date, 1))}`,
    `SUMMARY:${icsText(`${s.title} (${g.name})`)}`,
    ...(s.where ? [`LOCATION:${icsText(s.where)}`] : []),
    ...(s.notes ? [`DESCRIPTION:${icsText(s.notes)}`] : []),
    'END:VEVENT',
  ));
  lines.push('END:VCALENDAR');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  a.download = `${(sid ? list[0].title : g.name).replace(/[^\w\- ]+/g, '').trim() || 'study-sessions'}.ics`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
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
    <div class="sg-toolbar">
      <div class="small muted">Click and drag to mark when you’re usually free each week. Everyone has their own color, so the group grid shows exactly who’s free when.</div>
    </div>
    <div class="sg-avail-wrap">
      <div class="card card-pad" style="--me-color:${personColor(g, u)}">
        <div class="flex-between mb-8"><h3 class="sg-h3">Your weekly availability</h3>${mineAdded ? `<button class="btn btn-ghost btn-sm" onclick="clearMyAvailability('${g.code}')">Clear</button>` : '<span class="small muted">Drag to paint</span>'}</div>
        <div class="sg-mycolor"><span class="small muted">Your color</span>${colorSwatches(g, 'setMyGroupColor')}</div>
        ${scheduleBusyRanges().length ? `<div class="sg-auto-avail ${mineAdded ? '' : 'is-empty'}"><span class="small muted">${mineAdded ? 'Or start over:' : 'Skip the painting:'}</span><button class="btn btn-sm" onclick="fillAvailabilityFromSchedule('${g.code}')">${icon('sparkles', 13, 1.8)} ${mineAdded ? 'Redraft from my class schedule' : 'Start from my class schedule'}</button><span class="small muted">Free ${fmtTime(AVAIL_AUTO_START)}–${fmtTime(AVAIL_AUTO_END)}, minus your classes.</span></div>` : ''}
        ${availGrid(g, days, 'mine')}
      </div>
      <div class="card card-pad">
        <div class="flex-between mb-8">
          <h3 class="sg-h3">Group availability</h3>
          ${contributors.length <= 8 ? `<div class="segmented sg-view-toggle"><button class="${view === 'people' ? 'active' : ''}" onclick="window._availView='people';render()">People</button><button class="${view === 'heat' ? 'active' : ''}" onclick="window._availView='heat';render()">Heatmap</button></div>` : `<span class="small muted">${contributors.length} of ${people.length} added</span>`}
        </div>
        ${view === 'people' ? `
          <div class="sg-legend-people" role="group" aria-label="Highlight one person">
            ${contributors.length ? contributors.map(([id]) => `<button class="sg-legend-person ${focus === id ? 'active' : ''} ${focus && focus !== id ? 'dim' : ''}" style="--p:${personColor(g, id)}" aria-pressed="${focus === id}" onclick="window._availFocus=${focus === id ? 'null' : `'${id}'`};render()"><span class="sg-legend-dot"></span>${esc(id === u ? 'You' : personName(g, id))}</button>`).join('') : '<span class="small muted">No one has added availability yet.</span>'}
          </div>` : ''}
        ${availGrid(g, days, view, focus)}
        ${view === 'heat' ? `<div class="sg-legend small muted"><span>Fewer free</span><span class="sg-legend-bar"></span><span>Everyone</span></div>` : `<div class="small muted mt-8">${focus ? `Showing only ${esc(focus === u ? 'you' : personName(g, focus))}. Click again to show everyone.` : 'Click a name to highlight just that person.'}</div>`}
      </div>
    </div>
    <div class="grid grid-2 mt-16" style="align-items:start">
      <div class="card card-pad">
        <h3 class="sg-h3 mb-8">Best times to meet</h3>
        ${best.length && contributors.length >= 2 ? best.map(w => bestTimeRow(g, w)).join('') : `<p class="small muted">${contributors.length >= 2 ? 'No overlap yet. Try adding a few more open blocks.' : 'Suggestions show up once at least two people have added availability.'}</p>`}
      </div>
      <div class="card card-pad">
        <h3 class="sg-h3 mb-8">Who’s added theirs</h3>
        ${people.map(p => `<div class="sg-person">${personAvatar(p.uid, p.name, 24, personColor(g, p.uid))}<div class="row-title small">${esc(p.name)}${p.uid === u ? ' <span class="muted">(you)</span>' : ''}</div>${availHasAny(g.avail?.[p.uid]) ? `<span class="small">${icon('check', 13, 2.2)} Added</span>` : '<span class="small muted">Not yet</span>'}</div>`).join('')}
        ${missing.length && !g.local ? `<button class="btn btn-sm mt-8" onclick="copyAvailabilityNudge('${g.code}')">${icon('copy', 13, 1.8)} Copy a reminder for the group</button>` : ''}
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
        return `<div class="sg-cell ${hourRow ? 'hr' : ''} ${availDay(mine, d)[i] === '1' ? 'on' : ''}" data-day="${d}" data-col="${days.indexOf(d)}" data-slot="${i}"></div>`;
      }
      const free = contributors.filter(([, a]) => availDay(a, d)[i] === '1').map(([id]) => id);
      const everyone = contributors.length >= 2 && free.length === contributors.length;
      const label = `${AVAIL_DAYS_LONG[d]} ${fmtTime(slotTime(i))}: ${free.length ? free.map(id => personName(g, id)).join(', ') : 'nobody'} free`;
      if (mode === 'people') {
        // One thin stripe per person, in the same order in every cell, so each
        // person's free time lines up into a colored column you can follow.
        const stripes = contributors.map(([id]) => {
          const on = free.includes(id) && (!focus || focus === id);
          return `<i style="${on ? `background:${personColor(g, id)}` : ''}"></i>`;
        }).join('');
        return `<div class="sg-cell sg-cell-people ${hourRow ? 'hr' : ''} ${everyone && !focus ? 'all' : ''}" title="${esc(label)}">${stripes}</div>`;
      }
      const pct = contributors.length ? Math.round((free.length / contributors.length) * 100) : 0;
      return `<div class="sg-cell ${hourRow ? 'hr' : ''} ${everyone ? 'all' : ''}" style="--heat:${pct}%" title="${esc(label)}"></div>`;
    }).join(''));
  }
  const attrs = mode === 'mine' ? `id="sg-avail-mine" data-code="${g.code}" aria-label="Your weekly availability. Click and drag to mark free time."` : `aria-label="Group availability, ${mode === 'people' ? 'one color per person' : 'heatmap'}"`;
  return `<div class="sg-grid-scroll"><div class="sg-grid ${mode === 'mine' ? 'sg-grid-mine' : mode === 'people' ? 'sg-grid-people' : 'sg-grid-heat'}" ${attrs} style="--sg-cols:${days.length}">${rows.join('')}</div></div>`;
}
let _availPaint = null;
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

/* ── Tasks ─────────────────────────────────────────────────────── */
function groupTasksTab(g) {
  const u = myUidFor(g);
  const filter = ['all', 'mine', 'unassigned'].includes(state.groupTaskFilter) ? state.groupTaskFilter : 'all';
  const all = taskList(g);
  const match = t => filter === 'mine' ? t.assignee === u : filter === 'unassigned' ? !t.assignee : true;
  const open = all.filter(t => !t.done && match(t)).sort(byDueThenCreated);
  const done = all.filter(t => t.done && match(t)).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const doneCount = all.filter(t => t.done).length;
  const pct = all.length ? Math.round((doneCount / all.length) * 100) : 0;
  const people = groupPeople(g);
  return `
    <div class="card card-pad mb-16">
      <div class="sg-task-add">
        <input class="input" id="sg-task-title" maxlength="200" placeholder="Add a task, like “outline the intro” or “make a practice quiz”" onkeydown="if(event.key==='Enter')addGroupTask('${g.code}')">
        <input class="input" type="date" id="sg-task-due" aria-label="Due date (optional)" title="Due date (optional)">
        <select class="select" id="sg-task-assignee" aria-label="Assign to"><option value="">Unassigned</option>${people.map(p => `<option value="${esc(p.uid)}">${esc(p.name)}${p.uid === u ? ' (you)' : ''}</option>`).join('')}</select>
        <button class="btn btn-primary" onclick="addGroupTask('${g.code}')">Add</button>
      </div>
    </div>
    <div class="sg-toolbar">
      <div class="segmented">${[['all', 'All'], ['mine', 'Mine'], ['unassigned', 'Unassigned']].map(([k, l]) => `<button class="${filter === k ? 'active' : ''}" onclick="setState({groupTaskFilter:'${k}'})">${l}</button>`).join('')}</div>
      ${all.length ? `<div class="sg-task-progress"><span class="small muted">${doneCount} of ${all.length} done</span><div class="progress"><div style="width:${pct}%"></div></div></div>` : ''}
    </div>
    ${open.length ? open.map(t => groupTaskRow(g, t)).join('') : emptyState(icon('check-square', 24, 1.4), filter === 'mine' ? 'Nothing assigned to you' : filter === 'unassigned' ? 'Every task has an owner' : 'No open tasks', '', filter === 'all' ? 'Break the work into pieces and give each one an owner.' : '')}
    ${done.length ? `<details class="sg-past"><summary class="small muted">Completed (${done.length})</summary>${done.map(t => groupTaskRow(g, t)).join('')}</details>` : ''}
  `;
}
function groupTaskRow(g, t, { compact = false } = {}) {
  const u = myUidFor(g);
  const overdue = !t.done && t.due && t.due < todayIso();
  const meta = [
    t.due ? `<span class="${overdue ? 'sg-overdue' : ''}">${overdue ? 'Overdue, was due' : 'Due'} ${fmtSessionDay(t.due)}</span>` : '',
    t.done ? `Done by ${esc(t.doneBy ? personName(g, t.doneBy) : (t.doneByName || 'someone'))}` : '',
    compact || t.assignee || !t.assigneeName ? '' : `Was assigned to ${esc(t.assigneeName)}`,
  ].filter(Boolean).join(' · ');
  return `
    <div class="list-row sg-task ${compact ? 'compact' : ''}">
      <button type="button" class="row-check ${t.done ? 'checked' : ''}" role="checkbox" aria-checked="${!!t.done}" aria-label="Mark ${esc(t.title)} as ${t.done ? 'not done' : 'done'}" onclick="toggleGroupTask('${g.code}','${t.id}')">${t.done ? checkGlyph(true) : ''}</button>
      <div class="row-title">
        <div class="${t.done ? 'sg-done' : ''}">${esc(t.title)}${t.label ? ` <span class="tag sg-tag">${esc(t.label)}</span>` : ''}</div>
        ${meta ? `<div class="row-meta">${meta}</div>` : ''}
      </div>
      ${compact ? '' : `
        ${!t.done && !t.assignee ? `<button class="btn btn-sm sg-claim" onclick="setGroupTaskAssignee('${g.code}','${t.id}','${esc(u)}')">${icon('user-plus', 12, 1.9)} I’ll take it</button>` : ''}
        <select class="select sg-assignee" aria-label="Assign ${esc(t.title)}" onchange="setGroupTaskAssignee('${g.code}','${t.id}',this.value)">
          <option value="">Unassigned</option>${groupPeople(g).map(p => `<option value="${esc(p.uid)}" ${p.uid === t.assignee ? 'selected' : ''}>${esc(p.name)}${p.uid === u ? ' (you)' : ''}</option>`).join('')}
        </select>
        <button class="btn btn-ghost btn-icon btn-sm" aria-label="Delete ${esc(t.title)}" onclick="deleteGroupTask('${g.code}','${t.id}')">${icon('trash', 14)}</button>`}
    </div>`;
}
function addGroupTask(code) {
  const titleEl = $('#sg-task-title');
  const title = titleEl?.value.trim();
  if (!title) { titleEl?.focus(); return; }
  const due = $('#sg-task-due').value || null;
  const assignee = $('#sg-task-assignee').value || null;
  titleEl.value = ''; $('#sg-task-due').value = '';
  const g = findGroup(code);
  const id = uid();
  groupWrite(code, { [`taskItems.${id}`]: { id, title, label: '', due, assignee, done: false, doneBy: null, doneAt: null, createdBy: myUidFor(g), createdAt: Date.now() } });
  setTimeout(() => $('#sg-task-title')?.focus(), 40);
}
function toggleGroupTask(code, id) {
  const g = findGroup(code);
  const t = g?.taskItems?.[id];
  if (!t) return;
  const done = !t.done;
  groupWrite(code, { [`taskItems.${id}.done`]: done, [`taskItems.${id}.doneBy`]: done ? myUidFor(g) : null, [`taskItems.${id}.doneAt`]: done ? Date.now() : null });
}
async function setGroupTaskAssignee(code, id, assignee) {
  const g = findGroup(code);
  const claimed = assignee && assignee === myUidFor(g) && g?.taskItems?.[id] && !g.taskItems[id].assignee;
  if (await groupWrite(code, { [`taskItems.${id}.assignee`]: assignee || null, [`taskItems.${id}.assigneeName`]: '' }) && claimed) toast(`“${g.taskItems[id].title}” is yours`);
}
function deleteGroupTask(code, id) { groupWrite(code, { [`taskItems.${id}`]: GW_DELETE }); }

/* ── Resources ─────────────────────────────────────────────────── */
function groupResourcesTab(g) {
  const items = groupItems(g);
  return `
    <div class="sg-toolbar">
      <div class="small muted">Share notes, flashcards, files, and links. Anyone in the group can add their own copy.</div>
      <button class="btn btn-primary btn-sm" onclick="openShareResourceModal('${g.code}')">+ Share something</button>
    </div>
    ${items.length ? items.map(s => groupResourceRow(g, s)).join('') : emptyState(icon('layers', 24, 1.4), 'Nothing shared yet', `<button class="btn btn-sm mt-8" onclick="openShareResourceModal('${g.code}')">Share the first resource</button>`, 'You can also share straight from any note, notebook, flashcard deck, or project.')}
  `;
}
function resourceUrl(g, s) {
  const url = s.url || s.dataUrl || '';
  if (isHttpUrl(url)) return url;
  return g.local && String(url).startsWith('data:') ? url : '';
}
function groupResourceRow(g, s) {
  const u = myUidFor(g);
  const canRemove = !s.sharedByUid || s.sharedByUid === u || g.createdBy === u;
  const meta = { deck: `${(s.cards || []).length} cards`, 'note-bundle': `${(s.notes || []).length} notes`, project: `${(s.milestones || []).length} milestones`, file: fmtFileSize(s.size), link: hostOf(s.url) }[s.kind] || '';
  const url = resourceUrl(g, s);
  const action = s.kind === 'file' ? (url ? `<a class="btn btn-sm" href="${esc(url)}" target="_blank" rel="noopener" download="${esc(s.fileName || s.title)}">${icon('download', 13)} Open</a>` : '')
    : s.kind === 'link' ? (url ? `<a class="btn btn-sm" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('link', 13)} Open</a>` : '')
    : `<button class="btn btn-sm" onclick="importGroupResource('${g.code}','${s.id}')">${icon('plus', 13)} Add to mine</button>`;
  const kindLabel = s.kind === 'file' ? fileTypeLabel(s.fileName || s.title) : SHARE_KIND_LABEL[s.kind] || 'Item';
  return `
    <div class="list-row sg-resource">
      <span class="sg-res-ic">${icon(SHARE_KIND_ICON[s.kind] || 'file-text', 16)}</span>
      <div class="row-title"><div class="sg-strong">${esc(s.title)}</div><div class="row-meta">${[esc(kindLabel), esc(meta), esc(s.sharedBy || 'Someone'), fmtRelativeTime(s.sharedAt)].filter(Boolean).join(' · ')}</div></div>
      ${action}
      ${canRemove ? `<button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove ${esc(s.title)}" onclick="removeGroupResource('${g.code}','${s.id}')">${icon('trash', 14)}</button>` : ''}
    </div>`;
}
function openShareResourceModal(code) {
  const g = findGroup(code);
  if (!g) return;
  window._shareResource = { code, file: null };
  openModal(`
    <div class="modal-head"><h3>Share with ${esc(g.name)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label for="sr-kind">What are you sharing?</label>
        <select class="select" id="sr-kind" onchange="renderShareResourceFields()">
          <option value="note-bundle">A notebook (folder of notes)</option>
          <option value="note">A single note</option>
          <option value="deck">A flashcard deck</option>
          <option value="project">A project</option>
          <option value="file">A file (PDF, doc, image…)</option>
          <option value="link">A link</option>
        </select>
      </div>
      <div id="sr-fields"></div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="sr-share-btn" onclick="confirmShareResource()">Share</button></div>
  `);
  renderShareResourceFields();
}
function renderShareResourceFields() {
  const kind = $('#sr-kind').value;
  const field = $('#sr-fields');
  const g = findGroup(window._shareResource.code);
  window._shareResource.file = null;
  if (kind === 'file') {
    const max = g.local ? GROUP_FILE_MAX_BYTES_LOCAL : GROUP_FILE_MAX_BYTES_CLOUD;
    field.innerHTML = `<div class="field"><label>File</label>
      <div class="upload-drop" onclick="$('#sr-file-input').click()">
        <div class="small" id="sr-file-status">Click to choose a file (up to ${fmtFileSize(max)})</div>
        <input type="file" id="sr-file-input" style="display:none" onchange="handleShareResourceFile(this.files[0])">
      </div></div>`;
    return;
  }
  if (kind === 'link') {
    field.innerHTML = `
      <div class="field"><label for="sr-link-url">Link</label><input class="input" id="sr-link-url" type="url" placeholder="https://…"></div>
      <div class="field"><label for="sr-link-title">Title</label><input class="input" id="sr-link-title" maxlength="120" placeholder="Practice exam, shared Drive folder…"></div>`;
    return;
  }
  const items = kind === 'note-bundle' ? foldersWithNotes() : kind === 'note' ? state.notes.filter(n => n.type === 'note') : kind === 'deck' ? state.decks : state.projects;
  const label = { 'note-bundle': 'notebooks with notes in them', note: 'notes', deck: 'flashcard decks', project: 'projects' }[kind];
  field.innerHTML = items.length
    ? `<div class="field"><label for="sr-item">Choose one</label><select class="select" id="sr-item">${items.map(it => `<option value="${it.id}">${esc(it.name || it.title || 'Untitled')}</option>`).join('')}</select></div>
       <p class="small muted">Members get a copy they can add to their own planner. Later edits to yours won’t change theirs.</p>`
    : `<p class="small muted">You don’t have any ${label} yet.</p>`;
}
async function handleShareResourceFile(file) {
  if (!file) return;
  const g = findGroup(window._shareResource.code);
  const max = g.local ? GROUP_FILE_MAX_BYTES_LOCAL : GROUP_FILE_MAX_BYTES_CLOUD;
  const status = $('#sr-file-status');
  if (file.size > max) { status.textContent = `That file is ${fmtFileSize(file.size)}. The limit is ${fmtFileSize(max)}.`; window._shareResource.file = null; return; }
  status.textContent = 'Reading…';
  const dataUrl = 'data:' + mimeForFile(file.name, file.type) + ';base64,' + (await fileToBase64(file));
  window._shareResource.file = { name: file.name, size: file.size, dataUrl };
  status.textContent = `${file.name} (${fmtFileSize(file.size)}) is ready to share`;
}
function buildSharePayload(kind, itemId) {
  if (kind === 'note-bundle') {
    const folder = state.notes.find(x => x.id === itemId);
    const notes = state.notes.filter(n => n.type === 'note' && n.parentId === itemId);
    return { title: folder?.name || 'Notebook', notes: notes.map(n => ({ name: n.name, content: n.content || '' })) };
  }
  if (kind === 'note') { const n = state.notes.find(x => x.id === itemId); return { title: n?.name || 'Note', content: n?.content || '' }; }
  if (kind === 'deck') { const d = state.decks.find(x => x.id === itemId); return { title: d?.name || 'Flashcards', cards: (d?.cards || []).map(c => ({ front: c.front, back: c.back })) }; }
  const p = state.projects.find(x => x.id === itemId);
  return { title: p?.title || 'Project', dueDate: p?.dueDate || '', milestones: JSON.parse(JSON.stringify(p?.milestones || [])) };
}
async function confirmShareResource() {
  const st = window._shareResource;
  const { code, file } = st;
  // The duplicate question below replaces this modal, so the picked kind is
  // stashed and read back from there once the form is gone.
  if ($('#sr-kind')) st.kind = $('#sr-kind').value;
  const kind = st.kind;
  let item;
  if (kind === 'file') {
    if (!file) { toast('Choose a file first', 'error'); return; }
    // The group already has a file with this name: ask before adding a second
    // copy everyone has to tell apart (see askAboutDuplicateFile).
    const existing = st.dupOk ? null : findFileByName(groupItems(findGroup(code)), file.name);
    if (existing) {
      askAboutDuplicateFile(file.name, 'shared with this group', { onKeepBoth: () => { st.dupOk = true; confirmShareResource(); } });
      return;
    }
    item = { kind, title: file.name, fileName: file.name, size: file.size, dataUrl: file.dataUrl };
  } else if (kind === 'link') {
    const url = $('#sr-link-url').value.trim();
    if (!isHttpUrl(url)) { toast('Enter a full link starting with https://', 'error'); return; }
    item = { kind, title: $('#sr-link-title').value.trim() || hostOf(url) || 'Link', url };
  } else {
    const itemId = $('#sr-item')?.value;
    if (!itemId) { toast('Nothing to share yet', 'error'); return; }
    item = { kind, ...buildSharePayload(kind, itemId) };
  }
  const btn = $('#sr-share-btn');
  setBtnLoading(btn, true);
  const ok = await addGroupItem(code, item);
  setBtnLoading(btn, false, 'Share');
  if (ok) { closeModal(); toast(`Shared “${item.title}”`); }
}
async function addGroupItem(code, raw) {
  const entry = groupEntry(code);
  if (!entry) return false;
  const g = groupView(entry);
  const item = { id: uid(), ...raw, sharedBy: myGroupName(), sharedByUid: myUidFor(g), sharedAt: Date.now() };
  if (entry.local) {
    entry.items = [item, ...(entry.items || [])];
    touch();
    return true;
  }
  if (!cloudGroupsEnabled()) { toast('Log in to share with this group.', 'error'); return false; }
  try { await addCloudGroupItem(code, item); return true; }
  catch (e) { if (!e.message?.startsWith('That’s too large')) diag.error('studygroups', 'Share to group failed', e); toast(e.message?.startsWith('That’s too large') ? e.message : 'Couldn’t share that. Check your connection and try again.', 'error', 5000); return false; }
}
function importGroupResource(code, itemId) {
  const g = findGroup(code);
  const s = groupItems(g).find(x => x.id === itemId);
  if (!s) return;
  if (s.kind === 'note') {
    // Written by another member: sanitized here and again when rendered.
    state.notes.push({ id: uid(), type: 'note', name: String(s.title || 'Shared note').slice(0, 200), parentId: 'root', courseId: null, content: sanitizeHtml(s.content || ''), updatedAt: Date.now() });
    toast(`Added “${s.title}” to your notebook`);
  } else if (s.kind === 'note-bundle') {
    const folderId = uid();
    state.notes.push({ id: folderId, type: 'folder', name: s.title, parentId: 'root', courseId: null, open: true });
    (s.notes || []).forEach(n => state.notes.push({ id: uid(), type: 'note', name: String(n.name || 'Shared note').slice(0, 200), parentId: folderId, courseId: null, content: sanitizeHtml(n.content || ''), updatedAt: Date.now() }));
    toast(`Added “${s.title}” to your notebook`);
  } else if (s.kind === 'deck') {
    state.decks.push({ id: uid(), name: String(s.title || 'Shared deck').slice(0, 200), courseId: null, cards: (s.cards || []).slice(0, 2000).map(c => ({ id: uid(), front: String(c.front || '').slice(0, 2000), back: String(c.back || '').slice(0, 2000) })) });
    toast(`Added “${s.title}” to your flashcards`);
  } else if (s.kind === 'project') {
    state.projects.push({
      id: uid(), title: s.title, courseId: null, dueDate: s.dueDate || '',
      milestones: (s.milestones || []).map(m => ({ ...m, id: uid(), tasks: (m.tasks || []).map(t => ({ ...t, id: uid() })) })),
    });
    toast(`Added “${s.title}” to your projects`);
  }
  touch();
}
function removeGroupResource(code, itemId) {
  confirmDialog('Remove this from the group? Copies people already added stay in their planners.', async () => {
    const entry = groupEntry(code);
    if (entry.local) { entry.items = (entry.items || []).filter(x => x.id !== itemId); touch(); return; }
    const item = (_groupItems[code] || []).find(x => x.id === itemId);
    try {
      await _fbDb.collection('studyGroups').doc(code).collection('items').doc(itemId).delete();
      if (item?.kind === 'file' && String(item.url || '').includes('firebasestorage')) fbStorage().then(st => st.refFromURL(item.url).delete()).catch(() => {});
    } catch (e) { toast('Couldn’t remove that: ' + e.message, 'error'); }
  }, 'Remove');
}
// Entry point for the Share buttons on notes, notebooks, decks, and projects.
function openShareToGroupModal(kind, title, payload) {
  const groups = allGroups().filter(g => !g.loading);
  if (!groups.length) {
    confirmDialog('You’re not in any study groups yet. Start one to share this with classmates?', () => { setState({ route: 'studygroups', subRoute: null }); openCreateGroupModal(); }, 'Start a group');
    return;
  }
  window._shareDraft = { kind, title, payload };
  openModal(`
    <div class="modal-head"><h3>Share “${esc(title)}”</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label for="share-group">Share to group</label>
        <select class="select" id="share-group">${groups.map(g => `<option value="${g.code}">${esc(g.name)}</option>`).join('')}</select>
      </div>
      <p class="small muted">Everyone in the group can add a copy to their own ${kind === 'note' || kind === 'note-bundle' ? 'notebook' : kind === 'project' ? 'projects' : 'flashcards'}.</p>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="share-group-btn" onclick="confirmShareToGroup()">Share</button></div>
  `);
}
async function confirmShareToGroup() {
  const code = $('#share-group').value;
  const { kind, title, payload } = window._shareDraft;
  const btn = $('#share-group-btn');
  setBtnLoading(btn, true);
  const ok = await addGroupItem(code, { kind, title, ...payload });
  setBtnLoading(btn, false, 'Share');
  if (ok) { closeModal(); toast(`Shared with ${findGroup(code)?.name || 'your group'}`); }
}

/* ── Chat ──────────────────────────────────────────────────────── */
function groupChatTab(g) {
  const msgs = groupMessages(g);
  const u = myUidFor(g);
  const isOwner = g.createdBy === u;
  let lastDay = '', lastUid = '', lastAt = 0;
  const rows = msgs.map(m => {
    const day = iso(new Date(m.at));
    const sep = day !== lastDay ? `<div class="sg-chat-day">${fmtSessionDay(day)}</div>` : '';
    const grouped = !sep && lastUid === m.uid && m.at - lastAt < 5 * 60000;
    lastDay = day; lastUid = m.uid; lastAt = m.at;
    const mine = m.uid === u;
    return `${sep}
      <div class="sg-msg ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''}">
        ${mine ? '' : grouped ? '<span class="sg-msg-spacer"></span>' : personAvatar(m.uid, m.name, 28, personColor(g, m.uid))}
        <div class="sg-msg-body">
          ${!mine && !grouped ? `<div class="sg-msg-name">${esc(m.name)} <span class="muted">${new Date(m.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span></div>` : ''}
          <div class="sg-bubble" title="${esc(new Date(m.at).toLocaleString())}">${linkifyText(m.text)}</div>
        </div>
        ${mine || isOwner ? `<button class="sg-msg-del" aria-label="Delete message" title="Delete" onclick="deleteGroupMessage('${g.code}','${m.id}')">${icon('x', 11, 2.2)}</button>` : ''}
      </div>`;
  }).join('');
  return `
    <div class="card sg-chat">
      <div class="sg-chat-log" id="sg-chat-log" data-keep-scroll="bottom">
        ${msgs.length ? rows : emptyState(icon('message-circle', 24, 1.4), 'No messages yet', '', 'Say hi, or post what you’re stuck on.')}
      </div>
      <div class="sg-chat-compose">
        <input class="input" id="sg-chat-input" maxlength="${GROUP_MESSAGE_MAX}" autocomplete="off" placeholder="Message ${esc(g.name)}" onkeydown="if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();sendGroupMessage('${g.code}')}">
        <button class="btn btn-primary" aria-label="Send message" onclick="sendGroupMessage('${g.code}')">${icon('send', 14, 1.9)}</button>
      </div>
    </div>`;
}
async function sendGroupMessage(code) {
  const input = $('#sg-chat-input');
  const text = input?.value.trim();
  if (!text) return;
  const entry = groupEntry(code);
  const g = groupView(entry);
  const msg = { id: uid(), uid: myUidFor(g), name: myGroupName(), text: text.slice(0, GROUP_MESSAGE_MAX), at: Date.now() };
  const lastMessage = { uid: msg.uid, name: msg.name, text: msg.text.slice(0, 140), at: msg.at };
  input.value = '';
  if (entry.local) {
    entry.messages = [...(entry.messages || []), msg];
    entry.lastMessage = lastMessage;
    groupChatSeen()[code] = msg.at;
    touch();
    $('#sg-chat-input')?.focus();
    return;
  }
  if (!cloudGroupsEnabled()) { toast('Log in to chat with this group.', 'error'); return; }
  try {
    await _fbDb.collection('studyGroups').doc(code).collection('messages').doc(msg.id).set(msg);
    groupWrite(code, { lastMessage });
    markChatSeen(code, msg.at);
    playUiSound('send');
  } catch (e) {
    diag.error('studygroups', 'Message failed', e);
    if (input.isConnected && !input.value) input.value = text;
    toast('Message didn’t send. Check your connection and try again.', 'error');
  }
}
function deleteGroupMessage(code, id) {
  const entry = groupEntry(code);
  if (entry.local) { entry.messages = (entry.messages || []).filter(m => m.id !== id); touch(); return; }
  _fbDb.collection('studyGroups').doc(code).collection('messages').doc(id).delete().catch(e => toast('Couldn’t delete that message: ' + e.message, 'error'));
}
function markChatSeen(code, at) {
  const g = findGroup(code);
  const latest = at || g?.lastMessage?.at || 0;
  if (!latest || (groupChatSeen()[code] || 0) >= latest) return;
  groupChatSeen()[code] = latest;
  save();
  renderSidebar(); // clear the nav's unread dot without rebuilding the page
}

/* ── Create, join, invite, settings, leave ─────────────────────── */
function openCreateGroupModal() {
  const courses = activeCourses();
  openModal(`
    <div class="modal-head"><h3>New study group</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label for="gf-name">Group name</label><input class="input" id="gf-name" maxlength="80" placeholder="Calc II group" onkeydown="if(event.key==='Enter')submitCreateGroup()"></div>
      <div class="field"><label for="gf-course">Class <span class="muted">(optional)</span></label>
        <input class="input" id="gf-course" maxlength="60" list="gf-course-list" placeholder="MATH 152">
        <datalist id="gf-course-list">${courses.map(c => `<option value="${esc(c.code || c.name)}">`).join('')}</datalist>
      </div>
      <div class="field"><label for="gf-desc">What’s it for? <span class="muted">(optional)</span></label><input class="input" id="gf-desc" maxlength="200" placeholder="Weekly problem sets, Tuesdays in the library"></div>
      ${!cloudGroupsEnabled() && fbConfigured() ? `<p class="small muted">You’re not logged in, so this group stays on this tab only. <a href="login.html">Log in</a> to invite people.</p>` : ''}
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="gf-create" onclick="submitCreateGroup()">Create group</button></div>
  `);
  setTimeout(() => $('#gf-name')?.focus(), 60);
}
async function submitCreateGroup() {
  const name = $('#gf-name').value.trim();
  if (!name) { toast('Name the group', 'error'); $('#gf-name').focus(); return; }
  const courseLabel = $('#gf-course').value.trim();
  const description = $('#gf-desc').value.trim();
  if (!cloudGroupsEnabled()) {
    const code = genGroupCode();
    const doc = newGroupDoc({ code, name, courseLabel, description, ownerUid: LOCAL_UID });
    groupEntries().push({ ...doc, local: true, items: [], messages: [] });
    closeModal();
    openGroup(code);
    return;
  }
  const btn = $('#gf-create');
  setBtnLoading(btn, true);
  try {
    const code = await unusedGroupCode();
    const doc = newGroupDoc({ code, name, courseLabel, description, ownerUid: _fbUser.uid });
    await _fbDb.collection('studyGroups').doc(code).set(doc);
    _liveGroups[code] = doc;
    replaceWithCloudEntry(code, name);
    reconcileGroupSubscriptions();
    if (typeof countSetupStep === 'function') countSetupStep('setup_group_joined', 'study-group');
    closeModal();
    openGroup(code);
    setTimeout(() => openInviteModal(code, { justCreated: true }), 150);
  } catch (e) {
    diag.error('studygroups', 'Create group failed', e);
    setBtnLoading(btn, false, 'Create group');
    toast('Couldn’t create the group. Check your connection and try again.', 'error', 4500);
  }
}
function openJoinGroupModal(prefill = '') {
  if (!cloudGroupsEnabled()) {
    openModal(`
      <div class="modal-head"><h3>Join a study group</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
      <div class="modal-body"><p class="small muted">Joining a classmate’s group needs a Semester HQ account, so your sessions, tasks, and chat stay in sync with theirs.</p></div>
      <div class="modal-foot"><button class="btn" onclick="closeModal()">Not now</button>${fbConfigured() ? `<a class="btn btn-primary" href="login.html">Log in or sign up</a>` : ''}</div>
    `);
    return;
  }
  openModal(`
    <div class="modal-head"><h3>Join a study group</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label for="jf-code">Group code</label>
        <input class="input sg-code-input" id="jf-code" value="${esc(normalizeCode(prefill))}" placeholder="ABC123" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false"
          oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'')" onkeydown="if(event.key==='Enter')lookupJoinCode()">
      </div>
      <div id="jf-result"></div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="jf-btn" onclick="lookupJoinCode()">Find group</button></div>
  `);
  setTimeout(() => $('#jf-code')?.focus(), 60);
}
async function lookupJoinCode() {
  const code = normalizeCode($('#jf-code').value);
  if (code.length !== 6) { toast('Group codes are 6 characters', 'error'); return; }
  if (groupEntry(code)?.cloud) { closeModal(); openGroup(code); toast('You’re already in this group'); return; }
  const btn = $('#jf-btn');
  setBtnLoading(btn, true);
  try {
    const snap = await _fbDb.collection('studyGroups').doc(code).get();
    if (!snap.exists) {
      setBtnLoading(btn, false, 'Find group');
      $('#jf-result').innerHTML = `<div class="sg-callout small"><div>No group uses the code <strong>${esc(code)}</strong>. Double-check it with whoever invited you.</div></div>`;
      return;
    }
    showJoinPreview(code, snap.data());
  } catch (e) {
    setBtnLoading(btn, false, 'Find group');
    toast('Couldn’t look that up. Check your connection and try again.', 'error');
  }
}
function showJoinPreview(code, data) {
  const g = normalizeGroup({ ...data, code });
  const people = data.v === 2 ? groupPeople(g) : [];
  const count = data.v === 2 ? people.length : (data.members || []).length;
  const next = data.v === 2 ? upcomingSessions(g)[0] : null;
  openModal(`
    <div class="modal-head"><h3>You’re invited</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="sg-join-card">
        ${people.length ? avatarStack(g, 6, 34) : `<span class="sg-feature-ic">${icon('users', 18, 1.7)}</span>`}
        <div class="sg-join-name">${esc(g.name)}</div>
        <div class="small muted">${[g.courseLabel ? esc(g.courseLabel) : '', count ? `${count} member${count === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}</div>
        ${g.description ? `<div class="small mt-8">${esc(g.description)}</div>` : ''}
        ${next ? `<div class="small muted mt-8">Next session: ${esc(next.title)}, ${fmtSessionWhen(next)}</div>` : ''}
      </div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="clearPendingJoin();closeModal()">Not now</button><button class="btn btn-primary" id="jf-confirm" onclick="confirmJoinGroup('${code}')">Join group</button></div>
  `);
}
async function confirmJoinGroup(code) {
  const btn = $('#jf-confirm');
  setBtnLoading(btn, true);
  try {
    const name = await ensureGroupMembership(code);
    clearPendingJoin();
    replaceWithCloudEntry(code, name);
    reconcileGroupSubscriptions();
    if (typeof countSetupStep === 'function') countSetupStep('setup_group_joined', 'study-group');
    closeModal();
    openGroup(code);
    toast(`You joined ${name}`);
  } catch (e) {
    if (!e.message?.startsWith('No group')) diag.error('studygroups', 'Join failed', e);
    setBtnLoading(btn, false, 'Join group');
    toast(e.message?.startsWith('No group') ? e.message : 'Couldn’t join. Check your connection and try again.', 'error', 5000);
  }
}
function groupInviteLink(code) {
  return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}?join=${code}`;
}
function copyText(text, successMsg) {
  const done = () => toast(successMsg || 'Copied');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch { toast('Couldn’t copy. Select the text and copy it manually.', 'error'); }
  ta.remove();
}
function openInviteModal(code, { justCreated = false } = {}) {
  const g = findGroup(code);
  if (!g) return;
  const link = groupInviteLink(code);
  openModal(`
    <div class="modal-head"><h3>${justCreated ? 'Your group is ready' : `Invite to ${esc(g.name)}`}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      ${g.local ? `<div class="sg-callout small mb-16"><div>${g.sample ? 'This is a sample group, so this code is just for show.' : 'You’re not logged in, so no one else can join this group yet. <a href="login.html">Log in</a> to invite classmates for real.'}</div></div>` : ''}
      <p class="small muted" style="text-align:center">${justCreated ? 'Invite your classmates. ' : ''}They can join with this code:</p>
      <div class="sg-invite-code" aria-label="Group code ${code.split('').join(' ')}">${code.split('').map(c => `<span>${c}</span>`).join('')}</div>
      <div class="field mt-16"><label for="sg-invite-link">Or send them a link</label>
        <div class="sg-invite-row"><input class="input" id="sg-invite-link" value="${esc(link)}" readonly onclick="this.select()"><button class="btn btn-primary" onclick="copyInvite('${code}')">${icon('copy', 13, 1.8)} Copy</button></div>
      </div>
      ${navigator.share ? `<button class="btn" style="width:100%;justify-content:center" onclick="shareInviteNative('${code}')">${icon('send', 13, 1.8)} Share via Messages, GroupMe…</button>` : ''}
      <div class="sg-pricing-inline small mt-16">
        <span class="sg-feature-ic">${icon('users', 15, 1.7)}</span>
        <div><span class="sg-strong">Getting your whole class or club on board?</span><div class="muted">Each member needs their own Semester HQ Plus. <a href="${GROUP_PRICING_URL}" target="_blank" rel="noopener">Group pricing</a> covers everyone at a lower per-student rate.</div></div>
      </div>
    </div>
  `);
}
function inviteMessage(code) { const g = findGroup(code); return `Join my study group “${g?.name || 'Study group'}” on Semester HQ: ${groupInviteLink(code)} (code ${code})`; }
function copyInvite(code) { copyText(inviteMessage(code), 'Invite copied. Paste it wherever your classmates are.'); }
function shareInviteNative(code) {
  const g = findGroup(code);
  navigator.share({ title: `Join ${g?.name || 'my study group'} on Semester HQ`, text: inviteMessage(code) }).catch(() => {});
}
function openGroupSettingsModal(code) {
  const g = findGroup(code);
  if (!g) return;
  const u = myUidFor(g);
  const isOwner = g.createdBy === u;
  const people = groupPeople(g);
  openModal(`
    <div class="modal-head"><h3>Group settings</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label for="gs-name">Group name</label><input class="input" id="gs-name" value="${esc(g.name)}" maxlength="80"></div>
      <div class="field"><label for="gs-course">Class</label><input class="input" id="gs-course" value="${esc(g.courseLabel || '')}" maxlength="60" list="gs-course-list" placeholder="Optional"><datalist id="gs-course-list">${activeCourses().map(c => `<option value="${esc(c.code || c.name)}">`).join('')}</datalist></div>
      <div class="field"><label for="gs-desc">Description</label><input class="input" id="gs-desc" value="${esc(g.description || '')}" maxlength="200" placeholder="Optional"></div>
      <div class="field"><label>Your color in this group</label>${colorSwatches(g, 'pickGroupColorFromSettings')}</div>
      <div class="field"><label>Group color <span class="muted">(its sessions on your calendar)</span></label>
        <div class="org-colors" role="group" aria-label="Group color">
          <button type="button" class="page-color sg-color-auto ${HEX_COLOR.test(g.color || '') ? '' : 'active'}" aria-pressed="${!HEX_COLOR.test(g.color || '')}" title="${groupCourse(g) ? `Match ${esc(groupCourse(g).code || groupCourse(g).name)}` : 'No color'}" aria-label="${groupCourse(g) ? 'Match the class color' : 'No color'}" style="${groupCourse(g) ? `background:${groupCourse(g).color}` : ''}" onclick="setGroupColor('${code}','')">${groupCourse(g) ? '' : icon('x', 11, 2.2)}</button>
          ${GROUP_COLORS.map((c, i) => `<button type="button" class="page-color ${g.color === c ? 'active' : ''}" style="background:${c}" aria-label="Color ${i + 1}" aria-pressed="${g.color === c}" onclick="setGroupColor('${code}','${c}')"></button>`).join('')}
        </div>
        <div class="small muted mt-4">${groupCourse(g) ? `The first swatch follows ${esc(groupCourse(g).code || groupCourse(g).name)}’s color.` : g.courseLabel ? 'Add a class in Courses with the same code and the group can match its color.' : 'Pick one, or set a class above so the group can match it.'}</div>
      </div>
      <div class="divider"></div>
      <div class="small dim mb-8" style="font-weight:600">Members (${people.length})</div>
      ${people.map(p => `
        <div class="sg-person">
          ${personAvatar(p.uid, p.name, 26, personColor(g, p.uid))}
          <div class="row-title small">${esc(p.name)}${p.uid === u ? ' <span class="muted">(you)</span>' : ''}</div>
          ${p.role === 'owner' ? '<span class="small muted">Owner</span>' : isOwner && !g.local && p.uid !== u ? `<button class="btn btn-ghost btn-sm" onclick="confirmRemoveMember('${code}','${esc(p.uid)}')">Remove</button>` : ''}
        </div>`).join('')}
      <div class="divider"></div>
      <div class="sg-danger">
        <button class="btn btn-sm" onclick="confirmLeaveGroup('${code}')">${icon('log-out', 13, 1.8)} ${g.sample ? 'Remove sample group' : 'Leave group'}</button>
        ${isOwner && !g.local ? `<button class="btn btn-danger btn-sm" onclick="confirmDeleteGroup('${code}')">${icon('trash', 13, 1.8)} Delete for everyone</button>` : ''}
      </div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveGroupSettings('${code}')">Save</button></div>
  `);
}
async function setGroupColor(code, color) {
  if (color && !GROUP_COLORS.includes(color)) return;
  await groupWrite(code, { color: color || GW_DELETE });
  if ($('#gs-name')) openGroupSettingsModal(code);
}
function pickGroupColorFromSettings(code, color) {
  setMyGroupColor(code, color);
  setTimeout(() => { if ($('#gs-name')) openGroupSettingsModal(code); }, 60);
}
async function saveGroupSettings(code) {
  const name = $('#gs-name').value.trim();
  if (!name) { toast('The group needs a name', 'error'); return; }
  closeModal();
  const entry = groupEntry(code);
  if (entry?.cloud) entry.name = name;
  if (await groupWrite(code, { name, courseLabel: $('#gs-course').value.trim(), description: $('#gs-desc').value.trim() })) toast('Group updated');
}
function confirmRemoveMember(code, memberUid) {
  const g = findGroup(code);
  confirmDialog(`Remove ${personName(g, memberUid)} from ${g.name}? They can rejoin only if someone shares the code again.`, () => {
    groupWrite(code, { memberUids: gwRemove(memberUid), [`people.${memberUid}`]: GW_DELETE, [`avail.${memberUid}`]: GW_DELETE });
  }, 'Remove');
}
function confirmLeaveGroup(code) {
  const g = findGroup(code);
  if (g.local) {
    confirmDialog(g.sample ? 'Remove the sample group?' : `Delete “${g.name}”? It only exists on this tab.`, () => {
      state.studyGroups = groupEntries().filter(e => e.code !== code);
      state.subRoute = null;
      touch();
    }, 'Remove');
    return;
  }
  const others = groupPeople(g).filter(p => p.uid !== myUidFor(g));
  confirmDialog(others.length ? `Leave “${g.name}”? You can rejoin later with the code ${code}.` : `You’re the last member, so leaving deletes “${g.name}”.`, () => leaveGroup(code), others.length ? 'Leave group' : 'Leave and delete');
}
async function leaveGroup(code) {
  const g = findGroup(code);
  const myUid = _fbUser?.uid;
  if (!g || !myUid) return;
  const others = groupPeople(g).filter(p => p.uid !== myUid);
  if (!others.length) { await deleteGroupEverywhere(code); return; }
  const ops = { memberUids: gwRemove(myUid), [`people.${myUid}`]: GW_DELETE, [`avail.${myUid}`]: GW_DELETE };
  if (g.createdBy === myUid) { ops.createdBy = others[0].uid; ops[`people.${others[0].uid}.role`] = 'owner'; }
  if (_groupDocUnsubs[code]) { _groupDocUnsubs[code](); delete _groupDocUnsubs[code]; }
  if (await groupWrite(code, ops)) dropGroupEntry(code, `You left “${g.name}”.`);
  else reconcileGroupSubscriptions();
}
function confirmDeleteGroup(code) {
  const g = findGroup(code);
  const n = groupPeople(g).length;
  confirmDialog(`Delete “${g.name}” for all ${n} member${n === 1 ? '' : 's'}? Sessions, tasks, chat, and shared resources are erased for everyone. This can’t be undone.`, () => deleteGroupEverywhere(code), 'Delete group');
}
async function deleteGroupEverywhere(code) {
  const g = findGroup(code);
  try {
    const ref = _fbDb.collection('studyGroups').doc(code);
    for (const sub of ['items', 'messages']) {
      const snap = await ref.collection(sub).get();
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = _fbDb.batch();
        snap.docs.slice(i, i + 400).forEach(d => {
          batch.delete(d.ref);
          const url = d.data().url;
          if (sub === 'items' && String(url || '').includes('firebasestorage')) fbStorage().then(st => st.refFromURL(url).delete()).catch(() => {});
        });
        await batch.commit();
      }
    }
    if (_groupDocUnsubs[code]) { _groupDocUnsubs[code](); delete _groupDocUnsubs[code]; }
    await ref.delete();
    dropGroupEntry(code, `Deleted “${g?.name || 'the group'}”.`);
  } catch (e) {
    diag.error('studygroups', 'Delete group failed', e);
    reconcileGroupSubscriptions();
    toast('Couldn’t delete the group. Check your connection and try again.', 'error');
  }
}

/* ── Invite links: ?join=CODE survives login, checkout, and paywall ─ */
function captureJoinParam() {
  const params = new URLSearchParams(location.search);
  const code = normalizeCode(params.get('join'));
  if (!params.has('join')) return;
  params.delete('join');
  history.replaceState({}, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
  if (code.length !== 6 || isEmbedded()) return;
  try { localStorage.setItem(PENDING_JOIN_KEY, JSON.stringify({ code, at: Date.now() })); } catch {}
}
function pendingJoinCode() {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_JOIN_KEY) || 'null');
    if (p?.code && Date.now() - p.at < 14 * 86400000) return p.code;
  } catch {}
  return null;
}
function clearPendingJoin() { try { localStorage.removeItem(PENDING_JOIN_KEY); } catch {} window._pendingInviteName = null; }
let _inviteLoginShown = false;
async function handlePendingJoin() {
  const code = pendingJoinCode();
  if (!code || !fbConfigured() || isEmbedded()) return;
  if (!_fbUser) {
    if (_inviteLoginShown) return;
    _inviteLoginShown = true;
    openModal(`
      <div class="modal-head"><h3>You’re invited to a study group</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
      <div class="modal-body">
        <div class="sg-invite-code small-code">${code.split('').map(c => `<span>${c}</span>`).join('')}</div>
        <p class="small muted mt-16">Log in or create your Semester HQ account to join. You’ll come right back to this invite afterward.</p>
      </div>
      <div class="modal-foot"><button class="btn" onclick="closeModal()">Look around first</button><a class="btn btn-primary" href="login.html">Log in to join</a></div>
    `);
    return;
  }
  if (!window._licensed) return; // the paywall shows the invite instead, see pendingInviteBanner()
  if (groupEntry(code)?.cloud) { clearPendingJoin(); openGroup(code); return; }
  try {
    const snap = await _fbDb.collection('studyGroups').doc(code).get();
    if (!snap.exists) { clearPendingJoin(); toast('That invite link doesn’t match a group anymore. Ask for a new one.', 'error', 5000); return; }
    showJoinPreview(code, snap.data());
  } catch (e) { diag.warn('studygroups', 'Could not load invite', e); }
}
// Shown on the paywall when someone followed an invite link but hasn't
// subscribed yet. The invite is the reason they're here, so say so, and
// point whoever is organizing a whole group toward group pricing.
function pendingInviteBanner() {
  const code = pendingJoinCode();
  if (!code) return '';
  if (window._pendingInviteName === undefined && _fbUser && _fbDb) {
    window._pendingInviteName = null;
    _fbDb.collection('studyGroups').doc(code).get()
      .then(snap => { if (snap.exists) { window._pendingInviteName = snap.data().name || null; render(); } })
      .catch(() => {});
  }
  const name = window._pendingInviteName;
  return `<div class="sg-callout small mb-16" style="text-align:left"><span>${icon('users', 15, 1.8)}</span><div>You’ve been invited to join ${name ? `<strong>${esc(name)}</strong>` : 'a study group'}. Subscribe to join your classmates. If your whole group is signing up together, <a href="${GROUP_PRICING_URL}" target="_blank" rel="noopener">ask about group pricing</a>.</div></div>`;
}
// Called at the end of every auth state change (see firebase.js).
function onGroupsAuthResolved() {
  if (!_fbUser) { handlePendingJoin(); if (typeof handlePendingClass === 'function' && !pendingJoinCode()) handlePendingClass(); if (typeof handlePendingOrg === 'function' && !pendingJoinCode() && !pendingClassCode()) handlePendingOrg(); }
}

/* ── Calendar + dashboard ──────────────────────────────────────── */
function groupSessionsOnDate(dateIso) {
  return allGroups().flatMap(g => sessionList(g)
    .filter(s => s.date === dateIso && s.rsvp?.[myUidFor(g)] !== 'no')
    .map(s => ({ id: s.id, code: g.code, title: s.title, start: s.start || null, end: s.end || null, color: groupColor(g) || '#6b6b6b', kind: 'group', groupName: g.name, action: `showGroupSessionModal('${g.code}','${s.id}')` })));
}
function dashboardGroupsWidget() {
  const groups = allGroups();
  if (!groups.length) {
    return `
      <div class="card card-pad mb-16">
        <div class="flex-between wrap" style="gap:12px">
          <div><h3 style="font-size:15px">Study groups</h3><div class="small muted">Find a time everyone’s free, plan sessions, and split the work with classmates.</div></div>
          <button class="btn btn-sm" onclick="setState({route:'studygroups',subRoute:null})">${icon('users', 13, 1.8)} Start a group</button>
        </div>
      </div>`;
  }
  const end = addDays(todayIso(), 7);
  const sessions = groups.flatMap(g => upcomingSessions(g).filter(s => s.date <= end && s.rsvp?.[myUidFor(g)] !== 'no').map(s => ({ g, s })))
    .sort((a, b) => (a.s.date + (a.s.start || '')).localeCompare(b.s.date + (b.s.start || ''))).slice(0, 3);
  const tasks = groups.flatMap(g => taskList(g).filter(t => !t.done && t.assignee === myUidFor(g)).map(t => ({ g, t })))
    .sort((a, b) => byDueThenCreated(a.t, b.t)).slice(0, 3);
  const unread = groups.filter(groupHasUnread);
  return `
    <div class="card card-pad mb-16">
      <div class="flex-between mb-8"><h3 style="font-size:15px">Study groups</h3><a class="small" style="color:var(--accent);cursor:pointer" onclick="setState({route:'studygroups',subRoute:null})">View all →</a></div>
      ${unread.length ? `<div class="sg-dash-unread">${unread.map(g => `<button class="pill sg-unread-pill" onclick="openGroup('${g.code}','chat')"><span class="sg-unread-dot"></span>${esc(g.name)}</button>`).join('')}</div>` : ''}
      ${sessions.length ? sessions.map(({ g, s }) => `
        <div class="list-row sg-session-row" style="--course:${esc(groupColor(g) || '#6b6b6b')}" onclick="showGroupSessionModal('${g.code}','${s.id}')">
          ${dateTile(s.date)}
          <div class="row-title"><div class="sg-strong">${esc(s.title)}</div><div class="row-meta">${esc(g.name)} · ${fmtSessionWhen(s)}</div></div>
          ${rsvpControl(g, s)}
        </div>`).join('') : `<p class="small muted">No group sessions in the next 7 days.</p>`}
      ${tasks.length ? `<div class="divider"></div><div class="small dim mb-8" style="font-weight:600">Assigned to you</div>${tasks.map(({ g, t }) => `
        <div class="list-row sg-task compact" onclick="openGroup('${g.code}','tasks')">
          <button type="button" class="row-check" role="checkbox" aria-checked="false" aria-label="Mark ${esc(t.title)} as done" onclick="event.stopPropagation();toggleGroupTask('${g.code}','${t.id}')"></button>
          <div class="row-title"><div>${esc(t.title)}</div><div class="row-meta">${esc(g.name)}${t.due ? ` · ${t.due < todayIso() ? '<span class="sg-overdue">Overdue</span>' : 'Due ' + fmtSessionDay(t.due)}` : ''}</div></div>
        </div>`).join('')}` : ''}
    </div>`;
}

/* ── Sample group: lets people without an account see a group in use ─ */
function createSampleGroup() {
  const existing = groupEntries().find(e => e.sample);
  if (existing) { openGroup(existing.code); return; }
  const now = Date.now(), H = 3600000, D = 24 * H, t = todayIso();
  const me = LOCAL_UID, maya = 'sample-maya', jordan = 'sample-jordan', priya = 'sample-priya';
  const code = genGroupCode();
  const ranges = (list) => availFromRanges(list.flatMap(([days, start, end]) => days.map(day => ({ day, start, end }))));
  const nextDow = (dow) => addDays(t, ((dow - new Date().getDay() + 7) % 7) || 7);
  const reviewId = uid(), swapId = uid(), pastId = uid();
  const entry = {
    v: 2, code, local: true, sample: true,
    name: 'BIO 201 Group', courseLabel: 'BIO 201', description: 'Weekly review before exams. Usually Wednesdays in the library.',
    createdBy: maya, createdAt: now - 20 * D, updatedAt: now,
    memberUids: [maya, jordan, priya, me],
    people: {
      [maya]: { name: 'Maya', role: 'owner', joinedAt: now - 20 * D, color: '#c0503f' },
      [jordan]: { name: 'Jordan', role: 'member', joinedAt: now - 19 * D, color: '#3f8a55' },
      [priya]: { name: 'Priya', role: 'member', joinedAt: now - 12 * D, color: '#8a5cc2' },
      [me]: { name: myGroupName(), role: 'member', joinedAt: now - 2 * D },
    },
    members: ['Maya', 'Jordan', 'Priya', myGroupName()], events: [],
    sessions: {
      [reviewId]: { id: reviewId, title: 'Midterm 2 review', date: addDays(t, 1), start: '18:00', end: '19:30', where: 'Main library, room 204', notes: 'Bring your practice problems from chapters 7–9. Maya is bringing the Quizlet.', createdBy: maya, createdByName: 'Maya', createdAt: now - 3 * D, rsvp: { [maya]: 'yes', [jordan]: 'yes', [priya]: 'maybe' } },
      [swapId]: { id: swapId, title: 'Practice exam swap', date: nextDow(4), start: '17:30', end: '19:00', where: 'https://zoom.us/j/0000000000', notes: 'Everyone writes 5 questions, then we swap and check answers.', createdBy: priya, createdByName: 'Priya', createdAt: now - 1 * D, rsvp: { [priya]: 'yes' } },
      [pastId]: { id: pastId, title: 'Chapter 7 problem set', date: addDays(t, -6), start: '18:00', end: '19:00', where: 'Main library, room 204', notes: '', createdBy: maya, createdByName: 'Maya', createdAt: now - 9 * D, rsvp: { [maya]: 'yes', [jordan]: 'yes', [priya]: 'yes' } },
    },
    taskItems: Object.fromEntries([
      { title: 'Make a Quizlet for chapter 8 vocab', due: addDays(t, 1), assignee: maya },
      { title: 'Outline answers for review questions 1–10', due: addDays(t, 2), assignee: me },
      { title: 'Book a study room for next week', due: null, assignee: jordan, done: true, doneBy: jordan, doneAt: now - 5 * H },
      { title: 'Summarize lecture 14 notes', due: addDays(t, 4), assignee: null },
    ].map((x, i) => { const id = uid() + i; return [id, { id, label: '', done: false, doneBy: null, doneAt: null, createdBy: maya, createdAt: now - (4 - i) * D, ...x }]; })),
    avail: {
      [maya]: { name: 'Maya', updatedAt: now - 2 * D, ...ranges([[[1, 3], '15:00', '20:00'], [[2, 4], '18:00', '21:00'], [[0], '13:00', '17:00']]) },
      [jordan]: { name: 'Jordan', updatedAt: now - 2 * D, ...ranges([[[1, 2, 3, 4], '17:00', '19:30'], [[6], '10:00', '14:00']]) },
      [priya]: { name: 'Priya', updatedAt: now - D, ...ranges([[[3, 4], '16:00', '20:00'], [[1], '18:00', '22:00'], [[0], '14:00', '16:00']]) },
    },
    messages: [
      { id: uid(), uid: maya, name: 'Maya', text: 'Booked room 204 for tomorrow.', at: now - 26 * H },
      { id: uid(), uid: jordan, name: 'Jordan', text: 'Can we start at 6 instead? I have lab until 5:45', at: now - 25.5 * H },
      { id: uid(), uid: priya, name: 'Priya', text: '6 works for me, I might be a few minutes late though', at: now - 25 * H },
      { id: uid(), uid: maya, name: 'Maya', text: 'Moved it to 6! Can everyone add availability for next week so we can lock in the practice exam swap?', at: now - 3 * H },
    ],
    items: [
      { id: uid(), kind: 'deck', title: 'Cell signaling key terms', sharedBy: 'Maya', sharedByUid: maya, sharedAt: now - 2 * D, cards: [
        { front: 'Ligand', back: 'A signaling molecule that binds to a specific receptor' },
        { front: 'Second messenger', back: 'Small intracellular molecule (like cAMP) that relays a signal from a receptor' },
        { front: 'Kinase', back: 'Enzyme that transfers phosphate groups to proteins, often activating them' },
        { front: 'Signal transduction', back: 'The chain of events that converts an external signal into a cellular response' },
        { front: 'G protein', back: 'Membrane protein that is active when bound to GTP and relays receptor signals' },
      ] },
      { id: uid(), kind: 'note', title: 'Lecture 14 summary', sharedBy: 'Priya', sharedByUid: priya, sharedAt: now - 30 * H, content: '<h2>Lecture 14: Cell communication</h2><ul><li>Three stages: reception, transduction, response</li><li>GPCRs are the largest family of receptors</li><li>Amplification: one ligand can trigger thousands of responses</li></ul>' },
    ],
  };
  entry.lastMessage = { uid: maya, name: 'Maya', text: entry.messages[3].text.slice(0, 140), at: entry.messages[3].at };
  groupEntries().push(entry);
  openGroup(code);
  toast('This is a sample group. Try RSVPing or painting your availability.', 'info', 4200);
}
