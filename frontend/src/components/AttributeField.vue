<script setup lang="ts">
import { computed, ref } from 'vue'
import { PencilIcon } from '@lucide/vue'
import type { AttributeValueRecord } from '@/stores/timberItems'
import { formatShortDate } from '@/utils/date'
import { useTimberItemStore } from '@/stores/timberItems'

/**
 * Frame shared by the single-value fields (choice, date, …): label, locked state with pencil,
 * "date · name" line. The slot is the input shown while the field is unlocked.
 */
const props = defineProps<{
  name: string
  // id of the input in the slot, for the <label>
  labelFor: string
  // Current recording of a single-value attribute; undefined = nothing recorded, never locked
  // (series pass nothing: they only append).
  record?: AttributeValueRecord
  // The recorded value as displayed (option label, formatted date, …)
  lockedText?: string
}>()

const store = useTimberItemStore()

// A recorded value is locked against accidental changes; the pencil unlocks it.
const isUnlocked = ref(false)
const isLocked = computed(() => props.record !== undefined && !isUnlocked.value)
</script>

<template>
  <section
    v-if="isLocked && record"
    class="flex flex-col gap-2.5 border-t border-line bg-locked py-3.5 px-gutter text-mute *:max-w-full *:min-w-0"
  >
    <span class="flex items-center justify-between gap-2 text-[17px] font-bold">{{ name }}</span>
    <div class="flex min-h-[52px] items-center gap-3 rounded-lg border-2 border-lockline pl-3">
      <span class="min-w-0 flex-1">{{ lockedText }}</span>
      <button
        type="button"
        class="mr-0.5 flex size-11 items-center justify-center rounded-md text-ink"
        :aria-label="`${name} ändern`"
        @click="isUnlocked = true"
      >
        <PencilIcon :size="22" aria-hidden="true" />
      </button>
    </div>
    <span class="text-[13px] text-mute"
      >{{ formatShortDate(record.recorded_at) }} · {{ store.userName(record.user_id) }}</span
    >
  </section>

  <section
    v-else
    class="flex flex-col gap-2.5 border-t border-line py-3.5 px-gutter *:max-w-full *:min-w-0"
  >
    <div class="flex items-center justify-between gap-2 text-[17px] font-bold">
      <label :for="labelFor">{{ name }}</label>
    </div>
    <slot />
  </section>
</template>
