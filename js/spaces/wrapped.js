/* ── Club Wrapped and Group Wrapped ────────────────────────────────
   An end-of-term recap for a study group or a club, built only from
   data the space already has: events held, RSVPs, sessions, tasks done,
   files shared, messages, members who joined. Drawn on the same
   1080×1920 canvas as the personal Semester Wrapped (js/wrapped.js) so
   each card saves or shares as a story-sized image. Cards without data
   are skipped. Nothing here is stored in a shared document: the one
   per-user key is settings.spaceWrappedDismissed.

   Copy says "events" and "RSVPs", never attendance: nobody checks in.
──────────────────────────────────────────────────────────────── */
const WRAPPED_SPACE_W = 1080, WRAPPED_SPACE_H = 1920;
const WRAPPED_SPACE_MIN = 3;                     // past events or sessions before the recap offers itself
const WRAPPED_SPACE_BONE = '#F8F6F2', WRAPPED_SPACE_INK = '#121212';
const WRAPPED_SPACE_CATS = [['meeting', 'meeting', 'meetings'], ['practice', 'practice', 'practices'], ['game', 'game', 'games'], ['social', 'social', 'socials'], ['service', 'service day', 'service days'], ['other', 'other event', 'other events']];

/* ── The term ──────────────────────────────────────────────────── */
// Spaces have no term of their own: the viewer's current semester, clipped
// to today, with the last sixteen weeks as the fallback.
function wrappedSpaceRange() {
  const t = todayIso();
  const s = typeof currentSemester === 'function' ? currentSemester() : null;
  const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  if (s && ok(s.startDate) && ok(s.endDate) && s.startDate <= t) return { start: s.startDate, end: s.endDate < t ? s.endDate : t, name: String(s.name || 'This term').replace(/\s*\(sample\)$/, ''), semId: s.id || 'none' };
  return { start: addDays(t, -112), end: t, name: 'This term', semId: 'none' };
}
function wrappedSpaceInRange(r, d) { return !!d && d >= r.start && d <= r.end; }
function wrappedSpaceMsInRange(r, ms) { return typeof ms === 'number' && ms > 0 && wrappedSpaceInRange(r, iso(new Date(ms))); }
function wrappedSpaceHour(hhmm) {
  const h = Number(String(hhmm || '').slice(0, 2));
  if (!Number.isFinite(h) || !/^\d{2}:\d{2}$/.test(hhmm || '')) return '';
  return `${h % 12 === 0 ? 12 : h % 12} ${h >= 12 ? 'PM' : 'AM'}`;
}

