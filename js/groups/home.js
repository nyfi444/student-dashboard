/* ── Study Groups: the group home (Overview tab) ────────────────
   The next session or best time, the week, tasks, and the rail (exam,
   who's in, chat, activity). Moved out of js/studygroups.js as is;
   every name stays global. Loaded after js/groups/resources.js and
   before js/studygroups.js.
──────────────────────────────────────────────────────────────── */
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
  // The redraw replaced the strip: give focus back to the day you picked.
  const i = daysBetween(dateIso);
  requestAnimationFrame(() => $$('#content .space-weekstrip .space-week-daybtn')[i]?.focus({ preventScroll: true }));
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
    ${spaceNeedsStrip('group', g, { needs: { ...needs, items: stripItems } })}
    <div class="sg-overview sg-home">
      <div class="sg-col">
        ${next ? nextSessionHero(g, next, { need: needIds.has(next.id) }) : bestReady ? groupBestHero(g, best) : groupHomeEmptyHero(g)}
        ${groupRecapPrompt(g)}
        ${next && bestReady ? groupHomeBest(g, best) : ''}
        ${rest.length ? groupHomeComing(g, upcoming, rest, day, needIds, u) : ''}
        ${groupHomeTasks(g, u, stripTaskIds, needs.items, { contrib: !rest.length })}
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
// The same words Find a time's answer card uses (availWhenText, availWho),
// so the home and the tab never answer the question two ways.
function groupBestLine(g, w) {
  const added = availContributors(g).length;
  return {
    when: availWhenText(w),
    who: availWho(w, added, Math.max(groupPeople(g).length, added)).text,
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
    spaceWhenChip(s),
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
// The club's order: the week strip, then one card with Coming up as its
// own header, the rows, and who has finished which tasks as its footer.
function groupHomeComing(g, upcoming, rest, day, needIds, u) {
  const t = todayIso(), end = addDays(t, 6);
  const counts = {};
  upcoming.forEach(s => { if (s.date <= end) counts[s.date] = (counts[s.date] || 0) + 1; });
  const hasWeek = Object.keys(counts).length > 0;
  const list = day ? rest.filter(s => s.date === day) : rest.slice(0, GROUP_HOME_AGENDA_MAX);
  const dayName = day ? fmtDate(day, { weekday: 'long' }) : '';
  const empty = day
    ? `<p class="sg-home-empty">${upcoming[0]?.date === day ? `Just the next session on ${esc(dayName)}. It’s up top.` : `Nothing on ${esc(dayName)}.`}</p>`
    : '';
  const more = !day && rest.length > GROUP_HOME_AGENDA_MAX ? rest.length - GROUP_HOME_AGENDA_MAX : 0;
  const link = day
    ? `<button class="sg-link" onclick="pickGroupAgendaDay('${g.code}','${day}')">Show all ${icon('chevron-right', 12)}</button>`
    : `<button class="sg-link" onclick="setGroupTab('schedule')">${more ? `All ${upcoming.length} sessions` : 'All sessions'} ${icon('chevron-right', 12)}</button>`;
  return `
    <section class="sg-home-coming" aria-label="Coming up">
      ${hasWeek ? spaceWeekStrip({ start: t, selected: day, counts, label: 'Pick a day to see its sessions', onPick: (d) => `pickGroupAgendaDay('${g.code}','${d}')` }) : ''}
      <div class="card sg-home-agenda">
        <div class="sg-home-head"><h3 class="sg-h3">${day ? esc(dayName) : 'Coming up'}</h3>${link}</div>
        <div class="sg-home-agenda-rows">${list.length ? list.map(s => groupAgendaRow(g, s, needIds.has(s.id))).join('') : empty}</div>
        ${groupHomeContrib(g, u, taskList(g))}
      </div>
    </section>`;
}
// Your open tasks, minus the ones the needs strip already asks about, and
// who has finished what so far.
// The card only shows when it has something the strip doesn't: when every
// task of yours (or everything up for grabs) is already up top, it stays
// out. The done-so-far line sits in the Coming up card when there is one.
function groupHomeTasks(g, u, stripTaskIds, needItems, { contrib = true } = {}) {
  const all = taskList(g);
  const open = all.filter(t => !t.done);
  const mine = open.filter(t => t.assignee === u);
  const rows = mine.filter(t => !stripTaskIds.has(t.id)).sort(byDueThenCreated).slice(0, 4);
  const upTop = needItems.some(it => it.type === 'task' || it.type === 'claim');
  if (!rows.length && all.length && (mine.length || upTop)) {
    const done = contrib ? groupHomeContrib(g, u, all) : '';
    return done ? `<div class="card card-pad sg-home-tasks is-contrib-only">${done}</div>` : '';
  }
  const emptyLine = !all.length ? `No tasks yet. <button class="sg-link" onclick="setGroupTab('tasks')">Add one</button>` : 'Nothing assigned to you.';
  return `
    <div class="card card-pad sg-home-tasks">
      <div class="sg-home-head"><h3 class="sg-h3">Your tasks</h3><button class="sg-link" onclick="setGroupTab('tasks')">${open.length} open in group ${icon('chevron-right', 12)}</button></div>
      ${rows.length ? rows.map(t => groupTaskRow(g, t, { compact: true })).join('') : `<p class="sg-home-empty">${emptyLine}</p>`}
      ${contrib ? groupHomeContrib(g, u, all) : ''}
    </div>`;
}
function groupHomeContrib(g, u, all) {
  const done = all.filter(t => t.done);
  if (!done.length) return '';
  // Credit and order come from js/groups/tasks.js: the owner first, current
  // members only, in member order, so the line never reads as a ranking.
  const people = groupTaskCredits(g);
  const shownPeople = people.slice(0, 4);
  const extra = people.length - shownPeople.length;
  const first = (p) => p.uid === u ? 'You' : String(p.name).split(' ')[0];
  const label = `${done.length} of ${all.length} tasks done: ${shownPeople.map(p => `${first(p)} ${p.n}`).join(', ')}${extra ? `, ${extra} more` : ''}. Open tasks`;
  // The whole line is the way into the Tasks tab.
  return `
    <button type="button" class="sg-home-contrib" onclick="setGroupTab('tasks')" aria-label="${esc(label)}">
      <span class="sg-home-contrib-lead">${done.length} of ${all.length} done</span>
      ${shownPeople.map(p => `<span class="sg-home-contrib-p" aria-hidden="true">${personAvatar(p.uid, p.name, 18, personColor(g, p.uid))}${esc(first(p))} ${p.n}</span>`).join('')}
      ${extra ? `<span aria-hidden="true">+${extra} more</span>` : ''}
      <span class="sg-home-contrib-go" aria-hidden="true">Tasks ${icon('chevron-right', 12)}</span>
    </button>`;
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
// Columns for the face grid: one row up to six, then the first of 4, 5, 3
// that doesn't leave a single face alone on the last row.
function groupWhoCols(n) {
  if (n <= 6) return Math.max(n, 4);
  return [4, 5, 3].find(c => n % c !== 1) || 4;
}
function groupHomeWho(g, u) {
  const all = groupPeople(g);
  const people = [...all.filter(p => p.uid === u), ...all.filter(p => p.uid !== u)];
  const known = new Set(people.map(p => p.name));
  const legacy = (g.members || []).filter(n => n && !known.has(n) && n !== myGroupName());
  return `
    <div class="card card-pad sg-home-who${legacy.length ? ' has-legacy' : ''}">
      <div class="sg-home-head"><h3 class="sg-h3">Who’s in <span class="sg-home-n">${people.length}</span></h3><button class="sg-link" onclick="openInviteModal('${g.code}')">${icon('user-plus', 12)} Invite</button></div>
      <div class="sg-home-faces" role="list" style="--who-cols:${groupWhoCols(people.length)}">
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
      ${msgs.length ? msgs.map(m => `<div class="sg-mini-msg">${personAvatar(m.uid, m.name, 22, personColor(g, m.uid))}<div class="small"><span class="sg-strong">${esc(m.uid === u ? 'You' : m.name)}</span> <span class="muted">${fmtRelativeTime(m.at)}</span><div class="sg-mini-text">${esc(chatPreviewText(m.text, 'group', g.code))}</div></div></div>`).join('') : `<p class="sg-home-empty">No messages yet.</p>`}
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
