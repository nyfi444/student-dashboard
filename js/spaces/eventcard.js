/* ── Spaces: event pieces shared by study groups and clubs ─────────
   Render only: every function takes plain options and returns HTML
   (or, for eventTimeState and countdownLabel, plain data). Styles are
   the "Event pieces" section of css/spaces.css. Put the output inside a
   `.space` root (spaceShell, spaceCard, the event sheet) so --space and
   its mixes resolve; outside one they fall back to the theme accent.

   eventTimeState({ date, start, end }, now = new Date())
     -> { phase: 'before' | 'now' | 'after', days, startsInMin, endsInMin,
          endsAt, allDay, label }
     An event with no end counts as start + 60 minutes, capped at 23:59.
     An event with no start (a deadline) is 'now' all day on its date.
     label is countdownLabel() before, 'Happening now' now, 'Ended' after.
   countdownLabel({ date, start, end }, now = new Date())
     -> 'in 40 min' | 'in 3 hours' | 'tonight' (today, 5 PM or later) |
        'today' | 'tomorrow' | 'in 4 days' | 'Oct 12' | 'now' | ''
   spaceWhereHtml(where)
     A Zoom, Meet, Teams, Webex or Whereby link becomes a "Video call"
     chip; any other link shows its host; plain text is escaped.
   spaceDateBlock(date, { size = 'hero' | 'tile', today })
     hero: the 84px filled block (weekday, day, month). tile: the 44px
     .sg-date-tile, outlined in the space color when `today` is true
     (defaults to date === today).
   spaceTag(kind, label, iconName)
     kind: 'required' (ink outline) | 'weekly' (quiet fill) | 'cat'
     (glyph plus label) | 'need' ("Needs your answer", ink fill).
   spaceEventHero({ date, start, end, eyebrow, title, where, notes, tags,
                    onOpen, rsvpHtml, facesHtml, actionsHtml, extraHtml,
                    afterHtml, now, className })
     The big "next up" card in three states (see eventTimeState): before
     shows a countdown chip, now adds a "Happening now · until 8:00 PM"
     strip and a primary Join call for a link, after says it ended, drops
     the RSVP and shows afterHtml (the recap field or Post a recap). The
     card and its chip carry spaceLiveAttrs, so the minute tick keeps them
     current.
     eyebrow and title are plain text; tags, the *Html options and
     spaceWhereHtml(where) are trusted HTML. onOpen is onclick JS for the
     title (usually the event sheet).
   spaceAgendaRow({ date, title, metaHtml, tags, trailingHtml, onclick,
                    past, className, style })
     One 64px row: date tile, title and meta over a tag row, and whatever
     trails it (a compact RSVP, a Pay dues button). title is plain text and,
     with onclick, a real button described by the date, meta and tags.
     (label is no longer used: the visible words are the name.)
   spaceWeekStrip({ start, selected, counts, onPick, label })
     Seven day buttons from `start` (ISO date). counts: { iso: n } draws up
     to three dots; onPick(iso) returns onclick JS; selected is an ISO date.
   spaceStatTile({ value, label, sub, bar })
     A figure tile. value, label and sub are plain text; bar (0..1) adds
     the micro bar in the space color.
   spaceFacePile({ people, colorOf, meUid, size, max, verb, zeroText,
                   detail, onclick, label })
     Faces plus "You, Maya and 3 others are going". See spaceFaceCaption.
     verb 'said' is the after-the-event caption: "Maya and 2 others said
     they’d go", "You said you’d go".

   Before, during, after (Tier A item 7):
   spaceLiveAttrs(ev, { fmt }) -> ' data-ev-live="date|start|end"
       data-ev-phase="before|now|after"' for any element whose look
     depends on the event's phase. The minute tick re-renders the page
     when a phase in #content no longer matches, and rewrites the text of
     a `.space-live-text` inside it ("in 40 min" to "in 39 min") without a
     render. fmt 'short' uses spaceCountdown's words (index cards).
   spaceWhenChip(ev, { soonDays = 0, now }) -> '' or a chip for rows:
     "Happening now" (live dot) during, "In 40 min" / "In 3 hours" /
     "Tonight" / "Today" before when the event is within soonDays (0:
     today only, since row meta already says Tomorrow), nothing after.
   spaceLiveTick(now) -> true when it re-rendered. Runs once a minute (on
     the minute) and when the tab comes back into view. It only renders on
     the studygroups, orgs and dashboard routes, and never while a dialog
     is open, a field has focus, the availability grid is mid-drag or the
     page is hidden; it tries again on the next tick. Nothing is pushed,
     emailed or scheduled beyond this one timer.
   spaceRecapCard({ date, start, end, title, eyebrow, facesHtml, bodyHtml,
                    dismissJs })
     The quiet "just ended" card: eyebrow ("Last night · ended 6:00 PM"
     when not given), a 22px serif title, the face pile, then bodyHtml
     (a spaceRecapField, or a Post a recap button). dismissJs is the
     onclick for its Not now button. title is plain text.
   spaceRecapField(onclickJs, label = 'What did we cover?')
     A 3-line box that looks like a field and opens the real one in a
     dialog (so a snapshot redraw can never wipe a half-typed recap).
   spaceRecentlyEnded(ev, hours = 18, now) -> true when the event ended
     within the last `hours` hours.
   spaceRecapDismissed(key) / spaceRecapDismiss(key)
     "Not now" on a recap card, remembered on this device only
     (localStorage 'shq.recapSkip', pruned after 3 days).
   spaceRecapText(html) -> plain text of a member's recap note (sanitized
     first, never executed), for 2-line snippets.
──────────────────────────────────────────────────────────────── */

