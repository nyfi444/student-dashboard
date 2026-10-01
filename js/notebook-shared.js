/* ── Shared notes: one note, several people, edited live ──────────
   A shared note lives in sharedNotes/{id} (see firestore.rules), not in
   anyone's planner. Who can open it: the people on it (editorUids: the
   owner and anyone who joined with its link) and everyone in the study
   group or club it is shared with. In the Notebook it shows under Shared,
   with the id 'shared:{id}', and opens in the same editor as any note.

   Live editing is a three-way merge of the note's HTML (Google's
   diff-match-patch, vendor/diff-match-patch). The editor always holds
   `base` (the last text the server had, as far as this browser knows)
   plus whatever was typed here since. Saving runs in a transaction: if
   the server still has `base`, our text goes in as is; if someone else
   saved first, our changes since `base` are patched onto theirs. A change
   that arrives from someone else is patched under what was typed here the
   same way, so two people typing in different places both keep their
   words. Typing over the very same words at the same moment: the later
   save wins those words.

   presence/{uid} says who has the note open and where their cursor is (a
   character offset), refreshed every 20 seconds while it is open.
──────────────────────────────────────────────────────────────── */
const DMP_SRC = 'vendor/diff-match-patch/diff_match_patch.js';
const NB_SHARED_PREFIX = 'shared:';
const NB_SHARED_MAX = 880000;
const NB_SYNC_DEBOUNCE = 350, NB_SYNC_MAXWAIT = 1500;
const NB_PRESENCE_BEAT = 20000, NB_PRESENCE_STALE = 75000;
const NB_PERSON_COLORS = ['#d9648b', '#7b6fd0', '#3f9a9c', '#d18f36', '#5b9a5f', '#cf6f55', '#4f7fcf', '#a35fb5'];
const PENDING_NOTE_KEY = 'shq_pending_note';
const NB_SHARED_ID = /^[A-Za-z0-9]{10,40}$/;

const _nbShared = { list: new Map(), loadedAt: 0, loading: null, loaded: false, open: null };
let _dmp = null;

function nbIsSharedId(id) { return String(id || '').startsWith(NB_SHARED_PREFIX); }
function nbSharedSid(id) { return String(id || '').slice(NB_SHARED_PREFIX.length); }
function nbSharedCol() { return _fbDb.collection('sharedNotes'); }
function nbSharedEnabled() { return typeof cloudGroupsEnabled === 'function' && cloudGroupsEnabled(); }
async function nbDmp() {
  if (!_dmp) {
    if (typeof diff_match_patch === 'undefined') await loadScriptOnce(DMP_SRC);
    _dmp = new diff_match_patch();
    _dmp.Match_Distance = 4000;
  }
  return _dmp;
}
function nbPersonColor(uid) {
  let h = 0;
  for (const ch of String(uid || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return NB_PERSON_COLORS[h % NB_PERSON_COLORS.length];
}
function nbJoinKey() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map(b => abc[b % abc.length]).join('');
}
function nbSharedNewId() { return nbJoinKey().slice(0, 20); }
// The one form note HTML is compared and stored in: run through the
// sanitizer (which also settles attribute order and style spacing, so two
// browsers write the same thing), minus the editor's own caret marker.
function nbCanon(html) {
  return sanitizeHtml(String(html || '').replace(/(class="[^"]*?)\s*\bnb-caret-line\b/g, '$1'));
}
function nbMerge3(dmp, base, mine, theirs) {
  if (mine === base || mine === theirs) return theirs;
  if (theirs === base) return mine;
  return dmp.patch_apply(dmp.patch_make(base, mine), theirs)[0];
}

