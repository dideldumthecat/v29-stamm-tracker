<script setup lang="ts">
import AppToast from '@/components/AppToast.vue'
</script>

<template>
  <!-- Frame shared by all screens. Each view brings its own header, because
       the start screen and the timber item screen use different ones. -->
  <div
    class="mx-auto grid h-screen-safe max-w-[430px] grid-rows-[minmax(0,1fr)] overflow-hidden bg-paper min-[480px]:border-x min-[480px]:border-line"
  >
    <RouterView />
  </div>
  <AppToast />
</template>
