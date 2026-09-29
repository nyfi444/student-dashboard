/* ── Forms: a club asks, people answer ─────────────────────────────
   Two tests. The first is the sample club, signed out, through the real
   screens: a member fills a form in, an officer writes one and gets its
   link. The second is the point of the feature: an officer posts an
   interest form, someone who has never joined the club (and has no plan)
   opens the link on form.html, answers, and the officer reads it. That
   one runs against the rules that ship, so an answer that reaches the
   officer got there the only way the rules allow.

   The second needs the Firebase emulators: `npm run test:e2e` in tests/.
──────────────────────────────────────────────────────────────── */
import { test, expect } from '@playwright/test';
import { navTo, openApp } from './helpers.mjs';
import { firestoreAdmin, newAccount, openSignedIn, openStandalone, requireEmulators, signInHere } from './signedin.mjs';

const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('in the sample club, a member answers a form and an officer writes a new one', async ({ page }) => {
  const console_ = await openApp(page);
  await navTo(page, 'orgs');
  await page.locator('.space-sample-pick .chip', { hasText: 'Club' }).first().click();
  await expect(page.locator('#content')).toContainText('Women in Business');

  /* As a member: the sign-up is waiting, and says so. */
  await page.getByRole('button', { name: 'Member', exact: true }).click();
  await page.getByRole('tab', { name: /Forms/ }).click();
  const signup = page.locator('.form-card', { hasText: 'Fall retreat sign-up' });
  await expect(signup).toContainText('Waiting for your answer');
  await expect(signup.getByRole('button', { name: 'Answers' })).toHaveCount(0);
  expect(await noSidewaysScroll(page)).toBe(0);

  await signup.getByRole('button', { name: 'Fill out' }).click();
  await expect(page.locator('#modal')).toContainText('Your answers go to the officers of Women in Business, with your name');
  // The first question needs an answer: sending without one says which.
  await page.locator('#form-send').click();
  await expect(page.locator('#modal .ff-err:visible')).toHaveText(['This one needs an answer.']);
  await page.locator('#modal .ff-opt', { hasText: 'Maybe' }).click();
  await page.locator('#modal .ff-opt', { hasText: 'I need a ride' }).click();
  await page.locator('#modal input.ff-input').fill('No peanuts');
  await page.locator('#form-send').click();
  await expect(page.locator('#modal')).toBeHidden();
  await expect(signup).toContainText('You answered');

  // Their answer comes back when they open it again.
  await signup.getByRole('button', { name: 'Change my answer' }).click();
  await expect(page.locator('#modal .ff-opt', { hasText: 'Maybe' }).locator('input')).toBeChecked();
  await expect(page.locator('#modal input.ff-input')).toHaveValue('No peanuts');
  await page.locator('#modal .close-x').click();

  /* As an officer: the answer is there, by person and in the counts. */
  await page.getByRole('button', { name: 'Officer', exact: true }).click();
  await signup.getByRole('button', { name: 'Answers' }).click();
  await expect(page.locator('.forms-results-count')).toContainText('9 answers');
  await page.getByRole('button', { name: 'By person' }).click();
  await page.locator('.forms-person-row').first().click();
  await expect(page.locator('.forms-person-answers')).toContainText('No peanuts');
  expect(await noSidewaysScroll(page)).toBe(0);
  await page.getByRole('button', { name: 'All forms' }).click();

  /* And writes a new one, from nothing. */
  await page.getByRole('button', { name: 'New form' }).click();
  await page.locator('.fb-pick', { hasText: 'Blank form' }).click();
  await page.locator('#fb-title').fill('Snack vote');
  await page.locator('#fb-q-0-label').fill('Which snack?');
  await page.locator('.fb-q-type').first().selectOption('choice');
  await page.locator('#fb-q-0-opt-0').fill('Pretzels');
  // One choice isn't a choice: the form won't open until there are two.
  await page.locator('#fb-save').click();
  await expect(page.locator('.toast').last()).toContainText('Question 1 needs at least two choices.');
  await page.locator('#fb-q-0-opt-1').fill('Fruit');
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.locator('#modal')).toContainText('Preview, nothing is sent');
  await expect(page.locator('#modal .ff-opt')).toHaveText(['Pretzels', 'Fruit']);
  await page.locator('#modal .modal-foot').getByRole('button', { name: 'Back to editing' }).click();
  await expect(page.locator('#fb-title')).toHaveValue('Snack vote');
  await page.locator('#fb-save').click();

  // Opening it leads straight to its link and QR code.
  await expect(page.locator('#form-share-link')).toHaveValue(/\/form\.html\?f=c\.[A-Z0-9]{6}\.[a-z0-9]+$/);
  await expect(page.locator('.form-share-qr svg')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.form-card', { hasText: 'Snack vote' })).toContainText('Open');

  console_.expectClean();
});

