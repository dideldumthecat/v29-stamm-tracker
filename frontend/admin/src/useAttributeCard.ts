import { nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import type { AdminAttribute } from '@/api/contract'

import { NEW_ATTRIBUTE, type AttributesQuery } from '@/attributes'
import type { useAttributes } from '@/useAttributes'

/**
 * Where the card of the page "Merkmale" stands and how the page scrolls to the selection (template refs `left`, the preview column, and
 * `right`, the card column; the preview `list` comes from `useAttributes`).
 *
 * From lg on the card stands beside the selected attribute: its top is the top of the selected field of the preview (or of the placeholder
 * of a new one), and a small arrow at its left edge points at the middle of that field. It does not stick and is as high as its content; the
 * page scrolls. Measured (not computed from the order) because the fields differ in height: after every change of the selection, the order
 * and the view, and whenever the preview or the column changes size. offsetTop and offsetHeight ignore the transform of a field that is being
 * dragged. Below lg the card lies under the preview, is as high as its content, and `reveal` scrolls to its beginning.
 */
export function useAttributeCard(source: ReturnType<typeof useAttributes>) {
  const { list, status, visible, query, isNew, selected, newStep, livePreview, createdId, go } =
    source
  const left = useTemplateRef<HTMLElement>('left')
  const right = useTemplateRef<HTMLElement>('right')
  const cardTop = ref(0)
  /** The middle of the selected field, from the top of the card; null while nothing is selected (no arrow). */
  const arrowY = ref<number | null>(null)
  function align() {
    const target = list.value?.querySelector<HTMLElement>('[aria-current="true"]')
    const column = left.value
    if (!target || !column) {
      cardTop.value = 0
      arrowY.value = null
      return
    }
    let top = 0
    for (
      let el: HTMLElement | null = target;
      el && el !== column;
      el = el.offsetParent as HTMLElement | null
    ) {
      top += el.offsetTop
    }
    cardTop.value = top
    arrowY.value = target.offsetHeight / 2
  }
  watch(
    () => [visible.value, query.value.attribute, newStep.value, !!livePreview.value, status.value],
    align,
    { flush: 'post' },
  )
  let observer: ResizeObserver | undefined
  watch(
    [list, left],
    () => {
      observer?.disconnect()
      // jsdom has no ResizeObserver
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(align)
        for (const element of [list.value, left.value]) if (element) observer.observe(element)
      }
      align()
    },
    { flush: 'post' },
  )
  onBeforeUnmount(() => observer?.disconnect())

  const isNarrow = () => window.matchMedia?.('(max-width: 1023px)').matches ?? false
  async function reveal(next: Partial<AttributesQuery>) {
    await go(next)
    await nextTick()
    // The question "Änderungen verwerfen?" may have kept the page where it was
    if (query.value.attribute !== (next.attribute ?? null)) return
    // From lg on the watch below scrolls (to the field); only below the preview (narrow) the card has to be scrolled to
    if (!isNarrow()) return
    right.value?.scrollIntoView?.({ block: 'start', behavior: 'auto' })
  }
  // From lg on every change of the selection (click, keyboard, the page loaded with it in the URL, a link, back and forward) scrolls the page
  // so that the field starts under the header and the bar (`scroll-padding-top`, like any other scroll target); the card beside it starts
  // there too. Smooth, at once with reduced motion. Only a selection that actually changes: while the question "Änderungen verwerfen?" holds
  // it back nothing happens, and after "Anlegen" the new field is where its placeholder was, so the page stays.
  // The browser would put the page back where it was for back, forward and reload, after this has scrolled: while this page is open the
  // scrolling is done here.
  const restoration = history.scrollRestoration
  history.scrollRestoration = 'manual'
  onBeforeUnmount(() => (history.scrollRestoration = restoration))
  watch(
    // One string: a new array each time would fire at every change of the attributes (after a move or a save), not of the selection
    () => `${status.value} ${isNew.value ? NEW_ATTRIBUTE : selected.value?.id}`,
    async () => {
      if (status.value !== 'ready' || isNarrow()) return
      if (selected.value && selected.value.id === createdId.value) {
        createdId.value = null
        return
      }
      // The bar of the results publishes its height (`--sticky-bar-height`, part of the scroll padding) after this watcher has run
      await nextTick()
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      list.value
        ?.querySelector<HTMLElement>('[aria-current="true"]')
        ?.scrollIntoView?.({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
    },
    { flush: 'post' },
  )
  const select = (attribute: AdminAttribute) =>
    attribute.id === query.value.attribute ? undefined : reveal({ attribute: attribute.id })
  const startNew = () => (isNew.value ? undefined : reveal({ attribute: NEW_ATTRIBUTE }))

  return { cardTop, arrowY, select, startNew }
}