/* ── The numbers ───────────────────────────────────────────────── */
// Club: events that already happened this term (dues deadlines are not
// gatherings), Going answers from current members on those events, the
// busiest one, who joined, what officers shared and said.
function wrappedOrgStats(o, range = wrappedSpaceRange()) {
  const me = myOrgUid(o);
  const members = (o.memberUids || []).filter(safeId);
  const events = orgEventList(o).filter(e => !orgIsDuesEvent(e) && orgEventPast(e) && wrappedSpaceInRange(range, e.date));
  const byCat = {};
  events.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + 1; });
  let rsvpYes = 0, busiest = null;
  events.forEach(e => {
    const yes = members.filter(u => o.rsvp?.[u]?.[e.id] === 'yes').length;
    rsvpYes += yes;
    if (yes > 0 && (!busiest || yes > busiest.yes)) busiest = { id: e.id, date: e.date, title: e.title, category: e.category, yes };
  });
  const people = orgPeople(o);
  const joined = people.filter(p => wrappedSpaceMsInRange(range, p.joinedAt)).length;
  const files = orgFileList(o).filter(f => wrappedSpaceMsInRange(range, f.at)).length;
  const announcements = orgAnnouncementList(o).filter(a => wrappedSpaceMsInRange(range, a.at)).length;
  const messages = typeof orgMessages === 'function' ? orgMessages(o).filter(m => wrappedSpaceMsInRange(range, m.at)).length : 0;
  const mine = events.filter(e => o.rsvp?.[me]?.[e.id] === 'yes').length;
  return { kind: 'club', code: o.code, name: o.name, range, count: events.length, events: events.length, byCat, rsvpYes, perEvent: events.length ? rsvpYes / events.length : 0, busiest, joined, members: people.length, files, announcements, messages, mine, of: events.length };
}
// Group: past sessions this term, tasks finished, the time you usually met
// (what happened, not the availability grid), files shared, messages.
function wrappedGroupStats(g, range = wrappedSpaceRange()) {
  const me = myUidFor(g);
  const sessions = sessionList(g).filter(s => sessionIsPast(s) && wrappedSpaceInRange(range, s.date));
  const tasksDone = taskList(g).filter(t => t.done && wrappedSpaceMsInRange(range, t.doneAt)).length;
  const slots = {};
  sessions.forEach(s => { const k = `${new Date(s.date + 'T00:00:00').getDay()}|${String(s.start || '').slice(0, 2)}`; slots[k] = slots[k] || { n: 0, s }; slots[k].n++; });
  const top = Object.values(slots).sort((a, b) => b.n - a.n)[0];
  let usual = null;
  if (top && top.n >= 2) {
    const day = new Date(top.s.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' });
    const hour = wrappedSpaceHour(top.s.start);
    usual = { day: `${day}s`, hour, times: top.n };
  }
  const mine = sessions.filter(s => s.rsvp?.[me] === 'yes').length;
  const files = typeof groupLibItems === 'function' ? groupLibItems(g).filter(i => wrappedSpaceMsInRange(range, i.at)).length : 0;
  const messages = typeof groupMessages === 'function' ? groupMessages(g).filter(m => wrappedSpaceMsInRange(range, m.at)).length : 0;
  const people = groupPeople(g);
  const joined = people.filter(p => wrappedSpaceMsInRange(range, p.joinedAt)).length;
  return { kind: 'group', code: g.code, name: g.name, range, count: sessions.length, sessions: sessions.length, tasksDone, usual, mine, of: sessions.length, files, messages, members: people.length, joined };
}
function wrappedSpaceStats(kind, sp) { return kind === 'club' ? wrappedOrgStats(sp) : wrappedGroupStats(sp); }
function wrappedSpaceFind(kind, code) { return kind === 'club' ? findOrg(code) : findGroup(code); }
// The crest text drawn on every card: the club monogram, or the group's
// course code split (BIO over 201). Raw text, never HTML.
function wrappedSpaceCrest(kind, sp) {
  if (kind === 'group') return spaceGroupCrest(sp);
  return { main: spaceMonogram(sp?.name), sub: '' };
}
function wrappedSpaceColor(kind, sp) {
  const hex = kind === 'club' ? orgColor(sp) : groupColor(sp);
  return HEX_COLOR.test(hex || '') ? hex : GROUP_COLORS[0];
}

/* ── The cards ─────────────────────────────────────────────────── */
function wrappedSpaceCards(st) {
  const one = (v, a, b) => `${v} ${v === 1 ? a : b}`;
  const list = [{ kind: 'cover', eyebrow: st.range.name, big: 'Wrapped', sub: `${st.name}, by the numbers.` }];
  const rows = [];
  if (st.kind === 'club') {
    if (st.events >= 1) {
      const parts = WRAPPED_SPACE_CATS.filter(([k]) => st.byCat[k]).map(([k, a, b]) => one(st.byCat[k], a, b));
      list.push({ eyebrow: 'You got together', big: `${st.events}`, unit: st.events === 1 ? 'time' : 'times', sub: `${parts.length ? parts.join(', ') + '. ' : ''}Every one of them on the calendar.` });
      rows.push(['Events', `${st.events}`]);
    }
    if (st.rsvpYes >= 1) {
      list.push({ eyebrow: 'Members said Going', big: `${st.rsvpYes}`, unit: st.rsvpYes === 1 ? 'RSVP' : 'RSVPs', sub: st.events > 1 ? `about ${Math.max(1, Math.round(st.perEvent))} per event. That is a full room.` : 'That is a full room.' });
      rows.push(['RSVPs', `${st.rsvpYes}`]);
    }
    if (st.busiest && st.busiest.yes >= 2) {
      list.push({ eyebrow: 'Busiest night', big: fmtDate(st.busiest.date, { month: 'short', day: 'numeric' }), unit: '', sub: `${st.busiest.title}. ${st.busiest.yes} people said Going.`, bigSize: 210 });
      rows.push(['Busiest night', fmtDate(st.busiest.date, { month: 'short', day: 'numeric' })]);
    }
    if (st.joined >= 1) {
      list.push({ eyebrow: 'New this term', big: `${st.joined}`, unit: st.joined === 1 ? 'member' : 'members', sub: `joined ${st.name}. ${st.members} of you now.` });
      rows.push(['Joined this term', `${st.joined}`]);
    }
    if (st.files >= 1) { list.push({ eyebrow: 'Shared in Files', big: `${st.files}`, unit: st.files === 1 ? 'file' : 'files', sub: 'so nobody had to ask for the link twice.' }); rows.push(['Files shared', `${st.files}`]); }
    if (st.messages >= 10) { list.push({ eyebrow: 'Said in chat', big: st.messages.toLocaleString(), unit: 'messages', sub: 'plans, reminders and a few good jokes.' }); rows.push(['Messages', st.messages.toLocaleString()]); }
    if (st.announcements >= 1) rows.push(['Announcements', `${st.announcements}`]);
    if (st.of >= 1 && st.mine >= 1) list.push({ kind: 'mine', eyebrow: 'Your term', big: `${st.mine} of ${st.of}`, unit: '', sub: `events you said yes to. RSVPs, not attendance, but we see you.`, bigSize: 200 });
  } else {
    if (st.sessions >= 1) { list.push({ eyebrow: 'You met', big: `${st.sessions}`, unit: st.sessions === 1 ? 'time' : 'times', sub: 'Studying is better together.' }); rows.push(['Sessions', `${st.sessions}`]); }
    if (st.tasksDone >= 1) { list.push({ eyebrow: 'Finished together', big: `${st.tasksDone}`, unit: st.tasksDone === 1 ? 'task' : 'tasks', sub: 'claimed, done and checked off for everyone.' }); rows.push(['Tasks done', `${st.tasksDone}`]); }
    if (st.usual) { list.push({ eyebrow: 'Your usual time', big: st.usual.day, unit: st.usual.hour ? `at ${st.usual.hour}` : '', sub: `${st.usual.times} of your sessions landed here. A habit, basically.`, bigSize: 190 }); rows.push(['Usual time', st.usual.hour ? `${st.usual.day} at ${st.usual.hour}` : st.usual.day]); }
    if (st.files >= 1) { list.push({ eyebrow: 'Shared in Files', big: `${st.files}`, unit: st.files === 1 ? 'thing' : 'things', sub: 'notes, decks and links, in one place for everyone.' }); rows.push(['Files shared', `${st.files}`]); }
    if (st.messages >= 10) { list.push({ eyebrow: 'Said in chat', big: st.messages.toLocaleString(), unit: 'messages', sub: 'room numbers, reminders and moral support.' }); rows.push(['Messages', st.messages.toLocaleString()]); }
    if (st.joined >= 1) rows.push(['Joined this term', `${st.joined}`]);
    if (st.of >= 1 && st.mine >= 1) list.push({ kind: 'mine', eyebrow: 'Your term', big: `${st.mine} of ${st.of}`, unit: '', sub: 'sessions you said yes to. RSVPs, not attendance, but we see you.', bigSize: 200 });
  }
  rows.push(['Members', `${st.members}`]);
  list.push({ kind: 'summary', rows: rows.slice(0, 6) });
  return list;
}

/* ── Drawing ───────────────────────────────────────────────────── */
// Cards alternate the space's own color (settled by spaceColorSet so the
// text always reads) with bone paper that carries the color as an accent.
function wrappedSpaceRgba(hex, a) { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return `rgba(${r},${g},${b},${a})`; }
function wrappedSpacePalette(hex, i) {
  const c = spaceColorSet(hex);
  if (i % 2 === 0) {
    const light = spaceContrast(c.fill, '#ffffff') >= 4.5;
    const fg = light ? WRAPPED_SPACE_BONE : WRAPPED_SPACE_INK;
    return { bg: c.fill, fg, dim: wrappedSpaceRgba(fg, 0.7), accent: light ? spaceMixHex(c.fill, '#ffffff', 0.6) : spaceMixHex(c.fill, '#000000', 0.45) };
  }
  return { bg: WRAPPED_SPACE_BONE, fg: WRAPPED_SPACE_INK, dim: wrappedSpaceRgba(WRAPPED_SPACE_INK, 0.62), accent: c.textsafe };
}
// The space's cover pattern (spacePattern order: Ruled, Graph, Dot grid,
// Margin, Pennant, Tide) at 14% of the text color.
function wrappedSpaceDrawPattern(ctx, idx, color) {
  const W = WRAPPED_SPACE_W, H = WRAPPED_SPACE_H;
  ctx.save(); ctx.globalAlpha = 0.14; ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
  const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  switch (((idx % 6) + 6) % 6) {
    case 0: for (let y = 120; y < H; y += 72) line(0, y, W, y); break;
    case 1: for (let y = 0; y < H; y += 96) line(0, y, W, y); for (let x = 0; x < W; x += 96) line(x, 0, x, H); break;
    case 2: for (let y = 48; y < H; y += 72) for (let x = 48; x < W; x += 72) { ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); } break;
    case 3: for (let y = 120; y < H; y += 72) line(0, y, W, y); ctx.lineWidth = 5; line(150, 0, 150, H); break;
    case 4: for (let y = 0; y < H; y += 260) for (let x = -60; x < W; x += 130) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 130, y); ctx.lineTo(x + 65, y + 110); ctx.closePath(); ctx.stroke(); } break;
    default: for (let y = 60; y < H; y += 90) { ctx.beginPath(); for (let x = 0; x <= W; x += 12) { const yy = y + Math.sin(x / 70) * 14; if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); } ctx.stroke(); }
  }
  ctx.restore();
}
function wrappedSpaceDrawCrest(ctx, crest, p, sans) {
  const cx = 96 + 72, cy = 96 + 72, r = 72;
  ctx.fillStyle = p.fg; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = p.bg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const main = String(crest?.main || '?'), sub = String(crest?.sub || '');
  if (sub) {
    ctx.font = `600 44px ${sans}`; ctx.fillText(main, cx, cy - 22);
    ctx.font = `500 36px ${sans}`; ctx.fillText(sub, cx, cy + 26);
  } else {
    ctx.font = `600 ${main.length >= 3 ? 44 : 60}px ${sans}`; ctx.fillText(main, cx, cy + 2);
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}
async function wrappedSpaceDraw(card, ctx0, index) {
  const { st, crest, hex, patternIdx } = ctx0;
  const p = wrappedSpacePalette(hex, index);
  const cv = document.createElement('canvas');
  cv.width = WRAPPED_SPACE_W; cv.height = WRAPPED_SPACE_H;
  const ctx = cv.getContext('2d');
  const serif = '"Instrument Serif", Georgia, serif', sans = '"General Sans", -apple-system, "Segoe UI", sans-serif';
  const W = WRAPPED_SPACE_W, H = WRAPPED_SPACE_H;
  ctx.fillStyle = p.bg; ctx.fillRect(0, 0, W, H);
  wrappedSpaceDrawPattern(ctx, patternIdx, p.fg);
  const wrap = (text, x, y, maxW, lineH, font, color) => {
    ctx.font = font; ctx.fillStyle = color;
    const words = String(text).split(' ');
    let line = '', yy = y;
    words.forEach((w, i) => {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, yy); line = w; yy += lineH; } else line = test;
      if (i === words.length - 1) ctx.fillText(line, x, yy);
    });
    return yy;
  };
  const fit = (text, maxSize, minSize, maxW, weight = '') => {
    let size = maxSize;
    ctx.font = `${weight} ${size}px ${serif}`.trim();
    while (ctx.measureText(text).width > maxW && size > minSize) { size -= 10; ctx.font = `${weight} ${size}px ${serif}`.trim(); }
    return size;
  };
  // Header: crest, then the space's name and the term.
  ctx.textBaseline = 'alphabetic';
  wrappedSpaceDrawCrest(ctx, crest, p, sans);
  ctx.font = `500 44px ${sans}`; ctx.fillStyle = p.fg;
  let nameSize = 44;
  while (ctx.measureText(st.name).width > W - 96 - 270 - 96 && nameSize > 28) { nameSize -= 2; ctx.font = `500 ${nameSize}px ${sans}`; }
  ctx.fillText(st.name, 270, 156);
  ctx.font = `500 32px ${sans}`; ctx.fillStyle = p.dim; ctx.fillText(st.range.name, 270, 208);

  if (card.kind === 'summary') {
    ctx.font = `600 34px ${sans}`; ctx.fillStyle = p.dim; ctx.fillText('THE RECAP', 96, 470);
    fit('By the numbers', 150, 100, W - 192); ctx.fillStyle = p.fg; ctx.fillText('By the numbers', 90, 610);
    card.rows.forEach(([label, value], i) => {
      const y = 820 + i * 150;
      ctx.fillStyle = p.dim; ctx.globalAlpha = 0.35; ctx.fillRect(96, y - 96, W - 192, 2); ctx.globalAlpha = 1;
      ctx.font = `500 38px ${sans}`; ctx.fillStyle = p.dim; ctx.fillText(label, 96, y);
      const vs = fit(value, 76, 40, W - 192 - ctx.measureText(label).width - 40);
      ctx.font = `${vs}px ${serif}`; ctx.fillStyle = p.fg; ctx.textAlign = 'right'; ctx.fillText(value, W - 96, y + 6); ctx.textAlign = 'left';
    });
  } else if (card.kind === 'cover') {
    ctx.font = `600 36px ${sans}`; ctx.fillStyle = p.dim; ctx.fillText(String(card.eyebrow).toUpperCase(), 96, 760);
    ctx.font = `260px ${serif}`; ctx.fillStyle = p.fg; ctx.fillText(card.big, 80, 1000);
    wrap(card.sub, 96, 1110, W - 192, 72, `400 56px ${sans}`, p.dim);
    ctx.fillStyle = p.accent; ctx.beginPath(); ctx.arc(W - 190, 1400, 46, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.font = `600 36px ${sans}`; ctx.fillStyle = p.dim; ctx.fillText(String(card.eyebrow).toUpperCase(), 96, 700);
    const size = fit(card.big, card.bigSize || (card.big.length > 6 ? 190 : 330), 90, W - 192);
    ctx.fillStyle = p.fg; ctx.fillText(card.big, 84, 700 + size * 0.95);
    let y = 700 + size * 0.95;
    if (card.unit) { ctx.font = `96px ${serif}`; ctx.fillStyle = p.accent; ctx.fillText(card.unit, 96, y + 120); y += 120; }
    wrap(card.sub, 96, y + 110, W - 192, 72, `400 54px ${sans}`, p.dim);
  }
  // Footer: the small wordmark, the site, the card number.
  ctx.font = `italic 40px ${serif}`; ctx.fillStyle = p.fg; ctx.fillText('Semester HQ', 96, H - 110);
  ctx.font = `500 32px ${sans}`; ctx.fillStyle = p.dim; ctx.fillText('semester-hq.com', 96 + ctx.measureText('Semester HQ').width + 60, H - 110);
  ctx.textAlign = 'right'; ctx.fillText(`${index + 1}`, W - 96, H - 110); ctx.textAlign = 'left';
  return cv;
}

