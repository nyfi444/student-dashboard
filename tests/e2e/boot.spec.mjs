/* ── The app opens, and every page in it renders ───────────────────
   The one failure that costs everything: a white screen. There is no
   build step, so the script list in index.html IS the dependency graph
   (its own comment says so), and one reordered or missing line takes the
   whole app down on every device at once. Nothing but a browser catches
   that, which is what these are for.

   These run on desktop and on a phone, because the sidebar and several
   pages lay out differently and a student is far more likely to be on
   the phone.
──────────────────────────────────────────────────────────────── */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, expectDemoMode, navTo, watchConsole } from './helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => readFileSync(join(root, f), 'utf8');

test('the app boots with a clean console', async ({ page }) => {
  const console_ = await openApp(page);
  await expect(page.locator('#sidebar h1')).toHaveText('Semester HQ');
  await expect(page.locator('#content')).toContainText('Let’s build your semester');
  console_.expectClean();
});

test('signed out, it says so and keeps nothing', async ({ page }) => {
  await openApp(page);
  await expectDemoMode(page);
  await expect(page.locator('.user-chip')).toContainText('Not signed in');
});

test('signed out, a reload really does keep nothing', async ({ page }) => {
  // The promise the demo bar makes. If a change ever made the signed-out app
  // persist, a shared library computer would keep the last person's semester
  // for the next one, and nothing on screen would say so.
  await openApp(page);
  await navTo(page, 'courses');
  await page.getByRole('button', { name: 'Add course', exact: true }).first().click();
  await page.locator('#modal #cf-name').fill('Kept By Mistake');
  await page.locator('#modal').getByRole('button', { name: 'Save course' }).click();
  await expect(page.locator('.course-card')).toContainText('Kept By Mistake');

  await page.reload();
  await expect(page.locator('#sidebar [data-nav="dashboard"]')).toBeAttached();
  await navTo(page, 'courses');
  await expect(page.locator('#content')).not.toContainText('Kept By Mistake');
  await expect(page.locator('#content')).toContainText('Add your classes');
});

/* Every route in js/app.js PAGES, driven through the sidebar the way a
   student would. A page function that throws leaves #content empty and
   the console red; both are failures here. */
const ROUTES = [
  ['dashboard', 'Dashboard'],
  ['calendar', 'Calendar'],
  ['todos', 'To-Do'],
  ['courses', 'Courses'],
  ['assignments', 'Assignments'],
  ['exams', 'Exams'],
  ['projects', 'Projects'],
  ['notebook', 'Notebook'],
  ['timer', 'Timer'],
  ['studytools', 'Flashcards'],
  ['studygroups', 'Study Groups'],
  ['orgs', 'Clubs'],
  ['career', 'Applications'],
];

test('every page renders', async ({ page }) => {
  const console_ = await openApp(page);
  for (const [route] of ROUTES) {
    await navTo(page, route);
    // Something was drawn, and it isn't an empty shell.
    await expect(page.locator('#content'), `the ${route} page rendered nothing`).not.toBeEmpty();
    const text = (await page.locator('#content').innerText()).trim();
    expect(text.length, `the ${route} page rendered no visible text`).toBeGreaterThan(20);
  }
  // Settings sits in the sidebar foot on a computer, and in the More panel on a phone.
  const more = page.locator('#sidebar .nav-more');
  if (await more.isVisible()) {
    await more.click();
    await page.locator('#modal .more-tile', { hasText: 'Settings' }).click();
  } else {
    await page.locator('#sidebar .nav-settings').click();
  }
  await expect(page.locator('#content')).toContainText('Settings');
  console_.expectClean();
});

/* Study groups and clubs are split across several files (js/spaces/,
   js/groups/, js/orgs/), each loaded in its place in index.html. The
   route pages above only draw the index; this opens the sample group and
   the sample club and every one of their tabs, which is where a missing
   or misordered file would throw. */
