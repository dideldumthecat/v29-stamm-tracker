<script setup lang="ts">
import { useId } from 'vue'

/**
 * The part "Stamm und Balken" of the attribute settings ("Gültig für" and "Wert vererbbar" as the slot, as rows or as text of a system attribute):
 * a heading of its own (level 3 below the name of the attribute) and the sentence that says what both fields together mean for the beams.
 */
defineProps<{ text: string }>()
const id = useId()
</script>

<template>
  <section class="pt-3" :aria-labelledby="id">
    <h3 :id="id" class="text-base font-bold">Stamm und Balken</h3>
    <p v-if="text" class="mt-1 text-sm text-mute">{{ text }}</p>
    <slot />
  </section>
</template>
