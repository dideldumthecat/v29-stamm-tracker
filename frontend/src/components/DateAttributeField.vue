<script setup lang="ts">
import { computed, useId } from 'vue'
import type { Attribute, AttributeValueRecord } from '@/stores/timberItems'
import AttributeField from '@/components/AttributeField.vue'
import { formatDate } from '@/utils/date'

const props = defineProps<{
  attribute: Attribute
  // Recordings for this attribute from the timber item, if any (always an array, oldest first).
  recorded: AttributeValueRecord[] | undefined
}>()

// A date attribute is never a series, so the last entry is the current value.
const current = computed(() => props.recorded?.slice(-1)[0])
// Shown as TT.MM.JJJJ while locked; the date input itself uses the contract format.
const recordedText = computed(() => (current.value ? formatDate(String(current.value.value)) : ''))

// Draft = "YYYY-MM-DD", straight from the date input ("" while cleared or incomplete). undefined = untouched.
const draft = defineModel<string | undefined>()

const inputId = useId()

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
    <!-- Native picker: no own parsing or validation. h-[52px] is as tall as the other fields (gloves). -->
    <input
      :id="inputId"
      class="h-[52px] w-full rounded-lg border-2 border-ink bg-paper px-3 [&::-webkit-date-and-time-value]:text-left"
      type="date"
      :value="draft ?? String(current?.value ?? '')"
      @input="onInput"
    />
  </AttributeField>
</template>
