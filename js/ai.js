/* ── AI layer — Claude API calls for syllabus & assignment parsing ──
   Calls go through a Cloudflare Worker proxy (see /worker) that holds
   the real Anthropic API key server-side, so students never see or
   supply their own key. Fill in AI_PROXY_URL with your deployed
   Worker's URL (see worker/README.md for deploy steps) — until then,
   AI features show as unavailable rather than erroring.
──────────────────────────────────────────────────────────────── */
const AI_PROXY_URL = 'https://student-planner-ai-proxy.semesterhq.workers.dev/v1/messages';

function aiEnabled() { return !!AI_PROXY_URL; }

class AiError extends Error {}

async function callClaude({ system, userContent, maxTokens = 2000 }) {
  if (!aiEnabled()) throw new AiError('AI features aren’t set up on this deployment yet.');
  // AI upload is part of paid Founding Access, not the free local tier — see
  // checkout.js. This client-side check just avoids a wasted round trip and
  // gives a clear message; the Worker enforces the real gate server-side.
  if (!_fbUser) throw new AiError('Sign in to use AI upload — it’s included with Founding Access ($19, one time).');
  if (!window._licensed) throw new AiError('AI upload is part of Founding Access ($19, one time). Claim it from the pricing page, then sign in.');
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

const SYLLABUS_SYSTEM = `You extract structured course information from a syllabus. Reply with ONLY a JSON object (no prose, no markdown fences) matching this shape:
{
  "name": string, "code": string, "instructor": string, "location": string, "credits": number|null,
  "meetings": [{"day": 0-6 (0=Sun), "start": "HH:MM", "end": "HH:MM"}],
  "gradingBreakdown": [{"name": string, "weight": number}],
  "assignments": [{"title": string, "type": "assignment"|"reading"|"discussion"|"quiz"|"exam"|"project"|"paper"|"lab", "dueDate": "YYYY-MM-DD or empty string if unknown", "dueTime": "HH:MM or empty string", "maxPoints": number|null}]
}
Infer the current or nearest upcoming year for dates when the syllabus only gives month/day. If a field is unknown, use an empty string, null, or empty array. Do not invent assignments that aren't mentioned.`;

async function aiParseSyllabus({ text, imageBase64, mediaType }) {
  const userContent = imageBase64
    ? [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } }, { type: 'text', text: 'Extract the course info from this syllabus image as specified.' }]
    : `Here is the syllabus text:\n\n${text.slice(0, 15000)}`;
  const raw = await callClaude({ system: SYLLABUS_SYSTEM, userContent, maxTokens: 3000 });
  return extractJson(raw);
}

const ASSIGNMENTS_SYSTEM = `You extract a list of assignments/deadlines from a document (syllabus, assignment sheet, or course schedule). Reply with ONLY a JSON array (no prose, no markdown fences) of objects matching this shape:
[{"title": string, "type": "assignment"|"reading"|"discussion"|"quiz"|"exam"|"project"|"paper"|"lab", "dueDate": "YYYY-MM-DD or empty string if unknown", "dueTime": "HH:MM or empty string", "maxPoints": number|null}]
Infer the current or nearest upcoming year for dates when only month/day is given. Do not invent assignments that aren't mentioned in the document.`;

async function aiParseAssignments({ text, imageBase64, mediaType }) {
  const userContent = imageBase64
    ? [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } }, { type: 'text', text: 'Extract the list of assignments/deadlines from this image as specified.' }]
    : `Here is the document text:\n\n${text.slice(0, 15000)}`;
  const raw = await callClaude({ system: ASSIGNMENTS_SYSTEM, userContent, maxTokens: 3000 });
  return extractJson(raw);
}
