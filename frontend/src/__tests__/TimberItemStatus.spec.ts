import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import TimberItemStatus from '@/components/TimberItemStatus.vue'
import type { TimberItem } from '@/stores/timberItems'

const recorded = {
  id: 'item-1',
  created_at: '2026-10-01T08:00:00Z',
  created_by: 'user-1',
} as TimberItem

function mountStatus(props: { item: TimberItem | undefined; parentTag?: string }) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/timber-item/:tagNumber', name: 'timber-item', component: {} }],
  })
  return mount(TimberItemStatus, { props, global: { plugins: [router] } })
}

describe('TimberItemStatus', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('has no stem row without a parent tag', () => {
    expect(mountStatus({ item: recorded }).find('a').exists()).toBe(false)
    expect(mountStatus({ item: undefined }).find('a').exists()).toBe(false)
  })

  it.each([
    ['recorded', { item: recorded }, 'Bereits erfasst'],
    ['new', { item: undefined }, 'Noch nicht erfasst'],
  ])('links a %s beam to its stem', (_, props, status) => {
    const wrapper = mountStatus({ ...props, parentTag: '789' })
    const link = wrapper.get('a')
    expect(wrapper.text()).toContain(status)
    expect(link.attributes('href')).toBe('/timber-item/789')
    expect(link.text()).toBe('Aus Stamm 00789')
  })

  it('names what is created on save', () => {
    expect(mountStatus({ item: undefined }).text()).toContain('Stamm wird beim Speichern angelegt')
    expect(mountStatus({ item: undefined, parentTag: '789' }).text()).toContain(
      'Balken wird beim Speichern angelegt',
    )
  })
})
