import { ref } from 'vue'

/**
 * Where the dragged item lands: the number of the others whose middle lies above `position` (the middle of the dragged item at the
 * pointer's place). `middles` are those of all items before the drag, in page coordinates.
 */
export function dropIndex(middles: number[], from: number, position: number): number {
  return middles.filter((middle, index) => index !== from && middle < position).length
}

interface Drag {
  from: number
  to: number
  /** How far the pointer has moved since the start (the dragged item follows). */
  delta: number
  /** Height of the dragged item with the gap behind it: the ones it passes make room by that much. */
  height: number
}

/**
 * Sorting a list by dragging a handle, without a library: pointer events on the window, the items are moved by `transform` while
 * dragging (the DOM keeps its order, so the pointer keeps its target) and `onMove(from, to)` is called once on release. Positions are
 * measured in page coordinates, so a page that scrolls meanwhile (the pointer near the window edge scrolls it) is no problem.
 * Escape and a cancelled pointer drop nothing. The handle needs `touch-action: none` so that a finger drags instead of scrolling.
 */
export function useReorder(onMove: (from: number, to: number) => void) {
  const drag = ref<Drag | null>(null)

  function start(event: PointerEvent, from: number, items: () => HTMLElement[]) {
    if (event.button !== 0 || drag.value) return
    // Keeps the page from selecting text while dragging
    event.preventDefault()
    const rects = items().map((item) => item.getBoundingClientRect())
    const middles = rects.map((rect) => rect.top + rect.height / 2 + window.scrollY)
    // The space between two items counts into the room an item makes (the options have a gap, the preview has none)
    const gap = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0
    const startY = event.clientY + window.scrollY
    let clientY = event.clientY
    let frame = 0

    function update() {
      const delta = clientY + window.scrollY - startY
      drag.value = {
        from,
        to: dropIndex(middles, from, middles[from] + delta),
        delta,
        height: rects[from].height + gap,
      }
    }
    // Near the top or bottom edge of the window the page scrolls on, also while the pointer rests
    function scroll() {
      const edge = 80
      if (clientY < edge) window.scrollBy(0, -Math.ceil((edge - clientY) / 4))
      else if (clientY > window.innerHeight - edge) {
        window.scrollBy(0, Math.ceil((clientY - (window.innerHeight - edge)) / 4))
      }
      update()
      frame = requestAnimationFrame(scroll)
    }
    const move = (moved: PointerEvent) => ((clientY = moved.clientY), update())
    const key = (pressed: KeyboardEvent) => pressed.key === 'Escape' && finish(false)
    function finish(drop: boolean) {
      const result = drag.value
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
      cancelAnimationFrame(frame)
      drag.value = null
      if (drop && result && result.to !== result.from) onMove(result.from, result.to)
    }
    const up = () => finish(true)
    const cancel = () => finish(false)

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
    update()
    frame = requestAnimationFrame(scroll)
  }

  /** The style of item `index` while dragging: the dragged one follows the pointer, the ones between make room. */
  function style(index: number) {
    const current = drag.value
    if (!current) return undefined
    if (index === current.from) {
      return {
        transform: `translateY(${current.delta}px)`,
        zIndex: 10,
        position: 'relative' as const,
      }
    }
    const shift =
      current.from < index && index <= current.to
        ? -current.height
        : current.to <= index && index < current.from
          ? current.height
          : 0
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    return {
      transform: `translateY(${shift}px)`,
      transition: reduced ? undefined : 'transform 150ms',
    }
  }

  return { drag, start, style }
}
