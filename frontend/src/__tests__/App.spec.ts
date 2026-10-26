import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import App from '../App.vue'
import { routes } from '../router'
import { useTimberItemStore } from '@/stores/timberItems'
import { useToast } from '@/composables/useToast'
import { api, ApiError } from '@/api/client'

const needRefresh = ref(false)
const updateServiceWorker = vi.fn()
vi.mock('virtual:pwa-register/vue', () => ({
  useRegisterSW: () => ({ needRefresh, updateServiceWorker }),
}))

const mounted: { unmount: () => void }[] = []

// Memory history: no browser URL needed in the test environment.
async function mountAt(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  router.push(path)
  await router.isReady()
  const wrapper = mount(App, {
    // Real <Transition>: the stub would wrap the toast in an extra element.
    global: { plugins: [router], stubs: { transition: false } },
    attachTo: document.body,
  })
  await flushPromises()
  mounted.push(wrapper)
  return { wrapper, router }
}

// The server already holds every tag the device sends.
function rejectAll() {
  return vi.spyOn(api, 'sync').mockImplementation(async (events) => ({
    accepted_event_ids: [],
    rejected: events.map((event) => ({
      event_id: event.id,
      timber_item_id: event.timber_item_id,
      tag_number: '1555',
      reason: 'tag_already_taken' as const,
    })),
  }))
}

