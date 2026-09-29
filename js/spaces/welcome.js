/* js/spaces/welcome.js: Space welcome: the "Welcome to <space>" sheet after joining and the first-week checklists (member and officer), shared by groups and clubs.

   Public surface (every name starts with welcome*):
   welcomeExpect(kind, code)        confirmJoinOrg / confirmJoinGroup call this right before openOrg / openGroup.
                                    The sheet opens on the first snapshot that has the space's data with me in it.
   welcomeOnSnapshot(kind, code)    onOrgSnapshot / onGroupSnapshot call this after renderRemote(): opens the
                                    pending sheet, repaints an open one, and remembers a hello I sent.
   welcomeOpen(kind, code, {force}) The sheet itself. force shows it again (the "Show welcome" link, samples).
   welcomeChecklistCard(kind, space) The Overview card: the officer list for whoever made the space, the
                                    member list for everyone else. Ticks itself from the space's data.
   welcomeStep(kind, code, id)      A local tick (calendar, files) plus the step's action.
   welcomeDismiss(kind, code)       Hides the card for this space.

   kind is 'club' or 'group'. State lives only in state.settings.spaceOnboard["<kind>:<CODE>"]
   = { welcomed, chat, cal, read, dismissed }, saved with save() into the person's own planner doc
   (like orgChatSeen). Nothing here writes to a shared group or club document; the RSVP buttons
   are the existing setSpaceRsvp path. */

const WELCOME_WINDOW_MS = 14 * 86400000;   // the card lasts two weeks from joining (or from creating)
let _welcomePending = null;                // { kind, code } set by welcomeExpect until the sheet opens
let _welcomeOpenKey = '';                  // "<kind>:<code>" while the sheet is on screen

function welcomeKey(kind, code) { return `${kind}:${code}`; }
function welcomeAll() { return state.settings.spaceOnboard || (state.settings.spaceOnboard = {}); }
function welcomeState(kind, code) { const all = welcomeAll(); return all[welcomeKey(kind, code)] || (all[welcomeKey(kind, code)] = {}); }
function welcomePatch(kind, code, patch) { Object.assign(welcomeState(kind, code), patch); save(); }

function welcomeSpace(kind, code) {
  try { return kind === 'club' ? (typeof findOrg === 'function' ? findOrg(code) : null) : (typeof findGroup === 'function' ? findGroup(code) : null); } catch { return null; }
}
function welcomeMe(kind, sp) { return kind === 'club' ? myOrgUid(sp) : myUidFor(sp); }
function welcomeHasData(sp) { return !!sp && !sp.loading && Array.isArray(sp.memberUids); }
function welcomeIsMember(kind, sp) { return welcomeHasData(sp) && sp.memberUids.includes(welcomeMe(kind, sp)); }
// The officer list belongs to whoever made the space. On a sample, the
// Officer preview stands in for that person, so the toggle shows both lists.
function welcomeIsCreator(kind, sp) {
  if (sp.sample && kind === 'club') return isOrgOfficer(sp);
  return sp.createdBy === welcomeMe(kind, sp);
}
function welcomeJoinedAt(kind, sp) { return Number(sp.people?.[welcomeMe(kind, sp)]?.joinedAt) || 0; }
function welcomeColor(kind, sp) { return kind === 'club' ? orgColor(sp) : groupColor(sp); }
function welcomeCrest(kind, sp) { return kind === 'club' ? { text: orgMonogram(sp) } : groupCrest(sp); }
function welcomeNoun(kind, sp) { return kind === 'club' ? (sp.kind === 'team' ? 'team' : 'club') : 'group'; }
function welcomeNext(kind, sp) { return kind === 'club' ? upcomingOrgEvents(sp)[0] : upcomingSessions(sp)[0]; }
function welcomeMine(kind, sp, ev) { return kind === 'club' ? myOrgRsvp(sp, ev.id) : (sp.sessions?.[ev.id]?.rsvp?.[welcomeMe(kind, sp)] || ''); }
function welcomeSaidHi(kind, sp) { const m = sp.lastMessage; return !!m && m.uid === welcomeMe(kind, sp); }
function welcomeFilesTab(kind) { return kind === 'club' ? 'files' : 'resources'; }
function welcomeArgs(kind, code) { return `'${kind}','${esc(code)}'`; }

