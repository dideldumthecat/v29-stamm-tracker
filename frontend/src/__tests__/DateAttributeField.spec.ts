import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import DateAttributeField from '@/components/DateAttributeField.vue'
import { useTimberItemStore } from '@/stores/timberItems'

// Item 123 has Fälldatum 2026-09-28 recorded (by Kerstin, 02.10.); item 456 has nothing.
function setup(tagNumber: number) {
  const store = useTimberItemStore()
  const attribute = store.attributes.find((candidate) => candidate.type === 'date')!
  const wrapper = mount(DateAttributeField, {
    props: {
      attribute,
      recorded: store.findByTagNumber(tagNumber)?.values[attribute.id],
      modelValue: undefined as string | undefined,
      'onUpdate:modelValue': (value: string | undefined) => wrapper.setProps({ modelValue: value }),
    },
  })
  return { wrapper, attribute }
}

describe('DateAttributeField', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('passes the picked date to the draft in contract format', async () => {
    const { wrapper } = setup(456)
    const input = wrapper.find('input[type="date"]')
    await input.setValue('2026-09-08')
    expect(wrapper.emitted('update:modelValue')).toEqual([['2026-09-08']])
    expect((input.element as HTMLInputElement).value).toBe('2026-09-08')
  })

  it('locks a recorded date as TT.MM.JJJJ and unlocks it with the pencil', async () => {
    const { wrapper, attribute } = setup(123)
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.text()).toContain('28.09.2026')
    expect(wrapper.text()).toContain('02.10. · Kerstin')

    await wrapper.find(`button[aria-label="${attribute.name} ändern"]`).trigger('click')
    // The input itself uses the contract format; only the locked display is TT.MM.JJJJ.
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('2026-09-28')
  })

  it('marks an inactive attribute – the hint comes from AttributeField', () => {
    const store = useTimberItemStore()
    const attribute = store.attributes.find((candidate) => candidate.type === 'date')!
    const props = { attribute, recorded: store.findByTagNumber(123)?.values[attribute.id] }
    expect(mount(DateAttributeField, { props }).text()).not.toContain('deaktiviert')

    // Read-only on a split stem: no pencil, but not marked inactive.
    const split = mount(DateAttributeField, { props: { ...props, readonly: true } })
    expect(split.text()).not.toContain('deaktiviert')
    expect(split.find('button').exists()).toBe(false)

    const inactive = { ...props, attribute: { ...attribute, active: false }, readonly: true }
    expect(mount(DateAttributeField, { props: inactive }).text()).toContain('deaktiviert')
  })
})