/* ── The list, and the note as the notebook sees it ── */
function nbSharedRecord(sid, d) {
  return {
    sid, title: String(d.title || ''), content: String(d.content || ''), ownerUid: d.ownerUid || '',
    editorUids: Array.isArray(d.editorUids) ? d.editorUids : [], people: d.people && typeof d.people === 'object' ? d.people : {},
    groupCode: d.groupCode || '', orgCode: d.orgCode || '', joinKey: d.joinKey || '',
    updatedAt: Number(d.updatedAt) || 0, updatedBy: d.updatedBy || '', rev: Number(d.rev) || 0,
  };
}
// What notebook.js reads and writes as `note` for a shared note. Writing
// content or name goes to the shared note (templates, uploads and renames
// all do), so none of that code needs to know which kind it has.
class NbSharedNote {
  constructor(sid) { this.sid = sid; this.id = NB_SHARED_PREFIX + sid; this.type = 'note'; this.parentId = 'root'; this.courseId = null; this.pinned = false; this.template = ''; this.date = null; this.shared = true; }
  get rec() { return _nbShared.list.get(this.sid); }
  get name() { return this.rec?.title || 'Untitled note'; }
  set name(v) { nbSharedRename(this.id, v); }
  get content() { return this.rec?.content || ''; }
  set content(v) { const r = this.rec; if (r) { r.content = String(v || ''); nbSharedSchedule(this.sid); } }
  get updatedAt() { return this.rec?.updatedAt || 0; }
  set updatedAt(v) {}
}
function nbSharedNote(id) { nbSharedEnsureSample(); const sid = nbSharedSid(id); return _nbShared.list.has(sid) ? new NbSharedNote(sid) : null; }
function nbSharedNotes() { return [..._nbShared.list.keys()].map(sid => new NbSharedNote(sid)); }
function nbSharedWhere(rec) {
  const bits = [];
  const g = rec.groupCode && typeof findGroup === 'function' ? findGroup(rec.groupCode) : null;
  const o = rec.orgCode && typeof findOrg === 'function' ? findOrg(rec.orgCode) : null;
  if (g) bits.push(g.name); else if (rec.groupCode) bits.push('A study group');
  if (o) bits.push(o.name); else if (rec.orgCode) bits.push('A club');
  const others = rec.editorUids.filter(u => u !== _fbUser?.uid);
  const names = others.map(u => String(rec.people[u]?.name || '').trim()).filter(Boolean);
  if (others.length && names.length === others.length && others.length <= 2 && !bits.length) bits.push(`With ${names.join(' and ')}`);
  else if (others.length) bits.push(`${others.length} ${others.length === 1 ? 'person' : 'people'}`);
  if (!bits.length) return rec.ownerUid === _fbUser?.uid ? (rec.joinKey ? 'Anyone with the link' : 'Only you') : 'Shared';
  return bits.join(', ');
}
function nbSharedRowHtml(n, selectedId) {
  const rec = n.rec;
  const selected = n.id === selectedId;
  const title = n.name === 'Untitled note' ? 'Untitled' : n.name;
  const snippet = nbNoteSnippet(n);
  return `<div class="nb-note-row nb-note-shared ${selected ? 'selected' : ''}" ${selected ? 'aria-current="true"' : ''} onclick="selectNote('${n.id}')">
      <div class="nb-note-meta">
        <div class="nb-note-title"><span class="nb-note-name" title="${esc(title)}">${esc(title)}</span></div>
        ${snippet ? `<div class="nb-note-snippet">${esc(snippet)}</div>` : ''}
        <div class="nb-note-sub"><span class="nb-shared-ic" aria-hidden="true">${icon('users', 12)}</span><span class="nb-shared-where">${esc(nbSharedWhere(rec))}</span><span aria-hidden="true">·</span><span>${fmtRelativeTime(n.updatedAt)}</span></div>
      </div>
    </div>`;
}
// The Shared section of the notes list.
function nbSharedSectionHtml(search, sort, selectedId) {
  nbSharedEnsureSample();
  if (nbSharedEnabled()) nbSharedRefresh();
  const notes = sortNotebookNotes(nbSharedNotes().filter(n => notebookNoteMatches(n, search)), sort);
  if (!notes.length) return '';
  return `<div class="nb-section nb-section-shared">
    <div class="nb-section-label"><span>Shared</span></div>
    <div class="nb-rows">${notes.map(n => nbSharedRowHtml(n, selectedId)).join('')}</div>
  </div>`;
}
// Loads every shared note this account can open: the ones it is on, and
// the ones shared with each of its study groups and clubs.
function nbSharedRefresh(force) {
  if (!nbSharedEnabled() || _nbShared.loading) return _nbShared.loading;
  if (!force && Date.now() - _nbShared.loadedAt < 30000) return null;
  const me = _fbUser.uid;
  const col = nbSharedCol();
  const queries = [col.where('editorUids', 'array-contains', me).limit(200)];
  allGroups().filter(g => !g.local && !g.sample && !g.loading).forEach(g => queries.push(col.where('groupCode', '==', g.code).limit(100)));
  allOrgs().filter(o => !o.local && !o.sample).forEach(o => queries.push(col.where('orgCode', '==', o.code).limit(100)));
  _nbShared.loading = Promise.allSettled(queries.map(q => q.get())).then(results => {
    const next = new Map();
    let failed = 0;
    results.forEach(r => {
      if (r.status !== 'fulfilled') { failed++; diag.warn('notebook', 'Shared notes query failed', r.reason); return; }
      // The id goes into onclick handlers; anything but letters and digits
      // is skipped (firestore.rules refuses to create one, too).
      r.value.forEach(d => { if (NB_SHARED_ID.test(d.id)) next.set(d.id, nbSharedRecord(d.id, d.data())); });
    });
    // The open note keeps its live copy (and what was typed into it).
    const open = _nbShared.open;
    if (open && _nbShared.list.has(open.sid) && !open.lost) next.set(open.sid, _nbShared.list.get(open.sid));
    const before = [..._nbShared.list.values()].map(r => `${r.sid}:${r.updatedAt}:${r.title}`).sort().join('|');
    const after = [...next.values()].map(r => `${r.sid}:${r.updatedAt}:${r.title}`).sort().join('|');
    if (failed < results.length) { _nbShared.list = next; _nbShared.loadedAt = Date.now(); nbSharedEnsureSample(); }
    _nbShared.loaded = true;
    if (before !== after && state.route === 'notebook') nbSharedListChanged();
  }).finally(() => { _nbShared.loading = null; });
  return _nbShared.loading;
}
// The list changed. While someone is typing in a note, only the Shared
// section is redrawn, so the note they're in is never rebuilt under them.
function nbSharedListChanged() {
  const editor = document.getElementById('note-editor');
  const typing = editor && document.activeElement === editor;
  const section = $('.nb-section-shared');
  if (typing) {
    if (!section) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = nbSharedSectionHtml((state._notebookSearch || '').trim().toLowerCase(), state._notebookSort || 'edited', state.notebookSelected);
    if (tmp.firstElementChild) section.replaceWith(tmp.firstElementChild); else section.remove();
    return;
  }
  if (typeof renderRemote === 'function') renderRemote(); else render();
}

/* ── Text offsets: where a caret is, as a count of characters ── */
function nbTextOffset(editor, node, offset) {
  const r = document.createRange();
  r.selectNodeContents(editor);
  try { r.setEnd(node, offset); } catch { return 0; }
  return r.toString().length;
}
function nbPointAt(editor, target) {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let seen = 0, last = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.nodeValue.length;
    if (seen + len >= target) return { node: n, offset: Math.max(0, target - seen) };
    seen += len; last = n;
  }
  return last ? { node: last, offset: last.nodeValue.length } : { node: editor, offset: editor.childNodes.length };
}
function nbCaretOffsets(editor) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !editor.contains(sel.anchorNode)) return null;
  const r = sel.getRangeAt(0);
  return { start: nbTextOffset(editor, r.startContainer, r.startOffset), end: nbTextOffset(editor, r.endContainer, r.endOffset) };
}
function nbSetCaretOffsets(editor, start, end) {
  const a = nbPointAt(editor, start), b = end === start ? a : nbPointAt(editor, end);
  const r = document.createRange();
  try { r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset); } catch { return; }
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(r);
}
// Before and after a re-render of the notebook page: the caret of whoever
// is typing in the note stays where it was.
function nbCaretSnapshot() {
  const editor = document.getElementById('note-editor');
  if (!editor || document.activeElement !== editor) return null;
  const c = nbCaretOffsets(editor);
  return c ? { noteId: window._nbCurrentNoteId, ...c } : null;
}
function nbCaretRestore(snap) {
  const editor = document.getElementById('note-editor');
  if (!snap || !editor || snap.noteId !== window._nbCurrentNoteId) return;
  editor.focus({ preventScroll: true });
  nbSetCaretOffsets(editor, snap.start, snap.end);
}

/* ── Putting new HTML into the editor without losing your place ──
   Only the top-level blocks that changed are replaced (a longest common
   run of unchanged ones stays put), so pictures don't reload and the
   paragraph being typed in isn't rebuilt unless it was the one changed. */
