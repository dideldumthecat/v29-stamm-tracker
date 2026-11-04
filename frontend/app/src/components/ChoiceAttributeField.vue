<script setup lang="ts">
import { computed, useId } from 'vue'
import { ChevronDownIcon } from '@lucide/vue'
import type { Attribute, AttributeOption, AttributeValueRecord } from '@/stores/timberItems'
import AttributeField from '@/components/AttributeField.vue'
import { bySortOrder } from '@/utils/sort'

const props = defineProps<{
  attribute: Attribute
  // Recordings for this attribute from the timber item, if any (always an array, oldest first).
  recorded: AttributeValueRecord[] | undefined
  readonly?: boolean
  // Beam only: the value comes from the parent (shown as a hint, still overwritable).
  inherited?: boolean
}>()

// A choice attribute is never a series, so the last entry is the current value.
const current = computed(() => props.recorded?.slice(-1)[0])

// Draft selection (option id). undefined = untouched; the parent compares it with `recorded`.
const draft = defineModel<string | undefined>()

const selectId = useId()

// An inactive option that is recorded stays readable, marked as no longer selectable.
// Plain text: <option> takes nothing else.
const labelOf = (option: AttributeOption) =>
  option.active ? option.label : `${option.label} (deaktiviert)`

const recordedOption = computed(() =>
  props.attribute.options.find((candidate) => candidate.id === current.value?.value),
)

// Inactive options are no longer offered. Exception: the recorded one, otherwise the unlocked
// select would show nothing although a value exists.
const sortedOptions = computed(() =>
  props.attribute.options
    .filter((option) => option.active || option.id === current.value?.value)
    .sort(bySortOrder),
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
    :description="attribute.description"
    description-above
    :label-for="selectId"
    :record="current"
    :locked-text="recordedOption?.label ?? ''"
    :locked-inactive="recordedOption !== undefined && !recordedOption.active"
    :readonly="readonly"
    :inactive="!attribute.active"
    :inherited="inherited"
  >
    <!-- Native arrow removed (appearance-none) so the icon set's chevron can replace it. -->
    <div class="relative">
      <!-- Muted text while nothing is selected, like a placeholder. -->
      <select
        :id="selectId"
        class="h-[52px] w-full appearance-none rounded-lg border-2 border-ink bg-paper pr-12 pl-3 font-semibold"
        :class="selectedOptionId === '' ? 'text-mute' : 'text-ink'"
        :value="selectedOptionId"
        @change="onChange"
      >
        <option value="">{{ attribute.name }} wählen …</option>
        <option
          v-for="option in sortedOptions"
          :key="option.id"
          :value="option.id"
          :class="{ 'line-through': !option.active }"
        >
          {{ labelOf(option) }}
        </option>
      </select>
      <ChevronDownIcon
        class="pointer-events-none absolute top-1/2 right-3 size-6 -translate-y-1/2 text-ink"
        aria-hidden="true"
      />
    </div>
  </AttributeField>
</template>
