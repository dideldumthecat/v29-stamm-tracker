import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import NumberAttributeField from '@/components/NumberAttributeField.vue'
import { useTimberItemStore } from '@/stores/timberItems'
import type { AttributeValue } from '@v29/shared/contract'

// Item 123 has Holzfeuchte (series, unit %) recorded as 48.5 (Kerstin, 02.10.) and 41 (Jonas, 16.10.).
// `series: false` turns the same attribute into a single-value number.
function setup({ series = true, tagNumber = 123 } = {}) {
  const store = useTimberItemStore()
  const found = store.attributes.find((candidate) => candidate.type === 'number')!
  const attribute = { ...found, is_series: series }
  const wrapper = mount(NumberAttributeField, {
    props: {
      attribute,
      recorded: store.findByTagNumber(tagNumber)?.values[attribute.id],
      modelValue: undefined as string | undefined,
      added: undefined as AttributeValue[] | undefined,
      // Like v-model in the parent: write the emitted values back.
      'onUpdate:modelValue': (value: string | undefined) => wrapper.setProps({ modelValue: value }),
      'onUpdate:added': (value: AttributeValue[]) => wrapper.setProps({ added: value }),
    },
  })
  return { wrapper, attribute }
}

const addButton = (wrapper: ReturnType<typeof setup>['wrapper']) =>
  wrapper.findAll('button').find((button) => button.text() === 'Hinzufügen')!

describe('NumberAttributeField', () => {
  beforeEach(() => setActivePinia(createPinia()))

  describe('series', () => {
    it('lists earlier measurements newest first, with comma and unit', () => {
      const { wrapper } = setup()
      const text = wrapper.text()
      expect(text).toContain('48,5 %')
      expect(text).toContain('16.10. · Jonas')
      expect(text.indexOf('41 %')).toBeLessThan(text.indexOf('48,5 %'))
      // Append-only: never locked.
      expect(wrapper.find('input').exists()).toBe(true)
    })

    it('adds a value typed with a comma, marks it as new and clears the input', async () => {
      const { wrapper } = setup()
      const input = wrapper.find('input[inputmode="decimal"]')
      await input.setValue('34,5')
      await addButton(wrapper).trigger('click')

      expect(wrapper.emitted('update:added')).toEqual([[[34.5]]])
      expect((input.element as HTMLInputElement).value).toBe('')
      expect(wrapper.text()).toContain('34,5 %')
      expect(wrapper.text()).toContain('neu')
    })

    it('accepts a dot as well and adds with Enter', async () => {
      const { wrapper } = setup()
      const input = wrapper.find('input')
      await input.setValue('34.5')
      await input.trigger('keydown', { key: 'Enter' })
      expect(wrapper.emitted('update:added')).toEqual([[[34.5]]])
    })

    it('rejects text with a message until the next keystroke', async () => {
      const { wrapper } = setup()
      const input = wrapper.find('input')
      await input.setValue('34abc')
      await addButton(wrapper).trigger('click')
      expect(wrapper.emitted('update:added')).toBeUndefined()
      expect(wrapper.find('[role="alert"]').text()).toContain('Zahl')

      await input.setValue('34')
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    })

    it('removes a new value individually', async () => {
      const { wrapper } = setup()
      const input = wrapper.find('input')
      for (const text of ['30', '31']) {
        await input.setValue(text)
        await addButton(wrapper).trigger('click')
      }
      expect(wrapper.text()).toContain('30 %')

      // Newest first: the first remove button belongs to 31.
      await wrapper.find('button[aria-label="Wert entfernen"]').trigger('click')
      expect(wrapper.emitted('update:added')?.slice(-1)[0]).toEqual([[30]])
      expect(wrapper.text()).not.toContain('31 %')
      expect(wrapper.text()).toContain('30 %')
    })
  })

  describe('single value', () => {
    it('locks the recorded value with unit and unlocks it with the pencil', async () => {
      const { wrapper, attribute } = setup({ series: false })
      expect(wrapper.find('input').exists()).toBe(false)
      expect(wrapper.text()).toContain('41 %')
      expect(wrapper.text()).toContain('16.10. · Jonas')
      expect(addButton(wrapper)).toBeUndefined()

      await wrapper.find(`button[aria-label="${attribute.name} ändern"]`).trigger('click')
      expect((wrapper.find('input').element as HTMLInputElement).value).toBe('41')
    })

    it('passes the typed text to the draft', async () => {
      const { wrapper } = setup({ series: false, tagNumber: 456 })
      await wrapper.find('input').setValue('34,5')
      expect(wrapper.emitted('update:modelValue')).toEqual([['34,5']])
    })
  })
})
