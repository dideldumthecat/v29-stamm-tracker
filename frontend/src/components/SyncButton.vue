<script lang="ts" setup>
import { RefreshCwIcon } from '@lucide/vue'
defineProps<{
  pendingCount: number
}>()
</script>

<template>
  <button
    type="button"
    class="flex min-h-11 items-center gap-2 rounded-full border-2 border-ink bg-paper pl-2 text-[15px] font-semibold"
    :class="pendingCount > 0 ? 'pr-1.5' : 'pr-2.5'"
    :aria-label="`Synchronisieren, ${pendingCount} offene Einträge`"
  >
    <RefreshCwIcon :size="20" aria-hidden="true" />
    <span class="flex items-center gap-1">
      <span>Sync</span>
      <span
        v-if="pendingCount > 0"
        class="flex h-[26px] min-w-[26px] items-center justify-center rounded-full bg-ink px-1.5 text-sm text-paper tabular-nums"
        >{{ pendingCount }}</span
      >
    </span>
  </button>
</template>
