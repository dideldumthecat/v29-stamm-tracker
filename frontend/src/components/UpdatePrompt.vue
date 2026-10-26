<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { XIcon } from '@lucide/vue'

// registerType 'prompt': the new service worker waits until the user confirms.
const { needRefresh, updateServiceWorker } = useRegisterSW()
const route = useRoute()
</script>

<template>
  <!-- Start screen only: updating reloads the app, which would throw away an unsaved entry. -->
  <div
    v-if="needRefresh && route.name === 'start'"
    class="fixed top-safe-3 left-1/2 z-60 flex w-[calc(100%-32px)] max-w-[398px] -translate-x-1/2 items-center justify-between gap-3 rounded-lg border-2 border-ink bg-paper py-2.5 pr-1.5 pl-4 text-[15px] leading-[1.35] font-semibold text-ink shadow-lg"
    role="status"
  >
    <span class="min-w-0 flex-1">Neue Version verfügbar</span>
    <button
      type="button"
      class="min-h-11 shrink-0 p-1.5 font-bold text-ink underline"
      @click="updateServiceWorker(true)"
    >
      Aktualisieren
    </button>
    <button
      type="button"
      class="flex size-11 shrink-0 items-center justify-center text-ink"
      aria-label="Hinweis schließen"
      @click="needRefresh = false"
    >
      <XIcon :size="22" aria-hidden="true" />
    </button>
  </div>
</template>
