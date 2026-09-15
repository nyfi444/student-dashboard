/* ── Clubs & teams ─────────────────────────────────────────────────
   One calendar that officers run and every member gets: meetings,
   practices, games, philanthropy events, dues deadlines. Officers post
   events and announcements; members RSVP, and events land on their own
   Semester HQ calendar with reminders. Built for clubs, sports teams,
   and chapters buying a group plan.

   Firestore: orgs/{CODE}. The 6-character code is the invite, like study
   groups. officerUids decides who can post; people[uid] holds each
   member's name and the title shown next to it ("Treasurer"). Members can
   only RSVP (rsvp[their uid]), edit their own name and title, post in
   chat, or leave. Officers also share files (files[id], stored in Firebase
   Storage under orgs/CODE/files). Chat lives in the messages subcollection,
   with lastMessage on the doc for unread dots. See firestore.rules and
   storage.rules. Locally, state.orgs holds { code, cloud, name } entries;
   the sample org lives entirely in the planner.

   Roles: whoever starts the club is its founder and an officer. Only the
   founder makes someone else an officer. Anyone joining picks "general
   body" or adds their position, and the founder is asked whether that
   person should get officer access.
──────────────────────────────────────────────────────────────── */
const ORG_KINDS = [['club', 'Club', 'flag'], ['team', 'Team', 'trophy'], ['chapter', 'Sorority or fraternity', 'shield'], ['org', 'Organization', 'users'], ['other', 'Other', 'star']];
const ORG_EVENT_CATEGORIES = [['meeting', 'Meeting'], ['practice', 'Practice'], ['game', 'Game or match'], ['social', 'Social'], ['service', 'Service or philanthropy'], ['deadline', 'Deadline or dues'], ['other', 'Other']];
const ORG_COLORS = ['#1B2A4A', '#8C3B1F', '#2F4A3A', '#6E2E3A', '#3b6ea5', '#7A4A68', '#1F5F6B', '#5a4a1f'];
const ORG_TABS = [['overview', 'Overview'], ['events', 'Calendar'], ['announcements', 'Announcements'], ['chat', 'Chat'], ['files', 'Files'], ['members', 'Members']];
const ORG_CACHE_KEY = storeKey + '.orgs';
const PENDING_ORG_KEY = 'shq_pending_org';
const ORG_ANNOUNCEMENT_MAX = 1200;
const ORG_FILES_MAX = 100;
const ORG_TITLE_MAX = 40;
const ORG_TITLE_SUGGESTIONS = ['President', 'Vice President', 'Captain', 'Treasurer', 'Secretary', 'Social chair'];

let _liveOrgs = {};
try { _liveOrgs = JSON.parse(dataStore.getItem(ORG_CACHE_KEY) || '{}') || {}; } catch { _liveOrgs = {}; }
const persistOrgCache = debounce(() => { try { dataStore.setItem(ORG_CACHE_KEY, JSON.stringify(_liveOrgs)); } catch {} }, 800);
const _orgDocUnsubs = {};

function orgEntries() { return state.orgs || (state.orgs = []); }
function orgEntry(code) { return orgEntries().find(e => e.code === code); }
function orgView(entry) {
  if (!entry) return null;
  const raw = entry.local ? entry : (_liveOrgs[entry.code] ? { ..._liveOrgs[entry.code], code: entry.code } : { code: entry.code, name: entry.name || 'Club', loading: true });
  return {
    ...raw, local: !!entry.local, hideCalendar: !!entry.hideCalendar,
    people: raw.people || {}, memberUids: raw.memberUids || [], officerUids: raw.officerUids || [],
    events: raw.events || {}, announcements: raw.announcements || {}, rsvp: raw.rsvp || {}, titles: raw.titles || {},
    files: raw.files || {}, lastMessage: raw.lastMessage || null,
  };
}
function allOrgs() { return orgEntries().filter(e => e && SAFE_ID.test(e.code || '')).map(orgView).filter(Boolean); }
function findOrg(code) { return orgView(orgEntry(code)); }
function myOrgUid(o) { return o?.local ? LOCAL_UID : (_fbUser?.uid || LOCAL_UID); }
function isOrgOfficer(o) { return !!o && o.officerUids.includes(myOrgUid(o)); }
function isOrgOwner(o) { return !!o && o.createdBy === myOrgUid(o); }
function orgKind(o) { return ORG_KINDS.find(k => k[0] === o.kind) || ORG_KINDS[0]; }
// Monogram for the crest: "Women in Business" → "WB", "Club Soccer" → "CS".
function orgMonogram(o) {
  const words = String(o?.name || '').split(/\s+/).filter(w => /^[A-Za-z0-9]/.test(w) && !/^(of|the|and|in|for|at|a|an|&)$/i.test(w));
  return esc((words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase());
}
function orgColor(o) { return HEX_COLOR.test(o?.color || '') ? o.color : ORG_COLORS[0]; }
function orgPeople(o) {
  return o.memberUids.filter(safeId).map(u => ({ uid: u, name: cleanStr(o.people[u]?.name, 60) || 'Member', joinedAt: o.people[u]?.joinedAt || 0, officer: o.officerUids.includes(u), owner: o.createdBy === u, title: orgTitleOf(o, u), reviewed: !!o.people[u]?.reviewed }))
    .sort((a, b) => Number(b.owner) - Number(a.owner) || Number(b.officer) - Number(a.officer) || a.name.localeCompare(b.name));
}
// people[uid].title is the one source going forward (members set their own,
// officers anyone's); titles[uid] is where officers' titles lived before.
function orgTitleOf(o, uid) { const p = o.people?.[uid]; return p && typeof p.title === 'string' ? cleanStr(p.title, ORG_TITLE_MAX) : cleanStr(o.titles?.[uid], ORG_TITLE_MAX); }
function orgGeneralLabel(o) { return o.kind === 'team' ? 'Team member' : 'General body'; }
// What shows next to someone's name: their title, or their role without one.
function orgRoleLabel(o, p) { return p.title || (p.owner ? 'Founder' : p.officer ? 'Officer' : orgGeneralLabel(o)); }
function orgPersonByUid(o, uid) { return orgPeople(o).find(p => p.uid === uid); }
function orgChatSeen() { return state.settings.orgChatSeen || (state.settings.orgChatSeen = {}); }
function orgChatUnread(o) { const m = o.lastMessage; return !!m && typeof m.at === 'number' && m.uid !== myOrgUid(o) && m.at > (orgChatSeen()[o.code] || 0); }
function markOrgChatSeen(code, at) {
  const o = findOrg(code);
  const latest = at || o?.lastMessage?.at || 0;
  if (!latest || (orgChatSeen()[code] || 0) >= latest) return;
  orgChatSeen()[code] = latest;
  save();
  renderSidebar();
}
function orgEventList(o) {
  return Object.values(o.events || {}).filter(e => e && safeId(e.id) && typeof e.title === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date || ''))
    .map(e => ({ ...e, title: cleanStr(e.title, 120), start: /^\d{2}:\d{2}$/.test(e.start || '') ? e.start : '', end: /^\d{2}:\d{2}$/.test(e.end || '') ? e.end : '', location: cleanStr(e.location, 120), notes: cleanStr(e.notes, 1000), category: ORG_EVENT_CATEGORIES.some(c => c[0] === e.category) ? e.category : 'other' }))
    .sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
}
function orgEventPast(e) {
  const t = todayIso();
  if (e.date !== t) return e.date < t;
  return !!(e.end || e.start) && toMin(e.end || e.start) < nowMinutes();
}
function upcomingOrgEvents(o) { return orgEventList(o).filter(e => !orgEventPast(e)); }
function myOrgRsvp(o, eventId) { const v = o.rsvp?.[myOrgUid(o)]?.[eventId]; return v === 'yes' || v === 'no' ? v : ''; }
function orgRsvpCounts(o, eventId) {
  let yes = 0, no = 0;
  o.memberUids.forEach(u => { const v = o.rsvp?.[u]?.[eventId]; if (v === 'yes') yes++; else if (v === 'no') no++; });
  return { yes, no, none: Math.max(0, o.memberUids.length - yes - no) };
}
function orgAnnouncementList(o) {
  return Object.values(o.announcements || {}).filter(a => a && safeId(a.id) && typeof a.text === 'string' && a.text.trim())
    .map(a => ({ ...a, text: a.text.slice(0, ORG_ANNOUNCEMENT_MAX), name: cleanStr(a.name, 60) || 'An officer' }))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.at || 0) - (a.at || 0));
}
function orgSeen() { return state.settings.orgSeen || (state.settings.orgSeen = {}); }
function orgUnreadCount(o) { const seen = orgSeen()[o.code] || 0; return orgAnnouncementList(o).filter(a => (a.at || 0) > seen && a.uid !== myOrgUid(o)).length; }
function markOrgSeen(code) { const o = findOrg(code); if (!o) return; const latest = Math.max(0, ...orgAnnouncementList(o).map(a => a.at || 0)); if (latest > (orgSeen()[code] || 0)) { orgSeen()[code] = latest; save(); } }

/* ── Writes ────────────────────────────────────────────────────── */
async function orgWrite(code, ops) {
  const entry = orgEntry(code);
  if (!entry) return false;
  if (entry.local) {
    Object.entries(ops).forEach(([path, val]) => applyLocalOp(entry, path.split('.'), val));
    entry.updatedAt = Date.now();
    touch();
    return true;
  }
  if (!cloudGroupsEnabled()) { toast('Log in to make changes.', 'error'); return false; }
  const FV = firebase.firestore.FieldValue;
  const payload = { updatedAt: Date.now() };
  Object.entries(ops).forEach(([path, val]) => {
    payload[path] = val === GW_DELETE ? FV.delete() : val?.__op === 'union' ? FV.arrayUnion(...val.v) : val?.__op === 'remove' ? FV.arrayRemove(...val.v) : val;
  });
  try {
    await _fbDb.collection('orgs').doc(code).update(payload);
    return true;
  } catch (e) {
    console.warn('Org write failed', code, e);
    toast(e.code === 'permission-denied' ? 'Only officers can change that.' : 'Couldn’t save that. Check your connection and try again.', 'error', 4500);
    return false;
  }
}

/* ── Sync ──────────────────────────────────────────────────────── */
function startOrgSync() {
  if (!cloudGroupsEnabled()) return;
  if (orgEntries().some(e => e.sample)) { state.orgs = orgEntries().filter(e => !e.sample); save(); }
  const codes = new Set(orgEntries().map(e => e.code));
  Object.keys(_liveOrgs).forEach(c => { if (!codes.has(c)) delete _liveOrgs[c]; });
  reconcileOrgSubscriptions();
  handlePendingOrg();
}
function stopOrgSync() { Object.keys(_orgDocUnsubs).forEach(code => { _orgDocUnsubs[code](); delete _orgDocUnsubs[code]; }); }
function reconcileOrgSubscriptions() {
  if (!cloudGroupsEnabled()) return;
  const want = new Set(orgEntries().filter(e => e.cloud).map(e => e.code));
  Object.keys(_orgDocUnsubs).forEach(code => { if (!want.has(code)) { _orgDocUnsubs[code](); delete _orgDocUnsubs[code]; } });
  want.forEach(code => {
    if (_orgDocUnsubs[code]) return;
    _orgDocUnsubs[code] = _fbDb.collection('orgs').doc(code).onSnapshot(doc => onOrgSnapshot(code, doc), err => console.warn('Org listener failed', code, err));
  });
}
function onOrgSnapshot(code, doc) {
  const entry = orgEntry(code);
  if (!entry?.cloud || !_fbUser) return;
  const data = doc.exists ? doc.data() : null;
  if (!data || !(data.memberUids || []).includes(_fbUser.uid)) {
    if (doc.metadata.fromCache || doc.metadata.hasPendingWrites) return;
    dropOrgEntry(code, !data ? `“${entry.name || 'A club'}” was deleted.` : `You’re no longer a member of “${entry.name || 'a club'}”.`);
    return;
  }
  const before = _liveOrgs[code];
  _liveOrgs[code] = data;
  persistOrgCache();
  if (entry.name !== data.name) { entry.name = data.name; save(); }
  if (!doc.metadata.hasPendingWrites && data.people?.[_fbUser.uid] && data.people[_fbUser.uid].name !== myGroupName()) orgWrite(code, { [`people.${_fbUser.uid}.name`]: myGroupName() });
  // A new announcement while the app is open.
  if (before) {
    const o = findOrg(code);
    const fresh = orgAnnouncementList(o).filter(a => a.uid !== _fbUser.uid && !Object.values(before.announcements || {}).some(b => b.id === a.id));
    if (fresh.length && !(state.route === 'orgs' && state.subRoute === code)) toast(`${o.name}: ${fresh[0].text.slice(0, 90)}${fresh[0].text.length > 90 ? '…' : ''}`, 'info', 6000, { label: 'Open', run: () => openOrg(code, 'announcements') });
  }
  if (typeof uploadPushSchedule === 'function') uploadPushSchedule();
  renderRemote();
}
function dropOrgEntry(code, message) {
  if (_orgDocUnsubs[code]) { _orgDocUnsubs[code](); delete _orgDocUnsubs[code]; }
  delete _liveOrgs[code]; persistOrgCache();
  state.orgs = orgEntries().filter(e => e.code !== code);
  if (state.route === 'orgs' && state.subRoute === code) state.subRoute = null;
  touch();
  if (message) toast(message, 'info', 4500);
}
async function unusedOrgCode() {
  for (let i = 0; i < 6; i++) {
    const code = genGroupCode();
    try { const snap = await _fbDb.collection('orgs').doc(code).get(); if (!snap.exists) return code; } catch { return code; }
  }
  return genGroupCode();
}
function newOrgDoc({ code, name, kind, school, color, description, ownerUid, ownerTitle = '' }) {
  const now = Date.now();
  return {
    v: 1, code, name, kind, school, schoolKey: normKey(school), color, description,
    createdBy: ownerUid, createdAt: now, updatedAt: now,
    memberUids: [ownerUid], officerUids: [ownerUid], people: { [ownerUid]: { name: myGroupName(), joinedAt: now, title: cleanStr(ownerTitle, ORG_TITLE_MAX) } },
    titles: {}, events: {}, announcements: {}, rsvp: {}, files: {},
  };
}

