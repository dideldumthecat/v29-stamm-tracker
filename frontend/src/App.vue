<script setup lang="ts">
import { RotateCwIcon } from '@lucide/vue'
import AppToast from '@/components/AppToast.vue'
</script>

<template>
  <!-- Frame shared by all screens. Each view brings its own header, because
       the start screen and the timber item screen use different ones. -->
  <div
    class="mx-auto grid h-screen-safe max-w-[430px] grid-rows-[minmax(0,1fr)] overflow-hidden bg-paper min-[480px]:border-x min-[480px]:border-line"
  >
    <!-- Keyed by path: parent → beam stays on the same route, but each item needs a fresh screen. -->
    <RouterView v-slot="{ Component, route }">
      <component :is="Component" :key="route.fullPath" />
    </RouterView>
  </div>
  <AppToast />
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
