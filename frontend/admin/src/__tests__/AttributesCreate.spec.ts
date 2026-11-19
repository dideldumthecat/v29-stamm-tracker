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
  open,
  previewNames,
  settings,
  squeezed,
  type Opened,
} from './attributesPage'
import { stubBrowser } from './popup'

enableAutoUnmount(afterEach)
beforeEach(() => {
  user.value = null
  stubBrowser()
})
afterEach(() => vi.unstubAllGlobals())

const tile = (wrapper: VueWrapper, name: string) =>
  wrapper.findAll('section button').find((button) => button.text().startsWith(name))!
const placeholder = (wrapper: VueWrapper) => wrapper.find('[data-placeholder]')
const nameField = (wrapper: VueWrapper) => settings(wrapper).get('input[type=text]')
async function start(path = '/attributes') {
  const opened = await open(path)
  await buttonWith(opened.wrapper, 'Merkmal hinzufügen')!.trigger('click')
  await flushPromises()
  return opened
}
async function create(opened: Opened, type: string, name: string) {
  await tile(opened.wrapper, type).trigger('click')
  await nameField(opened.wrapper).setValue(name)
}
const panel = (wrapper: VueWrapper) => wrapper.find('section[aria-labelledby]')
const boxes = (wrapper: VueWrapper) =>
  panel(wrapper)
    .findAll<HTMLInputElement>('input[type=checkbox]')
    .map((box) => box.element.checked)

describe('step 1: the type', () => {
  it('shows a selected placeholder and the tiles with their examples', async () => {
    const { wrapper, router } = await start()

    expect(router.currentRoute.value.query).toEqual({ attribute: 'new' })
    const dashed = placeholder(wrapper)
    expect(dashed.text()).toBe('Unbenanntes Merkmal')
    expect(dashed.attributes('aria-current')).toBe('true')
    expect(countText(wrapper)).toBe('8 Merkmale')
    expect(wrapper.get('section[aria-labelledby] h2').text()).toBe('Neues Merkmal')
    // a new attribute is not closed with an X but with "Abbrechen"
    expect(wrapper.find('button[aria-label="Schließen"]').exists()).toBe(false)
    const tiles = wrapper.findAll('section ul button').map((button) => squeezed(button.text()))
    expect(tiles).toEqual([
      'Auswahl z. B. Holzart, Länge',
      'Ja / Nein z. B. Entrindet',
      'Zahl z. B. Durchmesser in cm',
      'Text z. B. Bemerkung',
      'Datum z. B. Lieferdatum, Fällzeitpunkt (nur Monat)',
    ])
    expect(wrapper.findAll('section ul svg')).toHaveLength(5)
    expect(buttonWith(wrapper, 'Abbrechen')).toBeDefined()
  })

  it('cancels without a question while nothing was entered', async () => {
    const { wrapper, router } = await start()

    await buttonWith(wrapper, 'Abbrechen')!.trigger('click')
    await flushPromises()

    expect(dialog()).toBeNull()
    expect(router.currentRoute.value.query).toEqual({})
    expect(placeholder(wrapper).exists()).toBe(false)
    expect(wrapper.text()).toContain('Nichts ausgewählt')
  })
})

