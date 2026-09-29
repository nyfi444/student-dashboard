/* ── A study group, with two real people in it ─────────────────────
   The group twin of clubs.spec.mjs: one account starts a group and
   schedules a session, a classmate joins with the code, and between them
   they use every part of a group that writes shared data: RSVPs
   (including maybe), Find a time, tasks (add, assign, complete), chat,
   and a shared link. Each step is checked on the other person's screen
   or in the Firestore document the rules let through.

   Needs the Firebase emulators — run through `npm run test:e2e` in tests/.
──────────────────────────────────────────────────────────────── */
import { test, expect } from '@playwright/test';
import { navTo } from './helpers.mjs';
import { firestoreAdmin, newAccount, openSignedIn, requireEmulators } from './signedin.mjs';

test.beforeEach(requireEmulators);

// Firestore's REST shape ({ mapValue: { fields } }, { stringValue }) as plain values.
function plain(v) {
  if (!v || typeof v !== 'object') return v;
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, plain(x)]));
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(plain);
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  return v;
}
const groupDoc = async (code) => {
  const d = await firestoreAdmin('GET', `studyGroups/${code}`);
  return d ? plain({ mapValue: { fields: d.fields } }) : null;
};
const isoInDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const tab = (page, name) => page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
// Generous: with the whole suite running, the emulator can take a while.
// Toggles (an RSVP, a task's check) are clicked exactly once and then
// checked in the database: clicking again to "retry" would undo them.
const POLL = { timeout: 45_000 };