/* ── Steps ─────────────────────────────────────────────────────── */
// Each step: { id, label, done, icon, onclick }. Done comes from the space
// where the space knows (an RSVP, a message, an event), and from the local
// flag where only this device knows (a download, an opened tab).
function welcomeMemberSteps(kind, sp) {
  const code = sp.code, st = welcomeState(kind, code), next = welcomeNext(kind, sp);
  const ev = kind === 'club' ? 'event' : 'session';
  const steps = [];
  if (next) {
    steps.push({ id: 'rsvp', icon: 'check-square', label: `Answer the next ${ev}`, sub: next.title, done: !!welcomeMine(kind, sp, next),
      onclick: kind === 'club' ? `showOrgEventModal('${esc(code)}','${esc(next.id)}')` : `showGroupSessionModal('${esc(code)}','${esc(next.id)}')` });
    steps.push({ id: 'cal', icon: 'calendar', label: `Put it on your phone calendar`, sub: 'Downloads a calendar file you can open', done: !!st.cal,
      onclick: `welcomeStep(${welcomeArgs(kind, code)},'cal')` });
  }
  if (kind === 'group') {
    steps.push({ id: 'avail', icon: 'grid', label: 'Add when you’re free', sub: 'So the group can find a time that works', done: availHasAny(sp.avail?.[welcomeMe(kind, sp)]),
      onclick: `welcomeStep(${welcomeArgs(kind, code)},'avail')` });
  }
  steps.push({ id: 'chat', icon: 'message-circle', label: 'Say hi in chat', done: !!st.chat || welcomeSaidHi(kind, sp),
    onclick: `welcomeStep(${welcomeArgs(kind, code)},'chat')` });
  steps.push({ id: 'read', icon: 'folder', label: 'Open the files', sub: 'Notes, decks and links people have shared', done: !!st.read,
    onclick: `welcomeStep(${welcomeArgs(kind, code)},'read')` });
  return steps;
}
function welcomeOfficerSteps(kind, sp) {
  const code = sp.code;
  if (kind === 'club') {
    return [
      { id: 'event', icon: 'calendar', label: 'Post the first event', sub: 'It lands on every member’s calendar', done: orgEventList(sp).length > 0, onclick: `openOrgEventModal('${esc(code)}')` },
      { id: 'invite', icon: 'user-plus', label: 'Invite members', sub: 'A link, a code and a QR to share', done: sp.memberUids.length > 1, onclick: `welcomeInvite(${welcomeArgs(kind, code)})` },
      { id: 'links', icon: 'link', label: 'Add links', sub: 'Dues, GroupMe, the drive, your Instagram', done: orgLinkList(sp).length > 0, onclick: `openOrgLinksModal('${esc(code)}')` },
    ];
  }
  return [
    { id: 'event', icon: 'calendar', label: 'Schedule the first session', done: sessionList(sp).length > 0, onclick: `openSessionModal('${esc(code)}')` },
    { id: 'invite', icon: 'user-plus', label: 'Invite your classmates', sub: 'A link, a code and a QR to share', done: sp.memberUids.length > 1, onclick: `welcomeInvite(${welcomeArgs(kind, code)})` },
    { id: 'avail', icon: 'grid', label: 'Add when you’re free', sub: 'Find a time fills in from your class schedule', done: availHasAny(sp.avail?.[welcomeMe(kind, sp)]), onclick: `welcomeStep(${welcomeArgs(kind, code)},'avail')` },
  ];
}
function welcomeInvite(kind, code) {
  if (typeof openSpaceInvite === 'function') { openSpaceInvite(welcomeSpace(kind, code), kind); return; }
  if (kind === 'club') openOrgInviteModal(code); else openInviteModal(code);
}
// A local tick, then the step's action.
function welcomeStep(kind, code, id) {
  const sp = welcomeSpace(kind, code);
  if (!sp) return;
  if (id === 'cal') {
    const next = welcomeNext(kind, sp);
    if (!next) return;
    welcomePatch(kind, code, { cal: true });
    if (kind === 'club') downloadOrgIcs(code, next.id); else downloadSessionIcs(code, next.id);
    welcomeRepaint(); render();
    return;
  }
  if (id === 'read') { welcomePatch(kind, code, { read: true }); closeModal(); spaceGoToTab(kind, welcomeFilesTab(kind)); return; }
  if (id === 'chat') { closeModal(); spaceGoToTab(kind, 'chat'); return; }
  if (id === 'avail') {
    if (kind === 'group' && typeof scheduleBusyRanges === 'function' && scheduleBusyRanges().length) { fillAvailabilityFromSchedule(code); setTimeout(welcomeRepaint, 30); return; }
    closeModal(); spaceGoToTab('group', 'availability');
  }
}
function welcomeDismiss(kind, code) { welcomePatch(kind, code, { dismissed: true }); render(); }