describe('step 2: the form', () => {
  it('starts with the defaults: valid for the view, no inheritance, no series, active, one empty option', async () => {
    const { wrapper } = await start()
    await tile(wrapper, 'Auswahl').trigger('click')

    const form = panel(wrapper)
    expect(form.get('h2').text()).toBe('Neues Merkmal')
    expect(form.text()).toContain('Auswahl')
    expect(form.text()).toContain('ändern')
    expect(form.text()).not.toContain('Genauigkeit')
    // Stamm, Balken, Vererbbar, then the yes/no attributes (Gesägt, Entlastungsschnitt: with or without key), Aktiv
    expect(boxes(wrapper)).toEqual([true, false, false, false, false, true])
    expect(form.findAll<HTMLInputElement>('input[aria-label^="Auswahl-Option"]')).toHaveLength(1)
    expect(form.get<HTMLInputElement>('input[aria-label^="Auswahl-Option"]').element.value).toBe('')
    expect(squeezed(form.text())).not.toContain('Nicht mehr änderbar')
    expect(buttonWith(wrapper, 'Abbrechen')).toBeDefined()
    expect(buttonWith(wrapper, 'Anlegen')!.attributes('disabled')).toBeUndefined()
  })

  it('is valid for beams in the view "Balken", and the type is text with "ändern"', async () => {
    const { wrapper } = await start('/attributes?view=beam')
    await tile(wrapper, 'Zahl').trigger('click')

    expect(boxes(wrapper).slice(0, 2)).toEqual([false, true])
    expect(panel(wrapper).find('select').exists()).toBe(false)
    expect(squeezed(panel(wrapper).text())).toContain('Zahl ändern')
    expect(panel(wrapper).text()).toContain('Einheit')
  })

  it('shows the new attribute in the preview in place of the placeholder once there is a name', async () => {
    const { wrapper } = await start()
    await tile(wrapper, 'Zahl').trigger('click')
    expect(placeholder(wrapper).exists()).toBe(true)

    await nameField(wrapper).setValue('Durchmesser')

    expect(placeholder(wrapper).exists()).toBe(false)
    expect(previewNames(wrapper).pop()).toBe('Durchmesser')
    expect(field(wrapper, 'Durchmesser').attributes('aria-current')).toBe('true')
    expect(field(wrapper, 'Durchmesser').text()).toContain('Wert')
    // not counted before it exists
    expect(countText(wrapper)).toBe('8 Merkmale')

    await nameField(wrapper).setValue('  ')
    expect(placeholder(wrapper).exists()).toBe(true)
  })

  it('draws the live preview as the type says, also a choice and a yes/no', async () => {
    const { wrapper } = await start()
    await tile(wrapper, 'Ja / Nein').trigger('click')
    await nameField(wrapper).setValue('Entrindet')
    expect(field(wrapper, 'Entrindet').text()).toContain('Entrindet')
    await settings(wrapper).get('textarea').setValue('Rinde ab?')
    expect(field(wrapper, 'Entrindet').text()).toContain('Rinde ab?')
  })

  it('asks for the precision of a date: "Tag" is the default and means date, "Monat" means month', async () => {
    const opened = await start()
    const { wrapper, api } = opened
    await create(opened, 'Datum', 'Eingang')

    const precision = settings(wrapper).get<HTMLSelectElement>('select')
    expect(precision.element.value).toBe('date')
    expect(settings(wrapper).text()).toContain('Genauigkeit')
    expect(field(wrapper, 'Eingang').text()).toContain('TT / MM / JJJJ')

    await precision.setValue('month')
    expect(field(wrapper, 'Eingang').text()).toContain('MM / JJJJ')
    expect(field(wrapper, 'Eingang').text()).not.toContain('TT')

    await buttonWith(wrapper, 'Anlegen')!.trigger('click')
    await flushPromises()
    expect(attributeOf(api, 'Eingang').type).toBe('month')
  })

  it('creates a date with the day when the precision stays', async () => {
    const opened = await start()
    await create(opened, 'Datum', 'Eingang')

    await buttonWith(opened.wrapper, 'Anlegen')!.trigger('click')
    await flushPromises()

    expect(attributeOf(opened.api, 'Eingang').type).toBe('date')
  })

  it('goes back to the tiles with "ändern" and keeps what fits the new type', async () => {
    const opened = await start()
    const { wrapper } = opened
    await create(opened, 'Zahl', 'Durchmesser')
    await settings(wrapper).get('textarea').setValue('Mitte des Stamms')
    await settings(wrapper).findAll<HTMLInputElement>('input[type=text]')[1].setValue('cm')
    await settings(wrapper).findAll<HTMLInputElement>('input[type=checkbox]')[1].setValue(true)

    await buttonWith(wrapper, 'ändern')!.trigger('click')
    expect(wrapper.findAll('section ul button')).toHaveLength(5)
    expect(tile(wrapper, 'Zahl').attributes('aria-pressed')).toBe('true')
    expect(tile(wrapper, 'Text').attributes('aria-pressed')).toBe('false')

    await tile(wrapper, 'Text').trigger('click')
    const form = settings(wrapper).exists() ? settings(wrapper) : panel(wrapper)
    expect(squeezed(form.text())).toContain('Text ändern')
    expect(nameField(wrapper).element).toHaveProperty('value', 'Durchmesser')
    expect(form.get<HTMLTextAreaElement>('textarea').element.value).toBe('Mitte des Stamms')
    expect(form.text()).not.toContain('Einheit')
    // Stamm and Balken as ticked
    expect(boxes(wrapper).slice(0, 2)).toEqual([true, true])
    expect(field(wrapper, 'Durchmesser').text()).toContain('Beobachtung')
  })

  it('creates a choice with its options in order', async () => {
    const opened = await start()
    const { wrapper, api } = opened
    await create(opened, 'Auswahl', 'Farbe')
    await settings(wrapper).get('input[aria-label="Auswahl-Option 1"]').setValue('Rot')
    await buttonWith(wrapper, 'Auswahl-Option hinzufügen')!.trigger('click')
    await settings(wrapper).get('input[aria-label="Auswahl-Option 2"]').setValue('Blau')

    await buttonWith(wrapper, 'Anlegen')!.trigger('click')
    await flushPromises()

    const created = attributeOf(api, 'Farbe')
    expect(created.options.map((option) => option.label)).toEqual(['Rot', 'Blau'])
    expect(created).toMatchObject({
      applies_to: ['stem'],
      is_inheritable: false,
      is_series: false,
      active: true,
      type: 'choice',
    })
  })
})

