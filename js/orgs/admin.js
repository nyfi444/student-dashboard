/* ── Clubs & teams: running a club ───────────────────────────────
   Officer tools: quick links, the RSVPs grid and the roster CSV, Officer
   home (the Admin tab), titles, member roles, and the settings sheet (leave, delete).
   Loaded right after js/orgs.js, which holds the data and the pages.
──────────────────────────────────────────────────────────────── */
/* ── Quick links (officers edit them) ─────────────────────────── */
function openOrgLinksModal(code) {
  const o = findOrg(code);
  if (!o || !isOrgOfficer(o)) return;
  const links = orgLinkList(o);
  const row = (l = { label: '', url: '' }) => `<div class="org-link-row"><input class="input" maxlength="30" placeholder="GroupMe" value="${esc(l.label)}" aria-label="Link name"><input class="input" type="url" placeholder="https://…" value="${esc(l.url)}" aria-label="Link address"><button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove link" data-tip="Remove link" onclick="this.parentNode.remove()">${icon('x', 12)}</button></div>`;
  openModal(`
    <div class="modal-head"><h3>Links for ${esc(o.name)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body">
      <p class="small muted mb-8">Up to ${ORG_LINKS_MAX}. They sit under the club’s name where every member can find them.</p>
      <div id="ol-rows">${(links.length ? links : [{ label: '', url: '' }]).map(row).join('')}</div>
      <div class="chip-row mt-8">${ORG_LINK_SUGGESTIONS.map(t => `<button type="button" class="chip" onclick="addOrgLinkRow('${t}')">${icon('plus', 12)} ${t}</button>`).join('')}<button type="button" class="chip" onclick="addOrgLinkRow('')">${icon('plus', 12)} Other</button></div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="ol-save" onclick="saveOrgLinks('${code}')">Save</button></div>
  `);
}
function addOrgLinkRow(label) {
  const rows = $('#ol-rows');
  if (!rows || rows.children.length >= ORG_LINKS_MAX) { toast(`Up to ${ORG_LINKS_MAX} links`, 'info'); return; }
  rows.insertAdjacentHTML('beforeend', `<div class="org-link-row"><input class="input" maxlength="30" placeholder="GroupMe" value="${esc(label)}" aria-label="Link name"><input class="input" type="url" placeholder="https://…" aria-label="Link address"><button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove link" data-tip="Remove link" onclick="this.parentNode.remove()">${icon('x', 12)}</button></div>`);
  rows.lastElementChild.querySelector(label ? 'input[type=url]' : 'input').focus();
}
async function saveOrgLinks(code) {
  const rows = $$('#ol-rows .org-link-row');
  const links = [];
  for (const r of rows) {
    const [labelEl, urlEl] = r.querySelectorAll('input');
    const url = urlEl.value.trim(), label = cleanStr(labelEl.value, 30);
    if (!url && !label) continue;
    if (!isHttpUrl(url)) { toast(`“${label || url}” needs a full link starting with https://`, 'error'); urlEl.focus(); return; }
    links.push({ id: uid(), label: label || hostOf(url), url });
  }
  setBtnLoading($('#ol-save'), true);
  if (await orgWrite(code, { links: links.slice(0, ORG_LINKS_MAX) })) { closeModal(); toast(links.length ? 'Links saved' : 'Links cleared'); }
  else setBtnLoading($('#ol-save'), false, 'Save');
}
/* ── RSVPs: who answered, across events ──────────────────────────
   Named for what it is: answers to Going or Can't, not a check-in. The
   per-event sheet answers "who's coming Tuesday"; this answers what an
   officer asks at the end of the month: who keeps not answering. Rows
   are members, columns are the events in the chosen range plus the next
   two, and the whole roster exports as a CSV.
   Every number covers current members only (removing someone or leaving
   deletes their answers), and a member only counts toward events on or
   after the day they joined. People from before joinedAt existed (0)
   count everywhere. */
