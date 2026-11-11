<script setup lang="ts">
import { computed, ref, useId, useTemplateRef } from 'vue'
import { XIcon } from '@lucide/vue'
import type { Attribute, AttributeValueRecord } from '@/stores/timberItems'
import type { AttributeValue } from '@v29/shared/contract'
import AttributeField from '@/components/AttributeField.vue'
import { formatNumber } from '@v29/shared/attributes'
import { NUMBER_ERROR, parseNumber } from '@/utils/attributeDraft'
import { formatDateTime } from '@/utils/date'

/**
 * Number attribute. Without `is_series`: one value, locked once recorded (like choice).
 * With `is_series` (e.g. moisture): earlier measurements as a list, new ones are only appended.
 */
const props = defineProps<{
  attribute: Attribute
  // Recordings for this attribute from the timber item, if any (always an array, oldest first).
  recorded: AttributeValueRecord[] | undefined
  // Set by the parent after a failed save.
  error?: string
  // No pencil and no input: inactive attribute, or a stem split into beams.
  readonly?: boolean
  // Beam only: the value comes from the parent (shown as a hint, still overwritable).
  inherited?: boolean
  // Resolved by the caller, so the field needs no store.
  userName: (userId: string) => string
}>()

// Text as typed ("34,5"); parsed by the parent. undefined = untouched.
// Series: the text not yet added with "Hinzufügen".
const draft = defineModel<string | undefined>()
// Series only: new values added so far, oldest first, still unsaved.
const added = defineModel<AttributeValue[]>('added', { default: () => [] })

const inputId = useId()
const errorId = useId()
const input = useTemplateRef<HTMLInputElement>('input')

const current = computed(() => props.recorded?.slice(-1)[0])
const unit = computed(() => props.attribute.unit ?? '')
const withUnit = (value: AttributeValue) =>
  [formatNumber(Number(value)), unit.value].join(' ').trim()

const recordedText = computed(() =>
  current.value ? formatNumber(Number(current.value.value)) : '',
)
// Newest first, as in the prototype.
const oldValues = computed(() => [...(props.recorded ?? [])].reverse())
const newValues = computed(() => added.value.map((value, index) => ({ value, index })).reverse())

// "Hinzufügen" can fail on its own, before any save; cleared on the next keystroke.
const addError = ref<string>()
const shownError = computed(() => addError.value ?? props.error)

function onInput(event: Event) {
  addError.value = undefined
  draft.value = (event.target as HTMLInputElement).value
}

function add() {
  const text = (draft.value ?? '').trim()
  if (text === '') {
    return
  }
  const value = parseNumber(text)
  if (value === null) {
    addError.value = NUMBER_ERROR
    return
  }
  added.value = [...added.value, value]
  draft.value = ''
  // Keep the keyboard open for the next measurement.
  input.value?.focus()
}

function remove(index: number) {
  added.value = added.value.filter((_, position) => position !== index)
}
</script>

<template>
  <AttributeField
    :name="attribute.name"
    :description="attribute.description"
    :label-for="inputId"
    :record="attribute.is_series ? undefined : current"
    :recorded-by="current && userName(current.user_id)"
    :locked-text="withUnit(current?.value ?? '')"
    :readonly="readonly"
    :inactive="!attribute.active"
    :inherited="inherited"
  >
    <div v-if="newValues.length > 0 || oldValues.length > 0" class="flex flex-col">
      <div
        v-for="entry in newValues"
        :key="entry.index"
        class="flex min-h-10 items-center justify-between gap-2.5 border-b border-soft py-1 text-detail"
      >
        <strong>{{ withUnit(entry.value) }}</strong>
        <span class="flex items-center gap-2 text-right text-caption text-mute">
          <span
            class="rounded-xl border-[1.5px] border-current px-2 py-[3px] text-xs font-semibold whitespace-nowrap text-ink"
            >neu</span
          >
          <button
            type="button"
            class="flex size-9 items-center justify-center rounded-md border-2 border-ink bg-paper text-ink"
            aria-label="Wert entfernen"
            @click="remove(entry.index)"
          >
            <XIcon :size="16" :stroke-width="2.5" aria-hidden="true" />
          </button>
        </span>
      </div>
      <div
        v-for="record in oldValues"
        :key="record.event_id"
        class="flex min-h-10 items-center justify-between gap-2.5 border-b border-soft py-1 text-detail"
      >
        <strong>{{ withUnit(record.value) }}</strong>
        <span class="text-right text-caption text-mute">{{
          inherited
            ? 'Vom Stamm geerbt'
            : `${formatDateTime(record.recorded_at)} · ${userName(record.user_id)}`
        }}</span>
      </div>
    </div>

    <div v-if="!readonly" class="flex gap-2">
      <!-- The border sits on the wrapper; the focus ring via focus-within, the input itself has no outline. -->
      <div
        class="flex h-[52px] min-w-0 flex-1 items-center rounded-lg border-2 border-ink bg-paper px-3 focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-ink"
      >
        <input
          :id="inputId"
          ref="input"
          class="min-w-0 flex-1 bg-transparent outline-none"
          type="text"
          inputmode="decimal"
          placeholder="Wert"
          autocomplete="off"
          :value="draft ?? (attribute.is_series ? '' : recordedText)"
          :aria-invalid="shownError ? true : undefined"
          :aria-describedby="shownError ? errorId : undefined"
          @input="onInput"
          @keydown.enter.prevent="attribute.is_series && add()"
        />
        <span v-if="unit" class="font-semibold">{{ unit }}</span>
      </div>
      <button
        v-if="attribute.is_series"
        type="button"
        class="min-h-11 shrink-0 rounded-lg border-2 border-ink bg-paper px-3.5 text-detail font-semibold"
        @click="add"
      >
        Hinzufügen
      </button>
    </div>
    <span v-if="shownError && !readonly" :id="errorId" class="text-sm font-semibold" role="alert">{{
      shownError
    }}</span>
  </AttributeField>
</template>
