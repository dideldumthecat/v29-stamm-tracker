<script lang="ts" setup>
defineProps<{
  pendingCount: number
}>()
</script>

<template>
  <button
    type="button"
    class="flex min-h-11 items-center gap-2 rounded-full border-2 border-ink bg-paper text-[15px] font-semibold pl-2"
    :class="pendingCount > 0 ? 'pr-1.5' : 'pr-2.5'"
    :aria-label="`Synchronisieren, ${pendingCount} offene Einträge`"
  >
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2" />
      <path d="M21 4v5h-5M3 20v-5h5" />
    </svg>
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
