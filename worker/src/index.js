/* ── Student Planner AI proxy ─────────────────────────────────────
   Sits between the static planner (browser) and the Anthropic API.
   Holds ANTHROPIC_API_KEY as a Worker secret so it never reaches the
   browser. The client only ever calls this Worker's /v1/messages
   route with a plain JSON body (model, max_tokens, system, messages)
   and no API key of its own.
──────────────────────────────────────────────────────────────── */

const ALLOWED_MODELS = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
const MAX_TOKENS_CAP = 4000;
const ANTHROPIC_VERSION = '2023-06-01';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(env) });
    if (request.method !== 'POST') return jsonError('Method not allowed', 405, env);

    const url = new URL(request.url);
    if (url.pathname !== '/v1/messages') return jsonError('Not found', 404, env);

    if (!env.ANTHROPIC_API_KEY) return jsonError('Server misconfigured: ANTHROPIC_API_KEY secret not set.', 500, env);

    let body;
    try { body = await request.json(); } catch { return jsonError('Invalid JSON body', 400, env); }

    if (!ALLOWED_MODELS.includes(body.model)) return jsonError(`Model not allowed. Use one of: ${ALLOWED_MODELS.join(', ')}`, 400, env);
    if (!body.system || !Array.isArray(body.messages)) return jsonError('Request must include system and messages', 400, env);

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: body.model,
        max_tokens: Math.min(Number(body.max_tokens) || 1024, MAX_TOKENS_CAP),
        system: body.system,
        messages: body.messages,
      }),
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: corsHeaders(env, { 'content-type': 'application/json' }),
    });
  },
};

function corsHeaders(env, extra = {}) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    ...extra,
  };
}
function jsonError(message, status, env) {
  return new Response(JSON.stringify({ error: message }), { status, headers: corsHeaders(env, { 'content-type': 'application/json' }) });
}
