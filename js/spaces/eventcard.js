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
                    now, className })
     The big "next up" card in three states (see eventTimeState): before
     shows a countdown chip, now adds a "Happening now · until 8:00 PM"
     strip and a primary Join call for a link, after says it ended.
     eyebrow and title are plain text; tags, the *Html options and
     spaceWhereHtml(where) are trusted HTML. onOpen is onclick JS for the
     title (usually the event sheet).
   spaceAgendaRow({ date, title, metaHtml, tags, trailingHtml, onclick,
                    past, className, style, label })
     One 64px row: date tile, title and meta over a tag row, and whatever
     trails it (a compact RSVP, a Pay dues button). title is plain text.
   spaceWeekStrip({ start, selected, counts, onPick, label })
     Seven day buttons from `start` (ISO date). counts: { iso: n } draws up
     to three dots; onPick(iso) returns onclick JS; selected is an ISO date.
   spaceStatTile({ value, label, sub, bar })
     A figure tile. value, label and sub are plain text; bar (0..1) adds
     the micro bar in the space color.
   spaceFacePile({ people, colorOf, meUid, size, max, verb, zeroText,
                   detail, onclick, label })
     Faces plus "You, Maya and 3 others are going". See spaceFaceCaption.
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
function spaceDateBlock(date, { size = 'hero', today } = {}) {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const isToday = today ?? date === _evIso(new Date());
  if (size === 'tile') {
    return `<div class="sg-date-tile space-date-tile${isToday ? ' is-today' : ''}"><span>${d.toLocaleDateString('en-US', { month: 'short' })}</span><strong>${d.getDate()}</strong></div>`;
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
  const chip = st.phase === 'before' && st.label ? `<span class="space-chip space-hero-chip">${esc(_evCap(st.label))}</span>`
    : st.phase === 'after' ? '<span class="space-chip space-hero-chip is-ended">Ended</span>' : '';
  const strip = st.phase === 'now'
    ? `<div class="space-hero-now"><span class="space-now-dot" aria-hidden="true"></span>Happening now${st.allDay ? ' · all day' : ` · until ${esc(fmtTime(st.endsAt))}`}</div>` : '';
  const join = isLink ? (st.phase === 'now' ? joinLinkButton(o.where, 'btn-primary space-join-now') : st.phase === 'before' ? joinLinkButton(o.where) : '') : '';
  return `
    <div class="card space-hero is-${st.phase}${o.className ? ' ' + o.className : ''}">
      ${strip}
      <div class="space-hero-grid">
        ${spaceDateBlock(o.date)}
        <div class="space-hero-head">
          <div class="space-hero-top">
            <div class="space-hero-eyebrow"><span class="eyebrow">${esc(o.eyebrow || '')}</span>${o.tags || ''}</div>
            ${chip}
          </div>
          ${o.onOpen ? `<button class="space-hero-title" onclick="${o.onOpen}">${esc(o.title)}</button>` : `<div class="space-hero-title">${esc(o.title)}</div>`}
          <div class="space-hero-meta">
            <span>${icon('calendar', 13)} ${esc(fmtDate(o.date, { weekday: 'long', month: 'short', day: 'numeric' }))}</span>
            ${range ? `<span>${icon('clock', 13)} ${esc(range)}</span>` : ''}
            ${o.where ? `<span>${icon('map-pin', 13)} ${whereHtml}</span>` : ''}
          </div>
        </div>
        <div class="space-hero-rest">
          ${o.notes ? `<div class="space-hero-notes">${linkifyText(o.notes)}</div>` : ''}
          ${o.extraHtml || ''}
          <div class="space-hero-foot">
            ${o.rsvpHtml || ''}
            ${join}
            ${o.actionsHtml ? `<span class="space-hero-actions">${o.actionsHtml}</span>` : ''}
          </div>
          ${o.facesHtml ? `<div class="space-hero-faces">${o.facesHtml}</div>` : ''}
        </div>
      </div>
    </div>`;
}

/* ── Agenda row ────────────────────────────────────────────────── */
function spaceAgendaRow(o) {
  const tags = o.tags ? `<div class="space-agenda-tags">${o.tags}</div>` : '';
  const click = o.onclick ? ` role="button" tabindex="0" onclick="${o.onclick}" onkeydown="if(event.key==='Enter'&&event.target===this){${o.onclick}}"` : '';
  return `
    <div class="space-agenda-row${o.past ? ' is-past' : ''}${o.className ? ' ' + o.className : ''}"${o.style ? ` style="${o.style}"` : ''}${click}${o.label ? ` aria-label="${esc(o.label)}"` : ''}>
      ${spaceDateBlock(o.date, { size: 'tile' })}
      <div class="space-agenda-main">
        <div class="space-agenda-title">${esc(o.title)}</div>
        ${o.metaHtml ? `<div class="space-agenda-meta">${o.metaHtml}</div>` : ''}
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
        return `<button class="space-week-daybtn${iso === today ? ' is-today' : ''}" aria-pressed="${iso === o.selected}" aria-label="${esc(name)}${n ? `, ${(o.counts || {})[iso]} event${(o.counts || {})[iso] === 1 ? '' : 's'}` : ''}" onclick="${o.onPick ? o.onPick(iso) : ''}">
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
  return o.onclick
    ? `<button type="button" class="${cls}" onclick="event.stopPropagation();${o.onclick}"${o.label ? ` aria-label="${esc(o.label)}"` : ''}>${inner}</button>`
    : `<span class="${cls}">${inner}</span>`;
}
