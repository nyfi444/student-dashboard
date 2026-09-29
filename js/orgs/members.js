/* ── Club Members: the directory (Tier A item 12) ──────────────────
   Who's who in a club: leadership on top, everyone else below, with a
   search box (from 8 people), filter chips, joined dates and faces in
   the club's colors. Officers also see how often each person answers
   RSVPs; members never see anyone's answer rate.

   Leadership is officers plus anyone with a title the founder has seen
   (people[uid].reviewed), or a title an officer set before per-member
   titles existed (titles[uid] only). A member can set their own title
   without anyone approving it, so an unreviewed title stays under
   Members with a "Waiting on founder" tag: nobody can type "President"
   and land in Leadership on their own. Titles never give powers.

   Answered (officers only): of this term's past events since the person
   joined, how many they answered Going or Can't. Dues and deadlines
   aren't counted, same as the Admin RSVP grid. It's RSVPs, not
   attendance. "Hasn't answered" matches the Admin "Needs you" card: a
   required event in the next two weeks with no answer yet.

   Filter and search live in _orgMemberView (memory only, reset when a
   different club opens). Rows are drawn already filtered, so a live
   snapshot re-render keeps the query and the chip. Typing and chip taps
   filter in place (applyOrgMemberFilter), so focus stays put.

   Reads only existing fields. Writes nothing new: Make officer and
   Remove reuse reviewOrgRole and removeOrgMember (js/orgs/admin.js). The
   roster CSV (downloadOrgRosterCsv) keeps its columns.
   ──────────────────────────────────────────────────────────────── */
const ORG_MEMBER_SEARCH_FROM = 8;
const ORG_MEMBER_NEW_DAYS = 30;
const ORG_MEMBER_FILTERS = [['all', 'All'], ['lead', 'Leadership'], ['member', 'Members'], ['new', 'New this month'], ['owe', 'Hasn’t answered']];
let _orgMemberView = { code: '', filter: 'all', q: '' };

function _orgMemberFor(code) {
  if (_orgMemberView.code !== code) _orgMemberView = { code, filter: 'all', q: '' };
  return _orgMemberView;
}
// Officers, the founder, and titles someone in charge has seen.
function orgIsLeader(o, p) {
  if (p.officer || p.owner) return true;
  if (!p.title) return false;
  const raw = o.people?.[p.uid];
  return raw?.reviewed === true || (typeof raw?.title !== 'string' && !!cleanStr(o.titles?.[p.uid], ORG_TITLE_MAX));
}
function orgMemberJoinedLabel(joinedAt) {
  if (!joinedAt) return '';
  const d = iso(new Date(joinedAt));
  const sameYear = d.slice(0, 4) === todayIso().slice(0, 4);
  return `Joined ${fmtDate(d, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' })}`;
}
function orgMemberIsNew(p, now = Date.now()) { return !!p.joinedAt && now - p.joinedAt <= ORG_MEMBER_NEW_DAYS * 86400000; }
// This term's past events (no dues) that this person was around for.
function orgMemberAnswerRate(o, p, past) {
  const mine = past.filter(e => orgJoinedBy(p, e));
  if (!mine.length) return null;
  let yes = 0, no = 0;
  mine.forEach(e => { const v = orgAnswerOf(o, p.uid, e); if (v === 'yes') yes++; else if (v === 'no') no++; });
  return { asked: mine.length, answered: yes + no, yes, no, none: mine.length - yes - no };
}
function orgMemberRatePast(o) {
  const from = orgTermStart();
  return orgEventList(o).filter(e => !orgIsDuesEvent(e) && orgEventPast(e) && e.date >= from);
}
// Required events in the next two weeks with no answer yet, per person.
function orgMemberOwed(o) {
  const out = {};
  orgAdminSilent(o).forEach(({ dates }) => dates.forEach(({ e }) => {
    orgRsvpPeople(o, e).none.forEach(p => { (out[p.uid] = out[p.uid] || []).push(e); });
  }));
  return out;
}
function orgMemberMatch(tags, hay, st) {
  const q = String(st.q || '').trim().toLowerCase();
  return (st.filter === 'all' || tags.includes(st.filter)) && (!q || hay.includes(q));
}

