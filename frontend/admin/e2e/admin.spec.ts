import { test, expect, type Locator, type Page, type Route } from '@playwright/test'

import dashboardFixture from '@v29/shared/fixtures/dashboard-response.json' with { type: 'json' }
import keyFiguresFixture from '@v29/shared/fixtures/key-figures-response.json' with { type: 'json' }

import { activityAnswer } from '../src/__tests__/fakeActivity'
import { createFakeAttributes } from '../src/__tests__/fakeAttributes'
import { createFakeUsers } from '../src/__tests__/fakeUsers'
import { snapshotFixture, stemPhotos } from '../src/__tests__/fakeSnapshot'

/**
 * The API is imitated in the browser (no backend needed): POST/DELETE /api/session and GET /api/admin/me
 * behave like the real ones, with one code per role; GET /api/admin/activity answers from the fixture of the
 * 31 October (one page; the test of "Ältere laden" asks for smaller pages).
 */
async function fakeApi(page: Page) {
  const codes: Record<string, string> = {
    'K7QM-4XHT-9RDP': 'admin',
    'W3ZV-8NBC-2F6G': 'user',
    'S4PA-2DM1-N8QX': 'superadmin',
  }
  let role: string | null = null
  const attributes = createFakeAttributes()
  const users = createFakeUsers()
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const call = `${request.method()} ${path}`
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
      const answer = activityAnswer(new URL(request.url()).searchParams)
      return answer ? route.fulfill({ json: answer }) : route.fulfill({ status: 400 })
    }
    if (call === 'GET /api/snapshot') {
      return role ? route.fulfill({ json: snapshotFixture }) : route.fulfill({ status: 401 })
    }
    if (call === 'GET /api/admin/dashboard') {
      return role ? route.fulfill({ json: dashboardFixture }) : route.fulfill({ status: 401 })
    }
    if (/^GET \/api\/admin\/timber-items\/[^/]+\/key-figures$/.test(call)) {
      return role ? route.fulfill({ json: keyFiguresFixture }) : route.fulfill({ status: 401 })
    }
    if (path.startsWith('/api/admin/attributes')) {
      if (!role) return route.fulfill({ status: 401 })
      const answer = attributes.handle(request.method(), path, request.postDataJSON())
      return route.fulfill({ status: answer?.status ?? 404, json: answer?.json })
    }
    if (path.startsWith('/api/admin/users')) {
      if (!role) return route.fulfill({ status: 401 })
      const body = request.postData() ? request.postDataJSON() : undefined
      const answer = users.handle(request.method(), path, body, role)
      return route.fulfill({ status: answer?.status ?? 404, json: answer?.json })
    }
    if (call.startsWith('GET /api/photos/')) {
      // the second photo of the stem is not uploaded yet
      if (call.endsWith(stemPhotos[1])) return route.fulfill({ status: 404 })
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="#888"/></svg>'
      return route.fulfill({ body: svg, contentType: 'image/svg+xml' })
    }
    return route.fulfill({ status: 404 })
  })
}

async function signIn(page: Page, code: string) {
  await page.getByLabel('Einladungscode').fill(code)
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click()
}

test.beforeEach(async ({ page }) => fakeApi(page))

