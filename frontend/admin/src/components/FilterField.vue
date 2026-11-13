<script setup lang="ts">
import { useTemplateRef } from 'vue'

import { useTagsField } from '@/tagsField'

/**
 * A text input of a column filter that behaves like the field "Kennung": it keeps its own text, applies a complete input
 * 500 ms after the last keystroke (`replace`), and Enter or leaving the field at once. Input that is not readable is never passed on.
 */
const props = defineProps<{ current: string; readable: (text: string) => boolean }>()
const emit = defineEmits<{ apply: [text: string, replace: boolean] }>()

const field = useTemplateRef<HTMLInputElement>('field')
const { tagsInput, onTagsInput, applyTagsNow } = useTagsField({
  current: () => props.current,
  apply: (text, replace) => {
    if (!text || props.readable(text)) emit('apply', text, replace)
  },
  field,
  readable: (text) => props.readable(text),
})

defineExpose({ focus: () => field.value?.focus() })
</script>

<template>
  <input
    ref="field"
    v-model="tagsInput"
    autocomplete="off"
    class="mt-1 h-11 w-full rounded-lg border-2 border-dim bg-transparent px-3 text-base text-ink placeholder:text-dim focus:bg-paper aria-invalid:border-ink aria-invalid:bg-paper"
    :aria-invalid="tagsInput.trim() !== '' && !readable(tagsInput.trim())"
    @input="onTagsInput"
    @keydown.enter="applyTagsNow"
    @change="applyTagsNow"
  />
</template>
