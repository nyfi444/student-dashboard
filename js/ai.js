/* ── AI layer: Claude API calls for syllabus & assignment parsing ──
   Calls go through a Cloudflare Worker proxy (see /worker) that holds
   the real Anthropic API key server-side, so students never see or
   supply their own key. Fill in AI_PROXY_URL with your deployed
   Worker's URL (see worker/README.md for deploy steps); until then,
   AI features show as unavailable rather than erroring.
──────────────────────────────────────────────────────────────── */
const AI_PROXY_URL = 'https://student-planner-ai-proxy.semesterhq.workers.dev/v1/messages';

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
    ? `<a class="btn btn-primary" href="https://semester-hq.com/#pricing" target="_top">See Semester HQ Plus</a>`
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

async function callClaude({ system, userContent, maxTokens = 2000 }) {
  if (!aiEnabled()) throw new AiError('AI features aren’t set up on this deployment yet.');
  if (isEmbedded()) throw new AiError('This is part of Semester HQ Plus, so it doesn’t run in the demo.');
  if (!navigator.onLine) throw new AiError('You’re offline. This needs an internet connection.');
  // AI upload is part of the paid subscription, not the free local tier, see
  // checkout.js. This client-side check just avoids a wasted round trip and
  // gives a clear message; the Worker enforces the real gate server-side.
  if (!_fbUser) throw new AiError('Sign in to use AI upload. It’s included with your subscription ($7.99/month).');
  if (!window._licensed) throw new AiError('AI upload requires a subscription ($7.99/month). Subscribe from the pricing page, then sign in.');
  const idToken = await _fbUser.getIdToken();
  const res = await fetch(AI_PROXY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: state.settings.aiModel || 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userContent }],
      idToken,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AiError(`AI request failed (${res.status}). ${body.slice(0, 160)}`);
  }
  const json = await res.json();
  return (json.content || []).map(b => b.text || '').join('\n').trim();
}

function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf('{') >= 0 && (raw.indexOf('{') < raw.indexOf('[') || raw.indexOf('[') === -1) ? raw.indexOf('{') : raw.indexOf('[');
  const endChar = raw[start] === '{' ? '}' : ']';
  const end = raw.lastIndexOf(endChar);
  const slice = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  return JSON.parse(slice);
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
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
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
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
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

// Study material uploaded to make flashcards from: text from a PDF, Word doc,
// PowerPoint, or text file, or page images when there's no text to pull (a
// photo of notes, a scanned PDF). Up to 8 files at once, like several photos.
const STUDY_MATERIAL_ACCEPT = '.pdf,.docx,.pptx,.txt,.md,image/*';
async function readStudyMaterial(fileList) {
  const images = [];
  let text = '';
  for (const file of Array.from(fileList || []).slice(0, 8)) {
    const ext = fileExt(file.name);
    if (/^image\//.test(file.type) || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'].includes(ext)) {
      const dataUrl = await downscaleImage(file, 1600, 0.82);
      if (!dataUrl) throw new Error(`Couldn’t open ${file.name}. Try a JPG or PNG photo.`);
      images.push({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' });
    } else if (ext === 'pdf' || file.type === 'application/pdf') {
      const pdfText = await withTimeout(extractPdfText(file), 30000, 'Timed out reading that PDF').catch(() => '');
      if (pdfText.trim().length > 200) text += `\n\n${pdfText}`;
      else (await withTimeout(extractPdfPageImages(file, { maxPages: 6 }), 30000, 'Timed out reading that PDF')).images.forEach(src => images.push({ base64: src.split(',')[1], mediaType: 'image/jpeg' }));
    } else if (ext === 'docx') text += `\n\n${await docxText(file)}`;
    else if (ext === 'pptx') text += `\n\n${await pptxText(file)}`;
    else if (['txt', 'md', 'csv', 'tsv'].includes(ext) || /^text\//.test(file.type)) text += `\n\n${await file.text()}`;
    else if (['doc', 'ppt', 'pages', 'key', 'rtf', 'odt'].includes(ext)) throw new Error(`Semester HQ can’t read .${ext} files. Save it as a PDF and upload that.`);
    else throw new Error(`Semester HQ can’t read ${file.name}. Try a PDF, Word doc, PowerPoint, or photo.`);
  }
  text = text.trim();
  if (!text && !images.length) throw new Error('Couldn’t find anything to read in that file.');
  return { text, images: images.slice(0, 8) };
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

// `images` is an array of {base64, mediaType}: multiple photos of one syllabus
// (e.g. a multi-page handout shot page by page) get sent as one message so the
// model can read them together instead of parsing each page in isolation.
function imageBlocks(images) {
  return images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } }));
}

async function aiParseSyllabus({ text, images }) {
  const userContent = images && images.length
    ? [...imageBlocks(images), { type: 'text', text: 'Extract the course info from this syllabus (across all pages/photos if more than one) as specified.' }]
    : `Here is the syllabus text:\n\n${text.slice(0, 15000)}`;
  const raw = await callClaude({ system: SYLLABUS_SYSTEM, userContent, maxTokens: 3000 });
  return extractJson(raw);
}

const ASSIGNMENTS_SYSTEM = `You extract a list of assignments/deadlines from a document (syllabus, assignment sheet, or course schedule). Reply with ONLY a JSON array (no prose, no markdown fences) of objects matching this shape:
[{"title": string, "type": "assignment"|"reading"|"discussion"|"quiz"|"exam"|"project"|"paper"|"lab", "dueDate": "YYYY-MM-DD or empty string if unknown", "dueTime": "HH:MM or empty string", "maxPoints": number|null}]
Infer the current or nearest upcoming year for dates when only month/day is given. Do not invent assignments that aren't mentioned in the document.`;

async function aiParseAssignments({ text, images }) {
  const userContent = images && images.length
    ? [...imageBlocks(images), { type: 'text', text: 'Extract the list of assignments/deadlines from these images (they may be multiple pages of one document) as specified.' }]
    : `Here is the document text:\n\n${text.slice(0, 15000)}`;
  const raw = await callClaude({ system: ASSIGNMENTS_SYSTEM, userContent, maxTokens: 3000 });
  return extractJson(raw);
}