/* ── The viewer ────────────────────────────────────────────────── */
// Same stage as the personal Wrapped (its .wrapped-* styles), its own state,
// so the two never mislabel each other.
async function wrappedSpaceOpen(kind, code) {
  const sp = wrappedSpaceFind(kind, code);
  if (!sp) return;
  const st = wrappedSpaceStats(kind, sp);
  const label = `${sp.name} Wrapped`;
  if (st.count < 1) {
    openModal(`
      <div class="modal-head"><h3>${esc(label)}</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
      <div class="modal-body">${emptyState(icon('star', 20), 'The recap is still being written', '', kind === 'club' ? 'Once a few events have happened, they turn into cards here: events, RSVPs, new members, files shared.' : 'Once a few sessions have happened, they turn into cards here: sessions, tasks done, your usual time.')}</div>
    `);
    return;
  }
  const cards = wrappedSpaceCards(st);
  try { await Promise.all([document.fonts.load('260px "Instrument Serif"'), document.fonts.load('italic 40px "Instrument Serif"'), document.fonts.load('600 36px "General Sans"'), document.fonts.load('400 54px "General Sans"')]); } catch {}
  const draw = { st, crest: wrappedSpaceCrest(kind, sp), hex: wrappedSpaceColor(kind, sp), patternIdx: spacePattern(sp.code) };
  const canvases = [];
  for (let i = 0; i < cards.length; i++) canvases.push(await wrappedSpaceDraw(cards[i], draw, i));
  const slug = String(sp.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || kind;
  window._wrappedSpace = { kind, code, canvases, index: 0, label, filePrefix: `${slug}-wrapped`, shareText: `${sp.name}, wrapped. semester-hq.com`, officer: kind === 'club' && isOrgOfficer(sp) };
  if (typeof playUiSound === 'function') playUiSound('success');
  document.addEventListener('keydown', wrappedSpaceKeydown);
  wrappedSpaceRender();
}
function wrappedSpaceRender() {
  const w = window._wrappedSpace;
  if (!w) return;
  const url = w.canvases[w.index].toDataURL('image/png');
  let el = document.getElementById('wrapped-space');
  if (!el) {
    el = document.createElement('div');
    el.id = 'wrapped-space';
    el.className = 'wrapped-wrap wrapped-space';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', w.label);
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div class="wrapped-stage">
      <div class="wrapped-bars">${w.canvases.map((_, i) => `<span class="${i < w.index ? 'done' : i === w.index ? 'current' : ''}"></span>`).join('')}</div>
      <button class="wrapped-close" aria-label="Close" onclick="wrappedSpaceClose()">${icon('x', 16, 2.2)}</button>
      <div class="wrapped-card">
        <img src="${url}" alt="${esc(w.label)} card ${w.index + 1} of ${w.canvases.length}">
        <button class="wrapped-hit prev" aria-label="Previous card" onclick="wrappedSpaceStep(-1)" ${w.index === 0 ? 'disabled' : ''}></button>
        <button class="wrapped-hit next" aria-label="Next card" onclick="wrappedSpaceStep(1)"></button>
      </div>
      <div class="wrapped-actions wrapped-space-actions">
        <button class="btn" onclick="wrappedSpaceShare()">${icon('share', 14, 1.8)} Share this card</button>
        <button class="btn btn-ghost wrapped-save" onclick="wrappedSpaceSave()">${icon('download', 14, 1.8)} Save image</button>
        ${w.officer ? `<button class="btn btn-ghost wrapped-save" onclick="wrappedSpaceClose();wrappedOrgPost('${esc(w.code)}')">${icon('megaphone', 14, 1.8)} Post to announcements</button>` : ''}
      </div>
    </div>`;
}
function wrappedSpaceStep(dir) {
  const w = window._wrappedSpace;
  if (!w) return;
  const next = w.index + dir;
  if (next >= w.canvases.length) { wrappedSpaceClose(); return; }
  w.index = clamp(next, 0, w.canvases.length - 1);
  wrappedSpaceRender();
}
function wrappedSpaceKeydown(e) {
  if (!window._wrappedSpace) return;
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); wrappedSpaceStep(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); wrappedSpaceStep(-1); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); wrappedSpaceClose(); }
}
function wrappedSpaceClose() {
  document.removeEventListener('keydown', wrappedSpaceKeydown);
  document.getElementById('wrapped-space')?.remove();
  window._wrappedSpace = null;
}
function wrappedSpaceFile() {
  const w = window._wrappedSpace;
  return new Promise(resolve => w.canvases[w.index].toBlob(b => resolve(new File([b], `${w.filePrefix}-${w.index + 1}.png`, { type: 'image/png' })), 'image/png'));
}
async function wrappedSpaceShare() {
  const w = window._wrappedSpace;
  if (!w) return;
  const file = await wrappedSpaceFile();
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: w.label, text: w.shareText }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  wrappedSpaceSave(file);
}
async function wrappedSpaceSave(existing) {
  if (!window._wrappedSpace) return;
  const file = existing instanceof File ? existing : await wrappedSpaceFile();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Saved. Post it to your story!');
}

/* ── Entry points ──────────────────────────────────────────────── */
// The offer shows in the last stretch of the term (the same 85% mark the
// dashboard banner uses) once enough has happened. Samples always show it.
// Dismissal is per space and term, in the viewer's own settings.
function wrappedSpaceDismissals() { return state.settings.spaceWrappedDismissed || (state.settings.spaceWrappedDismissed = {}); }
function wrappedSpaceDismissKey(kind, code, range = wrappedSpaceRange()) { return `${kind}:${code}:${range.semId}`; }
function wrappedSpaceDismiss(kind, code) {
  wrappedSpaceDismissals()[wrappedSpaceDismissKey(kind, code)] = Date.now();
  save();
  if (typeof renderPreservingInput === 'function') renderPreservingInput(); else if (typeof render === 'function') render();
}
function wrappedSpaceDue(sp, st) {
  if (st.count < WRAPPED_SPACE_MIN) return false;
  if (sp.sample) return true;
  const p = typeof computeSemesterProgress === 'function' ? computeSemesterProgress() : null;
  return !!p && p.pct >= 85;
}
function wrappedSpaceLine(st) {
  const one = (v, a, b) => `${v} ${v === 1 ? a : b}`;
  const bits = st.kind === 'club'
    ? [st.events ? one(st.events, 'event', 'events') : '', st.rsvpYes ? one(st.rsvpYes, 'RSVP', 'RSVPs') : '', st.joined ? `${st.joined} joined` : '']
    : [st.sessions ? one(st.sessions, 'session', 'sessions') : '', st.tasksDone ? one(st.tasksDone, 'task done', 'tasks done') : '', st.files ? one(st.files, 'file shared', 'files shared') : ''];
  return bits.filter(Boolean).join(', ');
}
// The member keepsake: a card on the space's home. Inside the .space root,
// so --space and --space-ink are the crest's colors.
function wrappedSpaceBanner(kind, sp) {
  if (!sp) return '';
  const st = wrappedSpaceStats(kind, sp);
  if (!wrappedSpaceDue(sp, st) || wrappedSpaceDismissals()[wrappedSpaceDismissKey(kind, sp.code, st.range)]) return '';
  const crest = wrappedSpaceCrest(kind, sp);
  const line = wrappedSpaceLine(st);
  return `
    <section class="card wrapped-space-banner" aria-label="${esc(sp.name)} Wrapped">
      ${spaceCrest({ text: esc(crest.main), sub: esc(crest.sub) }, 'lg')}
      <div class="wrapped-space-banner-text">
        <span class="eyebrow">${esc(st.range.name)}</span>
        <h3 class="wrapped-space-banner-title">${esc(sp.name)}, wrapped</h3>
        <p class="small muted">${esc(line ? `${line}. ` : '')}Your term together, in cards made for your story.</p>
      </div>
      <div class="wrapped-space-banner-actions">
        <button type="button" class="btn btn-primary btn-sm" onclick="wrappedSpaceOpen('${kind}','${esc(sp.code)}')">Open</button>
        <button type="button" class="btn btn-ghost btn-sm" onclick="wrappedSpaceDismiss('${kind}','${esc(sp.code)}')">Not now</button>
      </div>
    </section>`;
}

/* ── Officers: post and print (clubs) ──────────────────────────── */
// Aggregates only, no names: this is what goes on a wall and to student
// government, and members can already read the same numbers in the club.
function wrappedOrgRecapText(o, st = wrappedOrgStats(o)) {
  const one = (v, a, b) => `${v} ${v === 1 ? a : b}`;
  const bits = [one(st.events, 'event', 'events'), one(st.rsvpYes, 'RSVP', 'RSVPs')];
  if (st.joined) bits.push(one(st.joined, 'new member', 'new members'));
  if (st.files) bits.push(one(st.files, 'file shared', 'files shared'));
  const list = bits.length > 1 ? `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}` : bits[0];
  const busiest = st.busiest && st.busiest.yes >= 2 ? ` Busiest night: ${fmtDate(st.busiest.date, { month: 'short', day: 'numeric' })}, ${st.busiest.title}, with ${st.busiest.yes} of you saying Going.` : '';
  return `${o.name}, ${st.range.name} wrapped: ${list}.${busiest} Thank you for showing up. See you next term.`.slice(0, ORG_ANNOUNCEMENT_MAX);
}
function wrappedOrgPost(code) {
  const o = findOrg(code);
  if (!o || !isOrgOfficer(o)) return;
  openAnnouncementModal(code, wrappedOrgRecapText(o));
}
function wrappedOrgSummaryHtml(o, st = wrappedOrgStats(o)) {
  const cats = WRAPPED_SPACE_CATS.filter(([k]) => st.byCat[k]).map(([k, a, b]) => `${st.byCat[k]} ${st.byCat[k] === 1 ? a : b}`).join(', ');
  const rows = [
    ['Events held', `${st.events}${cats ? ` (${cats})` : ''}`],
    ['RSVPs (Going)', `${st.rsvpYes}`],
    ['Average RSVPs per event', st.events ? `${(st.perEvent).toFixed(1)}` : '0'],
    ['Busiest event', st.busiest ? `${fmtDate(st.busiest.date, { month: 'short', day: 'numeric' })}, ${st.busiest.title} (${st.busiest.yes} Going)` : 'None yet'],
    ['Members now', `${st.members}`],
    ['Joined this term', `${st.joined}`],
    ['Files shared', `${st.files}`],
    ['Announcements posted', `${st.announcements}`],
  ];
  return `
    <div class="wrapped-print-head">
      <span class="wrapped-print-crest">${orgMonogram(o)}</span>
      <div>
        <div class="wrapped-print-name">${esc(o.name)}</div>
        <div class="wrapped-print-meta">${esc(orgKindLabel(o))}${o.school ? ` · ${esc(o.school)}` : ''} · ${esc(st.range.name)}, ${esc(fmtDate(st.range.start, { month: 'short', day: 'numeric' }))} to ${esc(fmtDate(st.range.end, { month: 'short', day: 'numeric' }))}</div>
      </div>
    </div>
    <table class="wrapped-print-table">${rows.map(([l, v]) => `<tr><th scope="row">${esc(l)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
    <p class="wrapped-print-foot">Counts come from ${esc(o.name)}’s Semester HQ page and cover current members. RSVPs are answers, not attendance. No member names appear here. Prepared ${esc(fmtDate(todayIso(), { month: 'long', day: 'numeric', year: 'numeric' }))}.</p>`;
}
function wrappedOrgPrint(code) {
  const o = findOrg(code);
  if (!o || !isOrgOfficer(o)) return;
  openModal(`
    <div class="modal-head"><h3>Term summary</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 16)}</button></div>
    <div class="modal-body">
      <p class="small muted mb-8">One page, totals only. Made for a renewal request or a student government budget hearing.</p>
      <div class="wrapped-print" id="wrapped-print-preview">${wrappedOrgSummaryHtml(o)}</div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Close</button><button class="btn btn-primary" onclick="wrappedOrgPrintNow('${esc(o.code)}')">${icon('file-text', 14)} Print</button></div>
  `, { wide: true });
}
function wrappedOrgPrintNow(code) {
  const o = findOrg(code);
  const area = document.getElementById('print-area');
  if (!o || !area) return;
  area.className = 'wrapped-print wrapped-print-page';
  area.innerHTML = wrappedOrgSummaryHtml(o);
  const restoreTitle = document.title;
  document.title = `${o.name} term summary`;
  window.print();
  document.title = restoreTitle;
}
// The officer's card on Officer home: the numbers in one line, then Open,
// Post and Print. Members never see Officer home, so these live only here.
function wrappedOrgAdminCard(o) {
  if (!o || !isOrgOfficer(o)) return '';
  const st = wrappedOrgStats(o);
  const line = wrappedSpaceLine(st);
  return `
    <div class="card card-pad wrapped-space-admin">
      <div class="flex-between mb-8 wrap"><h3 class="sg-h3">${icon('star', 16)} Term recap</h3><span class="small muted">${esc(st.range.name)}</span></div>
      ${st.events < 1
        ? `<p class="small muted">Once a few events have happened, they turn into cards here: events, RSVPs, new members, files shared. Post them to announcements or save them for the budget hearing.</p>`
        : `<p class="small muted mb-8">${esc(line)}. Cards for the group chat, a text you can post, and a one-page summary for student government. RSVPs, not attendance.</p>
        <div class="flex-gap wrap">
          <button type="button" class="btn btn-primary btn-sm" onclick="wrappedSpaceOpen('club','${esc(o.code)}')">${icon('star', 14)} Open recap</button>
          <button type="button" class="btn btn-sm" onclick="wrappedOrgPost('${esc(o.code)}')">${icon('megaphone', 14)} Post to announcements</button>
          <button type="button" class="btn btn-sm" onclick="wrappedOrgPrint('${esc(o.code)}')">${icon('file-text', 14)} Print summary</button>
        </div>`}
    </div>`;
}
