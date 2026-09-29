/* ── Clubs & teams: data, writes, sync and invite links ──────────
   The club documents as the pages see them (orgView), the one write path
   (orgWrite), the Firestore listeners, and ?org=CODE link handling.
   Loaded after js/spaces/*.js and before js/orgs.js (see index.html). The
   constants it reads (ORG_KINDS and friends) live in js/orgs.js and are
   only used inside functions, so the order is safe.
──────────────────────────────────────────────────────────────── */
const ORG_CACHE_KEY = storeKey + '.orgs';
const PENDING_ORG_KEY = 'shq_pending_org';
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
// What the band and index card call it. A sample says what it stands for
// ('Honor society', 'Chapter'); a real club uses its ORG_KINDS label.
function orgKindLabel(o) { return o?.sample && typeof sampleOrgMeta === 'function' ? sampleOrgMeta(sampleOrgKind(o))[1] : orgKind(o)[1]; }
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
// Past once it ends; with no end time it runs an hour, and an all-day event
// (dues) lasts its whole day. See eventTimeState in js/spaces/eventcard.js.
function orgEventPast(e) { return eventTimeState(e).phase === 'after'; }
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
// Matched against the link's host and label, never its path or query, so a
// random URL with "pay" in it doesn't become the dues button.
const ORG_DUES_LINK = /venmo|paypal|cash\.app|cashapp|zelle|\bdues\b|\bpay\b/i;
function orgDuesLink(o) { return orgLinkList(o).find(l => ORG_DUES_LINK.test(`${hostOf(l.url)} ${l.label}`)) || null; }
// "Deadline or dues" events aren't something you attend, so they never ask
// Going or Can't. They leave the needs-your-answer lists, the RSVPs
// grid and the RSVP reminders; answers already given stay in the data and
// in the roster CSV (downloadOrgRosterCsv), untouched.
function orgIsDuesEvent(e) { return e?.category === 'deadline'; }
function orgAnnouncementList(o) {
  return Object.values(o.announcements || {}).filter(a => a && safeId(a.id) && typeof a.text === 'string' && a.text.trim())
    .map(a => ({ ...a, text: a.text.slice(0, ORG_ANNOUNCEMENT_MAX), name: cleanStr(a.name, 60) || 'An officer' }))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (b.at || 0) - (a.at || 0));
}
function orgSeen() { return state.settings.orgSeen || (state.settings.orgSeen = {}); }
function orgUnreadCount(o) { const seen = orgSeen()[o.code] || 0; return orgAnnouncementList(o).filter(a => (a.at || 0) > seen && a.uid !== myOrgUid(o)).length; }
function markOrgSeen(code) { const o = findOrg(code); if (!o) return; const latest = Math.max(0, ...orgAnnouncementList(o).map(a => a.at || 0)); if (latest > (orgSeen()[code] || 0)) { orgSeen()[code] = latest; save(); } }

/* ── Writes ────────────────────────────────────────────────────── */
// Firestore only says "permission-denied", so the toast works out the
// likely reason from what was written and who you are in the club.
function orgWriteDeniedMessage(code, ops, fallback) {
  const o = findOrg(code);
  if (!o) return 'This club was deleted.';
  const me = myOrgUid(o);
  if (!o.memberUids.includes(me)) return 'You’re no longer in this club.';
  const roles = ops.officerUids;
  const rolesChange = 'createdBy' in ops || (roles && (roles.__op === 'union' || (roles.v || []).some(u => u !== me && o.officerUids.includes(u))));
  if (rolesChange && !isOrgOwner(o)) return 'Only the founder can change who’s an officer.';
  const ownOnly = Object.keys(ops).every(k => k.startsWith(`rsvp.${me}`) || k.startsWith(`people.${me}.`) || (k === 'officerUids' || k === 'memberUids'));
  if (!isOrgOfficer(o) && !ownOnly) return 'Only officers can change that.';
  return fallback || 'That change wasn’t allowed. Reload the page and try again.';
}
// opts.denied: what to say when the rules refuse it and nothing more
// specific applies.
async function orgWrite(code, ops, opts = {}) {
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
    const msg = e.code === 'permission-denied' ? orgWriteDeniedMessage(code, ops, opts.denied)
      : e.code === 'not-found' ? 'This club was deleted.'
      : 'Couldn’t save that. Check your connection and try again.';
    toast(msg, 'error', 4500);
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
