/* ── Quick add, through the keyboard the way it is used ────────────
   tests/run.mjs already checks parseQuickAdd hard, in isolation. What it
   cannot check is that the parser is still wired to anything: the
   command palette reads the typed text, shows what it understood, and
   writes the result into state. A regression in that wiring passes every
   node test and is the whole feature gone.
──────────────────────────────────────────────────────────────── */
import { test, expect } from '@playwright/test';
import { openApp, navTo } from './helpers.mjs';

async function addCourse(page) {
  await navTo(page, 'courses');
  await page.getByRole('button', { name: '+ Add course' }).click();
  await page.locator('#modal #cf-name').fill('Cell Biology');
  await page.locator('#modal #cf-code').fill('BIO 210');
  await page.locator('#modal').getByRole('button', { name: 'Save course' }).click();
  await expect(page.locator('#modal')).toBeHidden();
}

async function openPalette(page, text) {
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.locator('#cmdk-input');
  await expect(input).toBeFocused();
  await input.fill(text);
  return input;
}

test('typing a deadline in plain English files it against the right class', async ({ page }) => {
  const console_ = await openApp(page);
  await addCourse(page);

  await openPalette(page, 'bio 210 lab report friday 5pm');

  // The palette says what it understood before anything is created. This is
  // the parser's output on screen, which is the part a student trusts.
  const offer = page.locator('.cmdk-item', { hasText: 'Add' });
  await expect(offer).toContainText(/lab report/i);
  await expect(offer).toContainText('BIO 210');
  await expect(offer).toContainText('5:00');
  await offer.click();

  await expect(page.locator('.toast-stack')).toContainText('BIO 210');

  await navTo(page, 'assignments');
  const row = page.locator('#content').getByText(/lab report/i).first();
  await expect(row).toBeVisible();
  // It landed with a real due date, not in the "No due date" bucket.
  await expect(page.locator('#content')).not.toContainText('No due date');
  console_.expectClean();
});

test('a line with no class becomes a to-do, not an assignment', async ({ page }) => {
  const console_ = await openApp(page);
  await openPalette(page, 'call the registrar tomorrow');

  const offer = page.locator('.cmdk-item', { hasText: 'Add' });
  await expect(offer).toContainText('as a to-do');
  await offer.click();

  await navTo(page, 'todos');
  await expect(page.locator('#content')).toContainText(/call the registrar/i);
  console_.expectClean();
});

test('the palette finds what is already there', async ({ page }) => {
  const console_ = await openApp(page);
  await addCourse(page);

  await openPalette(page, 'Cell Bio');
  await expect(page.locator('.cmdk-item').first()).toContainText('Cell Biology');
  await page.keyboard.press('Enter');
  await expect(page.locator('#content')).toContainText('Cell Biology');

  await page.keyboard.press('Escape');
  console_.expectClean();
});
