/* ── worker/src/firebase.js ─────────────────────────────────────
   Everything that talks to Firebase with the Worker's own service
   account: ID-token verification, the Firestore REST helpers, Storage
   and Auth deletes. No route lives here; it depends on nothing else.
──────────────────────────────────────────────────────────────── */

// Small shared helper: several Firestore docs keep a list or map as a JSON
// string in a single field (group admins, for one), so this reads them back
// without a malformed value taking a request down with it.
export function parseJsonField(v, fallback) { try { const x = JSON.parse(v || ''); return x ?? fallback; } catch { return fallback; } }

// PATCH only the named fields (updateMask), leaving the app's own fields alone.
export async function patchFirestoreDoc(env, path, fields) {
  const token = await getFirebaseAccessToken(env);
  const mask = Object.keys(fields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}?${mask}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
  });
  if (!res.ok) throw new Error('Firestore patch failed: ' + await res.text());
}

/* ── Firebase ID token verification (manual, no Admin SDK in Workers) ─
   Mirrors what the Admin SDK does: check standard claims, then verify the
   RS256 signature against Google's public JWK set for Firebase Auth. ─── */
export async function verifyFirebaseIdToken(idToken, projectId) {
  const [headerB64, payloadB64, sigB64] = String(idToken || '').split('.');
  if (!headerB64 || !payloadB64 || !sigB64) throw new Error('Malformed token');
  const header = JSON.parse(atob(base64urlToBase64(headerB64)));
  const payload = JSON.parse(atob(base64urlToBase64(payloadB64)));
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) throw new Error('Unexpected token header');
  if (payload.aud !== projectId) throw new Error('Bad audience');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Bad issuer');
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('Expired');
  if (typeof payload.iat !== 'number' || payload.iat > now + 300) throw new Error('Issued in the future');
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) throw new Error('No subject');

  // Google rotates these keys; they are cached for as long as Google says
  // and fetched again once when a token names a key that isn't cached.
  let jwk = (await googleSigningKeys()).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await googleSigningKeys(true)).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('Unknown key id');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64urlToBuffer(sigB64), new TextEncoder().encode(`${headerB64}.${payloadB64}`));
  if (!valid) throw new Error('Bad signature');
  return payload;
}

/* ── Firestore REST helpers, authenticated as our own service account ──
   Cloudflare Workers can't use the Node-only firebase-admin SDK, so we
   sign our own OAuth2 JWT with the service account's private key and
   exchange it for an access token, same as Admin SDK does internally. ── */
// Reused for most of the hour it's good for: without this, every Firestore
// call signed a new JWT and fetched a new token, doubling the requests a
// group plan update makes (and Workers cap subrequests per invocation).
let _firebaseToken = { value: '', expiresAt: 0 };
async function getFirebaseAccessToken(env) {
  if (_firebaseToken.value && Date.now() < _firebaseToken.expiresAt) return _firebaseToken.value;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  // .trim() defends against stray whitespace/newlines from copy-pasting the
  // secret value in (a real failure mode: Google's OAuth server reports a
  // trimmed-looking "account not found" for this rather than a clearer error).
  const clientEmail = (env.FIREBASE_CLIENT_EMAIL || '').trim();
  const claims = base64url(JSON.stringify({
    iss: clientEmail,
    sub: clientEmail,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    // datastore covers Firestore reads/writes; identitytoolkit is needed
    // only for handleDeleteAccount's Auth-user deletion step.
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/devstorage.read_write',
  }));
  const signingInput = `${header}.${claims}`;
  const key = await importPrivateKey(env.FIREBASE_PRIVATE_KEY);
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64urlFromBuffer(sigBuf)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Firebase auth failed: ' + JSON.stringify(data));
  _firebaseToken = { value: data.access_token, expiresAt: Date.now() + 50 * 60 * 1000 };
  return data.access_token;
}
async function importPrivateKey(pem) {
  const normalized = pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
  const b64 = normalized.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}
