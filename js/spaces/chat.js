/* ── Spaces: chat, shared by study groups and clubs ─────────────────
   One renderer for both chats. It draws; each feature keeps its own data
   and its own writes (sendGroupMessage / deleteGroupMessage in
   js/studygroups.js, sendOrgMessage / deleteOrgMessage in js/orgs.js).
   Messages keep their shape { id, uid, name, text, at } and nothing here
   writes to Firestore except the one-off read that pages back through
   history. The only settings it reads are the existing seen markers
   (groupChatSeen / orgChatSeen); the scroll and "Not now" state below is
   per tab, in memory.

   CHAT_ADAPTERS[kind]            kind is 'group' or 'club'. Per kind:
     logId, inputId               the ids tests and sends rely on:
                                  #sg-chat-log / #sg-chat-input and
                                  #org-chat-log / #org-chat-input
     seen(code) -> ms             the stored "seen up to" time
     markSeen(code)               markChatSeen / markOrgChatSeen
     list(code) -> messages       everything loaded, oldest first
     cloud(code) -> boolean       a Firestore space (not local or sample)
     ref(code)                    the messages collection
     store(code, list)            write the merged list back to
                                  _groupMessages / _orgMessages
     tab()                        the page's current tab key
     event(code, id)              the session or event, or null
     openEventJs(code, id)        onclick JS that opens its sheet
     link(code, id)               the deep link Share to chat posts
     send(code, text)             the feature's own send, with preset text
     open(code)                   open that space on its Chat tab

   chatView(o) -> HTML            the whole Chat tab. o:
     { kind, code, messages, me, people: [{ uid, name }],
       who(m) -> display name, avatarColor(m) -> hex,
       roleHtml(m) -> '' | trusted HTML after the name,
       canDelete(m) -> boolean, deleteJs(m) -> onclick JS,
       sendJs -> onclick JS, placeholder, stateHtml (shown instead of the
       log when there is nothing to list: loading, failed, empty),
       crest ({ text, sub }), title, sub (the phone sheet's header) }
     Draws day separators, sender grouping (same person, same day,
     within 5 minutes), the "New since you were last here" line (from the
     seen marker as it was when this chat opened), "Load earlier
     messages", @mentions of people in the space, link cards for plain
     URLs and event cards for links to this space's own sessions or
     events (with the RSVP inline). The composer is a textarea that grows
     to 6 lines: Enter sends on a keyboard, Shift+Enter adds a line, a
     touch keyboard's Return adds a line and the send button sends.
     On phones (760px and under) the whole view is a full-height sheet
     over the page, sized to the visual viewport so the composer sits
     above the bottom tab bar or the keyboard.

   chatAfterRender(kind, code)    call after every render that drew the
                                  log; places the scroll (at the "new"
                                  line on open, then at the bottom or
                                  where the reader left it), grows the
                                  composer, fits the card, marks seen.
   chatForget(kind, tab)          call after renders without the log:
                                  closes this kind's chat state, so the
                                  next open takes a fresh seen snapshot.
   chatMergeWindow(kind, code, docs) -> list
                                  for the live listener: merges a
                                  limitToLast snapshot into everything
                                  loaded, dropping ids inside the window
                                  that the snapshot no longer has
                                  (deleted), keeping older pages.
   chatDropStore(kind, code)      forget loaded history (listener closed).
   chatRemoveLocal(kind, code, id) drop one message from loaded history.
   chatLoadOlder(kind, code)      "Load earlier messages": shows more of
                                  what is loaded, else reads the next 50
                                  older messages once (cloud only), and
                                  keeps the reader's place.
   chatPreviewAfterDelete(list, id) -> lastMessage | null
                                  the preview to write back when the
                                  newest message is deleted.
   chatEnterSends(event) -> boolean
   chatGrow(textarea)
   chatTokens(text, names) -> [{ t: 'text'|'url'|'mention', v, uids }]
   chatNameIndex(people) -> names for chatTokens
   chatParseSpaceLink(url) -> { kind, code, id } | null
   chatPreviewText(text, kind, code) -> plain text for one-line previews
   chatEventLink(kind, code, id) -> URL
   shareToSpaceChat(kind, code, id)   the sheets' "Share to chat"
   chatShareButton(kind, code, id)    that button's HTML
   chatCloseSheet(kind)           the phone sheet's back button
──────────────────────────────────────────────────────────────── */
const CHAT_WINDOW = 200;          // the live listener's limitToLast
const CHAT_PAGE = 50;             // one "Load earlier" step
const CHAT_SHOW = 150;            // messages drawn when the chat opens
const CHAT_GROUP_MS = 5 * 60000;  // same sender within this reads as one run
const CHAT_CARDS_MAX = 3;
const CHAT_ADAPTERS = {
  group: {
    logId: 'sg-chat-log', inputId: 'sg-chat-input',
    seen: (code) => groupChatSeen()[code] || 0,
    markSeen: (code) => markChatSeen(code),
    list: (code) => { const g = findGroup(code); return g ? groupMessages(g) : []; },
    cloud: (code) => !!groupEntry(code)?.cloud && cloudGroupsEnabled(),
    ref: (code) => _fbDb.collection('studyGroups').doc(code).collection('messages'),
    store: (code, list) => { _groupMessages[code] = list; },
    tab: () => state.groupTab,
    event: (code, id) => SPACE_RSVP_ADAPTERS.group.event(code, id),
    openEventJs: (code, id) => `showGroupSessionModal('${esc(code)}','${esc(id)}')`,
    link: (code, id) => `${groupInviteLink(code)}&session=${encodeURIComponent(id)}`,
    send: (code, text) => sendGroupMessage(code, text),
    open: (code) => openGroup(code, 'chat'),
  },
  club: {
    logId: 'org-chat-log', inputId: 'org-chat-input',
    seen: (code) => orgChatSeen()[code] || 0,
    markSeen: (code) => markOrgChatSeen(code),
    list: (code) => { const o = findOrg(code); return o ? orgMessages(o) : []; },
    cloud: (code) => !!orgEntry(code)?.cloud && cloudGroupsEnabled(),
    ref: (code) => _fbDb.collection('orgs').doc(code).collection('messages'),
    store: (code, list) => { _orgMessages[code] = list; },
    tab: () => state.orgTab,
    event: (code, id) => SPACE_RSVP_ADAPTERS.club.event(code, id),
    openEventJs: (code, id) => `showOrgEventModal('${esc(code)}','${esc(id)}')`,
    link: (code, id) => `${orgInviteLink(code)}&event=${encodeURIComponent(id)}`,
    send: (code, text) => sendOrgMessage(code, text),
    open: (code) => openOrg(code, 'chat'),
  },
};
const _chatStores = {};   // 'group:CODE' -> { byId: Map, full, noMore, loading }
const _chatViews = {};    // 'group:CODE' -> { seen, placed, shown, top, atBottom }
const _chatPrevTab = {};  // kind -> the tab the phone sheet goes back to
function chatKey(kind, code) { return `${kind}:${code}`; }
function chatValidMessage(m) { return !!m && safeId(m.id) && typeof m.text === 'string' && typeof m.at === 'number'; }
function _chatSorted(st) { return [...st.byId.values()].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); }
function _chatStore(kind, code) {
  const key = chatKey(kind, code);
  return _chatStores[key] || (_chatStores[key] = { byId: new Map(), full: false, noMore: false, loading: false });
}
function chatViewState(kind, code) {
  const key = chatKey(kind, code);
  if (!_chatViews[key]) {
    let seen = 0;
    try { seen = CHAT_ADAPTERS[kind].seen(code) || 0; } catch {}
    _chatViews[key] = { seen, placed: false, shown: CHAT_SHOW, top: 0, atBottom: true };
  }
  return _chatViews[key];
}

