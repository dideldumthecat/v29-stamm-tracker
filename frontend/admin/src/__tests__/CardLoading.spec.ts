import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CardLoading from '@/components/CardLoading.vue'

describe('CardLoading', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows the saw blade only after 200 ms and announces the state to screen readers', async () => {
    const wrapper = mount(CardLoading, {
      props: { heading: 'Verlauf', label: 'Verlauf wird geladen' },
    })
    expect(wrapper.get('[role=status] .sr-only').text()).toBe('Verlauf wird geladen')
    expect(wrapper.find('svg').exists()).toBe(false)

    await vi.advanceTimersByTimeAsync(199)
    expect(wrapper.find('svg').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(wrapper.find('svg').exists()).toBe(true)
  })
})
