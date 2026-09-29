/* ── Spaces: the invite kit shared by study groups and clubs ──────────
   openSpaceInvite(space, kind, { justCreated })   kind: 'group' | 'club'
     The invite sheet: cover band and crest, the join link and code with
     copy buttons, a QR code, Share, "Show on screen" and (clubs) "Print a
     table card". openInviteModal and openOrgInviteModal hand off here.
   inviteJoinPreview(kind, code, data)   the join preview for someone who
     opened a link or typed a code (showJoinPreview / showOrgPreview).
   inviteSignedOutHtml(kind, code)   the signed-out invite (code only).
   inviteShowOnScreen(kind, code)    fixed full-screen view for a projector.
   invitePrintCard(kind, code)       letter-size tent card, PDF or print.

   Links and codes are built by the same functions the rest of the app
   uses (groupInviteLink, orgInviteLink), so nothing here changes what a
   scan or a paste resolves to. The QR encoder (vendor/qrcode) loads on
   demand and everything is drawn as inline SVG; no request leaves the
   device. Styles: css/space-invite.css. Every top-level name starts with
   invite (or openSpaceInvite) so the classic scripts never collide.
──────────────────────────────────────────────────────────────── */
const INVITE_QR_SRC = 'vendor/qrcode/qrcode.min.js';

// One plain shape for both kinds, so every view below reads the same fields.
function inviteSpaceOf(space, kind) {
  const isClub = kind === 'club';
  const code = space.code;
  return {
    kind, code, isClub,
    name: space.name || (isClub ? 'Club' : 'Study group'),
    color: isClub ? orgColor(space) : groupColor(space),
    crest: isClub ? { text: orgMonogram(space) } : groupCrest(space),
    link: isClub ? orgInviteLink(code) : groupInviteLink(code),
    message: isClub ? orgInviteMessage(code) : inviteMessage(code),
    local: !!space.local, sample: !!space.sample,
    sub: isClub ? [orgKindLabel(space), space.school].filter(Boolean).join(' · ') : (space.courseLabel || 'Study group'),
    officer: isClub ? isOrgOfficer(space) : true,
    space,
  };
}
function inviteFind(kind, code) {
  const s = kind === 'club' ? findOrg(code) : findGroup(code);
  return s ? inviteSpaceOf(s, kind) : null;
}
function inviteRootStyle(s) { return `${spaceVars(s.color)}${HEX_COLOR.test(s.color || '') ? `;${colorVars('org', s.color)}` : ''}`; }
function inviteCodeTiles(code, cls = 'sg-invite-code') {
  return `<div class="${cls}" aria-label="Code ${code.split('').join(' ')}">${code.split('').map(ch => `<span>${esc(ch)}</span>`).join('')}</div>`;
}

/* ── QR ── */
function inviteLoadQr() {
  if (typeof qrcode !== 'undefined') return Promise.resolve();
  return loadScriptOnce(INVITE_QR_SRC);
}
// Inline SVG, black on white in every theme, 4-module quiet zone, error
// correction M. Decorative: the link and code beside it are the text.
function inviteQrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(String(text));
  qr.make();
  const n = qr.getModuleCount(), q = 4, size = n + q * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
// Fills every [data-invite-qr] that is still empty. Failures stay quiet: a
// missing library (first open on bad wifi) shows a note, never a console error.
async function inviteFillQr(root) {
  const slots = [...(root || document).querySelectorAll('[data-invite-qr]:not([data-ready])')];
  if (!slots.length) return false;
  try { await inviteLoadQr(); } catch {
    slots.forEach(el => { el.innerHTML = '<span class="invite-qr-off small">QR code needs a connection once. The link and code work.</span>'; });
    return false;
  }
  slots.forEach(el => { try { el.innerHTML = inviteQrSvg(el.dataset.inviteQr); el.dataset.ready = '1'; } catch { el.innerHTML = ''; } });
  return true;
}
function inviteQrBlock(s, cls = '') {
  return `<div class="invite-qr ${cls}" role="img" aria-label="QR code that opens ${esc(s.link)} (code ${esc(s.code)})" data-invite-qr="${esc(s.link)}"></div>`;
}