/* ── Calendar, dashboard, reminders ────────────────────────────── */
// Events that belong on your own calendar: anything you haven't said no to.
function orgEventsOnDate(dateIso) {
  if (typeof allOrgs !== 'function') return [];
  return allOrgs().filter(o => !o.hideCalendar).flatMap(o => orgEventList(o).filter(e => e.date === dateIso && myOrgRsvp(o, e.id) !== 'no').map(e => ({
    id: e.id, code: o.code, title: e.title, start: e.start || null, end: e.end || null, color: orgColor(o), kind: 'org', orgName: o.name, required: !!e.required, category: e.category,
    action: `openOrgEvent('${o.code}','${e.id}')`,
  })));
}
function orgUpcomingForMe(days = 7) {
  const end = addDays(todayIso(), days);
  return allOrgs().flatMap(o => upcomingOrgEvents(o).filter(e => e.date <= end && myOrgRsvp(o, e.id) !== 'no').map(e => ({ o, e })))
    .sort((a, b) => (a.e.date + (a.e.start || '')).localeCompare(b.e.date + (b.e.start || '')));
}
function dashboardOrgsWidget() {
  const orgs = allOrgs();
  if (!orgs.length) return '';
  const rows = orgUpcomingForMe(10).slice(0, 4);
  const unread = orgs.map(o => [o, orgUnreadCount(o)]).filter(([, n]) => n);
  return `
    <div class="card card-pad">
      <div class="flex-between mb-8"><h3 class="sg-h3">Clubs & teams</h3><button class="sg-link" onclick="setState({route:'orgs',subRoute:null})">All →</button></div>
      ${unread.length ? `<div class="sg-dash-unread">${unread.map(([o, n]) => `<button class="pill sg-unread-pill" onclick="openOrg('${o.code}','announcements')"><span class="sg-unread-dot"></span>${esc(o.name)} · ${n} new</button>`).join('')}</div>` : ''}
      ${rows.length ? rows.map(({ o, e }) => `
        <div class="list-row sg-session-row" style="--course:${esc(orgColor(o))}" onclick="openOrgEvent('${o.code}','${e.id}')">
          ${dateTile(e.date)}
          <div class="row-title"><div class="sg-strong">${esc(e.title)}${e.required ? ' <span class="org-required">Required</span>' : ''}</div><div class="row-meta">${esc(o.name)}${e.start ? ` · ${fmtTime(e.start)}` : ''}</div></div>
        </div>`).join('') : '<p class="small muted">Nothing on the calendar in the next 10 days.</p>'}
    </div>`;
}

/* ── Navigation ────────────────────────────────────────────────── */
function openOrg(code, tab) { setState({ route: 'orgs', subRoute: code, orgTab: tab || 'overview' }); window.scrollTo(0, 0); if (tab === 'announcements') markOrgSeen(code); }
function openOrgEvent(code, eventId) { openOrg(code, 'events'); setTimeout(() => showOrgEventModal(code, eventId), 60); }

/* ── Clubs & teams page ────────────────────────────────────────── */
function pageOrgs() {
  if (state.subRoute) {
    const o = findOrg(state.subRoute);
    if (o) return pageOrgDetail(o);
  }
  const orgs = allOrgs();
  return `
    ${pageHead('Clubs & Teams', 'Your club, team, or chapter’s calendar, right next to your classes.', `
      <button class="btn btn-sm" onclick="openJoinOrgModal()">${icon('user-plus', 13, 1.8)} Join with code</button>
      <button class="btn btn-primary" onclick="openCreateOrgModal()">+ Start one</button>
    `)}
    ${!fbConfigured() || cloudGroupsEnabled() ? '' : `<div class="sg-callout mb-16"><span>${icon('sparkles', 14, 1.8)}</span><div class="small">You’re looking around without an account, so anything you make here disappears when you close the tab. <a href="login.html">Log in</a> to invite members.</div></div>`}
    ${orgs.length ? `
      ${orgUpcomingForMe(7).length ? `<div class="card card-pad mb-16"><h3 class="sg-h3 mb-8">This week</h3>${orgUpcomingForMe(7).slice(0, 6).map(({ o, e }) => orgEventRow(o, e, { showOrg: true })).join('')}</div>` : ''}
      <div class="sg-section-label">Yours</div>
      <div class="grid grid-3">${orgs.map(orgIndexCard).join('')}</div>
    ` : orgsEmptyHero()}
    <div class="sg-pricing-note small muted">${icon('users', 13, 1.8)} Bringing your whole team or chapter? <a href="${GROUP_PRICING_URL}" target="_blank" rel="noopener">Group pricing</a> covers every member at a lower rate.</div>
  `;
}
function orgsEmptyHero() {
  const features = [
    ['calendar', 'One calendar for everyone', 'Meetings, practices, games, and deadlines land on every member’s Semester HQ calendar.'],
    ['check-square', 'See who’s going', 'Everyone RSVPs, and you can see who’s coming, who can’t, and who hasn’t answered.'],
    ['message-circle', 'Chat, announcements, and files', 'Talk in one place, post updates that get seen, and share forms and schedules.'],
    ['shield', 'Officers and titles', 'Officers run the calendar. Everyone’s title, like President or Treasurer, shows next to their name.'],
  ];
  return `
    <div class="card sg-hero">
      <div class="sg-hero-copy">
        <div class="sg-eyebrow">${icon('shield', 13, 1.8)} Clubs & Teams</div>
        <h3 class="sg-hero-title">Your org’s calendar, in everyone’s planner.</h3>
        <p class="muted">For clubs, sports teams, sororities, fraternities, etc. Officers post it once, and it shows up for every member next to their classes and deadlines.</p>
        <div class="sg-hero-actions">
          <button class="btn btn-primary" onclick="openCreateOrgModal()">+ Start a club or team</button>
          <button class="btn" onclick="openJoinOrgModal()">Join with code</button>
        </div>
        ${!cloudGroupsEnabled() ? `<button class="btn btn-ghost btn-sm sg-sample-btn" onclick="createSampleOrg()">${icon('eye', 13, 1.8)} Explore a sample club first</button>` : ''}
      </div>
      <div class="sg-hero-features">${features.map(([ic, t, d]) => `<div class="sg-feature"><span class="sg-feature-ic">${icon(ic, 16, 1.7)}</span><div><div class="sg-strong">${t}</div><div class="small muted">${d}</div></div></div>`).join('')}</div>
    </div>`;
}
function orgIndexCard(o) {
  const next = upcomingOrgEvents(o)[0];
  const unread = orgUnreadCount(o);
  const chatUnread = orgChatUnread(o);
  const kind = orgKind(o);
  return `
    <div class="card sg-card org-card" style="--org:${esc(orgColor(o))}" role="button" tabindex="0" onclick="openOrg('${o.code}')" onkeydown="if(event.key==='Enter')openOrg('${o.code}')">
      <div class="org-card-band" aria-hidden="true"><span class="org-crest">${orgMonogram(o)}</span></div>
      <div class="sg-card-top">
        <div style="min-width:0">
          <div class="sg-card-name">${esc(o.name)}</div>
          <div class="small muted">${[kind[1], o.school ? esc(o.school) : '', o.sample ? 'Sample' : ''].filter(Boolean).join(' · ')}</div>
        </div>
        ${unread || chatUnread ? `<span class="sg-unread-dot" title="${[unread ? `${unread} new announcement${unread === 1 ? '' : 's'}` : '', chatUnread ? 'New messages' : ''].filter(Boolean).join(', ')}"></span>` : ''}
      </div>
      <div class="sg-card-line"><span class="sg-card-ic">${icon('calendar', 13)}</span>${next ? `<span><span class="sg-strong">${esc(next.title)}</span><br><span class="muted">${fmtSessionDay(next.date)}${next.start ? ` · ${fmtTime(next.start)}` : ''}</span></span>` : '<span class="muted">Nothing scheduled</span>'}</div>
      <div class="sg-card-foot"><span class="small muted">${o.loading ? 'Loading…' : `${o.memberUids.length} member${o.memberUids.length === 1 ? '' : 's'}`}${isOrgOfficer(o) ? ' · You’re an officer' : ''}</span></div>
    </div>`;
}
function orgEventRow(o, e, { showOrg = false } = {}) {
  const mine = myOrgRsvp(o, e.id);
  const counts = orgRsvpCounts(o, e.id);
  const past = orgEventPast(e);
  return `
    <div class="list-row sg-session-row org-event-row ${past ? 'is-past' : ''}" style="--course:${esc(orgColor(o))}" onclick="showOrgEventModal('${o.code}','${e.id}')">
      ${dateTile(e.date)}
      <div class="row-title">
        <div class="sg-strong">${esc(e.title)}${e.required ? ' <span class="org-required">Required</span>' : ''}</div>
        <div class="row-meta">${[showOrg ? esc(o.name) : '', esc(ORG_EVENT_CATEGORIES.find(c => c[0] === e.category)?.[1] || ''), e.start ? `${fmtTime(e.start)}${e.end ? `–${fmtTime(e.end)}` : ''}` : '', e.location ? esc(e.location) : ''].filter(Boolean).join(' · ')}</div>
      </div>
      ${!past ? orgRsvpControl(o, e, mine) : ''}
      <span class="small muted org-counts" title="${counts.yes} going, ${counts.no} can’t, ${counts.none} haven’t answered">${counts.yes} going</span>
    </div>`;
}
// Who's going, who can't, and (for officers, who follow up) who hasn't answered.
function orgAttendanceHtml(o, e) {
  const people = orgPeople(o);
  const answer = (p) => o.rsvp?.[p.uid]?.[e.id] || '';
  const group = (label, list, open = true) => `
    <details class="org-rsvp-group" ${open ? 'open' : ''}>
      <summary><span class="sg-strong">${label}</span><span class="assign-count">${list.length}</span></summary>
      ${list.length ? `<div class="org-rsvp-list">${list.map(p => `<div class="sg-person">${personAvatar(p.uid, p.name, 24, p.officer ? orgColor(o) : '#6b6b6b')}<div class="row-title small">${esc(p.name)}${p.uid === myOrgUid(o) ? ' <span class="muted">(you)</span>' : ''}</div><span class="small muted">${esc(orgRoleLabel(o, p))}</span></div>`).join('')}</div>` : '<div class="small muted org-rsvp-empty">No one yet.</div>'}
    </details>`;
  const going = people.filter(p => answer(p) === 'yes'), cant = people.filter(p => answer(p) === 'no'), none = people.filter(p => !answer(p));
  return `
    ${group(orgEventPast(e) ? 'Said they’d go' : 'Going', going)}
    ${group('Can’t make it', cant, cant.length <= 8)}
    ${isOrgOfficer(o)
      ? `${group('Haven’t answered', none, false)}${none.length && !orgEventPast(e) ? `<button class="btn btn-sm mt-8" onclick="remindToRsvp('${o.code}','${e.id}')">${icon('megaphone', 13, 1.8)} Remind them to RSVP</button>` : ''}`
      : none.length ? `<div class="small muted mt-8">${none.length} ${none.length === 1 ? 'person hasn’t' : 'people haven’t'} answered yet.</div>` : ''}`;
}
function remindToRsvp(code, eventId) {
  const o = findOrg(code);
  const e = o && orgEventList(o).find(x => x.id === eventId);
  if (!e) return;
  openAnnouncementModal(code, `Please RSVP for ${e.title} on ${fmtDate(e.date, { weekday: 'long', month: 'short', day: 'numeric' })}${e.start ? ` at ${fmtTime(e.start)}` : ''}. Open Clubs & Teams in Semester HQ and tap Going or Can’t.`);
}
function orgRsvpControl(o, e, mine = myOrgRsvp(o, e.id)) {
  const opt = (val, label) => `<button class="${mine === val ? 'active' : ''}" aria-pressed="${mine === val}" onclick="event.stopPropagation();setOrgRsvp('${o.code}','${e.id}','${val}')">${label}</button>`;
  return `<div class="segmented sg-rsvp" role="group" aria-label="RSVP to ${esc(e.title)}">${opt('yes', 'Going')}${opt('no', 'Can’t')}</div>`;
}
async function setOrgRsvp(code, eventId, val) {
  const o = findOrg(code);
  if (!o || !safeId(eventId)) return;
  const u = myOrgUid(o);
  const current = myOrgRsvp(o, eventId);
  if (val === 'yes' && current !== 'yes') playUiSound('tap');
  const ok = await orgWrite(code, { [`rsvp.${u}.${eventId}`]: current === val ? GW_DELETE : val });
  // Answering from inside the event's popup: refresh it so you show up in the right list.
  const open = window._orgEventModal;
  if (ok && open?.code === code && open.eventId === eventId && $('#modal .org-rsvp-group')) showOrgEventModal(code, eventId);
}

