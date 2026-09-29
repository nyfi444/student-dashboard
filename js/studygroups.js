/* ── Study Groups: pages, tabs, sessions, tasks, chat, settings ──
   The group feature is split across files, loaded in this order (see
   index.html): js/spaces/core.js (primitives shared with clubs),
   js/groups/sync.js (data model, writes, realtime sync, legacy
   migration, joining), js/groups/availability.js (Find a time),
   js/groups/resources.js (shared notes, decks, files, links),
   js/groups/home.js (the Overview tab), js/groups/sessions.js (the
   Sessions tab and session sheet), and this file, which renders the
   pages and handles everything else.
──────────────────────────────────────────────────────────────── */
/* ── Small helpers ─────────────────────────────────────────────── */
function fmtSessionWhen(s) { return `${fmtSessionDay(s.date)}${s.start ? ' · ' + fmtTime(s.start) + (s.end ? '–' + fmtTime(s.end) : '') : ''}`; }
function shortHour(h) { const hr = Math.floor(h); return `${hr % 12 === 0 ? 12 : hr % 12}${hr >= 12 ? 'p' : 'a'}`; }
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
const byDueThenCreated = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.createdAt || 0) - (b.createdAt || 0);

/* ── People ────────────────────────────────────────────────────── */
// Everyone in a group has a color (they can pick their own), used for their
// avatar and their stripe in the Find a time grid, so you can tell people
// apart at a glance. Stored per group at people.<uid>.color.
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
  return `<div class="sg-swatches" role="radiogroup" aria-label="Your color">${PERSON_COLORS.map(c => `<button class="sg-swatch ${c === mine ? 'active' : ''}" role="radio" aria-checked="${c === mine}" style="background:${c}" data-tip="${takenBy[c] ? `Also used by ${esc(takenBy[c])}` : 'Use this color'}" aria-label="Color ${c}${takenBy[c] ? `, used by ${esc(takenBy[c])}` : ''}" onclick="${onPickJs}('${g.code}','${c}')">${takenBy[c] ? '<span class="sg-swatch-taken"></span>' : ''}</button>`).join('')}</div>`;
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
  return avatarStackHtml(list, max, size, (uid) => personColor(g, uid));
}

