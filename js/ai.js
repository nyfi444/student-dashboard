/* ── AI layer: Claude API calls for syllabus & assignment parsing ──
   Calls go through a Cloudflare Worker proxy (see /worker) that holds
   the real Anthropic API key server-side, so students never see or
   supply their own key. WORKER_URL is set in js/config.js; without it,
   AI features show as unavailable rather than erroring.
──────────────────────────────────────────────────────────────── */
const AI_PROXY_URL = WORKER_URL ? `${WORKER_URL}/v1/messages` : '';

function aiEnabled() { return !!AI_PROXY_URL; }

/* ── Plus-only gate ──────────────────────────────────────────────
   Every AI request costs money, so AI features only run for a signed-in
   Semester HQ Plus account, never in the demo: no account, or the copy
   embedded on the marketing site. The Worker enforces the same rule
   server-side; this keeps the demo from opening a flow that can't finish.
   Buttons still show (with a lock) so the demo shows what Plus includes. */
function aiUnlocked() { return aiEnabled() && !isEmbedded() && !!_fbUser && !!window._licensed; }
function licensedDeviceFlag() { try { return localStorage.getItem(LICENSE_DEVICE_FLAG) === '1'; } catch { return false; } }
// A returning subscriber's account is still being checked for a moment
// after the app opens; don't flash locks at them in the meantime.
function aiLooksUnlocked() { return aiUnlocked() || (aiEnabled() && !isEmbedded() && !window._licenseChecked && licensedDeviceFlag()); }
// Call first in anything that uses AI. `what` names the feature in the
// explanation: "Quick capture is part of Semester HQ Plus…".
function requireAi(what) {
  if (aiUnlocked()) return true;
  if (!aiEnabled()) { toast('This isn’t set up on this deployment yet.', 'info'); return false; }
  if (aiLooksUnlocked()) { toast('One moment, still checking your account…', 'info'); return false; }
  openPlusOnlyModal(what);
  return false;
}
// For something opened straight from a link or the share sheet as the app
// loads: waits (up to 10s) for the account check so requireAi sees the answer.
function whenAccountChecked(fn, waited = 0) {
  if (window._licenseChecked || !fbConfigured() || waited >= 10000) { fn(); return; }
  setTimeout(() => whenAccountChecked(fn, waited + 250), 250);
}
function openPlusOnlyModal(what) {
  const cta = isEmbedded()
    ? `<a class="btn btn-primary" href="https://semester-hq.com/pricing.html" target="_top">See Semester HQ Plus</a>`
    : _fbUser ? `<button class="btn btn-primary" onclick="closeModal();redirectToCheckout()">Subscribe</button>`
    : `<a class="btn btn-primary" href="login.html">Log in or sign up</a>`;
  openModal(`
    <div class="modal-head"><h3>Included with Semester HQ Plus</h3><button class="close-x" aria-label="Close" onclick="closeModal()">${icon('x', 13, 2.2)}</button></div>
    <div class="modal-body">
      <div class="plus-lock" aria-hidden="true">${icon('lock', 18, 1.8)}</div>
      <p style="font-size:14px">${esc(what)} is part of Semester HQ Plus, so it doesn’t run in the demo.</p>
      <p class="small muted mt-8">Everything else works, so you can still add classes, assignments, and flashcards by hand. Plus is $7.99/month and also saves your semester and syncs it across your devices.</p>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Not now</button>${cta}</div>
  `);
}

class AiError extends Error {}

/* ── Models ───────────────────────────────────────────────────────
   Sonnet 5 reads a normal syllabus well and costs $2/$10 per million
   tokens in/out — a third less than the Sonnet 4.6 this used to run on,
   on a newer model. Opus 5 is 2.5x the price and is used for exactly one
   thing: a scan or photo with no extractable text, where the structure
   has to be inferred from the page layout. A well-formatted PDF does not
   pay for it. The Worker keeps the same allowlist (ALLOWED_MODELS).
──────────────────────────────────────────────────────────────── */
const AI_MODEL_DEFAULT = 'claude-sonnet-5';
const AI_MODEL_HARD = 'claude-opus-5';
// Structured outputs (output_config.format) exist on these; a student whose
// stored settings still name an older model gets the old text-parsing path
// rather than a 400. Remove claude-sonnet-4-6 from settings a release from now.
const AI_STRUCTURED_MODELS = ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5'];
function aiModel() {
  const stored = state?.settings?.aiModel;
  return stored || AI_MODEL_DEFAULT;
}
// Usage from the last call, so the syllabus telemetry can report whether the
// cached system prompt is actually being read (see SYLLABUS_SYSTEM below).
let _lastAiUsage = null;

