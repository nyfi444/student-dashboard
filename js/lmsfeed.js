/* ── LMS calendar feeds: Canvas, Blackboard, Brightspace, Moodle ────
   Every LMS hands each student a private calendar link with every due
   date already in it. Paste it once: the Worker fetches it (a browser
   can't, the LMS doesn't allow cross-site reads), the feed is parsed
   here, and every dated item becomes an assignment carrying the feed's
   own id for it (feedUid). A refresh matches on that id, so a deadline
   the professor moves moves here too, and nothing is added twice. A
   refresh never deletes: something unpublished on the LMS side stays
   until the student clears it.

   The link is a secret (it is the whole authentication), so it lives in
   the planner like everything else, never goes into a diagnostic report,
   and only ever leaves the browser to reach our own Worker. Without an
   account the same parser runs on an uploaded .ics file instead, so the
   demo can show a whole semester landing in one go.

   Feeds refresh when a paid account's planner loads and every six hours
   after that while the app is open (see syncFeedsIfStale). That is what
   "stays current" means here: the LMS is read again each time the
   student is actually looking, without a server job of its own.
──────────────────────────────────────────────────────────────── */
const FEED_SOURCES = [
  ['canvas', 'Canvas', 'Open Calendar in Canvas, click Calendar Feed at the bottom right, and copy the link.'],
  ['blackboard', 'Blackboard', 'Open Calendar, click the gear (Calendar Settings), choose Share calendar, and copy the link.'],
  ['brightspace', 'Brightspace / D2L', 'Open Calendar, go to Settings, turn on Calendar Feeds, click Subscribe, and copy the link.'],
  ['moodle', 'Moodle', 'Open Calendar, click Export calendar, choose all events and the widest time span, then Get calendar URL.'],
  ['other', 'Another calendar', 'Any private .ics or webcal link works, as long as it lists due dates.'],
];
const FEED_STALE_MS = 6 * 3600000;
const FEED_PAST_DAYS = 120;  // older than this is a past semester the feed is still dragging along
const FEED_FUTURE_DAYS = 400;
const feedNorm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function feedEntries() { return state.feeds || (state.feeds = []); }
function feedSourceName(source) { return (FEED_SOURCES.find(s => s[0] === source) || FEED_SOURCES[FEED_SOURCES.length - 1])[1]; }
function feedHost(url) { try { return new URL(String(url).replace(/^webcal:/i, 'https:')).hostname; } catch { return ''; } }
function guessFeedSource(url) {
  const h = feedHost(url).toLowerCase();
  if (/instructure|canvas/.test(h)) return 'canvas';
  if (/blackboard|bbcollab/.test(h)) return 'blackboard';
  if (/brightspace|d2l/.test(h)) return 'brightspace';
  if (/moodle/.test(h)) return 'moodle';
  return 'other';
}
// An uploaded file has no hostname; the calendar names its maker instead.
function feedSourceFromText(text) {
  const prodid = (/^PRODID:(.*)$/im.exec(String(text || '')) || [])[1] || '';
  if (/instructure|canvas/i.test(prodid)) return 'canvas';
  if (/blackboard/i.test(prodid)) return 'blackboard';
  if (/d2l|brightspace/i.test(prodid)) return 'brightspace';
  if (/moodle/i.test(prodid)) return 'moodle';
  return 'other';
}
function icsCalendarName(text) { return icsUnescape((/^X-WR-CALNAME:(.*)$/im.exec(unfoldIcs(text)) || [])[1] || '').trim().slice(0, 80); }

