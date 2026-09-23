/* ── A paying student's semester lives in their account ────────────
   The whole reason to pay: what you put in on your laptop is there on
   your phone, and a reload never loses it. These sign real (emulated)
   accounts in and check the data actually lands in Firestore under the
   rules that ship, then comes back on a second device.

   Needs the Firebase emulators — run through `npm run test:e2e` in tests/.
──────────────────────────────────────────────────────────────── */
import { test, expect } from '@playwright/test';
import { navTo } from './helpers.mjs';
import { expectSavedToAccount, newAccount, openSignedIn, requireEmulators } from './signedin.mjs';

test.beforeEach(requireEmulators);

async function addCourse(page, name, code) {
  await navTo(page, 'courses');
  await page.getByRole('button', { name: '+ Add course' }).first().click();
  await page.locator('#modal #cf-name').fill(name);
  await page.locator('#modal #cf-code').fill(code);
  await page.locator('#modal').getByRole('button', { name: 'Save course' }).click();
  await expect(page.locator('#modal')).toBeHidden();
}

test('a paying student’s semester is saved to their account and survives a reload', async ({ page }) => {
  const alice = await newAccount('alice');
  const console_ = await openSignedIn(page, alice);

  // Signed in and paid: no demo bar, no paywall.
  await expect(page.locator('.demo-bar')).toHaveCount(0);
  await expect(page.locator('#content')).not.toContainText('No plan on this account yet');

  await addCourse(page, 'Organic Chemistry', 'CHEM 230');
  await expectSavedToAccount(alice, 'Organic Chemistry');

  await page.reload();
  await expect(page.locator('#sidebar [data-nav="dashboard"]')).toBeAttached();
  await navTo(page, 'courses');
  await expect(page.locator('.course-card')).toContainText('Organic Chemistry');
  console_.expectClean();
});

test('what one device saves, another device loads', async ({ browser }) => {
  const alice = await newAccount('alice');

  const laptop = await browser.newContext();
  const laptopPage = await laptop.newPage();
  const laptopConsole = await openSignedIn(laptopPage, alice);
  await addCourse(laptopPage, 'Linear Algebra', 'MATH 221');
  await expectSavedToAccount(alice, 'Linear Algebra');

  // A second browser context shares nothing with the first — no storage, no
  // cache, no session. The only way the class can be here is the account.
  const phone = await browser.newContext();
  const phonePage = await phone.newPage();
  const phoneConsole = await openSignedIn(phonePage, alice);
  await navTo(phonePage, 'courses');
  await expect(phonePage.locator('.course-card')).toContainText('Linear Algebra');

  laptopConsole.expectClean();
  phoneConsole.expectClean();
  await laptop.close(); await phone.close();
});

test('signed in without a plan, the app asks for one and keeps nothing', async ({ page }) => {
  const bob = await newAccount('bob', { paid: false });
  const console_ = await openSignedIn(page, bob);
  await expect(page.locator('#content')).toContainText('No plan on this account yet');
  const stored = await page.evaluate(() => localStorage.getItem('studentPlanner.v1'));
  expect(stored, 'an unpaid account must not keep a planner on this device').toBeNull();
  console_.expectClean();
});

test('one student cannot read another’s planner, even from inside the app', async ({ browser }) => {
  const alice = await newAccount('alice');
  const mallory = await newAccount('mallory');

  const a = await (await browser.newContext()).newPage();
  await openSignedIn(a, alice);
  await addCourse(a, 'Private Seminar', 'HON 400');
  await expectSavedToAccount(alice, 'Private Seminar');

  // Mallory, signed in and paid, uses the app's own Firebase connection to
  // ask for Alice's planner by id. The rules that ship must refuse.
  const m = await (await browser.newContext()).newPage();
  await openSignedIn(m, mallory);
  const outcome = await m.evaluate(async (uid) => {
    try { const snap = await firebase.firestore().doc(`planners/${uid}`).get(); return snap.exists ? 'READ IT' : 'empty'; }
    catch (e) { return e.code || e.message; }
  }, alice.uid);
  expect(outcome).toBe('permission-denied');
});
