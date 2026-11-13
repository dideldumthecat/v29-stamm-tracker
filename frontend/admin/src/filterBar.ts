import { nextTick, ref, type Ref } from 'vue'

/**
 * What the filter bar and the chips of a list do together, for the lists of stems, beams and the activity: which pop-up is open,
 * opening one from a chip, and where the focus goes after a chip has been removed. The buttons are found by `data-filter`
 * (`FilterButton`), the chips by `data-chip` (`FilterChips`); "tags" is the field "Kennung".
 */
export function useFilterBar(tagsField: Ref<HTMLInputElement | null>) {
  const openId = ref<string | null>(null)
  const find = (attribute: 'filter' | 'chip', id: string) =>
    document.querySelector<HTMLElement>(`[data-${attribute}="${CSS.escape(id)}"]`)

  function setOpen(id: string, open: boolean) {
    if (open) openId.value = id
    else if (openId.value === id) openId.value = null
  }

  /** A click on a chip: the field takes the focus, any other filter opens its pop-up (the page scrolls to the button if need be). */
  function openFilter(id: string) {
    if (id === 'tags') return tagsField.value?.focus()
    // The scroll padding of the page keeps the button clear of the header and the bar
    find('filter', id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    openId.value = id
  }

  // After a removal the focus goes to the chip that took its place, without one to the button of the filter (the field "Kennung").
  // The chips may be gone for a moment (the activity loads again): then `waitForList` holds the focus back until the view
  // calls `settle()` with the list back; if the chip is not there by then, the button gets the focus.
  let pending: { next?: string; id: string } | null = null
  function focusAfterRemove(chipIds: string[], id: string, waitForList = false) {
    pending = { next: chipIds[chipIds.indexOf(id) + 1], id }
    void nextTick(() => settle(!waitForList))
  }
  function settle(final = true) {
    if (!pending) return
    const { next, id } = pending
    const chip = next ? find('chip', next) : null
    if (next && !chip && !final) return
    pending = null
    const fallback = id === 'tags' ? tagsField.value : find('filter', id)
    ;(chip ?? fallback)?.focus()
  }

  return { openId, setOpen, openFilter, focusAfterRemove, settle }
}