for (const [path, landing, heading] of [
  ['/admin/', '/admin/', 'Dashboard'],
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

test('no connection at the start: a retry instead of the sign-in, then the page with its filter', async ({
  page,
}) => {
  await page.goto('/admin/login')
  await signIn(page, 'K7QM4XHT9RDP')
  await expect(page.locator('h1')).toHaveText('Dashboard')

  // the last route handler wins: the call to /admin/me gets no answer until the handler is removed
  const noAnswer = (route: Route) => route.abort()
  await page.route('**/api/admin/me', noAnswer)
  await page.goto('/admin/activity?tags=104')
  await expect(page.getByRole('alert')).toContainText('keine Verbindung zum Server')
  await expect(page).toHaveURL(/\/admin\/activity\?tags=104$/)

  await page.unroute('**/api/admin/me', noAnswer)
  await page.getByRole('button', { name: 'Erneut versuchen' }).click()

  await expect(page.locator('h1')).toHaveText('Aktivität')
  await expect(page).toHaveURL(/\/admin\/activity\?tags=104$/)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

// the sticky bar with the count and the chips (ResultsBar)
// A filter button and its pop-up are named after the filter, plus the number of ticks once it is active ("Person", "Person 2").
const filterName = (name: string) => new RegExp(`^${name}( \\d+)?$`)

const resultsBar = (page: Page) => page.getByRole('region', { name: 'Ergebnisse', exact: true })

test('the frame: active navigation item, credit, and one 1280px column from header to footer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 900 })
  await page.goto('/admin/login')
  await expect(page.locator('header')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Alexander Summa', exact: true })).toBeVisible()
  await signIn(page, 'K7QM4XHT9RDP')

  // the sign-in lands on the dashboard, which has no navigation item
  await expect(page.locator('h1')).toHaveText('Dashboard')
  const navigation = page.getByRole('navigation')
  await expect(navigation.getByRole('link')).toHaveCount(3)
  await expect(navigation.locator('[aria-current]')).toHaveCount(0)
  await navigation.getByRole('link', { name: 'Aktivität', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Aktivität', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  // logo and title lead back
  await page.getByRole('link', { name: 'V29 Stamm-Tracker – Dashboard', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/$/)
  await expect(page.locator('h1')).toHaveText('Dashboard')
  const left = (locator: Locator) =>
    locator.first().evaluate((element) => element.getBoundingClientRect().left)
  // header brand, page heading and footer credit start on the same line: (1920 - 1280) / 2 + 32
  // The brand starts with the logo: an <svg> without role (decorative), so it is found inside the header landmark.
  const edge = 352
  expect(await left(page.getByRole('banner').locator('svg'))).toBe(edge)
  expect(await left(page.getByRole('heading', { level: 1 }))).toBe(edge)
  await expect(page.getByRole('contentinfo')).toContainText('Built with')
  await expect(page.getByRole('link', { name: 'Alexander Summa', exact: true })).toHaveAttribute(
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
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click()
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
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/login$/)

  await page.goto('/admin/x')
  await expect(page).toHaveURL(/\/admin\/login\?redirect=/)
})

test.describe('dashboard: stems by diameter', () => {
  const card = (page: Page) =>
    page.getByRole('region', { name: 'Stämme nach Mittendurchmesser', exact: true })
  const diameters = (page: Page) => card(page).getByRole('rowheader')
  const header = (page: Page, name: string) =>
    card(page).getByRole('columnheader', { name, exact: true })

  test('sorts by every column, a click turns the direction, the row without diameter stays last', async ({
    page,
  }) => {
    await page.goto('/admin/')
    await signIn(page, 'K7QM4XHT9RDP')

    await expect(header(page, 'Durchmesser')).toHaveAttribute('aria-sort', 'descending')
    await expect(diameters(page)).toHaveText([
      '38–39 cm',
      '36–37 cm',
      '34–35 cm',
      '32–33 cm',
      /^30–31 cm\s*davon 1 nicht sägbar$/,
      'ohne Durchmesser',
    ])

    await header(page, 'Ausbeute').getByRole('button').click()
    await expect(header(page, 'Ausbeute')).toHaveAttribute('aria-sort', 'descending')
    await expect(header(page, 'Durchmesser')).not.toHaveAttribute('aria-sort')
    await expect(diameters(page).first()).toHaveText('38–39 cm')
    await header(page, 'Ausbeute').getByRole('button').click()
    await expect(header(page, 'Ausbeute')).toHaveAttribute('aria-sort', 'ascending')
    await expect(diameters(page).first()).toHaveText('32–33 cm')
    await expect(diameters(page).last()).toHaveText('ohne Durchmesser')
  })

  test('stacks each row on a narrow screen: the bar below the diameter, yield and beams per stem named', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await page.goto('/admin/')
    await signIn(page, 'K7QM4XHT9RDP')

    const row = card(page).getByRole('row', { name: /^32–33 cm/ })
    const top = async (locator: Locator) => (await locator.boundingBox())!.y
    expect(await top(row.getByRole('img', { name: '1 Stamm', exact: true }))).toBeGreaterThan(
      await top(row.getByRole('rowheader')),
    )
    await expect(row.getByText('Ausbeute 26,1 %', { exact: true })).toBeVisible()
    await expect(row.getByText('Balken je Stamm 1,0', { exact: true })).toBeVisible()
  })
})

test.describe('activity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/activity')
    await signIn(page, 'K7QM4XHT9RDP')
    await expect(page.locator('h1')).toHaveText('Aktivität')
  })

  test('shows the 31 October as entries per day with the number of entries', async ({ page }) => {
    await expect(page.getByText('6 Einträge', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Di, 03.11.2026', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sa, 31.10.2026', exact: true })).toBeVisible()
    await expect(page.getByRole('article').filter({ hasText: 'Aaron Bauer' })).toBeVisible()
    await expect(page.getByText('11 Ereignisse')).toBeVisible()
    await expect(page.getByText('3 Balken angelegt')).toBeVisible()
    await expect(page.getByText('Gesägt – 1 Stamm')).toBeVisible()
    await expect(page.getByText('2 Stämme storniert')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Details', exact: true })).toHaveCount(0)
  })

  test('opens the details with keyboard or click and turns the chevron', async ({ page }) => {
    const card = page.getByRole('article').filter({ hasText: 'Aaron Bauer' })
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
    await expect(card.getByRole('term').filter({ hasText: /^Notiz$/ })).toBeVisible()
    await expect(card.getByText('105x145')).toBeVisible()

    await summary.click()
    await expect(details).not.toHaveAttribute('open', '')
  })

  test('puts the names and the values of all detail cards on the same edges, 2fr | 3fr', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 800 })
    const summaries = page.getByText('Details anzeigen')
    for (let i = (await summaries.count()) - 1; i >= 0; i--) await summaries.nth(i).click()
    const lists = page.locator('dl')
    expect(await lists.count()).toBeGreaterThan(1)
    const columns = await lists.evaluateAll((all) =>
      all.map((list) => {
        const box = (element: Element) => element.getBoundingClientRect()
        const list0 = box(list)
        // the card's padding sits on the rows, not on the list
        const padding = parseFloat(getComputedStyle(list.firstElementChild!).paddingLeft)
        const dt = [...list.querySelectorAll('dt')].map((dt) => box(dt))
        const dd = [...list.querySelectorAll('dd')].map((dd) => box(dd))
        return {
          inner: list0.width - 2 * padding,
          dtLeft: new Set(dt.map((rect) => Math.round(rect.left))).size,
          ddLeft: new Set(dd.map((rect) => Math.round(rect.left))).size,
          ddOffset: dd[0].left - dt[0].left,
          dtWidth: dt[0].width,
          ddRight: Math.max(...dd.map((rect) => rect.right)) - list0.right,
        }
      }),
    )
    for (const column of columns) {
      // one edge per column; the name column takes 2/5 of the width without the 16 px gap, the values end inside the card
      expect(column.dtLeft).toBe(1)
      expect(column.ddLeft).toBe(1)
      expect(column.dtWidth).toBeCloseTo(((column.inner - 16) * 2) / 5, 0)
      expect(column.ddOffset).toBeCloseTo(column.dtWidth + 16, 0)
      expect(column.ddRight).toBeLessThanOrEqual(1)
    }
    // all cards have the same width, so the edges of different cards agree too
    expect(new Set(columns.map((column) => Math.round(column.dtWidth))).size).toBe(1)
  })

  test('puts the details link in the middle of the right half, level with the name', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 800 })
    const card = page.getByRole('article').filter({ hasText: 'Aaron Bauer' })
    const box = (await card.boundingBox())!
    const summary = (await card.locator('summary').boundingBox())!
    const name = (await card.getByText('Aaron Bauer', { exact: true }).boundingBox())!

    const rightHalf = box.x + box.width / 2
    const center = summary.x + summary.width / 2
    expect(center).toBeGreaterThan(rightHalf)
    expect(Math.abs(center - (rightHalf + box.width / 2 / 2))).toBeLessThan(40)
    expect(Math.abs(summary.y + summary.height / 2 - (name.y + name.height / 2))).toBeLessThan(3)
  })

  test('stacks the details under the bullet points on a narrow screen', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 800 })
    const card = page.getByRole('article').filter({ hasText: 'Aaron Bauer' })
    const summary = (await card.locator('summary').boundingBox())!
    const list = (await card.locator('ul').boundingBox())!
    expect(summary.y).toBeGreaterThan(list.y + list.height)
    expect(Math.abs(summary.x - list.x)).toBeLessThan(25)
  })

  test('searches while typing without Enter, and the cross clears field and filter', async ({
    page,
  }) => {
    const field = page.getByLabel('Kennung', { exact: true })
    const clear = page.getByRole('button', { name: 'Kennung leeren', exact: true })
    await expect(clear).toHaveCount(0)

    await field.pressSequentially('128')
    await expect(page).toHaveURL(/tags=128/)
    await expect(page.getByText('1 von 6 Einträgen', { exact: true })).toBeVisible()
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

  test('shows the saw blade on the grey page while loading and keeps the filters', async ({
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
    await expect(card.getByRole('heading', { name: 'Moment', exact: true })).toBeVisible()
    await expect(card.getByText('Ergebnis wird zurechtgesägt')).toBeVisible()
    await expect(card).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(card).toHaveCSS('border-top-width', '0px')
    await expect(card.locator('svg g')).not.toHaveCSS('animation-name', 'none')
    await expect(card.locator('h2')).toHaveCSS('font-size', '26px')
    await expect(page.getByLabel('Kennung', { exact: true })).toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)',
    )
    await expect(page.getByRole('button', { name: 'Zeitraum', exact: true })).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    )
    await expect(page.getByLabel('Kennung', { exact: true })).toBeVisible()
    release()
    await expect(page.getByText('1 von 6 Einträgen', { exact: true })).toBeVisible()
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
    await expect(page.getByRole('heading', { name: 'Waldesruh', exact: true })).toBeVisible()
    await expect(page.getByText('Keine Ergebnisse weit und breit gefunden.')).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)

    // the bar stays above it with the one button
    await expect(
      page.getByRole('button', { name: 'Filter zurücksetzen', exact: true }),
    ).toHaveCount(1)
    await expect(page.getByRole('status').getByRole('button')).toHaveCount(0)
    await page.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).click()
    await expect(page).not.toHaveURL(/tags=/)
    await expect(page.getByText('6 Einträge', { exact: true })).toBeVisible()
  })

  test('loads older entries by whole days and then hides the button', async ({ page }) => {
    await page.route('**/api/admin/activity*', (route) => {
      const answer = activityAnswer(new URL(route.request().url()).searchParams, 4)
      return route.fulfill({ json: answer })
    })
    await page.reload()
    // the first page ends inside the 31 October, which is therefore held back until it is complete
    await expect(page.getByRole('time')).toHaveCount(1)
    await expect(page.getByRole('heading', { name: 'Sa, 31.10.2026', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Ältere laden', exact: true }).click()
    await expect(page.getByRole('time')).toHaveCount(6)
    await expect(page.getByRole('heading', { name: 'Sa, 31.10.2026', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ältere laden', exact: true })).toHaveCount(0)
  })

  for (const [width, height] of [
    [1280, 700],
    [400, 800],
  ]) {
    test(`keeps the number of entries in view while scrolling, at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      // 12 days with one entry each, and more on the server, so that "Ältere laden" is there
      await page.route('**/api/admin/activity*', (route) => {
        const base = activityAnswer(new URLSearchParams())!
        const entries = Array.from({ length: 12 }, (_, day) => ({
          ...base.entries[0],
          id: `00000000-0000-7000-8000-0000000001${String(day).padStart(2, '0')}`,
          received_at: `2026-10-${String(30 - day).padStart(2, '0')}T12:00:00.000Z`,
        }))
        return route.fulfill({
          json: {
            ...base,
            entries,
            next_cursor: '12',
            totals: { ...base.totals, entries: 40 },
            entries_unfiltered: 40,
          },
        })
      })
      await page.reload()
      const bar = resultsBar(page)
      const top = (locator: Locator) =>
        locator.evaluate((element) => element.getBoundingClientRect().top)
      // below the header from lg on, at the top of the window below it (the header scrolls away)
      const stuck = await bar.evaluate((element) => parseFloat(getComputedStyle(element).top))

      for (const y of [1000, 1800, 3000]) {
        await page.evaluate((to) => window.scrollTo(0, to), y)
        await expect(bar.getByText('40 Einträge')).toBeInViewport()
        expect(await top(bar)).toBe(stuck)
        // as wide as the window, so that no card shows at its sides
        expect((await bar.boundingBox())!.width).toBe(width)
      }

      // a button focused by keyboard lies clear of the bar
      await page.evaluate(() => window.scrollTo(0, 0))
      const more = page.getByRole('button', { name: 'Ältere laden', exact: true })
      await more.focus()
      await expect(more).toBeInViewport()
      const barBottom = (await bar.boundingBox())!.y + (await bar.boundingBox())!.height
      expect((await more.boundingBox())!.y).toBeGreaterThanOrEqual(barBottom)
    })
  }

  test('keeps the bar above "Waldesruh" with 0 of N and the chips, and removing the chip brings the list back', async ({
    page,
  }) => {
    await page.goto('/admin/activity?tags=999')
    await expect(page.getByRole('heading', { name: 'Waldesruh', exact: true })).toBeVisible()
    const bar = resultsBar(page)
    await expect(bar.getByText('0 von 6 Einträgen')).toBeVisible()
    await expect(bar.getByRole('button', { name: 'Kennung: 999', exact: true })).toBeVisible()
    // the card does not slide under the bar
    expect(await bar.evaluate((e) => e.getBoundingClientRect().bottom)).toBeLessThanOrEqual(
      await page.getByRole('status').evaluate((e) => e.getBoundingClientRect().top),
    )

    await bar.getByRole('button', { name: 'Filter Kennung entfernen', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Waldesruh', exact: true })).toHaveCount(0)
    await expect(page.getByText('6 Einträge', { exact: true })).toBeVisible()
  })

  test('filters by a beam tag and by two people at once', async ({ page }) => {
    await page.getByLabel('Kennung', { exact: true }).fill('104-a')
    await expect(page).toHaveURL(/tags=104-a/)
    await expect(page.getByRole('button', { name: 'Kennung: 104-a', exact: true })).toBeVisible()
    await expect(page.getByText('1 von 6 Einträgen', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Filter Kennung entfernen', exact: true }).click()
    await expect(page.getByText('6 Einträge', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Person', exact: true }).click()
    const people = page.getByRole('dialog', { name: filterName('Person'), exact: true })
    await expect(people.getByLabel('Alle')).toHaveCount(0)
    await people.getByLabel('Mara Vogel').check()
    await people.getByLabel('Aaron Bauer').check()
    await expect(page).toHaveURL(/user=[0-9a-f-]+,[0-9a-f-]+/)
    await expect(page.locator('[data-filter="user"]')).toHaveText(/Person\s*2/)
    await expect(
      page.getByRole('button', { name: 'Person: Aaron Bauer, Mara Vogel', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('article').filter({ hasText: 'Mara Vogel' }).first()).toBeVisible()
    await expect(page.getByRole('article').filter({ hasText: 'Aaron Bauer' }).first()).toBeVisible()
    await expect(page.getByRole('article').filter({ hasText: 'Sägewerk' })).toHaveCount(0)

    await page.reload()
    await expect(
      page.getByRole('button', { name: 'Person: Aaron Bauer, Mara Vogel', exact: true }),
    ).toBeVisible()
  })

  test('keeps the filter in the URL through a reload and the back button', async ({ page }) => {
    await page.getByLabel('Kennung', { exact: true }).fill('128')
    await page.getByLabel('Kennung', { exact: true }).press('Enter')
    await page.getByRole('button', { name: 'Person', exact: true }).click()
    await page
      .getByRole('dialog', { name: filterName('Person'), exact: true })
      .getByLabel('Mara Vogel')
      .check()
    await expect(page).toHaveURL(/tags=128/)
    await expect(page).toHaveURL(/user=/)
    await expect(page.getByText('1 von 6 Einträgen', { exact: true })).toBeVisible()

    await page.reload()
    await expect(page.getByLabel('Kennung', { exact: true })).toHaveValue('128')
    await expect(
      page.getByRole('button', { name: 'Person: Mara Vogel', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('listitem').filter({ hasText: /^2 Fotos$/ })).toBeVisible()
    await expect(page.getByRole('article').filter({ hasText: 'Aaron Bauer' })).toHaveCount(0)

    await page.goBack()
    await expect(page).not.toHaveURL(/user=/)
    await page.goBack()
    await expect(page.getByText('6 Einträge')).toBeVisible()
  })

  test('filters by period and person in drop-downs and shows them as chips that open and remove them', async ({
    page,
  }) => {
    const chips = page.getByRole('list', { name: 'Aktive Filter', exact: true })
    await expect(chips).toHaveCount(0)

    await page.getByRole('button', { name: 'Zeitraum', exact: true }).click()
    const period = page.getByRole('dialog', { name: filterName('Zeitraum'), exact: true })
    await period.getByLabel('Von').fill('2026-10-31')
    await expect(page).toHaveURL(/from=2026-10-31/)
    await period.getByLabel('Bis').fill('2026-11-03')
    await expect(page).toHaveURL(/to=2026-11-03/)
    await page.keyboard.press('Escape')
    await expect(period).toBeHidden()
    await expect(page.getByRole('button', { name: 'Zeitraum', exact: true })).toBeFocused()

    await page.getByRole('button', { name: 'Person', exact: true }).click()
    await page
      .getByRole('dialog', { name: filterName('Person'), exact: true })
      .getByLabel('Mara Vogel')
      .check()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/user=/)

    await expect(
      chips.getByRole('button', { name: 'Zeitraum: 31.10.–03.11.', exact: true }),
    ).toBeVisible()
    await expect(
      chips.getByRole('button', { name: 'Person: Mara Vogel', exact: true }),
    ).toBeVisible()

    // the chip opens its filter again
    await chips.getByRole('button', { name: 'Zeitraum: 31.10.–03.11.', exact: true }).click()
    await expect(period).toBeVisible()
    await expect(period.getByLabel('Von')).toHaveValue('2026-10-31')
    await page.keyboard.press('Escape')

    // the cross removes the period as a whole and leaves the person; the focus moves on to the next chip
    await page.getByRole('button', { name: 'Filter Zeitraum entfernen', exact: true }).click()
    await expect(page).not.toHaveURL(/from=|to=/)
    await expect(page).toHaveURL(/user=/)
    await expect(
      page.getByRole('button', { name: 'Person: Mara Vogel', exact: true }),
    ).toBeFocused()
  })

  for (const width of [390, 1280]) {
    test(`keeps the drop-downs inside the window, at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 })
      for (const name of ['Zeitraum', 'Person']) {
        await page.getByRole('button', { name, exact: true }).click()
        const box = (await page
          .getByRole('dialog', { name: filterName(name), exact: true })
          .boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(width)
        // right under its button
        const button = (await page.getByRole('button', { name, exact: true }).boundingBox())!
        expect(box.y).toBeGreaterThanOrEqual(button.y + button.height)
        expect(box.y).toBeLessThan(button.y + button.height + 12)
        await page.keyboard.press('Escape')
      }
    })
  }

  test('shows "Waldesruh" for an empty result and clears the filter again', async ({ page }) => {
    await page.getByLabel('Kennung', { exact: true }).fill('999')
    await page.getByLabel('Kennung', { exact: true }).press('Enter')
    await expect(page.getByRole('heading', { name: 'Waldesruh', exact: true })).toBeVisible()
    await expect(page.getByText('Keine Ergebnisse weit und breit gefunden.')).toBeVisible()

    await page.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).click()
    await expect(page).not.toHaveURL(/tags=/)
    await expect(page.getByText('6 Einträge', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Waldesruh', exact: true })).toHaveCount(0)
  })

  test('has "Filter zurücksetzen" at the right end of the results bar only while a filter is set', async ({
    page,
  }) => {
    const link = page.getByRole('button', { name: 'Filter zurücksetzen', exact: true })
    await expect(link).toHaveCount(0)

    await page.getByLabel('Kennung', { exact: true }).fill('128')
    await page.getByLabel('Kennung', { exact: true }).press('Enter')
    await expect(page.getByText('1 von 6 Einträgen', { exact: true })).toBeVisible()
    await expect(link).toBeVisible()
    const bar = (await resultsBar(page).boundingBox())!
    const box = (await link.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    // at the right edge of the column, in the bar
    expect(box.y).toBeGreaterThanOrEqual(bar.y)
    expect(box.y + box.height).toBeLessThanOrEqual(bar.y + bar.height)
    expect(bar.x + bar.width - (box.x + box.width)).toBeGreaterThan(0)
    await expect(page.locator('form').getByText('Filter zurücksetzen')).toHaveCount(0)

    await link.click()
    await expect(page).not.toHaveURL(/tags=/)
    await expect(page.getByText('6 Einträge', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Kennung', { exact: true })).toBeFocused()
    await expect(link).toHaveCount(0)
  })

  test('keeps the text column narrow', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 })
    const text = // the newest entry of one person, its bullet points sit in the text column
      page.getByRole('article').filter({ hasText: 'Alex Beispiel' }).first().getByRole('list')

    expect((await text.boundingBox())!.width).toBeLessThanOrEqual(760)
  })
})

for (const width of [1000, 390]) {
  test(`the open details do not scroll the page at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/admin/activity')
    await signIn(page, 'K7QM4XHT9RDP')
    // the entry with the most cards, so the widest content
    await page
      .getByRole('article')
      .filter({ hasText: 'Sägewerk Muster' })
      .getByText('Details anzeigen')
      .click()
    await expect(page.locator('details[open]')).toHaveCount(1)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBe(0)
  })
}

test.describe('detail view', () => {
  test('opens from the activity with its filter and "Zurück" leads back to it', async ({
    page,
  }) => {
    await page.goto('/admin/activity?tags=104')
    await signIn(page, 'K7QM4XHT9RDP')
    await page.getByText('Details anzeigen').click()
    await page.getByRole('article').getByRole('link', { name: '00104-C', exact: true }).click()

    await expect(page).toHaveURL(/\/admin\/beams\/104-C$/)
    await expect(page.locator('h1')).toHaveText('00104-C')
    await expect(page.getByRole('link', { name: 'Aus Stamm 00104', exact: true })).toBeVisible()
    await expect(page.getByText('Vom Stamm geerbt').first()).toBeVisible()

    await page.getByRole('button', { name: 'Zurück', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/activity\?tags=104$/)
  })

  test('a pasted link has a "Zurück" link to the activity', async ({ page }) => {
    await page.goto('/admin/stems/00104')
    await signIn(page, 'K7QM4XHT9RDP')
    await expect(page.locator('h1')).toHaveText('00104')
    await page.getByRole('link', { name: 'Zurück', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/activity$/)
  })

  test('opens the gallery, zooms, moves the photo by dragging and closes it', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 })
    await page.goto('/admin/stems/104')
    await signIn(page, 'K7QM4XHT9RDP')
    await page.getByRole('button', { name: 'Foto vergrößern', exact: true }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Stamm 00104 · Foto 1 von 2')
    await expect(dialog.getByRole('link', { name: 'Herunterladen', exact: true })).toHaveAttribute(
      'download',
      '00104-1.jpg',
    )

    const photo = dialog.locator('img').first()
    const stage = dialog.locator('div.touch-none')
    await stage.dblclick()
    await expect(
      dialog.getByRole('button', { name: 'Zoom 200 %, auf Einpassen zurücksetzen', exact: true }),
    ).toBeVisible()
    const before = (await photo.boundingBox())!
    await stage.dragTo(stage, {
      sourcePosition: { x: 600, y: 300 },
      targetPosition: { x: 680, y: 340 },
    })
    const after = (await photo.boundingBox())!
    expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(20)

    await page.keyboard.press('ArrowRight')
    await expect(dialog).toContainText('Foto 2 von 2')
    await expect(dialog.getByText('Foto noch nicht hochgeladen')).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: 'Zoom 100 %, auf Einpassen zurücksetzen', exact: true }),
    ).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('puts Fotos left (40 %), Balken, Kennzahlen, Merkmale and Verlauf right (60 %), one column below 900px', async ({
    page,
  }) => {
    const box = async (name: string) =>
      (await (
        name === 'Fotos'
          ? page.locator('section[aria-label="Fotos"]')
          : page.locator('section, details').filter({ hasText: new RegExp(`^\\s*${name}`) })
      ).boundingBox())!
    await page.setViewportSize({ width: 1200, height: 900 })
    await page.goto('/admin/stems/104')
    await signIn(page, 'K7QM4XHT9RDP')
    await expect(page.locator('h1')).toHaveText('00104')
    const [photos, beams, figures, values, history] = [
      await box('Fotos'),
      await box('Balken'),
      await box('Kennzahlen'),
      await box('Merkmale'),
      await box('Verlauf'),
    ]
    expect(beams.x).toBeGreaterThan(photos.x + 300)
    for (const right of [figures, values, history]) expect(right.x).toBe(beams.x)
    expect(beams.y).toBeLessThan(figures.y)
    expect(figures.y).toBeLessThan(values.y)
    expect(values.y).toBeLessThan(history.y)
    // 2fr | 3fr with a 24 px gap: the photo card takes 40 % of the width without the gap
    expect(photos.width / values.width).toBeCloseTo(2 / 3, 1)

    await page.setViewportSize({ width: 600, height: 900 })
    const ys = [
      await box('Fotos'),
      await box('Balken'),
      await box('Kennzahlen'),
      await box('Merkmale'),
      await box('Verlauf'),
    ]
    expect(ys.map((heading) => heading.x)).toEqual(Array(5).fill(ys[0].x))
    expect([...ys].map((heading) => heading.y)).toEqual(
      [...ys].map((heading) => heading.y).sort((a, b) => a - b),
    )
  })

  test('shows the key figures and opens and closes the formula of one', async ({ page }) => {
    await page.goto('/admin/stems/104')
    await signIn(page, 'K7QM4XHT9RDP')
    const card = page.locator('section', {
      has: page.getByRole('heading', { name: 'Kennzahlen', exact: true }),
    })
    await expect(card).toContainText('0,502 fm')
    await expect(card).toContainText('aus 40 × 39 cm und 4,10 m')
    await expect(card).toContainText('60 %')

    const info = card.getByRole('button', { name: 'Formel für Rundholz anzeigen', exact: true })
    const formula = page.getByRole('dialog')
    await expect(info).toHaveAttribute('aria-expanded', 'false')
    await info.click()
    await expect(info).toHaveAttribute('aria-expanded', 'true')
    await expect(formula).toContainText('0,785 × 0,40 m × 0,39 m × 4,10 m')
    await expect(formula).toContainText('Vorläufige Formel')

    await page.keyboard.press('Escape')
    await expect(formula).toBeHidden()
    await info.click()
    await expect(formula).toBeVisible()
    await page.getByRole('heading', { name: 'Merkmale', exact: true }).click()
    await expect(formula).toBeHidden()
  })

  test('keeps the photos in view while scrolling from 900px on, and does not stick below', async ({
    page,
  }) => {
    const photos = page.locator('section[aria-label="Fotos"]')
    await page.setViewportSize({ width: 1200, height: 500 })
    await page.goto('/admin/stems/104')
    await signIn(page, 'K7QM4XHT9RDP')
    await expect(page.locator('h1')).toHaveText('00104')
    await page.locator('summary', { hasText: 'Verlauf' }).click()
    await page.evaluate(() => window.scrollTo(0, 400))
    // 24 px under the sticky header (from 1024px on)
    const header = (await page.locator('header').first().boundingBox())!
    expect(
      Math.abs((await photos.boundingBox())!.y - (header.y + header.height + 24)),
    ).toBeLessThan(2)

    await page.setViewportSize({ width: 600, height: 500 })
    await page.evaluate(() => window.scrollTo(0, 700))
    expect((await photos.boundingBox())!.y).toBeLessThan(0)
  })

  test('opens the history as a timeline by device time and turns the chevron', async ({ page }) => {
    await page.goto('/admin/stems/104')
    await signIn(page, 'K7QM4XHT9RDP')
    const details = page.locator('details', { hasText: 'Verlauf' })
    const summary = details.locator('summary')
    await expect(summary).toHaveText('Verlauf')
    await expect(details).not.toHaveAttribute('open', '')
    await expect(details.getByText('Aaron Bauer')).toBeHidden()

    await summary.focus()
    await page.keyboard.press('Enter')
    await expect(details).toHaveAttribute('open', '')
    await expect(summary.locator('svg')).toHaveCSS('rotate', '180deg')
    await expect(details.getByText('31.10.')).toBeVisible()
    await expect(details.getByText('11:46')).toBeVisible()
    await expect(details.getByText('Aaron Bauer')).toBeVisible()
    await expect(details.getByText('Balken 00104-C')).toBeVisible()
    await expect(details.getByText('übertragen')).toHaveCount(0)

    await summary.click()
    await expect(details).not.toHaveAttribute('open', '')
  })

  for (const width of [1000, 390]) {
    test(`does not scroll the page sideways at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/admin/stems/104')
      await signIn(page, 'K7QM4XHT9RDP')
      await expect(page.locator('h1')).toHaveText('00104')
      await expect(page.locator('summary', { hasText: /^\s*Verlauf\s*$/ })).toBeVisible()
      await page.locator('summary', { hasText: /^\s*Verlauf\s*$/ }).click()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBe(0)
    })
  }
})

