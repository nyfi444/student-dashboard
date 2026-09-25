/* ── Quick add that understands plain English ─────────────────────
   "bio lab report fri 5pm" → a lab for BIO, due Friday at 5:00 PM.
   parseQuickAdd pulls the class, day, time, type, and priority out of
   what someone typed and leaves the rest as the title. quickAddBar is
   the input used on the dashboard, Assignments, and To-Do pages: it
   shows what it understood as chips while you type, and each chip can
   be dismissed if it guessed wrong.
──────────────────────────────────────────────────────────────── */
const QP_DAYS = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tues: 2, tue: 2, wednesday: 3, weds: 3, wed: 3, thursday: 4, thurs: 4, thur: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
const QP_MONTHS = { january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12 };
const QP_NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const QP_FILLER_END = /^(due|by|on|at|before|for|in|this|next|the|@|-|,|:)$/i;
const QP_FILLER_START = /^(due|by|on|at|before|@|-|,|:)$/i;
const QP_NAME_STOPWORDS = new Set(['intro', 'introduction', 'to', 'of', 'the', 'and', 'in', 'for', 'principles', 'fundamentals', 'advanced', 'general', 'topics', 'seminar', 'survey', 'foundations', 'elementary', 'intermediate', 'studies', 'lab', 'laboratory', 'i', 'ii', 'iii', 'iv']);

function qpIso(y, m, d) {
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return iso(dt);
}
// A month/day with no year: this year, unless that's well in the past (then next year).
function qpInferYear(m, d, now) {
  const y = now.getFullYear();
  const guess = qpIso(y, m, d);
  if (!guess) return null;
  return daysBetween(guess) < -60 ? qpIso(y + 1, m, d) : guess;
}
function qpTime(h, m, ampm) {
  h = Number(h); m = Number(m || 0);
  if (m > 59) return null;
  if (ampm) {
    if (h < 1 || h > 12) return null;
    const pm = ampm[0] === 'p';
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
  } else if (h > 23) return null;
  else if (h >= 1 && h <= 6) h += 12;             // "at 5" means 5 PM for a student
  else if (h === 11 && m === 59) h = 23;           // 11:59 deadlines are at night
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function qpNextDow(dow, now) {
  const diff = (dow - now.getDay() + 7) % 7;
  return addDays(iso(now), diff);
}
function qpType(lower) {
  if (/\b(midterm|final exam|finals?|exam|test)\b/.test(lower)) return 'exam';
  if (/\bquiz(zes)?\b/.test(lower)) return 'quiz';
  if (/\blab\b/.test(lower)) return 'lab';
  if (/\b(discussion|forum|post)\b/.test(lower)) return 'discussion';
  if (/\b(essay|paper)\b/.test(lower)) return 'paper';
  if (/\b(project|presentation|poster)\b/.test(lower)) return 'project';
  if (/\b(read|reading|chapter|ch\.?\s*\d)/.test(lower)) return 'reading';
  return 'assignment';
}
const QP_ASSIGNMENT_WORDS = /\b(due|hw|homework|pset|problem sets?|problems|exercises|worksheet|webwork|mastering|assignment|essay|paper|quiz|exam|midterm|final|test|lab|reading|discussion post|project|presentation|study guide)\b/;

// How each class can be referred to: its code ("chem 210", "chem210"), its
// subject ("chem"), its name, or the start of a distinctive word in its name
// ("calc" for Calculus II, "psych" for Intro to Psychology).
function qpCourseMatchers(courses) {
  const out = [];
  courses.forEach(c => {
    const code = String(c.code || '').trim();
    const m = code.match(/^([A-Za-z&]+)\s*-?\s*(\d+[A-Za-z]?)/);
    if (m) out.push({ course: c, re: new RegExp(`\\b${m[1].replace(/&/g, '\\&')}\\s*-?\\s*${m[2]}\\b`, 'i'), strength: 3 });
    const name = String(c.name || '').trim();
    if (name.length >= 4) out.push({ course: c, re: new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'i'), strength: 3 });
    // A subject like "bio"; two-letter ones ("CS", "IS") only when typed in capitals.
    if (m && m[1].length >= 3) out.push({ course: c, re: new RegExp(`\\b${m[1]}\\b`, 'i'), strength: 2 });
    else if (m && m[1].length === 2) out.push({ course: c, re: new RegExp(`\\b${m[1].toUpperCase()}\\b`), strength: 2 });
    name.toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 4 && !QP_NAME_STOPWORDS.has(w)).forEach(w => {
      // The word or the start of it, at least 4 letters: "calc", "psych", "chem".
      const prefixes = Array.from({ length: w.length - 3 }, (_, i) => w.slice(0, w.length - i));
      out.push({ course: c, re: new RegExp(`\\b(?:${prefixes.join('|')})\\b`, 'i'), strength: 1 });
    });
  });
  return out;
}

