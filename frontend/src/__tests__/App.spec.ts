import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import App from '../App.vue'
import { routes } from '../router'
import { useTimberItemStore } from '@/stores/timberItems'

const mounted: { unmount: () => void }[] = []

// Memory history: no browser URL needed in the test environment.
async function mountAt(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  router.push(path)
  await router.isReady()
  const wrapper = mount(App, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  mounted.push(wrapper)
  return { wrapper, router }
}

describe('App', () => {
  beforeEach(() => {
    // jsdom does not implement scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn()
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  // Unmount first: the toast state is global, a leftover app would re-render into the cleared body.
  afterEach(() => {
    mounted.splice(0).forEach((wrapper) => wrapper.unmount())
  })

  it('renders the start screen on /', async () => {
    const { wrapper } = await mountAt('/')
    expect(wrapper.text()).toContain('V29 Stamm-Tracker')
  })

  it('renders an unknown timber item with padded tag number', async () => {
    const { wrapper } = await mountAt('/timber-item/42')
    expect(wrapper.text()).toContain('00042')
    expect(wrapper.text()).toContain('Noch nicht erfasst')
    expect(wrapper.text()).toContain('Stamm anlegen & speichern')
  })

  it('shows a known timber item with its recorded value locked', async () => {
    const { wrapper } = await mountAt('/timber-item/123')
    expect(wrapper.text()).toContain('Bereits erfasst')
    expect(wrapper.text()).toContain('Traubeneiche')
    // Holzart is recorded → locked with a pencil button instead of a select.
    expect(wrapper.find('button[aria-label="Holzart ändern"]').exists()).toBe(true)
  })

  it('redirects invalid tag numbers to the start screen', async () => {
    const { router } = await mountAt('/timber-item/5000')
    expect(router.currentRoute.value.name).toBe('start')
  })

  it('asks before leaving with unsaved changes', async () => {
    const { wrapper, router } = await mountAt('/timber-item/42')
    await wrapper.find('select').setValue(wrapper.findAll('option')[1]!.element.value)
    await wrapper.find('button[aria-label="Schließen"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('timber-item')
    expect(document.body.textContent).toContain('Änderungen verwerfen?')
  })

  it('reports a saved change on a known timber item', async () => {
    const { wrapper } = await mountAt('/timber-item/456')
    await wrapper.find('select').setValue(wrapper.findAll('option')[1]!.element.value)
    await wrapper.find('button.bg-ink.text-lg').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('gespeichert')
    expect(document.body.textContent).not.toContain('Keine Änderungen')
  })

  it('records a ticked boolean attribute on save', async () => {
    const { wrapper } = await mountAt('/timber-item/456')
    await wrapper.find('button[aria-pressed]').trigger('click')
    await wrapper.find('button.bg-ink.text-lg').trigger('click')
    await flushPromises()
    const store = useTimberItemStore()
    const attribute = store.attributes.find((candidate) => candidate.type === 'boolean')!
    expect(store.findByTagNumber(456)?.values[attribute.id]?.[0]?.value).toBe(true)
  })

  it('records a picked date in contract format', async () => {
    const { wrapper } = await mountAt('/timber-item/456')
    const store = useTimberItemStore()
    const attribute = store.attributes.find((candidate) => candidate.type === 'date')!
    await wrapper.find('input[type="date"]').setValue('2026-09-08')
    await wrapper.find('button.bg-ink.text-lg').trigger('click')
    await flushPromises()
    expect(store.findByTagNumber(456)?.values[attribute.id]?.[0]?.value).toBe('2026-09-08')
  })

  it('blocks saving invalid number input, shows the error and protects the input', async () => {
    const { wrapper, router } = await mountAt('/timber-item/42')
    const input = wrapper.find('input[inputmode="decimal"]')
    await input.setValue('34abc')
    // No message while typing – only after the save attempt.
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)

    await wrapper.find('button.bg-ink.text-lg').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('Zahl')
    expect(useTimberItemStore().findByTagNumber(42)).toBeUndefined()

    // Changing the input hides the message again.
    await input.setValue('34abcd')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)

    // Invalid input is unsaved work: closing asks first.
    await wrapper.find('button[aria-label="Schließen"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('timber-item')
    expect(document.body.textContent).toContain('Änderungen verwerfen?')
  })

  it('records added series values and the pending input on save', async () => {
    const { wrapper } = await mountAt('/timber-item/456')
    const store = useTimberItemStore()
    const attribute = store.attributes.find((candidate) => candidate.type === 'number')!
    const input = wrapper.find('input[inputmode="decimal"]')
    await input.setValue('40')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Hinzufügen')!
      .trigger('click')
    // Typed but not added: saved too, so it is not lost.
    await input.setValue('41,5')
    await wrapper.find('button.bg-ink.text-lg').trigger('click')
    await flushPromises()
    expect(store.findByTagNumber(456)?.values[attribute.id]?.map((record) => record.value)).toEqual(
      [40, 41.5],
    )
  })

  it('orders attributes and options by sort_order, not by position in the snapshot', async () => {
    const store = useTimberItemStore()
    store.attributes.reverse()
    store.attributes.forEach((attribute) => attribute.options.reverse())
    const { wrapper } = await mountAt('/timber-item/456')
    const text = wrapper.text()
    const names = [...store.attributes].sort((a, b) => a.sort_order - b.sort_order)
    const positions = names
      // Inactive attributes without a value are hidden, so they have no position.
      .filter((attribute) => attribute.active)
      .filter((attribute) => ['choice', 'date', 'boolean', 'number'].includes(attribute.type))
      .map((attribute) => text.indexOf(attribute.name))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))

    const labels = wrapper
      .findAll('select')[0]!
      .findAll('option')
      .map((option) => option.text())
    expect(labels.slice(1, 3)).toEqual(['Traubeneiche', 'Stieleiche'])
  })

  it('walks through a known item: one value per type, saved, locked, counted', async () => {
    const { wrapper } = await mountAt('/timber-item/456')
    const store = useTimberItemStore()
    // First option after the placeholder of each select (Holzart, Lagerplatz, Sortierklasse).
    const selects = wrapper.findAll('select')
    for (const select of selects) {
      await select.setValue(select.findAll('option')[1]!.element.value)
    }
    await wrapper.find('input[type="date"]').setValue('2026-09-08')
    await wrapper.find('button[aria-pressed]').trigger('click')
    const measurement = wrapper.find('input[inputmode="decimal"]')
    await measurement.setValue('40')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Hinzufügen')!
      .trigger('click')
    // Typed but not added: saved with the rest.
    await measurement.setValue('41,5')
    expect(store.pendingCount).toBe(0)

    await wrapper.find('button.bg-ink.text-lg').trigger('click')
    await flushPromises()

    // One attribute_recorded event per value: 5 single values + 2 measurements.
    expect(store.pendingCount).toBe(7)
    expect(document.body.textContent).toContain('gespeichert')
    // Everything recorded is locked now (pencil instead of input), the series shows as a list.
    const names = ['Holzart', 'Lagerplatz', 'Sortierklasse', 'Fälldatum', 'Gesägt']
    const pencils = names.filter((name) =>
      wrapper.find(`button[aria-label="${name} ändern"]`).exists(),
    )
    expect(pencils).toEqual(names)
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.find('input[type="date"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('08.09.2026')
    expect(wrapper.text()).toContain('41,5 %')
    expect(wrapper.text()).toContain('40 %')
    expect(wrapper.text()).not.toContain('neu')
  })

  describe('inactive attributes', () => {
    const deactivate = (type: string) => {
      const store = useTimberItemStore()
      store.attributes
        .filter((attribute) => attribute.type === type)
        .forEach((attribute) => {
          attribute.active = false
        })
      return store
    }

    it('marks inactive values on item 123 and nothing else', async () => {
      const { wrapper } = await mountAt('/timber-item/123')
      const text = wrapper.text()
      // Lagerplatz is active, but its recorded option is not: the option is marked, the attribute is not.
      expect(text).toContain('Waldweg Ost')
      // Entlastungsschnitt is inactive and recorded: read-only with the hint next to the name.
      expect(text).toContain('Entlastungsschnitt')
      // One hint for the option, one for the attribute.
      expect(text.match(/\(deaktiviert\)/g)).toHaveLength(2)
      // Active values carry nothing.
      expect(text).toContain('Traubeneiche')
      expect(text).not.toContain('Traubeneiche (deaktiviert')
    })

    it('hides an inactive attribute without a recorded value', async () => {
      const store = deactivate('date')
      const name = store.attributes.find((attribute) => attribute.type === 'date')!.name
      const { wrapper } = await mountAt('/timber-item/456')
      expect(wrapper.text()).not.toContain(name)
      expect(wrapper.find('input[type="date"]').exists()).toBe(false)
    })

    it('shows recorded values of inactive attributes read-only, whatever the type', async () => {
      const store = deactivate('date')
      deactivate('number')
      deactivate('choice')
      deactivate('boolean')
      // Item 123: choice, date and series recorded. Item 789: boolean recorded.
      const first = await mountAt('/timber-item/123')
      expect(first.wrapper.text()).toContain('28.09.2026')
      expect(first.wrapper.text()).toContain('48,5 %')
      expect(first.wrapper.text()).toContain('Traubeneiche')
      const second = await mountAt('/timber-item/789')
      expect(second.wrapper.text()).toContain(
        store.attributes.find((a) => a.type === 'boolean')!.name,
      )
      for (const { wrapper } of [first, second]) {
        expect(wrapper.find('input').exists()).toBe(false)
        expect(wrapper.find('select').exists()).toBe(false)
        expect(wrapper.find('button[aria-pressed]').exists()).toBe(false)
        // No pencil and no "Hinzufügen".
        expect(wrapper.findAll('button[aria-label$="ändern"]')).toHaveLength(0)
        expect(wrapper.findAll('button').filter((b) => b.text() === 'Hinzufügen')).toHaveLength(0)
      }
    })
  })

  describe('text series', () => {
    const notes = () => {
      const store = useTimberItemStore()
      const attribute = store.attributes.find((candidate) => candidate.type === 'text')!
      return store.findByTagNumber(123)?.values[attribute.id]?.map((record) => record.value)
    }

    it('appends a new entry on save', async () => {
      const { wrapper } = await mountAt('/timber-item/123')
      await wrapper.find('textarea').setValue('  Astloch  ')
      await wrapper.find('button.bg-ink.text-lg').trigger('click')
      await flushPromises()
      expect(notes()).toEqual(['Leichter Drehwuchs', 'Astloch'])
      // The new entry is part of the list now, the textarea is empty again.
      expect(wrapper.text()).toContain('Astloch')
      expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')
    })

    it('treats whitespace as no change: nothing saved, nothing to confirm when leaving', async () => {
      const { wrapper, router } = await mountAt('/timber-item/123')
      await wrapper.find('textarea').setValue('   ')
      await wrapper.find('button.bg-ink.text-lg').trigger('click')
      await flushPromises()
      expect(document.body.textContent).toContain('Keine Änderungen')
      expect(notes()).toEqual(['Leichter Drehwuchs'])

      await wrapper.find('textarea').setValue('  ')
      await wrapper.find('button[aria-label="Schließen"]').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('start')
    })
  })

  describe('beams', () => {
    const buttonByText = (text: RegExp) =>
      [...document.body.querySelectorAll('button')].find((button) =>
        text.test(button.textContent ?? ''),
      )!

    it('adds a beam on the stem screen and opens it from the toast', async () => {
      const { router } = await mountAt('/timber-item/42')
      buttonByText(/Balken 00042-A hinzufügen/).click()
      await flushPromises()
      expect(router.currentRoute.value.params.tagNumber).toBe('42')
      expect(document.body.textContent).toContain('Balken 00042-A angelegt')
      expect(document.body.textContent).toContain('noch keine eigenen Angaben')

      buttonByText(/^\s*Öffnen\s*$/).click()
      await flushPromises()
      expect(router.currentRoute.value.params.tagNumber).toBe('42-A')
    })

    it('summarises own values only, first two in sort order', async () => {
      const { wrapper } = await mountAt('/timber-item/789')
      const rows = wrapper.findAll('a[href^="/timber-item/789-"]').map((row) => row.text())
      // 789-A: Holzart and Fälldatum are inherited, only Sortierklasse is its own.
      expect(rows).toEqual(['00789-AA', '00789-B01.10.2026 · B'])
      expect(rows.join()).not.toContain('nicht synchronisiert')
      expect(wrapper.text()).toContain('Übertragene Balken kann nur die Administration entfernen.')
    })

    it('stops at Z: the 26th beam is "-Z", then adding is disabled', async () => {
      await mountAt('/timber-item/42')
      for (let count = 0; count < 25; count++) {
        buttonByText(/hinzufügen/).click()
        await flushPromises()
      }
      buttonByText(/Balken 00042-Z hinzufügen/).click()
      await flushPromises()
      expect(buttonByText(/Balken hinzufügen/).disabled).toBe(true)
      expect(document.body.textContent).toContain('Höchstens 26 Balken je Stamm')
    })

    const optionLabel = (name: string, label: string) =>
      useTimberItemStore()
        .attributes.find((attribute) => attribute.name === name)!
        .options.find((option) => option.label === label)!.id

    it('keeps a split stem fully read-only, without save bar', async () => {
      const { wrapper } = await mountAt('/timber-item/789')
      expect(wrapper.text()).toContain('Aufgeteilter Stamm')
      expect(wrapper.text()).not.toContain('Speichern')
      expect(wrapper.find('button[aria-label$=" ändern"]').exists()).toBe(false)
      expect(wrapper.findAll('select, textarea, input').length).toBe(0)
    })

    it('saves a valid draft before adding a beam', async () => {
      const { wrapper, router } = await mountAt('/timber-item/42')
      await wrapper.find('select').setValue(optionLabel('Holzart', 'Stieleiche'))
      buttonByText(/00042-A hinzufügen/).click()
      await flushPromises()
      expect(router.currentRoute.value.params.tagNumber).toBe('42')
      expect(document.body.textContent).toContain(
        'Stamm 00042 gespeichert · Balken 00042-A angelegt',
      )
      expect(wrapper.text()).toContain('Stieleiche')
      expect(useTimberItemStore().findByTag('42-A')).toBeDefined()
    })

    it('adds no beam while the draft is invalid', async () => {
      const { wrapper } = await mountAt('/timber-item/42')
      await wrapper.find('input[inputmode="decimal"]').setValue('abc')
      buttonByText(/00042-A hinzufügen/).click()
      await flushPromises()
      expect(wrapper.find('[role="alert"]').exists()).toBe(true)
      expect(useTimberItemStore().findByTag('42')).toBeUndefined()
      expect(useTimberItemStore().findByTag('42-A')).toBeUndefined()
    })

    it('does not reuse the letter of a removed beam', async () => {
      const { wrapper } = await mountAt('/timber-item/42')
      buttonByText(/00042-A hinzufügen/).click()
      await flushPromises()
      await wrapper.find('button[aria-label="Balken 42-A entfernen"]').trigger('click')
      buttonByText(/^Balken entfernen$/).click()
      await flushPromises()
      expect(wrapper.find('a[href="/timber-item/42-A"]').exists()).toBe(false)
      expect(buttonByText(/hinzufügen/).textContent).toContain('00042-B')
    })
  })
})