// `feature` names which feature is asking ('syllabus', 'flashcards', …) so
// the Worker can say what each one costs (worker/src/usage.js). It is only a
// label: the Worker never forwards it to Anthropic, and counts anything it
// doesn't know as 'untagged'.
// maxTokens is room for thinking and the answer together: Sonnet 5 thinks
// first, so a small budget can be spent before any answer is written. The
// Worker caps it at 12000 (worker/src/ai.js).
async function callClaude({ system, userContent, maxTokens = 4000, schema = null, model = aiModel(), feature = '' }) {
  if (!aiEnabled()) throw new AiError('AI features aren’t set up on this deployment yet.');
  if (isEmbedded()) throw new AiError('This is part of Semester HQ Plus, so it doesn’t run in the demo.');
  if (!navigator.onLine) throw new AiError('You’re offline. This needs an internet connection.');
  // AI upload is part of the paid subscription, not the free local tier, see
  // checkout.js. This client-side check just avoids a wasted round trip and
  // gives a clear message; the Worker enforces the real gate server-side.
  if (!_fbUser) throw new AiError('Sign in to use AI upload. It’s included with your subscription ($7.99/month).');
  if (!window._licensed) throw new AiError('AI upload requires a subscription ($7.99/month). Subscribe from the pricing page, then sign in.');
  const idToken = await _fbUser.getIdToken();
  // The system prompt is long, identical on every call of its kind, and would
  // otherwise be re-billed in full each time. The cache_control breakpoint at
  // the end of it makes every upload after the first within the cache window
  // read it instead. Nothing volatile may go in front of it (no timestamps,
  // no per-student text) or the prefix stops matching and the cache silently
  // never hits — diag reports that, see aiParseSyllabus.
  const systemBlocks = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
  const useSchema = schema && AI_STRUCTURED_MODELS.includes(model);
  const res = await fetch(AI_PROXY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemBlocks,
      messages: [{ role: 'user', content: userContent }],
      // Constrains the reply to conforming JSON, so there is nothing to hunt
      // for in prose afterwards. Without it (an older stored model), the
      // caller falls back to extractJson.
      ...(useSchema ? { output_config: { format: { type: 'json_schema', schema } } } : {}),
      ...(feature ? { feature } : {}),
      idToken,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let message = '';
    try { message = JSON.parse(body).error || ''; } catch {}
    if (res.status < 500 && ![401, 402, 413, 429].includes(res.status)) diag.error('ai', `AI request failed (${res.status})`, null, { status: res.status, model, images: Array.isArray(userContent) });
    // 402 (no subscription), 413 (too much to read) and 429 (out of reads for
    // today, or everyone setting up at once) all come back from the Worker
    // with a sentence written for a student. Show that, not a status code.
    if (message && [402, 413, 429].includes(res.status)) throw new AiError(message);
    throw new AiError(message || `AI request failed (${res.status}). ${body.slice(0, 160)}`);
  }
  const json = await res.json();
  // The Worker streams from Claude and answers straight away, so a failure
  // partway through comes back in the body rather than as a status.
  if (json.type === 'error') {
    diag.warn('ai', 'AI reply stopped partway', null, { model, type: String(json.error?.type || '') });
    throw new AiError('Something interrupted the read. Try again in a moment.');
  }
  _lastAiUsage = json.usage || null;
  const cut = json.stop_reason === 'max_tokens';
  if (cut) diag.warn('ai', 'AI reply hit the token cap', null, { model, feature });
  const text = (json.content || []).filter(b => b.type === 'text' || b.text).map(b => b.text || '').join('\n').trim();
  if (!useSchema) return text;
  // A constrained reply is already conforming JSON; extractJson is only here
  // for the refusal/truncation edge. A reply cut off for room can't be read,
  // and saying so beats a JSON error the student can do nothing with.
  try { return JSON.parse(text); } catch (e) {
    if (cut) throw new AiError('That was too much to read in one go. Try a shorter file, or upload it in parts.');
    return extractJson(text);
  }
}

