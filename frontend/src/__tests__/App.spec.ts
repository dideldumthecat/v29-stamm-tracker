import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { Blob as NodeBlob } from 'node:buffer'
import App from '../App.vue'
import { routes } from '../router'
import { useTimberItemStore } from '@/stores/timberItems'
import { useToast } from '@/composables/useToast'
import { api, ApiError } from '@/api/client'
import { applyUpdate, checkForUpdateNow } from '@/composables/useUpdateCheck'

const needRefresh = ref(false)
const updateServiceWorker = vi.fn()
vi.mock('virtual:pwa-register/vue', () => ({
  useRegisterSW: () => ({ needRefresh, updateServiceWorker }),
}))

vi.mock('@/composables/useUpdateCheck', () => ({
  startUpdateCheck: vi.fn(),
  applyUpdate: vi.fn(),
  checkForUpdateNow: vi.fn(),
}))

// jsdom cannot decode images: the photos pass through as they are (the compression has its own tests).
vi.mock('@/utils/photo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/photo')>()),
  attachPhotos: async (files: Blob[], add: (photo: Blob) => void) => {
    files.forEach(add)
    return { skipped: 0 }
  },
}))
URL.createObjectURL = () => 'blob:preview'
URL.revokeObjectURL = () => {}

const mounted: { unmount: () => void }[] = []

