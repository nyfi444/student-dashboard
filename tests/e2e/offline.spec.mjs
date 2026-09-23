/* ── The app still opens on a bad campus connection ────────────────
   The service worker is the difference between "the library wifi
   dropped" and "my planner is gone the morning something is due." It
   is also the piece nothing else tests: sw.js keeps its own copy of the
   file list in index.html, and the two drifting apart is silent until
   somebody is offline.
──────────────────────────────────────────────────────────────── */
import { test, expect } from '@playwright/test';
import { openApp } from './helpers.mjs';

// Chromium only: WebKit's service-worker support under Playwright does not
// reliably serve an offline reload, and testing the same guarantee twice in
// two engines is not worth a flaky suite.
test.skip(({ browserName }) => browserName !== 'chromium', 'service worker offline test runs in Chromium');

test('once it has been opened, it opens again with no network', async ({ page, context }) => {
  await openApp(page);

  // Wait for the worker to be active AND to have finished filling its cache;
  // being active happens first, and reloading in between would race it.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(async () => page.evaluate(async () => {
    const keys = await caches.keys();
    if (!keys.length) return 0;
    const cache = await caches.open(keys[0]);
    return (await cache.keys()).length;
  }), { message: 'the service worker never cached the app shell', timeout: 20_000 }).toBeGreaterThan(20);

  await context.setOffline(true);
  await page.reload();

  // The whole app, from cache: sidebar, nav, and a page rendered into it.
  await expect(page.locator('#sidebar [data-nav="dashboard"]')).toBeAttached();
  await expect(page.locator('#sidebar h1')).toHaveText('Semester HQ');
  await expect(page.locator('#content')).not.toBeEmpty();

  await context.setOffline(false);
});

test('every script index.html loads is one the service worker keeps', async ({ page }) => {
  // The same check tests/run.mjs makes without a browser, made here against
  // what the browser actually requested — so a file added to index.html and
  // forgotten in sw.js fails twice, before and after the deploy.
  const requested = new Set();
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.origin === new URL(page.url() || 'http://localhost').origin || url.pathname.endsWith('.js')) {
      if (url.pathname.startsWith('/js/')) requested.add(url.pathname.slice(1));
    }
  });
  await openApp(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });

  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const cache = await caches.open(keys[0]);
    return (await cache.keys()).map(r => new URL(r.url).pathname.slice(1));
  });
  const uncached = [...requested].filter(p => !cached.includes(p));
  expect(uncached, `these run in the app but are not in sw.js APP_SHELL, so they vanish offline:\n${uncached.join('\n')}`).toEqual([]);
});
