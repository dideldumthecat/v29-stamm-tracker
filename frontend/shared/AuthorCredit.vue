<script setup lang="ts">
import { HeartIcon } from '@lucide/vue'
</script>

<!-- Size and color come from the surrounding element: the app help page and the administration footer style them. -->
<template>
  <p lang="en">
    Built with
    <HeartIcon
      :size="13"
      fill="currentColor"
      class="inline -translate-y-0.5 align-middle"
      aria-hidden="true"
    />
    <span class="sr-only">love</span> by
    <a href="https://alexandersumma.de" target="_blank" rel="noopener" class="underline"
      >Alexander Summa</a
    >
  </p>
</template>
