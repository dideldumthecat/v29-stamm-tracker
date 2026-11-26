<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import SawBladeIcon from '@/components/SawBladeIcon.vue'

import { LOADING_TEXT } from '@/loadingText'

// The loading state of a card that loads after the page (history, key figures). The heading stays where it is in the loaded card.
defineProps<{ heading: string }>()

// A fast answer should not flash the saw blade: it appears only if loading takes longer than this.
const SHOW_AFTER_MS = 200
const visible = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
onMounted(() => (timer = setTimeout(() => (visible.value = true), SHOW_AFTER_MS)))
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="card p-4 sm:p-6" role="status">
    <p class="text-lg font-bold" aria-hidden="true">{{ heading }}</p>
    <span class="sr-only">{{ LOADING_TEXT }}</span>
    <div v-if="visible" class="my-4 flex justify-center">
      <SawBladeIcon :size="32" :stroke-width="1.5" spinning class="text-ink" aria-hidden="true" />
    </div>
  </div>
</template>
