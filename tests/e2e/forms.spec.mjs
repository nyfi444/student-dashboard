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
  // What needs you on the Overview asks for it too, with an Answer button.
  const need = page.locator('.space-need.is-form', { hasText: 'Fall retreat sign-up' });
  await expect(need).toHaveCount(1);
  await expect(need.locator('.space-need-eyebrow')).toHaveText(/^Form · closes [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}$/);
  await expect(need.getByRole('button', { name: 'Answer: Fall retreat sign-up' })).toHaveCount(1);
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
  // Answered, so What needs you stops asking.
  await page.getByRole('tab', { name: /Overview/ }).click();
  await expect(page.locator('.space-need.is-form', { hasText: 'Fall retreat sign-up' })).toHaveCount(0);
  await page.getByRole('tab', { name: /Forms/ }).click();

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

test('in the sample club, applications are sorted, a file is sent as an answer, and the suggestion box has no names in it', async ({ page }) => {
  const console_ = await openApp(page);
  await navTo(page, 'orgs');
  await page.locator('.space-sample-pick .chip', { hasText: 'Club' }).first().click();
  await expect(page.locator('#content')).toContainText('Women in Business');

  /* As a member: an application with a file, and an anonymous suggestion. */
  await page.getByRole('button', { name: 'Member', exact: true }).click();
  await page.getByRole('tab', { name: /Forms/ }).click();
  const application = page.locator('.form-card', { hasText: 'Spring membership application' });
  await application.getByRole('button', { name: 'Fill out' }).click();
  await page.locator('#modal select.ff-input').selectOption('Junior');
  await page.locator('#modal input.ff-input').first().fill('Economics');
  await page.locator('#modal textarea.ff-input').first().fill('I want to learn how a club is run.');
  await page.locator('#modal .ff-opt', { hasText: 'Most weeks' }).click();
  // The picker takes any kind of file: it never filters by type.
  const picker = page.locator('#modal input[type="file"]');
  await expect(picker).not.toHaveAttribute('accept', /.*/);
  await picker.setInputFiles({ name: 'My résumé.pages', mimeType: 'application/vnd.apple.pages', buffer: Buffer.from('a résumé, more or less') });
  await expect(page.locator('#modal .ff-file-name')).toContainText('My résumé.pages');
  await page.locator('#modal .ff-file-remove').click();
  await expect(page.locator('#modal .ff-file-name')).toHaveCount(0);
  await picker.setInputFiles({ name: 'resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 a resume') });
  await page.locator('#form-send').click();
  await expect(page.locator('#modal')).toBeHidden();
  await expect(application).toContainText('You answered');
  // Nothing on a member's side says what was decided about anybody.
  await expect(page.locator('#content')).not.toContainText(/Accepted|Waitlisted|Declined/);

  const box = page.locator('.form-card', { hasText: 'Suggestion box' });
  await expect(box).toContainText('Anonymous');
  await box.getByRole('button', { name: 'Fill out' }).click();
  await expect(page.locator('#modal .ff-who')).toContainText('This form is anonymous. Your name and email are not attached');
  await page.locator('#modal textarea.ff-input').fill('Could meetings start ten minutes later?');
  await page.locator('#form-send').click();
  await expect(page.locator('#modal')).toBeHidden();
  await expect(box).toContainText('You answered');
  // It can't be read back, only replaced or removed.
  await box.getByRole('button', { name: 'Answer again' }).click();
  await expect(page.locator('#modal')).toContainText('Your answer is anonymous, so it can’t be shown here. Sending again replaces it.');
  await expect(page.locator('#modal textarea.ff-input')).toHaveValue('');
  await page.locator('#modal .close-x').click();

  /* As an officer: sort the applications. */
  await page.getByRole('button', { name: 'Officer', exact: true }).click();
  await application.getByRole('button', { name: 'Answers' }).click();
  await expect(page.locator('.forms-results-count')).toContainText('7 answers');
  await expect(page.locator('.forms-sum-marks')).toContainText('Sorted so far');
  await page.getByRole('button', { name: 'By person' }).click();
  await expect(page.locator('.forms-filter .chip', { hasText: 'Not sorted yet' })).toContainText('3');
  const mine = page.locator('.forms-person-row', { hasText: 'You' });
  await expect(mine.locator('.forms-mark')).toHaveCount(0);
  await mine.click();
  await expect(page.locator('.forms-person .forms-file')).toContainText('resume.pdf');
  await expect(page.locator('.forms-decide')).toContainText('Only officers see this. Nothing is sent to You.');
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accepted', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // Tapping the same one again clears it; another one replaces it.
  await page.getByRole('button', { name: 'Accepted', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Waitlist', exact: true }).click();
  await page.getByRole('button', { name: 'Everyone' }).click();
  await expect(mine.locator('.forms-mark')).toHaveText('Waitlisted');
  await page.locator('.forms-filter .chip', { hasText: 'Waitlisted' }).click();
  await expect(page.locator('.forms-person-row')).toHaveCount(2);
  expect(await noSidewaysScroll(page)).toBe(0);
  await page.getByRole('button', { name: 'All forms' }).click();

  /* And read the suggestion box: what was said, never who said it. */
  await box.getByRole('button', { name: 'Answers' }).click();
  await expect(page.locator('.forms-results-count')).toContainText('6 answers');
  await expect(page.locator('.forms-anon-note')).toContainText('carry no names');
  await expect(page.locator('.forms-summary')).toContainText('Could meetings start ten minutes later?');
  await page.getByRole('button', { name: 'One by one' }).click();
  await expect(page.locator('.forms-person-row')).toHaveCount(6);
  await expect(page.locator('.forms-person-row .sg-strong')).toHaveText(['Answer 1', 'Answer 2', 'Answer 3', 'Answer 4', 'Answer 5', 'Answer 6']);
  await expect(page.locator('.forms-people')).not.toContainText('You');
  expect(await noSidewaysScroll(page)).toBe(0);

  /* A new form can be anonymous only if it asks for no file. */
  await page.getByRole('button', { name: 'All forms' }).click();
  await page.getByRole('button', { name: 'New form' }).click();
  await page.locator('.fb-pick', { hasText: 'Membership application' }).click();
  await page.locator('#fb-anon').check();
  await expect(page.locator('.fb-warn')).toContainText('An anonymous form can’t take files');
  await page.locator('#fb-save').click();
  await expect(page.locator('.toast').last()).toContainText('asks for a file, and an anonymous form can’t take one');
  await page.locator('#modal .close-x').click();

  console_.expectClean();
});

test.describe('with accounts', () => {
  test.beforeEach(requireEmulators);

  test('an application with a résumé is sent from the link, an officer opens the file and decides, and nobody else can see either', async ({ browser }) => {
    test.setTimeout(90_000);
    const alice = await newAccount('alice');
    const carol = await newAccount('carol');
    const mallory = await newAccount('mallory', { paid: false });

    const a = await (await browser.newContext()).newPage();
    const aConsole = await openSignedIn(a, alice);
    await navTo(a, 'orgs');
    await a.getByRole('button', { name: 'Start a club or team', exact: true }).click();
    await a.locator('#modal #of-name').fill('Chess Club');
    await a.locator('#modal #of-create').click();
    const code = (await a.locator('#modal .sg-invite-code').innerText()).replace(/\s+/g, '');
    await a.locator('#modal .close-x').click();
    await a.getByRole('tab', { name: /Forms/ }).click();
    await a.getByRole('button', { name: 'Make a form' }).click();
    await a.locator('.fb-pick', { hasText: 'Membership application' }).click();
    await a.locator('#fb-save').click();
    const link = new URL(await a.locator('#form-share-link').inputValue());
    const formId = link.searchParams.get('f').split('.')[2];
    await a.getByRole('button', { name: 'Done' }).click();

    /* Mallory applies, with a file. */
    const m = await (await browser.newContext()).newPage();
    const mConsole = await openStandalone(m, link.pathname + link.search);
    await signInHere(m, mallory);
    await expect(m.locator('.fp-title')).toHaveText('Membership application');
    await m.locator('select.ff-input').selectOption('Sophomore');
    await m.locator('input.ff-input[type="text"]').first().fill('Biology');
    await m.locator('textarea.ff-input').first().fill('I like chess.');
    await m.locator('.ff-opt', { hasText: 'Yes' }).click();
    const resume = Buffer.from('%PDF-1.4 mallory, a résumé');
    await m.locator('input[type="file"]').setInputFiles({ name: 'Mallory résumé.pdf', mimeType: 'application/pdf', buffer: resume });
    await m.locator('#fp-send').click();
    await expect(m.locator('#fp-root')).toContainText('Your answers went to the officers of Chess Club');

    const saved = await firestoreAdmin('GET', `orgs/${code}/forms/${formId}/responses/${mallory.uid}`);
    const fileQ = Object.entries(saved.fields.answers.mapValue.fields).find(([, v]) => v.mapValue);
    expect(fileQ[1].mapValue.fields.name.stringValue).toBe('Mallory résumé.pdf');
    expect(Object.keys(fileQ[1].mapValue.fields).sort(), 'the answer holds the file’s name, size and type, never where it is').toEqual(['name', 'size', 'type']);
    // She can open her own file again from the same link.
    await m.reload();
    await expect(m.locator('.fp-files .forms-file')).toContainText('Mallory résumé.pdf');

    /* Alice opens the file and decides. */
    const aCard = a.locator('.form-card', { hasText: 'Membership application' });
    await aCard.getByRole('button', { name: 'Answers' }).click();
    await a.getByRole('button', { name: 'By person' }).click();
    await a.locator('.forms-person-row', { hasText: 'mallory' }).click();
    await expect(a.locator('.forms-person .forms-file')).toContainText('Mallory résumé.pdf');
    const path = `orgs/${code}/forms/${formId}/${mallory.uid}/${fileQ[0]}`;
    const opened = await a.evaluate(async (p) => { const url = await (await fbStorage()).ref(p).getDownloadURL(); return new TextDecoder().decode(await (await fetch(url)).arrayBuffer()); }, path);
    expect(opened).toBe(resume.toString());
    await a.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(a.getByRole('button', { name: 'Accepted', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await firestoreAdmin('GET', `orgs/${code}/forms/${formId}/marks/${mallory.uid}`))?.fields?.status?.stringValue).toBe('accepted');

    /* Mallory can't read what was decided. Carol, a member, can read neither the file nor the decision. */
    const readAs = (page, what, p) => page.evaluate(async ({ what, p }) => {
      try {
        if (what === 'file') { const s = typeof fbStorage === 'function' ? await fbStorage() : await fpStorage(); await s.ref(p).getDownloadURL(); }
        else await (typeof _fbDb !== 'undefined' && _fbDb ? _fbDb : _db).doc(p).get();
        return 'read';
      } catch (e) { return e.code; }
    }, { what, p });
    expect(await readAs(m, 'doc', `orgs/${code}/forms/${formId}/marks/${mallory.uid}`)).toBe('permission-denied');
    await expect(m.locator('#fp-root')).not.toContainText(/Accepted|accepted/);
    const c = await (await browser.newContext()).newPage();
    const cConsole = await openSignedIn(c, carol);
    await navTo(c, 'orgs');
    await c.getByRole('button', { name: 'Join with code' }).first().click();
    await c.locator('#modal #oj-code').fill(code);
    await c.locator('#modal #oj-btn').click();
    await c.locator('#modal #oj-confirm').click();
    await c.locator('#modal .spw-go').click();
    expect(await readAs(c, 'doc', `orgs/${code}/forms/${formId}/marks/${mallory.uid}`)).toBe('permission-denied');
    expect(await readAs(c, 'file', path)).toBe('storage/unauthorized');
    // The browser prints that refusal in her console. It is the one line
    // expected there, so it is taken out by name and everything else still counts.
    const refused = cConsole.problems.filter(p => p.includes('403') && p.includes(encodeURIComponent(path)));
    expect(refused.length, 'the file read was refused by Storage itself').toBe(1);
    cConsole.problems.splice(cConsole.problems.indexOf(refused[0]), 1);

    /* Mallory takes her application back: the answer and the file both go. */
    await m.getByRole('button', { name: 'Remove my answer' }).click();
    await m.locator('#confirm-yes').click();
    await expect(m.locator('#fp-send')).toBeVisible();
    expect(await firestoreAdmin('GET', `orgs/${code}/forms/${formId}/responses/${mallory.uid}`)).toBeNull();
    // Asked of the storage emulator itself, as the server would.
    await expect.poll(async () => (await fetch(`http://127.0.0.1:9199/v0/b/demo-semester-hq.appspot.com/o/${encodeURIComponent(path)}`, { headers: { authorization: 'Bearer owner' } })).status).toBe(404);

    aConsole.expectClean();
    cConsole.expectClean();
    mConsole.expectClean();
  });

  test('a member answers an anonymous form, and the officer reads the answer without the name', async ({ browser }) => {
    test.setTimeout(90_000);
    const alice = await newAccount('alice');
    const carol = await newAccount('carol');

    const a = await (await browser.newContext()).newPage();
    const aConsole = await openSignedIn(a, alice);
    await navTo(a, 'orgs');
    await a.getByRole('button', { name: 'Start a club or team', exact: true }).click();
    await a.locator('#modal #of-name').fill('Chess Club');
    await a.locator('#modal #of-create').click();
    const code = (await a.locator('#modal .sg-invite-code').innerText()).replace(/\s+/g, '');
    await a.locator('#modal .close-x').click();
    await a.getByRole('tab', { name: /Forms/ }).click();
    await a.getByRole('button', { name: 'Make a form' }).click();
    await a.locator('.fb-pick', { hasText: 'Suggestion box' }).click();
    await expect(a.locator('#fb-anon')).toBeChecked();
    await a.locator('#fb-save').click();
    const formId = new URL(await a.locator('#form-share-link').inputValue()).searchParams.get('f').split('.')[2];
    await a.getByRole('button', { name: 'Done' }).click();
    // Once it has opened, anonymous can't be switched off: not in the builder, not by the rules.
    await a.locator('.form-card', { hasText: 'Suggestion box' }).getByRole('button', { name: /^More for/ }).click();
    await a.getByRole('menuitem', { name: 'Edit questions' }).click();
    await expect(a.locator('#fb-anon')).toBeDisabled();
    await a.locator('#modal .close-x').click();
    const switched = await a.evaluate(({ code, formId }) => _fbDb.doc(`orgs/${code}/forms/${formId}`).update({ anonymous: false }).then(() => 'changed', (e) => e.code), { code, formId });
    expect(switched).toBe('permission-denied');

    const c = await (await browser.newContext()).newPage();
    const cConsole = await openSignedIn(c, carol);
    await navTo(c, 'orgs');
    await c.getByRole('button', { name: 'Join with code' }).first().click();
    await c.locator('#modal #oj-code').fill(code);
    await c.locator('#modal #oj-btn').click();
    await c.locator('#modal #oj-confirm').click();
    await c.locator('#modal .spw-go').click();
    await c.getByRole('tab', { name: /Forms/ }).click();
    const box = c.locator('.form-card', { hasText: 'Suggestion box' });
    await box.getByRole('button', { name: 'Fill out' }).click();
    await c.locator('#modal textarea.ff-input').fill('Fewer meetings, more games.');
    // The app may not write an answer to an anonymous form itself, under her uid or any other id.
    const direct = await c.evaluate(({ code, formId, uid }) => _fbDb.doc(`orgs/${code}/forms/${formId}/responses/${uid}`).set({ uid, name: 'carol', member: true, answers: {}, at: 1, updatedAt: 1 }).then(() => 'written', (e) => e.code), { code, formId, uid: carol.uid });
    expect(direct).toBe('permission-denied');
    const asked = c.waitForRequest((r) => r.url().endsWith('/form/answer'));
    await c.locator('#form-send').click();
    const sent = (await asked).postDataJSON();
    expect(Object.keys(sent).sort(), 'what goes to the Worker').toEqual(['answers', 'code', 'formId', 'idToken', 'kind']);
    await expect(c.locator('#modal')).toBeHidden();
    await expect(box).toContainText('You answered');
    // She can't remove her own record of it to answer twice.
    const cheat = await c.evaluate(({ code, formId, uid }) => _fbDb.doc(`planners/${uid}/formAnswers/orgs_${code}_${formId}`).delete().then(() => 'removed', (e) => e.code), { code, formId, uid: carol.uid });
    expect(cheat).toBe('permission-denied');

    const aCard = a.locator('.form-card', { hasText: 'Suggestion box' });
    await expect(aCard.locator('.form-card-count')).toContainText('1 answer', { timeout: 40_000 });
    await aCard.getByRole('button', { name: 'Answers' }).click();
    await expect(a.locator('.forms-summary')).toContainText('Fewer meetings, more games.');
    await a.getByRole('button', { name: 'One by one' }).click();
    await expect(a.locator('.forms-person-row .sg-strong')).toHaveText(['Answer 1']);
    await expect(a.locator('.forms-results')).not.toContainText(/carol/i);

    /* Carol takes it back. */
    await box.getByRole('button', { name: 'Answer again' }).click();
    await c.getByRole('button', { name: 'Remove my answer' }).click();
    await c.locator('#confirm-yes').click();
    await expect(box).toContainText('Waiting for your answer');
    await expect(a.locator('.forms-results')).toContainText('No answers yet', { timeout: 15_000 });

    aConsole.expectClean();
    cConsole.expectClean();
  });

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
