/* ── The sign-in page ──────────────────────────────────────────────
   Nobody gets into a paid account without this page working, and it is
   the one page with a legal obligation on it: the age gate and the
   agreement to the Terms and Privacy Policy have to be in front of a
   student before an account exists, not after.

   Sign-in itself cannot be driven here: it needs a real Firebase
   account, a Google popup, or Stripe. What these check is that the page
   renders, offers every route on both doors (log in, and ?signup=1),
   and puts the age gate where it belongs on each.
──────────────────────────────────────────────────────────────── */
import { test, expect } from '@playwright/test';
import { stubExternals, watchConsole } from './helpers.mjs';

async function openLogin(page) {
  await stubExternals(page);
  const console_ = watchConsole(page);
  await page.goto('/login.html');
  await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeVisible();
  return console_;
}

test('the login page renders with a clean console', async ({ page }) => {
  const console_ = await openLogin(page);
  // The brand line. It is the first thing a student reads and it is decided;
  // this is here so a redesign has to change it on purpose.
  await expect(page.locator('h1')).toContainText('Your entire semester');
  await expect(page.locator('h1')).toContainText('finally');
  await expect(page.locator('h1')).toContainText('in one place');
  console_.expectClean();
});

test('both ways in are offered', async ({ page }) => {
  await openLogin(page);
  await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Log in$/ })).toBeVisible();
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveAttribute('autocomplete', 'current-password');
  // Accounts made before passwords existed still get in.
  await expect(page.getByRole('link', { name: /Forgot password/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Email me a sign-in link/i })).toBeVisible();
});

// Sign-up creates the account on the page and goes on to checkout. The
// agreement is a box on the form itself, so it is in front of the student
// before any account exists, by email or by Google.
test('sign-up asks for a password and the agreement, with no inbox step', async ({ page }) => {
  await stubExternals(page);
  const console_ = watchConsole(page);
  await page.goto('/login.html?signup=1');
  await expect(page.getByRole('button', { name: /Create account/i })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveAttribute('autocomplete', 'new-password');
  await expect(page.locator('#age-tos-check')).toBeVisible();
  await expect(page.locator('body')).toContainText('at least 13 years old');
  await expect(page.locator('body')).not.toContainText('Check your inbox');

  await page.fill('#login-email-input', 'new-student@example.com');
  await page.fill('#login-password-input', 'a-long-password');
  await page.getByRole('button', { name: /Create account/i }).click();
  await expect(page.locator('#login-error')).toContainText('13 or older');

  await page.getByRole('button', { name: /Continue with Google/i }).click();
  await expect(page.locator('#login-error')).toContainText('13 or older');
  console_.expectClean();
});

test('the two doors switch without a reload', async ({ page }) => {
  await openLogin(page);
  await page.getByRole('link', { name: /Create an account/i }).click();
  await expect(page).toHaveURL(/signup=1/);
  await expect(page.getByRole('button', { name: /Create account/i })).toBeVisible();
  await page.getByRole('link', { name: /^Log in$/ }).click();
  await expect(page.getByRole('button', { name: /^Log in$/ })).toBeVisible();
});

test('the legal links are there and point at the site', async ({ page }) => {
  await openLogin(page);
  await expect(page.locator('a[href$="privacy.html"]').first()).toHaveAttribute('href', /semester-hq\.com\/privacy\.html/);
  await expect(page.locator('a[href$="terms.html"]').first()).toHaveAttribute('href', /semester-hq\.com\/terms\.html/);
});

test('the age gate and the agreement come before an account does', async ({ page }) => {
  const console_ = await openLogin(page);
  await page.getByRole('button', { name: /Continue with Google/i }).click();

  // Nothing has been signed into yet: what a student sees first is the gate.
  await expect(page.locator('body')).toContainText('at least 13 years old');
  await expect(page.locator('body')).toContainText('Terms of Service');
  await expect(page.locator('body')).toContainText('Privacy Policy');
  await expect(page.getByRole('button', { name: /^Continue$/ })).toBeVisible();
  console_.expectClean();
});
