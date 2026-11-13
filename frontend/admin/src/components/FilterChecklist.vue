<script setup lang="ts">
import { NOT_RECORDED_PICK } from '@/listFilters'

/** A list of ticks (choice, yes/no): any of the ticked values; "Nicht erfasst" apart under a line. Every tick is passed up at once. */
const props = defineProps<{ options: { id: string; label: string }[]; picks: string[] }>()
const emit = defineEmits<{ change: [picks: string[]] }>()

function toggle(id: string) {
  emit(
    'change',
    props.picks.includes(id) ? props.picks.filter((pick) => pick !== id) : [...props.picks, id],
  )
}
const row = 'flex h-10 items-center gap-3 rounded-md px-2 hover:bg-well'
</script>

<template>
  <ul>
    <li v-for="option in options" :key="option.id">
      <label :class="row">
        <input
          type="checkbox"
          class="size-5 shrink-0 accent-ink"
          :checked="picks.includes(option.id)"
          @change="toggle(option.id)"
        />
        {{ option.label }}
      </label>
    </li>
    <li class="mt-1 border-t border-soft pt-1">
      <label :class="row">
        <input
          type="checkbox"
          class="size-5 shrink-0 accent-ink"
          :checked="picks.includes(NOT_RECORDED_PICK)"
          @change="toggle(NOT_RECORDED_PICK)"
        />
        Nicht erfasst
      </label>
    </li>
  </ul>
</template>