// Memory history: no browser URL needed in the test environment.
// The leave dialog: title, intro line and the listed parts (text of the elements, blanks collapsed).
function leaveDialog() {
  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim()
  const dialog = document.body.querySelector('[role="dialog"]')
  return {
    title: text(dialog?.querySelector('h2')),
    intro: text(dialog?.querySelector('p')),
    items: [...(dialog?.querySelectorAll('li') ?? [])].map(text),
  }
}

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

  it('credits the author with a link in the help page footer', async () => {
    const { wrapper } = await mountAt('/help')
    const link = wrapper.find('a[href="https://alexandersumma.de"]')
    expect(link.text()).toBe('Alexander Summa')
    expect(link.attributes('target')).toBe('_blank')
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
    expect(leaveDialog()).toEqual({
      title: 'Änderungen verwerfen?',
      intro: 'Noch nicht gespeichert für Stamm 00042:',
      items: ['1 Änderung'],
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
      await wrapper.find('select').setValue(wrapper.findAll('option')[1]!.element.value)

      await closeButton(wrapper).trigger('click')
      await flushPromises()
      expect(leaveDialog().items).toEqual(['1 Foto', '1 Änderung'])
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
      expect(store.pendingPhotosOf(store.findByTagNumber(456)!.id)).toHaveLength(1)
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
        await flushPromises()
        expect(applyUpdate).toHaveBeenCalledWith(updateServiceWorker)
        const button = hint()!.querySelector('button') as HTMLButtonElement
        expect(button.disabled).toBe(true)
        expect(button.textContent).toContain('Wird aktualisiert')
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

        vi.advanceTimersByTime(3000)
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
    expect(leaveDialog().items).toEqual(['1 Änderung'])
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

  describe('beams', () => {
    const buttonByText = (text: RegExp) =>
      [...document.body.querySelectorAll('button')].find((button) =>
        text.test(button.textContent ?? ''),
      )!

    const rowOf = (tag: string) =>
      [...document.body.querySelectorAll('[class*="border-b"]')].find((row) =>
        row.querySelector(`button[aria-label="Balken ${tag} entfernen"]`),
      )!

    it('adds a beam to the draft of the stem: listed right away, nothing is saved', async () => {
      const { wrapper, router } = await mountAt('/timber-item/42')
      buttonByText(/Balken 00042-A hinzufügen/).click()
      await flushPromises()
      expect(router.currentRoute.value.params.tagNumber).toBe('42')
      expect(document.body.querySelector(':scope > [role="status"]')).toBeNull()
      expect(wrapper.text()).toContain('00042-A')
      expect(wrapper.text()).toContain('nicht gespeichert')
      expect(useTimberItemStore().events).toEqual([])
      expect(useTimberItemStore().findByTag('42')).toBeUndefined()
      // The save button says that the stem stays open.
      expect(buttonByText(/Stamm anlegen/).textContent?.trim()).toBe('Stamm anlegen')
    })

    it('creates the stem with its draft beams on save and stays on the stem', async () => {
      const { router } = await mountAt('/timber-item/42')
      buttonByText(/Balken 00042-A hinzufügen/).click()
      await flushPromises()
      buttonByText(/Balken 00042-B hinzufügen/).click()
      await flushPromises()
      buttonByText(/^\s*Stamm anlegen\s*$/).click()
      await flushPromises()

      const store = useTimberItemStore()
      expect(store.childrenOf(store.findByTag('42')!.id).map((beam) => beam.tag_number)).toEqual([
        '42-A',
        '42-B',
      ])
      expect(router.currentRoute.value.params.tagNumber).toBe('42')
      expect(document.body.textContent).toContain('Stamm 00042 gespeichert')
      // Split now: read-only, the bar leads back to the start screen.
      expect(buttonByText(/Stamm anlegen/)).toBeUndefined()
      buttonByText(/^\s*Zurück zum Start\s*$/).click()
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('start')
    })

    it('still returns to the start screen after recording a stem without beams', async () => {
      const { router } = await mountAt('/timber-item/42')
      buttonByText(/Stamm anlegen & schließen/).click()
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('start')
    })

    it('keeps the save label on a beam', async () => {
      await mountAt('/timber-item/789-A')
      expect(buttonByText(/Speichern & schließen/)).toBeDefined()
      expect(buttonByText(/Zurück zum Start/)).toBeUndefined()
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
      expect(wrapper.text()).not.toContain('kann nur die Administration entfernen')
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

    it('saves new beams on a split stem: "Speichern" instead of "Zurück zum Start", the stem stays locked', async () => {
      const { wrapper, router } = await mountAt('/timber-item/789')
      expect(buttonByText(/Zurück zum Start/)).toBeDefined()
      buttonByText(/00789-C hinzufügen/).click()
      await flushPromises()
      expect(buttonByText(/Zurück zum Start/)).toBeUndefined()
      expect(buttonByText(/^\s*Speichern\s*$/)).toBeDefined()
      expect(useTimberItemStore().events).toEqual([])

      buttonByText(/^\s*Speichern\s*$/).click()
      await flushPromises()
      const store = useTimberItemStore()
      expect(store.events.map((event) => [event.type, event.data])).toEqual([
        ['created', { parent_id: store.findByTag('789')!.id }],
        ['tag_assigned', { tag_number: '789-C' }],
      ])
      expect(router.currentRoute.value.params.tagNumber).toBe('789')
      expect(document.body.textContent).toContain('Stamm 00789 gespeichert')
      expect(wrapper.findAll('select, textarea, input')).toHaveLength(0)
      // Saved now: no draft left, the bar leads back to the start screen again, and removing asks.
      expect(buttonByText(/Zurück zum Start/)).toBeDefined()
      expect(wrapper.text()).toContain('nicht synchronisiert')
      await wrapper.find('button[aria-label="Balken 789-C entfernen"]').trigger('click')
      expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
    })

    it('protects draft beams on a split stem when leaving, and names them when discarding', async () => {
      const { wrapper, router } = await mountAt('/timber-item/789')
      buttonByText(/00789-C hinzufügen/).click()
      await flushPromises()
      await wrapper.find('button[aria-label="Schließen"]').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.params.tagNumber).toBe('789')
      expect(leaveDialog()).toEqual({
        title: 'Änderungen verwerfen?',
        intro: 'Noch nicht gespeichert für Stamm 00789:',
        items: ['Balken 00789-C'],
      })

      buttonByText(/^Verwerfen$/).click()
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('start')
      expect(useTimberItemStore().events).toEqual([])
    })

    it('records the stem values and the new beams in one save; the beams inherit the values', async () => {
      const { wrapper, router } = await mountAt('/timber-item/42')
      await wrapper.find('select').setValue(optionLabel('Holzart', 'Stieleiche'))
      buttonByText(/00042-A hinzufügen/).click()
      await flushPromises()
      expect(useTimberItemStore().events).toEqual([])

      buttonByText(/^\s*Stamm anlegen\s*$/).click()
      await flushPromises()
      const store = useTimberItemStore()
      expect(store.events.map((event) => event.type)).toEqual([
        'created',
        'tag_assigned',
        'attribute_recorded',
        'created',
        'tag_assigned',
      ])
      const holzart = store.attributes.find((attribute) => attribute.name === 'Holzart')!.id
      expect(store.findByTag('42-A')!.values[holzart]).toEqual(
        store.findByTag('42')!.values[holzart],
      )
      expect(router.currentRoute.value.params.tagNumber).toBe('42')
    })

    it('adds a beam while the input is invalid, but saving is blocked until it is fixed', async () => {
      const { wrapper } = await mountAt('/timber-item/42')
      await wrapper.find('input[inputmode="decimal"]').setValue('abc')
      buttonByText(/00042-A hinzufügen/).click()
      await flushPromises()
      expect(wrapper.text()).toContain('nicht gespeichert')
      buttonByText(/^\s*Stamm anlegen\s*$/).click()
      await flushPromises()
      expect(wrapper.find('[role="alert"]').exists()).toBe(true)
      expect(useTimberItemStore().findByTag('42')).toBeUndefined()
      expect(useTimberItemStore().findByTag('42-A')).toBeUndefined()
    })

    it('removes a draft beam without asking; letters never change, the free one is handed out next', async () => {
      const { wrapper } = await mountAt('/timber-item/42')
      for (const letter of ['A', 'B', 'C']) {
        buttonByText(new RegExp(`Balken 00042-${letter} hinzufügen`)).click()
        await flushPromises()
      }
      await wrapper.find('button[aria-label="Balken 42-A entfernen"]').trigger('click')
      expect(document.body.querySelector('[role="dialog"]')).toBeNull()
      expect(rowOf('42-A')).toBeUndefined()
      expect(rowOf('42-B')).toBeDefined()
      expect(rowOf('42-C')).toBeDefined()
      expect(buttonByText(/hinzufügen/).textContent).toContain('00042-A')
      expect(useTimberItemStore().events).toEqual([])
    })

    it('lists beams, photo and changes of a stem draft in that order', async () => {
      const { wrapper } = await mountAt('/timber-item/42')
      await wrapper.find('select').setValue(optionLabel('Holzart', 'Stieleiche'))
      buttonByText(/00042-A hinzufügen/).click()
      await flushPromises()
      const input = wrapper.find('input[accept="image/*"][multiple]')
      Object.defineProperty(input.element, 'files', {
        value: [new NodeBlob(['x']) as unknown as Blob],
        configurable: true,
      })
      await input.trigger('change')
      await flushPromises()
      await wrapper.find('button[aria-label="Schließen"]').trigger('click')
      await flushPromises()
      expect(leaveDialog().items).toEqual(['Balken 00042-A', '1 Foto', '1 Änderung'])
    })

    it('names the beam, not the stem, in the leave dialog of a beam', async () => {
      const { wrapper } = await mountAt('/timber-item/789-A')
      await wrapper.find('textarea').setValue('Riss')
      await wrapper.find('button[aria-label="Schließen"]').trigger('click')
      await flushPromises()
      expect(leaveDialog()).toEqual({
        title: 'Änderungen verwerfen?',
        intro: 'Noch nicht gespeichert für Balken 00789-A:',
        items: ['1 Änderung'],
      })
    })

    it('names the beams when the stem draft is discarded, and drops them', async () => {
      const { wrapper, router } = await mountAt('/timber-item/42')
      await wrapper.find('select').setValue(optionLabel('Holzart', 'Stieleiche'))
      buttonByText(/00042-A hinzufügen/).click()
      await flushPromises()
      buttonByText(/00042-B hinzufügen/).click()
      await flushPromises()
      await wrapper.find('button[aria-label="Schließen"]').trigger('click')
      await flushPromises()
      expect(leaveDialog().items).toEqual(['Balken 00042-A, 00042-B', '1 Änderung'])

      buttonByText(/^Verwerfen$/).click()
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('start')
      expect(useTimberItemStore().events).toEqual([])
    })

    it('asks "Speichern & öffnen" when a draft beam is tapped, without a discard option', async () => {
      const { wrapper, router } = await mountAt('/timber-item/42')
      buttonByText(/00042-A hinzufügen/).click()
      await flushPromises()
      await wrapper.find('button.flex-1.items-center').trigger('click')
      await flushPromises()
      const dialog = document.body.querySelector('[role="dialog"]')!
      expect(dialog.textContent).toContain('Speichern & öffnen')
      expect(dialog.textContent).toContain('Abbrechen')
      expect(dialog.textContent).not.toContain('Verwerfen')

      buttonByText(/^Abbrechen$/).click()
      await flushPromises()
      expect(document.body.querySelector('[role="dialog"]')).toBeNull()
      expect(router.currentRoute.value.params.tagNumber).toBe('42')
      expect(useTimberItemStore().events).toEqual([])

      await wrapper.find('button.flex-1.items-center').trigger('click')
      buttonByText(/Speichern & öffnen/).click()
      await flushPromises()
      expect(router.currentRoute.value.params.tagNumber).toBe('42-A')
      expect(useTimberItemStore().findByTag('42-A')).toBeDefined()
      expect(document.body.textContent).not.toContain('verwerfen?')
    })

    it('asks before opening a saved beam while its stem has a draft, and opens it right away otherwise', async () => {
      const { wrapper, router } = await mountAt('/timber-item/789')
      await wrapper.find('a[href="/timber-item/789-A"]').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.params.tagNumber).toBe('789-A')

      await router.push('/timber-item/789')
      await flushPromises()
      buttonByText(/00789-C hinzufügen/).click()
      await flushPromises()
      await wrapper.find('a[href="/timber-item/789-A"]').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.params.tagNumber).toBe('789')
      expect(document.body.textContent).toContain('Speichern & öffnen')

      buttonByText(/Speichern & öffnen/).click()
      await flushPromises()
      expect(router.currentRoute.value.params.tagNumber).toBe('789-A')
      expect(useTimberItemStore().findByTag('789-C')).toBeDefined()
    })

    it('removes a synced beam after confirming: it leaves the list, its letter is free', async () => {
      const { wrapper } = await mountAt('/timber-item/789')
      await wrapper.find('button[aria-label="Balken 789-B entfernen"]').trigger('click')
      expect(document.body.querySelector('[role="dialog"]')!.textContent).toContain(
        'auch auf dem Server entfernt',
      )
      buttonByText(/^Balken entfernen$/).click()
      await flushPromises()

      const store = useTimberItemStore()
      expect(store.events.map((event) => event.type)).toEqual(['voided'])
      expect(wrapper.find('a[href="/timber-item/789-B"]').exists()).toBe(false)
      expect(buttonByText(/hinzufügen/).textContent).toContain('00789-B')
    })

    it('offers to remove a synced beam on its own screen too', async () => {
      const { wrapper, router } = await mountAt('/timber-item/789-A')
      const button = [...wrapper.findAll('button')].find((candidate) =>
        /^\s*Balken entfernen\s*$/.test(candidate.text()),
      )!
      await button.trigger('click')
      buttonByText(/^Balken entfernen$/).click()
      await flushPromises()
      expect(router.currentRoute.value.params.tagNumber).toBe('789')
      expect(useTimberItemStore().findByTag('789-A')).toBeUndefined()
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

    it('clears the code and the error with the clear button, shown only while there is a code', async () => {
      useTimberItemStore().currentUser = null
      const { wrapper } = await mountAt('/')
      const clearButton = () => wrapper.find('button[aria-label="Code löschen"]')
      expect(clearButton().exists()).toBe(false)

      await wrapper.find('input#invite-code').setValue('Hallo Jana!')
      await wrapper.find('form').trigger('submit')
      expect(wrapper.find('[role="alert"]').exists()).toBe(true)
      expect(clearButton().attributes('type')).toBe('button')

      await clearButton().trigger('click')
      expect((wrapper.find('input#invite-code').element as HTMLInputElement).value).toBe('')
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      expect(clearButton().exists()).toBe(false)
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
    beforeEach(() => vi.mocked(checkForUpdateNow).mockClear())
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

    it('lists the removal of a synced beam as a row that can be discarded; the beam is back afterwards', async () => {
      const store = useTimberItemStore()
      store.removeTimberItem(store.findByTag('789-B')!.id)
      const { wrapper } = await mountAt('/sync')
      expect(wrapper.text()).toContain('Balken 00789-B entfernen')
      expect(wrapper.find('h1').text()).toBe('Synchronisierung (1)')

      await wrapper.find('button[aria-label="Eintrag verwerfen"]').trigger('click')
      expect(document.body.querySelector('[role="dialog"]')!.textContent).toContain(
        'Entfernen von Balken 00789-B verwerfen?',
      )
      ;[...document.body.querySelectorAll('button')]
        .find((button) => button.textContent === 'Verwerfen')!
        .click()
      await flushPromises()

      expect(store.events).toEqual([])
      expect(store.findByTag('789-B')).toBeDefined()
      expect(wrapper.text()).not.toContain('entfernen')
    })

    it('stops through the main button: secondary style while syncing, disabled until it has stopped, then a toast and the entries stay', async () => {
      useTimberItemStore().createTimberItem(1555)
      let stop!: () => void
      vi.spyOn(api, 'sync').mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            stop = () => reject(new ApiError(0, 'aborted'))
          }),
      )
      const { wrapper } = await mountAt('/sync')
      const main = () => wrapper.find('button.h-\\[88px\\]')
      expect(main().classes()).toContain('bg-ink')
      await main().trigger('click')
      expect(main().attributes('aria-label')).toBe('Synchronisierung anhalten')
      expect(main().text()).toBe('Anhalten')
      expect(main().classes()).not.toContain('bg-ink')
      expect(main().classes()).toContain('bg-paper')
      expect(wrapper.find('[role="progressbar"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('Daten werden übertragen …')

      await main().trigger('click')
      expect(main().text()).toBe('Wird angehalten …')
      expect(main().attributes('disabled')).toBeDefined()
      expect(main().find('svg').exists()).toBe(false)

      stop()
      await flushPromises()
      expect(main().text()).toContain('Jetzt synchronisieren')
      expect(main().classes()).toContain('bg-ink')
      expect(main().attributes('disabled')).toBeUndefined()
      expect(useToast().current.value).toMatchObject({
        before: 'Angehalten. Deine 1 Eintrag bleibt auf diesem Gerät.',
        kind: 'warning',
      })
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
      expect(wrapper.text()).toContain('01555')
    })

    it('uploads no further photo after stopping in the photo phase; the next sync sends the rest and closes the toast', async () => {
      const store = useTimberItemStore()
      const stem = store.createTimberItem(1555)
      const photoAttribute = store.attributes.find((attribute) => attribute.type === 'photo')!.id
      for (let count = 0; count < 3; count++) {
        store.addPhoto(
          stem.id,
          photoAttribute,
          new NodeBlob(['x'], { type: 'image/jpeg' }) as unknown as Blob,
        )
      }
      vi.spyOn(api, 'sync').mockImplementation(async (events) => ({
        accepted_event_ids: events.map((event) => event.id),
        rejected: [],
      }))
      const upload = vi
        .spyOn(api, 'uploadPhoto')
        .mockImplementationOnce((_photo, signal) => {
          return new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new ApiError(0, 'aborted')))
          })
        })
        .mockResolvedValue()
      const { wrapper } = await mountAt('/sync')
      const main = () => wrapper.find('button.h-\\[88px\\]')

      await main().trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('Foto 1 von 3')
      await main().trigger('click')
      await flushPromises()
      expect(upload).toHaveBeenCalledTimes(1)
      expect(useTimberItemStore().photos).toHaveLength(3)
      expect(useToast().current.value?.before).toBe('Angehalten. 3 Fotos bleiben auf diesem Gerät.')

      await main().trigger('click')
      expect(useToast().current.value).toBeNull()
      await flushPromises()
      expect(upload).toHaveBeenCalledTimes(4)
      expect(useTimberItemStore().photos).toHaveLength(0)
    })

    it('stops a sync that was started on an earlier visit of the page: no further photo goes up', async () => {
      const store = useTimberItemStore()
      const stem = store.createTimberItem(1555)
      const photoAttribute = store.attributes.find((attribute) => attribute.type === 'photo')!.id
      for (let count = 0; count < 2; count++) {
        store.addPhoto(
          stem.id,
          photoAttribute,
          new NodeBlob(['x'], { type: 'image/jpeg' }) as unknown as Blob,
        )
      }
      vi.spyOn(api, 'sync').mockImplementation(async (events) => ({
        accepted_event_ids: events.map((event) => event.id),
        rejected: [],
      }))
      const upload = vi.spyOn(api, 'uploadPhoto').mockImplementation(
        (_photo, signal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new ApiError(0, 'aborted')))
          }),
      )
      const { wrapper, router } = await mountAt('/sync')
      const main = () => wrapper.find('button.h-\\[88px\\]')
      await main().trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('Foto 1 von 2')

      await router.push('/')
      await router.push('/sync')
      await flushPromises()
      expect(main().text()).toBe('Anhalten')
      expect(wrapper.text()).toContain('Foto 1 von 2')

      await main().trigger('click')
      await flushPromises()
      expect(upload).toHaveBeenCalledTimes(1)
      expect(main().text()).toContain('Jetzt synchronisieren')
      expect(useTimberItemStore().photos).toHaveLength(2)
      expect(useToast().current.value?.before).toBe('Angehalten. 2 Fotos bleiben auf diesem Gerät.')
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
      expect(checkForUpdateNow).toHaveBeenCalledTimes(1)
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
      expect(checkForUpdateNow).not.toHaveBeenCalled()
    })
  })
})
