// The whole app mounted on a route, shared by the App spec files. Each file mocks the modules of `appMocks.ts`.
import { afterEach, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import App from '../App.vue'
import { routes } from '../router'
import { useTimberItemStore } from '@/stores/timberItems'
import { useToast } from '@/composables/useToast'
import { api } from '@/api/client'
import { isInstalling, isLockStuck } from '@/composables/useUpdateCheck'
import { needRefresh } from './appMocks'

URL.createObjectURL = () => 'blob:preview'
URL.revokeObjectURL = () => {}

const mounted: { unmount: () => void }[] = []

export function setupApp() {
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
    isInstalling.value = false
    isLockStuck.value = false
  })
}

// The leave dialog: title, intro line and the listed parts (text of the elements, blanks collapsed).
export function leaveDialog() {
  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim()
  const dialog = document.body.querySelector('[role="dialog"]')
  return {
    title: text(dialog?.querySelector('h2')),
    intro: text(dialog?.querySelector('p')),
    items: [...(dialog?.querySelectorAll('li') ?? [])].map(text),
  }
}

export const optionLabel = (name: string, label: string) =>
  useTimberItemStore()
    .attributes.find((attribute) => attribute.name === name)!
    .options.find((option) => option.label === label)!.id

// Memory history: no browser URL needed in the test environment.
export async function mountAt(path: string) {
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
export function rejectAll() {
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

export const DUPLICATE_HINT =
  'Stamm 01555 war bereits erfasst. Deine Angaben dazu wurden nicht übernommen. Bitte prüfe die Nummer und erfasse fehlende Werte am bestehenden Stamm.'
