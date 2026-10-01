/* ── Spaces: forms, the shared rules (no page, no network) ─────────
   A club or study group asks its own questions: an interest form at the
   club fair, a membership application, an event sign-up, feedback after
   a session. This file is what a form IS: the question types, what a
   stored form or answer is allowed to look like, whether a form is open,
   the results, the spreadsheet rows, the starting points.

   Loaded by the app (index.html) AND by the standalone fill-out page
   (form.html), and by tests/run.mjs, so nothing here may touch the page,
   the planner's state or Firebase. It needs only `uid` (js/utils.js).

   Where things live (see firestore.rules):
     orgs/{CODE}/forms/{id}                    the form
     orgs/{CODE}/forms/{id}/responses/{uid}    one answer per person
     orgs/{CODE}/forms/{id}/marks/{uid}        accepted, waitlisted or
       declined, kept by whoever runs the form and never readable by the
       person the answer belongs to
     studyGroups/{CODE}/forms/...              the same, for study groups
     planners/{uid}/formAnswers/{key}          the person's own list of
       what they answered, so deleting an account can find every answer
       (the rules refuse an answer that doesn't come with this entry)

   A form:
     { v, id, title, description, questions: [question], status, audience,
       collectEmail, allowEdit, closesAt (ms or null), createdBy,
       createdByName, createdAt, updatedAt, spaceKind ('club' | 'group'),
       spaceName, spaceColor }
     status    'draft' (only the people running it see it), 'open', 'closed'
     audience  'members' or 'link' (anyone signed in who has the link)
     review    the people running it sort answers: accepted, waitlisted,
               declined (an application)
     anonymous answers carry no name, email or uid. They go through the
               Worker (/form/answer, worker/src/forms.js), which files each
               one under a random id and keeps the link between the person
               and that id where only the person and the server can read
               it. An anonymous form collects no email, takes no files
               (a file is stored under the sender's uid) and is not sorted.
     spaceName and spaceColor are copies, so the fill-out page never has
     to read the club itself.
   A question:
     { id, type, label, help, required, options: [string] }
   An answer document:
     { uid, name, email (only when the form collects it), member,
       answers: { [question id]: string | [string] | number | file }, at, updatedAt }
     a file answer is { name, size, type }. The file itself sits in
     Storage at formFilePath(...), a path worked out from the form, the
     sender and the question, never read from the answer.
   An anonymous answer document: { anon: true, answers, at } (at is the
     start of the day it was sent, not the moment).

   Every string in a stored form or answer was typed by somebody: it is
   cleaned here on the way in and escaped by whatever draws it.
──────────────────────────────────────────────────────────────── */
// [key, label, icon, what it is for]
const FORM_TYPES = [
  ['short', 'Short answer', 'type', 'A name, a major, one line'],
  ['long', 'Paragraph', 'text-quote', 'A few sentences'],
  ['choice', 'Multiple choice', 'check', 'Pick one'],
  ['checks', 'Checkboxes', 'check-square', 'Pick any that apply'],
  ['dropdown', 'Dropdown', 'chevron-down', 'Pick one from a long list'],
  ['scale', 'Scale, 1 to 5', 'star', 'Rate something'],
  ['date', 'Date', 'calendar', 'A day'],
  ['file', 'File upload', 'upload', 'A résumé, a photo, a signed form'],
];
const FORM_OPTION_TYPES = ['choice', 'checks', 'dropdown'];
const FORM_TITLE_MAX = 120;
const FORM_DESC_MAX = 600;
const FORM_LABEL_MAX = 200;
const FORM_HELP_MAX = 200;
const FORM_OPTION_MAX = 80;
const FORM_OPTIONS_MAX = 20;
const FORM_QUESTIONS_MAX = 40;   // firestore.rules holds the same number
const FORM_SHORT_MAX = 300;
const FORM_LONG_MAX = 2000;
const FORM_PER_SPACE_MAX = 30;
const FORM_RESPONSES_SHOWN = 500;
const FORM_FILE_MAX_BYTES = 10 * 1024 * 1024;   // storage.rules holds the same limit
const FORM_FILE_NAME_MAX = 180;
// [key, label, icon, the button] What the people running a form can decide about an answer.
const FORM_MARKS = [['accepted', 'Accepted', 'check', 'Accept'], ['waitlisted', 'Waitlisted', 'clock', 'Waitlist'], ['declined', 'Declined', 'x', 'Decline']];
const FORM_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FORM_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FORM_TOKEN = /^(c|g)\.([A-Z0-9]{6})\.([A-Za-z0-9_-]{1,64})$/;

