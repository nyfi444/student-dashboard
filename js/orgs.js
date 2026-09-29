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
const ORG_TABS = [['overview', 'Overview'], ['events', 'Calendar'], ['announcements', 'Announcements'], ['files', 'Files'], ['members', 'Members'], ['chat', 'Chat']];
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
// A small glyph for the service a link goes to, and "Pay dues" for the first
// link that goes to a payment app, so members find it without reading labels.
const ORG_LINK_GLYPHS = [[/instagram|tiktok/i, 'camera'], [/groupme|discord|slack|whatsapp|messenger|telegram/i, 'message-circle'], [/drive\.google|docs\.google|dropbox|onedrive|notion/i, 'folder'], [/calendar/i, 'calendar']];
const ORG_DUES_LINK = /venmo|paypal|cash\.app|cashapp|zelle|\bdues\b/i;
function orgLinksHtml(o, { editable = false } = {}) {
  const links = orgLinkList(o);
  if (!links.length && !editable) return '';
  const duesId = links.find(l => ORG_DUES_LINK.test(`${l.url} ${l.label}`))?.id;
  const glyph = (l) => (ORG_LINK_GLYPHS.find(([re]) => re.test(`${l.url} ${l.label}`)) || [0, 'link'])[1];
  return `<div class="org-links">${links.map(l => `<a class="org-link-pill" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"${l.id === duesId ? ` title="${esc(l.label)}"` : ''}>${icon(l.id === duesId ? 'check-square' : glyph(l), 12)} ${l.id === duesId ? 'Pay dues' : esc(l.label)}</a>`).join('')}${editable ? `<button class="org-link-pill is-edit" onclick="openOrgLinksModal('${o.code}')">${icon('pencil', 11)} ${links.length ? 'Edit links' : 'Add links'}</button>` : ''}</div>`;
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
      ${orgsThisWeek()}
      <div class="sg-section-label">Yours</div>
      <div class="space-grid">${orgs.map(orgIndexCard).join('')}</div>
    ` : orgsEmptyHero()}
    <div class="sg-pricing-note small">${icon('users', 14)} Bringing your whole team or chapter? <a href="${GROUP_PRICING_URL}" target="_blank" rel="noopener">Group pricing</a> covers every member at a lower rate.</div>
  `;
}
function orgsThisWeek() {
  return spaceWeekCard({
    title: 'This week',
    rows: orgUpcomingForMe(7).map(({ o, e }) => ({
      date: e.date,
      html: `
        <div class="list-row space-week-item space" style="${spaceVars(orgColor(o))}" onclick="showOrgEventModal('${o.code}','${e.id}')">
          ${spaceCrest({ text: orgMonogram(o) }, 'xs')}
          <div class="row-title"><div class="sg-strong">${esc(e.title)}${e.required ? ' <span class="org-required">Required</span>' : ''}</div><div class="row-meta">${[e.start ? `${fmtTime(e.start)}${e.end ? ` to ${fmtTime(e.end)}` : ''}` : '', esc(o.name), e.location ? esc(e.location) : ''].filter(Boolean).join(' · ')}</div></div>
          ${orgRsvpControl(o, e)}
        </div>`,
    })),
  });
}
function orgsEmptyHero() {
  return emptyStateHtml({
    icon: 'shield',
    title: 'Your org’s calendar, in everyone’s planner.',
    body: 'For clubs, teams, and chapters: officers post a meeting or practice once, and it shows up for every member next to their classes and deadlines.',
    actions: [{ label: 'Start a club or team', onclick: 'openCreateOrgModal()', icon: 'plus' }, { label: 'Join with code', onclick: 'openJoinOrgModal()' }],
    extra: cloudGroupsEnabled() ? '' : sampleOrgChipsHtml(),
  });
}
// Faces in a club's colors: officers in the club color, everyone else in
// lighter steps of it, so a stack never reads as a row of grey dots.
function orgFaceColors(o) {
  const color = orgColor(o), map = {};
  orgPeople(o).forEach((p, i) => { map[p.uid] = p.officer ? color : spaceTint(color, (i % 3) + 1); });
  return map;
}
// What a club needs from you: required upcoming events you haven't answered.
function orgIndexNeedCount(o) { return upcomingOrgEvents(o).filter(e => e.required && !myOrgRsvp(o, e.id)).length; }
function orgIndexCard(o) {
  const next = upcomingOrgEvents(o)[0];
  const unread = orgUnreadCount(o);
  const chatUnread = orgChatUnread(o);
  const kind = orgKind(o);
  const faces = orgFaceColors(o);
  const count = o.memberUids.length;
  return spaceCard({
    code: o.code,
    color: orgColor(o),
    crest: { text: orgMonogram(o) },
    eyebrow: [kind[1], o.school ? esc(o.school) : '', o.sample ? 'Sample' : ''].filter(Boolean).join(' · '),
    name: o.name,
    onclick: `openOrg('${o.code}')`,
    style: colorVars('org', orgColor(o)),
    nextHtml: next
      ? `${spaceCountdownChip(next.date, next.start, next.end)}<span class="space-card-when"><span class="em">${esc(next.title)}</span>${spaceWhen(next.date, next.start) ? ` · ${esc(spaceWhen(next.date, next.start))}` : ''}</span>`
      : '<span class="space-card-when">Nothing scheduled</span>',
    unread: !!(unread || chatUnread),
    unreadLabel: [unread ? `${unread} new announcement${unread === 1 ? '' : 's'}` : '', chatUnread ? 'New messages' : ''].filter(Boolean).join(', '),
    footHtml: `${avatarStackHtml(orgPeople(o), 4, 24, (uid) => faces[uid])}<span>${o.loading ? 'Loading…' : `${count} member${count === 1 ? '' : 's'}`}</span>${isOrgOfficer(o) ? `<span class="space-officer">${icon('shield', 12)} Officer</span>` : ''}`,
    needCount: o.loading ? 0 : orgIndexNeedCount(o),
  });
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
  const officer = isOrgOfficer(o);
  const body = { overview: orgOverviewTab, events: orgEventsTab, announcements: orgAnnouncementsTab, chat: orgChatTab, files: orgFilesTab, members: orgMembersTab, admin: orgAdminTab }[tab];
  const crest = { text: orgMonogram(o) };
  const faces = orgFaceColors(o);
  // Invite is the band's primary on the overview; the other tabs lead with their own action.
  const invite = { onclick: `openOrgInviteModal('${o.code}')`, primary: tab === 'overview' && !orgIsBrandNew(o) };
  return spaceShell({
    kind: 'club',
    code: o.code,
    color: orgColor(o),
    // --org is what the tab bodies read the club color from.
    rootStyle: colorVars('org', orgColor(o)),
    band: {
      code: o.code,
      crest,
      eyebrow: [kind[1], o.school ? esc(o.school) : '', `${o.memberUids.length} member${o.memberUids.length === 1 ? '' : 's'}`, o.sample ? 'Sample' : ''].filter(Boolean).join(' · '),
      title: o.name,
      desc: o.description || '',
      back: { label: 'Clubs & teams', onclick: 'setState({subRoute:null})' },
      linksHtml: orgLinksHtml(o, { editable: officer && !o.local }),
      stackHtml: avatarStackHtml(orgPeople(o), 5, 28, (uid) => faces[uid]),
      // Officers keep these two in view on a desktop; a phone lists them in the ··· sheet.
      actionsHtml: officer ? `<button class="btn btn-sm space-phone-sheet" onclick="openOrgEventModal('${o.code}')">${icon('plus', 14)} Event</button><button class="btn btn-sm space-phone-sheet" onclick="openAnnouncementModal('${o.code}')">${icon('megaphone', 14)} Announce</button>` : '',
      invite,
      menuLabel: `${kind[0] === 'team' ? 'Team' : 'Club'} options`,
      menu: [
        officer
          ? { label: 'Admin', icon: 'shield', onclick: `setState({orgTab:'admin'})` }
          : { label: `${kind[0] === 'team' ? 'Team' : 'Club'} settings`, icon: 'settings', onclick: `openOrgSettingsModal('${o.code}')` },
        { label: 'Show on my calendar', icon: 'calendar', onclick: `setOrgOnCalendar('${o.code}',${!!o.hideCalendar})`, checked: !o.hideCalendar },
        { label: o.sample ? 'Remove sample' : kind[0] === 'team' ? 'Leave team' : kind[0] === 'club' ? 'Leave club' : 'Leave', icon: 'log-out', onclick: `confirmLeaveOrg('${o.code}')`, danger: true },
      ],
    },
    sample: orgSampleStrip(o),
    notice: orgLoadNotice(o),
    tabs: {
      tabs: orgTabsFor(o).map(([k, label]) => ({
        key: k, label,
        iconHtml: k === 'admin' ? icon('shield', 14) : '',
        count: k === 'announcements' ? unread : 0,
        dot: k === 'chat' && chatUnread,
        phoneHidden: k === 'chat',
      })),
      active: tab,
      onTab: (k) => `setState({orgTab:'${k}'})`,
      crest,
      title: o.name,
      invite,
    },
    body: tab === 'overview' && orgIsBrandNew(o) ? orgFirstStepsHtml(o) : body(o),
    fab: tab === 'chat' ? null : { onclick: `spaceGoToTab('club','chat')`, dot: chatUnread, label: `Open ${kind[0] === 'team' ? 'team' : 'club'} chat` },
  });
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
          ${officer && (!o.local || o.sample) ? `<button class="btn btn-ghost btn-sm" onclick="openMemberRoleModal('${o.code}','${esc(p.uid)}')">Manage</button>` : p.uid === me ? `<button class="btn btn-ghost btn-sm" onclick="openMyOrgTitleModal('${o.code}')">Edit title</button>` : ''}
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
  // The group page runs it from afterGroupPageRender; everywhere else this
  // one does, which also drops the sticky-row watcher on pages without one.
  if (state.route !== 'studygroups' && typeof afterSpaceRender === 'function') afterSpaceRender();
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
      ${o.local ? `<div class="sg-callout small mb-16"><div>${o.sample ? 'This is a sample, so the code is just for show.' : 'You’re not logged in, so no one can join yet. <a href="login.html">Log in</a> to invite members.'}</div></div>` : ''}
      <p class="small muted" style="text-align:center">Members join with this code:</p>
      <div class="sg-invite-code" aria-label="Code ${code.split('').join(' ')}">${code.split('').map(ch => `<span>${ch}</span>`).join('')}</div>
      <div class="field mt-16"><label for="org-invite-link">Or share a link in your group chat</label>
        <div class="sg-invite-row"><input class="input" id="org-invite-link" value="${esc(orgInviteLink(code))}" readonly onclick="this.select()"><button class="btn btn-primary" onclick="copyText(orgInviteMessage('${code}'),'Invite copied')">${icon('copy', 14)} Copy</button></div>
      </div>
      ${navigator.share ? `<button class="btn" style="width:100%;justify-content:center" onclick="navigator.share({title:'Join on Semester HQ',text:orgInviteMessage('${code}')}).catch(()=>{})">${icon('send', 14)} Share via Messages, GroupMe…</button>` : ''}
      <div class="sg-pricing-inline small mt-16">
        <span class="sg-feature-ic">${icon('shield', 16)}</span>
        <div><span class="sg-strong">Getting the whole ${o.kind === 'team' ? 'team' : o.kind === 'chapter' ? 'chapter' : 'club'} on?</span><div class="muted">Each member needs Semester HQ. ${isOrgOfficer(o) && typeof orgGroupPlanUrl === 'function'
          ? `A <a href="${o.sample ? GROUP_PRICING_URL : orgGroupPlanUrl(o)}"${o.sample ? ' target="_blank" rel="noopener"' : ''}>group plan</a> covers every member for $5.99 each a month, and can come out of your budget or dues. Members join from one link.`
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

/* ── Sample clubs for looking around ───────────────────────────── */
// Four made-up spaces, one for each kind of group that buys a plan. They
// live only in this tab (local: true, so orgWrite applies every change
// locally and nothing reaches Firestore), and the viewer starts as an
// officer, because the officer is the one deciding. The names are invented
// on purpose: none of them should match a real national organization, so
// no Greek letters. [key, label for the chips, icon, the viewer's title]
const SAMPLE_ORG_KINDS = [
  ['club', 'Club', 'flag', 'VP of Events'],
  ['chapter', 'Chapter', 'shield', 'Social chair'],
  ['team', 'Sports team', 'trophy', 'Travel coordinator'],
  ['honor', 'Honor society', 'star', 'VP of Service'],
];
// Which sample an entry is. The first sample ever made stored sample: true.
function sampleOrgKind(o) { return !o?.sample ? '' : o.sample === true ? 'club' : String(o.sample); }
function sampleOrgMeta(kind) { return SAMPLE_ORG_KINDS.find(k => k[0] === kind) || SAMPLE_ORG_KINDS[0]; }

// The content of each sample. Dates are relative to today, so there are
// always a few past events with answers (the Admin attendance grid shows
// the last six) and a few coming up, one of them required and not yet
// answered by everyone.
function sampleOrgTemplate(kind) {
  const t = todayIso();
  const nextDow = (dow) => addDays(t, ((dow - new Date().getDay() + 7) % 7) || 7);
  // Weekly dates on one weekday: weeks -3..-1 are past, 0 is the next one.
  const weekly = (dow, from, to) => { const out = []; for (let w = from; w <= to; w++) out.push(addDays(nextDow(dow), 7 * w)); return out; };
  if (kind === 'chapter') return {
    name: 'Kestrel House', kind: 'chapter', color: ORG_COLORS[5],
    description: 'Weekly chapter meetings, a service project every month, and Sunday family dinners.',
    // [key, name, title, officer, joined days ago, how often they say yes]
    people: [['olivia', 'Olivia', 'President', true, 500, 96], ['grace', 'Grace', 'Treasurer', true, 420, 92], ['harper', 'Harper', 'VP of Membership', true, 380, 90],
      ['zoe', 'Zoe', '', false, 360, 82], ['aaliyah', 'Aaliyah', '', false, 300, 74], ['chloe', 'Chloe', '', false, 260, 66], ['mei', 'Mei', 'Philanthropy chair', false, 240, 88],
      ['sofia', 'Sofia', '', false, 200, 58], ['nora', 'Nora', '', false, 150, 70], ['leah', 'Leah', '', false, 120, 48], ['camila', 'Camila', '', false, 60, 78],
      ['riley', 'Riley', '', false, 40, 62], ['tessa', 'Tessa', '', false, 14, 72]],
    events: [
      { title: 'Chapter meeting', category: 'meeting', dates: weekly(0, -4, 1), start: '18:00', end: '19:00', location: 'Chapter room, Kestrel House', required: true, series: 'chapter', notes: 'Business first, then family dinner at 7. Phones away during votes.' },
      { title: 'Sisterhood movie night', category: 'social', date: addDays(t, -13), start: '20:00', end: '22:30', location: 'Kestrel House living room' },
      { title: 'River park cleanup', category: 'service', date: addDays(t, -9), start: '09:00', end: '12:00', location: 'Riverfront park, north lot', notes: 'Gloves and bags provided. Counts toward service hours.' },
      { title: 'Spring dues', category: 'deadline', date: addDays(t, 6), start: '', end: '', location: '', required: true, notes: '$180 for the semester. Use the dues link at the top of the page, or talk to Grace about a payment plan.' },
      { title: 'Blood drive table shifts', category: 'service', date: addDays(t, 10), start: '10:00', end: '15:00', location: 'Student Union lobby', notes: 'Sign up for one hour. Two people per shift.' },
      { title: 'Formal dress fitting', category: 'social', date: addDays(t, 13), start: '17:00', end: '19:00', location: 'Kestrel House' },
    ],
    announcements: [['Dues are due next week. Payment plans are fine, just message Grace before the deadline.', 'grace', 20, true], ['Thank you to everyone who came to the river cleanup! That’s 33 more service hours for the chapter.', 'mei', 70]],
    messages: [['camila', 'Does anyone have a ride to the blood drive?', 30], ['zoe', 'I can take two people, I’m leaving at 9:45', 29], ['olivia', 'Reminder that chapter is at 6 on Sunday. Dinner right after!', 4]],
    files: [{ kind: 'link', title: 'Chapter bylaws', url: 'https://example.com/bylaws', by: 'olivia', hours: 400 }, { kind: 'link', title: 'Service hours log', url: 'https://example.com/service-log', by: 'mei', hours: 60 }],
    links: [['GroupMe', 'https://groupme.com/'], ['Dues portal', 'https://example.com/dues'], ['Instagram', 'https://instagram.com/']],
  };
  if (kind === 'team') return {
    name: 'Club Volleyball', kind: 'team', color: ORG_COLORS[4],
    description: 'Co-ed club volleyball. Practice Monday and Wednesday nights, and a tournament most months.',
    people: [['marcus', 'Marcus', 'Captain', true, 480, 97], ['dani', 'Dani', 'Co-captain', true, 400, 94], ['luis', 'Luis', '', false, 330, 84],
      ['brooke', 'Brooke', '', false, 300, 76], ['ethan', 'Ethan', '', false, 260, 68], ['jasmine', 'Jasmine', '', false, 220, 88], ['owen', 'Owen', '', false, 180, 52],
      ['kiara', 'Kiara', '', false, 120, 80], ['sean', 'Sean', '', false, 90, 60], ['talia', 'Talia', 'Treasurer', false, 70, 86], ['yuki', 'Yuki', '', false, 20, 74]],
    events: [
      { title: 'Practice', category: 'practice', dates: weekly(1, -2, 0), start: '20:00', end: '22:00', location: 'Rec center, court 3', series: 'mon', notes: 'Serving and passing drills, then scrimmage.' },
      { title: 'Practice', category: 'practice', dates: weekly(3, -2, 0), start: '20:00', end: '22:00', location: 'Rec center, court 3', series: 'wed' },
      { title: 'Home match vs. Harwick State', category: 'game', date: addDays(t, -5), start: '13:00', end: '16:00', location: 'Rec center, main gym', required: true },
      { title: 'Tournament fee', category: 'deadline', date: addDays(t, 4), start: '', end: '', location: '', required: true, notes: '$25 covers the entry and the van. Venmo Talia.' },
      { title: 'Travel tournament at Harwick State', category: 'game', date: addDays(t, 11), start: '07:00', end: '18:00', location: 'Van leaves the rec center', required: true, notes: 'Bring both jerseys, knee pads, and lunch money. We’re back around 6.' },
    ],
    announcements: [['Tournament roster is up in Files. If you can’t travel, tell Marcus by Friday so we can bring a sub.', 'marcus', 16, true], ['Great win at the home match! Film is in Files if you want to see your serves.', 'dani', 110]],
    messages: [['owen', 'Is practice still on if it’s raining?', 26], ['dani', 'Yep, it’s indoors!', 25.5], ['yuki', 'Can I borrow someone’s spare knee pads for Wednesday?', 6], ['jasmine', 'I have an extra pair, I’ll bring them', 5]],
    files: [{ kind: 'link', title: 'Tournament roster', url: 'https://example.com/roster', by: 'marcus', hours: 16 }, { kind: 'link', title: 'Match film', url: 'https://example.com/film', by: 'dani', hours: 110 }],
    links: [['Instagram', 'https://instagram.com/'], ['Venmo for fees', 'https://venmo.com/']],
  };
  if (kind === 'honor') return {
    name: 'Brightfield Honor Society', kind: 'org', color: ORG_COLORS[2],
    description: 'Scholarship and service. Members log 10 service hours a semester and meet once a month.',
    people: [['rachel', 'Rachel', 'President', true, 520, 95], ['omar', 'Omar', 'Secretary', true, 400, 90], ['hannah', 'Hannah', '', false, 300, 80],
      ['julian', 'Julian', '', false, 280, 64], ['amara', 'Amara', '', false, 210, 86], ['ben', 'Ben', '', false, 160, 56], ['lucy', 'Lucy', 'Tutoring lead', false, 130, 92],
      ['sana', 'Sana', '', false, 45, 72]],
    events: [
      { title: 'Tutoring at the community center', category: 'service', dates: weekly(2, -3, 1), start: '15:30', end: '17:00', location: 'Eastside community center', series: 'tutor', notes: 'Homework help for kids 8 to 12. Sign in at the front desk.' },
      { title: 'Library book sort', category: 'service', date: addDays(t, -8), start: '10:00', end: '12:00', location: 'Public library, lower level' },
      { title: 'Monthly meeting', category: 'meeting', date: addDays(t, -26), start: '19:00', end: '20:00', location: 'Honors college lounge', required: true },
      { title: 'Monthly meeting', category: 'meeting', date: addDays(t, 3), start: '19:00', end: '20:00', location: 'Honors college lounge', required: true, notes: 'Voting on the spring service project. Bring one idea.' },
      { title: 'Induction ceremony', category: 'other', date: addDays(t, 14), start: '18:00', end: '19:30', location: 'Alumni Hall', required: true, notes: 'Business formal. Family is welcome.' },
      { title: 'Service hours due', category: 'deadline', date: addDays(t, 20), start: '', end: '', location: '', notes: 'Log them with the form at the top of the page.' },
    ],
    announcements: [['Induction is in two weeks. New members, please send Omar the name you want on your certificate.', 'omar', 30, true], ['We’re at 212 service hours this semester. Thank you, everyone!', 'rachel', 140]],
    messages: [['sana', 'Is tutoring still on this week?', 50], ['lucy', 'Yes! Same time, 3:30 to 5', 49], ['hannah', 'The kids at tutoring made us a thank-you card today', 3]],
    files: [{ kind: 'link', title: 'Service hours form', url: 'https://example.com/hours', by: 'omar', hours: 300 }, { kind: 'link', title: 'Induction program', url: 'https://example.com/program', by: 'rachel', hours: 30 }],
    links: [['Service hours form', 'https://forms.google.com/'], ['Instagram', 'https://instagram.com/']],
  };
  return {
    name: 'Women in Business', kind: 'club', color: ORG_COLORS[3],
    description: 'Career panels, networking, and a community of students going into business.',
    people: [['ava', 'Ava', 'President', true, 400, 96], ['noah', 'Noah', 'Treasurer', true, 380, 90], ['jade', 'Jade', 'Social chair', false, 200, 84],
      ['lena', 'Lena', '', false, 150, 70], ['sam', 'Sam', '', false, 120, 54], ['maria', 'Maria', '', false, 100, 78], ['kofi', 'Kofi', '', false, 90, 62],
      ['emma', 'Emma', '', false, 60, 46], ['ines', 'Ines', '', false, 40, 68], ['dev', 'Dev', '', false, 18, 60]],
    events: [
      { title: 'General meeting', category: 'meeting', dates: weekly(2, -4, 1), start: '19:00', end: '20:00', location: 'Student Union 210', required: true, series: 'gm', notes: 'Voting on the spring trip. Bring ideas for the networking night.' },
      { title: 'Coffee chat with alumni', category: 'social', date: addDays(t, -18), start: '16:00', end: '17:00', location: 'Business School café' },
      { title: 'Mock interview night', category: 'social', date: addDays(t, -11), start: '18:00', end: '20:00', location: 'Career center' },
      { title: 'Resume workshop', category: 'social', date: addDays(t, -4), start: '18:00', end: '19:30', location: 'Business School 114' },
      { title: 'Dues deadline', category: 'deadline', date: addDays(t, 5), start: '', end: '', location: '', required: true, notes: '$40 for the semester. Venmo the treasurer.' },
      { title: 'Networking night with alumni', category: 'social', date: addDays(t, 9), start: '18:30', end: '20:30', location: 'Business School atrium', notes: 'Business casual. Bring a few copies of your resume.' },
      { title: 'Food bank volunteering', category: 'service', date: addDays(t, 12), start: '10:00', end: '13:00', location: 'Downtown food bank' },
    ],
    announcements: [['Dues are coming up. $40 for the semester, Venmo @noah-treasurer with your name in the note.', 'noah', 20, true], ['Huge thank you to everyone who came to the resume workshop! Slides are in the drive: https://example.com/slides', 'ava', 72]],
    messages: [['lena', 'Is the networking night business casual or business formal?', 27], ['ava', 'Business casual! Bring a few copies of your resume.', 26.5], ['jade', 'I can drive 3 people to the food bank on Saturday.', 5], ['noah', 'Reminder that dues are coming up. The details are in Files.', 2]],
    files: [{ kind: 'file', title: 'Spring dues', text: 'Spring dues\n\n$40 for the semester.\nVenmo @noah-treasurer and put your name in the note.\nQuestions? Ask Noah in chat.\n', by: 'noah', hours: 20 }, { kind: 'link', title: 'Resume workshop slides', url: 'https://example.com/slides', by: 'ava', hours: 72 }],
    links: [['GroupMe', 'https://groupme.com/'], ['Instagram', 'https://instagram.com/'], ['Venmo for dues', 'https://venmo.com/']],
  };
}

function createSampleOrg(kind = 'club') {
  const [key, , , myTitle] = sampleOrgMeta(kind);
  const existing = orgEntries().find(e => sampleOrgKind(e) === key);
  if (existing) { openOrg(existing.code); return; }
  const tpl = sampleOrgTemplate(key);
  const now = Date.now(), H = 3600000, D = 24 * H, t = todayIso();
  const me = LOCAL_UID, idOf = (k) => `sample-${k}`;
  const code = genGroupCode();
  const owner = idOf(tpl.people[0][0]);
  const people = { [me]: { name: myGroupName(), joinedAt: now - 30 * D, title: myTitle, reviewed: true } };
  const rel = { [me]: 82 };
  tpl.people.forEach(([k, name, title, , days, r]) => { people[idOf(k)] = { name, joinedAt: now - days * D, title, ...(title ? { reviewed: true } : {}) }; rel[idOf(k)] = r; });
  const memberUids = [...tpl.people.map(p => idOf(p[0])), me];
  const officerUids = [...tpl.people.filter(p => p[3]).map(p => idOf(p[0])), me];
  const officers = officerUids.filter(u => u !== me);
  // Events, then answers that look like a real club's: the regulars say
  // yes almost every time, a few people never answer, past events are
  // mostly answered and upcoming ones only partly.
  // A 0..99 roll per person and event that stays the same run to run.
  const roll = (str) => { let h = spaceHash(str); h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) % 100; };
  const events = {}, rsvp = {};
  let firstRequiredAhead = true;
  tpl.events.flatMap(e => (e.dates || [e.date]).map(date => ({ ...e, date }))).sort((a, b) => a.date.localeCompare(b.date)).forEach((e, i) => {
    const id = uid() + i;
    const past = e.date < t;
    events[id] = { id, title: e.title, category: e.category, date: e.date, start: e.start, end: e.end, location: e.location, notes: e.notes || '', required: !!e.required, createdBy: officers[i % officers.length], createdAt: now - (past ? 40 : 6) * D, ...(e.series ? { seriesId: `sample-${key}-${e.series}` } : {}) };
    memberUids.forEach(u => {
      let v;
      if (u === me) {
        // You answer your past events, and one required event ahead is
        // left for you to answer, so the "needs your answer" card shows.
        if (!past && e.required && firstRequiredAhead) { firstRequiredAhead = false; return; }
        v = roll(`${u}|${e.title}|${e.date}`) < (past ? 82 : 70) ? 'yes' : past ? 'no' : '';
      } else {
        const r = roll(`${u}|${e.title}|${e.date}`);
        const soon = daysBetween(e.date) <= 3;
        const yes = past ? rel[u] : Math.round(rel[u] * (soon ? 0.85 : e.required ? 0.62 : 0.5));
        v = r < yes ? 'yes' : r < yes + (past ? 14 : 9) ? 'no' : '';
      }
      if (v) (rsvp[u] = rsvp[u] || {})[id] = v;
    });
  });
  const nameOf = (k) => people[idOf(k)].name;
  const messages = tpl.messages.map(([k, text, hours]) => ({ id: uid(), uid: idOf(k), name: nameOf(k), text, at: now - hours * H }));
  const last = messages[messages.length - 1];
  const files = Object.fromEntries(tpl.files.map((f, i) => {
    const id = uid() + i, base = { id, kind: f.kind, title: f.title, uid: idOf(f.by), name: nameOf(f.by), at: now - f.hours * H };
    return [id, f.kind === 'file'
      ? { ...base, fileName: `${f.title}.txt`, size: f.text.length, url: 'data:text/plain;base64,' + btoa(f.text) }
      : { ...base, url: f.url }];
  }));
  const entry = {
    ...newOrgDoc({ code, name: tpl.name, kind: tpl.kind, school: state.settings.school || '', color: tpl.color, description: tpl.description, ownerUid: owner }),
    local: true, sample: key,
    createdAt: now - 400 * D,
    memberUids, officerUids, people,
    files, messages, events, rsvp,
    lastMessage: { uid: last.uid, name: last.name, text: last.text, at: last.at },
    links: tpl.links.map(([label, url], i) => ({ id: `sample-link-${i}`, label, url })),
    announcements: Object.fromEntries(tpl.announcements.map(([text, k, hours, pinned]) => { const id = uid(); return [id, { id, text, uid: idOf(k), name: nameOf(k), at: now - hours * H, ...(pinned ? { pinned: true } : {}) }]; })),
  };
  orgEntries().push(entry);
  openOrg(code);
  toast(`You’re previewing ${tpl.name} as an officer. Switch to Member anytime to see what everyone else sees.`, 'info', 4500);
}
// The sample strip's "Previewing as: Officer | Member". Only ever changes
// a local sample: your officer seat and your title, through orgWrite, which
// applies both in this tab.
function setSampleOrgRole(code, asOfficer) {
  const o = findOrg(code);
  if (!o || !o.sample || !o.local || isOrgOfficer(o) === asOfficer) return;
  if (!asOfficer && state.orgTab === 'admin') state.orgTab = 'overview';
  orgWrite(code, { officerUids: asOfficer ? gwUnion(LOCAL_UID) : gwRemove(LOCAL_UID), [`people.${LOCAL_UID}.title`]: asOfficer ? sampleOrgMeta(sampleOrgKind(o))[3] : '' });
}
// What spaceShell's sample strip needs for a sample club.
function orgSampleStrip(o) {
  if (!o.sample) return null;
  const mine = sampleOrgKind(o);
  return {
    note: 'This is a sample, so codes and links are just for show.',
    view: { officer: isOrgOfficer(o), onOfficer: `setSampleOrgRole('${o.code}',true)`, onMember: `setSampleOrgRole('${o.code}',false)` },
    others: cloudGroupsEnabled() ? [] : SAMPLE_ORG_KINDS.filter(k => k[0] !== mine).map(([k, label, ic]) => ({ label, icon: ic, onclick: `createSampleOrg('${k}')` })),
  };
}
// The four samples as chips, for the empty state.
function sampleOrgChipsHtml() {
  return `<div class="space-sample-pick"><div class="space-sample-label">Or look around a sample first</div><div class="chip-row">${SAMPLE_ORG_KINDS.map(([k, label, ic]) => `<button type="button" class="chip" onclick="createSampleOrg('${k}')">${icon(ic, 13)}${esc(label)}</button>`).join('')}</div></div>`;
}
