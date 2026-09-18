/* ── Semester Wrapped ──────────────────────────────────────────────
   A story of the semester in shareable cards, drawn on a 1080×1920
   canvas so each one saves or shares as a crisp image sized for
   Instagram and TikTok stories. Cards without data are skipped.
──────────────────────────────────────────────────────────────── */
const WRAP_W = 1080, WRAP_H = 1920;
const WRAP_PALETTES = [
  { bg: '#121212', fg: '#F8F6F2', dim: 'rgba(248,246,242,.62)', accent: '#D9CEC3' },
  { bg: '#F8F6F2', fg: '#121212', dim: 'rgba(18,18,18,.6)', accent: '#8C3B1F' },
  { bg: '#8C3B1F', fg: '#FBF3EA', dim: 'rgba(251,243,234,.7)', accent: '#F0C6A8' },
  { bg: '#1B2A4A', fg: '#EEF2FB', dim: 'rgba(238,242,251,.66)', accent: '#B9C8E8' },
  { bg: '#2F4A3A', fg: '#F1F5EF', dim: 'rgba(241,245,239,.68)', accent: '#CFE3D2' },
  { bg: '#6E2E3A', fg: '#FBF1F2', dim: 'rgba(251,241,242,.68)', accent: '#F2D5D9' },
  { bg: '#D9CEC3', fg: '#121212', dim: 'rgba(18,18,18,.62)', accent: '#6E2E3A' },
];

function semesterStats(sem = currentSemester()) {
  if (!sem) return null;
  const start = sem.startDate, end = sem.endDate < todayIso() ? sem.endDate : todayIso();
  const inRange = (d) => d && d >= start && d <= end;
  const courses = state.courses.filter(c => c.semesterId === sem.id);
  const courseIds = new Set(courses.map(c => c.id));
  const sessions = state.timerSessions.filter(s => inRange(s.date));
  const focusMin = sessions.reduce((a, s) => a + s.minutes, 0);
  const assignments = state.assignments.filter(a => courseIds.has(a.courseId));
  const done = assignments.filter(isAssignmentDone);
  const exams = done.filter(a => a.type === 'exam').length;
  // Streak: days with focus time or flashcard reviews.
  const activeDays = new Set([...sessions.map(s => s.date), ...Object.keys(state.srsLog || {}).filter(inRange)]);
  let longest = 0, run = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) { if (activeDays.has(d)) { run++; longest = Math.max(longest, run); } else run = 0; }
  const weeks = {};
  assignments.filter(a => inRange(a.dueDate)).forEach(a => { const w = startOfWeek(a.dueDate); weeks[w] = (weeks[w] || 0) + 1; });
  const busiest = Object.entries(weeks).sort((a, b) => b[1] - a[1])[0];
  const byCourse = {};
  sessions.forEach(s => { if (courseIds.has(s.courseId)) byCourse[s.courseId] = (byCourse[s.courseId] || 0) + s.minutes; });
  const topEntry = Object.entries(byCourse).sort((a, b) => b[1] - a[1])[0];
  const topCourse = topEntry ? { course: getCourse(topEntry[0]), minutes: topEntry[1] } : null;
  const cards = Object.entries(state.srsLog || {}).filter(([d]) => inRange(d)).reduce((a, [, n]) => a + n, 0);
  const hours = sessions.filter(s => s.at).map(s => new Date(Number(s.at)).getHours());
  let persona = null;
  if (hours.length >= 3) {
    const night = hours.filter(h => h >= 21 || h < 4).length, early = hours.filter(h => h >= 4 && h < 10).length;
    const weekend = sessions.filter(s => [0, 6].includes(new Date(s.date + 'T00:00:00').getDay())).length;
    if (night / hours.length >= 0.4) persona = { name: 'Night Owl', line: 'Most of your focus time happened after 9 PM.' };
    else if (early / hours.length >= 0.4) persona = { name: 'Early Bird', line: 'You got your best work done before 10 AM.' };
    else if (weekend / sessions.length >= 0.45) persona = { name: 'Weekend Warrior', line: 'Saturdays and Sundays were your power days.' };
    else persona = { name: 'Steady Grinder', line: 'You showed up at every hour of the day.' };
  }
  const groupSessions = typeof allGroups === 'function' ? allGroups().reduce((a, g) => a + sessionList(g).filter(s => inRange(s.date) && s.rsvp?.[myUidFor(g)] === 'yes').length, 0) : 0;
  const applied = (state.applications || []).filter(a => inRange(a.appliedOn)).length;
  return { sem, focusMin, sessions: sessions.length, longest, done: done.length, exams, busiest, topCourse, cards, persona, groupSessions, applied, courses: courses.length };
}

