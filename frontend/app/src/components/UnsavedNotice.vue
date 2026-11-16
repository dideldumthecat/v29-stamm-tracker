<script setup lang="ts">
import { TriangleAlertIcon } from '@lucide/vue'
import { useRoute } from 'vue-router'
import { useTimberItemStore } from '@/stores/timberItems'

const store = useTimberItemStore()
const route = useRoute()
</script>

<template>
  <!-- Stays until the entries are safe (see createPersistence). Inverted: the app has no warning colour, and this must
       be seen outdoors. Above every screen, so it needs no place in their layouts. -->
  <div
    v-if="store.hasUnsaved"
    role="alert"
    class="flex shrink-0 items-center gap-3 bg-ink py-3 px-gutter text-detail leading-notice text-paper"
  >
    <TriangleAlertIcon class="shrink-0" :size="22" aria-hidden="true" />
    <p class="min-w-0 flex-1">
      Nicht auf dem Gerät gespeichert. App offen lassen und synchronisieren.
    </p>
    <RouterLink
      v-if="route.name !== 'sync'"
      :to="{ name: 'sync' }"
      class="flex min-h-11 shrink-0 items-center rounded-lg border-2 border-paper px-3 font-semibold"
    >
      Sync
    </RouterLink>
  </div>
</template>