test.describe('stem list', () => {
  const tags = (page: Page) => page.locator('tbody th')
  // On a phone the emulated window cannot scroll sideways (see below), so a head button far to the right is out of reach for a click.
  // The filter bar has buttons of the same names, so these are the ones in the table head.
  const headButton = (page: Page, name: string) =>
    page.locator('thead').getByRole('button', { name, exact: true })
  const sortOn = (page: Page, name: string) => headButton(page, name).dispatchEvent('click')
  const bar = (page: Page) => page.locator('form').filter({ has: page.getByLabel('Kennung') })
  const filterButton = (page: Page, name: string) =>
    bar(page)
      .getByRole('button', { name: filterName(name), exact: true })
      .filter({ hasText: name })

  test('Balken lists the beams, filters by tag, opens a beam and keeps its own URL; the path follows the kind', async ({
    page,
  }) => {
    await page.goto('/admin/activity')
    await signIn(page, 'K7QM4XHT9RDP')
    const links = page.getByRole('navigation').getByRole('link')
    await expect(links).toHaveText(['Stämme', 'Balken', 'Aktivität'])
    await links.filter({ hasText: 'Balken' }).click()
    await expect(page).toHaveURL(/\/admin\/beams$/)
    await expect(page.locator('h1')).toHaveText('Balken')
    await expect(page.getByText('3 Balken', { exact: true })).toBeVisible()
    await expect(tags(page)).toHaveText(['00104-A', '00104-B', '00104-C'])
    await expect(page.getByRole('columnheader', { name: 'Balken', exact: true })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )

    await page.getByRole('textbox', { name: 'Kennung', exact: true }).fill('104-B')
    await expect(page).toHaveURL(/\/admin\/beams\?tags=104-B$/)
    await expect(tags(page)).toHaveText(['00104-B'])
    await expect(page.getByText('1 von 3 Balken')).toBeVisible()

    await page.getByRole('link', { name: '00104-B', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/beams\/104-B$/)
    await page.getByRole('button', { name: 'Zurück', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/beams\?tags=104-B$/)

    // the list of stems has its own filter state
    await links.first().click()
    await expect(page).toHaveURL(/\/admin\/stems$/)
    await expect(page.getByText('4 Stämme', { exact: true })).toBeVisible()

    // a tag on the path of the other kind goes to the right one
    await page.goto('/admin/beams/104')
    await expect(page).toHaveURL(/\/admin\/stems\/104$/)
    await page.goto('/admin/stems/104-A')
    await expect(page).toHaveURL(/\/admin\/beams\/104-A$/)
  })

  test('opens from the navigation, sorts, filters by tag and keeps both through the detail view', async ({
    page,
  }) => {
    await page.goto('/admin/activity')
    await signIn(page, 'K7QM4XHT9RDP')
    await page.getByRole('navigation').getByRole('link', { name: 'Stämme', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/stems$/)
    await expect(page.locator('h1')).toHaveText('Stämme')
    await expect(page.getByText('4 Stämme', { exact: true })).toBeVisible()
    await expect(tags(page)).toHaveText(['00007', '00104', '01500', 'ohne Kennung'])

    await sortOn(page, 'Balken')
    await expect(page).toHaveURL(/\?sort=Balken$/)
    await sortOn(page, 'Balken')
    await expect(page).toHaveURL(/\?sort=Balken&dir=desc$/)
    await expect(page.getByRole('columnheader', { name: 'Balken', exact: true })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
    await expect(tags(page).first()).toHaveText('00104')

    await page.getByRole('textbox', { name: 'Kennung', exact: true }).fill('1-200')
    await expect(page).toHaveURL(/tags=1-200/)
    await expect(page.getByText('2 von 4 Stämmen')).toBeVisible()

    await page.getByRole('link', { name: '00104', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/stems\/104$/)
    await expect(page.locator('h1')).toHaveText('00104')

    await page.getByRole('button', { name: 'Zurück', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/stems\?tags=1-200&sort=Balken&dir=desc$/)
    await expect(page.getByRole('textbox', { name: 'Kennung', exact: true })).toHaveValue('1-200')
    await expect(page.getByText('2 von 4 Stämmen')).toBeVisible()
    await expect(tags(page).first()).toHaveText('00104')
  })

  test('sorts the notes by whether there is one: with a note first, then without', async ({
    page,
  }) => {
    await page.goto('/admin/stems')
    await signIn(page, 'K7QM4XHT9RDP')
    await sortOn(page, 'Notiz')
    await expect(tags(page)).toHaveText(['00104', 'ohne Kennung', '00007', '01500'])
    await sortOn(page, 'Notiz')
    await expect(tags(page)).toHaveText(['00007', '01500', '00104', 'ohne Kennung'])
  })

  test('writes filters and sort with their names, and the copied link opens the same list', async ({
    page,
  }) => {
    await page.goto('/admin/stems')
    await signIn(page, 'K7QM4XHT9RDP')
    await page.goto('/admin/stems?Lagerplatz=Polter Süd,Polter Nord&sort=Geändert&dir=desc')
    const chips = page.getByRole('list', { name: 'Aktive Filter', exact: true })
    await expect(chips).toHaveText(/Lagerplatz: Polter Nord, Polter Süd/)
    // any change rewrites the URL in the readable form
    await page.getByRole('textbox', { name: 'Kennung', exact: true }).fill('1-1999')
    await expect(page).toHaveURL(/tags=1-1999/)
    const link = page.url()
    expect(new URL(link).searchParams.get('Lagerplatz')).toBe('Polter Süd,Polter Nord')
    expect(new URL(link).searchParams.get('sort')).toBe('Geändert')

    // a fresh load of the copied link (the fake API belongs to this page, a second tab would have none)
    await page.goto(link)
    await expect(chips).toHaveText('Kennung: 1-1999Lagerplatz: Polter Nord, Polter Süd')
  })

  // Many stems, so that the page has to scroll down
  async function openLong(page: Page, size: { width: number; height: number }) {
    await page.setViewportSize(size)
    const stems = Array.from({ length: 60 }, (_, index) => ({
      ...snapshotFixture.timber_items.find((item) => item.tag_number === '7')!,
      id: `many-${index}`,
      tag_number: String(200 + index),
    }))
    await page.route('**/api/snapshot', (route) =>
      route.fulfill({
        json: { ...snapshotFixture, timber_items: [...snapshotFixture.timber_items, ...stems] },
      }),
    )
    await page.goto('/admin/stems')
    await signIn(page, 'K7QM4XHT9RDP')
    await expect(tags(page)).toHaveCount(64)
  }
  const sideways = (page: Page) =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const top = (locator: Locator) =>
    locator.evaluate((element) => element.getBoundingClientRect().top)
  const bottom = (locator: Locator) =>
    locator.evaluate((element) => element.getBoundingClientRect().bottom)
  const left = (locator: Locator) =>
    locator.evaluate((element) => element.getBoundingClientRect().left)

  test('filters through the drop-downs of the columns: ticks, chips, back button, link, reset', async ({
    page,
  }) => {
    await page.goto('/admin/stems')
    await signIn(page, 'K7QM4XHT9RDP')
    await expect(tags(page)).toHaveCount(4)
    const chips = page.getByRole('list', { name: 'Aktive Filter', exact: true })
    await expect(chips).toHaveCount(0)

    // one button per filterable column behind the field "Kennung"; "Filter zurücksetzen" is not there without a filter
    const holzart = filterButton(page, 'Holzart')
    await expect(
      page.getByRole('button', { name: 'Filter zurücksetzen', exact: true }),
    ).toHaveCount(0)
    await expect(bar(page).getByRole('button', { name: 'Stamm', exact: true })).toHaveCount(0)

    await holzart.click()
    const popup = page.getByRole('dialog', { name: filterName('Holzart'), exact: true })
    await popup.getByLabel('Traubeneiche').check()
    await expect(page).toHaveURL(/\?Holzart=Traubeneiche$/)
    await expect(page.getByText('1 von 4 Stämmen')).toBeVisible()
    await expect(tags(page)).toHaveText(['01500'])
    await expect(
      chips.getByRole('button', { name: 'Holzart: Traubeneiche', exact: true }),
    ).toBeVisible()
    await expect(holzart).toHaveText(/Holzart\s*1/)

    await popup.getByLabel('Nicht erfasst').check()
    await expect(tags(page)).toHaveText(['00007', '01500', 'ohne Kennung'])
    await expect(
      chips.getByRole('button', { name: 'Holzart: Traubeneiche, Nicht erfasst', exact: true }),
    ).toBeVisible()
    await expect(holzart).toHaveText(/Holzart\s*2/)

    // Escape closes and returns the focus; the back button goes back one filter at a time
    await page.keyboard.press('Escape')
    await expect(popup).toBeHidden()
    await expect(holzart).toBeFocused()
    await page.goBack()
    await expect(tags(page)).toHaveText(['01500'])
    await page.goForward()
    await expect(tags(page)).toHaveCount(3)

    // together with the Kennung (and), and the whole view comes back from the link
    await page.getByRole('textbox', { name: 'Kennung', exact: true }).fill('1-200')
    await expect(tags(page)).toHaveText(['00007'])
    await expect(chips.getByRole('button')).toHaveCount(4)
    const link = page.url()
    const fresh = await page.context().newPage()
    await fakeApi(fresh)
    await fresh.goto(link)
    await signIn(fresh, 'K7QM4XHT9RDP')
    await expect(fresh.locator('tbody th')).toHaveText(['00007'])
    await expect(
      fresh.getByRole('button', { name: 'Holzart: Traubeneiche, Nicht erfasst', exact: true }),
    ).toBeVisible()
    await expect(fresh.getByRole('button', { name: 'Kennung: 1-200', exact: true })).toBeVisible()
    await fresh.close()

    // a chip opens its filter, the cross removes only this filter
    await chips
      .getByRole('button', { name: 'Holzart: Traubeneiche, Nicht erfasst', exact: true })
      .click()
    await expect(popup).toBeVisible()
    await popup.getByLabel('Traubeneiche').uncheck()
    await expect(
      chips.getByRole('button', { name: 'Holzart: Nicht erfasst', exact: true }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Filter Holzart entfernen', exact: true }).click()
    await expect(page).not.toHaveURL(/Holzart/)
    await expect(page).toHaveURL(/tags=1-200/)
    // no chip follows, so the focus goes to the button of the filter
    await expect(holzart).toBeFocused()

    // reset clears the Kennung and all filters
    await holzart.click()
    await popup.getByLabel('Stieleiche').check()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Filter zurücksetzen', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/stems$/)
    await expect(tags(page)).toHaveCount(4)
    await expect(page.getByRole('textbox', { name: 'Kennung', exact: true })).toHaveValue('')
  })

  test('searches a text while typing, takes a range and opens the filters by keyboard', async ({
    page,
  }) => {
    await page.goto('/admin/stems')
    await signIn(page, 'K7QM4XHT9RDP')

    await filterButton(page, 'Notiz').focus()
    await page.keyboard.press('Enter')
    const popup = page.getByRole('dialog', { name: filterName('Notiz'), exact: true })
    await expect(popup).toBeVisible()
    await popup.getByRole('textbox', { name: 'Suchtext', exact: true }).fill('drehwuchs')
    await expect(page).toHaveURL(/contains:drehwuchs/)
    await expect(
      page.getByRole('button', { name: 'Notiz: enthält drehwuchs', exact: true }),
    ).toBeVisible()
    await expect(tags(page)).toHaveText(['00104'])
    await page.keyboard.press('Escape')
    await expect(filterButton(page, 'Notiz')).toBeFocused()

    await filterButton(page, 'Holzfeuchte').click()
    const range = page.getByRole('dialog', { name: filterName('Holzfeuchte'), exact: true })
    await range.getByLabel('Von').fill('40')
    await range.getByLabel('Von').press('Enter')
    await expect(
      page.getByRole('button', { name: 'Holzfeuchte: ab 40 %', exact: true }),
    ).toBeVisible()
    await expect(page).toHaveURL(/=40~(&|$)/)
    await range.getByLabel('Von').fill('90')
    await range.getByLabel('Von').press('Enter')
    await expect(page.getByText('Keine Ergebnisse weit und breit gefunden.')).toBeVisible()
  })

  test('keeps the bar above "Waldesruh" with 0 of N and the chips, and removing the chip brings the table back', async ({
    page,
  }) => {
    await page.goto('/admin/stems?tags=300-400')
    await signIn(page, 'K7QM4XHT9RDP')
    await expect(page.getByRole('heading', { name: 'Waldesruh', exact: true })).toBeVisible()
    const bar = resultsBar(page)
    await expect(bar.getByText('0 von 4 Stämmen')).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Tabelle nach rechts scrollen', exact: true }),
    ).toHaveCount(0)
    expect(await bottom(bar)).toBeLessThanOrEqual(
      await top(page.getByRole('heading', { name: 'Waldesruh', exact: true })),
    )

    await bar.getByRole('button', { name: 'Filter Kennung entfernen', exact: true }).click()
    await expect(tags(page)).toHaveCount(4)
    await expect(page.getByText('4 Stämme', { exact: true })).toBeVisible()
  })

  test('finds the stem of a beam tag, and offers no "Nicht erfasst" for "Geändert"', async ({
    page,
  }) => {
    await page.goto('/admin/stems')
    await signIn(page, 'K7QM4XHT9RDP')
    await page.getByRole('textbox', { name: 'Kennung', exact: true }).fill('104-a')
    await expect(tags(page)).toHaveText(['00104'])
    await expect(page.getByRole('button', { name: 'Kennung: 104-a', exact: true })).toBeVisible()
    await page.getByRole('textbox', { name: 'Kennung', exact: true }).fill('104-d')
    await expect(page.getByRole('heading', { name: 'Waldesruh', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Filter Kennung entfernen', exact: true }).click()

    await filterButton(page, 'Geändert').click()
    const popup = page.getByRole('dialog', { name: filterName('Geändert'), exact: true })
    await expect(popup.getByLabel('Von')).toBeVisible()
    await expect(popup.getByText('Nicht erfasst')).toHaveCount(0)
  })

  test('has "Filter zurücksetzen" in the results bar left of the arrows, clears everything and does not scroll the page', async ({
    page,
    isMobile,
  }) => {
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(isMobile, 'a phone pans instead of scrolling the window, the arrows are not there')
    await openLong(page, { width: 900, height: 700 })
    const link = page.getByRole('button', { name: 'Filter zurücksetzen', exact: true })
    await expect(link).toHaveCount(0)

    // only stems come back that sort after the ones shown, so nothing above moves
    await page.goto('/admin/stems?tags=1-1999')
    await expect(link).toBeVisible()
    const arrows = (await page
      .getByRole('button', { name: 'Tabelle nach rechts scrollen', exact: true })
      .boundingBox())!
    const box = (await link.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(arrows.x)
    expect(Math.abs(box.y + box.height / 2 - (arrows.y + arrows.height / 2))).toBeLessThan(2)

    // scrolled down, the button is in view; a click clears all filters and the page stays where it is
    await page.evaluate(() => window.scrollTo(0, 800))
    await expect(link).toBeInViewport()
    await link.click()
    await expect(page).toHaveURL(/\/admin\/stems$/)
    await expect(page.getByRole('textbox', { name: 'Kennung', exact: true })).toBeFocused()
    expect(await page.evaluate(() => window.scrollY)).toBe(800)
    await expect(link).toHaveCount(0)
  })

  test('keeps the results bar as low as with one chip while the chips fill two lines, and grows with the third', async ({
    page,
    isMobile,
  }) => {
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(isMobile, 'the emulated phone widens the window to the table, the bar never wraps')
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/admin/stems')
    await signIn(page, 'K7QM4XHT9RDP')
    const id = (name: string) => snapshotFixture.attributes.find((a) => a.name === name)!.id
    const filters = [
      'tags=1-1999',
      `f.${id('Holzart')}=none`,
      `f.${id('Fälldatum')}=2026-10`,
      `f.${id('Lieferdatum')}=2026-01-01~2026-12-31`,
      `f.${id('Lagerplatz')}=none`,
      `f.${id('Gesägt')}=yes`,
      `f.${id('Holzfeuchte')}=10~90`,
      `f.${id('Notiz')}=has`,
      `f.${id('Fotos')}=has`,
      `f.beams=0~9`,
      'f.changed=2026-01-01~',
    ]
    const bar = resultsBar(page)
    const heights: number[] = []
    const lines: number[] = []
    for (const count of [1, 6, 8, 11]) {
      await page.goto(`/admin/stems?${filters.slice(0, count).join('&')}`)
      await expect(page.getByRole('list', { name: 'Aktive Filter', exact: true })).toBeVisible()
      heights.push((await bar.boundingBox())!.height)
      lines.push(
        (await page.getByRole('list', { name: 'Aktive Filter', exact: true }).boundingBox())!
          .height,
      )
    }
    // one chip: 60 px; two lines of chips: the same, the arrows and the button stay in the middle; more lines: the bar grows
    expect(heights[0]).toBe(60)
    expect(lines.filter((height) => height > 30 && height < 60).length).toBeGreaterThan(0)
    expect(heights.filter((_, index) => lines[index] < 60).every((height) => height === 60)).toBe(
      true,
    )
    expect(heights.filter((_, index) => lines[index] >= 60).every((height) => height > 60)).toBe(
      true,
    )
    // text, button and chips are centered vertically in the bar
    const barBox = (await bar.boundingBox())!
    const text = (await bar.getByText(/von 4 Stämmen/).boundingBox())!
    const link = (await bar
      .getByRole('button', { name: 'Filter zurücksetzen', exact: true })
      .boundingBox())!
    for (const box of [text, link]) {
      expect(Math.abs(box.y + box.height / 2 - (barBox.y + barBox.height / 2))).toBeLessThan(2)
    }
  })

  test('picks the days of "Geändert" with the date pickers; an old link and a reload keep them', async ({
    page,
  }) => {
    await page.goto('/admin/stems')
    await signIn(page, 'K7QM4XHT9RDP')
    await filterButton(page, 'Geändert').click()
    const popup = page.getByRole('dialog', { name: filterName('Geändert'), exact: true })
    const from = popup.getByLabel('Von')
    const to = popup.getByLabel('Bis')
    await expect(from).toHaveAttribute('type', 'date')
    await expect(to).toHaveAttribute('type', 'date')

    await from.fill('2026-10-31')
    await expect(page).toHaveURL(/Ge%C3%A4ndert=2026-10-31~$/)
    await expect(
      page.getByRole('button', { name: 'Geändert: ab 31.10.2026', exact: true }),
    ).toBeVisible()
    await expect(tags(page)).toHaveText(['00104'])
    await to.fill('2026-10-31')
    await expect(page).toHaveURL(/Ge%C3%A4ndert=2026-10-31~2026-10-31$/)
    await expect(
      page.getByRole('button', { name: 'Geändert: 31.10.2026–31.10.2026', exact: true }),
    ).toBeVisible()

    await page.reload()
    await filterButton(page, 'Geändert').click()
    await expect(from).toHaveValue('2026-10-31')
    await expect(to).toHaveValue('2026-10-31')
    await expect(
      page.getByRole('button', { name: 'Geändert: 31.10.2026–31.10.2026', exact: true }),
    ).toBeVisible()

    // the field cleared again (a half-typed date is no value): no filter on this side, and without both no chip
    await from.fill('')
    await to.fill('')
    await expect(page).not.toHaveURL(/Ge%C3%A4ndert/)
    await expect(page.getByRole('button', { name: /^Geändert:/, exact: true })).toHaveCount(0)

    // an old link still works
    await page.goto('/admin/stems?f.changed=2026-10-01~2026-12-31')
    await expect(
      page.getByRole('button', { name: 'Geändert: 01.10.2026–31.12.2026', exact: true }),
    ).toBeVisible()
  })

  test('keeps the drop-downs inside a narrow window', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 })
    await page.goto('/admin/stems')
    await signIn(page, 'K7QM4XHT9RDP')
    for (const name of ['Holzart', 'Geändert']) {
      await filterButton(page, name).click()
      const box = (await page
        .getByRole('dialog', { name: filterName(name), exact: true })
        .boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(390)
      await page.keyboard.press('Escape')
    }
  })

  test('keeps the chips in view while scrolling, and no focused element under the bar when it has two lines', async ({
    page,
    isMobile,
  }) => {
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(isMobile, 'the emulated phone widens the window to the table, the bar never wraps')
    await openLong(page, { width: 640, height: 700 })
    // enough filters for a second line of chips
    const id = (name: string) => snapshotFixture.attributes.find((a) => a.name === name)!.id
    await page.goto(
      `/admin/stems?tags=1-1999&f.${id('Holzart')}=none&f.${id('Gesägt')}=yes,no,none&f.${id('Notiz')}=none`,
    )
    const bar = resultsBar(page)
    await expect(page.getByRole('list', { name: 'Aktive Filter', exact: true })).toBeVisible()
    expect((await bar.boundingBox())!.height).toBeGreaterThan(80)
    await page.evaluate(() => window.scrollTo(0, 900))
    await expect(page.getByRole('list', { name: 'Aktive Filter', exact: true })).toBeInViewport()
    await expect(bar).toBeInViewport()

    // a link in the table, focused by keyboard, lies below the bar even though it has two lines
    // a row far down the list (the 31st): the order is the point, so it is found by position
    await tags(page).nth(30).getByRole('link').focus()
    const link = (await tags(page).nth(30).getByRole('link').boundingBox())!
    const barBox = (await bar.boundingBox())!
    expect(link.y).toBeGreaterThanOrEqual(barBox.y + barBox.height)
  })

  for (const [width, height] of [
    [1280, 700],
    [400, 800],
  ]) {
    test(`keeps the table head right under the bar while scrolling down, at ${width}px`, async ({
      page,
    }) => {
      await openLong(page, { width, height })
      const bar = resultsBar(page)
      const head = page.getByRole('columnheader', { name: 'Stamm', exact: true })
      // the bar sticks below the header from lg on, and to the top of the window below it (the header scrolls away)
      const stuck = await bar.evaluate((element) => parseFloat(getComputedStyle(element).top))

      for (const y of [900, 1500, 2500]) {
        await page.evaluate((to) => window.scrollTo(0, to), y)
        await expect(head).toBeInViewport()
        expect(await top(bar)).toBe(stuck)
        // 1 px: the head sits exactly on the lower edge of the bar
        expect(Math.abs((await top(head)) - (await bottom(bar)))).toBeLessThan(1)
        await expect(bar.getByText('64 Stämme')).toBeVisible()
      }
    })
  }

  // A phone widens the layout viewport to the content and pans the visual one: window.scrollTo has no effect there, so what sticks
  // to the left edge can only be checked in the desktop browser (and by hand on the phone).
  test.describe('scrolled sideways', () => {
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(({ isMobile }) => isMobile, 'a phone pans instead of scrolling the window')

    test('scrolls the page sideways, not a box: header, bar and filter stay, the stem column sits at the edge', async ({
      page,
    }) => {
      await openLong(page, { width: 1024, height: 700 })
      expect(await sideways(page)).toBeGreaterThan(0)

      const fixed = [
        page.locator('header'),
        page.getByRole('heading', { level: 1 }),
        page.getByRole('textbox', { name: 'Kennung', exact: true }),
        resultsBar(page),
        page.getByRole('contentinfo').getByRole('link'),
      ]
      const placed = async () =>
        Promise.all(
          fixed.map(async (locator) => {
            const box = (await locator.boundingBox())!
            // whole pixels: the scroll position is fractional on some screens
            return [Math.round(box.x) + 0, Math.round(box.y), Math.round(box.width)]
          }),
        )
      const before = await placed()
      await page.evaluate(() => window.scrollTo(300, 0))
      expect(await page.evaluate(() => window.scrollX)).toBeGreaterThan(100)
      expect(await placed()).toEqual(before)

      // the first column sticks to the edge of the window, in the head and in the rows
      expect(await left(page.getByRole('columnheader', { name: 'Stamm', exact: true }))).toBe(0)
      // the second row: any row of the list will do
      expect(await left(tags(page).nth(1))).toBe(0)
      await expect(tags(page).nth(1)).toBeInViewport()

      // nothing around the table scrolls by itself
      const scrollers = await page.locator('table').evaluate((table) => {
        const found: string[] = []
        for (let element = table.parentElement; element; element = element.parentElement) {
          const { overflowX, overflowY } = getComputedStyle(element)
          if (overflowX !== 'visible' || overflowY !== 'visible') found.push(element.tagName)
        }
        return found
      })
      expect(scrollers).toEqual([])
    })

    test('the arrows scroll the page and are disabled at the ends', async ({ page }) => {
      await openLong(page, { width: 1024, height: 700 })
      const next = page.getByRole('button', { name: 'Tabelle nach rechts scrollen', exact: true })
      const back = page.getByRole('button', { name: 'Tabelle nach links scrollen', exact: true })
      await expect(back).toBeDisabled()

      await next.click()
      await expect.poll(() => page.evaluate(() => window.scrollX)).toBeGreaterThan(100)
      await expect(back).toBeEnabled()

      await page.evaluate(() => window.scrollTo(document.documentElement.scrollWidth, 0))
      await expect(next).toBeDisabled()
      await back.click()
      await expect.poll(() => page.evaluate(() => window.scrollX)).toBeGreaterThan(0)
    })

    test('a link focused by keyboard lies clear of header, bar, table head and the stem column', async ({
      page,
    }) => {
      await openLong(page, { width: 1024, height: 700 })
      const head = page.getByRole('columnheader', { name: 'Stamm', exact: true })

      // a row far down the list (the 41st)
      await tags(page).nth(40).getByRole('link').focus()
      const row = await tags(page).nth(40).getByRole('link').boundingBox()
      expect(row!.y).toBeGreaterThan(await bottom(head))

      // a head button far to the right is not left under the stem column
      await page.evaluate(() => window.scrollTo(0, 0))
      await headButton(page, 'Geändert').focus()
      const button = (await headButton(page, 'Geändert').boundingBox())!
      expect(button.x).toBeGreaterThanOrEqual((await head.boundingBox())!.width)
      expect(await page.evaluate(() => window.scrollY)).toBe(0)

      // and one in a head that is stuck while the page is scrolled down
      await page.evaluate(() => window.scrollTo(0, 1500))
      await headButton(page, 'Balken').focus()
      await expect(headButton(page, 'Balken')).toBeInViewport()
      expect(await page.evaluate(() => window.scrollY)).toBe(1500)
    })
  })

  // The three widths of the card around the table (desktop): narrower than the column, wider than the column but inside the window,
  // wider than the window. The column content is at most 1216 px wide (1280 px minus the page margin of 32 px on both sides).
  const cardBox = async (page: Page) => (await page.locator('table >> xpath=..').boundingBox())!
  const radius = (page: Page, selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((element) => getComputedStyle(element).borderTopLeftRadius)

  test('a table with little content fills the column, lines up with the bar and has round corners', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 2400, height: 800 })
    // without attributes there are only the columns "Stamm", "Balken" and "Geändert"
    await page.route('**/api/snapshot', (route) =>
      route.fulfill({ json: { ...snapshotFixture, attributes: [] } }),
    )
    await page.goto('/admin/stems')
    await signIn(page, 'K7QM4XHT9RDP')
    await expect(tags(page)).toHaveCount(4)

    const bar = resultsBar(page).getByText('4 Stämme', { exact: true })
    const box = await cardBox(page)
    expect(box.width).toBeCloseTo(1216, 0)
    expect(Math.abs(box.x - (await left(bar)))).toBeLessThan(1)
    expect(await sideways(page)).toBe(0)
    for (const name of ['Tabelle nach links scrollen', 'Tabelle nach rechts scrollen'])
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
    expect(await radius(page, 'table >> xpath=..')).toBe('12px')
  })

  test('a table wider than the column but inside the window is centered and round, without sideways scrolling', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 800 })
    await page.goto('/admin/stems')
    await signIn(page, 'K7QM4XHT9RDP')
    await expect(tags(page)).toHaveCount(4)
    const natural = (await cardBox(page)).width
    expect(natural).toBeGreaterThan(1216)

    await page.setViewportSize({ width: 2400, height: 800 })
    const box = await cardBox(page)
    // as wide as before (not stretched), wider than the column, and the same room on both sides
    expect(box.width).toBeCloseTo(natural, 0)
    expect(box.width).toBeLessThan(2400)
    expect(Math.abs(box.x - (2400 - box.x - box.width))).toBeLessThan(1)
    expect(await sideways(page)).toBe(0)
    for (const name of ['Tabelle nach links scrollen', 'Tabelle nach rechts scrollen'])
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)

    // a card around the table: radius, line and white ground; the table itself has neither border nor radius
    const card = page.locator('table >> xpath=..')
    await expect(card).toHaveCSS('border-top-left-radius', '12px')
    await expect(card).toHaveCSS('border-left-width', '1px')
    await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(page.locator('table')).toHaveCSS('border-top-width', '0px')
  })

  test('only the white edge of the card shows beside the head while it sticks under the bar', async ({
    page,
  }) => {
    await openLong(page, { width: 2400, height: 700 })
    await page.evaluate(() => window.scrollTo(0, 1500))
    const head = page.getByRole('columnheader', { name: 'Stamm', exact: true })
    await expect(head).toBeInViewport()

    const beside = await head.evaluate((element) => {
      const box = element.getBoundingClientRect()
      const card = element.closest('table')!.parentElement!
      // a point left of the head, in the row of the head and in the first rows under it
      return [10, 40, 100].map((below) => {
        const found = document.elementFromPoint(box.left - 2, box.top + below)
        return found === card
      })
    })
    expect(beside).toEqual([true, true, true])
    await expect(head).toHaveCSS('border-top-left-radius', '0px')
  })

  test('a table wider than the window starts at the left edge, ends flush at the right one and keeps its round corners', async ({
    page,
    isMobile,
  }) => {
    // the phone cannot scroll the window sideways (see above)
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(isMobile, 'a phone pans instead of scrolling the window')
    await page.setViewportSize({ width: 1100, height: 800 })
    await page.goto('/admin/stems')
    await signIn(page, 'K7QM4XHT9RDP')
    await expect(tags(page)).toHaveCount(4)

    expect(await sideways(page)).toBeGreaterThan(0)
    // no page background to the left of the card
    expect((await cardBox(page)).x).toBe(0)
    expect(await radius(page, 'table >> xpath=..')).toBe('12px')

    await page.evaluate(() => window.scrollTo(document.documentElement.scrollWidth, 0))
    const box = await cardBox(page)
    expect(Math.abs(1100 - (box.x + box.width))).toBeLessThan(1)
  })

  test('keeps the page free of sideways scrolling when the list is empty or the filter unreadable', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await page.goto('/admin/stems?tags=300-400')
    await signIn(page, 'K7QM4XHT9RDP')
    await expect(page.getByRole('heading', { name: 'Waldesruh', exact: true })).toBeVisible()
    expect(await sideways(page)).toBe(0)
  })

  test('on a phone the page is wider than the window and the head stays under the bar', async ({
    page,
  }) => {
    await openLong(page, { width: 390, height: 800 })
    expect(await sideways(page)).toBeGreaterThan(0)
    await page.evaluate(() => window.scrollTo(0, 800))
    const bar = resultsBar(page)
    expect(
      Math.abs(
        (await top(page.getByRole('columnheader', { name: 'Stamm', exact: true }))) -
          (await bottom(bar)),
      ),
    ).toBeLessThan(1)
  })
})

test.describe('attributes', () => {
  test.beforeEach(async ({ page }) => {
    // Selecting scrolls the page; without animation the measurements below do not have to wait for it (one test has it with)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/admin/activity')
    await signIn(page, 'K7QM4XHT9RDP')
    await page.getByRole('button', { name: 'Verwaltung', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Merkmale', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/attributes$/)
  })

  test('opens from the gear, which is white there, and shows the preview with its count', async ({
    page,
  }) => {
    await expect(page.locator('h1')).toHaveText('Merkmale')
    await expect(page.getByRole('button', { name: 'Verwaltung', exact: true })).toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)',
    )
    await expect(page.getByText('8 Merkmale', { exact: true })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Nichts ausgewählt', exact: true }),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Balken', exact: true }).click()
    await expect(page).toHaveURL(/view=beam/)
    await expect(page.getByText('8 Merkmale', { exact: true })).toBeVisible()
  })

  test('selects a field, saves a change and keeps the selection', async ({ page }) => {
    await page.getByRole('button', { name: 'Lagerplatz', exact: true }).click()
    await expect(page).toHaveURL(/attribute=/)
    await expect(
      page.getByRole('heading', { name: 'Lagerplatz', level: 2, exact: true }),
    ).toBeVisible()
    const save = page.getByRole('button', { name: 'Speichern', exact: true })
    await expect(save).toBeDisabled()

    await page.getByLabel('Name', { exact: true }).fill('Ort')
    await expect(save).toBeEnabled()
    await save.click()

    await expect(page.getByRole('button', { name: 'Ort', exact: true })).toHaveAttribute(
      'aria-current',
      'true',
    )
    await expect(page.getByRole('heading', { name: 'Ort', level: 2, exact: true })).toBeVisible()
    await expect(save).toBeDisabled()
    await expect(page.getByText('Merkmal gespeichert', { exact: true })).toBeVisible()
    // the confirmation goes away by itself
    await expect(page.getByText('Merkmal gespeichert', { exact: true })).toHaveCount(0, {
      timeout: 6000,
    })
  })

  test('keeps the scroll position after saving, without a focus ring on the heading', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 420 })
    await page.getByRole('button', { name: 'Lagerplatz', exact: true }).click()
    await page.getByLabel('Name', { exact: true }).fill('Ort')
    const save = page.getByRole('button', { name: 'Speichern', exact: true })
    await save.scrollIntoViewIfNeeded()
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const before = await page.evaluate(() => window.scrollY)
    await save.click()
    await expect(page.getByText('Merkmal gespeichert', { exact: true })).toBeVisible()
    const heading = page.getByRole('heading', { name: 'Ort', level: 2, exact: true })
    await expect(heading).toBeFocused()
    expect(await page.evaluate(() => window.scrollY)).toBe(before)
    await expect(heading).toHaveCSS('outline-style', 'none')
  })

  test('shows no focus ring on the heading after saving with Enter', async ({ page }) => {
    await page.getByRole('button', { name: 'Lagerplatz', exact: true }).click()
    await page.getByLabel('Name', { exact: true }).fill('Ort')
    await page.getByLabel('Name', { exact: true }).press('Enter')
    const heading = page.getByRole('heading', { name: 'Ort', level: 2, exact: true })
    await expect(heading).toBeFocused()
    await expect(heading).toHaveCSS('outline-style', 'none')
  })

  test('asks before unsaved changes are lost, with its own dialog', async ({ page }) => {
    await page.getByRole('button', { name: 'Lagerplatz', exact: true }).click()
    await page.getByLabel('Name', { exact: true }).fill('Ort')

    await page.getByRole('button', { name: 'Holzart', exact: true }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Änderungen verwerfen?', exact: true })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Weiter bearbeiten', exact: true }).click()
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Ort')

    await page.getByRole('button', { name: 'Holzart', exact: true }).click()
    await dialog.getByRole('button', { name: 'Verwerfen', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Holzart', level: 2, exact: true }),
    ).toBeVisible()
  })

  test('changes the type of an attribute without values through the tiles, only "Speichern" keeps it', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Lieferdatum', exact: true }).click()
    await page.getByRole('button', { name: 'ändern', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Typ ändern', level: 2, exact: true }),
    ).toBeVisible()

    // "Abbrechen" leads back to the form without a change
    await page.getByRole('button', { name: 'Abbrechen', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Lieferdatum', level: 2, exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled()

    await page.getByRole('button', { name: 'ändern', exact: true }).click()
    await page.getByRole('button', { name: /^Text/ }).click()
    await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Speichern', exact: true }).click()
    await expect(page.getByText('Merkmal gespeichert', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled()
    await expect(page.getByLabel('Genauigkeit')).toHaveCount(0)
  })

  test('closes the form with the X: the selection ends, the focus goes to the attribute, unsaved changes are asked about', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Lagerplatz', exact: true }).click()
    await page.getByRole('button', { name: 'Schließen', exact: true }).click()
    await expect(page).not.toHaveURL(/attribute=/)
    await expect(page.getByText('Nichts ausgewählt', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Lagerplatz', exact: true })).toBeFocused()

    await page.getByRole('button', { name: 'Lagerplatz', exact: true }).click()
    await page.getByLabel('Name', { exact: true }).fill('Ort')
    await page.getByRole('button', { name: 'Schließen', exact: true }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Änderungen verwerfen?', exact: true })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Verwerfen', exact: true }).click()
    await expect(page.getByText('Nichts ausgewählt', { exact: true })).toBeVisible()
  })

  test('lets a system attribute change name and description only', async ({ page }) => {
    await page.getByRole('button', { name: 'Gesägt (Systemmerkmal)', exact: true }).click()
    await expect(
      page.getByText(
        'Systemmerkmal: Name und Beschreibung änderst du hier, der Rest ist im Code festgelegt.',
      ),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled()
    await page.getByLabel('Name', { exact: true }).fill('Fertig gesägt')
    await page.getByRole('button', { name: 'Speichern', exact: true }).click()
    await expect(page.getByText('Merkmal gespeichert')).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Fertig gesägt (Systemmerkmal)', exact: true }),
    ).toBeVisible()
  })

  // "Merkmal hinzufügen" exists twice: dashed under the preview, and in the card "Nichts ausgewählt" in the settings column
  const addButtons = {
    'the button under the preview': (page: Page) =>
      page
        .locator('[aria-label="Vorschau"]')
        .locator('xpath=../following-sibling::button')
        .filter({ hasText: 'Merkmal hinzufügen' }),
    'the button in the card "Nichts ausgewählt"': (page: Page) =>
      page
        .locator('[data-settings-column]')
        .getByRole('button', { name: 'Merkmal hinzufügen', exact: true }),
  }

  for (const [way, addButton] of Object.entries(addButtons)) {
    test(`creates an attribute with ${way}: type tiles, form with live preview, then it stays selected`, async ({
      page,
    }) => {
      await addButton(page).click()
      await expect(page).toHaveURL(/attribute=new/)
      await expect(
        page.getByRole('heading', { name: 'Neues Merkmal', level: 2, exact: true }),
      ).toBeVisible()
      await expect(page.getByText('Unbenanntes Merkmal', { exact: true })).toBeVisible()

      await page
        .getByRole('button', {
          name: 'Datum z. B. Lieferdatum, Fällzeitpunkt (nur Monat)',
          exact: true,
        })
        .click()
      await page.getByLabel('Name', { exact: true }).fill('Eingang')
      await page.getByLabel('Genauigkeit').selectOption('month')
      await expect(page.getByRole('button', { name: 'Eingang', exact: true })).toContainText(
        'MM / JJJJ',
      )

      await page.getByRole('button', { name: 'Anlegen', exact: true }).click()
      await expect(page.getByText('9 Merkmale', { exact: true })).toBeVisible()
      await expect(page.getByText('Merkmal gespeichert', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Eingang', exact: true })).toHaveAttribute(
        'aria-current',
        'true',
      )
      await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled()
    })

    test(`asks before the page is left with a draft started with ${way}`, async ({ page }) => {
      await addButton(page).click()
      await page.getByRole('button', { name: 'Text z. B. Bemerkung', exact: true }).click()
      await page.getByLabel('Name', { exact: true }).fill('Bemerkung')

      await page.getByRole('link', { name: 'Aktivität', exact: true }).click()
      const dialog = page.getByRole('alertdialog', { name: 'Änderungen verwerfen?', exact: true })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Weiter bearbeiten', exact: true }).click()
      await expect(page).toHaveURL(/\/admin\/attributes/)

      await page.getByRole('link', { name: 'Aktivität', exact: true }).click()
      await dialog.getByRole('button', { name: 'Verwerfen', exact: true }).click()
      await expect(page).toHaveURL(/\/admin\/activity/)
    })
  }

  test('shows the bin beside a new option only after its field was left, and saves one that was only typed', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Merkmal hinzufügen', exact: true }).first().click()
    await page.getByRole('button', { name: /^Auswahl/ }).click()
    await page.getByLabel('Name', { exact: true }).fill('Farbe')
    await expect(
      page.getByText('Erfassbar nur am Stamm. Balken haben dieses Merkmal nicht.', { exact: true }),
    ).toBeVisible()

    // typing: no button and no place reserved, the field gets narrower by the column (44 px and the 4 px gap) when the bin appears
    const first = page.getByLabel('Auswahl-Option 1', { exact: true })
    const width = (await first.boundingBox())!.width
    await first.fill('Rot')
    await expect(page.getByRole('button', { name: /löschen$/ })).toHaveCount(0)
    // a click beside the field: the bin appears, the option stays
    await page.getByLabel('Name', { exact: true }).click()
    await expect(page.getByRole('button', { name: '„Rot“ löschen', exact: true })).toBeVisible()
    await expect(first).toHaveValue('Rot')
    expect((await first.boundingBox())!.width).toBeCloseTo(width - 48, 0)

    await page.getByRole('button', { name: 'Auswahl-Option hinzufügen', exact: true }).click()
    await page.getByLabel('Auswahl-Option 2', { exact: true }).fill('Blau')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: '„Blau“ löschen', exact: true })).toBeVisible()

    // an empty one: leave it, then delete it
    await page.getByRole('button', { name: 'Auswahl-Option hinzufügen', exact: true }).click()
    await page.getByLabel('Name', { exact: true }).click()
    await page.getByRole('button', { name: 'Leere Auswahl-Option löschen', exact: true }).click()
    await expect(page.getByLabel('Auswahl-Option 3', { exact: true })).toHaveCount(0)

    await page.getByRole('button', { name: 'Auswahl-Option hinzufügen', exact: true }).click()
    await page.getByLabel('Auswahl-Option 3', { exact: true }).fill('Grün')
    await page.getByRole('button', { name: 'Anlegen', exact: true }).click()
    await expect(page.getByText('Merkmal gespeichert', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled()
    await expect(page.getByLabel('Auswahl-Option 3', { exact: true })).toHaveValue('Grün')
  })

  test('sorts with the arrow keys and the order stays after a reload', async ({ page }) => {
    const names = () =>
      page
        .locator(
          '[aria-label="Vorschau"] button[aria-current], [aria-label="Vorschau"] li > div > button:first-child',
        )
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))
    expect((await names())[0]).toBe('Holzart')

    await page.getByRole('button', { name: 'Holzart verschieben', exact: true }).focus()
    await page.keyboard.press('ArrowDown')
    await expect.poll(async () => (await names())[1]).toBe('Holzart')
    await expect(
      page.getByRole('button', { name: 'Holzart verschieben', exact: true }),
    ).toBeFocused()

    await page.reload()
    await expect.poll(async () => (await names())[1]).toBe('Holzart')
  })

  test('sorts by dragging the handle', async ({ page }) => {
    // tall enough that the handles are clear of the window edges, where the page would scroll on during a drag
    await page.setViewportSize({ width: 1280, height: 1600 })
    const first = page.getByRole('button', { name: 'Holzart verschieben', exact: true })
    const third = page.getByRole('button', { name: 'Lieferdatum verschieben', exact: true })
    const from = (await first.boundingBox())!
    const to = (await third.boundingBox())!

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 + 20, { steps: 8 })
    await page.mouse.up()

    // the position in the list is what the drag changes
    await expect(page.locator('[aria-label="Vorschau"] > li').nth(2)).toContainText('Holzart')
    await expect(page.locator('[aria-label="Vorschau"] > li').nth(0)).toContainText('Fälldatum')
  })

  // The card and the arrow, measured against the selected field (the visible frame of its button)
  const centerY = async (locator: Locator) => {
    const box = (await locator.boundingBox())!
    return box.y + box.height / 2
  }

  test('starts the card at the height of the selected field from 1024px on, with the arrow pointing at it, and the page jumps to it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    // a field far down the preview: the page jumps, the field and the card start under the bar
    const field = page.getByRole('button', { name: 'Holzfeuchte', exact: true })
    await field.click()
    await expectAtScrollTarget(page, field)

    const card = page.getByRole('region', { name: 'Holzfeuchte', exact: true })
    await expect(card).toBeVisible()
    expect(Math.abs((await card.boundingBox())!.y - (await field.boundingBox())!.y)).toBeLessThan(2)
    // the arrow sits on the card's left edge at the middle of the field, and the card has no scrollbar of its own
    const arrow = page.locator('[data-card-arrow]')
    expect(Math.abs((await centerY(arrow)) - (await centerY(field)))).toBeLessThan(2)
    const left = (await card.boundingBox())!.x
    expect(
      Math.abs((await arrow.boundingBox())!.x + (await arrow.boundingBox())!.width / 2 - left),
    ).toBeLessThan(2)
    const scrollers = await page
      .locator('[data-settings-column]')
      .evaluate(
        (column) =>
          [column, ...column.querySelectorAll('*')].filter(
            (el) =>
              /auto|scroll/.test(getComputedStyle(el).overflowY) &&
              el.scrollHeight > el.clientHeight,
          ).length,
      )
    expect(scrollers).toBe(0)

    // nothing selected: the card stands at the top again, without an arrow
    await page.getByRole('button', { name: 'Schließen', exact: true }).click()
    await expect(page.locator('[data-card-arrow]')).toHaveCount(0)
    const preview = (await page.getByRole('list', { name: 'Vorschau', exact: true }).boundingBox())!
    const column = (await page.locator('[data-settings-column]').boundingBox())!
    // the preview card has 8 px of padding above its list
    expect(Math.abs(column.y - (preview.y - 8))).toBeLessThan(2)
  })

  // Under the header and the bar, with the distance of every other scroll target
  const scrollPaddingTop = (page: Page) =>
    page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop),
    )

  // Where the scroll lands: the field starts under the header and the bar, or the page ends before it can get there
  const expectAtScrollTarget = async (page: Page, field: Locator) => {
    await expect
      .poll(async () => {
        const y = (await field.boundingBox())!.y
        const top = await scrollPaddingTop(page)
        const atEnd = await page.evaluate(
          () =>
            Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight,
        )
        return y >= top - 2 && (atEnd || Math.abs(y - top) < 2)
      })
      .toBe(true)
  }

  test('scrolls to the selected field when the page is opened with it in the URL', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 420 })
    await page.getByRole('button', { name: 'Holzfeuchte', exact: true }).click()
    await expect(page).toHaveURL(/attribute=/)
    const url = page.url()

    // opened again: the page starts at the top and scrolls to the field
    await page.goto(url)
    await expectAtScrollTarget(page, page.getByRole('button', { name: 'Holzfeuchte', exact: true }))
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  })

  test('scrolls to the selection that the back button brings, wherever the browser would put the page', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 420 })
    await page.getByRole('button', { name: 'Holzfeuchte', exact: true }).click()
    await expect(page).toHaveURL(/attribute=/)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.getByRole('button', { name: 'Holzart', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Holzart', exact: true })).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 0))

    await page.goBack()
    const field = page.getByRole('button', { name: 'Holzfeuchte', exact: true })
    await expect(field).toBeInViewport()
    expect(Math.abs((await field.boundingBox())!.y - (await scrollPaddingTop(page)))).toBeLessThan(
      2,
    )
  })

  test('starts the type tiles and the form of a new attribute at the placeholder', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page
      .locator('[data-settings-column]')
      .getByRole('button', { name: 'Merkmal hinzufügen', exact: true })
      .click()
    const placeholder = page.locator('[data-placeholder]')
    const card = page.getByRole('region', { name: 'Neues Merkmal', exact: true })
    await expect(card).toBeVisible()
    await expectAtScrollTarget(page, placeholder)
    expect(
      Math.abs((await card.boundingBox())!.y - (await placeholder.boundingBox())!.y),
    ).toBeLessThan(2)
    expect(
      Math.abs((await centerY(page.locator('[data-card-arrow]'))) - (await centerY(placeholder))),
    ).toBeLessThan(2)
  })

  test('has a long form that grows downwards, with the page scrolling to the buttons at the end of the card and nothing stuck', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 420 })
    const field = page.getByRole('button', { name: 'Lagerplatz', exact: true })
    await field.click()
    await expectAtScrollTarget(page, field)
    const card = page.getByRole('region', { name: 'Lagerplatz', exact: true })
    const save = page.getByRole('button', { name: 'Speichern', exact: true })
    const bottomOf = async (locator: Locator) => {
      const box = (await locator.boundingBox())!
      return box.y + box.height
    }

    // the card reaches below the window, the buttons are at its end and out of view
    expect(await bottomOf(card)).toBeGreaterThan(420)
    await expect(save).not.toBeInViewport()
    // no box of its own: the card is as high as its content
    expect(
      await card.evaluate((element) => element.scrollHeight - element.clientHeight),
    ).toBeLessThanOrEqual(0)

    // the page scrolls down to them, they stay at the end of the card (20 px padding and the 1 px frame below the button)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect(save).toBeInViewport()
    expect(Math.abs((await bottomOf(card)) - (await bottomOf(save)) - 21)).toBeLessThan(2)
    const y = await save.evaluate((element) => element.getBoundingClientRect().top + scrollY)
    await page.evaluate(() => window.scrollBy(0, -100))
    expect(await save.evaluate((element) => element.getBoundingClientRect().top + scrollY)).toBe(y)
  })

  test('scrolls smoothly to the field unless the motion is reduced', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.setViewportSize({ width: 1280, height: 420 })
    const field = page.getByRole('button', { name: 'Holzfeuchte', exact: true })
    await field.click()

    await expectAtScrollTarget(page, field)
    await expect(page.getByRole('region', { name: 'Holzfeuchte', exact: true })).toBeVisible()
  })

  test('puts the card below the preview under 1024px, without an arrow', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 })
    await page.getByRole('button', { name: 'Lagerplatz', exact: true }).click()
    const card = page.getByRole('region', { name: 'Lagerplatz', exact: true })
    await expect(card).toBeVisible()
    const preview = (await page.getByRole('list', { name: 'Vorschau', exact: true }).boundingBox())!
    expect((await card.boundingBox())!.y).toBeGreaterThanOrEqual(preview.y + preview.height)
    await expect(page.locator('[data-card-arrow]')).toBeHidden()
  })

  test('moves the card and the arrow along with the selected field when it is sorted', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const field = page.getByRole('button', { name: 'Holzart', exact: true })
    await field.click()
    await expectAtScrollTarget(page, field)
    // at the top of the page, where the browser does not keep the position of the page by scrolling when the fields change places
    await page.evaluate(() => window.scrollTo(0, 0))
    const card = page.getByRole('region', { name: 'Holzart', exact: true })
    await expect(card).toBeVisible()
    const before = (await card.boundingBox())!.y

    await page.getByRole('button', { name: 'Holzart verschieben', exact: true }).focus()
    await page.keyboard.press('ArrowDown')
    await expect.poll(async () => (await card.boundingBox())!.y).toBeGreaterThan(before + 40)
    expect(Math.abs((await card.boundingBox())!.y - (await field.boundingBox())!.y)).toBeLessThan(2)
    expect(
      Math.abs((await centerY(page.locator('[data-card-arrow]'))) - (await centerY(field))),
    ).toBeLessThan(2)
  })

  test('stays free of sideways scrolling', async ({ page }) => {
    await page.getByRole('button', { name: 'Lagerplatz', exact: true }).click()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBe(0)
  })
})

