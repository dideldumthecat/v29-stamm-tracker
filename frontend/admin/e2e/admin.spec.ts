import { test, expect, type Page } from '@playwright/test'

/**
 * The API is imitated in the browser (no backend needed): POST/DELETE /api/session and GET /api/admin/me
 * behave like the real ones, with one code per role.
 */
async function fakeApi(page: Page) {
  const codes: Record<string, string> = { 'K7QM-4XHT-9RDP': 'admin', 'W3ZV-8NBC-2F6G': 'user' }
  let role: string | null = null
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const call = `${request.method()} ${new URL(request.url()).pathname}`
    if (call === 'POST /api/session') {
      const granted = codes[request.postDataJSON().token]
      if (!granted) return route.fulfill({ status: 401 })
      role = granted
      return route.fulfill({ json: { user: { id: 'x', name: 'Ada' } } })
    }
    if (call === 'DELETE /api/session') {
      role = null
      return route.fulfill({ status: 204 })
    }
    if (call === 'GET /api/admin/me') {
      if (!role) return route.fulfill({ status: 401 })
      if (role === 'user') return route.fulfill({ status: 403 })
      return route.fulfill({ json: { user: { id: 'x', name: 'Ada', role } } })
    }
    return route.fulfill({ status: 404 })
  })
}

async function signIn(page: Page, code: string) {
  await page.getByLabel('Einladungscode').fill(code)
  await page.getByRole('button', { name: 'Anmelden' }).click()
}

test.beforeEach(async ({ page }) => fakeApi(page))

for (const path of ['/admin/', '/admin/x']) {
  test(`${path} leads to the sign-in and, after signing in, back to the page`, async ({ page }) => {
    await page.goto(path)
    await expect(page).toHaveURL(/\/admin\/login\?redirect=/)

    await signIn(page, 'K7QM4XHT9RDP')

    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.locator('h1')).toHaveText('V29 Stamm-Tracker – Administration')
    await expect(page.locator('header')).toContainText('Ada')
  })
}

test('formats the code while typing and refuses an incomplete one without asking the server', async ({
  page,
}) => {
  let asked = false
  await page.route('**/api/session', (route) => ((asked = true), route.fulfill({ status: 401 })))
  await page.goto('/admin/login')
  const field = page.getByLabel('Einladungscode')

  await field.pressSequentially('k7qm4')
  await expect(field).toHaveValue('K7QM-4')
  await field.press('Backspace')
  await expect(field).toHaveValue('K7QM')

  await field.fill('k7qm 4xht')
  await expect(field).toHaveValue('K7QM-4XHT')
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('alert')).toHaveText('Kein Einladungscode erkannt')
  expect(asked).toBe(false)
})

test('an unknown code is refused', async ({ page }) => {
  await page.goto('/admin/login')
  await signIn(page, 'AAAA-AAAA-AAAA')
  await expect(page.getByRole('alert')).toHaveText('Code unbekannt oder gesperrt.')
  await expect(page).toHaveURL(/\/admin\/login/)
})

test('a code of the role user has no access, on any page', async ({ page }) => {
  await page.goto('/admin/x')
  await signIn(page, 'w3zv8nbc2f6g')
  await expect(page.getByRole('alert')).toHaveText(
    'Dieser Code hat keinen Zugang zur Administration.',
  )

  await page.goto('/admin/x')
  await expect(page).toHaveURL(/\/admin\/login/)
})

test('signing out leads every page back to the sign-in', async ({ page }) => {
  await page.goto('/admin/')
  await signIn(page, 'K7QM4XHT9RDP')
  await page.getByRole('button', { name: 'Abmelden' }).click()
  await expect(page).toHaveURL(/\/admin\/login$/)

  await page.goto('/admin/x')
  await expect(page).toHaveURL(/\/admin\/login\?redirect=/)
})
