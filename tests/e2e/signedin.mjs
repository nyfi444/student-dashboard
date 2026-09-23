/* Setup for the signed-in browser tests.

   These run the real app against the Firebase emulators (Auth, Firestore,
   Storage) that ../with-emulators.mjs starts with this repo's own rules.
   The app switches to them only on localhost and only with the flag set
   below — see firebaseEmulatorHost in js/firebase.js.

   Three guarantees, because these tests sign in and write data:

   1. Nothing reaches the real Firebase project. Every request to a Google
      Firebase endpoint is blocked and fails the test that made it, so a
      broken emulator switch shows up as a red test, never as a write to
      production.
   2. Nothing reaches the real Worker. Every call to it is answered here.
      The license check and the terms record get their normal answers; an
      error report the app sends to /log-error fails the test with what it
      reported; anything else is unexpected and fails the test too.
   3. Every account is new. Emails are unique per test, so tests running
      in parallel never see each other's data and nothing needs wiping.
*/
import { test, expect } from '@playwright/test';
import { stubExternals, watchConsole } from './helpers.mjs';

const PROJECT = 'demo-semester-hq';
const AUTH = 'http://127.0.0.1:9099';
const FIRESTORE = 'http://127.0.0.1:8080';
const WORKER = 'https://student-planner-ai-proxy.semesterhq.workers.dev';
const PASSWORD = 'correct-horse-battery-staple';

/* Skips the signed-in tests, with a reason, when the emulators aren't up —
   so `npx playwright test` on its own still runs the signed-out suite. */
export async function requireEmulators() {
  let up = false;
  try { up = (await fetch(`${AUTH}/`)).ok; } catch {}
  test.skip(!up, 'Firebase emulators are not running. Use `npm run test:e2e` in tests/, which starts them.');
}

let counter = 0;
/* A brand-new account in the Auth emulator. paid: true writes the license
   document the way the Worker's webhook would — the only way one is ever
   created, since the rules let no client write it. */
export async function newAccount(name, { paid = true } = {}) {
  const email = `${name}.${Date.now().toString(36)}${(counter++).toString(36)}@school.test`;
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, displayName: name, returnSecureToken: true }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`could not create ${email}: ${JSON.stringify(body)}`);
  const uid = body.localId;
  if (paid) {
    await firestoreAdmin('PATCH', `licenses/${uid}`, { fields: { paid: { booleanValue: true }, individualPaid: { booleanValue: true } } });
  }
  return { name, email, uid, paid };
}

/* Reads or writes the emulator's Firestore as the server would, past the
   rules ("Bearer owner" is the emulator's admin credential). Used only to
   set up what the Worker would have written, and to check what the app
   actually saved. */
export async function firestoreAdmin(method, path, body) {
  const res = await fetch(`${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, {
    method, headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (method === 'GET' && res.status === 404) return null;
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json)}`);
  return json;
}

/* Blocks the real Firebase project and answers the Worker; see the top of
   this file. Returns the list of problems so the test can assert on it. */
async function isolate(page, problems) {
  // Matched on the host, not the whole URL: the Auth emulator serves its API
  // under paths like 127.0.0.1:9099/identitytoolkit.googleapis.com/..., so a
  // pattern over the full URL would block the emulator along with the real thing.
  const REAL_FIREBASE = new Set(['firestore.googleapis.com', 'identitytoolkit.googleapis.com', 'securetoken.googleapis.com', 'firebasestorage.googleapis.com']);
  await page.route((url) => REAL_FIREBASE.has(url.hostname), (route) => {
    problems.push(`reached the real Firebase project: ${route.request().method()} ${route.request().url()}`);
    return route.abort();
  });
  await page.route(`${WORKER}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (status, obj) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
    if (path === '/account/attest') return json(200, { ok: true });
    if (path === '/claim-license') return json(200, { paid: false });
    if (path === '/track-event') return json(200, { ok: true });
    if (path === '/log-error') {
      let report = '';
      try { report = JSON.stringify(route.request().postDataJSON()).slice(0, 500); } catch {}
      problems.push(`the app reported an error: ${report}`);
      return json(200, { ok: true });
    }
    problems.push(`unexpected call to the Worker: ${route.request().method()} ${path}`);
    return json(503, { error: 'not available in tests' });
  });
}

/* Opens the app on the emulators and signs in as `account` through the
   app's own Firebase connection — the same onAuthStateChanged path a real
   Google or email-link sign-in ends in. Resolves once the license check
   has finished and the app has rendered for that account. */
export async function openSignedIn(page, account) {
  await stubExternals(page);
  const console_ = watchConsole(page);
  await isolate(page, console_.problems);
  await page.addInitScript(() => {
    localStorage.setItem('shq_firebase_emulators', '1');
    localStorage.setItem('shq_age_tos_confirmed', '1');
  });
  await page.goto('/index.html');
  await expect(page.locator('#sidebar [data-nav="dashboard"]')).toBeAttached();
  const alreadyIn = await page.evaluate(() => !!(window.firebase && firebase.auth().currentUser));
  if (!alreadyIn) {
    await page.evaluate(({ email, password }) => firebase.auth().signInWithEmailAndPassword(email, password), { email: account.email, password: PASSWORD });
  }
  await expect.poll(() => page.evaluate(() => !!window._licenseChecked && !!(typeof _fbUser !== 'undefined' && _fbUser)),
    { message: `${account.name} never finished signing in`, timeout: 15_000 }).toBe(true);
  return console_;
}

/* Waits until what the app shows has reached the account's planner
   document in Firestore — the thing another device will load. */
export async function expectSavedToAccount(account, text) {
  await expect.poll(async () => JSON.stringify(await firestoreAdmin('GET', `planners/${account.uid}`) || {}),
    { message: `"${text}" never reached ${account.name}'s account`, timeout: 15_000 }).toContain(text);
}
