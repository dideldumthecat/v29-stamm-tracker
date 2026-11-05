import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

import App from '../App.vue'
import PlaceholderView from '../views/PlaceholderView.vue'

describe('App', () => {
  it('shows the placeholder on every path', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:pathMatch(.*)*', component: PlaceholderView }],
    })
    await router.push('/x')
    const wrapper = mount(App, { global: { plugins: [router] } })
    expect(wrapper.get('h1').text()).toBe('V29 Stamm-Tracker – Administration')
  })
})
