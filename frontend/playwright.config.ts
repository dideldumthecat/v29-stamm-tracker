import { defineConfig, devices } from '@playwright/test'

/**
 * E2E tests run inside the DDEV web container against the Vite dev server,
 * which already runs there as a daemon (see .ddev/config.vite.yaml) – so no `webServer` here.
 * localhost counts as a secure context, so service worker and camera APIs are available.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30 * 1000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },

  // Target devices: iPhone (WebKit as closest approximation of iOS Safari) and Android (Chromium)
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 14'] } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
  ],
})
