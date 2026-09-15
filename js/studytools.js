/* ── Flashcards with spaced repetition ────────────────────────────
   Each card carries a schedule (card.srs): when it's next due, the
   current interval in days, an ease factor, and how many times it's been
   remembered or forgotten. Reviewing asks "how well did you know it?"
   (Again / Hard / Good / Easy) and pushes the next review out further
   the better you know it, the SM-2 approach Anki popularized. New cards
   are introduced a limited number per day so a big deck never turns into
   a wall of 200 reviews.
──────────────────────────────────────────────────────────────── */
const SRS_NEW_PER_DAY = 20;
const SRS_MAX_INTERVAL = 365;
const SRS_RATINGS = [[1, 'Again'], [2, 'Hard'], [3, 'Good'], [4, 'Easy']];

// Cards created before spaced repetition only had a rough mastery label.
// Treat them as already in progress, due today, instead of brand new.
function srsState(card) {
  if (card.srs) return card.srs;
  if (card.mastery === 'mastered') return { due: todayIso(), interval: 7, ease: 2.5, reps: 3, lapses: 0 };
  if (card.mastery === 'learning') return { due: todayIso(), interval: 1, ease: 2.5, reps: 1, lapses: 0 };
  return null;
}
function isNewCard(card) { return !srsState(card); }
function isDueCard(card, t = todayIso()) { const s = srsState(card); return !!s && !!s.due && s.due <= t; }
function srsNext(card, rating, t = todayIso()) {
  const s = { ...(srsState(card) || { interval: 0, ease: 2.5, reps: 0, lapses: 0 }) };
  if (rating === 1) {
    if (s.reps > 0) s.lapses = (s.lapses || 0) + 1;
    s.reps = 0; s.interval = 0; s.ease = Math.max(1.3, s.ease - 0.2); s.due = t;
  } else {
    if (rating === 2) { s.interval = s.reps === 0 ? 1 : Math.max(s.interval + 1, Math.round(s.interval * 1.2)); s.ease = Math.max(1.3, s.ease - 0.15); }
    if (rating === 3) { s.interval = s.reps === 0 ? 1 : s.reps === 1 ? 3 : Math.max(s.interval + 1, Math.round(s.interval * s.ease)); }
    if (rating === 4) { s.interval = s.reps === 0 ? 4 : Math.max(s.interval + 2, Math.round(s.interval * s.ease * 1.3)); s.ease = Math.min(3.2, s.ease + 0.15); }
    s.interval = Math.min(SRS_MAX_INTERVAL, s.interval);
    s.reps += 1;
    s.due = addDays(t, s.interval);
  }
  s.last = t;
  return s;
}
function fmtInterval(days) {
  if (days <= 0) return 'Again today';
  if (days === 1) return '1 day';
  if (days <= 31) return `${days} days`;
  if (days < 365) { const m = days / 30; return `${m < 3 ? Math.round(m * 10) / 10 : Math.round(m)} mo`; }
  return '1 yr';
}
function masteryFromSrs(s) { return !s ? 'new' : s.interval >= 21 ? 'mastered' : 'learning'; }
// Per-day review counts, kept for Semester Wrapped and streaks.
function logReview() {
  const log = state.srsLog || (state.srsLog = {});
  log[todayIso()] = (log[todayIso()] || 0) + 1;
}
function srsDaily() {
  const d = state.settings.srsDaily;
  if (!d || d.date !== todayIso()) state.settings.srsDaily = { date: todayIso(), newSeen: 0, reviewed: 0 };
  return state.settings.srsDaily;
}
function newAllowance() { return Math.max(0, SRS_NEW_PER_DAY - (state.settings.srsDaily?.date === todayIso() ? state.settings.srsDaily.newSeen : 0)); }
function srsDueCount(deck) {
  const due = deck.cards.filter(c => isDueCard(c)).length;
  return due + Math.min(deck.cards.filter(isNewCard).length, newAllowance());
}
function srsDueTotal() {
  const decks = visibleDecks();
  const due = decks.reduce((s, d) => s + d.cards.filter(c => isDueCard(c)).length, 0);
  const fresh = decks.reduce((s, d) => s + d.cards.filter(isNewCard).length, 0);
  return due + Math.min(fresh, newAllowance());
}
function visibleDecks() { return state.decks.filter(d => !d.courseId || activeCourses().some(c => c.id === d.courseId)); }
function deckProgress(d) {
  const counts = { mastered: 0, learning: 0, newCount: 0 };
  d.cards.forEach(c => { const m = masteryFromSrs(srsState(c)); if (m === 'mastered') counts.mastered++; else if (m === 'learning') counts.learning++; else counts.newCount++; });
  return counts;
}

