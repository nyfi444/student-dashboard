/* ── A club, with two real people in it ────────────────────────────
   A club only means anything with at least two accounts in it: one runs
   it, the other joins with the code and sees what's posted. This is the
   two-account test that had been open since clubs shipped, driven through
   the real screens against the rules that ship.

   Needs the Firebase emulators — run through `npm run test:e2e` in tests/.
──────────────────────────────────────────────────────────────── */
import { test, expect } from '@playwright/test';
import { navTo } from './helpers.mjs';
import { firestoreAdmin, newAccount, openSignedIn, requireEmulators } from './signedin.mjs';

test.beforeEach(requireEmulators);

test('an officer starts a club, a classmate joins with the code, and each sees the other', async ({ browser }) => {
  const alice = await newAccount('alice');
  const bob = await newAccount('bob');

  /* Alice starts the club. */
  const a = await (await browser.newContext()).newPage();
  const aConsole = await openSignedIn(a, alice);
  await navTo(a, 'orgs');
  await a.getByRole('button', { name: '+ Start a club or team' }).click();
  await a.locator('#modal #of-name').fill('Chess Club');
  await a.locator('#modal #of-title').fill('President');
  await a.locator('#modal #of-create').click();

  // The invite screen shows the code a member types in.
  const codeBox = a.locator('#modal .sg-invite-code');
  await expect(codeBox).toBeVisible();
  const code = (await codeBox.innerText()).replace(/\s+/g, '');
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  await a.locator('#modal .close-x').click();

  /* She posts an announcement, which only an officer can do. */
  await a.getByRole('button', { name: 'Announce', exact: true }).click();
  await a.locator('#modal #an-text').fill('First meeting Tuesday at 7 in the Union.');
  await a.locator('#modal #an-post').click();
  await expect(a.locator('#modal')).toBeHidden();

  /* Bob joins with the code. */
  const b = await (await browser.newContext()).newPage();
  const bConsole = await openSignedIn(b, bob);
  await navTo(b, 'orgs');
  await b.getByRole('button', { name: 'Join with code' }).first().click(); // the header and the empty state both offer it
  await b.locator('#modal #oj-code').fill(code);
  await b.locator('#modal #oj-btn').click();
  await expect(b.locator('#modal')).toContainText('Chess Club');
  await b.locator('#modal #oj-confirm').click();

  // He's in, and sees what Alice posted.
  await expect(b.locator('#content')).toContainText('Chess Club');
  await b.getByRole('tab', { name: /Announcements/ }).click();
  await expect(b.locator('#content')).toContainText('First meeting Tuesday at 7 in the Union.');
  // A member who isn't an officer gets no Announce button and no Admin tab.
  await expect(b.getByRole('button', { name: 'Announce', exact: true })).toHaveCount(0);
  await expect(b.getByRole('tab', { name: /Admin/ })).toHaveCount(0);

  // What the rules allowed is what the database now says.
  const org = await firestoreAdmin('GET', `orgs/${code}`);
  const members = (org.fields.memberUids.arrayValue.values || []).map(v => v.stringValue);
  const officers = (org.fields.officerUids.arrayValue.values || []).map(v => v.stringValue);
  expect(members.sort()).toEqual([alice.uid, bob.uid].sort());
  expect(officers).toEqual([alice.uid]);

  /* Bob says hello in the club chat; Alice sees it arrive. */
  await b.getByRole('tab', { name: /Chat/ }).click();
  await b.locator('#org-chat-input').fill('Count me in for Tuesday');
  await b.locator('#org-chat-input').press('Enter');
  await expect(b.locator('#org-chat-log')).toContainText('Count me in for Tuesday');

  await a.getByRole('tab', { name: /Chat/ }).click();
  await expect(a.locator('#org-chat-log')).toContainText('Count me in for Tuesday', { timeout: 15_000 });

  aConsole.expectClean();
  bConsole.expectClean();
});
