import { describe, it, expect } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import FieldError from '@/components/FieldError.vue'
import { useFieldError } from '@/composables/useFieldError'

// A minimal field built the way the rule asks for: composable on the input, FieldError below.
const error = ref<string | undefined>()
const Field = defineComponent({
  setup() {
    const { errorId, errorBorder, errorAttrs } = useFieldError(error)
    return () => [
      h('input', { class: errorBorder.value, ...errorAttrs.value }),
      h(FieldError, { id: errorId, message: error.value }),
    ]
  },
})

describe('field error display', () => {
  it('shows red border, bold red alert text and the aria link while an error is shown', async () => {
    const wrapper = mount(Field)
    error.value = 'Bitte eine Zahl eingeben'
    await wrapper.vm.$nextTick()

    const input = wrapper.find('input')
    const alert = wrapper.find('[role="alert"]')
    expect(input.classes()).toContain('border-alert')
    expect(input.classes()).not.toContain('border-ink')
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(alert.text()).toBe('Bitte eine Zahl eingeben')
    expect(alert.classes()).toEqual(expect.arrayContaining(['text-alert', 'font-semibold']))
    expect(input.attributes('aria-describedby')).toBe(alert.attributes('id'))
  })

  it('is back to normal once the error is gone', async () => {
    const wrapper = mount(Field)
    error.value = 'Fehler'
    await wrapper.vm.$nextTick()
    error.value = undefined
    await wrapper.vm.$nextTick()

    const input = wrapper.find('input')
    expect(input.classes()).toContain('border-ink')
    expect(input.classes()).not.toContain('border-alert')
    expect(input.attributes('aria-invalid')).toBeUndefined()
    expect(input.attributes('aria-describedby')).toBeUndefined()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('FieldError renders nothing without a message', () => {
    expect(mount(FieldError, { props: { id: 'x' } }).html()).toBe('<!--v-if-->')
  })
})
