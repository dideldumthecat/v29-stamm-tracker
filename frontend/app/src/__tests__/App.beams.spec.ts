import { describe, it, expect, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { Blob as NodeBlob } from 'node:buffer'
import { useTimberItemStore } from '@/stores/timberItems'
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

  describe('beams', () => {
    const rowOf = (tag: string) =>
      [...document.body.querySelectorAll('[class*="border-b"]')].find((row) =>
        row.querySelector(`button[aria-label="Balken ${tag} entfernen"]`),
      )!

    it('puts the beams A and B into the draft with "Mehrere Balken": listed right away, nothing is saved', async () => {
      const { wrapper, router } = await mountAt('/timber-item/42')
      await splitIntoBeams()
      expect(router.currentRoute.value.params.tagNumber).toBe('42')
      expect(document.body.querySelector(':scope > [role="status"]')).toBeNull()
      expect(wrapper.text()).toContain('00042-A')
      expect(wrapper.text()).toContain('00042-B')
      expect(wrapper.text()).toContain('nicht gespeichert')
      expect(useTimberItemStore().events).toEqual([])
      expect(useTimberItemStore().findByTag('42')).toBeUndefined()
      // The save button says that the stem stays open.
      expect(buttonByText(/Stamm anlegen/).textContent?.trim()).toBe('Stamm anlegen')
    })

    it('creates the stem with its draft beams on save and stays on the stem', async () => {
      const { router } = await mountAt('/timber-item/42')
      await splitIntoBeams()
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
      await splitIntoBeams()
      for (let count = 0; count < 23; count++) {
        buttonByText(/hinzufügen/).click()
        await flushPromises()
      }
      buttonByText(/Balken 00042-Z hinzufügen/).click()
      await flushPromises()
      expect(buttonByText(/Balken hinzufügen/).disabled).toBe(true)
      expect(document.body.textContent).toContain('Höchstens 26 Balken je Stamm')
    })

    it('keeps on a split stem only stem attributes and the notes open, without save bar', async () => {
      const { wrapper } = await mountAt('/timber-item/789')
      expect(wrapper.text()).toContain('Aufgeteilter Stamm')
      expect(wrapper.text()).not.toContain('Speichern')
      // Holzart is for stems only: recorded, so with pencil. Lieferdatum (also for beams) and "Gesägt" have none.
      expect(
        wrapper
          .findAll('button[aria-label$=" ändern"]')
          .map((button) => button.attributes('aria-label')),
      ).toEqual(['Holzart ändern'])
      // The empty stem attributes Fälldatum and Lagerplatz; Holzfeuchte (also for beams) is gone.
      expect(wrapper.findAll('select, input').length).toBe(2)
      expect(wrapper.findAll('textarea').length).toBe(1)
      // No photos, so no photo section either.
      expect(wrapper.text()).not.toContain('Fotos')
      expect(wrapper.text()).not.toContain('Foto aufnehmen')
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
      expect(wrapper.findAll('select, input')).toHaveLength(2)
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
      await splitIntoBeams()
      expect(useTimberItemStore().events).toEqual([])

      buttonByText(/^\s*Stamm anlegen\s*$/).click()
      await flushPromises()
      const store = useTimberItemStore()
      expect(store.events.map((event) => event.type)).toEqual([
        'created',
        'tag_assigned',
        'attribute_recorded',
        'attribute_recorded',
        'created',
        'tag_assigned',
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
      await splitIntoBeams()
      expect(wrapper.text()).toContain('nicht gespeichert')
      buttonByText(/^\s*Stamm anlegen\s*$/).click()
      await flushPromises()
      expect(wrapper.find('[role="alert"]').exists()).toBe(true)
      expect(useTimberItemStore().findByTag('42')).toBeUndefined()
      expect(useTimberItemStore().findByTag('42-A')).toBeUndefined()
    })

    it('removes a draft beam without asking; letters never change, the free one is handed out next', async () => {
      const { wrapper } = await mountAt('/timber-item/42')
      await splitIntoBeams()
      buttonByText(/Balken 00042-C hinzufügen/).click()
      await flushPromises()
      await wrapper.find('button[aria-label="Balken 42-A entfernen"]').trigger('click')
      expect(document.body.querySelector('[role="dialog"]')).toBeNull()
      expect(rowOf('42-A')).toBeUndefined()
      expect(rowOf('42-B')).toBeDefined()
      expect(rowOf('42-C')).toBeDefined()
      expect(buttonByText(/hinzufügen/).textContent).toContain('00042-A')
      expect(useTimberItemStore().events).toEqual([])
    })

    it('lists values, invalid input, beams and photo of a stem draft in that order', async () => {
      const { wrapper } = await mountAt('/timber-item/42')
      await wrapper.find('select').setValue(optionLabel('Holzart', 'Stieleiche'))
      await wrapper.find('input[inputmode="decimal"]').setValue('34abc')
      // The photo first: once the stem is split, its photos go to the beams.
      const input = wrapper.find('input[accept="image/*"][multiple]')
      Object.defineProperty(input.element, 'files', {
        value: [new NodeBlob(['x']) as unknown as Blob],
        configurable: true,
      })
      await input.trigger('change')
      await flushPromises()
      await splitIntoBeams()
      await wrapper.find('button[aria-label="Schließen"]').trigger('click')
      await flushPromises()
      expect(leaveDialog().items).toEqual([
        'Holzart: Stieleiche',
        'Gesägt',
        'Holzfeuchte: ungültige Eingabe',
        'Balken 00042-A, 00042-B',
        '1 Foto',
      ])
    })

    it('names the beam, not the stem, in the leave dialog of a beam', async () => {
      const { wrapper } = await mountAt('/timber-item/789-A')
      await wrapper.find('textarea').setValue('Riss')
      await wrapper.find('button[aria-label="Schließen"]').trigger('click')
      await flushPromises()
      expect(leaveDialog()).toEqual({
        title: 'Änderungen verwerfen?',
        intro: 'Noch nicht gespeichert für Balken 00789-A:',
        items: ['Notiz: Riss'],
      })
    })

    it('names the beams when the stem draft is discarded, and drops them', async () => {
      const { wrapper, router } = await mountAt('/timber-item/42')
      await wrapper.find('select').setValue(optionLabel('Holzart', 'Stieleiche'))
      await splitIntoBeams()
      await wrapper.find('button[aria-label="Schließen"]').trigger('click')
      await flushPromises()
      expect(leaveDialog().items).toEqual([
        'Holzart: Stieleiche',
        'Gesägt',
        'Balken 00042-A, 00042-B',
      ])

      buttonByText(/^Verwerfen$/).click()
      await flushPromises()
      expect(router.currentRoute.value.name).toBe('start')
      expect(useTimberItemStore().events).toEqual([])
    })

    it('asks "Speichern" when a draft beam is tapped, without a discard option', async () => {
      const { wrapper, router } = await mountAt('/timber-item/42')
      await splitIntoBeams()
      await wrapper.find('button.flex-1.items-center').trigger('click')
      await flushPromises()
      const dialog = document.body.querySelector('[role="dialog"]')!
      expect(dialog.textContent).toContain('Erst danach lässt sich der Balken öffnen')
      expect(dialog.textContent).toContain('Abbrechen')
      expect(dialog.textContent).not.toContain('Verwerfen')

      buttonByText(/^Abbrechen$/).click()
      await flushPromises()
      expect(document.body.querySelector('[role="dialog"]')).toBeNull()
      expect(router.currentRoute.value.params.tagNumber).toBe('42')
      expect(useTimberItemStore().events).toEqual([])

      await wrapper.find('button.flex-1.items-center').trigger('click')
      buttonByText(/^Speichern$/).click()
      await flushPromises()
      // Only saved: still on the stem, the beam is a plain link now and opens without a question.
      expect(router.currentRoute.value.params.tagNumber).toBe('42')
      expect(document.body.textContent).toContain('gespeichert')
      expect(useTimberItemStore().findByTag('42-A')).toBeDefined()
      expect(document.body.querySelector('[role="dialog"]')).toBeNull()

      await wrapper.find('a[href="/timber-item/42-A"]').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.params.tagNumber).toBe('42-A')
      expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    })

    it('asks before opening a saved beam while its stem has a draft, saves, and stays on the stem', async () => {
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
      expect(document.body.textContent).toContain('Erst speichern?')

      buttonByText(/^Speichern$/).click()
      await flushPromises()
      expect(router.currentRoute.value.params.tagNumber).toBe('789')
      expect(useTimberItemStore().findByTag('789-C')).toBeDefined()

      await wrapper.find('a[href="/timber-item/789-A"]').trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.params.tagNumber).toBe('789-A')
    })

    describe('remove dialog', () => {
      // A stem with the inherited Holzart and one beam; `fill` adds the beam's own data.
      async function openRemoveDialog(
        fill: (store: ReturnType<typeof useTimberItemStore>, beamId: string) => void,
      ) {
        const store = useTimberItemStore()
        const stem = store.createTimberItem(1555)
        const holzart = store.attributes.find((attribute) => attribute.name === 'Holzart')!
        store.recordAttribute(stem.id, holzart.id, holzart.options[0]!.id)
        const beam = store.addBeam(stem.id)
        fill(store, beam.id)
        const { wrapper } = await mountAt('/timber-item/1555')
        await wrapper.find('button[aria-label="Balken 1555-A entfernen"]').trigger('click')
        const dialog = document.body.querySelector('[role="dialog"]')!
        return {
          text: dialog.textContent!.replace(/\s+/g, ' '),
          lines: [...dialog.querySelectorAll('li')].map((li) => li.textContent),
        }
      }
      const attributeId = (store: ReturnType<typeof useTimberItemStore>, name: string) =>
        store.attributes.find((attribute) => attribute.name === name)!.id
      const addPhotos = (
        store: ReturnType<typeof useTimberItemStore>,
        beamId: string,
        n: number,
      ) => {
        for (let count = 0; count < n; count++) {
          store.addPhoto(
            beamId,
            attributeId(store, 'Fotos'),
            new NodeBlob(['x']) as unknown as Blob,
          )
        }
      }

      it('lists nothing for a beam without own values, and names the freed letter', async () => {
        const { text, lines } = await openRemoveDialog(() => {})
        expect(lines).toEqual([])
        expect(text).not.toContain('Wird mit entfernt')
        expect(text).toContain(
          'Der Buchstabe A wird wieder frei und kann für einen neuen Balken vergeben werden.',
        )
      })

      it("lists own values in the order of the form, but not the stem's inherited ones", async () => {
        const { text, lines } = await openRemoveDialog((store, beamId) => {
          store.recordAttribute(beamId, attributeId(store, 'Notiz'), 'Riss')
          store.recordAttribute(beamId, attributeId(store, 'Holzfeuchte'), 41.5)
          store.recordAttribute(beamId, attributeId(store, 'Holzfeuchte'), 38)
        })
        expect(text).toContain('Wird mit entfernt:')
        expect(lines).toEqual(['Holzfeuchte: 41,5 %', 'Holzfeuchte: 38 %', 'Notiz: Riss'])
      })

      it('counts photos in one line instead of listing them as values', async () => {
        expect((await openRemoveDialog((store, id) => addPhotos(store, id, 1))).lines).toEqual([
          '1 Foto',
        ])
      })

      it('lists values, then the photo line', async () => {
        const { lines } = await openRemoveDialog((store, beamId) => {
          addPhotos(store, beamId, 3)
          store.recordAttribute(beamId, attributeId(store, 'Notiz'), 'Riss')
        })
        expect(lines).toEqual(['Notiz: Riss', '3 Fotos'])
      })
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
})
