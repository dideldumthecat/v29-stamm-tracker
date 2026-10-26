import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import UpdatePrompt from '@/components/UpdatePrompt.vue'

const updateServiceWorker = vi.fn()
vi.mock('virtual:pwa-register/vue', () => ({
  useRegisterSW: () => ({ needRefresh: ref(true), updateServiceWorker }),
}))

async function mountAt(path: string) {
  const component = { template: '<div />' }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'start', component },
      { path: '/timber-item/:tagNumber', name: 'timber-item', component },
    ],
  })
  router.push(path)
  await router.isReady()
  return mount(UpdatePrompt, { global: { plugins: [router] } })
}

describe('UpdatePrompt', () => {
  it('offers the update on the start screen and reloads on confirm', async () => {
    const wrapper = await mountAt('/')
    expect(wrapper.text()).toContain('Neue Version verfügbar')
    await wrapper.find('button').trigger('click')
    expect(updateServiceWorker).toHaveBeenCalledWith(true)
  })

  it('stays hidden while an item is open', async () => {
    const wrapper = await mountAt('/timber-item/5')
    expect(wrapper.text()).toBe('')
  })
})
