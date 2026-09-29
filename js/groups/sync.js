/* ── Study Groups: data, writes, sync, joining ───────────────────
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

   This file loads first of the group files (after js/spaces/core.js),
   so the constants every group file uses live here. The pages are in
   js/studygroups.js.
──────────────────────────────────────────────────────────────── */
const GROUP_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I, so a code read off a whiteboard can't be mistyped
const GROUP_FILE_MAX_BYTES_CLOUD = 10 * 1024 * 1024; // real Firebase Storage upload
const GROUP_FILE_MAX_BYTES_LOCAL = 2 * 1024 * 1024;  // inline data URL, only ever held in memory
const GROUP_MESSAGE_MAX = 2000;
const PENDING_JOIN_KEY = 'shq_pending_join';
const GROUP_CACHE_KEY = storeKey + '.groups';
const GROUP_PRICING_URL = 'https://semester-hq.com/group-pricing.html';
const GROUP_TABS = [['overview', 'Overview'], ['schedule', 'Sessions'], ['availability', 'Find a time'], ['tasks', 'Tasks'], ['resources', 'Files'], ['chat', 'Chat']];
const SESSION_REPEAT_WEEKS = [2, 4, 6, 8, 10, 12, 15];
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
// Past once it ends; with no end time it runs an hour (js/spaces/eventcard.js),
// so a session stays on the hero, and says Happening now, while it's on.
function sessionIsPast(s) { return eventTimeState(s).phase === 'after'; }
function upcomingSessions(g) { return sessionList(g).filter(s => !sessionIsPast(s)); }
function rsvpCounts(s) { const v = Object.values(s.rsvp || {}); return { yes: v.filter(x => x === 'yes').length, maybe: v.filter(x => x === 'maybe').length, no: v.filter(x => x === 'no').length }; }
// A task whose owner left the group is up for grabs again (taskOwner,
// js/groups/tasks.js): the copy returned drops the assignee and keeps it
// as formerAssignee, so every filter and claim button agrees.
function taskList(g) { return Object.values(g.taskItems || {}).filter(t => t && safeId(t.id) && t.title).map(t => t.assignee && taskOwner(g, t) !== t.assignee ? { ...t, assignee: null, formerAssignee: t.assignee } : t); }
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
  if (typeof welcomeOnSnapshot === 'function') welcomeOnSnapshot('group', code); // js/spaces/welcome.js
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
    // Merged, not replaced, so pages from "Load earlier" survive the window sliding.
    _groupMessages[code] = chatMergeWindow('group', code, snap.docs.map(d => ({ ...d.data(), id: d.id })));
    renderRemote();
  }, e => diag.error('studygroups', 'Group chat listener failed', e)));
}
function closeGroupDetailListeners() {
  if (_detailSubs.code) chatDropStore('group', _detailSubs.code);
  _detailSubs.unsubs.forEach(u => u());
  _detailSubs = { code: null, unsubs: [] };
}
function afterGroupPageRender() {
  const code = state.route === 'studygroups' ? state.subRoute : null;
  if (!code || !groupEntry(code)) {
    chatForget('group');
    if (_detailSubs.code) closeGroupDetailListeners();
    // Clubs run it from afterOrgPageRender; the groups index drops the sticky-row watcher here.
    if (state.route === 'studygroups' && typeof afterSpaceRender === 'function') afterSpaceRender();
    return;
  }
  centerActiveSgTab();
  if (typeof afterSpaceRender === 'function') afterSpaceRender();
  ensureGroupDetailListeners(code);
  bindAvailabilityPainting();
  // Scroll, the "new" line, composer height and the seen marker: js/spaces/chat.js.
  if (document.getElementById('sg-chat-log')) chatAfterRender('group', code);
  else chatForget('group', state.groupTab);
  sgFocusApply();
}

/* ── Where focus goes when its control goes away ─────────────────
   render() (js/app.js) finds the control that had focus again by its
   onclick. When that control is gone for good (a task checked off into
   a closed Done, a time you removed, the recap card after Not now),
   sgFocusAfter says where focus goes instead. targets: selectors tried
   in order (data-fk keys and ids). from: the control that is going away;
   while it is still on the page the plan waits, since a cloud write
   lands a render or two later. key: the onclick of what had focus, so a
   plan is dropped once focus has moved on (null skips that check). A
   plan older than 6 seconds is dropped too. */