/* ── Navigation ────────────────────────────────────────────────── */
function openGroup(code, tab) {
  window._availEditing = null; // Find a time's touch painting starts off on every visit
  setState({ route: 'studygroups', subRoute: code, groupTab: tab || 'overview' });
  window.scrollTo(0, 0);
}
function closeGroup() { window._availEditing = null; setState({ subRoute: null }); window.scrollTo(0, 0); }
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
    ${pageHead('Study Groups', 'Find a time that works, plan sessions, and split the work with classmates.', groups.length ? `
      <button class="btn btn-sm" onclick="openJoinGroupModal()">${icon('user-plus', 14)} Join with code</button>
      <button class="btn btn-primary" onclick="openCreateGroupModal()">${icon('plus', 14)} New group</button>
    ` : '')}
    ${groupsAccountBanner()}
    ${groups.length ? `
      ${groupsThisWeek(groups)}
      <div class="sg-section-label">Your groups</div>
      <div class="space-grid">${groups.map(groupIndexCard).join('')}</div>
    ` : groupsEmptyHero()}
    <div class="sg-pricing-note small">${icon('users', 14)} Bringing a whole class, club, or team onto Semester HQ? <a href="${GROUP_PRICING_URL}" target="_blank" rel="noopener">See group pricing</a></div>
  `;
}
// The global demo bar already says nothing is saved and offers Log in, so this
// only shows when that bar is not up (e.g. signed in without cloud groups).
function demoBarShowing() { return typeof demoBannerHtml === 'function' && !!demoBannerHtml(); }
function groupsAccountBanner() {
  if (!fbConfigured() || cloudGroupsEnabled() || demoBarShowing()) return '';
  return `<div class="sg-callout mb-16">${icon('info', 16)}<div class="small">You’re trying Study Groups without an account, so groups you make here only last until you close this tab. <a href="login.html">Log in</a> to invite classmates and keep everything synced.</div></div>`;
}
// The group's crest as spaceCrest wants it: course letters over the number.
function groupCrest(g) { const c = spaceGroupCrest(g); return { text: esc(c.main), sub: esc(c.sub) }; }
function groupsThisWeek(groups) {
  const end = addDays(todayIso(), 7);
  const rows = groups.flatMap(g => upcomingSessions(g).filter(s => s.date <= end).map(s => ({ g, s })))
    .sort((a, b) => (a.s.date + (a.s.start || '')).localeCompare(b.s.date + (b.s.start || '')));
  return spaceWeekCard({
    title: 'This week',
    rows: rows.map(({ g, s }) => ({
      date: s.date,
      html: `
        <div class="list-row space-week-item space" style="${spaceVars(groupColor(g))}" onclick="showGroupSessionModal('${g.code}','${s.id}')">
          ${spaceCrest(groupCrest(g), 'xs')}
          <div class="row-title"><div class="sg-strong">${esc(s.title)}${s.seriesId ? ` ${spaceTag('weekly', 'Weekly')}` : ''}</div><div class="row-meta">${[esc(_evTimeRange(s.start, s.end)), esc(g.name), s.where ? spaceWhereHtml(s.where) : ''].filter(Boolean).join(' · ')}</div></div>
          ${rsvpControl(g, s)}
        </div>`,
    })),
  });
}
// What a group needs from you: the same count as its "What needs you"
// strip (spaceNeeds in js/spaces/needs.js).
function groupIndexNeedCount(g) { return spaceNeeds('group', g).count; }
function groupIndexCard(g) {
  const next = upcomingSessions(g)[0];
  const unread = groupHasUnread(g);
  const count = groupPeople(g).length;
  return spaceCard({
    code: g.code,
    color: groupColor(g),
    crest: groupCrest(g),
    eyebrow: [g.courseLabel ? esc(g.courseLabel) : 'Study group', g.sample ? 'Sample' : ''].filter(Boolean).join(' · '),
    name: g.name,
    onclick: `openGroup('${g.code}')`,
    nextHtml: next
      ? `${spaceCountdownChip(next.date, next.start, next.end)}<span class="space-card-when">${[esc(spaceWhen(next.date, next.start)), next.where ? esc(groupWhereShort(next.where)) : ''].filter(Boolean).join(' · ') || esc(next.title)}</span>`
      : '<span class="space-card-when">No session scheduled</span>',
    lineHtml: g.lastMessage ? `<div class="space-card-msg ${unread ? 'is-unread' : ''}"><span class="em">${esc(g.lastMessage.name)}:</span> ${esc(chatPreviewText(g.lastMessage.text, 'group', g.code))}</div>` : '',
    unread,
    unreadLabel: 'New messages',
    footHtml: `${avatarStack(g, 4, 24)}<span>${g.loading ? 'Loading…' : `${count} member${count === 1 ? '' : 's'}`}</span>`,
    needCount: g.loading ? 0 : groupIndexNeedCount(g),
  });
}
function groupsEmptyHero() {
  return emptyStateHtml({
    icon: 'users',
    title: 'Study better, together.',
    body: 'Start a group for a class and invite classmates with a link, then find a time everyone is free, plan sessions, split up the work, and chat in one place.',
    actions: [{ label: 'Start a group', onclick: 'openCreateGroupModal()', icon: 'plus' }, { label: 'Join with code', onclick: 'openJoinGroupModal()' }],
    extra: cloudGroupsEnabled() ? '' : `<button class="btn btn-ghost btn-sm" onclick="createSampleGroup()">${icon('eye', 14)} Explore a sample group first</button>`,
  });
}

/* ── Group page ────────────────────────────────────────────────── */
function pageGroupDetail(g) {
  const tab = GROUP_TABS.some(([k]) => k === state.groupTab) ? state.groupTab : 'overview';
  const count = groupPeople(g).length;
  const unread = tab !== 'chat' && groupHasUnread(g);
  const body = { overview: groupOverviewTab, schedule: groupScheduleTab, availability: groupAvailabilityTab, tasks: groupTasksTab, resources: groupResourcesTab, chat: groupChatTab }[tab];
  const color = groupColor(g);
  const crest = groupCrest(g);
  // The band's Invite is the page's one primary on the overview; on the
  // other tabs (and a brand-new group, whose empty state invites) the tab's own action is.
  const invite = { onclick: `openInviteModal('${g.code}')`, primary: tab === 'overview' && !groupIsBrandNew(g) };
  return spaceShell({
    kind: 'group',
    code: g.code,
    color,
    // --sg and .sg-tinted are what the tab bodies read the group color from.
    className: color ? 'sg-tinted' : '',
    rootStyle: color ? colorVars('sg', color) : '',
    band: {
      code: g.code,
      crest,
      eyebrow: [g.courseLabel ? esc(g.courseLabel) : '', `${count} member${count === 1 ? '' : 's'}`, g.sample ? 'Sample group' : ''].filter(Boolean).join(' · '),
      title: g.name,
      desc: g.description || '',
      back: { label: 'All groups', onclick: 'closeGroup()' },
      stackHtml: avatarStack(g, 5, 28),
      invite,
      menuLabel: 'Group options',
      menu: [
        { label: 'Group settings', icon: 'settings', onclick: `openGroupSettingsModal('${g.code}')` },
        { label: g.sample ? 'Remove sample' : 'Leave group', icon: 'log-out', onclick: `confirmLeaveGroup('${g.code}')`, danger: true },
      ],
    },
    notice: groupLoadNotice(g),
    tabs: {
      tabs: GROUP_TABS.map(([k, label]) => ({ key: k, label, dot: k === 'chat' && unread, phoneHidden: k === 'chat' })),
      active: tab,
      onTab: (k) => `setGroupTab('${k}')`,
      crest,
      title: g.name,
      invite,
    },
    body: tab === 'overview' && groupIsBrandNew(g) ? groupFirstStepsHtml(g) : body(g),
    fab: tab === 'chat' ? null : { onclick: `spaceGoToTab('group','chat')`, count: groupUnreadCount(g), dot: unread, label: 'Open group chat' },
  });
}
// New messages since you last opened the chat. The group's message listener
// runs on every tab, so this is a real count; before it has loaded, the
// last-message check still gives a dot.
function groupUnreadCount(g) {
  if (!groupHasUnread(g)) return 0;
  const me = myUidFor(g), seen = groupChatSeen()[g.code] || 0;
  return groupMessages(g).filter(m => m.uid !== me && typeof m.at === 'number' && m.at > seen).length;
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

/* ── Tasks ─────────────────────────────────────────────────────── */
// The board, quick add, the edit sheet and every task write: js/groups/tasks.js.

/* ── Chat ──────────────────────────────────────────────────────── */
// Drawn by chatView (js/spaces/chat.js); the data and writes stay here.
function groupChatTab(g) {
  const u = myUidFor(g);
  const isOwner = g.createdBy === u;
  const n = (g.memberUids || []).length;
  return chatView({
    kind: 'group', code: g.code, messages: groupMessages(g), me: u,
    people: groupPeople(g),
    who: (m) => (m.uid === u ? myGroupName() : g.people?.[m.uid]?.name || m.name || 'Former member'),
    avatarColor: (m) => personColor(g, m.uid),
    canDelete: (m) => m.uid === u || isOwner,
    deleteJs: (m) => `deleteGroupMessage('${g.code}','${esc(m.id)}')`,
    sendJs: `sendGroupMessage('${g.code}')`,
    placeholder: `Message ${g.name}`,
    stateHtml: emptyState(icon('message-circle', 24), 'No messages yet', '', 'Say hi, or post what you’re stuck on.'),
    crest: groupCrest(g), title: g.name, sub: `${n} member${n === 1 ? '' : 's'}`,
  });
}
// text: a preset message (Share to chat) instead of what's in the box.
async function sendGroupMessage(code, preset) {
  const input = $('#sg-chat-input');
  const fromBox = typeof preset !== 'string';
  const text = (fromBox ? input?.value || '' : preset).trim();
  if (!text) return;
  const entry = groupEntry(code);
  if (!entry) return;
  const g = groupView(entry);
  const msg = { id: uid(), uid: myUidFor(g), name: myGroupName(), text: text.slice(0, GROUP_MESSAGE_MAX), at: Date.now() };
  const lastMessage = { uid: msg.uid, name: msg.name, text: msg.text.slice(0, 140), at: msg.at };
  if (fromBox && input) { input.value = ''; chatGrow(input); }
  chatPinBottom('group', code);
  if (entry.local) {
    entry.messages = [...(entry.messages || []), msg];
    entry.lastMessage = lastMessage;
    groupChatSeen()[code] = msg.at;
    touch();
    if (fromBox) $('#sg-chat-input')?.focus();
    return;
  }
  if (!cloudGroupsEnabled()) { if (fromBox && input) input.value = text; toast('Log in to chat with this group.', 'error'); return; }
  try {
    await _fbDb.collection('studyGroups').doc(code).collection('messages').doc(msg.id).set(msg);
    groupWrite(code, { lastMessage });
    markChatSeen(code, msg.at);
    playUiSound('send');
  } catch (e) {
    diag.error('studygroups', 'Message failed', e);
    const box = $('#sg-chat-input');
    if (fromBox && box && !box.value) { box.value = text; chatGrow(box); }
    toast('Message didn’t send. Check your connection and try again.', 'error');
  }
}
function deleteGroupMessage(code, id) {
  if (!groupEntry(code) || !safeId(id)) return;
  confirmDialog('It’s removed for everyone in the group.', () => removeGroupMessage(code, id), 'Delete', 'Delete this message?');
}
// If it was the newest message, the preview on the group goes back one
// (any member may rewrite lastMessage).
async function removeGroupMessage(code, id) {
  const entry = groupEntry(code);
  if (!entry) return;
  const g = groupView(entry);
  const list = groupMessages(g);
  const gone = list.find(m => m.id === id);
  const wasLatest = !!gone && !!g.lastMessage && g.lastMessage.at === gone.at;
  const prev = chatPreviewAfterDelete(list, id);
  if (entry.local) {
    entry.messages = (entry.messages || []).filter(m => m.id !== id);
    if (wasLatest) entry.lastMessage = prev;
    touch();
    return;
  }
  try {
    await _fbDb.collection('studyGroups').doc(code).collection('messages').doc(id).delete();
    chatRemoveLocal('group', code, id);
    if (wasLatest) groupWrite(code, { lastMessage: prev });
    renderRemote();
  } catch (e) { toast('Couldn’t delete that message: ' + e.message, 'error'); }
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
    <div class="modal-head"><h3>New study group</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
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
      <div class="modal-head"><h3>Join a study group</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
      <div class="modal-body"><p class="small muted">Joining a classmate’s group needs a Semester HQ account, so your sessions, tasks, and chat stay in sync with theirs.</p></div>
      <div class="modal-foot"><button class="btn" onclick="closeModal()">Not now</button>${fbConfigured() ? `<a class="btn btn-primary" href="login.html">Log in or sign up</a>` : ''}</div>
    `);
    return;
  }
  openModal(`
    <div class="modal-head"><h3>Join a study group</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
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
    <div class="modal-head"><h3>You’re invited</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body">
      <div class="sg-join-card">
        ${people.length ? avatarStack(g, 6, 34) : `<span class="sg-feature-ic">${icon('users', 18)}</span>`}
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
function openInviteModal(code, { justCreated = false } = {}) {
  const g = findGroup(code);
  if (!g) return;
  const link = groupInviteLink(code);
  openModal(`
    <div class="modal-head"><h3>${justCreated ? 'Your group is ready' : `Invite to ${esc(g.name)}`}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body">
      ${g.local ? `<div class="sg-callout small mb-16"><div>${g.sample ? 'This is a sample group, so this code is just for show.' : 'You’re not logged in, so no one else can join this group yet. <a href="login.html">Log in</a> to invite classmates for real.'}</div></div>` : ''}
      <p class="small muted" style="text-align:center">${justCreated ? 'Invite your classmates. ' : ''}They can join with this code:</p>
      <div class="sg-invite-code" aria-label="Group code ${code.split('').join(' ')}">${code.split('').map(c => `<span>${c}</span>`).join('')}</div>
      <div class="field mt-16"><label for="sg-invite-link">Or send them a link</label>
        <div class="sg-invite-row"><input class="input" id="sg-invite-link" value="${esc(link)}" readonly onclick="this.select()"><button class="btn btn-primary" onclick="copyInvite('${code}')">${icon('copy', 14)} Copy</button></div>
      </div>
      ${navigator.share ? `<button class="btn" style="width:100%;justify-content:center" onclick="shareInviteNative('${code}')">${icon('send', 14)} Share via Messages, GroupMe…</button>` : ''}
      <div class="sg-pricing-inline small mt-16">
        <span class="sg-feature-ic">${icon('users', 16)}</span>
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
    <div class="modal-head"><h3>Group settings</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body">
      <div class="field"><label for="gs-name">Group name</label><input class="input" id="gs-name" value="${esc(g.name)}" maxlength="80"></div>
      <div class="field"><label for="gs-course">Class</label><input class="input" id="gs-course" value="${esc(g.courseLabel || '')}" maxlength="60" list="gs-course-list" placeholder="Optional"><datalist id="gs-course-list">${activeCourses().map(c => `<option value="${esc(c.code || c.name)}">`).join('')}</datalist></div>
      <div class="field"><label for="gs-desc">Description</label><input class="input" id="gs-desc" value="${esc(g.description || '')}" maxlength="200" placeholder="Optional"></div>
      <div class="field"><label>Your color in this group</label>${colorSwatches(g, 'pickGroupColorFromSettings')}</div>
      <div class="field"><label>Group color <span class="muted">(its sessions on your calendar)</span></label>
        <div class="org-colors" role="group" aria-label="Group color">
          <button type="button" class="page-color sg-color-auto ${HEX_COLOR.test(g.color || '') ? '' : 'active'}" aria-pressed="${!HEX_COLOR.test(g.color || '')}" data-tip="${groupCourse(g) ? `Match ${esc(groupCourse(g).code || groupCourse(g).name)}` : 'No color'}" aria-label="${groupCourse(g) ? 'Match the class color' : 'No color'}" style="${groupCourse(g) ? `background:${groupCourse(g).color}` : ''}" onclick="setGroupColor('${code}','')">${groupCourse(g) ? '' : icon('x', 11)}</button>
          ${GROUP_COLORS.map((c, i) => `<button type="button" class="page-color ${g.color === c ? 'active' : ''}" style="background:${c}" aria-label="Color ${i + 1}" aria-pressed="${g.color === c}" onclick="setGroupColor('${code}','${c}')"></button>`).join('')}
        </div>
        <div class="small muted mt-4">${groupCourse(g) ? `The first swatch follows ${esc(groupCourse(g).code || groupCourse(g).name)}’s color.` : g.courseLabel ? 'Add a class in Courses with the same code and the group can match its color.' : 'Pick one, or set a class above so the group can match it.'}</div>
      </div>
      <div class="divider"></div>
      <div class="small dim mb-8" style="font-weight:600">Members (${people.length})</div>
      ${people.map(p => `
        <div class="sg-person">
          ${personAvatar(p.uid, p.name, 26, personColor(g, p.uid))}
          <div class="row-title small">${esc(p.name)}${p.uid === u && p.name !== 'You' ? ' <span class="muted">(you)</span>' : ''}</div>
          ${p.role === 'owner' ? '<span class="small muted">Owner</span>' : isOwner && !g.local && p.uid !== u ? `<button class="btn btn-ghost btn-sm" onclick="confirmRemoveMember('${code}','${esc(p.uid)}')">Remove</button>` : ''}
        </div>`).join('')}
      <div class="divider"></div>
      <div class="sg-danger">
        <button class="btn btn-sm" onclick="confirmLeaveGroup('${code}')">${icon('log-out', 14)} ${g.sample ? 'Remove sample group' : 'Leave group'}</button>
        ${isOwner && !g.local ? `<button class="btn btn-danger btn-sm" onclick="confirmDeleteGroup('${code}')">${icon('trash', 14)} Delete for everyone</button>` : ''}
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
    groupWrite(code, { memberUids: gwRemove(memberUid), [`people.${memberUid}`]: GW_DELETE, [`avail.${memberUid}`]: GW_DELETE, ...groupDepartureOps(findGroup(code), memberUid) });
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
  const ops = { memberUids: gwRemove(myUid), [`people.${myUid}`]: GW_DELETE, [`avail.${myUid}`]: GW_DELETE, ...groupDepartureOps(g, myUid) };
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

/* ── Calendar + dashboard ──────────────────────────────────────── */
function groupSessionsOnDate(dateIso) {
  return allGroups().flatMap(g => sessionList(g)
    .filter(s => s.date === dateIso && s.rsvp?.[myUidFor(g)] !== 'no')
    .map(s => ({ id: s.id, code: g.code, title: s.title, start: s.start || null, end: s.end || null, color: groupColor(g) || '#6b6b6b', kind: 'group', groupName: g.name, action: `showGroupSessionModal('${g.code}','${s.id}')`, date: s.date, mine: s.rsvp?.[myUidFor(g)] || '', rsvpKind: 'group' })));
}
function dashboardGroupsWidget() {
  const groups = allGroups();
  if (!groups.length) {
    return `
      <div class="card card-pad mb-16">
        <div class="flex-between wrap" style="gap:12px">
          <div><h3 class="sg-h3">Study groups</h3><div class="small muted">Find a time everyone’s free, plan sessions, and split the work with classmates.</div></div>
          <button class="btn btn-sm" onclick="setState({route:'studygroups',subRoute:null})">${icon('users', 14)} Start a group</button>
        </div>
      </div>`;
  }
  const end = addDays(todayIso(), 7);
  const tasks = groups.flatMap(g => taskList(g).filter(t => !t.done && t.assignee === myUidFor(g)).map(t => ({ g, t })))
    .sort((a, b) => byDueThenCreated(a.t, b.t)).slice(0, 3);
  // Your tasks lead, so the widget's fold never hides them; with tasks
  // showing, two sessions keep it about a screenful.
  const sessions = groups.flatMap(g => upcomingSessions(g).filter(s => s.date <= end && s.rsvp?.[myUidFor(g)] !== 'no').map(s => ({ g, s })))
    .sort((a, b) => (a.s.date + (a.s.start || '')).localeCompare(b.s.date + (b.s.start || ''))).slice(0, tasks.length ? 2 : 3);
  const unread = Object.fromEntries(groups.filter(groupHasUnread).map(g => [g.code, true]));
  return `
    <div class="card card-pad mb-16">
      <div class="flex-between mb-8"><h3 class="sg-h3">Study groups</h3><button class="sg-link" onclick="setState({route:'studygroups',subRoute:null})">All groups ${icon('chevron-right', 12)}</button></div>
      ${spaceNeedsPills('group', groups, { unread })}
      ${tasks.length ? `<div class="small dim mb-8 sg-strong">Assigned to you</div>${tasks.map(({ g, t }) => `
        <div class="list-row sg-task compact" onclick="openGroup('${g.code}','tasks')">
          <button type="button" class="row-check" role="checkbox" aria-checked="false" aria-label="Mark ${esc(t.title)} as done" onclick="event.stopPropagation();toggleGroupTask('${g.code}','${t.id}')"></button>
          <div class="row-title"><div>${esc(t.title)}</div><div class="row-meta">${esc(g.name)}${t.due ? ` · ${t.due < todayIso() ? '<span class="sg-overdue">Overdue</span>' : 'Due ' + fmtSessionDay(t.due)}` : ''}</div></div>
        </div>`).join('')}<div class="divider"></div><div class="small dim mb-8 sg-strong">This week</div>` : ''}
      ${sessions.length ? sessions.map(({ g, s }) => `
        <div class="list-row sg-session-row space" style="--course:${esc(groupColor(g) || '#6b6b6b')};${spaceVars(groupColor(g))}" onclick="showGroupSessionModal('${g.code}','${s.id}')">
          ${spaceDateBlock(s.date, { size: 'tile' })}
          <div class="row-title"><div class="sg-strong">${esc(s.title)}</div><div class="row-meta">${esc(g.name)} · ${esc(fmtSessionDay(s.date))}${s.start ? ` · ${esc(_evTimeRange(s.start, s.end))}` : ''}</div></div>
          ${rsvpControl(g, s)}
        </div>`).join('') : `<p class="small muted">No group sessions in the next 7 days.</p>`}
    </div>`;
}

/* ── Sample group: lets people without an account see a group in use ─ */
// An SI-style review cohort: a student who aced the class last year runs a
// weekly session, and the group adds its own reviews around the exams.
// Local only (local: true), like every sample.
function createSampleGroup() {
  const existing = groupEntries().find(e => e.sample);
  if (existing) { openGroup(existing.code); return; }
  const now = Date.now(), H = 3600000, D = 24 * H, t = todayIso();
  const me = LOCAL_UID, maya = 'sample-maya', jordan = 'sample-jordan', priya = 'sample-priya', diego = 'sample-diego', hana = 'sample-hana', theo = 'sample-theo';
  const code = genGroupCode();
  const ranges = (list) => availFromRanges(list.flatMap(([days, start, end]) => days.map(day => ({ day, start, end }))));
  const nextDow = (dow) => addDays(t, ((dow - new Date().getDay() + 7) % 7) || 7);
  const session = (title, date, start, end, where, notes, by, rsvp, extra = {}) => { const id = uid(); return [id, { id, title, date, start, end, where, notes, createdBy: by, createdByName: by === maya ? 'Maya' : by === priya ? 'Priya' : 'Jordan', createdAt: now - 9 * D, rsvp, ...extra }]; };
  const si = { seriesId: 'sample-si' };
  const siWhere = 'Science library, room 120';
  const entry = {
    v: 2, code, local: true, sample: true,
    name: 'BIO 201 Review', courseLabel: 'BIO 201', color: '#1F5F6B',
    description: 'Supplemental instruction for BIO 201. Maya aced it last spring and runs a review every Monday, plus extra sessions before each exam.',
    createdBy: maya, createdAt: now - 34 * D, updatedAt: now,
    memberUids: [maya, jordan, priya, diego, hana, theo, me],
    people: {
      [maya]: { name: 'Maya', role: 'owner', joinedAt: now - 34 * D, color: '#c0503f' },
      [jordan]: { name: 'Jordan', role: 'member', joinedAt: now - 33 * D, color: '#3f8a55' },
      [priya]: { name: 'Priya', role: 'member', joinedAt: now - 30 * D, color: '#8a5cc2' },
      [diego]: { name: 'Diego', role: 'member', joinedAt: now - 28 * D, color: '#d08a1e' },
      [hana]: { name: 'Hana', role: 'member', joinedAt: now - 21 * D, color: '#2a9396' },
      [theo]: { name: 'Theo', role: 'member', joinedAt: now - 12 * D, color: '#5a6b7b' },
      [me]: { name: myGroupName(), role: 'member', joinedAt: now - 9 * D },
    },
    members: ['Maya', 'Jordan', 'Priya', 'Diego', 'Hana', 'Theo', myGroupName()], events: [],
    sessions: Object.fromEntries([
      session('SI review: cell signaling', addDays(nextDow(1), -14), '17:00', '18:00', siWhere, '', maya, { [maya]: 'yes', [jordan]: 'yes', [priya]: 'yes', [diego]: 'yes', [hana]: 'no' }, si),
      session('SI review: enzymes and metabolism', addDays(nextDow(1), -7), '17:00', '18:00', siWhere, '', maya, { [maya]: 'yes', [jordan]: 'yes', [priya]: 'yes', [hana]: 'yes', [theo]: 'yes', [me]: 'yes' }, si),
      session('Chapter 7 problem set', addDays(t, -6), '18:00', '19:00', 'Main library, room 204', '', maya, { [maya]: 'yes', [jordan]: 'yes', [priya]: 'yes', [diego]: 'maybe' }),
      session('Midterm 2 review', addDays(t, 1), '18:00', '19:30', 'Main library, room 204', 'Bring your practice problems from chapters 7 to 9. Maya is bringing the Quizlet.', maya, { [maya]: 'yes', [jordan]: 'yes', [priya]: 'maybe', [diego]: 'yes', [hana]: 'yes', [me]: 'yes' }),
      session('SI review: gene expression', nextDow(1), '17:00', '18:00', siWhere, 'Transcription and translation. Maya has a worksheet, no prep needed.', maya, { [maya]: 'yes', [jordan]: 'yes', [hana]: 'yes', [theo]: 'maybe' }, si),
      session('Practice exam swap', nextDow(4), '17:30', '19:00', 'https://zoom.us/j/0000000000', 'Everyone writes 5 questions, then we swap and check answers.', priya, { [priya]: 'yes', [diego]: 'yes' }),
      session('SI review: DNA replication', addDays(nextDow(1), 7), '17:00', '18:00', siWhere, '', maya, { [maya]: 'yes', [me]: 'yes' }, si),
      session('Lab practical walkthrough', addDays(t, 9), '16:00', '17:30', 'Biology building, lab 3', 'We’ll go station by station. Bring your lab manual.', jordan, { [jordan]: 'yes', [maya]: 'yes', [theo]: 'yes', [me]: 'maybe' }),
    ]),
    taskItems: Object.fromEntries([
      { title: 'Make a Quizlet for chapter 8 vocab', due: addDays(t, 1), assignee: maya },
      { title: 'Outline answers for review questions 1 to 10', due: addDays(t, 2), assignee: me },
      { title: 'Write 5 questions for the practice exam swap', due: addDays(nextDow(4), -1), assignee: me },
      { title: 'Book a study room for next week', due: null, assignee: jordan, done: true, doneBy: jordan, doneAt: now - 5 * H },
      { title: 'Post the chapter 9 worksheet answers', due: null, assignee: maya, done: true, doneBy: maya, doneAt: now - 30 * H },
      { title: 'Summarize lecture 14 notes', due: addDays(t, 4), assignee: null },
      { title: 'Draw the lab practical station map', due: addDays(t, 7), assignee: diego },
    ].map((x, i) => { const id = uid() + i; return [id, { id, label: '', done: false, doneBy: null, doneAt: null, createdBy: maya, createdAt: now - (7 - i) * D, ...x }]; })),
    avail: {
      [maya]: { name: 'Maya', updatedAt: now - 2 * D, ...ranges([[[1, 3], '15:00', '20:00'], [[2, 4], '18:00', '21:00'], [[0], '13:00', '17:00']]) },
      [jordan]: { name: 'Jordan', updatedAt: now - 2 * D, ...ranges([[[1, 2, 3, 4], '17:00', '19:30'], [[6], '10:00', '14:00']]) },
      [priya]: { name: 'Priya', updatedAt: now - D, ...ranges([[[3, 4], '16:00', '20:00'], [[1], '18:00', '22:00'], [[0], '14:00', '16:00']]) },
      [diego]: { name: 'Diego', updatedAt: now - 3 * D, ...ranges([[[1, 3], '16:30', '21:00'], [[5], '12:00', '15:00']]) },
      [hana]: { name: 'Hana', updatedAt: now - D, ...ranges([[[2, 3, 4], '17:00', '20:00'], [[0], '12:00', '16:00']]) },
    },
    messages: [
      { id: uid(), uid: maya, name: 'Maya', text: 'Booked room 204 for tomorrow.', at: now - 26 * H },
      { id: uid(), uid: jordan, name: 'Jordan', text: 'Can we start at 6 instead? I have lab until 5:45', at: now - 25.5 * H },
      { id: uid(), uid: priya, name: 'Priya', text: '6 works for me, I might be a few minutes late though', at: now - 25 * H },
      { id: uid(), uid: hana, name: 'Hana', text: 'Same. Also the cell signaling flashcards in Files are so good, thank you Maya', at: now - 20 * H },
      { id: uid(), uid: hana, name: 'Hana', text: 'This chapter helped me with signal transduction https://openstax.org/books/biology-2e/pages/9-introduction', at: now - 20 * H + 60000 },
      { id: uid(), uid: jordan, name: 'Jordan', text: '@Maya can you bring the practice problems from chapter 8?\nI lost my copy', at: now - 6 * H },
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
      { id: uid(), kind: 'note', title: `Recap: Chapter 7 problem set, ${fmtDate(addDays(t, -6), { month: 'short', day: 'numeric' })}`, sharedBy: 'Priya', sharedByUid: priya, sharedAt: now - 5 * D - 12 * H, content: '<p>We got through 7.1 to 7.14. The Hill coefficient ones tripped everyone up, so Maya walked us through cooperativity with the oxygen curve.<br>Next time: chapter 8 vocab, then the practice exam.</p>' },
      // More in Files, so the library has every kind (js/groups/resources.js).
      ...sampleGroupLibraryItems({ maya, priya, jordan, hana, diego }, now),
    ],
  };
  // Priya shares tomorrow's review to chat, so it shows as an event card,
  // and "New since you were last here" sits above the last day.
  const review = Object.values(entry.sessions).find(x => x.title === 'Midterm 2 review');
  if (review) entry.messages.splice(-1, 0, { id: uid(), uid: priya, name: 'Priya', text: `Tap Going so Maya knows how many worksheets to print ${groupInviteLink(code)}&session=${review.id}`, at: now - 4 * H });
  groupChatSeen()[code] = now - 22 * H;
  const last = entry.messages[entry.messages.length - 1];
  entry.lastMessage = { uid: last.uid, name: last.name, text: last.text.slice(0, 140), at: last.at };
  groupEntries().push(entry);
  openGroup(code);
  toast('This is a sample group. Try RSVPing or painting your availability.', 'info', 4200);
}
