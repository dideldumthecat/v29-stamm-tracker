import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref, useTemplateRef } from 'vue'

import { useSizeVariable } from '@/sizeVariable'

// jsdom does not lay anything out: the size is set by hand, and the observer is one the test can fire.
let resize: () => void
class FakeResizeObserver {
  constructor(callback: () => void) {
    resize = callback
  }
  observe() {}
  disconnect() {}
}

enableAutoUnmount(afterEach)
beforeEach(() => vi.stubGlobal('ResizeObserver', FakeResizeObserver))
afterEach(() => vi.unstubAllGlobals())

const page = document.documentElement

describe('useSizeVariable', () => {
  it('puts the size of the element on the page and takes it away with the element', async () => {
    const shown = ref(true)
    const Measured = defineComponent({
      setup() {
        const element = useTemplateRef<HTMLElement>('element')
        useSizeVariable(element, '--test-height', 'height')
        return () => (shown.value ? h('div', { ref: 'element' }) : h('span'))
      },
    })
    const wrapper = mount(Measured, { attachTo: document.body })
    Object.defineProperty(wrapper.element, 'offsetHeight', { get: () => 44, configurable: true })
    await nextTick()
    resize()
    expect(page.style.getPropertyValue('--test-height')).toBe('44px')

    shown.value = false
    await nextTick()
    await nextTick()
    expect(page.style.getPropertyValue('--test-height')).toBe('')
  })
})