function formTypeOf(q) { return FORM_TYPES.find(t => t[0] === q?.type) || FORM_TYPES[0]; }
function formHasOptions(type) { return FORM_OPTION_TYPES.includes(type); }
// One line of text: whitespace folded, trimmed, capped. (The app's cleanStr
// does the same; this file can't rely on it being loaded.)
function formStr(v, max = 200) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''; }
// Keeps line breaks, which formStr folds away: descriptions and long answers.
function formCleanText(v, max) { return typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : ''; }

/* ── What a stored form may look like ──────────────────────────── */
function formCleanQuestion(q) {
  if (!q || typeof q !== 'object' || !FORM_ID.test(q.id || '')) return null;
  const type = FORM_TYPES.some(t => t[0] === q.type) ? q.type : 'short';
  const out = { id: q.id, type, label: formStr(q.label, FORM_LABEL_MAX), help: formStr(q.help, FORM_HELP_MAX), required: q.required === true, options: [] };
  if (formHasOptions(type)) {
    const seen = new Set();
    out.options = (Array.isArray(q.options) ? q.options : []).map(o => formStr(o, FORM_OPTION_MAX))
      .filter(o => o && !seen.has(o.toLowerCase()) && seen.add(o.toLowerCase())).slice(0, FORM_OPTIONS_MAX);
  }
  return out;
}
function formClean(raw) {
  if (!raw || typeof raw !== 'object' || !FORM_ID.test(raw.id || '')) return null;
  const ids = new Set();
  const questions = (Array.isArray(raw.questions) ? raw.questions : []).map(formCleanQuestion)
    .filter(q => q && !ids.has(q.id) && ids.add(q.id)).slice(0, FORM_QUESTIONS_MAX);
  return {
    v: 1, id: raw.id,
    title: formStr(raw.title, FORM_TITLE_MAX) || 'Untitled form',
    description: formCleanText(raw.description, FORM_DESC_MAX),
    questions,
    status: ['draft', 'open', 'closed'].includes(raw.status) ? raw.status : 'draft',
    audience: raw.audience === 'link' ? 'link' : 'members',
    anonymous: raw.anonymous === true,
    collectEmail: raw.collectEmail === true && raw.anonymous !== true,
    review: raw.review === true && raw.anonymous !== true,
    allowEdit: raw.allowEdit === true,
    closesAt: typeof raw.closesAt === 'number' && isFinite(raw.closesAt) && raw.closesAt > 0 ? raw.closesAt : null,
    createdBy: typeof raw.createdBy === 'string' ? raw.createdBy.slice(0, 128) : '',
    createdByName: formStr(raw.createdByName, 60),
    createdAt: Number(raw.createdAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
    spaceKind: raw.spaceKind === 'group' ? 'group' : 'club',
    spaceName: formStr(raw.spaceName, 80),
    spaceColor: /^#[0-9a-f]{6}$/i.test(raw.spaceColor || '') ? raw.spaceColor : '',
  };
}
// What gets written: the cleaned form, without anything undefined.
function formForSave(form) {
  const f = formClean(form);
  return f ? { ...f, questions: f.questions.map(q => ({ ...q })) } : null;
}
// Why a form can't be opened for answers yet ('' when it can).
function formPublishProblem(form) {
  const f = formClean(form);
  if (!f) return 'This form didn’t load.';
  if (!formStr(form.title, FORM_TITLE_MAX)) return 'Give the form a title.';
  if (!f.questions.length) return 'Add at least one question.';
  const blank = f.questions.findIndex(q => !q.label);
  if (blank >= 0) return `Question ${blank + 1} needs its question written.`;
  const thin = f.questions.findIndex(q => formHasOptions(q.type) && q.options.length < 2);
  if (thin >= 0) return `Question ${thin + 1} needs at least two choices.`;
  const file = f.questions.findIndex(q => q.type === 'file');
  if (f.anonymous && file >= 0) return `Question ${file + 1} asks for a file, and an anonymous form can’t take one. Change the question or turn anonymous off.`;
  return '';
}

/* ── Open, closed, closing ─────────────────────────────────────── */
function formIsOpen(form, now = Date.now()) { return !!form && form.status === 'open' && (!form.closesAt || now < form.closesAt); }
// 'draft' | 'open' | 'closed'. A form past its closing time reads closed
// even though nobody flipped it.
function formPhase(form, now = Date.now()) { return !form || form.status === 'draft' ? 'draft' : formIsOpen(form, now) ? 'open' : 'closed'; }
// A closing day is stored as the last millisecond of that day, local time.
function formClosesAtFromDate(dateIso) {
  if (!FORM_DATE.test(dateIso || '')) return null;
  const [y, m, d] = dateIso.split('-').map(Number);
  const t = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
  return isFinite(t) ? t : null;
}
function formClosesDate(form) {
  if (!form?.closesAt) return '';
  const d = new Date(form.closesAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function formClosesLabel(form, now = Date.now()) {
  if (!form?.closesAt) return '';
  const d = new Date(form.closesAt);
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return now < form.closesAt ? `Closes ${day}` : `Closed ${day}`;
}

/* ── Answers ───────────────────────────────────────────────────── */
function formAnswerEmpty(v) { return v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) ? !v.length : typeof v === 'object' && !(typeof v.name === 'string' && v.name.trim())); }
// A file answer as stored: its name, size and type. `url` only ever
// survives as a data: URL, which is how a sample or signed-out space (kept
// in memory, never uploaded) holds the file itself.
function formCleanFile(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const name = formStr(v.name, FORM_FILE_NAME_MAX).replace(/[\\/\u0000-\u001f]/g, '');
  const size = Number(v.size);
  if (!name || !(size > 0) || size > FORM_FILE_MAX_BYTES) return undefined;
  const type = typeof v.type === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(v.type) ? v.type.slice(0, 100) : '';
  // Never a page or a drawing that can carry script.
  const url = typeof v.url === 'string' && v.url.startsWith('data:') && !/^data:(text\/html|image\/svg\+xml|application\/xhtml)/i.test(v.url) ? v.url : '';
  return { name, size, type, ...(url ? { url } : {}) };
}
// One answer, cleaned against its question. Returns undefined when there
// is nothing usable, so a stale choice (the option was since renamed)
// simply isn't an answer.
function formCleanAnswer(q, v) {
  if (formAnswerEmpty(v)) return undefined;
  switch (q.type) {
    case 'short': { const s = formStr(String(v), FORM_SHORT_MAX); return s || undefined; }
    case 'long': { const s = formCleanText(String(v), FORM_LONG_MAX); return s || undefined; }
    case 'choice':
    case 'dropdown': return typeof v === 'string' && q.options.includes(v) ? v : undefined;
    case 'checks': { const list = [...new Set((Array.isArray(v) ? v : [v]).filter(x => typeof x === 'string' && q.options.includes(x)))]; return list.length ? list : undefined; }
    case 'scale': { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 5 ? n : undefined; }
    case 'date': return typeof v === 'string' && FORM_DATE.test(v) && !isNaN(new Date(v + 'T00:00:00')) ? v : undefined;
    case 'file': return formCleanFile(v);
    default: return undefined;
  }
}
// -> { ok, answers, errors: { [question id]: message }, first }
function formCheckAnswers(form, raw) {
  const answers = {}, errors = {};
  (form?.questions || []).forEach(q => {
    const given = raw ? raw[q.id] : undefined;
    const v = formCleanAnswer(q, given);
    if (v !== undefined) { answers[q.id] = v; return; }
    if (!formAnswerEmpty(given)) errors[q.id] = q.type === 'date' ? 'Pick a day from the calendar.' : q.type === 'file' ? (Number(given.size) > FORM_FILE_MAX_BYTES ? 'That file is over 10 MB. Pick a smaller one.' : 'That file couldn’t be read. Pick it again.') : 'That answer didn’t fit. Try again.';
    else if (q.required) errors[q.id] = 'This one needs an answer.';
  });
  const first = (form?.questions || []).find(q => errors[q.id])?.id || '';
  return { ok: !first, answers, errors, first };
}
// A stored answer document, as untrusted data.
function formCleanResponse(form, raw, id) {
  if (!raw || typeof raw !== 'object') return null;
  const anon = raw.anon === true;
  // An anonymous answer has no uid; the id it was filed under stands in
  // for one, so the page can tell answers apart.
  const uidOf = !anon && typeof raw.uid === 'string' && FORM_ID.test(raw.uid) ? raw.uid : (FORM_ID.test(id || '') ? id : '');
  if (!uidOf) return null;
  const answers = {};
  (form?.questions || []).forEach(q => { const v = formCleanAnswer(q, raw.answers ? raw.answers[q.id] : undefined); if (v !== undefined) answers[q.id] = v; });
  return {
    uid: uidOf,
    anon,
    name: anon ? 'Anonymous' : formStr(raw.name, 80) || 'Someone',
    email: !anon && typeof raw.email === 'string' && /^\S+@\S+$/.test(raw.email) ? raw.email.slice(0, 200) : '',
    member: !anon && raw.member === true,
    answers,
    at: Number(raw.at) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
  };
}
function formAnswerText(q, v) {
  if (formAnswerEmpty(v)) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (q.type === 'file') return v.name;
  if (q.type === 'scale') return `${v} of 5`;
  if (q.type === 'date') { const d = new Date(v + 'T00:00:00'); return isNaN(d) ? String(v) : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); }
  return String(v);
}

