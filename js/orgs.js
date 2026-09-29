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

   Split across files (see index.html): js/orgs/sync.js holds the data,
   writes, sync and ?org= links; js/orgs/events.js the event rows, the
   hero, the agenda and the event sheets; this one the pages,
   announcements, chat, joining and the sample clubs; js/orgs/admin.js
   the officer tools; js/orgs/files.js the Files tab. Every name stays a
   global, so inline onclick strings keep working.
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
const ORG_ANNOUNCEMENT_MAX = 1200;
const ORG_FILES_MAX = 100;
const ORG_TITLE_MAX = 40;
const ORG_TITLE_SUGGESTIONS = ['President', 'Vice President', 'Captain', 'Treasurer', 'Secretary', 'Social chair'];

// A small glyph for the service a link goes to, and "Pay dues" for the first
// link that goes to a payment app, so members find it without reading labels.
const ORG_LINK_GLYPHS = [[/instagram|tiktok/i, 'camera'], [/groupme|discord|slack|whatsapp|messenger|telegram/i, 'message-circle'], [/drive\.google|docs\.google|dropbox|onedrive|notion/i, 'folder'], [/calendar/i, 'calendar']];
// What a dues event shows instead of RSVP buttons: the club's pay link when
// the event is about paying, "Add a dues link" for an officer without one.
function orgDuesAction(o, e, { size = 'row' } = {}) {
  const payish = /dues|fee|pay/i.test(e.title || '');
  if (!payish) return '';
  const link = orgDuesLink(o);
  if (link) {
    const label = /dues/i.test(e.title) ? 'Pay dues' : /fee/i.test(e.title) ? 'Pay the fee' : 'Pay now';
    return `<a class="btn ${size === 'hero' ? 'space-dues-btn is-hero' : 'btn-sm space-dues-btn'}" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" title="${esc(link.label)}" onclick="event.stopPropagation()">${label} ${icon('arrow-up-right', 14)}</a>`;
  }
  return isOrgOfficer(o) ? `<button class="btn btn-ghost btn-sm space-dues-add" onclick="event.stopPropagation();openOrgLinksModal('${o.code}')">${icon('plus', 14)} Add a dues link</button>` : '';
}
function orgLinksHtml(o, { editable = false } = {}) {
  const links = orgLinkList(o);
  if (!links.length && !editable) return '';
  const duesId = orgDuesLink(o)?.id;
  const glyph = (l) => (ORG_LINK_GLYPHS.find(([re]) => re.test(`${l.url} ${l.label}`)) || [0, 'link'])[1];
  return `<div class="org-links">${links.map(l => `<a class="org-link-pill" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"${l.id === duesId ? ` title="${esc(l.label)}"` : ''}>${icon(l.id === duesId ? 'check-square' : glyph(l), 12)} ${l.id === duesId ? 'Pay dues' : esc(l.label)}</a>`).join('')}${editable ? `<button class="org-link-pill is-edit" onclick="openOrgLinksModal('${o.code}')">${icon('pencil', 11)} ${links.length ? 'Edit links' : 'Add links'}</button>` : ''}</div>`;
}
function dashboardOrgsWidget() {
  const orgs = allOrgs();
  if (!orgs.length) return '';
  const rows = orgUpcomingForMe(10).slice(0, 4);
  // New announcements ride on each club's one pill ("2 new"); new chat
  // messages with no new announcements say "new messages".
  const unread = {};
  orgs.forEach(o => { const n = orgUnreadCount(o); if (n) unread[o.code] = n; else if (orgChatUnread(o)) unread[o.code] = true; });
  return `
    <div class="card card-pad">
      <div class="flex-between mb-8"><h3 class="sg-h3">Clubs & teams</h3><button class="sg-link" onclick="setState({route:'orgs',subRoute:null})">All ${icon('chevron-right', 12)}</button></div>
      ${spaceNeedsPills('club', orgs, { unread })}
      ${rows.length ? rows.map(({ o, e }) => `
        <div class="list-row sg-session-row space" style="--course:${esc(orgColor(o))};${spaceVars(orgColor(o))}" onclick="openOrgEvent('${o.code}','${e.id}')">
          ${spaceDateBlock(e.date, { size: 'tile' })}
          <div class="row-title"><div class="sg-strong">${esc(e.title)}${orgRowRequiredTag(e)}</div><div class="row-meta">${esc(o.name)}${e.start ? ` · ${fmtTime(e.start)}` : ''}</div></div>
          ${orgRsvpControl(o, e)}
        </div>`).join('') : '<p class="small muted">Nothing on the calendar in the next 10 days.</p>'}
    </div>`;
}

