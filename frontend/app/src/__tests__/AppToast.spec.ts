import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import AppToast from '@/components/AppToast.vue'
import { useToast } from '@/composables/useToast'

describe('AppToast', () => {
  afterEach(() => useToast().hide())

  const icon = () => document.body.querySelector('[role="status"] svg')!

  it('gives an error a red warning icon on the same background as a warning', async () => {
    const wrapper = mount(AppToast, { attachTo: document.body })
    const toast = useToast()

    toast.show({ before: 'Angehalten', kind: 'warning' })
    await wrapper.vm.$nextTick()
    const warningBackground = document.body.querySelector('[role="status"]')!.className
    expect(icon().classList.contains('text-ink')).toBe(true)

    toast.show({ before: 'Fehlgeschlagen', kind: 'error' })
    await wrapper.vm.$nextTick()
    expect(icon().classList.contains('text-alert')).toBe(true)
    expect(document.body.querySelector('[role="status"]')!.className).toBe(warningBackground)
    wrapper.unmount()
  })

  it('keeps the success look: paper background, muted check icon', async () => {
    const wrapper = mount(AppToast, { attachTo: document.body })
    useToast().show({ before: 'Gespeichert' })
    await wrapper.vm.$nextTick()
    expect(document.body.querySelector('[role="status"]')!.classList.contains('bg-paper')).toBe(
      true,
    )
    expect(icon().classList.contains('text-mute')).toBe(true)
    wrapper.unmount()
  })
})