function nbMorph(editor, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const next = [...tpl.content.childNodes];
  const cur = [...editor.childNodes];
  const key = n => n.nodeType === 1 ? n.outerHTML.replace(/(class="[^"]*?)\s*\bnb-caret-line\b/g, '$1').replace(/ class=""/g, '').replace(/ data-(hl|ink)="[^"]*"/g, '') : n.nodeType === 3 ? '#' + n.nodeValue : '';
  if (cur.length * next.length > 400000) { editor.innerHTML = html; return; }
  const a = cur.map(key), b = next.map(key);
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const keep = new Map();
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) { keep.set(j, cur[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  const kept = new Set(keep.values());
  cur.forEach(n => { if (!kept.has(n)) n.remove(); });
  let ref = editor.firstChild;
  next.forEach((n, j) => {
    const k = keep.get(j);
    if (k) ref = k.nextSibling;
    else editor.insertBefore(n, ref);
  });
}
function nbApplyToEditor(editor, html, dmp) {
  const oldText = editor.textContent;
  const caret = document.activeElement === editor ? nbCaretOffsets(editor) : null;
  nbMorph(editor, sanitizeHtml(html));
  if (caret) {
    const diffs = dmp.diff_main(oldText, editor.textContent);
    nbSetCaretOffsets(editor, dmp.diff_xIndex(diffs, caret.start), dmp.diff_xIndex(diffs, caret.end));
  }
  nbTagInks(editor);
  if ($('#nb-lab-rail') && typeof refreshLabRailDebounced === 'function') refreshLabRailDebounced();
  nbDrawCarets();
}

/* ── The open note: listening, saving, presence ── */
function nbSharedEditor(sid) {
  const editor = document.getElementById('note-editor');
  return editor && window._nbCurrentNoteId === NB_SHARED_PREFIX + sid ? editor : null;
}
function nbSharedStatus(text) { const s = $('#nb-save-status'); if (s) s.textContent = text; }
// Called after every render of the notebook page.
async function nbSharedAttach(note) {
  const open = _nbShared.open;
  if (!note || !note.shared) { if (open) nbSharedDetach(); return; }
  if (open && open.sid === note.sid) { nbSharedPaintPeople(); nbDrawCarets(); return; }
  if (open) nbSharedDetach();
  if (note.rec?.sample) {
    // The demo: Maya and Priya are "here", their cursors in the study guide.
    const o = { sid: note.sid, sample: true, others: new Map(), lost: false };
    const text = (nbSharedEditor(note.sid)?.textContent || '');
    const at = (needle, fallback) => { const i = text.indexOf(needle); return i >= 0 ? i + needle.length : fallback; };
    o.others.set('sample-maya', { name: 'Maya', caret: at('Chair flips', 20) });
    o.others.set('sample-priya', { name: 'Priya', caret: at('Writing it', 60) });
    _nbShared.open = o;
    nbSharedPaintPeople(); nbDrawCarets();
    return;
  }
  if (!nbSharedEnabled()) return;
  const sid = note.sid;
  const o = { sid, base: null, pushing: false, again: false, remote: null, timer: 0, maxTimer: 0, others: new Map(), lost: false, unsub: null, presUnsub: null, beat: 0, lastCaret: -2 };
  _nbShared.open = o;
  const dmp = await nbDmp();
  if (_nbShared.open !== o) return;
  const editor = nbSharedEditor(sid);
  o.base = nbCanon(editor ? editor.innerHTML : note.content);
  const ref = nbSharedCol().doc(sid);
  o.unsub = ref.onSnapshot(snap => nbSharedOnSnap(o, snap, dmp), err => nbSharedLost(o, err));
  o.presUnsub = ref.collection('presence').onSnapshot(snap => {
    o.others.clear();
    snap.forEach(d => { if (d.id !== _fbUser?.uid) o.others.set(d.id, d.data()); });
    nbSharedPaintPeople(); nbDrawCarets();
  }, err => diag.warn('notebook', 'Presence listener failed', err));
  nbSharedBeat(o);
  o.beat = setInterval(() => nbSharedBeat(o), NB_PRESENCE_BEAT);
}
function nbSharedDetach() {
  const o = _nbShared.open;
  if (!o) return;
  // Anything typed and not yet sent goes now.
  if (o.timer || o.maxTimer) { clearTimeout(o.timer); clearTimeout(o.maxTimer); o.timer = o.maxTimer = 0; nbSharedPush(o.sid); }
  o.unsub?.(); o.presUnsub?.();
  clearInterval(o.beat);
  _nbShared.open = null;
  if (o.sample) return;
  const rec = _nbShared.list.get(o.sid);
  if (rec) rec._base = o.base;
  if (_fbUser && _fbDb) nbSharedCol().doc(o.sid).collection('presence').doc(_fbUser.uid).delete().catch(() => {});
}
function nbSharedOnSnap(o, snap, dmp) {
  if (_nbShared.open !== o) return;
  if (!snap.exists) { nbSharedLost(o, { code: 'not-found' }); return; }
  const d = snap.data();
  const rec = _nbShared.list.get(o.sid);
  const fresh = nbSharedRecord(o.sid, d);
  if (rec) {
    // A title being typed here wins over the one coming in until it's sent.
    if (Date.now() < (rec._titleDirtyUntil || 0)) fresh.title = rec.title;
    const titleChanged = rec.title !== fresh.title;
    Object.assign(rec, { ...fresh, content: rec.content });
    if (titleChanged) nbSharedShowTitle(rec.title);
  } else _nbShared.list.set(o.sid, fresh);
  if (snap.metadata.hasPendingWrites) return;
  if (o.pushing) { o.remote = fresh.content; return; }
  nbSharedTakeRemote(o, fresh.content, dmp);
}
function nbSharedTakeRemote(o, server, dmp) {
  if (server === o.base) return;
  const rec = _nbShared.list.get(o.sid);
  const editor = nbSharedEditor(o.sid);
  const mine = editor ? nbCanon(editor.innerHTML) : nbCanon(rec?.content);
  const result = mine === o.base ? server : nbMerge3(dmp, o.base, mine, server);
  o.base = server;
  if (editor && result !== mine) nbApplyToEditor(editor, result, dmp);
  if (rec) rec.content = editor ? editor.innerHTML : result;
  if (result !== server) nbSharedSchedule(o.sid);
  else { nbSharedStatus(`Edited ${nbEditedWhen(rec?.updatedAt)}`); nbSharedUpdateRow(o.sid); }
}
// The user typed (notebook.js routes saveNoteContentDebounced here).
function nbSharedLocalEdit(id, html) {
  const sid = nbSharedSid(id);
  const rec = _nbShared.list.get(sid);
  if (rec && typeof html === 'string') rec.content = html;
  if (rec?.sample) { clearTimeout(rec._saveTimer); rec._saveTimer = setTimeout(() => nbSampleSave(rec), 500); return; }
  nbSharedSchedule(sid);
}
function nbSharedSchedule(sid) {
  const sampleRec = _nbShared.list.get(sid);
  if (sampleRec?.sample) { nbSampleSave(sampleRec); return; }
  const o = _nbShared.open;
  if (!o || o.sid !== sid) { nbSharedPushClosed(sid); return; }
  nbSharedStatus('Saving…');
  clearTimeout(o.timer);
  o.timer = setTimeout(() => { clearTimeout(o.maxTimer); o.timer = o.maxTimer = 0; nbSharedPush(sid); }, NB_SYNC_DEBOUNCE);
  if (!o.maxTimer) o.maxTimer = setTimeout(() => { clearTimeout(o.timer); o.timer = o.maxTimer = 0; nbSharedPush(sid); }, NB_SYNC_MAXWAIT);
}
async function nbSharedPush(sid) {
  const o = _nbShared.open;
  if (!o || o.sid !== sid || o.lost || o.base == null) return;
  if (o.pushing) { o.again = true; return; }
  const dmp = await nbDmp();
  const rec = _nbShared.list.get(sid);
  const editor = nbSharedEditor(sid);
  const local = editor ? nbCanon(editor.innerHTML) : nbCanon(rec?.content);
  if (local === o.base) { nbSharedStatus(`Saved just now`); return; }
  if (local.length > NB_SHARED_MAX) { nbSharedStatus('Too long to save'); toast('This shared note is too long to save. Split it into two notes, or move some pictures out.', 'error', 7000); return; }
  o.pushing = true;
  const ref = nbSharedCol().doc(sid);
  let merged = local;
  try {
    await _fbDb.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error('This note was deleted.'), { code: 'not-found' });
      const server = String(snap.data().content || '');
      merged = server === o.base ? local : nbMerge3(dmp, o.base, local, server);
      tx.update(ref, { content: merged, updatedAt: Date.now(), updatedBy: _fbUser.uid, rev: (Number(snap.data().rev) || 0) + 1 });
    });
    // Anything typed while the save was out rides on top of what was saved.
    const now = editor && editor.isConnected ? nbCanon(editor.innerHTML) : null;
    if (now != null && merged !== local) nbApplyToEditor(editor, now === local ? merged : nbMerge3(dmp, local, now, merged), dmp);
    o.base = merged;
    if (rec) { rec.content = editor && editor.isConnected ? editor.innerHTML : merged; rec.updatedAt = Date.now(); rec.updatedBy = _fbUser.uid; }
    nbSharedStatus('Saved just now');
    nbSharedUpdateRow(sid);
  } catch (e) {
    if (e?.code === 'permission-denied' || e?.code === 'not-found') { nbSharedLost(o, e); return; }
    diag.warn('notebook', 'Shared note save failed, will retry', e);
    nbSharedStatus(navigator.onLine === false ? 'Offline. Saves when you’re back' : 'Not saved yet. Trying again…');
    setTimeout(() => nbSharedSchedule(sid), 3000);
  } finally {
    o.pushing = false;
    if (_nbShared.open === o && !o.lost) {
      const remote = o.remote;
      o.remote = null;
      if (remote != null) nbSharedTakeRemote(o, remote, dmp);
      if (o.again) { o.again = false; nbSharedSchedule(sid); }
    }
  }
}
// A change to a shared note that isn't open (a layout applied just before
// leaving it): one plain save of the whole thing, merged the same way.
async function nbSharedPushClosed(sid) {
  const rec = _nbShared.list.get(sid);
  if (!rec || !nbSharedEnabled()) return;
  const dmp = await nbDmp();
  const ref = nbSharedCol().doc(sid);
  const base = rec._base ?? null;
  const local = nbCanon(rec.content);
  // Without a known starting point there is nothing safe to merge from.
  if (base == null || local === base) return;
  try {
    await _fbDb.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const server = String(snap.data().content || '');
      const merged = server === base ? local : nbMerge3(dmp, base, local, server);
      rec._base = merged;
      tx.update(ref, { content: merged, updatedAt: Date.now(), updatedBy: _fbUser.uid, rev: (Number(snap.data().rev) || 0) + 1 });
    });
  } catch (e) { diag.warn('notebook', 'Shared note save (closed) failed', e); }
}
function nbSharedLost(o, err) {
  if (_nbShared.open !== o || o.lost) return;
  o.lost = true;
  o.unsub?.(); o.presUnsub?.();
  clearInterval(o.beat);
  const deleted = err?.code === 'not-found';
  diag.warn('notebook', 'Shared note closed', err);
  _nbShared.list.delete(o.sid);
  _nbShared.open = null;
  toast(deleted ? 'This shared note was deleted.' : 'You no longer have access to this shared note.', 'info', 6000);
  if (state.notebookSelected === NB_SHARED_PREFIX + o.sid) setState({ notebookSelected: null });
  else render();
}
function nbSharedRename(id, name) {
  const sid = nbSharedSid(id);
  const rec = _nbShared.list.get(sid);
  if (!rec) return;
  const clean = String(name || '').replace(/[\r\n]+/g, ' ').slice(0, 200);
  rec.title = clean.trim() && clean !== 'Untitled note' ? clean : '';
  rec._titleDirtyUntil = Date.now() + 2500;
  const label = rec.title.trim() || 'Untitled';
  document.querySelectorAll('.nb-note-row.selected .nb-note-name').forEach(el => { el.textContent = label; el.title = label; });
  if (rec.sample) { nbSampleSave(rec); return; }
  clearTimeout(rec._titleTimer);
  rec._titleTimer = setTimeout(() => {
    nbSharedCol().doc(sid).update({ title: rec.title, updatedAt: Date.now(), updatedBy: _fbUser.uid })
      .catch(e => { diag.warn('notebook', 'Shared note rename failed', e); toast('Couldn’t rename the note. Check your connection.', 'error'); });
  }, 600);
}
function nbSharedShowTitle(title) {
  const input = $('#nb-title-input');
  if (input && document.activeElement !== input) { input.value = title; nbAutosizeTitle(input); }
  nbSharedUpdateRow(_nbShared.open?.sid);
}
function nbSharedUpdateRow(sid) {
  if (!sid) return;
  const n = nbSharedNote(NB_SHARED_PREFIX + sid);
  const row = document.querySelector(`.nb-note-row[onclick="selectNote('${NB_SHARED_PREFIX + sid}')"]`);
  if (!n || !row) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = nbSharedRowHtml(n, state.notebookSelected);
  if (tmp.firstElementChild) row.replaceWith(tmp.firstElementChild);
}