function wrappedCards(st) {
  const name = (state.settings.displayName || '').split(' ')[0];
  const hrs = Math.round(st.focusMin / 60);
  // A semester is a finite, countable thing — sixteen weeks, and then it's
  // over. That framing is the most ownable thing Semester HQ says, so
  // Wrapped opens on it: this is what those sixteen weeks were.
  const term = computeSemesterProgress();
  const list = [
    { kind: 'cover', eyebrow: st.sem.name.replace(/\s*\(sample\)$/, ''), big: 'Wrapped', sub: `${name ? `${name}’s` : 'Your'} semester, by the numbers.` },
  ];
  if (term) list.push({
    eyebrow: term.week >= term.totalWeeks ? 'The whole thing was' : `You’re at week ${term.week} of`,
    big: `${term.totalWeeks}`, unit: 'weeks',
    sub: term.week >= term.totalWeeks ? 'and this is everything that fit inside them.' : 'and this is what’s fit inside it so far.',
  });
  if (st.focusMin >= 30) list.push({ eyebrow: 'You focused for', big: hrs >= 2 ? `${hrs}` : `${st.focusMin}`, unit: hrs >= 2 ? 'hours' : 'minutes', sub: `across ${st.sessions} session${st.sessions === 1 ? '' : 's'}. That’s real, deep work.` });
  if (st.longest >= 2) list.push({ eyebrow: 'Longest streak', big: `${st.longest}`, unit: 'days', sub: 'in a row of studying. Consistency looks good on you.' });
  if (st.done >= 1) list.push({ eyebrow: 'Deadlines conquered', big: `${st.done}`, unit: '', sub: `assignments, labs, and papers done${st.exams ? `, plus ${st.exams} exam${st.exams === 1 ? '' : 's'}` : ''}.` });
  if (st.busiest && st.busiest[1] >= 3) list.push({ eyebrow: 'Your toughest week', big: fmtDate(st.busiest[0], { month: 'short', day: 'numeric' }), unit: '', sub: `${st.busiest[1]} things due in a single week. You made it through.` });
  if (st.topCourse?.course && st.topCourse.minutes >= 30) list.push({ eyebrow: 'Most-studied class', big: st.topCourse.course.code || st.topCourse.course.name, unit: '', sub: `${fmtDuration(st.topCourse.minutes)} of focus time. ${st.topCourse.course.name}${st.topCourse.course.code ? '' : ''} had your heart.`, stripe: st.topCourse.course.color });
  if (st.cards >= 10) list.push({ eyebrow: 'Flashcards reviewed', big: st.cards.toLocaleString(), unit: '', sub: 'each one right before you’d forget it.' });
  if (st.groupSessions >= 1) list.push({ eyebrow: 'Study group sessions', big: `${st.groupSessions}`, unit: '', sub: 'Studying is better together.' });
  if (st.persona) list.push({ eyebrow: 'Your study style', big: st.persona.name, unit: '', sub: st.persona.line, bigSize: 150 });
  list.push({ kind: 'summary' });
  return list;
}

