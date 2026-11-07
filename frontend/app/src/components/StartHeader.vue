<script lang="ts" setup>
import { InfoIcon } from '@lucide/vue'
import V29Logo from '@v29/shared/V29Logo.vue'
import SyncButton from '@/components/SyncButton.vue'
import { useTimberItemStore } from '@/stores/timberItems'
import { formatShortDateTime } from '@/utils/date'

const store = useTimberItemStore()
</script>

<template>
  <!-- One root: StartView places the header as a single grid row. -->
  <div>
    <header
      class="flex h-header shrink-0 items-center justify-between gap-3 border-b-2 border-ink px-gutter"
    >
      <div class="flex min-w-0 items-center gap-3">
        <!-- 42 = heading line (24) + gap (2) + name line (16); fixed, so it does not change without a name -->
        <V29Logo :height="42" />
        <div class="flex min-w-0 flex-col gap-0.5">
          <h1 class="text-label leading-6 font-bold">
            <span class="sr-only">V29 </span>Stamm-Tracker
          </h1>
          <span v-if="store.currentUser" class="text-xs wrap-anywhere text-mute">{{
            store.currentUser.name
          }}</span>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        <RouterLink
          :to="{ name: 'help' }"
          class="flex size-11 shrink-0 items-center justify-center"
          aria-label="Hilfe"
        >
          <InfoIcon :size="24" aria-hidden="true" />
        </RouterLink>
        <SyncButton :pending-count="store.pendingCount" />
      </div>
    </header>
    <p class="border-b border-line py-2 px-gutter text-center text-caption text-mute">
      Stand der Daten:
      {{ store.lastSyncedAt ? formatShortDateTime(store.lastSyncedAt) : 'noch nie' }}
    </p>
  </div>
</template>
