import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * Scrolls a sideways scrolling element to its right end once it is shown (the newest week of a chart) and keeps track of whether
 * older content is still hidden on the left.
 */
export function useScrollStart(element: Ref<HTMLElement | null>) {
  const hiddenLeft = ref(false)
  const update = () => (hiddenLeft.value = !!element.value && element.value.scrollLeft > 1)

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

  return { hiddenLeft }
}
