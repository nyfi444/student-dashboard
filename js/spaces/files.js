/* ── Spaces: Files, a visual library shared by study groups and clubs ──
   One renderer for the group Files tab (tab key 'resources') and the club
   Files tab. It draws; each feature keeps its own data and its own writes
   (share, upload, link, add to mine and remove stay in
   js/groups/resources.js and js/orgs/files.js). Previews come only from
   fields the item already has: note text, deck cards, milestones, the file
   name, size and stored URL, the link's host. Nothing is fetched to build a
   preview except an image file's own stored URL (its thumbnail), and no
   favicon or other third-party request is ever made.

   Item model (what an adapter's items() returns, newest first is fine):
     { id, kind: 'note' | 'note-bundle' | 'deck' | 'project' | 'file' | 'link',
       title, by, at (ms), url (openable, '' when not), fileName, size,
       html (a note's stored HTML: only ever turned into escaped plain text),
       notes: [{ name, content }], cards: [{ front, back }],
       milestones: [{ title, done, dueDate }], dueDate, pinned (boolean) }
     Every string is data written by a member: escaped here, never trusted.

   LIB_ADAPTERS[kind]             kind is 'group' or 'club'. Per kind:
     space(code) -> group | club  findGroup / findOrg
     color(space) -> hex          groupColor / orgColor (feeds spaceVars)
     items(space) -> [item]       groupLibItems / orgLibItems
     primary(space, item, sheet)  the main action HTML (Add to mine, Open);
                                  sheet = true for the detail sheet's foot
     more(space, item) -> [{ label, icon, js, danger }]
                                  the "···" menu (and the sheet's other
                                  buttons): Remove, Add another copy
     share(space) -> { label, js } | null   the toolbar's primary button
     intro(space) -> string       one line shown when there are no chips
     empty(space) -> emptyStateHtml options, for a library with nothing in it

   spaceLibrary(kind, space) -> HTML   the whole tab: toolbar (type chips
     with counts when two or more types exist, a search box from
     LIB_SEARCH_FROM items, sort from LIB_SORT_FROM items, the share button)
     and the gallery of cards, pinned first when an item has pinned: true
     (no item has a pin field yet; Tier B). Filter, search and sort live in
     _libFilter, per space, in memory, and the render path applies them, so a
     live update that rebuilds the page keeps what the reader picked. Typing,
     chips and sort only touch the DOM (libApply); they never re-render.
   libCard(kind, code, space, item, st) -> one gallery card
   libRow(kind, code, item, actionsHtml) -> a compact row (club Overview rail)
   libTile(item) -> the 40px tile a compact row leads with
   libPreview(item) -> the card's preview area
   openLibraryItem(kind, code, id)    the detail sheet: full note text or
     card list, the file's type and size ('TXT · 1 KB'), the actions
   openLibraryMenu(btn, kind, code, id)   the "···" menu
   libSetChip / libSearch / libSetSort / libClear (kind, code, value)
   libApply(kind, code, { reorder })  re-filter (and re-sort) the grid in place
   libMatch(chip, hay, st), libCompare(sort), libSortKey(item),
   libHaystack(item), libText(item, max), libExtLabel(name), libIsImage(item),
   libFileMeta(item) -> 'PDF · 240 KB', libCountLabel(item) -> '5 cards'
   libTitleKey(title) -> the trimmed, lowercased, 200-character key that
     "In your Flashcards" compares with
   libSamplePdf(title, lines), libSampleImage(w, h, paint)
     tiny real files for the local sample spaces (never written to a cloud
     space)
──────────────────────────────────────────────────────────────── */
const LIB_SEARCH_FROM = 8;
const LIB_SORT_FROM = 3;
const LIB_CHIPS = [['all', 'All'], ['notes', 'Notes'], ['decks', 'Flashcards'], ['projects', 'Projects'], ['files', 'Files'], ['links', 'Links']];
const LIB_CHIP_OF = { note: 'notes', 'note-bundle': 'notes', deck: 'decks', project: 'projects', file: 'files', link: 'links' };
const LIB_KIND_LABEL = { note: 'Note', 'note-bundle': 'Notebook', deck: 'Flashcards', project: 'Project', file: 'File', link: 'Link' };
const LIB_KIND_ORDER = { note: 0, 'note-bundle': 1, deck: 2, project: 3, file: 4, link: 5 };
const LIB_SORTS = [['new', 'Newest first'], ['old', 'Oldest first'], ['az', 'A to Z'], ['kind', 'By type']];
const LIB_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const _libFilter = {};
const _libTextCache = new Map();