// The sample opens itself if it already exists, so a click lost to a
// redraw on a slow phone run is safe to repeat.
// label is the button's name; the four sample clubs are chips named
// exactly 'Club', 'Chapter', 'Sports team' and 'Honor society'.
async function openSample(page, label, tabs) {
  await expect(async () => {
    const btn = page.locator('#content').getByRole('button', { name: label, exact: true });
    if (await btn.isVisible()) await btn.click();
    await expect(tabs.first()).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
}
test('the sample study group and sample club open on every tab', async ({ page }) => {
  const console_ = await openApp(page);
  await navTo(page, 'studygroups');
  // :visible because a phone moves Chat out of the tab row into the
  // floating chat button (tested on its own below).
  const groupTabs = page.locator('#content [role="tab"]:visible');
  await openSample(page, 'Explore a sample group first', groupTabs);
  const gCount = await groupTabs.count();
  expect(gCount, 'the sample group shows its tabs').toBeGreaterThanOrEqual(5);
  for (let i = 0; i < gCount; i++) {
    await groupTabs.nth(i).click();
    await expect(groupTabs.nth(i)).toHaveAttribute('aria-selected', 'true');
    const text = (await page.locator('#content').innerText()).trim();
    expect(text.length, `group tab ${i} rendered no text`).toBeGreaterThan(40);
  }
  await navTo(page, 'orgs');
  const clubTabs = page.locator('#content [role="tab"]:visible');
  await openSample(page, 'Club', clubTabs);
  const cCount = await clubTabs.count();
  expect(cCount, 'the sample club shows its tabs').toBeGreaterThanOrEqual(5);
  for (let i = 0; i < cCount; i++) {
    await clubTabs.nth(i).click();
    await expect(clubTabs.nth(i)).toHaveAttribute('aria-selected', 'true');
    const text = (await page.locator('#content').innerText()).trim();
    expect(text.length, `club tab ${i} rendered no text`).toBeGreaterThan(40);
  }
  console_.expectClean();
});

/* The sample clubs open as an officer, with a strip that switches the
   preview to Member and back and opens the other samples. All of it is
   local to the tab. */
test('every sample club opens, and Previewing as switches officer and member', async ({ page }) => {
  const console_ = await openApp(page);
  await navTo(page, 'orgs');
  const tabs = page.locator('#content [role="tab"]:visible');
  await openSample(page, 'Chapter', tabs);
  await expect(page.locator('#content .space-title')).toHaveText('Kestrel House');
  const strip = page.locator('#content .space-sample');
  const admin = page.locator('#content [role="tab"]', { hasText: 'Admin' });
  await expect(admin).toHaveCount(1);
  await strip.getByRole('button', { name: 'Member', exact: true }).click();
  await expect(admin).toHaveCount(0);
  await expect(strip.getByRole('button', { name: 'Member', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await strip.getByRole('button', { name: 'Officer', exact: true }).click();
  await expect(admin).toHaveCount(1);
  await admin.click();
  await expect(page.locator('#content #org-attendance tbody tr')).not.toHaveCount(0);
  for (const [chip, name] of [['Sports team', 'Club Volleyball'], ['Honor society', 'Brightfield Honor Society'], ['Club', 'Women in Business']]) {
    await strip.getByRole('button', { name: chip, exact: true }).click();
    await expect(page.locator('#content .space-title')).toHaveText(name);
  }
  expect(await page.evaluate(() => state.orgs.filter(e => e.sample && e.local).length)).toBe(4);
  console_.expectClean();
});

/* RSVP (js/spaces/rsvp.js) on the local sample club: answering collapses
   the buttons into a pill, Change reopens them, and choosing the same
   answer again never clears it. A dues event asks for payment instead. */
test('the RSVP control answers, changes, never un-answers, and dues events ask for payment', async ({ page }) => {
  const console_ = await openApp(page);
  await navTo(page, 'orgs');
  const tabs = page.locator('#content [role="tab"]:visible');
  await openSample(page, 'Club', tabs);
  const ctl = page.locator('#content .space-hero .space-rsvp');
  await expect(ctl).toHaveCount(1);
  const change = ctl.getByRole('button', { name: /^Change your answer/ });
  if (await change.isVisible()) await change.click();
  await ctl.getByRole('button', { name: 'Going', exact: true }).click();
  await expect(ctl.locator('.space-rsvp-pill')).toHaveText('You’re going');
  await ctl.getByRole('button', { name: /^Change your answer/ }).click();
  await ctl.getByRole('button', { name: 'Can’t', exact: true }).click();
  await expect(ctl.locator('.space-rsvp-pill')).toHaveText('Can’t make it');
  await ctl.getByRole('button', { name: /^Change your answer/ }).click();
  await ctl.getByRole('button', { name: 'Going', exact: true }).click();
  await ctl.getByRole('button', { name: /^Change your answer/ }).click();
  await ctl.getByRole('button', { name: 'Going', exact: true }).click();
  await expect(ctl.locator('.space-rsvp-pill')).toHaveText('You’re going');
  const dues = await page.evaluate(() => {
    const o = findOrg(state.subRoute);
    const e = upcomingOrgEvents(o).find(x => x.category === 'deadline');
    showOrgEventModal(o.code, e.id);
    return e.title;
  });
  await expect(page.locator('#modal')).toContainText(dues);
  await expect(page.locator('#modal').getByRole('button', { name: 'Going', exact: true })).toHaveCount(0);
  await expect(page.locator('#modal').getByRole('link', { name: /Pay dues/ })).toHaveCount(1);
  console_.expectClean();
});

test('on a phone, a group or club page fits the screen and its chat button opens chat', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'the floating chat button is phone only');
  const console_ = await openApp(page);
  const noSideways = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'no sideways scroll').toBeLessThanOrEqual(0);
  for (const [route, label] of [['studygroups', 'Explore a sample group first'], ['orgs', 'Club']]) {
    await navTo(page, route);
    const fab = page.locator('#content .space-chat-fab');
    await openSample(page, label, fab);
    await noSideways();
    await expect(page.locator('#content [role="tab"]:visible', { hasText: /^Chat/ })).toHaveCount(0);
    await fab.click();
    await expect(page.locator('#content [role="tab"][aria-selected="true"]')).toHaveText(/^Chat/);
    await expect(fab).toHaveCount(0);
    await noSideways();
  }
  console_.expectClean();
});

test('on a phone, More opens every section the bottom bar leaves out', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'the bottom bar is phone only');
  const console_ = await openApp(page);
  const bar = page.locator('#sidebar');
  // Four sections and More, all on screen, nothing to scroll sideways to.
  await expect(bar.locator('.nav-item:visible')).toHaveCount(5);
  const nav = bar.locator('.sidebar-nav');
  expect(await nav.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

  const inBar = ['dashboard', 'calendar', 'todos', 'courses'];
  for (const [route, label] of ROUTES.filter(([r]) => !inBar.includes(r))) {
    await bar.locator('.nav-more').click();
    await page.locator('#modal .more-tile', { hasText: label }).first().click();
    await expect(page.locator('#modal-wrap')).not.toHaveClass(/show/);
    expect(await page.evaluate(() => state.route), `More did not open ${route}`).toBe(route);
    // More lights up while one of its sections is open.
    await expect(bar.locator('.nav-more')).toHaveClass(/active/);
  }
  await bar.locator('[data-nav="calendar"]').click();
  await expect(bar.locator('.nav-more')).not.toHaveClass(/active/);
  console_.expectClean();
});

test('the sidebar offers every section', async ({ page }) => {
  await openApp(page);
  for (const [route] of ROUTES) {
    await expect(page.locator(`#sidebar [data-nav="${route}"]`), `no sidebar entry for ${route}`).toHaveCount(1);
  }
});

// Safari could report a first install as an update, so a first visit reloaded
// itself about half a second in, cutting off Google sign-in mid-load. It only
// happened some of the time, so this watches a few seconds past the takeover.
test('a first visit does not reload itself when the offline worker takes over', async ({ page }) => {
  let loads = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) loads++; });
  const console_ = await openApp(page);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);
  await page.waitForTimeout(1500);
  expect(loads, 'the page reloaded itself on a first visit').toBe(1);
  console_.expectClean();
});

test('the service worker registers and names its cache after this build', async ({ page }) => {
  const version = (read('js/version.js').match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
  expect(version, 'js/version.js has no APP_VERSION').toBeTruthy();

  await openApp(page);
  const ready = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  expect(ready, 'the service worker never became active').toBe(true);

  // The cache name is what makes an installed app notice a deploy. If it
  // stops tracking APP_VERSION, home-screen apps stay on old code forever
  // and nothing on screen says so.
  await expect.poll(
    async () => page.evaluate(() => caches.keys()),
    { message: 'no cache named for this version', timeout: 15_000 },
  ).toContain(`shq-${version}`);
});
