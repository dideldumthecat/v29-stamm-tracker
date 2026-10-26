<script lang="ts" setup>
import SyncButton from '@/components/SyncButton.vue'
import { useTimberItemStore } from '@/stores/timberItems'
import { formatShortDateTime } from '@/utils/date'

const store = useTimberItemStore()
</script>

<template>
  <header
    class="flex h-header shrink-0 items-center justify-between gap-3 border-b-2 border-ink px-gutter"
  >
    <div class="flex min-w-0 flex-col gap-0.5">
      <h1 class="text-[17px] font-bold">V29 Stamm-Tracker</h1>
      <span class="text-xs text-mute"
        >Letzter Sync:
        {{ store.lastSyncedAt ? formatShortDateTime(store.lastSyncedAt) : 'noch nie' }}</span
      >
    </div>
    <div class="flex items-center gap-1.5">
      <SyncButton :pending-count="store.pendingCount" />
    </div>
  </header>
</template>
