import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, type VueWrapper } from '@vue/test-utils'

import { user } from '@/auth'
import {
  attributeOf,
  buttonWith,
  countText,
  dialog,
  dialogButton,
  field,
  handle,
  handles,
  open,
  previewNames,
  settings,
  squeezed,
} from './attributesPage'
import snapshot from '@v29/shared/fixtures/snapshot.json' with { type: 'json' }

import { stubBrowser } from './popup'

enableAutoUnmount(afterEach)
beforeEach(() => {
  user.value = null
  stubBrowser()
})
afterEach(() => vi.unstubAllGlobals())

const SYSTEM_NOTE =
  'Systemmerkmal: Name und Beschreibung änderst du hier, der Rest ist im Code festgelegt.'

describe('access', () => {
  it('opens the page from the gear in the header, which is white on that page', async () => {
    const { wrapper, router } = await open('/activity')
    const gear = wrapper.get('button[aria-label="Verwaltung"]')
    expect(gear.classes()).not.toContain('bg-paper')

    await gear.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    const link = [...document.querySelectorAll('a')].find(
      (a) => a.textContent!.trim() === 'Merkmale',
    )!
    link.click()
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('attributes')
    expect(wrapper.get('button[aria-label="Verwaltung"]').classes()).toContain('bg-paper')
    expect(wrapper.get('h1').text()).toBe('Merkmale')
  })

  it('keeps "Abmelden" next to the gear', async () => {
    const { wrapper } = await open('/activity')
    expect(
      wrapper.findAll('header button').map((button) => button.attributes('aria-label')),
    ).toEqual(['Verwaltung', 'Abmelden'])
  })
})

describe('the preview', () => {
  it('shows the attributes of a stem with the count, no inactive one', async () => {
    const { wrapper } = await open()

    expect(countText(wrapper)).toBe('8 Merkmale')
    expect(previewNames(wrapper)).toEqual([
      'Holzart',
      'Fälldatum',
      'Lieferdatum',
      'Lagerplatz',
      'Gesägt (Systemmerkmal)',
      'Holzfeuchte',
      'Notiz (Systemmerkmal)',
      'Fotos (Systemmerkmal)',
    ])
    expect(wrapper.text()).toContain('Nichts ausgewählt')
  })

  it('says so in the place of the settings while nothing is selected, as "Waldesruh" does in the lists', async () => {
    const { wrapper } = await open()

    const card = wrapper.get('[role=status]:not(.sr-only)')
    expect(card.get('h2').text()).toBe('Nichts ausgewählt')
    expect(card.text()).toContain('Merkmal zum Bearbeiten auswählen oder ein neues anlegen.')
    const icon = card.get('svg')
    expect(icon.classes()).toContain('lucide-mouse-pointer-click')
    expect([icon.attributes('width'), icon.attributes('stroke-width')]).toEqual(['96', '1.5'])
    expect(settings(wrapper).exists()).toBe(false)

    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('Nichts ausgewählt')
  })

  it('starts a draft from the button in the empty card as from the one under the preview', async () => {
    const { wrapper, router } = await open()
    const emptyCard = () => wrapper.get('[role=status]:not(.sr-only)')
    const inCard = emptyCard()
      .findAll('button')
      .find((b) => b.text() === 'Merkmal hinzufügen')!
    expect(inCard.find('svg.lucide-plus').exists()).toBe(true)
    // two buttons of this name while nothing is selected: the one under the preview comes first
    const all = wrapper.findAll('button').filter((b) => b.text() === 'Merkmal hinzufügen')
    expect(all).toHaveLength(2)
    expect(all[0].classes()).toContain('border-dashed')

    await inCard.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ attribute: 'new' })
    expect(wrapper.find('[data-placeholder]').exists()).toBe(true)
    expect(wrapper.get('section[aria-labelledby] h2').text()).toBe('Neues Merkmal')
    expect(wrapper.findAll('section ul button').map((b) => b.text())[0]).toContain('Auswahl')
    expect(wrapper.text()).not.toContain('Nichts ausgewählt')
    // both buttons are gone while the draft is open
    expect(wrapper.findAll('button').filter((b) => b.text() === 'Merkmal hinzufügen')).toHaveLength(
      0,
    )
  })

  it('has the button under the preview as high as the big buttons of the preview', async () => {
    const { wrapper } = await open()
    const button = wrapper.findAll('button').find((b) => b.text() === 'Merkmal hinzufügen')!

    expect(button.classes()).toEqual(
      expect.arrayContaining(['min-h-row', 'text-label', 'font-bold', 'w-full']),
    )
    expect(button.get('svg').attributes('width')).toBe('22')
  })

  it('shows what the stem alone has and the beams inherit in the view "Balken" as the app does: grey, no input, "Vom Stamm geerbt"', async () => {
    const { wrapper } = await open('/attributes?view=beam')
    const inherited = field(wrapper, 'Holzart')

    expect(inherited.attributes('aria-label')).toBe('Holzart (vom Stamm geerbt)')
    expect(inherited.classes()).toContain('bg-locked')
    expect(inherited.text()).toContain('Vom Stamm geerbt')
    // the description as in the app (a choice has it above), but no select and no placeholder
    expect(inherited.text()).toContain('Eichenart laut Rinde und Blatt')
    expect(inherited.text()).not.toContain('wählen')
    expect(inherited.find('.border-lockline').exists()).toBe(true)
    expect(inherited.find('.border-ink').exists()).toBe(false)
    // a yes/no attribute and a month: grey box too, the system lock stays after the name
    expect(field(wrapper, 'Gesägt').text()).toContain('Vom Stamm geerbt')
    expect(field(wrapper, 'Gesägt').find('svg.lucide-lock').exists()).toBe(true)
    expect(field(wrapper, 'Fälldatum').text()).not.toContain('MM / JJJJ')
    // the attributes of the beam are as before, an input and no hint
    expect(field(wrapper, 'Sortierklasse').text()).not.toContain('Vom Stamm geerbt')
    expect(field(wrapper, 'Sortierklasse').text()).toContain('wählen')
    expect(field(wrapper, 'Sortierklasse').classes()).not.toContain('bg-locked')
    // not on the stem
    await buttonWith(wrapper, 'Stamm')!.trigger('click')
    await flushPromises()
    expect(field(wrapper, 'Holzart').text()).not.toContain('Vom Stamm geerbt')
    expect(field(wrapper, 'Holzart').text()).toContain('Holzart wählen')
  })

  it('counts them, lets them be selected and moved like the others', async () => {
    const { wrapper, router, api } = await open('/attributes?view=beam')
    expect(countText(wrapper)).toBe('8 Merkmale')

    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({
      view: 'beam',
      attribute: attributeOf(api, 'Holzart').id,
    })
    expect(settings(wrapper).get('h2').text()).toBe('Holzart')
    expect(field(wrapper, 'Holzart').attributes('aria-current')).toBe('true')
    expect(handles(wrapper)).toHaveLength(8)
    expect(handles(wrapper)[0].attributes('aria-label')).toBe('Holzart verschieben')
    expect(handles(wrapper)[0].attributes('disabled')).toBeUndefined()
  })

  it('draws each type as the app shows it empty', async () => {
    const { wrapper } = await open()
    const text = (name: string) => squeezed(field(wrapper, name).text())

    expect(text('Holzart')).toContain('Holzart wählen …')
    expect(text('Fälldatum')).toContain('MM / JJJJ')
    expect(text('Lieferdatum')).toContain('TT / MM / JJJJ')
    expect(text('Holzfeuchte')).toContain('Wert')
    expect(field(wrapper, 'Holzfeuchte').text()).toContain('%')
    expect(text('Holzfeuchte')).toContain('Hinzufügen')
    expect(text('Notiz')).toContain('Beobachtung, Auffälligkeit …')
    expect(text('Fotos')).toContain('Foto aufnehmen')
    expect(text('Gesägt')).toContain('Gesägt')
    // the lock follows the name of a system attribute
    expect(field(wrapper, 'Notiz').find('svg.lucide-lock').exists()).toBe(true)
    expect(field(wrapper, 'Holzart').find('svg.lucide-lock').exists()).toBe(false)
  })

  it('has a handle on every field and an active "Merkmal hinzufügen"', async () => {
    const { wrapper } = await open()

    expect(handles(wrapper).map((button) => button.attributes('aria-label'))).toEqual(
      previewNames(wrapper).map((name) => `${name!.replace(' (Systemmerkmal)', '')} verschieben`),
    )
    expect(buttonWith(wrapper, 'Merkmal hinzufügen')!.attributes('disabled')).toBeUndefined()
  })

  it('shows the beam form with "Balken", and the state in the URL', async () => {
    const { wrapper, router } = await open()

    await buttonWith(wrapper, 'Balken')!.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ view: 'beam' })
    expect(countText(wrapper)).toBe('8 Merkmale')
    // Lagerplatz is for the stem alone and not inheritable: not on a beam
    expect(previewNames(wrapper).join()).not.toContain('Lagerplatz')
    expect(previewNames(wrapper)[0]).toBe('Holzart (vom Stamm geerbt)')
    expect(buttonWith(wrapper, 'Balken')!.attributes('aria-pressed')).toBe('true')
    expect(buttonWith(wrapper, 'Stamm')!.attributes('aria-pressed')).toBe('false')

    await buttonWith(wrapper, 'Stamm')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('shows inactive attributes only on request, struck through with the hint', async () => {
    const { wrapper, router } = await open('/attributes?view=beam')
    expect(previewNames(wrapper)).not.toContain('Entlastungsschnitt (deaktiviert)')

    await wrapper.get('input[type=checkbox]').setValue(true)
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ view: 'beam', inactive: '1' })
    expect(countText(wrapper)).toBe('9 Merkmale')
    const inactive = field(wrapper, 'Entlastungsschnitt')
    expect(inactive.attributes('aria-label')).toBe('Entlastungsschnitt (deaktiviert)')
    expect(inactive.find('.line-through').text()).toBe('Entlastungsschnitt')
    expect(inactive.text()).toContain('(deaktiviert)')
  })

  it('reads view, inactive and selection from the URL', async () => {
    const { wrapper, api } = await open('/attributes?view=beam&inactive=1')
    const id = attributeOf(api, 'Entlastungsschnitt').id

    await wrapper.vm.$router.push(`/attributes?view=beam&inactive=1&attribute=${id}`)
    await flushPromises()

    expect(wrapper.get<HTMLInputElement>('input[type=checkbox]').element.checked).toBe(true)
    expect(field(wrapper, 'Entlastungsschnitt').attributes('aria-current')).toBe('true')
    expect(settings(wrapper).get('h2').text()).toBe('Entlastungsschnitt')
  })

  it('selects nothing that is not in the preview', async () => {
    const { wrapper, api } = await open()
    const id = attributeOf(api, 'Sortierklasse').id

    await wrapper.vm.$router.push(`/attributes?attribute=${id}`)
    await flushPromises()

    expect(settings(wrapper).exists()).toBe(false)
    expect(wrapper.text()).toContain('Nichts ausgewählt')
  })

  it('says so when it cannot load', async () => {
    const { wrapper } = await open('/activity', (api) => api.failAttributes())
    await wrapper.vm.$router.push('/attributes')
    await flushPromises()

    expect(wrapper.get('[role=alert]').text()).toContain('Hier ist grad der Wurm drin')
  })
})

