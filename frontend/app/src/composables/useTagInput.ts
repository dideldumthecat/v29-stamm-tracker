import { computed, ref } from 'vue'
import { TAG_DIGITS } from '@v29/shared/tag'
import { TAG_MAX_NUMBER } from '@/config/constants'
import { isValidTagNumber as checkTagNumber } from '@/utils/tag'

/** Plaque number typed on the NumPad, counter principle: a leading zero is ignored. */
export function useTagInput() {
  const tagInput = ref('')
  const tagNumber = computed(() => Number(tagInput.value))
  const isValidTagNumber = computed(() => checkTagNumber(tagNumber.value))
  const isTagNumberTooHigh = computed(() => tagNumber.value > TAG_MAX_NUMBER)

  function onDigit(digit: string) {
    if ((tagInput.value === '' && digit === '0') || tagInput.value.length >= TAG_DIGITS) {
      return
    }
    tagInput.value += digit
  }

  function onClear() {
    tagInput.value = ''
  }

  function onDelete() {
    tagInput.value = tagInput.value.slice(0, -1)
  }

  return { tagInput, tagNumber, isValidTagNumber, isTagNumberTooHigh, onDigit, onClear, onDelete }
}