async function drawWrappedCard(card, st, index) {
  const p = WRAP_PALETTES[index % WRAP_PALETTES.length];
  const cv = document.createElement('canvas');
  cv.width = WRAP_W; cv.height = WRAP_H;
  const ctx = cv.getContext('2d');
  const serif = '"Instrument Serif", Georgia, serif', sans = '"General Sans", -apple-system, "Segoe UI", sans-serif';
  ctx.fillStyle = p.bg; ctx.fillRect(0, 0, WRAP_W, WRAP_H);
  // Quiet decorative rings.
  ctx.strokeStyle = p.dim; ctx.globalAlpha = 0.18; ctx.lineWidth = 2;
  [520, 700, 880].forEach((r, i) => { ctx.beginPath(); ctx.arc(WRAP_W * 0.82, WRAP_H * (0.18 + index * 0.07 % 0.5), r - i * 40, 0, Math.PI * 2); ctx.stroke(); });
  ctx.globalAlpha = 1;
  if (card.stripe) { ctx.fillStyle = card.stripe; ctx.fillRect(96, 640, 14, 360); }
  const drawSparkle = (x, y, s, color) => {
    ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(x, y - s); ctx.quadraticCurveTo(x, y, x + s, y); ctx.quadraticCurveTo(x, y, x, y + s); ctx.quadraticCurveTo(x, y, x - s, y); ctx.quadraticCurveTo(x, y, x, y - s);
    ctx.fill();
  };
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
  // Header wordmark.
  ctx.textBaseline = 'alphabetic';
  ctx.font = `italic 58px ${serif}`; ctx.fillStyle = p.fg; ctx.fillText('Semester HQ', 96, 170);
  drawSparkle(96 + ctx.measureText('Semester HQ').width + 26, 132, 16, p.accent);

  if (card.kind === 'summary') {
    ctx.font = `600 34px ${sans}`; ctx.fillStyle = p.dim; ctx.fillText(st.sem.name.replace(/\s*\(sample\)$/, '').toUpperCase(), 96, 420);
    ctx.font = `140px ${serif}`; ctx.fillStyle = p.fg; ctx.fillText('The recap', 90, 560);
    const rows = [
      ['Focus time', fmtDuration(st.focusMin)], ['Longest streak', `${st.longest} day${st.longest === 1 ? '' : 's'}`], ['Deadlines done', `${st.done}`],
      ['Classes', `${st.courses}`], ['Flashcards reviewed', st.cards.toLocaleString()], ['Study style', st.persona?.name || 'Getting started'],
    ];
    rows.forEach(([label, value], i) => {
      const y = 780 + i * 150;
      ctx.fillStyle = p.dim; ctx.globalAlpha = 0.35; ctx.fillRect(96, y - 96, WRAP_W - 192, 2); ctx.globalAlpha = 1;
      ctx.font = `500 38px ${sans}`; ctx.fillStyle = p.dim; ctx.fillText(label, 96, y);
      ctx.font = `76px ${serif}`; ctx.fillStyle = p.fg; ctx.textAlign = 'right'; ctx.fillText(value, WRAP_W - 96, y + 6); ctx.textAlign = 'left';
    });
  } else if (card.kind === 'cover') {
    ctx.font = `600 36px ${sans}`; ctx.fillStyle = p.dim; ctx.fillText(card.eyebrow.toUpperCase(), 96, 760);
    ctx.font = `260px ${serif}`; ctx.fillStyle = p.fg; ctx.fillText(card.big, 80, 1000);
    wrap(card.sub, 96, 1110, WRAP_W - 192, 72, `400 56px ${sans}`, p.dim);
    drawSparkle(WRAP_W - 190, 1380, 60, p.accent);
  } else {
    ctx.font = `600 36px ${sans}`; ctx.fillStyle = p.dim; ctx.fillText(card.eyebrow.toUpperCase(), 96, 700);
    let size = card.bigSize || (card.big.length > 6 ? 190 : 330);
    ctx.font = `${size}px ${serif}`;
    while (ctx.measureText(card.big).width > WRAP_W - 192 && size > 90) { size -= 10; ctx.font = `${size}px ${serif}`; }
    ctx.fillStyle = p.fg; ctx.fillText(card.big, 84, 700 + size * 0.95);
    let y = 700 + size * 0.95;
    if (card.unit) { ctx.font = `96px ${serif}`; ctx.fillStyle = p.accent; ctx.fillText(card.unit, 96, y + 120); y += 120; }
    wrap(card.sub, 96, y + 110, WRAP_W - 192, 72, `400 54px ${sans}`, p.dim);
  }
  // Footer.
  ctx.font = `500 32px ${sans}`; ctx.fillStyle = p.dim; ctx.fillText('semester-hq.com', 96, WRAP_H - 110);
  ctx.textAlign = 'right'; ctx.fillText(`${index + 1}`, WRAP_W - 96, WRAP_H - 110); ctx.textAlign = 'left';
  return cv;
}

