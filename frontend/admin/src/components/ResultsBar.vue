<script setup lang="ts">
import { useTemplateRef } from 'vue'
import { XIcon } from '@lucide/vue'

import FilterChips from '@/components/FilterChips.vue'
import type { FilterChip } from '@/listFilters'
import { useSizeVariable } from '@/sizeVariable'

/**
 * The bar with the number of hits, the chips of the active filters behind it, "Filter zurücksetzen" (only with a filter) and a slot at
 * the right (the arrows of the stem list). It sticks below the header (from lg on, below it the header scrolls away) over the whole
 * width of the window with the grey page background, above the content (z-20) and below the header (z-50). The chips take the width
 * between the count and the button and wrap: two lines of 26 px chips with a 4 px gap fit into min-h-15 (60 px) with 2 px padding, the bar
 * grows from the third line on. Below 640 px the button and the slot move under the chips, at the right. Its height goes into the scroll
 * padding of the page (`--sticky-bar-height`, main.css), so that a focused element does not end up behind it. The buttons in the bar
 * themselves lie in that zone, so they take it out with a negative scroll margin (as the buttons of the table head do): otherwise
 * focusing or clicking one would scroll the page.
 */
defineProps<{ text: string; chips: FilterChip[]; canReset: boolean }>()
defineEmits<{ open: [id: string]; remove: [id: string]; reset: [] }>()

const bar = useTemplateRef<HTMLElement>('bar')
useSizeVariable(bar, '--sticky-bar-height', 'height')
</script>

<template>
  <div
    ref="bar"
    class="sticky top-0 left-0 z-20 w-[100cqw] bg-desk lg:top-[var(--header-height,0px)] [&_button]:scroll-mt-[calc((var(--sticky-bar-height,0px)+var(--table-head-height,0px)+8px)*-1)]"
  >
    <div
      class="page-column grid min-h-15 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1 py-0.5 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
    >
      <p v-if="text" class="text-lg font-bold">{{ text }}</p>
      <div class="col-start-2 min-w-0">
        <FilterChips
          :chips="chips"
          @open="$emit('open', $event)"
          @remove="$emit('remove', $event)"
        />
      </div>
      <div class="col-span-2 flex items-center gap-4 justify-self-end sm:col-span-1 sm:col-start-3">
        <button
          v-if="canReset"
          type="button"
          class="flex h-11 items-center gap-2 rounded-lg px-2 text-base whitespace-nowrap text-ink underline last:-mr-2 active:bg-ink active:text-paper"
          @click="$emit('reset')"
        >
          <XIcon :size="18" aria-hidden="true" />
          Filter zurücksetzen
        </button>
        <slot name="end" />
      </div>
    </div>
  </div>
</template>
