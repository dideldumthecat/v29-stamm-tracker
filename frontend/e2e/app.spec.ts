import { test, expect, type Locator, type Page } from '@playwright/test'

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
  await page.getByRole('button', { name: 'Zurück zum Start' }).click()
  await expect(page.locator('h1')).toHaveText('V29 Stamm-Tracker')
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

// Production browsers get no form at all (unit test); the fake API keeps it for these tests.
test('start page in the browser asks to install the app first', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(SIGNED_OUT)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Willkommen' })).toBeVisible()
  await expect(page.getByText('Bitte zuerst die App installieren')).toBeVisible()
})

test('signs in with a typed code', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(SIGNED_OUT)
  await page.reload()
  await expect(page.getByRole('button', { name: '1', exact: true })).toHaveCount(0)
  const field = page.getByLabel('Einladungscode')
  await field.pressSequentially('k7qm4xht9rdpxx')
  await expect(field).toHaveValue('K7QM-4XHT-9RDP')
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.locator('header').getByText('Alexander', { exact: true })).toBeVisible()
  await expect(page.getByText('Stand der Daten:')).toBeVisible()
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

  await page.getByLabel('Einladungscode').fill('K7QM-4XHT-9RDP')
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByText('2 Einträge übertragen')).toBeVisible()
})