/* ── Results ───────────────────────────────────────────────────── */
// One entry per question:
//   { q, answered, kind: 'counts', rows: [{ label, count, pct }] }
//   { q, answered, kind: 'scale', avg, rows: [{ label: '1'..'5', count, pct }] }
//   { q, answered, kind: 'text', answers: [{ uid, name, text, at }] }
//   { q, answered, kind: 'files', answers: [{ uid, name, text (the file's name), size, at }] }
// pct is of the people who answered that question, so the bars of a
// pick-one question add up to 100.
function formSummary(form, responses) {
  const list = responses || [];
  return (form?.questions || []).map(q => {
    const given = list.filter(r => !formAnswerEmpty(r.answers[q.id]));
    const answered = given.length;
    const pct = (n) => answered ? Math.round((n / answered) * 100) : 0;
    if (formHasOptions(q.type)) {
      const rows = q.options.map(label => { const count = given.filter(r => [].concat(r.answers[q.id]).includes(label)).length; return { label, count, pct: pct(count) }; });
      return { q, answered, kind: 'counts', rows };
    }
    if (q.type === 'scale') {
      const rows = [1, 2, 3, 4, 5].map(n => { const count = given.filter(r => r.answers[q.id] === n).length; return { label: String(n), count, pct: pct(count) }; });
      const avg = answered ? Math.round((given.reduce((s, r) => s + r.answers[q.id], 0) / answered) * 10) / 10 : 0;
      return { q, answered, kind: 'scale', avg, rows };
    }
    return { q, answered, kind: q.type === 'file' ? 'files' : 'text', answers: given.map(r => ({ uid: r.uid, name: r.name, text: formAnswerText(q, r.answers[q.id]), at: r.at, ...(q.type === 'file' ? { size: r.answers[q.id].size } : {}) })).sort((a, b) => b.at - a.at || a.uid.localeCompare(b.uid)) };
  });
}
// A spreadsheet runs a cell that starts with = + - or @ as a formula, and
// these cells were typed by whoever filled the form in. A leading
// apostrophe makes the spreadsheet show the text instead of running it.
function formCsvSafe(v) { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; }
// marks: { [uid]: 'accepted' | 'waitlisted' | 'declined' }, for a form that sorts its answers.
function formMarkLabel(status) { return (FORM_MARKS.find(m => m[0] === status) || [0, ''])[1]; }
function formCsvRows(form, responses, marks = {}) {
  const qs = form?.questions || [];
  const anon = !!form?.anonymous;
  const head = [...(anon ? ['Answer'] : ['Name', ...(form?.collectEmail ? ['Email'] : []), 'Member']), ...(form?.review ? ['Status'] : []), 'Sent', ...qs.map((q, i) => q.label || `Question ${i + 1}`)];
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = (ms) => { if (!ms) return ''; const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}${anon ? '' : ` ${pad(d.getHours())}:${pad(d.getMinutes())}`}`; };
  // Anonymous answers are listed by the id they were filed under, never in
  // the order they arrived.
  const sorted = [...(responses || [])].sort(anon ? (a, b) => a.uid.localeCompare(b.uid) : (a, b) => a.at - b.at);
  const rows = sorted.map((r, i) => [
    ...(anon ? [`Answer ${i + 1}`] : [r.name, ...(form?.collectEmail ? [r.email] : []), r.member ? 'Yes' : 'No']),
    ...(form?.review ? [formMarkLabel(marks[r.uid])] : []),
    stamp(r.updatedAt || r.at),
    ...qs.map(q => { const v = r.answers[q.id]; return formAnswerEmpty(v) ? '' : Array.isArray(v) ? v.join('; ') : q.type === 'date' ? v : q.type === 'file' ? v.name : String(v); }),
  ]);
  return [head, ...rows].map(r => r.map(formCsvSafe));
}

/* ── Links ─────────────────────────────────────────────────────── */
// form.html?f=c.ABC123.formid  (c = club, g = study group)
function formToken(kind, code, id) { return `${kind === 'group' ? 'g' : 'c'}.${code}.${id}`; }
function formParseToken(token) {
  const m = FORM_TOKEN.exec(String(token || ''));
  return m ? { kind: m[1] === 'g' ? 'group' : 'club', collection: m[1] === 'g' ? 'studyGroups' : 'orgs', code: m[2], id: m[3] } : null;
}
function formCollection(kind) { return kind === 'group' ? 'studyGroups' : 'orgs'; }
// The id of the person's own record of an answer (planners/{uid}/formAnswers).
// firestore.rules builds the same string.
function formAnswerKey(kind, code, id) { return `${formCollection(kind)}_${code}_${id}`; }
// Where a file sent as an answer lives in Storage: one per question, under
// the sender's uid. storage.rules matches the same shape.
function formFilePath(kind, code, id, uid, questionId) { return `${formCollection(kind)}/${code}/forms/${id}/${uid}/${questionId}`; }

/* ── Starting points ───────────────────────────────────────────── */
// [key, name, one line, icon, kinds it suits, audience, questions]
// A question here is [type, label, required, options or help].
const FORM_YEARS = ['First year', 'Sophomore', 'Junior', 'Senior', 'Grad student'];
const FORM_TEMPLATES = [
  { key: 'blank', name: 'Blank form', line: 'Start from nothing', icon: 'plus', kinds: ['club', 'group'], audience: 'members', questions: [] },
  { key: 'interest', name: 'Interest form', line: 'For the club fair table and your bio link', icon: 'user-plus', kinds: ['club'], audience: 'link', title: 'Interested in joining?',
    description: 'Tell us a little about you and we’ll be in touch about our next meeting.',
    questions: [['dropdown', 'What year are you?', true, FORM_YEARS], ['short', 'What’s your major?', false], ['checks', 'What are you most interested in?', false, ['Events', 'Leadership', 'Volunteering', 'Meeting people']], ['choice', 'How did you hear about us?', false, ['Club fair', 'A friend', 'Instagram', 'A class', 'Somewhere else']], ['long', 'Anything you’d like us to know?', false]] },
  { key: 'application', name: 'Membership application', line: 'Questions and a closing date', icon: 'clipboard-list', kinds: ['club'], audience: 'link', title: 'Membership application',
    description: 'Thanks for applying. Answer in your own words; there are no wrong answers.',
    review: true,
    questions: [['dropdown', 'What year are you?', true, FORM_YEARS], ['short', 'What’s your major?', true], ['long', 'Why do you want to join?', true], ['long', 'What would you bring to the group?', false], ['choice', 'Can you make our weekly meetings?', true, ['Yes', 'Most weeks', 'Not this semester']], ['short', 'What else are you involved in this semester?', false], ['file', 'Your résumé', false, 'Optional. A PDF or a document, up to 10 MB']] },
  { key: 'signup', name: 'Event sign-up', line: 'Who’s coming, rides, food', icon: 'calendar', kinds: ['club', 'group'], audience: 'members', title: 'Event sign-up',
    description: '',
    questions: [['choice', 'Are you coming?', true, ['Yes', 'Maybe', 'Can’t make it']], ['choice', 'How are you getting there?', false, ['I can drive others', 'I need a ride', 'I’m all set']], ['short', 'Any food allergies or dietary needs?', false]] },
  { key: 'order', name: 'Shirt order', line: 'Sizes for the whole roster', icon: 'list', kinds: ['club'], audience: 'members', title: 'Shirt order',
    description: '',
    questions: [['dropdown', 'What size?', true, ['XS', 'S', 'M', 'L', 'XL', 'XXL']], ['short', 'Name on the back', false, 'Leave blank for none']] },
  { key: 'feedback', name: 'Feedback', line: 'How did it go?', icon: 'message-circle', kinds: ['club', 'group'], audience: 'members', title: 'How did it go?',
    description: 'Two minutes, and it changes what we do next time.',
    questions: [['scale', 'How was it overall?', true, '1 is rough, 5 is great'], ['long', 'What worked?', false], ['long', 'What should we change?', false]] },
  { key: 'suggestions', name: 'Suggestion box', line: 'Anonymous, so people say what they think', icon: 'lock', kinds: ['club', 'group'], audience: 'members', title: 'Suggestion box',
    description: 'Tell us what you really think. This form is anonymous.',
    anonymous: true,
    questions: [['choice', 'What is this about?', false, ['Meetings', 'Events', 'How we’re run', 'Something else']], ['long', 'What should we do differently?', true]] },
  { key: 'study', name: 'Study check-in', line: 'What to cover and how', icon: 'book-open', kinds: ['group'], audience: 'members', title: 'Before our next session',
    description: '',
    questions: [['long', 'Which topics feel shaky?', true], ['checks', 'How do you like to study?', false, ['Practice problems', 'Teaching each other', 'Quiet work together', 'Flashcards']], ['choice', 'How long should we go?', false, ['An hour', '90 minutes', 'Two hours']]] },
];
function formTemplatesFor(kind) { return FORM_TEMPLATES.filter(t => t.kinds.includes(kind === 'group' ? 'group' : 'club')); }
function formNewQuestion(type = 'short') {
  return { id: uid(), type: FORM_TYPES.some(t => t[0] === type) ? type : 'short', label: '', help: '', required: false, options: formHasOptions(type) ? ['', ''] : [] };
}
// A new draft from a template. The caller adds who made it and the space.
function formFromTemplate(key) {
  const t = FORM_TEMPLATES.find(x => x.key === key) || FORM_TEMPLATES[0];
  return {
    v: 1, id: uid(), title: t.title || '', description: t.description || '', status: 'draft',
    audience: t.audience, collectEmail: t.audience === 'link' && !t.anonymous, allowEdit: true, closesAt: null,
    review: !!t.review && !t.anonymous, anonymous: !!t.anonymous,
    questions: t.questions.map(([type, label, required, extra]) => ({ id: uid(), type, label, help: typeof extra === 'string' ? extra : '', required: !!required, options: Array.isArray(extra) ? [...extra] : [] })),
  };
}