function parseQuickAdd(text, { courses = activeCourses(), ignore = [], now = new Date() } = {}) {
  const src = String(text || '');
  let work = src;                         // matched text gets blanked out here, same length, so indexes line up
  const removed = [];
  const skip = new Set(ignore);
  const out = { raw: src, title: '', courseId: null, courseLabel: '', dueDate: null, dueTime: null, type: 'assignment', priority: null, found: [] };
  const take = (re, fn) => {
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let hit = false;
    work = work.replace(r, (...args) => {
      if (hit) return args[0];
      const offset = args[args.length - 2];
      const res = fn(args, offset, args[args.length - 1]);
      if (!res) return args[0];
      hit = true;
      removed.push([offset, offset + args[0].length]);
      return ' '.repeat(args[0].length);
    });
    return hit;
  };
  const lead = '(?:\\b(?:due|by|on|before|this)\\s+)?';

  // Priority
  if (!skip.has('priority')) {
    take(/(^|\s)(!{1,3}|p[123])(?=\s|$)/i, ([m, pre, tok]) => { out.priority = /p3/i.test(tok) ? 'low' : /p2/i.test(tok) ? 'medium' : 'high'; return true; });
    if (!out.priority) take(/\b(urgent|asap)\b/i, () => { out.priority = 'high'; return true; });
  }

  // Time
  if (!skip.has('time')) {
    take(/(?:\b(?:at|by)\s+|@\s*)?\b(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm|a\.m\.|p\.m\.)|(a|p))(?![a-z])/i, ([, h, m, ap, short]) => { const t = qpTime(h, m, (ap || short).toLowerCase().replace(/\./g, '')); if (t) out.dueTime = t; return !!t; })
      || take(/(?:\b(?:at|by)\s+|@\s*)?\b([01]?\d|2[0-3]):([0-5]\d)\b/i, ([, h, m]) => { const t = qpTime(h, m); if (t) out.dueTime = t; return !!t; })
      || take(/\b(?:at|by)\s+(noon|midday|midnight)\b|\b(noon|midnight)\b/i, ([, a, b]) => { out.dueTime = /mid(night)/i.test(a || b) ? '23:59' : '12:00'; return true; })
      || take(/(?:\bat|@)\s*(\d{1,2})\b(?![/.:-]\d)/i, ([, h]) => { const t = qpTime(h, 0); if (t) out.dueTime = t; return !!t; })
      || take(/\b(eod|end of (the )?day)\b/i, () => { out.dueTime = '23:59'; return true; });
  }

  // Date
  if (!skip.has('date')) {
    const today = iso(now);
    const setDate = (d) => { if (!d) return false; out.dueDate = d; return true; };
    take(new RegExp(`${lead}\\b(today|tdy)\\b`, 'i'), () => setDate(today))
      || take(new RegExp(`${lead}\\btonight\\b`, 'i'), () => { if (!out.dueTime && !skip.has('time')) out.dueTime = '23:59'; return setDate(today); })
      || take(new RegExp(`${lead}\\b(tomorrow|tmrw|tmr|tmw|2morrow)\\b`, 'i'), () => setDate(addDays(today, 1)))
      || take(/\bin\s+(\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(days?|weeks?|wks?)\b/i, ([, n, unit]) => {
        const k = /^\d+$/.test(n) ? Number(n) : QP_NUMBERS[n.toLowerCase()];
        return setDate(addDays(today, k * (/^w/i.test(unit) ? 7 : 1)));
      })
      || take(/(?:\bby\s+)?\b(end of (the )?week|eow)\b/i, () => setDate(qpNextDow(5, now)))
      || take(/(?:\bby\s+)?\b(this|next)\s+weekend\b/i, ([, w]) => setDate(addDays(qpNextDow(6, now), /next/i.test(w) && now.getDay() !== 0 && now.getDay() !== 6 ? 7 : 0)))
      || take(/(?:\b(?:due|by|on|before)\s+)?\bnext\s+week\b/i, () => setDate(addDays(qpNextDow(1, now), now.getDay() === 1 ? 7 : 0)))
      || take(/(?:\b(?:due|by|on|before)\s+)?\b(this|next)?\s*\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|weds|wed|thurs|thur|thu|fri|sat)\b\.?/i, ([m, which, day], offset, str) => {
        const key = day.toLowerCase();
        // "sat" and "sun" are also ordinary words (SAT prep, sun salutations):
        // only read them as days when it's clear, like "due sat" or at the very end.
        if ((key === 'sat' || key === 'sun') && !/^(due|by|on|before|this|next)\b/i.test(m.trim()) && str.slice(offset + m.length).trim() !== '') return false;
        let d = qpNextDow(QP_DAYS[key], now);
        if (/next/i.test(which || '')) {
          const nextMonday = addDays(qpNextDow(1, now), now.getDay() === 1 ? 7 : 0);
          if (d === today) d = addDays(d, 7);
          if (d < nextMonday) d = addDays(d, 7);
        }
        return setDate(d);
      })
      || take(new RegExp(`${lead}\\b(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?\\b`, 'i'), ([, a, b, y]) => {
        const m = Number(a), d = Number(b);
        if (m < 1 || m > 12) return false;
        const year = y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : null;
        return setDate(year ? qpIso(year, m, d) : qpInferYear(m, d, now));
      })
      || take(new RegExp(`${lead}\\b(${Object.keys(QP_MONTHS).join('|')})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, 'i'), ([, mon, d, y]) => {
        const m = QP_MONTHS[mon.toLowerCase()];
        return setDate(y ? qpIso(Number(y), m, Number(d)) : qpInferYear(m, Number(d), now));
      })
      || take(new RegExp(`${lead}\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${Object.keys(QP_MONTHS).join('|')})\\b`, 'i'), ([, d, mon]) => setDate(qpInferYear(QP_MONTHS[mon.toLowerCase()], Number(d), now)))
      || take(new RegExp(`${lead}\\bthe\\s+(\\d{1,2})(st|nd|rd|th)\\b`, 'i'), ([, d]) => {
        const day = Number(d);
        let cand = qpIso(now.getFullYear(), now.getMonth() + 1, day);
        if (cand && cand < today) { const nm = new Date(now.getFullYear(), now.getMonth() + 1, 1); cand = qpIso(nm.getFullYear(), nm.getMonth() + 1, day); }
        return setDate(cand);
      });
  }

  // Class
  if (!skip.has('course') && courses.length) {
    const matchers = qpCourseMatchers(courses);
    for (const strength of [3, 2, 1]) {
      const hits = matchers.filter(x => x.strength === strength && x.re.test(work));
      if (!hits.length) continue;
      // Anything that could mean two different classes is left alone.
      if (new Set(hits.map(h => h.course.id)).size > 1) break;
      const mt = hits[0];
      out.courseId = mt.course.id;
      out.courseLabel = mt.course.code || mt.course.name;
      const r = new RegExp(`(?:\\b(?:for|in)\\s+)?(${mt.re.source})`, 'i');
      const hit = work.match(r);
      if (hit) {
        const start = hit.index, end = hit.index + hit[0].length;
        const before = work.slice(0, start).trim(), after = work.slice(end).trim();
        // Drop the class from the title when it reads as a label (at the start
        // or end, or "for BIO"), not when it's part of the sentence.
        if (!before || !after) {
          removed.push([start, end]);
          work = work.slice(0, start) + ' '.repeat(end - start) + work.slice(end);
        }
      }
      break;
    }
  }

  // Title: whatever wasn't used, minus leftover "due", "by", "on"…
  let words = work.split(/\s+/).filter(Boolean);
  if (removed.length) {
    while (words.length && QP_FILLER_END.test(words[words.length - 1])) words.pop();
    while (words.length && QP_FILLER_START.test(words[0])) words.shift();
  }
  let title = words.join(' ').replace(/\s+([,.;:!?])/g, '$1').replace(/^[,.;:\-–—\s]+|[,;:\-–—\s]+$/g, '');
  if (!title) title = src.trim();
  out.title = /^[a-z][a-z\s]/.test(title) ? title.charAt(0).toUpperCase() + title.slice(1) : title;
  out.type = qpType(src.toLowerCase());
  out.looksLikeAssignment = !!out.courseId && (out.type !== 'assignment' || QP_ASSIGNMENT_WORDS.test(src.toLowerCase()));
  return out;
}

/* ── The quick add bar ─────────────────────────────────────────── */
// mode: 'auto' (dashboard: decides to-do vs assignment), 'assignment', or 'todo'.
window._qa = window._qa || {};
function qaState(id) { return window._qa[id] || (window._qa[id] = { ignore: [], kind: null, courseId: null }); }
function quickAddBar(id, { mode = 'auto', placeholder, defaultCourseId = null } = {}) {
  const st = qaState(id);
  st.mode = mode; st.defaultCourseId = defaultCourseId;
  // A phone's box fits about half the example, so it gets a shorter one.
  const phone = window.matchMedia?.('(max-width: 760px)').matches;
  const ph = placeholder || (phone
    ? (mode === 'todo' ? 'Add a to-do: “email advisor 3pm”' : mode === 'assignment' ? 'Add one: “lab report fri 5pm”' : 'Add anything: “lab fri 5pm”')
    : (mode === 'todo' ? 'Add a to-do: “email advisor tomorrow 3pm !”' : mode === 'assignment' ? 'Add an assignment: “chem lab report fri 5pm”' : 'Add anything: “bio lab report fri 5pm” or “call mom sunday”'));
  return `
    <div class="quick-add card qa-smart" id="qa-wrap-${id}">
      <div class="qa-row">
        <span class="quick-add-ic">${icon('plus', 15, 2)}</span>
        <input class="quick-add-input" id="qa-${id}" placeholder="${esc(ph)}" autocomplete="off" aria-label="${mode === 'todo' ? 'Add a to-do' : mode === 'assignment' ? 'Add an assignment' : 'Quick add'}" aria-describedby="qa-${id}-preview"
          oninput="qaPreview('${id}')" onkeydown="if(event.key==='Enter'){event.preventDefault();qaSubmit('${id}')}else if(event.key==='Escape'){this.value='';qaReset('${id}')}">
        <button class="btn btn-sm btn-primary qa-add-btn" onclick="qaSubmit('${id}')">Add</button>
      </div>
      <div class="qa-preview" id="qa-${id}-preview" aria-live="polite">${qaPreviewHtml(id, '')}</div>
    </div>`;
}
function qaReset(id) { const st = qaState(id); st.ignore = []; st.kind = null; st.courseId = null; qaPreview(id); }
function qaParse(id, text) {
  const st = qaState(id);
  const p = parseQuickAdd(text, { ignore: st.ignore });
  if (st.courseId) { const c = getCourse(st.courseId); if (c) { p.courseId = c.id; p.courseLabel = c.code || c.name; p.coursePicked = true; } }
  if (!p.courseId && st.mode === 'assignment' && st.defaultCourseId && getCourse(st.defaultCourseId)) { const c = getCourse(st.defaultCourseId); p.courseId = c.id; p.courseLabel = c.code || c.name; p.courseDefault = true; }
  p.kind = st.mode === 'todo' ? 'todo' : st.mode === 'assignment' ? 'assignment' : (st.kind || (p.looksLikeAssignment ? 'assignment' : 'todo'));
  return p;
}
function qaPreviewHtml(id, text) {
  const st = qaState(id);
  if (!text.trim()) {
    return `<span class="qa-hint">${st.mode === 'todo' ? 'Try “return library books sat”, “text group 7pm”, or add ! for high priority.' : st.mode === 'assignment' ? 'Include the class, day, and time: “psych quiz 2 thursday 11am”.' : 'Type naturally. The class, day, and time fill themselves in.'}</span>`;
  }
  const p = qaParse(id, text);
  const chip = (key, iconName, label, { dismiss = true, cls = '' } = {}) => `<span class="qa-chip ${cls}">${icon(iconName, 12, 1.9)}<span>${esc(label)}</span>${dismiss ? `<button type="button" class="qa-chip-x" aria-label="Don’t use ${esc(label)}" onclick="qaIgnore('${id}','${key}')">${icon('x', 10, 2.4)}</button>` : ''}</span>`;
  const courses = activeCourses();
  const parts = [];
  if (st.mode === 'auto') parts.push(`<button type="button" class="qa-kind" onclick="qaToggleKind('${id}')" title="Switch between to-do and assignment">${icon(p.kind === 'assignment' ? 'clipboard-list' : 'check-square', 12, 1.9)} ${p.kind === 'assignment' ? 'Assignment' : 'To-do'} <span class="muted">⇄</span></button>`);
  if (p.courseId) parts.push(`<span class="qa-chip qa-course" style="--c:${esc(getCourseColor(p.courseId))}"><span class="course-dot" style="--course:${esc(getCourseColor(p.courseId))}"></span><span>${esc(p.courseLabel)}${p.courseDefault ? ' <span class="muted">(default)</span>' : ''}</span>${!p.courseDefault ? `<button type="button" class="qa-chip-x" aria-label="Don’t use ${esc(p.courseLabel)}" onclick="${p.coursePicked ? `qaPickCourse('${id}','')` : `qaIgnore('${id}','course')`}">${icon('x', 10, 2.4)}</button>` : ''}</span>`);
  else if (courses.length && p.kind === 'assignment') parts.push(`<label class="qa-chip qa-pick">${icon('graduation-cap', 12, 1.9)}<select aria-label="Class" onchange="qaPickCourse('${id}',this.value)"><option value="">Pick a class</option>${courses.map(c => `<option value="${c.id}">${esc(c.code || c.name)}</option>`).join('')}</select></label>`);
  if (p.dueDate) parts.push(chip('date', 'calendar', relativeDay(p.dueDate).replace(' (overdue)', '') + (daysBetween(p.dueDate) > 6 || daysBetween(p.dueDate) < 0 ? '' : `, ${fmtDate(p.dueDate)}`)));
  else parts.push(chip('date', 'calendar', 'No due date', { dismiss: false, cls: 'is-default' }));
  if (p.dueTime) parts.push(chip('time', 'clock', fmtTime(p.dueTime)));
  if (p.kind === 'assignment' && p.type !== 'assignment') parts.push(`<span class="qa-chip">${icon('flag', 12, 1.9)}<span>${esc(p.type)}</span></span>`);
  if (p.priority) parts.push(chip('priority', 'star', `${p.priority[0].toUpperCase() + p.priority.slice(1)} priority`));
  return `<span class="qa-title">${esc(p.title)}</span>${parts.join('')}`;
}
function qaPreview(id) {
  const input = $(`#qa-${id}`), box = $(`#qa-${id}-preview`);
  if (!input || !box) return;
  if (!input.value.trim()) { const st = qaState(id); st.ignore = []; st.kind = null; st.courseId = null; }
  box.innerHTML = qaPreviewHtml(id, input.value);
}
function qaIgnore(id, key) { const st = qaState(id); if (!st.ignore.includes(key)) st.ignore.push(key); qaPreview(id); $(`#qa-${id}`)?.focus(); }
function qaToggleKind(id) { const st = qaState(id); const p = qaParse(id, $(`#qa-${id}`)?.value || ''); st.kind = p.kind === 'assignment' ? 'todo' : 'assignment'; qaPreview(id); $(`#qa-${id}`)?.focus(); }
function qaPickCourse(id, courseId) { const st = qaState(id); st.courseId = courseId || null; if (!courseId) { if (!st.ignore.includes('course')) st.ignore.push('course'); } qaPreview(id); $(`#qa-${id}`)?.focus(); }
function qaSubmit(id) {
  const input = $(`#qa-${id}`);
  const text = input?.value.trim();
  if (!text) { input?.focus(); return; }
  const p = qaParse(id, text);
  if (p.kind === 'assignment') {
    if (!p.courseId && activeCourses().length) { toast('Which class is this for? Pick one below, or add the class to what you typed.', 'error', 3800); return; }
    const a = {
      id: uid(), courseId: p.courseId, title: p.title, type: p.type, dueDate: cleanDueDate(p.dueDate), dueTime: cleanDueTime(p.dueTime),
      startByDate: null, maxPoints: null, status: 'not-started', rubric: [], notes: '', attachments: [], recurringTemplateId: null,
    };
    state.assignments.push(a);
    qaReset(id);
    touch();
    toast(`Added “${a.title}” · ${p.courseLabel} · ${a.dueDate ? `due ${relativeDay(a.dueDate).replace(' (overdue)', '')}${a.dueTime !== '23:59' ? ` ${fmtTime(a.dueTime)}` : ''}` : 'no due date'}`, 'success', 4500, { label: 'Undo', run: () => { state.assignments = state.assignments.filter(x => x.id !== a.id); touch(); } });
  } else {
    const st = qaState(id);
    const td = {
      id: uid(), courseId: p.courseId, sectionId: st.sectionId || null, title: p.title, done: false,
      dueDate: cleanDueDate(p.dueDate), dueTime: cleanDueTime(p.dueTime, null), priority: p.priority || 'medium', recurring: null,
    };
    state.todos.unshift(td);
    qaReset(id);
    touch();
    toast(`Added “${td.title}”${td.dueDate ? ` · ${relativeDay(td.dueDate).replace(' (overdue)', '')}` : ''}${td.dueTime ? ` ${fmtTime(td.dueTime)}` : ''}`, 'success', 4500, { label: 'Undo', run: () => { state.todos = state.todos.filter(x => x.id !== td.id); touch(); } });
  }
  if (typeof playUiSound === 'function') playUiSound('tap');
  setTimeout(() => { const el = $(`#qa-${id}`); if (el) { el.value = ''; el.focus(); qaPreview(id); } }, 30);
}