const ORG_RSVP_RANGES = [['30', 'Last 30 days'], ['term', 'This term'], ['all', 'All']];
let _orgRsvpRange = '30';
function orgSetRsvpRange(range) {
  if (!ORG_RSVP_RANGES.some(r => r[0] === range) || range === _orgRsvpRange) return;
  _orgRsvpRange = range;
  render();
  // The redraw drops focus to <body>; put it back on the range just picked.
  document.querySelector('#content .org-rsvp-range button[aria-pressed="true"]')?.focus({ preventScroll: true });
}
// The grid scrolls sideways when there are more events than fit: a fade on
// the right edge says so, and goes once the last column is in view.
function orgAttEdge(el) {
  if (!el) return;
  el.classList.toggle('is-more', el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
}
function orgAttEdges() { document.querySelectorAll('#content .org-att').forEach(orgAttEdge); }
function orgJoinedBy(p, e) { return !p.joinedAt || iso(new Date(p.joinedAt)) <= e.date; }
function orgAnswerOf(o, memberUid, e) { const v = o.rsvp?.[memberUid]?.[e.id]; return v === 'yes' || v === 'no' ? v : ''; }
// Answered (Going or Can't) out of the answers that were asked for.
function orgRsvpRate(o, events, people = orgPeople(o)) {
  let asked = 0, answered = 0;
  events.forEach(e => people.forEach(p => { if (!orgJoinedBy(p, e)) return; asked++; if (orgAnswerOf(o, p.uid, e)) answered++; }));
  return { asked, answered, rate: asked ? answered / asked : null };
}
// This term, from your own semester dates. Without them: since Aug 1
// in the fall, since Jan 1 in the spring.
function orgTermStart() {
  const s = typeof currentSemester === 'function' ? currentSemester() : null;
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s.startDate || '') && s.startDate <= todayIso()) return s.startDate;
  const t = todayIso();
  return +t.slice(5, 7) >= 8 ? `${t.slice(0, 4)}-08-01` : `${t.slice(0, 4)}-01-01`;
}
function orgRsvpRangeStart(range = _orgRsvpRange) { return range === 'all' ? '' : range === 'term' ? orgTermStart() : addDays(todayIso(), -30); }
// Dues and deadlines aren't attended, so they aren't columns here. The
// roster CSV below still lists them, with any answers given before.
function orgRsvpGridEvents(o, range = _orgRsvpRange) {
  const from = orgRsvpRangeStart(range);
  const all = orgEventList(o).filter(e => !orgIsDuesEvent(e));
  const past = all.filter(e => orgEventPast(e) && (!from || e.date >= from));
  const upcoming = all.filter(e => !orgEventPast(e)).slice(0, 2);
  return { past, upcoming, events: [...past, ...upcoming] };
}
// The four numbers at the top of Officer home.
function orgHealth(o) {
  const people = orgPeople(o);
  const last = orgEventList(o).filter(e => !orgIsDuesEvent(e) && orgEventPast(e)).slice(-4);
  const rate = orgRsvpRate(o, last, people);
  const required = orgRsvpGridEvents(o).past.filter(e => e.required);
  let every = 0, counted = 0;
  people.forEach(p => {
    const mine = required.filter(e => orgJoinedBy(p, e));
    if (!mine.length) return;
    counted++;
    if (mine.every(e => orgAnswerOf(o, p.uid, e))) every++;
  });
  const monthStart = `${todayIso().slice(0, 8)}01`;
  const joined = people.filter(p => p.joinedAt && iso(new Date(p.joinedAt)) >= monthStart).length;
  return { people, last, rate, required, every, counted, monthStart, joined };
}
// Officer home and the Overview's Officer view show these two tiles, from
// the same orgHealth numbers, so they always match.
function orgRateTile(h) {
  return spaceStatTile(h.rate.rate === null
    ? { value: '–', label: 'Answer rate', sub: 'No past events yet' }
    : { value: `${Math.round(h.rate.rate * 100)}%`, label: 'Answer rate', sub: h.last.length < 4 ? `Last ${h.last.length} event${h.last.length === 1 ? '' : 's'} (all there are)` : 'Last 4 events', bar: h.rate.rate });
}
function orgEveryRequiredTile(h) {
  return spaceStatTile(h.counted
    ? { value: `${h.every} of ${h.counted}`, label: 'Answered every required event', sub: ORG_RSVP_RANGES.find(r => r[0] === _orgRsvpRange)[1], bar: h.every / h.counted }
    : { value: '–', label: 'Answered every required event', sub: 'No required events yet' });
}
function orgRsvpMark(v, { small = false } = {}) {
  const label = { yes: 'Going', no: 'Can’t', none: 'No answer', na: 'Not in the club yet' }[v];
  return `<span class="org-rsvp-mark is-${v}${small ? ' is-small' : ''}" title="${label}"><span class="sr-only">${label}</span></span>`;
}
function orgAttendanceHtml_officer(o) {
  const { past, events } = orgRsvpGridEvents(o);
  const people = orgPeople(o);
  if (!events.length) return `<p class="small muted">${_orgRsvpRange === 'all' ? 'Once there are events, this shows who answered each one.' : 'No events in this range. Try All.'}</p>`;
  const faces = orgFaceColors(o);
  const me = myOrgUid(o);
  const mark = (p, e, opts) => orgRsvpMark(!orgJoinedBy(p, e) ? 'na' : orgAnswerOf(o, p.uid, e) || 'none', opts);
  const stats = new Map(people.map(p => [p.uid, orgRsvpRate(o, past, [p])]));
  const rows = [...people].sort((a, b) => (stats.get(b.uid).rate ?? -1) - (stats.get(a.uid).rate ?? -1) || a.name.localeCompare(b.name));
  const nameOf = (p) => `${esc(p.name)}${p.uid === me && p.name !== 'You' ? ' <span class="muted">(you)</span>' : ''}`;
  const rateHtml = (s) => s.asked
    ? `<span class="org-rsvp-rate"><span class="org-rsvp-rate-n">${s.answered} of ${s.asked}</span><span class="org-rsvp-rate-bar" aria-hidden="true"><i style="width:${Math.round(s.rate * 100)}%"></i></span></span>`
    : `<span class="org-rsvp-rate is-new">New</span>`;
  const DOTS = 12;
  // The first and last dates under a member's dots, so a row reads as a
  // span of time. Two or three dots share one caption.
  const short = (e) => esc(fmtDate(e.date, { month: 'short', day: 'numeric' }));
  const dateCaps = (evs) => !evs.length ? '' : `<span class="org-rsvp-caps" aria-hidden="true">${evs.length < 4 ? `<span>${short(evs[0])}${evs.length > 1 ? ` to ${short(evs[evs.length - 1])}` : ''}</span>` : `<span>${short(evs[0])}</span><span>${short(evs[evs.length - 1])}</span>`}</span>`;
  return `
    <div class="org-att org-rsvp-table" onscroll="orgAttEdge(this)"><table>
      <thead><tr><th class="org-att-name" scope="col">Member</th><th class="org-att-total" scope="col">Answered</th>${events.map(e => `<th scope="col" class="${orgEventPast(e) ? '' : 'is-upcoming'}" title="${esc(e.title)} · ${esc(fmtDate(e.date))}"><button class="org-att-ev" onclick="showOrgEventModal('${o.code}','${e.id}')" aria-label="${esc(e.title)}, ${esc(fmtDate(e.date, { month: 'short', day: 'numeric' }))}"><span class="org-att-date">${esc(fmtDate(e.date, { month: 'short', day: 'numeric' }))}</span><span class="org-att-title">${esc(e.title)}</span>${e.required ? `<span class="org-att-req">Required</span>` : ''}</button></th>`).join('')}</tr></thead>
      <tbody>${rows.map(p => `<tr><th class="org-att-name" scope="row"><span class="sg-strong">${nameOf(p)}</span>${p.title ? ` <span class="muted">· ${esc(p.title)}</span>` : ''}</th><td class="org-att-total">${rateHtml(stats.get(p.uid))}</td>${events.map(e => `<td class="org-att-cell${orgEventPast(e) ? '' : ' is-upcoming'}">${mark(p, e)}</td>`).join('')}</tr>`).join('')}</tbody>
      <tfoot><tr><th class="org-att-name muted" scope="row">Going</th><td></td>${events.map(e => { const c = orgRsvpCounts(o, e.id); return `<td class="org-att-cell muted" title="${c.yes} going, ${c.no} can’t, ${c.none} no answer">${c.yes}</td>`; }).join('')}</tr></tfoot>
    </table></div>
    <div class="org-rsvp-cards" role="list">${rows.map(p => {
      const s = stats.get(p.uid);
      const shownEvents = events.slice(-DOTS);
      const earlier = events.length - shownEvents.length;
      return `
      <div class="org-rsvp-card" role="listitem">
        ${personAvatar(p.uid, p.name, 28, faces[p.uid] || orgColor(o))}
        <div class="org-rsvp-card-main">
          <div class="org-rsvp-card-top"><span class="sg-strong">${nameOf(p)}</span><span class="org-rsvp-card-n">${s.asked ? `${s.answered} of ${s.asked} answered` : 'New'}</span></div>
          <div class="org-rsvp-dots">${earlier ? `<span class="org-rsvp-earlier">+${earlier} earlier</span>` : ''}<span class="org-rsvp-strip"><span class="org-rsvp-slots">${shownEvents.map(e => `<span class="org-rsvp-slot">${mark(p, e, { small: true })}</span>`).join('')}</span>${dateCaps(shownEvents)}</span></div>
        </div>
      </div>`;
    }).join('')}</div>
    <div class="org-rsvp-key small muted" aria-hidden="true">${orgRsvpMark('yes', { small: true })} Going ${orgRsvpMark('no', { small: true })} Can’t ${orgRsvpMark('none', { small: true })} No answer</div>`;
}
// Roster + every event's RSVPs, one member per row. What a treasurer pastes
// into the sheet they already keep.
function downloadOrgRosterCsv(code) {
  const o = findOrg(code);
  if (!o || !isOrgOfficer(o)) return;
  const events = orgEventList(o);
  const people = orgPeople(o);
  const head = ['Name', 'Title', 'Role', 'Joined', ...events.map(e => `${e.date} ${e.title}${e.required ? ' (required)' : ''}`)];
  const rows = people.map(p => [p.name, p.title, p.owner ? 'Founder' : p.officer ? 'Officer' : orgGeneralLabel(o), p.joinedAt ? iso(new Date(p.joinedAt)) : '', ...events.map(e => ({ yes: 'Going', no: "Can't" }[o.rsvp?.[p.uid]?.[e.id]] || ''))]);
  downloadCsv(`${o.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'club'}-roster.csv`, [head, ...rows]);
  toast(`Exported ${people.length} member${people.length === 1 ? '' : 's'}`);
}

