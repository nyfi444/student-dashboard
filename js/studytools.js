/* ── Study Tools: flashcard decks ────────────────────────────────── */
function pageStudyTools() {
  const decks = state.decks.filter(d => !d.courseId || activeCourses().some(c => c.id === d.courseId));
  const totalCards = decks.reduce((s, d) => s + d.cards.length, 0);
  const coursesLinked = new Set(decks.map(d => d.courseId).filter(Boolean)).size;
  return `
    ${pageHead('Study Tools', 'Flashcards for studying', `
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
function deckCard(d) {
  return `
    <div class="card card-pad">
      <div style="font-weight:700">${esc(d.name)}</div>
      ${d.courseId ? courseChip(d.courseId) : ''}
      <div class="small muted mt-8">${d.cards.length} card${d.cards.length === 1 ? '' : 's'}</div>
      <div class="flex-gap mt-16">
        <button class="btn btn-primary btn-sm" onclick="openStudyMode('${d.id}')" ${d.cards.length ? '' : 'disabled'}>Study</button>
        <button class="btn btn-sm" onclick="openDeckModal('${d.id}')">Edit</button>
        <button class="btn btn-ghost btn-icon btn-sm" onclick="shareDeckToGroup('${d.id}')" title="Share to group">${icon('users',14)}</button>
        <button class="btn btn-ghost btn-icon btn-sm" onclick="deleteDeck('${d.id}')">${icon('trash',14)}</button>
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
    <div class="modal-head"><h3>${id ? 'Edit deck' : 'New deck'}</h3><button class="close-x" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="field-row">
        <div class="field"><label>Deck name</label><input class="input" id="df-name" value="${esc(d.name)}"></div>
        <div class="field"><label>Course</label><select class="select" id="df-course"><option value="">—</option>${activeCourses().map(c => `<option value="${c.id}" ${c.id === d.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Cards</label>
        <div id="df-cards">${d.cards.map((c, i) => cardRow(c, i)).join('')}</div>
        <button class="btn btn-sm mt-8" onclick="_deckDraft.cards.push({id:uid(),front:'',back:''});renderDeckModal('${id || ''}')">+ Add card</button>
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
    <button class="btn btn-ghost btn-icon btn-sm" onclick="_deckDraft.cards.splice(${i},1);renderDeckModal()">${icon('x',13,2.2)}</button>
  </div>`;
}
function saveDeckModal(id) {
  const d = _deckDraft;
  d.name = $('#df-name').value.trim() || 'Untitled deck';
  d.courseId = $('#df-course').value || null;
  if (id) { const i = state.decks.findIndex(x => x.id === id); state.decks[i] = d; } else state.decks.push(d);
  touch(); closeModal(); toast(id ? 'Deck updated' : 'Deck created');
}
function deleteDeck(id) { confirmDialog('Delete this deck?', () => { state.decks = state.decks.filter(x => x.id !== id); touch(); closeModal(); }); }
function shareDeckToGroup(id) {
  const d = state.decks.find(x => x.id === id);
  if (!d) return;
  openShareToGroupModal('deck', d.name || 'Untitled deck', { cards: d.cards.map(c => ({ front: c.front, back: c.back })) });
}

window._study = { deckId: null, idx: 0, flipped: false };
function openStudyMode(deckId) { window._study = { deckId, idx: 0, flipped: false }; renderStudyMode(); }
function renderStudyMode() {
  const deck = state.decks.find(d => d.id === window._study.deckId);
  const card = deck.cards[window._study.idx];
  openModal(`
    <div class="modal-head"><h3>${esc(deck.name)}</h3><button class="close-x" onclick="closeModal()">${icon('x',13,2.2)}</button></div>
    <div class="modal-body">
      <div class="small muted mb-8" style="text-align:center">${window._study.idx + 1} / ${deck.cards.length}</div>
      <div class="flip-card ${window._study.flipped ? 'flipped' : ''}" onclick="_study.flipped=!_study.flipped;renderStudyMode()">
        <div class="flip-inner">
          <div class="flip-face">${esc(card.front)}</div>
          <div class="flip-face back">${esc(card.back)}</div>
        </div>
      </div>
      <div class="small muted mt-8" style="text-align:center">Click card to flip</div>
    </div>
    <div class="modal-foot" style="justify-content:center">
      <button class="btn" onclick="studyNav(-1)" ${window._study.idx === 0 ? 'disabled' : ''}>← Prev</button>
      <button class="btn" onclick="shuffleDeck()">Shuffle</button>
      <button class="btn btn-primary" onclick="studyNav(1)" ${window._study.idx === deck.cards.length - 1 ? 'disabled' : ''}>Next →</button>
    </div>
  `);
}
function studyNav(dir) { window._study.idx = clamp(window._study.idx + dir, 0, state.decks.find(d => d.id === window._study.deckId).cards.length - 1); window._study.flipped = false; renderStudyMode(); }
function shuffleDeck() {
  const deck = state.decks.find(d => d.id === window._study.deckId);
  for (let i = deck.cards.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[deck.cards[i], deck.cards[j]] = [deck.cards[j], deck.cards[i]]; }
  window._study.idx = 0; window._study.flipped = false; touch(); renderStudyMode();
}