test('a student starts a study group, a classmate joins with the code, and they plan, split the work and talk', async ({ browser }) => {
  // Two browsers, two sign-ins and a dozen round trips through the emulator.
  test.setTimeout(240_000);
  const alice = await newAccount('alice');
  const bob = await newAccount('bob');

  /* Alice starts the group. */
  const a = await (await browser.newContext()).newPage();
  const aConsole = await openSignedIn(a, alice);
  await navTo(a, 'studygroups');
  await a.getByRole('button', { name: /^(New group|Start a group)$/ }).first().click();
  await a.locator('#modal #gf-name').fill('Bio 201 Study Group');
  await a.locator('#modal #gf-create').click();

  const codeBox = a.locator('#modal .sg-invite-code');
  await expect(codeBox).toBeVisible();
  const code = (await codeBox.innerText()).replace(/\s+/g, '');
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  await a.locator('#modal .close-x').click();
  await expect(a.locator('#content')).toContainText('Bio 201 Study Group');

  /* She schedules a session. */
  await tab(a, 'Sessions');
  await a.getByRole('button', { name: 'New session' }).click();
  await a.locator('#modal #ss-title').fill('Midterm review');
  await a.locator('#modal #ss-date').fill(isoInDays(3));
  await a.locator('#modal #ss-start').fill('18:00');
  await a.locator('#modal #ss-end').fill('19:30');
  await a.locator('#modal').getByRole('button', { name: 'Schedule' }).click();
  await expect(a.locator('#modal')).toBeHidden();
  await expect(a.locator('#content')).toContainText('Midterm review');
  let doc;
  await expect.poll(async () => Object.values((doc = await groupDoc(code))?.sessions || {}).map(s => s.title), POLL).toEqual(['Midterm review']);
  const sid = Object.keys(doc.sessions)[0];

  /* Bob joins with the code. */
  const b = await (await browser.newContext()).newPage();
  const bConsole = await openSignedIn(b, bob);
  await navTo(b, 'studygroups');
  await b.getByRole('button', { name: 'Join with code' }).first().click();
  await b.locator('#modal #jf-code').fill(code);
  await b.locator('#modal #jf-btn').click();
  await expect(b.locator('#modal')).toContainText('Bio 201 Study Group');
  await b.locator('#modal #jf-confirm').click();
  await expect(b.locator('#content')).toContainText('Bio 201 Study Group');
  await expect.poll(async () => ((await groupDoc(code))?.memberUids || []).sort(), POLL).toEqual([alice.uid, bob.uid].sort());

  /* RSVPs: Bob says maybe, Alice says she's going. */
  await tab(b, 'Sessions');
  await expect(b.locator('#content')).toContainText('Midterm review');
  await b.locator('.sg-rsvp').first().getByRole('button', { name: 'Maybe' }).click();
  // Each answer redraws the other screen when it arrives; Alice answers once
  // Bob's has reached her, so her click can't land on a button being replaced.
  await expect.poll(() => a.evaluate(([c, s, u]) => findGroup(c)?.sessions?.[s]?.rsvp?.[u], [code, sid, bob.uid]), POLL).toBe('maybe');
  await tab(a, 'Sessions');
  await a.locator('.sg-rsvp').first().getByRole('button', { name: 'Going' }).click();
  await expect.poll(async () => (await groupDoc(code))?.sessions?.[sid]?.rsvp || {}, POLL).toEqual({ [alice.uid]: 'yes', [bob.uid]: 'maybe' });

  /* Find a time: Bob paints a block of his week. */
  await tab(b, 'Find a time');
  const grid = b.locator('#sg-avail-mine');
  await expect(grid).toBeVisible();
  // Alice's writes can redraw the grid just before the drag starts (the app
  // holds redraws only while a drag is under way), so the drag is retried
  // until a block is painted. Pressing a painted cell would clear it, so a
  // retry only happens while nothing is painted yet.
  await expect(async () => {
    if (await grid.locator('.sg-cell.on').count() >= 2) return;
    const from = grid.locator('.sg-cell[data-col="1"][data-slot="20"]');
    const to = grid.locator('.sg-cell[data-col="2"][data-slot="23"]');
    await from.scrollIntoViewIfNeeded({ timeout: 2_000 });
    const fb = await from.boundingBox(), tb = await to.boundingBox();
    await b.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
    await b.mouse.down();
    await b.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 6 });
    await b.mouse.up();
    expect(await grid.locator('.sg-cell.on').count()).toBeGreaterThanOrEqual(2);
  }).toPass({ timeout: 45_000 });
  // How many cells a drag covers depends on where the pointer landed, so the
  // check is that what he painted is exactly what was saved.
  const painted = await grid.locator('.sg-cell.on').count();
  expect(painted).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => {
    const av = (await groupDoc(code))?.avail?.[bob.uid];
    return av ? Object.entries(av).filter(([k]) => /^d\d$/.test(k)).reduce((n, [, v]) => n + (String(v).match(/1/g) || []).length, 0) : 0;
  }, POLL).toBe(painted);

  /* Tasks: Alice adds one for Bob, and Bob finishes it. */
  const tasks = async () => Object.values((await groupDoc(code))?.taskItems || {});
  // Bob's painting redraws Alice's page when it arrives, which would clear a
  // half-typed task, so she starts once his week has reached her screen.
  await expect.poll(() => a.evaluate(([c, u]) => !!findGroup(c)?.avail?.[u], [code, bob.uid]), POLL).toBe(true);
  await tab(a, 'Tasks');
  await a.locator('#sg-task-title').fill('Outline the lab report');
  await a.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(async () => (await tasks()).map(t => t.title), POLL).toEqual(['Outline the lab report']);
  await expect(a.locator('#content')).toContainText('Outline the lab report');
  // She hands it to Bob from the task's own row (setting the same person
  // twice changes nothing, so this one can be retried).
  await expect(async () => {
    const pick = a.getByRole('combobox', { name: 'Assign Outline the lab report' });
    if (await pick.inputValue() !== bob.uid) await pick.selectOption(bob.uid);
    expect((await tasks()).map(t => t.assignee)).toEqual([bob.uid]);
  }).toPass({ timeout: 45_000 });
  await tab(b, 'Tasks');
  await expect(b.getByRole('combobox', { name: 'Assign Outline the lab report' })).toHaveValue(bob.uid, POLL);
  await b.getByRole('checkbox', { name: 'Mark Outline the lab report as done', exact: true }).click();
  await expect.poll(async () => (await tasks()).map(t => [t.title, t.assignee, t.done, t.doneBy]), POLL)
    .toEqual([['Outline the lab report', bob.uid, true, bob.uid]]);

  /* Chat: Bob says hello, Alice sees it arrive. */
  await tab(b, 'Chat');
  await b.locator('#sg-chat-input').fill('See you Thursday, I will bring the practice exam');
  await b.locator('#sg-chat-input').press('Enter');
  await expect(b.locator('#sg-chat-log')).toContainText('See you Thursday');
  await tab(a, 'Chat');
  await expect(a.locator('#sg-chat-log')).toContainText('See you Thursday', { timeout: 30_000 });

  /* Files (the resources tab): Alice shares a link, Bob sees it. */
  await tab(a, 'Files');
  // A new group's Files tab is the library's empty state: Upload a file, Add a link.
  await a.getByRole('button', { name: /^(Add a link|Share)$/ }).first().click();
  await a.locator('#modal #sr-kind').selectOption('link');
  await a.locator('#modal #sr-link-url').fill('https://example.com/bio201-practice-exam');
  await a.locator('#modal #sr-link-title').fill('Practice exam');
  await a.locator('#modal #sr-share-btn').click();
  await expect(a.locator('#modal')).toBeHidden();
  await expect(a.locator('#content')).toContainText('Practice exam');
  await tab(b, 'Files');
  await expect(b.locator('#content')).toContainText('Practice exam', { timeout: 30_000 });
  const items = await firestoreAdmin('GET', `studyGroups/${code}/items`);
  expect((items.documents || []).map(d => plain({ mapValue: { fields: d.fields } })).map(i => [i.kind, i.title])).toEqual([['link', 'Practice exam']]);

  aConsole.expectClean();
  bConsole.expectClean();
});