/* Presence: who's here, and their cursors */
function nbSharedBeat(o) {
  if (_nbShared.open !== o || o.lost || o.sample || !_fbUser) return;
  const editor = nbSharedEditor(o.sid);
  const c = editor && document.activeElement === editor ? nbCaretOffsets(editor) : null;
  o.lastCaret = c ? c.end : -1;
  o.lastBeat = Date.now();
  nbSharedCol().doc(o.sid).collection('presence').doc(_fbUser.uid)
    .set({ name: String(myGroupName()).slice(0, 60), at: Date.now(), caret: o.lastCaret, color: nbPersonColor(_fbUser.uid) })
    .catch(e => diag.warn('notebook', 'Presence write failed', e));
}
let _nbCaretBeatTimer = 0;
function nbSharedCaretMoved() {
  const o = _nbShared.open;
  if (!o || o.sample || _nbCaretBeatTimer) return;
  _nbCaretBeatTimer = setTimeout(() => {
    _nbCaretBeatTimer = 0;
    const editor = nbSharedEditor(o.sid);
    const c = editor && document.activeElement === editor ? nbCaretOffsets(editor) : null;
    if ((c ? c.end : -1) !== o.lastCaret) nbSharedBeat(o);
  }, 1200);
}
function nbSharedHere(o) {
  if (o.sample) return [...o.others.entries()];
  const now = Date.now();
  return [...o.others.entries()].filter(([, p]) => now - (Number(p.at) || 0) < NB_PRESENCE_STALE);
}
function nbSharedPeopleHtml() {
  const o = _nbShared.open;
  if (!o) return '';
  const here = nbSharedHere(o);
  if (!here.length) return '';
  const shown = here.slice(0, 4);
  const names = here.map(([, p]) => p.name || 'Someone');
  const label = names.length === 1 ? `${names[0]} is here` : `${names.slice(0, -1).join(', ')} and ${names.at(-1)} are here`;
  return `<span class="nb-people-dots" role="img" aria-label="${esc(label)}" data-tip="${esc(label)}">${shown.map(([u, p]) => `<span class="nb-person" style="--c:${nbPersonColor(u)}">${esc((p.name || '?').trim().charAt(0).toUpperCase())}</span>`).join('')}${here.length > 4 ? `<span class="nb-person nb-person-more">+${here.length - 4}</span>` : ''}</span>`;
}
function nbSharedPaintPeople() {
  const el = $('#nb-shared-people');
  if (el) el.innerHTML = nbSharedPeopleHtml();
}
function nbDrawCarets() {
  const layer = $('#nb-carets');
  const o = _nbShared.open;
  const editor = o && nbSharedEditor(o.sid);
  if (!layer) return;
  if (!o || !editor) { layer.innerHTML = ''; return; }
  const box = layer.getBoundingClientRect();
  const total = editor.textContent.length;
  layer.innerHTML = nbSharedHere(o).filter(([, p]) => Number(p.caret) >= 0).map(([u, p]) => {
    const at = nbPointAt(editor, Math.min(Number(p.caret), total));
    const r = document.createRange();
    try { r.setStart(at.node, at.offset); r.collapse(true); } catch { return ''; }
    let rect = r.getClientRects()[0];
    if (!rect && at.node.nodeType === 3) {
      // At the very end of a text node some browsers give no box; measure the character before.
      try { r.setStart(at.node, Math.max(0, at.offset - 1)); r.setEnd(at.node, at.offset); const rr = r.getBoundingClientRect(); rect = { left: rr.right, top: rr.top, height: rr.height }; } catch {}
    }
    if (!rect) return '';
    // Colors come from the uid here, never from what another browser wrote.
    const color = nbPersonColor(u);
    return `<span class="nb-rcaret" style="left:${Math.round(rect.left - box.left)}px;top:${Math.round(rect.top - box.top)}px;height:${Math.round(rect.height || 20)}px;--c:${color}"><span class="nb-rcaret-name">${esc(p.name || 'Someone')}</span></span>`;
  }).join('');
}

