<script setup lang="ts">
import { computed, useId } from 'vue'
import type { Attribute, AttributeValueRecord } from '@/stores/timberItems'
import AttributeField from '@/components/AttributeField.vue'
import { formatShortDate } from '@/utils/date'
import { useTimberItemStore } from '@/stores/timberItems'

/**
 * Text attribute. Without `is_series`: one value, locked once recorded (like choice).
 * With `is_series` (e.g. notes): earlier entries as a list, the textarea holds one new entry
 * that is appended on save. No "Hinzufügen" – one entry per save is enough for notes.
 */
const props = defineProps<{
  attribute: Attribute
  // Recordings for this attribute from the timber item, if any (always an array, oldest first).
  recorded: AttributeValueRecord[] | undefined
  // Inactive attribute: shows what was recorded, no input.
  readonly?: boolean
  // Beam only: the value comes from the parent (shown as a hint, still overwritable).
  inherited?: boolean
}>()

const store = useTimberItemStore()

// Text as typed. Empty or whitespace-only counts as no change (decided by the parent).
// undefined = untouched.
const draft = defineModel<string | undefined>()

const textareaId = useId()

const current = computed(() => props.recorded?.slice(-1)[0])
const currentText = computed(() => String(current.value?.value ?? ''))
// Newest first, as in the prototype.
const entries = computed(() => [...(props.recorded ?? [])].reverse())

function onInput(event: Event) {
  draft.value = (event.target as HTMLTextAreaElement).value
}
</script>

<template>
  <AttributeField
    :name="attribute.name"
    :label-for="textareaId"
    :record="attribute.is_series ? undefined : current"
    :locked-text="currentText"
    :readonly="readonly"
    :inherited="inherited"
  >
    <div v-if="attribute.is_series && entries.length > 0" class="flex flex-col">
      <div
        v-for="record in entries"
        :key="record.event_id"
        class="flex flex-col gap-1 border-b border-soft py-2"
      >
        <p class="text-[15px] leading-[1.4] wrap-anywhere whitespace-pre-line">
          {{ record.value }}
        </p>
        <span class="text-[13px] text-mute"
          >{{ formatShortDate(record.recorded_at) }} · {{ store.userName(record.user_id)
          }}{{ inherited ? ' · vom Stamm' : '' }}</span
        >
      </div>
    </div>
    <!-- A series starts empty (new entry); a single value starts with the recorded text. -->
    <textarea
      v-if="!readonly"
      :id="textareaId"
      class="min-h-[84px] w-full resize-y rounded-lg border-2 border-ink bg-paper px-3 py-2.5 leading-[1.4]"
      rows="3"
      placeholder="Beobachtung, Auffälligkeit …"
      :value="draft ?? (attribute.is_series ? '' : currentText)"
      @input="onInput"
    ></textarea>
  </AttributeField>
</template>
