import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * Scrolls a sideways scrolling element to its right end once it is shown (the newest week of a chart) and keeps track of whether
 * content is hidden on its left (older weeks) and on its right.
 */
export function useScrollStart(element: Ref<HTMLElement | null>) {
  const hiddenLeft = ref(false)
  const hiddenRight = ref(false)
  function update() {
    const target = element.value
    hiddenLeft.value = !!target && target.scrollLeft > 1
    // One pixel of room: scrollLeft is fractional on scaled screens and never quite reaches the end
    hiddenRight.value = !!target && target.scrollLeft + target.clientWidth < target.scrollWidth - 1
  }

  let observer: ResizeObserver | undefined
  onMounted(() => {
    const target = element.value
    if (!target) return
    target.scrollLeft = target.scrollWidth
    update()
    target.addEventListener('scroll', update, { passive: true })
    // The guard is for jsdom, which has no ResizeObserver
    observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
    observer?.observe(target)
  })
  onBeforeUnmount(() => {
    element.value?.removeEventListener('scroll', update)
    observer?.disconnect()
  })

  return { hiddenLeft, hiddenRight }
}
