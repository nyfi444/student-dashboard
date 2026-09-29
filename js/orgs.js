/* ── Clubs & teams ─────────────────────────────────────────────────
   One calendar that officers run and every member gets: meetings,
   practices, games, philanthropy events, dues deadlines. Officers post
   events and announcements; members RSVP, and events land on their own
   Semester HQ calendar. Built for clubs, sports teams,
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

   Split across files (see index.html): this one holds the data, sync,
   pages, events, announcements, chat, joining and the sample club;
   js/orgs/admin.js the officer tools; js/orgs/files.js the Files tab.
──────────────────────────────────────────────────────────────── */
const ORG_KINDS = [['club', 'Club', 'flag'], ['team', 'Team', 'trophy'], ['chapter', 'Sorority or fraternity', 'shield'], ['org', 'Organization', 'users'], ['other', 'Other', 'star']];
// [key, label, icon]: the icon is what makes a list of twelve events scannable.
const ORG_EVENT_CATEGORIES = [['meeting', 'Meeting', 'users'], ['practice', 'Practice', 'timer'], ['game', 'Game or match', 'trophy'], ['social', 'Social', 'star'], ['service', 'Service or philanthropy', 'target'], ['deadline', 'Deadline or dues', 'flag'], ['other', 'Other', 'calendar']];
function orgCat(e) { return ORG_EVENT_CATEGORIES.find(c => c[0] === e?.category) || ORG_EVENT_CATEGORIES[ORG_EVENT_CATEGORIES.length - 1]; }
function orgCatHtml(e) { const c = orgCat(e); return `<span class="org-cat">${icon(c[2], 11)} ${c[1]}</span>`; }
const ORG_COLORS = GROUP_COLORS; // shared with study groups, see js/spaces/core.js
const ORG_LINKS_MAX = 6;
const ORG_LINK_SUGGESTIONS = ['GroupMe', 'Instagram', 'Website', 'Venmo', 'Google Drive', 'Discord'];
const ORG_TABS = [['overview', 'Overview'], ['events', 'Calendar'], ['announcements', 'Announcements'], ['chat', 'Chat'], ['files', 'Files'], ['members', 'Members']];
// Officers get one more: everything that comes with running the club, which
// was otherwise spread across a settings gear, an invite popup, the members
// list, and a link buried in the invite modal (see orgAdminTab).
const ORG_ADMIN_TAB = ['admin', 'Admin'];
function orgTabsFor(o) { return isOrgOfficer(o) ? [...ORG_TABS, ORG_ADMIN_TAB] : ORG_TABS; }
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
// Officer-set links every member keeps needing: the GroupMe, the Instagram,
// the Venmo dues go to. Shown under the club's name on every tab.
function orgLinkList(o) {
  return (Array.isArray(o?.links) ? o.links : []).filter(l => l && safeId(l.id) && isHttpUrl(l.url))
    .map(l => ({ id: l.id, label: cleanStr(l.label, 30) || hostOf(l.url) || 'Link', url: String(l.url).trim() })).slice(0, ORG_LINKS_MAX);
}
function orgLinksHtml(o, { editable = false } = {}) {
  const links = orgLinkList(o);
  if (!links.length && !editable) return '';
  return `<div class="org-links">${links.map(l => `<a class="org-link-pill" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${icon('link', 11)} ${esc(l.label)}</a>`).join('')}${editable ? `<button class="org-link-pill is-edit" onclick="openOrgLinksModal('${o.code}')">${icon('pencil', 11)} ${links.length ? 'Edit links' : 'Add links'}</button>` : ''}</div>`;
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
    diag.error('clubs', 'Club write failed', e);
    toast(e.code === 'permission-denied' ? 'Only officers can change that.' : 'Couldn’t save that. Check your connection and try again.', 'error', 4500);
    return false;
  }
}