/* ── The invite sheet ── */
function openSpaceInvite(space, kind, { justCreated = false } = {}) {
  const s = inviteSpaceOf(space, kind);
  const canShare = !s.local || s.sample;          // a local, non-sample group has no code anyone can use
  const noun = s.isClub ? 'Members' : 'Classmates';
  const notice = s.local
    ? `<div class="sg-callout small mb-16"><div>${s.sample ? 'This is a sample, so the code is just for show.' : `You’re not logged in, so no one else can join yet. <a href="login.html">Log in</a> to invite ${noun.toLowerCase()} for real.`}</div></div>`
    : '';
  openModal(`
    <div class="space invite-sheet" style="${inviteRootStyle(s)}">
      <div class="invite-cover space-cover" data-pattern="${spacePattern(s.code)}">
        <button class="close-x invite-close" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button>
        ${spaceCrest(s.crest, 'xl')}
        <div class="invite-cover-text">
          <div class="eyebrow invite-eyebrow">${justCreated ? 'Ready to go' : 'Invite'}</div>
          <h3 class="invite-title">${esc(s.name)}</h3>
          ${s.sub ? `<div class="invite-sub small">${esc(s.sub)}</div>` : ''}
        </div>
      </div>
      <div class="modal-body invite-body">
        ${notice}
        <div class="invite-grid">
          <div class="invite-main">
            <div class="field">
              <label for="invite-link">${s.isClub ? 'Join link' : 'Join link'}</label>
              <div class="sg-invite-row"><input class="input" id="invite-link" value="${esc(s.link)}" readonly onclick="this.select()"><button class="btn btn-primary" onclick="inviteCopyLink('${kind}','${s.code}')">${icon('copy', 14)} Copy</button></div>
            </div>
            <div class="invite-code-wrap">
              <div class="invite-code-label small">${noun} can also type this code</div>
              ${inviteCodeTiles(s.code)}
              <button class="sg-link invite-copy-code" onclick="inviteCopyCode('${s.code}')">${icon('copy', 12)} Copy code</button>
            </div>
          </div>
          ${canShare ? `<div class="invite-qr-card">${inviteQrBlock(s)}<div class="small invite-qr-cap">Scan to join</div></div>` : ''}
        </div>
        ${canShare ? `
        <div class="invite-actions">
          ${navigator.share ? `<button class="btn" onclick="inviteShare('${kind}','${s.code}')">${icon('send', 14)} Share</button>` : ''}
          <button class="btn" onclick="inviteShowOnScreen('${kind}','${s.code}')">${icon('maximize', 14)} Show on screen</button>
          ${s.isClub ? `<button class="btn" onclick="invitePrintCard('${kind}','${s.code}')">${icon('file-text', 14)} Print a table card</button>` : ''}
        </div>` : ''}
        ${canShare && s.officer && !s.sample ? `<p class="small muted invite-note">Anyone with this code can join. You can remove people from Members.</p>` : ''}
        ${invitePricingLine(s)}
      </div>
    </div>
  `, { wide: true });
  inviteFillQr($('#modal'));
}
// The same pricing pointer the old sheets had, one per kind.
function invitePricingLine(s) {
  if (s.isClub) {
    const o = s.space;
    const kindWord = o.kind === 'team' ? 'team' : o.kind === 'chapter' ? 'chapter' : 'club';
    const officerPlan = s.officer && typeof orgGroupPlanUrl === 'function';
    return `<div class="sg-pricing-inline small mt-16">
        <span class="sg-feature-ic">${icon('shield', 16)}</span>
        <div><span class="sg-strong">Getting the whole ${kindWord} on?</span><div class="muted">Each member needs Semester HQ. ${officerPlan
          ? `A <a href="${o.sample ? GROUP_PRICING_URL : orgGroupPlanUrl(o)}"${o.sample ? ' target="_blank" rel="noopener"' : ''}>group plan</a> covers every member for $5.99 each a month, and can come out of your budget or dues. Members join from one link.`
          : `<a href="${GROUP_PRICING_URL}" target="_blank" rel="noopener">Group pricing</a> covers everyone for less, and can come out of your budget or dues.`}</div></div>
      </div>`;
  }
  return `<div class="sg-pricing-inline small mt-16">
        <span class="sg-feature-ic">${icon('users', 16)}</span>
        <div><span class="sg-strong">Getting your whole class or club on board?</span><div class="muted">Each member needs their own Semester HQ Plus. <a href="${GROUP_PRICING_URL}" target="_blank" rel="noopener">Group pricing</a> covers everyone at a lower per-student rate.</div></div>
      </div>`;
}
function inviteCopyLink(kind, code) {
  const s = inviteFind(kind, code);
  if (s) copyText(s.link, 'Link copied');
}
function inviteCopyCode(code) { copyText(code, 'Code copied'); }
function inviteShare(kind, code) {
  const s = inviteFind(kind, code);
  if (!s || !navigator.share) return;
  navigator.share({ title: `Join ${s.name} on Semester HQ`, text: s.message }).catch(() => {});
}

