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

// Both emails go through the Worker, from our own sending domain, because
// Firebase's own sender lands in Gmail's Spam with its link switched off.
// The Worker needs a Turnstile solve, so there is one confirm step first.
test('an emailed sign-in link goes through the Worker, after the verification', async ({ page }) => {
  await stubExternals(page);
  const asked = [];
  await page.route(/\/auth-email$/, async (route) => {
    asked.push(JSON.parse(route.request().postData()));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.addInitScript(() => localStorage.setItem('shq_age_tos_confirmed', '1'));
  await page.goto('/login.html');
  await page.fill('#login-email-input', 'student@example.com');
  await page.getByRole('link', { name: /Email me a sign-in link/i }).click();
  await expect(page.locator('#login-body')).toContainText('student@example.com');
  await expect(page.locator('[data-turnstile-stub]')).toBeVisible();
  await page.getByRole('button', { name: /^Send$/ }).click();
  await expect(page.locator('#login-body')).toContainText('Check your inbox');
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatchObject({ kind: 'signin', email: 'student@example.com', turnstileToken: 'stub-token' });
  expect(asked[0].continueUrl).toMatch(/\/login\.html$/);
  expect(await page.evaluate(() => localStorage.getItem('shq_email_for_signin'))).toBe('student@example.com');
});

test('a password link the Worker refuses says why and goes back to the form', async ({ page }) => {
  await stubExternals(page);
  await page.route(/\/auth-email$/, (route) =>
    route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"Please complete the verification and try again."}' }));
  await page.goto('/login.html');
  await page.fill('#login-email-input', 'student@example.com');
  await page.getByRole('link', { name: /Forgot password/i }).click();
  await expect(page.locator('#login-body')).toContainText('a link to set your password');
  await page.getByRole('button', { name: /^Send$/ }).click();
  await expect(page.locator('#login-error')).toContainText('verification');
  await expect(page.locator('#login-email-input')).toHaveValue('student@example.com');
});