const DUPLICATE_HINT =
  'Stamm 01555 war bereits erfasst. Deine Angaben dazu wurden nicht übernommen. Bitte prüfe die Nummer und erfasse fehlende Werte am bestehenden Stamm.'

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
    // Saving shows a toast for 1.7 s; it must not leak into the next test.
    useToast().hide()
    needRefresh.value = false
  })

  it('renders the start screen on /', async () => {
    const { wrapper } = await mountAt('/')
    expect(wrapper.text()).toContain('V29 Stamm-Tracker')
  })

  it('renders an unknown timber item with padded tag number', async () => {
    const { wrapper } = await mountAt('/timber-item/42')
    expect(wrapper.text()).toContain('00042')
    expect(wrapper.text()).toContain('Noch nicht erfasst')
    expect(wrapper.text()).toContain('Stamm anlegen & schließen')
  })

  it('shows a known timber item with its recorded value locked', async () => {
    const { wrapper } = await mountAt('/timber-item/123')
    expect(wrapper.text()).toContain('Bereits erfasst')
    expect(wrapper.text()).toContain('Traubeneiche')
    // Holzart is recorded → locked with a pencil button instead of a select.
    expect(wrapper.find('button[aria-label="Holzart ändern"]').exists()).toBe(true)
  })

  it('opens the help page from the start header', async () => {
    const { wrapper, router } = await mountAt('/')
    await wrapper.find('a[aria-label="Hilfe"]').trigger('click')
    // The lazy-loaded view resolves after more than one tick.
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('help'))
    await flushPromises()
    expect(wrapper.text()).toContain('App installieren')
    expect(wrapper.text()).toContain('Synchronisieren')
    expect(wrapper.text()).toContain('Speicher geschützt: unbekannt')
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

  it('closes a saved stem to the start screen and still shows the toast there', async () => {
    const { wrapper, router } = await mountAt('/timber-item/456')
    await wrapper.find('select').setValue(wrapper.findAll('option')[1]!.element.value)
    await wrapper.find('button.bg-ink.text-lg').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('start')
    expect(document.body.textContent).toContain('Stamm 00456 gespeichert')
    expect(document.body.textContent).not.toContain('Änderungen verwerfen?')
  })

  it('enables saving only with changes, but always for a stem not recorded yet', async () => {
    const saveButton = (wrapper: { find: (selector: string) => { element: Element } }) =>
      wrapper.find('button.bg-ink.text-lg').element as HTMLButtonElement

    const known = await mountAt('/timber-item/456')
    expect(saveButton(known.wrapper).disabled).toBe(true)
    await known.wrapper.find('select').setValue(known.wrapper.findAll('option')[1]!.element.value)
    expect(saveButton(known.wrapper).disabled).toBe(false)

    const unknown = await mountAt('/timber-item/42')
    expect(saveButton(unknown.wrapper).disabled).toBe(false)
  })

  it('shows a toast below the header that lets taps through and hides after 1.5 s', async () => {
    vi.useFakeTimers()
    try {
      const { wrapper } = await mountAt('/timber-item/42')
      await wrapper.find('button.bg-ink.text-lg').trigger('click')
      await flushPromises()
      // Teleported to the end of <body> inside its clipping wrapper; TimberItemStatus also has role="status".
      const toast = document.body.querySelector(':scope > div > [role="status"]')!
      expect(toast.textContent).toContain('Stamm 00042 gespeichert')
      const clip = toast.parentElement!
      expect(clip.className).toContain('top-[calc(var(--spacing-header)')
      expect(clip.classList).toContain('overflow-hidden')
      expect(clip.classList).toContain('pointer-events-none')
      expect(toast.querySelector('button')).toBeNull()
      expect(toast.querySelector('svg')).not.toBeNull()

      // Slide-in (200 ms) does not count towards the 1.5 s.
      vi.advanceTimersByTime(1500)
      await flushPromises()
      expect(document.body.querySelector(':scope > div > [role="status"]')).not.toBeNull()
      vi.advanceTimersByTime(200)
      await flushPromises()
      // Slide-out (150 ms), then the element is removed.
      vi.advanceTimersByTime(150)
      await flushPromises()
      expect(document.body.querySelector(':scope > div > [role="status"]')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('swaps the text of a visible toast and restarts its timer', async () => {
    vi.useFakeTimers()
    try {
      await mountAt('/')
      const toast = useToast()
      toast.show({ before: 'Erster' })
      vi.advanceTimersByTime(1000)
      toast.show({ before: 'Zweiter' })
      await flushPromises()
      const status = () => document.body.querySelector(':scope > div > [role="status"]')
      expect(status()?.textContent).toContain('Zweiter')
      vi.advanceTimersByTime(1499)
      await flushPromises()
      expect(status()).not.toBeNull()
      vi.advanceTimersByTime(1)
      await flushPromises()
      expect(toast.current.value).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  describe('update hint', () => {
    const hint = () =>
      [...document.body.querySelectorAll(':scope > div > [role="status"]')].find((status) =>
        status.textContent?.includes('Neue Version verfügbar'),
      )

    it('stays on the start screen without time limit and reloads on confirm', async () => {
      vi.useFakeTimers()
      try {
        needRefresh.value = true
        await mountAt('/')
        vi.advanceTimersByTime(60_000)
        await flushPromises()
        expect(hint()?.classList).toContain('pointer-events-auto')
        ;[...hint()!.querySelectorAll('button')]
          .find((b) => b.textContent?.includes('Aktualisieren'))!
          .click()
        expect(updateServiceWorker).toHaveBeenCalledWith(true)
      } finally {
        vi.useRealTimers()
      }
    })

    it('gives way to a toast and comes back after it', async () => {
      vi.useFakeTimers()
      try {
        needRefresh.value = true
        await mountAt('/')
        useToast().show({ before: 'Gespeichert' })
        await flushPromises()
        vi.advanceTimersByTime(200)
        await flushPromises()
        expect(hint()).toBeUndefined()
        expect(document.body.textContent).toContain('Gespeichert')

        vi.advanceTimersByTime(1500)
        await flushPromises()
        // Toast slides out first (out-in), then the hint slides in.
        vi.advanceTimersByTime(500)
        await flushPromises()
        expect(hint()).toBeDefined()
      } finally {
        vi.useRealTimers()
      }
    })

    it('hides on close', async () => {
      needRefresh.value = true
      await mountAt('/')
      ;(
        hint()!.querySelector('button[aria-label="Hinweis schließen"]') as HTMLButtonElement
      ).click()
      expect(needRefresh.value).toBe(false)
      await vi.waitFor(() => expect(hint()).toBeUndefined())
    })

    it('is not shown outside the start screen', async () => {
      needRefresh.value = true
      await mountAt('/timber-item/42')
      expect(hint()).toBeUndefined()
    })
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

  it('records a picked month and shows it as MM/JJJJ', async () => {
    const { wrapper, router } = await mountAt('/timber-item/456')
    const store = useTimberItemStore()
    const attribute = store.attributes.find((candidate) => candidate.type === 'month')!
    await wrapper.find('input[type="month"]').setValue('2026-10')
    await wrapper.find('button.bg-ink.text-lg').trigger('click')
    await flushPromises()
    expect(store.findByTagNumber(456)?.values[attribute.id]?.[0]?.value).toBe('2026-10')
    await router.push('/timber-item/456')
    await flushPromises()
    expect(wrapper.text()).toContain('10/2026')
  })

  it('blocks saving invalid number input, shows the error and protects the input', async () => {
    const { wrapper, router } = await mountAt('/timber-item/42')
    const input = wrapper.find('input[inputmode="decimal"]')
    await input.setValue('34abc')
    // No message while typing – only after the save attempt.
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)

    await wrapper.find('button.bg-ink.text-lg').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('timber-item')
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
    const { wrapper, router } = await mountAt('/timber-item/456')
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
    await router.push('/timber-item/456')
    await flushPromises()
    // Everything recorded is locked now (pencil instead of input), the series shows as a list.
    const names = ['Holzart', 'Lagerplatz', 'Sortierklasse', 'Lieferdatum', 'Gesägt']
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
      deactivate('month')
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
      const { wrapper, router } = await mountAt('/timber-item/123')
      await wrapper.find('textarea').setValue('  Astloch  ')
      await wrapper.find('button.bg-ink.text-lg').trigger('click')
      await flushPromises()
      expect(notes()).toEqual(['Leichter Drehwuchs', 'Astloch'])
      // Reopened: the new entry is part of the list, the textarea is empty.
      await router.push('/timber-item/123')
      await flushPromises()
      expect(wrapper.text()).toContain('Astloch')
      expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')
    })

    it('treats whitespace as no change: nothing to save, nothing to confirm when leaving', async () => {
      const { wrapper, router } = await mountAt('/timber-item/123')
      await wrapper.find('textarea').setValue('   ')
      expect(wrapper.find('button.bg-ink.text-lg').attributes('disabled')).toBeDefined()
      expect(notes()).toEqual(['Leichter Drehwuchs'])

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

    it('adds a beam on the stem screen and lists it right there', async () => {
      const { wrapper, router } = await mountAt('/timber-item/42')
      buttonByText(/Balken 00042-A hinzufügen/).click()
      await flushPromises()
      expect(router.currentRoute.value.params.tagNumber).toBe('42')
      expect(document.body.querySelector(':scope > [role="status"]')).toBeNull()
      expect(wrapper.find('a[href="/timber-item/42-A"]').text()).toContain(
        'noch keine eigenen Angaben',
      )
    })

    it('closes a saved beam to its stem and still shows the toast there', async () => {
      const { wrapper, router } = await mountAt('/timber-item/789-A')
      await wrapper.find('textarea').setValue('Riss')
      await wrapper.find('button.bg-ink.text-lg').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.params.tagNumber).toBe('789')
      expect(document.body.textContent).toContain('Balken 00789-A gespeichert')
      expect(document.body.textContent).not.toContain('Änderungen verwerfen?')
    })

    it('summarises own values only, first two in sort order', async () => {
      const { wrapper } = await mountAt('/timber-item/789')
      const rows = wrapper.findAll('a[href^="/timber-item/789-"]').map((row) => row.text())
      // 789-A: Holzart and Lieferdatum are inherited, only Sortierklasse is its own.
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
      expect(document.body.querySelector(':scope > [role="status"]')).toBeNull()
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

    it('reuses the letter of a removed beam', async () => {
      const { wrapper } = await mountAt('/timber-item/42')
      buttonByText(/00042-A hinzufügen/).click()
      await flushPromises()
      await wrapper.find('button[aria-label="Balken 42-A entfernen"]').trigger('click')
      buttonByText(/^Balken entfernen$/).click()
      await flushPromises()
      expect(wrapper.find('a[href="/timber-item/42-A"]').exists()).toBe(false)
      expect(buttonByText(/hinzufügen/).textContent).toContain('00042-A')
    })
  })

  describe('sign-in field', () => {
    it('replaces the number pad while no user is stored and shows the name right after', async () => {
      useTimberItemStore().currentUser = null
      const { wrapper } = await mountAt('/')
      expect(wrapper.text()).toContain('Einladungscode')
      expect(wrapper.text()).not.toContain('Alexander')

      await wrapper.find('input#invite-code').setValue('k7qm4xht9rdp')
      expect((wrapper.find('input#invite-code').element as HTMLInputElement).value).toBe(
        'K7QM-4XHT-9RDP',
      )
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      expect(wrapper.find('input#invite-code').exists()).toBe(false)
      expect(wrapper.text()).toContain('Alexander')
    })

    it('sends nothing when no code is recognised', async () => {
      useTimberItemStore().currentUser = null
      const redeem = vi.spyOn(api, 'redeemInvite')
      const { wrapper } = await mountAt('/')
      await wrapper.find('input#invite-code').setValue('Hallo Jana!')
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      expect(wrapper.text()).toContain('Kein Einladungscode erkannt')
      expect(redeem).not.toHaveBeenCalled()
      vi.restoreAllMocks()
    })

    it('asks a browser to install the app first, with the form only for the fake API', async () => {
      useTimberItemStore().currentUser = null
      const { wrapper } = await mountAt('/')
      expect(wrapper.find('[role="note"]').text()).toContain('Bitte zuerst die App installieren')
      expect(wrapper.find('input#invite-code').exists()).toBe(true)
    })

    it('shows no sign-in form in a production browser', async () => {
      useTimberItemStore().currentUser = null
      vi.stubEnv('DEV', false)
      vi.stubEnv('VITE_API', '')
      const { wrapper } = await mountAt('/')
      expect(wrapper.find('[role="note"]').text()).toContain('Bitte zuerst die App installieren')
      expect(wrapper.find('input#invite-code').exists()).toBe(false)
      vi.unstubAllEnvs()
    })

    it('shows the iPhone install steps in an iPhone browser', async () => {
      useTimberItemStore().currentUser = null
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone)')
      const { wrapper } = await mountAt('/')
      expect(wrapper.find('[role="note"]').text()).toContain('„Zum Home-Bildschirm“')
      vi.restoreAllMocks()
    })

    it('shows no install hint in the installed app', async () => {
      useTimberItemStore().currentUser = null
      vi.stubGlobal('matchMedia', () => ({ matches: true }))
      const { wrapper } = await mountAt('/')
      expect(wrapper.find('[role="note"]').exists()).toBe(false)
      expect(wrapper.find('input#invite-code').exists()).toBe(true)
      vi.unstubAllGlobals()
    })

    it('reports an invalid or revoked invite', async () => {
      useTimberItemStore().currentUser = null
      vi.spyOn(api, 'redeemInvite').mockRejectedValue(new ApiError(401, 'revoked'))
      const { wrapper } = await mountAt('/')
      await wrapper.find('input#invite-code').setValue('K7QM-4XHT-9RDP')
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      expect(wrapper.text()).toContain(
        'Einladung ungültig oder widerrufen – bitte bei V29 nachfragen.',
      )
      vi.restoreAllMocks()
    })
  })

  describe('sync page', () => {
    afterEach(() => vi.restoreAllMocks())

    it('lists rejected duplicate captures on the result and drops them from the queue', async () => {
      useTimberItemStore().createTimberItem(1555)
      rejectAll()
      const { wrapper } = await mountAt('/sync')
      await wrapper.find('button.bg-ink.text-lg').trigger('click')
      await flushPromises()

      expect(wrapper.find('[role="alert"]').text()).toBe(DUPLICATE_HINT)
      expect(useTimberItemStore().events).toEqual([])
    })

    it('opens the result after a sign-in whose sync rejected something', async () => {
      const store = useTimberItemStore()
      store.currentUser = null
      store.createTimberItem(1555)
      const sync = rejectAll()
      const { wrapper, router } = await mountAt('/')
      await wrapper.find('input#invite-code').setValue('K7QM-4XHT-9RDP')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(sync).toHaveBeenCalled()
      expect(router.currentRoute.value.name).toBe('sync')
      expect(wrapper.find('[role="alert"]').text()).toBe(DUPLICATE_HINT)
    })

    it('lists pending entries and stays on the result after a sync', async () => {
      const store = useTimberItemStore()
      const stem = store.createTimberItem(321)
      store.recordAttribute(stem.id, store.attributes.find((a) => a.name === 'Holzart')!.id, 'x')
      const { wrapper, router } = await mountAt('/sync')
      expect(wrapper.text()).toContain('Synchronisierung (2)')
      expect(wrapper.text()).toContain('Stamm angelegt')
      expect(wrapper.text()).toContain('noch nie')

      await wrapper.find('button.bg-ink.text-lg').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('sync')
      expect(wrapper.text()).toContain('2 Einträge übertragen')
      expect(wrapper.text()).not.toContain('noch nie')
    })

    it('shows a rejected batch and keeps it', async () => {
      const store = useTimberItemStore()
      store.createTimberItem(321)
      vi.spyOn(api, 'sync').mockRejectedValue(new ApiError(400, 'events[0]: broken'))
      const { wrapper } = await mountAt('/sync')

      await wrapper.find('button.bg-ink.text-lg').trigger('click')
      await flushPromises()
      expect(wrapper.find('[role="alert"]').text()).toContain('abgelehnt (events[0]: broken)')
      expect(wrapper.text()).toContain('Stamm angelegt')
      expect(store.pendingCount).toBe(1)
    })
  })
})
