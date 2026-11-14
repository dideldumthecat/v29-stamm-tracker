<script setup lang="ts">
import { BugIcon } from '@lucide/vue'

// The error state of a card that loads after the page and fails on its own (history, key figures).
defineProps<{ message: string }>()
defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="flex flex-col items-center gap-4 card p-4 text-center sm:p-6" role="alert">
    <BugIcon :size="40" :stroke-width="1.5" class="text-ink" aria-hidden="true" />
    <p class="leading-message">{{ message }}</p>
    <button
      type="button"
      class="mt-2 h-11 rounded-lg border-2 border-ink px-4 font-bold"
      @click="$emit('retry')"
    >
      Erneut versuchen
    </button>
  </div>
</template>