/* ── Page ──────────────────────────────────────────────────────── */
function pageStudyTools() {
  const decks = visibleDecks();
  const totalDue = srsDueTotal();
  const today = srsDaily();
  const t = todayIso();
  const forecast = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(t, i);
    const n = decks.reduce((s, dk) => s + dk.cards.filter(c => { const st = srsState(c); return st && st.due && (i === 0 ? st.due <= d : st.due === d); }).length, 0);
    return { d, n };
  });
  const maxF = Math.max(1, ...forecast.map(f => f.n));
  return `
    ${pageHead('Flashcards', 'Review each card right before you’d forget it', `
      ${aiButton('Make from a note', 'openGenerateDeckModal()')}
      <button class="btn btn-primary" onclick="openDeckModal()">+ New deck</button>
    `)}
    ${decks.length ? `
    <div class="card fc-hero">
      <div class="fc-hero-main">
        <div class="sg-eyebrow">Today</div>
        <div class="fc-hero-num">${totalDue ? `${totalDue} card${totalDue === 1 ? '' : 's'} to review` : 'You’re all caught up'}</div>
        <div class="small muted">${today.reviewed ? `${today.reviewed} reviewed so far today. ` : ''}${totalDue ? 'About ' + Math.max(1, Math.round(totalDue * 8 / 60)) + ' min.' : 'Come back tomorrow, or browse a deck anytime.'}</div>
        ${totalDue ? `<button class="btn btn-primary mt-16" onclick="openReview()">${icon('play', 12, 1.5)} Start review</button>` : ''}
      </div>
      <div class="fc-forecast" aria-label="Cards due over the next week">
        <div class="small muted mb-8">Coming up</div>
        <div class="fc-forecast-bars">${forecast.map((f, i) => `<div class="fc-fbar ${i === 0 ? 'today' : ''}" title="${i === 0 ? 'Today' : fmtDate(f.d, { weekday: 'long' })}: ${f.n} due"><span class="fc-fbar-n">${f.n || ''}</span><span class="fc-fbar-fill" style="height:${f.n ? 6 + (f.n / maxF) * 46 : 2}px"></span><em>${i === 0 ? 'Today' : fmtDate(f.d, { weekday: 'short' })}</em></div>`).join('')}</div>
      </div>
    </div>
    <div class="grid grid-3">${decks.map(deckCard).join('')}</div>`
    : `<div class="card welcome-inline">
        <div class="sg-feature-ic">${icon('layers', 18, 1.7)}</div>
        <div style="flex:1;min-width:220px"><div class="sg-strong">Make your first deck</div><div class="small muted">Build one by hand, paste a list of terms, or turn any note into flashcards automatically. Semester HQ schedules each card so you review it right before you’d forget.</div></div>
        <div class="flex-gap wrap">${aiButton('Make from a note', 'openGenerateDeckModal()')}<button class="btn btn-primary btn-sm" onclick="openDeckModal()">+ New deck</button></div>
      </div>`}
  `;
}
function deckCard(d) {
  const p = deckProgress(d);
  const due = srsDueCount(d);
  const n = d.cards.length || 1;
  const c = getCourse(d.courseId);
  return `
    <div class="card fc-deck" style="--course:${esc(c?.color || '#5a6b7b')}">
      <div class="flex-between" style="align-items:flex-start;gap:8px">
        <div style="min-width:0">
          <div class="fc-deck-name">${esc(d.name)}</div>
          <div class="small muted">${c ? `<span class="course-dot"></span> ${esc(c.code || c.name)} · ` : ''}${d.cards.length} card${d.cards.length === 1 ? '' : 's'}</div>
        </div>
        ${due ? `<span class="fc-due">${due} due</span>` : d.cards.length ? `<span class="fc-done">${icon('check', 11, 2.4)}</span>` : ''}
      </div>
      ${d.cards.length ? `
        <div class="fc-mastery" title="${p.mastered} mastered · ${p.learning} learning · ${p.newCount} new">
          <span style="width:${p.mastered / n * 100}%" class="m"></span><span style="width:${p.learning / n * 100}%" class="l"></span>
        </div>
        <div class="fc-legend small muted"><span><i class="m"></i>${p.mastered} mastered</span><span><i class="l"></i>${p.learning} learning</span><span><i></i>${p.newCount} new</span></div>` : `<p class="small muted mt-8">No cards yet.</p>`}
      <div class="flex-gap mt-16">
        <button class="btn btn-sm ${due ? 'btn-primary' : ''}" onclick="${due ? `openReview(['${d.id}'])` : `openStudyMode('${d.id}')`}" ${d.cards.length ? '' : 'disabled'}>${due ? 'Review' : 'Browse'}</button>
        ${due ? `<button class="btn btn-sm" onclick="openStudyMode('${d.id}')" ${d.cards.length ? '' : 'disabled'}>Browse</button>` : ''}
        <button class="btn btn-sm" onclick="openDeckModal('${d.id}')">Edit</button>
        <span style="flex:1"></span>
        <button class="btn btn-ghost btn-icon btn-sm" onclick="shareDeckToGroup('${d.id}')" title="Share to a study group" aria-label="Share ${esc(d.name)} to a study group">${icon('users', 14)}</button>
        <button class="btn btn-ghost btn-icon btn-sm" aria-label="Delete ${esc(d.name)}" onclick="deleteDeck('${d.id}')">${icon('trash', 14)}</button>
      </div>
    </div>`;
}

