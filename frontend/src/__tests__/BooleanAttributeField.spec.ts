import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import BooleanAttributeField from '@/components/BooleanAttributeField.vue'
import { useTimberItemStore } from '@/stores/timberItems'

// The fixture has one boolean attribute; item 789 has it recorded as true (by Alexander, 14.10.).
function setup(tagNumber: number | null) {
  const store = useTimberItemStore()
  const attribute = store.attributes.find((candidate) => candidate.type === 'boolean')!
  const recorded = tagNumber ? store.findByTagNumber(tagNumber)?.values[attribute.id] : undefined
  const wrapper = mount(BooleanAttributeField, {
    props: {
      attribute,
      recorded,
      modelValue: undefined as boolean | undefined,
      // Like v-model in the parent: write the emitted value back.
      'onUpdate:modelValue': (value: boolean | undefined) =>
        wrapper.setProps({ modelValue: value }),
    },
  })
  return { wrapper, attribute }
}

describe('BooleanAttributeField', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('toggles the draft by tapping the button', async () => {
    const { wrapper } = setup(null)
    const button = wrapper.find('button[aria-pressed]')
    expect(button.attributes('aria-pressed')).toBe('false')

    await button.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
    expect(button.attributes('aria-pressed')).toBe('true')

    await button.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[true], [false]])
    expect(button.attributes('aria-pressed')).toBe('false')
  })

  it('locks a recorded value and unlocks it with the pencil', async () => {
    const { wrapper, attribute } = setup(789)
    expect(wrapper.find('button[aria-pressed]').exists()).toBe(false)
    expect(wrapper.text()).toContain('14.10. · Alexander')

    await wrapper.find(`button[aria-label="${attribute.name} ändern"]`).trigger('click')
    const button = wrapper.find('button[aria-pressed]')
    // Starts from the recorded value, so one tap turns it off.
    expect(button.attributes('aria-pressed')).toBe('true')
    await button.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('does not lock an item without a recorded value', () => {
    const { wrapper } = setup(456)
    expect(wrapper.find('button[aria-pressed]').exists()).toBe(true)
  })

  it('marks an inactive attribute and drops the pencil', () => {
    const store = useTimberItemStore()
    const attribute = store.attributes.find((candidate) => candidate.type === 'boolean')!
    const wrapper = mount(BooleanAttributeField, {
      props: {
        attribute: { ...attribute, active: false },
        readonly: true,
        recorded: store.findByTagNumber(789)?.values[attribute.id],
      },
    })
    expect(wrapper.text()).toContain('deaktiviert')
    expect(wrapper.find('button').exists()).toBe(false)
  })
})