/* ── Show on screen ── */
let _inviteScreen = null, _inviteScreenReturn = null, _inviteWakeLock = null;
function inviteShowOnScreen(kind, code) {
  const s = inviteFind(kind, code);
  if (!s || _inviteScreen) return;
  _inviteScreenReturn = document.activeElement;
  const el = document.createElement('div');
  el.className = 'space invite-screen space-cover';
  el.id = 'invite-screen';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', `Scan to join ${s.name}`);
  el.dataset.pattern = spacePattern(s.code);
  el.style.cssText = inviteRootStyle(s);
  el.innerHTML = `
    <button type="button" class="btn invite-screen-done" onclick="inviteCloseScreen()">${icon('x', 14)} Done</button>
    <div class="invite-screen-col">
      ${spaceCrest(s.crest, 'xl')}
      <h2 class="invite-screen-name">${esc(s.name)}</h2>
      <div class="invite-screen-lead">Scan to join</div>
      <div class="invite-screen-qr">${inviteQrBlock(s)}</div>
      ${inviteCodeTiles(s.code, 'invite-screen-code')}
      <div class="invite-screen-url">${esc(s.link)}</div>
      ${s.sample ? '<div class="invite-screen-note small">Sample code, just for show</div>' : ''}
    </div>`;
  document.body.appendChild(el);
  _inviteScreen = el;
  window.addEventListener('keydown', inviteScreenKey, true);
  document.addEventListener('fullscreenchange', inviteScreenFsChange);
  inviteFillQr(el);
  // Fill the display and keep it awake where the browser allows; iPhone
  // Safari has neither, so the fixed overlay is the whole answer there.
  try { if (el.requestFullscreen) el.requestFullscreen().catch(() => {}); } catch {}
  try { if (navigator.wakeLock?.request) navigator.wakeLock.request('screen').then(l => { _inviteWakeLock = l; }).catch(() => {}); } catch {}
  setTimeout(() => { try { el.querySelector('.invite-screen-done').focus({ preventScroll: true }); } catch {} }, 30);
}
function inviteScreenKey(e) {
  if (!_inviteScreen) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); inviteCloseScreen(); return; }
  if (e.key === 'Tab') { e.preventDefault(); try { _inviteScreen.querySelector('.invite-screen-done').focus(); } catch {} }
}
function inviteScreenFsChange() { if (_inviteScreen && !document.fullscreenElement) inviteCloseScreen(); }
function inviteCloseScreen() {
  const el = _inviteScreen;
  if (!el) return;
  _inviteScreen = null;
  window.removeEventListener('keydown', inviteScreenKey, true);
  document.removeEventListener('fullscreenchange', inviteScreenFsChange);
  try { if (document.fullscreenElement === el && document.exitFullscreen) document.exitFullscreen().catch(() => {}); } catch {}
  try { if (_inviteWakeLock) { _inviteWakeLock.release().catch(() => {}); _inviteWakeLock = null; } } catch {}
  el.remove();
  const back = _inviteScreenReturn;
  _inviteScreenReturn = null;
  if (back && document.contains(back)) { try { back.focus({ preventScroll: true }); } catch {} }
}

