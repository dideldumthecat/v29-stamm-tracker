import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

import { isReadableTags } from '@/listFilters'

// "Kennung" searches while typing. The field keeps its own text (the URL would round it, and the field must not be
// re-rendered under the typing hand); the URL stays the only source of the filter and the field follows it.
const AUTO_SEARCH_DELAY = 500

/**
 * The behaviour of the "Kennung" field of every list: `current` is the filter in the URL, `apply` writes a new one
 * (as `router.replace` if `replace` is set, otherwise as `router.push`), `field` is the input element.
 * `readable` says which input is complete enough to search while typing; the text fields of the filters in the
 * pop-ups (`FilterField`) use this too, with their own rule.
 */
export function useTagsField(options: {
  current: () => string
  apply: (tags: string, replace: boolean) => void
  field: Ref<HTMLInputElement | null>
  readable?: (text: string) => boolean
}) {
  const { current, apply, field, readable = isReadableTags } = options
  const tagsInput = ref(current())
  let timer: ReturnType<typeof setTimeout> | undefined
  function cancelTagsTimer() {
    clearTimeout(timer)
    timer = undefined
  }
  function onTagsInput() {
    cancelTagsTimer()
    const text = tagsInput.value.trim()
    if (!text) return apply('', false)
    // Only complete input is sent on its own; "100-" waits for Enter or leaving the field. A pause is a replace,
    // so that searching does not fill the browser history; the first filter after "none" is a step of its own.
    if (!readable(text)) return
    timer = setTimeout(() => {
      timer = undefined
      apply(text, current() !== '')
    }, AUTO_SEARCH_DELAY)
  }
  // Enter and leaving the field apply at once, whatever was typed
  function applyTagsNow() {
    cancelTagsTimer()
    apply(tagsInput.value.trim(), false)
  }
  function clearTags() {
    cancelTagsTimer()
    tagsInput.value = ''
    apply('', false)
    field.value?.focus()
  }
  // A pause that is still running or text that was never applied must not bring the old filter back.
  function resetTagsInput() {
    cancelTagsTimer()
    tagsInput.value = ''
  }
  // The URL changed from outside (back button, reset): the field shows it and a waiting pause is dropped.
  // Our own change has the same text as the field (apart from blanks), so typing is not disturbed.
  watch(current, (tags) => {
    if (tagsInput.value.trim() === tags) return
    cancelTagsTimer()
    tagsInput.value = tags
  })
  onBeforeUnmount(cancelTagsTimer)

  return { tagsInput, onTagsInput, applyTagsNow, clearTags, resetTagsInput }
}
