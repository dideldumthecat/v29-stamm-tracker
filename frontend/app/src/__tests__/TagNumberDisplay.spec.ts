import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TagNumberDisplay from '@/components/TagNumberDisplay.vue'

describe('TagNumberDisplay error', () => {
  it('shows red frames and the alert text, linked to the display', () => {
    const wrapper = mount(TagNumberDisplay, { props: { tagInput: '2500', hasError: true } })
    const alert = wrapper.find('[role="alert"]')
    expect(alert.text()).toContain('Ungültige Nummer')
    expect(alert.classes()).toEqual(expect.arrayContaining(['text-alert', 'font-semibold']))
    const status = wrapper.find('[role="status"]')
    expect(status.attributes('aria-invalid')).toBe('true')
    expect(status.attributes('aria-describedby')).toBe(alert.attributes('id'))
    expect(wrapper.findAll('.border-alert')).toHaveLength(4)
  })

  it('looks normal without an error', () => {
    const wrapper = mount(TagNumberDisplay, { props: { tagInput: '12', hasError: false } })
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.find('[role="status"]').attributes('aria-invalid')).toBeUndefined()
    expect(wrapper.find('.border-alert').exists()).toBe(false)
  })
})