/* ── Sync ──────────────────────────────────────────────────────── */
// code -> the error its listener died with. Cleared by the next good snapshot.
const _orgLoadErrors = {};
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
    _orgDocUnsubs[code] = _fbDb.collection('orgs').doc(code).onSnapshot(doc => onOrgSnapshot(code, doc), err => { _orgLoadErrors[code] = err; diag.error('clubs', 'Club listener failed', err); renderRemote(); });
  });
}
function onOrgSnapshot(code, doc) {
  delete _orgLoadErrors[code];
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
// Same shape as retryGroupLoad / groupLoadNotice in js/groups/sync.js: a failed
// listener never comes back on its own, so the page says so and offers a
// retry instead of a permanent "Loading…".
function retryOrgLoad(code) {
  delete _orgLoadErrors[code];
  if (_orgDocUnsubs[code]) { try { _orgDocUnsubs[code](); } catch {} delete _orgDocUnsubs[code]; }
  reconcileOrgSubscriptions();
  render();
}
function orgLoadNotice(o) {
  const err = _orgLoadErrors[o.code];
  if (!err) return o.loading ? '<div class="small muted mb-16">Loading…</div>' : '';
  const denied = err.code === 'permission-denied';
  return `<div class="mb-16">${inlineErrorHtml(
    denied ? 'You don’t have access to this club anymore. It may have been deleted, or you were removed.' : 'This club didn’t load. Check your connection and try again.',
    `retryOrgLoad('${o.code}')`,
    { extra: denied ? `<button class="btn btn-sm btn-ghost" onclick="dropOrgEntry('${o.code}')">Remove it from my list</button>` : '' },
  )}</div>`;
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

/* ── Calendar, dashboard, Heads up ─────────────────────────────── */
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
      <div class="flex-between mb-8"><h3 class="sg-h3">Clubs & teams</h3><button class="sg-link" onclick="setState({route:'orgs',subRoute:null})">All ${icon('chevron-right', 12)}</button></div>
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
    ${pageHead('Clubs & Teams', 'Your club, team, or chapter’s calendar, right next to your classes.', orgs.length ? `
      <button class="btn btn-sm" onclick="openJoinOrgModal()">${icon('user-plus', 14)} Join with code</button>
      <button class="btn btn-primary" onclick="openCreateOrgModal()">${icon('plus', 14)} Start one</button>
    ` : '')}
    ${!fbConfigured() || cloudGroupsEnabled() || demoBarShowing() ? '' : `<div class="sg-callout mb-16">${icon('info', 16)}<div class="small">You’re looking around without an account, so anything you make here disappears when you close the tab. <a href="login.html">Log in</a> to invite members.</div></div>`}
    ${orgs.length ? `
      ${orgUpcomingForMe(7).length ? `<div class="card card-pad mb-16"><h3 class="sg-h3 mb-8">This week</h3>${orgUpcomingForMe(7).slice(0, 6).map(({ o, e }) => orgEventRow(o, e, { showOrg: true })).join('')}</div>` : ''}
      <div class="sg-section-label">Yours</div>
      <div class="grid grid-3">${orgs.map(orgIndexCard).join('')}</div>
    ` : orgsEmptyHero()}
    <div class="sg-pricing-note small">${icon('users', 14)} Bringing your whole team or chapter? <a href="${GROUP_PRICING_URL}" target="_blank" rel="noopener">Group pricing</a> covers every member at a lower rate.</div>
  `;
}
function orgsEmptyHero() {
  return emptyStateHtml({
    icon: 'shield',
    title: 'Your org’s calendar, in everyone’s planner.',
    body: 'For clubs, teams, and chapters: officers post a meeting or practice once, and it shows up for every member next to their classes and deadlines.',
    actions: [{ label: 'Start a club or team', onclick: 'openCreateOrgModal()', icon: 'plus' }, { label: 'Join with code', onclick: 'openJoinOrgModal()' }],
    extra: cloudGroupsEnabled() ? '' : `<button class="btn btn-ghost btn-sm" onclick="createSampleOrg()">${icon('eye', 14)} Explore a sample club first</button>`,
  });
}
function orgIndexCard(o) {
  const next = upcomingOrgEvents(o)[0];
  const unread = orgUnreadCount(o);
  const chatUnread = orgChatUnread(o);
  const kind = orgKind(o);
  return `
    <div class="card sg-card org-card" style="${colorVars('org', orgColor(o))}" role="button" tabindex="0" onclick="openOrg('${o.code}')" onkeydown="if(event.key==='Enter')openOrg('${o.code}')">
      <div class="sg-card-top">
        <div class="org-card-id">
          <span class="org-crest" aria-hidden="true">${orgMonogram(o)}</span>
          <div style="min-width:0">
            <div class="sg-card-name">${esc(o.name)}</div>
            <div class="small dim">${[kind[1], o.school ? esc(o.school) : '', o.sample ? 'Sample' : ''].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        ${unread || chatUnread ? `<span class="sg-unread-dot" role="img" aria-label="${[unread ? `${unread} new announcement${unread === 1 ? '' : 's'}` : '', chatUnread ? 'New messages' : ''].filter(Boolean).join(', ')}"></span>` : ''}
      </div>
      <div class="sg-card-line"><span class="sg-card-ic">${icon('calendar', 14)}</span>${next ? `<span><span class="sg-strong">${esc(next.title)}</span><br><span class="dim">${fmtSessionDay(next.date)}${next.start ? ` · ${fmtTime(next.start)}` : ''}</span></span>` : '<span class="dim">Nothing scheduled</span>'}</div>
      <div class="sg-card-foot"><span class="small dim">${o.loading ? 'Loading…' : `${o.memberUids.length} member${o.memberUids.length === 1 ? '' : 's'}`}${isOrgOfficer(o) ? ' · You’re an officer' : ''}</span></div>
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
        <div class="row-meta">${[showOrg ? esc(o.name) : '', orgCatHtml(e), e.start ? `${fmtTime(e.start)}${e.end ? `–${fmtTime(e.end)}` : ''}` : '', e.location ? esc(e.location) : ''].filter(Boolean).join(' · ')}</div>
      </div>
      ${past
        ? `<span class="small muted org-counts">${counts.yes} said they’d go</span>`
        : `<span class="small org-row-answer ${mine ? '' : 'muted'}">${mine === 'yes' ? 'Going' : mine === 'no' ? 'Can’t go' : 'Not answered'}<span class="org-row-count muted"> · ${counts.yes} going</span></span>`}
    </div>`;
}
// Who's going, who can't, and (for officers, who follow up) who hasn't answered.
function orgAttendanceHtml(o, e) {
  const people = orgPeople(o);
  const answer = (p) => o.rsvp?.[p.uid]?.[e.id] || '';
  const group = (label, list, open = true) => `
    <details class="org-rsvp-group" ${open ? 'open' : ''}>
      <summary><span class="sg-strong">${label}</span><span class="assign-count">${list.length}</span></summary>
      ${list.length ? `<div class="org-rsvp-list">${list.map(p => `<div class="sg-person">${personAvatar(p.uid, p.name, 24, p.officer ? orgColor(o) : '#6b6b6b')}<div class="row-title small">${esc(p.name)}${p.uid === myOrgUid(o) && p.name !== 'You' ? ' <span class="muted">(you)</span>' : ''}</div><span class="small muted">${esc(orgRoleLabel(o, p))}</span></div>`).join('')}</div>` : '<div class="small muted org-rsvp-empty">No one yet.</div>'}
    </details>`;
  const going = people.filter(p => answer(p) === 'yes'), cant = people.filter(p => answer(p) === 'no'), none = people.filter(p => !answer(p));
  return `
    ${group(orgEventPast(e) ? 'Said they’d go' : 'Going', going)}
    ${group('Can’t make it', cant, cant.length <= 8)}
    ${isOrgOfficer(o)
      ? `${group('Haven’t answered', none, false)}${none.length && !orgEventPast(e) ? `<button class="btn btn-sm mt-8" onclick="remindToRsvp('${o.code}','${e.id}')">${icon('megaphone', 14)} Remind them to RSVP</button>` : ''}`
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
  const tab = orgTabsFor(o).some(([k]) => k === state.orgTab) ? state.orgTab : 'overview';
  const unread = orgUnreadCount(o);
  if (tab === 'announcements' && unread) setTimeout(() => markOrgSeen(o.code), 0);
  const kind = orgKind(o);
  const chatUnread = orgChatUnread(o);
  const body = { overview: orgOverviewTab, events: orgEventsTab, announcements: orgAnnouncementsTab, chat: orgChatTab, files: orgFilesTab, members: orgMembersTab, admin: orgAdminTab }[tab];
  return `
    <div style="${colorVars('org', orgColor(o))}">
    <button class="btn btn-ghost btn-sm sg-back" onclick="setState({subRoute:null})">${icon('arrow-left', 14)} Clubs & teams</button>
    <div class="org-head">
      <span class="org-crest large" aria-hidden="true">${orgMonogram(o)}</span>
      <div class="org-head-name">
        <div class="sg-eyebrow">${[kind[1], o.school ? esc(o.school) : '', `${o.memberUids.length} member${o.memberUids.length === 1 ? '' : 's'}`, o.sample ? 'Sample' : ''].filter(Boolean).join(' · ')}</div>
        <h2 class="sg-title">${esc(o.name)}</h2>
      </div>
      ${o.description ? `<p class="small muted sg-desc org-head-desc">${esc(o.description)}</p>` : ''}
      <div class="sg-head-actions">
        ${signInHeaderButton()}
        ${isOrgOfficer(o) ? `<button class="btn btn-sm" onclick="openOrgEventModal('${o.code}')">${icon('plus', 14)} Event</button><button class="btn btn-sm" onclick="openAnnouncementModal('${o.code}')">${icon('megaphone', 14)} Announce</button>` : ''}
        <button class="btn btn-sm ${tab === 'overview' && !orgIsBrandNew(o) ? 'btn-primary' : ''}" onclick="openOrgInviteModal('${o.code}')">${icon('user-plus', 14)} Invite</button>
        <button class="btn btn-ghost btn-icon" aria-label="${isOrgOfficer(o) ? `Admin for ${esc(o.name)}` : 'Club settings'}" data-tip="${isOrgOfficer(o) ? 'Admin' : 'Club settings'}" onclick="${isOrgOfficer(o) ? `setState({orgTab:'admin'})` : `openOrgSettingsModal('${o.code}')`}">${icon(isOrgOfficer(o) ? 'shield' : 'settings', 16)}</button>
      </div>
    </div>
    ${orgLinksHtml(o, { editable: isOrgOfficer(o) && !o.local })}
    ${orgLoadNotice(o)}
    <div class="sg-tabs" role="tablist">
      ${orgTabsFor(o).map(([k, label]) => `<button role="tab" aria-selected="${tab === k}" class="${tab === k ? 'active' : ''}" onclick="setState({orgTab:'${k}'})">${k === 'admin' ? `${icon('shield', 12)} ` : ''}${label}${(k === 'announcements' && unread || k === 'chat' && chatUnread) && tab !== k ? '<span class="sg-tab-dot" aria-label="new"></span>' : ''}</button>`).join('')}
    </div>
    <div class="sg-tab-body">${tab === 'overview' && orgIsBrandNew(o) ? orgFirstStepsHtml(o) : body(o)}</div>
    </div>`;
}
// One member, no events, no announcements, no files: the overview would be
// a stack of "nothing yet" cards, so the page leads with the two things
// that make a club real, people and the first event.
function orgIsBrandNew(o) {
  if (o.loading || o.sample) return false;
  return o.memberUids.length <= 1 && !orgEventList(o).length && !orgAnnouncementList(o).length && !orgFileList(o).length;
}
function orgFirstStepsHtml(o) {
  const officer = isOrgOfficer(o);
  return emptyStateHtml({
    icon: 'user-plus',
    title: 'It’s just you so far',
    body: officer ? 'Invite your members with the club code or a link, then add the first meeting or practice and it shows up on everyone’s calendar.' : 'Invite the rest of the group with the club code or a link.',
    actions: [{ label: 'Invite members', onclick: `openOrgInviteModal('${o.code}')`, icon: 'user-plus' }, ...(officer ? [{ label: 'Add an event', onclick: `openOrgEventModal('${o.code}')`, icon: 'plus' }] : [])],
  });
}
function orgOverviewTab(o) {
  const upcoming = upcomingOrgEvents(o);
  const next = upcoming[0];
  const anns = orgAnnouncementList(o).slice(0, 3);
  const officers = orgPeople(o).filter(p => p.officer);
  const unanswered = isOrgOfficer(o) ? upcoming.filter(e => e.required).slice(0, 3).map(e => ({ e, c: orgRsvpCounts(o, e.id) })).filter(x => x.c.none) : [];
  // Required events you haven't answered, before anything else: officers
  // are counting on it (see orgAttendanceHtml), and it's one tap.
  const needMine = upcoming.filter(e => e.required && !myOrgRsvp(o, e.id)).slice(0, 4);
  return `
    <div class="sg-overview">
      <div class="sg-col">
        ${needMine.length ? `
          <div class="card card-pad org-need-answer">
            <div class="flex-between mb-8"><h3 class="sg-h3">${icon('bell', 14)} ${needMine.length === 1 ? 'One required event needs your answer' : `${needMine.length} required events need your answer`}</h3></div>
            ${needMine.map(e => `<div class="list-row sg-session-row org-event-row" onclick="showOrgEventModal('${o.code}','${e.id}')">${dateTile(e.date)}<div class="row-title"><div class="sg-strong">${esc(e.title)}</div><div class="row-meta">${fmtSessionDay(e.date)}${e.start ? ` · ${fmtTime(e.start)}` : ''}${e.location ? ` · ${esc(e.location)}` : ''}</div></div>${orgRsvpControl(o, e)}</div>`).join('')}
          </div>` : ''}
        ${next ? `
          <div class="card sg-next org-next">
            ${(() => { const d = new Date(next.date + 'T00:00:00'); return `<div class="sg-next-date"><span>${d.toLocaleDateString('en-US', { weekday: 'short' })}</span><strong>${d.getDate()}</strong><span>${d.toLocaleDateString('en-US', { month: 'short' })}</span></div>`; })()}
            <div class="sg-next-body">
              <div class="sg-eyebrow">Next up · ${fmtSessionDay(next.date)}${next.required ? ' · <span class="org-required">Required</span>' : ''}</div>
              <div class="sg-next-title">${esc(next.title)}</div>
              <div class="small muted sg-meta-line">${next.start ? `<span>${icon('clock', 12)} ${fmtTime(next.start)}${next.end ? `–${fmtTime(next.end)}` : ''}</span>` : ''}${next.location ? `<span>${icon('map-pin', 12)} ${linkifyWhere(next.location)}</span>` : ''}</div>
              ${next.notes ? `<div class="small sg-notes">${linkifyText(next.notes)}</div>` : ''}
              <div class="sg-next-foot">${orgRsvpControl(o, next)}${joinLinkButton(next.location)}${(() => { const goingUids = orgPeople(o).filter(p => o.rsvp?.[p.uid]?.[next.id] === 'yes'); return `<button class="sg-link org-going-link" onclick="showOrgEventModal('${o.code}','${next.id}')" aria-label="See who’s going to ${esc(next.title)}">${goingUids.length ? `<span class="sg-stack">${goingUids.slice(0, 4).map(p => personAvatar(p.uid, p.name, 22, p.officer ? orgColor(o) : '#6b6b6b')).join('')}</span>` : ''}${goingUids.length} going · See who</button>`; })()}</div>
            </div>
          </div>` : `
          <div class="card card-pad sg-next-empty">
            <div class="sg-eyebrow">Calendar</div>
            <div class="sg-next-title">Nothing scheduled yet</div>
            <p class="small muted">${isOrgOfficer(o) ? 'Add your first meeting or practice and it shows up on every member’s calendar.' : 'When officers add events, they’ll show up here and on your calendar.'}</p>
            ${isOrgOfficer(o) ? `<button class="btn btn-primary btn-sm mt-8" onclick="openOrgEventModal('${o.code}')">${icon('plus', 14)} Add an event</button>` : ''}
          </div>`}
        <div class="card card-pad">
          <div class="flex-between mb-8"><h3 class="sg-h3">Coming up</h3><button class="sg-link" onclick="setState({orgTab:'events'})">Full calendar ${icon('chevron-right', 12)}</button></div>
          ${upcoming.slice(1).filter(e => !needMine.includes(e)).slice(0, 5).map(e => orgEventRow(o, e)).join('') || '<p class="small muted">Nothing else scheduled.</p>'}
        </div>
      </div>
      <div class="sg-col">
        ${unanswered.length ? `<div class="card card-pad org-officer-card"><div class="sg-eyebrow">${icon('shield', 12)} Officer view</div>${unanswered.map(({ e, c }) => `<div class="small mt-8"><span class="sg-strong">${esc(e.title)}</span>: ${c.none} haven’t RSVPed. <button class="sg-link" onclick="showOrgEventModal('${o.code}','${e.id}')">See who</button></div>`).join('')}</div>` : ''}
        <div class="card card-pad">
          <div class="flex-between mb-8"><h3 class="sg-h3">Announcements</h3>${isOrgOfficer(o) ? `<button class="sg-link" onclick="openAnnouncementModal('${o.code}')">${icon('plus', 12)} Post</button>` : `<button class="sg-link" onclick="setState({orgTab:'announcements'})">All ${icon('chevron-right', 12)}</button>`}</div>
          ${anns.length ? anns.map(a => orgAnnouncementHtml(o, a, { compact: true })).join('') : '<p class="small muted">No announcements yet.</p>'}
        </div>
        ${(() => { const files = orgFileList(o).slice(0, 3); return files.length ? `
        <div class="card card-pad">
          <div class="flex-between mb-8"><h3 class="sg-h3">Files</h3><button class="sg-link" onclick="setState({orgTab:'files'})">All ${orgFileList(o).length} ${icon('chevron-right', 12)}</button></div>
          ${files.map(f => orgFileRow(o, f, { compact: true })).join('')}
        </div>` : ''; })()}
        <div class="card card-pad">
          <div class="flex-between mb-8"><h3 class="sg-h3">Officers</h3><button class="sg-link" onclick="setState({orgTab:'members'})">${o.memberUids.length} members ${icon('chevron-right', 12)}</button></div>
          ${officers.map(p => `<div class="sg-person">${personAvatar(p.uid, p.name, 28, orgColor(o))}<div class="row-title small">${esc(p.name)}${p.uid === myOrgUid(o) && p.name !== 'You' ? ' <span class="muted">(you)</span>' : ''}</div><span class="small muted">${esc(orgRoleLabel(o, p))}</span></div>`).join('')}
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
        ${upcoming.length ? `<button class="btn btn-sm" onclick="downloadOrgIcs('${o.code}')">${icon('download', 14)} Add all to calendar app</button>` : ''}
        ${isOrgOfficer(o) ? `<button class="btn btn-primary btn-sm" onclick="openOrgEventModal('${o.code}')">${icon('plus', 14)} Event</button>` : ''}
      </div>
    </div>
    ${byMonth.length ? byMonth.map(g => `<div class="sg-section-label">${esc(g.label)}</div><div class="card card-pad mb-16">${g.items.map(e => orgEventRow(o, e)).join('')}</div>`).join('') : emptyState(icon('calendar', 24), 'No upcoming events', isOrgOfficer(o) ? `<button class="btn btn-primary btn-sm" onclick="openOrgEventModal('${o.code}')">${icon('plus', 14)} Add an event</button>` : '', isOrgOfficer(o) ? 'Weekly meetings can repeat, so you only add them once.' : '')}
    ${past.length ? `<details class="sg-past"><summary class="small muted">Past events (${past.length})</summary><div class="card card-pad">${past.slice(0, 40).map(e => orgEventRow(o, e)).join('')}</div></details>` : ''}
  `;
}
function orgAnnouncementHtml(o, a, { compact = false } = {}) {
  const text = compact && a.text.length > 220 ? a.text.slice(0, 220) + '…' : a.text;
  return `
    <div class="org-ann ${a.pinned ? 'is-pinned' : ''}">
      <div class="flex-between">
        <div class="small"><span class="sg-strong">${esc(a.name)}</span> <span class="muted">· ${fmtRelativeTime(a.at)}</span>${a.pinned ? ` <span class="org-pin">${icon('pin', 11)} Pinned</span>` : ''}</div>
        ${!compact && isOrgOfficer(o) ? `<div class="flex-gap"><button class="btn btn-ghost btn-icon btn-sm" aria-label="${a.pinned ? 'Unpin' : 'Pin'} announcement" onclick="pinAnnouncement('${o.code}','${a.id}',${!a.pinned})">${icon('pin', 14)}</button><button class="btn btn-ghost btn-icon btn-sm" aria-label="Delete announcement" data-tip="Delete announcement" onclick="deleteAnnouncement('${o.code}','${a.id}')">${icon('trash', 14)}</button></div>` : ''}
      </div>
      <div class="org-ann-text">${linkifyText(text)}</div>
    </div>`;
}
function orgAnnouncementsTab(o) {
  const anns = orgAnnouncementList(o);
  return `
    ${isOrgOfficer(o) ? `<div class="sg-toolbar"><div class="small muted">Members see new announcements on their dashboard.</div><button class="btn btn-primary btn-sm" onclick="openAnnouncementModal('${o.code}')">${icon('megaphone', 14)} New announcement</button></div>` : ''}
    ${anns.length ? `<div class="card card-pad">${anns.map(a => orgAnnouncementHtml(o, a)).join('')}</div>` : emptyState(icon('megaphone', 24), 'No announcements yet', '', isOrgOfficer(o) ? 'Dues reminders, carpool plans, last-minute changes.' : 'Officers’ updates will show up here.')}
  `;
}
function orgMembersTab(o) {
  const people = orgPeople(o);
  const me = myOrgUid(o);
  const officerCount = people.filter(p => p.officer).length;
  // Someone who joined with a position ("Treasurer") but isn't an officer
  // yet: only the founder can give officer access, so the founder is asked.
  const requests = isOrgOwner(o) ? people.filter(p => p.title && !p.officer && !p.reviewed) : [];
  const officer = isOrgOfficer(o);
  const memberRow = (p) => `
        <div class="sg-person org-member" data-search="${esc((p.name + ' ' + orgRoleLabel(o, p)).toLowerCase())}">
          ${personAvatar(p.uid, p.name, 30, p.officer ? orgColor(o) : '#6b6b6b')}
          <div class="row-title"><div class="small sg-strong">${esc(p.name)}${p.uid === me && p.name !== 'You' ? ' <span class="muted">(you)</span>' : ''}</div><div class="small muted">${esc(orgRoleLabel(o, p))}${p.officer && p.title ? ` · <span class="org-officer-tag">${icon('shield', 11)} ${p.owner ? 'Founder' : 'Officer'}</span>` : ''}</div></div>
          ${officer && !o.local ? `<button class="btn btn-ghost btn-sm" onclick="openMemberRoleModal('${o.code}','${esc(p.uid)}')">Manage</button>` : p.uid === me ? `<button class="btn btn-ghost btn-sm" onclick="openMyOrgTitleModal('${o.code}')">Edit title</button>` : ''}
        </div>`;
  const officers = people.filter(p => p.officer), general = people.filter(p => !p.officer);
  return `
    <div class="sg-toolbar">
      <div class="small muted">${people.length} member${people.length === 1 ? '' : 's'} · ${officerCount} officer${officerCount === 1 ? '' : 's'}</div>
      <div class="flex-gap wrap">
        ${officer ? `<button class="btn btn-sm" onclick="setState({orgTab:'admin'});setTimeout(()=>document.getElementById('org-attendance')?.scrollIntoView({block:'start'}),80)">${icon('check-square', 14)} Attendance</button><button class="btn btn-sm" onclick="downloadOrgRosterCsv('${o.code}')">${icon('download', 14)} Export roster</button>` : ''}
      </div>
    </div>
    ${people.length >= 8 ? `<input class="input org-member-search mb-8" id="org-member-search" placeholder="Search ${people.length} members by name or title" aria-label="Search members" autocomplete="off" oninput="filterOrgMembers(this.value)">` : ''}
    ${requests.map(p => `
      <div class="sg-callout org-request mb-8"><span>${icon('shield', 14)}</span>
        <div class="small" style="flex:1"><span class="sg-strong">${esc(p.name)}</span> joined as <span class="sg-strong">${esc(p.title)}</span>. Make them an officer so they can add events, post announcements, and share files?</div>
        <div class="flex-gap"><button class="btn btn-sm" onclick="reviewOrgRole('${o.code}','${esc(p.uid)}',false)">Not now</button><button class="btn btn-primary btn-sm" onclick="reviewOrgRole('${o.code}','${esc(p.uid)}',true)">Make officer</button></div>
      </div>`).join('')}
    <div class="card card-pad" id="org-member-list">
      <div class="sg-section-label org-member-head" style="margin-top:0">Officers <span class="assign-count">${officers.length}</span></div>
      ${officers.map(memberRow).join('')}
      <div class="sg-section-label org-member-head">${esc(orgGeneralLabel(o))} <span class="assign-count">${general.length}</span></div>
      ${general.length ? general.map(memberRow).join('') : `<p class="small muted">No one yet. <button class="sg-link" onclick="openOrgInviteModal('${o.code}')">Invite members</button></p>`}
      <p class="small muted org-member-none" hidden>No one matches that.</p>
    </div>
    <details class="card card-pad org-roles-help mt-16">
      <summary class="sg-strong small">${icon('chevron-right', 12)}How roles work</summary>
      <div class="small muted mt-8">
        <p><span class="sg-strong">Founder:</span> whoever started ${esc(o.name)}. The founder is an officer and is the only one who can make someone else an officer.</p>
        <p><span class="sg-strong">Officers:</span> add events, post announcements, share files, see who hasn’t RSVPed, and manage members.</p>
        <p><span class="sg-strong">${esc(orgGeneralLabel(o))}:</span> RSVP, chat, and open shared files. Events show up on their calendar.</p>
        <p>Anyone can add a title, like Treasurer or Captain, that shows next to their name. When someone joins with a title, the founder is asked whether they should be an officer.</p>
      </div>
    </details>`;
}
function filterOrgMembers(q) {
  const needle = String(q || '').trim().toLowerCase();
  let shown = 0;
  $$('#org-member-list .org-member').forEach(el => { const on = !needle || el.dataset.search.includes(needle); el.hidden = !on; if (on) shown++; });
  $$('#org-member-list .org-member-head').forEach(el => { el.hidden = !!needle; });
  const none = $('#org-member-list .org-member-none');
  if (none) none.hidden = shown > 0;
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
    <div class="modal-head"><h3>${esc(e.title)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body">
      <div class="sg-eyebrow">${esc(o.name)} · ${orgCatHtml(e)}${e.seriesId ? ' · Weekly' : ''}${e.required ? ' · <span class="org-required">Required</span>' : ''}</div>
      <div class="small sg-meta-line mt-8">
        <span>${icon('calendar', 12)} ${esc(fmtDateLong(e.date))}</span>
        ${e.start ? `<span>${icon('clock', 12)} ${fmtTime(e.start)}${e.end ? `–${fmtTime(e.end)}` : ''}</span>` : ''}
        ${e.location ? `<span>${icon('map-pin', 12)} ${linkifyWhere(e.location)}</span>` : ''}
      </div>
      ${e.notes ? `<div class="small sg-notes mt-8">${linkifyText(e.notes)}</div>` : ''}
      ${!past ? `<div class="flex-gap wrap mt-16" style="align-items:center">${orgRsvpControl(o, e)}${joinLinkButton(e.location)}<button class="btn btn-ghost btn-sm" onclick="downloadOrgIcs('${o.code}','${e.id}')">${icon('download', 14)} Add to calendar app</button></div>` : ''}
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
  const later = e?.seriesId ? orgEventList(o).filter(x => x.seriesId === e.seriesId && x.date > e.date).length : 0;
  const v = e || { title: '', category: 'meeting', date: todayIso(), start: '19:00', end: '20:00', location: '', required: false, notes: '' };
  openModal(`
    <div class="modal-head"><h3>${e ? 'Edit event' : `New event for ${esc(o.name)}`}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
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
      ${!e ? `<div class="field-row mt-8" style="align-items:center"><label class="checkbox-row small" style="margin:0"><input type="checkbox" id="oe-repeat" onchange="$('#oe-weeks').disabled=!this.checked"><span>Repeat weekly for</span></label><select class="select" id="oe-weeks" style="max-width:110px" disabled aria-label="How many weeks">${[2, 4, 6, 8, 10, 12, 15].map(n => `<option value="${n}" ${n === 8 ? 'selected' : ''}>${n} weeks</option>`).join('')}</select></div>` : ''}
      ${e && later > 0 ? `<label class="checkbox-row small mt-8"><input type="checkbox" id="oe-series"><span>Also update the ${later} later event${later === 1 ? '' : 's'} in this weekly series (they keep their dates)</span></label>` : ''}
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
  let laterCount = 0;
  if (eventId) {
    Object.entries({ ...base, date }).forEach(([k, val]) => { ops[`events.${eventId}.${k}`] = val; });
    // Practice moved from 6 to 7 for the rest of the season: the later
    // events in the series take the new details but keep their own dates.
    const cur = orgEventList(o).find(x => x.id === eventId);
    if ($('#oe-series')?.checked && cur?.seriesId) {
      const later = orgEventList(o).filter(x => x.seriesId === cur.seriesId && x.date > cur.date);
      laterCount = later.length;
      later.forEach(x => Object.entries(base).forEach(([k, val]) => { ops[`events.${x.id}.${k}`] = val; }));
    }
  } else {
    const weeks = $('#oe-repeat')?.checked ? Number($('#oe-weeks').value) || 1 : 1;
    const seriesId = weeks > 1 ? uid() : null;
    for (let i = 0; i < weeks; i++) {
      const id = uid();
      ops[`events.${id}`] = { id, ...base, date: addDays(date, i * 7), seriesId, createdBy: myOrgUid(o), createdAt: Date.now() };
    }
  }
  setBtnLoading($('#oe-save'), true);
  if (await orgWrite(code, ops)) { closeModal(); const n = Object.keys(ops).length; toast(eventId ? (laterCount ? `Updated this and ${laterCount} later event${laterCount === 1 ? '' : 's'}` : 'Event updated') : n > 1 ? `Added ${n} weekly events` : 'Event added. Members will see it on their calendar.'); }
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
    <div class="modal-head"><h3>Announcement to ${esc(o.name)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body">
      <div class="field"><label for="an-text">Message</label><textarea class="input" id="an-text" maxlength="${ORG_ANNOUNCEMENT_MAX}" style="min-height:130px" placeholder="Practice moved to 6 tomorrow because of the storm.">${esc(prefill)}</textarea></div>
      <label class="checkbox-row small"><input type="checkbox" id="an-pin"><span>Pin to the top</span></label>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="an-post" onclick="postAnnouncement('${o.code}')">${icon('send', 14)} Post</button></div>
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
    diag.error('clubs', 'Club chat listener failed', err);
    _orgChatFailed[code] = true; // not retried until the tab is opened again, so a failure can't loop
    _orgChatSub = { code: null, unsub: null };
    renderRemote();
  });
}
// Runs after every render (see render() in app.js).
function afterOrgPageRender() {
  const code = state.route === 'orgs' ? state.subRoute : null;
  if (code && typeof centerActiveSgTab === 'function') centerActiveSgTab();
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
        ${mine || officer ? `<button class="sg-msg-del" aria-label="Delete message" data-tip="Delete" onclick="deleteOrgMessage('${o.code}','${m.id}')">${icon('x', 11)}</button>` : ''}
      </div>`;
  }).join('');
  return `
    <div class="card sg-chat">
      <div class="sg-chat-log" id="org-chat-log" data-keep-scroll="bottom">
        ${_orgChatFailed[o.code] ? emptyState(icon('message-circle', 24), 'Chat didn’t load', `<button class="btn btn-sm mt-8" onclick="delete _orgChatFailed['${o.code}'];render()">Try again</button>`, 'Check your connection, then try again.')
          : loading ? '<div class="small muted" style="padding:18px;text-align:center">Loading messages…</div>'
          : msgs.length ? rows : emptyState(icon('message-circle', 24), 'No messages yet', '', `Say hi to ${o.name}. Everyone in the ${o.kind === 'team' ? 'team' : o.kind === 'chapter' ? 'chapter' : 'club'} sees this chat.`)}
      </div>
      <div class="sg-chat-compose">
        <input class="input" id="org-chat-input" maxlength="${GROUP_MESSAGE_MAX}" autocomplete="off" placeholder="Message ${esc(o.name)}" onkeydown="if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();sendOrgMessage('${o.code}')}">
        <button class="btn btn-primary" aria-label="Send message" data-tip="Send" onclick="sendOrgMessage('${o.code}')">${icon('send', 14)}</button>
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
    ref.update({ lastMessage, updatedAt: Date.now() }).catch(e => diag.warn('clubs', 'Club lastMessage update failed', e));
    markOrgChatSeen(code, msg.at);
    playUiSound('send');
  } catch (e) {
    diag.error('clubs', 'Club message failed', e);
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
    <div class="modal-head"><h3>Start a club or team</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body">
      <div class="field"><label for="of-name">Name</label><input class="input" id="of-name" maxlength="80" placeholder="Women in Business"></div>
      <div class="field"><label>What is it?</label><div class="chip-row" id="of-kind" role="group" aria-label="Kind">${ORG_KINDS.map(([k, l, ic]) => `<button type="button" class="chip ${k === 'club' ? 'active' : ''}" aria-pressed="${k === 'club'}" onclick="_orgDraft.kind='${k}';$$('#of-kind .chip').forEach(b=>{b.classList.toggle('active',b===this);b.setAttribute('aria-pressed',b===this)})">${icon(ic, 12)} ${l}</button>`).join('')}</div></div>
      <div class="field-row">
        <div class="field"><label for="of-school">School <span class="muted">(optional)</span></label><input class="input" id="of-school" maxlength="80" value="${esc(state.settings.school || '')}" placeholder="University of Georgia"></div>
        <div class="field"><label>Color</label><div class="org-colors" id="of-colors" role="group" aria-label="Color">${ORG_COLORS.map((c, i) => `<button type="button" class="page-color ${i === 0 ? 'active' : ''}" style="background:${c}" aria-label="Color ${i + 1}" aria-pressed="${i === 0}" onclick="_orgDraft.color='${c}';$$('#of-colors button').forEach(b=>{b.classList.toggle('active',b===this);b.setAttribute('aria-pressed',b===this)})"></button>`).join('')}</div></div>
      </div>
      <div class="field"><label for="of-desc">Description <span class="muted">(optional)</span></label><input class="input" id="of-desc" maxlength="200" placeholder="Meetings Tuesdays at 7 in the Union"></div>
      <div class="field"><label for="of-title">Your title <span class="muted">(optional)</span></label>
        <input class="input" id="of-title" maxlength="${ORG_TITLE_MAX}" placeholder="President, Captain, Chair…">
        <div class="chip-row mt-8">${ORG_TITLE_SUGGESTIONS.map(t => `<button type="button" class="chip" onclick="$('#of-title').value='${t}'">${t}</button>`).join('')}</div>
      </div>
      <div class="sg-callout small mb-8"><span>${icon('shield', 14)}</span><div>You’ll be the founder and an officer. Officers add events, post announcements, share files, and see who’s coming. You can make other members officers from the Members tab.</div></div>
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
    if (typeof countSetupStep === 'function') countSetupStep('setup_group_joined', 'club');
    closeModal();
    openOrg(code);
    setTimeout(() => openOrgInviteModal(code, { justCreated: true }), 150);
  } catch (e) {
    diag.error('clubs', 'Create club failed', e);
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
    <div class="modal-head"><h3>${justCreated ? `${esc(o.name)} is ready` : `Invite to ${esc(o.name)}`}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body">
      ${o.local ? `<div class="sg-callout small mb-16"><div>${o.sample ? 'This is a sample club, so the code is just for show.' : 'You’re not logged in, so no one can join yet. <a href="login.html">Log in</a> to invite members.'}</div></div>` : ''}
      <p class="small muted" style="text-align:center">Members join with this code:</p>
      <div class="sg-invite-code" aria-label="Code ${code.split('').join(' ')}">${code.split('').map(ch => `<span>${ch}</span>`).join('')}</div>
      <div class="field mt-16"><label for="org-invite-link">Or share a link in your group chat</label>
        <div class="sg-invite-row"><input class="input" id="org-invite-link" value="${esc(orgInviteLink(code))}" readonly onclick="this.select()"><button class="btn btn-primary" onclick="copyText(orgInviteMessage('${code}'),'Invite copied')">${icon('copy', 14)} Copy</button></div>
      </div>
      ${navigator.share ? `<button class="btn" style="width:100%;justify-content:center" onclick="navigator.share({title:'Join on Semester HQ',text:orgInviteMessage('${code}')}).catch(()=>{})">${icon('send', 14)} Share via Messages, GroupMe…</button>` : ''}
      <div class="sg-pricing-inline small mt-16">
        <span class="sg-feature-ic">${icon('shield', 16)}</span>
        <div><span class="sg-strong">Getting the whole ${o.kind === 'team' ? 'team' : o.kind === 'chapter' ? 'chapter' : 'club'} on?</span><div class="muted">Each member needs Semester HQ. ${isOrgOfficer(o) && typeof orgGroupPlanUrl === 'function'
          ? `A <a href="${orgGroupPlanUrl(o)}">group plan</a> covers every member for $5.99 each a month, and can come out of your budget or dues. Members join from one link.`
          : `<a href="${GROUP_PRICING_URL}" target="_blank" rel="noopener">Group pricing</a> covers everyone for less, and can come out of your budget or dues.`}</div></div>
      </div>
    </div>
  `);
}
function openJoinOrgModal(prefill = '') {
  if (!cloudGroupsEnabled()) {
    openModal(`
      <div class="modal-head"><h3>Join a club or team</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
      <div class="modal-body"><p class="small muted">Joining needs a Semester HQ account, so the events stay in sync with your officers.</p></div>
      <div class="modal-foot"><button class="btn" onclick="closeModal()">Not now</button>${fbConfigured() ? '<a class="btn btn-primary" href="login.html">Log in or sign up</a>' : ''}</div>
    `);
    return;
  }
  openModal(`
    <div class="modal-head"><h3>Join a club or team</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
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
    <div class="modal-head"><h3>You’re invited</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body">
      <div class="sg-join-card" style="${colorVars('org', orgColor(o))}">
        <span class="org-crest large" aria-hidden="true">${orgMonogram(o)}</span>
        <div class="sg-join-name">${esc(o.name)}</div>
        <div class="small muted">${[kind[1], o.school ? esc(o.school) : '', `${o.memberUids.length} member${o.memberUids.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</div>
        ${o.description ? `<div class="small mt-8">${esc(o.description)}</div>` : ''}
        ${next ? `<div class="small muted mt-8">Next: ${esc(next.title)}, ${fmtSessionDay(next.date)}${next.start ? ` at ${fmtTime(next.start)}` : ''}</div>` : ''}
        ${orgLinksHtml(o)}
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
    if (typeof countSetupStep === 'function') countSetupStep('setup_group_joined', 'club');
    closeModal();
    openOrg(code);
    playUiSound('success');
    toast(`You joined ${name}. Its events are on your calendar now.`, 'success', 4500);
  } catch (e) {
    setBtnLoading(btn, false, 'Join');
    toast(e.message?.startsWith('That club') ? e.message : 'Couldn’t join. Check your connection and try again.', 'error', 5000);
  }
}
/* ── ?org=CODE invite links ────────────────────────────────────── */
function captureOrgParam() {
  const params = new URLSearchParams(location.search);
  if (!params.has('org')) return;
  const code = normalizeCode(params.get('org'));
  // ?org=CODE&tab=admin is the direct link an officer bookmarks or sends a
  // co-officer (see orgAdminLink); a member who opens it just lands on the
  // club, since the Admin tab only exists for officers.
  const tab = params.get('tab') || '';
  params.delete('org');
  params.delete('tab');
  history.replaceState({}, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
  if (code.length === 6 && !isEmbedded()) try { localStorage.setItem(PENDING_ORG_KEY, JSON.stringify({ code, at: Date.now(), tab })); } catch {}
}
function pendingOrgCode() { try { const p = JSON.parse(localStorage.getItem(PENDING_ORG_KEY) || 'null'); return p?.code && Date.now() - p.at < 14 * 86400000 ? p.code : null; } catch { return null; } }
function pendingOrgTab() { try { const p = JSON.parse(localStorage.getItem(PENDING_ORG_KEY) || 'null'); return p?.tab || ''; } catch { return ''; } }
function clearPendingOrg() { try { localStorage.removeItem(PENDING_ORG_KEY); } catch {} }
let _orgInviteShown = false;
async function handlePendingOrg() {
  const code = pendingOrgCode();
  if (!code || !fbConfigured() || isEmbedded()) return;
  if (!_fbUser) {
    if (_orgInviteShown) return;
    _orgInviteShown = true;
    openModal(`
      <div class="modal-head"><h3>You’re invited to join a club</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
      <div class="modal-body"><div class="sg-invite-code small-code">${code.split('').map(ch => `<span>${ch}</span>`).join('')}</div><p class="small muted mt-16">Log in or create your Semester HQ account to join. Its events go straight onto your calendar.</p></div>
      <div class="modal-foot"><button class="btn" onclick="closeModal()">Look around first</button><a class="btn btn-primary" href="login.html">Log in to join</a></div>
    `);
    return;
  }
  if (!window._licensed) return;
  if (orgEntry(code)?.cloud) {
    const tab = pendingOrgTab();
    clearPendingOrg();
    // Already a member: honor the tab the link asked for, when it's one this
    // person can actually see.
    openOrg(code, tab && orgTabsFor(findOrg(code) || {}).some(([k]) => k === tab) ? tab : undefined);
    return;
  }
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
    ev('General meeting', 'meeting', nextDow(2), '19:00', '20:00', 'Student Union 210', { required: true, notes: 'Voting on the spring trip. Bring ideas for the networking night.', seriesId: 'sample-gm' }),
    ev('Networking night with alumni', 'social', addDays(t, 9), '18:30', '20:30', 'Business School atrium', { notes: 'Business casual. Bring a few copies of your resume.' }),
    ev('Dues deadline', 'deadline', addDays(t, 5), '', '', '', { required: true, notes: '$40 for the semester. Venmo the treasurer.' }),
    ev('Food bank volunteering', 'service', addDays(t, 12), '10:00', '13:00', 'Downtown food bank'),
    ev('General meeting', 'meeting', addDays(nextDow(2), 7), '19:00', '20:00', 'Student Union 210', { required: true, seriesId: 'sample-gm' }),
    ev('General meeting', 'meeting', addDays(nextDow(2), -7), '19:00', '20:00', 'Student Union 210', { required: true, seriesId: 'sample-gm', createdAt: now - 20 * D }),
    ev('Resume workshop', 'social', addDays(t, -4), '18:00', '19:30', 'Business School 114', { createdAt: now - 12 * D }),
  ]);
  const ids = Object.keys(events);
  const H = 3600000;
  const fileId = uid(), linkId = uid();
  const dues = 'Spring dues\n\n$40 for the semester, due Friday.\nVenmo @noah-treasurer and put your name in the note.\nQuestions? Ask Noah in chat.\n';
  const messages = [
    { uid: lena, name: 'Lena', text: 'Is the networking night business casual or business formal?', at: now - 27 * H },
    { uid: ava, name: 'Ava', text: 'Business casual! Bring a few copies of your resume.', at: now - 26.5 * H },
    { uid: jade, name: 'Jade', text: 'I can drive 3 people to the food bank on Saturday.', at: now - 5 * H },
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
    rsvp: { [ava]: { [ids[0]]: 'yes', [ids[1]]: 'yes', [ids[5]]: 'yes', [ids[6]]: 'yes' }, [noah]: { [ids[0]]: 'yes', [ids[3]]: 'yes', [ids[5]]: 'yes', [ids[6]]: 'yes' }, [lena]: { [ids[0]]: 'no', [ids[1]]: 'yes', [ids[5]]: 'yes', [ids[6]]: 'no' }, [sam]: { [ids[1]]: 'yes', [ids[6]]: 'yes' }, [jade]: { [ids[5]]: 'yes' } },
    links: [{ id: 'sample-groupme', label: 'GroupMe', url: 'https://groupme.com/' }, { id: 'sample-ig', label: 'Instagram', url: 'https://instagram.com/' }, { id: 'sample-venmo', label: 'Venmo for dues', url: 'https://venmo.com/' }],
    announcements: Object.fromEntries([
      { text: 'Dues are due this Friday. $40 for the semester, Venmo @noah-treasurer with your name in the note.', uid: noah, name: 'Noah', at: now - 20 * 3600000, pinned: true },
      { text: 'Huge thank you to everyone who came to the resume workshop! Slides are in the drive: https://example.com/slides', uid: ava, name: 'Ava', at: now - 3 * D },
    ].map(a => { const id = uid(); return [id, { id, ...a }]; })),
  };
  orgEntries().push(entry);
  openOrg(code);
  toast('This is a sample club. Try RSVPing, see who’s going, or say hi in Chat.', 'info', 4500);
}
