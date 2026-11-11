import { onBeforeUnmount, watch, type Ref } from 'vue'

/**
 * Publishes the width or height of an element as a CSS variable on `<html>` (main.css adds them to the scroll padding of the page,
 * so that a focused element does not end up under what sticks to the window). Measured again when the element changes size,
 * removed when it goes away.
 */
export function useSizeVariable(
  element: Ref<HTMLElement | null>,
  name: string,
  side: 'width' | 'height',
) {
  const style = document.documentElement.style
  let observer: ResizeObserver | undefined
  function stop() {
    observer?.disconnect()
    observer = undefined
    style.removeProperty(name)
  }
  watch(
    element,
    (target) => {
      stop()
      if (!target) return
      const measure = () =>
        style.setProperty(name, `${side === 'width' ? target.offsetWidth : target.offsetHeight}px`)
      measure()
      // The guard is for jsdom, which has no ResizeObserver
      if (typeof ResizeObserver === 'undefined') return
      observer = new ResizeObserver(measure)
      observer.observe(target)
    },
    { flush: 'post' },
  )
  onBeforeUnmount(stop)
}
