<script setup lang="ts">
import { computed, useId } from 'vue'
import type { Attribute, AttributeValueRecord } from '@/stores/timberItems'
import AttributeField from '@/components/AttributeField.vue'
import { formatDate } from '@/utils/date'

const props = defineProps<{
  attribute: Attribute
  // Recordings for this attribute from the timber item, if any (always an array, oldest first).
  recorded: AttributeValueRecord[] | undefined
  // Shown below the input; set by the parent after a failed save.
  error?: string
}>()

// A date attribute is never a series, so the last entry is the current value.
const current = computed(() => props.recorded?.slice(-1)[0])
const recordedText = computed(() => (current.value ? formatDate(String(current.value.value)) : ''))

// Draft = the text as typed ("8.9.2026"). It is parsed by the parent, so half-typed input survives.
// undefined = untouched.
const draft = defineModel<string | undefined>()

const inputId = useId()
const errorId = useId()

function onInput(event: Event) {
  draft.value = (event.target as HTMLInputElement).value
}
</script>

<template>
  <AttributeField
    :name="attribute.name"
    :label-for="inputId"
    :record="current"
    :locked-text="recordedText"
  >
    <input
      :id="inputId"
      class="h-[52px] w-full rounded-lg border-2 border-ink bg-paper px-3"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      placeholder="TT.MM.JJJJ"
      :value="draft ?? recordedText"
      :aria-invalid="error ? true : undefined"
      :aria-describedby="error ? errorId : undefined"
      @input="onInput"
    />
    <span v-if="error" :id="errorId" class="text-sm font-semibold" role="alert">{{ error }}</span>
  </AttributeField>
</template>