/* ── Table card ── */
// Two halves with a fold; the top half is upside down so the card reads
// from both sides of the table. Ink only. The QR is an <img> from a data
// URL here because html2canvas draws images more reliably than inline SVG.
function inviteTentHtml(s) {
  let qr = '';
  try { qr = `<img class="invite-tent-qr" alt="" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(inviteQrSvg(s.link))}">`; } catch {}
  const crest = `<span class="invite-tent-crest"><span>${s.crest.text}</span>${s.crest.sub ? `<small>${s.crest.sub}</small>` : ''}</span>`;
  const half = `
    <div class="invite-tent-half">
      ${crest}
      <div class="invite-tent-name">${esc(s.name)}</div>
      <div class="invite-tent-lead">Scan to join${s.sub ? ` · ${esc(s.sub)}` : ''}</div>
      ${qr}
      <div class="invite-tent-code">${esc(s.code)}</div>
      <div class="invite-tent-url">${esc(s.link)}</div>
    </div>`;
  return `<div class="invite-tent">${half}<div class="invite-tent-fold" aria-hidden="true"></div>${half}</div>`;
}
async function invitePrintCard(kind, code) {
  const s = inviteFind(kind, code);
  if (!s) return;
  try { await inviteLoadQr(); } catch { toast('The QR code needs a connection once. Try again when you’re online.', 'error', 4500); return; }
  const html = inviteTentHtml(s);
  const filename = `${s.name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Table card'} table card.pdf`;
  if (typeof html2pdf === 'undefined') { try { await loadScriptOnce(HTML2PDF_SRC); } catch {} }
  if (typeof html2pdf !== 'undefined' && typeof shareOrDownloadPdf === 'function') {
    const box = document.createElement('div');
    box.className = 'invite-tent-page';
    box.innerHTML = html;
    document.body.appendChild(box);
    try {
      const blob = await html2pdf().set({
        margin: 0, filename,
        html2canvas: { backgroundColor: '#ffffff', scale: 2 },
        jsPDF: { unit: 'pt', format: 'letter' },
        pagebreak: { mode: ['avoid-all'] },
      }).from(box).outputPdf('blob');
      await shareOrDownloadPdf(blob, filename, `${s.name} table card`);
      return;
    } catch (e) {
      diag.warn('invite', 'Table card PDF failed, fell back to print', e);
    } finally { box.remove(); }
  }
  inviteLegacyPrint(html, `${s.name} table card`);
}
function inviteLegacyPrint(html, title) {
  const area = $('#print-area');
  if (!area) return;
  area.className = 'print-tent';
  area.innerHTML = html;
  const restore = document.title;
  document.title = title;
  try { window.print(); } catch {}
  document.title = restore;
  setTimeout(() => { if (area.className === 'print-tent') { area.className = ''; area.innerHTML = ''; } }, 1000);
}