describe('the form of a new attribute, in the order of the settings', () => {
  const rowLabels = (wrapper: VueWrapper) =>
    panel(wrapper)
      .findAll('form > div, form > section > h3, form > section > div > div')
      .map((row) => (row.element.firstElementChild ?? row.element).textContent!.trim())

  it('has the rows in the order of the settings', async () => {
    const { wrapper } = await start()
    await tile(wrapper, 'Zahl').trigger('click')

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
  })

  it('puts the precision of a date after the description', async () => {
    const { wrapper } = await start()
    await tile(wrapper, 'Datum').trigger('click')

    expect(rowLabels(wrapper).slice(0, 4)).toEqual(['Typ', 'Name', 'Beschreibung', 'Genauigkeit'])
  })

  it('switches "Wert vererbbar" off in the draft when "Stamm" is unticked, and hides the row', async () => {
    const opened = await start()
    const { wrapper, api } = opened
    await create(opened, 'Text', 'Merkmal')
    const boxes = () => panel(wrapper).findAll<HTMLInputElement>('input[type=checkbox]')
    // Stamm, Balken, Vererbbar, Serie
    await boxes()[2].setValue(true)
    expect(rowLabels(wrapper)).toContain('Wert vererbbar')

    await boxes()[1].setValue(true)
    await boxes()[0].setValue(false)

    expect(rowLabels(wrapper)).not.toContain('Wert vererbbar')
    // "Stamm" again: the row is back, and the value stays off
    await boxes()[0].setValue(true)
    expect(rowLabels(wrapper)).toContain('Wert vererbbar')
    expect(boxes()[2].element.checked).toBe(false)

    await boxes()[0].setValue(false)
    await buttonWith(wrapper, 'Anlegen')!.trigger('click')
    await flushPromises()
    expect(attributeOf(api, 'Merkmal')).toMatchObject({
      applies_to: ['beam'],
      is_inheritable: false,
    })
  })

  it('is valid for the beam only and not inheritable when made in the view "Balken" without "Stamm"', async () => {
    const opened = await start('/attributes?view=beam')
    const { wrapper } = opened
    await tile(wrapper, 'Text').trigger('click')

    expect(rowLabels(wrapper)).not.toContain('Wert vererbbar')
  })
})