describe('the settings', () => {
  it('select a field: black frame, the URL, the name as heading and the form of an attribute without key', async () => {
    const { wrapper, router, api } = await open()

    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({
      attribute: attributeOf(api, 'Lagerplatz').id,
    })
    expect(field(wrapper, 'Lagerplatz').attributes('aria-current')).toBe('true')
    expect(field(wrapper, 'Lagerplatz').classes()).toContain('ring-ink')
    const panel = settings(wrapper)
    expect(panel.get('h2').text()).toBe('Lagerplatz')
    expect(panel.get<HTMLInputElement>('input[type=text]').element.value).toBe('Lagerplatz')
    expect(panel.get('textarea').attributes('placeholder')).toBe(
      'Hinweis für die Erfassung (optional)',
    )
    expect(panel.find('select').exists()).toBe(false)
    expect(panel.text()).toContain('Auswahl')
    expect(buttonWith(wrapper, 'ändern')).toBeDefined()
    // the options: a field and a button each
    expect(panel.findAll('input[aria-label^="Auswahl-Option"]')).toHaveLength(3)
    expect(panel.findAll('button[aria-label$=" deaktivieren"]')).toHaveLength(2)
    expect(panel.findAll('button[aria-label$=" aktivieren"]')).toHaveLength(1)
    expect(panel.text()).toContain('Ausblenden, wenn folgende Merkmale gesetzt sind:')
    // the yes/no system attributes, not the attribute itself
    expect(panel.text()).toContain('Gesägt')
    expect(panel.text()).toContain('In der App sichtbar')
    expect(buttonWith(wrapper, 'Speichern')!.attributes('disabled')).toBeDefined()
    expect(buttonWith(wrapper, 'Verwerfen')!.attributes('disabled')).toBeDefined()
  })

  it('lock type, inheritance and series of an attribute that has values', async () => {
    const { wrapper } = await open()
    await field(wrapper, 'Holzfeuchte').trigger('click')
    await flushPromises()

    const panel = settings(wrapper)
    expect(panel.find('select').exists()).toBe(false)
    expect(buttonWith(wrapper, 'ändern')).toBeUndefined()
    expect(panel.text()).toContain('Zahl')
    expect(panel.findAll('svg.lucide-lock').length).toBeGreaterThanOrEqual(3)
    expect(panel.text().match(/Nicht mehr änderbar: Es sind schon Werte erfasst\./g)).toHaveLength(
      3,
    )
    const boxes = panel.findAll<HTMLInputElement>('input[type=checkbox]')
    const disabled = boxes.filter((box) => box.element.disabled)
    expect(disabled).toHaveLength(2) // Vererbbar and Serie
    expect(panel.text()).toContain('Jeder Eintrag wird zu einer Liste hinzugefügt')
    // everything else stays editable: name, unit, kinds, hidden, active
    expect(panel.find<HTMLInputElement>('input[type=text]').element.disabled).toBe(false)
    expect(panel.text()).toContain('Einheit')
  })

  /** "ändern" at the type, then a tile of the picker (a month: the tile "Datum", then the precision). */
  const changeType = async (wrapper: VueWrapper, tile: string) => {
    await buttonWith(wrapper, 'ändern')!.trigger('click')
    await wrapper
      .findAll('section ul button')
      .find((button) => button.text().startsWith(tile))!
      .trigger('click')
  }

  it('leave type and inheritance free without values, and offer the series only for number, text, date and month', async () => {
    const { wrapper } = await open()
    await field(wrapper, 'Lieferdatum').trigger('click')
    await flushPromises()
    const panel = () => settings(wrapper)

    expect(panel().text()).not.toContain('Nicht mehr änderbar')
    expect(panel().text()).toContain('Jeder Eintrag wird zu einer Liste hinzugefügt') // date
    expect(panel().text()).not.toContain('Einheit')

    await changeType(wrapper, 'Zahl')
    expect(panel().text()).toContain('Einheit')
    expect(panel().text()).toContain('Jeder Eintrag wird zu einer Liste hinzugefügt')
    await changeType(wrapper, 'Text')
    expect(panel().text()).toContain('Jeder Eintrag wird zu einer Liste hinzugefügt')
    await changeType(wrapper, 'Datum')
    await panel().get('select').setValue('month')
    expect(panel().text()).toContain('Jeder Eintrag wird zu einer Liste hinzugefügt')
    await changeType(wrapper, 'Auswahl')
    expect(panel().text()).not.toContain('Jeder Eintrag wird zu einer Liste hinzugefügt')
    expect(panel().text()).toContain('Auswahl-Option hinzufügen')
    await changeType(wrapper, 'Ja / Nein')
    expect(panel().text()).not.toContain('Jeder Eintrag wird zu einer Liste hinzugefügt')
    expect(panel().text()).not.toContain('Auswahl-Option hinzufügen')
  })

  it('change the type through the tiles: "Abbrechen" changes nothing, the choice counts as unsaved until "Speichern"', async () => {
    const { wrapper, api } = await open()
    await field(wrapper, 'Lieferdatum').trigger('click')
    await flushPromises()

    // the tiles for this attribute, the current type marked; "Abbrechen" leads back to the form as it was
    await buttonWith(wrapper, 'ändern')!.trigger('click')
    expect(settings(wrapper).get('h2').text()).toBe('Typ ändern')
    expect(
      wrapper.findAll('section ul button[aria-pressed=true]').map((button) => button.text()),
    ).toEqual([expect.stringMatching(/^Datum/)])
    await buttonWith(wrapper, 'Abbrechen')!.trigger('click')
    expect(settings(wrapper).get('h2').text()).toBe('Lieferdatum')
    expect(buttonWith(wrapper, 'Speichern')!.attributes('disabled')).toBeDefined()

    // a month stays a month with the tile "Datum" again
    await changeType(wrapper, 'Datum')
    expect(buttonWith(wrapper, 'Speichern')!.attributes('disabled')).toBeDefined()

    await changeType(wrapper, 'Text')
    expect(buttonWith(wrapper, 'Speichern')!.attributes('disabled')).toBeUndefined()
    await buttonWith(wrapper, 'Speichern')!.trigger('click')
    await flushPromises()
    expect(attributeOf(api, 'Lieferdatum').type).toBe('text')
  })

  it('show the refusal of a type change in the type row, keeping the new type in the form', async () => {
    const { wrapper, api } = await open()
    await field(wrapper, 'Lieferdatum').trigger('click')
    await flushPromises()
    await changeType(wrapper, 'Text')
    const message =
      'Der Typ lässt sich nicht ändern, solange „Rinde“ damit ausgeblendet wird. Entferne dort zuerst die Ausblendung.'
    api.attributes.reject([{ field: 'type', message }])

    await buttonWith(wrapper, 'Speichern')!.trigger('click')
    await flushPromises()

    const typeRow = settings(wrapper)
      .findAll('form > div')
      .find((row) => row.element.firstElementChild?.textContent?.trim() === 'Typ')!
    expect(typeRow.get('[role=alert]').text()).toBe(message)
    expect(typeRow.text()).toContain('Text')
    expect(attributeOf(api, 'Lieferdatum').type).toBe('date')
  })

  it('leave the picker with unsaved changes: a switch of the selection asks first', async () => {
    const { wrapper } = await open()
    await field(wrapper, 'Lieferdatum').trigger('click')
    await flushPromises()
    await changeType(wrapper, 'Text')
    await buttonWith(wrapper, 'ändern')!.trigger('click')

    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    expect(dialog()).not.toBeNull()
  })

  it('put the note on a system attribute right below the name, so that the X sits in the corner beside it', async () => {
    const { wrapper } = await open()
    await field(wrapper, 'Gesägt').trigger('click')
    await flushPromises()

    const panel = settings(wrapper)
    const note = panel.findAll('p').find((p) => p.text().startsWith('Systemmerkmal'))!
    const heading = panel.get('h2')
    expect(note.text()).toBe(SYSTEM_NOTE)
    // nothing comes before the name; the X is in its row, the note is the next element
    const headingRow = heading.element.parentElement!
    expect(headingRow.previousElementSibling).toBeNull()
    expect(headingRow.querySelector('button[aria-label="Schließen"]')).not.toBeNull()
    expect(headingRow.nextElementSibling).toBe(note.element)
    // and attributes of V29 have none
    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()
    expect(settings(wrapper).text()).not.toContain('Systemmerkmal:')
  })

  it('points the options of the piles to the page "Polter"; their options are text, not fields', async () => {
    const { wrapper } = await open('/attributes', (api) => {
      Object.assign(attributeOf(api, 'Holzart'), { key: 'source', is_system: true })
    })
    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()

    const hint = settings(wrapper).get('[data-piles-hint]')
    expect(squeezed(hint.text())).toBe(
      'Die Optionen sind die Polter. Du pflegst sie auf der Seite Polter.',
    )
    expect(hint.get('a').attributes('href')).toBe('/piles')
    expect(settings(wrapper).find('input[aria-label="Auswahl-Option 1"]').exists()).toBe(false)

    await field(wrapper, 'Gesägt').trigger('click')
    await flushPromises()
    expect(settings(wrapper).find('[data-piles-hint]').exists()).toBe(false)
  })

  /** The labels of the rows, top to bottom (the first child of a row is its label). */
  const rowLabels = (wrapper: VueWrapper) =>
    settings(wrapper)
      .findAll(
        'form > div, form > section > h3, form > section > div > div, section > h3, dl > div',
      )
      .map((row) => (row.element.firstElementChild ?? row.element).textContent!.trim())

  it('order the rows: Typ, Name, Beschreibung, the fields of the type, Stamm und Balken, Serie, Anzeige-Bedingung, Aktiv', async () => {
    const { wrapper } = await open()
    await field(wrapper, 'Lieferdatum').trigger('click')
    await flushPromises()
    await changeType(wrapper, 'Zahl')

    expect(rowLabels(wrapper)).toEqual([
      'Typ',
      'Name',
      'Beschreibung',
      'Einheit',
      'Stamm und Balken',
      'Gültig für',
      'Wert vererbbar',
      'Serie',
      'Anzeige-Bedingung',
      'Aktiv',
    ])

    // a choice has no series, but options before "Aktiv"
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    dialogButton('Verwerfen').click()
    await flushPromises()
    expect(rowLabels(wrapper)).toEqual([
      'Typ',
      'Name',
      'Beschreibung',
      'Auswahl-Optionen',
      'Stamm und Balken',
      'Gültig für',
      'Wert vererbbar',
      'Anzeige-Bedingung',
      'Aktiv',
    ])
  })

  it('order the rows of a system attribute the same way', async () => {
    const { wrapper } = await open()
    await field(wrapper, 'Notiz').trigger('click')
    await flushPromises()

    expect(rowLabels(wrapper)).toEqual([
      'Name',
      'Beschreibung',
      'Typ',
      'Stamm und Balken',
      'Gültig für',
      'Wert vererbbar',
      'Serie',
      'Anzeige-Bedingung',
      'Aktiv',
    ])
  })

  it('hide "Wert vererbbar" unless "Stamm" is ticked, and leave the saved value as it is', async () => {
    const { wrapper, api } = await open()
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    const boxes = () => settings(wrapper).findAll<HTMLInputElement>('input[type=checkbox]')
    const inheritable = () => rowLabels(wrapper).includes('Wert vererbbar')
    // Stamm, Balken, Vererbbar
    await boxes()[2].setValue(true)
    expect(inheritable()).toBe(true)

    await boxes()[1].setValue(true)
    await boxes()[0].setValue(false)
    expect(inheritable()).toBe(false)
    expect(settings(wrapper).text()).not.toContain('Wert vererbbar')

    // ticked again: the row is back with the value it had, nothing was switched off
    await boxes()[0].setValue(true)
    expect(inheritable()).toBe(true)
    expect(boxes()[2].element.checked).toBe(true)

    // saved with "Stamm" off: the value is not forced either
    await boxes()[0].setValue(false)
    await buttonWith(wrapper, 'Speichern')!.trigger('click')
    await flushPromises()
    expect(attributeOf(api, 'Lagerplatz')).toMatchObject({
      applies_to: ['beam'],
      is_inheritable: true,
    })
  })

  it('hide "Wert vererbbar" of a system attribute that is not valid for the stem, and show it otherwise', async () => {
    const { wrapper } = await open('/attributes?view=beam', (fake) => {
      const notes = fake.attributes.attributes.find((attribute) => attribute.key === 'notes')!
      notes.applies_to = ['beam']
      notes.is_inheritable = true
    })
    await field(wrapper, 'Notiz').trigger('click')
    await flushPromises()
    expect(rowLabels(wrapper)).toEqual([
      'Name',
      'Beschreibung',
      'Typ',
      'Stamm und Balken',
      'Gültig für',
      'Serie',
      'Anzeige-Bedingung',
      'Aktiv',
    ])

    await field(wrapper, 'Gesägt').trigger('click')
    await flushPromises()
    expect(rowLabels(wrapper)).toContain('Wert vererbbar')
  })

  it('show a system attribute as text, with only name and description to change', async () => {
    const { wrapper } = await open()
    await field(wrapper, 'Gesägt').trigger('click')
    await flushPromises()

    const panel = settings(wrapper)
    expect(panel.get('h2').text()).toBe('Gesägt')
    expect(panel.text()).toContain(SYSTEM_NOTE)
    expect(panel.text()).toContain('Ja/Nein')
    expect(panel.text()).toContain('Stamm')
    expect(panel.text()).toContain('Immer angezeigt')
    expect(panel.get('h3').text()).toBe('Stamm und Balken')
    expect(panel.get('h3 + p').text()).toMatch(/^Erfassbar /)
    // the X, the name and the description; everything else is text
    expect(
      panel.findAll('input, select, textarea').map((control) => control.element.tagName),
    ).toEqual(['INPUT', 'TEXTAREA'])
    expect(panel.findAll('button').map((control) => control.attributes('aria-label'))).toContain(
      'Schließen',
    )
    expect(buttonWith(wrapper, 'Speichern')!.attributes('disabled')).toBeDefined()
  })

  it('save the name and description of a system attribute and send nothing else', async () => {
    const { wrapper, api } = await open()
    await field(wrapper, 'Gesägt').trigger('click')
    await flushPromises()
    await settings(wrapper).get('input[type=text]').setValue('Fertig gesägt')
    await settings(wrapper).get('textarea').setValue('Stamm ist zu Balken gesägt')

    await buttonWith(wrapper, 'Speichern')!.trigger('click')
    await flushPromises()

    expect(attributeOf(api, 'Fertig gesägt')).toMatchObject({
      key: 'sawn',
      description: 'Stamm ist zu Balken gesägt',
      type: 'boolean',
    })
    expect(settings(wrapper).get('h2').text()).toBe('Fertig gesägt')
    expect(previewNames(wrapper)).toContain('Fertig gesägt (Systemmerkmal)')
    expect(wrapper.text()).toContain('Merkmal gespeichert')
  })

  it('name the attributes that hide a system attribute and show the options as text', async () => {
    const { wrapper, api } = await open('/attributes', (fake) => {
      const sawn = fake.attributes.attributes.find((attribute) => attribute.key === 'sawn')!
      sawn.hidden_when = [
        fake.attributes.attributes.find((attribute) => attribute.name === 'Entlastungsschnitt')!.id,
      ]
      sawn.type = 'choice'
      sawn.options = [
        { id: 'o1', label: 'Ja', sort_order: 10, active: true },
        { id: 'o2', label: 'Nein', sort_order: 20, active: false },
      ]
    })
    expect(api).toBeTruthy()
    await field(wrapper, 'Gesägt').trigger('click')
    await flushPromises()

    const panel = settings(wrapper)
    // by name, not by id
    expect(panel.text()).toContain('Ausgeblendet, wenn gesetzt: Entlastungsschnitt')
    expect(panel.text()).toContain('Auswahl-Optionen')
    expect(panel.find('li .line-through').text()).toBe('Nein')
    expect(panel.text()).toContain('(deaktiviert)')
  })
})