let _sgFocusPlan = null;
function sgFocusAfter(targets, from = '', key) {
  const a = document.activeElement;
  _sgFocusPlan = { targets: targets.filter(Boolean), from, key: key === undefined ? (a && a !== document.body ? a.getAttribute('onclick') || '' : '') : key, until: Date.now() + 6000 };
}
function sgFocusApply() {
  const p = _sgFocusPlan;
  if (!p) return;
  if (Date.now() > p.until) { _sgFocusPlan = null; return; }
  const had = window._renderFocusKey;
  if (p.key && had && had.onclick !== p.key) { _sgFocusPlan = null; return; }
  const now = document.activeElement;
  if (now && now !== document.body) return;
  const shown = (x) => !!x && x.getClientRects().length > 0 && (typeof x.checkVisibility !== 'function' || x.checkVisibility());
  if (p.from && shown(document.querySelector(p.from))) return;
  _sgFocusPlan = null;
  for (const sel of p.targets) {
    const x = document.querySelector(sel);
    if (shown(x)) { try { x.focus({ preventScroll: true }); } catch {} return; }
  }
}

/* ── Invite links: ?join=CODE survives login, checkout, and paywall ─ */
function captureJoinParam() {
  const params = new URLSearchParams(location.search);
  const code = normalizeCode(params.get('join'));
  if (!params.has('join')) return;
  // &session=ID comes from a session shared to chat: open it once you're in.
  const session = params.get('session') || '';
  params.delete('join');
  params.delete('session');
  history.replaceState({}, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
  if (code.length !== 6 || isEmbedded()) return;
  // The link in the current URL wins over any older stored club invite.
  try { localStorage.setItem(PENDING_JOIN_KEY, JSON.stringify({ code, at: Date.now(), ...(safeId(session) ? { session } : {}) })); localStorage.removeItem('shq_pending_org'); } catch {}
}
function pendingJoinSession() { try { const p = JSON.parse(localStorage.getItem(PENDING_JOIN_KEY) || 'null'); return p?.session && safeId(p.session) ? p.session : ''; } catch { return ''; } }
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
    if (typeof inviteSignedOutHtml === 'function') { openModal(inviteSignedOutHtml('group', code)); return; } // js/spaces/invite.js
    openModal(`
      <div class="modal-head"><h3>You’re invited to a study group</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
      <div class="modal-body">
        <div class="sg-invite-code small-code">${code.split('').map(c => `<span>${c}</span>`).join('')}</div>
        <p class="small muted mt-16">Log in or create your Semester HQ account to join. You’ll come right back to this invite afterward.</p>
      </div>
      <div class="modal-foot"><button class="btn" onclick="closeModal()">Look around first</button><a class="btn btn-primary" href="login.html">Log in to join</a></div>
    `);
    return;
  }
  if (!window._licensed) return; // the paywall shows the invite instead, see pendingInviteBanner()
  if (groupEntry(code)?.cloud) {
    const sid = pendingJoinSession();
    clearPendingJoin();
    if (sid && findGroup(code)?.sessions?.[sid]) openGroupSession(code, sid); else openGroup(code);
    return;
  }
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
  return `<div class="sg-callout small mb-16" style="text-align:left"><span>${icon('users', 16)}</span><div>You’ve been invited to join ${name ? `<strong>${esc(name)}</strong>` : 'a study group'}. Subscribe to join your classmates. If your whole group is signing up together, <a href="${GROUP_PRICING_URL}" target="_blank" rel="noopener">ask about group pricing</a>.</div></div>`;
}
// Called at the end of every auth state change (see firebase.js).
function onGroupsAuthResolved() {
  if (!_fbUser) { handlePendingJoin(); if (typeof handlePendingClass === 'function' && !pendingJoinCode()) handlePendingClass(); if (typeof handlePendingOrg === 'function' && !pendingJoinCode() && !pendingClassCode()) handlePendingOrg(); }
}

