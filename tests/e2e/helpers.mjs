/* Shared setup for every browser test.

   Two things every spec needs and neither should re-invent:

   1. A console watch. The app has no build step and no framework, so a
      typo in one file is a runtime error in the browser and nothing else
      catches it — not a linter, not a type checker, not the node tests.
      Any spec that opens a page gets its console watched, and anything
      red fails the test that caused it.
   2. A clean start. The app keeps a licensed device's data in
      localStorage, so a test that ran before must not be able to change
      what the next one sees.
*/
import { expect } from '@playwright/test';

/* Two Cloudflare services on these pages cannot work from localhost, both
   of them correctly: the analytics beacon checks the request origin, and
   the Turnstile widget only accepts the domains it is configured for
   (error 110200 is exactly that check doing its job — see the note on
   allowed origins in the Turnstile setup). Neither is a bug, and neither
   should be loosened so a test can pass.

   Rather than teach the console watch to recognise those two failures —
   Chromium and WebKit word them differently, and a filter loose enough to
   catch both would hide real CORS and third-party errors — the two are
   replaced: the beacon with nothing, Turnstile with a stub that has the
   same tiny API (render / getResponse / reset). The page then follows the
   same code path it does in production, and a token still reaches the
   Worker, which rejects a fake one. That last part is the boundary this
   suite deliberately does not cross. */
export async function stubExternals(page) {
  await page.route(/cloudflareinsights\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route(/challenges\.cloudflare\.com/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.turnstile = {
        render(target, opts) {
          const slot = typeof target === 'string' ? document.querySelector(target) : target;
          if (slot) { const box = document.createElement('div'); box.setAttribute('data-turnstile-stub', '1'); box.textContent = 'verification (stubbed in tests)'; slot.appendChild(box); }
          return 'stub-widget';
        },
        getResponse() { return 'stub-token'; },
        reset() {}, remove() {},
      };`,
    }));
}

/* Watches a page for anything that would show up as a red line in the
   console, and returns a function that asserts there was nothing.
   Deliberately unfiltered: if something new shows up here it is either a
   real bug or something worth an explicit decision, never a shrug. */
export function watchConsole(page) {
  const problems = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const where = msg.location()?.url || '';
    problems.push(`console.error: ${msg.text()}${where ? ` (${where})` : ''}`);
  });
  page.on('pageerror', (err) => problems.push(`uncaught: ${err.message}\n${err.stack || ''}`));
  page.on('requestfailed', (req) => problems.push(`request failed: ${req.url()} — ${req.failure()?.errorText || 'failed'}`));
  return {
    problems,
    expectClean() {
      expect(problems, `the browser console should be clean:\n${problems.join('\n')}`).toEqual([]);
    },
  };
}

/* Opens the app and waits until it has actually booted — the sidebar is
   rendered by render() at the end of initApp, so its nav being in the
   document is the real signal, not load or networkidle. Attached rather
   than visible: on a phone the sidebar starts off-screen. */
export async function openApp(page, path = '/index.html') {
  await stubExternals(page);
  const console_ = watchConsole(page);
  await page.goto(path);
  await expect(page.locator('#sidebar [data-nav="dashboard"]')).toBeAttached();
  return console_;
}

/* The app signed out keeps nothing (see isDemoMode in js/state.js), so
   every test starts from an empty semester without any cleanup step.
   This asserts that is really the case rather than assuming it. */
export async function expectDemoMode(page) {
  await expect(page.locator('.demo-bar')).toContainText('Nothing here is saved');
  const stored = await page.evaluate(() => localStorage.getItem('studentPlanner.v1'));
  expect(stored, 'signed out, the app must not write a student’s data to disk').toBeNull();
}

/* Clicks a sidebar entry by its route id (data-nav in js/app.js).
   The sidebar is off-screen on a phone, so this navigates the same way the
   button does rather than fighting the layout. */
export async function navTo(page, route) {
  const item = page.locator(`#sidebar [data-nav="${route}"]`);
  await expect(item).toBeAttached();
  await item.dispatchEvent('click');
}
