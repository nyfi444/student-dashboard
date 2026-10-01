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
  // Two browsers, two accounts and two sign-ins: this takes ~13s alone and
  // runs past the shared 30s budget when the whole suite runs in parallel.
  test.setTimeout(60_000);
  const alice = await newAccount('alice');
  const bob = await newAccount('bob');

  /* Alice starts the club. */
  const a = await (await browser.newContext()).newPage();
  const aConsole = await openSignedIn(a, alice);
  await navTo(a, 'orgs');
  await a.getByRole('button', { name: 'Start a club or team', exact: true }).click();
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
  // The welcome sheet greets him first (js/spaces/welcome.js); he closes it.
  await expect(b.locator('#modal')).toContainText('Welcome to Chess Club');
  await b.locator('#modal .spw-go').click();
  await expect(b.locator('#modal')).toBeHidden();
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

test('a club is members-only: a stranger sees the preview, a blocked member can’t come back until unblocked', async ({ browser }) => {
  test.setTimeout(90_000);
  const alice = await newAccount('alice');
  const bob = await newAccount('bob');

  const a = await (await browser.newContext()).newPage();
  const aConsole = await openSignedIn(a, alice);
  await navTo(a, 'orgs');
  await a.getByRole('button', { name: 'Start a club or team', exact: true }).click();
  await a.locator('#modal #of-name').fill('Debate Society');
  await a.locator('#modal #of-create').click();
  const codeBox = a.locator('#modal .sg-invite-code');
  await expect(codeBox).toBeVisible();
  const code = (await codeBox.innerText()).replace(/\s+/g, '');
  await a.locator('#modal .close-x').click();

  // Alice's app writes the public preview, with nothing personal in it.
  await expect.poll(async () => (await firestoreAdmin('GET', `orgs/${code}/public/preview`))?.fields?.memberCount?.integerValue, { timeout: 15_000 }).toBe('1');
  const preview = await firestoreAdmin('GET', `orgs/${code}/public/preview`);
  expect(Object.keys(preview.fields).sort()).toEqual(['memberCount', 'name', 'next', 'updatedAt', 'v'].concat(Object.keys(preview.fields).filter(k => ['color', 'kind', 'school', 'description'].includes(k))).sort());

  /* Bob finds it by code (the preview; the club itself is members-only) and joins. */
  const b = await (await browser.newContext()).newPage();
  const bConsole = await openSignedIn(b, bob);
  await navTo(b, 'orgs');
  await b.getByRole('button', { name: 'Join with code' }).first().click();
  await b.locator('#modal #oj-code').fill(code);
  await b.locator('#modal #oj-btn').click();
  await expect(b.locator('#modal')).toContainText('Debate Society');
  await expect(b.locator('#modal')).toContainText('1 member');
  await b.locator('#modal #oj-confirm').click();
  await expect(b.locator('#modal')).toContainText('Welcome to Debate Society');
  await b.locator('#modal .spw-go').click();

  /* Alice shares a file. The club keeps where it lives, not a permanent link. */
  await a.evaluate((c) => openOrgFileModal(c), code);
  await a.locator('#ofl-file-input').setInputFiles({ name: 'bylaws.txt', mimeType: 'text/plain', buffer: Buffer.from('Article I. Debate every Thursday.') });
  await expect(a.locator('#ofl-file-status')).toContainText('ready to share');
  await a.locator('#modal #ofl-share').click();
  await expect(a.locator('.toast').last()).toContainText('Shared');
  const withFile = await firestoreAdmin('GET', `orgs/${code}`);
  const fileEntry = Object.values(withFile.fields.files.mapValue.fields)[0].mapValue.fields;
  expect(fileEntry.path.stringValue).toMatch(new RegExp(`^orgs/${code}/files/`));
  expect(fileEntry.url).toBeUndefined();
  // Bob, a member, gets a link when he opens it.
  await expect.poll(() => b.evaluate((c) => orgFileList(findOrg(c) || { files: {} }).length, code)).toBe(1);
  const link = await b.evaluate(async (p) => orgFileLink(p), fileEntry.path.stringValue);
  expect(link).toContain('bylaws.txt');

  /* Alice removes him and blocks him from rejoining. */
  await expect.poll(() => a.evaluate((c) => (findOrg(c)?.memberUids || []).length, code)).toBe(2);
  await a.evaluate(({ c, u }) => removeOrgMember(c, u), { c: code, u: bob.uid });
  await expect(a.locator('#modal')).toContainText('Block from rejoining with the code');
  await a.locator('#modal #rm-block').check();
  await a.locator('#modal #rm-yes').click();

  // His app lets go of the club, and says why.
  await expect(b.locator('.toast').last()).toContainText('no longer a member of “Debate Society”', { timeout: 15_000 });
  await expect.poll(() => b.evaluate((c) => !!orgEntry(c), code)).toBe(false);
  // Removing him asked the Worker for new file links (worker/src/spaces.js).
  expect(await a.evaluate(() => true) && a._rotateCalls).toBe(1);

  // The code no longer lets him in.
  await b.getByRole('button', { name: 'Join with code' }).first().click();
  await b.locator('#modal #oj-code').fill(code);
  await b.locator('#modal #oj-btn').click();
  await b.locator('#modal #oj-confirm').click();
  await expect(b.locator('.toast').last()).toContainText('You can’t join this club');
  const org = await firestoreAdmin('GET', `orgs/${code}`);
  expect((org.fields.memberUids.arrayValue.values || []).map(v => v.stringValue)).toEqual([alice.uid]);
  expect(Object.keys(org.fields.blocked.mapValue.fields)).toEqual([bob.uid]);

  /* Alice unblocks him in settings, and he can join again. */
  await a.evaluate((c) => openOrgSettingsModal(c), code);
  await expect(a.locator('#modal')).toContainText('Blocked from rejoining (1)');
  await a.locator('#modal').getByRole('button', { name: /^Unblock/ }).click();
  await expect(a.locator('.toast').last()).toContainText('Unblocked');
  await a.locator('#modal .close-x').click();

  await b.locator('#modal #oj-confirm').click();
  // In again (the welcome sheet only greets a first join).
  await expect.poll(() => b.evaluate((c) => !!orgEntry(c), code)).toBe(true);
  const back = await firestoreAdmin('GET', `orgs/${code}`);
  expect((back.fields.memberUids.arrayValue.values || []).map(v => v.stringValue).sort()).toEqual([alice.uid, bob.uid].sort());

  aConsole.expectClean();
  bConsole.expectClean();
});
