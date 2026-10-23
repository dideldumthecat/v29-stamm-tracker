import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TextAttributeField from '@/components/TextAttributeField.vue'
import { useTimberItemStore } from '@/stores/timberItems'

// Item 123 has Notiz (series) recorded once: "Leichter Drehwuchs" (Kerstin, 02.10.).
// `series: false` turns the same attribute into a single-value text.
function setup({ series = true, tagNumber = 123 } = {}) {
  const store = useTimberItemStore()
  const found = store.attributes.find((candidate) => candidate.type === 'text')!
  const attribute = { ...found, is_series: series }
  const wrapper = mount(TextAttributeField, {
    props: {
      attribute,
      recorded: store.findByTagNumber(tagNumber)?.values[attribute.id],
      modelValue: undefined as string | undefined,
      // Like v-model in the parent: write the emitted value back.
      'onUpdate:modelValue': (value: string | undefined) => wrapper.setProps({ modelValue: value }),
    },
  })
  return { wrapper, attribute }
}

describe('TextAttributeField', () => {
  beforeEach(() => setActivePinia(createPinia()))

  describe('series', () => {
    it('lists earlier entries and starts with an empty textarea', () => {
      const { wrapper } = setup()
      expect(wrapper.text()).toContain('Leichter Drehwuchs')
      expect(wrapper.text()).toContain('02.10. · Kerstin')
      expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')
    })

    it('passes a new entry to the draft as typed', async () => {
      const { wrapper } = setup()
      await wrapper.find('textarea').setValue('Astloch auf halber Länge')
      expect(wrapper.emitted('update:modelValue')).toEqual([['Astloch auf halber Länge']])
    })

    it('passes whitespace on unchanged – the parent decides that it is no change', async () => {
      const { wrapper } = setup()
      await wrapper.find('textarea').setValue('   ')
      expect(wrapper.emitted('update:modelValue')).toEqual([['   ']])
    })
  })

  describe('single value', () => {
    it('locks the recorded text and unlocks it with the pencil', async () => {
      const { wrapper, attribute } = setup({ series: false })
      expect(wrapper.find('textarea').exists()).toBe(false)
      expect(wrapper.text()).toContain('Leichter Drehwuchs')

      await wrapper.find(`button[aria-label="${attribute.name} ändern"]`).trigger('click')
      expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe(
        'Leichter Drehwuchs',
      )
    })

    it('does not lock an item without a recorded text', () => {
      const { wrapper } = setup({ series: false, tagNumber: 456 })
      expect(wrapper.find('textarea').exists()).toBe(true)
    })
  })
})
