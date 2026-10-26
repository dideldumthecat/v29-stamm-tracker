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
  await page.getByRole('button', { name: 'Stamm anlegen & schließen' }).click()
  // Saving closes the stem: back on the start screen, the toast is still visible.
  await expect(page.getByText('Stamm 01777 gespeichert')).toBeVisible()
  await expect(page.locator('h1')).toHaveText('V29 Stamm-Tracker')
  for (const digit of '1777') {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  await page.getByRole('button', { name: /öffnen/i }).click()
  await expect(page.getByText('Traubeneiche')).toBeVisible()

  // Adding stays on the stem; the new beam is listed right below.
  await page.getByRole('button', { name: 'Balken 01777-A hinzufügen' }).click()
  await expect(page.locator('a[href="/timber-item/1777-A"]')).toBeVisible()
  await expect(page.locator('h1')).toContainText('STAMM')
  await expect(page.locator('body > div > [role="status"]')).toHaveCount(0)
  await page.locator('a[href="/timber-item/1777-A"]').click()
  await expect(page.locator('h1')).toContainText('BALKEN')
  await expect(page.locator('h1')).toContainText('01777-A')
  const holzartField = page.locator('section', { hasText: 'Holzart' }).first()
  await expect(holzartField).toContainText('Traubeneiche')
  await expect(holzartField).toContainText('vom Stamm')

  await page.getByRole('button', { name: 'Holzart ändern' }).click()
  await page.getByLabel('Holzart').selectOption({ label: 'Stieleiche' })
  await page.getByRole('button', { name: 'Speichern & schließen' }).click()

  // Saving closes the beam: back on its stem, which lists the beam and is read-only now.
  await expect(page.getByText('Balken 01777-A gespeichert')).toBeVisible()
  await expect(page.locator('h1')).toContainText('STAMM')
  await expect(page.getByRole('link', { name: /01777-A/ })).toContainText('Stieleiche')
  await expect(page.getByText('Aufgeteilter Stamm')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Holzart ändern' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Speichern/ })).toHaveCount(0)
})

test('beam letters run to Z, are reused after removal, and stop after 26', async ({ page }) => {
  await page.goto('/timber-item/1888')
  await page.getByRole('button', { name: 'Balken 01888-A hinzufügen' }).click()
  await page.getByRole('button', { name: 'Balken 1888-A entfernen' }).click()
  await page.getByRole('button', { name: 'Balken entfernen', exact: true }).click()
  await expect(page.getByRole('link', { name: /01888-A/ })).toHaveCount(0)

  for (let count = 0; count < 25; count++) {
    await page.getByRole('button', { name: /^Balken \d+-[A-Z] hinzufügen$/ }).click()
  }
  await page.getByRole('button', { name: 'Balken 01888-Z hinzufügen' }).click()
  await expect(page.getByRole('button', { name: 'Balken hinzufügen' })).toBeDisabled()
  await expect(page.getByText('Höchstens 26 Balken je Stamm')).toBeVisible()
})

// Narrowest supported phone: both save labels stay on one line.
test('save labels fit on one line at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  for (const [path, label] of [
    ['/timber-item/42', 'Stamm anlegen & schließen'],
    ['/timber-item/123', 'Speichern & schließen'],
  ]) {
    await page.goto(path)
    const button = page.getByRole('button', { name: label })
    await expect(button).toBeVisible()
    const lines = await button.evaluate((element) => {
      const range = element.ownerDocument.createRange()
      range.selectNodeContents(element)
      return range.getClientRects().length
    })
    expect(lines).toBe(1)
  }
})

test('invalid input keeps the item open and shows the error', async ({ page }) => {
  await page.goto('/timber-item/43')
  await page.locator('input[inputmode="decimal"]').fill('34abc')
  await page.getByRole('button', { name: 'Stamm anlegen & schließen' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.locator('h1')).toContainText('STAMM')
})

const SIGNED_OUT = () => localStorage.setItem('fake-api', 'signed-out')

test('signs in with a code pasted from a messenger', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(SIGNED_OUT)
  await page.reload()
  await expect(page.getByRole('button', { name: '1', exact: true })).toHaveCount(0)
  await page
    .getByLabel('Einladungscode oder Link')
    .fill('Hallo Alexander,\ndein Zugang: https://v29.example/invite#k7qm–4xht–9rdp – viel Spaß')
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByText('Alexander · Letzter Sync')).toBeVisible()
  await expect(page.getByRole('button', { name: '1', exact: true })).toBeVisible()
})

test('a 401 on sync keeps the queue and syncs after signing in again', async ({ page }) => {
  await page.goto('/timber-item/1555')
  await page.getByLabel('Holzart').selectOption({ label: 'Traubeneiche' })
  await page.getByRole('button', { name: 'Stamm anlegen & schließen' }).click()
  await page.evaluate(SIGNED_OUT)

  await page.goto('/sync')
  await page.getByRole('button', { name: 'Jetzt synchronisieren' }).click()
  await expect(page.getByRole('alert')).toContainText('nicht (mehr) angemeldet')
  await expect(page.getByRole('alert')).toContainText('2 Einträge bleiben')
  // The queue survives a reload, not just the open page.
  await page.reload()
  await expect(page.locator('h1')).toHaveText('Synchronisierung (2)')
  await page.getByRole('button', { name: 'Jetzt synchronisieren' }).click()

  await page.getByLabel('Einladungscode oder Link').fill('K7QM-4XHT-9RDP')
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByText('2 Einträge übertragen')).toBeVisible()
})

test('invite link in iPhone Safari shows instructions instead of redeeming', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone', 'iPhone Safari only')
  await page.goto('/')
  await page.evaluate(SIGNED_OUT)
  await page.goto('/invite#K7QM-4XHT-9RDP')
  await expect(page.getByText('„Zum Home-Bildschirm“')).toBeVisible()
  await expect(page.getByText('K7QM-4XHT-9RDP', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Code kopieren' })).toBeVisible()
  // Not redeemed: the fake still has no session.
  expect(await page.evaluate(() => localStorage.getItem('fake-api'))).toBe('signed-out')
})

test('invite link elsewhere is redeemed right away', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'iphone', 'not iPhone Safari')
  await page.goto('/')
  await page.evaluate(SIGNED_OUT)
  await page.goto('/invite#K7QM-4XHT-9RDP')
  await expect(page.locator('h1')).toHaveText('V29 Stamm-Tracker')
  await expect(page.getByText('Alexander · Letzter Sync')).toBeVisible()
})

test('sync without pending changes offers to refresh the data', async ({ page }) => {
  await page.goto('/sync')
  await expect(
    page.getByRole('heading', { name: 'Keine Änderungen auf diesem Gerät' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Daten aktualisieren' }).click()
  await expect(page.getByRole('heading', { name: 'Synchronisiert' })).toBeVisible()
})
