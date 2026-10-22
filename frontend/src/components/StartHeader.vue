<script lang="ts" setup>
import SyncButton from '@/components/SyncButton.vue'
import { useTimberItemStore } from '@/stores/timberItems'

const store = useTimberItemStore()
</script>

<template>
  <header
    class="flex h-header shrink-0 items-center justify-between gap-3 border-b-2 border-ink px-gutter"
  >
    <div class="flex min-w-0 flex-col gap-0.5">
      <span class="text-[17px] font-bold">V29 Stamm-Tracker</span>
      <span class="text-xs text-mute">Letzter Sync: 15.10., 18:42</span>
    </div>
    <div class="flex items-center gap-1.5">
      <SyncButton :pending-count="store.pendingCount" />
    </div>
  </header>
</template>
