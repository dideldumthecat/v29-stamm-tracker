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
  handles,
  open,
  previewNames,
  settings,
  squeezed,
} from './attributesPage'
import { stubBrowser } from './popup'

enableAutoUnmount(afterEach)
beforeEach(() => {
  user.value = null
  stubBrowser()
})
afterEach(() => vi.unstubAllGlobals())

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
    expect(panel.get<HTMLSelectElement>('select').element.value).toBe('choice')
    // the options: a field and a button each
    expect(panel.findAll('input[aria-label^="Option"]')).toHaveLength(3)
    expect(panel.findAll('button').filter((b) => b.text() === 'Deaktivieren')).toHaveLength(2)
    expect(panel.findAll('button').filter((b) => b.text() === 'Aktivieren')).toHaveLength(1)
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

  it('leave type and inheritance free without values, and offer the series only for number, text, date and month', async () => {
    const { wrapper } = await open()
    await field(wrapper, 'Lieferdatum').trigger('click')
    await flushPromises()
    const panel = () => settings(wrapper)
    const type = (value: string) => panel().get('select').setValue(value)

    expect(panel().text()).not.toContain('Nicht mehr änderbar')
    expect(panel().text()).toContain('Jeder Eintrag wird zu einer Liste hinzugefügt') // date
    expect(panel().text()).not.toContain('Einheit')

    await type('number')
    expect(panel().text()).toContain('Einheit')
    expect(panel().text()).toContain('Jeder Eintrag wird zu einer Liste hinzugefügt')
    await type('text')
    expect(panel().text()).toContain('Jeder Eintrag wird zu einer Liste hinzugefügt')
    await type('month')
    expect(panel().text()).toContain('Jeder Eintrag wird zu einer Liste hinzugefügt')
    await type('choice')
    expect(panel().text()).not.toContain('Jeder Eintrag wird zu einer Liste hinzugefügt')
    expect(panel().text()).toContain('Option hinzufügen')
    await type('boolean')
    expect(panel().text()).not.toContain('Jeder Eintrag wird zu einer Liste hinzugefügt')
    expect(panel().text()).not.toContain('Option hinzufügen')
  })

  it('put the note on a system attribute at the very top, above the name', async () => {
    const { wrapper } = await open()
    await field(wrapper, 'Gesägt').trigger('click')
    await flushPromises()

    const panel = settings(wrapper)
    const note = panel.findAll('p').find((p) => p.text().startsWith('Systemmerkmal'))!
    const heading = panel.get('h2')
    expect(note.text()).toBe('Systemmerkmal: Ändern nur im Code möglich.')
    expect(
      note.element.compareDocumentPosition(heading.element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    // nothing but the note comes before the name
    expect(heading.element.previousElementSibling).toBe(note.element)
    expect(note.element.previousElementSibling).toBeNull()
    // and attributes of V29 have none
    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()
    expect(settings(wrapper).text()).not.toContain('Systemmerkmal: Ändern')
  })

  /** The labels of the rows, top to bottom (the first child of a row is its label). */
  const rowLabels = (wrapper: VueWrapper) =>
    settings(wrapper)
      .findAll('form > div, dl > div')
      .map((row) => row.element.firstElementChild!.textContent!.trim())

  it('order the rows: Name, Beschreibung, Typ, Einheit, Gültig für, Serie, Vererbbar, Anzeige-Bedingung, Aktiv', async () => {
    const { wrapper } = await open()
    await field(wrapper, 'Lieferdatum').trigger('click')
    await flushPromises()
    await settings(wrapper).get('select').setValue('number')

    expect(rowLabels(wrapper)).toEqual([
      'Name',
      'Beschreibung',
      'Typ',
      'Einheit',
      'Gültig für',
      'Serie',
      'Vererbbar',
      'Anzeige-Bedingung',
      'Aktiv',
    ])

    // a choice has no series, but options before "Aktiv"
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    dialogButton('Verwerfen').click()
    await flushPromises()
    expect(rowLabels(wrapper)).toEqual([
      'Name',
      'Beschreibung',
      'Typ',
      'Gültig für',
      'Vererbbar',
      'Anzeige-Bedingung',
      'Optionen',
      'Aktiv',
    ])
  })

  it('order the rows of a system attribute the same way', async () => {
    const { wrapper } = await open()
    await field(wrapper, 'Notiz').trigger('click')
    await flushPromises()

    expect(rowLabels(wrapper)).toEqual([
      'Typ',
      'Gültig für',
      'Serie',
      'Vererbbar',
      'Anzeige-Bedingung',
      'Aktiv',
    ])
  })

  it('hide "Vererbbar" unless "Stamm" is ticked, and leave the saved value as it is', async () => {
    const { wrapper, api } = await open()
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    const boxes = () => settings(wrapper).findAll<HTMLInputElement>('input[type=checkbox]')
    const inheritable = () => rowLabels(wrapper).includes('Vererbbar')
    // Stamm, Balken, Vererbbar
    await boxes()[2].setValue(true)
    expect(inheritable()).toBe(true)

    await boxes()[1].setValue(true)
    await boxes()[0].setValue(false)
    expect(inheritable()).toBe(false)
    expect(settings(wrapper).text()).not.toContain('Ja, Balken übernehmen den Wert des Stamms')

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

  it('hide "Vererbbar" of a system attribute that is not valid for the stem, and show it otherwise', async () => {
    const { wrapper } = await open('/attributes?view=beam', (fake) => {
      const notes = fake.attributes.attributes.find((attribute) => attribute.key === 'notes')!
      notes.applies_to = ['beam']
      notes.is_inheritable = true
    })
    await field(wrapper, 'Notiz').trigger('click')
    await flushPromises()
    expect(rowLabels(wrapper)).toEqual(['Typ', 'Gültig für', 'Serie', 'Anzeige-Bedingung', 'Aktiv'])

    await field(wrapper, 'Gesägt').trigger('click')
    await flushPromises()
    expect(rowLabels(wrapper)).toContain('Vererbbar')
  })

  it('show a system attribute as text only, without any control', async () => {
    const { wrapper } = await open()
    await field(wrapper, 'Gesägt').trigger('click')
    await flushPromises()

    const panel = settings(wrapper)
    expect(panel.get('h2').text()).toBe('Gesägt')
    expect(panel.text()).toContain('Systemmerkmal: Ändern nur im Code möglich.')
    expect(panel.text()).toContain('Ja/Nein')
    expect(panel.text()).toContain('Stamm')
    expect(panel.text()).toContain('Immer angezeigt')
    expect(panel.find('input, select, textarea, button').exists()).toBe(false)
    expect(buttonWith(wrapper, 'Speichern')).toBeUndefined()
    expect(buttonWith(wrapper, 'Verwerfen')).toBeUndefined()
  })

  it('name the attributes that hide a system attribute and show the options as text', async () => {
    const { wrapper, api } = await open('/attributes', (fake) => {
      const sawn = fake.attributes.attributes.find((attribute) => attribute.key === 'sawn')!
      sawn.hidden_when = ['notes']
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
    // by name, not by key (the yes/no system attributes: here "Notiz" is text, so the key is the fallback)
    expect(panel.text()).toContain('Ausgeblendet, wenn gesetzt:')
    expect(panel.text()).toContain('Optionen')
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

  it('sends the attribute, keeps the selection and updates the preview', async () => {
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
  })

  it('adds a new option and takes back one that is new, deactivates one that exists', async () => {
    const { wrapper, api } = await open()
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    const panel = () => settings(wrapper)

    await buttonWith(wrapper, 'Option hinzufügen')!.trigger('click')
    expect(panel().findAll('input[aria-label^="Option"]')).toHaveLength(4)
    await buttonWith(wrapper, 'Entfernen')!.trigger('click')
    expect(panel().findAll('input[aria-label^="Option"]')).toHaveLength(3)
    expect(buttonWith(wrapper, 'Speichern')!.attributes('disabled')).toBeDefined()

    await buttonWith(wrapper, 'Option hinzufügen')!.trigger('click')
    await panel().findAll('input[aria-label^="Option"]')[3].setValue('Lager Mitte')
    await panel()
      .findAll('button')
      .find((b) => b.text() === 'Deaktivieren')!
      .trigger('click')
    expect(panel().find('input.line-through').exists()).toBe(true)
    expect(
      panel()
        .findAll('button')
        .some((b) => b.text() === 'Aktivieren'),
    ).toBe(true)

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
      { field: 'options.1.label', message: 'Die Option „X“ gibt es schon.' },
    ])

    await buttonWith(wrapper, 'Speichern')!.trigger('click')
    await flushPromises()

    const panel = settings(wrapper)
    const alerts = panel.findAll('[role=alert]').map((alert) => alert.text())
    expect(alerts).toEqual([
      'Ein Merkmal mit diesem Namen gibt es schon.',
      'Die Option „X“ gibt es schon.',
    ])
    expect(panel.get('input[type=text]').attributes('aria-invalid')).toBe('true')
    // the name's error is in the name row, the option's under its option
    expect(panel.findAll('input[aria-label^="Option"]')[1].attributes('aria-invalid')).toBe('true')
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

  it('scrolls smoothly to the card when it starts above the visible area, under the header and the bar', async () => {
    const { wrapper } = await open()
    cardStartsAt(-100)

    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()

    expect(scrolled()).toHaveLength(1)
    expect(scrolled()[0].options).toEqual({ block: 'start', behavior: 'smooth' })
  })

  it('does so when the card starts under the bar only partly: the first 132 px are covered', async () => {
    const { wrapper } = await open()
    cardStartsAt(100)

    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()

    expect(scrolled()).toHaveLength(1)
  })

  it('does nothing when the card is visible', async () => {
    const { wrapper } = await open()
    cardStartsAt(132)

    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()

    expect(scrolled()).toHaveLength(0)
    expect(settings(wrapper).get('h2').text()).toBe('Lagerplatz')
  })

  it('does the same for "Merkmal hinzufügen"', async () => {
    const { wrapper } = await open()
    cardStartsAt(300)
    await buttonWith(wrapper, 'Merkmal hinzufügen')!.trigger('click')
    await flushPromises()
    expect(scrolled()).toHaveLength(0)

    await buttonWith(wrapper, 'Abbrechen')!.trigger('click')
    await flushPromises()
    cardStartsAt(-40)
    await buttonWith(wrapper, 'Merkmal hinzufügen')!.trigger('click')
    await flushPromises()
    expect(scrolled()).toHaveLength(1)
  })

  it('moves without animation when the system asks for less motion', async () => {
    const { wrapper } = await open()
    cardStartsAt(-100)
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduced-motion') }))

    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()

    expect(scrolled()[0].options).toEqual({ block: 'start', behavior: 'auto' })
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

  it('does not scroll while the question about unsaved changes holds the selection back', async () => {
    const { wrapper } = await open()
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    await settings(wrapper).get('input[type=text]').setValue('Ort')
    cardStartsAt(-100)

    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()

    expect(dialog()).not.toBeNull()
    expect(scrolled()).toHaveLength(0)
  })

  it('has a card that is not sticky, not limited in height and without a scrollbar of its own', async () => {
    const { wrapper } = await open()
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()

    const column = wrapper.get('[data-settings-column]').element
    const panel = settings(wrapper).element
    for (const element of [column, panel, panel.firstElementChild!]) {
      expect(element.className).not.toMatch(/sticky|max-h|overflow-y/)
    }
    // "Verwerfen" and "Speichern" are the card's last row, after the form
    expect(panel.lastElementChild!.contains(buttonWith(wrapper, 'Speichern')!.element)).toBe(true)
    expect(panel.firstElementChild!.contains(buttonWith(wrapper, 'Speichern')!.element)).toBe(false)
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

    expect(focused()).toBe(settings(wrapper).findAll('input[aria-label^="Option"]')[1].element)
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
