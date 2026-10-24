<script setup lang="ts">
import { computed, useId } from 'vue'
import { CalendarIcon } from '@lucide/vue'
import type { Attribute, AttributeValueRecord } from '@/stores/timberItems'
import AttributeField from '@/components/AttributeField.vue'
import { formatDate } from '@/utils/date'

const props = defineProps<{
  attribute: Attribute
  // Recordings for this attribute from the timber item, if any (always an array, oldest first).
  recorded: AttributeValueRecord[] | undefined
  readonly?: boolean
}>()

// A date attribute is never a series, so the last entry is the current value.
const current = computed(() => props.recorded?.slice(-1)[0])
// Shown as TT.MM.JJJJ while locked; the date input itself uses the contract format.
const recordedText = computed(() => (current.value ? formatDate(String(current.value.value)) : ''))

// Draft = "YYYY-MM-DD", straight from the date input ("" while cleared or incomplete). undefined = untouched.
const draft = defineModel<string | undefined>()

const inputId = useId()

// What the input shows: the draft if touched, otherwise the recorded value.
const inputValue = computed(() => draft.value ?? String(current.value?.value ?? ''))

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
    :readonly="readonly"
  >
    <!-- Native picker: no own parsing or validation. appearance-none makes iOS Safari respect the
         width (otherwise it keeps its own minimum width and overflows the page). The picker indicator
         of Chrome is stretched over the whole field (invisible) so a tap anywhere opens the picker;
         the icon sits on top and lets taps through. -->
    <div class="relative">
      <input
        :id="inputId"
        class="block h-[52px] w-full max-w-full min-w-0 appearance-none rounded-lg border-2 border-ink bg-paper pr-12 pl-3 font-semibold [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:size-full [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-date-and-time-value]:text-left"
        :class="inputValue === '' ? 'text-transparent' : 'text-ink'"
        type="date"
        :value="inputValue"
        @input="onInput"
      />
      <!-- Own placeholder: browsers differ in what an empty date input shows (blank, format hint, today). -->
      <span
        v-if="inputValue === ''"
        class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-semibold text-mute"
        >{{ attribute.name }} wählen …</span
      >
      <CalendarIcon
        class="pointer-events-none absolute top-1/2 right-3 size-6 -translate-y-1/2 text-ink"
        aria-hidden="true"
      />
    </div>
  </AttributeField>
</template>
