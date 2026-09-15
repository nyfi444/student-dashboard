/* ── Web Push (RFC 8030 / 8291 / 8292), no dependencies ─────────────
   encryptPayload: aes128gcm message encryption to one browser
   subscription. vapidAuthHeader: the signed VAPID JWT that identifies
   this server to the push service. sendWebPush: both, plus a POST to
   the subscription's endpoint, restricted to real push services so a
   crafted subscription can't make the Worker call arbitrary URLs.
──────────────────────────────────────────────────────────────── */
const enc = (s) => new TextEncoder().encode(s);
function concat(...parts) {
  const arrays = parts.map(p => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrays) { out.set(a, o); o += a.length; }
  return out;
}
export function b64urlEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64urlDecode(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmacSha256(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

export async function encryptPayload(p256dh, auth, plaintext) {
  const uaPublic = b64urlDecode(p256dh);
  const authSecret = b64urlDecode(auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('Bad subscription keys');
  const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  // RFC 8291 §3.4: combine the ECDH secret with the subscription's auth secret.
  const prkKey = await hmacSha256(authSecret, ecdhSecret);
  const ikm = (await hmacSha256(prkKey, concat(enc('WebPush: info\0'), uaPublic, asPublic, [1]))).slice(0, 32);
  // RFC 8188: derive the content key and nonce.
  const prk = await hmacSha256(salt, ikm);
  const cek = (await hmacSha256(prk, concat(enc('Content-Encoding: aes128gcm\0'), [1]))).slice(0, 16);
  const nonce = (await hmacSha256(prk, concat(enc('Content-Encoding: nonce\0'), [1]))).slice(0, 12);
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const body = typeof plaintext === 'string' ? enc(plaintext) : plaintext;
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, concat(body, [2])));
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = 65;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

const _jwtCache = new Map();
export async function vapidAuthHeader(audience, { publicKey, privateJwk, subject }) {
  const cached = _jwtCache.get(audience);
  const nowSec = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - nowSec > 3600) return cached.header;
  const exp = nowSec + 12 * 3600;
  const head = b64urlEncode(enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(enc(JSON.stringify({ aud: audience, exp, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', typeof privateJwk === 'string' ? JSON.parse(privateJwk) : privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc(`${head}.${claims}`));
  const header = `vapid t=${head}.${claims}.${b64urlEncode(sig)}, k=${publicKey}`;
  _jwtCache.set(audience, { header, exp });
  return header;
}

const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)android\.googleapis\.com$/];
export function isPushEndpoint(endpoint) {
  try { const u = new URL(endpoint); return u.protocol === 'https:' && PUSH_HOSTS.some(re => re.test(u.hostname)); } catch { return false; }
}
export async function sendWebPush(subscription, payload, vapid, { ttl = 86400, urgency = 'normal' } = {}) {
  if (!isPushEndpoint(subscription?.endpoint)) return { status: 400 };
  const u = new URL(subscription.endpoint);
  const body = await encryptPayload(subscription.keys.p256dh, subscription.keys.auth, typeof payload === 'string' ? payload : JSON.stringify(payload));
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      TTL: String(ttl), Urgency: urgency, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
      Authorization: await vapidAuthHeader(`${u.protocol}//${u.host}`, vapid),
    },
    body,
  });
  return { status: res.status };
}
