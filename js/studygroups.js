/* ── Study Groups: pages, tabs, sessions, tasks, chat, settings ──
   The group feature is split across files, loaded in this order (see
   index.html): js/spaces/core.js (primitives shared with clubs),
   js/groups/sync.js (data model, writes, realtime sync, legacy
   migration, joining), js/groups/availability.js (Find a time),
   js/groups/resources.js (shared notes, decks, files, links), and this
   file, which renders the pages and handles everything else.
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
          <div class="row-title"><div class="sg-strong">${esc(s.title)}${s.seriesId ? ' <span class="sg-series-tag">Weekly</span>' : ''}</div><div class="row-meta">${[s.start ? `${fmtTime(s.start)}${s.end ? ` to ${fmtTime(s.end)}` : ''}` : '', esc(g.name), s.where ? linkifyWhere(s.where) : ''].filter(Boolean).join(' · ')}</div></div>
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
      ? `${spaceCountdownChip(next.date, next.start, next.end)}<span class="space-card-when">${[esc(spaceWhen(next.date, next.start)), next.where ? esc(next.where) : ''].filter(Boolean).join(' · ') || esc(next.title)}</span>`
      : '<span class="space-card-when">No session scheduled</span>',
    lineHtml: g.lastMessage ? `<div class="space-card-msg ${unread ? 'is-unread' : ''}"><span class="em">${esc(g.lastMessage.name)}:</span> ${esc(g.lastMessage.text)}</div>` : '',
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

/* ── Group home (Overview) ─────────────────────────────────────────
   One path top to bottom: what needs you, the next session (or the best
   time to meet when nothing is scheduled), the week, your tasks. The rail
   holds your exam for this class, who's in, the chat and recent activity.
   Every session renders once. The hero and the Coming up rows carry their
   own RSVP, so the needs strip here leaves out the sessions they show; the
   ask moves onto that session as a "Needs your answer" badge instead. */