export async function writeFirestoreDoc(env, collection, docId, fields) {
  const token = await getFirebaseAccessToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
  });
  if (!res.ok) throw new Error('Firestore write failed: ' + await res.text());
}
export async function readFirestoreDoc(env, collection, docId) {
  const token = await getFirebaseAccessToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Firestore read failed: ' + await res.text());
  const data = await res.json();
  return fromFirestoreFields(data.fields || {});
}
// Same as readFirestoreDoc, plus when the doc last changed, for a write that
// should only land if nobody has changed it since (see commitFirestore).
export async function readFirestoreDocWithTime(env, path) {
  const token = await getFirebaseAccessToken(env);
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Firestore read failed: ' + await res.text());
  const doc = await res.json();
  return { data: fromFirestoreFields(doc.fields || {}), updateTime: doc.updateTime };
}
export async function batchGetFirestoreDocs(env, paths) {
  const out = {};
  if (!paths.length) return out;
  const token = await getFirebaseAccessToken(env);
  const root = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const res = await fetch(`https://firestore.googleapis.com/v1/${root}:batchGet`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ documents: paths.map(p => `${root}/${p}`) }),
  });
  if (!res.ok) throw new Error('Firestore batch read failed: ' + await res.text());
  for (const row of await res.json()) {
    if (row.found) out[row.found.name.slice(root.length + 1)] = fromFirestoreFields(row.found.fields || {});
    else if (row.missing) out[row.missing.slice(root.length + 1)] = null;
  }
  return out;
}
// Writes that all land or none do. Each is { path, fields } (only those
// fields change) or { path, remove: true }, optionally with exists (true or
// false) or updateTime as a condition. Resolves false when a condition
// didn't hold, so the caller can re-read and try again.
// `increments` ({ fieldPath: n }) adds to counters server-side, so two
// writers counting at once can't overwrite each other (see usage.js). A
// field path segment that isn't a plain identifier has to be quoted in
// backticks, as Firestore's own field path syntax requires.
export async function commitFirestore(env, writes) {
  const token = await getFirebaseAccessToken(env);
  const root = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const body = {
    writes: writes.map(w => {
      const name = `${root}/${w.path}`;
      const condition = typeof w.exists === 'boolean' ? { currentDocument: { exists: w.exists } } : w.updateTime ? { currentDocument: { updateTime: w.updateTime } } : {};
      if (w.remove) return { delete: name, ...condition };
      // `clear` names field paths to delete (e.g. one key of a map, like
      // `people.abc123`): in the mask but absent from fields, which is how
      // Firestore is told to remove just that key. Rewriting the whole map
      // instead would mean decoding and re-encoding every other member's
      // entry, and anything this Worker's decoder doesn't model — a null,
      // say — would silently vanish from their data.
      const fields = w.fields || {};
      const paths = [...Object.keys(fields), ...(w.clear || [])];
      const transforms = w.increments ? { updateTransforms: Object.entries(w.increments).map(([fieldPath, n]) => ({ fieldPath, increment: { integerValue: String(Math.trunc(n)) } })) } : {};
      return { update: { name, fields: toFirestoreFields(fields) }, updateMask: { fieldPaths: paths }, ...transforms, ...condition };
    }),
  };
  const res = await fetch(`https://firestore.googleapis.com/v1/${root}:commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (res.ok) return true;
  const text = await res.text();
  if (/FAILED_PRECONDITION|ALREADY_EXISTS|ABORTED|NOT_FOUND/.test(text)) return false;
  throw new Error('Firestore commit failed: ' + text);
}
export async function listFirestoreCollection(env, path) {
  const token = await getFirebaseAccessToken(env);
  const base = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
  const docs = [];
  let pageToken = '';
  for (let page = 0; page < 20; page++) {
    const res = await fetch(`${base}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Firestore list failed: ' + await res.text());
    const data = await res.json();
    for (const d of data.documents || []) docs.push({ id: d.name.split('/').pop(), ...fromFirestoreFields(d.fields || {}) });
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return docs;
}
export async function deleteFirestoreDoc(env, collection, docId) {
  const token = await getFirebaseAccessToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
  const res = await fetch(url, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
  if (!res.ok && res.status !== 404) throw new Error('Firestore delete failed: ' + await res.text());
}
// Firestore never cascade-deletes a subcollection when its parent document
// is deleted; has to be done by hand: list every doc, delete each one,
// page through if there are more than one page's worth.
export async function deleteFirestoreSubcollection(env, parentPath, subcollectionId) {
  const token = await getFirebaseAccessToken(env);
  const base = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${parentPath}/${subcollectionId}`;
  let pageToken = '';
  for (;;) {
    const url = `${base}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Firestore list failed: ' + await res.text());
    const data = await res.json();
    const docs = data.documents || [];
    await Promise.all(docs.map(d => fetch(`https://firestore.googleapis.com/v1/${d.name}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
}
export async function deleteFirebaseAuthUser(env, uid) {
  const token = await getFirebaseAccessToken(env);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts:delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ localId: uid }),
  });
  if (!res.ok) throw new Error('Identity Toolkit delete failed: ' + await res.text());
}
// `parent` scopes the query to a document's subcollections (e.g. the messages
// under one study group); omitted, it queries the top level.
export async function runFirestoreQuery(env, structuredQuery, parent = '') {
  const token = await getFirebaseAccessToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents${parent ? `/${parent}` : ''}:runQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) throw new Error('Firestore query failed: ' + await res.text());
  const rows = await res.json();
  return rows
    .filter(r => r.document)
    .map(r => ({ id: r.document.name.split('/').pop(), ...fromFirestoreFields(r.document.fields || {}) }));
}
export async function queryRecentDocs(env, collectionId, limit) {
  return runFirestoreQuery(env, {
    from: [{ collectionId }],
    orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
    limit,
  });
}
export async function queryRecentErrors(env, limit) {
  return queryRecentDocs(env, 'errors', limit);
}
function toFirestoreValue(v) {
  // A deliberate "not known" (the ledger's traffic on a day Cloudflare
  // can't answer for). Before this it was stored as the string "null".
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { integerValue: String(Math.trunc(v)) };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (v && typeof v === 'object') return { mapValue: { fields: toFirestoreFields(v) } };
  return { stringValue: String(v) };
}
function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = toFirestoreValue(v);
  return fields;
}
function fromFirestoreValue(v) {
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFirestoreValue).filter(x => x !== undefined);
  if ('mapValue' in v) return fromFirestoreFields(v.mapValue.fields || {});
  return undefined;
}
function fromFirestoreFields(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields)) {
    const value = fromFirestoreValue(v);
    if (value !== undefined) obj[k] = value;
  }
  return obj;
}
export function encodeEmailDocId(email) { return email.replace(/[^a-zA-Z0-9@._-]/g, '_'); }
// Google's public keys for Firebase ID tokens, cached for as long as Google
// allows (capped at six hours) instead of fetched on every single check.
let _googleJwks = { keys: [], expiresAt: 0 };
async function googleSigningKeys(forceRefresh = false) {
  if (!forceRefresh && _googleJwks.keys.length && Date.now() < _googleJwks.expiresAt) return _googleJwks.keys;
  const res = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if (!res.ok) throw new Error(`Could not fetch signing keys (${res.status})`);
  const { keys } = await res.json();
  const maxAge = Number((res.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1]) || 3600;
  _googleJwks = { keys: Array.isArray(keys) ? keys : [], expiresAt: Date.now() + Math.min(maxAge, 6 * 3600) * 1000 };
  return _googleJwks.keys;
}
// Deletes every object under a prefix in the project's Storage bucket, using
// the same service account as Firestore (the token carries the storage scope).
export async function deleteStorageFolder(env, prefix) {
  const bucket = env.FIREBASE_STORAGE_BUCKET;
  if (!bucket) return 0;
  const token = await getFirebaseAccessToken(env);
  const base = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`;
  let deleted = 0, pageToken = '';
  do {
    const listUrl = `${base}?prefix=${encodeURIComponent(prefix)}&fields=items(name),nextPageToken&maxResults=500${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(listUrl, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Storage list ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    for (const item of data.items || []) {
      const del = await fetch(`${base}/${encodeURIComponent(item.name)}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
      if (!del.ok && del.status !== 404) throw new Error(`Storage delete ${del.status}`);
      deleted++;
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return deleted;
}

/* ── base64url helpers ───────────────────────────────────────── */
function base64url(str) { return base64urlFromBuffer(new TextEncoder().encode(str)); }
function base64urlFromBuffer(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlToBase64(b64url) {
  return b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(b64url.length + (4 - (b64url.length % 4)) % 4, '=');
}
function base64urlToBuffer(b64url) {
  const bin = atob(base64urlToBase64(b64url));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