/* ── History: the live window plus older pages ── */
function chatMergeWindow(kind, code, docs) {
  const st = _chatStore(kind, code);
  const clean = (docs || []).filter(chatValidMessage);
  const ids = new Set(clean.map(m => m.id));
  const minAt = clean.length ? Math.min(...clean.map(m => m.at)) : -Infinity;
  // Anything the window covers but no longer returns was deleted; anything
  // older than the window slid out of it (or came from a page) and stays.
  for (const [id, m] of st.byId) if (m.at >= minAt && !ids.has(id)) st.byId.delete(id);
  clean.forEach(m => st.byId.set(m.id, m));
  st.full = clean.length >= CHAT_WINDOW;
  return _chatSorted(st);
}
function chatDropStore(kind, code) { delete _chatStores[chatKey(kind, code)]; }
function chatRemoveLocal(kind, code, id) {
  const st = _chatStores[chatKey(kind, code)];
  if (!st || !st.byId.delete(id)) return;
  CHAT_ADAPTERS[kind].store(code, _chatSorted(st));
}
// Keep the reader's place when rows are added above: the distance from
// the bottom of the log is what stays put.
function _chatKeepPlace(kind, fn) {
  const a = CHAT_ADAPTERS[kind];
  const before = document.getElementById(a.logId);
  const fromBottom = before ? before.scrollHeight - before.scrollTop : 0;
  fn();
  const log = document.getElementById(a.logId);
  if (log && before) log.scrollTop = Math.max(0, log.scrollHeight - fromBottom);
}
async function chatLoadOlder(kind, code, btn) {
  const a = CHAT_ADAPTERS[kind];
  if (!a) return;
  const v = chatViewState(kind, code);
  const all = a.list(code);
  if (all.length > v.shown) { _chatKeepPlace(kind, () => { v.shown += CHAT_PAGE; renderPreservingInput(); }); return; }
  const st = _chatStores[chatKey(kind, code)];
  if (!a.cloud(code) || !st || !st.full || st.noMore || st.loading || !all.length) return;
  st.loading = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
  try {
    const snap = await a.ref(code).orderBy('at').endBefore(all[0].at).limitToLast(CHAT_PAGE).get();
    const docs = snap.docs.map(d => ({ ...d.data(), id: d.id })).filter(chatValidMessage);
    docs.forEach(m => st.byId.set(m.id, m));
    if (docs.length < CHAT_PAGE) st.noMore = true;
    a.store(code, _chatSorted(st));
    _chatKeepPlace(kind, () => { v.shown = all.length + docs.length; renderPreservingInput(); });
  } catch (e) {
    diag.warn(kind === 'club' ? 'clubs' : 'studygroups', 'Could not load earlier messages', e);
    toast('Couldn’t load earlier messages. Check your connection and try again.', 'error');
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = 'Load earlier messages'; }
  } finally { st.loading = false; }
}
// The newest message left once `id` is gone, shaped as lastMessage.
function chatPreviewAfterDelete(list, id) {
  const rest = (list || []).filter(m => m && m.id !== id);
  const m = rest[rest.length - 1];
  return m ? { uid: m.uid, name: m.name || '', text: String(m.text || '').slice(0, 140), at: m.at } : null;
}

