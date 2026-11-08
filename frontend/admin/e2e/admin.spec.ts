import { test, expect, type Locator, type Page } from '@playwright/test'

import { activityAnswer } from '../src/__tests__/fakeActivity'

/**
 * The API is imitated in the browser (no backend needed): POST/DELETE /api/session and GET /api/admin/me
 * behave like the real ones, with one code per role; GET /api/admin/activity answers from the fixture of the
 * 31 October (4 entries per page, so that "Ältere laden" has something to load).
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
    if (call === 'GET /api/admin/activity') {
      if (!role) return route.fulfill({ status: 401 })
      const answer = activityAnswer(new URL(request.url()).searchParams, 4)
      return answer ? route.fulfill({ json: answer }) : route.fulfill({ status: 400 })
    }
    return route.fulfill({ status: 404 })
  })
}

async function signIn(page: Page, code: string) {
  await page.getByLabel('Einladungscode').fill(code)
  await page.getByRole('button', { name: 'Anmelden' }).click()
}

test.beforeEach(async ({ page }) => fakeApi(page))

for (const [path, landing, heading] of [
  ['/admin/', '/admin/aktivitaet', 'Aktivität'],
  ['/admin/x', '/admin/x', 'V29 Stamm-Tracker – Administration'],
]) {
  test(`${path} leads to the sign-in and, after signing in, back to the page`, async ({ page }) => {
    await page.goto(path)
    await expect(page).toHaveURL(/\/admin\/login\?redirect=/)

    await signIn(page, 'K7QM4XHT9RDP')

    await expect(page).toHaveURL(new RegExp(`${landing}$`))
    await expect(page.locator('h1')).toHaveText(heading)
    await expect(page.locator('header')).toContainText('Ada')
  })
}

test('the frame: active navigation item, credit, and one 1280px column from header to footer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 900 })
  await page.goto('/admin/login')
  await expect(page.locator('header')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Alexander Summa' })).toBeVisible()
  await signIn(page, 'K7QM4XHT9RDP')

  await expect(page.getByRole('navigation').getByRole('link')).toHaveCount(1)
  await expect(page.getByRole('link', { name: 'Aktivität' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  const left = (locator: Locator) =>
    locator.first().evaluate((element) => element.getBoundingClientRect().left)
  // header brand, page heading and footer credit start on the same line: (1920 - 1280) / 2 + 32
  // The brand starts with the logo: an <svg> without role (decorative), so it is found inside the header landmark.
  const edge = 352
  expect(await left(page.getByRole('banner').locator('svg'))).toBe(edge)
  expect(await left(page.getByRole('heading', { level: 1 }))).toBe(edge)
  await expect(page.getByRole('contentinfo')).toContainText('Built with')
  await expect(page.getByRole('link', { name: 'Alexander Summa' })).toHaveAttribute(
    'href',
    'https://alexandersumma.de',
  )
})

for (const width of [1000, 390]) {
  test(`no horizontal scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/admin/')
    await signIn(page, 'K7QM4XHT9RDP')
    await expect(page.locator('header')).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBe(0)
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

test.describe('activity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/aktivitaet')
    await signIn(page, 'K7QM4XHT9RDP')
    await expect(page.locator('h1')).toHaveText('Aktivität')
  })

  test('shows the 31 October as entries per day with the number of entries', async ({ page }) => {
    await expect(page.getByText('6 Einträge', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Di, 03.11.2026' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sa, 31.10.2026' })).toBeVisible()
    await expect(page.getByRole('article').filter({ hasText: 'Alexander Barina' })).toBeVisible()
    await expect(page.getByText('11 Ereignisse · erfasst 11:46–11:48')).toBeVisible()
    await expect(page.getByText('3 Balken angelegt')).toBeVisible()
    await expect(page.getByText('Gesägt – 1 Stamm')).toBeVisible()
    await expect(page.getByText('2 Stämme storniert')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Details' })).toHaveCount(0)
  })

  test('opens the details with keyboard or click and turns the chevron', async ({ page }) => {
    const card = page.getByRole('article').filter({ hasText: 'Alexander Barina' })
    const summary = card.locator('summary')
    const details = card.locator('details')
    const chevron = summary.locator('svg')
    await expect(details).not.toHaveAttribute('open', '')
    await expect(summary).toHaveText(/Details anzeigen/)
    await expect(summary.getByText('Details ausblenden')).toBeHidden()

    await summary.focus()
    await page.keyboard.press('Enter')
    await expect(details).toHaveAttribute('open', '')
    await expect(summary.getByText('Details ausblenden')).toBeVisible()
    await expect(chevron).toHaveCSS('rotate', '180deg')
    await expect(card.getByText('00104-C')).toBeVisible()
    await expect(card.getByRole('rowheader', { name: 'Notiz', exact: true })).toBeVisible()
    await expect(card.getByText('105x145')).toBeVisible()

    await summary.click()
    await expect(details).not.toHaveAttribute('open', '')
  })

  test('keeps the attribute names on one line in the details, values may wrap', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 800 })
    const summaries = page.getByText('Details anzeigen')
    for (let i = (await summaries.count()) - 1; i >= 0; i--) await summaries.nth(i).click()
    const names = page.getByRole('rowheader')
    const count = await names.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      const name = names.nth(i)
      const value = name.locator('xpath=following-sibling::td')
      // one line of text (the cell itself is as tall as the row); the table never exceeds its card
      const lines = await name.evaluate((th) => {
        const range = document.createRange()
        range.selectNodeContents(th)
        return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size
      })
      expect(lines).toBe(1)
      const card = (await name.locator('xpath=ancestor::table').boundingBox())!
      const cell = (await value.boundingBox())!
      expect(cell.x + cell.width).toBeLessThanOrEqual(card.x + card.width + 1)
    }
  })

  test('puts the details link in the middle of the right half, level with the name', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 800 })
    const card = page.getByRole('article').filter({ hasText: 'Alexander Barina' })
    const box = (await card.boundingBox())!
    const summary = (await card.locator('summary').boundingBox())!
    const name = (await card.getByText('Alexander Barina', { exact: true }).boundingBox())!

    const rightHalf = box.x + box.width / 2
    const center = summary.x + summary.width / 2
    expect(center).toBeGreaterThan(rightHalf)
    expect(Math.abs(center - (rightHalf + box.width / 2 / 2))).toBeLessThan(40)
    expect(Math.abs(summary.y + summary.height / 2 - (name.y + name.height / 2))).toBeLessThan(3)
  })

  test('stacks the details under the bullet points on a narrow screen', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 800 })
    const card = page.getByRole('article').filter({ hasText: 'Alexander Barina' })
    const summary = (await card.locator('summary').boundingBox())!
    const list = (await card.locator('ul').boundingBox())!
    expect(summary.y).toBeGreaterThan(list.y + list.height)
    expect(Math.abs(summary.x - list.x)).toBeLessThan(25)
  })

  test('searches while typing without Enter, and the cross clears field and filter', async ({
    page,
  }) => {
    const field = page.getByLabel('Kennung', { exact: true })
    const clear = page.getByRole('button', { name: 'Kennung leeren' })
    await expect(clear).toHaveCount(0)

    await field.pressSequentially('128')
    await expect(page).toHaveURL(/tags=128/)
    await expect(page.getByText('1 Eintrag', { exact: true })).toBeVisible()
    await expect(field).toBeFocused()

    // the touch target is at least 44 x 44 px
    const box = (await clear.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(44)
    expect(box.height).toBeGreaterThanOrEqual(44)

    await clear.focus()
    await page.keyboard.press('Enter')
    await expect(page).not.toHaveURL(/tags=/)
    await expect(field).toHaveValue('')
    await expect(field).toBeFocused()
    await expect(clear).toHaveCount(0)
    await expect(page.getByText('6 Einträge', { exact: true })).toBeVisible()
  })

  test('shows the saw blade on a white card while loading and keeps the filters', async ({
    page,
  }) => {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    await page.route('**/api/admin/activity*', async (route) => {
      await held
      await route.fallback()
    })
    await page.getByLabel('Kennung', { exact: true }).fill('128')
    await page.getByLabel('Kennung', { exact: true }).press('Enter')

    const card = page.getByRole('status')
    await expect(card.getByRole('heading', { name: 'Moment' })).toBeVisible()
    await expect(card.getByText('Ergebnis wird zurechtgesägt')).toBeVisible()
    await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(card.locator('svg g')).not.toHaveCSS('animation-name', 'none')
    await expect(card.locator('h2')).toHaveCSS('font-size', '26px')
    await expect(page.getByLabel('Kennung', { exact: true })).toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)',
    )
    await expect(page.getByLabel('Von')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(page.getByLabel('Kennung', { exact: true })).toBeVisible()
    release()
    await expect(page.getByText('1 Eintrag', { exact: true })).toBeVisible()
  })

  test('does not rotate the saw blade with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/api/admin/activity*', () => new Promise(() => {}))
    await page.getByLabel('Kennung', { exact: true }).fill('128')
    await page.getByLabel('Kennung', { exact: true }).press('Enter')
    await expect(page.getByRole('status').locator('svg g')).toHaveCSS('animation-name', 'none')
  })

  test('shows "Waldesruh" for a filter nobody understands', async ({ page }) => {
    await page.getByLabel('Kennung', { exact: true }).fill('abc')
    await page.getByLabel('Kennung', { exact: true }).press('Enter')
    await expect(page.getByRole('heading', { name: 'Waldesruh' })).toBeVisible()
    await expect(
      page.getByText('Die Filter verstehen wir nicht. Kennung zum Beispiel 104 oder 100-120.'),
    ).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)

    await page.getByRole('status').getByRole('button', { name: 'Filter zurücksetzen' }).click()
    await expect(page).not.toHaveURL(/tags=/)
    await expect(page.getByText('6 Einträge', { exact: true })).toBeVisible()
  })

  test('loads older entries and then hides the button', async ({ page }) => {
    await expect(page.getByRole('time')).toHaveCount(4)
    await page.getByRole('button', { name: 'Ältere laden' }).click()
    await expect(page.getByRole('time')).toHaveCount(6)
    await expect(page.getByRole('button', { name: 'Ältere laden' })).toHaveCount(0)
  })

  test('keeps the filter in the URL through a reload and the back button', async ({ page }) => {
    await page.getByLabel('Kennung', { exact: true }).fill('128')
    await page.getByLabel('Kennung', { exact: true }).press('Enter')
    await page.getByLabel('Person').selectOption({ label: 'Florian Summa' })
    await expect(page).toHaveURL(/tags=128/)
    await expect(page).toHaveURL(/user=/)
    await expect(page.getByText('1 Eintrag', { exact: true })).toBeVisible()

    await page.reload()
    await expect(page.getByLabel('Kennung', { exact: true })).toHaveValue('128')
    await expect(page.getByLabel('Person')).toHaveValue(/-/)
    await expect(page.getByRole('listitem').filter({ hasText: /^2 Fotos$/ })).toBeVisible()
    await expect(page.getByRole('article').filter({ hasText: 'Alexander Barina' })).toHaveCount(0)

    await page.goBack()
    await expect(page).not.toHaveURL(/user=/)
    await page.goBack()
    await expect(page.getByText('6 Einträge')).toBeVisible()
  })

  test('shows "Waldesruh" for an empty result and clears the filter again', async ({ page }) => {
    await page.getByLabel('Kennung', { exact: true }).fill('999')
    await page.getByLabel('Kennung', { exact: true }).press('Enter')
    await expect(page.getByRole('heading', { name: 'Waldesruh' })).toBeVisible()
    await expect(page.getByText('Für diese Auswahl gibt es keine Einträge.')).toBeVisible()

    await page.getByRole('status').getByRole('button', { name: 'Filter zurücksetzen' }).click()
    await expect(page).not.toHaveURL(/tags=/)
    await expect(page.getByText('6 Einträge', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Waldesruh' })).toHaveCount(0)
  })

  test('the link in the filter bar resets all filters and is out of reach without one', async ({
    page,
  }) => {
    const link = page.getByRole('button', { name: 'Filter zurücksetzen' })
    const von = page.getByLabel('Von')
    const box = (await von.boundingBox())!
    await expect(link).toBeHidden()

    await page.getByLabel('Kennung', { exact: true }).fill('128')
    await page.getByLabel('Kennung', { exact: true }).press('Enter')
    await expect(page.getByText('1 Eintrag', { exact: true })).toBeVisible()
    await expect(link).toBeVisible()
    expect(await von.boundingBox()).toEqual(box)
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)

    await link.click()
    await expect(page).not.toHaveURL(/tags=/)
    await expect(page.getByText('6 Einträge', { exact: true })).toBeVisible()
    await expect(von).toBeFocused()
    await expect(link).toBeHidden()
  })

  test('keeps the text column narrow', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 })
    const text = page.locator('section').nth(1).locator('div.text-measure').first()

    expect((await text.boundingBox())!.width).toBeLessThanOrEqual(760)
  })
})

for (const width of [1000, 390]) {
  test(`the open details do not scroll the page at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/admin/aktivitaet')
    await signIn(page, 'K7QM4XHT9RDP')
    await page.getByText('Details anzeigen').nth(2).click()
    await expect(page.locator('details[open]')).toHaveCount(1)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBe(0)
  })
}