/* ── Parsing: just enough iCalendar for a deadline list ─────────── */
function unfoldIcs(text) { return String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, ''); }
function icsUnescape(v) { return String(v || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1'); }
// 20260925 (a whole day), 20260925T035959Z (UTC: Canvas stores 11:59pm this
// way), or 20260925T235900 (the LMS's own wall clock, taken as local time).
function parseIcsDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(value || '').trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, z] = m;
  if (!hh) return { date: `${y}-${mo}-${d}`, time: null, allDay: true };
  if (z) {
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +(ss || 0)));
    return { date: iso(dt), time: `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`, allDay: false };
  }
  return { date: `${y}-${mo}-${d}`, time: `${hh}:${mm}`, allDay: false };
}
function parseIcs(text) {
  const events = [];
  let cur = null;
  unfoldIcs(text).split('\n').forEach(line => {
    if (line === 'BEGIN:VEVENT' || line === 'BEGIN:VTODO') { cur = {}; return; }
    if (line === 'END:VEVENT' || line === 'END:VTODO') { if (cur) events.push(cur); cur = null; return; }
    if (!cur) return;
    const i = line.indexOf(':');
    if (i < 1) return;
    const key = line.slice(0, i).split(';')[0].toUpperCase();
    const value = line.slice(i + 1);
    if (key === 'DTSTART' || key === 'DUE' || key === 'DTEND') cur[key] = parseIcsDate(value);
    else if (key === 'SUMMARY' || key === 'DESCRIPTION' || key === 'LOCATION') cur[key] = icsUnescape(value).trim();
    else if (key === 'UID' || key === 'URL' || key === 'RRULE') cur[key] = value.trim();
  });
  return events.filter(e => e.SUMMARY || e.UID).map(e => ({
    uid: String(e.UID || '').slice(0, 200) || `t-${feedNorm(e.SUMMARY).slice(0, 40)}-${(e.DUE || e.DTSTART)?.date || ''}`,
    title: String(e.SUMMARY || 'Untitled').replace(/\s+/g, ' ').trim().slice(0, 200),
    description: String(e.DESCRIPTION || '').slice(0, 2000),
    location: String(e.LOCATION || '').slice(0, 200),
    url: isHttpUrl(e.URL) ? e.URL : '',
    when: e.DUE || e.DTSTART || null,
    recurring: !!e.RRULE,
  }));
}

/* ── From calendar entries to assignments ────────────────────────── */
// Which class an entry belongs to, as the LMS wrote it. Canvas puts the
// course after the title in brackets, Blackboard names it in the
// description, Brightspace leads with the course code.
function feedCourseLabel(ev) {
  const m = /\s*\[([^\]]{2,80})\]\s*$/.exec(ev.title);
  if (m) return { label: m[1].trim(), title: ev.title.slice(0, m.index).trim() || ev.title };
  const d = /(?:^|\n)\s*Course(?: name)?:\s*([^\n]{2,80})/i.exec(ev.description || '');
  if (d) return { label: d[1].trim(), title: ev.title };
  const b = /^([A-Z]{2,5}[ -]?\d{3}[A-Z]?)\s*[-–:]\s*(.{2,})$/.exec(ev.title);
  if (b) return { label: b[1].trim(), title: b[2].trim() };
  return { label: '', title: ev.title };
}
function feedItemType(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(final|midterm|exam)\b/.test(t)) return 'exam';
  if (/\bquiz\b/.test(t)) return 'quiz';
  if (/\blab\b/.test(t)) return 'lab';
  if (/\b(essay|paper)\b/.test(t)) return 'paper';
  if (/\bdiscussion\b/.test(t)) return 'discussion';
  if (/\b(reading|chapter|ch\.)\b/.test(t)) return 'reading';
  if (/\bproject\b/.test(t)) return 'project';
  return 'assignment';
}
const FEED_DEADLINE_WORDS = /\b(due|exam|quiz|midterm|final|assignment|homework|hw|project|paper|essay|lab|discussion|submit|submission)\b/i;
// A Canvas feed also carries plain calendar entries (a lecture, a club fair,
// office hours). Its ids say which kind each one is; other systems export
// due dates and nothing else.
function feedLooksLikeDeadline(ev, source) {
  if (source === 'canvas') return /assignment|quiz|discussion|planner|todo/i.test(ev.uid) || FEED_DEADLINE_WORDS.test(ev.title);
  return true;
}
function guessFeedCourse(label, ev, courses) {
  const hay = feedNorm(label) || feedNorm(`${ev.title} ${String(ev.description || '').slice(0, 300)}`);
  let best = null;
  (courses || []).forEach(c => {
    const code = feedNorm(c.code), name = feedNorm(c.name);
    const score = code && code.length >= 4 && hay.includes(code) ? 100 + code.length : name && name.length >= 5 && hay.includes(name) ? name.length : 0;
    if (score && (!best || score > best.score)) best = { id: c.id, score };
  });
  return best ? best.id : null;
}
function feedItemsFromEvents(events, source, today = todayIso()) {
  const from = addDays(today, -FEED_PAST_DAYS), to = addDays(today, FEED_FUTURE_DAYS);
  const skipped = { undated: 0, repeating: 0, notDeadline: 0, outside: 0 };
  const items = [];
  events.forEach(ev => {
    if (!ev.when) { skipped.undated++; return; }
    if (ev.recurring) { skipped.repeating++; return; }
    if (!feedLooksLikeDeadline(ev, source)) { skipped.notDeadline++; return; }
    if (ev.when.date < from || ev.when.date > to) { skipped.outside++; return; }
    const { label, title } = feedCourseLabel(ev);
    items.push({
      uid: ev.uid, title, label, labelKey: feedNorm(label), dueDate: ev.when.date, dueTime: ev.when.allDay ? '23:59' : ev.when.time,
      type: feedItemType(`${title} ${String(ev.description || '').slice(0, 200)}`), url: ev.url,
    });
  });
  return { items, skipped };
}
function feedSkippedText(s) {
  const parts = [s.notDeadline ? `${s.notDeadline} class events` : '', s.repeating ? `${s.repeating} repeating meetings` : '', s.outside ? `${s.outside} from other semesters` : ''].filter(Boolean);
  return parts.length ? `Left out: ${parts.join(', ')}.` : '';
}

