/* ── Flashcards: decks ────────────────────────────────────────────── */
function pageStudyTools() {
  const decks = state.decks.filter(d => !d.courseId || activeCourses().some(c => c.id === d.courseId));
  const totalCards = decks.reduce((s, d) => s + d.cards.length, 0);
  const coursesLinked = new Set(decks.map(d => d.courseId).filter(Boolean)).size;
  return `
    ${pageHead('Flashcards', 'Build decks and study', `
      <button class="btn btn-primary" onclick="openDeckModal()">+ New deck</button>
    `)}
    <div class="grid grid-3 mb-16">
      <div class="stat-card"><div class="num">${decks.length}</div><div class="lbl">Decks</div></div>
      <div class="stat-card"><div class="num">${totalCards}</div><div class="lbl">Total cards</div></div>
      <div class="stat-card"><div class="num">${coursesLinked}</div><div class="lbl">Courses covered</div></div>
    </div>
    ${decks.length ? `<div class="grid grid-3">${decks.map(deckCard).join('')}</div>` : emptyState(icon('layers',26,1.4), 'No flashcard decks yet', `<button class="btn btn-primary mt-8" onclick="openDeckModal()">+ New deck</button>`, 'Build one by hand to start studying.')}
  `;
}
function deckProgress(d) {
  const mastered = d.cards.filter(c => c.mastery === 'mastered').length;
  const learning = d.cards.filter(c => c.mastery === 'learning').length;
  const newCount = d.cards.length - mastered - learning;
  return { mastered, learning, newCount };
}
function deckCard(d) {
  const p = deckProgress(d);
  return `
    <div class="card card-pad">
      <div style="font-weight:700">${esc(d.name)}</div>
      ${d.courseId ? courseChip(d.courseId) : ''}
      <div class="small muted mt-8">${d.cards.length} card${d.cards.length === 1 ? '' : 's'}</div>
      ${d.cards.length ? `
      <div class="progress mt-8" style="display:flex;overflow:hidden">
        <div style="width:${p.mastered / d.cards.length * 100}%;background:var(--success, #2e7d32)"></div>
        <div style="width:${p.learning / d.cards.length * 100}%;background:var(--warn, #b8860b)"></div>
      </div>
      <div class="small muted mt-8">Mastered: ${p.mastered} · Learning: ${p.learning} · New: ${p.newCount}</div>
      ` : ''}
      <div class="flex-gap mt-16">
        <button class="btn btn-primary btn-sm" onclick="openStudyMode('${d.id}')" ${d.cards.length ? '' : 'disabled'}>Study</button>
        <button class="btn btn-sm" onclick="openDeckModal('${d.id}')">Edit</button>
        <button class="btn btn-ghost btn-icon btn-sm" onclick="shareDeckToGroup('${d.id}')" title="Share to group" aria-label="Share ${esc(d.name)} to group">${icon('users',14)}</button>
        <button class="btn btn-ghost btn-icon btn-sm" aria-label="Delete ${esc(d.name)}" onclick="deleteDeck('${d.id}')">${icon('trash',14)}</button>
      </div>
    </div>
  `;
}
function openDeckModal(id) {
  const d = id ? state.decks.find(x => x.id === id) : { id: uid(), name: '', courseId: null, cards: [] };
  window._deckDraft = JSON.parse(JSON.stringify(d));
  renderDeckModal(id);
}
function renderDeckModal(id) {
  const d = _deckDraft;
  openModal(`
    <div class="modal-head"><h3>${id ? 'Edit deck' : 'New deck'}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="field-row">
        <div class="field"><label>Deck name</label><input class="input" id="df-name" value="${esc(d.name)}"></div>
        <div class="field"><label>Course</label><select class="select" id="df-course"><option value="">—</option>${activeCourses().map(c => `<option value="${c.id}" ${c.id === d.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Cards</label>
        <div id="df-cards">${d.cards.map((c, i) => cardRow(c, i)).join('')}</div>
        <button class="btn btn-sm mt-8" onclick="_deckDraft.cards.push({id:uid(),front:'',back:'',mastery:'new',starred:false});renderDeckModal('${id || ''}')">+ Add card</button>
      </div>
    </div>
    <div class="modal-foot">
      ${id ? `<button class="btn btn-danger" onclick="deleteDeck('${id}')">Delete</button>` : ''}
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveDeckModal(${id ? `'${id}'` : 'null'})">Save</button>
    </div>
  `, { wide: true });
}
function cardRow(c, i) {
  return `<div class="field-row" style="margin-bottom:6px">
    <input class="input" value="${esc(c.front)}" placeholder="Front" oninput="_deckDraft.cards[${i}].front=this.value">
    <input class="input" value="${esc(c.back)}" placeholder="Back" oninput="_deckDraft.cards[${i}].back=this.value">
    <button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove card" onclick="_deckDraft.cards.splice(${i},1);renderDeckModal()">${icon('x',13,2.2)}</button>
  </div>`;
}
function saveDeckModal(id) {
  const d = _deckDraft;
  d.name = $('#df-name').value.trim() || 'Untitled deck';
  d.courseId = $('#df-course').value || null;
  if (id) { const i = state.decks.findIndex(x => x.id === id); state.decks[i] = d; } else state.decks.push(d);
  touch(); closeModal(); toast(id ? 'Deck updated' : 'Deck created');
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
  if (card) { card.starred = !card.starred; touch(); renderStudyMode(); }
}
function markCardMastery(level) {
  const { deck, cards } = studyCards();
  const card = cards[window._study.idx];
  if (card) card.mastery = level;
  touch();
  if (window._study.idx < cards.length - 1) { studyNav(1); } else { renderStudyMode(); }
}
function renderStudyMode() {
  const { deck, cards } = studyCards();
  if (!cards.length) {
    openModal(`
      <div class="modal-head"><h3>${esc(deck.name)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
      <div class="modal-body">${emptyState(icon('star',24,1.4), window._study.starredOnly ? 'No starred cards yet.' : 'This deck has no cards.')}</div>
      <div class="modal-foot"><button class="btn" onclick="toggleStarredOnly()">${window._study.starredOnly ? 'Show all cards' : 'Show starred only'}</button></div>
    `);
    return;
  }
  const idx = clamp(window._study.idx, 0, cards.length - 1);
  window._study.idx = idx;
  const card = cards[idx];
  const mode = window._study.mode;
  openModal(`
    <div class="modal-head"><h3>${esc(deck.name)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="flex-between mb-8">
        <div class="segmented">
          <button class="${mode === 'flip' ? 'active' : ''}" onclick="setStudyMode('flip')">Flip cards</button>
          <button class="${mode === 'learn' ? 'active' : ''}" onclick="setStudyMode('learn')">Learn</button>
          <button class="${mode === 'test' ? 'active' : ''}" onclick="setStudyMode('test')">Test yourself</button>
        </div>
        <button class="btn btn-icon btn-sm ${card.starred ? 'btn-primary' : ''}" onclick="toggleCardStar()" title="Star as difficult" aria-pressed="${!!card.starred}" aria-label="Star as difficult">${icon('star',14)}</button>
      </div>
      <div class="small muted mb-8" style="text-align:center">${idx + 1} / ${cards.length}${window._study.starredOnly ? ' · starred only' : ''}</div>

      ${mode === 'flip' ? `
        <div class="flip-card ${window._study.flipped ? 'flipped' : ''}" onclick="_study.flipped=!_study.flipped;renderStudyMode()">
          <div class="flip-inner">
            <div class="flip-face">${esc(card.front)}</div>
            <div class="flip-face back">${esc(card.back)}</div>
          </div>
        </div>
        <div class="small muted mt-8" style="text-align:center">Click card to flip</div>
      ` : ''}

      ${mode === 'learn' ? `
        <div class="flip-card ${window._study.flipped ? 'flipped' : ''}" onclick="_study.flipped=!_study.flipped;renderStudyMode()">
          <div class="flip-inner">
            <div class="flip-face">${esc(card.front)}</div>
            <div class="flip-face back">${esc(card.back)}</div>
          </div>
        </div>
        ${window._study.flipped ? `
        <div class="flex-gap mt-16" style="justify-content:center">
          <button class="btn" onclick="markCardMastery('learning')">Still learning</button>
          <button class="btn btn-primary" onclick="markCardMastery('mastered')">Got it</button>
        </div>` : `<div class="small muted mt-8" style="text-align:center">Click card to reveal the answer</div>`}
      ` : ''}

      ${mode === 'test' ? `
        <div class="card card-pad" style="text-align:center;font-size:16px;font-weight:600">${esc(card.front)}</div>
        <input class="input mt-8" id="test-input" placeholder="Type the answer…" value="${esc(window._study.testInputVal || '')}" oninput="window._study.testInputVal=this.value" onkeydown="if(event.key==='Enter')checkTestAnswer()">
        ${window._study.testResult ? `
          <div class="small mt-8" style="text-align:center;color:${window._study.testResult === 'correct' ? 'var(--success,#2e7d32)' : 'var(--danger)'}">${window._study.testResult === 'correct' ? 'Correct!' : `Answer: ${esc(card.back)}`}</div>
          <div class="flex-gap mt-16" style="justify-content:center">
            <button class="btn" onclick="markCardMastery('learning')">Still learning</button>
            <button class="btn btn-primary" onclick="markCardMastery('mastered')">Got it</button>
          </div>
        ` : `<button class="btn btn-primary mt-8" onclick="checkTestAnswer()" style="width:100%">Check answer</button>`}
      ` : ''}
    </div>
    <div class="modal-foot" style="justify-content:space-between">
      <button class="btn btn-sm" onclick="toggleStarredOnly()">${window._study.starredOnly ? 'Show all' : 'Starred only'}</button>
      <div class="flex-gap">
        <button class="btn" onclick="studyNav(-1)" ${idx === 0 ? 'disabled' : ''}>← Prev</button>
        <button class="btn" onclick="shuffleDeck()">${icon('shuffle',13,2)} Shuffle</button>
        <button class="btn btn-primary" onclick="studyNav(1)" ${idx === cards.length - 1 ? 'disabled' : ''}>Next →</button>
      </div>
    </div>
  `);
  if (mode === 'test') setTimeout(() => { const el = $('#test-input'); if (el) el.focus(); }, 0);
}
function checkTestAnswer() {
  const { cards } = studyCards();
  const card = cards[window._study.idx];
  const given = (window._study.testInputVal || '').trim().toLowerCase();
  window._study.testResult = given && given === (card.back || '').trim().toLowerCase() ? 'correct' : 'incorrect';
  renderStudyMode();
}
function studyNav(dir) {
  const { cards } = studyCards();
  window._study.idx = clamp(window._study.idx + dir, 0, cards.length - 1);
  window._study.flipped = false; window._study.testResult = null; window._study.testInputVal = '';
  renderStudyMode();
}
function shuffleDeck() {
  const deck = state.decks.find(d => d.id === window._study.deckId);
  for (let i = deck.cards.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[deck.cards[i], deck.cards[j]] = [deck.cards[j], deck.cards[i]]; }
  window._study.idx = 0; window._study.flipped = false; touch(); renderStudyMode();
}
