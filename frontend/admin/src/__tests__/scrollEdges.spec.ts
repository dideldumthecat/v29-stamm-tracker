import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, useTemplateRef } from 'vue'

import { useScrollEdges } from '@/scrollEdges'

// jsdom does not lay anything out: the sizes are set by hand, and the observer is one the test can fire.
let resize: () => void
class FakeResizeObserver {
  constructor(callback: () => void) {
    resize = callback
  }
  observe() {}
  disconnect() {}
}

const Page = defineComponent({
  setup() {
    const content = useTemplateRef<HTMLElement>('content')
    const edges = useScrollEdges(content)
    return () =>
      h('div', { ref: 'content' }, [
        h('p', `${edges.canScrollLeft.value}/${edges.canScrollRight.value}`),
      ])
  },
})

const page = document.documentElement
const state = { clientWidth: 0, scrollWidth: 0, scrollX: 0 }
function size(sizes: typeof state) {
  Object.assign(state, sizes)
  for (const name of ['clientWidth', 'scrollWidth'] as const) {
    Object.defineProperty(page, name, { get: () => state[name], configurable: true })
  }
  Object.defineProperty(window, 'scrollX', { get: () => state.scrollX, configurable: true })
}

async function setup(sizes: typeof state) {
  size(sizes)
  const wrapper = mount(Page, { attachTo: document.body })
  // the template ref is set after the first render: only then the observer exists
  await nextTick()
  const shown = async () => {
    await nextTick()
    return wrapper.get('p').text()
  }
  const scrolled = () => window.dispatchEvent(new Event('scroll'))
  return { state, shown, scrolled }
}

enableAutoUnmount(afterEach)
beforeEach(() => vi.stubGlobal('ResizeObserver', FakeResizeObserver))
afterEach(() => {
  vi.unstubAllGlobals()
  size({ clientWidth: 0, scrollWidth: 0, scrollX: 0 })
})

describe('useScrollEdges', () => {
  it('has content to the right at the start, to both sides in between and only to the left at the end', async () => {
    const { state, shown, scrolled } = await setup({
      clientWidth: 500,
      scrollWidth: 900,
      scrollX: 0,
    })
    resize()
    expect(await shown()).toBe('false/true')

    state.scrollX = 120
    scrolled()
    expect(await shown()).toBe('true/true')

    state.scrollX = 400
    scrolled()
    expect(await shown()).toBe('true/false')
  })

  it('has nothing on either side if the content fits', async () => {
    const { shown } = await setup({ clientWidth: 900, scrollWidth: 900, scrollX: 0 })
    resize()
    expect(await shown()).toBe('false/false')
  })

  it('follows a change of size without any scrolling', async () => {
    const { state, shown } = await setup({ clientWidth: 900, scrollWidth: 900, scrollX: 0 })
    resize()
    expect(await shown()).toBe('false/false')

    state.scrollWidth = 1200
    resize()
    expect(await shown()).toBe('false/true')

    state.clientWidth = 1200
    resize()
    expect(await shown()).toBe('false/false')
  })

  it('follows a change of the window', async () => {
    const { state, shown } = await setup({ clientWidth: 900, scrollWidth: 900, scrollX: 0 })
    state.clientWidth = 600
    window.dispatchEvent(new Event('resize'))
    expect(await shown()).toBe('false/true')
  })

  it('does not count a fraction of a pixel at the end as more content', async () => {
    const { state, shown, scrolled } = await setup({
      clientWidth: 500,
      scrollWidth: 900,
      scrollX: 0,
    })
    state.scrollX = 399.5
    scrolled()
    expect(await shown()).toBe('true/false')
  })
})