/* ── Starting, sharing, joining, leaving ── */
function nbGroupOptions() { return typeof allGroups === 'function' ? allGroups().filter(g => !g.local && !g.sample && !g.loading) : []; }
function nbOrgOptions() { return typeof allOrgs === 'function' ? allOrgs().filter(o => !o.local && !o.sample) : []; }
function nbSharedLink(rec) { return rec.joinKey ? `${location.origin}/?note=${rec.sid}.${rec.joinKey}` : ''; }
// The Share button on a note of your own.
function openNoteShareModal(id) {
  const n = state.notes.find(x => x.id === id);
  if (!n) return;
  const title = n.name && n.name !== 'Untitled note' ? n.name : 'Untitled';
  if (!nbSharedEnabled()) {
    openModal(`
      <div class="modal-head"><h3>Share “${esc(title)}”</h3>${closeXButton()}</div>
      <div class="modal-body"><p class="small muted">Log in to work on notes with classmates, your study group, or your club. Everyone sees each change as it’s made.</p></div>
      <div class="modal-foot"><button class="btn" onclick="closeModal()">Not now</button><a class="btn btn-primary" href="login.html">Log in</a></div>
    `);
    return;
  }
  const groups = nbGroupOptions(), orgs = nbOrgOptions();
  openModal(`
    <div class="modal-head"><h3>Edit “${esc(title)}” together</h3>${closeXButton()}</div>
    <div class="modal-body nb-share-body">
      <p class="small muted mb-16">Everyone you share with can write in this note, and sees changes as they’re made.</p>
      ${nbShareWhoFields({ groupCode: '', orgCode: '', joinKey: '' }, groups, orgs, true)}
    </div>
    <div class="modal-foot nb-share-foot">
      <button class="btn btn-ghost" onclick="closeModal();shareNoteToGroup('${n.id}')">Send a copy instead</button>
      <span class="spacer"></span>
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="nb-share-go" onclick="nbStartSharing('${n.id}')">Start editing together</button>
    </div>
  `);
}
function nbShareWhoFields(rec, groups, orgs, isNew) {
  const groupSel = `<select class="select" id="nb-share-group" aria-label="Study group" onchange="$('#nb-share-group-on').checked=!!this.value">
      <option value="">Pick a study group</option>${groups.map(g => `<option value="${esc(g.code)}" ${g.code === rec.groupCode ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>`;
  const orgSel = `<select class="select" id="nb-share-org" aria-label="Club" onchange="$('#nb-share-org-on').checked=!!this.value">
      <option value="">Pick a club</option>${orgs.map(o => `<option value="${esc(o.code)}" ${o.code === rec.orgCode ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
  return `
    <div class="nb-share-who">
      <label class="nb-share-opt"><input type="checkbox" id="nb-share-group-on" ${rec.groupCode ? 'checked' : ''} ${groups.length ? '' : 'disabled'}><span class="nb-share-opt-text"><b>A study group</b><span class="small muted">${groups.length ? 'Everyone in it can edit, while they’re in the group.' : 'You’re not in a study group yet.'}</span></span></label>
      ${groups.length ? `<div class="nb-share-pick">${groupSel}</div>` : ''}
      <label class="nb-share-opt"><input type="checkbox" id="nb-share-org-on" ${rec.orgCode ? 'checked' : ''} ${orgs.length ? '' : 'disabled'}><span class="nb-share-opt-text"><b>A club</b><span class="small muted">${orgs.length ? 'Every member can edit, while they’re in the club.' : 'You’re not in a club yet.'}</span></span></label>
      ${orgs.length ? `<div class="nb-share-pick">${orgSel}</div>` : ''}
      <label class="nb-share-opt"><input type="checkbox" id="nb-share-link-on" ${rec.joinKey || (isNew && !groups.length && !orgs.length) ? 'checked' : ''}><span class="nb-share-opt-text"><b>Anyone with the link</b><span class="small muted">Anyone with a Semester HQ account who opens the link can edit.</span></span></label>
    </div>`;
}
function nbReadShareWho() {
  const groupOn = $('#nb-share-group-on')?.checked, orgOn = $('#nb-share-org-on')?.checked;
  const groupCode = groupOn ? ($('#nb-share-group')?.value || '') : '';
  const orgCode = orgOn ? ($('#nb-share-org')?.value || '') : '';
  if (groupOn && !groupCode) return { error: 'Pick the study group to share with.' };
  if (orgOn && !orgCode) return { error: 'Pick the club to share with.' };
  return { groupCode, orgCode, link: !!$('#nb-share-link-on')?.checked };
}
// Turns a note of your own into a shared one. The pictures it carries
// inline move to Storage first, so the note fits in one document.
async function nbStartSharing(noteId) {
  const n = state.notes.find(x => x.id === noteId);
  if (!n || !nbSharedEnabled()) return;
  const who = nbReadShareWho();
  if (who.error) { toast(who.error, 'error'); return; }
  if (!who.groupCode && !who.orgCode && !who.link) { toast('Pick who can edit it: a study group, a club, or anyone with the link.', 'error'); return; }
  const editor = $('#note-editor');
  if (editor && window._nbCurrentNoteId === noteId) n.content = editor.innerHTML;
  const btn = $('#nb-share-go');
  setBtnLoading(btn, true);
  const sid = nbSharedNewId();
  const me = _fbUser.uid;
  const ref = nbSharedCol().doc(sid);
  const rec = { title: n.name && n.name !== 'Untitled note' ? String(n.name).slice(0, 200) : '', content: '', ownerUid: me, editorUids: [me], people: { [me]: { name: String(myGroupName()).slice(0, 60) } }, groupCode: who.groupCode, orgCode: who.orgCode, joinKey: who.link ? nbJoinKey() : '', createdAt: Date.now(), updatedAt: Date.now(), updatedBy: me, rev: 0 };
  try {
    await ref.set(rec);
    let content = nbCanon(n.content);
    const inline = [...new Set([...content.matchAll(/src="(data:image\/[^"]+)"/g)].map(m => m[1]))];
    let i = 0;
    for (const src of inline) {
      const url = await uploadDataUrlToStorage(`sharedNotes/${sid}/images/${uid()}-picture-${++i}.jpg`, src, `picture-${i}.jpg`);
      content = content.split(src).join(url);
    }
    if (content.length > NB_SHARED_MAX) throw new Error('This note is too long to share. Split it into two notes first.');
    await ref.update({ content, updatedAt: Date.now(), rev: 1 });
    _nbShared.list.set(sid, nbSharedRecord(sid, { ...rec, content, rev: 1 }));
    state.notes = state.notes.filter(x => x.id !== noteId);
    closeModal();
    setState({ notebookSelected: NB_SHARED_PREFIX + sid });
    toast(rec.joinKey ? 'Shared. Copy the link from Share to invite people.' : 'Shared. Everyone you picked can edit it now.', 'success', 5000);
    if (rec.joinKey) setTimeout(() => nbOpenSharedPanel(NB_SHARED_PREFIX + sid), 250);
  } catch (e) {
    diag.warn('notebook', 'Could not start a shared note', e);
    ref.delete().catch(() => {});
    setBtnLoading(btn, false, 'Start editing together');
    toast(e.message && !/permission|internal/i.test(e.message) ? e.message : 'Couldn’t share the note. Check your connection and try again.', 'error', 6000);
  }
}
// The Share button on a shared note: who's on it, the link, and (for the
// owner) changing who it's shared with.
function nbOpenSharedPanel(id) {
  const rec = _nbShared.list.get(nbSharedSid(id));
  if (!rec) return;
  if (rec.sample) {
    openModal(`
      <div class="modal-head"><h3>Share “${esc(rec.title || 'Untitled')}”</h3>${closeXButton()}</div>
      <div class="modal-body nb-share-body">
        <div class="nb-share-section-label">Who can edit</div>
        <ul class="nb-share-people">${NB_SAMPLE_PEOPLE.map(([u, name]) => `<li class="nb-share-person"><span class="nb-person" style="--c:${nbPersonColor(u)}">${esc(name.charAt(0))}</span><span class="nb-share-person-name">${esc(name)}</span><span class="small muted">Sample classmate</span></li>`).join('')}</ul>
        <p class="small muted">This is a sample. In your own notebook, Share on any note lets your study group, your club, or anyone with the link write in it with you, and you see each other’s changes as they happen.</p>
      </div>
      <div class="modal-foot"><button class="btn btn-primary" onclick="closeModal()">Got it</button></div>
    `);
    return;
  }
  const me = _fbUser?.uid;
  const owner = rec.ownerUid === me;
  const title = rec.title || 'Untitled';
  const link = nbSharedLink(rec);
  const person = (u) => {
    const name = rec.people[u]?.name || (u === me ? myGroupName() : 'Someone');
    return `<li class="nb-share-person"><span class="nb-person" style="--c:${nbPersonColor(u)}">${esc(String(name).trim().charAt(0).toUpperCase())}</span><span class="nb-share-person-name">${esc(name)}${u === me ? ' (you)' : ''}</span><span class="small muted">${u === rec.ownerUid ? 'Owner' : 'Joined with the link'}</span>${owner && u !== me && /^[A-Za-z0-9_-]{1,128}$/.test(u) ? `<button class="btn btn-ghost btn-sm" onclick="nbRemoveSharedPerson('${rec.sid}','${u}')">Remove</button>` : ''}</li>`;
  };
  const g = rec.groupCode && typeof findGroup === 'function' ? findGroup(rec.groupCode) : null;
  const o = rec.orgCode && typeof findOrg === 'function' ? findOrg(rec.orgCode) : null;
  openModal(`
    <div class="modal-head"><h3>Share “${esc(title)}”</h3>${closeXButton()}</div>
    <div class="modal-body nb-share-body">
      ${link ? `<div class="field"><label for="nb-share-link">Invite link</label><div class="nb-share-linkrow"><input class="input" id="nb-share-link" readonly value="${esc(link)}" onclick="this.select()"><button class="btn btn-primary" onclick="nbCopySharedLink('${rec.sid}')">${icon('copy', 14)} Copy</button></div><p class="small muted">Anyone with a Semester HQ account who opens it can edit.</p></div>` : ''}
      <div class="nb-share-section-label">Who can edit</div>
      <ul class="nb-share-people">
        ${rec.editorUids.map(person).join('')}
        ${rec.groupCode ? `<li class="nb-share-person"><span class="nb-person nb-person-group">${icon('users', 12)}</span><span class="nb-share-person-name">${esc(g?.name || 'A study group')}</span><span class="small muted">Everyone in the group</span></li>` : ''}
        ${rec.orgCode ? `<li class="nb-share-person"><span class="nb-person nb-person-group">${icon('users', 12)}</span><span class="nb-share-person-name">${esc(o?.name || 'A club')}</span><span class="small muted">Every member</span></li>` : ''}
      </ul>
      ${owner ? `<details class="nb-share-change" ${rec.editorUids.length <= 1 && !rec.groupCode && !rec.orgCode && !rec.joinKey ? 'open' : ''}><summary>Change who it’s shared with</summary>${nbShareWhoFields(rec, nbGroupOptions(), nbOrgOptions(), false)}
        <div class="nb-share-save"><button class="btn btn-primary btn-sm" id="nb-share-save" onclick="nbSaveSharing('${rec.sid}')">Save</button>${rec.joinKey ? `<button class="btn btn-ghost btn-sm" onclick="nbNewSharedLink('${rec.sid}')">Make a new link</button>` : ''}</div></details>` : ''}
    </div>
    <div class="modal-foot nb-share-foot">
      ${owner ? `<button class="btn btn-danger" onclick="nbStopSharing('${rec.sid}')">Stop sharing</button>` : rec.editorUids.includes(me) ? `<button class="btn btn-ghost" onclick="nbLeaveShared('${rec.sid}')">Leave this note</button>` : ''}
      <span class="spacer"></span>
      <button class="btn" onclick="closeModal()">Done</button>
    </div>
  `);
}
async function nbCopySharedLink(sid) {
  const rec = _nbShared.list.get(sid);
  const link = rec && nbSharedLink(rec);
  if (!link) return;
  try { await navigator.clipboard.writeText(link); toast('Link copied'); }
  catch { $('#nb-share-link')?.select(); toast('Select the link and copy it', 'info'); }
}
async function nbSaveSharing(sid) {
  const rec = _nbShared.list.get(sid);
  if (!rec) return;
  const who = nbReadShareWho();
  if (who.error) { toast(who.error, 'error'); return; }
  const joinKey = who.link ? (rec.joinKey || nbJoinKey()) : '';
  const btn = $('#nb-share-save');
  setBtnLoading(btn, true);
  try {
    await nbSharedCol().doc(sid).update({ groupCode: who.groupCode, orgCode: who.orgCode, joinKey });
    Object.assign(rec, { groupCode: who.groupCode, orgCode: who.orgCode, joinKey });
    toast('Sharing updated');
    nbOpenSharedPanel(NB_SHARED_PREFIX + sid);
    nbSharedUpdateRow(sid);
  } catch (e) {
    diag.warn('notebook', 'Could not change sharing', e);
    setBtnLoading(btn, false, 'Save');
    toast('Couldn’t change who it’s shared with. Check your connection.', 'error');
  }
}
async function nbNewSharedLink(sid) {
  const rec = _nbShared.list.get(sid);
  if (!rec) return;
  const joinKey = nbJoinKey();
  try {
    await nbSharedCol().doc(sid).update({ joinKey });
    rec.joinKey = joinKey;
    toast('New link made. The old one no longer works.');
    nbOpenSharedPanel(NB_SHARED_PREFIX + sid);
  } catch (e) { diag.warn('notebook', 'Could not reset the link', e); toast('Couldn’t make a new link.', 'error'); }
}
async function nbRemoveSharedPerson(sid, u) {
  const rec = _nbShared.list.get(sid);
  if (!rec) return;
  const people = { ...rec.people };
  delete people[u];
  try {
    await nbSharedCol().doc(sid).update({ editorUids: rec.editorUids.filter(x => x !== u), [`people.${u}`]: firebase.firestore.FieldValue.delete() });
    rec.editorUids = rec.editorUids.filter(x => x !== u); rec.people = people;
    nbOpenSharedPanel(NB_SHARED_PREFIX + sid);
  } catch (e) { diag.warn('notebook', 'Could not remove someone', e); toast('Couldn’t remove them. Check your connection.', 'error'); }
}
// The owner takes everyone else off; the note stays theirs, in Shared,
// ready to share again.
function nbStopSharing(sid) {
  const rec = _nbShared.list.get(sid);
  if (!rec) return;
  confirmDialog('Stop sharing this note? Everyone else loses it, and old links stop working. It stays in your notebook.', async () => {
    try {
      await nbSharedCol().doc(sid).update({ editorUids: [_fbUser.uid], people: { [_fbUser.uid]: rec.people[_fbUser.uid] || { name: String(myGroupName()).slice(0, 60) } }, groupCode: '', orgCode: '', joinKey: '' });
      Object.assign(rec, { editorUids: [_fbUser.uid], groupCode: '', orgCode: '', joinKey: '' });
      closeModal();
      toast('Only you can see it now');
      render();
    } catch (e) { diag.warn('notebook', 'Could not stop sharing', e); toast('Couldn’t stop sharing. Check your connection.', 'error'); }
  }, 'Stop sharing');
}
function nbLeaveShared(sid) {
  confirmDialog('Leave this note? It comes off your notebook. You can come back with the link, if it still works.', async () => {
    const rec = _nbShared.list.get(sid);
    try {
      await nbSharedCol().doc(sid).update({ editorUids: firebase.firestore.FieldValue.arrayRemove(_fbUser.uid) });
      closeModal();
      if (_nbShared.open?.sid === sid) nbSharedDetach();
      // Still reachable through a group or club it's shared with: it stays listed.
      if (rec && !rec.groupCode && !rec.orgCode) _nbShared.list.delete(sid);
      _nbShared.loadedAt = 0;
      setState({ notebookSelected: null });
    } catch (e) { diag.warn('notebook', 'Could not leave a shared note', e); toast('Couldn’t leave the note. Check your connection.', 'error'); }
  }, 'Leave');
}
// The owner deletes it for everyone, pictures included.
function nbDeleteShared(sid) {
  confirmDialog('Delete this note for everyone? Nobody can get it back.', async () => {
    const ref = nbSharedCol().doc(sid);
    try {
      if (_nbShared.open?.sid === sid) nbSharedDetach();
      for (const sub of ['presence', 'joins']) {
        const snap = await ref.collection(sub).get().catch(() => null);
        if (snap) await Promise.all(snap.docs.map(d => d.ref.delete().catch(() => {})));
      }
      try { const st = await fbStorage(); const all = await st.ref(`sharedNotes/${sid}/images`).listAll(); await Promise.all(all.items.map(it => it.delete().catch(() => {}))); } catch (e) { diag.warn('notebook', 'Could not remove a shared note’s pictures', e); }
      await ref.delete();
      _nbShared.list.delete(sid);
      setState({ notebookSelected: null });
      toast('Note deleted');
    } catch (e) { diag.warn('notebook', 'Could not delete a shared note', e); toast('Couldn’t delete the note. Check your connection.', 'error'); }
  }, 'Delete for everyone');
}
// A copy of a shared note in your own notebook.
function nbCopySharedToMine(sid) {
  const rec = _nbShared.list.get(sid);
  if (!rec) return;
  const editor = nbSharedEditor(sid);
  const id = uid();
  state.notes.push({ id, type: 'note', name: (rec.title || 'Untitled note') + ' (copy)', parentId: 'root', courseId: null, pinned: false, content: editor ? editor.innerHTML : rec.content, updatedAt: Date.now() });
  setState({ notebookSelected: id });
  toast('Saved a copy to your notebook');
}

/* ── The demo's shared note ─────────────────────────────────────
   The sample semester carries one shared note (state.sampleSharedNote),
   "written with" Maya and Priya, so the demo shows a note several people
   edit: who's here, their cursors, a wrapped picture and a table. It lives
   in this browser only; nothing goes to Firestore, and Share explains how
   to make a real one. */
const NB_SAMPLE_SID = 'sampleStudyGuide01';
const NB_SAMPLE_PEOPLE = [['sample-maya', 'Maya'], ['sample-priya', 'Priya']];
function nbMakeSampleSharedNote() {
  const pic = typeof libSampleImage === 'function' ? libSampleImage(520, 400, (c, w, h) => {
    c.fillStyle = '#f4eef6'; c.fillRect(0, 0, w, h);
    const cx = 250, cy = 205, r = 92;
    const pts = [...Array(6)].map((_, i) => [cx + r * Math.cos(Math.PI / 6 + i * Math.PI / 3), cy + r * Math.sin(Math.PI / 6 + i * Math.PI / 3)]);
    c.strokeStyle = '#3b3346'; c.lineWidth = 6; c.lineJoin = 'round'; c.lineCap = 'round';
    c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.stroke();
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); c.lineTo(pts[0][0] + 78, pts[0][1] + 34); c.stroke();
    c.fillStyle = '#c0567f'; c.font = '600 40px "General Sans", system-ui, sans-serif'; c.fillText('OH', pts[0][0] + 84, pts[0][1] + 52);
    c.fillStyle = '#3b3346'; c.font = '38px "Instrument Serif", Georgia, serif'; c.fillText('Cyclohexanol', 24, 52);
    c.fillStyle = '#7b6f86'; c.font = '500 22px "General Sans", system-ui, sans-serif'; c.fillText('OH sits equatorial in the chair', 24, h - 26);
  }) : null;
  const img = pic ? `<p><img class="nb-img nb-img-right" src="${pic.dataUrl}" alt="Cyclohexanol, OH equatorial in the chair" style="width: 40%"></p>` : '';
  return {
    title: 'Exam 2 study guide',
    updatedAt: Date.now() - 12 * 60000,
    content: `${img}<p>Split up by chapter. Add what you finish, and check off what you’ve reviewed.</p>`
      + '<ul><li>Chair flips: big groups go equatorial</li><li>SN1 vs SN2: substrate, nucleophile, solvent</li><li>E2 needs anti-periplanar H and leaving group</li></ul>'
      + '<h3>Who’s covering what</h3>'
      + '<table class="nb-table"><thead><tr><th>Topic</th><th>Who</th><th>Status</th></tr></thead><tbody>'
      + '<tr><td>Conformations</td><td>Maya</td><td>Done</td></tr><tr><td>Substitution</td><td>Priya</td><td>Writing it up</td></tr><tr><td>Elimination</td><td>Ashley</td><td>Next</td></tr></tbody></table>'
      + '<div class="nb-todo-line"><input type="checkbox" checked="">&nbsp;Practice exam 1</div><div class="nb-todo-line"><input type="checkbox">&nbsp;Office hours Thursday</div>',
  };
}
// Puts the sample note into the list while the sample semester has one.
function nbSharedEnsureSample() {
  // A sample semester loaded before this note existed gets it once.
  if (state.settings.sampleData && state.sampleSharedNote === undefined) state.sampleSharedNote = nbMakeSampleSharedNote();
  const sample = state.sampleSharedNote;
  if (!sample) { if (_nbShared.list.has(NB_SAMPLE_SID)) _nbShared.list.delete(NB_SAMPLE_SID); return; }
  const rec = _nbShared.list.get(NB_SAMPLE_SID);
  if (rec) { rec.title = sample.title; return; }
  _nbShared.list.set(NB_SAMPLE_SID, {
    ...nbSharedRecord(NB_SAMPLE_SID, { title: sample.title, content: sample.content, ownerUid: 'sample-maya', editorUids: NB_SAMPLE_PEOPLE.map(p => p[0]), people: Object.fromEntries(NB_SAMPLE_PEOPLE.map(([u, name]) => [u, { name }])), updatedAt: sample.updatedAt }),
    sample: true,
  });
}
function nbSampleSave(rec) {
  const sample = state.sampleSharedNote;
  if (!sample || !rec) return;
  sample.content = rec.content; sample.title = rec.title; sample.updatedAt = rec.updatedAt = Date.now();
  save();
  nbSharedStatus('Saved just now');
}

/* ── ?note=ID.KEY invite links ── */
function captureNoteParam() {
  const params = new URLSearchParams(location.search);
  if (!params.has('note')) return;
  const [sid, key] = String(params.get('note') || '').split('.');
  params.delete('note');
  history.replaceState({}, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
  if (NB_SHARED_ID.test(sid || '') && /^[A-Za-z0-9]{20,64}$/.test(key || '') && !isEmbedded()) {
    try { localStorage.setItem(PENDING_NOTE_KEY, JSON.stringify({ sid, key, at: Date.now() })); } catch {}
  }
}
function pendingNote() { try { const p = JSON.parse(localStorage.getItem(PENDING_NOTE_KEY) || 'null'); return p?.sid && Date.now() - p.at < 14 * 86400000 ? p : null; } catch { return null; } }
let _nbNoteInviteShown = false, _nbJoining = false;
async function handlePendingNote() {
  const p = pendingNote();
  if (!p || !fbConfigured() || _nbJoining) return;
  if (!_fbUser) {
    if (_nbNoteInviteShown) return;
    _nbNoteInviteShown = true;
    openModal(`
      <div class="modal-head"><h3>A classmate shared a note with you</h3>${closeXButton()}</div>
      <div class="modal-body"><p class="small muted">Log in or create your Semester HQ account to open it. You can write in it together, and see each other’s changes as they happen.</p></div>
      <div class="modal-foot"><button class="btn" onclick="closeModal()">Look around first</button><a class="btn btn-primary" href="login.html">Log in to open it</a></div>
    `);
    return;
  }
  if (!nbSharedEnabled()) return;
  _nbJoining = true;
  const me = _fbUser.uid;
  const ref = nbSharedCol().doc(p.sid);
  try {
    let snap = null;
    try { snap = await ref.get(); } catch {}
    if (!snap || !snap.exists || !(snap.data().editorUids || []).includes(me)) {
      const batch = _fbDb.batch();
      batch.set(ref.collection('joins').doc(me), { key: p.key, at: Date.now() });
      batch.update(ref, { editorUids: firebase.firestore.FieldValue.arrayUnion(me), [`people.${me}`]: { name: String(myGroupName()).slice(0, 60) } });
      await batch.commit();
      snap = await ref.get();
    }
    try { localStorage.removeItem(PENDING_NOTE_KEY); } catch {}
    _nbShared.list.set(p.sid, nbSharedRecord(p.sid, snap.data()));
    _nbShared.loadedAt = 0;
    nbShowNoteOnPhone();
    setState({ route: 'notebook', subRoute: null, notebookSelected: NB_SHARED_PREFIX + p.sid });
    toast(`You’re in “${snap.data().title || 'Untitled'}”. Everyone on it sees your changes live.`, 'success', 5000);
  } catch (e) {
    diag.warn('notebook', 'Could not join a shared note', e);
    try { localStorage.removeItem(PENDING_NOTE_KEY); } catch {}
    toast('That note link doesn’t work anymore. Ask whoever sent it for a new one.', 'error', 7000);
  } finally { _nbJoining = false; }
}

/* Wiring that only needs to happen once */
let _nbSharedWired = false;
function wireNbShared() {
  if (_nbSharedWired) return;
  _nbSharedWired = true;
  document.addEventListener('selectionchange', () => { if (_nbShared.open) nbSharedCaretMoved(); });
  document.addEventListener('input', e => { if (_nbShared.open && e.target.closest?.('#note-editor')) requestAnimationFrame(nbDrawCarets); });
  window.addEventListener('resize', () => { if (_nbShared.open) nbDrawCarets(); });
  // Leaving the page or the tab: off the "who's here" row, and the last words sent.
  window.addEventListener('pagehide', () => nbSharedDetach());
  document.addEventListener('visibilitychange', () => {
    const o = _nbShared.open;
    if (!o) return;
    if (document.visibilityState === 'hidden') { if (o.timer || o.maxTimer) { clearTimeout(o.timer); clearTimeout(o.maxTimer); o.timer = o.maxTimer = 0; nbSharedPush(o.sid); } }
    else nbSharedBeat(o);
  });
}
