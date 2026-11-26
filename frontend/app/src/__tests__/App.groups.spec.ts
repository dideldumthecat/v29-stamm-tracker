import { describe, it, expect, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { useTimberItemStore } from '@/stores/timberItems'
import { buttonByText, mountAt, setupApp } from './appSetup'
import { restartWithHidden, restartWithSnapshot } from './storeSetup'

vi.mock('virtual:pwa-register/vue', () => import('./appMocks').then((mocks) => mocks.pwaRegister))
vi.mock('@/composables/useUpdateCheck', () =>
  import('./appMocks').then((mocks) => mocks.updateCheck),
)
vi.mock('@/utils/photo', async (importOriginal) =>
  (await import('./appMocks')).photoUtils(await importOriginal()),
)

// The group of the user decides which attributes the app shows (`hidden_attribute_ids` of the snapshot).
// Stem 789 is sawn, has Holzart "Stieleiche", Lieferdatum and the beams A and B (Sortierklasse is their own).
describe('App: attributes the group of the user does not see', () => {
  setupApp()

  const attributeId = (name: string) =>
    useTimberItemStore().attributes.find((attribute) => attribute.name === name)!.id

  it('shows no field and no recorded value of a hidden attribute, but all others', async () => {
    await restartWithHidden('Holzart')

    const { wrapper } = await mountAt('/timber-item/789')

    expect(wrapper.text()).not.toContain('Holzart')
    expect(wrapper.text()).not.toContain('Stieleiche')
    expect(wrapper.text()).toContain('Lieferdatum')
  })

  it('shows the form of an empty stem without the hidden attribute', async () => {
    await restartWithHidden('Holzart', 'Holzfeuchte')

    const { wrapper } = await mountAt('/timber-item/456')

    expect(wrapper.text()).not.toContain('Holzart')
    expect(wrapper.text()).not.toContain('Holzfeuchte')
    expect(wrapper.text()).toContain('Fälldatum')
  })

  it('hides a value a beam inherits, and a hidden value in the list of beams', async () => {
    await restartWithHidden('Holzart', 'Sortierklasse')

    const beam = await mountAt('/timber-item/789-A')
    expect(beam.wrapper.text()).not.toContain('Holzart')
    expect(beam.wrapper.text()).not.toContain('Stieleiche')
    expect(beam.wrapper.text()).not.toContain('Sortierklasse')
    expect(beam.wrapper.text()).toContain('Lieferdatum')

    const stem = await mountAt('/timber-item/789')
    const rows = stem.wrapper.findAll('a[href^="/timber-item/789-"]').map((row) => row.text())
    // 789-B has its own Lieferdatum and Sortierklasse; "· B" would be the class.
    expect(rows).toEqual(['00789-Anoch keine eigenen Angaben', '00789-B01.10.2026'])
  })

  it('saves nothing for a hidden attribute and still sends what was recorded before', async () => {
    const store = useTimberItemStore()
    const stemId = store.findByTag('456')!.id
    store.recordAttribute(stemId, attributeId('Holzfeuchte'), 12)
    await restartWithHidden('Holzfeuchte')
    expect(store.pendingCount).toBe(1)

    const { wrapper } = await mountAt('/timber-item/456')
    await wrapper.find('input[type="date"]').setValue('2026-09-08')
    wrapper.find<HTMLButtonElement>('button.bg-ink.text-lg').element.click()
    await flushPromises()

    expect(
      store.events.map((event) => event.type === 'attribute_recorded' && event.data.attribute_id),
    ).toEqual([attributeId('Holzfeuchte'), attributeId('Lieferdatum')])
  })

  it('lets "hidden_when" work on a hidden attribute', async () => {
    const store = useTimberItemStore()
    const stemId = store.findByTag('456')!.id
    const unsawableId = crypto.randomUUID()
    store.recordAttribute(stemId, unsawableId, true)
    await restartWithSnapshot((snapshot) => {
      const sawn = snapshot.attributes.find((attribute) => attribute.key === 'sawn')!
      sawn.hidden_when = [unsawableId]
      snapshot.attributes.push({
        ...sawn,
        id: unsawableId,
        key: null,
        name: 'Nicht sägbar',
        hidden_when: [],
      })
      snapshot.hidden_attribute_ids = [unsawableId]
    })

    const { wrapper } = await mountAt('/timber-item/456')

    // "Nicht sägbar" is hidden and stands on "ja": "Gesägt" is hidden by it, though the group does not see "Nicht sägbar" itself.
    expect(wrapper.text()).not.toContain('Nicht sägbar')
    expect(wrapper.text()).not.toContain('Gesägt')
    expect(wrapper.text()).toContain('Holzart')
  })

  // Adding and removing beams belong to "Gesägt" (key "sawn"): without it the beams stay listed and can be opened.
  describe('beams without the attribute "Gesägt"', () => {
    const hideSawn = () => restartWithHidden('Gesägt')

    it('keeps the beams of a stem listed and openable, with no way to add or remove', async () => {
      await hideSawn()

      const { wrapper, router } = await mountAt('/timber-item/789')

      const rows = wrapper.findAll('a[href^="/timber-item/789-"]')
      expect(rows).toHaveLength(2)
      expect(wrapper.text()).toContain('Balken (2)')
      expect(buttonByText(/Balken .* hinzufügen/)).toBeUndefined()
      expect(wrapper.find('button[aria-label^="Balken 789-"]').exists()).toBe(false)
      await rows[0]!.trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.params.tagNumber).toBe('789-A')
    })

    it('offers no "Balken entfernen" on a beam', async () => {
      await hideSawn()

      const { wrapper } = await mountAt('/timber-item/789-A')

      expect(wrapper.text()).toContain('Aus Stamm')
      expect(buttonByText(/Balken entfernen/)).toBeUndefined()
    })

    it('offers no beams on a stem without any, and no split question', async () => {
      await hideSawn()

      const { wrapper } = await mountAt('/timber-item/456')

      expect(wrapper.text()).not.toContain('Balken')
      expect(buttonByText(/^\s*Gesägt\s*$/)).toBeUndefined()
    })

    it('still offers them to a group that sees "Gesägt"', async () => {
      const { wrapper } = await mountAt('/timber-item/456')

      expect(buttonByText(/Balken A und B hinzufügen/)).toBeDefined()
      expect(wrapper.text()).toContain('Balken')
    })
  })
})