function orgMemberRateHtml(r) {
  if (!r) return '<span class="org-dir-rate is-none" aria-hidden="true"></span>';
  const tip = `${r.yes} going, ${r.no} can’t, ${r.none} no answer this term since they joined`;
  return `<span class="org-dir-rate" title="${esc(tip)}"><span class="sr-only">Answered </span><span class="org-dir-rate-n">${r.answered} of ${r.asked}</span><span class="org-dir-meter" aria-hidden="true"><span style="width:${Math.round(r.answered / r.asked * 100)}%"></span></span></span>`;
}
function orgMemberRow(o, p, ctx) {
  const { me, officer, faces, rates, owed, leader } = ctx;
  const tags = [leader ? 'lead' : 'member'];
  if (orgMemberIsNew(p)) tags.push('new');
  if (officer && owed[p.uid]) tags.push('owe');
  const hay = `${p.name} ${orgRoleLabel(o, p)}`.toLowerCase();
  const pill = p.owner ? '<span class="org-dir-pill is-founder">Founder</span>'
    : p.officer ? `<span class="org-dir-pill is-officer">${icon('shield', 11)}Officer</span>`
    : p.title && !leader ? '<span class="org-dir-pill is-waiting">Waiting on founder</span>' : '';
  const joined = orgMemberJoinedLabel(p.joinedAt);
  const owe = officer && owed[p.uid] ? owed[p.uid] : null;
  const canManage = officer && (!o.local || o.sample);
  const action = canManage
    ? `<button type="button" class="btn btn-ghost btn-sm btn-icon org-dir-more" aria-label="${p.uid === me ? 'Edit your title' : `Manage ${esc(p.name)}`}" aria-haspopup="menu" aria-expanded="false" onclick="openOrgMemberMenu(this,'${o.code}','${esc(p.uid)}')">${icon('more-horizontal', 16)}</button>`
    : p.uid === me ? `<button type="button" class="btn btn-ghost btn-sm org-dir-edit" onclick="openMyOrgTitleModal('${o.code}')">Edit title</button>` : '';
  return `
        <div class="org-dir-row" data-tags="${tags.join(' ')}" data-search="${esc(hay)}"${orgMemberMatch(tags, hay, _orgMemberView) ? '' : ' hidden'}>
          ${personAvatar(p.uid, p.name, 36, faces[p.uid] || orgColor(o))}
          <div class="org-dir-text">
            <div class="org-dir-name">${esc(p.name)}${p.uid === me && p.name !== 'You' ? ' <span class="org-dir-you">(you)</span>' : ''}</div>
            <div class="org-dir-sub">${p.title ? `<span class="org-dir-role">${esc(p.title)}</span>` : ''}${pill}${joined ? `<span class="org-dir-joined">${esc(joined)}</span>` : ''}</div>
            ${owe ? `<div class="org-dir-owe">Hasn’t answered ${esc(owe[0].title)}, ${esc(fmtDate(owe[0].date, { month: 'short', day: 'numeric' }))}${owe.length > 1 ? ` and ${owe.length - 1} more` : ''}</div>` : ''}
          </div>
          ${officer ? orgMemberRateHtml(rates[p.uid]) : ''}
          ${action ? `<div class="org-dir-act">${action}</div>` : ''}
        </div>`;
}
function orgMembersTab(o) {
  const st = _orgMemberFor(o.code);
  const people = orgPeople(o);
  const me = myOrgUid(o);
  const officer = isOrgOfficer(o);
  const faces = orgFaceColors(o);
  // Someone who joined with a position ("Treasurer") but isn't an officer
  // yet: only the founder can give officer access, so the founder is asked.
  const requests = isOrgOwner(o) ? people.filter(p => p.title && !p.officer && !p.reviewed) : [];
  const past = officer ? orgMemberRatePast(o) : [];
  const rates = {};
  if (officer) people.forEach(p => { rates[p.uid] = orgMemberAnswerRate(o, p, past); });
  const owed = officer ? orgMemberOwed(o) : {};
  const leaders = people.filter(p => orgIsLeader(o, p));
  const others = people.filter(p => !orgIsLeader(o, p)).sort((a, b) => a.name.localeCompare(b.name));
  const counts = { all: people.length, lead: leaders.length, member: others.length, new: people.filter(p => orgMemberIsNew(p)).length, owe: officer ? people.filter(p => owed[p.uid]).length : 0 };
  const filters = ORG_MEMBER_FILTERS.filter(([k]) => k === 'all' || k === 'lead' || k === 'member' || counts[k] > 0);
  if (!filters.some(([k]) => k === st.filter)) st.filter = 'all';
  if (people.length < ORG_MEMBER_SEARCH_FROM) st.q = '';
  const ctx = { me, officer, faces, rates, owed };
  const rows = (list, leader) => list.map(p => orgMemberRow(o, p, { ...ctx, leader })).join('');
  const shownIn = (list, leader) => list.filter(p => {
    const tags = [leader ? 'lead' : 'member', ...(orgMemberIsNew(p) ? ['new'] : []), ...(officer && owed[p.uid] ? ['owe'] : [])];
    return orgMemberMatch(tags, `${p.name} ${orgRoleLabel(o, p)}`.toLowerCase(), st);
  }).length;
  const leadShown = shownIn(leaders, true), otherShown = shownIn(others, false);
  const chip = ([k, label]) => `<button type="button" class="chip org-dir-chip" data-filter="${k}" aria-pressed="${st.filter === k}" onclick="setOrgMemberFilter('${o.code}','${k}')">${esc(label)}<span class="sr-only">, </span><span class="org-dir-chip-n">${counts[k]}</span></button>`;
  const section = (key, title, note, list, leader, shown) => `
    <section class="org-dir-sec" data-sec="${key}"${shown ? '' : ' hidden'} aria-labelledby="org-dir-h-${key}">
      <div class="org-dir-head"><h3 class="org-dir-title" id="org-dir-h-${key}">${esc(title)} <span class="org-dir-n">${list.length}</span></h3>${note ? `<p class="org-dir-note">${note}</p>` : ''}</div>
      <div class="card org-dir-card"><div class="org-dir-grid">${rows(list, leader)}</div></div>
    </section>`;
  const general = orgGeneralLabel(o);
  return `
    <div class="org-dir${st.filter === 'owe' ? ' is-owe' : ''}" id="org-member-list" data-code="${esc(o.code)}">
      <div class="org-dir-bar">
        <div class="org-dir-count">${people.length} member${people.length === 1 ? '' : 's'} · ${leaders.length} in leadership</div>
        <div class="org-dir-actions">
          ${officer ? `<button class="btn btn-sm" onclick="downloadOrgRosterCsv('${o.code}')">${icon('download', 14)} Export roster</button>` : ''}
          <button class="btn btn-primary btn-sm org-dir-invite" onclick="openOrgInviteModal('${o.code}')">${icon('user-plus', 14)} Invite</button>
        </div>
      </div>
      <div class="org-dir-tools">
        ${people.length >= ORG_MEMBER_SEARCH_FROM ? `<label class="org-dir-search">${icon('search', 14)}<input class="input" type="search" id="org-member-search" value="${esc(st.q)}" placeholder="Search by name or title" aria-label="Search ${people.length} members" autocomplete="off" oninput="filterOrgMembers(this.value)"></label>` : ''}
        <div class="chip-row org-dir-chips" role="group" aria-label="Show">${filters.map(chip).join('')}</div>
      </div>
      ${requests.map(p => `
        <div class="sg-callout org-request mb-8"><span>${icon('shield', 14)}</span>
          <div class="small" style="flex:1"><span class="sg-strong">${esc(p.name)}</span> joined as <span class="sg-strong">${esc(p.title)}</span>. Make them an officer so they can add events, post announcements, and share files?</div>
          <div class="flex-gap"><button class="btn btn-sm" onclick="reviewOrgRole('${o.code}','${esc(p.uid)}',false)">Not now</button><button class="btn btn-primary btn-sm" onclick="reviewOrgRole('${o.code}','${esc(p.uid)}',true)">Make officer</button></div>
        </div>`).join('')}
      ${section('lead', 'Leadership', 'Titles don’t change what someone can do. Only officers post, add events, and manage members.', leaders, true, leadShown)}
      ${section('member', o.kind === 'team' ? 'Team' : 'Members', '', others, false, otherShown)}
      <div class="org-dir-none"${leadShown + otherShown ? ' hidden' : ''}>
        <p class="small muted">No one matches that.</p>
        <button type="button" class="btn btn-sm" onclick="clearOrgMemberFilter('${o.code}')">Show everyone</button>
      </div>
      ${!others.length && !st.q && st.filter === 'all' ? `<p class="small muted org-dir-empty">No ${esc(general.toLowerCase())} yet. <button class="sg-link" onclick="openOrgInviteModal('${o.code}')">Invite members</button></p>` : ''}
      <p class="sr-only" id="org-member-status" aria-live="polite"></p>
      ${officer ? `<p class="org-dir-foot">${icon('eye', 14)}<span>Answered counts RSVPs to this term’s events since each person joined. Only officers see it. <button class="sg-link" onclick="setState({orgTab:'admin'});setTimeout(()=>document.getElementById('org-attendance')?.scrollIntoView({block:'start'}),80)">See the RSVP grid</button></span></p>` : ''}
    </div>
    <details class="card card-pad org-roles-help mt-16">
      <summary class="sg-strong small">${icon('chevron-right', 12)}How roles work</summary>
      <div class="small muted mt-8">
        <p><span class="sg-strong">Founder:</span> whoever started ${esc(o.name)}. The founder is an officer and is the only one who can make someone else an officer.</p>
        <p><span class="sg-strong">Officers:</span> add events, post announcements, share files, see who hasn’t RSVPed, and manage members.</p>
        <p><span class="sg-strong">${esc(general)}:</span> RSVP, chat, and open shared files. Events show up on their calendar.</p>
        <p><span class="sg-strong">Titles:</span> anyone can add one, like Treasurer or Captain. Titles are for show and don’t change what someone can do. A title moves to Leadership once the founder has seen it.</p>
      </div>
    </details>`;
}

