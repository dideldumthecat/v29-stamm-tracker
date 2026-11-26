import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'

/** The arrow is a 14 px square turned by 45°: its middle is 7 px from its own edge. */
const ARROW_HALF_WIDTH = 7
/** `right` of an absolutely placed arrow counts from the inner edge of the card, so the 1 px border of the card is not part of it. */
const CARD_BORDER = 1
/** Distance of the arrow from the right edge of the card before it is measured (and while the button is not there). */
const ARROW_RIGHT_DEFAULT = 32

/** `right` of the arrow so that its middle is over the middle of the button; the card and the button are given as `DOMRect`s. */
export const arrowRightOf = (
  card: Pick<DOMRect, 'right'>,
  button: Pick<DOMRect, 'left' | 'width'>,
) => Math.round(card.right - (button.left + button.width / 2) - ARROW_HALF_WIDTH - CARD_BORDER)

/**
 * The card of "… hinzufügen" below the button of the results bar (template refs `addButton` and `addCard`). Its arrow points at the middle of
 * the real button: the button sits at the right edge of the row, the card is as wide as the row, so the arrow stands at the distance of the
 * middle of the button from the right edge of the card. Call `placeArrow` once the card is on the screen; it follows the window while it is
 * resized. (CSS alone does not do it: an anchor has to lie inside the containing block of the arrow, and the button is in the bar, the card
 * beside it.)
 */
export function useAddCard() {
  const addButton = useTemplateRef<HTMLButtonElement>('addButton')
  const addCard = useTemplateRef<HTMLElement>('addCard')
  const arrowRight = ref(ARROW_RIGHT_DEFAULT)

  function placeArrow() {
    if (!addButton.value || !addCard.value) return
    const button = addButton.value.getBoundingClientRect()
    if (!button.width) return
    arrowRight.value = arrowRightOf(addCard.value.getBoundingClientRect(), button)
  }
  onMounted(() => window.addEventListener('resize', placeArrow))
  onBeforeUnmount(() => window.removeEventListener('resize', placeArrow))

  return { addCard, arrowRight, placeArrow }
}
