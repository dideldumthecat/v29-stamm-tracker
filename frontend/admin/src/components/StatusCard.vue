<script setup lang="ts">
defineProps<{ title: string; textClass?: string }>()
</script>

<!-- White card with icon, heading and sentence; loading and "Waldesruh" share it, so both look the same.
     It replaces the whole result area, and min-h-72 keeps the page from jumping. -->
<template>
  <div
    class="mt-6 flex min-h-72 flex-col items-center justify-center gap-4 card px-4 py-16 text-center sm:py-24"
  >
    <slot name="icon" />
    <h2 class="text-display font-bold text-balance">{{ title }}</h2>
    <p class="leading-message text-mute" :class="textClass"><slot name="text" /></p>
    <slot />
  </div>
</template>
