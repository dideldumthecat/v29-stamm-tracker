import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ChoiceAttributeField from '@/components/ChoiceAttributeField.vue'
import { useTimberItemStore } from '@/stores/timberItems'
import type { AttributeValueRecord } from '@/api/contract'

// Fixture: the first choice attribute (Holzart) has one inactive option (Roteiche).
function setup(recordedOptionId?: string) {
  const store = useTimberItemStore()
  const attribute = store.attributes.find((candidate) => candidate.type === 'choice')!
  const inactive = attribute.options.find((option) => !option.active)!
  const recorded: AttributeValueRecord[] | undefined = recordedOptionId
    ? [
        {
          value: recordedOptionId,
          recorded_at: '2026-10-02T07:12:00Z',
          user_id: store.users[0]!.id,
          event_id: 'e',
        },
      ]
    : undefined
  const wrapper = mount(ChoiceAttributeField, { props: { attribute, recorded } })
  return { wrapper, attribute, inactive }
}

const optionLabels = (wrapper: ReturnType<typeof setup>['wrapper']) =>
  wrapper.findAll('option').map((option) => option.text())

describe('ChoiceAttributeField with inactive options', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('does not offer an inactive option for a new value', () => {
    const { wrapper, inactive } = setup()
    expect(optionLabels(wrapper)).not.toContain(inactive.label)
    expect(optionLabels(wrapper)).toContain('Traubeneiche')
  })

  it('still shows the label of an inactive recorded option', () => {
    const { wrapper, inactive } = setup(setupInactiveId())
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.text()).toContain(`${inactive.label} (nicht mehr wählbar)`)
  })

  it('keeps the recorded inactive option selectable-as-shown after unlocking, offers no other inactive one', async () => {
    const { wrapper, attribute, inactive } = setup(setupInactiveId())
    await wrapper.find(`button[aria-label="${attribute.name} ändern"]`).trigger('click')
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe(inactive.id)
    expect(optionLabels(wrapper)).toContain(`${inactive.label} (nicht mehr wählbar)`)
    // Active options carry no addition.
    expect(optionLabels(wrapper)).toContain('Traubeneiche')
  })

  it('drops the pencil when read-only', () => {
    const store = useTimberItemStore()
    const attribute = store.attributes.find((candidate) => candidate.type === 'choice')!
    const wrapper = mount(ChoiceAttributeField, {
      props: {
        attribute,
        readonly: true,
        recorded: store.findByTagNumber(123)?.values[attribute.id],
      },
    })
    expect(wrapper.text()).toContain('Traubeneiche')
    expect(wrapper.find('button').exists()).toBe(false)
  })
})

function setupInactiveId(): string {
  const store = useTimberItemStore()
  return store.attributes
    .find((candidate) => candidate.type === 'choice')!
    .options.find((option) => !option.active)!.id
}
