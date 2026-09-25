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
  await page.getByRole('button', { name: '+ Add course' }).click();
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