test.describe('with accounts', () => {
  test.beforeEach(requireEmulators);

  test('an officer posts an interest form, someone outside the club answers it from the link, and the officer reads it', async ({ browser }) => {
    test.setTimeout(90_000);
    const alice = await newAccount('alice');
    const carol = await newAccount('carol');
    // Mallory has an account and nothing else: no plan, no club.
    const mallory = await newAccount('mallory', { paid: false });

    /* Alice starts the club and posts the form. */
    const a = await (await browser.newContext()).newPage();
    const aConsole = await openSignedIn(a, alice);
    await navTo(a, 'orgs');
    await a.getByRole('button', { name: 'Start a club or team', exact: true }).click();
    await a.locator('#modal #of-name').fill('Chess Club');
    await a.locator('#modal #of-create').click();
    const codeBox = a.locator('#modal .sg-invite-code');
    await expect(codeBox).toBeVisible();
    const code = (await codeBox.innerText()).replace(/\s+/g, '');
    await a.locator('#modal .close-x').click();

    await a.getByRole('tab', { name: /Forms/ }).click();
    await a.getByRole('button', { name: 'Make a form' }).click();
    await a.locator('.fb-pick', { hasText: 'Interest form' }).click();
    await expect(a.locator('#fb-audience button.active')).toContainText('Anyone with the link');
    await a.locator('#fb-save').click();
    const linkBox = a.locator('#form-share-link');
    await expect(linkBox).toHaveValue(/\/form\.html\?f=c\./);
    const link = new URL(await linkBox.inputValue());
    const formId = link.searchParams.get('f').split('.')[2];
    expect(link.searchParams.get('f')).toBe(`c.${code}.${formId}`);
    await a.getByRole('button', { name: 'Done' }).click();

    /* Mallory opens the link. Signed out, she sees nothing of the form. */
    const m = await (await browser.newContext()).newPage();
    const mConsole = await openStandalone(m, link.pathname + link.search);
    await expect(m.locator('#fp-root')).toContainText('Someone sent you a form');
    await expect(m.locator('#fp-root')).not.toContainText('Interested in joining?');
    await signInHere(m, mallory);

    await expect(m.locator('.fp-title')).toHaveText('Interested in joining?');
    await expect(m.locator('.fp-from')).toHaveText('Chess Club');
    await expect(m.locator('.ff-who')).toContainText(`Your answers go to the officers of Chess Club, with your name (mallory) and email (${mallory.email}).`);
    expect(await noSidewaysScroll(m)).toBe(0);
    await m.locator('#fp-send').click();
    await expect(m.locator('.ff-err:visible')).toHaveText(['This one needs an answer.']);
    await m.locator('select.ff-input').selectOption('Sophomore');
    await m.locator('input.ff-input').first().fill('Biology');
    await m.locator('.ff-opt', { hasText: 'Volunteering' }).click();
    await m.locator('#fp-send').click();
    await expect(m.locator('#fp-root')).toContainText('Your answers went to the officers of Chess Club');
    await expect(m.locator('.fp-pitch')).toContainText('Your entire semester, finally in one place.');

    // What the rules let through is what the database now holds: her answer
    // under her own uid with the email she signed in with, marked as not a
    // member, and her own record of it for the day she deletes her account.
    const saved = await firestoreAdmin('GET', `orgs/${code}/forms/${formId}/responses/${mallory.uid}`);
    expect(saved.fields.email.stringValue).toBe(mallory.email);
    expect(saved.fields.member.booleanValue).toBe(false);
    expect(saved.fields.uid.stringValue).toBe(mallory.uid);
    const record = await firestoreAdmin('GET', `planners/${mallory.uid}/formAnswers/orgs_${code}_${formId}`);
    expect(record.fields.formId.stringValue).toBe(formId);
    // She never joined the club by answering.
    const org = await firestoreAdmin('GET', `orgs/${code}`);
    expect((org.fields.memberUids.arrayValue.values || []).map(v => v.stringValue)).toEqual([alice.uid]);

    // The link still works for her afterwards, and shows what she sent.
    await m.reload();
    await expect(m.locator('#fp-root')).toContainText('You answered');
    await expect(m.locator('select.ff-input')).toHaveValue('Sophomore');

    /* Carol joins the club. A member can't read Mallory's answer. */
    const c = await (await browser.newContext()).newPage();
    const cConsole = await openSignedIn(c, carol);
    await navTo(c, 'orgs');
    await c.getByRole('button', { name: 'Join with code' }).first().click();
    await c.locator('#modal #oj-code').fill(code);
    await c.locator('#modal #oj-btn').click();
    await c.locator('#modal #oj-confirm').click();
    await c.locator('#modal .spw-go').click();
    await c.getByRole('tab', { name: /Forms/ }).click();
    const cCard = c.locator('.form-card', { hasText: 'Interested in joining?' });
    await expect(cCard).toContainText('Waiting for your answer');
    await expect(cCard.getByRole('button', { name: 'Answers' })).toHaveCount(0);
    const denied = await c.evaluate(({ code, formId, uid }) => _fbDb.collection('orgs').doc(code).collection('forms').doc(formId).collection('responses').doc(uid).get().then(() => 'read', (e) => e.code), { code, formId, uid: mallory.uid });
    expect(denied).toBe('permission-denied');

    /* Alice reads it. */
    const aCard = a.locator('.form-card', { hasText: 'Interested in joining?' });
    // The list asks for fresh counts every so often while it is on screen.
    await expect(aCard.locator('.form-card-count')).toContainText('1 answer', { timeout: 40_000 });
    await aCard.getByRole('button', { name: 'Answers' }).click();
    await expect(a.locator('.forms-results-count')).toContainText('1 answer · 1 from people who aren’t members yet');
    await a.getByRole('button', { name: 'By person' }).click();
    const row = a.locator('.forms-person-row').first();
    await expect(row).toContainText('mallory');
    await expect(row).toContainText(mallory.email);
    await row.click();
    await expect(a.locator('.forms-person-answers')).toContainText('Biology');
    expect(await noSidewaysScroll(a)).toBe(0);

    /* She closes the form. The link stops taking answers. */
    await a.getByRole('button', { name: /^More for/ }).click();
    await a.getByRole('menuitem', { name: 'Stop taking answers' }).click();
    await expect(a.locator('.forms-results-tags')).toContainText('Closed');
    await m.reload();
    await expect(m.locator('#fp-root')).toContainText('You answered this form');
    await expect(m.locator('#fp-send')).toHaveCount(0);

    aConsole.expectClean();
    cConsole.expectClean();
    mConsole.expectClean();
  });
});