/* ── Words: URLs and @mentions, tokenized once from the raw text ── */
function chatNameIndex(people) {
  const map = new Map();
  const add = (key, uid) => { key = key.trim().toLowerCase(); if (key.length < 2) return; if (!map.has(key)) map.set(key, new Set()); map.get(key).add(uid); };
  (people || []).forEach(p => {
    const name = String(p?.name || '').trim();
    if (!name || !p.uid) return;
    add(name, p.uid);
    const first = name.split(/\s+/)[0];
    if (first !== name) add(first, p.uid);
  });
  return [...map].map(([key, uids]) => ({ key, uids: [...uids] })).sort((a, b) => b.key.length - a.key.length);
}
function _chatNameAt(s, pos, names) {
  const rest = s.slice(pos).toLowerCase();
  for (const n of names) {
    if (!rest.startsWith(n.key)) continue;
    if (/[\p{L}\p{N}_]/u.test(rest[n.key.length] || '')) continue;
    return n;
  }
  return null;
}
function chatTokens(text, names = []) {
  const s = String(text || '');
  const out = [];
  const re = /https?:\/\/[^\s<>"]+|@/g;
  let i = 0, m;
  const plain = (end) => { if (end > i) out.push({ t: 'text', v: s.slice(i, end) }); };
  while ((m = re.exec(s))) {
    if (m[0] === '@') {
      // Not an email address: the @ starts a word.
      if (m.index && /[\p{L}\p{N}_.]/u.test(s[m.index - 1])) continue;
      const hit = _chatNameAt(s, m.index + 1, names);
      if (!hit) continue;
      plain(m.index);
      out.push({ t: 'mention', v: s.slice(m.index, m.index + 1 + hit.key.length), uids: hit.uids });
      i = re.lastIndex = m.index + 1 + hit.key.length;
    } else {
      let url = m[0].replace(/[.,;:!?'"’”]+$/, '');
      // A closing bracket belongs to the URL only when the URL opened one.
      while (/[)\]}]$/.test(url) && (url.match(/[([{]/g) || []).length < (url.match(/[)\]}]/g) || []).length) url = url.slice(0, -1).replace(/[.,;:!?'"’”]+$/, '');
      plain(m.index);
      out.push({ t: 'url', v: url });
      i = re.lastIndex = m.index + url.length;
    }
  }
  plain(s.length);
  return out;
}
// A long URL reads as host and path, cut to fit; the href stays whole.
function chatShortUrl(url) {
  let u;
  try { u = new URL(url); } catch { return url; }
  const s = u.hostname.replace(/^www\./, '') + decodeURIComponentSafe(u.pathname + u.search + u.hash).replace(/\/$/, '');
  return s.length > 48 ? s.slice(0, 47) + '…' : s;
}
// hide: URLs drawn as event cards, left out of the bubble's text.
function _chatTokensHtml(tokens, me, hide) {
  const list = hide && hide.size ? tokens.filter(tk => !(tk.t === 'url' && hide.has(tk.v))) : tokens;
  // Trim the space a removed link leaves at the end.
  if (list !== tokens && list.length && list[list.length - 1].t === 'text') list[list.length - 1] = { ...list[list.length - 1], v: list[list.length - 1].v.replace(/\s+$/, '') };
  return list.map(tk => {
    if (tk.t === 'url') return `<a href="${esc(tk.v)}" target="_blank" rel="noopener noreferrer" title="${esc(tk.v)}">${esc(chatShortUrl(tk.v))}</a>`;
    if (tk.t === 'mention') return `<span class="chat-mention${tk.uids.includes(me) ? ' is-me' : ''}">${esc(tk.v)}</span>`;
    return esc(tk.v);
  }).join('');
}

// One line of a message for previews (the home card, index cards): a
// link to this space's own session or event reads as its title, any
// other URL as host and path.
function chatPreviewText(text, kind, code) {
  return chatTokens(text).map(tk => {
    if (tk.t !== 'url') return tk.v;
    const link = chatParseSpaceLink(tk.v);
    let ev = null;
    if (link && link.kind === kind && link.code === code) { try { ev = CHAT_ADAPTERS[kind].event(code, link.id); } catch {} }
    return ev?.title ? `“${ev.title}”` : chatShortUrl(tk.v);
  }).join('');
}

/* ── Cards under a bubble ── */
function chatEventLink(kind, code, id) { return CHAT_ADAPTERS[kind].link(code, id); }
function chatParseSpaceLink(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const ours = (typeof location !== 'undefined' && u.host === location.host) || /(^|\.)semester-hq\.com$/i.test(u.hostname);
  if (!ours) return null;
  const p = u.searchParams;
  const pick = (codeKey, idKey, kind) => {
    const code = String(p.get(codeKey) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const id = p.get(idKey) || '';
    return code.length === 6 && safeId(id) ? { kind, code, id } : null;
  };
  if (p.has('join') && p.has('session')) return pick('join', 'session', 'group');
  if (p.has('org') && p.has('event')) return pick('org', 'event', 'club');
  return null;
}
function chatLinkCard(url) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  const host = u.hostname.replace(/^www\./, '');
  if (!host) return '';
  let path = decodeURIComponentSafe(u.pathname + u.search).replace(/\/$/, '');
  if (path.length > 64) path = path.slice(0, 63) + '…';
  return `<a class="chat-link-card" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
    <span class="chat-link-tile" aria-hidden="true">${esc(host[0].toUpperCase())}</span>
    <span class="chat-link-text"><span class="chat-link-host">${esc(host)}</span>${path ? `<span class="chat-link-path">${esc(path)}</span>` : ''}</span>
    ${icon('arrow-up-right', 14)}
  </a>`;
}
function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }
function chatEventCard(kind, code, id) {
  const a = CHAT_ADAPTERS[kind];
  let ev = null;
  try { ev = a.event(code, id); } catch {}
  if (!ev || !ev.date) return '';
  const title = ev.title || (kind === 'club' ? 'Event' : 'Session');
  const st = eventTimeState(ev);
  const when = [fmtSessionDay(ev.date), _evTimeRange(ev.start, ev.end)].filter(Boolean).join(' · ');
  // A dues deadline takes no RSVP, the same as its sheet.
  const dues = kind === 'club' && typeof orgIsDuesEvent === 'function' && orgIsDuesEvent(ev);
  const rsvp = st.phase === 'after'
    ? '<span class="chat-event-ended">Ended</span>'
    : dues ? '' : spaceRsvp({ kind, code, id, title, mine: spaceRsvpMine(kind, code, id), size: 'row' });
  return `<div class="chat-event-card"${spaceLiveAttrs(ev)}>
    <button type="button" class="chat-event-open" onclick="${a.openEventJs(code, id)}" aria-label="Open ${esc(title)}">
      ${spaceDateBlock(ev.date, { size: 'tile' })}
      <span class="chat-event-text"><span class="chat-event-title">${esc(title)}</span><span class="chat-event-when">${esc(when)}</span>${st.phase === 'now' ? spaceWhenChip(ev) : ''}</span>
    </button>
    ${rsvp ? `<div class="chat-event-rsvp">${rsvp}</div>` : ''}
  </div>`;
}
// -> { html, events: Set of the URLs drawn as event cards }
function _chatCards(kind, code, urls) {
  const events = new Set();
  const html = [...new Set(urls)].slice(0, CHAT_CARDS_MAX).map(url => {
    const link = chatParseSpaceLink(url);
    const card = link && link.kind === kind && link.code === code ? chatEventCard(kind, code, link.id) : '';
    if (card) { events.add(url); return card; }
    return chatLinkCard(url);
  }).join('');
  return { html, events };
}

/* ── The view ── */
function _chatTime(at) { return new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
function chatView(o) {
  const kind = o.kind === 'club' ? 'club' : 'group';
  const a = CHAT_ADAPTERS[kind];
  const code = o.code;
  const v = chatViewState(kind, code);
  const all = o.messages || [];
  const shown = all.slice(Math.max(0, all.length - v.shown));
  const st = _chatStores[chatKey(kind, code)];
  let cloud = false;
  try { cloud = a.cloud(code); } catch {}
  const canOlder = all.length > shown.length || (cloud && st && st.full && !st.noMore && all.length > 0);
  const firstNew = v.seen ? shown.find(m => m.at > v.seen && m.uid !== o.me) : null;
  const names = chatNameIndex(o.people);
  let lastDay = '', lastUid = '', lastAt = 0;
  const rows = shown.map(m => {
    const day = iso(new Date(m.at));
    let pre = '';
    if (day !== lastDay) pre += `<div class="chat-day" role="separator"><span>${esc(fmtSessionDay(day))}</span></div>`;
    if (firstNew && m.id === firstNew.id) pre += `<div class="chat-new" role="separator" aria-label="New since you were last here"><span>New since you were last here</span></div>`;
    const grouped = !pre && lastUid === m.uid && m.at - lastAt < CHAT_GROUP_MS;
    lastDay = day; lastUid = m.uid; lastAt = m.at;
    const mine = m.uid === o.me;
    const tokens = chatTokens(m.text, names);
    const urls = tokens.filter(t => t.t === 'url').map(t => t.v);
    const cards = urls.length ? _chatCards(kind, code, urls) : { html: '', events: new Set() };
    // No bubble when the message is only links, or only event links.
    const words = tokens.filter(t => (t.t === 'text' ? t.v.trim() : !(t.t === 'url' && (cards.events.has(t.v) || urls.length === 1))));
    const onlyLink = !words.length && urls.length > 0;
    const mentionsMe = !mine && tokens.some(t => t.t === 'mention' && t.uids.includes(o.me));
    const who = o.who ? o.who(m) : (m.name || 'Member');
    const time = _chatTime(m.at);
    const head = grouped ? '' : mine
      ? `<div class="chat-msg-name is-mine"><time class="chat-msg-time">${esc(time)}</time></div>`
      : `<div class="chat-msg-name"><span class="chat-msg-who">${esc(who)}</span>${o.roleHtml ? o.roleHtml(m) : ''}<time class="chat-msg-time">${esc(time)}</time></div>`;
    const face = mine ? '' : grouped ? '<span class="chat-msg-spacer" aria-hidden="true"></span>' : personAvatar(m.uid, who, 28, o.avatarColor ? o.avatarColor(m) : '#6b6b6b');
    const bubble = onlyLink ? '' : `<div class="chat-bubble" title="${esc(new Date(m.at).toLocaleString())}">${_chatTokensHtml(tokens, o.me, cards.events)}</div>`;
    const cardsHtml = cards.html ? `<div class="chat-cards">${cards.html}</div>` : '';
    const del = o.canDelete && o.canDelete(m) ? `<button type="button" class="chat-msg-del" aria-label="Delete message" data-tip="Delete" onclick="${o.deleteJs(m)}">${icon('trash', 13)}</button>` : '';
    return `${pre}<div class="chat-msg${mine ? ' is-mine' : ''}${grouped ? ' is-grouped' : ''}${mentionsMe ? ' is-mention' : ''}" data-mid="${esc(m.id)}">
      ${face}<div class="chat-msg-body">${head}${bubble}${cardsHtml}</div>${del}
    </div>`;
  }).join('');
  const older = canOlder ? `<div class="chat-older"><button type="button" class="btn btn-ghost btn-sm" onclick="chatLoadOlder('${kind}','${esc(code)}',this)">Load earlier messages</button></div>` : '';
  const logBody = shown.length ? `${older}${rows}` : (o.stateHtml || '');
  const sendArgs = o.sendJs;
  return `
    <div class="chat-view chat-${kind}">
      <div class="card chat-card">
        <div class="chat-sheet-head">
          <button type="button" class="chat-sheet-back" aria-label="Close chat" onclick="chatCloseSheet('${kind}')">${icon('chevron-left', 20)}</button>
          ${o.crest ? spaceCrest(o.crest, 'md') : ''}
          <span class="chat-sheet-title"><span class="chat-sheet-name">${esc(o.title || '')}</span>${o.sub ? `<span class="chat-sheet-sub">${esc(o.sub)}</span>` : ''}</span>
        </div>
        <div class="chat-log" id="${a.logId}" data-keep-scroll="bottom" role="log" aria-label="Messages">${logBody}</div>
        <div class="chat-compose">
          <textarea class="input chat-input" id="${a.inputId}" rows="1" maxlength="${GROUP_MESSAGE_MAX}" autocomplete="off" enterkeyhint="enter" aria-label="${esc(o.placeholder || 'Message')}" placeholder="${esc(o.placeholder || 'Message')}" oninput="chatGrow(this)" onkeydown="if(chatEnterSends(event)){event.preventDefault();${sendArgs}}"></textarea>
          <button type="button" class="chat-send" aria-label="Send message" data-tip="Send" onclick="${sendArgs}">${icon('send', 16)}</button>
        </div>
        <div class="chat-hint" aria-hidden="true">Enter to send · Shift+Enter for a new line</div>
      </div>
    </div>`;
}

/* ── Composer ── */
function chatTouchKeyboard() {
  try { return window.matchMedia('(hover: none) and (pointer: coarse)').matches; } catch { return false; }
}
function chatEnterSends(e) {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return false;
  return !chatTouchKeyboard();
}
function chatGrow(el) {
  if (!el || el.tagName !== 'TEXTAREA') return;
  const log = el.closest('.chat-card')?.querySelector('.chat-log');
  const atBottom = log ? log.scrollHeight - log.scrollTop - log.clientHeight < 48 : false;
  el.style.height = 'auto';
  const cs = getComputedStyle(el);
  const edge = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  const max = parseFloat(cs.maxHeight) || 160;
  const h = Math.min(el.scrollHeight + edge, max);
  el.style.height = `${Math.ceil(h)}px`;
  el.style.overflowY = el.scrollHeight + edge > max + 1 ? 'auto' : 'hidden';
  if (log && atBottom) log.scrollTop = log.scrollHeight;
}
// Before a send: jump to the bottom, so the redraw that brings the new
// message in keeps the log pinned there.
function chatPinBottom(kind, code) {
  const v = chatViewState(kind, code);
  v.atBottom = true;
  const log = document.getElementById(CHAT_ADAPTERS[kind].logId);
  if (log) log.scrollTop = log.scrollHeight;
}

/* ── Layout: the desktop card fits the window; the phone sheet fits the
   visual viewport (above the tab bar, or above the keyboard) ── */
const CHAT_PHONE_MQ = '(max-width: 760px)';
function chatIsPhone() { try { return window.matchMedia(CHAT_PHONE_MQ).matches; } catch { return false; } }
function chatFit() {
  const card = document.querySelector('#content .chat-card');
  if (!card) return;
  if (chatIsPhone()) {
    card.style.height = '';
    const vv = window.visualViewport;
    const root = document.documentElement;
    const top = vv ? Math.max(0, Math.round(vv.offsetTop)) : 0;
    const kb = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
    const bar = document.getElementById('sidebar');
    const nav = bar ? bar.offsetHeight : 0;
    root.style.setProperty('--chat-top', `${top}px`);
    root.style.setProperty('--chat-bottom', `${kb > 40 ? kb : nav}px`);
    return;
  }
  const top = card.getBoundingClientRect().top + window.scrollY;
  const h = Math.max(420, Math.min(720, window.innerHeight - top - 24));
  card.style.height = `${Math.round(h)}px`;
}
let _chatWired = false;
function _chatWire() {
  if (_chatWired || typeof window === 'undefined') return;
  _chatWired = true;
  const refit = () => { if (document.querySelector('#content .chat-card')) chatFit(); };
  window.addEventListener('resize', refit);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', refit);
    window.visualViewport.addEventListener('scroll', refit);
  }
}

/* ── After render ── */
function chatAfterRender(kind, code) {
  const a = CHAT_ADAPTERS[kind];
  const log = a && document.getElementById(a.logId);
  if (!log) { chatForget(kind); return; }
  _chatWire();
  const v = chatViewState(kind, code);
  chatFit();
  const input = document.getElementById(a.inputId);
  if (input) {
    chatGrow(input);
    // renderPreservingInput puts a draft back after this runs.
    Promise.resolve().then(() => { if (input.isConnected && input.value) chatGrow(input); });
  }
  if (!v.placed) {
    if (log.querySelector('.chat-msg')) {
      const place = () => {
        const line = log.querySelector('.chat-new');
        log.scrollTop = line ? Math.max(0, line.offsetTop - 24) : log.scrollHeight;
        v.top = log.scrollTop;
        v.atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
      };
      place();
      // The first messages usually arrive through renderPreservingInput,
      // which puts back the scroll it saw before (the empty log); place
      // again once it has finished.
      Promise.resolve().then(() => { if (log.isConnected) place(); });
      v.placed = true;
    }
  } else if (v.atBottom) log.scrollTop = log.scrollHeight;
  else log.scrollTop = v.top;
  v.top = log.scrollTop;
  v.atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  log.addEventListener('scroll', () => {
    v.top = log.scrollTop;
    v.atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  }, { passive: true });
  try { a.markSeen(code); } catch {}
}
function chatForget(kind, tab) {
  Object.keys(_chatViews).forEach(k => { if (k.startsWith(`${kind}:`)) delete _chatViews[k]; });
  if (tab && tab !== 'chat') _chatPrevTab[kind] = tab;
}
function chatCloseSheet(kind) {
  const back = _chatPrevTab[kind] || 'overview';
  spaceGoToTab(kind, back);
}

/* ── Share to chat (session and event sheets) ── */
function chatShareButton(kind, code, id) {
  return `<button type="button" class="btn btn-ghost btn-sm" onclick="shareToSpaceChat('${kind}','${esc(code)}','${esc(id)}')">${icon('message-circle', 14)} Share to chat</button>`;
}
async function shareToSpaceChat(kind, code, id) {
  const a = CHAT_ADAPTERS[kind];
  if (!a || !safeId(id)) return;
  if (typeof closeModal === 'function') closeModal();
  a.open(code);
  chatPinBottom(kind, code);
  await a.send(code, a.link(code, id));
}
