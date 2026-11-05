import { defineConfig, devices } from '@playwright/test'

/**
 * E2E tests run inside the DDEV web container against a production build (`vite preview`, below /admin/),
 * built into its own folder so it never ends up in backend/public. Playwright builds and starts it itself.
 * The administration is desktop-first, but must stay usable on a phone: one project each.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30 * 1000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  webServer: {
    command:
      'npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port 4174 --strictPort',
    url: 'http://localhost:4174/admin/',
    reuseExistingServer: false,
    timeout: 120 * 1000,
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
})
