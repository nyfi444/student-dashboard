/* ── AI layer — Claude API calls for syllabus parsing & study tools ─
   Calls the Anthropic API directly from the browser using a key the
   user pastes into Settings > AI (stored only in localStorage on
   this device). This is fine for a single-user personal tool but
   the key is visible in devtools — don't share this device/profile.
──────────────────────────────────────────────────────────────── */
const AI_ENDPOINT = 'https://api.anthropic.com/v1/messages';

function getApiKey() { return (state.settings.aiApiKey || '').trim(); }
function hasAiKey() { return !!getApiKey(); }

class AiError extends Error {}

async function callClaude({ system, userContent, maxTokens = 2000 }) {
  const key = getApiKey();
  if (!key) throw new AiError('Add your Claude API key in Settings → AI to use this feature.');
  const res = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: state.settings.aiModel || 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401) throw new AiError('That API key was rejected. Double-check it in Settings → AI.');
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

async function aiGenerateFlashcards(notesText, count = 10) {
  const system = `You turn study notes into flashcards. Reply with ONLY a JSON array (no prose, no markdown fences) of up to ${count} objects: [{"front": string, "back": string}]. Fronts should be concise questions or terms; backs should be concise answers.`;
  const raw = await callClaude({ system, userContent: `Notes:\n\n${notesText.slice(0, 12000)}`, maxTokens: 2500 });
  return extractJson(raw);
}

async function aiGenerateStudyGuide(notesText, courseName) {
  const system = `You write a clear, well-organized study guide from a student's notes for ${courseName || 'a course'}. Reply with ONLY HTML using <h2>, <h3>, <p>, <ul>/<li>, and <strong> tags (no markdown, no full document, no <html>/<body> tags) — this gets inserted directly into a notes editor. Organize by topic, bold key terms, keep it skimmable.`;
  return await callClaude({ system, userContent: `Notes:\n\n${notesText.slice(0, 14000)}`, maxTokens: 3000 });
}