test('sync without pending changes offers to refresh the data', async ({ page }) => {
  await page.goto('/sync')
  await expect(
    page.getByRole('heading', { name: 'Keine Änderungen auf diesem Gerät' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Daten aktualisieren' }).click()
  await expect(page.getByRole('heading', { name: 'Synchronisiert' })).toBeVisible()
})

// Flow: a synced beam gets its own plaque and is found by it from the start screen only.
test('a beam gets a new plaque, refusing a taken one', async ({ page }) => {
  const type = async (digits: string) => {
    for (const digit of digits) {
      await page.getByRole('button', { name: digit, exact: true }).click()
    }
  }
  await page.goto('/sync')
  await page.getByRole('button', { name: 'Daten aktualisieren' }).click()
  await expect(page.getByRole('heading', { name: 'Synchronisiert' })).toBeVisible()

  await page.goto('/timber-item/789-A')
  await page.getByRole('button', { name: 'Plakette ändern' }).click()
  await type('456')
  await expect(page.getByText('ist schon vergeben')).toHaveText(
    'Plakette 00456 ist schon vergeben.',
  )
  await expect(page.getByRole('button', { name: 'Plakette ändern' })).toBeDisabled()

  await page.getByRole('button', { name: 'Leeren' }).click()
  await type('345')
  await page.getByRole('button', { name: 'Plakette ändern' }).click()
  await expect(page.getByRole('dialog')).toContainText('00789-A → 00345')
  await page.getByRole('dialog').getByRole('button', { name: 'Plakette ändern' }).click()
  await expect(page.locator('h1')).toContainText('BALKEN')
  await expect(page.locator('h1')).toContainText('00345')

  await page.goto('/')
  await type('345')
  await page.getByRole('button', { name: 'Stamm öffnen' }).click()
  await expect(page.locator('h1')).toContainText('BALKEN')
  await expect(page.getByRole('link', { name: /Aus Stamm 00789/ })).toBeVisible()
  // The old tag leads nowhere: unknown beam tags go back to the start screen.
  await page.goto('/timber-item/789-A')
  await expect(page).toHaveURL('/')

  await page.goto('/sync')
  await expect(page.locator('h1')).toHaveText('Synchronisierung (1)')
  await expect(page.getByText('Plakette geändert: 00345')).toBeVisible()

  // A beam holding the plaque is named by its stem.
  await page.goto('/timber-item/789-B')
  await page.getByRole('button', { name: 'Plakette ändern' }).click()
  await type('345')
  await expect(page.getByText('ist schon vergeben')).toHaveText(
    'Plakette 00345 ist schon vergeben: Balken aus Stamm 00789.',
  )
})

// Flow: an unsynced stem is discarded on the sync screen; cancelling the confirmation keeps it.
test('discards a new stem on the sync screen after confirming', async ({ page }) => {
  await page.goto('/timber-item/1666')
  await page.getByRole('button', { name: 'Stamm anlegen & schließen' }).click()
  await expect(page.getByText('Stamm 01666 gespeichert')).toBeVisible()

  await page.goto('/sync')
  await expect(page.locator('h1')).toHaveText('Synchronisierung (1)')
  await page.getByRole('button', { name: 'Eintrag verwerfen' }).click()
  await expect(page.getByRole('dialog')).toContainText('Stamm 01666 mit allen Angaben verwerfen?')
  await page.getByRole('button', { name: 'Abbrechen' }).click()
  await expect(page.locator('h1')).toHaveText('Synchronisierung (1)')

  await page.getByRole('button', { name: 'Eintrag verwerfen' }).click()
  await page.getByRole('button', { name: 'Verwerfen', exact: true }).click()
  await expect(page.locator('h1')).toHaveText('Synchronisierung')
  await expect(
    page.getByRole('heading', { name: 'Keine Änderungen auf diesem Gerät' }),
  ).toBeVisible()
})

// The automatic update downloads only: pending entries stay on the device for the sync button.
test('opening the app refreshes the data without tapping and keeps pending entries', async ({
  page,
}) => {
  await page.goto('/')
  // A fresh device never synced; the start-up download stamps the time.
  await expect(page.getByText('Stand der Daten:')).not.toContainText('noch nie')

  await page.goto('/timber-item/1888')
  await page.getByLabel('Holzart').selectOption({ label: 'Traubeneiche' })
  await page.getByRole('button', { name: 'Stamm anlegen & schließen' }).click()
  await expect(page.getByRole('link', { name: 'Synchronisieren, 2 offene Einträge' })).toBeVisible()

  await page.reload()
  await expect(page.getByText('Stand der Daten:')).not.toContainText('noch nie')
  await expect(page.getByRole('link', { name: 'Synchronisieren, 2 offene Einträge' })).toBeVisible()
})

// iOS cannot lock the orientation, so landscape on a phone shows an overlay over the (still mounted) app.
test('landscape phone shows the rotate hint and keeps the entry', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '7', exact: true }).click()
  const hint = page.getByText('Bitte das Handy hochkant halten.')
  await expect(hint).toBeHidden()

  await page.setViewportSize({ width: 844, height: 390 })
  await expect(hint).toBeVisible()
  await expect(
    page.getByRole('button', { name: '7', exact: true }).click({ trial: true, timeout: 1000 }),
  ).rejects.toThrow(/intercepts pointer events/)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(hint).toBeHidden()
  await expect(page.getByText('Stammnummer: 7')).toBeAttached()
})

test('landscape tablet shows no rotate hint', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/')
  await expect(page.locator('h1')).toBeVisible()
  await expect(page.getByText('Bitte das Handy hochkant halten.')).toBeHidden()
})

// Photos: the "file chooser" stands in for the system camera.
const PHOTO = 'e2e/fixtures/photo.jpg'

async function takePhoto(page: Page) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Foto aufnehmen' }).click()
  await (await chooser).setFiles(PHOTO)
}

// In-app navigation: no reload, so the tests do not depend on the device storage (see the reload test).
async function openStem(page: Page, digits: string) {
  for (const digit of digits) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  await page.getByRole('button', { name: /öffnen/i }).click()
}

// The tile shows up before the write to the device is through; leaving the page earlier would lose the photo.
async function photoStored(page: Page, count: number) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const open = indexedDB.open('v29-stamm-tracker')
            open.onsuccess = () => {
              const request = open.result.transaction('photos').objectStore('photos').count()
              request.onsuccess = () => {
                open.result.close()
                resolve(request.result)
              }
            }
          }),
      ),
    )
    .toBe(count)
}

