<script setup lang="ts">
import { computed, useId } from 'vue'
import { CalendarIcon } from '@lucide/vue'
import type { Attribute, AttributeValueRecord } from '@/stores/timberItems'
import AttributeField from '@/components/AttributeField.vue'
import { formatDate, formatMonth } from '@v29/shared/attributes'

const props = defineProps<{
  attribute: Attribute
  // Recordings for this attribute from the timber item, if any (always an array, oldest first).
  recorded: AttributeValueRecord[] | undefined
  readonly?: boolean
  // Beam only: the value comes from the parent (shown as a hint, still overwritable).
  inherited?: boolean
  // Set by the parent after a failed save (month only: typed text where the browser has no picker).
  error?: string
  // Default 'date'. MonthAttributeField passes 'month'.
  type?: 'date' | 'month'
  // Resolved by the caller, so the field needs no store.
  userName: (userId: string) => string
}>()

const type = computed(() => props.type ?? 'date')
// Desktop Firefox and Safari fall back to a plain text field for type="month".
const hasPicker = computed(() => {
  const probe = document.createElement('input')
  probe.type = type.value
  return probe.type === type.value
})

// A date or month attribute is never a series, so the last entry is the current value.
const current = computed(() => props.recorded?.slice(-1)[0])
// Shown as TT.MM.JJJJ (or MM/JJJJ) while locked; the input itself uses the contract format.
const format = computed(() => (type.value === 'month' ? formatMonth : formatDate))
const recordedText = computed(() =>
  current.value ? format.value(String(current.value.value)) : '',
)

// Draft = "YYYY-MM-DD" / "YYYY-MM", straight from the input ("" while cleared or incomplete). undefined = untouched.
const draft = defineModel<string | undefined>()

const inputId = useId()
const errorId = useId()

// What the input shows: the draft if touched, otherwise the recorded value.
const inputValue = computed(() => draft.value ?? String(current.value?.value ?? ''))

function onInput(event: Event) {
  draft.value = (event.target as HTMLInputElement).value
}
</script>

<template>
  <AttributeField
    :name="attribute.name"
    :description="attribute.description"
    description-above
    :label-for="inputId"
    :record="current"
    :recorded-by="current && userName(current.user_id)"
    :locked-text="recordedText"
    :readonly="readonly"
    :inactive="!attribute.active"
    :inherited="inherited"
  >
    <!-- Native picker: no own parsing or validation. appearance-none makes iOS Safari respect the
         width (otherwise it keeps its own minimum width and overflows the page). The picker indicator
         of Chrome is stretched over the whole field (invisible) so a tap anywhere opens the picker;
         the icon sits on top and lets taps through. iOS Safari puts the value at the top with its own
         margin; no margin plus a line height of the inner height (52px minus border) centres it. -->
    <div class="relative">
      <input
        :id="inputId"
        class="block h-[52px] w-full max-w-full min-w-0 appearance-none rounded-lg border-2 border-ink bg-paper py-0 pr-12 pl-3 leading-[48px] font-semibold [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:size-full [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-date-and-time-value]:m-0 [&::-webkit-date-and-time-value]:text-left"
        :class="inputValue === '' ? 'text-transparent' : 'text-ink'"
        :type="type"
        :value="inputValue"
        :aria-invalid="error ? true : undefined"
        :aria-describedby="error ? errorId : undefined"
        @input="onInput"
      />
      <!-- Own placeholder: browsers differ in what an empty date input shows (blank, format hint, today). -->
      <span
        v-if="inputValue === ''"
        class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-semibold text-mute"
        >{{ hasPicker ? `${attribute.name} wählen …` : 'JJJJ-MM, zum Beispiel 2026-10' }}</span
      >
      <CalendarIcon
        v-if="hasPicker"
        class="pointer-events-none absolute top-1/2 right-3 size-6 -translate-y-1/2 text-ink"
        aria-hidden="true"
      />
    </div>
    <span v-if="error && !readonly" :id="errorId" class="text-sm font-semibold" role="alert">{{
      error
    }}</span>
  </AttributeField>
</template>
