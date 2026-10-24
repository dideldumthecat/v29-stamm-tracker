import { test, expect } from '@playwright/test'

// Smoke test: the app shell renders
test('shows the app title', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('h1')).toHaveText('V29 Stamm-Tracker')
})

// Stamm screen at 375 px: iOS Safari used to let the date input overflow the page.
test('stamm screen has no horizontal scroll and equal date/choice fields', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto('/timber-item/85')
  const date = page.locator('input[type="date"]')
  const choice = page.locator('select').first()
  await expect(date).toBeVisible()

  const noOverflow = await page
    .locator('html')
    .evaluate((root) => root.scrollWidth <= root.clientWidth)
  expect(noOverflow).toBe(true)

  const [d, c] = [await date.boundingBox(), await choice.boundingBox()]
  expect(d!.width).toBeCloseTo(c!.width, 0)
  expect(d!.x).toBeCloseTo(c!.x, 0)
  expect(d!.height).toBeCloseTo(52, 0)
  expect(c!.height).toBeCloseTo(52, 0)
})
