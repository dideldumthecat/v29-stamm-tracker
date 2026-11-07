<script setup lang="ts">
import { computed, ref } from 'vue'
import { PencilIcon } from '@lucide/vue'
import type { AttributeValueRecord } from '@/stores/timberItems'
import InactiveHint from '@/components/InactiveHint.vue'
import { formatDateTime } from '@/utils/date'

/**
 * Frame shared by the single-value fields (choice, date, …): label, locked state with pencil,
 * "date · name" line. The slot is the input shown while the field is unlocked.
 */
const props = defineProps<{
  name: string
  // Shown below the field in every state (empty, editing, locked, read-only).
  description?: string
  // Description right below the heading instead (choice: read before picking an option).
  descriptionAbove?: boolean
  // id of the input in the slot, for the <label>
  labelFor: string
  // Current recording of a single-value attribute; undefined = nothing recorded, never locked
  // (series pass nothing: they only append).
  record?: AttributeValueRecord
  // The recorded value as displayed (option label, formatted date, …)
  lockedText?: string
  // The recorded option is inactive: struck through and marked.
  lockedInactive?: boolean
  // No pencil and no input: inactive attribute, or a stem split into beams.
  readonly?: boolean
  // Inactive attribute: name struck through and marked.
  inactive?: boolean
  // Beam only: the value comes from the parent (shown as a hint, still overwritable).
  inherited?: boolean
  // Name of whoever recorded `record`.
  recordedBy?: string
}>()

// A recorded value is locked against accidental changes; the pencil unlocks it.
const isUnlocked = ref(false)
const isLocked = computed(() => props.record !== undefined && (props.readonly || !isUnlocked.value))
</script>

<template>
  <section
    v-if="isLocked && record"
    class="flex flex-col gap-2.5 border-t border-line bg-locked py-section px-gutter text-mute *:max-w-full *:min-w-0"
  >
    <span class="flex items-baseline gap-2 text-heading font-bold">
      <span :class="{ 'line-through': inactive }">{{ name }}</span
      ><InactiveHint v-if="inactive"
    /></span>
    <p v-if="description && descriptionAbove" class="text-sm leading-copy text-body">
      {{ description }}
    </p>
    <div class="flex min-h-[52px] items-center gap-3 rounded-lg border-2 border-lockline pl-3">
      <span class="min-w-0 flex-1 wrap-anywhere whitespace-pre-line"
        ><span :class="{ 'line-through': lockedInactive }">{{ lockedText }}</span
        ><InactiveHint v-if="lockedInactive" class="ml-2"
      /></span>
      <button
        v-if="!readonly"
        type="button"
        class="mr-0.5 flex size-11 items-center justify-center rounded-md text-ink"
        :aria-label="`${name} ändern`"
        @click="isUnlocked = true"
      >
        <PencilIcon :size="22" aria-hidden="true" />
      </button>
    </div>
    <p v-if="description && !descriptionAbove" class="text-sm leading-copy text-body">
      {{ description }}
    </p>
    <span class="text-caption text-mute"
      >{{ formatDateTime(record.recorded_at) }} · {{ recordedBy
      }}{{ inherited ? ' · vom Stamm' : '' }}</span
    >
  </section>

  <section
    v-else
    class="flex flex-col gap-2.5 border-t border-line py-section px-gutter *:max-w-full *:min-w-0"
  >
    <div class="flex items-center justify-between gap-2 text-heading font-bold">
      <span v-if="readonly" class="flex items-baseline gap-2"
        ><span :class="{ 'line-through': inactive }">{{ name }}</span
        ><InactiveHint v-if="inactive"
      /></span>
      <label v-else :for="labelFor">{{ name }}</label>
    </div>
    <p v-if="description && descriptionAbove" class="text-sm leading-copy text-body">
      {{ description }}
    </p>
    <slot />
    <p v-if="description && !descriptionAbove" class="text-sm leading-copy text-body">
      {{ description }}
    </p>
  </section>
</template>
