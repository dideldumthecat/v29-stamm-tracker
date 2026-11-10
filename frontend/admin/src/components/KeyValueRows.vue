<script setup lang="ts">
import { computed } from 'vue'
import type { ActivityItem } from '@v29/shared/contract'

import { detailRows } from '@/activity'

// "Merkmal | Wert" of one stem or beam; the activity cards and the history of the detail page share it.
// Fixed columns (2fr | 3fr) in every block, never sized by the longest name, so that all blocks share one edge.
// The parent may set --pad (the inner padding of its card); without it there is none.
// `framed` (history): a faint border around the block, no lines between the rows.
const props = defineProps<{ item: ActivityItem; labelledby: string; framed?: boolean }>()
const rows = computed(() => detailRows(props.item))
</script>

<template>
  <dl :class="framed && 'rounded-lg border border-soft'" :aria-labelledby="labelledby">
    <div
      v-for="(row, index) in rows"
      :key="index"
      class="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 px-[var(--pad,0px)] py-1.5 max-sm:grid-cols-1 max-sm:py-2"
    >
      <dt class="text-caption font-semibold wrap-anywhere text-mute">{{ row.name }}</dt>
      <dd class="text-sm wrap-anywhere text-ink max-sm:mt-0.5">{{ row.value }}</dd>
    </div>
  </dl>
</template>
