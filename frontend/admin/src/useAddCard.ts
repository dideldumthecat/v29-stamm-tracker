import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'

/**
 * The card of "… hinzufügen" below the button of the results bar (template refs `addButton` and `addCard`). Its arrow points at the middle of
 * the real button: its distance from the right edge of the card, less its own half width (14 px) and the border of the card. The button sits at the
 * right edge of the row, the card is as wide as the row. Call `placeArrow` once the card is on the screen; it follows the window while it is resized.
 */
export function useAddCard() {
  const addButton = useTemplateRef<HTMLButtonElement>('addButton')
  const addCard = useTemplateRef<HTMLElement>('addCard')
  const arrowRight = ref(32)

  function placeArrow() {
    if (!addButton.value || !addCard.value) return
    const button = addButton.value.getBoundingClientRect()
    const card = addCard.value.getBoundingClientRect()
    if (!button.width) return
    arrowRight.value = Math.round(card.right - (button.left + button.width / 2) - 7 - 1)
  }
  onMounted(() => window.addEventListener('resize', placeArrow))
  onBeforeUnmount(() => window.removeEventListener('resize', placeArrow))

  return { addCard, arrowRight, placeArrow }
}
