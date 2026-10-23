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
})