const preview = (page: Page) => page.getByAltText('Foto, noch nicht hochgeladen')

// Photos are part of the draft: nothing is stored until "Speichern & schließen".
const saveDraft = (page: Page) => page.getByRole('button', { name: /& schließen$/ }).click()
const close = (page: Page) => page.getByRole('button', { name: 'Schließen', exact: true }).click()
const syncLink = (page: Page, count: number) =>
  page.getByRole('link', { name: `Synchronisieren, ${count} offene Einträge` })

test('a photo on an unknown stem creates nothing when discarded', async ({ page }) => {
  await page.goto('/timber-item/1444')
  await expect(page.getByText('Noch nicht erfasst')).toBeVisible()
  await takePhoto(page)
  await expect(preview(page)).toHaveCount(1)
  // The wide first-photo button is replaced by the tile grid; the stem does not exist yet.
  await expect(page.getByRole('button', { name: 'Foto aufnehmen' })).toHaveCount(1)
  await expect(page.getByText('Noch nicht erfasst')).toBeVisible()

  await close(page)
  await expect(page.getByRole('dialog')).toContainText('1 Foto verwerfen?')
  await page.getByRole('button', { name: 'Verwerfen', exact: true }).click()
  await expect(page.locator('h1')).toHaveText('V29 Stamm-Tracker')
  await expect(syncLink(page, 0)).toBeVisible()

  await openStem(page, '1444')
  await expect(page.getByText('Noch nicht erfasst')).toBeVisible()
  await expect(preview(page)).toHaveCount(0)
})

test('a photo on an unknown stem is stored with the stem and survives a reload', async ({
  page,
  browserName,
}) => {
  await page.goto('/timber-item/1444')
  await takePhoto(page)
  await page.getByLabel('Holzart').selectOption({ label: 'Traubeneiche' })
  await saveDraft(page)
  await expect(page.locator('h1')).toHaveText('V29 Stamm-Tracker')
  // Stem, Holzart and photo.
  await expect(syncLink(page, 3)).toBeVisible()

  // Playwright's WebKit runs without a disk profile and cannot store Blobs in IndexedDB: check that on a real iPhone.
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(browserName === 'webkit', 'WebKit in Playwright cannot store Blobs in IndexedDB')
  await photoStored(page, 1)
  await page.reload()
  await openStem(page, '1444')
  await expect(preview(page)).toHaveCount(1)
  await expect(page.getByText('Bereits erfasst')).toBeVisible()
})

test('leaving an existing stem with a photo asks first; "Weiter bearbeiten" keeps it, "Verwerfen" drops it', async ({
  page,
}) => {
  await page.goto('/timber-item/123')
  await takePhoto(page)
  await expect(preview(page)).toHaveCount(1)

  await close(page)
  await expect(page.getByRole('dialog')).toContainText('1 Foto verwerfen?')
  await page.getByRole('button', { name: 'Weiter bearbeiten' }).click()
  await expect(preview(page)).toHaveCount(1)

  await close(page)
  await page.getByRole('button', { name: 'Verwerfen', exact: true }).click()
  await expect(syncLink(page, 0)).toBeVisible()
  await openStem(page, '123')
  await expect(preview(page)).toHaveCount(0)
})

test('a photo and a field change are saved together and survive a reload', async ({
  page,
  browserName,
}) => {
  await page.goto('/timber-item/456')
  await takePhoto(page)
  await page.getByLabel('Holzart').selectOption({ label: 'Traubeneiche' })
  await close(page)
  await expect(page.getByRole('dialog')).toContainText('1 Foto und 1 Änderung verwerfen?')
  await page.getByRole('button', { name: 'Weiter bearbeiten' }).click()

  await saveDraft(page)
  await expect(syncLink(page, 2)).toBeVisible()

  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(browserName === 'webkit', 'WebKit in Playwright cannot store Blobs in IndexedDB')
  await photoStored(page, 1)
  await page.reload()
  await openStem(page, '456')
  await expect(preview(page)).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Holzart ändern' })).toBeVisible()
})

