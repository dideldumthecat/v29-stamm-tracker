<script setup lang="ts">
import InfoPopover from '@/components/InfoPopover.vue'

/**
 * The info button of a figure (detail view and dashboard): opens formula, inserted values, result and note, all as the server wrote them.
 * The parent places the button (its classes go to the button, see InfoPopover) and decides which one is open.
 */
defineOptions({ inheritAttrs: false })
defineProps<{
  label: string
  formula: string
  inserted: string | null
  /** The formatted value */
  result: string
  note: string | null
}>()
const open = defineModel<boolean>('open', { required: true })
</script>

<template>
  <InfoPopover v-model:open="open" v-bind="$attrs" :button-label="`Formel für ${label} anzeigen`">
    <h3 class="text-[15px] font-bold">So wird {{ label }} berechnet</h3>
    <dl class="mt-3 space-y-2 text-sm">
      <div class="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3">
        <dt class="font-semibold text-mute">Formel</dt>
        <dd class="wrap-anywhere">{{ formula }}</dd>
      </div>
      <div v-if="inserted !== null" class="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3">
        <dt class="font-semibold text-mute">Eingesetzt</dt>
        <dd class="wrap-anywhere">{{ inserted }}</dd>
      </div>
      <div class="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3">
        <dt class="font-semibold text-mute">Ergebnis</dt>
        <dd class="font-bold tabular-nums">{{ result }}</dd>
      </div>
    </dl>
    <p v-if="note" class="mt-3 border-t border-soft pt-3 text-caption text-mute">
      {{ note }}
    </p>
  </InfoPopover>
</template>
