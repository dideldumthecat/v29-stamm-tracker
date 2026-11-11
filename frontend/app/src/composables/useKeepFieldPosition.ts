import { nextTick, watch, type Ref } from 'vue'

/** How far to scroll so that an element whose top edge moved from `before` to `after` is back where it was. */
export const scrollDistance = (before: number, after: number) => after - before

/**
 * Keeps the field of the last input where it is on screen when fields above it appear or disappear
 * (`hidden_when`, attributes by kind): otherwise it would slip away from under the finger.
 *
 * container: the scroll container. layout: changes whenever the shown fields change.
 * Fields are found by `data-field`, not by element: a field that turns read-only is a new element.
 */
export function useKeepFieldPosition(container: Ref<HTMLElement | null>, layout: () => unknown) {
  let anchorId: string | null = null
  const topOf = (id: string) =>
    container.value?.querySelector(`[data-field="${id}"]`)?.getBoundingClientRect().top

  // Runs before the page is updated (default flush), so the old position can still be measured.
  watch(layout, async () => {
    const id = anchorId
    const before = id === null ? undefined : topOf(id)
    if (id === null || before === undefined) {
      return
    }
    await nextTick()
    const after = topOf(id)
    // No animation; at the top or bottom end the browser simply stops.
    if (after !== undefined && container.value) {
      container.value.scrollTop += scrollDistance(before, after)
    }
  })

  return {
    /** The field the next change belongs to; null = the next change scrolls on its own (or not at all). */
    setAnchor(attributeId: string | null) {
      anchorId = attributeId
    },
  }
}