describe('creating', () => {
  it('keeps the new attribute selected as an attribute, at the end, counts it and confirms', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const opened = await start()
    const { wrapper, api, router } = opened
    await create(opened, 'Text', 'Bemerkung')

    await buttonWith(wrapper, 'Anlegen')!.trigger('click')
    await flushPromises()

    const id = attributeOf(api, 'Bemerkung').id
    expect(api.calls.filter((call) => call.startsWith('POST /api/admin/attributes'))).toHaveLength(
      1,
    )
    expect(router.currentRoute.value.query).toEqual({ attribute: id })
    expect(countText(wrapper)).toBe('9 Merkmale')
    expect(previewNames(wrapper).pop()).toBe('Bemerkung')
    expect(field(wrapper, 'Bemerkung').attributes('aria-current')).toBe('true')
    expect(dialog()).toBeNull()
    // now the form of an existing attribute: the type as text with "ändern", "Speichern" off
    expect(settings(wrapper).get('h2').text()).toBe('Bemerkung')
    expect(settings(wrapper).find('select').exists()).toBe(false)
    expect(squeezed(settings(wrapper).text())).toContain('Text ändern')
    expect(buttonWith(wrapper, 'Speichern')!.attributes('disabled')).toBeDefined()
    expect(placeholder(wrapper).exists()).toBe(false)
    // the confirmation beside the count and for the screen reader
    expect(wrapper.text()).toContain('Merkmal gespeichert')
    expect(wrapper.get('[role=status].sr-only').text()).toBe('Merkmal „Bemerkung“ gespeichert.')
    // the heading of the card has the focus
    expect(focus.mock.contexts[focus.mock.contexts.length - 1]).toBe(
      settings(wrapper).get('h2').element,
    )
    focus.mockRestore()
  })

  it('shows it in a view where it belongs when it is made for the other kind', async () => {
    const opened = await start()
    const { wrapper, router } = opened
    await create(opened, 'Text', 'Sortierung')
    const kinds = settings(wrapper).findAll<HTMLInputElement>('input[type=checkbox]')
    await kinds[0].setValue(false)
    await kinds[1].setValue(true)

    await buttonWith(wrapper, 'Anlegen')!.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query.view).toBe('beam')
    expect(previewNames(wrapper)).toContain('Sortierung')
    expect(settings(wrapper).get('h2').text()).toBe('Sortierung')
  })

  it('shows the errors of a 422 at their fields and keeps the draft', async () => {
    const opened = await start()
    const { wrapper, api } = opened
    await create(opened, 'Text', 'Holzart')
    api.attributes.reject([
      { field: 'name', message: 'Ein Merkmal mit diesem Namen gibt es schon.' },
    ])

    await buttonWith(wrapper, 'Anlegen')!.trigger('click')
    await flushPromises()

    expect(panel(wrapper).get('[role=alert]').text()).toBe(
      'Ein Merkmal mit diesem Namen gibt es schon.',
    )
    expect(nameField(wrapper).attributes('aria-invalid')).toBe('true')
    expect(squeezed(panel(wrapper).text())).toContain('Text ändern')
    expect(countText(wrapper)).toBe('8 Merkmale')
  })

  it('focuses the first field with a message', async () => {
    const opened = await start()
    const { wrapper, api } = opened
    await create(opened, 'Text', 'Holzart')
    api.attributes.reject([
      { field: 'applies_to', message: 'Mindestens eins' },
      { field: 'name', message: 'Gibt es schon' },
    ])

    await buttonWith(wrapper, 'Anlegen')!.trigger('click')
    await flushPromises()

    expect(document.activeElement).toBe(nameField(wrapper).element)
  })

  it('says so when it fails for another reason', async () => {
    const opened = await start()
    const { wrapper, api } = opened
    await create(opened, 'Text', 'Bemerkung')
    api.failAttributes()

    await buttonWith(wrapper, 'Anlegen')!.trigger('click')
    await flushPromises()

    expect(panel(wrapper).get('[role=alert]').text()).toBe(
      'Anlegen fehlgeschlagen. Bitte noch einmal versuchen.',
    )
  })
})

