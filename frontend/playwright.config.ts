import { defineConfig, devices } from '@playwright/test'

/**
 * E2E tests run inside the DDEV web container against a production build (`vite preview`), not the dev server:
 * no on-demand compiling, so the first test after a start is as fast as the last. Built with `--mode test`
 * (.env.test: fake API) into its own folder, so it never ends up in backend/public like `npm run build`.
 * Playwright builds and starts it itself and stops it after the run.
 * localhost counts as a secure context, so service worker and camera APIs are available.
 * The service worker stays on, as in production: every test gets a fresh browser context, so no new version is ever
 * waiting, so the automatic update (which would reload the page) never triggers.
 * Failures stay visible: no retries locally, and every failed test leaves a trace and screenshot (test-results/).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30 * 1000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // `list` names every test (and project) as it finishes, so failures show up in the terminal; the HTML report stays.
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  webServer: {
    command:
      'npx vite build --mode test --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port 4173 --strictPort',
    url: 'http://localhost:4173',
    // Always a fresh build: a server left running could serve an outdated one.
    reuseExistingServer: false,
    timeout: 120 * 1000,
  },

  // Target devices: iPhone (WebKit as closest approximation of iOS Safari) and Android (Chromium)
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 14'] } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
  ],
})
