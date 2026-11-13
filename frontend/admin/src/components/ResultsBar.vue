<script setup lang="ts">
import { useTemplateRef } from 'vue'

import FilterChips from '@/components/FilterChips.vue'
import type { FilterChip } from '@/listFilters'
import { useSizeVariable } from '@/sizeVariable'

/**
 * The bar with the number of hits, the chips of the active filters behind it and a slot at the right (the arrows of the stem list).
 * It sticks below the header (from lg on, below it the header scrolls away) over the whole width of the window with the grey page
 * background, above the content (z-20) and below the header (z-50). It wraps when there are many chips; its height goes into the scroll
 * padding of the page (`--sticky-bar-height`, main.css), so that a focused element does not end up behind it. min-h-15 = 44 px + padding,
 * so that the row does not grow when the arrows appear.
 */
defineProps<{ text: string; chips: FilterChip[] }>()
defineEmits<{ open: [id: string]; remove: [id: string] }>()

const bar = useTemplateRef<HTMLElement>('bar')
useSizeVariable(bar, '--sticky-bar-height', 'height')
</script>

<template>
  <div
    ref="bar"
    class="sticky top-0 left-0 z-20 w-[100cqw] bg-desk lg:top-[var(--header-height,0px)]"
  >
    <div class="page-column flex min-h-15 items-center justify-between gap-4 py-2">
      <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
        <p class="text-lg font-bold">{{ text }}</p>
        <FilterChips
          :chips="chips"
          @open="$emit('open', $event)"
          @remove="$emit('remove', $event)"
        />
      </div>
      <slot name="end" />
    </div>
  </div>
</template>