describe('saving', () => {
  async function edit(wrapper: VueWrapper, name: string, text: string) {
    await field(wrapper, name).trigger('click')
    await flushPromises()
    await settings(wrapper).get('input[type=text]').setValue(text)
  }

  it('enables "Speichern" and "Verwerfen" with a change, and "Verwerfen" takes it back', async () => {
    const { wrapper } = await open()
    await edit(wrapper, 'Lagerplatz', 'Ort')

    expect(buttonWith(wrapper, 'Speichern')!.attributes('disabled')).toBeUndefined()
    await buttonWith(wrapper, 'Verwerfen')!.trigger('click')

    expect(settings(wrapper).get<HTMLInputElement>('input[type=text]').element.value).toBe(
      'Lagerplatz',
    )
    expect(buttonWith(wrapper, 'Speichern')!.attributes('disabled')).toBeDefined()
  })

  it('sends the attribute, keeps the selection, updates the preview and confirms', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const { wrapper, api, router } = await open()
    await edit(wrapper, 'Lagerplatz', 'Ort')
    await settings(wrapper).get('textarea').setValue('Wo der Stamm liegt')
    await settings(wrapper).findAll<HTMLInputElement>('input[type=checkbox]')[1].setValue(false)

    await buttonWith(wrapper, 'Speichern')!.trigger('click')
    await flushPromises()

    const call = api.calls.filter((entry) => entry.startsWith('PATCH')).pop()!
    expect(call).toBe(`PATCH /api/admin/attributes/${attributeOf(api, 'Ort').id}`)
    expect(attributeOf(api, 'Ort')).toMatchObject({
      description: 'Wo der Stamm liegt',
      applies_to: ['stem'],
    })
    expect(router.currentRoute.value.query.attribute).toBe(attributeOf(api, 'Ort').id)
    expect(settings(wrapper).get('h2').text()).toBe('Ort')
    expect(previewNames(wrapper)).toContain('Ort')
    expect(previewNames(wrapper)).not.toContain('Lagerplatz')
    expect(field(wrapper, 'Ort').text()).toContain('Wo der Stamm liegt')
    expect(buttonWith(wrapper, 'Speichern')!.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Merkmal gespeichert')
    // "Speichern" is disabled now: the heading of the card has the focus
    expect(focus.mock.contexts[focus.mock.contexts.length - 1]).toBe(
      settings(wrapper).get('h2').element,
    )
    expect(settings(wrapper).get('h2').attributes('tabindex')).toBe('-1')
    focus.mockRestore()
  })

  it('offers every yes/no attribute but the attribute itself as a condition, one without key too, and saves its id', async () => {
    const { wrapper, api } = await open()
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    const labels = () =>
      settings(wrapper)
        .findAll('label')
        .map((label) => label.text())
    expect(labels()).toEqual(expect.arrayContaining(['Gesägt', 'Entlastungsschnitt']))
    expect(labels()).not.toContain('Lagerplatz')

    const row = settings(wrapper)
      .findAll('label')
      .find((label) => label.text() === 'Entlastungsschnitt')!
    await row.get('input').setValue(true)
    await buttonWith(wrapper, 'Speichern')!.trigger('click')
    await flushPromises()

    expect(attributeOf(api, 'Lagerplatz').hidden_when).toEqual([
      attributeOf(api, 'Entlastungsschnitt').id,
    ])
  })

  it('updates the count when the attribute leaves the view', async () => {
    const { wrapper } = await open()
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    await settings(wrapper).findAll<HTMLInputElement>('input[type=checkbox]')[0].setValue(false)
    await settings(wrapper).findAll<HTMLInputElement>('input[type=checkbox]')[1].setValue(true)

    await buttonWith(wrapper, 'Speichern')!.trigger('click')
    await flushPromises()

    expect(countText(wrapper)).toBe('7 Merkmale')
    expect(previewNames(wrapper)).not.toContain('Lagerplatz')
    expect(wrapper.text()).toContain('Merkmal gespeichert')
  })

  it('adds a new option and deletes one that is new, deactivates one that exists', async () => {
    const { wrapper, api } = await open()
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    const panel = () => settings(wrapper)

    await buttonWith(wrapper, 'Auswahl-Option hinzufügen')!.trigger('click')
    expect(panel().findAll('input[aria-label^="Auswahl-Option"]')).toHaveLength(4)
    await panel().findAll('input[aria-label^="Auswahl-Option"]')[3].setValue('Lager Nord')
    await panel().findAll('input[aria-label^="Auswahl-Option"]')[3].trigger('blur')
    await wrapper.get('button[aria-label="„Lager Nord“ löschen"]').trigger('click')
    expect(panel().findAll('input[aria-label^="Auswahl-Option"]')).toHaveLength(3)
    expect(buttonWith(wrapper, 'Speichern')!.attributes('disabled')).toBeDefined()

    await buttonWith(wrapper, 'Auswahl-Option hinzufügen')!.trigger('click')
    await panel().findAll('input[aria-label^="Auswahl-Option"]')[3].setValue('Lager Mitte')
    await panel().get('button[aria-label$=" deaktivieren"]').trigger('click')
    expect(panel().find('input.line-through').exists()).toBe(true)
    expect(panel().find('button[aria-label$=" aktivieren"]').exists()).toBe(true)

    await buttonWith(wrapper, 'Speichern')!.trigger('click')
    await flushPromises()

    const options = attributeOf(api, 'Lagerplatz').options
    expect(options.map((option) => [option.label, option.active])).toEqual([
      ['Polter Nord', false],
      ['Polter Süd', true],
      ['Waldweg Ost', false],
      ['Lager Mitte', true],
    ])
  })

  it('shows the errors of a 422 at their fields and keeps the form', async () => {
    const { wrapper, api } = await open()
    await edit(wrapper, 'Lagerplatz', 'Holzart')
    api.attributes.reject([
      { field: 'name', message: 'Ein Merkmal mit diesem Namen gibt es schon.' },
      { field: 'options.1.label', message: 'Die Auswahl-Option „X“ gibt es schon.' },
    ])

    await buttonWith(wrapper, 'Speichern')!.trigger('click')
    await flushPromises()

    const panel = settings(wrapper)
    const alerts = panel.findAll('[role=alert]').map((alert) => alert.text())
    expect(alerts).toEqual([
      'Ein Merkmal mit diesem Namen gibt es schon.',
      'Die Auswahl-Option „X“ gibt es schon.',
    ])
    expect(panel.get('input[type=text]').attributes('aria-invalid')).toBe('true')
    // the name's error is in the name row, the option's under its option
    expect(panel.findAll('input[aria-label^="Auswahl-Option"]')[1].attributes('aria-invalid')).toBe(
      'true',
    )
    expect(panel.get<HTMLInputElement>('input[type=text]').element.value).toBe('Holzart')
    expect(buttonWith(wrapper, 'Speichern')!.attributes('disabled')).toBeUndefined()

    // typing takes the messages away
    await panel.get('input[type=text]').setValue('Ort')
    expect(settings(wrapper).findAll('[role=alert]')).toHaveLength(0)
  })

  it('says so when saving fails for another reason, and keeps the changes', async () => {
    const { wrapper } = await open()
    await edit(wrapper, 'Lagerplatz', 'Ort')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    )

    await buttonWith(wrapper, 'Speichern')!.trigger('click')
    await flushPromises()

    expect(wrapper.get('[role=alert]').text()).toBe(
      'Speichern fehlgeschlagen. Bitte noch einmal versuchen.',
    )
    expect(settings(wrapper).get<HTMLInputElement>('input[type=text]').element.value).toBe('Ort')
    expect(buttonWith(wrapper, 'Speichern')!.attributes('disabled')).toBeUndefined()
  })
})