function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf('{') >= 0 && (raw.indexOf('{') < raw.indexOf('[') || raw.indexOf('[') === -1) ? raw.indexOf('{') : raw.indexOf('[');
  const endChar = raw[start] === '{' ? '}' : ']';
  const end = raw.lastIndexOf(endChar);
  const slice = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  try { return JSON.parse(slice); }
  // The parser's message quotes the reply, which comes from the student's document, so it isn't sent.
  catch (e) { diag.warn('ai', 'AI reply wasn’t valid JSON', null, { length: text.length }); throw e; }
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function extractPdfText(file) {
  await ensurePdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await openPdf(buf);
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(it => it.str).join(' ') + '\n';
  }
  return text.trim();
}

// Renders each PDF page to an actual page image (instead of just pulling text out)
// so an upload looks like the real document: figures, handwriting, layout and
// all, not a stripped-down text reflow. Capped in page count/resolution/quality
// since every image is stored inline as a data URL alongside the rest of the
// planner (see FIRESTORE_DOC_SAFE_BYTES in firebase.js).
async function extractPdfPageImages(file, { scale = 1.3, quality = 0.78, maxPages = 20 } = {}) {
  await ensurePdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await openPdf(buf);
  const pageCount = Math.min(pdf.numPages, maxPages);
  const images = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(canvas.toDataURL('image/jpeg', quality));
  }
  return { images, totalPages: pdf.numPages, truncated: pdf.numPages > pageCount };
}

const SYLLABUS_SYSTEM = `You extract structured course information from a syllabus. Reply with ONLY a JSON object (no prose, no markdown fences) matching this shape:
{
  "name": string, "code": string, "instructor": string, "location": string, "credits": number|null,
  "meetings": [{"day": 0-6 (0=Sun), "start": "HH:MM", "end": "HH:MM"}],
  "assignments": [{"title": string, "type": "assignment"|"reading"|"discussion"|"quiz"|"exam"|"project"|"paper"|"lab", "dueDate": "YYYY-MM-DD or empty string if unknown", "dueTime": "HH:MM or empty string", "maxPoints": number|null}],
  "details": {
    "email": string, "phone": string, "office": string,
    "officeHours": [{"day": 0-6, "start": "HH:MM", "end": "HH:MM", "where": string}],
    "officeHoursNote": string (for example "or by appointment", or office hours that don't have fixed times),
    "tas": [{"name": string, "email": string, "officeHours": string}],
    "absenceLimit": number|null (how many absences are allowed before it starts to count against you, only if the syllabus gives a number),
    "absencePolicy": string (one or two plain sentences),
    "latePolicy": string (one or two plain sentences on late work and extensions),
    "policies": [{"title": string, "text": string}] (up to 5 other rules a student would want to know: missed exams, makeup work, AI use, collaboration, devices in class),
    "website": string (course website URL if one is given),
    "textbook": string
  }
}
Infer the current or nearest upcoming year for dates when the syllabus only gives month/day. If a field is unknown, use an empty string, null, or empty array. Do not invent assignments, office hours, or policies that aren't in the syllabus. Keep policy summaries short and in plain language. Do not extract grading weights or grade scales.`;

/* ── The shape, as a contract instead of a hope ────────────────────
   This is sanitizeCourseDetails() in js/syllabus.js written out formally,
   and it is passed to the model as output_config.format, so the reply is
   constrained to conform rather than asked nicely to. That removes the
   whole class of "syllabus upload failed" that came from a model wrapping
   its JSON in a sentence — which happened at the single most important
   moment in the product. Keep this in step with sanitizeCourseDetails:
   the sanitizer is still the boundary that decides what gets stored.
   Structured outputs don't take minimum/maximum or minLength/maxLength,
   and every object needs additionalProperties:false and a full `required`. */