/* ── Admin: Officer home ─────────────────────────────────────────
   The screen an officer shows their board: four numbers, what needs
   them, the RSVPs grid, then the running-the-club sections in two
   columns. Only ever shown to officers. */
const ORG_NEEDS_SHOW = 4;
const ORG_NEEDS_DAYS = 14; // Needs you looks two weeks ahead
// Required events in the next two weeks that someone hasn't answered. A
// weekly series is one row, with a chip per date; its See who and Post a
// nudge act on the nearest date.
function orgAdminSilent(o) {
  const end = addDays(todayIso(), ORG_NEEDS_DAYS);
  const rows = [], bySeries = new Map();
  upcomingOrgEvents(o).filter(e => e.required && !orgIsDuesEvent(e) && e.date <= end).forEach(e => {
    const n = orgRsvpPeople(o, e).none.length;
    if (!n) return;
    const key = e.seriesId || '';
    if (key && bySeries.has(key)) { bySeries.get(key).dates.push({ e, n }); return; }
    const row = { e, n, dates: [{ e, n }] };
    if (key) bySeries.set(key, row);
    rows.push(row);
  });
  return rows;
}
function orgAdminNeedsCard(o) {
  const people = orgPeople(o);
  const requests = isOrgOwner(o) ? people.filter(p => p.title && !p.officer && !p.reviewed) : [];
  const silent = orgAdminSilent(o);
  const count = (requests.length ? 1 : 0) + silent.length;
  const short = (d) => fmtDate(d, { month: 'short', day: 'numeric' });
  const row = ({ e, n, dates }) => {
    const series = dates.length > 1;
    const meta = series
      ? `<span class="org-needs-cap">Haven’t answered</span><span class="org-needs-chips">${dates.map(d => `<span class="org-needs-chip">${esc(short(d.e.date))} · ${d.n}</span>`).join('')}</span>`
      : `${esc(fmtDate(e.date, { weekday: 'short', month: 'short', day: 'numeric' }))}${e.start ? ` · ${esc(fmtTime(e.start))}` : ''} · <span class="em">${n} ${n === 1 ? 'hasn’t' : 'haven’t'} answered</span>`;
    return spaceAgendaRow({
      date: e.date, title: series ? `${e.title} · weekly` : e.title,
      metaHtml: meta,
      trailingHtml: `<div class="org-needs-acts"><button class="btn btn-sm" onclick="showOrgEventModal('${o.code}','${e.id}')" aria-label="See who hasn’t answered ${esc(e.title)}, ${esc(short(e.date))}">See who</button><button class="btn btn-sm" onclick="remindToRsvp('${o.code}','${e.id}')" aria-label="Post a nudge for ${esc(e.title)}, ${esc(short(e.date))}">${icon('megaphone', 14)} Post a nudge</button></div>`,
      onclick: `showOrgEventModal('${o.code}','${e.id}')`,
      className: series ? 'is-series' : '',
    });
  };
  const extra = silent.slice(ORG_NEEDS_SHOW);
  // Nothing to chase: a calm end state an officer can show their board.
  const clear = () => {
    const h = orgHealth(o);
    return `<div class="org-needs-done" role="status">
      <div class="org-needs-done-text"><span class="org-needs-check" aria-hidden="true">${icon('check', 14, 2.4)}</span><span class="org-needs-done-title">Everyone’s answered for the next 2 weeks</span></div>
      <div class="org-needs-done-kpi">${orgRateTile(h)}</div>
    </div>`;
  };
  return `
    <div class="card card-pad org-admin-needs">
      <div class="flex-between mb-8"><h3 class="sg-h3">Needs you${count ? ` <span class="org-admin-count">${count}</span>` : ''}</h3></div>
      ${count ? `<div class="org-needs-rows">
        ${requests.length ? `<div class="org-needs-request">
          <span class="org-needs-ic" aria-hidden="true">${icon('shield', 16)}</span>
          <div class="org-needs-request-text"><div class="sg-strong">${requests.length === 1 ? `${esc(requests[0].name)} joined as ${esc(requests[0].title)}` : `${requests.length} people joined with a position`}</div><div class="small muted">Waiting on you for officer access.</div></div>
          <button class="btn btn-sm" onclick="setState({orgTab:'members'})">Review</button>
        </div>` : ''}
        ${silent.slice(0, ORG_NEEDS_SHOW).map(row).join('')}
        ${extra.length ? `<details class="org-needs-more"><summary class="sg-link">${icon('chevron-right', 12)} ${extra.length} more required event${extra.length === 1 ? '' : 's'}</summary>${extra.map(row).join('')}</details>` : ''}
      </div>` : clear()}
    </div>`;
}
function orgAdminStats(o) {
  const h = orgHealth(o);
  const plan = typeof orgGroupPlan === 'function' ? orgGroupPlan(o) : null;
  const officers = h.people.filter(p => p.officer).length;
  return `
    <div class="org-admin-stats">
      ${orgRateTile(h)}
      ${orgEveryRequiredTile(h)}
      ${spaceStatTile({ value: String(h.joined), label: `New member${h.joined === 1 ? '' : 's'} this month`, sub: `Since ${fmtDate(h.monthStart, { month: 'short', day: 'numeric' })}` })}
      ${plan && plan.status === 'active'
        ? spaceStatTile({ value: `${plan.memberCount} of ${plan.seats}`, label: 'Seats claimed', sub: 'Your group plan', bar: plan.seats ? plan.memberCount / plan.seats : 0 })
        : spaceStatTile({ value: String(h.people.length), label: `Member${h.people.length === 1 ? '' : 's'}`, sub: `${officers} officer${officers === 1 ? '' : 's'}` })}
    </div>`;
}
// Color picked in Club details but not saved yet: survives a re-render,
// saved with everything else by Save details.
let _orgPendingColor = null;
function orgPickDetailsColor(code, color, btn) {
  if (!ORG_COLORS.includes(color)) return;
  _orgPendingColor = { code, color };
  const group = btn?.closest('.org-colors');
  group?.querySelectorAll('.page-color').forEach(b => { const on = b.dataset.color === color; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
  const preview = document.getElementById('oa-preview');
  if (preview) preview.setAttribute('style', spaceVars(color));
}
function orgDetailsColor(o) { return _orgPendingColor?.code === o.code ? _orgPendingColor.color : orgColor(o); }
function orgAdminTab(o) {
  if (!isOrgOfficer(o)) return `<div class="card card-pad"><p class="small muted">Officers run ${esc(o.name)}. Ask the founder for officer access if you should have it.</p></div>`;
  const people = orgPeople(o);
  const officers = people.filter(p => p.officer);
  const noEvents = !upcomingOrgEvents(o).length;
  const plan = typeof orgGroupPlan === 'function' ? orgGroupPlan(o) : null;
  // No plan yet (or a sample): the pitch goes right under the numbers, in
  // this club's own seat math. A club with a plan keeps it in the rail.
  const pitch = typeof orgPlanAdminCard === 'function' && (o.sample || !plan);
  const color = orgDetailsColor(o);
  const faces = orgFaceColors(o);
  return `
    <div class="org-admin">
      <div class="org-admin-head">
        <h2 class="org-admin-title">Officer home</h2>
        <p class="small muted">Only officers see this. Numbers cover current members.</p>
      </div>
      ${orgAdminStats(o)}
      ${pitch ? orgPlanAdminCard(o, plan) : ''}
      ${orgAdminNeedsCard(o)}
      <div class="org-admin-grid">
        <div class="card card-pad org-admin-wide" id="org-attendance">
          <div class="flex-between mb-8 wrap org-rsvp-head"><h3 class="sg-h3">${icon('check-square', 16)} RSVPs</h3>${orgEventList(o).length ? `<button class="btn btn-sm" onclick="downloadOrgRosterCsv('${o.code}')">${icon('download', 14)} Export CSV</button>` : ''}</div>
          <div class="segmented org-rsvp-range" role="group" aria-label="Which events">${ORG_RSVP_RANGES.map(([k, l]) => `<button type="button" aria-pressed="${_orgRsvpRange === k}" class="${_orgRsvpRange === k ? 'active' : ''}" onclick="orgSetRsvpRange('${k}')">${l}</button>`).join('')}</div>
          <p class="small muted org-rsvp-help">Who answered Going or Can’t, plus the next two events. Tap an event to see the full list or post a nudge.</p>
          ${orgAttendanceHtml_officer(o)}
        </div>

        <div class="org-admin-col">
          <div class="card card-pad">
            <h3 class="sg-h3 mb-8">${icon('user-plus', 16)} Getting people in</h3>
            <p class="small muted mb-8">One link, one code. Members who join see every event on their own calendar.${o.sample ? ' This is a sample, so these links are just for show.' : ''}</p>
            <div class="field"><label for="oa-invite">Invite link</label>
              <div class="sg-invite-row"><input class="input" id="oa-invite" value="${esc(orgInviteLink(o.code))}" readonly onclick="this.select()"><button class="btn btn-primary" onclick="copyText(orgInviteMessage('${o.code}'),'Invite copied')">${icon('copy', 14)} Copy</button></div>
            </div>
            <div class="field"><label for="oa-direct">Direct link to this page</label>
              <div class="sg-invite-row"><input class="input" id="oa-direct" value="${esc(orgAdminLink(o.code))}" readonly onclick="this.select()"><button class="btn" onclick="copyText(orgAdminLink('${o.code}'),'Link copied')">${icon('copy', 14)} Copy</button></div>
              <div class="small muted mt-8">Bookmark it, or send it to a co-officer. It opens ${esc(o.name)} straight to Officer home (officers only).</div>
            </div>
            <div class="divider"></div>
            <div class="small sg-strong mb-8">Post to everyone</div>
            <div class="flex-gap wrap">
              <button class="btn btn-sm" onclick="openOrgInviteModal('${o.code}')">${icon('user-plus', 14)} Invite</button>
              <button class="btn btn-sm" onclick="openOrgEventModal('${o.code}')">${icon('calendar', 14)} Add an event</button>
              <button class="btn btn-sm" onclick="openAnnouncementModal('${o.code}')">${icon('megaphone', 14)} Post an announcement</button>
              <button class="btn btn-sm" onclick="openOrgFileModal('${o.code}')">${icon('upload', 14)} Share a file</button>
            </div>
            ${noEvents ? `<p class="small muted mt-8">Nothing on the calendar yet. The first meeting or practice you add shows up for every member.</p>` : ''}
          </div>
        </div>

        <div class="org-admin-col">
          ${pitch ? '' : orgPlanAdminCard(o, plan)}
          ${typeof wrappedOrgAdminCard === 'function' ? wrappedOrgAdminCard(o) : ''}

          <div class="card card-pad">
            <div class="flex-between mb-8"><h3 class="sg-h3">${icon('users', 16)} Who’s who</h3><button class="sg-link" onclick="setState({orgTab:'members'})">All ${people.length} ${icon('chevron-right', 12)}</button></div>
            <div class="small muted mb-8">${people.length} member${people.length === 1 ? '' : 's'} · ${officers.length} officer${officers.length === 1 ? '' : 's'}${isOrgOwner(o) ? '' : ' · Only the founder can add officers.'}</div>
            ${officers.map(p => `<div class="sg-person org-whos-row">
              ${personAvatar(p.uid, p.name, 28, faces[p.uid] || orgColor(o))}
              <div class="row-title small"><span class="sg-strong">${esc(p.name)}</span>${p.uid === myOrgUid(o) && p.name !== 'You' ? ' <span class="muted">(you)</span>' : ''}<div class="muted">${esc(orgRoleLabel(o, p))}</div></div>
              ${o.local && !o.sample ? '' : `<button class="btn btn-ghost btn-sm" onclick="openMemberRoleModal('${o.code}','${esc(p.uid)}')">Manage</button>`}
            </div>`).join('')}
          </div>

          <div class="card card-pad">
            <h3 class="sg-h3 mb-8">${icon('settings', 16)} ${esc(o.name)} details</h3>
            <div class="org-details-preview space" id="oa-preview" style="${spaceVars(color)}" aria-hidden="true">
              <div class="space-cover org-details-cover" data-pattern="${spacePattern(o.code)}">${spaceCrest({ text: orgMonogram(o) }, 'md')}<span class="org-details-name">${esc(o.name)}</span></div>
            </div>
            <div class="field"><label for="oa-name">Name</label><input class="input" id="oa-name" maxlength="80" value="${esc(o.name)}"></div>
            <div class="field-row">
              <div class="field"><label for="oa-kind">Kind</label><select class="select" id="oa-kind">${ORG_KINDS.map(([k, l]) => `<option value="${k}" ${o.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
              <div class="field"><label for="oa-school">School</label><input class="input" id="oa-school" maxlength="80" value="${esc(o.school || '')}"></div>
            </div>
            <div class="field"><label for="oa-desc">Description</label><input class="input" id="oa-desc" maxlength="200" value="${esc(o.description || '')}"></div>
            <div class="field"><label>Links <span class="muted">(GroupMe, Instagram, where dues go)</span></label>${orgLinksHtml(o, { editable: true })}</div>
            <div class="field"><label>Color</label><div class="org-colors" role="group" aria-label="Color">${ORG_COLORS.map((c, i) => `<button type="button" class="page-color ${color === c ? 'active' : ''}" data-color="${c}" style="background:${c}" aria-label="Color ${i + 1}" aria-pressed="${color === c}" onclick="orgPickDetailsColor('${o.code}','${c}',this)"></button>`).join('')}</div></div>
            <button class="btn btn-primary btn-sm" id="oa-save" onclick="saveOrgAdminDetails('${o.code}')">Save details</button>
          </div>

          <div class="card card-pad">
            <h3 class="sg-h3 mb-8">${icon('log-out', 16)} Leaving and closing</h3>
            <p class="small muted mb-8">${o.local ? 'Removing it clears it from this tab.' : isOrgOwner(o) ? 'As founder, you pick who takes over when you leave.' : 'Leaving takes this club’s events off your calendar. Other members keep theirs.'}</p>
            <div class="sg-danger">
              <button class="btn btn-sm" onclick="confirmLeaveOrg('${o.code}')">${icon('log-out', 14)} ${o.sample ? 'Remove sample' : 'Leave ' + esc(o.name)}</button>
              ${isOrgOwner(o) && !o.local ? `<button class="btn btn-danger btn-sm" onclick="confirmDeleteOrg('${o.code}')">${icon('trash', 14)} Delete for everyone</button>` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>`;
}
// A link straight to a club's Admin page, for bookmarking or handing to a
// co-officer. Non-officers who open it land on the club's Overview instead.
function orgAdminLink(code) { return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}?org=${code}&tab=admin`; }
// Everything in Club details in one write, the color included, so a
// re-render can't drop a field that wasn't saved yet.
async function saveOrgAdminDetails(code) {
  const name = $('#oa-name').value.trim();
  if (!name) { toast('It needs a name', 'error'); return; }
  const o = findOrg(code);
  const school = $('#oa-school').value.trim().slice(0, 80);
  const ops = { name: name.slice(0, 80), kind: $('#oa-kind').value, school, schoolKey: normKey(school), description: $('#oa-desc').value.trim().slice(0, 200) };
  const color = o ? orgDetailsColor(o) : '';
  if (o && color !== orgColor(o)) ops.color = color;
  const entry = orgEntry(code);
  if (entry?.cloud) entry.name = ops.name;
  if (await orgWrite(code, ops)) { if (_orgPendingColor?.code === code) _orgPendingColor = null; toast('Saved'); }
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
    <div class="modal-head"><h3>Your title in ${esc(o.name)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
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

/* ── Members and roles ─────────────────────────────────────────── */
function openMemberRoleModal(code, memberUid) {
  const o = findOrg(code);
  const p = o && orgPeople(o).find(x => x.uid === memberUid);
  if (!p || !isOrgOfficer(o)) return;
  const me = myOrgUid(o);
  openModal(`
    <div class="modal-head"><h3>${esc(p.name)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body">
      <div class="field"><label for="mr-title">Title <span class="muted">(shown next to their name)</span></label><input class="input" id="mr-title" maxlength="${ORG_TITLE_MAX}" value="${esc(p.title)}" placeholder="President, Captain, Treasurer…"><div class="small muted mt-4">Leave it blank to list them as ${esc(orgGeneralLabel(o).toLowerCase())}.</div></div>
      ${isOrgOwner(o) && !p.owner ? `<label class="checkbox-row small"><input type="checkbox" id="mr-officer" ${p.officer ? 'checked' : ''}><span>Officer: can add events, post announcements, share files, and manage members</span></label>` : `<p class="small muted">${p.owner ? 'Founder of this club.' : p.officer ? 'Officer.' : esc(orgGeneralLabel(o)) + '.'} ${isOrgOwner(o) ? '' : p.officer && p.uid !== me ? 'Only the founder can change or remove an officer.' : 'Only the founder can make someone an officer.'}</p>`}
    </div>
    <div class="modal-foot">
      ${!p.owner && p.uid !== me && (!p.officer || isOrgOwner(o)) ? `<button class="btn btn-danger" style="margin-right:auto" onclick="removeOrgMember('${code}','${esc(p.uid)}')">Remove</button>` : ''}
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
  closeModal();
  spaceRemoveDialog({ name, spaceName: o.name, canBlock: !o.local, onRemove: async (block) => {   // js/spaces/preview.js
    const ok = await orgWrite(code, { memberUids: gwRemove(memberUid), officerUids: gwRemove(memberUid), [`people.${memberUid}`]: GW_DELETE, [`rsvp.${memberUid}`]: GW_DELETE, [`titles.${memberUid}`]: GW_DELETE, ...(block ? spaceBlockOp(memberUid, name) : {}) });
    // New links for the club's files, so ones the removed member saved stop working (the Worker, js/orgs/files.js).
    if (ok && !o.local && typeof orgRotateFileLinks === 'function') orgRotateFileLinks(code);
  } });
}

/* ── Settings, leave, delete ────────────────────────────── */
function openOrgSettingsModal(code) {
  const o = findOrg(code);
  if (!o) return;
  const officer = isOrgOfficer(o);
  openModal(`
    <div class="modal-head"><h3>${esc(o.name)} settings</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body">
      ${officer ? `
        <div class="field"><label for="os-name">Name</label><input class="input" id="os-name" maxlength="80" value="${esc(o.name)}"></div>
        <div class="field-row">
          <div class="field"><label for="os-kind">Kind</label><select class="select" id="os-kind">${ORG_KINDS.map(([k, l]) => `<option value="${k}" ${o.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label for="os-school">School</label><input class="input" id="os-school" maxlength="80" value="${esc(o.school || '')}"></div>
        </div>
        <div class="field"><label for="os-desc">Description</label><input class="input" id="os-desc" maxlength="200" value="${esc(o.description || '')}"></div>
        <div class="field"><label>Color</label><div class="org-colors" role="group" aria-label="Color">${ORG_COLORS.map((c, i) => `<button type="button" class="page-color ${orgDetailsColor(o) === c ? 'active' : ''}" style="background:${c}" aria-label="Color ${i + 1}" aria-pressed="${orgDetailsColor(o) === c}" data-color="${c}" onclick="orgPickDetailsColor('${code}','${c}',this)"></button>`).join('')}</div></div>
      ` : `<p class="small muted mb-8">Officers manage the details. You can leave any time.</p>`}
      <div class="flex-between small mb-8"><span>Your title: <span class="sg-strong">${esc(orgTitleOf(o, myOrgUid(o)) || (isOrgOwner(o) ? 'Founder' : isOrgOfficer(o) ? 'Officer' : orgGeneralLabel(o)))}</span></span><button class="sg-link" onclick="openMyOrgTitleModal('${code}')">Change</button></div>
      <label class="checkbox-row small"><input type="checkbox" ${o.hideCalendar ? '' : 'checked'} onchange="setOrgOnCalendar('${code}',this.checked)"><span>Show events on my calendar</span></label>
      ${spaceBlockedHtml('club', o, officer && !o.local)}
      <div class="divider"></div>
      <div class="sg-danger">
        <button class="btn btn-sm" onclick="confirmLeaveOrg('${code}')">${icon('log-out', 14)} ${o.sample ? 'Remove sample' : 'Leave'}</button>
        ${isOrgOwner(o) && !o.local ? `<button class="btn btn-danger btn-sm" onclick="confirmDeleteOrg('${code}')">${icon('trash', 14)} Delete for everyone</button>` : ''}
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
  const o = findOrg(code);
  if (o && orgDetailsColor(o) !== orgColor(o)) ops.color = orgDetailsColor(o);
  closeModal();
  const entry = orgEntry(code);
  if (entry?.cloud) entry.name = ops.name;
  if (await orgWrite(code, ops)) { if (_orgPendingColor?.code === code) _orgPendingColor = null; toast('Saved'); }
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
  if (isOrgOwner(o)) { openOrgHeirModal(code); return; }
  confirmDialog(`Leave “${o.name}”? Its events come off your calendar.`, () => leaveOrg(code), 'Leave');
}
// Who can take over from the founder: officers first, then everyone
// else, each oldest member first. The earliest-joined officer (or member,
// with no other officers) is preselected, the same person the account
// deletion on the server picks (worker/src/account.js).
function orgHeirCandidates(o) {
  const me = myOrgUid(o);
  const byJoined = (a, b) => (a.joinedAt || 0) - (b.joinedAt || 0) || a.name.localeCompare(b.name);
  const others = orgPeople(o).filter(p => p.uid !== me);
  return [...others.filter(p => p.officer).sort(byJoined), ...others.filter(p => !p.officer).sort(byJoined)];
}
function openOrgHeirModal(code) {
  const o = findOrg(code);
  if (!o || !isOrgOwner(o)) return;
  const list = orgHeirCandidates(o);
  if (!list.length) return;
  const faces = orgFaceColors(o);
  openModal(`
    <div class="modal-head"><h3>Who takes over ${esc(o.name)}?</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body">
      <p class="small muted mb-8">They become the founder: the one who adds officers. If they aren’t an officer yet, they become one. Then you leave.</p>
      <div class="org-heir-list" role="radiogroup" aria-label="New founder">${list.map((p, i) => `
        <label class="org-heir">
          <input type="radio" name="org-heir" value="${esc(p.uid)}" ${i === 0 ? 'checked' : ''}>
          ${personAvatar(p.uid, p.name, 28, faces[p.uid] || orgColor(o))}
          <span class="org-heir-text"><span class="sg-strong">${esc(p.name)}</span><span class="small muted">${esc(orgRoleLabel(o, p))}${p.joinedAt ? ` · joined ${esc(fmtDate(iso(new Date(p.joinedAt)), { month: 'short', year: 'numeric' }))}` : ''}</span></span>
        </label>`).join('')}
      </div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-danger" id="oh-leave" onclick="leaveOrg('${code}', document.querySelector('#modal input[name=org-heir]:checked')?.value)">Hand off and leave</button></div>
  `);
}
async function leaveOrg(code, heirUid) {
  const o = findOrg(code);
  const me = _fbUser?.uid;
  if (!o || !me) return;
  if (isOrgOwner(o)) {
    // Hand the club over first (a founder-only change), then leave as a
    // regular officer. If the second write fails, the handoff stands.
    const heir = orgHeirCandidates(o).find(p => p.uid === heirUid) || orgHeirCandidates(o)[0];
    if (!heir) return;
    setBtnLoading($('#oh-leave'), true);
    const handoff = { createdBy: heir.uid };
    if (!heir.officer) handoff.officerUids = gwUnion(heir.uid);
    if (!(await orgWrite(code, handoff, { denied: 'Only the founder can hand the club over.' }))) { setBtnLoading($('#oh-leave'), false, 'Hand off and leave'); return; }
    closeModal();
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
    } catch (e) { diag.warn('clubs', 'Could not clear club chat', e); }
    if (o) orgFileList(o).filter(f => f.kind === 'file').forEach(f => orgFileStorageRef(f).then(r => r?.delete()).catch(() => {}));
    await spacePreviewRemove('club', code);   // while still the founder, so the rules allow it
    await _fbDb.collection('orgs').doc(code).delete();
    dropOrgEntry(code, `Deleted “${o?.name || 'the club'}”.`);
  } catch (e) { diag.error('clubs', 'Delete club failed', e); reconcileOrgSubscriptions(); toast('Couldn’t delete it. Check your connection.', 'error'); }
}

