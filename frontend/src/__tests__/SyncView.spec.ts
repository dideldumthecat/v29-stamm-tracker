import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import SyncView from '@/views/SyncView.vue'
import { useTimberItemStore } from '@/stores/timberItems'

const mounted: { unmount: () => void }[] = []

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'start', component: {} },
      { path: '/timber-item/:tagNumber', name: 'timber-item', component: {} },
    ],
  })
  await router.push('/')
  const wrapper = mount(SyncView, { global: { plugins: [router] }, attachTo: document.body })
  mounted.push(wrapper)
  return wrapper
}

// The sheet teleports to the body.
const dialog = () => document.body.querySelector('[role="dialog"]')!
const dialogButtons = () =>
  [...dialog().querySelectorAll('button')].map((b) => b.textContent?.trim())

describe('SyncView: discarding the removal of a synced beam', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => mounted.splice(0).forEach((wrapper) => wrapper.unmount()))

  async function openRemovalDialog(letterTaken: boolean) {
    const store = useTimberItemStore()
    store.removeTimberItem(store.findByTag('789-B')!.id)
    if (letterTaken) {
      store.addBeam(store.findByTag('789')!.id)
    }
    const wrapper = await mountView()
    await wrapper.find('button[aria-label="Eintrag verwerfen"]').trigger('click')
  }

  it('offers to discard and names the letter that is occupied again', async () => {
    await openRemovalDialog(false)
    expect(dialog().textContent).toContain('Entfernen von Balken 00789-B verwerfen?')
    expect(dialog().textContent).toContain(
      'Der Balken ist danach wieder da. Der Buchstabe B ist dann wieder belegt.',
    )
    expect(dialogButtons()).toEqual(['Verwerfen', 'Abbrechen'])
  })

  it('only informs when a new beam took the letter', async () => {
    await openRemovalDialog(true)
    expect(dialog().textContent).toContain('Entfernen von Balken 00789-B verwerfen?')
    expect(dialog().textContent).toContain(
      'Der Buchstabe B ist inzwischen an einen neuen Balken vergeben. Um 00789-B zurückzuholen, erst den neuen Balken 00789-B entfernen.',
    )
    expect(dialogButtons()).toEqual(['Verstanden'])
  })
})