/* ── Time ──────────────────────────────────────────────────────── */
function _evMin(t) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? Math.min(1439, +m[1] * 60 + +m[2]) : null; }
function _evIso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function _evDays(dateIso, now) {
  const a = new Date(`${dateIso}T00:00:00`), b = new Date(`${_evIso(now)}T00:00:00`);
  return Math.round((a - b) / 86400000);
}
function eventTimeState(ev, now = new Date()) {
  const date = String(ev?.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { phase: 'after', days: -1, startsInMin: -1, endsInMin: -1, endsAt: '', allDay: true, label: '' };
  const days = _evDays(date, now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const s = _evMin(ev.start);
  const allDay = s == null;
  const start = allDay ? 0 : s;
  let end = allDay ? 1439 : _evMin(ev.end);
  if (end == null || end <= start) end = Math.min(1439, start + 60);
  const startsInMin = days * 1440 + start - nowMin;
  // An all-day item ends at the end of its day, so it's "now" through 23:59.
  const endsInMin = days * 1440 + (allDay ? 1440 : end) - nowMin;
  const phase = startsInMin > 0 ? 'before' : endsInMin > 0 ? 'now' : 'after';
  const endsAt = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
  const out = { phase, days, startsInMin, endsInMin, endsAt, allDay, label: '' };
  out.label = phase === 'now' ? 'Happening now' : phase === 'after' ? 'Ended' : countdownLabel(ev, now);
  return out;
}
function countdownLabel(ev, now = new Date()) {
  const date = String(ev?.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const days = _evDays(date, now);
  if (days < 0) return '';
  const s = _evMin(ev.start);
  if (days === 0) {
    if (s == null) return 'today';
    const mins = s - (now.getHours() * 60 + now.getMinutes());
    if (mins <= 0) {
      let e = _evMin(ev.end);
      if (e == null || e <= s) e = Math.min(1439, s + 60);
      return now.getHours() * 60 + now.getMinutes() < e ? 'now' : '';
    }
    if (mins < 60) return `in ${mins} min`;
    if (s >= 17 * 60) return 'tonight';
    const h = Math.round(mins / 60);
    return `in ${h} hour${h === 1 ? '' : 's'}`;
  }
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ${days} days`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(`${date}T00:00:00`));
}
function _evCap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }
function _evTimeRange(start, end) { return start ? `${fmtTime(start)}${end ? ` to ${fmtTime(end)}` : ''}` : ''; }

/* ── Places ────────────────────────────────────────────────────── */
const SPACE_VIDEO_HOSTS = /zoom\.us|meet\.google|teams\.microsoft|teams\.live|webex|whereby/i;
function spaceWhereHtml(where) {
  if (!where) return '';
  if (typeof isHttpUrl === 'function' && isHttpUrl(where) && SPACE_VIDEO_HOSTS.test(hostOf(where))) {
    return `<a class="space-video-chip" href="${esc(String(where).trim())}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${icon('video', 12)} Video call</a>`;
  }
  return linkifyWhere(where);
}

/* ── Dates ─────────────────────────────────────────────────────── */
function spaceDateBlock(date, { size = 'hero', today, id } = {}) {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const isToday = today ?? date === _evIso(new Date());
  if (size === 'tile') {
    // Read as "Tuesday, September 29" (", today"), not "Sep29".
    const long = `${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${isToday ? ', today' : ''}`;
    return `<div class="sg-date-tile space-date-tile${isToday ? ' is-today' : ''}"${id ? ` id="${esc(id)}"` : ''}><span aria-hidden="true">${d.toLocaleDateString('en-US', { month: 'short' })}</span><strong aria-hidden="true">${d.getDate()}</strong><span class="sr-only">${esc(long)}</span></div>`;
  }
  return `<div class="space-date-block${isToday ? ' is-today' : ''}" aria-hidden="true"><span class="eyebrow">${d.toLocaleDateString('en-US', { weekday: 'short' })}</span><strong>${d.getDate()}</strong><span class="eyebrow">${d.toLocaleDateString('en-US', { month: 'short' })}</span></div>`;
}

/* ── Tags ──────────────────────────────────────────────────────── */
function spaceTag(kind, label, iconName) {
  return `<span class="space-tag is-${esc(kind)}">${iconName ? icon(iconName, 12) : ''}${esc(label)}</span>`;
}

/* ── Event hero (before / now / after) ────────────────────────── */
function spaceEventHero(o) {
  const st = eventTimeState(o, o.now || new Date());
  const range = _evTimeRange(o.start, o.end);
  const whereHtml = spaceWhereHtml(o.where);
  const isLink = typeof isHttpUrl === 'function' && isHttpUrl(o.where);
  const chip = st.phase === 'before' && st.label ? `<span class="space-chip space-hero-chip"${spaceLiveAttrs(o)}><span class="space-live-text">${esc(_evCap(st.label))}</span></span>`
    : st.phase === 'after' ? '<span class="space-chip space-hero-chip is-ended">Ended</span>' : '';
  const strip = st.phase === 'now'
    ? `<div class="space-hero-now"><span class="space-now-dot" aria-hidden="true"></span>Happening now${st.allDay ? ' · all day' : ` · until ${esc(fmtTime(st.endsAt))}`}</div>` : '';
  const join = isLink ? (st.phase === 'now' ? joinLinkButton(o.where, 'btn-primary space-join-now') : st.phase === 'before' ? joinLinkButton(o.where) : '') : '';
  return `
    <div class="card space-hero is-${st.phase}${o.className ? ' ' + o.className : ''}"${spaceLiveAttrs(o)}>
      ${strip}
      <div class="space-hero-grid">
        ${spaceDateBlock(o.date)}
        <div class="space-hero-head">
          <div class="space-hero-top">
            <div class="space-hero-eyebrow"><span class="eyebrow">${esc(o.eyebrow || '')}</span>${o.tags ? `<span class="space-hero-eyetags">${o.tags}</span>` : ''}</div>
            ${chip}
          </div>
          ${o.onOpen ? `<button class="space-hero-title" onclick="${o.onOpen}">${esc(o.title)}</button>` : `<div class="space-hero-title">${esc(o.title)}</div>`}
          ${o.tags ? `<div class="space-hero-tags">${o.tags}</div>` : ''}
          <div class="space-hero-meta">
            <span>${icon('calendar', 13)} ${esc(fmtDate(o.date, { weekday: 'long', month: 'short', day: 'numeric' }))}</span>
            ${range ? `<span>${icon('clock', 13)} ${esc(range)}</span>` : ''}
            ${o.where ? `<span>${icon('map-pin', 13)} ${whereHtml}</span>` : ''}
          </div>
        </div>
        <div class="space-hero-rest">
          ${o.notes ? `<div class="space-hero-notes">${linkifyText(o.notes)}</div>` : ''}
          ${o.extraHtml || ''}
          ${st.phase === 'after' && o.afterHtml ? `<div class="space-hero-after">${o.afterHtml}</div>` : ''}
          <div class="space-hero-foot">
            ${st.phase === 'after' ? '' : o.rsvpHtml || ''}
            ${join}
            ${o.actionsHtml ? `<span class="space-hero-actions">${o.actionsHtml}</span>` : ''}
          </div>
          ${o.facesHtml ? `<div class="space-hero-faces">${o.facesHtml}</div>` : ''}
        </div>
      </div>
    </div>`;
}

/* ── Agenda row ────────────────────────────────────────────────── */
// The title is the row's one button (it opens the sheet) and is described
// by the date, the meta line and the tags, so every visible word is read.
// The RSVP, face pile and Pay controls are its siblings, never inside it.
// A click anywhere else on the row still opens the sheet, for the mouse
// only (data-row-click, tabindex -1: not a second tab stop).
let _spaceRowSeq = 0;
function spaceAgendaRow(o) {
  const id = `space-row-${++_spaceRowSeq}`;
  const tags = o.tags ? `<div class="space-agenda-tags" id="${id}-t">${o.tags}</div>` : '';
  const describedBy = [`${id}-d`, o.metaHtml ? `${id}-m` : '', o.tags ? `${id}-t` : ''].filter(Boolean).join(' ');
  const click = o.onclick ? ` data-row-click tabindex="-1" onclick="${o.onclick}"` : '';
  const title = o.onclick
    ? `<button type="button" class="space-agenda-title" onclick="event.stopPropagation();${o.onclick}" aria-describedby="${describedBy}">${esc(o.title)}</button>`
    : `<div class="space-agenda-title">${esc(o.title)}</div>`;
  return `
    <div class="space-agenda-row${o.past ? ' is-past' : ''}${o.className ? ' ' + o.className : ''}"${o.style ? ` style="${o.style}"` : ''}${click}>
      ${spaceDateBlock(o.date, { size: 'tile', id: `${id}-d` })}
      <div class="space-agenda-main">
        ${title}
        ${o.metaHtml ? `<div class="space-agenda-meta" id="${id}-m">${o.metaHtml}</div>` : ''}
        ${tags}
      </div>
      ${o.trailingHtml ? `<div class="space-agenda-end" onclick="event.stopPropagation()">${o.trailingHtml}</div>` : ''}
    </div>`;
}

/* ── Week strip ────────────────────────────────────────────────── */
function spaceWeekStrip(o) {
  const today = _evIso(new Date());
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(`${o.start}T00:00:00`); d.setDate(d.getDate() + i); return _evIso(d); });
  return `
    <div class="card card-sm space-weekstrip" role="group" aria-label="${esc(o.label || 'Pick a day')}">
      ${days.map(iso => {
        const d = new Date(`${iso}T00:00:00`);
        const n = Math.min(3, (o.counts || {})[iso] || 0);
        const name = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        return `<button class="space-week-daybtn${iso === today ? ' is-today' : ''}" aria-pressed="${iso === o.selected}" aria-label="${esc(name)}${iso === today ? ', today' : ''}${n ? `, ${(o.counts || {})[iso]} event${(o.counts || {})[iso] === 1 ? '' : 's'}` : ''}" onclick="${o.onPick ? o.onPick(iso) : ''}">
          <span class="eyebrow">${d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
          <strong>${d.getDate()}</strong>
          <span class="space-week-dots">${'<i></i>'.repeat(n)}</span>
        </button>`;
      }).join('')}
    </div>`;
}

/* ── Stat tile ─────────────────────────────────────────────────── */
function spaceStatTile(o) {
  const bar = typeof o.bar === 'number' ? `<span class="space-stat-bar" aria-hidden="true"><i style="width:${Math.round(Math.max(0, Math.min(1, o.bar)) * 100)}%"></i></span>` : '';
  return `
    <div class="card card-sm space-stat">
      <strong class="space-stat-num">${esc(o.value)}</strong>
      <span class="space-stat-label">${esc(o.label)}</span>
      ${o.sub ? `<span class="space-stat-sub">${esc(o.sub)}</span>` : ''}
      ${bar}
    </div>`;
}

/* ── Face pile ─────────────────────────────────────────────────── */
// people: [{ uid, name }] of the people who gave this answer, current
// members only. "You" leads when meUid is among them.
function spaceFaceCaption(people, meUid, verb = 'going') {
  const me = people.some(p => p.uid === meUid);
  const names = [...(me ? ['You'] : []), ...people.filter(p => p.uid !== meUid).map(p => String(p.name || 'Someone').split(' ')[0])];
  if (!names.length) return '';
  // After the event: what people said, not who came (no one checks in).
  if (verb === 'said') {
    if (names.length === 1) return me ? 'You said you’d go' : `${names[0]} said they’d go`;
    if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} said they’d go`;
    const r = names.length - 2;
    return `${names[0]}, ${names[1]} and ${r} other${r === 1 ? '' : 's'} said they’d go`;
  }
  if (names.length === 1) return me ? `You’re ${verb}` : `${names[0]} is ${verb}`;
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are ${verb}`;
  const rest = names.length - 2;
  return `${names[0]}, ${names[1]} and ${rest} other${rest === 1 ? '' : 's'} are ${verb}`;
}
function spaceFacePile(o) {
  const people = o.people || [];
  const size = o.size || 26;
  const caption = people.length ? spaceFaceCaption(people, o.meUid, o.verb || 'going') : (o.zeroText || '');
  // "You" first in the stack too, so your face is the one you recognize.
  const ordered = [...people.filter(p => p.uid === o.meUid), ...people.filter(p => p.uid !== o.meUid)];
  const stack = ordered.length ? avatarStackHtml(ordered, o.max || 5, size, o.colorOf || (() => '#6b6b6b')) : '';
  const inner = `${stack}<span class="space-facepile-text${people.length ? '' : ' is-zero'}">${esc(caption)}${o.detail ? `<span class="space-facepile-detail"> · ${esc(o.detail)}</span>` : ''}</span>`;
  const cls = `space-facepile${size <= 22 ? ' is-small' : ''}`;
  // The name starts with the words you can see, then says what it opens.
  const name = [caption, o.detail ? ` · ${o.detail}` : ''].join('');
  const aria = o.label ? (name ? `${name}. ${o.label}` : o.label) : '';
  return o.onclick
    ? `<button type="button" class="${cls}" onclick="event.stopPropagation();${o.onclick}"${aria ? ` aria-label="${esc(aria)}"` : ''}>${inner}</button>`
    : `<span class="${cls}">${inner}</span>`;
}

/* ── Live: before, during, after ───────────────────────────────── */
function spaceLiveAttrs(ev, { fmt = '', now } = {}) {
  const st = eventTimeState(ev || {}, now || new Date());
  return ` data-ev-live="${esc([ev?.date || '', ev?.start || '', ev?.end || ''].join('|'))}" data-ev-phase="${st.phase}"${fmt ? ` data-ev-fmt="${esc(fmt)}"` : ''}`;
}
// A chip for rows: only when it says more than the date tile beside it.
function spaceWhenChip(ev, { soonDays = 0, now } = {}) {
  const st = eventTimeState(ev || {}, now || new Date());
  if (st.phase === 'now') return `<span class="space-chip is-now space-when-chip"${spaceLiveAttrs(ev, { now })}><span class="space-now-dot" aria-hidden="true"></span><span class="space-live-text">Happening now</span></span>`;
  if (st.phase !== 'before' || st.days > soonDays || !st.label) return '';
  return `<span class="space-chip space-when-chip"${spaceLiveAttrs(ev, { now })}><span class="space-live-text">${esc(_evCap(st.label))}</span></span>`;
}
function _spaceLiveText(el, date, start, end, now) {
  if (el.dataset.evFmt === 'short' && typeof spaceCountdown === 'function') return spaceCountdown(date, start, end);
  return _evCap(countdownLabel({ date, start, end }, now));
}
const SPACE_LIVE_ROUTES = ['studygroups', 'orgs', 'dashboard'];
let _spaceLiveTimer = 0, _spaceLiveDay = '', _spaceLiveSig = null;
// Today's group sessions and club events, phase by phase: catches a
// boundary on screens whose rows carry no data-ev-live (the dashboard).
function _spaceLiveSignature(now) {
  const t = _evIso(now);
  let list = [];
  try { if (typeof groupSessionsOnDate === 'function') list = list.concat(groupSessionsOnDate(t)); } catch {}
  try { if (typeof orgEventsOnDate === 'function') list = list.concat(orgEventsOnDate(t)); } catch {}
  return list.map(e => `${e.code}:${e.id}:${eventTimeState({ date: t, start: e.start, end: e.end }, now).phase}`).join(',');
}
function spaceLiveBusy() {
  if (document.hidden) return true;
  if (document.getElementById('modal-wrap')?.classList.contains('show')) return true;
  const a = document.activeElement;
  if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName || ''))) return true;
  return typeof _availPaint !== 'undefined' && !!_availPaint;
}
function spaceLiveTick(now = new Date()) {
  if (typeof document === 'undefined' || typeof state === 'undefined' || !document.querySelectorAll) return false;
  let stale = false;
  document.querySelectorAll('[data-ev-live]').forEach(el => {
    const [date, start, end] = String(el.dataset.evLive || '').split('|');
    const st = eventTimeState({ date, start, end }, now);
    if (st.phase !== el.dataset.evPhase) { if (el.closest('#content')) stale = true; return; }
    if (st.phase !== 'before') return;
    const txt = el.classList.contains('space-live-text') ? el : el.querySelector(':scope > .space-live-text');
    const next = txt && _spaceLiveText(el, date, start, end, now);
    if (txt && next && txt.textContent !== next) txt.textContent = next;
  });
  const day = _evIso(now);
  if (_spaceLiveDay && _spaceLiveDay !== day) stale = true;
  const sig = _spaceLiveSignature(now);
  if (_spaceLiveSig !== null && sig !== _spaceLiveSig) stale = true;
  if (_spaceLiveSig === null) _spaceLiveSig = sig;
  if (!stale || !SPACE_LIVE_ROUTES.includes(state.route) || spaceLiveBusy()) return false;
  _spaceLiveDay = day;
  _spaceLiveSig = sig;
  if (typeof renderPreservingInput === 'function') renderPreservingInput(); else render();
  return true;
}
function spaceLiveStart() {
  if (_spaceLiveTimer || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  _spaceLiveDay = _evIso(new Date());
  // On the minute, so "in 40 min" turns over when the clock does.
  const arm = () => { _spaceLiveTimer = setTimeout(() => { try { spaceLiveTick(); } catch (e) { if (typeof diag !== 'undefined') diag.warn?.('spaces', 'Live tick failed', e); } arm(); }, 60000 - (Date.now() % 60000) + 200); };
  arm();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) spaceLiveTick(); });
}
if (typeof window !== 'undefined' && window.document) spaceLiveStart();

