import { describe, it, expect, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { Blob as NodeBlob } from 'node:buffer'
import { useTimberItemStore } from '@/stores/timberItems'
import { useToast } from '@/composables/useToast'
import { api } from '@/api/client'
import {
  buttonByText,
  leaveDialog,
  mountAt,
  optionLabel,
  setupApp,
  splitIntoBeams,
} from './appSetup'

vi.mock('virtual:pwa-register/vue', () => import('./appMocks').then((mocks) => mocks.pwaRegister))
vi.mock('@/composables/useUpdateCheck', () =>
  import('./appMocks').then((mocks) => mocks.updateCheck),
)
vi.mock('@/utils/photo', async (importOriginal) =>
  (await import('./appMocks')).photoUtils(await importOriginal()),
)

describe('App', () => {
  setupApp()

  describe('leave dialog lines', () => {
    const closeAndRead = async (wrapper: Awaited<ReturnType<typeof mountAt>>['wrapper']) => {
      await wrapper.find('button[aria-label="Schließen"]').trigger('click')
      await flushPromises()
      return leaveDialog().items
    }

    it('words choice, number and yes/no values like the sync screen, in the order of the form', async () => {
      const { wrapper } = await mountAt('/timber-item/456')
      // Typed first, but its attribute comes after Holzart and Gesägt in the form.
      await wrapper.find('input[inputmode="decimal"]').setValue('41,5')
      await wrapper.find('button[aria-pressed]').trigger('click')
      buttonByText(/Nein, nicht aufgeteilt/).click()
      await flushPromises()
      await wrapper.find('select').setValue(optionLabel('Holzart', 'Stieleiche'))
      expect(await closeAndRead(wrapper)).toEqual([
        'Holzart: Stieleiche',
        'Gesägt',
        'Holzfeuchte: 41,5 %',
      ])
    })

    it('words a recorded value turned to "no" as "Gesägt: Nein"', async () => {
      const { wrapper } = await mountAt('/timber-item/456')
      const store = useTimberItemStore()
      const gesaegt = store.attributes.find((attribute) => attribute.name === 'Gesägt')!
      store.recordAttribute(store.findByTagNumber(456)!.id, gesaegt.id, true)
      await flushPromises()
      await wrapper.find('button[aria-label="Gesägt ändern"]').trigger('click')
      await wrapper.find('button[aria-pressed]').trigger('click')
      expect(await closeAndRead(wrapper)).toEqual(['Gesägt: Nein'])
    })
  })

  describe('photos in the draft', () => {
    const pick = async (wrapper: Awaited<ReturnType<typeof mountAt>>['wrapper'], count = 1) => {
      // Node's Blob: the one the fake IndexedDB can store.
      const files = Array.from({ length: count }, () => new NodeBlob(['x']) as unknown as Blob)
      const input = wrapper.find('input[accept="image/*"][multiple]')
      Object.defineProperty(input.element, 'files', { value: files, configurable: true })
      await input.trigger('change')
      await flushPromises()
    }
    const previews = (wrapper: Awaited<ReturnType<typeof mountAt>>['wrapper']) =>
      wrapper.findAll('img[alt="Foto, noch nicht hochgeladen"]')
    const closeButton = (wrapper: Awaited<ReturnType<typeof mountAt>>['wrapper']) =>
      wrapper.find('button[aria-label="Schließen"]')

    it('keeps the photos of a locked stem visible, without buttons and without a hint', async () => {
      const { wrapper } = await mountAt('/timber-item/42')
      await pick(wrapper)
      await splitIntoBeams()
      expect(wrapper.text()).toContain('Aufgeteilter Stamm')
      expect(previews(wrapper)).toHaveLength(1)
      expect(wrapper.text()).not.toContain('Foto aufnehmen')
      expect(wrapper.text()).not.toContain('Fotos am jeweiligen Balken')
    })
    const saveButton = (wrapper: Awaited<ReturnType<typeof mountAt>>['wrapper']) =>
      wrapper.find('button.bg-ink.text-lg')
    const sheetButton = (name: string) =>
      [...document.querySelectorAll('[role="dialog"] button')].find(
        (button) => button.textContent?.trim() === name,
      ) as HTMLButtonElement

    it('creates nothing for a photo on an unknown stem that is discarded', async () => {
      const { wrapper, router } = await mountAt('/timber-item/1444')
      await pick(wrapper)
      expect(previews(wrapper)).toHaveLength(1)
      expect(useTimberItemStore().events).toEqual([])

      await closeButton(wrapper).trigger('click')
      await flushPromises()
      expect(leaveDialog().items).toEqual(['1 Foto'])
      sheetButton('Verwerfen').click()
      await flushPromises()

      const store = useTimberItemStore()
      expect(router.currentRoute.value.name).toBe('start')
      expect([store.events, store.photos, store.pendingCount]).toEqual([[], [], 0])
    })

    it('creates the stem and queues the photo when the draft is saved', async () => {
      const { wrapper } = await mountAt('/timber-item/1444')
      expect(saveButton(wrapper).attributes('disabled')).toBeUndefined()
      await pick(wrapper)
      await saveButton(wrapper).trigger('click')
      await flushPromises()

      const store = useTimberItemStore()
      expect(store.findByTagNumber(1444)).toBeDefined()
      expect(store.photos).toHaveLength(1)
      expect(store.events.map((event) => event.type)).toEqual([
        'created',
        'tag_assigned',
        'attribute_recorded',
      ])
      expect(store.pendingCount).toBe(2)
    })

    it('asks before leaving a stem with a photo; "Weiter bearbeiten" keeps it, "Verwerfen" drops it', async () => {
      const { wrapper } = await mountAt('/timber-item/123')
      const photosBefore = useTimberItemStore().photos.length
      await pick(wrapper)
      await wrapper.find('input[type="month"]').setValue('2026-10')

      await closeButton(wrapper).trigger('click')
      await flushPromises()
      expect(leaveDialog().items).toEqual(['Fälldatum: 10/2026', '1 Foto'])
      sheetButton('Weiter bearbeiten').click()
      await flushPromises()
      expect(previews(wrapper)).toHaveLength(1)

      await closeButton(wrapper).trigger('click')
      await flushPromises()
      sheetButton('Verwerfen').click()
      await flushPromises()
      expect(useTimberItemStore().photos).toHaveLength(photosBefore)
      expect(useTimberItemStore().events).toEqual([])
    })

    it('saves a photo together with a field change, and the photo is still there on reopening', async () => {
      const { wrapper } = await mountAt('/timber-item/456')
      await pick(wrapper)
      await wrapper.find('select').setValue(wrapper.findAll('option')[1]!.element.value)
      await saveButton(wrapper).trigger('click')
      await flushPromises()

      const store = useTimberItemStore()
      expect(store.events.map((event) => event.type)).toEqual([
        'attribute_recorded',
        'attribute_recorded',
      ])
      expect(
        store.pendingPhotosOf(
          store.findByTagNumber(456)!.id,
          store.attributes.find((attribute) => attribute.type === 'photo')!.id,
        ),
      ).toHaveLength(1)
      const reopened = await mountAt('/timber-item/456')
      expect(previews(reopened.wrapper)).toHaveLength(1)
    })

    it('holds three gallery photos in the draft until saving, and a draft photo can be removed', async () => {
      const { wrapper } = await mountAt('/timber-item/123')
      await pick(wrapper, 3)
      expect(previews(wrapper)).toHaveLength(3)
      expect(useTimberItemStore().photos).toEqual([])

      await wrapper.find('button[aria-label="Foto entfernen"]').trigger('click')
      sheetButton('Foto entfernen').click()
      await flushPromises()
      expect(previews(wrapper)).toHaveLength(2)

      await saveButton(wrapper).trigger('click')
      await flushPromises()
      expect(useTimberItemStore().photos).toHaveLength(2)
    })
  })

  it('keeps an unsaved entry when the data is refreshed in the background', async () => {
    const { wrapper } = await mountAt('/timber-item/42')
    const value = wrapper.findAll('option')[1]!.element.value
    await wrapper.find('select').setValue(value)

    const fresh = api.initialSnapshot()
    fresh.generated_at = '2026-10-28T10:00:00.000Z'
    vi.spyOn(api, 'loadSnapshot').mockResolvedValue(fresh)
    await useTimberItemStore().refresh()
    await flushPromises()

    expect(useTimberItemStore().snapshot.generated_at).toBe('2026-10-28T10:00:00.000Z')
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe(value)
    vi.restoreAllMocks()
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

      // Slide-in (200 ms) does not count towards the 3 s.
      vi.advanceTimersByTime(3000)
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
      vi.advanceTimersByTime(2999)
      await flushPromises()
      expect(status()).not.toBeNull()
      vi.advanceTimersByTime(1)
      await flushPromises()
      expect(toast.current.value).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a warning toast for 8 s', async () => {
    vi.useFakeTimers()
    try {
      await mountAt('/')
      const toast = useToast()
      toast.show({ before: 'Achtung', kind: 'warning' })
      vi.advanceTimersByTime(7999)
      expect(toast.current.value).not.toBeNull()
      vi.advanceTimersByTime(201)
      expect(toast.current.value).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  describe('open draft', () => {
    const isDraftOpen = () => useTimberItemStore().isDraftOpen

    it('is open with unsaved input and closed again by saving', async () => {
      const { wrapper } = await mountAt('/timber-item/456')
      expect(isDraftOpen()).toBe(false)
      await wrapper.find('input[type="date"]').setValue('2026-09-08')
      expect(isDraftOpen()).toBe(true)
      await wrapper.find('button.bg-ink.text-lg').trigger('click')
      await flushPromises()
      expect(isDraftOpen()).toBe(false)
    })

    it('is closed when the screen is left after discarding', async () => {
      const { wrapper, router } = await mountAt('/timber-item/456')
      await wrapper.find('input[type="date"]').setValue('2026-09-08')
      await router.push('/')
      await flushPromises()
      ;[...document.body.querySelectorAll('[role="dialog"] button')]
        .find((button) => button.textContent?.includes('Verwerfen'))!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('start')
      expect(isDraftOpen()).toBe(false)
    })

    it('stays open while the system camera is open, until it answers', async () => {
      const { wrapper } = await mountAt('/timber-item/456')
      const camera = wrapper.find('input[capture]')
      const click = vi
        .spyOn(camera.element as HTMLInputElement, 'click')
        .mockImplementation(() => {})
      await wrapper
        .findAll('button')
        .find((button) => button.text().includes('Foto aufnehmen'))!
        .trigger('click')
      expect(click).toHaveBeenCalled()
      expect(isDraftOpen()).toBe(true)
      await camera.trigger('cancel')
      expect(isDraftOpen()).toBe(false)
    })
  })

  it('records a ticked boolean attribute on save', async () => {
    const { wrapper } = await mountAt('/timber-item/456')
    await wrapper.find('button[aria-pressed]').trigger('click')
    buttonByText(/Nein, nicht aufgeteilt/).click()
    await flushPromises()
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
    expect(leaveDialog().items).toEqual(['Holzfeuchte: ungültige Eingabe'])
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

  it('hides a field while the attribute named in its hidden_when is ticked and drops its input', async () => {
    const store = useTimberItemStore()
    const sawn = store.attributes.find((attribute) => attribute.key === 'sawn')!
    sawn.hidden_when = ['unsawable']
    store.attributes.push({
      ...sawn,
      id: crypto.randomUUID(),
      key: 'unsawable',
      name: 'Nicht sägbar',
      sort_order: sawn.sort_order - 1,
      hidden_when: ['sawn'],
    })
    const { wrapper } = await mountAt('/timber-item/456')
    const toggle = (name: string) =>
      wrapper.findAll('button[aria-pressed]').find((button) => button.text().includes(name))
    expect([toggle('Nicht sägbar'), toggle('Gesägt')].every(Boolean)).toBe(true)

    await toggle('Nicht sägbar')!.trigger('click')
    expect(toggle('Gesägt')).toBeUndefined()
    // Without "Gesägt" there is no way to beams either.
    expect(buttonByText(/hinzufügen/)).toBeUndefined()
    await toggle('Nicht sägbar')!.trigger('click')
    expect(toggle('Gesägt')).toBeDefined()
    expect(buttonByText(/Balken A und B hinzufügen/)).toBeDefined()

    await toggle('Gesägt')!.trigger('click')
    buttonByText(/Nein, nicht aufgeteilt/).click()
    await flushPromises()
    expect(toggle('Nicht sägbar')).toBeUndefined()
    expect(toggle('Gesägt')!.attributes('aria-pressed')).toBe('true')

    // "Nicht sägbar" comes back above "Gesägt": the screen scrolls by what "Gesägt" moved, so it stays under the finger.
    const top = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValueOnce({ top: 300 } as DOMRect)
      .mockReturnValueOnce({ top: 380 } as DOMRect)
    await toggle('Gesägt')!.trigger('click')
    await flushPromises()
    expect(toggle('Nicht sägbar')).toBeDefined()
    expect(top.mock.contexts.map((element) => (element as Element).textContent)).toEqual([
      expect.stringContaining('Gesägt'),
      expect.stringContaining('Gesägt'),
    ])
    expect(wrapper.find('.overflow-y-auto').element.scrollTop).toBe(80)
    top.mockRestore()
    await toggle('Gesägt')!.trigger('click')
    buttonByText(/Nein, nicht aufgeteilt/).click()
    await flushPromises()

    await wrapper.find('button.bg-ink.text-lg').trigger('click')
    await flushPromises()
    const recorded = store.events.filter((event) => event.type === 'attribute_recorded')
    expect(recorded.map((event) => event.data)).toEqual([{ attribute_id: sawn.id, value: true }])
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
      // So are attributes for beams on a stem that is not sawn.
      .filter((attribute) => attribute.applies_to.includes('stem'))
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
    // Sawn as a whole: the stem is its own beam, so the beam attribute Sortierklasse appears.
    await wrapper.find('button[aria-pressed]').trigger('click')
    expect(wrapper.findAll('select')).toHaveLength(2)
    buttonByText(/Nein, nicht aufgeteilt/).click()
    await flushPromises()
    // First option after the placeholder of each select (Holzart, Lagerplatz, Sortierklasse).
    const selects = wrapper.findAll('select')
    expect(selects).toHaveLength(3)
    for (const select of selects) {
      await select.setValue(select.findAll('option')[1]!.element.value)
    }
    await wrapper.find('input[type="date"]').setValue('2026-09-08')
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
      deactivate('photo')
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
})
