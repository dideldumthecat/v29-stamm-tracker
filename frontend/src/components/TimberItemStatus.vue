<script setup lang="ts">
import type { TimberItem } from '@/stores/timberItems'
import { formatShortDate } from '@/utils/date'

defineProps<{
  // undefined = not recorded yet, will be created on save
  item: TimberItem | undefined
}>()
</script>

<template>
  <!-- Known item: tinted box. New item: dashed border, so the difference is visible without colour. -->
  <div
    v-if="item"
    class="mt-4 mx-gutter mb-2 flex flex-col gap-1 rounded-lg bg-well px-3.5 py-3 text-sm"
    role="status"
  >
    <strong class="text-base">Bereits erfasst</strong>
    <span>Angelegt {{ formatShortDate(item.createdAt) }} von {{ item.createdBy }}</span>
  </div>
  <div
    v-else
    class="mt-4 mx-gutter mb-2 flex flex-col gap-1 rounded-lg border-2 border-dashed border-ink px-3.5 py-3 text-sm"
    role="status"
  >
    <strong class="text-base">Noch nicht erfasst</strong>
    <span>Stamm wird beim Speichern angelegt</span>
  </div>
</template>