describe('a draft', () => {
  const addButton = (wrapper: VueWrapper) =>
    wrapper.findAll('button').filter((b) => b.text() === 'Merkmal hinzufügen')

  it('hides "Merkmal hinzufügen" under the preview while a draft is open, and shows it again after "Anlegen"', async () => {
    const opened = await start()
    const { wrapper } = opened
    // the step of the type
    expect(addButton(wrapper)).toHaveLength(0)

    await create(opened, 'Text', 'Bemerkung')
    expect(addButton(wrapper)).toHaveLength(0)
    await buttonWith(wrapper, 'Anlegen')!.trigger('click')
    await flushPromises()

    expect(addButton(wrapper)).toHaveLength(1)
    expect(addButton(wrapper)[0].classes()).toContain('border-dashed')
  })

  it('shows it again after "Abbrechen", also after discarding in the question', async () => {
    const opened = await start()
    const { wrapper } = opened
    expect(addButton(wrapper)).toHaveLength(0)
    await buttonWith(wrapper, 'Abbrechen')!.trigger('click')
    await flushPromises()
    expect(addButton(wrapper).length).toBeGreaterThan(0)

    await addButton(wrapper)[0].trigger('click')
    await flushPromises()
    await create(opened, 'Text', 'Bemerkung')
    await buttonWith(wrapper, 'Abbrechen')!.trigger('click')
    await flushPromises()
    expect(dialog()).not.toBeNull()
    expect(addButton(wrapper)).toHaveLength(0)
    dialogButton('Verwerfen').click()
    await flushPromises()

    expect(addButton(wrapper).length).toBeGreaterThan(0)
  })

  it('asks before another attribute is selected, and "Weiter bearbeiten" stays with the draft', async () => {
    const opened = await start()
    const { wrapper, router } = opened
    await create(opened, 'Text', 'Bemerkung')

    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()

    expect(dialog()!.textContent).toContain('Änderungen verwerfen?')
    dialogButton('Weiter bearbeiten').click()
    await flushPromises()
    expect(router.currentRoute.value.query.attribute).toBe('new')
    expect(nameField(wrapper).element).toHaveProperty('value', 'Bemerkung')

    await field(wrapper, 'Holzart').trigger('click')
    await flushPromises()
    dialogButton('Verwerfen').click()
    await flushPromises()
    expect(settings(wrapper).get('h2').text()).toBe('Holzart')
    expect(countText(wrapper)).toBe('8 Merkmale')
  })

  it('asks before "Abbrechen" and before the view changes, and does not for a type chosen and nothing more', async () => {
    const opened = await start()
    const { wrapper } = opened
    await tile(wrapper, 'Text').trigger('click')
    await buttonWith(wrapper, 'Balken')!.trigger('click')
    await flushPromises()
    expect(dialog()).toBeNull()

    await buttonWith(wrapper, 'Merkmal hinzufügen')!.trigger('click')
    await flushPromises()
    await create(opened, 'Text', 'X')
    await buttonWith(wrapper, 'Abbrechen')!.trigger('click')
    await flushPromises()
    expect(dialog()).not.toBeNull()
    dialogButton('Verwerfen').click()
    await flushPromises()
    expect(wrapper.text()).toContain('Nichts ausgewählt')
  })

  it('asks before the page is left, and goes on with "Verwerfen"', async () => {
    const opened = await start()
    const { wrapper, router } = opened
    await create(opened, 'Text', 'Bemerkung')

    await router.push('/activity')
    await flushPromises()
    expect(dialog()).not.toBeNull()
    expect(router.currentRoute.value.name).toBe('attributes')
    dialogButton('Weiter bearbeiten').click()
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('attributes')

    await router.push('/activity')
    await flushPromises()
    dialogButton('Verwerfen').click()
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('activity')
    expect(wrapper.get('h1').text()).toBe('Aktivität')
  })

  it('asks before the page is left with unsaved changes of an attribute too, and not without', async () => {
    const { wrapper, router } = await open()
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    await router.push('/stems')
    await flushPromises()
    expect(dialog()).toBeNull()
    expect(router.currentRoute.value.name).toBe('stems')

    await router.push('/attributes')
    await flushPromises()
    await field(wrapper, 'Lagerplatz').trigger('click')
    await flushPromises()
    await nameField(wrapper).setValue('Ort')
    await router.push('/beams')
    await flushPromises()
    expect(dialog()).not.toBeNull()
    expect(router.currentRoute.value.name).toBe('attributes')
  })

  it('does not ask when signing out with the button', async () => {
    const { wrapper, router } = await start()
    await create({ wrapper, router } as unknown as Opened, 'Text', 'Bemerkung')

    await wrapper.get('button[aria-label="Abmelden"]').trigger('click')
    await flushPromises()

    expect(dialog()).toBeNull()
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('does not ask when the session has expired', async () => {
    const opened = await start()
    const { wrapper, router, api } = opened
    await create(opened, 'Text', 'Bemerkung')
    api.expireSession()

    await buttonWith(wrapper, 'Anlegen')!.trigger('click')
    await flushPromises()

    expect(dialog()).toBeNull()
    expect(router.currentRoute.value.name).toBe('login')
  })
})

describe('the section "Stamm und Balken"', () => {
  it('has a heading of level 3 and the sentence follows "Gültig für" and "Wert vererbbar" at once', async () => {
    const opened = await start()
    const { wrapper } = opened
    await create(opened, 'Text', 'Merkmal')
    const boxes = () => panel(wrapper).findAll<HTMLInputElement>('input[type=checkbox]')
    const sentence = () => panel(wrapper).get('h3 + p').text()
    expect(panel(wrapper).get('h3').text()).toBe('Stamm und Balken')

    // Stamm, Balken, Vererbbar, Serie
    expect(sentence()).toBe('Erfassbar nur am Stamm. Balken haben dieses Merkmal nicht.')
    await boxes()[2].setValue(true)
    expect(sentence()).toBe(
      'Erfassbar nur am Stamm. Balken zeigen seinen Wert, ändern lässt er sich nur am Stamm.',
    )
    await boxes()[1].setValue(true)
    expect(sentence()).toBe(
      'Erfassbar an Stamm und Balken. Balken zeigen den Wert des Stamms, bis sie einen eigenen bekommen.',
    )
    await boxes()[2].setValue(false)
    expect(sentence()).toBe(
      'Erfassbar an Stamm und Balken. Balken starten leer, auch wenn der Stamm einen Wert hat.',
    )
    await boxes()[0].setValue(false)
    expect(sentence()).toBe(
      'Erfassbar nur an Balken, auch an einem Stamm, der als Ganzes zum Balken gesägt ist.',
    )
  })
})

describe('the checkbox "Wert vererbbar"', () => {
  it('is named by the label of its row and its own text', async () => {
    const opened = await start()
    const { wrapper } = opened
    await create(opened, 'Text', 'Merkmal')
    const box = panel(wrapper).findAll<HTMLInputElement>('input[type=checkbox]')[2]
    const name = box
      .attributes('aria-labelledby')!
      .split(' ')
      .map((id) => wrapper.element.querySelector(`[id="${id}"]`)?.textContent?.trim())
      .join(' ')

    expect(name).toBe('Wert vererbbar Ja')
  })
})

describe('a new option', () => {
  const optionInput = (wrapper: VueWrapper, index = 0) =>
    settings(wrapper).findAll<HTMLInputElement>('input[aria-label^="Auswahl-Option"]')[index]
  const optionButtons = (wrapper: VueWrapper) =>
    settings(wrapper)
      .findAll('li button:not([data-handle])')
      .map((button) => button.attributes('aria-label'))
  async function choice() {
    const opened = await start()
    await create(opened, 'Auswahl', 'Farbe')
    return opened
  }

  it('has no button and reserves no place while it is typed in', async () => {
    const { wrapper } = await choice()
    const column = () => settings(wrapper).findAll('li div.w-11')
    expect(optionButtons(wrapper)).toEqual([])
    expect(column()).toHaveLength(0)

    await optionInput(wrapper).setValue('Rot')
    expect(optionButtons(wrapper)).toEqual([])
    expect(column()).toHaveLength(0)

    await optionInput(wrapper).trigger('blur')
    expect(column()).toHaveLength(1)
  })

  it('shows the bin once the field was left, and keeps it while it is edited', async () => {
    const { wrapper } = await choice()
    await optionInput(wrapper).setValue('Rot')
    await optionInput(wrapper).trigger('blur')
    expect(optionButtons(wrapper)).toEqual(['„Rot“ löschen'])
    expect(optionInput(wrapper).element.value).toBe('Rot')

    await optionInput(wrapper).setValue('Rotbraun')
    expect(optionButtons(wrapper)).toEqual(['„Rotbraun“ löschen'])

    await wrapper.get('button[aria-label="„Rotbraun“ löschen"]').trigger('click')
    expect(settings(wrapper).findAll('input[aria-label^="Auswahl-Option"]')).toHaveLength(0)
  })

  it('leaves the field with Enter without submitting the form', async () => {
    const { wrapper, api } = await choice()
    await optionInput(wrapper).setValue('Rot')
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    optionInput(wrapper).element.dispatchEvent(enter)
    await flushPromises()

    expect(enter.defaultPrevented).toBe(true)
    expect(optionButtons(wrapper)).toEqual(['„Rot“ löschen'])
    expect(attributeOf(api, 'Farbe')).toBeUndefined()
  })

  it('can be deleted with the bin after an empty field was left', async () => {
    const { wrapper } = await choice()
    await optionInput(wrapper).trigger('blur')
    expect(optionButtons(wrapper)).toEqual(['Leere Auswahl-Option löschen'])

    await wrapper.get('button[aria-label="Leere Auswahl-Option löschen"]').trigger('click')
    expect(settings(wrapper).findAll('input[aria-label^="Auswahl-Option"]')).toHaveLength(0)
  })

  it('is saved with the attribute although the field was never left', async () => {
    const { wrapper, api } = await choice()
    await optionInput(wrapper).setValue('Rot')
    await buttonWith(wrapper, 'Anlegen')!.trigger('click')
    await flushPromises()

    expect(attributeOf(api, 'Farbe').options.map((option) => option.label)).toEqual(['Rot'])
  })
})
