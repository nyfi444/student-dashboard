/* ── Claude's reply, streamed and put back together ────────────────
   The AI proxy (ai.js) asks Anthropic to stream. A long reply sent in
   one piece can take more than the 100 seconds Cloudflare waits before
   giving up, and a reply cut off for room came back empty. The app still
   wants the one JSON message a plain call returns, so the Worker reads
   the stream, folds it back into that message here, and sends it at the
   end. The same helpers run the Business OS's proxy.
──────────────────────────────────────────────────────────────── */
// Server-sent events arrive in chunks that can split anywhere. Feed each
// chunk in; get back the complete events it finished.
export function sseReader() {
  let buf = '';
  return (chunk, done = false) => {
    buf += chunk;
    buf = buf.replace(/\r\n/g, '\n');
    const out = [];
    let cut;
    while ((cut = buf.indexOf('\n\n')) !== -1 || (done && buf.trim())) {
      const block = cut === -1 ? buf : buf.slice(0, cut);
      buf = cut === -1 ? '' : buf.slice(cut + 2);
      const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
      if (!data) continue;
      try { out.push(JSON.parse(data)); } catch { /* not JSON: skip it */ }
    }
    return out;
  };
}

// One event at a time into a message shaped like a plain call's answer.
// Returns the new state; state.error is set if Anthropic sent an error.
export function foldClaudeEvent(state, ev) {
  const s = state || { message: null, error: null };
  if (!ev || typeof ev !== 'object') return s;
  switch (ev.type) {
    case 'message_start':
      s.message = { ...(ev.message || {}), content: [] };
      break;
    case 'content_block_start':
      if (s.message) s.message.content[ev.index ?? s.message.content.length] = { ...(ev.content_block || {}) };
      break;
    case 'content_block_delta': {
      const b = s.message?.content[ev.index];
      const d = ev.delta || {};
      if (!b) break;
      if (d.type === 'text_delta') b.text = (b.text || '') + (d.text || '');
      else if (d.type === 'thinking_delta') b.thinking = (b.thinking || '') + (d.thinking || '');
      else if (d.type === 'signature_delta') b.signature = d.signature;
      else if (d.type === 'input_json_delta') b._json = (b._json || '') + (d.partial_json || '');
      break;
    }
    case 'content_block_stop': {
      const b = s.message?.content[ev.index];
      if (b && b._json !== undefined) {
        try { b.input = JSON.parse(b._json || '{}'); } catch { b.input = {}; }
        delete b._json;
      }
      break;
    }
    case 'message_delta':
      if (s.message) {
        Object.assign(s.message, ev.delta || {});
        if (ev.usage) s.message.usage = { ...(s.message.usage || {}), ...ev.usage };
      }
      break;
    case 'error':
      s.error = ev.error || { type: 'api_error', message: 'Claude stopped partway through.' };
      break;
    default: break; // ping, message_stop, anything new
  }
  return s;
}

// The finished message. If a refusal handed the answer to a fallback model
// partway through, the text before and after that point is one answer (the
// fallback continues from it), so it is joined into a single text block;
// otherwise the page would put a line break into the middle of it.
export function finishClaudeMessage(state) {
  if (state?.error) return { type: 'error', error: state.error };
  const m = state?.message;
  if (!m) return { type: 'error', error: { type: 'api_error', message: 'Claude sent no answer.' } };
  const content = (m.content || []).filter(Boolean);
  if (content.some(b => b.type === 'fallback')) {
    const text = content.filter(b => b.type === 'text').map(b => b.text || '').join('');
    const kept = content.filter(b => b.type !== 'text' && b.type !== 'thinking' && b.type !== 'redacted_thinking');
    return { ...m, content: [...kept, { type: 'text', text }] };
  }
  return { ...m, content };
}