/* ── Org page ──────────────────────────────────────────────────── */
function pageOrgDetail(o) {
  const tab = ORG_TABS.some(([k]) => k === state.orgTab) ? state.orgTab : 'overview';
  const unread = orgUnreadCount(o);
  if (tab === 'announcements' && unread) setTimeout(() => markOrgSeen(o.code), 0);
  const kind = orgKind(o);
  const chatUnread = orgChatUnread(o);
  const body = { overview: orgOverviewTab, events: orgEventsTab, announcements: orgAnnouncementsTab, chat: orgChatTab, files: orgFilesTab, members: orgMembersTab }[tab];
  return `
    <div style="--org:${esc(orgColor(o))}">
    <button class="btn btn-ghost btn-sm sg-back" onclick="setState({subRoute:null})">${icon('arrow-left', 14, 1.9)} Clubs & teams</button>
    <div class="org-head">
      <span class="org-crest large" aria-hidden="true">${orgMonogram(o)}</span>
      <div style="min-width:0;flex:1">
        <div class="sg-eyebrow">${[kind[1], o.school ? esc(o.school) : '', `${o.memberUids.length} member${o.memberUids.length === 1 ? '' : 's'}`, o.sample ? 'Sample' : ''].filter(Boolean).join(' · ')}</div>
        <h2 class="sg-title">${esc(o.name)}</h2>
        ${o.description ? `<p class="small muted sg-desc">${esc(o.description)}</p>` : ''}
      </div>
      <div class="sg-head-actions">
        ${signInHeaderButton()}
        ${isOrgOfficer(o) ? `<button class="btn btn-sm" onclick="openOrgEventModal('${o.code}')">+ Event</button><button class="btn btn-sm" onclick="openAnnouncementModal('${o.code}')">${icon('megaphone', 13, 1.8)} Announce</button>` : ''}
        <button class="btn btn-primary btn-sm" onclick="openOrgInviteModal('${o.code}')">${icon('user-plus', 13, 1.8)} Invite</button>
        <button class="btn btn-icon" aria-label="Settings for ${esc(o.name)}" title="Settings" onclick="openOrgSettingsModal('${o.code}')">${icon('settings', 16, 1.6)}</button>
      </div>
    </div>
    ${o.loading ? '<div class="small muted mb-16">Loading…</div>' : ''}
    <div class="sg-tabs" role="tablist">
      ${ORG_TABS.map(([k, label]) => `<button role="tab" aria-selected="${tab === k}" class="${tab === k ? 'active' : ''}" onclick="setState({orgTab:'${k}'})">${label}${(k === 'announcements' && unread || k === 'chat' && chatUnread) && tab !== k ? '<span class="sg-tab-dot" aria-label="new"></span>' : ''}</button>`).join('')}
    </div>
    <div class="sg-tab-body">${body(o)}</div>
    </div>`;
}
function orgOverviewTab(o) {
  const upcoming = upcomingOrgEvents(o);
  const next = upcoming[0];
  const anns = orgAnnouncementList(o).slice(0, 3);
  const officers = orgPeople(o).filter(p => p.officer);
  const unanswered = isOrgOfficer(o) ? upcoming.filter(e => e.required).slice(0, 3).map(e => ({ e, c: orgRsvpCounts(o, e.id) })).filter(x => x.c.none) : [];
  return `
    <div class="sg-overview">
      <div class="sg-col">
        ${next ? `
          <div class="card sg-next org-next">
            ${(() => { const d = new Date(next.date + 'T00:00:00'); return `<div class="sg-next-date"><span>${d.toLocaleDateString('en-US', { weekday: 'short' })}</span><strong>${d.getDate()}</strong><span>${d.toLocaleDateString('en-US', { month: 'short' })}</span></div>`; })()}
            <div class="sg-next-body">
              <div class="sg-eyebrow">Next up · ${fmtSessionDay(next.date)}${next.required ? ' · <span class="org-required">Required</span>' : ''}</div>
              <div class="sg-next-title">${esc(next.title)}</div>
              <div class="small muted sg-meta-line">${next.start ? `<span>${icon('clock', 12, 1.8)} ${fmtTime(next.start)}${next.end ? `–${fmtTime(next.end)}` : ''}</span>` : ''}${next.location ? `<span>${icon('map-pin', 12, 1.8)} ${linkifyWhere(next.location)}</span>` : ''}</div>
              ${next.notes ? `<div class="small sg-notes">${linkifyText(next.notes)}</div>` : ''}
              <div class="sg-next-foot">${orgRsvpControl(o, next)}${(() => { const goingUids = orgPeople(o).filter(p => o.rsvp?.[p.uid]?.[next.id] === 'yes'); return `<button class="sg-link org-going-link" onclick="showOrgEventModal('${o.code}','${next.id}')" aria-label="See who’s going to ${esc(next.title)}">${goingUids.length ? `<span class="sg-stack">${goingUids.slice(0, 4).map(p => personAvatar(p.uid, p.name, 22, p.officer ? orgColor(o) : '#6b6b6b')).join('')}</span>` : ''}${goingUids.length} going · See who</button>`; })()}</div>
            </div>
          </div>` : `
          <div class="card card-pad sg-next-empty">
            <div class="sg-eyebrow">Calendar</div>
            <div class="sg-next-title">Nothing scheduled yet</div>
            <p class="small muted">${isOrgOfficer(o) ? 'Add your first meeting or practice and it shows up on every member’s calendar.' : 'When officers add events, they’ll show up here and on your calendar.'}</p>
            ${isOrgOfficer(o) ? `<button class="btn btn-primary btn-sm mt-8" onclick="openOrgEventModal('${o.code}')">+ Add an event</button>` : ''}
          </div>`}
        <div class="card card-pad">
          <div class="flex-between mb-8"><h3 class="sg-h3">Coming up</h3><button class="sg-link" onclick="setState({orgTab:'events'})">Full calendar →</button></div>
          ${upcoming.slice(1, 6).map(e => orgEventRow(o, e)).join('') || '<p class="small muted">Nothing else scheduled.</p>'}
        </div>
      </div>
      <div class="sg-col">
        ${unanswered.length ? `<div class="card card-pad org-officer-card"><div class="sg-eyebrow">${icon('shield', 12, 1.8)} Officer view</div>${unanswered.map(({ e, c }) => `<div class="small mt-8"><span class="sg-strong">${esc(e.title)}</span>: ${c.none} haven’t RSVPed. <button class="sg-link" onclick="showOrgEventModal('${o.code}','${e.id}')">See who</button></div>`).join('')}</div>` : ''}
        <div class="card card-pad">
          <div class="flex-between mb-8"><h3 class="sg-h3">Announcements</h3>${isOrgOfficer(o) ? `<button class="sg-link" onclick="openAnnouncementModal('${o.code}')">+ Post</button>` : `<button class="sg-link" onclick="setState({orgTab:'announcements'})">All →</button>`}</div>
          ${anns.length ? anns.map(a => orgAnnouncementHtml(o, a, { compact: true })).join('') : '<p class="small muted">No announcements yet.</p>'}
        </div>
        ${(() => { const files = orgFileList(o).slice(0, 3); return files.length ? `
        <div class="card card-pad">
          <div class="flex-between mb-8"><h3 class="sg-h3">Files</h3><button class="sg-link" onclick="setState({orgTab:'files'})">All ${orgFileList(o).length} →</button></div>
          ${files.map(f => orgFileRow(o, f, { compact: true })).join('')}
        </div>` : ''; })()}
        <div class="card card-pad">
          <div class="flex-between mb-8"><h3 class="sg-h3">Officers</h3><button class="sg-link" onclick="setState({orgTab:'members'})">${o.memberUids.length} members →</button></div>
          ${officers.map(p => `<div class="sg-person">${personAvatar(p.uid, p.name, 28, orgColor(o))}<div class="row-title small">${esc(p.name)}${p.uid === myOrgUid(o) ? ' <span class="muted">(you)</span>' : ''}</div><span class="small muted">${esc(orgRoleLabel(o, p))}</span></div>`).join('')}
        </div>
        <label class="checkbox-row small org-cal-toggle"><input type="checkbox" ${o.hideCalendar ? '' : 'checked'} onchange="setOrgOnCalendar('${o.code}',this.checked)"><span>Show ${esc(o.name)} events on my calendar</span></label>
      </div>
    </div>`;
}
function setOrgOnCalendar(code, on) { const e = orgEntry(code); if (!e) return; e.hideCalendar = !on; touch(); }
function orgEventsTab(o) {
  const all = orgEventList(o);
  const upcoming = all.filter(e => !orgEventPast(e));
  const past = all.filter(orgEventPast).reverse();
  const byMonth = [];
  upcoming.forEach(e => { const key = e.date.slice(0, 7); let g = byMonth.find(x => x.key === key); if (!g) byMonth.push(g = { key, label: fmtDate(e.date, { month: 'long', year: 'numeric' }), items: [] }); g.items.push(e); });
  return `
    <div class="sg-toolbar">
      <div class="small muted">${o.hideCalendar ? 'These events are hidden from your calendar.' : 'Events you haven’t said no to are on your calendar.'}</div>
      <div class="flex-gap">
        ${upcoming.length ? `<button class="btn btn-sm" onclick="downloadOrgIcs('${o.code}')">${icon('download', 13, 1.8)} Add all to calendar app</button>` : ''}
        ${isOrgOfficer(o) ? `<button class="btn btn-primary btn-sm" onclick="openOrgEventModal('${o.code}')">+ Event</button>` : ''}
      </div>
    </div>
    ${byMonth.length ? byMonth.map(g => `<div class="sg-section-label">${esc(g.label)}</div><div class="card card-pad mb-16">${g.items.map(e => orgEventRow(o, e)).join('')}</div>`).join('') : emptyState(icon('calendar', 24, 1.4), 'No upcoming events', isOrgOfficer(o) ? `<button class="btn btn-primary btn-sm" onclick="openOrgEventModal('${o.code}')">+ Add an event</button>` : '', isOrgOfficer(o) ? 'Weekly meetings can repeat, so you only add them once.' : '')}
    ${past.length ? `<details class="sg-past"><summary class="small muted">Past events (${past.length})</summary><div class="card card-pad">${past.slice(0, 40).map(e => orgEventRow(o, e)).join('')}</div></details>` : ''}
  `;
}
function orgAnnouncementHtml(o, a, { compact = false } = {}) {
  const text = compact && a.text.length > 220 ? a.text.slice(0, 220) + '…' : a.text;
  return `
    <div class="org-ann ${a.pinned ? 'is-pinned' : ''}">
      <div class="flex-between">
        <div class="small"><span class="sg-strong">${esc(a.name)}</span> <span class="muted">· ${fmtRelativeTime(a.at)}</span>${a.pinned ? ` <span class="org-pin">${icon('pin', 11, 1.8)} Pinned</span>` : ''}</div>
        ${!compact && isOrgOfficer(o) ? `<div class="flex-gap"><button class="btn btn-ghost btn-icon btn-sm" aria-label="${a.pinned ? 'Unpin' : 'Pin'} announcement" onclick="pinAnnouncement('${o.code}','${a.id}',${!a.pinned})">${icon('pin', 13, 1.8)}</button><button class="btn btn-ghost btn-icon btn-sm" aria-label="Delete announcement" onclick="deleteAnnouncement('${o.code}','${a.id}')">${icon('trash', 13)}</button></div>` : ''}
      </div>
      <div class="org-ann-text">${linkifyText(text)}</div>
    </div>`;
}
function orgAnnouncementsTab(o) {
  const anns = orgAnnouncementList(o);
  return `
    ${isOrgOfficer(o) ? `<div class="sg-toolbar"><div class="small muted">Members see new announcements on their dashboard.</div><button class="btn btn-primary btn-sm" onclick="openAnnouncementModal('${o.code}')">${icon('megaphone', 13, 1.8)} New announcement</button></div>` : ''}
    ${anns.length ? `<div class="card card-pad">${anns.map(a => orgAnnouncementHtml(o, a)).join('')}</div>` : emptyState(icon('megaphone', 24, 1.4), 'No announcements yet', '', isOrgOfficer(o) ? 'Dues reminders, carpool plans, last-minute changes.' : 'Officers’ updates will show up here.')}
  `;
}
function orgMembersTab(o) {
  const people = orgPeople(o);
  const me = myOrgUid(o);
  const officerCount = people.filter(p => p.officer).length;
  // Someone who joined with a position ("Treasurer") but isn't an officer
  // yet: only the founder can give officer access, so the founder is asked.
  const requests = isOrgOwner(o) ? people.filter(p => p.title && !p.officer && !p.reviewed) : [];
  return `
    <div class="sg-toolbar"><div class="small muted">${people.length} member${people.length === 1 ? '' : 's'} · ${officerCount} officer${officerCount === 1 ? '' : 's'}</div><button class="btn btn-primary btn-sm" onclick="openOrgInviteModal('${o.code}')">${icon('user-plus', 13, 1.8)} Invite</button></div>
    ${requests.map(p => `
      <div class="sg-callout org-request mb-8"><span>${icon('shield', 14, 1.8)}</span>
        <div class="small" style="flex:1"><span class="sg-strong">${esc(p.name)}</span> joined as <span class="sg-strong">${esc(p.title)}</span>. Make them an officer so they can add events, post announcements, and share files?</div>
        <div class="flex-gap"><button class="btn btn-sm" onclick="reviewOrgRole('${o.code}','${esc(p.uid)}',false)">Not now</button><button class="btn btn-primary btn-sm" onclick="reviewOrgRole('${o.code}','${esc(p.uid)}',true)">Make officer</button></div>
      </div>`).join('')}
    <div class="card card-pad">
      ${people.map(p => `
        <div class="sg-person org-member">
          ${personAvatar(p.uid, p.name, 30, p.officer ? orgColor(o) : '#6b6b6b')}
          <div class="row-title"><div class="small sg-strong">${esc(p.name)}${p.uid === me ? ' <span class="muted">(you)</span>' : ''}</div><div class="small muted">${esc(orgRoleLabel(o, p))}${p.officer && p.title ? ` · <span class="org-officer-tag">${icon('shield', 11, 1.9)} ${p.owner ? 'Founder' : 'Officer'}</span>` : ''}</div></div>
          ${isOrgOfficer(o) && !o.local ? `<button class="btn btn-ghost btn-sm" onclick="openMemberRoleModal('${o.code}','${esc(p.uid)}')">Manage</button>` : p.uid === me ? `<button class="btn btn-ghost btn-sm" onclick="openMyOrgTitleModal('${o.code}')">Edit title</button>` : ''}
        </div>`).join('')}
    </div>
    <details class="card card-pad org-roles-help mt-16">
      <summary class="sg-strong small">How roles work</summary>
      <div class="small muted mt-8">
        <p><span class="sg-strong">Founder:</span> whoever started ${esc(o.name)}. The founder is an officer and is the only one who can make someone else an officer.</p>
        <p><span class="sg-strong">Officers:</span> add events, post announcements, share files, see who hasn’t RSVPed, and manage members.</p>
        <p><span class="sg-strong">${esc(orgGeneralLabel(o))}:</span> RSVP, chat, and open shared files. Events show up on their calendar.</p>
        <p>Anyone can add a title, like Treasurer or Captain, that shows next to their name. When someone joins with a title, the founder is asked whether they should be an officer.</p>
      </div>
    </details>`;
}
async function reviewOrgRole(code, memberUid, makeOfficer) {
  const o = findOrg(code);
  if (!o || !isOrgOwner(o) || !safeId(memberUid)) return;
  const ops = { [`people.${memberUid}.reviewed`]: true };
  if (makeOfficer) ops.officerUids = gwUnion(memberUid);
  const name = orgPersonByUid(o, memberUid)?.name || 'They';
  if (await orgWrite(code, ops)) toast(makeOfficer ? `${name} is an officer now` : 'Got it. You can make them an officer anytime from Manage.');
}
function openMyOrgTitleModal(code) {
  const o = findOrg(code);
  if (!o) return;
  const me = myOrgUid(o);
  const current = orgTitleOf(o, me);
  openModal(`
    <div class="modal-head"><h3>Your title in ${esc(o.name)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      ${orgRoleFieldsHtml(o, current, 'mt')}
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveMyOrgTitle('${code}')">Save</button></div>
  `);
}
// "General body" or a position, used when joining and when editing your own title.
function orgRoleFieldsHtml(o, title, prefix) {
  const hasRole = !!title;
  return `
    <div class="field" style="margin-bottom:0"><label>Your role</label>
      <div class="segmented org-role-pick" role="radiogroup" aria-label="Your role">
        <button type="button" role="radio" aria-checked="${!hasRole}" class="${hasRole ? '' : 'active'}" onclick="pickOrgRole('${prefix}',false)">${esc(orgGeneralLabel(o))}</button>
        <button type="button" role="radio" aria-checked="${hasRole}" class="${hasRole ? 'active' : ''}" onclick="pickOrgRole('${prefix}',true)">I have a position</button>
      </div>
      <div id="${prefix}-title-wrap" class="mt-8" ${hasRole ? '' : 'hidden'}>
        <input class="input" id="${prefix}-title" maxlength="${ORG_TITLE_MAX}" value="${esc(title)}" placeholder="Treasurer, Captain, Social chair…" aria-label="Your title">
        <div class="chip-row mt-8">${ORG_TITLE_SUGGESTIONS.map(t => `<button type="button" class="chip" onclick="$('#${prefix}-title').value='${t}'">${t}</button>`).join('')}</div>
        <div class="small muted mt-8">Shows next to your name.${isOrgOfficer(o) ? '' : ' If you should be an officer, the founder can give you access to post events.'}</div>
      </div>
    </div>`;
}
function pickOrgRole(prefix, hasRole) {
  const wrap = $(`#${prefix}-title-wrap`);
  if (wrap) wrap.hidden = !hasRole;
  $$('.org-role-pick button').forEach((b, i) => { const on = (i === 1) === hasRole; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); });
  if (hasRole) setTimeout(() => $(`#${prefix}-title`)?.focus(), 30);
}
function chosenOrgTitle(prefix) {
  const wrap = $(`#${prefix}-title-wrap`);
  return wrap && !wrap.hidden ? cleanStr($(`#${prefix}-title`)?.value, ORG_TITLE_MAX) : '';
}
async function saveMyOrgTitle(code) {
  const o = findOrg(code);
  if (!o) return;
  const me = myOrgUid(o);
  const title = chosenOrgTitle('mt');
  // A new title is worth the founder's review again, unless it's being cleared.
  const ops = { [`people.${me}.title`]: title, [`people.${me}.reviewed`]: title ? isOrgOfficer(o) : GW_DELETE };
  closeModal();
  if (await orgWrite(code, ops)) toast(title ? `Your title is ${title}` : `You’re listed as ${orgGeneralLabel(o).toLowerCase()}`);
}

