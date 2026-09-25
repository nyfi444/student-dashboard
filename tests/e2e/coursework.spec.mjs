/* ── A semester, the way a student actually builds one ─────────────
   Add a class, put work against it, tick the work off. This is the
   product's spine: every other feature hangs off a course and an
   assignment existing, and all of it runs through the same modal,
   state and render path whether the person is paying or not.

   Signed out the app keeps everything in memory (see isDemoMode in
   js/state.js), so these write nothing and need no accounts. The same
   work reaching a paying student's account is account.spec.mjs.
──────────────────────────────────────────────────────────────── */
import { test, expect } from '@playwright/test';
import { openApp, navTo } from './helpers.mjs';

const COURSE = { name: 'Cell Biology', code: 'BIO 210', credits: '4' };

/* Fills in the add-course modal and saves. */
async function addCourse(page, course = COURSE) {
  await navTo(page, 'courses');
  await page.getByRole('button', { name: '+ Add course' }).click();
  const modal = page.locator('#modal');
  await expect(modal.locator('h3')).toHaveText('Add course');
  await modal.locator('#cf-name').fill(course.name);
  await modal.locator('#cf-code').fill(course.code);
  await modal.locator('#cf-credits').fill(course.credits);
  await modal.getByRole('button', { name: 'Save course' }).click();
  await expect(modal).toBeHidden();
}

test('a course can be added, and shows up everywhere it should', async ({ page }) => {
  const console_ = await openApp(page);
  await addCourse(page);

  // On its own page…
  await expect(page.locator('.course-card')).toHaveCount(1);
  await expect(page.locator('.course-card')).toContainText(COURSE.code);
  await expect(page.locator('.course-card')).toContainText(COURSE.name);
  // …in the page header's summary…
  await expect(page.locator('#content')).toContainText('4 credits');
  // …and in the sidebar, under Courses.
  await expect(page.locator('#sidebar .nav-class')).toContainText(COURSE.code);

  console_.expectClean();
});

test('a course opens its own page', async ({ page }) => {
  const console_ = await openApp(page);
  await addCourse(page);
  await page.locator('.course-card').click();
  await expect(page.locator('#content')).toContainText(COURSE.name);
  console_.expectClean();
});

test('work can be added to a course and ticked off', async ({ page }) => {
  const console_ = await openApp(page);
  await addCourse(page);

  await navTo(page, 'assignments');
  await page.getByRole('button', { name: '+ Add assignment' }).click();
  const modal = page.locator('#modal');
  await expect(modal.locator('h3')).toHaveText('New assignment');
  await modal.locator('#af-title').fill('Lab report 1');
  await expect(modal.locator('#af-course')).toHaveValue(/.+/); // the course we just made
  await modal.locator('#af-type').selectOption('assignment');
  await modal.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(modal).toBeHidden();

  const row = page.locator('#content').getByText('Lab report 1').first();
  await expect(row).toBeVisible();

  // Tick it off by the same control a student uses, found the way a screen
  // reader would find it.
  const tick = page.getByRole('checkbox', { name: /Mark Lab report 1 as done/i });
  await expect(tick).toHaveAttribute('aria-checked', 'false');
  await tick.click();

  // Done work leaves the to-do view, which is the default.
  await expect(page.getByRole('checkbox', { name: /Mark Lab report 1 as done/i })).toHaveCount(0);
  // And is there under Done.
  await page.getByRole('button', { name: /^Done/ }).first().click();
  await expect(page.locator('#content')).toContainText('Lab report 1');
  await expect(page.getByRole('checkbox', { name: /Mark Lab report 1 as not done/i })).toHaveAttribute('aria-checked', 'true');

  console_.expectClean();
});

test('adding an exam says exam, not assignment', async ({ page }) => {
  const console_ = await openApp(page);
  await addCourse(page);

  await navTo(page, 'exams');
  await page.getByRole('button', { name: '+ Add exam' }).first().click();
  const modal = page.locator('#modal');
  await expect(modal.locator('h3')).toHaveText('New exam');
  await expect(modal.locator('#af-type')).toHaveValue('exam');
  // The heading follows the Type field if it changes.
  await modal.locator('#af-type').selectOption('quiz');
  await expect(modal.locator('h3')).toHaveText('New quiz');
  await modal.locator('#af-type').selectOption('exam');
  await modal.locator('#af-title').fill('Midterm 1');
  await modal.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(modal).toBeHidden();
  await expect(page.locator('.toast').last()).toContainText('Exam added');
  await expect(page.locator('#content')).toContainText('Midterm 1');

  console_.expectClean();
});

test('an empty semester says what to do next rather than showing nothing', async ({ page }) => {
  await openApp(page);
  await navTo(page, 'courses');
  await expect(page.locator('#content')).toContainText('Add your classes');
  await expect(page.getByRole('button', { name: /Set up my semester/i })).toBeVisible();
});
