import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import SyncButton from '@/components/SyncButton.vue'
import { holdSync } from './storeSetup'

function mountButton(props: { pendingCount: number; inverted?: boolean }) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/sync', name: 'sync', component: {} }],
  })
  return mount(SyncButton, { props, global: { plugins: [router] } })
}

describe('SyncButton', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it.each([false, true])(
    'spins the icon and says so while a sync runs (inverted: %s)',
    async (inverted) => {
      const wrapper = mountButton({ pendingCount: 2, inverted })
      const icon = () => wrapper.find('svg')
      expect(icon().classes()).not.toContain('animate-spin')
      expect(wrapper.attributes('aria-label')).toBe('Synchronisieren, 2 offene Einträge')

      const finishSync = holdSync()
      await wrapper.vm.$nextTick()
      expect(icon().classes()).toContain('animate-spin')
      expect(icon().classes()).toContain('motion-reduce:animate-none')
      expect(wrapper.attributes('aria-label')).toBe('Synchronisierung läuft, 2 offene Einträge')

      await finishSync()
      await wrapper.vm.$nextTick()
      expect(icon().classes()).not.toContain('animate-spin')
    },
  )

  it('counts down with the pending entries', async () => {
    const wrapper = mountButton({ pendingCount: 2 })
    await wrapper.setProps({ pendingCount: 1 })
    expect(wrapper.attributes('aria-label')).toContain('1 offene Einträge')
  })
})