const LIB_ADAPTERS = {
  group: {
    space: (code) => findGroup(code),
    color: (g) => groupColor(g),
    items: (g) => groupLibItems(g),
    primary: (g, it, sheet) => groupLibPrimary(g, it, sheet),
    more: (g, it) => groupLibMore(g, it),
    share: (g) => ({ label: 'Share', js: `openShareResourceModal('${g.code}')` }),
    intro: () => 'Notes, flashcards, files and links. Anyone here can add a copy to their planner.',
    empty: (g) => groupLibEmpty(g),
  },
  club: {
    space: (code) => findOrg(code),
    color: (o) => orgColor(o),
    items: (o) => orgLibItems(o),
    primary: (o, it, sheet) => orgLibPrimary(o, it, sheet),
    more: (o, it) => orgLibMore(o, it),
    share: (o) => (isOrgOfficer(o) ? { label: 'Add file', js: `openOrgFileModal('${o.code}')` } : null),
    intro: (o) => (isOrgOfficer(o) ? 'Forms, schedules, rosters and links for everyone.' : 'Forms, schedules and links from your officers.'),
    empty: (o) => orgLibEmpty(o),
  },
};

/* ── Small pieces ── */
function libKey(kind, code) { return `${kind}-${code}`; }
function libState(kind, code) {
  const k = libKey(kind, code);
  return _libFilter[k] || (_libFilter[k] = { chip: 'all', q: '', sort: 'new' });
}
function libTitleKey(title) { return String(title || '').trim().slice(0, 200).trim().toLowerCase(); }
function libExtLabel(name) {
  const ext = fileExt(name);
  return ext && ext.length <= 5 ? ext.toUpperCase() : 'File';
}
function libIsImage(it) { return it.kind === 'file' && !!it.url && LIB_IMAGE_EXTS.includes(fileExt(it.fileName || it.title)); }
function libFileMeta(it) {
  if (it.kind === 'file') return [libExtLabel(it.fileName || it.title), it.size ? fmtFileSize(it.size) : ''].filter(Boolean).join(' · ');
  if (it.kind === 'link') return hostOf(it.url) || 'Link';
  return LIB_KIND_LABEL[it.kind] || 'Item';
}
function libCountLabel(it) {
  const n = (list, one, many) => `${list.length} ${list.length === 1 ? one : many}`;
  if (it.kind === 'deck') return n(it.cards || [], 'card', 'cards');
  if (it.kind === 'note-bundle') return n(it.notes || [], 'note', 'notes');
  if (it.kind === 'project') return n(it.milestones || [], 'milestone', 'milestones');
  return '';
}
// A note's stored HTML (written by another member) as plain text. The
// result is always escaped by the caller; sanitized HTML never renders here.
function libPlain(html, max) {
  const src = String(html || '').slice(0, Math.max(3000, max * 2));
  let text = null;
  if (typeof htmlToText === 'function' && typeof DOMParser !== 'undefined') { try { text = htmlToText(src); } catch { text = null; } }
  if (text == null) text = src.replace(/<(br|\/p|\/li|\/h\d|\/div)[^>]*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, max);
}
function libText(it, max = 220) {
  const html = it.kind === 'note-bundle' ? (it.notes || [])[0]?.content : it.html;
  const k = `${it.id}|${max}|${String(html || '').length}`;
  if (!_libTextCache.has(k)) {
    if (_libTextCache.size > 400) _libTextCache.clear();
    _libTextCache.set(k, libPlain(html, max));
  }
  return _libTextCache.get(k);
}
function libHaystack(it) {
  return [it.title, it.by, LIB_KIND_LABEL[it.kind], it.fileName, it.kind === 'link' ? hostOf(it.url) : '',
    it.kind === 'deck' ? (it.cards || []).slice(0, 20).map(c => c.front).join(' ') : '',
    it.kind === 'note' || it.kind === 'note-bundle' ? libText(it, 160) : '']
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').toLowerCase().slice(0, 600);
}
function libMatch(chip, hay, st) {
  if (st.chip !== 'all' && chip !== st.chip) return false;
  const words = String(st.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  return words.every(w => hay.includes(w));
}
function libSortKey(it) { return { at: Number(it.at) || 0, title: libTitleKey(it.title), order: LIB_KIND_ORDER[it.kind] ?? 9, pinned: !!it.pinned }; }
function libCompare(sort) {
  return (a, b) => (b.pinned - a.pinned)
    || (sort === 'old' ? a.at - b.at
      : sort === 'az' ? a.title.localeCompare(b.title) || b.at - a.at
      : sort === 'kind' ? a.order - b.order || b.at - a.at
      : b.at - a.at);
}

/* ── Previews ── */
function libThumbFailed(img) { const box = img.closest('.lib-thumb-box'); if (box) box.classList.remove('has-thumb'); img.remove(); }
function libPreview(it) {
  if (it.kind === 'note') {
    const text = libText(it);
    return `<span class="lib-paper"><span class="lib-paper-text">${text ? esc(text) : '<span class="lib-faint">Empty note</span>'}</span></span>`;
  }
  if (it.kind === 'note-bundle') {
    const first = (it.notes || [])[0];
    return `<span class="lib-paper lib-paper-under" aria-hidden="true"></span>
      <span class="lib-paper lib-paper-top">${first ? `<span class="lib-paper-name">${esc(String(first.name || 'Untitled'))}</span><span class="lib-paper-text lib-clamp-2">${esc(libText(it, 140))}</span>` : '<span class="lib-faint">No notes yet</span>'}</span>
      <span class="lib-pill">${esc(libCountLabel(it))}</span>`;
  }
  if (it.kind === 'deck') {
    const front = String((it.cards || [])[0]?.front || it.title || '').slice(0, 90);
    return `<span class="lib-flash lib-flash-under" aria-hidden="true"></span>
      <span class="lib-flash lib-flash-top"><span class="lib-flash-text">${esc(front)}</span></span>
      <span class="lib-pill">${esc(libCountLabel(it))}</span>`;
  }
  if (it.kind === 'project') {
    const ms = (it.milestones || []).slice(0, 3);
    return `<span class="lib-paper lib-ms">${ms.length ? ms.map(m => `<span class="lib-ms-row"><span class="lib-ms-dot${m.done ? ' is-done' : ''}"></span><span class="lib-ms-title">${esc(String(m.title || 'Milestone'))}</span></span>`).join('') : '<span class="lib-faint">No milestones yet</span>'}</span>
      <span class="lib-pill">${esc(it.dueDate ? `Due ${fmtDate(it.dueDate, { month: 'short', day: 'numeric' })}` : libCountLabel(it))}</span>`;
  }
  if (it.kind === 'file') {
    const glyph = `<span class="lib-ext">${esc(libExtLabel(it.fileName || it.title))}</span><span class="lib-ext-sub">${icon('paperclip', 12)}${esc(it.size ? fmtFileSize(it.size) : 'File')}</span>`;
    if (!libIsImage(it)) return glyph;
    return `<span class="lib-thumb-box has-thumb">${glyph}<img class="lib-thumb" src="${esc(it.url)}" alt="" loading="lazy" decoding="async" onerror="libThumbFailed(this)"></span>`;
  }
  if (it.kind === 'link') {
    const host = hostOf(it.url) || 'link';
    let path = '';
    try { const u = new URL(it.url); path = decodeURIComponentSafe(u.pathname + u.search).replace(/\/$/, ''); } catch {}
    return `<span class="lib-host-tile">${esc(host[0].toUpperCase())}</span>
      <span class="lib-host"><span class="lib-host-name">${esc(host)}</span>${path ? `<span class="lib-host-path">${esc(path.slice(0, 80))}</span>` : ''}</span>`;
  }
  return '';
}
// The compact row's leading tile: a thumbnail, the extension, or the host letter.
function libTile(it) {
  if (libIsImage(it)) return `<span class="lib-tile lib-thumb-box has-thumb"><span class="lib-tile-ext">IMG</span><img class="lib-thumb" src="${esc(it.url)}" alt="" loading="lazy" decoding="async" onerror="libThumbFailed(this)"></span>`;
  if (it.kind === 'file') return `<span class="lib-tile"><span class="lib-tile-ext">${esc(libExtLabel(it.fileName || it.title))}</span></span>`;
  if (it.kind === 'link') return `<span class="lib-tile lib-tile-host">${esc((hostOf(it.url) || 'L')[0].toUpperCase())}</span>`;
  const ic = { note: 'file-text', 'note-bundle': 'folder-open', deck: 'layers', project: 'folder' }[it.kind] || 'file-text';
  return `<span class="lib-tile">${icon(ic, 16)}</span>`;
}

/* ── Cards, rows and the whole tab ── */
function libCard(kind, code, sp, it, st) {
  const A = LIB_ADAPTERS[kind];
  const open = `openLibraryItem('${kind}','${code}','${it.id}')`;
  const more = A.more(sp, it);
  const hay = libHaystack(it);
  const k = libSortKey(it);
  const chip = LIB_CHIP_OF[it.kind];
  const label = [it.title, libFileMeta(it), libCountLabel(it)].filter(Boolean).join(', ');
  return `<article class="lib-card lib-k-${it.kind}" data-lib-chip="${chip}" data-lib-q="${esc(hay)}" data-lib-at="${k.at}" data-lib-title="${esc(k.title)}" data-lib-order="${k.order}" data-lib-pin="${k.pinned ? 1 : 0}"${libMatch(chip, hay, st) ? '' : ' hidden'}>
    <button type="button" class="lib-preview" tabindex="-1" aria-hidden="true" onclick="${open}">${libPreview(it)}</button>
    <div class="lib-body">
      <button type="button" class="lib-title" onclick="${open}" aria-label="${esc(label)}">${esc(it.title)}</button>
      <div class="lib-meta">${it.pinned ? `<span class="lib-pinned">${icon('pin', 12)}Pinned</span> · ` : ''}${it.kind === 'link' && hostOf(it.url) ? `<span class="lib-meta-host">${esc(hostOf(it.url))} · </span>` : ''}${esc(it.by || 'Someone')}${it.at ? ` · ${esc(fmtRelativeTime(it.at))}` : ''}</div>
      <div class="lib-actions">${A.primary(sp, it, false)}${more.length ? `<button type="button" class="btn btn-ghost btn-icon btn-sm lib-more" aria-label="More for ${esc(it.title)}" aria-haspopup="true" aria-expanded="false" data-tip="More" onclick="openLibraryMenu(this,'${kind}','${code}','${it.id}')">${icon('more-horizontal', 16)}</button>` : ''}</div>
    </div>
  </article>`;
}
function libRow(kind, code, it, actionsHtml = '') {
  const open = `openLibraryItem('${kind}','${code}','${it.id}')`;
  return `<div class="lib-row">
    <button type="button" class="lib-row-lead" tabindex="-1" aria-hidden="true" onclick="${open}">${libTile(it)}</button>
    <div class="lib-row-text">
      <button type="button" class="lib-title lib-row-title" onclick="${open}">${esc(it.title)}</button>
      <div class="lib-meta">${esc(libFileMeta(it))}</div>
    </div>
    ${actionsHtml}
  </div>`;
}
function spaceLibrary(kind, sp) {
  const A = LIB_ADAPTERS[kind];
  const code = sp.code;
  const items = A.items(sp);
  const share = A.share(sp);
  if (!items.length) return `<div class="lib lib-empty">${emptyStateHtml(A.empty(sp))}</div>`;
  const st = libState(kind, code);
  const counts = {};
  items.forEach(it => { const c = LIB_CHIP_OF[it.kind]; counts[c] = (counts[c] || 0) + 1; });
  const chips = LIB_CHIPS.filter(([c]) => c === 'all' || counts[c]);
  const showChips = chips.length > 2;
  if (!showChips || (st.chip !== 'all' && !counts[st.chip])) st.chip = 'all';
  const search = items.length >= LIB_SEARCH_FROM;
  if (!search) st.q = '';
  const sort = items.length >= LIB_SORT_FROM;
  if (!sort) st.sort = 'new';
  const cmp = libCompare(st.sort);
  const sorted = items.map(it => ({ it, k: libSortKey(it) })).sort((a, b) => cmp(a.k, b.k)).map(x => x.it);
  const shown = sorted.filter(it => libMatch(LIB_CHIP_OF[it.kind], libHaystack(it), st)).length;
  const id = libKey(kind, code);
  const args = `'${kind}','${code}'`;
  return `<div class="lib" data-lib="${id}">
    <div class="lib-toolbar">
      ${showChips ? `<div class="chip-row lib-chips" role="group" aria-label="Show">${chips.map(([c, label]) => `<button type="button" class="chip lib-chip" data-lib-chip="${c}" aria-pressed="${st.chip === c}" onclick="libSetChip(${args},'${c}')">${label}<span class="sr-only">, </span><span class="lib-chip-n">${c === 'all' ? items.length : counts[c]}</span></button>`).join('')}</div>`
        : `<p class="lib-intro">${esc(A.intro(sp))}</p>`}
      <div class="lib-tools">
        ${search ? `<label class="lib-search">${icon('search', 14)}<input class="input" type="search" id="lib-q-${id}" value="${esc(st.q)}" placeholder="Search" aria-label="Search files" autocomplete="off" oninput="libSearch(${args},this.value)"></label>` : ''}
        ${sort ? `<select class="select lib-sort" id="lib-sort-${id}" aria-label="Sort" onchange="libSetSort(${args},this.value)">${LIB_SORTS.map(([v, label]) => `<option value="${v}"${st.sort === v ? ' selected' : ''}>${label}</option>`).join('')}</select>` : ''}
        ${share ? `<button type="button" class="btn btn-primary btn-sm lib-share" onclick="${share.js}">${icon('plus', 14)}${esc(share.label)}</button>` : ''}
      </div>
    </div>
    <div class="lib-grid" id="lib-grid-${id}">${sorted.map(it => libCard(kind, code, sp, it, st)).join('')}</div>
    <p class="sr-only" id="lib-status-${id}" aria-live="polite"></p>
    <p class="lib-none" id="lib-none-${id}"${shown ? ' hidden' : ''}>Nothing matches. <button type="button" class="sg-link" onclick="libClear(${args})">Show everything</button></p>
  </div>`;
}

/* ── Filter, search, sort: DOM only, no render ── */
function libApply(kind, code, { reorder = false } = {}) {
  const id = libKey(kind, code);
  const grid = document.getElementById(`lib-grid-${id}`);
  if (!grid) return;
  const st = libState(kind, code);
  const cards = [...grid.querySelectorAll(':scope > .lib-card')];
  if (reorder) {
    const cmp = libCompare(st.sort);
    const key = (el) => ({ at: Number(el.dataset.libAt) || 0, title: el.dataset.libTitle || '', order: Number(el.dataset.libOrder) || 0, pinned: el.dataset.libPin === '1' });
    cards.map(el => ({ el, k: key(el) })).sort((a, b) => cmp(a.k, b.k)).forEach(x => grid.appendChild(x.el));
  }
  let shown = 0;
  cards.forEach(el => { const on = libMatch(el.dataset.libChip, el.dataset.libQ || '', st); el.hidden = !on; if (on) shown++; });
  const none = document.getElementById(`lib-none-${id}`);
  if (none) none.hidden = shown > 0;
  // Said once per change, from a node the filter never redraws.
  const status = document.getElementById(`lib-status-${id}`);
  const filtered = st.chip !== 'all' || String(st.q || '').trim();
  if (status && !reorder) status.textContent = filtered ? (shown ? `${shown} ${shown === 1 ? 'file' : 'files'} shown` : 'Nothing matches') : `All ${cards.length} ${cards.length === 1 ? 'file' : 'files'} shown`;
  const root = grid.closest('.lib');
  root?.querySelectorAll('.lib-chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.libChip === st.chip)));
}
function libSetChip(kind, code, chip) { libState(kind, code).chip = chip; libApply(kind, code); }
function libSearch(kind, code, q) { libState(kind, code).q = String(q || '').slice(0, 80); libApply(kind, code); }
function libSetSort(kind, code, sort) { libState(kind, code).sort = LIB_SORTS.some(([v]) => v === sort) ? sort : 'new'; libApply(kind, code, { reorder: true }); }
function libClear(kind, code) {
  const st = libState(kind, code);
  st.chip = 'all'; st.q = '';
  const input = document.getElementById(`lib-q-${libKey(kind, code)}`);
  if (input) input.value = '';
  libApply(kind, code);
}

/* ── The "···" menu and the detail sheet ── */
function libFind(kind, code, id) {
  const A = LIB_ADAPTERS[kind];
  const sp = A && A.space(code);
  const it = sp && A.items(sp).find(x => x.id === id);
  return it ? { A, sp, it } : null;
}
function openLibraryMenu(btn, kind, code, id) {
  const f = libFind(kind, code, id);
  if (!f) return;
  const more = f.A.more(f.sp, f.it);
  const rows = [`<button class="menu-item" onclick="openLibraryItem('${kind}','${code}','${id}')">${icon('eye', 16)}<span>Details</span></button>`,
    ...more.map(m => `${m.danger ? '<div class="menu-sep" role="separator"></div>' : ''}<button class="menu-item${m.danger ? ' is-danger' : ''}" onclick="${m.js}">${icon(m.icon, 16)}<span>${esc(m.label)}</span></button>`)];
  openMenu(btn, rows.join(''), { align: 'end' });
}
function libDetail(it) {
  if (it.kind === 'note') {
    const text = libText(it, 20000);
    return text ? `<div class="lib-sheet-text">${esc(text)}</div>` : '<p class="lib-sheet-empty">This note is empty.</p>';
  }
  if (it.kind === 'note-bundle') {
    const notes = (it.notes || []).slice(0, 60);
    return notes.length ? `<div class="lib-sheet-list">${notes.map(n => `<div class="lib-sheet-row"><div class="lib-sheet-row-title">${esc(String(n.name || 'Untitled'))}</div><div class="lib-sheet-row-sub">${esc(libPlain(n.content, 160)) || 'Empty note'}</div></div>`).join('')}</div>` : '<p class="lib-sheet-empty">No notes in this notebook.</p>';
  }
  if (it.kind === 'deck') {
    const cards = it.cards || [];
    return cards.length ? `<div class="lib-sheet-list">${cards.slice(0, 60).map(c => `<div class="lib-sheet-row lib-sheet-card"><div class="lib-sheet-row-title">${esc(String(c.front || ''))}</div><div class="lib-sheet-row-sub">${esc(String(c.back || ''))}</div></div>`).join('')}</div>${cards.length > 60 ? `<p class="lib-sheet-empty">And ${cards.length - 60} more.</p>` : ''}` : '<p class="lib-sheet-empty">No cards yet.</p>';
  }
  if (it.kind === 'project') {
    const ms = it.milestones || [];
    return `${it.dueDate ? `<p class="lib-sheet-due">Due ${esc(fmtDateLong(it.dueDate))}</p>` : ''}${ms.length ? `<div class="lib-sheet-list">${ms.slice(0, 40).map(m => {
      const tasks = Array.isArray(m.tasks) ? m.tasks.length : 0;
      const sub = [m.dueDate ? fmtDate(m.dueDate, { month: 'short', day: 'numeric' }) : '', tasks ? `${tasks} task${tasks === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
      return `<div class="lib-sheet-row lib-sheet-ms"><span class="lib-ms-dot${m.done ? ' is-done' : ''}"></span><div><div class="lib-sheet-row-title">${esc(String(m.title || 'Milestone'))}</div>${sub ? `<div class="lib-sheet-row-sub">${esc(sub)}</div>` : ''}</div></div>`;
    }).join('')}</div>` : '<p class="lib-sheet-empty">No milestones yet.</p>'}`;
  }
  if (it.kind === 'file') {
    if (libIsImage(it)) return `<div class="lib-sheet-img-box"><img class="lib-sheet-img" src="${esc(it.url)}" alt="${esc(it.title)}" decoding="async"></div>`;
    return `<div class="lib-sheet-file"><span class="lib-ext">${esc(libExtLabel(it.fileName || it.title))}</span><div class="lib-sheet-file-text"><div class="lib-sheet-row-title">${esc(it.fileName || it.title)}</div><div class="lib-sheet-row-sub">${esc(it.size ? fmtFileSize(it.size) : 'Size unknown')}</div></div></div>${it.url ? '' : '<p class="lib-sheet-empty">This file isn’t available on this device.</p>'}`;
  }
  if (it.kind === 'link') {
    const host = hostOf(it.url) || 'link';
    return `<div class="lib-sheet-file"><span class="lib-host-tile">${esc(host[0].toUpperCase())}</span><div class="lib-sheet-file-text"><div class="lib-sheet-row-title">${esc(host)}</div><div class="lib-sheet-url">${esc(it.url || '')}</div></div></div>`;
  }
  return '';
}
function openLibraryItem(kind, code, id) {
  const f = libFind(kind, code, id);
  if (!f) return;
  const { A, sp, it } = f;
  const more = A.more(sp, it);
  const meta = [libFileMeta(it), libCountLabel(it), it.by || 'Someone', it.at ? fmtRelativeTime(it.at) : ''].filter(Boolean);
  const btns = more.filter(m => !m.danger).map(m => `<button type="button" class="btn" onclick="closeModal();${m.js}">${icon(m.icon, 16)}${esc(m.label)}</button>`).join('')
    + A.primary(sp, it, true)
    + more.filter(m => m.danger).map(m => `<button type="button" class="btn btn-danger lib-sheet-danger" onclick="closeModal();${m.js}">${icon(m.icon, 16)}${esc(m.label)}</button>`).join('');
  openModal(`
    <div class="modal-head"><h3>${esc(it.title)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body space lib-sheet" style="${spaceVars(A.color(sp))}">
      <p class="lib-sheet-meta">${meta.map(esc).join(' · ')}</p>
      ${libDetail(it)}
    </div>
    ${btns ? `<div class="modal-foot lib-sheet-foot">${btns}</div>` : ''}
  `);
}

/* ── Tiny real files for the local sample spaces ── */
// A one-page PDF with Helvetica text (ASCII only). Returns { dataUrl, size }.
function libSamplePdf(title, lines) {
  const pdfEsc = (s) => String(s).replace(/[^\x20-\x7e]/g, '').replace(/[\\()]/g, m => '\\' + m);
  const text = [`BT /F1 20 Tf 72 720 Td (${pdfEsc(title)}) Tj ET`, ...lines.map((l, i) => `BT /F1 12 Tf 72 ${684 - i * 20} Td (${pdfEsc(l)}) Tj ET`)].join('\n');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { dataUrl: 'data:application/pdf;base64,' + btoa(out), size: out.length };
}
// A small JPEG painted on a canvas: paint(ctx, w, h). Returns
// { dataUrl, size } or null where there is no canvas (node tests).
function libSampleImage(w, h, paint) {
  if (typeof document === 'undefined') return null;
  try {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    paint(ctx, w, h);
    const dataUrl = c.toDataURL('image/jpeg', 0.78);
    return { dataUrl, size: Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75) };
  } catch { return null; }
}