/* ── The Overview card ─────────────────────────────────────────── */
function welcomeRing(done, total) {
  const r = 14, c = 2 * Math.PI * r, frac = total ? done / total : 0;
  return `<svg class="spw-ring${done === total ? ' is-done' : ''}" viewBox="0 0 36 36" width="36" height="36" role="img" aria-label="${done} of ${total} done">
    <circle cx="18" cy="18" r="${r}" class="spw-ring-track"/>
    <circle cx="18" cy="18" r="${r}" class="spw-ring-fill" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - frac)).toFixed(2)}"/>
    <text x="18" y="18" text-anchor="middle" dominant-baseline="central">${done === total && total ? '✓' : done}</text>
  </svg>`;
}
function welcomeStepRow(s, { inSheet = false } = {}) {
  return `<button type="button" class="spw-step${s.done ? ' is-done' : ''}" onclick="${s.onclick}">
    ${s.done ? '<span class="sr-only">Done. </span>' : ''}<span class="spw-check" aria-hidden="true">${s.done ? icon('check', 14, 2.4) : ''}</span>
    <span class="spw-step-text"><span class="spw-step-label">${esc(s.label)}</span>${s.sub && (inSheet || !s.done) ? `<span class="spw-step-sub">${esc(s.sub)}</span>` : ''}</span>
    ${s.done ? `<span class="spw-step-done">Done</span>` : icon('chevron-right', 14)}
  </button>`;
}
function welcomeChecklistCard(kind, sp) {
  if (!welcomeHasData(sp) || !welcomeIsMember(kind, sp)) return '';
  const code = sp.code, st = welcomeState(kind, code);
  if (st.dismissed) return '';
  const creator = welcomeIsCreator(kind, sp);
  const since = creator ? Number(sp.createdAt) || 0 : welcomeJoinedAt(kind, sp);
  if (!sp.sample && (!since || Date.now() - since > WELCOME_WINDOW_MS)) return '';
  const steps = creator ? welcomeOfficerSteps(kind, sp) : welcomeMemberSteps(kind, sp);
  if (!steps.length) return '';
  const done = steps.filter(s => s.done).length, all = done === steps.length;
  const noun = welcomeNoun(kind, sp);
  const title = creator ? `Get the ${noun} going` : 'Your first week';
  const sub = all ? (creator ? `That’s the ${noun} set up. Nice.` : `You’re all set here. Welcome in.`) : creator ? `${steps.length - done} to go` : `${done} of ${steps.length} done`;
  return `
    <div class="card card-pad spw-card${all ? ' is-complete' : ''}">
      <div class="spw-card-head">
        ${welcomeRing(done, steps.length)}
        <div class="spw-card-text"><h3 class="sg-h3">${title}</h3><span class="small muted">${sub}</span></div>
        <button type="button" class="btn btn-ghost btn-icon btn-sm spw-card-x" aria-label="Dismiss this checklist" data-tip="Dismiss" onclick="welcomeDismiss(${welcomeArgs(kind, code)})">${icon('x', 14)}</button>
      </div>
      <div class="spw-steps">${steps.map(s => welcomeStepRow(s)).join('')}</div>
      ${creator ? '' : `<button type="button" class="sg-link spw-again" onclick="welcomeOpen(${welcomeArgs(kind, code)},{force:true})">${icon('sparkles', 12)} Show the welcome again</button>`}
    </div>`;
}