test.describe('users', () => {
  // The clipboard of a headless browser is not readable without permissions: the copied text is kept on the window
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async (text: string) =>
            ((window as never as { copied: string }).copied = text),
        },
      })
    })
    await page.goto('/admin/activity')
  })

  const open = async (page: Page, code: string) => {
    await signIn(page, code)
    await page.getByRole('button', { name: 'Verwaltung', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Nutzer', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/users$/)
    await expect(page.getByText('5 Nutzer', { exact: true })).toBeVisible()
  }
  const user = (page: Page, name: string) => page.locator(`[data-user="${name}"]`)
  const card = (page: Page, name: string) =>
    page.getByRole('region', { name: `Einstellungen von ${name}`, exact: true })
  const toggle = (page: Page, name: string) => user(page, name).getByRole('button')

  test('adds a user: the form closes and the new user is open with the code, which is copied', async ({
    page,
  }) => {
    await open(page, 'K7QM4XHT9RDP')

    await page.getByRole('button', { name: 'Nutzer hinzufügen', exact: true }).click()
    await page.getByLabel('Name', { exact: true }).fill('Eva')
    await page.getByRole('button', { name: 'Anlegen', exact: true }).click()

    await expect(page.getByText('6 Nutzer', { exact: true })).toBeVisible()
    await expect(user(page, 'Eva')).toBeVisible()
    await expect(card(page, 'Eva')).toContainText('N1AA-BBBB-CCCC')
    await expect(page.locator('[data-add-arrow]')).toHaveCount(0)

    await card(page, 'Eva').getByRole('button', { name: 'Code kopieren', exact: true }).click()
    await expect(
      card(page, 'Eva').getByRole('button', { name: 'Kopiert', exact: true }),
    ).toBeVisible()
    expect(await page.evaluate(() => (window as never as { copied: string }).copied)).toBe(
      'N1AA-BBBB-CCCC',
    )
  })

  test('opens one user at a time; the arrow sits under the chevron of the row', async ({
    page,
  }) => {
    await open(page, 'K7QM4XHT9RDP')

    await toggle(page, 'Bruno').click()
    await expect(card(page, 'Bruno')).toContainText('nicht gespeichert')
    await toggle(page, 'Dora').click()
    await expect(card(page, 'Bruno')).toHaveCount(0)
    await expect(card(page, 'Dora')).toContainText('Wird aus Sicherheitsgründen nicht gespeichert.')

    const chevron = (await user(page, 'Dora').locator('[data-chevron]').boundingBox())!
    const arrow = (await page.locator('[data-card-arrow]').boundingBox())!
    expect(Math.abs(chevron.x + chevron.width / 2 - (arrow.x + arrow.width / 2))).toBeLessThan(2)
  })

  test('the arrow of the add card points at the button', async ({ page }) => {
    await open(page, 'K7QM4XHT9RDP')
    const add = page.getByRole('button', { name: 'Nutzer hinzufügen', exact: true })
    await add.click()

    const button = (await add.boundingBox())!
    const arrow = (await page.locator('[data-add-arrow]').boundingBox())!
    expect(Math.abs(button.x + button.width / 2 - (arrow.x + arrow.width / 2))).toBeLessThan(2)
  })

  test('opens and closes a user by a click anywhere in the row, but not the superadmin', async ({
    page,
  }) => {
    await open(page, 'K7QM4XHT9RDP')

    // The button covers the row, so Playwright would call it "intercepting" a click on a cell: click at the position instead
    const clickCell = async (name: string) => {
      const box = (await user(page, name).locator('td').nth(1).boundingBox())!
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    }
    await clickCell('Bruno')
    await expect(card(page, 'Bruno')).toBeVisible()
    await clickCell('Bruno')
    await expect(card(page, 'Bruno')).toHaveCount(0)

    await clickCell('Ada')
    await expect(page.locator('section[aria-label^="Einstellungen von"]')).toHaveCount(0)
  })

  test('renews the code after a question, which makes the old one invalid', async ({ page }) => {
    await open(page, 'K7QM4XHT9RDP')
    await toggle(page, 'Bruno').click()

    await card(page, 'Bruno').getByRole('button', { name: 'Neuer Code', exact: true }).click()
    const dialog = page.getByRole('alertdialog', {
      name: 'Neuen Code für Bruno erzeugen?',
      exact: true,
    })
    await expect(dialog).toContainText('werden abgemeldet')
    await dialog.getByRole('button', { name: 'Neuen Code erzeugen', exact: true }).click()

    await expect(card(page, 'Bruno')).toContainText('N1AA-BBBB-CCCC')
    await expect(card(page, 'Bruno')).toContainText('nur dieses eine Mal')
    await expect(card(page, 'Bruno').getByRole('img', { name: 'Warnung' })).toBeVisible()
    // closed and opened again: the code is gone
    await toggle(page, 'Bruno').click()
    await toggle(page, 'Bruno').click()
    await expect(card(page, 'Bruno')).not.toContainText('N1AA-BBBB-CCCC')
  })

  test('blocks after a question and unblocks', async ({ page }) => {
    await open(page, 'K7QM4XHT9RDP')
    await toggle(page, 'Bruno').click()

    await card(page, 'Bruno').getByRole('button', { name: 'Sperren', exact: true }).click()
    await page
      .getByRole('alertdialog', { name: 'Bruno sperren?', exact: true })
      .getByRole('button', { name: 'Sperren', exact: true })
      .click()
    await expect(user(page, 'Bruno').getByText('Gesperrt', { exact: true })).toBeVisible()
    await expect(
      card(page, 'Bruno').getByRole('button', { name: 'Neuer Code', exact: true }),
    ).toHaveCount(0)

    await card(page, 'Bruno').getByRole('button', { name: 'Entsperren', exact: true }).click()
    await expect(user(page, 'Bruno').getByText('Gesperrt', { exact: true })).toHaveCount(0)
    await expect(
      card(page, 'Bruno').getByRole('button', { name: 'Neuer Code', exact: true }),
    ).toBeVisible()
  })

  test('renames with "Speichern"', async ({ page }) => {
    await open(page, 'K7QM4XHT9RDP')
    await toggle(page, 'Bruno').click()

    await card(page, 'Bruno').getByLabel('Name', { exact: true }).fill('Brunhild')
    await card(page, 'Bruno').getByRole('button', { name: 'Speichern', exact: true }).click()

    await expect(user(page, 'Brunhild')).toBeVisible()
    await expect(user(page, 'Bruno')).toHaveCount(0)
  })

  test('leaves an admin without a role to choose, and gives the superadmin the role of everybody but their own', async ({
    page,
  }) => {
    await open(page, 'K7QM4XHT9RDP')
    await expect(toggle(page, 'Chef')).toHaveCount(0)
    await toggle(page, 'Bruno').click()
    await expect(card(page, 'Bruno').getByRole('combobox')).toHaveCount(0)
    await page.getByRole('button', { name: 'Abmelden', exact: true }).click()

    await signIn(page, 'S4PA2DM1N8QX')
    await page.getByRole('button', { name: 'Verwaltung', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Nutzer', exact: true }).click()
    await expect(toggle(page, 'Ada')).toHaveCount(0)
    await toggle(page, 'Bruno').click()
    await card(page, 'Bruno').getByLabel('Rolle', { exact: true }).selectOption('admin')
    await card(page, 'Bruno').getByRole('button', { name: 'Speichern', exact: true }).click()
    await expect(user(page, 'Bruno').getByText('Admin', { exact: true })).toBeVisible()
  })

  for (const width of [1000, 390]) {
    test(`stays free of sideways scrolling at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await open(page, 'S4PA2DM1N8QX')
      await toggle(page, 'Bruno').click()
      await expect(card(page, 'Bruno')).toBeVisible()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBe(0)
    })
  }
})
