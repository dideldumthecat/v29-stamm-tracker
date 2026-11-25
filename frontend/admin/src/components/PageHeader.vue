<script setup lang="ts">
/** The head of every overview page: heading, optional intro text and the one gap to the content (the pages set none of their own). */
defineProps<{ title: string }>()
</script>

<template>
  <header class="mb-8">
    <!-- Heading and the `aside` slot on one baseline; too narrow for both, the aside goes below the heading, at the left -->
    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
      <h1 class="text-3xl font-bold">{{ title }}</h1>
      <slot name="aside" />
    </div>
    <p v-if="$slots.default" class="mt-2 text-measure text-mute"><slot /></p>
  </header>
</template>
