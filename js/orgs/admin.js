/* ── Clubs & teams: running a club ───────────────────────────────
   Officer tools: quick links, attendance and the roster CSV, the Admin
   tab, titles, member roles, and the settings sheet (leave, delete).
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
/* ── Attendance: who said they'd come, across events ─────────────
   The per-event popup answers "who's coming Tuesday". This answers the
   question officers of a team or chapter actually ask at the end of the
   month: who keeps skipping the required ones. Rows are members, columns
   are the last few events plus what's next, and it exports as a CSV. */
function orgAttendanceEvents(o, { past = 6, upcoming = 2 } = {}) {
  // Dues and deadlines aren't attended, so they aren't columns here. The
  // roster CSV below still lists them, with any answers given before.
  const all = orgEventList(o).filter(e => !orgIsDuesEvent(e));
  return [...all.filter(orgEventPast).slice(-past), ...all.filter(e => !orgEventPast(e)).slice(0, upcoming)];
}
function orgAttendanceHtml_officer(o) {
  const events = orgAttendanceEvents(o);
  const people = orgPeople(o);
  if (!events.length) return `<p class="small muted">Once there are events, this shows who said they’d come to each one.</p>`;
  const answer = (p, e) => o.rsvp?.[p.uid]?.[e.id] || '';
  const cell = (v) => v === 'yes' ? `<span class="org-att-yes">${icon('check', 12)}<span class="sr-only">Going</span></span>` : v === 'no' ? `<span class="org-att-no">${icon('x', 12)}<span class="sr-only">Can’t</span></span>` : `<span class="org-att-none"><span aria-hidden="true">·</span><span class="sr-only">No answer</span></span>`;
  const score = (p) => events.filter(e => answer(p, e) === 'yes').length;
  const rows = [...people].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
  return `
    <div class="org-att"><table>
      <thead><tr><th class="org-att-name">Member</th>${events.map(e => `<th title="${esc(e.title)} · ${esc(fmtDate(e.date))}"><button class="org-att-ev" onclick="showOrgEventModal('${o.code}','${e.id}')"><span class="org-att-date">${esc(fmtDate(e.date, { month: 'short', day: 'numeric' }))}</span><span class="org-att-title">${esc(e.title)}</span>${e.required ? `<span class="org-required">Req</span>` : ''}</button></th>`).join('')}<th class="org-att-total">Going</th></tr></thead>
      <tbody>${rows.map(p => `<tr><td class="org-att-name"><span class="sg-strong">${esc(p.name)}</span>${p.title ? ` <span class="muted">· ${esc(p.title)}</span>` : ''}</td>${events.map(e => `<td class="org-att-cell ${orgEventPast(e) ? '' : 'is-upcoming'}">${cell(answer(p, e))}</td>`).join('')}<td class="org-att-total">${score(p)}<span class="muted">/${events.length}</span></td></tr>`).join('')}</tbody>
      <tfoot><tr><td class="org-att-name muted">Going</td>${events.map(e => { const c = orgRsvpCounts(o, e.id); return `<td class="org-att-cell muted" title="${c.yes} going, ${c.no} can’t, ${c.none} no answer">${c.yes}</td>`; }).join('')}<td></td></tr></tfoot>
    </table></div>`;
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

/* ── Admin: one page for running a club or team ───────────────────
   Officers had to hunt: the join link lived in a popup, roles in the
   members list, club details behind a gear, and paying for everyone's
   Semester HQ in a sentence inside the invite modal. This gathers all
   of it, including a direct link an officer can bookmark or hand to a
   co-officer, and it's only ever shown to officers. */
function orgAdminTab(o) {
  if (!isOrgOfficer(o)) return `<div class="card card-pad"><p class="small muted">Officers run ${esc(o.name)}. Ask the founder for officer access if you should have it.</p></div>`;
  const people = orgPeople(o);
  const officers = people.filter(p => p.officer);
  const requests = isOrgOwner(o) ? people.filter(p => p.title && !p.officer && !p.reviewed) : [];
  const noEvents = !upcomingOrgEvents(o).length;
  const plan = typeof orgGroupPlan === 'function' ? orgGroupPlan(o) : null;
  return `
    <div class="org-admin">
      ${requests.length ? `<div class="sg-callout org-request mb-8"><span>${icon('shield', 14)}</span>
        <div class="small" style="flex:1">${requests.length} ${requests.length === 1 ? 'person' : 'people'} joined with a position and ${requests.length === 1 ? 'is' : 'are'} waiting on officer access.</div>
        <button class="btn btn-sm" onclick="setState({orgTab:'members'})">Review</button></div>` : ''}

      <div class="card card-pad">
        <h3 class="sg-h3 mb-8">${icon('user-plus', 14)} Getting people in</h3>
        <p class="small muted mb-8">One link, one code. Members who join see every event on their own calendar.${o.sample ? ' This is a sample, so these links are just for show.' : ''}</p>
        <div class="field"><label for="oa-invite">Invite link</label>
          <div class="sg-invite-row"><input class="input" id="oa-invite" value="${esc(orgInviteLink(o.code))}" readonly onclick="this.select()"><button class="btn btn-primary" onclick="copyText(orgInviteMessage('${o.code}'),'Invite copied')">${icon('copy', 14)} Copy</button></div>
        </div>
        <div class="field" style="margin-bottom:0"><label for="oa-direct">Direct link to this page</label>
          <div class="sg-invite-row"><input class="input" id="oa-direct" value="${esc(orgAdminLink(o.code))}" readonly onclick="this.select()"><button class="btn" onclick="copyText(orgAdminLink('${o.code}'),'Link copied')">${icon('copy', 14)} Copy</button></div>
          <div class="small muted mt-8">Bookmark it, or send it to a co-officer. It opens ${esc(o.name)} straight to this Admin page (officers only).</div>
        </div>
      </div>

      <div class="card card-pad">
        <h3 class="sg-h3 mb-8">${icon('users', 14)} Who's who</h3>
        <div class="small muted mb-8">${people.length} member${people.length === 1 ? '' : 's'} · ${officers.length} officer${officers.length === 1 ? '' : 's'}</div>
        ${officers.map(p => `<div class="sg-person">
          ${personAvatar(p.uid, p.name, 26, orgColor(o))}
          <div class="row-title small"><span class="sg-strong">${esc(p.name)}</span>${p.uid === myOrgUid(o) && p.name !== 'You' ? ' <span class="muted">(you)</span>' : ''} <span class="muted">· ${esc(orgRoleLabel(o, p))}</span></div>
          ${o.local && !o.sample ? '' : `<button class="btn btn-ghost btn-sm" onclick="openMemberRoleModal('${o.code}','${esc(p.uid)}')">Manage</button>`}
        </div>`).join('')}
        <div class="flex-gap wrap mt-8">
          <button class="btn btn-sm" onclick="setState({orgTab:'members'})">All ${people.length} member${people.length === 1 ? '' : 's'}</button>
          ${isOrgOwner(o) ? '' : `<span class="small muted">Only the founder can add officers.</span>`}
        </div>
      </div>

      <div class="card card-pad">
        <h3 class="sg-h3 mb-8">${icon('megaphone', 14)} What officers can post</h3>
        <div class="flex-gap wrap">
          <button class="btn btn-sm" onclick="openOrgEventModal('${o.code}')">${icon('calendar', 14)} Add an event</button>
          <button class="btn btn-sm" onclick="openAnnouncementModal('${o.code}')">${icon('megaphone', 14)} Post an announcement</button>
          <button class="btn btn-sm" onclick="openOrgFileModal('${o.code}')">${icon('upload', 14)} Share a file</button>
        </div>
        ${noEvents ? `<p class="small muted mt-8">Nothing on the calendar yet. The first meeting or practice you add shows up for every member.</p>` : ''}
      </div>

      <div class="card card-pad" id="org-attendance">
        <div class="flex-between mb-8 wrap" style="gap:8px"><h3 class="sg-h3">${icon('check-square', 14)} Attendance</h3>${orgEventList(o).length ? `<button class="btn btn-sm" onclick="downloadOrgRosterCsv('${o.code}')">${icon('download', 14)} Export CSV</button>` : ''}</div>
        <p class="small muted mb-8">Who said they’d come, across the last few events and what’s next. Tap an event to see the full list or remind people to answer.</p>
        ${orgAttendanceHtml_officer(o)}
      </div>

      ${orgPlanAdminCard(o, plan)}

      <div class="card card-pad">
        <h3 class="sg-h3 mb-8">${icon('settings', 14)} ${esc(o.name)} details</h3>
        <div class="field"><label for="oa-name">Name</label><input class="input" id="oa-name" maxlength="80" value="${esc(o.name)}"></div>
        <div class="field-row">
          <div class="field"><label for="oa-kind">Kind</label><select class="select" id="oa-kind">${ORG_KINDS.map(([k, l]) => `<option value="${k}" ${o.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label for="oa-school">School</label><input class="input" id="oa-school" maxlength="80" value="${esc(o.school || '')}"></div>
        </div>
        <div class="field"><label for="oa-desc">Description</label><input class="input" id="oa-desc" maxlength="200" value="${esc(o.description || '')}"></div>
        <div class="field"><label>Links <span class="muted">(GroupMe, Instagram, where dues go)</span></label>${orgLinksHtml(o, { editable: true })}</div>
        <div class="field"><label>Color</label><div class="org-colors" role="group" aria-label="Color">${ORG_COLORS.map((c, i) => `<button type="button" class="page-color ${orgColor(o) === c ? 'active' : ''}" style="background:${c}" aria-label="Color ${i + 1}" aria-pressed="${orgColor(o) === c}" onclick="orgWrite('${o.code}',{color:'${c}'})"></button>`).join('')}</div></div>
        <button class="btn btn-primary btn-sm" onclick="saveOrgAdminDetails('${o.code}')">Save details</button>
      </div>

      <div class="card card-pad">
        <h3 class="sg-h3 mb-8">${icon('log-out', 14)} Leaving and closing</h3>
        <p class="small muted mb-8">${isOrgOwner(o) ? 'As founder, make someone else an officer before you leave so the club still has someone running it.' : 'Leaving takes this club’s events off your calendar. Other members keep theirs.'}</p>
        <div class="sg-danger">
          <button class="btn btn-sm" onclick="confirmLeaveOrg('${o.code}')">${icon('log-out', 14)} ${o.sample ? 'Remove sample' : 'Leave ' + esc(o.name)}</button>
          ${isOrgOwner(o) && !o.local ? `<button class="btn btn-danger btn-sm" onclick="confirmDeleteOrg('${o.code}')">${icon('trash', 14)} Delete for everyone</button>` : ''}
        </div>
      </div>
    </div>`;
}
// A link straight to a club's Admin page, for bookmarking or handing to a
// co-officer. Non-officers who open it land on the club's Overview instead.
function orgAdminLink(code) { return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}?org=${code}&tab=admin`; }
async function saveOrgAdminDetails(code) {
  const name = $('#oa-name').value.trim();
  if (!name) { toast('It needs a name', 'error'); return; }
  const school = $('#oa-school').value.trim().slice(0, 80);
  const ops = { name: name.slice(0, 80), kind: $('#oa-kind').value, school, schoolKey: normKey(school), description: $('#oa-desc').value.trim().slice(0, 200) };
  const entry = orgEntry(code);
  if (entry?.cloud) entry.name = ops.name;
  if (await orgWrite(code, ops)) toast('Saved');
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
        <div class="field"><label>Color</label><div class="org-colors" role="group" aria-label="Color">${ORG_COLORS.map((c, i) => `<button type="button" class="page-color ${orgColor(o) === c ? 'active' : ''}" style="background:${c}" aria-label="Color ${i + 1}" aria-pressed="${orgColor(o) === c}" onclick="orgWrite('${code}',{color:'${c}'}).then(()=>openOrgSettingsModal('${code}'))"></button>`).join('')}</div></div>
      ` : `<p class="small muted mb-8">Officers manage the details. You can leave any time.</p>`}
      <div class="flex-between small mb-8"><span>Your title: <span class="sg-strong">${esc(orgTitleOf(o, myOrgUid(o)) || (isOrgOwner(o) ? 'Founder' : isOrgOfficer(o) ? 'Officer' : orgGeneralLabel(o)))}</span></span><button class="sg-link" onclick="openMyOrgTitleModal('${code}')">Change</button></div>
      <label class="checkbox-row small"><input type="checkbox" ${o.hideCalendar ? '' : 'checked'} onchange="setOrgOnCalendar('${code}',this.checked)"><span>Show events on my calendar</span></label>
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
    } catch (e) { diag.warn('clubs', 'Could not clear club chat', e); }
    if (o) orgFileList(o).filter(f => f.kind === 'file' && String(f.url || '').includes('firebasestorage')).forEach(f => fbStorage().then(s => s.refFromURL(f.url).delete()).catch(() => {}));
    await _fbDb.collection('orgs').doc(code).delete();
    dropOrgEntry(code, `Deleted “${o?.name || 'the club'}”.`);
  } catch (e) { diag.error('clubs', 'Delete club failed', e); reconcileOrgSubscriptions(); toast('Couldn’t delete it. Check your connection.', 'error'); }
}

