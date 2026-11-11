import { describe, it, expect, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { useTimberItemStore } from '@/stores/timberItems'
import { buttonByText, mountAt, setupApp, splitIntoBeams } from './appSetup'
import { restartWithOldSnapshot } from './storeSetup'

vi.mock('virtual:pwa-register/vue', () => import('./appMocks').then((mocks) => mocks.pwaRegister))
vi.mock('@/composables/useUpdateCheck', () =>
  import('./appMocks').then((mocks) => mocks.updateCheck),
)
vi.mock('@/utils/photo', async (importOriginal) =>
  (await import('./appMocks')).photoUtils(await importOriginal()),
)

// Fixture: Holzart, Fälldatum, Lagerplatz, Gesägt are for stems, Sortierklasse for beams,
// Lieferdatum, Holzfeuchte, Notiz and Fotos for both. Stem 456 is empty, 789 is sawn and has the beams A and B.
describe('App: attributes by kind and the split choice', () => {
  setupApp()

  const sawnButton = () => buttonByText(/^\s*Gesägt\s*$/)
  const saveButton = () => document.body.querySelector<HTMLButtonElement>('button.bg-ink.text-lg')!
  const attributeId = (name: string) =>
    useTimberItemStore().attributes.find((attribute) => attribute.name === name)!.id
  const dialog = () => document.body.querySelector('[role="dialog"]')
  async function tap(button: HTMLElement) {
    button.click()
    await flushPromises()
  }

  it('hides beam attributes on a stem that is not sawn', async () => {
    const { wrapper } = await mountAt('/timber-item/456')
    expect(wrapper.text()).toContain('Holzart')
    expect(wrapper.text()).not.toContain('Sortierklasse')
    expect(wrapper.text()).not.toContain('Aufteilung')
  })

  const addTwoButton = () => buttonByText(/Balken A und B hinzufügen/)

  it('"Balken A und B hinzufügen" on a stem that is not sawn: splits without the dialog and ticks "Gesägt"', async () => {
    const { wrapper, router } = await mountAt('/timber-item/456')
    await tap(addTwoButton())
    expect(dialog()).toBeNull()
    expect(wrapper.text()).toContain('00456-A')
    expect(wrapper.text()).toContain('00456-B')
    expect(wrapper.text()).toContain('Aufgeteilter Stamm')
    expect(sawnButton().getAttribute('aria-pressed')).toBe('true')
    expect(buttonByText(/Balken 00456-C hinzufügen/)).toBeDefined()

    await tap(saveButton())
    const store = useTimberItemStore()
    expect(router.currentRoute.value.params.tagNumber).toBe('456')
    const stem = store.findByTag('456')!
    expect(stem.values[attributeId('Gesägt')]?.[0]?.value).toBe(true)
    expect(store.childrenOf(stem.id).map((beam) => beam.tag_number)).toEqual(['456-A', '456-B'])
  })

  it('keeps "Gesägt" ticked when the beams added by the button are removed again: sawn, not split', async () => {
    const { wrapper } = await mountAt('/timber-item/456')
    await tap(addTwoButton())
    await wrapper.find('button[aria-label="Balken 456-A entfernen"]').trigger('click')
    await wrapper.find('button[aria-label="Balken 456-B entfernen"]').trigger('click')
    expect(dialog()).toBeNull()
    expect(sawnButton().getAttribute('aria-pressed')).toBe('true')
    expect(wrapper.text()).not.toContain('Aufgeteilter Stamm')
    expect(wrapper.text()).toContain('Sortierklasse')
    expect(addTwoButton()).toBeDefined()
  })

  it('splits a sawn, not split stem by the button without asking; its saved beam values stay read-only, typed ones are dropped', async () => {
    const store = useTimberItemStore()
    const stemId = store.findByTag('456')!.id
    store.recordAttribute(stemId, attributeId('Gesägt'), true)
    const { wrapper } = await mountAt('/timber-item/456')
    const sortierklasse = wrapper.findAll('select')[2]!
    await sortierklasse.setValue(sortierklasse.findAll('option')[1]!.element.value)
    const before = store.events.length
    await tap(addTwoButton())
    expect(dialog()).toBeNull()
    expect(wrapper.text()).toContain('00456-A')
    expect(wrapper.text()).not.toContain('Sortierklasse')
    await tap(saveButton())
    expect(store.events.slice(before).map((event) => event.type)).toEqual([
      'created',
      'tag_assigned',
      'created',
      'tag_assigned',
    ])
  })

  it('asks whether the stem was split the moment "Gesägt" is ticked; the dialog takes no way out but its buttons', async () => {
    const { wrapper, router } = await mountAt('/timber-item/456')
    await tap(sawnButton())
    expect(dialog()!.querySelector('h2')!.textContent).toBe('Stamm aufgeteilt?')
    expect([...dialog()!.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
      'Nein, nicht aufgeteilt',
      'Ja, mehrere Balken',
      'Abbrechen',
    ])
    expect(dialog()!.contains(document.activeElement)).toBe(true)

    // A tap next to the dialog and the back gesture change nothing.
    await tap(document.body.querySelector<HTMLElement>('.fixed')!)
    await router.push('/')
    await flushPromises()
    expect(dialog()).not.toBeNull()
    expect(router.currentRoute.value.params.tagNumber).toBe('456')

    // Tab stays inside the dialog.
    const buttons = [...dialog()!.querySelectorAll('button')]
    buttons[buttons.length - 1]!.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    expect(document.activeElement).toBe(buttons[0])
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }))
    expect(document.activeElement).toBe(buttons[buttons.length - 1])

    expect(wrapper.text()).not.toContain('Sortierklasse')
  })

  it('"Abbrechen" takes the tick back and leaves nothing behind', async () => {
    const { wrapper, router } = await mountAt('/timber-item/456')
    await tap(sawnButton())
    await tap(buttonByText(/^\s*Abbrechen\s*$/))
    expect(dialog()).toBeNull()
    expect(sawnButton().getAttribute('aria-pressed')).toBe('false')
    expect(saveButton().disabled).toBe(true)
    expect(useTimberItemStore().isDraftOpen).toBe(false)
    await router.push('/')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('start')
    expect(wrapper.text()).not.toContain('Änderungen verwerfen?')
  })

  it('"Nicht aufgeteilt": the beam attributes can be recorded on the stem, no beams and no extra field', async () => {
    const { wrapper, router } = await mountAt('/timber-item/456')
    const before = wrapper.findAll('section').length
    await tap(sawnButton())
    await tap(buttonByText(/Nein, nicht aufgeteilt/))
    expect(dialog()).toBeNull()
    expect(addTwoButton()).toBeDefined()
    // Only Sortierklasse joined the form; the answer itself is shown nowhere.
    expect(wrapper.findAll('section').length).toBe(before + 1)
    expect(wrapper.text()).not.toContain('nicht aufgeteilt')
    const sortierklasse = wrapper.findAll('select')[2]!
    await sortierklasse.setValue(sortierklasse.findAll('option')[1]!.element.value)
    await tap(saveButton())

    const store = useTimberItemStore()
    expect(router.currentRoute.value.name).toBe('start')
    expect(store.events.map((event) => event.type)).toEqual([
      'attribute_recorded',
      'attribute_recorded',
    ])
    expect(store.findByTag('456')!.values[attributeId('Sortierklasse')]).toHaveLength(1)

    // Opened again: not split follows from the state, without a dialog.
    await router.push('/timber-item/456')
    await flushPromises()
    expect(dialog()).toBeNull()
    expect(wrapper.find('button[aria-label="Sortierklasse ändern"]').exists()).toBe(true)
  })

  it('"Mehrere Balken": A and B in the draft, the stem locked except stem attributes, "Gesägt" and the notes', async () => {
    const { wrapper, router } = await mountAt('/timber-item/456')
    await splitIntoBeams()
    expect(dialog()).toBeNull()
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    expect(wrapper.text()).toContain('00456-A')
    expect(wrapper.text()).toContain('00456-B')
    expect(wrapper.text()).toContain('Aufgeteilter Stamm')
    // No photos, so no photo section either.
    expect(wrapper.text()).not.toContain('Fotos')
    expect(wrapper.text()).not.toContain('Foto aufnehmen')
    expect(wrapper.text()).not.toContain('mehrere Balken')
    // Nothing recorded yet, so the locked fields (Lieferdatum, Holzfeuchte) are gone; left are the stem attributes
    // Holzart, Fälldatum and Lagerplatz, "Gesägt" and the notes.
    expect(wrapper.findAll('select, input')).toHaveLength(3)
    expect(wrapper.find('input[type="date"]').exists()).toBe(false)
    expect(wrapper.find('input[inputmode="decimal"]').exists()).toBe(false)
    expect(wrapper.findAll('textarea')).toHaveLength(1)
    expect(sawnButton().getAttribute('aria-pressed')).toBe('true')

    const holzart = wrapper.findAll('select')[0]!
    await holzart.setValue(holzart.findAll('option')[1]!.element.value)
    await wrapper.find('textarea').setValue('Krumm')
    await tap(saveButton())
    const store = useTimberItemStore()
    expect(store.events.map((event) => event.type)).toEqual([
      'attribute_recorded',
      'attribute_recorded',
      'attribute_recorded',
      'created',
      'tag_assigned',
      'created',
      'tag_assigned',
    ])
    expect(store.findByTag('456')!.values[attributeId('Holzart')]).toHaveLength(1)
    expect(store.isInherited(store.findByTag('456-A')!.id, attributeId('Holzart'))).toBe(true)
    expect(router.currentRoute.value.params.tagNumber).toBe('456')
    // Saved beams: "Gesägt" is settled.
    expect(wrapper.find('button[aria-label="Gesägt ändern"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Gesägt')
  })

  it('keeps input typed before the choice as a field and saves it with the stem', async () => {
    const { wrapper } = await mountAt('/timber-item/456')
    await wrapper.find('input[type="date"]').setValue('2026-09-08')
    await splitIntoBeams()
    expect(wrapper.find('input[type="date"]').exists()).toBe(true)
    await tap(saveButton())
    const store = useTimberItemStore()
    expect(store.findByTag('456')!.values[attributeId('Lieferdatum')]![0]!.value).toBe('2026-09-08')
    expect(wrapper.find('input[type="date"]').exists()).toBe(false)
  })

  it('changes the answer by unticking and ticking "Gesägt" again; beam attributes typed before are not recorded on a split stem', async () => {
    const { wrapper } = await mountAt('/timber-item/456')
    await tap(sawnButton())
    await tap(buttonByText(/Nein, nicht aufgeteilt/))
    const sortierklasse = wrapper.findAll('select')[2]!
    await sortierklasse.setValue(sortierklasse.findAll('option')[1]!.element.value)
    // No draft beams, so unticking does not ask.
    await tap(sawnButton())
    expect(dialog()).toBeNull()
    expect(wrapper.text()).not.toContain('Sortierklasse')
    await splitIntoBeams()
    expect(wrapper.text()).toContain('00456-A')
    expect(wrapper.text()).not.toContain('Sortierklasse')
    await tap(saveButton())
    expect(
      useTimberItemStore().findByTag('456')!.values[attributeId('Sortierklasse')],
    ).toBeUndefined()
  })

  it('counts as "Nicht aufgeteilt" once the last draft beam is removed: unlocked at once, saved without a question', async () => {
    const { wrapper, router } = await mountAt('/timber-item/456')
    await splitIntoBeams()
    await wrapper.find('button[aria-label="Balken 456-A entfernen"]').trigger('click')
    expect(wrapper.text()).toContain('Aufgeteilter Stamm')
    await wrapper.find('button[aria-label="Balken 456-B entfernen"]').trigger('click')
    expect(dialog()).toBeNull()
    expect(wrapper.text()).not.toContain('Aufgeteilter Stamm')
    expect(addTwoButton()).toBeDefined()
    expect(sawnButton().getAttribute('aria-pressed')).toBe('true')
    // Holzart, Lagerplatz and the beam attribute Sortierklasse are back; so are the photo buttons.
    expect(wrapper.findAll('select')).toHaveLength(3)
    expect(wrapper.text()).toContain('Foto aufnehmen')

    // To split after all: untick (nothing to ask, no beams) and tick again.
    await tap(sawnButton())
    expect(dialog()).toBeNull()
    await tap(sawnButton())
    expect(dialog()!.querySelector('h2')!.textContent).toBe('Stamm aufgeteilt?')
    await tap(buttonByText(/Nein, nicht aufgeteilt/))

    const sortierklasse = wrapper.findAll('select')[2]!
    await sortierklasse.setValue(sortierklasse.findAll('option')[1]!.element.value)
    await tap(saveButton())
    expect(dialog()).toBeNull()
    expect(router.currentRoute.value.name).toBe('start')
    const stem = useTimberItemStore().findByTag('456')!
    expect(stem.has_children).toBe(false)
    expect(stem.values[attributeId('Gesägt')]?.[0]?.value).toBe(true)
    expect(stem.values[attributeId('Sortierklasse')]).toHaveLength(1)
  })

  it('asks before unticking "Gesägt" throws draft beams away; ticking again asks for the split anew', async () => {
    const { wrapper } = await mountAt('/timber-item/456')
    await splitIntoBeams()
    await tap(sawnButton())
    expect(dialog()!.querySelector('h2')!.textContent).toBe('Balken verwerfen?')
    expect(dialog()!.textContent!.replace(/\s+/g, ' ')).toContain('Balken 00456-A, 00456-B')
    await tap(buttonByText(/^\s*Abbrechen\s*$/))
    expect(wrapper.text()).toContain('00456-A')
    expect(sawnButton().getAttribute('aria-pressed')).toBe('true')

    await tap(sawnButton())
    await tap(buttonByText(/^\s*Verwerfen\s*$/))
    expect(dialog()).toBeNull()
    expect(wrapper.text()).not.toContain('00456-A')
    expect(sawnButton().getAttribute('aria-pressed')).toBe('false')
    expect(useTimberItemStore().events).toEqual([])

    await tap(sawnButton())
    expect(dialog()!.querySelector('h2')!.textContent).toBe('Stamm aufgeteilt?')
    await tap(buttonByText(/Nein, nicht aufgeteilt/))
    expect(wrapper.text()).toContain('Sortierklasse')
    expect(addTwoButton()).toBeDefined()
  })

  it('opens a stem with saved beams without a dialog, "Gesägt" read-only, and still takes a note', async () => {
    const { wrapper, router } = await mountAt('/timber-item/789')
    expect(dialog()).toBeNull()
    expect(wrapper.find('button[aria-label="Gesägt ändern"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-pressed]').exists()).toBe(false)
    expect(buttonByText(/Zurück zum Start/)).toBeDefined()

    await wrapper.find('textarea').setValue('Kern faul')
    await tap(buttonByText(/Speichern & schließen/))
    const store = useTimberItemStore()
    expect(store.events.map((event) => [event.type, event.data])).toEqual([
      ['attribute_recorded', { attribute_id: attributeId('Notiz'), value: 'Kern faul' }],
    ])
    expect(router.currentRoute.value.name).toBe('start')
  })

  it('frees the stem again once its last beam is removed', async () => {
    const { wrapper } = await mountAt('/timber-item/789')
    for (const tag of ['789-A', '789-B']) {
      await wrapper.find(`button[aria-label="Balken ${tag} entfernen"]`).trigger('click')
      await tap(buttonByText(/^Balken entfernen$/))
    }
    // Sawn without beams counts as not split, without asking.
    expect(dialog()).toBeNull()
    expect(wrapper.find('button[aria-label="Gesägt ändern"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Sortierklasse')
  })

  it('offers a beam its own attributes and shows stem attributes only as inherited values, without pencil', async () => {
    const { wrapper } = await mountAt('/timber-item/789-A')
    const text = wrapper.text()
    // Inherited from the stem.
    expect(text).toContain('Stieleiche')
    expect(text).toContain('Vom Stamm geerbt')
    expect(text).not.toContain('· Vom Stamm')
    expect(wrapper.find('button[aria-label="Holzart ändern"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="Gesägt ändern"]').exists()).toBe(false)
    // Stem attributes without a value are not shown.
    expect(text).not.toContain('Lagerplatz')
    expect(text).not.toContain('Fälldatum')
    expect(text).not.toContain('Aufteilung')
    // Beam attributes: recorded ones with pencil, the rest as input.
    expect(wrapper.find('button[aria-label="Sortierklasse ändern"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="Lieferdatum ändern"]').exists()).toBe(true)
    expect(wrapper.find('input[inputmode="decimal"]').exists()).toBe(true)
    expect(wrapper.find('textarea').exists()).toBe(true)
    expect(text).toContain('Foto aufnehmen')
  })

  it('works with a stored snapshot from before key, applies_to and hidden_when, and takes the new rules from the next download', async () => {
    const store = useTimberItemStore()
    await restartWithOldSnapshot()
    expect(
      store.attributes.every(
        (attribute) =>
          attribute.key === null &&
          attribute.applies_to.join() === 'stem,beam' &&
          attribute.hidden_when.length === 0,
      ),
    ).toBe(true)

    const { wrapper, router } = await mountAt('/timber-item/456')
    // As before the update: every attribute on the stem, "Gesägt" without a question.
    expect(wrapper.findAll('select')).toHaveLength(3)
    await tap(sawnButton())
    expect(dialog()).toBeNull()
    expect(sawnButton().getAttribute('aria-pressed')).toBe('true')
    await tap(sawnButton())
    // The button adds the beams without ticking "Gesägt"; the stem stays open until they are saved.
    await tap(addTwoButton())
    expect(dialog()).toBeNull()
    expect(sawnButton().getAttribute('aria-pressed')).toBe('false')
    expect(wrapper.text()).not.toContain('Aufgeteilter Stamm')
    expect(wrapper.findAll('select')).toHaveLength(3)
    await wrapper.find('input[type="date"]').setValue('2026-09-08')
    await tap(saveButton())
    expect(store.events.map((event) => event.type)).toEqual([
      'attribute_recorded',
      'created',
      'tag_assigned',
      'created',
      'tag_assigned',
    ])
    expect(wrapper.text()).toContain('Aufgeteilter Stamm')
    expect(wrapper.findAll('select, input, textarea')).toHaveLength(0)

    // The download brings the fields: the new rules apply without a restart.
    await store.refresh()
    expect(store.attributes.some((attribute) => attribute.key === 'sawn')).toBe(true)
    await router.push('/timber-item/42')
    await flushPromises()
    expect(wrapper.text()).not.toContain('Sortierklasse')
    await tap(sawnButton())
    expect(dialog()!.querySelector('h2')!.textContent).toBe('Stamm aufgeteilt?')
  })

  it('shows a value recorded in the wrong place read-only', async () => {
    const store = useTimberItemStore()
    // A beam attribute on a stem that is not sawn.
    store.recordAttribute(
      store.findByTag('456')!.id,
      attributeId('Sortierklasse'),
      store.attributes.find((attribute) => attribute.name === 'Sortierklasse')!.options[0]!.id,
    )
    const { wrapper } = await mountAt('/timber-item/456')
    expect(wrapper.text()).toContain('Sortierklasse')
    expect(wrapper.find('button[aria-label="Sortierklasse ändern"]').exists()).toBe(false)
    expect(wrapper.findAll('select')).toHaveLength(2)
  })
})
