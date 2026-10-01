/* ── Clubs & teams: chat ───────────────────────────────────────────
   Moved out of js/orgs.js as is (Tier A item 15), plus the shared
   renderer: orgChatTab draws through chatView (js/spaces/chat.js), and
   sendOrgMessage / deleteOrgMessage keep the club's own writes. Also holds
   afterOrgPageRender, which runs after every render.
──────────────────────────────────────────────────────────────── */
/* ── Chat ─────────────────────────────────────────────────────────
   Everyone in the club can post. Messages live in orgs/CODE/messages and
   only load while the Chat tab is open; lastMessage on the club doc drives
   the unread dots everywhere else. Officers can delete any message. */
const _orgMessages = {};
const _orgChatFailed = {};
let _orgChatSub = { code: null, unsub: null };
function orgMessages(o) {
  const list = o.local ? (orgEntry(o.code)?.messages || []) : (_orgMessages[o.code] || []);
  return list.filter(m => m && safeId(m.id) && typeof m.text === 'string' && typeof m.at === 'number');
}
function closeOrgChatListener() { if (_orgChatSub.code) chatDropStore('club', _orgChatSub.code); if (_orgChatSub.unsub) _orgChatSub.unsub(); _orgChatSub = { code: null, unsub: null }; }
function ensureOrgChatListener(code) {
  const entry = orgEntry(code);
  if (!entry?.cloud || !cloudGroupsEnabled() || _orgChatFailed[code]) { closeOrgChatListener(); return; }
  if (_orgChatSub.code === code) return;
  closeOrgChatListener();
  _orgChatSub.code = code;
  _orgChatSub.unsub = _fbDb.collection('orgs').doc(code).collection('messages').orderBy('at').limitToLast(200).onSnapshot(snap => {
    // Merged, not replaced, so pages from "Load earlier" survive the window sliding.
    _orgMessages[code] = chatMergeWindow('club', code, snap.docs.map(d => ({ ...d.data(), id: d.id })));
    renderRemote();
  }, err => {
    diag.error('clubs', 'Club chat listener failed', err);
    _orgChatFailed[code] = true; // not retried until the tab is opened again, so a failure can't loop
    _orgChatSub = { code: null, unsub: null };
    renderRemote();
  });
}
// Runs after every render (see render() in app.js).
function afterOrgPageRender() {
  const code = state.route === 'orgs' ? state.subRoute : null;
  if (code && typeof centerActiveSgTab === 'function') centerActiveSgTab();
  if (code && state.orgTab === 'admin' && typeof orgAttEdges === 'function') orgAttEdges();
  // The group page runs it from afterGroupPageRender; everywhere else this
  // one does, which also drops the sticky-row watcher on pages without one.
  if (state.route !== 'studygroups' && typeof afterSpaceRender === 'function') afterSpaceRender();
  if (!code || state.orgTab !== 'chat' || !orgEntry(code)) {
    chatForget('club', code ? state.orgTab : '');
    if (_orgChatSub.code) closeOrgChatListener();
    Object.keys(_orgChatFailed).forEach(k => delete _orgChatFailed[k]);
    return;
  }
  ensureOrgChatListener(code);
  // Scroll, the "new" line, composer height and the seen marker: js/spaces/chat.js.
  chatAfterRender('club', code);
}
// Drawn by chatView (js/spaces/chat.js); the data and writes stay here.
function orgChatTab(o) {
  const me = myOrgUid(o);
  const officer = isOrgOfficer(o);
  const people = orgPeople(o);
  const byUid = Object.fromEntries(people.map((p, i) => [p.uid, { ...p, i }]));
  const color = orgColor(o);
  const loading = !o.local && !_orgMessages[o.code] && !_orgChatFailed[o.code];
  const noun = o.kind === 'team' ? 'team' : o.kind === 'chapter' ? 'chapter' : 'club';
  const n = people.length;
  return chatView({
    kind: 'club', code: o.code, messages: orgMessages(o), me, people,
    who: (m) => byUid[m.uid]?.name || cleanStr(m.name, 60) || 'Former member',
    // Officers wear the club color; everyone else a lighter step of it.
    avatarColor: (m) => { const p = byUid[m.uid]; return !p ? '#6b6b6b' : p.officer ? color : spaceTint(color, 1 + (p.i % 3)); },
    roleHtml: (m) => { const p = byUid[m.uid]; return p ? `<span class="chat-role${p.officer ? ' is-officer' : ''}">${esc(orgRoleLabel(o, p))}</span>` : ''; },
    canDelete: (m) => m.uid === me || officer,
    deleteJs: (m) => `deleteOrgMessage('${o.code}','${esc(m.id)}')`,
    sendJs: `sendOrgMessage('${o.code}')`,
    placeholder: `Message ${o.name}`,
    stateHtml: _orgChatFailed[o.code] ? emptyState(icon('message-circle', 24), 'Chat didn’t load', `<button class="btn btn-sm mt-8" onclick="delete _orgChatFailed['${o.code}'];render()">Try again</button>`, 'Check your connection, then try again.')
      : loading ? '<div class="chat-loading small muted">Loading messages…</div>'
      : emptyState(icon('message-circle', 24), 'No messages yet', '', `Say hi to ${o.name}. Everyone in the ${noun} sees this chat.`),
    crest: { text: orgMonogram(o) }, title: o.name, sub: `${n} member${n === 1 ? '' : 's'}`,
  });
}
// preset: a message to send (Share to chat) instead of what's in the box.
async function sendOrgMessage(code, preset) {
  const input = $('#org-chat-input');
  const fromBox = typeof preset !== 'string';
  const text = (fromBox ? input?.value || '' : preset).trim();
  const entry = orgEntry(code);
  const o = findOrg(code);
  if (!text || !entry || !o) return;
  const msg = { id: uid(), uid: myOrgUid(o), name: myGroupName(), text: text.slice(0, GROUP_MESSAGE_MAX), at: Date.now() };
  const lastMessage = { uid: msg.uid, name: msg.name, text: msg.text.slice(0, 140), at: msg.at };
  if (fromBox && input) { input.value = ''; chatGrow(input); }
  chatPinBottom('club', code);
  if (entry.local) {
    entry.messages = [...(entry.messages || []), msg].slice(-200);
    entry.lastMessage = lastMessage;
    orgChatSeen()[code] = msg.at;
    touch();
    if (fromBox) $('#org-chat-input')?.focus();
    return;
  }
  if (!cloudGroupsEnabled()) { if (fromBox && input) input.value = text; toast('Log in to chat with your club.', 'error'); return; }
  try {
    const ref = _fbDb.collection('orgs').doc(code);
    await ref.collection('messages').doc(msg.id).set(msg);
    ref.update({ lastMessage, updatedAt: Date.now() }).catch(e => diag.warn('clubs', 'Club lastMessage update failed', e));
    markOrgChatSeen(code, msg.at);
    playUiSound('send');
  } catch (e) {
    diag.error('clubs', 'Club message failed', e);
    const box = $('#org-chat-input');
    if (fromBox && box && !box.value) { box.value = text; chatGrow(box); }
    toast('Message didn’t send. Check your connection and try again.', 'error');
  }
}
function deleteOrgMessage(code, id) {
  const entry = orgEntry(code);
  if (!entry || !safeId(id)) return;
  confirmDialog('It’s removed for everyone in the chat.', () => removeOrgMessage(code, id), 'Delete', 'Delete this message?');
}
// If it was the newest message, the club's preview goes back one. The
// rules let officers rewrite lastMessage, and members only to a message of
// their own, so a member's delete otherwise leaves the preview as it was.
async function removeOrgMessage(code, id) {
  const entry = orgEntry(code);
  const o = findOrg(code);
  if (!entry || !o) return;
  const list = orgMessages(o);
  const gone = list.find(m => m.id === id);
  const wasLatest = !!gone && !!o.lastMessage && o.lastMessage.at === gone.at;
  const prev = chatPreviewAfterDelete(list, id);
  if (entry.local) {
    entry.messages = (entry.messages || []).filter(m => m.id !== id);
    if (wasLatest) entry.lastMessage = prev;
    touch();
    return;
  }
  try {
    const ref = _fbDb.collection('orgs').doc(code);
    await ref.collection('messages').doc(id).delete();
    chatRemoveLocal('club', code, id);
    if (wasLatest && (isOrgOfficer(o) || (prev && prev.uid === myOrgUid(o)))) {
      ref.update({ lastMessage: prev, updatedAt: Date.now() }).catch(e => diag.warn('clubs', 'Club lastMessage update failed', e));
    }
    renderRemote();
  } catch { toast('Couldn’t delete that message.', 'error'); }
}
