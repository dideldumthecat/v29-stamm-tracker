<script setup lang="ts">
import { computed, useId } from 'vue'
import type { Attribute, AttributeValueRecord } from '@/stores/timberItems'
import AttributeField from '@/components/AttributeField.vue'

const props = defineProps<{
  attribute: Attribute
  // Recordings for this attribute from the timber item, if any (always an array, oldest first).
  recorded: AttributeValueRecord[] | undefined
}>()

// A choice attribute is never a series, so the last entry is the current value.
const current = computed(() => props.recorded?.slice(-1)[0])

// Draft selection (option id). undefined = untouched; the parent compares it with `recorded`.
const draft = defineModel<string | undefined>()

const selectId = useId()

const recordedLabel = computed(
  () => props.attribute.options.find((option) => option.id === current.value?.value)?.label,
)

// What the select shows: the draft if touched, otherwise the recorded value.
const selectedOptionId = computed(
  () => draft.value ?? (current.value?.value as string | undefined) ?? '',
)

function onChange(event: Event) {
  draft.value = (event.target as HTMLSelectElement).value
}
</script>

<template>
  <AttributeField
    :name="attribute.name"
    :label-for="selectId"
    :record="current"
    :locked-text="recordedLabel ?? ''"
  >
    <!-- Muted text while nothing is selected, like a placeholder. -->
    <select
      :id="selectId"
      class="h-[52px] w-full rounded-lg border-2 border-ink bg-paper px-3 font-semibold"
      :class="selectedOptionId === '' ? 'text-mute' : 'text-ink'"
      :value="selectedOptionId"
      @change="onChange"
    >
      <option value="">{{ attribute.name }} wählen …</option>
      <option v-for="option in attribute.options" :key="option.id" :value="option.id">
        {{ option.label }}
      </option>
    </select>
  </AttributeField>
</template>