test('removing a draft photo asks first', async ({ page }) => {
  await page.goto('/timber-item/123')
  await takePhoto(page)
  await expect(preview(page)).toHaveCount(1)

  await page.getByRole('button', { name: 'Foto entfernen' }).click()
  await page.getByRole('button', { name: 'Abbrechen' }).click()
  await expect(preview(page)).toHaveCount(1)

  await page.getByRole('button', { name: 'Foto entfernen' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Foto entfernen' }).click()
  await expect(preview(page)).toHaveCount(0)
})

test('removing a saved, not yet uploaded photo asks first', async ({ page }) => {
  await page.goto('/timber-item/123')
  await takePhoto(page)
  await saveDraft(page)
  await openStem(page, '123')
  await expect(preview(page)).toHaveCount(1)

  await page.getByRole('button', { name: 'Foto entfernen' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Foto entfernen' }).click()
  await expect(preview(page)).toHaveCount(0)
  await close(page)
  await expect(syncLink(page, 0)).toBeVisible()
})

test('the photo section switches layout with the first photo and fits a narrow phone', async ({
  page,
}) => {
  await page.goto('/timber-item/123')
  const camera = page.getByRole('button', { name: 'Foto aufnehmen' })
  const gallery = page.getByRole('button', { name: 'Aus Galerie' })
  const stack = page.getByRole('img', { name: '1 Foto hochgeladen' })
  const cell = stack.locator('..')
  const box = async (locator: Locator) => (await locator.boundingBox())!

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 640 })
    // Stem 123 holds one uploaded photo: stack and both buttons in one row.
    await expect(page.getByRole('heading', { name: 'Fotos (1)' })).toBeVisible()
    const [cellBox, front, buttons] = [await box(cell), await box(stack), await box(camera)]
    // The whole stack stays inside its cell: gap to the buttons is the grid gap (8px), edges are flush.
    expect(buttons.x - (cellBox.x + cellBox.width)).toBeCloseTo(8, 0)
    expect(cellBox.y).toBeCloseTo(buttons.y, 0)
    expect(front.y + front.height).toBeCloseTo(buttons.y + buttons.height, 0)
    expect(front.x).toBeCloseTo(cellBox.x, 0)
    const outlines = await cell
      .locator('span')
      .evaluateAll((spans) => spans.map((span) => span.getBoundingClientRect().toJSON()))
    for (const outline of outlines) {
      expect(outline.right).toBeLessThanOrEqual(cellBox.x + cellBox.width + 0.5)
      expect(outline.top).toBeGreaterThanOrEqual(cellBox.y - 0.5)
    }
    for (const button of [camera, gallery]) {
      expect(await button.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    }
  }

  await takePhoto(page)
  await expect(page.getByRole('heading', { name: 'Fotos (2)' })).toBeVisible()
  // Now the buttons sit below the stack and the preview, which line up on both edges.
  const [cellBox, front, previewBox, buttons] = [
    await box(cell),
    await box(stack),
    await box(preview(page)),
    await box(camera),
  ]
  expect(buttons.y).toBeGreaterThan(cellBox.y + cellBox.height)
  expect(cellBox.y).toBeCloseTo(previewBox.y, 0)
  expect(cellBox.height).toBeCloseTo(previewBox.height, 0)
  expect(front.y + front.height).toBeCloseTo(previewBox.y + previewBox.height, 0)
})

test('uploads photos after the data and leaves the count tile', async ({ page }) => {
  await page.goto('/timber-item/123')
  // Stem 123 holds one uploaded photo already: a grey tile with the count.
  const count = page.getByRole('img', { name: '1 Foto hochgeladen' })
  await expect(count).toHaveText('1')
  await takePhoto(page)
  await expect(preview(page)).toHaveCount(1)
  await expect(count).toHaveText('1')
  await saveDraft(page)

  await syncLink(page, 1).click()
  await expect(page.locator('h1')).toHaveText('Synchronisierung (1)')
  await expect(page.getByText(/^Foto \(\d+ KB\)$/)).toBeVisible()
  await expect(page.getByText(/^1 Foto · \d+ KB$/)).toBeVisible()
  await page.getByRole('button', { name: 'Jetzt synchronisieren' }).click()
  await expect(page.getByRole('progressbar')).toBeVisible()
  await expect(page.getByText('Foto 1 von 1')).toBeVisible()
  await expect(page.getByText('1 Foto hochgeladen, aktueller Stand geladen.')).toBeVisible()

  await page.getByRole('button', { name: 'Zurück zum Start' }).click()
  await openStem(page, '123')
  await expect(preview(page)).toHaveCount(0)
  await expect(count).toHaveText('1')
})

test('cancelling the photos keeps them; the next sync uploads them', async ({ page }) => {
  await page.goto('/timber-item/123')
  await takePhoto(page)
  await takePhoto(page)
  await expect(preview(page)).toHaveCount(2)
  await saveDraft(page)

  await syncLink(page, 2).click()
  await page.getByRole('button', { name: 'Jetzt synchronisieren' }).click()
  await expect(page.getByText('Foto 1 von 2')).toBeVisible()
  await page.getByRole('button', { name: 'Abbrechen' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Abgebrochen. 2 Fotos bleiben auf diesem Gerät.',
  )
  await expect(page.locator('h1')).toHaveText('Synchronisierung (2)')

  await page.getByRole('button', { name: 'Jetzt synchronisieren' }).click()
  await expect(page.getByText('2 Fotos hochgeladen, aktueller Stand geladen.')).toBeVisible()
})

// Photos from the library: the same chooser, several files at once.
async function pickPhotos(page: Page, files: string[]) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Aus Galerie' }).click()
  await (await chooser).setFiles(files)
}

test('three photos from the library stay in the draft until saving, then upload like captured ones', async ({
  page,
}) => {
  await page.goto('/timber-item/123')
  await pickPhotos(page, [PHOTO, 'e2e/fixtures/photo-2.jpg', PHOTO])
  await expect(preview(page)).toHaveCount(3)
  await close(page)
  await expect(page.getByRole('dialog')).toContainText('3 Fotos verwerfen?')
  await page.getByRole('button', { name: 'Weiter bearbeiten' }).click()
  await saveDraft(page)

  await syncLink(page, 3).click()
  await page.getByRole('button', { name: 'Jetzt synchronisieren' }).click()
  await expect(page.getByText('3 Fotos hochgeladen, aktueller Stand geladen.')).toBeVisible()

  await page.getByRole('button', { name: 'Zurück zum Start' }).click()
  await openStem(page, '123')
  await expect(preview(page)).toHaveCount(0)
  await expect(page.getByRole('img', { name: '1 Foto hochgeladen' })).toHaveText('1')
})

test('an unreadable file is skipped, the others join the draft of the new stem', async ({
  page,
  browserName,
}) => {
  await page.goto('/timber-item/1445')
  await expect(page.getByRole('button', { name: 'Foto aufnehmen' })).toBeVisible()
  await pickPhotos(page, [PHOTO, 'e2e/fixtures/broken.jpg', 'e2e/fixtures/photo-2.jpg'])
  await expect(preview(page)).toHaveCount(2)
  await expect(page.getByText('1 Foto konnte nicht gelesen werden')).toBeVisible()

  await saveDraft(page)
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(browserName === 'webkit', 'WebKit in Playwright cannot store Blobs in IndexedDB')
  await photoStored(page, 2)
  await page.reload()
  await openStem(page, '1445')
  await expect(preview(page)).toHaveCount(2)
})

test('a split stem offers neither camera nor library', async ({ page }) => {
  await page.goto('/timber-item/789')
  await expect(page.getByText('Aufgeteilter Stamm')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Foto aufnehmen' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Aus Galerie' })).toHaveCount(0)
})