describe('unsaved changes', () => {
  async function dirty() {
    const opened = await open()
    await field(opened.wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    await settings(opened.wrapper).get('input[type=text]').setValue('Ort')
    return opened
  }

  it('ask before another attribute is selected, and "Weiter bearbeiten" stays', async () => {
    const { wrapper, api } = await dirty()

    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()

    expect(dialog()!.textContent).toContain('Änderungen verwerfen?')
    expect(wrapper.vm.$route.query.attribute).toBe(attributeOf(api, 'Lagerplatz').id)
    dialogButton('Weiter bearbeiten').click()
    await flushPromises()

    expect(dialog()).toBeNull()
    expect(wrapper.vm.$route.query.attribute).toBe(attributeOf(api, 'Lagerplatz').id)
    expect(settings(wrapper).get<HTMLInputElement>('input[type=text]').element.value).toBe('Ort')
  })

  it('go on to the other attribute with "Verwerfen", the changes are gone', async () => {
    const { wrapper, api } = await dirty()

    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()
    dialogButton('Verwerfen').click()
    await flushPromises()

    expect(dialog()).toBeNull()
    expect(wrapper.vm.$route.query.attribute).toBe(attributeOf(api, 'Holzart').id)
    expect(settings(wrapper).get('h2').text()).toBe('Holzart')
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    expect(settings(wrapper).get<HTMLInputElement>('input[type=text]').element.value).toBe(
      'Lagerplatz',
    )
  })

  it('ask before the view changes', async () => {
    const { wrapper } = await dirty()

    await buttonWith(wrapper, 'Balken')!.trigger('click')
    await flushPromises()

    expect(dialog()).not.toBeNull()
    expect(wrapper.vm.$route.query.view).toBeUndefined()
    dialogButton('Verwerfen').click()
    await flushPromises()
    expect(wrapper.vm.$route.query.view).toBe('beam')
    expect(wrapper.vm.$route.query.attribute).toBeUndefined()
  })

  it('ask about "Inaktive zeigen" only when the selection goes with it', async () => {
    const { wrapper, api } = await open('/attributes?view=beam&inactive=1')
    await field(wrapper, 'Entlastungsschnitt').trigger('click')
    await flushPromises()
    await settings(wrapper).get('input[type=text]').setValue('Anders')

    // the checkbox of the filter row is the first one on the page
    await wrapper.get('input[type=checkbox]').setValue(false)
    await flushPromises()
    expect(dialog()).not.toBeNull()
    dialogButton('Weiter bearbeiten').click()
    await flushPromises()

    // an attribute that stays in the view needs no question: select an active one, change it, toggle
    await field(wrapper, 'Sortierklasse').trigger('click')
    await flushPromises()
    dialogButton('Verwerfen').click()
    await flushPromises()
    await settings(wrapper).get('input[type=text]').setValue('Klasse')
    await wrapper.get('input[type=checkbox]').setValue(true)
    await flushPromises()
    expect(dialog()).toBeNull()
    expect(wrapper.vm.$route.query.attribute).toBe(attributeOf(api, 'Sortierklasse').id)
    expect(settings(wrapper).get<HTMLInputElement>('input[type=text]').element.value).toBe('Klasse')
  })

  it('do not ask without a change, and not after saving', async () => {
    const { wrapper } = await open()
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()
    expect(dialog()).toBeNull()

    await settings(wrapper).get('input[type=text]').setValue('Baumart')
    await buttonWith(wrapper, 'Speichern')!.trigger('click')
    await flushPromises()
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()

    expect(dialog()).toBeNull()
    expect(settings(wrapper).get('h2').text()).toBe('Lagerplatz')
  })
})

describe('closing the form', () => {
  const close = (wrapper: VueWrapper) => wrapper.get('button[aria-label="Schließen"]')
  const lastFocused = (focus: { mock: { contexts: unknown[] } }) =>
    focus.mock.contexts[focus.mock.contexts.length - 1]

  it('ends the selection with the X and puts the focus on the attribute in the preview', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const { wrapper } = await open()
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    expect(close(wrapper).attributes('title')).toBe('Schließen')

    await close(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.vm.$route.query.attribute).toBeUndefined()
    expect(settings(wrapper).exists()).toBe(false)
    expect(wrapper.text()).toContain('Nichts ausgewählt')
    expect(dialog()).toBeNull()
    expect(lastFocused(focus)).toBe(field(wrapper, 'Lagerplatz').element)
    focus.mockRestore()
  })

  it('is there for a system attribute too', async () => {
    const { wrapper } = await open()
    await field(wrapper, 'Gesägt').trigger('click')
    await flushPromises()

    await close(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.vm.$route.query.attribute).toBeUndefined()
    expect(wrapper.text()).toContain('Nichts ausgewählt')
  })

  it('asks first with unsaved changes: "Weiter bearbeiten" stays, "Verwerfen" closes and focuses the attribute', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const { wrapper, api } = await open()
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    await settings(wrapper).get('input[type=text]').setValue('Ort')

    await close(wrapper).trigger('click')
    await flushPromises()
    expect(dialog()!.textContent).toContain('Änderungen verwerfen?')
    dialogButton('Weiter bearbeiten').click()
    await flushPromises()
    expect(wrapper.vm.$route.query.attribute).toBe(attributeOf(api, 'Lagerplatz').id)
    expect(settings(wrapper).get<HTMLInputElement>('input[type=text]').element.value).toBe('Ort')

    await close(wrapper).trigger('click')
    await flushPromises()
    dialogButton('Verwerfen').click()
    await flushPromises()
    expect(wrapper.vm.$route.query.attribute).toBeUndefined()
    expect(wrapper.text()).toContain('Nichts ausgewählt')
    expect(lastFocused(focus)).toBe(field(wrapper, 'Lagerplatz').element)
    focus.mockRestore()
  })
})

