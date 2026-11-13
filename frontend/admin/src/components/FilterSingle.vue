<script setup lang="ts">
import { useId } from 'vue'

/** One of several values, "Alle" (empty) among them; the choice is passed up at once. */
defineProps<{ options: { id: string; label: string }[]; value: string }>()
defineEmits<{ change: [value: string] }>()
const name = useId()
</script>

<template>
  <ul>
    <li v-for="option in options" :key="option.id">
      <label class="flex h-10 items-center gap-3 rounded-md px-2 hover:bg-well">
        <input
          type="radio"
          :name="name"
          class="size-5 shrink-0 accent-ink"
          :checked="option.id === value"
          @change="$emit('change', option.id)"
        />
        {{ option.label }}
      </label>
    </li>
  </ul>
</template>
