<script setup lang="ts">
import { XIcon } from '@lucide/vue'

import type { FilterChip } from '@/listFilters'

/**
 * The active filters as small chips, deliberately quiet (like an inactive filter button). Each chip has two buttons: the text opens the
 * filter (`open`), the cross removes it (`remove`). `data-chip` is what the focus finds the text button by after a removal.
 */
defineProps<{ chips: FilterChip[] }>()
defineEmits<{ open: [id: string]; remove: [id: string] }>()
</script>

<template>
  <ul
    v-if="chips.length"
    class="flex flex-wrap items-center gap-x-2 gap-y-1"
    aria-label="Aktive Filter"
  >
    <li
      v-for="chip in chips"
      :key="chip.id"
      class="flex h-[26px] items-center rounded-lg border border-mute text-caption whitespace-nowrap text-mute"
    >
      <button
        type="button"
        class="h-full rounded-l-lg pr-1 pl-2"
        :data-chip="chip.id"
        @click="$emit('open', chip.id)"
      >
        {{ chip.text }}
      </button>
      <button
        type="button"
        class="flex h-full items-center rounded-r-lg pr-2 pl-1"
        :aria-label="`Filter ${chip.name} entfernen`"
        @click="$emit('remove', chip.id)"
      >
        <XIcon :size="12" aria-hidden="true" />
      </button>
    </li>
  </ul>
</template>