describe('bringing the settings into view', () => {
  /** What the browser would say about the card: where it starts. The header (72 px) and the bar (60 px) stay at the top. */
  function cardStartsAt(top: number) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return { top: this.matches('[data-settings-column]') ? top : 0 } as DOMRect
    })
    document.documentElement.style.setProperty('--header-height', '72px')
    document.documentElement.style.setProperty('--sticky-bar-height', '60px')
  }
  const scrolled = () =>
    vi
      .mocked(Element.prototype.scrollIntoView)
      .mock.contexts.map((element, index) => ({
        element: element as HTMLElement,
        options: vi.mocked(Element.prototype.scrollIntoView).mock.calls[index][0],
      }))
      .filter(({ element }) => element.matches('[data-settings-column]'))
  afterEach(() => {
    vi.restoreAllMocks()
    document.documentElement.removeAttribute('style')
  })

  it('does not scroll to the card on a wide screen: it stands beside the field', async () => {
    const { wrapper } = await open()
    cardStartsAt(-100)

    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()
    await buttonWith(wrapper, 'Abbrechen')?.trigger('click')
    await buttonWith(wrapper, 'Merkmal hinzufügen')!.trigger('click')
    await flushPromises()

    expect(scrolled()).toHaveLength(0)
  })

  it('always scrolls to the card on a narrow screen, where it lies below the preview', async () => {
    const { wrapper } = await open()
    cardStartsAt(900)
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width') }))

    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()

    expect(scrolled()).toHaveLength(1)
    expect(scrolled()[0].options).toEqual({ block: 'start', behavior: 'auto' })
  })

  const scrolledToField = () =>
    vi
      .mocked(Element.prototype.scrollIntoView)
      .mock.contexts.map((element, index) => ({
        element: element as HTMLElement,
        options: vi.mocked(Element.prototype.scrollIntoView).mock.calls[index][0],
      }))
      // what is scrolled to is selected when it happens, not necessarily later
      .filter(({ element }) => element.closest('[aria-label="Vorschau"]'))
  const idOf = (name: string) =>
    snapshot.attributes.find((attribute) => attribute.name === name)!.id
  const smooth = { block: 'start', behavior: 'smooth' }

  it('scrolls to the field a click selects, smoothly, so that it starts at the top', async () => {
    const { wrapper } = await open()

    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()

    expect(scrolledToField()).toHaveLength(1)
    expect(scrolledToField()[0].element.getAttribute('aria-label')).toBe('Lagerplatz')
    expect(scrolledToField()[0].options).toEqual(smooth)

    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()
    expect(scrolledToField().map(({ element }) => element.getAttribute('aria-label'))).toEqual([
      'Lagerplatz',
      'Holzart',
    ])
  })

  it('scrolls once the selection is made, and not for a click on the field that is selected', async () => {
    const { wrapper } = await open()
    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()
    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()

    expect(scrolledToField()).toHaveLength(1)
  })

  it('does not scroll without animation when the motion is reduced, and not to the field when it is closed', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }))
    const { wrapper } = await open()

    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()
    expect(scrolledToField()[0].options).toEqual({ block: 'start', behavior: 'auto' })

    await wrapper.get('button[aria-label="Schließen"]').trigger('click')
    await flushPromises()
    expect(scrolledToField()).toHaveLength(1)
  })

  it('scrolls to the placeholder when "Merkmal hinzufügen" creates it, in the card too', async () => {
    const { wrapper } = await open()

    await wrapper
      .get('[data-settings-column]')
      .findAll('button')
      .find((button) => squeezed(button.text()) === 'Merkmal hinzufügen')!
      .trigger('click')
    await flushPromises()

    expect(scrolledToField()).toHaveLength(1)
    expect(scrolledToField()[0].element.hasAttribute('data-placeholder')).toBe(true)
    expect(scrolledToField()[0].options).toEqual(smooth)
  })

  it('scrolls to the selected field when the page loads with it in the URL, and to the placeholder of a new attribute', async () => {
    const { wrapper } = await open(`/attributes?attribute=${idOf('Lagerplatz')}`)
    expect(scrolledToField()).toHaveLength(1)
    expect(scrolledToField()[0].element.getAttribute('aria-label')).toBe('Lagerplatz')
    expect(scrolledToField()[0].options).toEqual(smooth)
    wrapper.unmount()

    vi.mocked(Element.prototype.scrollIntoView).mockClear()
    await open('/attributes?attribute=new')
    expect(scrolledToField()).toHaveLength(1)
    expect(scrolledToField()[0].element.hasAttribute('data-placeholder')).toBe(true)
  })

  it('scrolls to the selection that back brings', async () => {
    const { router, wrapper } = await open('/attributes')
    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    vi.mocked(Element.prototype.scrollIntoView).mockClear()

    router.back()
    await flushPromises()

    expect(router.currentRoute.value.query.attribute).toBe(idOf('Holzart'))
    expect(scrolledToField()).toHaveLength(1)
    expect(scrolledToField()[0].element.getAttribute('aria-label')).toBe('Holzart')
  })

  it('does not scroll while the question about unsaved changes holds the selection back, and scrolls once it changes', async () => {
    const { wrapper } = await open()
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    await settings(wrapper).get('input[type=text]').setValue('Ort')
    vi.mocked(Element.prototype.scrollIntoView).mockClear()

    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()
    expect(dialog()).not.toBeNull()
    expect(scrolledToField().map(({ element }) => element.getAttribute('aria-label'))).toEqual([])

    dialogButton('Weiter bearbeiten').click()
    await flushPromises()
    expect(scrolledToField()).toHaveLength(0)

    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()
    dialogButton('Verwerfen').click()
    await flushPromises()
    expect(scrolledToField()).toHaveLength(1)
    expect(scrolledToField()[0].element.getAttribute('aria-label')).toBe('Holzart')
  })

  it('does not scroll when the selection stays: after a save and after a move', async () => {
    const { wrapper } = await open()
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    await settings(wrapper).get('input[type=text]').setValue('Ort')
    vi.mocked(Element.prototype.scrollIntoView).mockClear()

    await buttonWith(wrapper, 'Speichern')!.trigger('click')
    await flushPromises()
    await handle(wrapper, 'Ort').trigger('keydown', { key: 'ArrowUp' })
    await flushPromises()

    expect(scrolledToField()).toHaveLength(0)
  })

  it('does not scroll to the field below lg', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width') }))
    const { wrapper } = await open(`/attributes?attribute=${idOf('Lagerplatz')}`)
    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()

    expect(scrolledToField()).toHaveLength(0)
  })

  it('does not scroll after "Anlegen": the new field is where its placeholder was', async () => {
    const { wrapper } = await open()
    await buttonWith(wrapper, 'Merkmal hinzufügen')!.trigger('click')
    await flushPromises()
    await wrapper
      .findAll('section button')
      .find((button) => button.text().startsWith('Text'))!
      .trigger('click')
    await settings(wrapper).get('input[type=text]').setValue('Neu')
    vi.mocked(Element.prototype.scrollIntoView).mockClear()

    await buttonWith(wrapper, 'Anlegen')!.trigger('click')
    await flushPromises()

    expect(wrapper.vm.$route.query.attribute).not.toBe('new')
    expect(scrolledToField()).toHaveLength(0)
  })

  /** What the browser would say about the layout: the selected field starts `top` px below the column and is `height` px high. */
  function selectedFieldAt(top: number, height: number) {
    const selected = (element: HTMLElement) => element.matches('[aria-current="true"]')
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return selected(this) ? top : 0
    })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return selected(this) ? height : 0
    })
  }
  const cardTop = (wrapper: VueWrapper) =>
    (wrapper.get('[data-settings-column]').element as HTMLElement).style.getPropertyValue(
      '--card-top',
    )
  const arrow = (wrapper: VueWrapper) => wrapper.find<HTMLElement>('[data-card-arrow]')
  const close = (wrapper: VueWrapper) => wrapper.get('button[aria-label="Schließen"]')

  it('starts the card at the height of the selected field, with an arrow at the middle of that field', async () => {
    const { wrapper } = await open()
    selectedFieldAt(300, 80)

    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()

    expect(cardTop(wrapper)).toBe('300px')
    // from the top of the card to the middle of the field, minus half the arrow (14 px)
    expect(arrow(wrapper).element.style.top).toBe('33px')
    expect(arrow(wrapper).classes()).toContain('lg:block')
    expect(arrow(wrapper).classes()).toContain('hidden')
  })

  it('follows another selection, and starts at the top with the arrow gone when nothing is selected', async () => {
    const { wrapper } = await open()
    selectedFieldAt(300, 80)
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    selectedFieldAt(500, 100)

    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()
    expect(cardTop(wrapper)).toBe('500px')
    expect(arrow(wrapper).element.style.top).toBe('43px')

    await close(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Nichts ausgewählt')
    expect(cardTop(wrapper)).toBe('0px')
    expect(arrow(wrapper).exists()).toBe(false)
  })

  it('starts the type tiles and the form of a new attribute at the placeholder', async () => {
    const { wrapper } = await open()
    selectedFieldAt(700, 130)

    await buttonWith(wrapper, 'Merkmal hinzufügen')!.trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-placeholder]').attributes('aria-current')).toBe('true')
    expect(wrapper.text()).toContain('Neues Merkmal')
    expect(cardTop(wrapper)).toBe('700px')
    expect(arrow(wrapper).element.style.top).toBe('58px')
  })

  it('has a card that does not stick and does not scroll inside, with the buttons as its last row and nothing sticking', async () => {
    const { wrapper } = await open()
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()

    const column = wrapper.get('[data-settings-column]').element
    const panel = settings(wrapper).element
    expect(column.className).not.toMatch(/sticky|max-h|overflow/)
    expect(panel.outerHTML).not.toMatch(/data-card-scroll|overflow-y|max-h|sticky/)
    expect(panel.lastElementChild!.contains(buttonWith(wrapper, 'Speichern')!.element)).toBe(true)
  })

  it('has the buttons of the type tiles as the last row, nothing sticks', async () => {
    const { wrapper } = await open()
    await buttonWith(wrapper, 'Merkmal hinzufügen')!.trigger('click')
    await flushPromises()

    const card = wrapper.get('[data-settings-column] section')
    expect(card.element.outerHTML).not.toMatch(/sticky|overflow-y|max-h/)
    expect(card.element.lastElementChild!.textContent!.trim()).toBe('Abbrechen')
  })
})