async function openWrapped() {
  const st = semesterStats();
  if (!st) return;
  if (st.focusMin < 30 && st.done < 1 && st.cards < 10) {
    openModal(`
      <div class="modal-head"><h3>Semester Wrapped</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
      <div class="modal-body">${emptyState(icon('sparkles', 26, 1.4), 'Your Wrapped is still being written', '', 'Log focus sessions, finish assignments, and review flashcards. At the end of the semester, it all comes together here as a recap you can share.')}</div>
    `);
    return;
  }
  const cards = wrappedCards(st);
  try { await Promise.all([document.fonts.load('260px "Instrument Serif"'), document.fonts.load('italic 58px "Instrument Serif"'), document.fonts.load('600 36px "General Sans"'), document.fonts.load('400 54px "General Sans"')]); } catch {}
  const canvases = [];
  for (let i = 0; i < cards.length; i++) canvases.push(await drawWrappedCard(cards[i], st, i));
  window._wrapped = { canvases, index: 0, sem: st.sem };
  playUiSound('success');
  document.addEventListener('keydown', wrappedKeydown);
  renderWrapped();
}
function renderWrapped() {
  const w = window._wrapped;
  const url = w.canvases[w.index].toDataURL('image/png');
  let el = document.getElementById('wrapped');
  if (!el) {
    el = document.createElement('div');
    el.id = 'wrapped';
    el.className = 'wrapped-wrap';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Semester Wrapped');
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div class="wrapped-stage">
      <div class="wrapped-bars">${w.canvases.map((_, i) => `<span class="${i < w.index ? 'done' : i === w.index ? 'current' : ''}"></span>`).join('')}</div>
      <button class="wrapped-close" aria-label="Close" onclick="closeWrapped()">${icon('x', 16, 2.2)}</button>
      <div class="wrapped-card">
        <img src="${url}" alt="Semester Wrapped card ${w.index + 1} of ${w.canvases.length}">
        <button class="wrapped-hit prev" aria-label="Previous card" onclick="stepWrapped(-1)" ${w.index === 0 ? 'disabled' : ''}></button>
        <button class="wrapped-hit next" aria-label="Next card" onclick="stepWrapped(1)"></button>
      </div>
      <div class="wrapped-actions">
        <button class="btn" onclick="shareWrappedCard()">${icon('share', 14, 1.8)} Share this card</button>
        <button class="btn btn-ghost wrapped-save" onclick="saveWrappedCard()">${icon('download', 14, 1.8)} Save image</button>
      </div>
    </div>`;
}
function stepWrapped(dir) {
  const w = window._wrapped;
  if (!w) return;
  const next = w.index + dir;
  if (next >= w.canvases.length) { closeWrapped(); return; }
  w.index = clamp(next, 0, w.canvases.length - 1);
  renderWrapped();
}
function wrappedKeydown(e) {
  if (!window._wrapped) return;
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); stepWrapped(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); stepWrapped(-1); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeWrapped(); }
}
function closeWrapped() {
  document.removeEventListener('keydown', wrappedKeydown);
  document.getElementById('wrapped')?.remove();
  window._wrapped = null;
}
function wrappedFile() {
  const w = window._wrapped;
  return new Promise(resolve => w.canvases[w.index].toBlob(b => resolve(new File([b], `semester-hq-wrapped-${w.index + 1}.png`, { type: 'image/png' })), 'image/png'));
}
async function shareWrappedCard() {
  const file = await wrappedFile();
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'My semester, wrapped', text: 'My semester, wrapped. semester-hq.com' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  saveWrappedCard(file);
}
async function saveWrappedCard(existing) {
  const file = existing instanceof File ? existing : await wrappedFile();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Saved. Post it to your story!');
}
// Shown on the dashboard near the end of the semester.
function wrappedDashboardBanner() {
  const sem = computeSemesterProgress();
  if (!sem || sem.pct < 85 || state.settings.wrappedDismissed === state.currentSemesterId) return '';
  return `
    <button class="card wrapped-banner" onclick="openWrapped()">
      <span class="wrapped-banner-mark">${icon('sparkles', 18, 1.6)}</span>
      <span style="flex:1;min-width:0;text-align:left"><span class="wrapped-banner-title">Your ${esc(sem.name.replace(/\s*\(sample\)$/, ''))} Wrapped is ready</span><span class="small muted">See your semester in cards made for your story.</span></span>
      <span class="btn btn-primary btn-sm">Open</span>
    </button>`;
}
