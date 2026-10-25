import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import MonthAttributeField from '@/components/MonthAttributeField.vue'
import type { AttributeValueRecord } from '@/api/contract'
import { useTimberItemStore } from '@/stores/timberItems'

const recorded: AttributeValueRecord[] = [
  {
    value: '2026-09',
    recorded_at: '2026-10-02T07:12:00.000Z',
    user_id: '993955be-5888-4f39-937c-56af8c5187c1',
    event_id: 'e',
  },
]

function setup(props: { recorded?: AttributeValueRecord[]; error?: string } = {}) {
  // The update comes from the date field inside, so record it here instead of via emitted().
  const updates: (string | undefined)[] = []
  const attribute = useTimberItemStore().attributes.find((candidate) => candidate.type === 'month')!
  const wrapper = mount(MonthAttributeField, {
    props: {
      attribute,
      recorded: props.recorded,
      error: props.error,
      modelValue: undefined as string | undefined,
      'onUpdate:modelValue': (value: string | undefined) => {
        updates.push(value)
        wrapper.setProps({ modelValue: value })
      },
    },
  })
  return { wrapper, attribute, updates }
}

describe('MonthAttributeField', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('passes the picked month to the draft in contract format', async () => {
    const { wrapper, updates } = setup()
    const input = wrapper.find('input[type="month"]')
    await input.setValue('2026-10')
    expect(updates).toEqual(['2026-10'])
    expect((input.element as HTMLInputElement).value).toBe('2026-10')
  })

  it('locks a recorded month as MM/JJJJ and unlocks it with the pencil', async () => {
    const { wrapper, attribute } = setup({ recorded })
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.text()).toContain('09/2026')
    expect(wrapper.text()).toContain('02.10. · Kerstin')

    await wrapper.find(`button[aria-label="${attribute.name} ändern"]`).trigger('click')
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('2026-09')
  })

  it('shows the error set by the parent next to the input', () => {
    const { wrapper } = setup({ error: 'Bitte Jahr und Monat eingeben.' })
    const alert = wrapper.find('[role="alert"]')
    expect(alert.text()).toBe('Bitte Jahr und Monat eingeben.')
    expect(wrapper.find('input').attributes('aria-describedby')).toBe(alert.attributes('id'))
  })
})
