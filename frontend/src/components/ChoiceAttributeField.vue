<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { PencilIcon } from '@lucide/vue'
import type { Attribute, RecordedValue } from '@/stores/timberItems'
import { formatShortDate } from '@/utils/date'

const props = defineProps<{
  attribute: Attribute
  // Value already recorded for this item, if any.
  recorded: RecordedValue | undefined
}>()

// Draft selection (option id). undefined = untouched; the parent compares it with `recorded`.
const draft = defineModel<string | undefined>()

const selectId = useId()

// A recorded value is locked against accidental changes; the pencil unlocks it.
const isUnlocked = ref(false)
const isLocked = computed(() => props.recorded !== undefined && !isUnlocked.value)

const recordedLabel = computed(
  () => props.attribute.options.find((option) => option.id === props.recorded?.optionId)?.label,
)

// What the select shows: the draft if touched, otherwise the recorded value.
const selectedOptionId = computed(() => draft.value ?? props.recorded?.optionId ?? '')

function unlock() {
  isUnlocked.value = true
}

function onChange(event: Event) {
  draft.value = (event.target as HTMLSelectElement).value
}
</script>

<template>
  <section
    v-if="isLocked"
    class="flex flex-col gap-2.5 border-t border-line bg-locked py-3.5 px-gutter text-mute *:max-w-full *:min-w-0"
  >
    <span class="flex items-center justify-between gap-2 text-[17px] font-bold">{{
      attribute.name
    }}</span>
    <div class="flex min-h-[52px] items-center gap-3 rounded-lg border-2 border-lockline pl-3">
      <span class="min-w-0 flex-1">{{ recordedLabel }}</span>
      <button
        type="button"
        class="mr-0.5 flex size-11 items-center justify-center rounded-md text-ink"
        :aria-label="`${attribute.name} ändern`"
        @click="unlock"
      >
        <PencilIcon :size="22" aria-hidden="true" />
      </button>
    </div>
    <span v-if="recorded" class="text-[13px] text-mute"
      >{{ formatShortDate(recorded.recordedAt) }} · {{ recorded.recordedBy }}</span
    >
  </section>

  <section
    v-else
    class="flex flex-col gap-2.5 border-t border-line py-3.5 px-gutter *:max-w-full *:min-w-0"
  >
    <div class="flex items-center justify-between gap-2 text-[17px] font-bold">
      <label :for="selectId">{{ attribute.name }}</label>
    </div>
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
  </section>
</template>