// courseMap: labelKey -> course id, '' for "no class", or 'skip'.
function mergeFeedItems(feed, items, courseMap) {
  const summary = { added: 0, moved: 0, renamed: 0, linked: 0, unchanged: 0, skipped: 0 };
  const sourceName = feedSourceName(feed.source);
  items.forEach(it => {
    const mapped = courseMap[it.labelKey];
    if (mapped === 'skip') { summary.skipped++; return; }
    const courseId = mapped && getCourse(mapped) ? mapped : null;
    let a = state.assignments.find(x => x.feedId === feed.id && x.feedUid === it.uid);
    if (!a) {
      // Typed in by hand before the feed existed: adopt it, so it is the
      // one that moves next time rather than a second copy appearing.
      const twin = findDuplicateAssignment(it.title, courseId);
      if (twin && !twin.feedUid) {
        Object.assign(twin, { feedId: feed.id, feedUid: it.uid, feedTitle: it.title, feedUrl: it.url || twin.feedUrl || '' });
        summary.linked++;
        return;
      }
      state.assignments.push({
        id: uid(), courseId, title: it.title, type: it.type, dueDate: it.dueDate, dueTime: it.dueTime, startByDate: null,
        maxPoints: null, earnedPoints: null, status: 'not-started', rubric: [], notes: '',
        attachments: it.url ? [{ id: uid(), kind: 'reference', name: `Open in ${sourceName}`, url: it.url, dataUrl: null }] : [],
        recurringTemplateId: null, feedId: feed.id, feedUid: it.uid, feedTitle: it.title, feedUrl: it.url || '',
      });
      summary.added++;
      return;
    }
    let changed = false;
    if (a.dueDate !== it.dueDate || (a.dueTime || '23:59') !== it.dueTime) { a.dueDate = it.dueDate; a.dueTime = it.dueTime; changed = true; summary.moved++; }
    // A title the student never touched follows the LMS; one they renamed stays theirs.
    if (it.title !== a.feedTitle && a.title === a.feedTitle) { a.title = it.title; changed = true; summary.renamed++; }
    a.feedTitle = it.title;
    if (!changed) summary.unchanged++;
  });
  return summary;
}
function feedSummaryText(s) {
  const parts = [s.added ? `${s.added} new` : '', s.moved ? `${s.moved} moved` : '', s.renamed ? `${s.renamed} renamed` : '', s.linked ? `${s.linked} matched to ones you had` : ''].filter(Boolean);
  return parts.length ? parts.join(', ') : 'everything was already up to date';
}

