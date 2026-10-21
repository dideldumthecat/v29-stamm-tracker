<script lang="ts" setup>
import SyncButton from '@/components/SyncButton.vue'
</script>

<template>
  <header class="flex items-center justify-between gap-3 border-b-2 border-ink py-3 px-gutter">
    <div class="flex min-w-0 flex-col gap-0.5">
      <span class="text-[17px] font-bold">V29 Stamm-Tracker</span>
      <span class="text-xs text-mute">Zuletzt synchronisiert: 15.10., 18:42</span>
    </div>
    <div class="flex items-center gap-1.5">
      <SyncButton :pending-count="29" />
    </div>
  </header>
</template>