describe('after a 422', () => {
  async function fail(errors: { field: string; message: string }[]) {
    const opened = await open()
    await field(opened.wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    await settings(opened.wrapper).get('input[type=text]').setValue('Ort')
    opened.api.attributes.reject(errors)
    await buttonWith(opened.wrapper, 'Speichern')!.trigger('click')
    await flushPromises()
    return opened
  }
  const focused = () => document.activeElement

  it('focuses the first field with a message in the order of the form, not of the server', async () => {
    const { wrapper } = await fail([
      { field: 'active', message: 'c' },
      { field: 'options.1.label', message: 'b' },
      { field: 'name', message: 'a' },
    ])

    expect(focused()).toBe(settings(wrapper).get('input[type=text]').element)
    const calls = vi.mocked(Element.prototype.scrollIntoView).mock
    expect(calls.contexts).toContain(focused())
    expect(calls.calls[calls.contexts.indexOf(focused() as Element)][0]).toEqual({
      block: 'nearest',
      behavior: 'smooth',
    })
  })

  it('focuses the input of the option that has the message', async () => {
    const { wrapper } = await fail([{ field: 'options.1.label', message: 'Doppelt' }])

    expect(focused()).toBe(
      settings(wrapper).findAll('input[aria-label^="Auswahl-Option"]')[1].element,
    )
  })

  it('focuses the first box of a group of boxes, and the box of "Aktiv"', async () => {
    const { wrapper } = await fail([{ field: 'applies_to', message: 'Mindestens eins' }])
    const boxes = settings(wrapper).findAll<HTMLInputElement>('input[type=checkbox]')
    expect(focused()).toBe(boxes[0].element)
  })

  it('focuses "Aktiv" when that is the only one', async () => {
    const { wrapper } = await fail([{ field: 'active', message: 'x' }])
    const boxes = settings(wrapper).findAll<HTMLInputElement>('input[type=checkbox]')
    expect(focused()).toBe(boxes[boxes.length - 1].element)
  })

  it('does not move the focus when the save fails for another reason', async () => {
    const { wrapper } = await open()
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    await settings(wrapper).get('input[type=text]').setValue('Ort')
    const before = document.activeElement
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 })),
    )

    await buttonWith(wrapper, 'Speichern')!.trigger('click')
    await flushPromises()

    expect(document.activeElement).toBe(before)
  })
})
