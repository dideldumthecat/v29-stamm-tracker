import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

/**
 * Whether the page holds more content to its left and to its right kept up to date while it scrolls and while the window
 * or the content change size. `content` is the element that makes the page wider (a template ref, it may come and go).
 */
export function useScrollEdges(content: Ref<HTMLElement | null>) {
  const canScrollLeft = ref(false)
  const canScrollRight = ref(false)

  function update() {
    const page = document.documentElement
    canScrollLeft.value = !!content.value && window.scrollX > 0
    // One pixel of room: scrollX is fractional on scaled screens and never quite reaches the end
    canScrollRight.value =
      !!content.value && window.scrollX + page.clientWidth < page.scrollWidth - 1
  }

  let observer: ResizeObserver | undefined
  // After the update of the DOM, so that the page already has its new width
  watch(
    content,
    (element) => {
      observer?.disconnect()
      // The guard is for jsdom, which has no ResizeObserver. The content is watched, not the window: sorting and filtering change its width.
      observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
      if (element) observer?.observe(element)
      update()
    },
    { flush: 'post' },
  )
  window.addEventListener('scroll', update, { passive: true })
  window.addEventListener('resize', update)
  onBeforeUnmount(() => {
    window.removeEventListener('scroll', update)
    window.removeEventListener('resize', update)
    observer?.disconnect()
  })

  return { canScrollLeft, canScrollRight }
}
