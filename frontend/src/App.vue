<script setup lang="ts">
import { LoaderCircleIcon, RotateCwIcon } from '@lucide/vue'
import { useRegisterSW } from 'virtual:pwa-register/vue'
import AppToast from '@/components/AppToast.vue'
import {
  installWhenSafe,
  isInstalling,
  isLockStuck,
  reloadFromLock,
  startUpdateCheck,
} from '@/composables/useUpdateCheck'

// registerType 'prompt': a new service worker waits until installWhenSafe finds a moment where a reload costs nothing.
const { needRefresh, updateServiceWorker } = useRegisterSW({
  // Registers once per page load and lives as long as the app, so the cleanup function is not needed.
  onRegisteredSW(_url, registration) {
    if (registration) {
      startUpdateCheck(registration)
    }
  },
})
installWhenSafe(needRefresh, updateServiceWorker)
</script>

<template>
  <!-- Frame shared by all screens. Each view brings its own header, because
       the start screen and the timber item screen use different ones. -->
  <div
    :inert="isInstalling || undefined"
    class="mx-auto grid h-screen-safe max-w-[430px] grid-rows-[minmax(0,1fr)] overflow-hidden bg-paper min-[480px]:border-x min-[480px]:border-line"
  >
    <!-- Keyed by path: parent → beam stays on the same route, but each item needs a fresh screen. -->
    <RouterView v-slot="{ Component, route }">
      <component :is="Component" :key="route.fullPath" />
    </RouterView>
  </div>
  <AppToast />
  <!-- Covers the whole app (also the landscape hint) from the start of an update until the reload. The frame above is
       inert, so neither taps nor keyboard nor screen readers reach it. No close button: the page reloads by itself. -->
  <div
    v-if="isInstalling"
    role="status"
    class="fixed inset-0 z-110 flex flex-col items-center justify-center gap-4 bg-paper py-4 px-gutter text-center text-ink"
  >
    <LoaderCircleIcon
      :size="40"
      class="animate-spin text-mute motion-reduce:animate-none"
      aria-hidden="true"
    />
    <p class="text-[22px] leading-[1.3]">App wird aktualisiert …</p>
    <!-- Only after LOCK_ESCAPE_MS: the reload did not come. The one operable element; the frame stays inert. -->
    <template v-if="isLockStuck">
      <button
        type="button"
        class="min-h-14 rounded-lg bg-ink px-8 text-lg font-bold text-paper"
        @click="reloadFromLock"
      >
        Neu laden
      </button>
      <p class="text-base leading-[1.3] text-body">
        Falls nichts passiert: App schließen und neu öffnen
      </p>
    </template>
  </div>
  <!-- iOS ignores the manifest's orientation and cannot lock it from JavaScript, so landscape only gets a hint.
       Shown by CSS alone: the app below stays mounted, so entries, scroll position and route survive the rotation. -->
  <div
    class="fixed inset-0 z-100 hidden flex-col items-center justify-center gap-4 bg-paper py-4 px-gutter text-center text-ink landscape-phone:flex"
    style="
      padding-top: max(16px, env(safe-area-inset-top, 0px));
      padding-bottom: max(16px, env(safe-area-inset-bottom, 0px));
    "
  >
    <RotateCwIcon :size="48" aria-hidden="true" />
    <p class="text-[22px] leading-[1.3]">Bitte das Handy hochkant halten.</p>
  </div>
</template>
