import { test, expect } from '@playwright/test'

// Every path below /admin/ gets the shell; the router shows the placeholder.
for (const path of ['/admin/', '/admin/x']) {
  test(`shows the placeholder at ${path}`, async ({ page }) => {
    await page.goto(path)
    await expect(page.locator('h1')).toHaveText('V29 Stamm-Tracker – Administration')
  })
}
