/* ── HTML sanitizer for anything that did not come from this browser ──
   Notes are rich text stored as HTML. A note written here is the person's
   own, but a note shared into a study group was written by somebody else,
   and "Add to my notebook" used to copy it in as-is and render it with
   innerHTML. One classmate could put a script in a shared note and run it
   in everyone else's account. Everything that renders stored HTML now goes
   through sanitizeHtml(), and so does every import.

   How it works: the HTML is parsed into an inert document (nothing loads or
   runs there), then a brand new tree is built from an allowlist. Elements
   and attributes that are not on the list are dropped; unknown wrappers keep
   their text. Only the shapes the notebook editor itself produces are kept
   (see SLASH_COMMANDS in js/notebook.js), plus tables and images for pasted
   content.
──────────────────────────────────────────────────────────────── */
const SANITIZE_ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'sub', 'sup', 'mark', 'span', 'div', 'font', 'a', 'img',
  'input', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
]);
// Dropped with everything inside them: nothing in here is ever note content.
const SANITIZE_DROP_WITH_CHILDREN = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'template', 'svg', 'math', 'link', 'meta', 'base', 'form',
  'button', 'select', 'textarea', 'noscript', 'canvas', 'video', 'audio', 'frame', 'frameset', 'applet', 'head', 'title',
]);
const SANITIZE_ALLOWED_STYLES = new Set(['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-align']);
const SANITIZE_STYLE_VALUE = /^[#\w\s,.()%'"-]+$/;
const SANITIZE_CONTROL_CHARS = /[\x00-\x1F\x7F\s]+/g;

function sanitizeHtml(html) {
  const source = String(html || '');
  if (!source) return '';
  const parsed = new DOMParser().parseFromString('<!doctype html><html><body>' + source + '</body></html>', 'text/html');
  const out = document.implementation.createHTMLDocument('');
  const root = out.createElement('div');
  sanitizeInto(parsed.body, root, out, 0);
  return root.innerHTML;
}

function sanitizeInto(from, to, doc, depth) {
  if (depth > 60) return; // pathological nesting: stop rather than hang
  for (const node of Array.from(from.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) { to.appendChild(doc.createTextNode(node.nodeValue)); continue; }
    if (node.nodeType !== Node.ELEMENT_NODE) continue; // comments, processing instructions
    const tag = node.localName;
    // Only elements from the HTML namespace. svg/math and friends are where
    // parser tricks live, and nothing the editor makes is in another namespace.
    if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || SANITIZE_DROP_WITH_CHILDREN.has(tag)) continue;
    if (!SANITIZE_ALLOWED_TAGS.has(tag)) { sanitizeInto(node, to, doc, depth + 1); continue; } // unwrap: keep the text
    if (tag === 'input' && String(node.getAttribute('type') || '').toLowerCase() !== 'checkbox') continue;
    const el = doc.createElement(tag);
    copySafeAttributes(node, el, tag);
    if (tag !== 'img' && tag !== 'input' && tag !== 'br' && tag !== 'hr') sanitizeInto(node, el, doc, depth + 1);
    to.appendChild(el);
  }
}

function copySafeAttributes(from, to, tag) {
  const cls = String(from.getAttribute('class') || '').split(/\s+/).filter(c => /^nb-[\w-]+$/.test(c));
  if (cls.length) to.setAttribute('class', cls.join(' '));
  if (tag === 'a') {
    const href = safeUrl(from.getAttribute('href'), ['http:', 'https:', 'mailto:']);
    if (href) { to.setAttribute('href', href); to.setAttribute('target', '_blank'); to.setAttribute('rel', 'noopener noreferrer nofollow'); }
  }
  if (tag === 'img') {
    const src = safeUrl(from.getAttribute('src'), ['http:', 'https:', 'data:']);
    if (!src) { to.setAttribute('alt', from.getAttribute('alt') || ''); return; }
    to.setAttribute('src', src);
    if (from.hasAttribute('alt')) to.setAttribute('alt', String(from.getAttribute('alt')).slice(0, 300));
    for (const dim of ['width', 'height']) {
      const v = from.getAttribute(dim);
      if (v && /^\d{1,4}$/.test(v)) to.setAttribute(dim, v);
    }
  }
  if (tag === 'input') { to.setAttribute('type', 'checkbox'); if (from.hasAttribute('checked')) to.setAttribute('checked', ''); }
  if (tag === 'font') {
    for (const attr of ['face', 'size', 'color']) {
      const v = from.getAttribute(attr);
      if (v && SANITIZE_STYLE_VALUE.test(v) && v.length <= 80) to.setAttribute(attr, v);
    }
  }
  if (tag === 'th' || tag === 'td') {
    for (const attr of ['colspan', 'rowspan']) {
      const v = from.getAttribute(attr);
      if (v && /^\d{1,3}$/.test(v)) to.setAttribute(attr, v);
    }
  }
  const style = from.getAttribute('style');
  if (style) {
    const kept = [];
    // Read through the inert document's CSSOM so odd escapes are normalised
    // before the allowlist looks at them.
    for (let i = 0; i < from.style.length; i++) {
      const prop = from.style[i];
      const value = from.style.getPropertyValue(prop);
      if (!SANITIZE_ALLOWED_STYLES.has(prop) || !value || value.length > 120) continue;
      if (!SANITIZE_STYLE_VALUE.test(value) || /url\(|expression|javascript|@import/i.test(value)) continue;
      kept.push(`${prop}: ${value}`);
    }
    if (kept.length) to.setAttribute('style', kept.join('; '));
  }
}

// A URL is kept only when its scheme is on the list. data: is allowed for
// images only, and only as an image; everything else (javascript:, vbscript:,
// file:, blob: from another origin) is dropped.
function safeUrl(raw, schemes) {
  if (!raw) return '';
  const value = String(raw).replace(SANITIZE_CONTROL_CHARS, '').trim();
  if (!value || value.length > 200000) return '';
  let url;
  try { url = new URL(value, 'https://semester-hq.invalid/'); } catch { return ''; }
  if (!schemes.includes(url.protocol)) return '';
  if (url.protocol === 'data:' && !/^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(value)) return '';
  // A relative link would resolve against the placeholder origin above; only
  // absolute links are kept, so anything that resolved is fine to return as-is.
  if (url.protocol !== 'data:' && !/^(https?:|mailto:)/i.test(value)) return '';
  return value;
}

// Plain text of stored HTML without ever attaching it to the page (an
// <img onerror> in a detached element still fires when its src is set).
function textOfHtml(html) {
  if (!html) return '';
  return new DOMParser().parseFromString('<!doctype html><html><body>' + String(html) + '</body></html>', 'text/html').body.textContent || '';
}
