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

// Flow: create a stem, record an inheritable value, add a beam, see it inherited, override it.
test('beam inherits a stem value and can override it', async ({ page }) => {
  await page.goto('/')
  for (const digit of '1777') {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  await page.getByRole('button', { name: /öffnen/i }).click()

  const holzart = page.getByLabel('Holzart')
  await holzart.selectOption({ label: 'Traubeneiche' })
  await page.getByRole('button', { name: 'Stamm anlegen & speichern' }).click()
  await expect(page.getByText('Traubeneiche')).toBeVisible()

  // Adding stays on the stem; the new beam is listed right below.
  await page.getByRole('button', { name: 'Balken 01777-A hinzufügen' }).click()
  await expect(page.getByText('Balken 01777-A angelegt')).toBeVisible()
  await expect(page.locator('h1')).toContainText('STAMM')
  await page.locator('a[href="/timber-item/1777-A"]').click()
  await expect(page.locator('h1')).toContainText('BALKEN')
  await expect(page.locator('h1')).toContainText('01777-A')
  const holzartField = page.locator('section', { hasText: 'Holzart' }).first()
  await expect(holzartField).toContainText('Traubeneiche')
  await expect(holzartField).toContainText('vom Stamm')

  await page.getByRole('button', { name: 'Holzart ändern' }).click()
  await page.getByLabel('Holzart').selectOption({ label: 'Stieleiche' })
  await page.getByRole('button', { name: 'Speichern', exact: true }).click()
  await expect(holzartField).toContainText('Stieleiche')
  await expect(holzartField).not.toContainText('vom Stamm')

  // The stem lists the beam and is read-only now.
  await page.getByRole('link', { name: /Aus Stamm/ }).click()
  await expect(page.getByRole('link', { name: /01777-A/ })).toContainText('Stieleiche')
  await expect(page.getByText('Aufgeteilter Stamm')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Holzart ändern' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toHaveCount(0)
})

test('beam letters run to Z, are never reused, and stop after 26', async ({ page }) => {
  await page.goto('/timber-item/1888')
  await page.getByRole('button', { name: 'Balken 01888-A hinzufügen' }).click()
  await page.getByRole('button', { name: 'Balken 1888-A entfernen' }).click()
  await page.getByRole('button', { name: 'Balken entfernen', exact: true }).click()
  await expect(page.getByRole('link', { name: /01888-A/ })).toHaveCount(0)

  for (let count = 1; count < 25; count++) {
    await page.getByRole('button', { name: /^Balken \d+-[A-Z] hinzufügen$/ }).click()
  }
  await page.getByRole('button', { name: 'Balken 01888-Z hinzufügen' }).click()
  await expect(page.getByRole('button', { name: 'Balken hinzufügen' })).toBeDisabled()
  await expect(page.getByText('Höchstens 26 Balken je Stamm')).toBeVisible()
})