/* ── Filtering in place ─────────────────────────────────────────── */
function applyOrgMemberFilter() {
  const root = document.getElementById('org-member-list');
  if (!root || root.dataset.code !== _orgMemberView.code) return;
  const st = _orgMemberView;
  let shown = 0;
  root.querySelectorAll('.org-dir-sec').forEach(sec => {
    let n = 0;
    sec.querySelectorAll('.org-dir-row').forEach(el => { const on = orgMemberMatch(el.dataset.tags.split(' '), el.dataset.search, st); el.hidden = !on; if (on) n++; });
    sec.hidden = !n;
    shown += n;
  });
  root.querySelectorAll('.org-dir-chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === st.filter)));
  root.classList.toggle('is-owe', st.filter === 'owe');
  const none = root.querySelector('.org-dir-none');
  if (none) none.hidden = shown > 0;
  const status = document.getElementById('org-member-status');
  const filtered = st.filter !== 'all' || String(st.q || '').trim();
  if (status) status.textContent = filtered ? (shown ? `${shown} ${shown === 1 ? 'person' : 'people'} shown` : 'No one matches that') : '';
}
// The search box's oninput. Kept by name for older markup.
function filterOrgMembers(q) { _orgMemberView.q = String(q || '').slice(0, 80); applyOrgMemberFilter(); }
function setOrgMemberFilter(code, key) {
  const st = _orgMemberFor(code);
  st.filter = ORG_MEMBER_FILTERS.some(([k]) => k === key) ? key : 'all';
  applyOrgMemberFilter();
}
function clearOrgMemberFilter(code) {
  const st = _orgMemberFor(code);
  st.filter = 'all'; st.q = '';
  const box = document.getElementById('org-member-search');
  if (box) { box.value = ''; box.defaultValue = ''; }
  applyOrgMemberFilter();
  document.querySelector('#org-member-list .org-dir-chip[data-filter="all"]')?.focus({ preventScroll: true });
}

/* ── The ··· Manage menu ────────────────────────────────────────── */
function openOrgMemberMenu(btn, code, memberUid) {
  const o = findOrg(code);
  const p = o && orgPeople(o).find(x => x.uid === memberUid);
  if (!p || !isOrgOfficer(o)) return;
  const me = myOrgUid(o), owner = isOrgOwner(o);
  const canRemove = !p.owner && p.uid !== me && (!p.officer || owner);
  const items = [
    `<button class="menu-item" onclick="openMemberRoleModal('${code}','${esc(p.uid)}')">${icon('pencil', 16)}<span>${p.uid === me ? 'Edit your title' : 'Title and role'}</span></button>`,
    owner && !p.officer ? `<button class="menu-item" onclick="reviewOrgRole('${code}','${esc(p.uid)}',true)">${icon('shield', 16)}<span>Make officer</span></button>` : '',
    canRemove ? `<div class="menu-sep" role="separator"></div><button class="menu-item is-danger" onclick="removeOrgMember('${code}','${esc(p.uid)}')">${icon('trash', 16)}<span>Remove from ${esc(o.name)}</span></button>` : '',
  ];
  openMenu(btn, items.join(''));
}