/* ── Fetching and refreshing ─────────────────────────────────────── */
async function fetchFeedText(url) {
  if (typeof WORKER_URL === 'undefined' || !WORKER_URL) throw new Error('Calendar feeds aren’t set up on this deployment yet.');
  if (!_fbUser) throw new Error('Log in to connect a calendar feed.');
  const res = await fetch(`${WORKER_URL}/calendar-feed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, idToken: await _fbUser.getIdToken() }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Couldn’t fetch that calendar. Try again in a moment.');
  return String(data.text || '');
}
let _feedSyncing = false;
async function syncFeed(id, { quiet = false } = {}) {
  const feed = feedEntries().find(f => f.id === id);
  if (!feed || feed.kind !== 'link' || _feedSyncing) return null;
  if (!navigator.onLine) { if (!quiet) toast('You’re offline. The feed refreshes once you’re back.', 'info'); return null; }
  _feedSyncing = true;
  try {
    const text = await fetchFeedText(feed.url);
    const { items } = feedItemsFromEvents(parseIcs(text), feed.source);
    // A class that first shows up after the mapping was made gets the best guess.
    items.forEach(it => { if (!(it.labelKey in feed.courseMap)) feed.courseMap[it.labelKey] = guessFeedCourse(it.label, it, activeCourses()) || ''; });
    const summary = mergeFeedItems(feed, items, feed.courseMap);
    feed.lastSyncAt = Date.now(); feed.lastError = ''; feed.itemCount = items.length;
    touch();
    if (!quiet || summary.added || summary.moved || summary.renamed) toast(`${feedSourceName(feed.source)}: ${feedSummaryText(summary)}`, 'success', 4000);
    return summary;
  } catch (e) {
    feed.lastError = e.message || 'Couldn’t refresh';
    feed.lastErrorAt = Date.now();
    save();
    if (state.route === 'settings') render();
    diag.warn('feeds', 'Calendar feed refresh failed', e);
    if (!quiet) toast(feed.lastError, 'error', 5000);
    return null;
  } finally { _feedSyncing = false; }
}
async function syncFeedsIfStale() {
  if (!_fbUser || !window._licensed || !navigator.onLine) return;
  for (const f of feedEntries()) {
    if (f.kind === 'link' && (!f.lastSyncAt || Date.now() - f.lastSyncAt > FEED_STALE_MS)) await syncFeed(f.id, { quiet: true });
  }
}
if (typeof setInterval === 'function' && typeof window !== 'undefined' && window.document) {
  setInterval(() => { syncFeedsIfStale().catch(() => {}); }, 30 * 60000);
}
function removeFeed(id) {
  const feed = feedEntries().find(f => f.id === id);
  if (!feed) return;
  confirmDialog(`Remove the ${feedSourceName(feed.source)} feed? The assignments it added stay; they just stop updating from it.`, () => {
    state.feeds = feedEntries().filter(f => f.id !== id);
    state.assignments.forEach(a => { if (a.feedId === id) { delete a.feedId; delete a.feedUid; delete a.feedTitle; } });
    touch();
    toast('Feed removed');
  }, 'Remove');
}

/* ── Import: paste the link or upload the file, map classes, add ─── */
function openFeedImportModal({ feedId = null } = {}) {
  const existing = feedId ? feedEntries().find(f => f.id === feedId) : null;
  const signedIn = !!_fbUser && !!window._licensed;
  const canLink = typeof WORKER_URL !== 'undefined' && !!WORKER_URL && fbConfigured();
  const tab = existing?.kind === 'file' ? 'file' : signedIn && canLink ? 'link' : 'file';
  window._feedDraft = { tab, file: null, feedId, url: existing?.url || '' };
  openModal(`
    <div class="modal-head"><h3>${existing ? `Update the ${esc(feedSourceName(existing.source))} import` : 'Import from Canvas or your LMS'}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <p class="small muted mb-8">Every Canvas, Blackboard, Brightspace, and Moodle account has a private calendar link with every due date in it. Paste it once and your assignments stay in step with it, including dates that move.</p>
      <div class="segmented mb-8" id="fi-tabs"><button class="${tab === 'link' ? 'active' : ''}" data-tab="link" onclick="feedTab('link')">Paste the feed link</button><button class="${tab === 'file' ? 'active' : ''}" data-tab="file" onclick="feedTab('file')">Upload an .ics file</button></div>
      <div id="fi-link" ${tab === 'link' ? '' : 'hidden'}>
        ${signedIn && canLink ? `
          <div class="field"><label for="fi-url">Feed link</label><input class="input" id="fi-url" type="url" value="${esc(existing?.url || '')}" placeholder="https://….instructure.com/feeds/calendars/user_….ics" autocomplete="off" spellcheck="false" oninput="onFeedUrlInput(this.value)"></div>
          <div class="small muted" id="fi-source-note">${existing?.url ? `Looks like ${esc(feedSourceName(guessFeedSource(existing.url)))}.` : ''}</div>`
        : `<div class="sg-callout small"><span>${icon('lock', 14, 1.8)}</span><div>Keeping a feed in sync needs a Semester HQ account. ${fbConfigured() ? '<a href="login.html">Log in</a>, or' : 'For now,'} upload the .ics file instead to try it.</div></div>`}
      </div>
      <div id="fi-file" ${tab === 'file' ? '' : 'hidden'}>
        <div class="upload-drop" onclick="if(event.target.id!=='fi-file-input')$('#fi-file-input').click()" ondragover="event.preventDefault();this.classList.add('drag')" ondragleave="this.classList.remove('drag')" ondrop="event.preventDefault();this.classList.remove('drag');handleFeedFilePick(event.dataTransfer.files[0])">
          <div class="small" id="fi-file-status">Choose the calendar file you exported, or drop it here</div>
          <input type="file" id="fi-file-input" hidden onchange="handleFeedFilePick(this.files[0])">
        </div>
        <div class="small muted mt-8">A file is a one-time import. Paste the link instead and it refreshes on its own.</div>
      </div>
      <details class="mt-16 small feed-help"><summary class="sg-strong">Where do I find the link?</summary>
        <ul class="mt-8">${FEED_SOURCES.filter(s => s[0] !== 'other').map(s => `<li><span class="sg-strong">${esc(s[1])}:</span> ${esc(s[2])}</li>`).join('')}</ul>
        <p class="muted mt-8">The link is private to you. Semester HQ keeps it with your planner and uses it only to read your due dates.</p>
      </details>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="fi-go" onclick="runFeedImport()">${icon('calendar', 13, 1.8)} Find my deadlines</button>
    </div>
  `, { wide: true });
  setTimeout(() => $('#fi-url')?.focus(), 60);
}
function feedTab(tab) {
  window._feedDraft.tab = tab;
  const link = $('#fi-link'), file = $('#fi-file');
  if (link) link.hidden = tab !== 'link';
  if (file) file.hidden = tab !== 'file';
  $$('#fi-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
}
function onFeedUrlInput(v) {
  const note = $('#fi-source-note');
  if (!note) return;
  const url = String(v || '').trim();
  note.textContent = !url ? '' : /^(https:|webcal:)\/\//i.test(url) ? `Looks like ${feedSourceName(guessFeedSource(url))}.` : 'The link should start with https:// or webcal://';
}
function handleFeedFilePick(file) {
  const input = $('#fi-file-input');
  if (input) input.value = '';
  if (!file) return;
  const status = $('#fi-file-status');
  if (file.size > 3 * 1024 * 1024) { if (status) status.textContent = 'That file is too large to be a calendar export.'; return; }
  const reader = new FileReader();
  reader.onload = () => {
    window._feedDraft.file = { name: file.name, text: String(reader.result || '') };
    if (status) status.textContent = `${file.name} is ready`;
  };
  reader.onerror = () => { if (status) status.textContent = 'Couldn’t read that file.'; };
  reader.readAsText(file);
}
async function runFeedImport() {
  const d = window._feedDraft;
  const btn = $('#fi-go');
  setBtnLoading(btn, true);
  try {
    let text;
    if (d.tab === 'link') {
      const url = ($('#fi-url')?.value || '').trim().replace(/^webcal:/i, 'https:');
      if (!/^https:\/\/\S+$/i.test(url)) throw new Error('Paste the whole feed link. It starts with https:// or webcal://');
      d.kind = 'link'; d.url = url; d.source = guessFeedSource(url);
      text = await fetchFeedText(url);
    } else {
      if (!d.file) throw new Error('Choose the calendar file first.');
      d.kind = 'file'; text = d.file.text; d.source = feedSourceFromText(text);
    }
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('That isn’t a calendar. Make sure it’s the calendar feed or export, not a course page.');
    const events = parseIcs(text);
    const { items, skipped } = feedItemsFromEvents(events, d.source);
    if (!items.length) throw new Error(events.length ? 'No due dates in that calendar for this semester. Check that the feed covers your current classes.' : 'That calendar is empty.');
    d.items = items; d.skipped = skipped; d.calName = icsCalendarName(text);
    const existing = d.feedId ? feedEntries().find(f => f.id === d.feedId)?.courseMap : null;
    d.courseMap = {};
    items.forEach(it => { if (!(it.labelKey in d.courseMap)) d.courseMap[it.labelKey] = existing && it.labelKey in existing ? existing[it.labelKey] : (guessFeedCourse(it.label, it, activeCourses()) || ''); });
    renderFeedPreviewModal();
  } catch (e) {
    setBtnLoading(btn, false, 'Find my deadlines');
    toast(e.message || 'Couldn’t read that calendar.', 'error', 5500);
  }
}
function renderFeedPreviewModal() {
  const d = window._feedDraft;
  const courses = activeCourses();
  const groups = [];
  d.items.forEach(it => { let g = groups.find(x => x.key === it.labelKey); if (!g) groups.push(g = { key: it.labelKey, label: it.label, items: [] }); g.items.push(it); });
  groups.sort((a, b) => b.items.length - a.items.length);
  const n = d.items.length;
  openModal(`
    <div class="modal-head"><h3>${n} deadline${n === 1 ? '' : 's'} found</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <p class="small muted mb-8">Match each calendar to one of your classes. ${esc(feedSkippedText(d.skipped))}</p>
      <div class="feed-map">
        ${groups.map(g => `
          <div class="feed-map-row">
            <div class="feed-map-info">
              <div class="small sg-strong">${g.label ? esc(g.label) : 'No class named'}</div>
              <div class="small muted">${g.items.length} item${g.items.length === 1 ? '' : 's'} · ${g.items.slice(0, 3).map(i => esc(i.title)).join(' · ')}${g.items.length > 3 ? ' …' : ''}</div>
            </div>
            <select class="select" aria-label="Class for ${esc(g.label || 'unlabeled items')}" onchange="_feedDraft.courseMap['${g.key}']=this.value">
              ${courses.map(c => `<option value="${c.id}" ${d.courseMap[g.key] === c.id ? 'selected' : ''}>${esc(c.code || c.name)}</option>`).join('')}
              <option value="" ${!d.courseMap[g.key] ? 'selected' : ''}>No class</option>
              <option value="skip" ${d.courseMap[g.key] === 'skip' ? 'selected' : ''}>Don’t import</option>
            </select>
          </div>`).join('')}
      </div>
      ${!courses.length ? `<div class="sg-callout small mt-8"><span>${icon('graduation-cap', 14, 1.8)}</span><div>No classes yet, so these land under “No class”. Add your classes in Courses and move them from there, or run this again afterward.</div></div>` : ''}
      ${d.kind === 'link' ? `<p class="small muted mt-8">From now on this refreshes when you open Semester HQ, so a moved due date moves here too.</p>` : ''}
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="openFeedImportModal({feedId:${d.feedId ? `'${d.feedId}'` : 'null'}})">Back</button>
      <button class="btn btn-primary" id="fi-commit" onclick="commitFeedImport()">Add to Assignments</button>
    </div>
  `, { wide: true });
}
function commitFeedImport() {
  const d = window._feedDraft;
  let feed = d.feedId ? feedEntries().find(f => f.id === d.feedId) : null;
  if (!feed && d.kind === 'file') feed = feedEntries().find(f => f.kind === 'file' && f.source === d.source) || null;
  if (!feed && d.kind === 'link') feed = feedEntries().find(f => f.kind === 'link' && f.url === d.url) || null;
  if (!feed) {
    feed = { id: uid(), kind: d.kind, source: d.source, url: d.kind === 'link' ? d.url : '', label: d.calName || '', courseMap: {}, addedAt: Date.now(), lastSyncAt: 0, lastError: '', itemCount: 0 };
    feedEntries().push(feed);
  } else if (d.kind === 'link') { feed.url = d.url; feed.kind = 'link'; feed.source = d.source; }
  feed.courseMap = { ...feed.courseMap, ...d.courseMap };
  const summary = mergeFeedItems(feed, d.items, feed.courseMap);
  feed.lastSyncAt = Date.now(); feed.lastError = ''; feed.itemCount = d.items.length;
  closeModal();
  touch();
  if (typeof playUiSound === 'function') playUiSound('success');
  toast(`${feedSourceName(feed.source)}: ${feedSummaryText(summary)}${feed.kind === 'link' ? '. It refreshes on its own from now on.' : '.'}`, 'success', 5500);
  if (state.route !== 'assignments') setState({ route: 'assignments', subRoute: null });
}

/* ── Settings card ───────────────────────────────────────────────── */
function feedSettingsCard() {
  const feeds = feedEntries();
  return `
    <div class="card card-pad">
      <h3 style="font-size:15px" class="mb-8">Calendar feeds</h3>
      <p class="small muted mb-8">Due dates from Canvas, Blackboard, Brightspace, or Moodle, kept in step with the LMS.</p>
      ${feeds.map(f => `
        <div class="feed-row">
          <div class="row-title">
            <div class="small sg-strong">${esc(feedSourceName(f.source))}${f.label ? ` · ${esc(f.label)}` : ''}</div>
            <div class="small muted">${f.kind === 'file' ? 'From an uploaded file' : esc(feedHost(f.url))} · ${f.lastSyncAt ? `updated ${fmtRelativeTime(f.lastSyncAt)}` : 'never updated'}${f.itemCount ? ` · ${f.itemCount} item${f.itemCount === 1 ? '' : 's'}` : ''}</div>
            ${f.lastError ? `<div class="small" style="color:var(--danger)">${esc(f.lastError)}</div>` : ''}
          </div>
          <div class="flex-gap">
            ${f.kind === 'link' ? `<button class="btn btn-sm" onclick="syncFeed('${f.id}')">${icon('refresh-cw', 13, 1.8)} Refresh</button>` : `<button class="btn btn-sm" onclick="openFeedImportModal({feedId:'${f.id}'})">${icon('upload', 13, 1.8)} Upload a newer file</button>`}
            <button class="btn btn-ghost btn-sm" onclick="removeFeed('${f.id}')">Remove</button>
          </div>
        </div>`).join('')}
      <button class="btn btn-sm ${feeds.length ? 'mt-8' : ''}" onclick="openFeedImportModal()">${icon('calendar', 13, 1.8)} ${feeds.length ? 'Add another calendar' : 'Connect Canvas or another LMS'}</button>
    </div>`;
}