/* ── After: the recap card ─────────────────────────────────────── */
function spaceRecentlyEnded(ev, hours = 18, now = new Date()) {
  const st = eventTimeState(ev || {}, now);
  return st.phase === 'after' && !st.allDay && -st.endsInMin <= hours * 60;
}
function _spaceRecapEyebrow(ev, now = new Date()) {
  const st = eventTimeState(ev, now);
  const ended = `ended ${fmtTime(st.endsAt)}`;
  if (st.days === 0) return -st.endsInMin <= 90 ? 'Just ended' : `Today · ${ended}`;
  if (st.days === -1) return `${_evMin(st.endsAt) >= 17 * 60 ? 'Last night' : 'Yesterday'} · ${ended}`;
  return `${fmtDate(ev.date, { weekday: 'short', month: 'short', day: 'numeric' })} · ${ended}`;
}
function spaceRecapField(onclickJs, label = 'What did we cover?') {
  return `<button type="button" class="space-recap-field" onclick="${onclickJs}"><span>${esc(label)}</span></button>`;
}
function spaceRecapCard(o) {
  return `
    <section class="card space-recap-card" aria-label="${esc(`Recap for ${o.title}`)}"${spaceLiveAttrs(o)}>
      <div class="space-recap-top">
        <span class="eyebrow">${esc(o.eyebrow || _spaceRecapEyebrow(o))}</span>
        ${o.dismissJs ? `<button type="button" class="btn btn-ghost btn-sm space-recap-skip" onclick="${o.dismissJs}">Not now</button>` : ''}
      </div>
      <h3 class="space-recap-title">${esc(o.title)}</h3>
      ${o.facesHtml ? `<div class="space-recap-faces">${o.facesHtml}</div>` : ''}
      ${o.bodyHtml || ''}
    </section>`;
}
const SPACE_RECAP_SKIP = 'shq.recapSkip';
function _spaceRecapSkips() {
  try {
    const m = JSON.parse(localStorage.getItem(SPACE_RECAP_SKIP) || '{}') || {};
    const cut = Date.now() - 3 * 86400000;
    Object.keys(m).forEach(k => { if (!(m[k] > cut)) delete m[k]; });
    return m;
  } catch { return {}; }
}
function spaceRecapDismissed(key) { return !!_spaceRecapSkips()[key]; }
function spaceRecapDismiss(key) {
  const m = _spaceRecapSkips();
  m[key] = Date.now();
  try { localStorage.setItem(SPACE_RECAP_SKIP, JSON.stringify(m)); } catch {}
  if (typeof renderPreservingInput === 'function') renderPreservingInput();
}
function spaceRecapText(html) {
  const clean = typeof sanitizeHtml === 'function' ? sanitizeHtml(String(html || '')) : '';
  try {
    const doc = new DOMParser().parseFromString(clean.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h[1-6]|div)>/gi, '\n'), 'text/html');
    return String(doc.body.textContent || '').replace(/\n{2,}/g, '\n').trim();
  } catch { return ''; }
}