/* ── Join preview and the signed-out invite ── */
// Cover, crest, name, kind or class · school · N members, the next event,
// one big Join. No faces or names: this person is not a member yet.
function inviteJoinPreview(kind, code, data) {
  const isClub = kind === 'club';
  let s, count, next, extra = '', confirmId, confirmJs, notNowJs, verb;
  if (isClub) {
    // Straight from the doc: orgView only knows clubs this person is already in.
    const o = { ...data, code, local: false, people: data.people || {}, memberUids: data.memberUids || [], officerUids: data.officerUids || [], events: data.events || {}, rsvp: data.rsvp || {}, titles: data.titles || {} };
    s = inviteSpaceOf(o, 'club');
    count = o.memberUids.length;
    const e = upcomingOrgEvents(o)[0];
    next = e ? `${esc(e.title)} · ${fmtSessionDay(e.date)}${e.start ? ` at ${fmtTime(e.start)}` : ''}` : '';
    extra = `${orgLinksHtml(o) ? `<div class="invite-join-links">${orgLinksHtml(o)}</div>` : ''}<div class="invite-join-fields">${orgRoleFieldsHtml(o, '', 'oj')}</div>`;
    confirmId = 'oj-confirm'; confirmJs = `confirmJoinOrg('${code}')`; notNowJs = 'clearPendingOrg();closeModal()'; verb = 'Join';
  } else {
    const g = normalizeGroup({ ...data, code });
    s = inviteSpaceOf(g, 'group');
    count = data.v === 2 ? groupPeople(g).length : (data.members || []).length;
    const n = data.v === 2 ? upcomingSessions(g)[0] : null;
    next = n ? `${esc(n.title)} · ${fmtSessionWhen(n)}` : '';
    confirmId = 'jf-confirm'; confirmJs = `confirmJoinGroup('${code}')`; notNowJs = 'clearPendingJoin();closeModal()'; verb = 'Join';
  }
  const meta = [esc(s.sub), count ? `${count} member${count === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
  const desc = data.description ? cleanStr(data.description, 200) : '';
  openModal(`
    <div class="space invite-join" style="${inviteRootStyle(s)}">
      <div class="invite-join-cover space-cover" data-pattern="${spacePattern(code)}">
        <button class="close-x invite-close" aria-label="Close" onclick="${notNowJs}">${icon('x', 16)}</button>
      </div>
      <div class="modal-body invite-join-body">
        ${spaceCrest(s.crest, 'xl')}
        <div class="eyebrow invite-eyebrow">You’re invited</div>
        <h3 class="invite-join-name">${esc(s.name)}</h3>
        ${meta ? `<div class="small muted invite-join-meta">${meta}</div>` : ''}
        ${desc ? `<p class="small invite-join-desc">${esc(desc)}</p>` : ''}
        ${next ? `<div class="invite-join-next small"><span class="invite-join-next-k">Next</span> ${next}</div>` : ''}
        ${extra}
        <button class="btn btn-primary invite-join-btn" id="${confirmId}" onclick="${confirmJs}">${verb} ${esc(s.name)}</button>
        <button class="sg-link invite-join-notnow" onclick="${notNowJs}">Not now</button>
      </div>
    </div>
  `);
}
// Signed out, the rules keep the name private, so this is the code alone.
function inviteSignedOutHtml(kind, code) {
  const isClub = kind === 'club';
  return `
    <div class="invite-join is-anon">
      <div class="invite-join-cover is-plain">
        <button class="close-x invite-close" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button>
      </div>
      <div class="modal-body invite-join-body">
        <span class="space-crest is-xl invite-anon-crest" aria-hidden="true"><span class="space-crest-main">${icon(isClub ? 'flag' : 'users', 26)}</span></span>
        <div class="eyebrow invite-eyebrow">You’re invited</div>
        <h3 class="invite-join-name">${isClub ? 'Join a club on Semester HQ' : 'Join a study group'}</h3>
        ${inviteCodeTiles(code, 'sg-invite-code small-code')}
        <p class="small muted invite-join-desc">Log in or create your Semester HQ account to join. You’ll come right back to this invite afterward.${isClub ? ' Its events go straight onto your calendar.' : ''}</p>
        <a class="btn btn-primary invite-join-btn" href="login.html">Log in to join</a>
        <button class="sg-link invite-join-notnow" onclick="closeModal()">Look around first</button>
      </div>
    </div>`;
}
