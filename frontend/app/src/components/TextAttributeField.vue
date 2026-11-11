<script setup lang="ts">
import { computed, useId } from 'vue'
import type { Attribute, AttributeValueRecord } from '@/stores/timberItems'
import AttributeField from '@/components/AttributeField.vue'
import { formatDateTime } from '@/utils/date'

/**
 * Text attribute. Without `is_series`: one value, locked once recorded (like choice).
 * With `is_series` (e.g. notes): earlier entries as a list, the textarea holds one new entry
 * that is appended on save. No "Hinzufügen" – one entry per save is enough for notes.
 */
const props = defineProps<{
  attribute: Attribute
  // Recordings for this attribute from the timber item, if any (always an array, oldest first).
  recorded: AttributeValueRecord[] | undefined
  // No pencil and no input: inactive attribute, or a stem split into beams.
  readonly?: boolean
  // Beam only: the value comes from the parent (shown as a hint, still overwritable).
  inherited?: boolean
  // Resolved by the caller, so the field needs no store.
  userName: (userId: string) => string
}>()

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
    :description="attribute.description"
    :label-for="textareaId"
    :record="attribute.is_series ? undefined : current"
    :recorded-by="current && userName(current.user_id)"
    :locked-text="currentText"
    :readonly="readonly"
    :inactive="!attribute.active"
    :inherited="inherited"
  >
    <div v-if="attribute.is_series && entries.length > 0" class="flex flex-col">
      <div
        v-for="record in entries"
        :key="record.event_id"
        class="flex flex-col gap-1 border-b border-soft py-2"
      >
        <p class="text-detail leading-copy wrap-anywhere whitespace-pre-line">
          {{ record.value }}
        </p>
        <span class="text-caption text-mute">{{
          inherited
            ? 'Vom Stamm geerbt'
            : `${formatDateTime(record.recorded_at)} · ${userName(record.user_id)}`
        }}</span>
      </div>
    </div>
    <!-- A series starts empty (new entry); a single value starts with the recorded text. -->
    <textarea
      v-if="!readonly"
      :id="textareaId"
      class="min-h-[84px] w-full resize-y rounded-lg border-2 border-ink bg-paper px-3 py-2.5 leading-copy"
      rows="3"
      placeholder="Beobachtung, Auffälligkeit …"
      :value="draft ?? (attribute.is_series ? '' : currentText)"
      @input="onInput"
    ></textarea>
  </AttributeField>
</template>