const NULLABLE_NUMBER = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const ASSIGNMENT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    type: { type: 'string', enum: ['assignment', 'reading', 'discussion', 'quiz', 'exam', 'project', 'paper', 'lab'] },
    dueDate: { type: 'string', description: 'YYYY-MM-DD, or an empty string if the document does not say' },
    dueTime: { type: 'string', description: 'HH:MM in 24-hour time, or an empty string' },
    maxPoints: NULLABLE_NUMBER,
  },
  required: ['title', 'type', 'dueDate', 'dueTime', 'maxPoints'],
  additionalProperties: false,
};
const HOURS_SCHEMA = {
  type: 'object',
  properties: {
    day: { type: 'integer', description: '0 = Sunday through 6 = Saturday' },
    start: { type: 'string', description: 'HH:MM' },
    end: { type: 'string', description: 'HH:MM' },
    where: { type: 'string' },
  },
  required: ['day', 'start', 'end', 'where'],
  additionalProperties: false,
};
const SYLLABUS_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    code: { type: 'string' },
    instructor: { type: 'string' },
    location: { type: 'string' },
    credits: NULLABLE_NUMBER,
    meetings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { day: { type: 'integer' }, start: { type: 'string' }, end: { type: 'string' } },
        required: ['day', 'start', 'end'],
        additionalProperties: false,
      },
    },
    assignments: { type: 'array', items: ASSIGNMENT_SCHEMA },
    details: {
      type: 'object',
      properties: {
        email: { type: 'string' }, phone: { type: 'string' }, office: { type: 'string' },
        officeHours: { type: 'array', items: HOURS_SCHEMA },
        officeHoursNote: { type: 'string' },
        tas: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, email: { type: 'string' }, officeHours: { type: 'string' } },
            required: ['name', 'email', 'officeHours'],
            additionalProperties: false,
          },
        },
        absenceLimit: { anyOf: [{ type: 'integer' }, { type: 'null' }], description: 'Only if the syllabus gives a number' },
        absencePolicy: { type: 'string' },
        latePolicy: { type: 'string' },
        policies: {
          type: 'array',
          items: {
            type: 'object',
            properties: { title: { type: 'string' }, text: { type: 'string' } },
            required: ['title', 'text'],
            additionalProperties: false,
          },
        },
        website: { type: 'string' },
        textbook: { type: 'string' },
      },
      required: ['email', 'phone', 'office', 'officeHours', 'officeHoursNote', 'tas', 'absenceLimit', 'absencePolicy', 'latePolicy', 'policies', 'website', 'textbook'],
      additionalProperties: false,
    },
  },
  required: ['name', 'code', 'instructor', 'location', 'credits', 'meetings', 'assignments', 'details'],
  additionalProperties: false,
};
const ASSIGNMENTS_SCHEMA = {
  type: 'object',
  properties: { assignments: { type: 'array', items: ASSIGNMENT_SCHEMA } },
  required: ['assignments'],
  additionalProperties: false,
};

// `images` is an array of {base64, mediaType}: multiple photos of one syllabus
// (e.g. a multi-page handout shot page by page) get sent as one message so the
// model can read them together instead of parsing each page in isolation.
function imageBlocks(images) {
  return images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } }));
}