const GROUP_HOME_AGENDA_MAX = 5;
// The day picked in the week strip lives on the window, not in state: it
// is a view filter, and it only applies to the group it was picked in.
function groupHomeAgendaDay(g) {
  const d = window._groupAgendaDay, t = todayIso();
  return d && d.code === g.code && d.date >= t && d.date <= addDays(t, 6) ? d.date : '';
}
function pickGroupAgendaDay(code, dateIso) {
  const d = window._groupAgendaDay;
  window._groupAgendaDay = d && d.code === code && d.date === dateIso ? null : { code, date: dateIso };
  renderPreservingInput();
}
function groupOverviewTab(g) {
  const u = myUidFor(g);
  const upcoming = upcomingSessions(g);
  const next = upcoming[0];
  const rest = upcoming.slice(1);
  const day = groupHomeAgendaDay(g);
  const needs = spaceNeeds('group', g);
  const needIds = new Set(needs.items.filter(it => it.type === 'session').map(it => it.id));
  // Sessions the page already shows with their own RSVP stay out of the strip.
  const shown = new Set([next?.id, ...rest.slice(0, GROUP_HOME_AGENDA_MAX).map(s => s.id)].filter(Boolean));
  const stripItems = needs.items.filter(it => !(it.type === 'session' && shown.has(it.id)));
  const stripTaskIds = new Set(stripItems.filter(it => it.type === 'task' || it.type === 'claim').map(it => it.id));
  const best = groupBestTimes(g)[0];
  const contributors = Object.values(g.avail || {}).filter(availHasAny).length;
  const bestReady = !!best && contributors >= 2;
  return `
    ${spaceNeedsStrip('group', g, { needs: { ...needs, items: stripItems, count: stripItems.length } })}
    <div class="sg-overview sg-home">
      <div class="sg-col">
        ${next ? nextSessionHero(g, next, { need: needIds.has(next.id) }) : bestReady ? groupBestHero(g, best) : groupHomeEmptyHero(g)}
        ${next && bestReady ? groupHomeBest(g, best) : ''}
        ${rest.length ? groupHomeComing(g, upcoming, rest, day, needIds) : ''}
        ${groupHomeTasks(g, u, stripTaskIds, needs.items)}
      </div>
      <div class="sg-col sg-home-rail">
        ${groupHomeExam(g)}
        ${groupHomeWho(g, u)}
        ${groupHomeChat(g, u)}
        ${groupHomeActivity(g)}
      </div>
    </div>`;
}
function groupHomeEmptyHero(g) {
  return `
    <div class="card card-pad sg-next-empty">
      <div class="eyebrow">Next session</div>
      <div class="sg-next-title">Nothing scheduled yet</div>
      <p class="small muted mb-16">Pick a time from everyone’s availability, or just put one on the calendar.</p>
      <div class="flex-gap wrap"><button class="btn btn-primary btn-sm" onclick="openSessionModal('${g.code}')">${icon('plus', 14)} Schedule a session</button><button class="btn btn-sm" onclick="setGroupTab('availability')">${icon('grid', 14)} Find a time</button></div>
    </div>`;
}
function groupBestLine(g, w) {
  const people = groupPeople(g).length;
  const n = w.uids.length;
  return {
    when: `${AVAIL_DAYS_LONG[w.day]}, ${fmtTime(slotTime(w.start))} to ${fmtTime(slotTime(w.end))}`,
    who: n >= people ? `works for all ${n}` : `works for ${n} of ${people}`,
    schedule: `scheduleFromBestTime('${g.code}',${w.day},${w.start},${w.end})`,
  };
}
// Nothing on the calendar, but two or more people have added their week:
// the answer to "when can we meet?" is the most useful thing on the page.
function groupBestHero(g, w) {
  const b = groupBestLine(g, w);
  const free = w.uids.map(id => ({ uid: id, name: personName(g, id) }));
  return `
    <div class="card sg-besthero">
      <div class="sg-besthero-top"><span class="eyebrow">Best time to meet</span><span class="space-chip">Nothing scheduled yet</span></div>
      <div class="sg-besthero-title">${esc(b.when)} <span class="sg-besthero-who">${esc(b.who)}</span></div>
      <div class="sg-besthero-faces">${avatarStackHtml(free, 6, 26, (id) => personColor(g, id))}<span>${esc(spaceFaceCaption(free, myUidFor(g), 'free'))}</span></div>
      <div class="sg-besthero-foot">
        <button class="btn btn-primary" onclick="${b.schedule}">${icon('calendar', 14)} Schedule it</button>
        <button class="btn btn-ghost btn-sm" onclick="setGroupTab('availability')">${icon('grid', 14)} See every time</button>
      </div>
    </div>`;
}
// One line under the hero: the next time most people are free.
function groupHomeBest(g, w) {
  const b = groupBestLine(g, w);
  return `
    <div class="card card-sm sg-home-best">
      <span class="sg-home-best-ic" aria-hidden="true">${icon('grid', 14)}</span>
      <button class="sg-home-best-text" onclick="setGroupTab('availability')"><span class="sg-home-best-label">Best time to meet</span><span class="sg-home-best-when">${esc(b.when)}</span> <span class="sg-home-best-who">${esc(b.who)}</span></button>
      <button class="btn btn-sm" onclick="${b.schedule}">Schedule</button>
    </div>`;
}
// A place as plain row text: a meeting link reads as "Video call" or its
// host, not a long URL (the sheet shows the real link).
function groupWhereShort(where) {
  const w = String(where || '').trim();
  if (!(typeof isHttpUrl === 'function' ? isHttpUrl(w) : /^https?:\/\//i.test(w))) return w;
  return SPACE_VIDEO_HOSTS.test(w) ? 'Video call' : (hostOf(w) || 'Link');
}
// A session as a flat row: time and place, Weekly and Needs your answer
// badges, who's going, and the compact RSVP.
function groupAgendaRow(g, s, need) {
  const range = s.start ? `${fmtTime(s.start)}${s.end ? ` to ${fmtTime(s.end)}` : ''}` : 'Any time';
  const going = sessionRsvpPeople(g, s).yes.length;
  const tags = [
    need ? spaceTag('need', 'Needs your answer') : '',
    s.seriesId ? spaceTag('weekly', 'Weekly') : '',
    going ? groupFacePile(g, s, { size: 20 }) : '',
  ].join('');
  return spaceAgendaRow({
    date: s.date, title: s.title,
    metaHtml: `${esc(fmtSessionDay(s.date))} · ${esc(range)}${s.where ? ` · ${esc(groupWhereShort(s.where))}` : ''}`,
    tags,
    trailingHtml: rsvpControl(g, s),
    onclick: `showGroupSessionModal('${g.code}','${s.id}')`,
    label: `${s.title}, ${fmtSessionWhen(s)}`,
  });
}
function groupHomeComing(g, upcoming, rest, day, needIds) {
  const t = todayIso(), end = addDays(t, 6);
  const counts = {};
  upcoming.forEach(s => { if (s.date <= end) counts[s.date] = (counts[s.date] || 0) + 1; });
  const hasWeek = Object.keys(counts).length > 0;
  const list = day ? rest.filter(s => s.date === day) : rest.slice(0, GROUP_HOME_AGENDA_MAX);
  const dayName = day ? fmtDate(day, { weekday: 'long' }) : '';
  const empty = day
    ? `<p class="sg-home-empty">${upcoming[0]?.date === day ? `Just the next session on ${esc(dayName)}. It’s up top.` : `Nothing on ${esc(dayName)}.`} <button class="sg-link" onclick="pickGroupAgendaDay('${g.code}','${day}')">Show all</button></p>`
    : '';
  const more = !day && rest.length > GROUP_HOME_AGENDA_MAX ? rest.length - GROUP_HOME_AGENDA_MAX : 0;
  return `
    <section class="sg-home-coming" aria-label="Coming up">
      <div class="sg-home-head"><h3 class="sg-h3">${day ? esc(dayName) : 'Coming up'}</h3><button class="sg-link" onclick="setGroupTab('schedule')">${more ? `All ${upcoming.length} sessions` : 'All sessions'} ${icon('chevron-right', 12)}</button></div>
      ${hasWeek ? spaceWeekStrip({ start: t, selected: day, counts, label: 'Pick a day to see its sessions', onPick: (d) => `pickGroupAgendaDay('${g.code}','${d}')` }) : ''}
      <div class="card sg-home-agenda">${list.length ? list.map(s => groupAgendaRow(g, s, needIds.has(s.id))).join('') : empty}</div>
    </section>`;
}
// Your open tasks, minus the ones the needs strip already asks about, and
// who has finished what so far.
function groupHomeTasks(g, u, stripTaskIds, needItems) {
  const all = taskList(g);
  const open = all.filter(t => !t.done);
  const mine = open.filter(t => t.assignee === u);
  const rows = mine.filter(t => !stripTaskIds.has(t.id)).sort(byDueThenCreated).slice(0, 4);
  const upTop = needItems.some(it => it.type === 'task' || it.type === 'claim');
  const emptyLine = !all.length ? `No tasks yet. <button class="sg-link" onclick="setGroupTab('tasks')">Add one</button>`
    : mine.length ? 'Your tasks due this week are up top.'
    : upTop ? 'Nothing assigned to you. Up for grabs is up top.'
    : 'Nothing assigned to you.';
  return `
    <div class="card card-pad sg-home-tasks">
      <div class="sg-home-head"><h3 class="sg-h3">Your tasks</h3><button class="sg-link" onclick="setGroupTab('tasks')">${open.length} open in group ${icon('chevron-right', 12)}</button></div>
      ${rows.length ? rows.map(t => groupTaskRow(g, t, { compact: true })).join('') : `<p class="sg-home-empty">${emptyLine}</p>`}
      ${groupHomeContrib(g, u, all)}
    </div>`;
}
function groupHomeContrib(g, u, all) {
  const done = all.filter(t => t.done);
  if (!done.length) return '';
  const by = new Map();
  done.forEach(t => {
    const key = t.doneBy || `name:${t.doneByName || 'Someone'}`;
    const cur = by.get(key) || { uid: t.doneBy || key, name: t.doneBy ? personName(g, t.doneBy) : (t.doneByName || 'Someone'), n: 0 };
    cur.n++; by.set(key, cur);
  });
  const people = [...by.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const shownPeople = people.slice(0, 4);
  const extra = people.length - shownPeople.length;
  return `
    <div class="sg-home-contrib" aria-label="Tasks finished so far">
      <span class="sg-home-contrib-lead">${done.length} of ${all.length} done</span>
      ${shownPeople.map(p => `<span class="sg-home-contrib-p">${personAvatar(p.uid, p.name, 18, personColor(g, p.uid))}${esc(p.uid === u ? 'You' : String(p.name).split(' ')[0])} ${p.n}</span>`).join('')}
      ${extra ? `<span>+${extra} more</span>` : ''}
    </div>`;
}
// The viewer's own next exam for this group's class, from their planner.
// Groups have no shared exam date, so it only shows when the class matches.
function groupHomeExam(g) {
  const c = groupCourse(g);
  if (!c || typeof examList !== 'function') return '';
  const t = todayIso();
  const a = examList().find(x => x.courseId === c.id && x.dueDate && x.dueDate >= t);
  if (!a) return '';
  const d = daysBetween(a.dueDate);
  const when = d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `in ${d} days`;
  const prep = typeof examPrep === 'function' ? examPrep(a) : null;
  const sub = ['Your exam', fmtDate(a.dueDate, { weekday: 'short', month: 'short', day: 'numeric' }) + (a.dueTime ? `, ${fmtTime(a.dueTime)}` : ''), prep == null ? '' : `${prep}% prepped`].filter(Boolean).join(' · ');
  return `
    <button class="card sg-home-exam" onclick="openExamPrep('${esc(a.id)}')" aria-label="${esc(`${a.title}, ${when}. Open exam prep`)}">
      <span class="eyebrow">${esc(a.title)}</span>
      <span class="sg-home-exam-when">${esc(when)}</span>
      <span class="sg-home-exam-sub">${esc(sub)}</span>
      ${prep == null ? '' : `<span class="sg-home-exam-bar" aria-hidden="true"><i style="width:${prep}%"></i></span>`}
    </button>`;
}
// Faces, not a list. The legacy note stays: people from before the update
// only show up once they open the group.
function groupHomeWho(g, u) {
  const people = groupPeople(g);
  const known = new Set(people.map(p => p.name));
  const legacy = (g.members || []).filter(n => n && !known.has(n) && n !== myGroupName());
  return `
    <div class="card card-pad sg-home-who${legacy.length ? ' has-legacy' : ''}">
      <div class="sg-home-head"><h3 class="sg-h3">Who’s in <span class="sg-home-n">${people.length}</span></h3><button class="sg-link" onclick="openInviteModal('${g.code}')">${icon('user-plus', 12)} Invite</button></div>
      <div class="sg-home-faces" role="list">
        ${people.map(p => {
          const name = p.uid === u && p.name !== 'You' ? `${p.name} (you)` : p.name;
          const label = `${name}${p.role === 'owner' ? ', started the group' : ''}`;
          return `<span class="sg-home-face" role="listitem" title="${esc(label)}" aria-label="${esc(label)}">${personAvatar(p.uid, p.name, 32, personColor(g, p.uid))}<span class="sg-home-face-name" aria-hidden="true">${esc(p.uid === u ? 'You' : String(p.name).split(' ')[0])}</span></span>`;
        }).join('')}
      </div>
      ${legacy.length ? `<div class="small muted mt-8">From before the update: ${legacy.map(esc).join(', ')}. They’ll appear here once they open the group.</div>` : ''}
    </div>`;
}
// The last three messages and a reply box. It reuses #sg-chat-input (the
// Chat tab never renders at the same time), so sendGroupMessage and the
// draft-keeping remote re-render both work unchanged.
function groupHomeChat(g, u) {
  const msgs = groupMessages(g).slice(-3);
  const unread = groupUnreadCount(g);
  return `
    <div class="card card-pad sg-home-chat">
      <div class="sg-home-head"><h3 class="sg-h3">Chat${unread ? ` <span class="sg-home-unread" aria-label="${unread} new">${unread}</span>` : ''}</h3><button class="sg-link" onclick="setGroupTab('chat')">Open chat ${icon('chevron-right', 12)}</button></div>
      ${msgs.length ? msgs.map(m => `<div class="sg-mini-msg">${personAvatar(m.uid, m.name, 22, personColor(g, m.uid))}<div class="small"><span class="sg-strong">${esc(m.uid === u ? 'You' : m.name)}</span> <span class="muted">${fmtRelativeTime(m.at)}</span><div class="sg-mini-text">${esc(m.text)}</div></div></div>`).join('') : `<p class="sg-home-empty">No messages yet.</p>`}
      <div class="sg-home-reply">
        <input class="input" id="sg-chat-input" maxlength="${GROUP_MESSAGE_MAX}" autocomplete="off" aria-label="Reply to ${esc(g.name)}" placeholder="${msgs.length ? 'Reply to the group' : 'Say hi to the group'}" onkeydown="if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();sendGroupMessage('${g.code}')}">
        <button class="btn btn-icon btn-sm" aria-label="Send reply" data-tip="Send" onclick="sendGroupMessage('${g.code}')">${icon('send', 14)}</button>
      </div>
    </div>`;
}
function groupHomeActivity(g) {
  const activity = groupActivity(g).slice(0, 8);
  return `
    <div class="card card-pad sg-home-activity">
      <h3 class="sg-h3 mb-8">Recent activity</h3>
      ${activity.length ? activity.map(a => `<div class="sg-activity"><span class="sg-activity-ic">${icon(a.icon, 14)}</span><div class="small">${esc(a.text)} <span class="muted">· ${fmtRelativeTime(a.at)}</span></div></div>`).join('') : `<p class="sg-home-empty">Nothing yet.</p>`}
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
// The shared control (js/spaces/rsvp.js) with a group's answers: Going,
// Maybe, Can't. size 'row' everywhere a list shows sessions, 'hero' in the
// next-session card and the session sheet.
function rsvpControl(g, s, { size = 'row', stillComing = false, clearable = false } = {}) {
  const mine = s.rsvp?.[myUidFor(g)] || '';
  return spaceRsvp({ kind: 'group', code: g.code, id: s.id, title: s.title, mine, size, clearable,
    stillComing: stillComing && spaceStillComingDue('group', g.code, s.id, s, mine) });
}
// toggle (default true, the old behavior) clears your answer when you tap
// the one you already gave. The shared control always passes false, so
// "Still coming? Yes" and "Change, same answer" can never un-RSVP you.
async function setSessionRsvp(code, sid, val, toggle = true) {
  const g = findGroup(code);
  if (!g?.sessions?.[sid] || !['yes', 'maybe', 'no'].includes(val)) return false;
  const u = myUidFor(g);
  const current = g.sessions[sid].rsvp?.[u];
  const next = spaceRsvpNextValue(current, val, toggle);
  if (next === 'yes' && current !== 'yes' && typeof playUiSound === 'function') playUiSound('tap');
  const ok = await groupWrite(code, { [`sessions.${sid}.rsvp.${u}`]: next === null ? GW_DELETE : next });
  // Answering from inside the session's sheet: refresh it so you land in the right list.
  const open = window._groupSessionModal;
  if (ok && open?.code === code && open.sid === sid && $('#modal .space-sheet')) showGroupSessionModal(code, sid);
  return ok;
}
// Who gave which answer, current members only: someone who left keeps a
// key in s.rsvp, but shouldn't be counted or shown as "Former member".
function sessionRsvpPeople(g, s) {
  const out = { yes: [], maybe: [], no: [], none: [] };
  groupPeople(g).forEach(p => { const v = s.rsvp?.[p.uid]; (out[v === 'yes' || v === 'maybe' || v === 'no' ? v : 'none']).push(p); });
  return out;
}
// "You, Maya and 3 others are going". Groups have no officers, so everyone
// sees the counts; only the empty hero line changes.
function groupFacePile(g, s, { size = 26, zero = true } = {}) {
  const who = sessionRsvpPeople(g, s);
  return spaceFacePile({
    people: who.yes, meUid: myUidFor(g), size, colorOf: (uid) => personColor(g, uid),
    zeroText: zero ? 'Be the first to say you’re going' : '0 going',
    detail: who.maybe.length ? `${who.maybe.length} maybe` : '',
    onclick: `showGroupSessionModal('${g.code}','${s.id}')`,
    label: `See who’s going to ${s.title}`,
  });
}
/* ── Session sheet: the details, who's coming, and who hasn't said ──
   Session cards used to hide the RSVP names in a tooltip. This is the
   same sheet as a club event's (spaceEventSheet), so calendar blocks,
   dashboard rows and "coming up" lists all open the same thing. */
function showGroupSessionModal(code, sid) {
  const g = findGroup(code);
  const s = g?.sessions?.[sid];
  if (!g || !s || !safeId(sid)) return;
  const u = myUidFor(g);
  const past = sessionIsPast(s);
  const who = sessionRsvpPeople(g, s);
  window._groupSessionModal = { code, sid };
  const later = s.seriesId ? sessionList(g).filter(x => x.seriesId === s.seriesId && x.date > s.date).length : 0;
  const colorOf = (uid) => personColor(g, uid);
  const nameOf = (p) => ({ ...p, name: p.uid === u && p.name !== 'You' ? `${p.name} (you)` : p.name });
  const lists = [
    { key: 'yes', label: past ? 'Said they’d go' : 'Going', short: past ? 'Went' : 'Going', people: who.yes.map(nameOf), colorOf, empty: past ? 'No one said they’d go.' : 'No one yet. Be the first.' },
    { key: 'maybe', label: 'Maybe', people: who.maybe.map(nameOf), colorOf },
    { key: 'no', label: 'Can’t make it', short: 'Can’t', people: who.no.map(nameOf), colorOf },
    { key: 'none', label: 'Haven’t answered', short: 'No answer', people: who.none.map(nameOf), colorOf, empty: 'Everyone has answered.',
      footHtml: who.none.length && !past && !g.local ? `<button class="btn btn-sm mt-8" onclick="copyRsvpNudge('${g.code}','${s.id}')">${icon('copy', 14)} Copy a reminder for them</button>` : '' },
  ];
  openModal(spaceEventSheet({
    kind: 'group', code: g.code, id: s.id, color: groupColor(g), glyph: 'book-open', spaceName: g.name,
    title: s.title, date: s.date, start: s.start, end: s.end, where: s.where, notes: s.notes,
    tags: s.seriesId ? spaceTag('weekly', `Weekly${later ? `, ${later} more after this` : ''}`) : '',
    rsvpHtml: past ? '' : rsvpControl(g, s, { size: 'hero', stillComing: true, clearable: true }),
    facesHtml: past ? '' : groupFacePile(g, s, { size: 24 }),
    actionsHtml: past ? '' : `${joinLinkButton(s.where)}<button class="btn btn-ghost btn-sm" onclick="downloadSessionIcs('${g.code}','${s.id}')">${icon('download', 14)} Add to calendar app</button>`,
    listsHtml: spaceRsvpLists({ key: spaceRsvpKey('group', g.code, s.id), lists }),
    footHtml: `<button class="btn btn-danger" style="margin-right:auto" onclick="deleteSession('${g.code}','${s.id}')">Delete</button><button class="btn" onclick="openSessionModal('${g.code}','${s.id}')">Edit</button><button class="btn btn-primary" onclick="closeModal()">Done</button>`,
  }), { onClose: () => { window._groupSessionModal = null; } });
}
function copyRsvpNudge(code, sid) {
  const g = findGroup(code);
  const s = g?.sessions?.[sid];
  if (!s) return;
  copyText(`Can everyone RSVP for “${s.title}” (${fmtSessionWhen(s)}) in Semester HQ? Open “${g.name}” → Sessions and tap Going, Maybe, or Can’t. ${groupInviteLink(code)}`, 'Reminder copied. Paste it in your group chat.');
}
// need: the session is one the needs strip would ask about; the home leaves
// it out of the strip and badges it here instead.
function nextSessionHero(g, s, { need = false } = {}) {
  // The countdown chip (or the Happening now strip) carries the when.
  return spaceEventHero({
    date: s.date, start: s.start, end: s.end, where: s.where, notes: s.notes,
    eyebrow: 'Next session',
    tags: `${need ? spaceTag('need', 'Needs your answer') : ''}${s.seriesId ? spaceTag('weekly', 'Weekly') : ''}`,
    title: s.title,
    onOpen: `showGroupSessionModal('${g.code}','${s.id}')`,
    rsvpHtml: rsvpControl(g, s, { size: 'hero', stillComing: true }),
    facesHtml: groupFacePile(g, s),
    actionsHtml: `<button class="btn btn-ghost btn-sm sg-ics" onclick="downloadSessionIcs('${g.code}','${s.id}')">${icon('download', 14)} Add to calendar app</button>`,
    className: 'sg-next-hero',
  });
}
function groupScheduleTab(g) {
  const upcoming = upcomingSessions(g);
  const past = sessionList(g).filter(sessionIsPast).reverse();
  return `
    <div class="sg-toolbar">
      <div class="small muted">Sessions show up on every member’s Semester HQ calendar.</div>
      <div class="flex-gap wrap">${upcoming.length > 1 ? `<button class="btn btn-sm" onclick="downloadSessionIcs('${g.code}')">${icon('download', 14)} Add all to calendar app</button>` : ''}<button class="btn btn-sm" onclick="setGroupTab('availability')">${icon('grid', 14)} Find a time</button><button class="btn btn-primary btn-sm" onclick="openSessionModal('${g.code}')">${icon('plus', 14)} New session</button></div>
    </div>
    ${upcoming.length ? upcoming.map(s => sessionCard(g, s)).join('') : emptyState(icon('calendar', 24), 'No upcoming sessions', `<button class="btn btn-primary btn-sm mt-8" onclick="openSessionModal('${g.code}')">Schedule one</button>`, 'Not sure when? Find a time shows when everyone is free.')}
    ${past.length ? `<details class="sg-past"><summary class="small muted">Past sessions (${past.length})</summary>${past.slice(0, 30).map(s => sessionCard(g, s, { past: true })).join('')}</details>` : ''}
  `;
}
function sessionCard(g, s, { past = false } = {}) {
  const r = sessionRsvpPeople(g, s);
  const c = { yes: r.yes.length, maybe: r.maybe.length, no: r.no.length };
  const who = [...r.yes.map(p => `${p.name} (going)`), ...r.maybe.map(p => `${p.name} (maybe)`), ...r.no.map(p => `${p.name} (can’t)`)].join(', ');
  return `
    <div class="card sg-session ${past ? 'past' : ''}" onclick="showGroupSessionModal('${g.code}','${s.id}')">
      ${dateTile(s.date)}
      <div class="sg-session-body">
        <div class="sg-session-top">
          <div style="min-width:0">
            <div class="sg-strong">${esc(s.title)}${s.seriesId ? ' <span class="sg-series-tag">Weekly</span>' : ''}</div>
            <div class="small muted sg-meta-line"><span>${fmtSessionWhen(s)}</span>${s.where ? `<span>${icon('map-pin', 12)} ${linkifyWhere(s.where)}</span>` : ''}</div>
          </div>
          <div class="sg-session-actions">
            ${!past ? `<button class="btn btn-ghost btn-icon btn-sm" data-tip="Add to your calendar app (.ics)" aria-label="Download ${esc(s.title)} as a calendar file" onclick="event.stopPropagation();downloadSessionIcs('${g.code}','${s.id}')">${icon('download', 14)}</button>` : ''}
            <button class="btn btn-ghost btn-icon btn-sm" aria-label="Edit ${esc(s.title)}" data-tip="Edit" onclick="event.stopPropagation();openSessionModal('${g.code}','${s.id}')">${icon('pencil', 14)}</button>
          </div>
        </div>
        ${s.notes ? `<div class="small sg-notes">${linkifyText(s.notes)}</div>` : ''}
        <div class="sg-session-foot">
          ${!past ? rsvpControl(g, s) : ''}
          ${!past ? joinLinkButton(s.where) : ''}
          <span class="small muted sg-session-count" title="${esc(who)}">${past ? `${c.yes} said they’d go` : `${c.yes} going${c.maybe ? ` · ${c.maybe} maybe` : ''}${c.no ? ` · ${c.no} can’t` : ''}`}</span>
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
    <div class="modal-head"><h3>${s ? 'Edit session' : 'New study session'}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
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
        <select class="select" id="sg-task-assignee" aria-label="Assign to"><option value="">Unassigned</option>${people.map(p => `<option value="${esc(p.uid)}">${esc(p.name)}${p.uid === u && p.name !== 'You' ? ' (you)' : ''}</option>`).join('')}</select>
        <button class="btn btn-primary" onclick="addGroupTask('${g.code}')">Add</button>
      </div>
    </div>
    <div class="sg-toolbar">
      <div class="segmented">${[['all', 'All'], ['mine', 'Mine'], ['unassigned', 'Unassigned']].map(([k, l]) => `<button class="${filter === k ? 'active' : ''}" aria-pressed="${filter === k}" onclick="setState({groupTaskFilter:'${k}'})">${l}</button>`).join('')}</div>
      ${all.length ? `<div class="sg-task-progress"><span class="small muted">${doneCount} of ${all.length} done</span><div class="progress"><div style="width:${pct}%"></div></div></div>` : ''}
    </div>
    ${open.length ? open.map(t => groupTaskRow(g, t)).join('') : emptyState(icon('check-square', 24), filter === 'mine' ? 'Nothing assigned to you' : filter === 'unassigned' ? 'Every task has an owner' : 'No open tasks', '', filter === 'all' ? 'Break the work into pieces and give each one an owner.' : '')}
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
        ${!t.done && !t.assignee ? `<button class="btn btn-sm sg-claim" onclick="setGroupTaskAssignee('${g.code}','${t.id}','${esc(u)}')">${icon('user-plus', 12)} I’ll take it</button>` : ''}
        <select class="select sg-assignee" aria-label="Assign ${esc(t.title)}" onchange="setGroupTaskAssignee('${g.code}','${t.id}',this.value)">
          <option value="">Unassigned</option>${groupPeople(g).map(p => `<option value="${esc(p.uid)}" ${p.uid === t.assignee ? 'selected' : ''}>${esc(p.name)}${p.uid === u && p.name !== 'You' ? ' (you)' : ''}</option>`).join('')}
        </select>
        <button class="btn btn-ghost btn-icon btn-sm" aria-label="Delete ${esc(t.title)}" data-tip="Delete" onclick="deleteGroupTask('${g.code}','${t.id}')">${icon('trash', 14)}</button>`}
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
        ${mine || isOwner ? `<button class="sg-msg-del" aria-label="Delete message" data-tip="Delete" onclick="deleteGroupMessage('${g.code}','${m.id}')">${icon('x', 11)}</button>` : ''}
      </div>`;
  }).join('');
  return `
    <div class="card sg-chat">
      <div class="sg-chat-log" id="sg-chat-log" data-keep-scroll="bottom">
        ${msgs.length ? rows : emptyState(icon('message-circle', 24), 'No messages yet', '', 'Say hi, or post what you’re stuck on.')}
      </div>
      <div class="sg-chat-compose">
        <input class="input" id="sg-chat-input" maxlength="${GROUP_MESSAGE_MAX}" autocomplete="off" placeholder="Message ${esc(g.name)}" onkeydown="if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();sendGroupMessage('${g.code}')}">
        <button class="btn btn-primary" aria-label="Send message" data-tip="Send" onclick="sendGroupMessage('${g.code}')">${icon('send', 14)}</button>
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
  const sessions = groups.flatMap(g => upcomingSessions(g).filter(s => s.date <= end && s.rsvp?.[myUidFor(g)] !== 'no').map(s => ({ g, s })))
    .sort((a, b) => (a.s.date + (a.s.start || '')).localeCompare(b.s.date + (b.s.start || ''))).slice(0, 3);
  const tasks = groups.flatMap(g => taskList(g).filter(t => !t.done && t.assignee === myUidFor(g)).map(t => ({ g, t })))
    .sort((a, b) => byDueThenCreated(a.t, b.t)).slice(0, 3);
  const unread = groups.filter(groupHasUnread);
  return `
    <div class="card card-pad mb-16">
      <div class="flex-between mb-8"><h3 class="sg-h3">Study groups</h3><button class="sg-link" onclick="setState({route:'studygroups',subRoute:null})">All groups ${icon('chevron-right', 12)}</button></div>
      ${spaceNeedsPills('group', groups)}
      ${unread.length ? `<div class="sg-dash-unread">${unread.map(g => `<button class="pill sg-unread-pill" onclick="openGroup('${g.code}','chat')"><span class="sg-unread-dot"></span>${esc(g.name)}</button>`).join('')}</div>` : ''}
      ${sessions.length ? sessions.map(({ g, s }) => `
        <div class="list-row sg-session-row space" style="--course:${esc(groupColor(g) || '#6b6b6b')};${spaceVars(groupColor(g))}" onclick="showGroupSessionModal('${g.code}','${s.id}')">
          ${spaceDateBlock(s.date, { size: 'tile' })}
          <div class="row-title"><div class="sg-strong">${esc(s.title)}</div><div class="row-meta">${esc(g.name)} · ${fmtSessionWhen(s)}</div></div>
          ${rsvpControl(g, s)}
        </div>`).join('') : `<p class="small muted">No group sessions in the next 7 days.</p>`}
      ${tasks.length ? `<div class="divider"></div><div class="small dim mb-8 sg-strong">Assigned to you</div>${tasks.map(({ g, t }) => `
        <div class="list-row sg-task compact" onclick="openGroup('${g.code}','tasks')">
          <button type="button" class="row-check" role="checkbox" aria-checked="false" aria-label="Mark ${esc(t.title)} as done" onclick="event.stopPropagation();toggleGroupTask('${g.code}','${t.id}')"></button>
          <div class="row-title"><div>${esc(t.title)}</div><div class="row-meta">${esc(g.name)}${t.due ? ` · ${t.due < todayIso() ? '<span class="sg-overdue">Overdue</span>' : 'Due ' + fmtSessionDay(t.due)}` : ''}</div></div>
        </div>`).join('')}` : ''}
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
  const last = entry.messages[entry.messages.length - 1];
  entry.lastMessage = { uid: last.uid, name: last.name, text: last.text.slice(0, 140), at: last.at };
  groupEntries().push(entry);
  openGroup(code);
  toast('This is a sample group. Try RSVPing or painting your availability.', 'info', 4200);
}
