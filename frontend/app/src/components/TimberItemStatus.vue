<script setup lang="ts">
import { CornerLeftUpIcon } from '@lucide/vue'
import type { TimberItem } from '@/stores/timberItems'
import { formatShortDate } from '@/utils/date'
import { useTimberItemStore } from '@/stores/timberItems'
import FormattedTag from '@/components/FormattedTag.vue'

defineProps<{
  // undefined = not recorded yet, will be created on save
  item: TimberItem | undefined
  // Set for a beam: tag of the stem it was cut from. Also tells a new beam from a new stem.
  parentTag?: string
}>()

const store = useTimberItemStore()
</script>

<template>
  <!-- Known item: tinted box. New item: dashed border, so the difference is visible without colour. -->
  <div
    class="mt-4 mx-gutter mb-2 flex flex-col rounded-lg text-sm"
    :class="item ? 'bg-well' : 'border-2 border-dashed border-ink'"
  >
    <div class="flex flex-col gap-1 px-3.5 py-3" role="status">
      <template v-if="item">
        <strong class="text-base">Bereits erfasst</strong>
        <span
          >Angelegt {{ formatShortDate(item.created_at) }} von
          {{ store.userName(item.created_by) }}</span
        >
      </template>
      <template v-else>
        <strong class="text-base">Noch nicht erfasst</strong>
        <span>{{ parentTag ? 'Balken' : 'Stamm' }} wird beim Speichern angelegt</span>
      </template>
    </div>
    <!-- Full card width, so the whole row is the tap target. -->
    <RouterLink
      v-if="parentTag"
      :to="{ name: 'timber-item', params: { tagNumber: parentTag } }"
      class="flex min-h-12 items-center gap-2 rounded-b-lg border-t px-3.5 font-semibold"
      :class="item ? 'border-line' : 'border-dashed border-ink'"
    >
      <CornerLeftUpIcon :size="20" aria-hidden="true" />
      <span
        >Aus Stamm <FormattedTag :tag-number="parentTag" class="underline underline-offset-4"
      /></span>
    </RouterLink>
  </div>
</template>
