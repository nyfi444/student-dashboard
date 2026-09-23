import { defineConfig, devices } from '@playwright/test';

/* The app is a static site with no build step, so the "server" is just a
   file server over the repo root — the same files GitHub Pages serves.
   localhost counts as a secure context, so the service worker, the
   clipboard and Firebase all behave as they do in production. */
const PORT = Number(process.env.E2E_PORT || 7441);

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  // A failing browser test is nearly always a real failure; a retry that
  // passes hides a race rather than fixing it. One retry on CI only, where
  // a cold runner genuinely is slower.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL || `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Most students open this on a phone. The sidebar collapses and several
    // pages lay out differently, so the boot tests run here too.
    { name: 'phone', use: { ...devices['iPhone 13'] }, testMatch: 'boot.spec.mjs' },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: `python3 -m http.server ${PORT} --directory ../..`,
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