/* ── Deck editor ───────────────────────────────────────────────── */
function openDeckModal(id, presetCourseId) {
  const d = id ? state.decks.find(x => x.id === id) : { id: uid(), name: '', courseId: presetCourseId || null, cards: [] };
  window._deckDraft = JSON.parse(JSON.stringify(d));
  if (!id && !window._deckDraft.cards.length) window._deckDraft.cards.push({ id: uid(), front: '', back: '' });
  renderDeckModal(id);
}
function renderDeckModal(id) {
  const d = _deckDraft;
  const existing = id || (state.decks.some(x => x.id === d.id) ? d.id : '');
  openModal(`
    <div class="modal-head"><h3>${existing ? 'Edit deck' : 'New deck'}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="field-row">
        <div class="field"><label for="df-name">Deck name</label><input class="input" id="df-name" value="${esc(d.name)}" placeholder="Chapter 4 vocab" oninput="_deckDraft.name=this.value"></div>
        <div class="field"><label for="df-course">Class</label><select class="select" id="df-course" onchange="_deckDraft.courseId=this.value||null"><option value="">None</option>${activeCourses().map(c => `<option value="${c.id}" ${c.id === d.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Cards (${d.cards.length})</label>
        <div id="df-cards">${d.cards.map((c, i) => cardRow(c, i, existing)).join('')}</div>
        <div class="flex-gap wrap mt-8">
          <button class="btn btn-sm" onclick="_deckDraft.cards.push({id:uid(),front:'',back:''});renderDeckModal('${existing}');setTimeout(()=>$$('#df-cards .fc-edit-front').at(-1)?.focus(),60)">+ Add card</button>
          <button class="btn btn-sm btn-ghost" onclick="$('#df-bulk-wrap').hidden=!$('#df-bulk-wrap').hidden">Paste a list</button>
        </div>
        <div id="df-bulk-wrap" hidden class="mt-8">
          <textarea class="input" id="df-bulk" placeholder="One card per line. Separate the front and back with a tab, a dash, or a colon:&#10;Mitochondria - powerhouse of the cell&#10;Osmosis: diffusion of water across a membrane"></textarea>
          <button class="btn btn-sm mt-8" onclick="importBulkCards('${existing}')">Add these cards</button>
        </div>
      </div>
    </div>
    <div class="modal-foot">
      ${existing ? `<button class="btn btn-danger" style="margin-right:auto" onclick="deleteDeck('${existing}')">Delete</button>` : ''}
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveDeckModal(${existing ? `'${existing}'` : 'null'})">Save</button>
    </div>
  `, { wide: true });
}
function cardRow(c, i, existing) {
  return `<div class="fc-edit-row">
    <textarea class="input fc-edit-front" rows="1" placeholder="Front" oninput="_deckDraft.cards[${i}].front=this.value">${esc(c.front)}</textarea>
    <textarea class="input" rows="1" placeholder="Back" oninput="_deckDraft.cards[${i}].back=this.value">${esc(c.back)}</textarea>
    <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove card" onclick="_deckDraft.cards.splice(${i},1);renderDeckModal('${existing}')">${icon('x', 13, 2.2)}</button>
  </div>`;
}
function importBulkCards(existing) {
  const lines = ($('#df-bulk').value || '').split('\n').map(l => l.trim()).filter(Boolean);
  let added = 0;
  lines.forEach(line => {
    const m = line.match(/^(.+?)(?:\t|\s+[-–—]\s+|\s*:\s+)(.+)$/);
    if (!m) return;
    _deckDraft.cards.push({ id: uid(), front: m[1].trim(), back: m[2].trim() });
    added++;
  });
  _deckDraft.cards = _deckDraft.cards.filter(c => c.front.trim() || c.back.trim());
  renderDeckModal(existing);
  toast(added ? `Added ${added} card${added === 1 ? '' : 's'}` : 'Couldn’t find any “front - back” lines', added ? 'success' : 'error');
}
function saveDeckModal(id) {
  const d = _deckDraft;
  d.name = $('#df-name').value.trim() || 'Untitled deck';
  d.courseId = $('#df-course').value || null;
  d.cards = d.cards.filter(c => (c.front || '').trim() || (c.back || '').trim());
  if (id) { const i = state.decks.findIndex(x => x.id === id); state.decks[i] = d; } else state.decks.push(d);
  touch(); closeModal(); toast(id ? 'Deck updated' : `Deck created with ${d.cards.length} card${d.cards.length === 1 ? '' : 's'}`);
}
function deleteDeck(id) {
  confirmDialog('Delete this deck? You can restore it from Recently Deleted for 30 days.', () => {
    const d = state.decks.find(x => x.id === id);
    if (d) trashItem('deck', d.name || 'Untitled deck', d);
    state.decks = state.decks.filter(x => x.id !== id);
    touch(); closeModal();
  });
}
function shareDeckToGroup(id) {
  const d = state.decks.find(x => x.id === id);
  if (!d) return;
  openShareToGroupModal('deck', d.name || 'Untitled deck', { cards: d.cards.map(c => ({ front: c.front, back: c.back })) });
}

/* ── Review session ────────────────────────────────────────────── */
window._review = null;
function openReview(deckIds) {
  const decks = deckIds && deckIds.length ? state.decks.filter(d => deckIds.includes(d.id)) : visibleDecks();
  const t = todayIso();
  const due = [], fresh = [];
  decks.forEach(d => d.cards.forEach(c => {
    if (isDueCard(c, t)) due.push({ deckId: d.id, cardId: c.id, due: srsState(c).due });
    else if (isNewCard(c)) fresh.push({ deckId: d.id, cardId: c.id });
  }));
  due.sort((a, b) => a.due.localeCompare(b.due));
  const queue = [...due, ...fresh.slice(0, newAllowance())];
  if (!queue.length) {
    if (decks.length === 1 && decks[0].cards.length) { openStudyMode(decks[0].id); toast('Nothing due in this deck, so here’s browse mode.', 'info'); }
    else toast('Nothing to review right now. You’re caught up.', 'info');
    return;
  }
  window._review = { queue, index: 0, flipped: false, counts: { 1: 0, 2: 0, 3: 0, 4: 0 }, startedAt: Date.now(), total: queue.length };
  document.addEventListener('keydown', reviewKeydown);
  renderReview();
}
function reviewCurrent() {
  const r = window._review;
  const item = r?.queue[r.index];
  if (!item) return null;
  const deck = state.decks.find(d => d.id === item.deckId);
  const card = deck?.cards.find(c => c.id === item.cardId);
  return card ? { deck, card } : null;
}
function renderReview() {
  const r = window._review;
  if (!r) return;
  const cur = reviewCurrent();
  if (!cur) { renderReviewSummary(); return; }
  const { deck, card } = cur;
  const c = getCourse(deck.courseId);
  const left = r.queue.length - r.index;
  const done = r.total - left;
  const isNew = isNewCard(card);
  openModal(`
    <div class="modal-head">
      <h3 class="fc-review-title"><span class="course-dot" style="--course:${esc(c?.color || '#5a6b7b')}"></span> ${esc(deck.name)}</h3>
      <div class="flex-gap" style="align-items:center"><span class="small muted">${left} left</span><button class="close-x" aria-label="End review" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    </div>
    <div class="fc-review-progress"><div style="width:${r.total ? (done / r.total) * 100 : 0}%"></div></div>
    <div class="modal-body">
      <div class="fc-review-card ${r.flipped ? 'is-flipped' : ''}" ${r.flipped ? '' : 'onclick="flipReview()"'}>
        ${isNew ? `<span class="fc-badge">New</span>` : ''}
        <div class="fc-review-front">${esc(card.front)}</div>
        ${r.flipped ? `<div class="fc-review-divider"></div><div class="fc-review-back">${esc(card.back)}</div>` : `<div class="fc-review-hint small muted">Tap or press Space to show the answer</div>`}
      </div>
      ${r.flipped ? `
        <div class="fc-ratings">${SRS_RATINGS.map(([v, label]) => {
          const next = srsNext(card, v);
          return `<button class="fc-rate fc-rate-${v}" onclick="rateReview(${v})"><span class="fc-rate-label">${label}</span><span class="fc-rate-int">${fmtInterval(next.interval)}</span><kbd>${v}</kbd></button>`;
        }).join('')}</div>`
      : `<button class="btn btn-primary fc-show" onclick="flipReview()">Show answer <kbd>Space</kbd></button>`}
    </div>
  `, { wide: true, onClose: endReview });
}
function flipReview() { if (window._review) { window._review.flipped = true; renderReview(); } }
function rateReview(rating) {
  const r = window._review;
  const cur = reviewCurrent();
  if (!r || !cur) return;
  const wasNew = isNewCard(cur.card);
  cur.card.srs = srsNext(cur.card, rating);
  cur.card.mastery = masteryFromSrs(cur.card.srs);
  const daily = srsDaily();
  daily.reviewed++;
  logReview();
  if (wasNew) daily.newSeen++;
  r.counts[rating]++;
  playUiSound(rating === 1 ? 'tap' : 'complete');
  // Forgotten cards come back a few cards later in the same session.
  if (rating === 1) r.queue.splice(Math.min(r.queue.length, r.index + 4), 0, { deckId: cur.deck.id, cardId: cur.card.id });
  r.index++;
  r.flipped = false;
  save();
  renderReview();
}
function reviewKeydown(e) {
  if (!window._review || !$('#modal-wrap').classList.contains('show')) return;
  if (e.target?.matches?.('input, textarea, select')) return;
  if ((e.key === ' ' || e.key === 'Enter') && !window._review.flipped && reviewCurrent()) { e.preventDefault(); flipReview(); }
  else if (window._review.flipped && ['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); rateReview(Number(e.key)); }
}
function renderReviewSummary() {
  const r = window._review;
  if (!r.celebrated) { r.celebrated = true; playUiSound('success'); }
  const reviewed = r.counts[1] + r.counts[2] + r.counts[3] + r.counts[4];
  const remembered = reviewed ? Math.round(((r.counts[2] + r.counts[3] + r.counts[4]) / reviewed) * 100) : 0;
  const mins = Math.max(1, Math.round((Date.now() - r.startedAt) / 60000));
  const tomorrow = visibleDecks().reduce((s, d) => s + d.cards.filter(c => { const st = srsState(c); return st && st.due === addDays(todayIso(), 1); }).length, 0);
  openModal(`
    <div class="modal-head"><h3>Review complete</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="setup-done">
        <div class="setup-done-mark">${icon('check', 26, 2.4)}</div>
        <h3 class="welcome-title" style="font-size:30px">Nice work.</h3>
        <p class="muted">${reviewed} review${reviewed === 1 ? '' : 's'} in ${mins} min · you remembered ${remembered}%</p>
        <div class="hub-stats mt-16" style="text-align:left">
          <div class="hub-stat"><strong>${r.counts[1]}</strong><span>Again</span></div>
          <div class="hub-stat"><strong>${r.counts[2]}</strong><span>Hard</span></div>
          <div class="hub-stat"><strong>${r.counts[3]}</strong><span>Good</span></div>
          <div class="hub-stat"><strong>${r.counts[4]}</strong><span>Easy</span></div>
        </div>
        <p class="small muted mt-16">${tomorrow ? `${tomorrow} card${tomorrow === 1 ? '' : 's'} coming back tomorrow.` : 'Nothing scheduled for tomorrow yet.'}</p>
      </div>
    </div>
    <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">Done</button></div>
  `, { onClose: endReview });
}
function endReview() {
  document.removeEventListener('keydown', reviewKeydown);
  const had = !!window._review;
  window._review = null;
  if (had) touch();
}

/* ── Browse (flip through) and self-test ───────────────────────── */
window._study = { deckId: null, idx: 0, flipped: false, mode: 'flip', starredOnly: false, testResult: null };
function openStudyMode(deckId) { window._study = { deckId, idx: 0, flipped: false, mode: 'flip', starredOnly: false, testResult: null }; renderStudyMode(); }
function studyCards() {
  const deck = state.decks.find(d => d.id === window._study.deckId);
  const cards = window._study.starredOnly ? deck.cards.filter(c => c.starred) : deck.cards;
  return { deck, cards };
}
function setStudyMode(mode) { window._study.mode = mode; window._study.idx = 0; window._study.flipped = false; window._study.testResult = null; renderStudyMode(); }
function toggleStarredOnly() { window._study.starredOnly = !window._study.starredOnly; window._study.idx = 0; window._study.flipped = false; renderStudyMode(); }
function toggleCardStar() {
  const { cards } = studyCards();
  const card = cards[window._study.idx];
  if (card) { card.starred = !card.starred; save(); renderStudyMode(); }
}
function renderStudyMode() {
  const { deck, cards } = studyCards();
  if (!cards.length) {
    openModal(`
      <div class="modal-head"><h3>${esc(deck.name)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
      <div class="modal-body">${emptyState(icon('star', 24, 1.4), window._study.starredOnly ? 'No starred cards yet.' : 'This deck has no cards.')}</div>
      <div class="modal-foot"><button class="btn" onclick="toggleStarredOnly()">${window._study.starredOnly ? 'Show all cards' : 'Show starred only'}</button></div>
    `);
    return;
  }
  const idx = clamp(window._study.idx, 0, cards.length - 1);
  window._study.idx = idx;
  const card = cards[idx];
  const mode = window._study.mode;
  const due = srsDueCount(deck);
  openModal(`
    <div class="modal-head"><h3>${esc(deck.name)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="flex-between mb-8">
        <div class="segmented">
          <button class="${mode === 'flip' ? 'active' : ''}" onclick="setStudyMode('flip')">Browse</button>
          <button class="${mode === 'test' ? 'active' : ''}" onclick="setStudyMode('test')">Test yourself</button>
        </div>
        <button class="btn btn-icon btn-sm ${card.starred ? 'btn-primary' : ''}" onclick="toggleCardStar()" title="Star as difficult" aria-pressed="${!!card.starred}" aria-label="Star as difficult">${icon('star', 14)}</button>
      </div>
      <div class="small muted mb-8" style="text-align:center">${idx + 1} / ${cards.length}${window._study.starredOnly ? ' · starred only' : ''}</div>
      ${mode === 'flip' ? `
        <div class="flip-card ${window._study.flipped ? 'flipped' : ''}" onclick="_study.flipped=!_study.flipped;renderStudyMode()">
          <div class="flip-inner">
            <div class="flip-face">${esc(card.front)}</div>
            <div class="flip-face back">${esc(card.back)}</div>
          </div>
        </div>
        <div class="small muted mt-8" style="text-align:center">Click the card to flip it. Browsing doesn’t change your review schedule.</div>
      ` : `
        <div class="card card-pad" style="text-align:center;font-size:16px;font-weight:600">${esc(card.front)}</div>
        <input class="input mt-8" id="test-input" placeholder="Type the answer…" value="${esc(window._study.testInputVal || '')}" oninput="window._study.testInputVal=this.value" onkeydown="if(event.key==='Enter')checkTestAnswer()">
        ${window._study.testResult ? `
          <div class="small mt-8" style="text-align:center;font-weight:600">${window._study.testResult === 'correct' ? 'Correct!' : `Answer: ${esc(card.back)}`}</div>
          <div class="flex-gap mt-16" style="justify-content:center">
            <button class="btn" onclick="gradeTestCard(1)">I missed it</button>
            <button class="btn btn-primary" onclick="gradeTestCard(3)">I knew it</button>
          </div>
        ` : `<button class="btn btn-primary mt-8" onclick="checkTestAnswer()" style="width:100%">Check answer</button>`}
      `}
    </div>
    <div class="modal-foot" style="justify-content:space-between">
      <div class="flex-gap">
        <button class="btn btn-sm" onclick="toggleStarredOnly()">${window._study.starredOnly ? 'Show all' : 'Starred only'}</button>
        ${due ? `<button class="btn btn-sm" onclick="closeModal();openReview(['${deck.id}'])">Review ${due} due</button>` : ''}
      </div>
      <div class="flex-gap">
        <button class="btn" onclick="studyNav(-1)" ${idx === 0 ? 'disabled' : ''}>← Prev</button>
        <button class="btn" onclick="shuffleDeck()">${icon('shuffle', 13, 2)} Shuffle</button>
        <button class="btn btn-primary" onclick="studyNav(1)" ${idx === cards.length - 1 ? 'disabled' : ''}>Next →</button>
      </div>
    </div>
  `);
  if (mode === 'test') setTimeout(() => { const el = $('#test-input'); if (el && !window._study.testResult) el.focus(); }, 0);
}
function checkTestAnswer() {
  const { cards } = studyCards();
  const card = cards[window._study.idx];
  const norm = (v) => String(v || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const given = norm(window._study.testInputVal);
  window._study.testResult = given && given === norm(card.back) ? 'correct' : 'incorrect';
  renderStudyMode();
}
// Self-testing counts as a review, so it feeds the same schedule.
function gradeTestCard(rating) {
  const { cards } = studyCards();
  const card = cards[window._study.idx];
  if (card) { card.srs = srsNext(card, rating); card.mastery = masteryFromSrs(card.srs); srsDaily().reviewed++; logReview(); save(); }
  if (window._study.idx < cards.length - 1) studyNav(1); else { closeModal(); touch(); toast('End of the deck'); }
}
function studyNav(dir) {
  const { cards } = studyCards();
  window._study.idx = clamp(window._study.idx + dir, 0, cards.length - 1);
  window._study.flipped = false; window._study.testResult = null; window._study.testInputVal = '';
  renderStudyMode();
}
function shuffleDeck() {
  const deck = state.decks.find(d => d.id === window._study.deckId);
  for (let i = deck.cards.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck.cards[i], deck.cards[j]] = [deck.cards[j], deck.cards[i]]; }
  window._study.idx = 0; window._study.flipped = false; save(); renderStudyMode();
}

/* ── Make flashcards from a note (or pasted text) ─────────────── */
const FLASHCARDS_SYSTEM = `You write study flashcards from a student's class notes. Reply with ONLY a JSON array (no prose, no markdown fences) of objects: [{"front": string, "back": string}].
Rules: one idea per card; fronts are short questions or terms; backs are concise answers (under 30 words); cover the most important facts, definitions, and relationships in the material; no duplicates; do not invent facts that aren't in the material; aim for 8 to 25 cards depending on how much material there is.`;
function openGenerateDeckModal(noteId) {
  const notes = state.notes.filter(n => n.type === 'note' && plainTextOfNoteSafe(n).trim().length > 40).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const pre = noteId ? state.notes.find(n => n.id === noteId) : null;
  window._genDeck = { source: notes.length || pre ? 'note' : 'text', noteId: pre?.id || notes[0]?.id || null, cards: null };
  openModal(`
    <div class="modal-head"><h3>Make flashcards <span class="ai-badge">AI</span></h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <p class="small muted mb-16">Semester HQ reads your notes and writes question-and-answer cards. You’ll review them before the deck is created.</p>
      <div class="segmented mb-16">
        <button class="${window._genDeck.source === 'note' ? 'active' : ''}" onclick="window._genDeck.source='note';openGenerateDeckModalRefresh()">From a note</button>
        <button class="${window._genDeck.source === 'text' ? 'active' : ''}" onclick="window._genDeck.source='text';openGenerateDeckModalRefresh()">Paste text</button>
      </div>
      <div id="gd-source">${generateSourceFields(notes, pre)}</div>
      <div class="field-row">
        <div class="field"><label for="gd-name">Deck name</label><input class="input" id="gd-name" value="${esc(pre ? pre.name : '')}" placeholder="Chapter 5 review"></div>
        <div class="field"><label for="gd-course">Class</label><select class="select" id="gd-course"><option value="">None</option>${activeCourses().map(c => `<option value="${c.id}" ${pre && c.id === pre.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" id="gd-go" onclick="runGenerateDeck()">${icon('sparkles', 13, 1.5)} Make flashcards</button></div>
  `, { wide: true });
}
function openGenerateDeckModalRefresh() {
  const notes = state.notes.filter(n => n.type === 'note' && plainTextOfNoteSafe(n).trim().length > 40).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  $('#gd-source').innerHTML = generateSourceFields(notes, state.notes.find(n => n.id === window._genDeck.noteId));
  $$('.modal-body .segmented button').forEach((b, i) => b.classList.toggle('active', (i === 0) === (window._genDeck.source === 'note')));
}
function generateSourceFields(notes, pre) {
  if (window._genDeck.source === 'note') {
    if (!notes.length) return `<p class="small muted mb-16">You don’t have any notes with enough text yet. Paste text instead.</p>`;
    return `<div class="field"><label for="gd-note">Note</label><select class="select" id="gd-note" onchange="window._genDeck.noteId=this.value;const n=state.notes.find(x=>x.id===this.value);if(n&&!$('#gd-name').value)$('#gd-name').value=n.name||''">${notes.map(n => `<option value="${n.id}" ${n.id === (pre?.id || window._genDeck.noteId) ? 'selected' : ''}>${esc(n.name || 'Untitled note')}</option>`).join('')}</select></div>`;
  }
  return `<div class="field"><label for="gd-text">Material</label><textarea class="input" id="gd-text" style="min-height:160px" placeholder="Paste lecture notes, a study guide, or a reading summary"></textarea></div>`;
}
function plainTextOfNoteSafe(n) { return String(n.content || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' '); }
async function runGenerateDeck() {
  const g = window._genDeck;
  let text = '';
  if (g.source === 'note') {
    const n = state.notes.find(x => x.id === ($('#gd-note')?.value || g.noteId));
    text = n ? `${n.name}\n\n${plainTextOfNoteSafe(n)}` : '';
  } else text = ($('#gd-text')?.value || '').trim();
  if (text.trim().length < 40) { toast('Add a bit more material to make cards from', 'error'); return; }
  if (!navigator.onLine) { toast('You’re offline. Making flashcards needs a connection.', 'error'); return; }
  const name = $('#gd-name').value.trim() || 'New deck';
  const courseId = $('#gd-course').value || null;
  const btn = $('#gd-go');
  setBtnLoading(btn, true);
  try {
    const raw = await callClaude({ system: FLASHCARDS_SYSTEM, userContent: `Material:\n\n${text.slice(0, 14000)}`, maxTokens: 3000 });
    const cards = extractJson(raw).filter(c => c && c.front && c.back).slice(0, 60).map(c => ({ id: uid(), front: String(c.front).trim(), back: String(c.back).trim(), _include: true }));
    if (!cards.length) throw new Error('Couldn’t find enough to make cards from. Try a longer note.');
    window._genDeck = { ...g, name, courseId, cards };
    renderGeneratedReview();
  } catch (e) {
    setBtnLoading(btn, false);
    toast(e.message || 'Couldn’t make flashcards', 'error', 5000);
  }
}
function renderGeneratedReview() {
  const g = window._genDeck;
  const count = g.cards.filter(c => c._include).length;
  openModal(`
    <div class="modal-head"><h3>Review your cards <span class="ai-badge">AI</span></h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <p class="small muted mb-16">Edit anything that’s off, and uncheck cards you don’t want.</p>
      ${g.cards.map((c, i) => `
        <div class="fc-gen-row ${c._include ? '' : 'is-off'}">
          <button type="button" class="row-check ${c._include ? 'checked' : ''}" role="checkbox" aria-checked="${c._include}" aria-label="Include card ${i + 1}" onclick="window._genDeck.cards[${i}]._include=!window._genDeck.cards[${i}]._include;renderGeneratedReview()">${c._include ? checkGlyph(true) : ''}</button>
          <textarea class="input" rows="2" oninput="window._genDeck.cards[${i}].front=this.value">${esc(c.front)}</textarea>
          <textarea class="input" rows="2" oninput="window._genDeck.cards[${i}].back=this.value">${esc(c.back)}</textarea>
        </div>`).join('')}
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="commitGeneratedDeck()" ${count ? '' : 'disabled'}>Create deck with ${count} card${count === 1 ? '' : 's'}</button></div>
  `, { wide: true });
}
function commitGeneratedDeck() {
  const g = window._genDeck;
  const deck = { id: uid(), name: g.name, courseId: g.courseId, cards: g.cards.filter(c => c._include && c.front.trim() && c.back.trim()).map(({ _include, ...c }) => c) };
  state.decks.push(deck);
  closeModal();
  setState({ route: 'studytools', subRoute: null });
  toast(`Created “${deck.name}” with ${deck.cards.length} cards`);
}
