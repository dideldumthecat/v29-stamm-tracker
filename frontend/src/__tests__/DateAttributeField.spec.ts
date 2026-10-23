import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import DateAttributeField from '@/components/DateAttributeField.vue'
import { useTimberItemStore } from '@/stores/timberItems'

// Item 123 has Fälldatum 2026-09-28 recorded (by Kerstin, 02.10.); item 456 has nothing.
function setup(tagNumber: number, error?: string) {
  const store = useTimberItemStore()
  const attribute = store.attributes.find((candidate) => candidate.type === 'date')!
  const wrapper = mount(DateAttributeField, {
    props: {
      attribute,
      recorded: store.findByTagNumber(tagNumber)?.values[attribute.id],
      error,
      modelValue: undefined as string | undefined,
      'onUpdate:modelValue': (value: string | undefined) => wrapper.setProps({ modelValue: value }),
    },
  })
  return { wrapper, attribute }
}

describe('DateAttributeField', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('passes the text as typed to the draft', async () => {
    const { wrapper } = setup(456)
    const input = wrapper.find('input[inputmode="numeric"]')
    await input.setValue('28.09.')
    expect(wrapper.emitted('update:modelValue')).toEqual([['28.09.']])
    expect((input.element as HTMLInputElement).value).toBe('28.09.')
  })

  it('shows the error message next to the input', () => {
    const { wrapper } = setup(456, 'Bitte als TT.MM.JJJJ eingeben.')
    expect(wrapper.find('[role="alert"]').text()).toBe('Bitte als TT.MM.JJJJ eingeben.')
    expect(wrapper.find('input').attributes('aria-invalid')).toBe('true')
  })

  it('locks a recorded date as TT.MM.JJJJ and unlocks it with the pencil', async () => {
    const { wrapper, attribute } = setup(123)
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.text()).toContain('28.09.2026')
    expect(wrapper.text()).toContain('02.10. · Kerstin')

    await wrapper.find(`button[aria-label="${attribute.name} ändern"]`).trigger('click')
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('28.09.2026')
  })
})