/* ── The welcome sheet ─────────────────────────────────────────── */
function welcomeWho(kind, sp) {
  const me = welcomeMe(kind, sp);
  let people, colorOf, roleOf, title;
  if (kind === 'club') {
    const faces = orgFaceColors(sp);
    people = orgPeople(sp).filter(p => p.officer);
    colorOf = (p) => faces[p.uid] || orgColor(sp);
    roleOf = (p) => orgRoleLabel(sp, p);
    title = 'Who’s who';
  } else {
    people = groupPeople(sp).filter(p => p.uid !== me).slice(0, 6);
    colorOf = (p) => personColor(sp, p.uid);
    roleOf = (p) => p.role === 'owner' ? 'Started the group' : 'Member';
    title = 'Who’s here';
  }
  if (!people.length) return '';
  return `
    <section class="spw-sec">
      <h3 class="sg-h3">${title}</h3>
      <div class="spw-faces">${people.map(p => `
        <div class="spw-face">${personAvatar(p.uid, p.name, 48, colorOf(p))}<span class="spw-face-name">${esc(p.name)}${p.uid === me ? ' <span class="muted">(you)</span>' : ''}</span><span class="spw-face-role">${esc(roleOf(p))}</span></div>`).join('')}
      </div>
    </section>`;
}
function welcomeStartHere(kind, sp) {
  if (kind !== 'club') return '';
  const pinned = orgAnnouncementList(sp).filter(a => a.pinned).sort((a, b) => (b.at || 0) - (a.at || 0))[0];
  if (!pinned) return '';
  return `
    <section class="spw-sec">
      <h3 class="sg-h3">Start here</h3>
      <blockquote class="spw-quote">
        <p>${linkifyText(pinned.text)}</p>
        <footer class="small muted">${esc(pinned.name)} · ${fmtRelativeTime(pinned.at)}</footer>
      </blockquote>
    </section>`;
}
function welcomeNextUp(kind, sp) {
  const next = welcomeNext(kind, sp);
  if (!next) return '';
  const where = kind === 'club' ? next.location : next.where;
  return `
    <section class="spw-sec">
      <h3 class="sg-h3">Next up</h3>
      <div class="spw-next">
        ${spaceDateBlock(next.date, { size: 'tile' })}
        <div class="spw-next-text">
          <span class="spw-next-title">${esc(next.title)}</span>
          <span class="small muted">${esc(fmtSessionDay(next.date))}${next.start ? ` · ${esc(fmtTime(next.start))}` : ''}${where ? ` · ${esc(where)}` : ''}</span>
        </div>
        ${spaceRsvp({ kind, code: sp.code, id: next.id, title: next.title, mine: welcomeMine(kind, sp, next), size: 'row' })}
      </div>
    </section>`;
}
function welcomeAvailLead(kind, sp) {
  if (kind !== 'group') return '';
  const me = welcomeMe(kind, sp);
  if (availHasAny(sp.avail?.[me])) return '';
  const fromClasses = typeof scheduleBusyRanges === 'function' && scheduleBusyRanges().length > 0;
  return `
    <div class="spw-lead">
      <div class="spw-lead-text"><strong>Add your availability.</strong> ${fromClasses ? 'It takes 10 seconds from your class schedule.' : 'The group finds a time everyone can make.'}</div>
      ${fromClasses
        ? `<button type="button" class="btn btn-primary btn-sm" onclick="welcomeStep(${welcomeArgs(kind, sp.code)},'avail')">${icon('sparkles', 14)} Fill it in</button>`
        : `<button type="button" class="btn btn-sm" onclick="closeModal();spaceGoToTab('group','availability')">${icon('grid', 14)} Find a time</button>`}
    </div>`;
}
function welcomeSheetHtml(kind, sp) {
  const noun = welcomeNoun(kind, sp), steps = welcomeMemberSteps(kind, sp);
  const kindLabel = kind === 'club' ? (ORG_KINDS.find(k => k[0] === sp.kind) || ORG_KINDS[0])[1] : (sp.courseLabel ? `Study group for ${sp.courseLabel}` : 'Study group');
  const meta = [kindLabel, kind === 'club' ? sp.school : '', `${sp.memberUids.length} member${sp.memberUids.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  const links = kind === 'club' ? orgLinksHtml(sp) : '';
  const done = steps.filter(s => s.done).length;
  return `
    <div class="space space-${kind} spw-sheet" style="${spaceVars(welcomeColor(kind, sp))}">
      <div class="spw-cover space-cover" data-pattern="${spacePattern(sp.code)}">
        <button type="button" class="close-x spw-close" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button>
        ${spaceCrest(welcomeCrest(kind, sp), 'xl')}
      </div>
      <div class="spw-body">
        <div class="sg-eyebrow">You’re in</div>
        <h2 class="spw-title">Welcome to ${esc(sp.name)}</h2>
        <p class="spw-meta small muted">${esc(meta)}</p>
        ${sp.description ? `<p class="spw-desc">${esc(sp.description)}</p>` : ''}
        ${welcomeAvailLead(kind, sp)}
        ${welcomeWho(kind, sp)}
        ${welcomeStartHere(kind, sp)}
        ${welcomeNextUp(kind, sp)}
        ${links ? `<section class="spw-sec"><h3 class="sg-h3">Links</h3>${links}</section>` : ''}
        ${steps.length ? `
        <section class="spw-sec">
          <div class="spw-sec-head"><h3 class="sg-h3">Your first week</h3><span class="small muted">${done} of ${steps.length}</span></div>
          <div class="spw-steps">${steps.map(s => welcomeStepRow(s, { inSheet: true })).join('')}</div>
        </section>` : ''}
      </div>
      <div class="spw-foot"><button type="button" class="btn btn-primary spw-go" onclick="closeModal()">Go to the ${noun}</button></div>
    </div>`;
}
function welcomeOpen(kind, code, { force = false } = {}) {
  const sp = welcomeSpace(kind, code);
  if (!welcomeIsMember(kind, sp)) return false;
  const st = welcomeState(kind, code);
  if (st.welcomed && !force) return false;
  welcomePatch(kind, code, { welcomed: true });
  _welcomeOpenKey = welcomeKey(kind, code);
  openModal(welcomeSheetHtml(kind, sp), { wide: true, onClose: () => { _welcomeOpenKey = ''; } });
  const modal = document.getElementById('modal');
  if (modal) { modal.classList.add('is-welcome'); modal.scrollTop = 0; welcomeWire(modal); }
  return true;
}
// Redraw the open sheet in place (an RSVP, the availability fill, a snapshot).
function welcomeRepaint() {
  if (!_welcomeOpenKey) return;
  const [kind, code] = _welcomeOpenKey.split(':');
  const sp = welcomeSpace(kind, code);
  const modal = document.getElementById('modal');
  if (!welcomeIsMember(kind, sp) || !modal || !modal.querySelector('.spw-sheet')) { _welcomeOpenKey = ''; return; }
  const top = modal.scrollTop;
  const focusKey = modalFocusKey(document.activeElement);
  modal.innerHTML = welcomeSheetHtml(kind, sp);
  welcomeWire(modal);
  modal.scrollTop = top;
  if (focusKey?.onclick) { const back = [...modal.querySelectorAll('[onclick]')].find(el => el.getAttribute('onclick') === focusKey.onclick); if (back) try { back.focus({ preventScroll: true }); } catch {} }
}
// The RSVP buttons write through setSpaceRsvp, which redraws the page, not
// the sheet, and they stop their click from bubbling, so the sheet listens
// in the capture phase and repaints once the write has landed locally.
function welcomeAfterRsvp(e) {
  if (!e.target.closest('.space-rsvp-btn, .space-rsvp-clear')) return;
  setTimeout(welcomeRepaint, 60);
}
function welcomeWire(modal) {
  const next = modal?.querySelector('.spw-next');
  if (next) next.addEventListener('click', welcomeAfterRsvp, true);
}

/* ── Hooks from the join flow and the listeners ────────────────── */
function welcomeExpect(kind, code) { _welcomePending = { kind, code }; }
function welcomeOnSnapshot(kind, code) {
  const sp = welcomeSpace(kind, code);
  if (!welcomeIsMember(kind, sp)) return;
  // A hello I sent is remembered, so the tick stays after others post.
  if (welcomeSaidHi(kind, sp) && !welcomeState(kind, code).chat) welcomePatch(kind, code, { chat: true });
  if (_welcomeOpenKey === welcomeKey(kind, code)) welcomeRepaint();
  if (_welcomePending && _welcomePending.kind === kind && _welcomePending.code === code) {
    _welcomePending = null;
    if (!sp.local && sp.createdBy !== welcomeMe(kind, sp)) welcomeOpen(kind, code);
  }
}
