import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'

import { user } from '@/auth'
import { createAdminRouter } from '@/router'
import App from '../App.vue'
import { fakeApi } from './fakeApi'
import { stubBrowser } from './popup'

const CODE = 'K7QM-4XHT-9RDP'

async function open(prepare: (api: ReturnType<typeof fakeApi>) => void = () => {}) {
  const api = fakeApi({ [CODE]: 'admin' })
  prepare(api)
  const router = createAdminRouter(createMemoryHistory())
  await router.push('/login')
  const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } })
  await flushPromises()
  await wrapper.get('input').setValue(CODE)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  await router.push('/piles')
  await flushPromises()
  return { api, router, wrapper }
}

enableAutoUnmount(afterEach)
beforeEach(() => {
  user.value = null
  stubBrowser()
})
afterEach(() => vi.unstubAllGlobals())

describe('page Polter', () => {
  it('is in the navigation between "Aktivität" and "Stämme"', async () => {
    const { wrapper } = await open()

    const links = wrapper.get('nav[aria-label="Hauptnavigation"]').findAll('a')
    expect(links.map((link) => link.text())).toEqual([
      'Dashboard',
      'Aktivität',
      'Polter',
      'Stämme',
      'Balken',
    ])
    expect(links[2]!.attributes('aria-current')).toBe('page')
  })

  it('shows the cards in the order of the server, under the heading and its line', async () => {
    const { wrapper } = await open()

    expect(wrapper.get('h1').text()).toBe('Polter')
    expect(wrapper.get('h1 + p').text()).toBe('Zuletzt angelegter Polter oben.')
    expect(wrapper.get('h1 + p').classes()).toContain('text-mute')
    expect(wrapper.findAll('main section > div > h2').map((h2) => h2.text())).toEqual([
      'Polter 2601-010170 (Lindenallee)',
      'Polter 2601-010160 (Waldweg Nord)',
      'Polter 2601-010145 (Krummes F)',
    ])
  })

  it('offers a retry when the cards cannot be loaded', async () => {
    const { wrapper } = await open((api) => api.failPileCards())

    expect(wrapper.find('section').exists()).toBe(false)
    expect(wrapper.get('main').text()).toContain('Erneut versuchen')
  })

  it('keeps the master data on its own route behind the gear', async () => {
    const { router, wrapper } = await open()

    await router.push('/pile-data')
    await flushPromises()
    expect(wrapper.get('h1').text()).toBe('Polter')
    expect(wrapper.text()).toContain('Polter hinzufügen')
  })
})