/* ── Events ────────────────────────────────────────────────────── */
function showOrgEventModal(code, eventId) {
  const o = findOrg(code);
  const e = o && orgEventList(o).find(x => x.id === eventId);
  if (!e) return;
  const past = orgEventPast(e);
  const same = window._orgEventModal?.code === code && window._orgEventModal.eventId === eventId;
  const openGroups = same ? $$('#modal .org-rsvp-group').map(d => d.open) : null;
  window._orgEventModal = { code, eventId };
  openModal(`
    <div class="modal-head"><h3>${esc(e.title)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="sg-eyebrow">${esc(o.name)} · ${esc(ORG_EVENT_CATEGORIES.find(c => c[0] === e.category)?.[1] || 'Event')}${e.required ? ' · <span class="org-required">Required</span>' : ''}</div>
      <div class="small sg-meta-line mt-8">
        <span>${icon('calendar', 12, 1.8)} ${esc(fmtDateLong(e.date))}</span>
        ${e.start ? `<span>${icon('clock', 12, 1.8)} ${fmtTime(e.start)}${e.end ? `–${fmtTime(e.end)}` : ''}</span>` : ''}
        ${e.location ? `<span>${icon('map-pin', 12, 1.8)} ${linkifyWhere(e.location)}</span>` : ''}
      </div>
      ${e.notes ? `<div class="small sg-notes mt-8">${linkifyText(e.notes)}</div>` : ''}
      ${!past ? `<div class="flex-gap wrap mt-16" style="align-items:center">${orgRsvpControl(o, e)}<button class="btn btn-ghost btn-sm" onclick="downloadOrgIcs('${o.code}','${e.id}')">${icon('download', 13, 1.8)} Add to calendar app</button></div>` : ''}
      <div class="divider"></div>
      ${orgAttendanceHtml(o, e)}
    </div>
    ${isOrgOfficer(o) ? `<div class="modal-foot"><button class="btn btn-danger" style="margin-right:auto" onclick="deleteOrgEvent('${o.code}','${e.id}')">Delete</button><button class="btn" onclick="openOrgEventModal('${o.code}','${e.id}')">Edit</button><button class="btn btn-primary" onclick="closeModal()">Done</button></div>` : ''}
  `, { onClose: () => { window._orgEventModal = null; } });
  if (openGroups) $$('#modal .org-rsvp-group').forEach((d, i) => { if (openGroups[i] != null) d.open = openGroups[i]; });
}
function openOrgEventModal(code, eventId) {
  const o = findOrg(code);
  if (!o || !isOrgOfficer(o)) return;
  const e = eventId ? orgEventList(o).find(x => x.id === eventId) : null;
  const v = e || { title: '', category: 'meeting', date: todayIso(), start: '19:00', end: '20:00', location: '', required: false, notes: '' };
  openModal(`
    <div class="modal-head"><h3>${e ? 'Edit event' : `New event for ${esc(o.name)}`}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="field-row">
        <div class="field"><label for="oe-title">What</label><input class="input" id="oe-title" maxlength="120" value="${esc(v.title)}" placeholder="Chapter meeting"></div>
        <div class="field" style="max-width:220px"><label for="oe-cat">Type</label><select class="select" id="oe-cat">${ORG_EVENT_CATEGORIES.map(([k, l]) => `<option value="${k}" ${v.category === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="oe-date">Date</label><input class="input" type="date" id="oe-date" value="${v.date}"></div>
        <div class="field"><label for="oe-start">Starts</label><input class="input" type="time" id="oe-start" value="${v.start || ''}"></div>
        <div class="field"><label for="oe-end">Ends</label><input class="input" type="time" id="oe-end" value="${v.end || ''}"></div>
      </div>
      <div class="field"><label for="oe-where">Where</label><input class="input" id="oe-where" maxlength="120" value="${esc(v.location)}" placeholder="Student Union 210, or a Zoom link"></div>
      <div class="field"><label for="oe-notes">Details <span class="muted">(optional)</span></label><textarea class="input" id="oe-notes" maxlength="1000" placeholder="Wear your jersey. Dues are due at the door.">${esc(v.notes)}</textarea></div>
      <label class="checkbox-row small"><input type="checkbox" id="oe-required" ${v.required ? 'checked' : ''}><span>Required for members</span></label>
      ${!e ? `<div class="field-row mt-8" style="align-items:center"><label class="checkbox-row small" style="margin:0"><input type="checkbox" id="oe-repeat" onchange="$('#oe-weeks').disabled=!this.checked"><span>Repeat weekly for</span></label><select class="select" id="oe-weeks" style="max-width:110px" disabled>${[2, 4, 6, 8, 10, 12, 15].map(n => `<option value="${n}" ${n === 8 ? 'selected' : ''}>${n} weeks</option>`).join('')}</select></div>` : ''}
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="oe-save" onclick="saveOrgEvent('${o.code}',${e ? `'${e.id}'` : 'null'})">${e ? 'Save' : 'Add to calendar'}</button></div>
  `);
}
async function saveOrgEvent(code, eventId) {
  const o = findOrg(code);
  if (!o || !isOrgOfficer(o)) return;
  const title = $('#oe-title').value.trim();
  const date = $('#oe-date').value;
  if (!title || !date) { toast('Add a name and a date', 'error'); return; }
  const base = { title: title.slice(0, 120), category: $('#oe-cat').value, start: $('#oe-start').value || '', end: $('#oe-end').value || '', location: $('#oe-where').value.trim().slice(0, 120), notes: $('#oe-notes').value.trim().slice(0, 1000), required: $('#oe-required').checked };
  const ops = {};
  if (eventId) {
    Object.entries({ ...base, date }).forEach(([k, val]) => { ops[`events.${eventId}.${k}`] = val; });
  } else {
    const weeks = $('#oe-repeat')?.checked ? Number($('#oe-weeks').value) || 1 : 1;
    const seriesId = weeks > 1 ? uid() : null;
    for (let i = 0; i < weeks; i++) {
      const id = uid();
      ops[`events.${id}`] = { id, ...base, date: addDays(date, i * 7), seriesId, createdBy: myOrgUid(o), createdAt: Date.now() };
    }
  }
  setBtnLoading($('#oe-save'), true);
  if (await orgWrite(code, ops)) { closeModal(); const n = Object.keys(ops).length; toast(eventId ? 'Event updated' : n > 1 ? `Added ${n} weekly events` : 'Event added. Members will see it on their calendar.'); }
  else setBtnLoading($('#oe-save'), false, eventId ? 'Save' : 'Add to calendar');
}
function deleteOrgEvent(code, eventId) {
  const o = findOrg(code);
  const e = o && orgEventList(o).find(x => x.id === eventId);
  if (!e) return;
  const series = e.seriesId ? orgEventList(o).filter(x => x.seriesId === e.seriesId && x.date >= e.date) : [];
  openModal(`
    <div class="modal-body" style="padding-top:22px"><p style="font-size:14px">Delete “${esc(e.title)}” on ${esc(fmtDate(e.date))}? It comes off every member’s calendar.</p></div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      ${series.length > 1 ? `<button class="btn btn-danger" onclick="removeOrgEvents('${code}',${JSON.stringify(series.map(x => x.id)).replace(/"/g, '&quot;')})">This and ${series.length - 1} after</button>` : ''}
      <button class="btn btn-danger" onclick="removeOrgEvents('${code}',['${e.id}'])">Delete event</button>
    </div>
  `);
}
async function removeOrgEvents(code, ids) {
  const ops = {};
  ids.filter(safeId).forEach(id => { ops[`events.${id}`] = GW_DELETE; });
  closeModal();
  if (await orgWrite(code, ops)) toast(ids.length > 1 ? `Deleted ${ids.length} events` : 'Event deleted');
}
function downloadOrgIcs(code, eventId) {
  const o = findOrg(code);
  if (!o) return;
  const list = orgEventList(o).filter(e => (eventId ? e.id === eventId : !orgEventPast(e)));
  const icsText = (v) => String(v || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Semester HQ//Clubs//EN'];
  list.forEach(e => {
    const d = e.date.replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${e.id}@${o.code}.semester-hq`, `DTSTAMP:${stamp}`,
      ...(e.start ? [`DTSTART:${d}T${e.start.replace(':', '')}00`, `DTEND:${d}T${(e.end || addMinutesHHMM(e.start, 60)).replace(':', '')}00`] : [`DTSTART;VALUE=DATE:${d}`]),
      `SUMMARY:${icsText(`${o.name}: ${e.title}`)}`, ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []), ...(e.notes ? [`DESCRIPTION:${icsText(e.notes)}`] : []), 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  a.download = `${o.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'club'}${eventId ? '-event' : ''}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ── Announcements ─────────────────────────────────────────────── */
function openAnnouncementModal(code, prefill = '') {
  const o = findOrg(code);
  if (!o || !isOrgOfficer(o)) return;
  openModal(`
    <div class="modal-head"><h3>Announcement to ${esc(o.name)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label for="an-text">Message</label><textarea class="input" id="an-text" maxlength="${ORG_ANNOUNCEMENT_MAX}" style="min-height:130px" placeholder="Practice moved to 6 tomorrow because of the storm.">${esc(prefill)}</textarea></div>
      <label class="checkbox-row small"><input type="checkbox" id="an-pin"><span>Pin to the top</span></label>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="an-post" onclick="postAnnouncement('${o.code}')">${icon('send', 13, 1.8)} Post</button></div>
  `);
}
async function postAnnouncement(code) {
  const o = findOrg(code);
  const text = $('#an-text').value.trim();
  if (!o || !text) { toast('Write something first', 'error'); return; }
  const id = uid();
  const ops = { [`announcements.${id}`]: { id, text: text.slice(0, ORG_ANNOUNCEMENT_MAX), uid: myOrgUid(o), name: myGroupName(), at: Date.now(), pinned: $('#an-pin').checked } };
  // Keep the document small: only the 40 newest announcements stay.
  orgAnnouncementList(o).filter(a => !a.pinned).slice(39).forEach(a => { ops[`announcements.${a.id}`] = GW_DELETE; });
  setBtnLoading($('#an-post'), true);
  if (await orgWrite(code, ops)) { closeModal(); playUiSound('send'); toast('Posted'); }
  else setBtnLoading($('#an-post'), false, 'Post');
}
function pinAnnouncement(code, id, pinned) { if (safeId(id)) orgWrite(code, { [`announcements.${id}.pinned`]: !!pinned }); }
function deleteAnnouncement(code, id) { if (safeId(id)) confirmDialog('Delete this announcement for everyone?', () => orgWrite(code, { [`announcements.${id}`]: GW_DELETE })); }

/* ── Members and roles ─────────────────────────────────────────── */
function openMemberRoleModal(code, memberUid) {
  const o = findOrg(code);
  const p = o && orgPeople(o).find(x => x.uid === memberUid);
  if (!p || !isOrgOfficer(o)) return;
  const me = myOrgUid(o);
  openModal(`
    <div class="modal-head"><h3>${esc(p.name)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label for="mr-title">Title <span class="muted">(shown next to their name)</span></label><input class="input" id="mr-title" maxlength="${ORG_TITLE_MAX}" value="${esc(p.title)}" placeholder="President, Captain, Treasurer…"><div class="small muted mt-4">Leave it blank to list them as ${esc(orgGeneralLabel(o).toLowerCase())}.</div></div>
      ${isOrgOwner(o) && !p.owner ? `<label class="checkbox-row small"><input type="checkbox" id="mr-officer" ${p.officer ? 'checked' : ''}><span>Officer: can add events, post announcements, share files, and manage members</span></label>` : `<p class="small muted">${p.owner ? 'Founder of this club.' : p.officer ? 'Officer.' : esc(orgGeneralLabel(o)) + '.'} ${isOrgOwner(o) ? '' : 'Only the founder can make someone an officer.'}</p>`}
    </div>
    <div class="modal-foot">
      ${!p.owner && p.uid !== me ? `<button class="btn btn-danger" style="margin-right:auto" onclick="removeOrgMember('${code}','${esc(p.uid)}')">Remove</button>` : ''}
      <button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveMemberRole('${code}','${esc(p.uid)}')">Save</button>
    </div>
  `);
}
async function saveMemberRole(code, memberUid) {
  const o = findOrg(code);
  if (!o || !safeId(memberUid)) return;
  const ops = { [`people.${memberUid}.title`]: cleanStr($('#mr-title').value, ORG_TITLE_MAX), [`titles.${memberUid}`]: GW_DELETE, [`people.${memberUid}.reviewed`]: true };
  const box = $('#mr-officer');
  if (box && isOrgOwner(o)) ops.officerUids = box.checked ? gwUnion(memberUid) : gwRemove(memberUid);
  closeModal();
  if (await orgWrite(code, ops)) toast('Saved');
}
function removeOrgMember(code, memberUid) {
  const o = findOrg(code);
  if (!o || !safeId(memberUid)) return;
  const name = orgPeople(o).find(p => p.uid === memberUid)?.name || 'this member';
  confirmDialog(`Remove ${name} from ${o.name}?`, () => orgWrite(code, { memberUids: gwRemove(memberUid), officerUids: gwRemove(memberUid), [`people.${memberUid}`]: GW_DELETE, [`rsvp.${memberUid}`]: GW_DELETE, [`titles.${memberUid}`]: GW_DELETE }), 'Remove');
}

/* ── Files: officers share, everyone opens ─────────────────────── */
function orgFileList(o) {
  return Object.values(o.files || {}).filter(f => f && safeId(f.id) && (f.kind === 'file' || f.kind === 'link') && typeof f.title === 'string')
    .map(f => ({ ...f, title: cleanStr(f.title, 120) || 'File', name: cleanStr(f.name, 60) || 'An officer', size: Number(f.size) || 0 }))
    .sort((a, b) => (b.at || 0) - (a.at || 0));
}
function orgFileUrl(o, f) {
  const url = String(f.url || '');
  if (isHttpUrl(url)) return url;
  return o.local && url.startsWith('data:') ? url : '';
}
function orgFileRow(o, f, { compact = false } = {}) {
  const url = orgFileUrl(o, f);
  const isFile = f.kind === 'file';
  const meta = isFile ? [fileTypeLabel(f.fileName || f.title), fmtFileSize(f.size)] : ['Link', hostOf(url)];
  if (!compact) meta.push(f.name, fmtRelativeTime(f.at));
  const open = !url ? '' : isFile
    ? `<a class="btn btn-sm" href="${esc(url)}" target="_blank" rel="noopener" download="${esc(f.fileName || f.title)}">${icon('download', 13)} Open</a>`
    : `<a class="btn btn-sm" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('link', 13)} Open</a>`;
  return `
    <div class="list-row sg-resource org-file">
      <span class="sg-res-ic">${icon(isFile ? 'paperclip' : 'link', 16)}</span>
      <div class="row-title"><div class="sg-strong">${esc(f.title)}</div><div class="row-meta">${meta.filter(Boolean).map(esc).join(' · ')}</div></div>
      ${open}
      ${!compact && isOrgOfficer(o) ? `<button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove ${esc(f.title)}" onclick="removeOrgFile('${o.code}','${f.id}')">${icon('trash', 14)}</button>` : ''}
    </div>`;
}
function orgFilesTab(o) {
  const files = orgFileList(o);
  const officer = isOrgOfficer(o);
  return `
    <div class="sg-toolbar">
      <div class="small muted">${officer ? 'Share forms, schedules, rosters, and links with everyone.' : 'Forms, schedules, and links from your officers.'}</div>
      ${officer ? `<button class="btn btn-primary btn-sm" onclick="openOrgFileModal('${o.code}')">+ Share a file or link</button>` : ''}
    </div>
    ${files.length ? `<div class="card card-pad">${files.map(f => orgFileRow(o, f)).join('')}</div>`
      : emptyState(icon('paperclip', 24, 1.4), 'No files yet', officer ? `<button class="btn btn-sm mt-8" onclick="openOrgFileModal('${o.code}')">Share the first file</button>` : '', officer ? 'A dues form, the practice schedule, your constitution, a link to the photo drive.' : 'When officers share something, it shows up here.')}
  `;
}
function openOrgFileModal(code) {
  const o = findOrg(code);
  if (!o || !isOrgOfficer(o)) return;
  window._orgFile = { code, kind: 'file', file: null };
  const max = o.local ? GROUP_FILE_MAX_BYTES_LOCAL : GROUP_FILE_MAX_BYTES_CLOUD;
  openModal(`
    <div class="modal-head"><h3>Share with ${esc(o.name)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="segmented mb-16" id="ofl-kind-pick" role="group" aria-label="What are you sharing?">
        <button type="button" class="active" aria-pressed="true" onclick="setOrgFileKind('file')">${icon('paperclip', 12, 1.8)} A file</button>
        <button type="button" aria-pressed="false" onclick="setOrgFileKind('link')">${icon('link', 12, 1.8)} A link</button>
      </div>
      <div id="ofl-file-fields">
        <div class="upload-drop" onclick="if(event.target.id!=='ofl-file-input')$('#ofl-file-input').click()" ondragover="event.preventDefault();this.classList.add('drag')" ondragleave="this.classList.remove('drag')" ondrop="event.preventDefault();this.classList.remove('drag');handleOrgFilePick(event.dataTransfer.files[0])">
          <div class="small" id="ofl-file-status">Choose a file or drop it here: a PDF, doc, spreadsheet, or image, up to ${fmtFileSize(max)}</div>
          <input type="file" id="ofl-file-input" hidden onchange="handleOrgFilePick(this.files[0])">
        </div>
      </div>
      <div id="ofl-link-fields" hidden>
        <div class="field" style="margin-bottom:0"><label for="ofl-link-url">Link</label><input class="input" id="ofl-link-url" type="url" placeholder="https://…"></div>
      </div>
      <div class="field mt-16" style="margin-bottom:0"><label for="ofl-title">Title <span class="muted">(optional)</span></label><input class="input" id="ofl-title" maxlength="120" placeholder="Dues form, Practice schedule, Photo drive…"></div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="ofl-share" onclick="saveOrgFile()">Share</button></div>
  `);
}
function setOrgFileKind(kind) {
  window._orgFile.kind = kind;
  $('#ofl-file-fields').hidden = kind !== 'file';
  $('#ofl-link-fields').hidden = kind !== 'link';
  $$('#ofl-kind-pick button').forEach((b, i) => { const on = (i === 0) === (kind === 'file'); b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
  if (kind === 'link') setTimeout(() => $('#ofl-link-url')?.focus(), 30);
}
async function handleOrgFilePick(file) {
  const st = window._orgFile;
  const o = findOrg(st?.code);
  const input = $('#ofl-file-input');
  if (input) input.value = '';
  if (!file || !o) return;
  const max = o.local ? GROUP_FILE_MAX_BYTES_LOCAL : GROUP_FILE_MAX_BYTES_CLOUD;
  const status = $('#ofl-file-status');
  if (file.size > max) { st.file = null; if (status) status.textContent = `That file is ${fmtFileSize(file.size)}. The limit is ${fmtFileSize(max)}.`; return; }
  if (status) status.textContent = 'Reading…';
  const dataUrl = 'data:' + mimeForFile(file.name, file.type) + ';base64,' + (await fileToBase64(file));
  st.file = { name: file.name, size: file.size, dataUrl };
  if (status) status.textContent = `${file.name} (${fmtFileSize(file.size)}) is ready to share`;
}
async function saveOrgFile() {
  const st = window._orgFile;
  const o = findOrg(st?.code);
  if (!o || !isOrgOfficer(o)) return;
  if (orgFileList(o).length >= ORG_FILES_MAX) { toast(`${o.name} already has ${ORG_FILES_MAX} files. Remove an old one first.`, 'error', 5000); return; }
  const id = uid();
  const base = { id, uid: myOrgUid(o), name: myGroupName(), at: Date.now() };
  const title = cleanStr($('#ofl-title').value, 120);
  let item;
  if (st.kind === 'link') {
    const url = $('#ofl-link-url').value.trim();
    if (!isHttpUrl(url)) { toast('Enter a full link starting with https://', 'error'); return; }
    item = { ...base, kind: 'link', title: title || hostOf(url) || 'Link', url };
  } else {
    if (!st.file) { toast('Choose a file first', 'error'); return; }
    item = { ...base, kind: 'file', title: title || fileBaseName(st.file.name) || st.file.name, fileName: st.file.name, size: st.file.size };
  }
  const btn = $('#ofl-share');
  setBtnLoading(btn, true);
  try {
    if (item.kind === 'file') {
      if (o.local) item.url = st.file.dataUrl;
      else if (!cloudGroupsEnabled()) { setBtnLoading(btn, false, 'Share'); toast('Log in to share files.', 'error'); return; }
      else item.url = await uploadDataUrlToStorage(`orgs/${o.code}/files/${id}-${storageSafeName(st.file.name)}`, st.file.dataUrl, st.file.name);
    }
    if (await orgWrite(o.code, { [`files.${id}`]: item })) { closeModal(); toast(`Shared “${item.title}”`); }
    else setBtnLoading(btn, false, 'Share');
  } catch (e) {
    console.warn('Club file upload failed', e?.code, e);
    setBtnLoading(btn, false, 'Share');
    toast('Couldn’t upload that file. Check your connection and try again.', 'error', 5000);
  }
}
function removeOrgFile(code, id) {
  const o = findOrg(code);
  const f = o && orgFileList(o).find(x => x.id === id);
  if (!f || !isOrgOfficer(o)) return;
  confirmDialog(`Remove “${f.title}” for everyone?`, async () => {
    if (!(await orgWrite(code, { [`files.${id}`]: GW_DELETE }))) return;
    if (f.kind === 'file' && String(f.url || '').includes('firebasestorage')) fbStorage().then(s => s.refFromURL(f.url).delete()).catch(() => {});
  }, 'Remove');
}

/* ── Chat ─────────────────────────────────────────────────────────
   Everyone in the club can post. Messages live in orgs/CODE/messages and
   only load while the Chat tab is open; lastMessage on the club doc drives
   the unread dots everywhere else. Officers can delete any message. */
const _orgMessages = {};
const _orgChatFailed = {};
let _orgChatSub = { code: null, unsub: null };
function orgMessages(o) {
  const list = o.local ? (orgEntry(o.code)?.messages || []) : (_orgMessages[o.code] || []);
  return list.filter(m => m && safeId(m.id) && typeof m.text === 'string' && typeof m.at === 'number');
}
function closeOrgChatListener() { if (_orgChatSub.unsub) _orgChatSub.unsub(); _orgChatSub = { code: null, unsub: null }; }
function ensureOrgChatListener(code) {
  const entry = orgEntry(code);
  if (!entry?.cloud || !cloudGroupsEnabled() || _orgChatFailed[code]) { closeOrgChatListener(); return; }
  if (_orgChatSub.code === code) return;
  closeOrgChatListener();
  _orgChatSub.code = code;
  _orgChatSub.unsub = _fbDb.collection('orgs').doc(code).collection('messages').orderBy('at').limitToLast(200).onSnapshot(snap => {
    _orgMessages[code] = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    renderRemote();
  }, err => {
    console.warn('Club chat listener failed', code, err);
    _orgChatFailed[code] = true; // not retried until the tab is opened again, so a failure can't loop
    _orgChatSub = { code: null, unsub: null };
    renderRemote();
  });
}
// Runs after every render (see render() in app.js).
function afterOrgPageRender() {
  const code = state.route === 'orgs' ? state.subRoute : null;
  if (!code || state.orgTab !== 'chat' || !orgEntry(code)) {
    if (_orgChatSub.code) closeOrgChatListener();
    Object.keys(_orgChatFailed).forEach(k => delete _orgChatFailed[k]);
    return;
  }
  ensureOrgChatListener(code);
  const log = document.getElementById('org-chat-log');
  if (log) { log.scrollTop = log.scrollHeight; markOrgChatSeen(code); }
}
function orgChatTab(o) {
  const msgs = orgMessages(o);
  const me = myOrgUid(o);
  const officer = isOrgOfficer(o);
  const byUid = Object.fromEntries(orgPeople(o).map(p => [p.uid, p]));
  const loading = !o.local && !_orgMessages[o.code] && !_orgChatFailed[o.code];
  let lastDay = '', lastUid = '', lastAt = 0;
  const rows = msgs.map(m => {
    const day = iso(new Date(m.at));
    const sep = day !== lastDay ? `<div class="sg-chat-day">${fmtSessionDay(day)}</div>` : '';
    const grouped = !sep && lastUid === m.uid && m.at - lastAt < 5 * 60000;
    lastDay = day; lastUid = m.uid; lastAt = m.at;
    const mine = m.uid === me;
    const p = byUid[m.uid];
    const who = p ? p.name : cleanStr(m.name, 60) || 'Former member';
    return `${sep}
      <div class="sg-msg ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''}">
        ${mine ? '' : grouped ? '<span class="sg-msg-spacer"></span>' : personAvatar(m.uid, who, 28, p?.officer ? orgColor(o) : '#6b6b6b')}
        <div class="sg-msg-body">
          ${!mine && !grouped ? `<div class="sg-msg-name">${esc(who)}${p ? ` <span class="org-msg-role">${esc(orgRoleLabel(o, p))}</span>` : ''} <span class="muted">${new Date(m.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span></div>` : ''}
          <div class="sg-bubble" title="${esc(new Date(m.at).toLocaleString())}">${linkifyText(m.text)}</div>
        </div>
        ${mine || officer ? `<button class="sg-msg-del" aria-label="Delete message" title="Delete" onclick="deleteOrgMessage('${o.code}','${m.id}')">${icon('x', 11, 2.2)}</button>` : ''}
      </div>`;
  }).join('');
  return `
    <div class="card sg-chat">
      <div class="sg-chat-log" id="org-chat-log" data-keep-scroll="bottom">
        ${_orgChatFailed[o.code] ? emptyState(icon('message-circle', 24, 1.4), 'Chat didn’t load', `<button class="btn btn-sm mt-8" onclick="delete _orgChatFailed['${o.code}'];render()">Try again</button>`, 'Check your connection, then try again.')
          : loading ? '<div class="small muted" style="padding:18px;text-align:center">Loading messages…</div>'
          : msgs.length ? rows : emptyState(icon('message-circle', 24, 1.4), 'No messages yet', '', `Say hi to ${o.name}. Everyone in the ${o.kind === 'team' ? 'team' : o.kind === 'chapter' ? 'chapter' : 'club'} sees this chat.`)}
      </div>
      <div class="sg-chat-compose">
        <input class="input" id="org-chat-input" maxlength="${GROUP_MESSAGE_MAX}" autocomplete="off" placeholder="Message ${esc(o.name)}" onkeydown="if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();sendOrgMessage('${o.code}')}">
        <button class="btn btn-primary" aria-label="Send message" onclick="sendOrgMessage('${o.code}')">${icon('send', 14, 1.9)}</button>
      </div>
    </div>`;
}
async function sendOrgMessage(code) {
  const input = $('#org-chat-input');
  const text = input?.value.trim();
  const entry = orgEntry(code);
  const o = findOrg(code);
  if (!text || !entry || !o) return;
  const msg = { id: uid(), uid: myOrgUid(o), name: myGroupName(), text: text.slice(0, GROUP_MESSAGE_MAX), at: Date.now() };
  const lastMessage = { uid: msg.uid, name: msg.name, text: msg.text.slice(0, 140), at: msg.at };
  input.value = '';
  if (entry.local) {
    entry.messages = [...(entry.messages || []), msg].slice(-200);
    entry.lastMessage = lastMessage;
    orgChatSeen()[code] = msg.at;
    touch();
    $('#org-chat-input')?.focus();
    return;
  }
  if (!cloudGroupsEnabled()) { input.value = text; toast('Log in to chat with your club.', 'error'); return; }
  try {
    const ref = _fbDb.collection('orgs').doc(code);
    await ref.collection('messages').doc(msg.id).set(msg);
    ref.update({ lastMessage, updatedAt: Date.now() }).catch(e => console.warn('Club lastMessage update failed', e));
    markOrgChatSeen(code, msg.at);
    playUiSound('send');
  } catch (e) {
    console.warn('Club message failed', e?.code, e);
    if (input.isConnected && !input.value) input.value = text;
    toast('Message didn’t send. Check your connection and try again.', 'error');
  }
}
function deleteOrgMessage(code, id) {
  const entry = orgEntry(code);
  if (!entry || !safeId(id)) return;
  if (entry.local) { entry.messages = (entry.messages || []).filter(m => m.id !== id); touch(); return; }
  _fbDb.collection('orgs').doc(code).collection('messages').doc(id).delete().catch(() => toast('Couldn’t delete that message.', 'error'));
}

/* ── Create, join, invite, settings ────────────────────────────── */
function openCreateOrgModal() {
  window._orgDraft = { kind: 'club', color: ORG_COLORS[0] };
  openModal(`
    <div class="modal-head"><h3>Start a club or team</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label for="of-name">Name</label><input class="input" id="of-name" maxlength="80" placeholder="Women in Business"></div>
      <div class="field"><label>What is it?</label><div class="chip-row" id="of-kind" role="group" aria-label="Kind">${ORG_KINDS.map(([k, l, ic]) => `<button type="button" class="chip ${k === 'club' ? 'active' : ''}" aria-pressed="${k === 'club'}" onclick="_orgDraft.kind='${k}';$$('#of-kind .chip').forEach(b=>{b.classList.toggle('active',b===this);b.setAttribute('aria-pressed',b===this)})">${icon(ic, 12, 1.8)} ${l}</button>`).join('')}</div></div>
      <div class="field-row">
        <div class="field"><label for="of-school">School <span class="muted">(optional)</span></label><input class="input" id="of-school" maxlength="80" value="${esc(state.settings.school || '')}" placeholder="University of Georgia"></div>
        <div class="field"><label>Color</label><div class="org-colors" id="of-colors" role="group" aria-label="Color">${ORG_COLORS.map((c, i) => `<button type="button" class="page-color ${i === 0 ? 'active' : ''}" style="background:${c}" aria-label="Color ${i + 1}" aria-pressed="${i === 0}" onclick="_orgDraft.color='${c}';$$('#of-colors button').forEach(b=>{b.classList.toggle('active',b===this);b.setAttribute('aria-pressed',b===this)})"></button>`).join('')}</div></div>
      </div>
      <div class="field"><label for="of-desc">Description <span class="muted">(optional)</span></label><input class="input" id="of-desc" maxlength="200" placeholder="Meetings Tuesdays at 7 in the Union"></div>
      <div class="field"><label for="of-title">Your title <span class="muted">(optional)</span></label>
        <input class="input" id="of-title" maxlength="${ORG_TITLE_MAX}" placeholder="President, Captain, Chair…">
        <div class="chip-row mt-8">${ORG_TITLE_SUGGESTIONS.map(t => `<button type="button" class="chip" onclick="$('#of-title').value='${t}'">${t}</button>`).join('')}</div>
      </div>
      <div class="sg-callout small mb-8"><span>${icon('shield', 14, 1.8)}</span><div>You’ll be the founder and an officer. Officers add events, post announcements, share files, and see who’s coming. You can make other members officers from the Members tab.</div></div>
      ${!cloudGroupsEnabled() && fbConfigured() ? '<p class="small muted">You’re not logged in, so this stays on this tab only. <a href="login.html">Log in</a> to invite members.</p>' : ''}
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="of-create" onclick="submitCreateOrg()">Create</button></div>
  `);
}
async function submitCreateOrg() {
  const name = $('#of-name').value.trim();
  if (!name) { toast('Give it a name', 'error'); $('#of-name').focus(); return; }
  const d = window._orgDraft;
  const school = $('#of-school').value.trim().slice(0, 80);
  if (school) state.settings.school = school;
  const fields = { name: name.slice(0, 80), kind: d.kind, school, color: d.color, description: $('#of-desc').value.trim().slice(0, 200), ownerTitle: cleanStr($('#of-title').value, ORG_TITLE_MAX) };
  if (!cloudGroupsEnabled()) {
    const code = genGroupCode();
    orgEntries().push({ ...newOrgDoc({ code, ...fields, ownerUid: LOCAL_UID }), local: true });
    closeModal(); openOrg(code);
    return;
  }
  const btn = $('#of-create');
  setBtnLoading(btn, true);
  try {
    const code = await unusedOrgCode();
    const doc = newOrgDoc({ code, ...fields, ownerUid: _fbUser.uid });
    await _fbDb.collection('orgs').doc(code).set(doc);
    _liveOrgs[code] = doc;
    state.orgs = [...orgEntries().filter(e => e.code !== code), { code, cloud: true, name: doc.name, joinedAt: Date.now() }];
    save();
    reconcileOrgSubscriptions();
    closeModal();
    openOrg(code);
    setTimeout(() => openOrgInviteModal(code, { justCreated: true }), 150);
  } catch (e) {
    console.warn('Create org failed', e);
    setBtnLoading(btn, false, 'Create');
    toast('Couldn’t create it. Check your connection and try again.', 'error', 4500);
  }
}
function orgInviteLink(code) { return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}?org=${code}`; }
function orgInviteMessage(code) { const o = findOrg(code); return `Join ${o?.name || 'our club'} on Semester HQ so our events show up on your calendar: ${orgInviteLink(code)} (code ${code})`; }
function openOrgInviteModal(code, { justCreated = false } = {}) {
  const o = findOrg(code);
  if (!o) return;
  openModal(`
    <div class="modal-head"><h3>${justCreated ? `${esc(o.name)} is ready` : `Invite to ${esc(o.name)}`}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      ${o.local ? `<div class="sg-callout small mb-16"><div>${o.sample ? 'This is a sample club, so the code is just for show.' : 'You’re not logged in, so no one can join yet. <a href="login.html">Log in</a> to invite members.'}</div></div>` : ''}
      <p class="small muted" style="text-align:center">Members join with this code:</p>
      <div class="sg-invite-code" aria-label="Code ${code.split('').join(' ')}">${code.split('').map(ch => `<span>${ch}</span>`).join('')}</div>
      <div class="field mt-16"><label for="org-invite-link">Or share a link in your group chat</label>
        <div class="sg-invite-row"><input class="input" id="org-invite-link" value="${esc(orgInviteLink(code))}" readonly onclick="this.select()"><button class="btn btn-primary" onclick="copyText(orgInviteMessage('${code}'),'Invite copied')">${icon('copy', 13, 1.8)} Copy</button></div>
      </div>
      ${navigator.share ? `<button class="btn" style="width:100%;justify-content:center" onclick="navigator.share({title:'Join on Semester HQ',text:orgInviteMessage('${code}')}).catch(()=>{})">${icon('send', 13, 1.8)} Share via Messages, GroupMe…</button>` : ''}
      <div class="sg-pricing-inline small mt-16">
        <span class="sg-feature-ic">${icon('shield', 15, 1.7)}</span>
        <div><span class="sg-strong">Getting the whole ${o.kind === 'team' ? 'team' : o.kind === 'chapter' ? 'chapter' : 'club'} on?</span><div class="muted">Each member needs Semester HQ. <a href="${GROUP_PRICING_URL}" target="_blank" rel="noopener">Group pricing</a> covers everyone for less, and can come out of your budget or dues.</div></div>
      </div>
    </div>
  `);
}
function openJoinOrgModal(prefill = '') {
  if (!cloudGroupsEnabled()) {
    openModal(`
      <div class="modal-head"><h3>Join a club or team</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
      <div class="modal-body"><p class="small muted">Joining needs a Semester HQ account, so the events stay in sync with your officers.</p></div>
      <div class="modal-foot"><button class="btn" onclick="closeModal()">Not now</button>${fbConfigured() ? '<a class="btn btn-primary" href="login.html">Log in or sign up</a>' : ''}</div>
    `);
    return;
  }
  openModal(`
    <div class="modal-head"><h3>Join a club or team</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="field"><label for="oj-code">Code from your officers</label>
        <input class="input sg-code-input" id="oj-code" value="${esc(normalizeCode(prefill))}" placeholder="ABC123" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'')" onkeydown="if(event.key==='Enter')lookupOrgCode()">
      </div>
      <div id="oj-result"></div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="oj-btn" onclick="lookupOrgCode()">Find</button></div>
  `);
}
async function lookupOrgCode() {
  const code = normalizeCode($('#oj-code').value);
  if (code.length !== 6) { toast('Codes are 6 characters', 'error'); return; }
  if (orgEntry(code)?.cloud) { closeModal(); openOrg(code); return; }
  const btn = $('#oj-btn');
  setBtnLoading(btn, true);
  try {
    const snap = await _fbDb.collection('orgs').doc(code).get();
    if (!snap.exists) { setBtnLoading(btn, false, 'Find'); $('#oj-result').innerHTML = `<div class="sg-callout small"><div>Nothing uses the code <strong>${esc(code)}</strong>. Double-check it with an officer.</div></div>`; return; }
    showOrgPreview(code, snap.data());
  } catch { setBtnLoading(btn, false, 'Find'); toast('Couldn’t look that up. Check your connection.', 'error'); }
}
function showOrgPreview(code, data) {
  const o = orgView({ ...data, code, local: false });
  const kind = orgKind(o);
  const next = upcomingOrgEvents(o)[0];
  openModal(`
    <div class="modal-head"><h3>You’re invited</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="sg-join-card" style="--org:${esc(orgColor(o))}">
        <span class="org-crest large" aria-hidden="true">${orgMonogram(o)}</span>
        <div class="sg-join-name">${esc(o.name)}</div>
        <div class="small muted">${[kind[1], o.school ? esc(o.school) : '', `${o.memberUids.length} member${o.memberUids.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</div>
        ${o.description ? `<div class="small mt-8">${esc(o.description)}</div>` : ''}
        ${next ? `<div class="small muted mt-8">Next: ${esc(next.title)}, ${fmtSessionDay(next.date)}${next.start ? ` at ${fmtTime(next.start)}` : ''}</div>` : ''}
      </div>
      <div class="mt-16">${orgRoleFieldsHtml(o, '', 'oj')}</div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="clearPendingOrg();closeModal()">Not now</button><button class="btn btn-primary" id="oj-confirm" onclick="confirmJoinOrg('${code}')">Join</button></div>
  `);
}
async function confirmJoinOrg(code) {
  const btn = $('#oj-confirm');
  const title = chosenOrgTitle('oj');
  setBtnLoading(btn, true);
  try {
    const myUid = _fbUser.uid;
    const ref = _fbDb.collection('orgs').doc(code);
    let name = '';
    await _fbDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('That club doesn’t exist anymore.');
      const data = snap.data();
      name = data.name;
      if (!(data.memberUids || []).includes(myUid)) tx.update(ref, { memberUids: firebase.firestore.FieldValue.arrayUnion(myUid), [`people.${myUid}`]: { name: myGroupName(), joinedAt: Date.now(), title }, updatedAt: Date.now() });
    });
    clearPendingOrg();
    state.orgs = [...orgEntries().filter(e => e.code !== code), { code, cloud: true, name, joinedAt: Date.now() }];
    save();
    reconcileOrgSubscriptions();
    closeModal();
    openOrg(code);
    playUiSound('success');
    toast(`You joined ${name}. Its events are on your calendar now.`, 'success', 4500);
  } catch (e) {
    setBtnLoading(btn, false, 'Join');
    toast(e.message?.startsWith('That club') ? e.message : 'Couldn’t join. Check your connection and try again.', 'error', 5000);
  }
}
function openOrgSettingsModal(code) {
  const o = findOrg(code);
  if (!o) return;
  const officer = isOrgOfficer(o);
  openModal(`
    <div class="modal-head"><h3>${esc(o.name)} settings</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      ${officer ? `
        <div class="field"><label for="os-name">Name</label><input class="input" id="os-name" maxlength="80" value="${esc(o.name)}"></div>
        <div class="field-row">
          <div class="field"><label for="os-kind">Kind</label><select class="select" id="os-kind">${ORG_KINDS.map(([k, l]) => `<option value="${k}" ${o.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label for="os-school">School</label><input class="input" id="os-school" maxlength="80" value="${esc(o.school || '')}"></div>
        </div>
        <div class="field"><label for="os-desc">Description</label><input class="input" id="os-desc" maxlength="200" value="${esc(o.description || '')}"></div>
        <div class="field"><label>Color</label><div class="org-colors" role="group" aria-label="Color">${ORG_COLORS.map((c, i) => `<button type="button" class="page-color ${orgColor(o) === c ? 'active' : ''}" style="background:${c}" aria-label="Color ${i + 1}" aria-pressed="${orgColor(o) === c}" onclick="orgWrite('${code}',{color:'${c}'}).then(()=>openOrgSettingsModal('${code}'))"></button>`).join('')}</div></div>
      ` : `<p class="small muted mb-8">Officers manage the details. You can leave any time.</p>`}
      <div class="flex-between small mb-8"><span>Your title: <span class="sg-strong">${esc(orgTitleOf(o, myOrgUid(o)) || (isOrgOwner(o) ? 'Founder' : isOrgOfficer(o) ? 'Officer' : orgGeneralLabel(o)))}</span></span><button class="sg-link" onclick="openMyOrgTitleModal('${code}')">Change</button></div>
      <label class="checkbox-row small"><input type="checkbox" ${o.hideCalendar ? '' : 'checked'} onchange="setOrgOnCalendar('${code}',this.checked)"><span>Show events on my calendar</span></label>
      <div class="divider"></div>
      <div class="sg-danger">
        <button class="btn btn-sm" onclick="confirmLeaveOrg('${code}')">${icon('log-out', 13, 1.8)} ${o.sample ? 'Remove sample' : 'Leave'}</button>
        ${isOrgOwner(o) && !o.local ? `<button class="btn btn-danger btn-sm" onclick="confirmDeleteOrg('${code}')">${icon('trash', 13, 1.8)} Delete for everyone</button>` : ''}
      </div>
    </div>
    ${officer ? `<div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveOrgSettings('${code}')">Save</button></div>` : ''}
  `);
}
async function saveOrgSettings(code) {
  const name = $('#os-name').value.trim();
  if (!name) { toast('It needs a name', 'error'); return; }
  const school = $('#os-school').value.trim().slice(0, 80);
  const ops = { name: name.slice(0, 80), kind: $('#os-kind').value, school, schoolKey: normKey(school), description: $('#os-desc').value.trim().slice(0, 200) };
  closeModal();
  const entry = orgEntry(code);
  if (entry?.cloud) entry.name = ops.name;
  if (await orgWrite(code, ops)) toast('Saved');
}
function confirmLeaveOrg(code) {
  const o = findOrg(code);
  if (!o) return;
  if (o.local) {
    confirmDialog(o.sample ? 'Remove the sample club?' : `Delete “${o.name}”? It only exists on this tab.`, () => { state.orgs = orgEntries().filter(e => e.code !== code); state.subRoute = null; touch(); }, 'Remove');
    return;
  }
  const others = orgPeople(o).filter(p => p.uid !== myOrgUid(o));
  if (!others.length) { confirmDialog(`You’re the only member, so leaving deletes “${o.name}”.`, () => deleteOrgEverywhere(code), 'Leave and delete'); return; }
  if (isOrgOwner(o) && !others.some(p => p.officer)) { toast('Make someone else an officer before you leave, so the club still has someone running it.', 'error', 5500); return; }
  confirmDialog(`Leave “${o.name}”? Its events come off your calendar.`, () => leaveOrg(code), 'Leave');
}
async function leaveOrg(code) {
  const o = findOrg(code);
  const me = _fbUser?.uid;
  if (!o || !me) return;
  if (isOrgOwner(o)) {
    // Hand the club to another officer first (a founder-only change), then leave as a regular officer.
    const heir = orgPeople(o).find(p => p.officer && p.uid !== me);
    if (!heir || !(await orgWrite(code, { createdBy: heir.uid }))) return;
  }
  const ops = { memberUids: gwRemove(me), [`people.${me}`]: GW_DELETE, [`rsvp.${me}`]: GW_DELETE };
  if (o.officerUids.includes(me)) ops.officerUids = gwRemove(me);
  if (_orgDocUnsubs[code]) { _orgDocUnsubs[code](); delete _orgDocUnsubs[code]; }
  if (await orgWrite(code, ops)) dropOrgEntry(code, `You left “${o.name}”.`);
  else reconcileOrgSubscriptions();
}
function confirmDeleteOrg(code) {
  const o = findOrg(code);
  confirmDialog(`Delete “${o.name}” for all ${o.memberUids.length} members? Events and announcements are erased for everyone.`, () => deleteOrgEverywhere(code), 'Delete');
}
async function deleteOrgEverywhere(code) {
  const o = findOrg(code);
  try {
    if (_orgDocUnsubs[code]) { _orgDocUnsubs[code](); delete _orgDocUnsubs[code]; }
    if (_orgChatSub.code === code) closeOrgChatListener();
    // Best effort: the chat and shared files don't go away on their own.
    try {
      const msgs = await _fbDb.collection('orgs').doc(code).collection('messages').limit(450).get();
      if (!msgs.empty) { const batch = _fbDb.batch(); msgs.docs.forEach(d => batch.delete(d.ref)); await batch.commit(); }
    } catch (e) { console.warn('Could not clear club chat', e); }
    if (o) orgFileList(o).filter(f => f.kind === 'file' && String(f.url || '').includes('firebasestorage')).forEach(f => fbStorage().then(s => s.refFromURL(f.url).delete()).catch(() => {}));
    await _fbDb.collection('orgs').doc(code).delete();
    dropOrgEntry(code, `Deleted “${o?.name || 'the club'}”.`);
  } catch (e) { console.warn(e); reconcileOrgSubscriptions(); toast('Couldn’t delete it. Check your connection.', 'error'); }
}

/* ── ?org=CODE invite links ────────────────────────────────────── */
function captureOrgParam() {
  const params = new URLSearchParams(location.search);
  if (!params.has('org')) return;
  const code = normalizeCode(params.get('org'));
  params.delete('org');
  history.replaceState({}, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
  if (code.length === 6 && !isEmbedded()) try { localStorage.setItem(PENDING_ORG_KEY, JSON.stringify({ code, at: Date.now() })); } catch {}
}
function pendingOrgCode() { try { const p = JSON.parse(localStorage.getItem(PENDING_ORG_KEY) || 'null'); return p?.code && Date.now() - p.at < 14 * 86400000 ? p.code : null; } catch { return null; } }
function clearPendingOrg() { try { localStorage.removeItem(PENDING_ORG_KEY); } catch {} }
let _orgInviteShown = false;
async function handlePendingOrg() {
  const code = pendingOrgCode();
  if (!code || !fbConfigured() || isEmbedded()) return;
  if (!_fbUser) {
    if (_orgInviteShown) return;
    _orgInviteShown = true;
    openModal(`
      <div class="modal-head"><h3>You’re invited to join a club</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
      <div class="modal-body"><div class="sg-invite-code small-code">${code.split('').map(ch => `<span>${ch}</span>`).join('')}</div><p class="small muted mt-16">Log in or create your Semester HQ account to join. Its events go straight onto your calendar.</p></div>
      <div class="modal-foot"><button class="btn" onclick="closeModal()">Look around first</button><a class="btn btn-primary" href="login.html">Log in to join</a></div>
    `);
    return;
  }
  if (!window._licensed) return;
  if (orgEntry(code)?.cloud) { clearPendingOrg(); openOrg(code); return; }
  try { const snap = await _fbDb.collection('orgs').doc(code).get(); if (snap.exists) showOrgPreview(code, snap.data()); else clearPendingOrg(); } catch {}
}

/* ── Sample club for looking around ────────────────────────────── */
function createSampleOrg() {
  const existing = orgEntries().find(e => e.sample);
  if (existing) { openOrg(existing.code); return; }
  const now = Date.now(), D = 86400000, t = todayIso();
  const me = LOCAL_UID, ava = 'sample-ava', noah = 'sample-noah', lena = 'sample-lena', sam = 'sample-sam', jade = 'sample-jade';
  const code = genGroupCode();
  const nextDow = (dow) => addDays(t, ((dow - new Date().getDay() + 7) % 7) || 7);
  const ev = (title, category, date, start, end, location, extra = {}) => { const id = uid(); return [id, { id, title, category, date, start, end, location, notes: '', required: false, createdBy: ava, createdAt: now - 5 * D, ...extra }]; };
  const events = Object.fromEntries([
    ev('General meeting', 'meeting', nextDow(2), '19:00', '20:00', 'Student Union 210', { required: true, notes: 'Voting on the spring trip. Bring ideas for the networking night.' }),
    ev('Networking night with alumni', 'social', addDays(t, 9), '18:30', '20:30', 'Business School atrium', { notes: 'Business casual. Bring a few copies of your resume.' }),
    ev('Dues deadline', 'deadline', addDays(t, 5), '', '', '', { required: true, notes: '$40 for the semester. Venmo the treasurer.' }),
    ev('Food bank volunteering', 'service', addDays(t, 12), '10:00', '13:00', 'Downtown food bank'),
    ev('General meeting', 'meeting', addDays(nextDow(2), 7), '19:00', '20:00', 'Student Union 210', { required: true }),
  ]);
  const ids = Object.keys(events);
  const H = 3600000;
  const fileId = uid(), linkId = uid();
  const dues = 'Spring dues\n\n$40 for the semester, due Friday.\nVenmo @noah-treasurer and put your name in the note.\nQuestions? Ask Noah in chat.\n';
  const messages = [
    { uid: lena, name: 'Lena', text: 'Is the networking night business casual or business formal?', at: now - 27 * H },
    { uid: ava, name: 'Ava', text: 'Business casual! Bring a few copies of your resume.', at: now - 26.5 * H },
    { uid: jade, name: 'Jade', text: 'I can drive 3 people to the food bank on Saturday 🚗', at: now - 5 * H },
    { uid: noah, name: 'Noah', text: 'Reminder that dues are due Friday. The details are in Files.', at: now - 2 * H },
  ].map(m => ({ id: uid(), ...m }));
  const entry = {
    ...newOrgDoc({ code, name: 'Women in Business', kind: 'club', school: state.settings.school || '', color: ORG_COLORS[3], description: 'Career panels, networking, and a community of students going into business.', ownerUid: ava }),
    local: true, sample: true,
    memberUids: [ava, noah, lena, sam, jade, me], officerUids: [ava, noah],
    people: { [ava]: { name: 'Ava', joinedAt: now - 60 * D, title: 'President' }, [noah]: { name: 'Noah', joinedAt: now - 50 * D, title: 'Treasurer' }, [lena]: { name: 'Lena', joinedAt: now - 30 * D, title: '' }, [sam]: { name: 'Sam', joinedAt: now - 20 * D, title: '' }, [jade]: { name: 'Jade', joinedAt: now - 9 * D, title: 'Social chair', reviewed: true }, [me]: { name: myGroupName(), joinedAt: now - 2 * D, title: '' } },
    files: {
      [fileId]: { id: fileId, kind: 'file', title: 'Spring dues', fileName: 'Spring dues.txt', size: dues.length, url: 'data:text/plain;base64,' + btoa(dues), uid: noah, name: 'Noah', at: now - 20 * H },
      [linkId]: { id: linkId, kind: 'link', title: 'Resume workshop slides', url: 'https://example.com/slides', uid: ava, name: 'Ava', at: now - 3 * D },
    },
    messages,
    lastMessage: { uid: noah, name: 'Noah', text: messages[3].text, at: messages[3].at },
    events,
    rsvp: { [ava]: { [ids[0]]: 'yes', [ids[1]]: 'yes' }, [noah]: { [ids[0]]: 'yes', [ids[3]]: 'yes' }, [lena]: { [ids[0]]: 'no', [ids[1]]: 'yes' }, [sam]: { [ids[1]]: 'yes' } },
    announcements: Object.fromEntries([
      { text: 'Dues are due this Friday. $40 for the semester, Venmo @noah-treasurer with your name in the note.', uid: noah, name: 'Noah', at: now - 20 * 3600000, pinned: true },
      { text: 'Huge thank you to everyone who came to the resume workshop! Slides are in the drive: https://example.com/slides', uid: ava, name: 'Ava', at: now - 3 * D },
    ].map(a => { const id = uid(); return [id, { id, ...a }]; })),
  };
  orgEntries().push(entry);
  openOrg(code);
  toast('This is a sample club. Try RSVPing, see who’s going, or say hi in Chat.', 'info', 4500);
}
