/* ── Spaces: the shell every group and club page shares ────────────
   Render only. Study groups (pageGroupDetail) and clubs (pageOrgDetail)
   hand these functions plain options and get HTML back; the index pages
   use spaceCard and spaceWeekCard. Styles are in css/spaces.css.

   spaceShell({ kind, code, color, rootStyle, band, sample, notice, tabs, body, fab })
     The page: a `.space` root carrying the color (see spaceVars), the
     cover band, the sample strip (only for a sample space), an optional
     notice, the sticky tab row, the tab body and the phone chat button.
   spaceSampleStrip({ note, view: { officer, onOfficer, onMember }, others })
     A sample's strip under the band: a plain-text note, "Previewing as:
     Officer | Member" (onOfficer and onMember are onclick JS), and
     others: [{ label, icon, onclick }] as chips for the other samples.
   spaceBand({ kind, code, crest, eyebrow, title, desc, back, linksHtml,
               stackHtml, actionsHtml, invite, menu, menuLabel })
     crest: { text, sub } as trusted, already escaped HTML (orgMonogram is).
     eyebrow and linksHtml, stackHtml, actionsHtml are trusted HTML; title
     and desc are plain text. back: { label, onclick }. invite: { onclick,
     primary }. actionsHtml holds officer buttons that show on a desktop;
     give them the class `space-phone-sheet` and a phone lists them in the
     ··· sheet instead. menu: [{ label, icon, onclick, danger, checked }]
     (checked true or false makes it a checkbox item).
   spaceTabs({ tabs, active, onTab, crest, title, invite })
     tabs: [{ key, label, iconHtml, count, dot, phoneHidden }]; onTab(key)
     returns the onclick JS for a tab. phoneHidden (the Chat tab) now only
     moves that tab to the end of the row on a phone; it stays visible. The row sticks to the top once the
     band scrolls away (afterSpaceRender watches it) and then shows the
     crest, the name and, on a desktop, a small Invite.
   spaceChatFab({ onclick, count, dot, label })   phones only, and only
     while the tab row is stuck (.space-fab-on on the .space root).
   spaceCrest(crest, size)   size: 'xl' 64, 'lg' 48, 'md' 40, 'sm' 24, 'xs' 20.
   spaceCard({ code, color, crest, eyebrow, name, onclick, nextHtml,
               lineHtml, footHtml, needCount, unread, unreadLabel, style })
   spaceCountdown(date, start, end) / spaceCountdownChip(date, start, end) /
     spaceWhen(date, start): the chip's text, the chip, and what follows it.
   spaceWeekCard({ title, rows: [{ date, html }], max })
   afterSpaceRender()   called by afterGroupPageRender and afterOrgPageRender.
──────────────────────────────────────────────────────────────── */
function spaceCrest(crest, size = 'xl') {
  let text = String(crest?.text || '?');
  // The 20px crest (This week rows) holds one letter; the 24px one in the
  // stuck tab row holds two (three ran edge to edge).
  if (size === 'xs') text = (text.match(/^(?:&[a-z]+;|&#\d+;|[\s\S])/u) || ['?'])[0];
  else if (size === 'sm' && /^[A-Z0-9]{3,}$/.test(text)) text = text.slice(0, 2);
  const sub = (size === 'xl' || size === 'lg') && crest?.sub ? `<span class="space-crest-sub">${crest.sub}</span>` : '';
  const len = String(text).replace(/&[a-z]+;|&#\d+;/g, 'x').length;
  return `<span class="space-crest is-${size}${len >= 4 ? ' is-long' : ''}${sub ? ' has-sub' : ''}" aria-hidden="true"><span class="space-crest-main">${text}</span>${sub}</span>`;
}

function spaceMenuItemsHtml(menu) {
  return (menu || []).map(m => {
    const check = typeof m.checked === 'boolean';
    return `<button type="button" class="btn head-menu${m.danger ? ' btn-danger' : ''}"${check ? ` role="menuitemcheckbox" aria-checked="${m.checked}"` : ''} onclick="${m.onclick}">${m.icon ? icon(m.icon, 16) : ''}<span>${esc(m.label)}</span>${check ? `<span class="space-menu-check">${m.checked ? icon('check', 14) : ''}</span>` : ''}</button>`;
  }).join('');
}

function spaceBand(o) {
  const inviteBtn = o.invite ? `<button type="button" class="btn btn-sm ${o.invite.primary === false ? '' : 'btn-primary'} space-invite" onclick="${o.invite.onclick}">${icon('user-plus', 14)} Invite</button>` : '';
  const more = (o.menu || []).length || o.actionsHtml
    ? `<button type="button" class="btn btn-ghost btn-icon head-more space-more" aria-label="${esc(o.menuLabel || 'More')}" aria-haspopup="true" data-tip="More" onclick="openHeadMore(this)">${icon('more-horizontal', 18)}</button>`
    : '';
  return `
    <header class="space-band space-cover" data-pattern="${spacePattern(o.code)}">
      <button type="button" class="space-back" onclick="${o.back.onclick}">${icon('arrow-left', 14)} ${esc(o.back.label)}</button>
      <div class="space-actions">
        ${o.stackHtml || ''}
        ${signInHeaderButton()}
        ${o.actionsHtml || ''}
        ${inviteBtn}
        ${spaceMenuItemsHtml(o.menu)}
        ${more}
      </div>
      <div class="space-id">
        ${spaceCrest(o.crest, 'xl')}
        <div class="space-id-text">
          ${o.eyebrow ? `<div class="eyebrow space-eyebrow">${o.eyebrow}</div>` : ''}
          <h2 class="space-title">${esc(o.title)}</h2>
        </div>
        ${o.desc ? `<div class="space-desc-wrap"><p class="space-desc">${esc(o.desc)}</p><button type="button" class="space-desc-more" hidden onclick="spaceExpandDesc(this)">More</button></div>` : ''}
        ${o.linksHtml ? `<div class="space-links">${o.linksHtml}</div>` : ''}
      </div>
    </header>`;
}
function spaceExpandDesc(btn) {
  btn.closest('.space-desc-wrap')?.classList.add('is-open');
  btn.hidden = true;
}

// A real tablist: one tab in the Tab order (the active one), arrow keys,
// Home and End move and open (automatic activation), and the tab body is
// the one tabpanel, labelled by the active tab.
const SPACE_TABPANEL_ID = 'space-tabpanel';
function spaceTabId(key) { return `space-tab-${String(key || '').replace(/[^A-Za-z0-9_-]/g, '')}`; }
function spaceTabs(o) {
  const hasActive = o.tabs.some(t => t.key === o.active);
  const tabs = o.tabs.map((t, i) => {
    const on = t.key === o.active;
    const count = t.count && !on ? `<span class="space-tab-count"><span class="sr-only">, </span>${t.count > 99 ? '99+' : t.count}<span class="sr-only"> new</span></span>` : '';
    const dot = !count && t.dot && !on ? '<span class="sg-tab-dot space-tab-dot" aria-hidden="true"></span><span class="sr-only">, new messages</span>' : '';
    const stop = on || (!hasActive && i === 0);
    return `<button type="button" role="tab" id="${spaceTabId(t.key)}" aria-controls="${SPACE_TABPANEL_ID}" aria-selected="${on}" tabindex="${stop ? 0 : -1}" class="${on ? 'active' : ''}${t.phoneHidden ? ' space-tab-phone-last' : ''}" data-tab="${esc(t.key)}" onclick="${o.onTab(t.key)}">${t.iconHtml || ''}${esc(t.label)}${count}${dot}</button>`;
  }).join('');
  const listLabel = o.label || (o.kind === 'club' ? 'Club sections' : 'Group sections');
  return `
    <div class="space-tabs-sentinel" aria-hidden="true"></div>
    <div class="space-tabbar">
      <div class="space-tabbar-id" aria-hidden="true">${spaceCrest(o.crest, 'sm')}<span class="space-tabbar-name">${esc(o.title)}</span></div>
      <div class="sg-tabs space-tabs" role="tablist" aria-label="${esc(listLabel)}" onkeydown="spaceTabsKey(event)">${tabs}</div>
      ${o.invite ? `<button type="button" class="btn btn-sm ${o.invite.primary === false ? '' : 'btn-primary'} space-tabbar-invite" onclick="${o.invite.onclick}">${icon('user-plus', 14)} Invite</button>` : ''}
    </div>`;
}

function spaceTabsKey(e) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const list = e.currentTarget;
  // Visual order, not DOM order: a phone moves Chat to the end of the row.
  const tabs = [...list.querySelectorAll('[role="tab"]')].filter(b => b.getClientRects().length)
    .sort((a, b) => a.offsetLeft - b.offsetLeft);
  if (!tabs.length) return;
  e.preventDefault();
  let i = tabs.indexOf(document.activeElement);
  if (i < 0) i = Math.max(0, tabs.findIndex(b => b.getAttribute('aria-selected') === 'true'));
  const j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  const key = tabs[j].dataset.tab;
  tabs[j].click();
  // The click redraws the page; focus the new active tab in the new row.
  const refocus = () => {
    const b = [...document.querySelectorAll('#content .space-tabs [role="tab"]')].find(x => x.dataset.tab === key);
    if (b && document.activeElement !== b) b.focus({ preventScroll: true });
  };
  refocus();
  requestAnimationFrame(refocus);
}

function spaceChatFab(o) {
  const badge = o.count ? `<span class="space-fab-badge">${o.count > 9 ? '9+' : o.count}</span>` : o.dot ? '<span class="space-fab-dot"></span>' : '';
  const label = `${o.label || 'Open chat'}${o.count ? `, ${o.count} new` : o.dot ? ', new messages' : ''}`;
  return `<button type="button" class="space-chat-fab" aria-label="${esc(label)}" onclick="${o.onclick}">${icon('message-circle', 22)}${badge}</button>`;
}

// The other samples, for the phone "Samples" sheet (the strip keeps one line there).
let _spaceSampleOthers = [];
function spaceSampleSheet() {
  const list = _spaceSampleOthers || [];
  if (!list.length) return;
  openModal(`
    <div class="modal-head"><h3>Try another sample</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body"><div class="space-sample-sheet">${list.map(c => `<button type="button" class="btn space-sample-sheet-btn" onclick="closeModal();${c.onclick}">${c.icon ? icon(c.icon, 16) : ''}<span>${esc(c.label)}</span>${icon('chevron-right', 14)}</button>`).join('')}</div></div>`);
}
function spaceSampleStrip(s) {
  if (!s) return '';
  _spaceSampleOthers = s.others || [];
  const opt = (on, label, ic, onclick) => `<button type="button" class="${on ? 'active' : ''}" aria-pressed="${on}" onclick="${onclick}">${icon(ic, 13)}${label}</button>`;
  const view = s.view ? `
    <div class="space-sample-view">
      <span class="space-sample-label" aria-hidden="true">Previewing as</span>
      <div class="segmented" role="group" aria-label="Previewing as">${opt(s.view.officer, 'Officer', 'shield', s.view.onOfficer)}${opt(!s.view.officer, 'Member', 'users', s.view.onMember)}</div>
      ${(s.others || []).length ? `<button type="button" class="chip space-sample-more" aria-haspopup="dialog" onclick="spaceSampleSheet()">${icon('layers', 13)}Samples</button>` : ''}
    </div>` : '';
  const others = (s.others || []).length ? `
    <div class="space-sample-try">
      <span class="space-sample-label">Try another</span>
      <div class="space-sample-chips">${s.others.map(c => `<button type="button" class="chip" onclick="${c.onclick}">${c.icon ? icon(c.icon, 13) : ''}${esc(c.label)}</button>`).join('')}</div>
    </div>` : '';
  return `
    <div class="space-sample" role="region" aria-label="Sample preview">
      ${s.note ? `<div class="space-sample-note">${icon('eye', 14)}<span>${esc(s.note)}</span></div>` : ''}
      ${view}${others}
    </div>`;
}

function spaceShell(o) {
  return `
    <div class="space space-${o.kind}${o.className ? ' ' + o.className : ''}" style="${spaceVars(o.color)}${o.rootStyle ? ';' + o.rootStyle : ''}">
      ${spaceBand(o.band)}
      ${spaceSampleStrip(o.sample)}
      ${o.notice || ''}
      ${spaceTabs({ kind: o.kind, ...o.tabs })}
      <div class="sg-tab-body" role="tabpanel" id="${SPACE_TABPANEL_ID}" aria-labelledby="${spaceTabId(o.tabs.active)}">${o.body}</div>
      ${o.fab ? spaceChatFab(o.fab) : ''}
    </div>`;
}

// Switch tabs from outside the tab row (the phone chat button), then bring
// the tab row to the top so the new tab starts in view.
function spaceGoToTab(kind, tab) {
  if (kind === 'group') setGroupTab(tab);
  else setState({ orgTab: tab });
  const s = document.querySelector('#content .space-tabs-sentinel');
  if (s && s.getBoundingClientRect().top < 0) window.scrollTo({ top: window.scrollY + s.getBoundingClientRect().top, behavior: 'instant' });
}

/* ── Index pages ─────────────────────────────────────────────── */
// "Now", "in 40m", "in 3h", "Tomorrow", "in 4 days", or a short date.
function spaceCountdown(date, start, end) {
  if (!date) return '';
  // Phases from eventTimeState (js/spaces/eventcard.js): no end means an hour.
  const st = eventTimeState({ date, start, end });
  if (st.phase === 'after') return '';
  if (st.phase === 'now') return st.allDay ? 'Today' : 'Now';
  if (st.days === 0) return st.startsInMin < 60 ? `in ${st.startsInMin}m` : `in ${Math.round(st.startsInMin / 60)}h`;
  if (st.days === 1) return 'Tomorrow';
  if (st.days < 7) return `in ${st.days} days`;
  return fmtDate(date);
}
// The words that go after the countdown chip without repeating it: the
// weekday only when the chip says "in 4 days", then the time.
function spaceWhen(date, start) {
  const days = daysBetween(date);
  const day = days >= 2 && days < 7 ? fmtDate(date, { weekday: 'short' }) : '';
  return [day, start ? fmtTime(start) : ''].filter(Boolean).join(' ');
}
// "Now" reads "Happening now" with the live dot. The chip carries
// spaceLiveAttrs, so the minute tick keeps its words and phase current.
function spaceCountdownChip(date, start, end) {
  const t = spaceCountdown(date, start, end);
  if (!t) return '';
  const now = t === 'Now';
  return `<span class="space-chip${now ? ' is-now' : ''}"${spaceLiveAttrs({ date, start, end }, { fmt: 'short' })}>${now ? '<span class="space-now-dot" aria-hidden="true"></span>' : ''}<span class="space-live-text">${now ? 'Happening now' : esc(t)}</span></span>`;
}

// The card is one button (Enter and Space come from ui.js's keydown for
// role=button): named by the space's name and described by the next event,
// the unread line and the need count, never by the avatar letters.
let _spaceCardSeq = 0;
function spaceCard(o) {
  const id = `space-card-${++_spaceCardSeq}`;
  const need = o.needCount ? `<span class="space-need-pill" id="${id}-need">${o.needCount} need${o.needCount === 1 ? 's' : ''} you</span>` : '';
  // Unread sits in front of the last-message line; a space with no line
  // (clubs) says what's new in words.
  const unreadText = String(o.unreadLabel || 'New messages');
  const unread = o.unread
    ? (o.lineHtml
      ? `<div class="space-card-line" id="${id}-line"><span class="space-card-unread" aria-hidden="true"></span>${o.lineHtml}<span class="sr-only">, new messages</span></div>`
      : `<div class="space-card-line is-bare" id="${id}-line"><span class="space-card-unread" aria-hidden="true"></span><span class="space-card-unread-text">${esc(unreadText.charAt(0).toUpperCase() + unreadText.slice(1).toLowerCase())}</span></div>`)
    : (o.lineHtml ? `<div class="space-card-line" id="${id}-line">${o.lineHtml}</div>` : '');
  const describedBy = [o.nextHtml ? `${id}-next` : '', unread ? `${id}-line` : '', need ? `${id}-need` : ''].filter(Boolean).join(' ');
  const foot = String(o.footHtml || '').replace('<span class="sg-stack">', '<span class="sg-stack" aria-hidden="true">');
  return `
    <div class="card sg-card space space-card" style="${spaceVars(o.color)}${o.style ? ';' + o.style : ''}" role="button" tabindex="0" onclick="${o.onclick}" aria-labelledby="${id}-name"${describedBy ? ` aria-describedby="${describedBy}"` : ''}>
      <div class="space-card-cover space-cover" data-pattern="${spacePattern(o.code)}">
        ${spaceCrest(o.crest, 'md')}
      </div>
      <div class="space-card-body">
        ${o.eyebrow ? `<div class="eyebrow space-card-eyebrow">${o.eyebrow}</div>` : ''}
        <div class="sg-card-name" id="${id}-name">${esc(o.name)}</div>
        ${o.nextHtml ? `<div class="space-card-next" id="${id}-next">${o.nextHtml}</div>` : ''}
        ${unread}
      </div>
      <div class="space-card-foot">${foot}${need}</div>
    </div>`;
}

// "This week", grouped by day. Rows past `max` stay folded behind See all.
function spaceWeekCard(o) {
  const max = o.max || 6;
  if (!o.rows.length) return '';
  let lastDate = '', i = 0;
  const body = o.rows.map(r => {
    const head = r.date !== lastDate ? `<div class="eyebrow space-week-day${i >= max ? ' is-more' : ''}">${esc(relativeDay(r.date))}${daysBetween(r.date) > 1 ? '' : ` · ${esc(fmtDate(r.date))}`}</div>` : '';
    lastDate = r.date;
    const row = `<div class="space-week-row${i >= max ? ' is-more' : ''}">${r.html}</div>`;
    i++;
    return head + row;
  }).join('');
  return `
    <div class="card card-pad space-week mb-16">
      <h3 class="sg-h3 mb-8">${esc(o.title)}</h3>
      ${body}
      ${o.rows.length > max ? `<button type="button" class="sg-link space-week-all" onclick="this.closest('.space-week').classList.add('is-open');this.remove()">See all ${o.rows.length} ${icon('chevron-right', 12)}</button>` : ''}
    </div>`;
}

/* ── After render ────────────────────────────────────────────── */
// The smallest scroll of the tab row that shows the whole active tab.
// scrollLeft only: scrollIntoView would move the page too.
function spaceActiveTabIntoView(tabs) {
  const a = tabs?.querySelector('button.active');
  if (!a || tabs.scrollWidth <= tabs.clientWidth) return;
  const r = a.getBoundingClientRect(), box = tabs.getBoundingClientRect();
  const pad = 24;
  if (r.right > box.right - pad) tabs.scrollLeft += r.right - box.right + pad;
  else if (r.left < box.left) tabs.scrollLeft -= box.left - r.left + 8;
}
// Every render replaces the page, so the sticky-row observer is always
// dropped and re-attached to the new nodes.
let _spaceStickyObs = null;
function afterSpaceRender() {
  if (_spaceStickyObs) { _spaceStickyObs.disconnect(); _spaceStickyObs = null; }
  const bar = document.querySelector('#content .space-tabbar');
  const sentinel = document.querySelector('#content .space-tabs-sentinel');
  if (!bar || !sentinel) return;
  // Set the state this render starts in without animating it, then watch.
  bar.classList.add('is-instant');
  const stuck = () => sentinel.getBoundingClientRect().top < 0;
  // The phone chat button shows only once the row sticks, so at rest it
  // never sits over the hero; the Chat tab covers that state.
  const root = bar.closest('.space');
  const setStuck = (on) => { bar.classList.toggle('is-stuck', on); if (root) root.classList.toggle('space-fab-on', on); };
  setStuck(stuck());
  requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.remove('is-instant')));
  // The tab row fades at the right edge only while more tabs sit off it.
  const tabs = bar.querySelector('.space-tabs');
  const edge = () => { if (tabs) tabs.classList.toggle('is-clipped', tabs.scrollWidth - tabs.clientWidth - tabs.scrollLeft > 4); };
  if (tabs) {
    edge();
    tabs.addEventListener('scroll', edge, { passive: true });
  }
  // Sticking narrows the row (the crest slides in at the left), so the
  // active tab is brought back into view once the slide has settled.
  const settle = () => { spaceActiveTabIntoView(tabs); edge(); };
  if ('IntersectionObserver' in window) {
    _spaceStickyObs = new IntersectionObserver(() => {
      const was = bar.classList.contains('is-stuck'), now = stuck();
      setStuck(now);
      if (was !== now) { settle(); setTimeout(settle, 380); }
    }, { threshold: [0, 1] });
    _spaceStickyObs.observe(sentinel);
  }
  // "More" under a description only when the phone clamp actually cut it.
  const desc = document.querySelector('#content .space-desc');
  const moreBtn = document.querySelector('#content .space-desc-more');
  if (desc && moreBtn) moreBtn.hidden = !(desc.scrollHeight - desc.clientHeight > 2);
}
