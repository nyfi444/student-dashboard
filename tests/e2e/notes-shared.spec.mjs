/* ── A note two people edit at the same time ───────────────────────
   Alice turns a note into a shared one and sends the link; Bob opens it
   and joins. Then both type at once, in different places, and each must
   end up with both people's words, in their own editor and in Firestore.
   A picture Alice adds goes to Storage and shows up for Bob. Driven
   through the real screens, against the rules that ship.

   Needs the Firebase emulators — run through `npm run test:e2e` in tests/.
──────────────────────────────────────────────────────────────── */
import { test, expect } from '@playwright/test';
import { navTo } from './helpers.mjs';
import { firestoreAdmin, newAccount, openSignedIn, requireEmulators } from './signedin.mjs';

test.beforeEach(requireEmulators);

const caretAtEnd = (page) => page.evaluate(() => { const ed = document.getElementById('note-editor'); ed.focus(); const n = ed.textContent.length; nbSetCaretOffsets(ed, n, n); });
const caretAtStart = (page) => page.evaluate(() => { const ed = document.getElementById('note-editor'); ed.focus(); nbSetCaretOffsets(ed, 0, 0); });
const editorText = (page) => page.locator('#note-editor').innerText();
// Two people saving the same note at the same instant: Firestore turns one
// save away (the note changed under it), the SDK runs it again on the new
// text, and the browser logs the turned-away request. That retry is how
// live editing is meant to work (see nbSharedPush), so exactly that
// message is allowed here; any other error still fails the test.
const TRANSACTION_RETRY = /^console\.error: Failed to load resource: the server responded with a status of 400 \(Bad Request\) \(http:\/\/127\.0\.0\.1:8080\/v1\/projects\/demo-semester-hq\/databases\/\(default\)\/documents:commit\)$/;
const expectCleanApartFromRetries = (c) => { const keep = c.problems.filter(p => !TRANSACTION_RETRY.test(p)); c.problems.splice(0, c.problems.length, ...keep); c.expectClean(); };

test('two people edit one note live: a link to join, both people’s typing kept, pictures shared', async ({ browser }) => {
  test.setTimeout(90_000);
  const alice = await newAccount('alice');
  const bob = await newAccount('bob');

  /* Alice writes a note and shares it with anyone who has the link. */
  const a = await (await browser.newContext()).newPage();
  const aConsole = await openSignedIn(a, alice);
  await navTo(a, 'notebook');
  await a.getByRole('button', { name: 'Note', exact: true }).first().click();
  await a.locator('#nb-title-input').fill('Bio 201 study guide');
  await a.locator('#note-editor').click();
  await a.keyboard.type('Cell signaling has three stages.');
  await a.keyboard.press('Enter');
  await a.keyboard.type('Reception, transduction, response.');
  await a.locator('.nb-act-share').click();
  await expect(a.locator('#modal')).toContainText('together');
  await a.locator('#modal #nb-share-link-on').check();
  await a.locator('#modal #nb-share-go').click();

  // The note moves to Shared, and the Share panel hands over the link.
  await expect(a.locator('.nb-section-shared')).toContainText('Bio 201 study guide');
  const linkBox = a.locator('#modal #nb-share-link');
  await expect(linkBox).toBeVisible();
  const link = await linkBox.inputValue();
  expect(link).toMatch(/\?note=[A-Za-z0-9]+\.[A-Za-z0-9]{24}$/);
  const sid = link.split('?note=')[1].split('.')[0];
  await a.locator('#modal').getByRole('button', { name: 'Done' }).click();

  /* Bob opens the link and is in. */
  const b = await (await browser.newContext()).newPage();
  const bConsole = await openSignedIn(b, bob);
  await b.goto('/index.html?note=' + link.split('?note=')[1]);
  await expect(b.locator('#note-editor')).toContainText('Reception, transduction, response.', { timeout: 15_000 });
  await expect(b.locator('#nb-title-input')).toHaveValue('Bio 201 study guide');
  const joined = await firestoreAdmin('GET', `sharedNotes/${sid}`);
  expect((joined.fields.editorUids.arrayValue.values || []).map(v => v.stringValue).sort()).toEqual([alice.uid, bob.uid].sort());

  // Each sees the other is here.
  await expect(a.locator('#nb-shared-people .nb-person')).toHaveCount(1, { timeout: 15_000 });
  await expect(b.locator('#nb-shared-people .nb-person')).toHaveCount(1, { timeout: 15_000 });

  /* Both type at once: Alice at the end, Bob at the start. */
  await caretAtEnd(a);
  await caretAtStart(b);
  await Promise.all([
    a.keyboard.type(' Kinases pass it along.', { delay: 15 }),
    b.keyboard.type('Exam on Friday. ', { delay: 15 }),
  ]);
  for (const page of [a, b]) {
    await expect.poll(() => editorText(page), { timeout: 15_000 }).toContain('Exam on Friday. Cell signaling has three stages.');
    await expect.poll(() => editorText(page), { timeout: 15_000 }).toContain('Reception, transduction, response. Kinases pass it along.');
  }
  await expect.poll(async () => (await firestoreAdmin('GET', `sharedNotes/${sid}`)).fields.content.stringValue, { timeout: 15_000 })
    .toMatch(/Exam on Friday\. Cell signaling[\s\S]*Kinases pass it along\./);

  /* A rename reaches the other person. */
  await b.locator('#nb-title-input').fill('Bio 201 exam guide');
  await expect(a.locator('.nb-section-shared')).toContainText('Bio 201 exam guide', { timeout: 15_000 });

  /* Alice adds a picture; it is stored as a file and Bob sees it. */
  await caretAtEnd(a);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFTEMIQkAPrcH+Zc5Oq8AAAAASUVORK5CYII=', 'base64');
  await a.locator('#nb-picture-input').setInputFiles({ name: 'diagram.png', mimeType: 'image/png', buffer: png });
  await expect(a.locator('#note-editor img.nb-img')).toHaveCount(1, { timeout: 15_000 });
  const src = await a.locator('#note-editor img.nb-img').getAttribute('src');
  expect(src).toContain(`sharedNotes%2F${sid}%2Fimages`);
  await expect(b.locator('#note-editor img.nb-img')).toHaveAttribute('src', src, { timeout: 15_000 });

  expectCleanApartFromRetries(aConsole);
  expectCleanApartFromRetries(bConsole);
});