// An upload can bring both text and images (a Word doc plus photos, or a
// scan with a little text), so both go in the same message.
async function aiParseSyllabus({ text = '', images = [], fileType = '' } = {}) {
  const userContent = images.length
    ? [...imageBlocks(images), { type: 'text', text: `Extract the course info from this syllabus (across all pages/photos if more than one) as specified.${text ? `\n\nText from the same upload:\n${text.slice(0, 15000)}` : ''}` }]
    : `Here is the syllabus text:\n\n${text.slice(0, 15000)}`;
  // A scan or photo with no text at all is the hard case: nothing to read, so
  // the structure has to come from the layout of the page. That one gets the
  // better model. Anything with real text does not — it doesn't need it, and
  // Opus costs 2.5x as much.
  const scannedOnly = images.length > 0 && text.trim().length < 200;
  const model = scannedOnly && aiModel() === AI_MODEL_DEFAULT ? AI_MODEL_HARD : aiModel();
  const started = Date.now();
  const measure = { source: images.length ? 'upload' : 'text', fileType: fileType || (images.length ? 'image' : 'text'), model, images: images.length, chars: text.length };
  try {
    const data = await callClaude({ system: SYLLABUS_SYSTEM, userContent, maxTokens: 10000, schema: SYLLABUS_SCHEMA, model, feature: 'syllabus' });
    reportSyllabusRead({ ...measure, outcome: 'parsed', ms: Date.now() - started, assignments: (data?.assignments || []).length, meetings: (data?.meetings || []).length, details: courseDetailsCount(sanitizeCourseDetails(data?.details)) });
    return data;
  } catch (e) {
    reportSyllabusRead({ ...measure, outcome: 'failed', ms: Date.now() - started, reason: syllabusFailureReason(e) });
    throw e;
  }
}

/* ── Is the wedge working? ────────────────────────────────────────
   The syllabus read is the one thing the whole product rests on, so its
   failure rate is the reliability number that matters most, and it isn't
   knowable without measuring it. These two calls are that measurement.
   Only counts leave the browser — never a course name, a file name, or
   anything out of the document (the Worker allowlists the fields too).
──────────────────────────────────────────────────────────────── */
function syllabusFailureReason(e) {
  const m = String(e?.message || '').toLowerCase();
  if (m.includes('subscription') || m.includes('sign in')) return 'not-subscribed';
  if (m.includes('offline')) return 'offline';
  if (m.includes('too much') || m.includes('too large')) return 'too-big';
  if (m.includes('busy') || m.includes('reads for today')) return 'rate-limited';
  if (e instanceof SyntaxError || m.includes('json')) return 'bad-json';
  return 'error';
}
function reportSyllabusRead(detail) {
  const usage = _lastAiUsage || {};
  diag.event('syllabus_read', {
    ...detail,
    cacheRead: usage.cache_read_input_tokens || 0,
    cacheWrite: usage.cache_creation_input_tokens || 0,
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
  });
}
// Called once the student has looked at what came back and said yes. `offered`
// is what the parser found, `kept` what survived, `edited` what they corrected
// and `removed` what they deleted. The keep rate is the honest accuracy number:
// a high parse rate with a low keep rate means the parser is confidently wrong.
function reportSyllabusKept({ offered = 0, kept = 0, edited = 0, removed = 0 }) {
  diag.event('syllabus_kept', { offered, kept, edited, removed });
}

const ASSIGNMENTS_SYSTEM = `You extract a list of assignments/deadlines from a document (syllabus, assignment sheet, or course schedule). Reply with ONLY a JSON object (no prose, no markdown fences) matching this shape:
{"assignments": [{"title": string, "type": "assignment"|"reading"|"discussion"|"quiz"|"exam"|"project"|"paper"|"lab", "dueDate": "YYYY-MM-DD or empty string if unknown", "dueTime": "HH:MM or empty string", "maxPoints": number|null}]}
Infer the current or nearest upcoming year for dates when only month/day is given. Do not invent assignments that aren't mentioned in the document.`;

async function aiParseAssignments({ text = '', images = [] }) {
  const userContent = images.length
    ? [...imageBlocks(images), { type: 'text', text: `Extract the list of assignments/deadlines from these images (they may be multiple pages of one document) as specified.${text ? `\n\nText from the same upload:\n${text.slice(0, 15000)}` : ''}` }]
    : `Here is the document text:\n\n${text.slice(0, 15000)}`;
  const data = await callClaude({ system: ASSIGNMENTS_SYSTEM, userContent, maxTokens: 10000, schema: ASSIGNMENTS_SCHEMA, feature: 'assignments' });
  // Constrained replies come back as {assignments:[...]} because a JSON Schema
  // root has to be an object; the old prose path returned the bare array.
  return Array.isArray(data) ? data : (data?.assignments || []);
}