// Small rows (dashboard, This week) carry only Required, in the same
// outline tag as the Overview; the RSVP control already sits beside them.
function orgRowRequiredTag(e) { return e.required && !orgIsDuesEvent(e) ? ` ${spaceTag('required', 'Required')}` : ''; }

/* ── Navigation ────────────────────────────────────────────────── */
function openOrg(code, tab) { _orgWeekOpen = false; setState({ route: 'orgs', subRoute: code, orgTab: tab || 'overview' }); window.scrollTo(0, 0); if (tab === 'announcements') markOrgSeen(code); }
function openOrgEvent(code, eventId) { openOrg(code, 'events'); setTimeout(() => showOrgEventModal(code, eventId), 60); }

/* ── Clubs & teams page ────────────────────────────────────────── */
function pageOrgs() {
  if (state.subRoute) {
    const o = findOrg(state.subRoute);
    if (o) return pageOrgDetail(o);
  }
  const orgs = allOrgs();
  // Arriving from another page (the old page is still on screen while this
  // builds): This week starts capped again.
  if (!document.querySelector('#content [data-org-index]')) _orgWeekOpen = false;
  return `
    ${pageHead('Clubs & Teams', 'Your club, team, or chapter’s calendar, right next to your classes.', orgs.length ? `
      <button class="btn btn-sm" onclick="openJoinOrgModal()">${icon('user-plus', 14)} Join with code</button>
      <button class="btn btn-primary" onclick="openCreateOrgModal()">${icon('plus', 14)} Start one</button>
    ` : '')}
    ${!fbConfigured() || cloudGroupsEnabled() || demoBarShowing() ? '' : `<div class="sg-callout mb-16">${icon('info', 16)}<div class="small">You’re looking around without an account, so anything you make here disappears when you close the tab. <a href="login.html">Log in</a> to invite members.</div></div>`}
    ${orgs.length ? `
      ${orgsThisWeek()}
      <div class="sg-section-label">Yours</div>
      <div class="space-grid" data-org-index>${orgs.map(orgIndexCard).join('')}</div>
    ` : orgsEmptyHero()}
    <div class="sg-pricing-note small">${icon('users', 14)} Bringing your whole team or chapter? <a href="${GROUP_PRICING_URL}" target="_blank" rel="noopener">Group pricing</a> covers every member at a lower rate.</div>
  `;
}
// Three rows on a phone and four on a desktop, so your clubs sit above
// the fold. See all opens the rest in place, stays open across redraws of
// this page, and closes again once you go somewhere else.
let _orgWeekOpen = false;
function orgsThisWeek() {
  const phone = window.matchMedia?.('(max-width: 760px)').matches;
  const card = spaceWeekCard({
    title: 'This week',
    max: _orgWeekOpen ? 99 : (phone ? 3 : 4),
    rows: orgUpcomingForMe(7).map(({ o, e }) => ({
      date: e.date,
      html: `
        <div class="list-row space-week-item space" style="${spaceVars(orgColor(o))}" onclick="showOrgEventModal('${o.code}','${e.id}')">
          ${spaceCrest({ text: orgMonogram(o) }, 'xs')}
          <div class="row-title"><div class="sg-strong">${esc(e.title)}${orgRowRequiredTag(e)}</div><div class="row-meta">${[e.start ? `${fmtTime(e.start)}${e.end ? ` to ${fmtTime(e.end)}` : ''}` : '', esc(o.name), e.location ? esc(e.location) : ''].filter(Boolean).join(' · ')}</div></div>
          ${orgRsvpControl(o, e)}
        </div>`,
    })),
  });
  return card ? `<div class="org-week" role="none" onclick="orgWeekSeeAll(event)">${card}</div>` : '';
}
// See all removes itself, so focus moves to the first row it revealed.
function orgWeekSeeAll(ev) {
  if (!ev.target.closest('.space-week-all')) return;
  _orgWeekOpen = true;
  const row = ev.currentTarget.querySelector('.space-week-row.is-more .list-row');
  if (row) { if (!row.hasAttribute('tabindex')) row.setAttribute('tabindex', '0'); row.focus({ preventScroll: true }); }
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
// lighter steps of it, so a stack never reads as a row of grey dots. In
// dark mode the base is the lifted fill (spaceDarkPair), so a navy or wine
// club's faces don't sink into each other or the dark band. personAvatar
// picks each face's letter color from its own fill.
function orgFaceColors(o) {
  const raw = orgColor(o), map = {};
  const color = state.settings?.dark && HEX_COLOR.test(raw || '') ? spaceDarkPair(raw).fill : raw;
  orgPeople(o).forEach((p, i) => { map[p.uid] = p.officer ? color : spaceTint(color, (i % 3) + 1); });
  return map;
}
// What a club needs from you: the same count as its "What needs you"
// strip (spaceNeeds in js/spaces/needs.js).
function orgIndexNeedCount(o) { return spaceNeeds('club', o).count; }
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
    eyebrow: [esc(orgKindLabel(o)), o.school ? esc(o.school) : '', o.sample ? 'Sample' : ''].filter(Boolean).join(' · '),
    name: o.name,
    onclick: `openOrg('${o.code}')`,
    style: colorVars('org', orgColor(o)),
    nextHtml: next
      ? `${spaceCountdownChip(next.date, next.start, next.end)}<span class="space-card-when"><span class="em">${esc(next.title)}</span>${spaceWhen(next.date, next.start) ? ` · ${esc(spaceWhen(next.date, next.start))}` : ''}</span>`
      : '<span class="space-card-when">Nothing scheduled</span>',
    unread: !!(unread || chatUnread),
    unreadLabel: [unread ? `${unread} new announcement${unread === 1 ? '' : 's'}` : '', chatUnread ? 'new messages' : ''].filter(Boolean).join(' · '),
    footHtml: `${avatarStackHtml(orgPeople(o), 4, 24, (uid) => faces[uid])}<span>${o.loading ? 'Loading…' : `${count} member${count === 1 ? '' : 's'}`}</span>${isOrgOfficer(o) ? `<span class="space-officer">${icon('shield', 12)} Officer</span>` : ''}`,
    needCount: o.loading ? 0 : orgIndexNeedCount(o),
  });
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
      eyebrow: orgBandEyebrow(o),
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
// Kind, school, member count, Sample. On a phone the count drops out when
// the line would wrap (the band's faces already say how many).
function orgBandEyebrow(o) {
  const n = o.memberUids.length;
  const label = orgKindLabel(o), count = `${n} member${n === 1 ? '' : 's'}`;
  const long = [label, o.school || '', count, o.sample ? 'Sample' : ''].filter(Boolean).join(' · ').length > 36;
  const head = [esc(label), o.school ? esc(o.school) : ''].filter(Boolean).join(' · ');
  return `${head}<span class="org-band-count${long ? ' is-long' : ''}"> · ${count}</span>${o.sample ? ' · Sample' : ''}`;
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
/* ── Overview: one path, top to bottom ────────────────────────────
   What needs you, the pinned announcement, one Next up hero, a week
   strip, and a flat Coming up agenda. Every event renders once: the
   hero's event leaves the needs strip (the hero asks for the answer
   itself), and the agenda skips anything the hero or the strip shows. */
// The pinned announcement, under the tabs. An unread one is already a
// "Read it" card in the needs strip, so the banner takes the first pinned
// announcement the strip isn't showing.
function orgPinnedBanner(o, skip) {
  const pinned = orgAnnouncementList(o).filter(a => a.pinned && !skip.has(a.id));
  const a = pinned[0];
  if (!a) return '';
  const more = pinned.length - 1;
  const flat = a.text.replace(/\s+/g, ' ').trim();
  const text = flat.length > 220 ? flat.slice(0, 220) + '…' : flat;
  // A flat row like the needs strip's: the pin tile is the only tint.
  return `
    <section class="org-pinned" aria-label="Pinned announcement">
      <span class="org-pinned-pin" aria-hidden="true">${icon('pin', 14)}</span>
      <div class="org-pinned-body">
        <div class="org-pinned-by">Pinned by ${esc(a.name)} · ${esc(fmtRelativeTime(a.at))}${more ? ` · <button class="sg-link org-pinned-more" onclick="setState({orgTab:'announcements'})">+${more} more pinned</button>` : ''}</div>
        <div class="org-pinned-text">${linkifyText(text)}</div>
      </div>
      <div class="org-pinned-acts">
        <button class="btn btn-sm" onclick="spaceNeedsReadPinned('${o.code}','${a.id}',null)" aria-label="Read the pinned announcement">Read</button>
        ${isOrgOfficer(o) && !(o.local && !o.sample) ? `<button class="btn btn-ghost btn-sm" onclick="pinAnnouncement('${o.code}','${a.id}',false)" aria-label="Unpin this announcement">Unpin</button>` : ''}
      </div>
    </section>`;
}
// Officers only: the same two numbers as the top of Officer home (the
// same orgHealth call and tiles), with the way into Admin. Who hasn't
// answered the next event is already under the hero's faces.
function orgOfficerMiniCard(o) {
  if (!isOrgOfficer(o) || typeof orgHealth !== 'function') return '';
  const h = orgHealth(o);
  return `
    <div class="card card-pad org-officer-mini">
      <div class="flex-between mb-8"><h3 class="sg-h3">${icon('shield', 16)} Officer view</h3><button class="sg-link" onclick="setState({orgTab:'admin'})">Open Admin ${icon('chevron-right', 12)}</button></div>
      <div class="org-mini-stats">${orgRateTile(h)}${orgEveryRequiredTile(h)}</div>
    </div>`;
}
function orgOverviewTab(o) {
  const officer = isOrgOfficer(o);
  const upcoming = upcomingOrgEvents(o);
  const next = upcoming[0];
  // The strip, minus the hero's event: the hero carries its own Needs
  // your answer tag and the full-size buttons. The header keeps the full
  // count (the same one the index card, dashboard and Heads up show) and
  // says how many sit below; a strip whose asks all sit below is left out.
  const all = spaceNeeds('club', o);
  const need = new Set(all.items.filter(i => i.type === 'event').map(i => i.id));
  const items = all.items.filter(i => !(next && i.type === 'event' && i.id === next.id));
  const needs = { ...all, items, count: all.count };
  const shown = new Set([...(next ? [next.id] : []), ...items.filter(i => i.type === 'event').map(i => i.id)]);
  const stripPinned = new Set(items.filter(i => i.type === 'pinned').map(i => i.id));
  const strip = spaceNeedsStrip('club', o, { needs });
  const banner = orgPinnedBanner(o, stripPinned);
  const bannerId = orgAnnouncementList(o).find(a => a.pinned && !stripPinned.has(a.id))?.id;

  // Week strip: today and the six days after, dots from every event.
  const t = todayIso();
  const day = orgAgendaDay(o);
  const counts = {};
  orgEventList(o).forEach(e => { if (e.date >= t && e.date <= addDays(t, 6)) counts[e.date] = (counts[e.date] || 0) + 1; });
  const dayEvents = day ? orgEventList(o).filter(e => e.date === day) : [];
  const agenda = day ? dayEvents.filter(e => !shown.has(e.id)) : upcoming.filter(e => !shown.has(e.id)).slice(0, 6);
  const above = day ? dayEvents.length - agenda.length : 0;
  const dayLabel = day ? fmtDate(day, { weekday: 'long', month: 'short', day: 'numeric' }) : '';
  const agendaEmpty = day
    ? (above ? `Nothing else on ${esc(dayLabel)}.` : `Nothing on ${esc(dayLabel)}.`)
    : next ? 'Nothing else scheduled.' : '';

  const anns = orgAnnouncementList(o).filter(a => a.id !== bannerId && !stripPinned.has(a.id)).slice(0, 3);
  const officers = orgPeople(o).filter(p => p.officer);
  const faces = orgFaceColors(o);
  const me = myOrgUid(o);
  const files = orgFileList(o);
  return `
    ${strip}
    ${banner}
    <div class="sg-overview org-overview">
      <div class="sg-col">
        ${next ? orgNextHero(o, next, need) : `
          <div class="card card-pad sg-next-empty">
            <div class="sg-eyebrow">Calendar</div>
            <div class="sg-next-title">Nothing scheduled yet</div>
            <p class="small muted">${officer ? 'Add your first meeting or practice and it shows up on every member’s calendar.' : 'When officers add events, they’ll show up here and on your calendar.'}</p>
            ${officer ? `<button class="btn btn-primary btn-sm mt-8" onclick="openOrgEventModal('${o.code}')">${icon('plus', 14)} Add an event</button>` : ''}
          </div>`}
        ${orgRecapPrompt(o)}
        ${next ? spaceWeekStrip({ start: t, selected: day, counts, onPick: (d) => `orgPickAgendaDay('${o.code}','${d}')`, label: `Pick a day to see ${o.name} events` }) : ''}
        ${next || day ? `
        <div class="card card-pad org-agenda">
          <div class="flex-between org-agenda-head">
            <h3 class="sg-h3">${day ? esc(dayLabel) : 'Coming up'}</h3>
            ${day ? `<button class="sg-link" onclick="orgPickAgendaDay('${o.code}','${day}')">Show all ${icon('chevron-right', 12)}</button>` : `<button class="sg-link" onclick="setState({orgTab:'events'})">Full calendar ${icon('chevron-right', 12)}</button>`}
          </div>
          ${agenda.length ? `<div class="org-agenda-rows">${agenda.map(e => orgAgendaRow(o, e, need)).join('')}</div>` : `<p class="small muted org-agenda-empty">${agendaEmpty}</p>`}
          ${above ? `<p class="small muted org-agenda-above">${above === 1 ? 'One more this day is' : `${above} more this day are`} shown above.</p>` : ''}
        </div>` : ''}
      </div>
      <div class="sg-col">
        ${orgOfficerMiniCard(o)}
        <div class="card card-pad">
          <div class="flex-between mb-8"><h3 class="sg-h3">Announcements</h3>${officer ? `<button class="sg-link" onclick="openAnnouncementModal('${o.code}')">${icon('plus', 12)} Post</button>` : `<button class="sg-link" onclick="setState({orgTab:'announcements'})">All ${icon('chevron-right', 12)}</button>`}</div>
          ${anns.length ? anns.map(a => orgAnnouncementHtml(o, a, { compact: true })).join('') : `<p class="small muted">${bannerId || stripPinned.size ? 'Nothing else yet.' : 'No announcements yet.'}</p>`}
        </div>
        <div class="card card-pad">
          <div class="flex-between mb-8"><h3 class="sg-h3">Officers</h3><button class="sg-link" onclick="setState({orgTab:'members'})">${o.memberUids.length} member${o.memberUids.length === 1 ? '' : 's'} ${icon('chevron-right', 12)}</button></div>
          <div class="org-officer-faces">${officers.map(p => `
            <div class="org-officer-face">${personAvatar(p.uid, p.name, 32, faces[p.uid] || orgColor(o))}<div class="org-officer-face-text"><span class="org-officer-face-name">${esc(p.name)}${p.uid === me && p.name !== 'You' ? ' <span class="muted">(you)</span>' : ''}</span><span class="org-officer-face-title">${esc(orgRoleLabel(o, p))}</span></div></div>`).join('')}
          </div>
        </div>
        ${files.length ? `
        <div class="card card-pad org-rail-files">
          <div class="flex-between mb-8"><h3 class="sg-h3">Files</h3><button class="sg-link" onclick="setState({orgTab:'files'})">All ${files.length} ${icon('chevron-right', 12)}</button></div>
          ${files.slice(0, 3).map(f => orgFileRow(o, f, { compact: true })).join('')}
        </div>` : ''}
      </div>
    </div>`;
}
function setOrgOnCalendar(code, on) { const e = orgEntry(code); if (!e) return; e.hideCalendar = !on; touch(); }
// compact: the rail preview. Links shrink to their host at normal weight
// and the text stops at two lines; the Announcements tab keeps it all.
function orgAnnouncementPreview(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+/g, (m) => `<a class="org-ann-host" href="${m}" target="_blank" rel="noopener noreferrer">${esc(hostOf(m.replace(/&amp;/g, '&')) || 'link')}</a>`);
}
function orgAnnouncementHtml(o, a, { compact = false } = {}) {
  const text = compact && a.text.length > 220 ? a.text.slice(0, 220) + '…' : a.text;
  return `
    <div class="org-ann ${a.pinned ? 'is-pinned' : ''}">
      <div class="flex-between">
        <div class="small"><span class="sg-strong">${esc(a.name)}</span> <span class="muted">· ${fmtRelativeTime(a.at)}</span>${a.pinned ? ` <span class="org-pin">${icon('pin', 11)} Pinned</span>` : ''}</div>
        ${!compact && isOrgOfficer(o) ? `<div class="flex-gap"><button class="btn btn-ghost btn-icon btn-sm" aria-label="${a.pinned ? 'Unpin' : 'Pin'} announcement" onclick="pinAnnouncement('${o.code}','${a.id}',${!a.pinned})">${icon('pin', 14)}</button><button class="btn btn-ghost btn-icon btn-sm" aria-label="Delete announcement" data-tip="Delete announcement" onclick="deleteAnnouncement('${o.code}','${a.id}')">${icon('trash', 14)}</button></div>` : ''}
      </div>
      <div class="org-ann-text${compact ? ' is-preview' : ''}">${compact ? orgAnnouncementPreview(text) : linkifyText(text)}</div>
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
  const faces = orgFaceColors(o);
  const memberRow = (p) => `
        <div class="sg-person org-member" data-search="${esc((p.name + ' ' + orgRoleLabel(o, p)).toLowerCase())}">
          ${personAvatar(p.uid, p.name, 30, faces[p.uid] || orgColor(o))}
          <div class="row-title"><div class="small sg-strong">${esc(p.name)}${p.uid === me && p.name !== 'You' ? ' <span class="muted">(you)</span>' : ''}</div><div class="small muted">${esc(orgRoleLabel(o, p))}${p.officer && p.title ? ` · <span class="org-officer-tag">${icon('shield', 11)} ${p.owner ? 'Founder' : 'Officer'}</span>` : ''}</div></div>
          ${officer && (!o.local || o.sample) ? `<button class="btn btn-ghost btn-sm" onclick="openMemberRoleModal('${o.code}','${esc(p.uid)}')">Manage</button>` : p.uid === me ? `<button class="btn btn-ghost btn-sm" onclick="openMyOrgTitleModal('${o.code}')">Edit title</button>` : ''}
        </div>`;
  const officers = people.filter(p => p.officer), general = people.filter(p => !p.officer);
  return `
    <div class="sg-toolbar">
      <div class="small muted">${people.length} member${people.length === 1 ? '' : 's'} · ${officerCount} officer${officerCount === 1 ? '' : 's'}</div>
      <div class="flex-gap wrap">
        ${officer ? `<button class="btn btn-sm" onclick="setState({orgTab:'admin'});setTimeout(()=>document.getElementById('org-attendance')?.scrollIntoView({block:'start'}),80)">${icon('check-square', 14)} RSVPs</button><button class="btn btn-sm" onclick="downloadOrgRosterCsv('${o.code}')">${icon('download', 14)} Export roster</button>` : ''}
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
  if (code && state.orgTab === 'admin' && typeof orgAttEdges === 'function') orgAttEdges();
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
// always a few past events with answers (the Admin RSVPs grid shows
// the last 30 days) and a few coming up, one of them required and not yet
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
    if (!orgIsDuesEvent(e)) memberUids.forEach(u => {
      let v;
      if (u === me) {
        // You answer your past events, and one required event ahead is
        // left for you to answer, so the "needs your answer" card shows.
        if (!past && e.required && !orgIsDuesEvent(e) && firstRequiredAhead) { firstRequiredAhead = false; return; }
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
